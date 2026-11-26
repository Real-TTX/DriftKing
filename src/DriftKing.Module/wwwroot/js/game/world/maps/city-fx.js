// DriftKing · maps/city-fx.js – what makes the Neon-Viertel's street look wet and alive: view-dependent reflection streaks of the lamps,
// neon signs and shop windows on the wet asphalt (world/wet-streaks.js – there is no screen-space reflection, RENDERING.md §12), and steam
// rising from manholes. Both are one draw call each and computed on the GPU. Colours are display-referred like the kit's glow points
// (RENDERING.md §9): written as they are straight to the canvas (low), decoded into the linear HDR target (medium/high) – low pays only for
// the blended pixels.

import * as THREE from 'three';
import { WetStreaks } from '../wet-streaks.js';

const STEAM_VERTEX = /* glsl */ `
    attribute float seed;
    uniform float time;
    uniform float scale;
    varying float vAlpha;
    void main() {
        float t = fract(time * (0.16 + seed * 0.05) + seed * 7.13);
        vec3 p = position;
        p.y += t * 3.2;
        p.x += sin(seed * 31.0 + t * 2.5) * 0.35 * t + t * 0.6;
        p.z += cos(seed * 17.0 + t * 2.1) * 0.35 * t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = mix(0.7, 3.2, t);
        gl_PointSize = size * scale / max(-mv.z, 0.5);
        vAlpha = smoothstep(0.0, 0.1, t) * pow(1.0 - t, 1.2) * 0.42 * (1.0 - smoothstep(80.0, 140.0, -mv.z));
        gl_Position = projectionMatrix * mv;
    }`;

const STEAM_FRAGMENT = /* glsl */ `
    uniform vec3 colour;        // display colour (low)
    uniform vec3 colourLinear;  // the same decoded (medium/high)
    varying float vAlpha;
    void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = smoothstep(1.0, 0.0, dot(q, q)) * vAlpha;
        if (a < 0.004) discard;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(colour, a);
        #else
            gl_FragColor = vec4(colourLinear, a);
        #endif
    }`;

const tmpSize = new THREE.Vector2();

/** Collects the reflection sources and steam vents of the district and builds their two meshes. */
export class CityFx {
    constructor(ctx) {
        this.ctx = ctx;
        this.streaks = new WetStreaks(ctx, { roadY: 0.036 });
        this.time = this.streaks.time;
        this.steamMaterial = null;
        /** reflect(x, z, height, sRGB hex, width, strength): a light whose reflection streaks across the wet road. */
        this.reflect = this.streaks.reflect;
    }

    /** Builds the streak and steam meshes into root. steam: [{ x, z }] manholes that steam. */
    build(root, steam = []) {
        this.streaks.build(root);
        if (steam.length > 0) {
            const perVent = 12;
            const positions = new Float32Array(steam.length * perVent * 3);
            const seeds = new Float32Array(steam.length * perVent);
            steam.forEach((v, k) => {
                for (let i = 0; i < perVent; i++) {
                    positions.set([v.x, 0.1, v.z], (k * perVent + i) * 3);
                    seeds[k * perVent + i] = i / perVent + k * 0.37;
                }
            });
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
            const display = new THREE.Color(0.62, 0.62, 0.68);
            const linear = new THREE.Color(Math.pow(0.62, 2.2), Math.pow(0.62, 2.2), Math.pow(0.68, 2.2));
            this.steamMaterial = new THREE.ShaderMaterial({
                uniforms: { time: this.time, scale: { value: 600 }, colour: { value: display }, colourLinear: { value: linear } },
                vertexShader: STEAM_VERTEX,
                fragmentShader: STEAM_FRAGMENT,
                transparent: true,
                depthWrite: false,
            });
            const material = this.steamMaterial;
            const points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            points.renderOrder = 6;
            points.name = 'steam';
            points.onBeforeRender = (renderer, scene, camera) => {
                const height = renderer.getDrawingBufferSize(tmpSize).y;
                const fov = camera.isPerspectiveCamera ? camera.fov : 60;
                material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
            };
            root.add(points);
        }
    }

    update(dt) {
        this.time.value += dt;
    }
}
