// DriftKing · world/wet-streaks.js – the lights of a map mirrored in its wet road: a view-dependent reflection streak per lamp, neon sign or
// shop window (there is no screen-space reflection – RENDERING.md §12). Computed on the GPU, one instanced additive draw call for the map:
// a streak lies on the road from below its light towards the camera, brightest at the mirror point (where the angle down to the road equals
// the angle up to the light), stretched by the rough water film and broken by wavering bands. Colours are display-referred like the kit's
// glow points (RENDERING.md §9): written as they are straight to the canvas (low), decoded into the linear HDR target (medium/high) – low
// pays only for the blended pixels (and draws only the stronger sources). The cars' own lamps are fx/streaks.js; the sea is harbor-water.js.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
    attribute vec4 foot;      // x, z below the light, height of the light above the road, road height there
    attribute vec3 tint;      // display colour × strength
    attribute vec2 shape;     // width (m), reach (1: from half way to the mirror point; 2: from the foot of the light)
    uniform vec4 fade;        // near fade in (from, to), far fade out (from, to) – metres from the camera to the foot
    uniform float keep;       // the bright part stays at least this far in front of the camera (tall lights: their mirror point is at your feet)
    varying vec2 vUv;
    varying vec3 vTint;
    varying float vMirror;
    varying float vLength;
    varying float vReach;
    void main() {
        vec2 toCamera = cameraPosition.xz - foot.xy;
        float distance = length(toCamera);
        vec2 dir = toCamera / max(distance, 1e-3);
        vec2 side = vec2(-dir.y, dir.x);
        float cameraHeight = max(cameraPosition.y - foot.w, 0.3);
        float mirror = distance * foot.z / (foot.z + cameraHeight);
        if (keep > 0.0) mirror = min(mirror, max(distance - keep, distance * 0.5));
        float start = mirror * max(0.0, 1.0 - 0.5 * shape.y);
        float end = min(distance - 1.5, mirror + (distance - mirror) * 0.8);
        float t = position.y + 0.5;
        float along = mix(start, end, t);
        vec2 p = foot.xy + dir * along + side * position.x * shape.x * mix(0.9, 1.35, t);
        vUv = vec2(position.x * 2.0, t);
        vMirror = (mirror - start) / max(end - start, 1e-3);
        vLength = end - start;
        vReach = shape.y;
        float f = (1.0 - smoothstep(fade.z, fade.w, distance)) * smoothstep(fade.x, fade.y, distance);
        vTint = tint * f;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, foot.w, p.y, 1.0);
        // nothing to draw: collapse the quad (no fragments)
        if (f <= 0.0 || end <= start) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    }`;

const FRAGMENT = /* glsl */ `
    uniform float time;
    varying vec2 vUv;
    varying vec3 vTint;
    varying float vMirror;
    varying float vLength;
    varying float vReach;
    void main() {
        float metres = vUv.y * vLength;
        // a narrow core in a soft sheen, slightly frayed at the sides
        float x = vUv.x * (1.0 + 0.18 * sin(metres * 1.3 + vUv.x * 2.0));
        float across = exp(-x * x * 7.0) * 0.75 + exp(-x * x * 2.2) * 0.25;
        float d = vUv.y - vMirror;
        float along = (d < 0.0 ? exp(-d * d * 45.0 / (vReach * vReach)) : exp(-d * 1.7)) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
        // the water film breaks the reflection into bands across the streak that waver slowly
        float bands = 0.74 + 0.26 * sin(metres * 2.3 + 2.0 * sin(metres * 0.61 + time * 0.7));
        vec3 c = vTint * across * along * bands;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(c, 1.0);
        #else
            gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        #endif
    }`;

/** Collects the lights that streak across a wet road and builds their mesh. */
export class WetStreaks {
    /**
     * @param {object} ctx the map context (quality)
     * @param {{ roadY?: number, gain?: number, lowGain?: number, lowMin?: number, near?: [number, number], far?: [number, number], keep?: number }} [options]
     *        roadY: the road height of sources added without one; gain/lowGain: overall strength (medium/high, low); lowMin: the weakest
     *        source still drawn on low; near/far: fade in/out by the camera's distance to the foot (m); keep: metres in front of the camera
     *        the bright part stays at least (0: where the mirror point is; for the masts of a yard)
     */
    constructor(ctx, { roadY = 0, gain = 0.75, lowGain = 0.4, lowMin = 0.6, near = [4, 9], far = [55, 100], keep = 0 } = {}) {
        this.low = ctx.quality === 'low';
        this.roadY = roadY;
        this.gain = this.low ? lowGain : gain;
        this.lowMin = lowMin;
        this.fade = new THREE.Vector4(near[0], near[1], far[0], far[1]);
        this.keep = keep;
        this.sources = [];
        this.time = { value: 0 };
        this.material = null;
        /**
         * reflect(x, z, height, sRGB hex, width, strength, { roadY, reach }?): a light (height above the road) whose reflection streaks across it;
         * reach 1–2: how far the streak runs back towards the foot of the light (tall lights: more).
         */
        this.reflect = (x, z, height, hex, width, strength = 1, { roadY = this.roadY, reach = 1 } = {}) => {
            this.sources.push({ x, z, height, hex, width, strength, roadY, reach });
        };
    }

    /** Builds the mesh into root (nothing without sources). Returns the mesh or null. */
    build(root) {
        // on low only the stronger sources reflect (fewer blended pixels)
        const sources = this.sources.filter(s => !this.low || s.strength >= this.lowMin);
        if (sources.length === 0) return null;
        const base = new THREE.PlaneGeometry(1, 1);
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        geometry.setAttribute('position', base.attributes.position);
        const foot = new Float32Array(sources.length * 4);
        const tint = new Float32Array(sources.length * 3);
        const shape = new Float32Array(sources.length * 2);
        const gain = this.gain;
        sources.forEach((s, k) => {
            foot.set([s.x, s.z, Math.max(0.6, s.height), s.roadY], k * 4);
            // display-referred colour: the sRGB components as they are, scaled by the strength
            const r = ((s.hex >> 16) & 255) / 255;
            const g = ((s.hex >> 8) & 255) / 255;
            const b = (s.hex & 255) / 255;
            tint.set([r * s.strength * gain, g * s.strength * gain, b * s.strength * gain], k * 3);
            shape.set([Math.max(0.5, Math.min(3, s.width)), Math.max(1, Math.min(2, s.reach))], k * 2);
        });
        geometry.setAttribute('foot', new THREE.InstancedBufferAttribute(foot, 4));
        geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
        geometry.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 2));
        geometry.instanceCount = sources.length;
        this.material = new THREE.ShaderMaterial({
            uniforms: { time: this.time, fade: { value: this.fade }, keep: { value: this.keep } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
        });
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        mesh.name = 'wet-reflections';
        root.add(mesh);
        return mesh;
    }

    update(dt) {
        this.time.value = (this.time.value + dt) % 10000;
    }
}
