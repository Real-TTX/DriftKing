// DriftKing · maps/city-rail.js – the elevated railway of the Neon-Viertel: a concrete viaduct on single piers that crosses the south and the
// north straight, with noise barriers, ballast and rails, catenary masts and wires, tube lights under the deck where the street passes below,
// and two commuter trains with lit windows that cross the district now and then (one each way). The piers stand clear of the road.

import * as THREE from 'three';
import { Batch, Frame } from './city-kit.js';
import { LIGHT_PRESETS } from '../../render/lights.js';

/** Where the line runs (along z) and how wide its corridor is (buildings keep out). */
export const RAIL = Object.freeze({ x: -140, half: 9, from: -700, to: 700 });

const DECK = 7.6;
const GIRDER = 1.4;
const TRACKS = [-2.2, 2.2];
const SPEED = 15;
const CYCLE = 1600;

/**
 * Builds the viaduct (into the facade and props batches) and the trains (their own moving meshes).
 * @returns {{ update(dt: number): void }}
 */
export function buildRail(ctx, { facades, props, emissive, wires, roads, propsMaterial, emissiveMaterial }) {
    const frame = new Frame(RAIL.x, 0, 0);
    const concrete = 0xa8a49c;
    const top = DECK + GIRDER;
    const clearOf = z => roads.every(r => Math.abs(z - r) > 15);
    for (let z = RAIL.from + 20; z <= RAIL.to - 20; z += 32) {
        if (!clearOf(z)) continue;
        facades.block('concrete', frame, 2.0, DECK - 1.55, 1.6, 0, 0, z, concrete, { top: false });
        facades.block('concrete', frame, 9.4, 1.0, 1.9, 0, DECK - 1.55, z, concrete, { bottom: true, top: false });
        frame.cylinder(props, 0.1, 0.1, DECK - 1.55, 1.15, 0, z + 0.6, 0x5a5c60, { rough: 0.5, metal: 0.3, open: true }, 6);
    }
    for (let z = RAIL.from; z < RAIL.to; z += 100) {
        const zc = z + 50;
        facades.block('concrete', frame, 10, GIRDER, 100, 0, DECK, zc, 0x9a968e, { bottom: true });
        for (const side of [-1, 1]) facades.block('concrete', frame, 0.25, 1.3, 100, side * 4.88, top, zc, 0xb4b0a8, { top: true });
        frame.box(props, 9.5, 0.24, 100, 0, top + 0.12, zc, 0x3c3a38, { rough: 0.95, metal: 0 });
        // the girders under the deck slab and a drain pipe along one side
        for (const x of [-3.4, 0, 3.4]) frame.box(props, 0.7, 0.55, 100, x, DECK - 0.27, zc, 0x8a867e, { rough: 0.9, metal: 0 });
        frame.box(props, 0.2, 0.2, 100, 4.6, DECK + 0.3, zc, 0x5a5c60, { rough: 0.5, metal: 0.3 });
        for (const track of TRACKS) {
            for (const gauge of [-0.535, 0.535]) frame.box(props, 0.07, 0.14, 100, track + gauge, top + 0.31, zc, 0x6a6460, { rough: 0.35, metal: 0.9 });
        }
    }
    // catenary masts (H frames) and the contact wires
    let last = null;
    for (let z = RAIL.from + 10; z <= RAIL.to - 10; z += 45) {
        for (const side of [-1, 1]) frame.box(props, 0.22, 6.0, 0.22, side * 4.55, top + 3.0, z, 0x5a5e62, { rough: 0.5, metal: 0.7 });
        frame.box(props, 9.3, 0.3, 0.22, 0, top + 5.6, z, 0x5a5e62, { rough: 0.5, metal: 0.7 });
        if (last !== null) {
            for (const track of TRACKS) {
                wires.push(RAIL.x + track, top + 5.0, last, RAIL.x + track, top + 5.0, z);
                wires.push(RAIL.x + track, top + 5.45, last, RAIL.x + track, top + 5.2, (last + z) / 2);
                wires.push(RAIL.x + track, top + 5.2, (last + z) / 2, RAIL.x + track, top + 5.45, z);
            }
        }
        last = z;
    }
    // tube lights under the deck where the street runs below
    for (const road of roads) {
        for (const dz of [-4.5, 4.5]) {
            for (const dx of [-2.5, 2.5]) emissive.box(1.3, 0.05, 0.12, RAIL.x + dx, DECK - 0.04, road + dz, 0, 0xe8f2ff, { gain: 9 });
        }
        ctx.lights.add({ ...LIGHT_PRESETS.tube, x: RAIL.x, y: DECK - 0.3, z: road, intensity: 110, distance: 16, priority: 0.9 });
        ctx.glows.add(RAIL.x, DECK - 0.2, road, 3, 0xe8f2ff);
    }
    // the trains
    const trains = [];
    const cars = ctx.quality === 'low' ? 4 : 6;
    for (const [k, track] of TRACKS.entries()) {
        const { body, glow, length } = trainMeshes(cars, k === 0 ? 0x1fa35a : 0xe8701a, propsMaterial, emissiveMaterial);
        const group = new THREE.Group();
        group.add(body, glow);
        group.position.set(RAIL.x + track, top + 0.38, 0);
        group.rotation.y = k === 0 ? 0 : Math.PI;
        group.name = 'train';
        ctx.root.add(group);
        trains.push({ group, length, dir: k === 0 ? 1 : -1, offset: k * 730 });
    }
    let time = 0;
    return {
        update(dt) {
            time += dt;
            for (const t of trains) {
                const run = (time * SPEED + t.offset) % CYCLE;
                // the head runs from one end of the line to the other; outside the line the train is hidden
                const head = RAIL.from - 60 + run;
                const tail = head - t.length;
                t.group.visible = tail < RAIL.to - 10 && head > RAIL.from + 10;
                t.group.position.z = t.dir > 0 ? tail : -tail;
            }
        },
    };
}

