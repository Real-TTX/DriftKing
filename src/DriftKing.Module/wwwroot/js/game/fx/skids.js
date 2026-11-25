// DriftKing · fx/skids.js – skid marks: dark ribbons behind sliding tyres, a ring buffer of quads in one mesh (the oldest marks make room).
// Each tyre has its own track (an id); a track breaks when the tyre grips again.

import * as THREE from 'three';

const WIDTH = 0.24;
const MIN_STEP = 0.35;

/** The skid marks of a run. */
export class Skids {
    /** @param {number} capacity quads in the ring (low 600, medium 1500, high 2600) */
    constructor(capacity) {
        this.capacity = capacity;
        this.next = 0;
        this.tracks = new Map();
        const geometry = new THREE.BufferGeometry();
        this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.colors = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', this.positions);
        geometry.setAttribute('color', this.colors);
        const index = new Uint32Array(capacity * 6);
        for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        }));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.dirty = false;
    }

    /** The tyre `id` is at (x, y, z) and slides with strength 0..1 (0 = grips: the track breaks). */
    mark(id, x, y, z, strength) {
        let track = this.tracks.get(id);
        if (strength <= 0.05) {
            if (track) track.active = false;
            return;
        }
        if (!track) {
            track = { x, y, z, lx: 0, lz: 0, active: false };
            this.tracks.set(id, track);
        }
        if (!track.active) {
            Object.assign(track, { x, y, z, active: true, lx: 0, lz: 0 });
            return;
        }
        const dx = x - track.x;
        const dz = z - track.z;
        const d = Math.hypot(dx, dz);
        if (d < MIN_STEP) return;
        if (d > 3) {
            Object.assign(track, { x, y, z, lx: 0, lz: 0 });
            return;
        }
        const nx = (-dz / d) * WIDTH * 0.5;
        const nz = (dx / d) * WIDTH * 0.5;
        const q = this.next;
        this.next = (this.next + 1) % this.capacity;
        const p = this.positions.array;
        const lx = track.lx || nx;
        const lz = track.lz || nz;
        p.set([track.x + lx, track.y + 0.025, track.z + lz, track.x - lx, track.y + 0.025, track.z - lz, x + nx, y + 0.025, z + nz, x - nx, y + 0.025, z - nz], q * 12);
        const a = Math.min(0.7, 0.25 + strength * 0.5);
        const c = this.colors.array;
        for (let v = 0; v < 4; v++) c.set([0.03, 0.03, 0.04, a], q * 16 + v * 4);
        Object.assign(track, { x, y, z, lx: nx, lz: nz });
        this.dirty = true;
    }

    update() {
        if (!this.dirty) return;
        this.positions.needsUpdate = true;
        this.colors.needsUpdate = true;
        this.dirty = false;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
