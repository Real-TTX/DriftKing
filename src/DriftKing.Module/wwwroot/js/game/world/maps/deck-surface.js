// DriftKing · maps/deck-surface.js – the floor of "Parkdeck 7": the coated concrete slab (PBR floor with wet patches) and everything on it –
// worn bay lines with bay numbers, wheel stops, arrows and lettering, hatched no-parking areas, a zebra crossing, expansion joints, gullies
// and a linear drain, oil stains, the rubber the drift crowd left in every corner, donuts in the infield, the yellow guide line of the event.
// All of it is three meshes: the slab, the paint (one transparent atlas mesh) and the glossy spills. Nothing here is solid (flat paint, and
// the 10 cm wheel stops sit at the back of the bays).

import * as THREE from 'three';
import { metricUVs, rng } from '../../render/kit.js';
import { Batch, PAINT } from './deck-atlas.js';

/** Height of paint above the slab (plus polygon offset). */
const PAINT_Y = 0.012;

/**
 * The three materials of the paint atlas: transparent paint, glossy spills (oil), opaque painted solids (hazard stripes, wheel stops, bumps).
 * Low gets Lambert (spills = paint). envMap: the scene's reflection map – the spills carry it themselves, so their own (low) intensity
 * counts: the map is a generic street, and a puddle mirroring one of its neon panels at full strength glows like a lamp.
 */
export function atlasMaterials(quality, texture, envMap = null) {
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    if (quality === 'low') {
        const paint = new THREE.MeshLambertMaterial({ map: texture, transparent: true, depthWrite: false, ...offset });
        return { paint, spill: paint, solid: new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 }) };
    }
    return {
        paint: new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.62, metalness: 0, ...offset }),
        spill: new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0, envMap, envMapIntensity: 0.12, ...offset }),
        solid: new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.5, roughness: 0.66, metalness: 0 }),
    };
}

/**
 * The bays of the deck: rows along the parapets and a double row in the infield, minus what towers, the ramp and the course occupy.
 * @returns {{ x, z, fx, fz, number }[]} bay centres, the direction a car drives into the bay (towards its back), the painted number
 */
export function bayLayout({ halfX, halfZ, blocked }) {
    const bays = [];
    let number = 701;
    // every row counts from 01 again (the row is on the signs; the deck number 7 is the first digit)
    const row = () => {
        number = 701;
    };
    // blocked(minX, minZ, maxX, maxZ): true where a tower, the ramp or a pole stands in the bay
    const push = (x, z, fx, fz) => {
        const hx = fx !== 0 ? 2.5 : 1.4;
        const hz = fx !== 0 ? 1.4 : 2.5;
        if (blocked(x - hx, z - hz, x + hx, z + hz)) return;
        bays.push({ x, z, fx, fz, number: number++ });
    };
    for (let x = -76; x <= 76.01; x += 2.8) push(x, -halfZ + 4, 0, -1);
    row();
    for (let z = -46; z <= 46.01; z += 2.8) push(halfX - 4, z, 1, 0);
    row();
    for (let x = 76; x >= -76.01; x -= 2.8) push(x, halfZ - 4, 0, 1);
    row();
    for (let z = 46; z >= -46.01; z -= 2.8) push(-halfX + 4, z, -1, 0);
    row();
    // the infield double row (the light poles stand in its median)
    for (let x = -14; x <= 46.01; x += 2.8) {
        push(x, -2.5, 0, 1);
        push(x, 2.5, 0, -1);
    }
    return bays;
}

/**
 * Builds the slab and everything painted, spilled or rubbed onto it.
 * @param {object} ctx the map context
 * @param {{ halfX, halfZ, bays, free, ramp, doors, materials, solid: Batch }} layout doors: [{ x, z, nx, nz }] in front of the tower doors;
 *        materials: the atlas materials; solid: the batch of painted solids (wheel stops, bumps, the ramp edge)
 */
