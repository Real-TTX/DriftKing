// DriftKing · maps/deck-structures.js – what stands on and around the roof of "Parkdeck 7": the concrete parapets with their coping and
// galvanised railing, the stair towers and the lift tower (lit stairwell and lobby behind glass, steel doors, exit signs, wall lamps, roof
// plant), the ramp down to level 6 with its upstands, boom barrier and card reader, the plinths of the light poles, the "P7" sign on the
// facade and the open facade of the levels below (spandrels, fins, lit ceilings, shops at street level). Concrete is one merged mesh,
// steel one, painted steel one, glass one, everything lit goes into the lit atlas batch, painted details into the solid atlas batch.
// Colliders are added by deck.js.

import * as THREE from 'three';
import { box, mergeGeometries, metricUVs } from '../../render/kit.js';
import { LIGHT_PRESETS, kelvinHex } from '../../render/lights.js';
import { Batch, LIT, PAINT } from './deck-atlas.js';

/** Floor heights of the parking levels below the roof (ground floor 5 m, six levels of 3.5 m; the roof deck is level 7 at y = 0). */
export const LEVEL_Y = [-21, -17.5, -14, -10.5, -7, -3.5];
const SLAB = 0.35;
const PARAPET = 0.92;

/** A placed box with metric UVs (for the concrete/steel factories). */
function piece(w, h, d, x, y, z, rot = 0) {
    return metricUVs(box(w, h, d, x, y, z, rot));
}

/** A rod (open cylinder) from a to b with radius r and metric UVs. */
export function rod(a, b, r, segments = 6) {
    const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = dir.length();
    const g = new THREE.CylinderGeometry(r, r, length, segments, 1, true).translate(0, length / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(a.x, a.y, a.z);
    return metricUVs(g);
}

/**
 * Hazard stripes as a band on a wall from (x0, z0) to (x1, z1) between heights y0 and y1; the band faces to the right of its direction
 * (seen from above) and sits `offset` in front of the wall.
 */
export function hazardBand(solid, x0, z0, x1, z1, y0, y1, offset = 0.006) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / length;
    const uz = (z1 - z0) / length;
    const nx = -uz;
    const nz = ux;
    const h = y1 - y0;
    // the cell holds 16 periods of 64 units and is one slant (64 units) high: 45° stripes when 64 units across = h
    const perMetre = 64 / h / 1024;
    let at = 0;
    let u = (Math.abs(x0 * 7 + z0 * 3) % 1) * 0.5;
    while (at < length - 0.001) {
        const step = Math.min(length - at, (1 - u) / perMetre);
        const cx = x0 + ux * (at + step / 2) + nx * offset;
        const cz = z0 + uz * (at + step / 2) + nz * offset;
        solid.wall(cx, (y0 + y1) / 2, cz, ux, uz, step / 2, h / 2, PAINT.hazard, { u0: u, u1: u + step * perMetre });
        at += step;
        u = 0;
    }
}

/** An octagonal plinth (concrete with hazard paint in two bands) at the foot of a light pole. */
export function plinth(solid, x, z, r = 0.3, h = 0.6) {
    const sides = 8;
    const step = (Math.PI * 2) / sides;
    const flat = r * Math.cos(step / 2);
    const half = r * Math.sin(step / 2);
    const perMetre = 64 / (h / 2) / 1024;
    let u = 0;
    for (let k = 0; k < sides; k++) {
        const a = (k + 0.5) * step;
        const nx = Math.cos(a);
        const nz = Math.sin(a);
        // the face looks along (nx, nz): u = (nz, −nx)
        for (const band of [0, 1]) {
            solid.wall(x + nx * flat, h * (0.25 + band * 0.5), z + nz * flat, nz, -nx, half, h / 4, PAINT.hazard, { u0: u, u1: u + half * 2 * perMetre });
        }
        u += half * 2 * perMetre;
    }
    solid.floor(x, h, z, 1, 0, flat, flat, PAINT.concreteGrey);
}

/**
 * Builds the structures.
 * @param {object} ctx map context
 * @param {{ halfX, halfZ, drop, towers, ramp, poles, solid: Batch, lit: Batch }} layout
 * @returns {{ doors: { x, z, nx, nz, zebra }[], reader: { x, z } }} the spots in front of the tower doors, the card reader at the ramp
 */
