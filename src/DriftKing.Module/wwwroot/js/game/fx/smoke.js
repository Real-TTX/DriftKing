// DriftKing · fx/smoke.js – tyre smoke: a pool of soft billboard puffs in one instanced draw call. Puffs grow, rise a little, slow down and fade;
// neon and street light tint them through the colour of the map. The pool size follows the picture quality.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
    attribute vec3 offset;
    attribute float size;
    attribute float alpha;
    varying vec2 vUv;
    varying float vAlpha;
    uniform float fogFar;
    void main() {
        vUv = position.xy;
        vec4 mv = modelViewMatrix * vec4(offset, 1.0);
        mv.xy += position.xy * size;
        vAlpha = alpha * clamp(1.0 - (-mv.z) / fogFar, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
    }`;

const FRAGMENT = /* glsl */ `
    uniform vec3 colour;
    varying vec2 vUv;
    varying float vAlpha;
    void main() {
        float d = length(vUv);
        float a = smoothstep(1.0, 0.15, d) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(colour, a);
    }`;

/** The smoke of a run. emit() puffs, update() moves them (once per frame). */
export class Smoke {
    /** @param {number} capacity how many puffs at most (low 120, medium 260, high 420) */
    constructor(capacity, { colour = 0xb9b8cc, fogFar = 400 } = {}) {
        this.capacity = capacity;
        this.next = 0;
        this.particles = Array.from({ length: capacity }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, alpha: 0 }));
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.sizes = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
        this.alphas = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('offset', this.offsets);
        geometry.setAttribute('size', this.sizes);
        geometry.setAttribute('alpha', this.alphas);
        geometry.instanceCount = capacity;
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: { colour: { value: new THREE.Color(colour) }, fogFar: { value: fogFar } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            transparent: true,
            depthWrite: false,
        }));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 8;
    }

    /** A puff at (x, y, z) moving with (vx, vz), starting size and strength 0..1. */
    emit(x, y, z, vx, vz, size, strength) {
        const p = this.particles[this.next];
        this.next = (this.next + 1) % this.capacity;
        p.life = 1.1 + strength * 1.2;
        p.age = 0;
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = vx * 0.35 + (Math.random() - 0.5) * 1.2;
        p.vy = 0.5 + Math.random() * 0.6;
        p.vz = vz * 0.35 + (Math.random() - 0.5) * 1.2;
        p.size = size;
        p.grow = 0.9 + strength * 1.3;
        p.alpha = 0.07 + strength * 0.13;
    }

    update(dt) {
        const offsets = this.offsets.array;
        const sizes = this.sizes.array;
        const alphas = this.alphas.array;
        const drag = Math.exp(-dt * 1.6);
        for (let k = 0; k < this.capacity; k++) {
            const p = this.particles[k];
            if (p.age >= p.life) {
                alphas[k] = 0;
                continue;
            }
            p.age += dt;
            p.vx *= drag;
            p.vz *= drag;
            p.vy *= drag;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            const t = p.age / p.life;
            offsets[k * 3] = p.x;
            offsets[k * 3 + 1] = p.y;
            offsets[k * 3 + 2] = p.z;
            sizes[k] = p.size + p.grow * Math.sqrt(t) * 2;
            alphas[k] = p.alpha * (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88);
        }
        this.offsets.needsUpdate = true;
        this.sizes.needsUpdate = true;
        this.alphas.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