export function buildDeckSurface(ctx, layout) {
    const { root, course, materials } = ctx;
    const { halfX, halfZ, bays, free, ramp, doors, solid } = layout;
    const atlas = layout.materials;

    // the slab with the ramp's opening: power-floated concrete with the macro layer's wet patches (they only form on the flat deck);
    // the shape is drawn in (x, −z) and laid down
    const outline = new THREE.Shape([
        new THREE.Vector2(-halfX, -halfZ), new THREE.Vector2(halfX, -halfZ), new THREE.Vector2(halfX, halfZ), new THREE.Vector2(-halfX, halfZ),
    ]);
    outline.holes.push(new THREE.Path([
        new THREE.Vector2(ramp.x0, -ramp.z1), new THREE.Vector2(ramp.x0, -ramp.z0 - 0.25), new THREE.Vector2(ramp.x1 - 0.25, -ramp.z0 - 0.25),
        new THREE.Vector2(ramp.x1 - 0.25, -ramp.z1),
    ]));
    const slab = new THREE.Mesh(metricUVs(new THREE.ShapeGeometry(outline).rotateX(-Math.PI / 2)), materials.concrete({ color: 0xaaa498, seams: false, stains: false }));
    slab.receiveShadow = true;
    root.add(slab);

    const paint = new Batch();
    const spill = ctx.quality === 'low' ? paint : new Batch();
    const random = rng(1907);

    paintBays(paint, solid, bays, random, free);
    paintJoints(paint, halfX, halfZ, random);
    paintDrains(paint, spill, { halfX, halfZ, random, ramp });
    paintGuideLine(paint, course, random);
    paintTyreMarks(paint, course, random, free, ctx.quality === 'low' ? 3 : 1.5);
    paintOil(spill, bays, course, random);
    paintAisles(paint, solid, { halfX, halfZ, free, ramp, doors, random });

    const paintMesh = paint.mesh(atlas.paint);
    paintMesh.renderOrder = 1;
    root.add(paintMesh);
    if (spill !== paint) {
        const spillMesh = spill.mesh(atlas.spill);
        if (spillMesh) {
            spillMesh.renderOrder = 1;
            root.add(spillMesh);
        }
    }
}

/** Bay lines (5 m, worn), the bay numbers at the back, wheel stops in the rows along the parapets. */
function paintBays(paint, solid, bays, random, free) {
    const lines = new Set();
    for (const bay of bays) {
        // the side axis of the bay (across the driving direction)
        const sx = -bay.fz;
        const sz = bay.fx;
        for (const side of [-1, 1]) {
            const lx = bay.x + sx * 1.4 * side;
            const lz = bay.z + sz * 1.4 * side;
            const key = `${Math.round(lx * 10)}:${Math.round(lz * 10)}`;
            if (lines.has(key)) continue;
            lines.add(key);
            const u0 = random() * 0.6;
            paint.floor(lx, PAINT_Y, lz, bay.fx, bay.fz, 2.5, 0.065, PAINT.lineWhite, { u0, u1: u0 + 0.3 });
        }
        // the number at the back of the bay, read by the driver who comes in
        const digits = String(bay.number).split('').map(Number);
        const bx = bay.x + bay.fx * 1.55;
        const bz = bay.z + bay.fz * 1.55;
        digits.forEach((d, k) => {
            const off = (k - 1) * 0.3;
            paint.lettering(bx + sx * off, PAINT_Y, bz + sz * off, bay.fx, bay.fz, 0.14, 0.32, PAINT.digit(d));
        });
        // a wheel stop at the back of bays well away from the course
        if (free(bay.x + bay.fx * 1.9, bay.z + bay.fz * 1.9, 3)) {
            const wx = bay.x + bay.fx * 2.0;
            const wz = bay.z + bay.fz * 2.0;
            const along = bay.fx !== 0;
            solid.box(wx, 0.05, wz, along ? 0.16 : 1.5, 0.1, along ? 1.5 : 0.16, PAINT.paintYellow);
        }
    }
}

