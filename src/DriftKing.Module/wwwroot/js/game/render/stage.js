// DriftKing · render/stage.js – the one WebGL canvas of the app: renderer, the frame loop, the picture quality.
// Whoever owns the screen (menu backdrop, garage, a run) calls stage.show({ scene, camera, update(dt, time) }).

import * as THREE from 'three';
import { settings } from '../settings.js';

/** Pixel ratio per quality: low renders below the screen's resolution, high up to 2×. */
const PIXEL_RATIO = { low: 0.75, medium: 1.25, high: 2 };

/**
 * Creates the renderer inside the host element and starts the frame loop.
 * @param {HTMLElement} host the element the canvas fills (#dk-stage)
 * @returns {{ renderer: THREE.WebGLRenderer, show(view: { scene: THREE.Scene, camera: THREE.Camera, update?: (dt: number, time: number) => void }): void,
 *            clear(): void, quality: string, fps: number, time: number, size(): { width: number, height: number }, dispose(): void }}
 */
export function createStage(host) {
    const renderer = new THREE.WebGLRenderer({ antialias: settings.get().quality !== 'low', powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x0b0a18, 1);
    host.appendChild(renderer.domElement);

    const timer = new THREE.Timer();
    timer.connect(document);

    const stage = {
        renderer,
        view: null,
        quality: settings.get().quality,
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
            renderer.dispose();
            renderer.domElement.remove();
        },
    };

    function applyQuality() {
        const quality = settings.get().quality;
        stage.quality = quality;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO[quality] ?? 1.25));
        renderer.shadowMap.enabled = quality === 'high';
    }

    function resize() {
        const { width, height } = stage.size();
        renderer.setSize(width, height, false);
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
            renderer.clear();
            return;
        }
        view.update?.(dt, stage.time);
        // the update may have replaced or cleared the view
        if (stage.view?.scene && stage.view.camera) renderer.render(stage.view.scene, stage.view.camera);
    }

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
