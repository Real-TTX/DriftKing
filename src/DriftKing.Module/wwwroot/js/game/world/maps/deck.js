// DriftKing · maps/deck.js – "Parkdeck 7": the open roof of a multi-storey car park above the city at night. A coated concrete deck with
// worn bay lines, numbers, arrows, hatching, joints, drains, oil and the rubber of many drift nights; parapets with a galvanised railing;
// LED light poles on hazard-striped plinths; two stair towers and the lift tower with lit glazing, exit signs and wall lamps; the ramp down
// to level 6 behind a boom barrier; parked cars in the bays; the course marked by cones. The city lies 26 m below (deck-city.js).
// The parts live in deck-atlas.js (paint and lit atlases), deck-surface.js (the floor), deck-structures.js (what stands), deck-city.js.
// Colliders: the four parapet walls, the light poles, the towers and the parked cars exactly as ever; new are the ramp enclosure with its
// barrier, the ticket machine beside it and the cars in the side rows.

import { buildCones, buildStartLine, coneSpots } from '../road.js';
import { buildLamps, buildParkedCars } from '../props.js';
import { LIGHT_PRESETS } from '../../render/lights.js';
import { rng } from '../../render/kit.js';
import { Batch, litAtlas, paintAtlas } from './deck-atlas.js';
import { atlasMaterials, bayLayout, buildDeckSurface } from './deck-surface.js';
import { buildStructures } from './deck-structures.js';
import { buildCity } from './deck-city.js';

const HALF_X = 80;
const HALF_Z = 56;
const DROP = 26;
/** The ramp's opening along the west parapet (the lane goes down towards z0), its mouth with the barrier at z1. */
const RAMP = { x0: -80, x1: -73.5, z0: 6, z1: 30 };
/** Stair towers in two corners and the lift tower: footprint (the collider), height, the direction their front (door) faces. */
const TOWERS = [
    { x: -72, z: -48, w: 10, d: 8, h: 4.2, nx: 0, nz: 1, kind: 'stairs' },
    { x: 72, z: 49, w: 10, d: 8, h: 4.2, nx: 0, nz: -1, kind: 'stairs' },
    { x: 70, z: -50, w: 7, d: 7, h: 7.5, nx: -1, nz: 0, kind: 'lift' },
];