/** Expansion joints between the deck sections (aluminium profiles with a rubber insert) and thin sawn joints between the panels. */
function paintJoints(paint, halfX, halfZ, random) {
    for (const x of [-27, 27]) {
        for (let z = -halfZ; z < halfZ - 0.1; z += 8) {
            const u0 = random() * 0.5;
            paint.floor(x, PAINT_Y, z + 4, 0, 1, 4, 0.09, PAINT.joint, { u0, u1: u0 + 0.5 });
        }
    }
    for (let x = -halfX; x < halfX - 0.1; x += 8) {
        const u0 = random() * 0.5;
        paint.floor(x + 4, PAINT_Y, 0, 1, 0, 4, 0.09, PAINT.joint, { u0, u1: u0 + 0.5 });
    }
    // sawn joints: 7.5 × 7 m panels, a thin dark line (only the rubber band of the joint cell)
    for (let x = -halfX + 7.5; x < halfX; x += 7.5) {
        if (Math.abs(Math.abs(x) - 27) < 1) continue;
        paint.floor(x, PAINT_Y, 0, 0, 1, halfZ, 0.016, PAINT.joint, { v0: 0.4, v1: 0.6 });
    }
    for (let z = -halfZ + 7; z < halfZ; z += 7) {
        if (Math.abs(z) < 1) continue;
        paint.floor(0, PAINT_Y, z, 1, 0, halfX, 0.016, PAINT.joint, { v0: 0.4, v1: 0.6 });
    }
}

/** Gullies at the low points of each section with the water standing round them, a linear drain along the parapets, puddles. */
function paintDrains(paint, spill, { halfX, halfZ, random, ramp }) {
    for (const x of [-54, 0, 54]) {
        for (const z of [-28, 28]) {
            paint.floor(x, PAINT_Y + 0.001, z, 1, 0, 0.3, 0.3, PAINT.gully);
            const r = 1.2 + random() * 1.4;
            const a = random() * 6.28;
            spill.floor(x + (random() - 0.5), PAINT_Y, z + (random() - 0.5), Math.cos(a), Math.sin(a), r * 1.3, r, PAINT.puddle);
        }
    }
    // water along the foot of the parapets and in a few dips of the deck
    for (let k = 0; k < 26; k++) {
        const side = random() < 0.5 ? -1 : 1;
        const along = (random() - 0.5) * 2;
        const r = 0.7 + random() * 1.2;
        if (random() < 0.5) spill.floor(along * (halfX - 6), PAINT_Y, side * (halfZ - 0.5 - r * 0.5), 1, 0, r * 2.2, r * 0.7, PAINT.puddle);
        else spill.floor(side * (halfX - 0.5 - r * 0.5), PAINT_Y, along * (halfZ - 6), 0, 1, r * 2.2, r * 0.7, PAINT.puddle);
    }
    for (let k = 0; k < 14; k++) {
        const x = (random() - 0.5) * (halfX * 2 - 10);
        const z = (random() - 0.5) * (halfZ * 2 - 10);
        const r = 0.6 + random() * 1.3;
        const a = random() * 6.28;
        spill.floor(x, PAINT_Y, z, Math.cos(a), Math.sin(a), r * 1.5, r, PAINT.puddle);
    }
    // linear drains at the foot of the parapets
    for (let x = -halfX + 2; x < halfX - 2; x += 3.2) {
        paint.floor(x + 1.6, PAINT_Y, -halfZ + 0.25, 1, 0, 1.6, 0.1, PAINT.grate);
        paint.floor(x + 1.6, PAINT_Y, halfZ - 0.25, 1, 0, 1.6, 0.1, PAINT.grate);
    }
    for (let z = -halfZ + 2; z < halfZ - 2; z += 3.2) {
        if (z + 1.6 > ramp.z0 - 1 && z + 1.6 < ramp.z1 + 1) continue;
        paint.floor(-halfX + 0.25, PAINT_Y, z + 1.6, 0, 1, 1.6, 0.1, PAINT.grate);
        paint.floor(halfX - 0.25, PAINT_Y, z + 1.6, 0, 1, 1.6, 0.1, PAINT.grate);
    }
    // damp dirt where the water runs off
    for (let k = 0; k < 40; k++) {
        const side = random() < 0.5 ? -1 : 1;
        const along = (random() - 0.5) * 2;
        const r = 0.8 + random() * 1.6;
        if (random() < 0.5) paint.floor(along * (halfX - 4), PAINT_Y, side * (halfZ - 0.6 - r * 0.4), 1, 0, r * 1.6, r * 0.6, PAINT.stain);
        else paint.floor(side * (halfX - 0.6 - r * 0.4), PAINT_Y, along * (halfZ - 4), 0, 1, r * 1.6, r * 0.6, PAINT.stain);
    }
}

