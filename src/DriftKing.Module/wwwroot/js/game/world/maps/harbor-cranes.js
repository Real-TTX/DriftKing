// DriftKing · maps/harbor-cranes.js – the machines of Kaikō-Docks: three ship-to-shore gantry cranes on the quay (legs on the old colliders,
// portal, box girders with the back-reach and the boom over the ship – one boom raised – A-frame with fore- and backstays, machinery house,
// trolley with the operator's cab, spreader and a box on the hook, floodlights and aviation lights), and the yard machines the land module
// parks outside the fence: rubber-tyred gantries, straddle carriers, reach stackers and terminal trucks. All invented, no real makes.

import * as THREE from 'three';
import { HARBOR, LED, block, harborPalette, tube } from './harbor-parts.js';
import { BOX, LINES } from './harbor-containers.js';
import { LIGHT_PRESETS } from '../../render/lights.js';

const { quayZ: QUAY_Z } = HARBOR;

/** The quay cranes' positions along the quay; the crane at the stern of the ship has its boom up. */
const STS = [{ x: -110, raised: true }, { x: 10, trolley: 141 }, { x: 120, trolley: 160 }];

/** Segments around a wheel (fewer on low). */
function wheelSides(materials) {
    return materials.quality === 'low' ? 6 : 10;
}

/** The cranes' materials (from the map's palette). */
function palette(materials) {
    const p = harborPalette(materials);
    return { frame: p.red, white: p.white, dark: p.dark, yellow: p.yellow, steel: p.steel, glass: p.glass, rubber: p.rubber, flood: p.led, warm: p.warm, red: p.redLight, cream: p.cream, grey: p.grey, blue: p.blue };
}

/**
 * The ship-to-shore cranes on the quay. Their legs stand on the old colliders (0.7 m half boxes); everything above is out of reach.
 * @param {object} ctx the map context
 * @param {{ yard: import('./harbor-containers.js').ContainerYard, streaks: import('./harbor-water.js').WaterStreaks }} parts
 */