/** One train: cars along local +z from 0 to length (the head at +z), silver bodies with a coloured line and lit windows. */
function trainMeshes(cars, line, propsMaterial, emissiveMaterial) {
    const body = new Batch();
    const glow = new Batch({ emissive: true });
    const metal = { rough: 0.32, metal: 0.75 };
    const pitch = 20.6;
    for (let c = 0; c < cars; c++) {
        const z0 = c * pitch;
        const zc = z0 + 10;
        body.box(2.9, 3.2, 20, 0, 0.55 + 1.6, zc, 0, 0xb8bcc2, metal);
        body.box(2.6, 0.26, 19.4, 0, 3.88, zc, 0, 0x7a7e84, metal);
        body.box(2.94, 0.24, 20.02, 0, 1.35, zc, 0, line, { rough: 0.4, metal: 0.2 });
        for (const z of [z0 + 3.2, z0 + 16.8]) body.box(2.3, 0.75, 2.8, 0, 0.42, z, 0, 0x1c1c1e, { rough: 0.7, metal: 0.4 });
        if (c < cars - 1) body.box(2.3, 2.7, 0.7, 0, 2.0, z0 + 20.3, 0, 0x222224, { rough: 0.8, metal: 0 });
        for (let i = 0; i < 8; i++) {
            const z = z0 + 1.5 + i * 2.43;
            // doors (dark) between the windows on every other bay, windows lit from the inside
            if (i % 2 === 1) {
                for (const side of [-1, 1]) body.box(0.03, 2.1, 1.3, side * 1.46, 1.9, z + 0.6, 0, 0x3a3c40, metal);
                continue;
            }
            for (const side of [-1, 1]) glow.box(0.03, 0.95, 1.45, side * 1.465, 2.45, z + 0.6, 0, 0xfff0d8, { gain: 1.9 });
        }
    }
    const length = cars * pitch - 0.6;
    // the cab: a dark windscreen, headlights at the head, tail lights at the end
    body.box(2.7, 1.1, 0.05, 0, 2.6, length + 0.01, 0, 0x101014, { rough: 0.1, metal: 0 });
    for (const x of [-0.95, 0.95]) {
        glow.box(0.28, 0.16, 0.05, x, 1.3, length + 0.03, 0, 0xfff6e8, { gain: 16 });
        glow.box(0.22, 0.14, 0.05, x, 1.3, -0.03, 0, 0xff2010, { gain: 5 });
    }
    return { body: body.build(propsMaterial), glow: glow.build(emissiveMaterial), length };
}