/** The event's yellow guide line along the centre of the course: 2 m dashes, 2 m gaps, worn. */
function paintGuideLine(paint, course, random) {
    for (let s = 0; s < course.length - 2; s += 4) {
        const points = [];
        for (const d of [0, 1, 2]) {
            const p = course.at(s + d);
            points.push({ x: p.x, z: p.z });
        }
        const u0 = random() * 0.85;
        paint.strip(points, PAINT_Y, 0.06, PAINT.lineYellow, { u0, u1: u0 + 0.12 });
    }
}

/** Drift marks: in every corner a few pairs of black arcs swinging out from the line; a couple of braking marks; donuts in the infield. */
function paintTyreMarks(paint, course, random, free, step) {
    const corners = [];
    let start = -1;
    for (let i = 0; i <= course.count; i++) {
        const k = i < course.count ? course.k[i] : 0;
        const bent = Math.abs(k) > 1 / 30;
        if (bent && start < 0) start = i;
        if (!bent && start >= 0) {
            corners.push({ from: start * course.step, to: i * course.step, sign: Math.sign(course.k[start]) });
            start = -1;
        }
    }
    for (const corner of corners) {
        const pairs = 3 + Math.floor(random() * 3);
        for (let n = 0; n < pairs; n++) {
            const s0 = corner.from - 10 - random() * 10;
            const s1 = corner.to + 3 + random() * 10;
            // the rear swings out of the corner: lateral offset towards the outside, a little wave
            const out = -corner.sign;
            const base = (0.5 + random() * 2.6) * out;
            const swing = 0.4 + random() * 1.0;
            const phase = random() * 6;
            for (const wheel of [-0.75, 0.75]) {
                const points = [];
                for (let s = s0; s <= s1; s += step) {
                    const p = course.at(s);
                    const t = (s - s0) / (s1 - s0);
                    const lateral = base * Math.sin(Math.PI * t) + Math.sin(phase + s * 0.12) * swing * 0.3 + wheel;
                    points.push({ x: p.x + p.tz * lateral, z: p.z - p.tx * lateral, w: 0.7 + Math.sin(Math.PI * t) * 0.5 });
                }
                const u0 = random() * 0.3;
                paint.strip(points, PAINT_Y + 0.001, 0.13, PAINT.tyre, { u0, u1: u0 + 0.7 });
            }
        }
    }
    // braking marks before the corners
    for (const corner of corners) {
        if (random() < 0.4) continue;
        const s1 = corner.from - 2;
        const s0 = s1 - 14 - random() * 10;
        const lateral = (random() - 0.5) * 4;
        for (const wheel of [-0.78, 0.78]) {
            const points = [];
            for (let s = s0; s <= s1; s += step * 1.4) {
                const p = course.at(s);
                points.push({ x: p.x + p.tz * (lateral + wheel), z: p.z - p.tx * (lateral + wheel) });
            }
            paint.strip(points, PAINT_Y + 0.001, 0.11, PAINT.tyre, { u0: 0.2, u1: 0.8 });
        }
    }
    // donuts in the infield
    const spots = [[8, -24], [36, -12], [-10, -18], [18, -30], [42, -28]];
    for (const [x, z] of spots) {
        const r = 2.6 + random() * 1.4;
        if (!free(x, z, r)) continue;
        paint.floor(x, PAINT_Y + 0.002, z, Math.cos(random() * 6), 0, r, r, PAINT.donut);
    }
}