export function buildCranes(ctx, { batch, yard, streaks }) {
    const { colliders, glows, pools, materials, quality, lights } = ctx;
    const p = palette(materials);
    const pbr = quality !== 'low';
    const land = QUAY_Z - 12;
    const sea = QUAY_Z - 2;
    for (const crane of STS) {
        const x0 = crane.x;
        // the legs on their bogies (the old colliders), sill beams across the quay, the portal beams along it
        for (const dx of [-7, 7]) {
            for (const z of [land, sea]) {
                colliders.addBox(x0 + dx, z, 0.7, 0.7);
                batch.add(p.dark, block(1.38, 1.1, 1.38, x0 + dx, 0.55, z));
                for (const wz of [-0.45, 0.45]) batch.add(p.rubber, new THREE.CylinderGeometry(0.42, 0.42, 1.42, wheelSides(materials)).rotateZ(Math.PI / 2).translate(x0 + dx, 0.42, z + wz));
                batch.add(p.frame, block(1.25, 31, 1.25, x0 + dx, 1.1 + 15.5, z, { faces: '-x+x-z+z' }));
            }
            batch.add(p.frame, block(1.1, 1.6, sea - land, x0 + dx, 14.8, (land + sea) / 2, { faces: '-x+x-y+y' }));
            // diagonal braces in the portal (seen along the quay)
            batch.add(p.frame, tube({ x: x0 + dx, y: 15.5, z: land + 0.6 }, { x: x0 + dx, y: 30.5, z: sea - 0.6 }, 0.32, { sides: 4 }));
        }
        for (const z of [land, sea]) batch.add(p.frame, block(15.3, 1.8, 1.4, x0, 31.4, z, { faces: '-y+y-z+z' }));
        // the girders: back-reach over the quay, the boom over the water (raised on the idle crane)
        const girders = [];
        for (const gx of [-4.6, 4.6]) {
            girders.push(block(1.4, 3, QUAY_Z + 0.5 - 92, x0 + gx, 33.8, (92 + QUAY_Z + 0.5) / 2, { faces: '-x+x-y+y-z' }));
        }
        for (let z = 94; z < QUAY_Z; z += 8) girders.push(block(8, 0.5, 0.6, x0, 32.5, z, { faces: '-y+y-z+z' }));
        const boom = [];
        const boomLength = 52;
        for (const gx of [-4.6, 4.6]) {
            const g = block(1.4, 3, boomLength, x0 + gx, 33.8, QUAY_Z + 0.5 + boomLength / 2, { faces: '-x+x-y+y+z' });
            boom.push(g);
        }
        for (let z = QUAY_Z + 6; z < QUAY_Z + boomLength; z += 9) boom.push(block(8, 0.5, 0.6, x0, 32.5, z, { faces: '-y+y-z+z' }));
        const floods = [];
        for (const z of [QUAY_Z + 14, QUAY_Z + 30, QUAY_Z + 46]) floods.push(block(1.2, 0.12, 0.6, x0, 32.2, z, { faces: '-y' }));
        const hinge = { y: 33.8, z: QUAY_Z + 0.5 };
        const angle = crane.raised ? 1.32 : 0;
        const raise = g => {
            if (!angle) return g;
            g.translate(0, -hinge.y, -hinge.z);
            g.rotateX(-angle);
            g.translate(0, hinge.y, hinge.z);
            return g;
        };
        batch.add(p.white, ...girders, ...boom.map(raise));
        batch.add(p.flood, ...floods.map(raise));
        const tip = { y: hinge.y + Math.sin(angle) * boomLength, z: hinge.z + Math.cos(angle) * boomLength };
        const midBoom = { y: hinge.y + Math.sin(angle) * boomLength * 0.5, z: hinge.z + Math.cos(angle) * boomLength * 0.5 };
        // machinery house on the back-reach, its lit window strip
        batch.add(p.white, block(10.4, 5.4, 9, x0, 38, 97.5, { faces: '-x+x+y-z+z' }));
        batch.add(p.warm, block(10.45, 0.5, 9.05, x0, 39.4, 97.5, { faces: '-x+x-z+z' }));
        // the A-frame over the waterside legs, fore- and backstays
        const apex = { y: 58, z: QUAY_Z - 5 };
        for (const gx of [-4.6, 4.6]) {
            batch.add(p.frame, tube({ x: x0 + gx, y: 35.3, z: land }, { x: x0 + gx * 0.8, y: apex.y, z: apex.z }, 0.55, { sides: 4 }));
            batch.add(p.frame, tube({ x: x0 + gx, y: 35.3, z: sea }, { x: x0 + gx * 0.8, y: apex.y, z: apex.z }, 0.55, { sides: 4 }));
            batch.add(p.steel, tube({ x: x0 + gx * 0.8, y: apex.y, z: apex.z }, { x: x0 + gx, y: tip.y + 1.5, z: tip.z - (angle ? 0 : 2) }, 0.16, { sides: 4 }));
            batch.add(p.steel, tube({ x: x0 + gx * 0.8, y: apex.y, z: apex.z }, { x: x0 + gx, y: midBoom.y + 1.5, z: midBoom.z }, 0.16, { sides: 4 }));
            batch.add(p.steel, tube({ x: x0 + gx * 0.8, y: apex.y, z: apex.z }, { x: x0 + gx, y: 35.3, z: 93 }, 0.18, { sides: 4 }));
        }
        batch.add(p.frame, block(8, 1.2, 1.2, x0, apex.y, apex.z));
        batch.add(p.red, block(0.4, 0.4, 0.4, x0, apex.y + 0.9, apex.z), block(0.4, 0.4, 0.4, x0, tip.y + 0.4, tip.z));
        glows.add(x0, apex.y + 0.9, apex.z, 2.6, 0xff3020);
        glows.add(x0, tip.y + 0.4, tip.z, 2.4, 0xff3020);
        // floodlights under the portal: the cool light on the quay (one real light per crane), glows, the reflections on the water
        for (const dx of [-5, 5]) {
            for (const z of [land + 1.2, sea - 1.2]) {
                batch.add(p.flood, block(1, 0.12, 0.5, x0 + dx, 30.4, z, { faces: '-y' }));
                glows.add(x0 + dx, 30.3, z, 2.6, 0xdfe8ff);
            }
        }
        lights.add({ x: x0, y: 30, z: QUAY_Z - 7, ...LIGHT_PRESETS.mast, color: LED, intensity: 2200, distance: 56, angle: 0.95, priority: 1.3 });
        pools.add(x0, 0, QUAY_Z - 7, 16, 0xdfe6ff, pbr ? 0.2 : 0.45);
        if (!angle) {
            for (const z of [QUAY_Z + 14, QUAY_Z + 30, QUAY_Z + 46]) glows.add(x0, 32.1, z, 2.8, 0xdfe8ff);
            // trolley, operator's cab, ropes, spreader and the box it carries
            const tz = crane.trolley;
            batch.add(p.white, block(7.4, 1.4, 4.4, x0, 31.6, tz));
            batch.add(p.white, block(2.6, 2.6, 2.6, x0 + 2.4, 29.6, tz - 0.4, { faces: '-x+x-y+y-z' }));
            batch.add(p.glass, block(2.62, 1.4, 0.05, x0 + 2.4, 29.6, tz + 0.92, { faces: '+z-y' }));
            batch.add(p.warm, block(2.2, 0.08, 2.2, x0 + 2.4, 28.32, tz - 0.4, { faces: '-y' }));
            const hook = crane.x > 0 ? 19.5 : 24;
            for (const ox of [-3, 3]) {
                for (const oz of [-0.9, 0.9]) batch.add(p.steel, tube({ x: x0 + ox, y: 30.9, z: tz + oz }, { x: x0 + ox * 1.6, y: hook + 0.5, z: tz + oz }, 0.03, { sides: 3 }));
            }
            batch.add(p.yellow, block(12.3, 0.45, 2.5, x0, hook + 0.25, tz));
            const line = LINES[(Math.abs(x0) / 10) % LINES.length | 0];
            yard.add({ x: x0, y: hook - BOX.h - 0.02, z: tz, yaw: 0, size: 40, line, lod: 'mid', chunk: 'ship' });
        } else {
            // the raised boom's floodlights point at the quay
            glows.add(x0, tip.y - 3, tip.z - 1.5, 2.4, 0xdfe8ff);
        }
    }
}