export function build(ctx) {
    const { root, course, colliders, glows, pools, random, materials, quality } = ctx;
    const clear = course.width / 2 + 2.5;
    const free = (x, z, r = 0) => course.distanceTo(x, z) > clear + r;

    // the parapet's inner faces are the walls of the arena
    colliders.addSegment(-HALF_X, -HALF_Z, HALF_X, -HALF_Z);
    colliders.addSegment(HALF_X, -HALF_Z, HALF_X, HALF_Z);
    colliders.addSegment(HALF_X, HALF_Z, -HALF_X, HALF_Z);
    colliders.addSegment(-HALF_X, HALF_Z, -HALF_X, -HALF_Z);

    buildCones(root, coneSpots(course, 0.5), { materials });
    buildStartLine(root, course, glows, { gantry: false, materials });

    // LED light poles on a grid where the course leaves room: two heads each, one real light per pole
    const lamps = [];
    const poles = [];
    for (let x = -66; x <= 66; x += 22) {
        for (let z = -44; z <= 44; z += 22) {
            if (!free(x, z, 1)) continue;
            lamps.push({ x, y: 0, z, yaw: 0 }, { x, y: 0, z, yaw: Math.PI });
            poles.push({ x, z });
            colliders.addCircle(x, z, 0.3);
        }
    }
    buildLamps(root, lamps, glows, pools, { colour: 0xe4f0ff, height: 7, arm: 1.2, pool: 10, strength: 0.2, materials, preset: 'led' });
    // one real light per pole: deck luminaires throw wide (the pools of neighbouring poles meet), so a wider cone than a street lamp's
    for (const p of poles) ctx.lights.add({ ...LIGHT_PRESETS.led, x: p.x, y: 7.1, z: p.z, intensity: 460, distance: 30, angle: 1.22, penumbra: 0.8 });

    // the towers (colliders as ever)
    const towers = [];
    for (const t of TOWERS) {
        if (!free(t.x, t.z, Math.max(t.w, t.d) / 2)) continue;
        colliders.addBox(t.x, t.z, t.w / 2, t.d / 2);
        towers.push(t);
    }

    // parked cars in the bays along the north and south parapets (the map's random sequence, as ever)
    const parked = [];
    for (let x = -62; x <= 62; x += 2.8) {
        for (const z of [-HALF_Z + 4, HALF_Z - 4]) {
            if (random() < 0.45 || !free(x, z, 2.5)) continue;
            parked.push({ x, y: 0, z, yaw: random() < 0.5 ? 0 : Math.PI });
            colliders.addBox(x, z, 0.95, 2.15);
        }
    }

    // where the bays are: not in a tower, the ramp or around a pole
    const blocked = (minX, minZ, maxX, maxZ) => {
        for (const t of towers) {
            if (maxX > t.x - t.w / 2 - 0.3 && minX < t.x + t.w / 2 + 0.3 && maxZ > t.z - t.d / 2 - 0.3 && minZ < t.z + t.d / 2 + 0.3) return true;
        }
        if (maxX > RAMP.x0 && minX < RAMP.x1 + 1.5 && maxZ > RAMP.z0 - 0.5 && minZ < RAMP.z1 + 2) return true;
        return poles.some(p => p.x > minX - 0.4 && p.x < maxX + 0.4 && p.z > minZ - 0.4 && p.z < maxZ + 0.4);
    };
    const bays = bayLayout({ halfX: HALF_X, halfZ: HALF_Z, blocked });

    // a few more cars in the side rows (their own colliders; a separate random so the cars above stay where they were)
    const sideRandom = rng(7070);
    for (const bay of bays) {
        if (bay.fx === 0 || sideRandom() < 0.55 || !free(bay.x, bay.z, 3)) continue;
        parked.push({ x: bay.x, y: 0, z: bay.z, yaw: bay.fx > 0 ? Math.PI / 2 : -Math.PI / 2 });
        colliders.addBox(bay.x, bay.z, 2.15, 0.95);
    }
    buildParkedCars(root, parked, random, { materials });

    // the atlases and their batches
    const paintTexture = paintAtlas(quality);
    const atlas = atlasMaterials(quality, paintTexture, ctx.envMap);
    const solid = new Batch();
    const lit = new Batch();

    const { doors, reader } = buildStructures(ctx, { halfX: HALF_X, halfZ: HALF_Z, drop: DROP, towers, ramp: RAMP, poles, solid, lit });
    // the ramp enclosure with the barrier across its mouth, the ticket machine beside it
    colliders.addBox((RAMP.x0 - 0.2 + RAMP.x1 + 0.65) / 2, (RAMP.z0 - 0.2 + RAMP.z1 + 0.6) / 2, (RAMP.x1 + 0.85 - RAMP.x0) / 2, (RAMP.z1 + 0.8 - RAMP.z0) / 2);
    colliders.addCircle(reader.x, reader.z, 0.35);

    buildDeckSurface(ctx, { halfX: HALF_X, halfZ: HALF_Z, bays, free, ramp: RAMP, doors, materials: atlas, solid });
    const city = buildCity(ctx, { halfX: HALF_X, halfZ: HALF_Z, drop: DROP, lit });

    // the painted solids (hazard stripes, wheel stops, bumps, barrier) and everything lit
    const solidMesh = solid.mesh(atlas.solid);
    if (solidMesh) root.add(solidMesh);
    const litMesh = lit.mesh(materials.emissive(0xffffff, 4, { map: litAtlas(quality) }));
    if (litMesh) root.add(litMesh);
    return { flatY: 0, update: city.update };
}