/** Oil in the bays (where the engines stand) and a few drops on the lanes. */
function paintOil(spill, bays, course, random) {
    for (const bay of bays) {
        if (random() < 0.45) continue;
        const r = 0.35 + random() * 0.5;
        const back = 0.6 + random() * 1.2;
        const a = random() * 6.28;
        spill.floor(bay.x + bay.fx * back + (random() - 0.5) * 0.6, PAINT_Y, bay.z + bay.fz * back + (random() - 0.5) * 0.6, Math.cos(a), Math.sin(a), r * 1.3, r, PAINT.oil[Math.floor(random() * 3)]);
    }
    for (let k = 0; k < 30; k++) {
        const p = course.at(random() * course.length);
        const lateral = (random() - 0.5) * course.width;
        const r = 0.3 + random() * 0.4;
        const a = random() * 6.28;
        spill.floor(p.x + p.tz * lateral, PAINT_Y, p.z - p.tx * lateral, Math.cos(a), Math.sin(a), r * 1.4, r, PAINT.oil[k % 3]);
    }
}

/**
 * The aisles: direction arrows where the course leaves room, AUSFAHRT/LANGSAM and an arrow before the ramp, the yellow edge at the ramp
 * mouth, hatched areas in front of the tower doors and beside the ramp, a zebra crossing from the lift, speed bumps.
 */
function paintAisles(paint, solid, { halfX, halfZ, free, ramp, doors, random }) {
    // aisle arrows: along the rows, pointing the way the deck is driven (anticlockwise)
    const arrows = [];
    for (let x = -60; x <= 60; x += 20) {
        arrows.push({ x, z: -halfZ + 9.5, fx: 1, fz: 0 });
        arrows.push({ x, z: halfZ - 9.5, fx: -1, fz: 0 });
    }
    for (let z = -36; z <= 36; z += 18) {
        arrows.push({ x: halfX - 9.5, z, fx: 0, fz: 1 });
        arrows.push({ x: -halfX + 9.5, z, fx: 0, fz: -1 });
    }
    for (const a of arrows) {
        if (!free(a.x, a.z, 1.5)) continue;
        paint.lettering(a.x, 0.013, a.z, a.fx, a.fz, 0.55, 1.6, random() < 0.75 ? PAINT.arrow : PAINT.turn);
    }
    // before the ramp: lettering and an arrow, read by a car heading into the ramp (towards −z)
    const mx = (ramp.x0 + ramp.x1) / 2;
    paint.lettering(mx, 0.013, ramp.z1 + 4.2, 0, -1, 1.6, 1.0, PAINT.exitWord);
    paint.lettering(mx, 0.013, ramp.z1 + 8.4, 0, -1, 1.5, 0.9, PAINT.slowWord);
    paint.lettering(mx, 0.013, ramp.z1 + 11.8, 0, -1, 0.55, 1.6, PAINT.arrow);
    // the yellow/black edge across the ramp mouth
    for (let x = ramp.x0 + 0.6; x < ramp.x1 - 0.1; x += 1.2) {
        const u0 = random() * 0.7;
        solid.floor(x, 0.008, ramp.z1 + 0.18, 1, 0, 0.6, 0.18, PAINT.hazard, { u0, u1: u0 + 0.208 });
    }
    // hatched areas beside the ramp mouth and in front of the tower doors
    paint.floor(ramp.x1 + 1.6, 0.013, ramp.z1 - 2.5, 0, 1, 2.5, 1.25, PAINT.hatchYellow);
    for (const door of doors) {
        paint.floor(door.x + door.nx * 2.2, 0.013, door.z + door.nz * 2.2, -door.nz, door.nx, 1.8, 1.6, PAINT.hatchWhite);
        if (door.zebra) {
            for (let k = 0; k < 2; k++) {
                const d = 5.2 + k * 2.4;
                paint.floor(door.x + door.nx * d, 0.013, door.z + door.nz * d, door.nx, door.nz, 1.2, 1.4, PAINT.zebra);
            }
        }
    }
    // speed bumps (5 cm rubber, black and yellow) across the aisle in front of the ramp
    const bumpZ = ramp.z1 + 15;
    if (free(mx + 3, bumpZ, 1)) {
        for (let x = ramp.x0 + 0.3, k = 0; x < ramp.x1 + 4.5; x += 0.5, k++) solid.box(x + 0.25, 0.025, bumpZ, 0.48, 0.05, 0.45, k % 2 ? PAINT.paintYellow : PAINT.rubber);
    }
}
