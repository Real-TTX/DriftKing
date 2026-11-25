// DriftKing · fx/sparks.js – sparks where metal meets a wall or another car: hot streaks in one instanced draw call (none while there are none).
// A spark flies off with the scrape, falls, bounces off the road and cools from white-yellow to orange-red within half a second; each is drawn as a
// streak along its motion (at least ~1.5 px wide, so it never flickers away) in HDR – the bloom of medium/high makes them glow.

import * as THREE from 'three';
import { CULL_GLSL, DISPLAY_GLSL } from './common.js';

const VERTEX = /* glsl */ `
    attribute vec4 head;     // xyz position, w heat 1..0
    attribute vec4 motion;   // xyz velocity, w width (m)
    uniform vec2 resolution;
    uniform float streak;
    uniform float exposure;
    varying vec2 vUv;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    ${DISPLAY_GLSL}
    ${CULL_GLSL}
    void main() {
        mat4 viewProjection = projectionMatrix * viewMatrix;
        vec4 c0 = viewProjection * vec4(head.xyz, 1.0);
        vec4 c1 = viewProjection * vec4(head.xyz - motion.xyz * streak, 1.0);
        if (c0.w < 0.35 || c1.w < 0.35) {
            gl_Position = FX_HIDDEN;
            return;
        }
        // position.x: 0 at the head, 1 at the tail; position.y: −1..1 across
        vec2 s0 = c0.xy / c0.w * resolution;
        vec2 s1 = c1.xy / c1.w * resolution;
        vec2 along = s1 - s0;
        float span = max(1e-3, length(along));
        along /= span;
        vec2 side = vec2(-along.y, along.x);
        vec4 clip = mix(c0, c1, position.x);
        float pixels = max(1.6, motion.w * projectionMatrix[1][1] * resolution.y / clip.w);
        // a round head: the quad reaches half a width past the head
        vec2 offset = side * position.y * pixels - along * (1.0 - position.x) * pixels * 0.5;
        clip.xy += offset / resolution * clip.w;
        vUv = vec2(position.x, position.y);
        float heat = head.w;
        vec3 colour = mix(vec3(1.0, 0.14, 0.02) * 2.5, vec3(1.0, 0.6, 0.22) * 14.0, heat * heat);
        vLinear = colour;
        vDisplay = fxDisplay(colour, exposure);
        gl_Position = clip;
    }`;

const FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    void main() {
        float across = 1.0 - vUv.y * vUv.y;
        float a = across * across * mix(1.0, 0.15, vUv.x);
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(vDisplay, a);
        #else
            gl_FragColor = vec4(vLinear, a);
        #endif
    }`;

const GRAVITY = 9.81;

/** The sparks of a run. emit() a burst, update() once per frame. */
export class Sparks {
    /** @param {number} capacity sparks at most (low 48, medium 120, high 200) */
    constructor(capacity, { exposure = 1.3 } = {}) {
        this.capacity = capacity;
        this.next = 0;
        this.particles = Array.from({ length: capacity }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: 0, width: 0.02 }));
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.heads = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.motions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('head', this.heads);
        geometry.setAttribute('motion', this.motions);
        geometry.instanceCount = 0;
        this.attributes = [this.heads, this.motions];
        const material = new THREE.ShaderMaterial({
            uniforms: { resolution: { value: new THREE.Vector2(1366, 768) }, streak: { value: 0.035 }, exposure: { value: exposure } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9;
        this.mesh.visible = false;
        const size = new THREE.Vector2();
        // half the drawing buffer in pixels (clip space spans 2)
        this.mesh.onBeforeRender = renderer => {
            renderer.getDrawingBufferSize(size);
            material.uniforms.resolution.value.set(size.x * 0.5, size.y * 0.5);
        };
    }

    /**
     * A burst of n sparks at (x, y, z) above a road at height ground: thrown along (sx, sz) (the scrape: the car's motion along the wall) and
     * out along (nx, nz) (the wall's normal), strength 0..1.
     */
    emit(n, x, y, z, ground, sx, sz, nx, nz, strength = 1) {
        for (let k = 0; k < n; k++) {
            const p = this.particles[this.next];
            this.next = (this.next + 1) % this.capacity;
            const along = 0.35 + Math.random() * 0.75;
            const out = 0.5 + Math.random() * 2.5 * strength;
            p.life = 0.22 + Math.random() * 0.5 * (0.5 + strength * 0.5);
            p.age = 0;
            p.x = x + (Math.random() - 0.5) * 0.25;
            p.y = y + (Math.random() - 0.5) * 0.2;
            p.z = z + (Math.random() - 0.5) * 0.25;
            p.vx = sx * along + nx * out + (Math.random() - 0.5) * 3;
            p.vy = 0.6 + Math.random() * 3.2 * (0.4 + strength * 0.6);
            p.vz = sz * along + nz * out + (Math.random() - 0.5) * 3;
            p.ground = ground;
            p.width = 0.012 + Math.random() * 0.014;
        }
    }

    update(dt) {
        const heads = this.heads.array;
        const motions = this.motions.array;
        const drag = Math.exp(-dt * 1.2);
        let n = 0;
        for (const p of this.particles) {
            if (p.age >= p.life) continue;
            p.age += dt;
            if (p.age >= p.life) continue;
            p.vx *= drag;
            p.vz *= drag;
            p.vy -= GRAVITY * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            // a bounce off the road (it loses most of its height, skids on)
            if (p.y < p.ground + 0.02 && p.vy < 0) {
                p.y = p.ground + 0.02;
                p.vy = -p.vy * 0.32;
                p.vx *= 0.7;
                p.vz *= 0.7;
            }
            const heat = 1 - p.age / p.life;
            heads[n * 4] = p.x;
            heads[n * 4 + 1] = p.y;
            heads[n * 4 + 2] = p.z;
            heads[n * 4 + 3] = heat;
            motions[n * 4] = p.vx;
            motions[n * 4 + 1] = p.vy;
            motions[n * 4 + 2] = p.vz;
            motions[n * 4 + 3] = p.width;
            n++;
        }
        this.mesh.visible = n > 0;
        this.mesh.geometry.instanceCount = n;
        if (n === 0) return;
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, n * 4);
            attribute.needsUpdate = true;
        }
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
