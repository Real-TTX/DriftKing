// DriftKing · render/stage.js – the one WebGL canvas of the app: renderer, the frame loop, the picture quality.
// Whoever owns the screen (menu backdrop, garage, a run) calls stage.show({ scene, camera, update(dt, time), post? }).
// The renderer is HDR-ready (tone mapping, sRGB output); medium and high render through the post chain (render/post.js), low directly.

import * as THREE from 'three';
import { settings } from '../settings.js';
import { createPost, POST_DEFAULTS, toneMapColor } from './post.js';
import { setRenderer } from './device.js';
import { disposeEnvironments } from './environment.js';
import { disposeMaterials } from './materials.js';
import { setGlowGain } from './kit.js';

/** Pixel ratio per quality: low renders below the screen's resolution, high up to 2×. */
const PIXEL_RATIO = { low: 0.75, medium: 1.25, high: 2 };

/**
 * The tone mapping of the whole game. ACES keeps the night deep (a real toe) and lets neon and lamps burn out to white in a filmic way;
 * see docs/RENDERING.md for the comparison with AgX and Neutral.
 */
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;

/**
 * Low renders straight to the canvas, so every fragment of every material tone-maps itself: it gets a cheaper fit of the same curve
 * (Narkowicz 2015, with the input × 0.8 it matches three's ACES within a few percent for greys; no gamut matrices) as three's
 * CustomToneMapping. Medium and high tone-map once per pixel in the post chain with the full ACES.
 */
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    'vec3 CustomToneMapping( vec3 color ) { color *= toneMappingExposure * 0.8; ' +
        'return saturate( ( color * ( 2.51 * color + 0.03 ) ) / ( color * ( 2.43 * color + 0.59 ) + 0.14 ) ); }',
);

/** The additive glow sprites (render/kit.js) are the "bloom" of low; with a real bloom they step back. */
const GLOW_GAIN = { low: 1, medium: 0.55, high: 0.5 };

/**
 * Creates the renderer inside the host element and starts the frame loop.
 * A view may carry post settings: view.post (or view.scene.userData.post) = { exposure, bloom: { strength, radius, threshold } | false, vignette, grain };
 * view.post = false renders that view directly even on medium/high.
 * @param {HTMLElement} host the element the canvas fills (#dk-stage)
 * @returns {{ renderer: THREE.WebGLRenderer, show(view: { scene: THREE.Scene, camera: THREE.Camera, update?: (dt: number, time: number) => void, post?: object|false }): void,
 *            clear(): void, quality: string, fps: number, time: number, post: import('./post.js').PostChain|null, size(): { width: number, height: number }, dispose(): void }}
 */
export function createStage(host) {
    // no multisampling on the canvas: medium and high anti-alias in the post chain's own target, low stays without (as it always was)
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = TONE_MAPPING;
    renderer.toneMappingExposure = POST_DEFAULTS.exposure;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x0b0a18, 1);
    // the post chain renders several passes per frame: count the whole frame (reset once per frame, right before rendering)
    renderer.info.autoReset = false;
    host.appendChild(renderer.domElement);
    setRenderer(renderer);

    const timer = new THREE.Timer();
    timer.connect(document);

    const stage = {
        renderer,
        view: null,
        quality: settings.get().quality,
        /** The post chain of medium/high (null on low). */
        post: null,
        fps: 60,
        time: 0,

        /** Shows a view (replaces the current one): its scene with its camera, update(dt, time) before every frame. */
        show(view) {
            this.view = view;
            resize();
        },

        /** Shows nothing (the clear colour). */
        clear() {
            this.view = null;
        },

        size() {
            return { width: host.clientWidth || innerWidth, height: host.clientHeight || innerHeight };
        },

        dispose() {
            cancelAnimationFrame(frame);
            removeEventListener('resize', resize);
            unsubscribe();
            stage.post?.dispose();
            stage.post = null;
            disposeEnvironments();
            disposeMaterials();
            setRenderer(null);
            renderer.dispose();
            renderer.domElement.remove();
        },
    };

    function applyQuality() {
        const quality = settings.get().quality;
        stage.quality = quality;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO[quality] ?? 1.25));
        renderer.shadowMap.enabled = quality === 'high';
        renderer.toneMapping = quality === 'low' ? THREE.CustomToneMapping : TONE_MAPPING;
        stage.post?.dispose();
        stage.post = createPost(renderer, quality);
        setGlowGain(GLOW_GAIN[quality] ?? 1);
    }

    function resize() {
        const { width, height } = stage.size();
        renderer.setSize(width, height, false);
        stage.post?.setSize(width, height, renderer.getPixelRatio());
        const camera = stage.view?.camera;
        if (camera?.isPerspectiveCamera) {
            camera.aspect = width / Math.max(1, height);
            camera.updateProjectionMatrix();
        }
    }

    let frame = 0;
    function loop(timestamp) {
        frame = requestAnimationFrame(loop);
        timer.update(timestamp);
        const dt = Math.min(0.1, timer.getDelta());
        stage.time += dt;
        if (dt > 0) stage.fps = stage.fps * 0.95 + (1 / dt) * 0.05;
        const view = stage.view;
        if (!view) {
            renderer.info.reset();
            renderer.clear();
            return;
        }
        view.update?.(dt, stage.time);
        // the update may have replaced or cleared the view
        const shown = stage.view;
        if (!shown?.scene || !shown.camera) return;
        const post = shown.post ?? shown.scene.userData.post;
        // the counters hold one whole frame (all passes) until the next render: readable in update() and between frames
        renderer.info.reset();
        if (stage.post && post !== false) {
            stage.post.render(shown.scene, shown.camera, dt, post);
        } else {
            renderer.toneMappingExposure = post?.exposure ?? POST_DEFAULTS.exposure;
            // three mixes the fog in after tone mapping on a direct render: give it the tone-mapped colour, so the far haze matches the sky
            const fog = shown.scene.fog;
            if (fog) {
                fogColor.copy(fog.color);
                toneMapColor(fogColor, renderer.toneMapping, renderer.toneMappingExposure, fog.color);
            }
            renderer.render(shown.scene, shown.camera);
            if (fog) fog.color.copy(fogColor);
        }
    }
    const fogColor = new THREE.Color();

    const unsubscribe = settings.onChange(() => {
        if (settings.get().quality !== stage.quality) {
            applyQuality();
            resize();
        }
    });
    addEventListener('resize', resize);
    applyQuality();
    resize();
    frame = requestAnimationFrame(loop);
    return stage;
}
