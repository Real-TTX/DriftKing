// DriftKing · maps/harbor-quay.js – the quay of Kaikō-Docks: the edge the cars bounce off (its collider and the bollards' are the old ones),
// a concrete quay wall down into the water with a dark wet band at the waterline, a yellow-painted coping, cast mooring bollards, rubber
// fenders hanging on the wall, ladders, and the low lamps on the quay that throw their reflections on the water.

import * as THREE from 'three';
import { HARBOR, block, harborPalette, slab } from './harbor-parts.js';

const { minX: MIN_X, maxX: MAX_X, quayZ: QUAY_Z, waterY: WATER_Y } = HARBOR;

/**
 * Builds the quay; returns { bollards: [{ x, z }] } (the ship moors to them).
 * @param {object} ctx the map context
 * @param {{ decals: import('./harbor-decals.js').Decals, streaks: import('./harbor-water.js').WaterStreaks }} parts
 */
export function buildQuay(ctx, { batch }) {
    const { colliders, materials, quality } = ctx;
    colliders.addSegment(MAX_X, QUAY_Z, MIN_X, QUAY_Z);
    const p = harborPalette(materials);
    const { concrete, algae, yellow, rubber, steel } = p;
    const iron = p.dark;
    const x0 = -262;
    const x1 = 262;
    // the quay wall: face towards the water from below the waterline up to the coping; the dark wet band where the tide works
    batch.add(concrete, slab(x0, x1, WATER_Y - 3, 0, QUAY_Z, QUAY_Z + 0.6, { faces: '+z' }));
    batch.add(algae, slab(x0, x1, WATER_Y - 0.6, WATER_Y + 0.9, QUAY_Z + 0.6, QUAY_Z + 0.62, { faces: '+z' }));
    // the coping: a low kerb along the edge, its top and face painted in safety yellow
    batch.add(concrete, slab(x0, x1, 0, 0.22, QUAY_Z - 0.55, QUAY_Z + 0.6, { faces: '-z' }));
    batch.add(yellow, slab(x0, x1, 0.22, 0.225, QUAY_Z - 0.55, QUAY_Z + 0.6, { faces: '+y' }));
    batch.add(yellow, slab(x0, x1, 0.02, 0.225, QUAY_Z + 0.6, QUAY_Z + 0.605, { faces: '+z' }));
    // bollards every 16 m (the old colliders), fenders between them, a ladder now and then
    const bollards = [];
    const sides = quality === 'low' ? 8 : 14;
    let n = 0;
    for (let x = MIN_X + 10; x < MAX_X; x += 16, n++) {
        colliders.addCircle(x, QUAY_Z - 1.2, 0.35);
        bollards.push({ x, z: QUAY_Z - 1.2 });
        const z = QUAY_Z - 1.2;
        batch.add(iron, new THREE.CylinderGeometry(0.34, 0.34, 0.06, sides).translate(x, 0.03, z));
        batch.add(iron, new THREE.CylinderGeometry(0.2, 0.24, 0.5, sides, 1, true).translate(x, 0.3, z));
        batch.add(yellow, new THREE.CylinderGeometry(0.33, 0.27, 0.14, sides).translate(x, 0.6, z));
        // a cylindrical fender on chains, half-way to the next bollard
        const fx = x + 8;
        if (fx < x1) {
            batch.add(rubber, new THREE.CylinderGeometry(0.55, 0.55, 2.4, sides, 1, false).rotateZ(Math.PI / 2).translate(fx, -1.25, QUAY_Z + 1.15));
            batch.add(steel, block(0.05, 1.1, 0.05, fx - 0.9, -0.3, QUAY_Z + 0.75));
            batch.add(steel, block(0.05, 1.1, 0.05, fx + 0.9, -0.3, QUAY_Z + 0.75));
        }
        // a ladder recessed in the wall every fifth bay
        if (n % 5 === 2) {
            for (const dx of [-0.25, 0.25]) batch.add(steel, block(0.05, WATER_Y * -1 + 0.6, 0.05, x + 4 + dx, (WATER_Y - 0.6) / 2, QUAY_Z + 0.66));
            for (let y = WATER_Y - 0.4; y < 0; y += 0.3) batch.add(steel, block(0.5, 0.03, 0.03, x + 4, y, QUAY_Z + 0.66));
        }
    }
    return { bollards };
}
