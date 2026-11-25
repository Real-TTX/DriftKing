// DriftKing · maps/city-fx.js – what makes the Neon-Viertel's street look wet and alive: view-dependent reflection streaks of the lamps,
// neon signs and shop windows on the wet asphalt (there is no screen-space reflection – RENDERING.md §12), and steam rising from manholes.
// Both are one draw call each and are computed on the GPU: a streak lies on the road from below its light towards the camera, brightest at the
// mirror point (where the angle down to the road equals the angle up to the light), stretched by the rough water film and broken by ripples.
// Colours are display-referred like the kit's glow points (RENDERING.md §9): written as they are straight to the canvas (low), decoded into
// the linear HDR target (medium/high) – low pays only for the blended pixels.

import * as THREE from 'three';

const STREAK_VERTEX = /* glsl */ `
    attribute vec3 foot;      // x, z below the light, height of the light
    attribute vec3 tint;      // display colour × strength
    attribute float width;
    uniform float roadY;
    varying vec2 vUv;
    varying vec3 vTint;
    varying float vMirror;
    varying float vLength;
    void main() {
        vec2 toCamera = cameraPosition.xz - foot.xy;
        float distance = length(toCamera);
        vec2 dir = toCamera / max(distance, 1e-3);
        vec2 side = vec2(-dir.y, dir.x);
        float cameraHeight = max(cameraPosition.y - roadY, 0.3);
        float mirror = distance * foot.z / (foot.z + cameraHeight);
        float start = mirror * 0.5;
        float end = min(distance - 1.5, mirror + (distance - mirror) * 0.8);
        float t = position.y + 0.5;
        float along = mix(start, end, t);
        vec2 p = foot.xy + dir * along + side * position.x * width * mix(0.9, 1.35, t);
        vUv = vec2(position.x * 2.0, t);
        vMirror = (mirror - start) / max(end - start, 1e-3);
        vLength = end - start;
        float fade = (1.0 - smoothstep(55.0, 100.0, distance)) * smoothstep(4.0, 9.0, distance);
        vTint = tint * fade;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, roadY, p.y, 1.0);
        // nothing to draw: collapse the quad (no fragments)
        if (fade <= 0.0 || end <= start) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    }`;

const STREAK_FRAGMENT = /* glsl */ `
    uniform float time;
    varying vec2 vUv;
    varying vec3 vTint;
    varying float vMirror;
    varying float vLength;
    void main() {
        float metres = vUv.y * vLength;
        // a narrow core in a soft sheen, slightly frayed at the sides
        float x = vUv.x * (1.0 + 0.18 * sin(metres * 1.3 + vUv.x * 2.0));
        float across = exp(-x * x * 7.0) * 0.75 + exp(-x * x * 2.2) * 0.25;
        float d = vUv.y - vMirror;
        float along = d < 0.0 ? exp(-d * d * 45.0) : exp(-d * 1.7) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
        // the water film breaks the reflection into bands across the streak that waver slowly
        float bands = 0.74 + 0.26 * sin(metres * 2.3 + 2.0 * sin(metres * 0.61 + time * 0.7));
        vec3 c = vTint * across * along * bands;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(c, 1.0);
        #else
            gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        #endif
    }`;

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
        this.sources = [];
        this.time = { value: 0 };
        this.streakMaterial = null;
        this.steamMaterial = null;
        /** reflect(x, z, height, sRGB hex, width, strength): a light whose reflection streaks across the wet road. */
        this.reflect = (x, z, height, hex, width, strength = 1) => {
            this.sources.push({ x, z, height, hex, width, strength });
        };
    }

    /** Builds the streak and steam meshes into root. steam: [{ x, z }] manholes that steam. */
    build(root, steam = []) {
        const low = this.ctx.quality === 'low';
        // on low only the stronger sources reflect (fewer blended pixels)
        const sources = this.sources.filter(s => !low || s.strength >= 0.6);
        if (sources.length > 0) {
            const base = new THREE.PlaneGeometry(1, 1);
            const geometry = new THREE.InstancedBufferGeometry();
            geometry.index = base.index;
            geometry.setAttribute('position', base.attributes.position);
            const foot = new Float32Array(sources.length * 3);
            const tint = new Float32Array(sources.length * 3);
            const width = new Float32Array(sources.length);
            const gain = low ? 0.4 : 0.75;
            sources.forEach((s, k) => {
                foot.set([s.x, s.z, Math.max(0.6, s.height)], k * 3);
                // display-referred colour: the sRGB components as they are, scaled by the strength
                const r = ((s.hex >> 16) & 255) / 255;
                const g = ((s.hex >> 8) & 255) / 255;
                const b = (s.hex & 255) / 255;
                tint.set([r * s.strength * gain, g * s.strength * gain, b * s.strength * gain], k * 3);
                width[k] = Math.max(0.5, Math.min(3, s.width));
            });
            geometry.setAttribute('foot', new THREE.InstancedBufferAttribute(foot, 3));
            geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
            geometry.setAttribute('width', new THREE.InstancedBufferAttribute(width, 1));
            geometry.instanceCount = sources.length;
            this.streakMaterial = new THREE.ShaderMaterial({
                uniforms: { time: this.time, roadY: { value: 0.036 } },
                vertexShader: STREAK_VERTEX,
                fragmentShader: STREAK_FRAGMENT,
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -3,
                polygonOffsetUnits: -3,
            });
            const mesh = new THREE.Mesh(geometry, this.streakMaterial);
            mesh.frustumCulled = false;
            mesh.renderOrder = 3;
            mesh.name = 'wet-reflections';
            root.add(mesh);
        }
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