export function buildStructures(ctx, layout) {
    const { root, materials } = ctx;
    const { halfX, halfZ, drop, towers, ramp, poles, solid, lit } = layout;
    const parts = { concrete: [], steel: [], painted: [], glass: [] };

    buildParapet(parts, solid, { halfX, halfZ, postStep: ctx.quality === 'low' ? 4 : 2 });
    const doors = towers.map(t => buildTower(ctx, parts, solid, lit, t));
    const reader = buildRamp(ctx, parts, solid, lit, ramp);
    for (const p of poles) plinth(solid, p.x, p.z);
    buildBigSign(ctx, parts, lit, halfZ);
    buildCarPark(parts, lit, { halfX, halfZ, drop, ramp });

    const concrete = new THREE.Mesh(mergeGeometries(parts.concrete), materials.concrete({ color: 0xc8c4bc }));
    const steel = new THREE.Mesh(mergeGeometries(parts.steel), materials.metal({ color: 0xb4b8bd, roughness: 0.42 }));
    const painted = new THREE.Mesh(mergeGeometries(parts.painted), materials.painted({ color: 0x3e4a48, roughness: 0.48 }));
    // the moon casts shadows on high: towers, parapets, railings
    for (const mesh of [concrete, steel, painted]) {
        mesh.castShadow = ctx.quality === 'high';
        mesh.receiveShadow = ctx.quality === 'high';
        root.add(mesh);
    }
    const glass = new THREE.Mesh(mergeGeometries(parts.glass), materials.glass({ tint: 0x10161c, opacity: 0.28, roughness: 0.05 }));
    glass.renderOrder = 3;
    root.add(glass);
    return { doors, reader };
}

/** The parapet: a 0.92 m concrete upstand on the slab edge with a precast coping, a galvanised railing on top, hazard paint at the corners. */
function buildParapet({ concrete, steel }, solid, { halfX, halfZ, postStep }) {
    const t = 0.5;
    const sides = [
        { len: halfX * 2 + t * 2, x: 0, z: -halfZ - t / 2, alongX: true },
        { len: halfX * 2 + t * 2, x: 0, z: halfZ + t / 2, alongX: true },
        { len: halfZ * 2, x: -halfX - t / 2, z: 0, alongX: false },
        { len: halfZ * 2, x: halfX + t / 2, z: 0, alongX: false },
    ];
    const top = PARAPET + 0.09;
    for (const s of sides) {
        const ax = s.alongX;
        concrete.push(piece(ax ? s.len : t, PARAPET, ax ? t : s.len, s.x, PARAPET / 2, s.z));
        // the coping: a little wider than the wall (drip edges)
        concrete.push(piece(ax ? s.len + 0.1 : t + 0.12, 0.09, ax ? t + 0.12 : s.len + 0.1, s.x, PARAPET + 0.045, s.z));
        // railing: posts every 2 m (4 m on low), a top rail and a knee rail
        for (let a = -s.len / 2 + 0.3; a <= s.len / 2 - 0.2; a += postStep) {
            steel.push(piece(0.05, 0.36, 0.05, ax ? s.x + a : s.x, top + 0.18, ax ? s.z : s.z + a));
        }
        for (const [y, r] of [[top + 0.36, 0.03], [top + 0.18, 0.018]]) {
            const a = { x: ax ? s.x - s.len / 2 + 0.1 : s.x, y, z: ax ? s.z : s.z - s.len / 2 + 0.1 };
            const b = { x: ax ? s.x + s.len / 2 - 0.1 : s.x, y, z: ax ? s.z : s.z + s.len / 2 - 0.1 };
            steel.push(rod(a, b, r, 6));
        }
    }
    // hazard paint on the inner faces near the four corners (lower 0.45 m); each band runs so that it faces the deck
    const run = 6;
    const bands = [
        [-halfX + run, -halfZ, -halfX, -halfZ], [-halfX, -halfZ, -halfX, -halfZ + run],
        [halfX, -halfZ, halfX - run, -halfZ], [halfX, -halfZ + run, halfX, -halfZ],
        [halfX - run, halfZ, halfX, halfZ], [halfX, halfZ, halfX, halfZ - run],
        [-halfX, halfZ - run, -halfX, halfZ], [-halfX, halfZ, -halfX + run, halfZ],
    ];
    for (const [x0, z0, x1, z1] of bands) hazardBand(solid, x0, z0, x1, z1, 0, 0.45);
    // a few tags on the inner faces
    solid.wall(38, 0.5, -halfZ + 0.008, 1, 0, 1.0, 0.25, PAINT.tags[0]);
    solid.wall(-46, 0.5, halfZ - 0.008, -1, 0, 1.0, 0.25, PAINT.tags[0]);
    solid.wall(halfX - 0.008, 0.5, 12, 0, 1, 1.0, 0.25, PAINT.tags[0]);
}

