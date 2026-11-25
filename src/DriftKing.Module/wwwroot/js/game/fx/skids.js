// DriftKing · fx/skids.js – skid marks: rubber laid down by sliding tyres, a ring buffer of quads in one mesh (the oldest marks make room and fade
// out before they go). Each tyre has its own track (an id); a track breaks when the tyre grips again. A mark is as wide as the slide is hard,
// darker where the tyre slid harder, printed with the tread (fx/textures.js: soft edges, grooves, smeared streaks) and pales slowly as it ages.
// Medium/high: rubber is a lit, slightly glossy material (on a wet road the marks read as dark, faintly shiny bands); low: flat dark marks.
// The marks lie a few centimetres over the road and its painted lines and are pulled forward in depth (no z-fighting with road decals).

import * as THREE from 'three';
import { settings } from '../settings.js';
import { skidPrint } from './textures.js';

const MIN_STEP = 0.35;
/** Height above the car's ground (the road surface): over the road strip (+0.02) and painted lines (+0.03). */
const LIFT = 0.034;
/** One texture tile along the track (metres). */
const TILE = 2;
/** Seconds until a mark has paled to its old shade. */
const AGEING = 60;

/** The skid marks of a run. */
export class Skids {
    /**
     * @param {number} capacity quads in the ring (low 600, medium 1500, high 2600)
     * @param {{ quality?: string }} [options]
     */
    constructor(capacity, { quality = settings.get().quality } = {}) {
        this.capacity = capacity;
        this.next = 0;
        this.serial = 0;
        this.written = 0;
        this.tracks = new Map();
        this.dirtyFrom = Infinity;
        this.dirtyTo = -1;
        const geometry = new THREE.BufferGeometry();
        this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.uvs = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 2), 2).setUsage(THREE.DynamicDrawUsage);
        this.marks = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
        const normals = new Float32Array(capacity * 4 * 3);
        for (let v = 0; v < capacity * 4; v++) normals[v * 3 + 1] = 1;
        geometry.setAttribute('position', this.positions);
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', this.uvs);
        geometry.setAttribute('mark', this.marks);
        const index = new Uint32Array(capacity * 6);
        // counter-clockwise from above: the front faces look up
        for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.setDrawRange(0, 0);
        this.attributes = [this.positions, this.uvs, this.marks];

        this.uniforms = { head: { value: 0 }, capacity: { value: capacity }, now: { value: 0 } };
        const common = {
            alphaMap: skidPrint(),
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        };
        // rubber: very dark, a little glossy (dry asphalt polished by the slide; on a wet road a faint sheen)
        const material = quality === 'low'
            ? new THREE.MeshBasicMaterial({ color: 0x08080a, ...common })
            : new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.42, metalness: 0, envMapIntensity: 0.7, ...common });
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, this.uniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                    attribute vec3 mark;          // x serial number of the quad, y slip strength 0..1, z time laid (s)
                    uniform float head;
                    uniform float capacity;
                    uniform float now;
                    varying float vMark;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    // the oldest fifth of the ring fades out before it is overwritten; marks pale as they age
                    float ring = clamp((capacity - (head - mark.x)) / (capacity * 0.2), 0.0, 1.0);
                    float aged = mix(1.0, 0.62, smoothstep(0.0, ${AGEING.toFixed(1)}, now - mark.z));
                    vMark = (0.34 + 0.6 * mark.y) * ring * aged;`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vMark;')
                .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vMark;');
        };
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.dirty = false;
    }

    /** The tyre `id` is at (x, y, z) – y = the road under it – and slides with strength 0..1 (0 = grips: the track breaks). */
    mark(id, x, y, z, strength) {
        let track = this.tracks.get(id);
        if (strength <= 0.05) {
            if (track) track.active = false;
            return;
        }
        if (!track) {
            track = { x, y, z, lx: 0, lz: 0, v: 0, s: 0, active: false };
            this.tracks.set(id, track);
        }
        if (!track.active) {
            Object.assign(track, { x, y, z, active: true, lx: 0, lz: 0, s: strength });
            return;
        }
        const dx = x - track.x;
        const dz = z - track.z;
        const d = Math.hypot(dx, dz);
        if (d < MIN_STEP) return;
        if (d > 3) {
            Object.assign(track, { x, y, z, lx: 0, lz: 0, s: strength });
            return;
        }
        // the harder the slide, the wider the band of rubber (a tyre is ~0.23 m wide; at a slight slip only its edge marks)
        const s = Math.min(1, strength);
        const half = (0.13 + 0.12 * s) * 0.5;
        const nx = (-dz / d) * half;
        const nz = (dx / d) * half;
        const q = this.next;
        this.next = (this.next + 1) % this.capacity;
        const lx = track.lx || nx;
        const lz = track.lz || nz;
        const v0 = track.v;
        const v1 = v0 + d / TILE;
        const p = this.positions.array;
        const y0 = track.y + LIFT;
        const y1 = y + LIFT;
        let o = q * 12;
        p[o] = track.x + lx; p[o + 1] = y0; p[o + 2] = track.z + lz;
        p[o + 3] = track.x - lx; p[o + 4] = y0; p[o + 5] = track.z - lz;
        p[o + 6] = x + nx; p[o + 7] = y1; p[o + 8] = z + nz;
        p[o + 9] = x - nx; p[o + 10] = y1; p[o + 11] = z - nz;
        const uv = this.uvs.array;
        o = q * 8;
        uv[o] = 0; uv[o + 1] = v0;
        uv[o + 2] = 1; uv[o + 3] = v0;
        uv[o + 4] = 0; uv[o + 5] = v1;
        uv[o + 6] = 1; uv[o + 7] = v1;
        const m = this.marks.array;
        const serial = this.serial++;
        const now = performance.now() / 1000;
        o = q * 12;
        for (let k = 0; k < 4; k++) {
            m[o + k * 3] = serial;
            m[o + k * 3 + 1] = k < 2 ? track.s : s;
            m[o + k * 3 + 2] = now;
        }
        Object.assign(track, { x, y, z, lx: nx, lz: nz, v: v1 % 64, s });
        this.written = Math.min(this.capacity, this.written + 1);
        this.dirtyFrom = Math.min(this.dirtyFrom, q);
        this.dirtyTo = Math.max(this.dirtyTo, q);
        this.dirty = true;
    }

    /** Uploads what changed (once per frame). */
    update() {
        this.uniforms.now.value = performance.now() / 1000;
        this.uniforms.head.value = this.serial;
        if (!this.dirty) return;
        this.mesh.geometry.setDrawRange(0, this.written * 6);
        // only the quads written since the last upload (when the ring wrapped within the frame that span is the whole ring)
        const from = this.dirtyFrom;
        const count = this.dirtyTo - this.dirtyFrom + 1;
        for (const attribute of this.attributes) {
            const size = attribute.itemSize * 4;
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(from * size, count * size);
            attribute.needsUpdate = true;
        }
        this.dirtyFrom = Infinity;
        this.dirtyTo = -1;
        this.dirty = false;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