/**
 * A rubber-tyred gantry crane over a container block (unreachable areas only – no colliders): two portals on rubber tyres, span along z,
 * the top girders with the trolley, its cab and a spreader.
 */
export function addRtg(batch, materials, { x, z0, z1, height = 19 }) {
    const p = palette(materials);
    const yellow = p.yellow;
    const zc = (z0 + z1) / 2;
    const span = z1 - z0;
    for (const dx of [-3.4, 3.4]) {
        for (const z of [z0, z1]) {
            batch.add(yellow, block(0.9, height - 1.4, 0.9, x + dx, 1.4 + (height - 1.4) / 2, z, { faces: '-x+x-z+z' }));
            batch.add(p.dark, block(1.4, 0.7, 2.4, x + dx, 1.35, z));
            for (const wz of [-0.7, 0.7]) batch.add(p.rubber, new THREE.CylinderGeometry(0.62, 0.62, 0.55, wheelSides(materials)).rotateZ(Math.PI / 2).translate(x + dx, 0.62, z + wz));
        }
        batch.add(yellow, block(0.8, 0.8, span, x + dx, 1.9, zc, { faces: '-x+x+y' }));
    }
    for (const z of [z0, z1]) batch.add(yellow, block(8.2, 1.4, 1.1, x, height, z));
    for (const dx of [-3.4, 3.4]) batch.add(yellow, block(1, 1.6, span + 1.2, x + dx, height + 1.4, zc, { faces: '-x+x+y-z+z' }));
    const tz = z0 + span * 0.35;
    batch.add(p.white, block(6.6, 1.6, 3.4, x, height + 3, tz));
    batch.add(p.white, block(2.2, 2.4, 2.2, x - 2.2, height - 0.6, tz + 1.5, { faces: '-x+x-y-z+z' }));
    batch.add(p.glass, block(0.05, 1.2, 2.2, x - 3.31, height - 0.4, tz + 1.5, { faces: '-x' }));
    batch.add(p.yellow, block(12.2, 0.4, 2.4, x, height - 6, tz));
    for (const ox of [-2.5, 2.5]) batch.add(p.steel, tube({ x: x + ox, y: height + 2.2, z: tz }, { x: x + ox * 1.8, y: height - 5.8, z: tz }, 0.03, { sides: 3 }));
    batch.add(p.flood, block(1, 0.1, 0.5, x, height - 0.75, z0 + 0.6, { faces: '-y' }), block(1, 0.1, 0.5, x, height - 0.75, z1 - 0.6, { faces: '-y' }));
    return [{ x, y: height - 0.8, z: z0 + 0.6 }, { x, y: height - 0.8, z: z1 - 0.6 }];
}

/** A straddle carrier (about 9 × 5 × 14 m) at (x, z) turned by yaw, optionally carrying a container (unreachable areas only). */
export function addStraddle(batch, materials, yard, { x, z, yaw = 0, line = null }) {
    const p = palette(materials);
    const body = p.cream;
    const parts = [];
    const dark = [];
    const tyres = [];
    for (const side of [-1, 1]) {
        const zz = side * 2.4;
        parts.push(block(8.6, 0.9, 0.7, 0, 1.5, zz));
        for (const lx of [-3.9, 3.9]) parts.push(block(0.6, 12, 0.6, lx, 7.6, zz));
        parts.push(block(8.6, 1, 0.8, 0, 13.4, zz));
        for (const lx of [-3.3, -1.1, 1.1, 3.3]) tyres.push(new THREE.CylinderGeometry(0.55, 0.55, 0.45, wheelSides(materials)).rotateX(Math.PI / 2).translate(lx, 0.55, zz));
    }
    for (const lx of [-3.9, 3.9]) parts.push(block(0.8, 0.8, 5.6, lx, 13.6, 0));
    dark.push(block(2, 2.2, 2.2, 3.6, 15.1, -1.2));
    const glass = block(0.05, 1.1, 2, 4.62, 15.3, -1.2, { faces: '+x' });
    parts.push(block(8, 0.3, 2.3, 0, 10.5, 0));
    const place = g => g.rotateY(yaw).translate(x, 0, z);
    batch.add(body, ...parts.map(place));
    batch.add(p.dark, ...dark.map(place));
    batch.add(p.glass, place(glass));
    batch.add(p.rubber, ...tyres.map(place));
    if (line) yard.add({ x, y: 10.35 - BOX.h, z, yaw, size: 40, line, lod: 'mid', chunk: 'land' });
}