/**
 * A stair tower or the lift tower: a concrete box (the collider footprint) with a roof slab, a glazed lit section and a steel door on its
 * front face, the exit sign, a canopy and a wall lamp (a real light source), hazard paint on the front corners, plant on the roof.
 * @returns {{ x, z, nx, nz, zebra }} the spot in front of the door
 */
function buildTower(ctx, { concrete, steel, painted, glass }, solid, lit, t) {
    const { x, z, w, d, h, nx, nz, kind } = t;
    concrete.push(piece(w, h, d, x, h / 2, z));
    concrete.push(piece(w + 0.3, 0.22, d + 0.3, x, h + 0.11, z));
    // the front face: its centre, the axis along it (u; the face looks to the right of u, along n), its width
    const depth = Math.abs(nx) > 0 ? w / 2 : d / 2;
    const span = Math.abs(nx) > 0 ? d : w;
    const fx = x + nx * depth;
    const fz = z + nz * depth;
    const ux = nz;
    const uz = -nx;
    const yaw = Math.atan2(nx, nz);
    const at = (along, out = 0) => ({ x: fx + ux * along + nx * out, z: fz + uz * along + nz * out });
    // glazing: the lit stairwell / lobby behind glass in a steel frame
    const lift = kind === 'lift';
    const glazeWidth = lift ? 3.2 : 2.4;
    const glazeHeight = lift ? 2.7 : Math.min(3.2, h - 0.8);
    const glazeAlong = lift ? -0.6 : span / 2 - glazeWidth / 2 - 0.7;
    const inside = at(glazeAlong, 0.012);
    lit.wall(inside.x, glazeHeight / 2 + 0.1, inside.z, ux, uz, glazeWidth / 2, glazeHeight / 2, lift ? LIT.lobby : LIT.stairs);
    const pane = at(glazeAlong, 0.07);
    glass.push(new THREE.PlaneGeometry(glazeWidth, glazeHeight).rotateY(yaw).translate(pane.x, glazeHeight / 2 + 0.1, pane.z));
    for (const k of [-1, -0.33, 0.33, 1]) {
        const m = at(glazeAlong + (k * glazeWidth) / 2, 0.05);
        steel.push(piece(0.07, glazeHeight + 0.08, 0.07, m.x, glazeHeight / 2 + 0.1, m.z));
    }
    for (const y of [0.1, glazeHeight + 0.1]) {
        const a = at(glazeAlong - glazeWidth / 2, 0.05);
        const b = at(glazeAlong + glazeWidth / 2, 0.05);
        steel.push(rod({ x: a.x, y, z: a.z }, { x: b.x, y, z: b.z }, 0.04, 4));
    }
    // the steel door with its push bar
    const doorAlong = lift ? span / 2 - 1.1 : -span / 2 + 1.6;
    const door = at(doorAlong, 0.03);
    painted.push(metricUVs(box(1.0, 2.1, 0.06, door.x, 1.05, door.z, yaw)));
    const bar = at(doorAlong, 0.1);
    steel.push(piece(Math.abs(nx) > 0 ? 0.04 : 0.8, 0.05, Math.abs(nx) > 0 ? 0.8 : 0.04, bar.x, 1.0, bar.z));
    // the exit sign above the door, a canopy over it
    const sign = at(doorAlong, 0.09);
    painted.push(metricUVs(box(0.62, 0.32, 0.12, sign.x, 2.45, sign.z, yaw)));
    const signFace = at(doorAlong, 0.152);
    lit.wall(signFace.x, 2.45, signFace.z, ux, uz, 0.29, 0.145, LIT.exit);
    ctx.glows.add(signFace.x + nx * 0.15, 2.45, signFace.z + nz * 0.15, 0.9, 0x3ef08a);
    const canopy = at(doorAlong, 0.6);
    painted.push(metricUVs(box(1.8, 0.08, 1.2, canopy.x, 2.72, canopy.z, yaw)));
    // the wall lamp beside the door (a bulkhead): emissive lens, a glow, a real light on the door area
    const lamp = at(doorAlong + 1.0, 0.06);
    painted.push(metricUVs(box(0.32, 0.2, 0.1, lamp.x, 2.2, lamp.z, yaw)));
    const lens = at(doorAlong + 1.0, 0.112);
    lit.wall(lens.x, 2.2, lens.z, ux, uz, 0.13, 0.07, LIT.lamp);
    ctx.glows.add(lens.x + nx * 0.1, 2.2, lens.z + nz * 0.1, 1.2, 0xe8f0ff);
    ctx.lights.add({ x: lens.x + nx * 0.3, y: 2.3, z: lens.z + nz * 0.3, ...LIGHT_PRESETS.shop, color: kelvinHex(4200), intensity: 60, distance: 11,
        dir: { x: nx, y: -0.9, z: nz }, priority: 0.7 });
    // hazard paint on both front corners: a strip on the front face and one on the side face
    for (const side of [-1, 1]) {
        const c = at((side * span) / 2);
        const e = { x: c.x - ux * side * 0.35, z: c.z - uz * side * 0.35 };
        const b = { x: c.x - nx * 0.35, z: c.z - nz * 0.35 };
        if (side > 0) {
            hazardBand(solid, e.x, e.z, c.x, c.z, 0, 1.2);
            hazardBand(solid, c.x, c.z, b.x, b.z, 0, 1.2);
        } else {
            hazardBand(solid, c.x, c.z, e.x, e.z, 0, 1.2);
            hazardBand(solid, b.x, b.z, c.x, c.z, 0, 1.2);
        }
    }
    // a dark metal fascia round the top with a thin LED line under it
    painted.push(metricUVs(box(w + 0.08, 0.62, d + 0.08, x, h - 0.31, z)));
    for (const [fx2, fz2, ux2, uz2, half2] of [[0, d / 2 + 0.045, 1, 0, w / 2], [0, -d / 2 - 0.045, -1, 0, w / 2], [w / 2 + 0.045, 0, 0, -1, d / 2], [-w / 2 - 0.045, 0, 0, 1, d / 2]]) {
        lit.wall(x + fx2, h - 0.66, z + fz2, ux2, uz2, half2, 0.025, LIT.lamp);
    }
    // tags on the side walls (the faces without the door)
    for (const side of [-1, 1]) {
        const sx = x + ux * side * (span / 2 + 0.008);
        const sz = z + uz * side * (span / 2 + 0.008);
        const along = (Math.abs(nx) > 0 ? w : d) / 2 - 1.6;
        // the side face looks along u·side, so its texture runs along −n·side
        solid.wall(sx - nx * along * 0.4, 1.1, sz - nz * along * 0.4, -nx * side, -nz * side, 1.1, 0.55, PAINT.tags[0]);
    }
    // roof plant: the lift's machine room with the blue P and the level number, or a vent hood and a pipe on a stair tower
    if (lift) {
        const mx = x - nx * 0.6;
        const mz = z - nz * 0.6;
        const top = h + 1.02;
        concrete.push(piece(w * 0.55, 1.6, d * 0.55, mx, top, mz));
        const half = ((Math.abs(nx) > 0 ? w : d) * 0.55) / 2;
        const px = mx + nx * (half + 0.01);
        const pz = mz + nz * (half + 0.01);
        lit.wall(px, top, pz, ux, uz, 0.7, 0.7, LIT.parking);
        lit.wall(px + ux * 1.15, top, pz + uz * 1.15, ux, uz, 0.32, 0.4, LIT.level);
        ctx.glows.add(px + nx * 0.5, top, pz + nz * 0.5, 3.4, 0x2a6cff);
        for (const s of [-1, 1]) steel.push(piece(0.06, 3.0, 0.06, x + ux * s * 1.2 - nx * 1.6, h + 1.5, z + uz * s * 1.2 - nz * 1.6));
    } else {
        concrete.push(piece(1.4, 0.7, 1.4, x - nx * 1.5, h + 0.57, z - nz * 1.5));
        steel.push(piece(1.6, 0.06, 1.6, x - nx * 1.5, h + 0.95, z - nz * 1.5));
        steel.push(rod({ x: x + ux * 2, y: h + 0.22, z: z + uz * 2 }, { x: x + ux * 2, y: h + 1.8, z: z + uz * 2 }, 0.08, 6));
    }
    return { x: door.x, z: door.z, nx, nz, zebra: lift };
}

