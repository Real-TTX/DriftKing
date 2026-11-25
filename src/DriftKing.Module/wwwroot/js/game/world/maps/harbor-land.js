// DriftKing · maps/harbor-land.js – everything around the fenced yard of Kaikō-Docks, out of the cars' reach (no colliders): the warehouse
// halls north of the fence (corrugated cladding, roller doors – some open onto lit halls –, wall packs, painted hall numbers, trucks at the
// docks), the empty-container depots east and west with a rubber-tyred gantry, straddle carriers and reach stackers, silos and tanks,
// the town behind (lit facades, aviation lights), the far shore across the basin with its lights, and a cable-stayed bridge in the west.

import * as THREE from 'three';
import { HARBOR, block, harborPalette, slab, tube } from './harbor-parts.js';
import { fitText, wear } from './harbor-decals.js';
import { BOX, LINES, TIER } from './harbor-containers.js';
import { addReachStacker, addRtg, addStraddle, addTruck } from './harbor-cranes.js';
import { rng } from '../../render/kit.js';

const { minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, quayZ: QUAY_Z, waterY: WATER_Y } = HARBOR;

/**
 * Builds the surroundings.
 * @param {object} ctx the map context
 * @param {{ batch: import('./harbor-parts.js').Batch, yard: import('./harbor-containers.js').ContainerYard,
 *           decals: import('./harbor-decals.js').Decals, streaks: import('./harbor-water.js').WaterStreaks }} parts
 */
export function buildLand(ctx, parts) {
    buildWarehouses(ctx, parts);
    buildDepots(ctx, parts);
    buildTown(ctx, parts);
    buildFarShore(ctx, parts);
    buildBridge(ctx, parts);
}