/** A reach stacker (about 11 × 4 m, boom up to a container) at (x, z) facing yaw (unreachable areas only). */
export function addReachStacker(batch, materials, yard, { x, z, yaw = 0, line = null, lift = 5 }) {
    const p = palette(materials);
    const paint = p.red;
    const parts = [];
    const tyres = [];
    parts.push(block(8.5, 1.6, 3.6, 0, 1.6, 0));
    parts.push(block(2.4, 1.6, 3.4, -3.4, 2.9, 0));
    const cab = block(1.8, 2.2, 1.6, -0.6, 3.5, 0.8);
    const glass = block(1.82, 1.2, 1.62, -0.6, 3.8, 0.8, { faces: '-x+x-z+z' });
    const boomLength = 11;
    const angle = Math.atan2(lift, 7);
    const boom = block(boomLength, 1, 0.9, 0, 0, -0.4);
    boom.translate(boomLength / 2, 0, 0).rotateZ(angle).translate(-3, 3.2, 0);
    parts.push(boom);
    for (const lx of [-2.8, 2.6]) {
        for (const side of [-1, 1]) tyres.push(new THREE.CylinderGeometry(0.8, 0.8, 0.7, wheelSides(materials)).rotateX(Math.PI / 2).translate(lx, 0.8, side * 1.75));
    }
    const head = { x: -3 + Math.cos(angle) * boomLength, y: 3.2 + Math.sin(angle) * boomLength };
    const spreader = block(2.4, 0.4, 6, head.x + 0.4, head.y - 0.8, -0.4);
    const place = g => g.rotateY(yaw).translate(x, 0, z);
    batch.add(paint, ...parts.map(place), place(cab));
    batch.add(p.glass, place(glass));
    batch.add(p.yellow, place(spreader));
    batch.add(p.rubber, ...tyres.map(place));
    if (line) {
        const cx = x + Math.cos(yaw) * (head.x + 0.4) + Math.sin(yaw) * -0.4;
        const cz = z - Math.sin(yaw) * (head.x + 0.4) + Math.cos(yaw) * -0.4;
        yard.add({ x: cx, y: head.y - 1 - BOX.h, z: cz, yaw: yaw + Math.PI / 2, size: 40, line, lod: 'mid', chunk: 'land' });
    }
}

/** A terminal truck: cab-over tractor and a skeletal chassis, optionally with a container on it (unreachable areas only). */
export function addTruck(batch, materials, yard, { x, z, yaw = 0, paint: kind = 'blue', line = null }) {
    const p = palette(materials);
    const paint = p[kind] ?? p.blue;
    const parts = [];
    const dark = [];
    const tyres = [];
    parts.push(block(2.2, 2.4, 2.45, 6.9, 2.15, 0, { faces: '-x+x+y-z+z' }));
    const glass = block(0.05, 1, 2.2, 8.02, 2.6, 0, { faces: '+x' });
    dark.push(block(3.6, 0.5, 1.1, 6.6, 0.85, 0));
    dark.push(block(12.4, 0.35, 0.9, -0.6, 1.25, 0));
    dark.push(block(0.3, 0.3, 2.44, -6.6, 1.3, 0), block(0.3, 0.3, 2.44, 5.3, 1.3, 0));
    for (const lx of [7.2, 5.4, -4.6, -5.8]) {
        for (const side of [-1, 1]) tyres.push(new THREE.CylinderGeometry(0.5, 0.5, 0.5, wheelSides(materials)).rotateX(Math.PI / 2).translate(lx, 0.5, side * 1.0));
    }
    const lamps = [block(0.05, 0.2, 0.3, 8.02, 1.4, -0.9, { faces: '+x' }), block(0.05, 0.2, 0.3, 8.02, 1.4, 0.9, { faces: '+x' })];
    const place = g => g.rotateY(yaw).translate(x, 0, z);
    batch.add(paint, ...parts.map(place));
    batch.add(p.dark, ...dark.map(place));
    batch.add(p.glass, place(glass));
    batch.add(p.rubber, ...tyres.map(place));
    batch.add(p.warm, ...lamps.map(place));
    if (line) yard.add({ x: x - Math.cos(yaw) * 0.6, y: 1.45, z: z + Math.sin(yaw) * 0.6, yaw, size: 40, line, lod: 'mid', chunk: 'land' });
}