/**
 * The ramp down to level 6 along the west parapet: the opening in the slab (the slab leaves it out), the sloped lane, walls going down, upstands
 * with coping and hazard paint on the deck, the mouth with the boom barrier and a card reader, the lit level-6 room under the slab.
 * @returns {{ x, z }} the card reader post (deck.js gives it a collider)
 */
function buildRamp(ctx, { concrete, steel }, solid, lit, ramp) {
    const { x0, x1, z0, z1 } = ramp;
    const lane = x1 - x0 - 0.25;
    const laneX = x0 + lane / 2;
    const bottom = -3.5;
    // the lane: from the mouth at deck height down to level 6 under the slab (z0 is the far end of the opening)
    const profile = [[z1, 0], [z0 + 0.25, bottom + 0.6], [z0 - 3, bottom], [z0 - 12, bottom]];
    for (let k = 0; k < profile.length - 1; k++) {
        const [za, ya] = profile[k];
        const [zb, yb] = profile[k + 1];
        const g = new THREE.PlaneGeometry(lane, Math.hypot(za - zb, ya - yb)).rotateX(-Math.PI / 2 - Math.atan2(ya - yb, za - zb));
        g.translate(laneX, (ya + yb) / 2 - 0.02, (za + zb) / 2);
        concrete.push(metricUVs(g));
    }
    // the inner upstand (deck side, 1.1 m above the deck and down to the lane) and the end upstand over the far end of the opening
    concrete.push(piece(0.25, 5.1, z1 - z0, x1 - 0.125, -1.45, (z0 + z1) / 2));
    concrete.push(piece(x1 - x0, 1.1 + SLAB, 0.25, (x0 + x1) / 2, (1.1 - SLAB) / 2, z0 + 0.125));
    concrete.push(piece(0.36, 0.08, z1 - z0 + 0.1, x1 - 0.125, 1.14, (z0 + z1) / 2));
    concrete.push(piece(x1 - x0 + 0.1, 0.08, 0.36, (x0 + x1) / 2, 1.14, z0 + 0.125));
    // walls down along the lane (the facade side and, under the slab, the deck side), the level-6 ceiling, its lit back wall and tubes
    concrete.push(piece(0.3, 4, z1 - z0 + 12, x0 - 0.15, -2, (z0 - 12 + z1) / 2));
    concrete.push(piece(0.25, 4, 12, x1 - 0.125, -2, z0 - 6));
    concrete.push(piece(x1 - x0, SLAB - 0.03, 12, (x0 + x1) / 2, -SLAB / 2 - 0.015, z0 - 6));
    lit.wall(laneX, -1.8, z0 - 11.9, 1, 0, lane / 2, 1.5, LIT.levels, { u0: 0.1, u1: 0.25 });
    for (const dz of [-4, 4]) lit.quad({ x: laneX, y: -SLAB - 0.04, z: z0 + dz }, { x: 0.08, y: 0, z: 0 }, { x: 0, y: 0, z: 1.2 }, Batch.rect(LIT.lamp));
    // hazard paint along the upstand foot, on its nose at the mouth and on the end upstand
    hazardBand(solid, x1, z1, x1, z0, 0, 0.4);
    hazardBand(solid, x1 - 0.25, z1, x1, z1, 0, 1.1);
    hazardBand(solid, x1, z0, x0, z0, 0, 0.4);
    // the boom barrier: housing on the deck at the mouth, a striped boom across, a rest post at the far side
    const by = 0.95;
    const bz = z1 + 0.35;
    solid.box(x1 + 0.35, 0.55, bz, 0.34, 1.1, 0.34, PAINT.paintYellow);
    solid.box(x1 + 0.35, 1.13, bz, 0.38, 0.06, 0.38, PAINT.rubber);
    const boom = x1 - x0 + 0.1;
    for (let k = 0; k < 2; k++) solid.box(x1 + 0.2 - (boom / 2) * (k + 0.5), by, bz, boom / 2, 0.09, 0.07, PAINT.redWhite);
    solid.box(x0 + 0.35, 0.45, bz, 0.1, 0.9, 0.1, PAINT.paintYellow);
    // the card reader on a post beside the housing (its screen faces the aisle)
    const reader = { x: x1 + 1.1, z: bz + 0.25 };
    solid.box(reader.x, 0.55, reader.z, 0.1, 1.1, 0.1, PAINT.steel);
    solid.box(reader.x, 1.18, reader.z, 0.32, 0.42, 0.26, PAINT.steel);
    lit.wall(reader.x, 1.22, reader.z + 0.134, 1, 0, 0.1, 0.07, LIT.window);
    ctx.glows.add(reader.x, 1.22, reader.z + 0.2, 0.25, 0x9fd0ff);
    // signs at the mouth on one post beside the upstand (inside the ramp's collider): the lit AUSFAHRT box, the speed limit below it
    const post = { x: x1 + 0.4, z: z1 - 0.4 };
    steel.push(piece(0.08, 2.9, 0.08, post.x, 1.45, post.z));
    solid.box(post.x, 2.62, post.z + 0.05, 0.92, 0.26, 0.08, PAINT.steel);
    lit.wall(post.x, 2.62, post.z + 0.092, 1, 0, 0.44, 0.11, LIT.exitBox);
    lit.wall(post.x, 2.0, post.z + 0.05, 1, 0, 0.3, 0.3, LIT.limit);
    ctx.glows.add(post.x, 2.62, post.z + 0.3, 1.3, 0x3ef08a);
    // a tag on the upstand
    solid.wall(x1 + 0.008, 0.75, (z0 + z1) / 2 - 3, 0, -1, 1.2, 0.3, PAINT.tags[0]);
    // two lamps on the upstand lighting the lane
    for (const z of [z0 + 6, z1 - 6]) {
        steel.push(piece(0.3, 0.08, 0.12, x1 - 0.4, 0.6, z));
        lit.quad({ x: x1 - 0.4, y: 0.555, z }, { x: 0.13, y: 0, z: 0 }, { x: 0, y: 0, z: 0.05 }, Batch.rect(LIT.lamp));
        ctx.glows.add(x1 - 0.45, 0.5, z, 0.7, 0xfff2dc);
    }
    return reader;
}