/** Warehouse halls north of the fence, facing the yard. */
function buildWarehouses(ctx, { batch, yard, decals }) {
    const { materials, glows, pools, quality } = ctx;
    const random = rng(19);
    const front = MIN_Z - 16;
    const depth = 34;
    const height = 11;
    const ridge = 2.6;
    const p = harborPalette(materials);
    const { roof, strip, yellow, rubber } = p;
    const plinth = p.concrete;
    const housing = p.dark;
    const lens = p.sodium;
    const interior = p.warm;
    const dark = p.black;
    const pipe = p.grey;
    const names = ['HALLE 1', 'HALLE 2', 'HALLE 3', 'HALLE 4', 'HALLE 5'];
    decals.define('logistik', 448, 64, (c, w, h) => fitText(c, 'KAIKŌ LOGISTIK', 0, 0, w, h, { colour: '#f0f0ec', size: h * 0.82 }));
    names.forEach((name, k) => decals.define(`hall-${k}`, 256, 64, (c, w, h) => {
        fitText(c, name, 0, 0, w, h, { colour: '#1c2430', size: h * 0.82 });
        wear(c, w, h, 300 + k, 0.4);
    }, { ink: '#1c2430' }));
    let hall = 0;
    for (let x0 = MIN_X + 20; x0 + 60 <= MAX_X - 15; x0 += 68, hall++) {
        const x1 = x0 + 62;
        const back = front - depth;
        const cladding = p.cladding[hall % p.cladding.length];
        // the cladding: one texture tile over the wall height (ribs vertical, grime at the foot, rust under the eaves)
        const wallUV = (x, y, z, face) => [face === '+z' || face === '-z' ? x : z, (y * 2.6) / (height + ridge)];
        batch.add(cladding, slab(x0, x1, 1.2, height, back, front, { faces: '+z-z', uv: wallUV }));
        // gable ends: the wall up to the ridge
        for (const [x, nx] of [[x0, -1], [x1, 1]]) {
            const g = new THREE.BufferGeometry();
            const ys = [1.2, height, height + ridge, height, 1.2];
            const zs = [back, back, (back + front) / 2, front, front];
            const positions = [];
            const uvs = [];
            for (let k = 0; k < 5; k++) {
                positions.push(x, ys[k], zs[k]);
                uvs.push(zs[k] * -nx, (ys[k] * 2.6) / (height + ridge));
            }
            g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            g.setIndex(nx > 0 ? [0, 4, 3, 0, 3, 1, 1, 3, 2] : [0, 1, 3, 0, 3, 4, 1, 2, 3]);
            g.computeVertexNormals();
            batch.add(cladding, g);
        }
        batch.add(plinth, slab(x0 - 0.05, x1 + 0.05, 0, 1.2, back - 0.05, front + 0.05, { faces: '-x+x+y-z+z' }));
        // the roof: two slopes over the ridge along x, ribs running down the slopes
        for (const side of [-1, 1]) {
            const ze = side > 0 ? front + 0.4 : back - 0.4;
            const zr = (back + front) / 2;
            const g = new THREE.BufferGeometry();
            const slope = Math.hypot(ze - zr, ridge);
            g.setAttribute('position', new THREE.Float32BufferAttribute([x0 - 0.4, height - 0.1, ze, x1 + 0.4, height - 0.1, ze, x1 + 0.4, height + ridge, zr, x0 - 0.4, height + ridge, zr], 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute([x0, 0, x1, 0, x1, slope, x0, slope], 2));
            g.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
            g.computeVertexNormals();
            batch.add(roof, g);
        }
        // roller doors on the yard side, two open onto the lit hall; dock bumpers, guard posts, a wall pack over each door
        const doorColour = p.doors[hall % p.doors.length];
        const doors = 6;
        for (let d = 0; d < doors; d++) {
            const cx = x0 + (62 / doors) * (d + 0.5);
            const open = random() < 0.28;
            if (open) {
                batch.add(interior, slab(cx - 2.5, cx + 2.5, 0.05, 5.4, front - 0.6, front - 0.5, { faces: '+z' }));
                batch.add(dark, slab(cx - 2.6, cx + 2.6, 5.4, 5.9, front - 0.6, front + 0.12, { faces: '+z-y' }));
                pools.add(cx, 0, front + 3, 6, 0xffd8a0, 0.35);
            } else {
                batch.add(doorColour, slab(cx - 2.5, cx + 2.5, 0.05, 5.6, front - 0.15, front + 0.02, { faces: '+z', uv: (x, y) => [y * 1.4, x] }));
            }
            batch.add(dark, slab(cx - 2.7, cx - 2.5, 0, 5.8, front, front + 0.12, { faces: '-x+x+z' }), slab(cx + 2.5, cx + 2.7, 0, 5.8, front, front + 0.12, { faces: '-x+x+z' }));
            for (const s of [-1, 1]) {
                batch.add(yellow, new THREE.CylinderGeometry(0.14, 0.14, 1.2, 8).translate(cx + s * 3.1, 0.6, front + 0.6));
                batch.add(rubber, block(0.3, 0.5, 0.25, cx + s * 1.6, 1.1, front + 0.15));
            }
            batch.add(housing, block(0.5, 0.3, 0.35, cx, 6.6, front + 0.2));
            batch.add(lens, block(0.4, 0.02, 0.26, cx, 6.44, front + 0.24));
            glows.add(cx, 6.4, front + 0.3, 1.6, 0xffb860);
            pools.add(cx, 0, front + 3.5, 7, 0xffb060, 0.38);
        }
        // a translucent light band under the eaves, downpipes, the painted hall number and (once) the company's name
        for (let x = x0 + 2; x < x1 - 3; x += 3.2) batch.add(hall % 2 && random() < 0.7 ? strip : dark, slab(x, x + 2.4, height - 1.5, height - 0.9, front, front + 0.04, { faces: '+z' }));
        for (const x of [x0 + 0.3, x1 - 0.3]) batch.add(pipe, tube({ x, y: 0.2, z: front + 0.25 }, { x, y: height, z: front + 0.25 }, 0.07, { sides: 6 }));
        decals.wall(`hall-${hall % names.length}`, { x: x0 + 7, y: height - 3, z: front + 0.06 }, { x: 1, z: 0 }, 8, 2);
        if (hall === 2) decals.wall('logistik', { x: (x0 + x1) / 2, y: height - 3, z: front + 0.06 }, { x: 1, z: 0 }, 22, 3.15);
        // trucks backed onto the docks
        if (random() < 0.8) {
            const d = Math.floor(random() * doors);
            const cx = x0 + (62 / doors) * (d + 0.5);
            const line = LINES[Math.floor(random() * LINES.length)];
            addTruck(batch, materials, yard, { x: cx, z: front + 8.6, yaw: Math.PI / 2, paint: ['blue', 'red', 'white', 'grey'][hall % 4], line: random() < 0.7 ? line : null });
        }
    }
    // the warehouses' forecourt light
    void quality;
}

/**
 * The empty-container depots east and west of the yard (beyond the fence): high stacks, a rubber-tyred gantry over one block, straddle
 * carriers and a reach stacker at work, a few silos and tanks behind.
 */
function buildDepots(ctx, { batch, yard, streaks }) {
    const { materials, glows, quality, detail } = ctx;
    const random = rng(271);
    // the column facing the yard in some detail on high, the rest plain boxes
    for (const side of [-1, 1]) {
        const chunk = side < 0 ? 'west' : 'east';
        const xs = [];
        for (let x = 199; x < 262; x += BOX.l40 + 0.6) xs.push(side * x);
        let blockIndex = 0;
        for (let z0 = MIN_Z + 4; z0 < QUAY_Z - 20; z0 += 26, blockIndex++) {
            if (random() > 0.55 + detail * 0.3) continue;
            const main = LINES[Math.floor(random() * LINES.length)];
            for (let row = 0; row < 6; row++) {
                const z = z0 + row * 2.74;
                for (const x of xs) {
                    if (random() < 0.1) continue;
                    const height = 2 + Math.floor(random() * 4);
                    for (let level = 0; level < height; level++) {
                        const line = random() < 0.5 ? main : LINES[Math.floor(random() * LINES.length)];
                        yard.add({ x: x + (random() - 0.5) * 0.08, y: level * TIER, z, yaw: side > 0 ? 0 : Math.PI, size: 40, line, colour: yard.shade(line, random), lod: quality === 'high' && x * side < 205 ? 'mid' : 'box', chunk, marks: x * side < 215 });
                    }
                }
            }
            if (blockIndex === 3) {
                const lights = addRtg(batch, materials, { x: side * 212, z0: z0 - 2.4, z1: z0 + 5 * 2.74 + 2.4, height: 19.5 });
                for (const l of lights) glows.add(l.x, l.y, l.z, 2.4, 0xdfe8ff);
            }
        }
        // machines in the depot's lanes
        addStraddle(batch, materials, yard, { x: side * 196, z: 16, yaw: Math.PI / 2, line: LINES[3 + side] });
        addStraddle(batch, materials, yard, { x: side * 230, z: -40, yaw: 0, line: null });
        addReachStacker(batch, materials, yard, { x: side * 222, z: 74, yaw: side > 0 ? Math.PI : 0, line: LINES[5], lift: 6 });
        // floodlight masts in the depots (glows only: far from the course)
        for (const z of [-80, -10, 60]) {
            batch.add(harborPalette(materials).zinc, new THREE.CylinderGeometry(0.16, 0.32, 24, 8, 1, true).translate(side * 262, 12, z));
            for (const o of [-0.8, 0, 0.8]) glows.add(side * 262 - side * 0.5, 23.6, z + o, 3, 0xffae42);
        }
    }
    // silos (west) and tanks (east) behind the depots
    const concrete = harborPalette(materials).concrete;
    const tankPaint = harborPalette(materials).cream;
    for (let k = 0; k < 6; k++) {
        const x = -300 - (k % 3) * 13;
        const z = -40 + Math.floor(k / 3) * 13;
        batch.add(concrete, new THREE.CylinderGeometry(6, 6, 38, 20, 1, true).translate(x, 19, z));
        batch.add(concrete, new THREE.ConeGeometry(6.2, 3, 20, 1, true).translate(x, 39.5, z));
    }
    batch.add(concrete, block(12, 10, 40, -300 - 13, 48, -33.5, { faces: '-x+x+y-z+z' }));
    glows.add(-306, 53.5, -14, 2.4, 0xff3020);
    for (let k = 0; k < 5; k++) {
        const x = 300 + (k % 3) * 26;
        const z = -70 + Math.floor(k / 3) * 30 + (k % 2) * 8;
        batch.add(tankPaint, new THREE.CylinderGeometry(11, 11, 15, 28, 1, true).translate(x, 7.5, z));
        batch.add(tankPaint, new THREE.CylinderGeometry(11.2, 11.2, 0.6, 28).translate(x, 15.2, z));
        glows.add(x, 16, z + 11, 1.2, 0xffc070);
    }
    void streaks;
}

/** The town north of the port: facades with lit windows (one shared facade texture), roofs, aviation lights on the tall ones. */
function buildTown(ctx, { batch }) {
    const { materials, glows, detail } = ctx;
    const random = rng(41);
    const { roofs, facade } = harborPalette(materials);
    const count = Math.round(70 * detail);
    for (let k = 0; k < count; k++) {
        const x = -560 + random() * 1120;
        const z = MIN_Z - 95 - random() * 330;
        const w = 14 + Math.round(random() * 3) * 6;
        const d = 14 + Math.round(random() * 2) * 6;
        const h = 3.2 * (3 + Math.floor(random() * random() * 16));
        // the windows start at the building's corner: shift the facade so whole bays fit
        const ox = x - w / 2;
        const oz = z - d / 2;
        const uv = (px, py, pz, face) => [face === '+z' || face === '-z' ? px - ox : pz - oz, py];
        batch.add(facade, slab(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, { faces: '-x+x-z+z', uv }));
        batch.add(roofs, slab(x - w / 2, x + w / 2, h, h + 0.4, z - d / 2, z + d / 2, { faces: '-x+x+y-z+z' }));
        if (random() < 0.5) batch.add(roofs, block(3 + random() * 4, 2.4, 3 + random() * 3, x + (random() - 0.5) * w * 0.5, h + 1.6, z + (random() - 0.5) * d * 0.5));
        if (h > 30) glows.add(x, h + 1.2, z, 2.2, 0xff3020);
    }
}

/** The far shore across the basin: low sheds, a second terminal's cranes, a line of lamps along the water with their reflections. */
function buildFarShore(ctx, { batch, streaks }) {
    const { materials, glows, detail } = ctx;
    const random = rng(97);
    const shore = QUAY_Z + 360;
    const p = harborPalette(materials);
    batch.add(p.gravel, slab(-1400, 1400, 0.4, 0.4, shore, shore + 500, { faces: '+y' }));
    batch.add(p.concrete, slab(-1400, 1400, WATER_Y - 1, 0.4, shore - 0.5, shore, { faces: '-z' }));
    const sheds = p.cladding;
    for (let k = 0; k < 26 * detail; k++) {
        const x = -700 + random() * 1400;
        const z = shore + 30 + random() * 160;
        const w = 30 + random() * 60;
        const h = 8 + random() * 14;
        batch.add(sheds[k % 2], slab(x - w / 2, x + w / 2, 0.4, h, z - 15, z + 15, { faces: '-x+x+y-z+z', uv: (px, py, pz, face) => [face === '-z' || face === '+z' ? px : pz, (py * 2.6) / h] }));
    }
    const frame = p.grey;
    for (const x of [140, 190, 240, 290]) {
        for (const dx of [-7, 7]) batch.add(frame, block(1.2, 30, 1.2, x + dx, 15, shore + 18));
        batch.add(frame, block(3, 3, 70, x - 4.6, 33, shore + 10), block(3, 3, 70, x + 4.6, 33, shore + 10));
        glows.add(x, 50, shore + 14, 3.4, 0xff3020);
        glows.add(x, 31, shore - 10, 3.6, 0xdfe8ff);
        streaks.add(x, 31, shore - 10, 0xdfe8ff, { width: 1.1, length: 0.8, strength: 0.4 });
    }
    for (let x = -680; x < 700; x += 38) {
        const warm = random() < 0.75;
        const colour = warm ? 0xffae42 : 0xdfe8ff;
        glows.add(x, 9, shore + 4, 4.5, colour);
        streaks.add(x, 9, shore + 4, colour, { width: 1.5, length: 0.7, strength: warm ? 0.55 : 0.45 });
    }
}

/** A cable-stayed bridge over the basin in the west: two A-pylons, fans of stays, the deck with its lamps; ramps down to the land. */
function buildBridge(ctx, { batch, streaks }) {
    const { materials, glows } = ctx;
    const x = -620;
    const deckY = 38;
    const z0 = QUAY_Z - 40;
    const z1 = QUAY_Z + 380;
    const concrete = harborPalette(materials).concrete;
    const cable = harborPalette(materials).zinc;
    // the deck and its approach ramp onto the land in the north
    batch.add(concrete, slab(x - 15, x + 15, deckY - 2.6, deckY, z0, z1 + 60, { faces: '-x+x-y+y' }));
    const ramp = new THREE.BufferGeometry();
    const rz = z0 - 260;
    ramp.setAttribute('position', new THREE.Float32BufferAttribute([x - 15, 0, rz, x + 15, 0, rz, x + 15, deckY, z0, x - 15, deckY, z0], 3));
    ramp.setIndex([0, 2, 1, 0, 3, 2]);
    ramp.computeVertexNormals();
    ramp.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 30, 0, 30, 260, 0, 260], 2));
    batch.add(concrete, ramp);
    for (let z = rz + 40; z < z0; z += 50) batch.add(concrete, block(6, deckY * ((z - rz) / (z0 - rz)), 4, x, (deckY * ((z - rz) / (z0 - rz))) / 2, z));
    // two A-pylons with fans of stays to both sides
    for (const pz of [QUAY_Z + 70, QUAY_Z + 250]) {
        const top = { x, y: 150, z: pz };
        for (const side of [-1, 1]) batch.add(concrete, tube({ x: x + side * 22, y: WATER_Y, z: pz }, { x: x + side * 1.5, y: 150, z: pz }, 3, { sides: 4 }));
        batch.add(concrete, block(30, 3, 5, x, deckY - 4, pz));
        for (let k = 1; k <= 9; k++) {
            for (const dir of [-1, 1]) {
                for (const side of [-1, 1]) {
                    batch.add(cable, tube({ x: x + side * 1.2, y: 146 - k * 3.4, z: pz }, { x: x + side * 14, y: deckY, z: pz + dir * k * 9 }, 0.22, { sides: 3 }));
                }
            }
        }
        glows.add(top.x, top.y + 2, top.z, 5, 0xff3020);
        glows.add(top.x, 100, top.z, 3, 0xff3020);
    }
    for (let z = z0; z < z1 + 60; z += 24) {
        for (const side of [-1, 1]) {
            glows.add(x + side * 14, deckY + 9, z, 4.2, 0xffae42);
            if (z > QUAY_Z + 5 && z < z1 - 20) streaks.add(x + side * 14, deckY + 9, z, 0xffa040, { width: 3, length: 0.6, strength: 0.4 });
        }
    }
}