/** The "P7" sign of the car park: a backlit cabinet on two steel posts fixed to the south facade, rising above the parapet. */
function buildBigSign(ctx, { steel, painted }, lit, halfZ) {
    const x = -20;
    const z = -halfZ - 1.4;
    const size = 7.5;
    const y = 8.6;
    painted.push(metricUVs(box(size + 0.3, size + 0.3, 0.6, x, y, z - 0.3)));
    lit.wall(x, y, z + 0.012, 1, 0, size / 2, size / 2, LIT.sign);
    for (const dx of [-2.6, 2.6]) {
        steel.push(piece(0.32, 12, 0.32, x + dx, 0.05, z - 0.4));
        steel.push(piece(0.2, 0.2, 1.0, x + dx, 0.4, -halfZ - 0.9));
        steel.push(piece(0.2, 0.2, 1.0, x + dx, -3.2, -halfZ - 0.9));
    }
    ctx.glows.add(x, y, z + 0.6, 12, 0x29e7ff);
    ctx.glows.add(x - 1.8, y + 1.2, z + 0.4, 5, 0x2a6cff);
    // the sign throws a little cyan light onto the deck at the start
    ctx.lights.add({ x, y: y - 2, z: z + 1.2, ...LIGHT_PRESETS.neon, color: 0x5ad8ff, intensity: 140, distance: 24, dir: { x: 0, y: -0.55, z: 1 }, priority: 0.9 });
}

/**
 * The open facade of the car park below the roof: slab edges and spandrels per level, concrete fins every 8 m, the lit levels seen through
 * the openings (an inner skin with the lit atlas), shop fronts at street level.
 */
function buildCarPark({ concrete }, lit, { halfX, halfZ, drop, ramp }) {
    const ox = halfX + 0.25;
    const oz = halfZ + 0.25;
    // the roof slab edge (fascia) under the parapet
    for (const s of [-1, 1]) {
        concrete.push(piece(ox * 2 + 0.5, 0.6, 0.3, 0, -0.3, s * (oz + 0.1)));
        concrete.push(piece(0.3, 0.6, oz * 2 + 0.5, s * (ox + 0.1), -0.3, 0));
    }
    // slab edge + a 1 m spandrel per level, a plinth band at street level
    const h = SLAB + 1.0;
    for (const y of [...LEVEL_Y.map(l => l - SLAB + h / 2), -drop + 0.4]) {
        const hh = y < -drop + 1 ? 0.8 : h;
        for (const s of [-1, 1]) {
            concrete.push(piece(ox * 2 + 0.5, hh, 0.3, 0, y, s * (oz + 0.1)));
            concrete.push(piece(0.3, hh, oz * 2 + 0.5, s * (ox + 0.1), y, 0));
        }
    }
    // fins every 8 m from the street to the roof
    const finHeight = drop - 0.6;
    for (let a = -ox; a <= ox + 0.01; a += 8) {
        for (const s of [-1, 1]) concrete.push(piece(0.45, finHeight, 0.5, a, -drop + finHeight / 2, s * (oz + 0.2)));
    }
    for (let a = -oz; a <= oz + 0.01; a += 8) {
        for (const s of [-1, 1]) concrete.push(piece(0.5, finHeight, 0.45, s * (ox + 0.2), -drop + finHeight / 2, a));
    }
    // the lit levels behind the openings: an inner skin 1 m behind the facade, facing out
    const ix = halfX - 1.0;
    const iz = halfZ - 1.0;
    const levelHeight = 3.5 - SLAB;
    for (const y of LEVEL_Y) {
        const cy = y + levelHeight / 2;
        for (let a = -ix; a < ix - 0.01; a += 16) {
            const len = Math.min(16, ix - a);
            const u0 = (Math.abs(a * 13 + y * 7) % 7) / 10;
            lit.wall(a + len / 2, cy, -iz, -1, 0, len / 2, levelHeight / 2, LIT.levels, { u0, u1: u0 + 0.3 });
            lit.wall(a + len / 2, cy, iz, 1, 0, len / 2, levelHeight / 2, LIT.levels, { u0: 0.7 - u0, u1: 1 - u0 });
        }
        for (let a = -iz; a < iz - 0.01; a += 16) {
            const len = Math.min(16, iz - a);
            const u0 = (Math.abs(a * 11 + y * 5) % 7) / 10;
            // the top level's west skin would stand in the ramp's room
            if (!(y > -4 && a < ramp.z1 && a + len > ramp.z0 - 12)) lit.wall(-ix, cy, a + len / 2, 0, 1, len / 2, levelHeight / 2, LIT.levels, { u0, u1: u0 + 0.3 });
            lit.wall(ix, cy, a + len / 2, 0, -1, len / 2, levelHeight / 2, LIT.levels, { u0: 0.7 - u0, u1: 1 - u0 });
        }
    }
    // the ground floor all round: shop fronts (the car park's own shops, the entrance) – contiguous, so the building is not hollow below
    const gy = -drop + 0.8 + 1.9;
    const shopRow = (from, to, place) => {
        for (let a = from; a < to - 0.01; a += 12) {
            const len = Math.min(12, to - a);
            const u0 = (Math.abs(Math.round(a)) % 5) / 10;
            place(a + len / 2, len / 2, u0);
        }
    };
    shopRow(-ox, ox, (a, half, u0) => {
        lit.wall(a, gy, -oz - 0.36, -1, 0, half, 1.9, LIT.shops, { u0, u1: u0 + 0.5 });
        lit.wall(a, gy, oz + 0.36, 1, 0, half, 1.9, LIT.shops, { u0: 0.5 - u0, u1: 1 - u0 });
    });
    shopRow(-oz, oz, (a, half, u0) => {
        lit.wall(-ox - 0.36, gy, a, 0, 1, half, 1.9, LIT.shops, { u0, u1: u0 + 0.5 });
        lit.wall(ox + 0.36, gy, a, 0, -1, half, 1.9, LIT.shops, { u0: 0.5 - u0, u1: 1 - u0 });
    });
}
