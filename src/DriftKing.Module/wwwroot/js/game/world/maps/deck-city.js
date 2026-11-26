// DriftKing · maps/deck-city.js – the city around "Parkdeck 7", 26 m below the roof: a street grid with sodium lamps and light pools,
// traffic (head and tail lights gliding along the streets), shops at street level, and blocks of buildings in three facade types – glass
// office towers, residential slabs, older brick offices – drawn from canvas facade atlases (windows at real size, lit by storey or by flat).
// From the deck you mostly see roofs at eye level, so the roofs are busy: parapets, lift rooms, plant, water tanks on legs, antennas with
// blinking red lights, lit crowns, and the big neon billboard on the roof across the north street. All seeded (rng), all batched per material.

import * as THREE from 'three';
import { canvasTexture, drawLast, GlowPoints, getGlowGain, mergeGeometries, metricUVs, rng, sharedTexture } from '../../render/kit.js';
import { Batch, LIT } from './deck-atlas.js';
import { rod } from './deck-structures.js';

/** Street centre lines (both axes): the car park's block in the middle, 120 m blocks around it. */
const STREETS_X = [-571.5, -451.5, -331.5, -211.5, -91.5, 91.5, 211.5, 331.5, 451.5, 571.5];
const STREETS_Z = [-547.5, -427.5, -307.5, -187.5, -67.5, 67.5, 187.5, 307.5, 427.5, 547.5];
const ROAD_HALF = 7;
const WALK = 4;

/** The three facade types: bay width and storey height in metres (one atlas tile = 32 storeys), roughness, how many windows are lit. */
const STYLES = {
    glass: { bay: 1.5, storey: 3.6, bays: 32, roughness: 0.32, reflect: 0.22, lit: 0.3, tint: 0xffffff, seed: 101 },
    flats: { bay: 3, storey: 3, bays: 16, roughness: 0.88, reflect: 0.5, lit: 0.3, tint: 0xffffff, seed: 202 },
    brick: { bay: 2, storey: 3.3, bays: 24, roughness: 0.9, reflect: 0.5, lit: 0.36, tint: 0xffffff, seed: 303 },
};

/** Per-building tints of each facade type (vertex colours multiply the albedo, not the lit windows): glass in several hues, rendered walls, brick and stone. */
const TINTS = {
    glass: [0xffffff, 0xd6e2ff, 0xd4f4e4, 0xffe6cc, 0xc4c6d0, 0xe8e8f0],
    flats: [0xffffff, 0xf2e4d0, 0xd6d8de, 0xffdcb8, 0xc4baae, 0xa8a49c, 0xe8d0c8],
    brick: [0xffffff, 0xd8ae9c, 0xb4a490, 0x9a9a9e, 0xe4cab0],
};

/**
 * Builds the city below and around the car park.
 * @param {object} ctx map context
 * @param {{ halfX, halfZ, drop, lit: Batch }} layout lit: the lit atlas batch (shops, billboard)
 * @returns {{ update(dt: number): void }}
 */
export function buildCity(ctx, { halfX, halfZ, drop, lit }) {
    const { root, materials, quality, detail, glows } = ctx;
    const ground = -drop;
    const facades = {};
    for (const [name, style] of Object.entries(STYLES)) {
        facades[name] = { style, batch: new Batch(), material: facadeMaterial(name, style, quality, ctx.envMap) };
    }
    const roofs = [];
    const plant = [];
    const crowns = [];
    const beacons = [];
    const steady = [];

    // every part draws from its own seeded generator (and every block and lot from one of its own), so the city is the same on every
    // quality - lower detail only leaves things out
    buildStreets(ctx, ground, detail, rng(4243));

    // the billboard building across the north street, facing the deck
    const billboard = { x0: -64, x1: -30, z0: 80, z1: 98 };
    // the blocks: between two street lines (minus road and sidewalk); the car park's own block is skipped
    for (let i = 0; i <= STREETS_X.length; i++) {
        const ax = i === 0 ? -680 : STREETS_X[i - 1] + ROAD_HALF + WALK;
        const bx = i === STREETS_X.length ? 680 : STREETS_X[i] - ROAD_HALF - WALK;
        for (let j = 0; j <= STREETS_Z.length; j++) {
            const az = j === 0 ? -660 : STREETS_Z[j - 1] + ROAD_HALF + WALK;
            const bz = j === STREETS_Z.length ? 660 : STREETS_Z[j] - ROAD_HALF - WALK;
            if (ax < 0 && bx > 0 && az < 0 && bz > 0) continue;
            // 1 = the blocks around the car park, 5 = the outermost
            const ring = Math.max(Math.abs(i - STREETS_X.length / 2), Math.abs(j - STREETS_Z.length / 2));
            // far blocks thin out on lower detail
            const random = rng(4242 + i * 97 + j * 7919);
            if (random() > Math.min(1, detail + 0.25) && ring >= 4) continue;
            buildBlock({ ax, bx, az, bz, ring, ground, random, facades, roofs, plant, crowns, beacons, steady, lit, billboard, detail });
        }
    }
    buildBillboard(ctx, { ...billboard, ground, facades, roofs, plant, lit });

    for (const { batch, material } of Object.values(facades)) {
        const mesh = batch.mesh(material);
        if (mesh) root.add(mesh);
    }
    root.add(new THREE.Mesh(mergeGeometries(roofs), materials.concrete({ color: 0x8e8a84 })));
    root.add(new THREE.Mesh(mergeGeometries(plant), materials.metal({ color: 0x9a9ea4, roughness: 0.5 })));
    if (crowns.length) root.add(new THREE.Mesh(mergeGeometries(crowns), materials.emissive(0xd8e6ff, 2.6)));
    for (const s of steady) glows.add(s.x, s.y, s.z, 2.6, 0xff2a20);

    // aviation lights on the antennas: one material and one set of glows, blinking together
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const beaconGeometries = beacons.map(b => new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(b.x, b.y, b.z));
    if (beaconGeometries.length) root.add(new THREE.Mesh(mergeGeometries(beaconGeometries), beaconMaterial));
    const beaconGlows = new GlowPoints();
    for (const b of beacons) beaconGlows.add(b.x, b.y, b.z, 7, 0xff2a20);
    const beaconPoints = beaconGlows.build({ fogFar: ctx.palette.fogFar * 1.8 });
    if (beaconPoints) root.add(beaconPoints);

    const traffic = buildTraffic(ground, detail, rng(4244), ctx.palette.fogFar * 1.6);
    root.add(traffic);

    let time = 0;
    return {
        update(dt) {
            time += dt;
            // 1 s period, 0.35 s on (with a quick fade so the bloom does not pop)
            const phase = time % 1.2;
            const on = phase < 0.4 ? Math.min(1, phase * 12, (0.4 - phase) * 12) : 0;
            beaconMaterial.color.setRGB(0.15 + on * 7, 0.01 + on * 0.3, 0.01 + on * 0.25);
            if (beaconPoints) beaconPoints.material.uniforms.intensity.value = 0.08 + on * 1.1;
            traffic.material.uniforms.time.value = time;
        },
    };
}

/** The ground, the road surfaces, sodium lamps on both sides with their light pools. */
function buildStreets(ctx, ground, detail, random) {
    const { root, materials, glows, pools } = ctx;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500).rotateX(-Math.PI / 2).translate(0, ground, 0), materials.painted({ color: 0x34333a, roughness: 0.92 }));
    // under everything of the town: drawn last, so only its visible pixels are shaded
    root.add(drawLast(plane));
    const roads = [];
    const extent = 640;
    for (const x of STREETS_X) roads.push(new THREE.PlaneGeometry(ROAD_HALF * 2, extent * 2).rotateX(-Math.PI / 2).translate(x, ground + 0.03, 0));
    for (const z of STREETS_Z) roads.push(new THREE.PlaneGeometry(extent * 2, ROAD_HALF * 2).rotateX(-Math.PI / 2).translate(0, ground + 0.04, z));
    root.add(new THREE.Mesh(mergeGeometries(roads), materials.painted({ color: 0x1c1c20, roughness: 0.6 })));
    const spacing = 32 / Math.min(1, detail + 0.3);
    const sodium = 0xffb05a;
    const lamp = (x, z) => {
        glows.add(x, ground + 8.5, z, 3.4, sodium);
        pools.add(x, ground, z, 8, sodium, 0.24);
    };
    for (const x of STREETS_X) {
        for (let z = -extent + random() * spacing; z < extent; z += spacing) {
            if (STREETS_Z.some(c => Math.abs(z - c) < ROAD_HALF + 3)) continue;
            lamp(x - ROAD_HALF - 0.8, z);
            lamp(x + ROAD_HALF + 0.8, z + spacing / 2);
        }
    }
    for (const z of STREETS_Z) {
        for (let x = -extent + random() * spacing; x < extent; x += spacing) {
            if (STREETS_X.some(c => Math.abs(x - c) < ROAD_HALF + 3)) continue;
            lamp(x, z - ROAD_HALF - 0.8);
            lamp(x + spacing / 2, z + ROAD_HALF + 0.8);
        }
    }
}

/** One block: split into lots, a building on most of them (towers more likely farther out and to the north), roof clutter. */
function buildBlock(o) {
    const { ax, bx, az, bz, ring, billboard, detail } = o;
    // lots grow with the distance (far blocks are seen as a few big shapes)
    const lot = ring <= 1 ? 18 : ring <= 3 ? 24 : 34;
    const cutsX = cuts(ax, bx, o.random, lot);
    const cutsZ = cuts(az, bz, o.random, lot);
    for (let i = 0; i < cutsX.length - 1; i++) {
        for (let j = 0; j < cutsZ.length - 1; j++) {
            const x0 = cutsX[i] + 1;
            const x1 = cutsX[i + 1] - 1;
            const z0 = cutsZ[j] + 1;
            const z1 = cutsZ[j + 1] - 1;
            if (x1 - x0 < 8 || z1 - z0 < 8) continue;
            if (x1 > billboard.x0 - 4 && x0 < billboard.x1 + 4 && z1 > billboard.z0 - 4 && z0 < billboard.z1 + 4) continue;
            // the lot's own generator: what one lot leaves out does not change the next
            const random = rng((Math.round(x0 * 7) * 73856093) ^ (Math.round(z0 * 7) * 19349663));
            const skip = random();
            // an empty lot now and then; most inner lots are courtyards (always on low detail)
            const inner = i > 0 && i < cutsX.length - 2 && j > 0 && j < cutsZ.length - 2;
            if (skip < 0.08 || (inner && skip > 0.08 + detail * 0.32)) continue;
            const cx = (x0 + x1) / 2;
            const cz = (z0 + z1) / 2;
            const north = cz > 150 && Math.abs(cx) < 380;
            const towerChance = ring <= 1 ? 0.1 : north ? 0.45 : 0.18;
            const tower = random() < towerChance;
            // the outermost ring only keeps its towers (low buildings there are lost in the haze)
            if (ring >= 5 && !tower) continue;
            let h = tower ? 55 + Math.pow(random(), 1.4) * (north ? 140 : 90) : 14 + Math.pow(random(), 1.3) * (ring <= 1 ? 26 : 38);
            const r = random();
            const style = h > 55 ? (r < 0.72 ? 'glass' : 'brick') : r < 0.55 ? 'flats' : r < 0.85 ? 'brick' : 'glass';
            // roof clutter on the near rings (on low detail only right around the car park)
            building({ ...o, x0, x1, z0, z1, h, style, random, clutter: ring <= (detail < 0.6 ? 1 : 2), lean: detail < 0.6 });
        }
    }
}

/** Cut positions along a block side: lots of `lot` to 2.4 × lot metres. */
function cuts(a, b, random, lot) {
    const out = [a];
    let at = a;
    while (b - at > lot * 2.8) {
        at += lot + random() * lot * 1.4;
        out.push(at);
    }
    out.push(b);
    return out;
}

/** A building on a lot: one box or a tower with setbacks, its facade quads, the roof, its plant. */
function building({ x0, x1, z0, z1, h, style, ground, random, facades, roofs, plant, crowns, beacons, steady, clutter, lean }) {
    const facade = facades[style];
    const { bay, storey } = facade.style;
    // footprint and height in whole bays and storeys (windows never cut at a corner)
    let w = Math.max(2, Math.floor((x1 - x0) / bay)) * bay;
    let d = Math.max(2, Math.floor((z1 - z0) / bay)) * bay;
    const storeys = Math.max(4, Math.round(h / storey));
    let cx = (x0 + x1) / 2;
    let cz = (z0 + z1) / 2;
    let y = ground;
    const offU = Math.floor(random() * facade.style.bays) * bay;
    const offV = Math.floor(random() * 32) * storey;
    const sections = storeys * storey > 60 && random() < 0.7 ? 2 + (random() < 0.35 ? 1 : 0) : 1;
    const tints = TINTS[style];
    facade.batch.setTint(tints[Math.floor(random() * tints.length)]);
    let left = storeys;
    for (let s = 0; s < sections; s++) {
        const part = s === sections - 1 ? left : Math.max(3, Math.round(left * (0.45 + random() * 0.25)));
        left -= part;
        const sh = part * storey;
        facadeBox(facade.batch, cx, y, cz, w, sh, d, offU, offV + (y - ground));
        // the roof of this section (a ledge where the next one steps back)
        roofs.push(metricUVs(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(cx, y + sh, cz)));
        y += sh;
        if (s < sections - 1) {
            const inset = bay * (1 + Math.floor(random() * 3));
            w = Math.max(bay * 3, w - inset * 2);
            d = Math.max(bay * 3, d - inset * 2);
            cx += (random() - 0.5) * bay * 2;
            cz += (random() - 0.5) * bay * 2;
        }
    }
    const top = y;
    roofClutter({ cx, cz, w, d, top, random, roofs, plant, crowns, beacons, steady, tall: top - ground > 70, height: top - ground, clutter, lean });
}

/** The four walls of a box with facade UVs in metres (u along each face from offU, v up from offV). */
function facadeBox(batch, cx, y, cz, w, h, d, offU, offV) {
    const hy = h / 2;
    const yc = y + hy;
    const v0 = offV;
    const v1 = offV + h;
    // south (−z), west (−x), north (+z), east (+x): u runs around the building, so windows continue round the corners
    let u = offU;
    batch.quad({ x: cx, y: yc, z: cz - d / 2 }, { x: -w / 2, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, [u, u + w, v0, v1]);
    u += w;
    batch.quad({ x: cx - w / 2, y: yc, z: cz }, { x: 0, y: 0, z: d / 2 }, { x: 0, y: hy, z: 0 }, [u, u + d, v0, v1]);
    u += d;
    batch.quad({ x: cx, y: yc, z: cz + d / 2 }, { x: w / 2, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, [u, u + w, v0, v1]);
    u += w;
    batch.quad({ x: cx + w / 2, y: yc, z: cz }, { x: 0, y: 0, z: -d / 2 }, { x: 0, y: hy, z: 0 }, [u, u + d, v0, v1]);
}

/** Parapet, lift room, plant, a water tank on legs, antennas with aviation lights, lit crowns on some towers. */
function roofClutter({ cx, cz, w, d, top, random, roofs, plant, crowns, beacons, steady, tall, height, clutter, lean }) {
    // far roofs: only the lift room and the antennas of the towers
    const rw = Math.min(w * 0.35, 7);
    const rd = Math.min(d * 0.35, 6);
    const rx = cx + (random() - 0.5) * (w - rw) * 0.5;
    const rz = cz + (random() - 0.5) * (d - rd) * 0.5;
    const rh = 3 + random() * 1.5;
    roofs.push(metricUVs(new THREE.BoxGeometry(rw, rh, rd).translate(rx, top + rh / 2, rz)));
    antennas({ top, rx, rz, rw, rd, rh, random, plant, beacons, tall, height });
    // steady red lights on the corners of the tallest, a lit crown band under the roof edge of some towers
    if (height > 100) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) steady.push({ x: cx + sx * (w / 2 - 0.3), y: top + 1.1, z: cz + sz * (d / 2 - 0.3) });
    }
    if (tall && random() < 0.45) {
        const y = top - 0.9;
        crowns.push(new THREE.PlaneGeometry(w, 0.35).rotateY(Math.PI).translate(cx, y, cz - d / 2 - 0.03));
        crowns.push(new THREE.PlaneGeometry(w, 0.35).translate(cx, y, cz + d / 2 + 0.03));
        crowns.push(new THREE.PlaneGeometry(d, 0.35).rotateY(-Math.PI / 2).translate(cx - w / 2 - 0.03, y, cz));
        crowns.push(new THREE.PlaneGeometry(d, 0.35).rotateY(Math.PI / 2).translate(cx + w / 2 + 0.03, y, cz));
    }
    if (!clutter) return;
    // the parapet
    const p = 0.9;
    roofs.push(metricUVs(new THREE.BoxGeometry(w, p, 0.3).translate(cx, top + p / 2, cz - d / 2 + 0.15)));
    roofs.push(metricUVs(new THREE.BoxGeometry(w, p, 0.3).translate(cx, top + p / 2, cz + d / 2 - 0.15)));
    roofs.push(metricUVs(new THREE.BoxGeometry(0.3, p, d - 0.6).translate(cx - w / 2 + 0.15, top + p / 2, cz)));
    roofs.push(metricUVs(new THREE.BoxGeometry(0.3, p, d - 0.6).translate(cx + w / 2 - 0.15, top + p / 2, cz)));
    // plant: boxes and fans
    // (lean: low detail - fewer units, no fans, coarser tanks)
    const units = lean ? 1 + Math.floor(random() * 2) : 1 + Math.floor(random() * 4);
    for (let k = 0; k < units; k++) {
        const uw = 1.2 + random() * 2.8;
        const ud = 1.2 + random() * 2.4;
        const uh = 0.9 + random() * 1.4;
        const ux = cx + (random() - 0.5) * (w - uw - 2);
        const uz = cz + (random() - 0.5) * (d - ud - 2);
        if (Math.abs(ux - rx) < (uw + rw) / 2 && Math.abs(uz - rz) < (ud + rd) / 2) continue;
        plant.push(metricUVs(new THREE.BoxGeometry(uw, uh, ud).translate(ux, top + uh / 2, uz)));
        if (random() < 0.5 && !lean) plant.push(metricUVs(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8, 1, true).translate(ux, top + uh + 0.15, uz)));
    }
    // a water tank on four legs (mid-rise roofs)
    if (!tall && random() < 0.32 && w > 12 && d > 12) {
        const tx = cx + (random() < 0.5 ? -1 : 1) * (w / 2 - 4);
        const tz = cz + (random() < 0.5 ? -1 : 1) * (d / 2 - 4);
        const r = 1.4 + random() * 1.0;
        const legs = 2 + random() * 1.5;
        const segments = lean ? 8 : 12;
        plant.push(metricUVs(new THREE.CylinderGeometry(r, r, 3.2, segments, 1, true).translate(tx, top + legs + 1.6, tz)));
        plant.push(metricUVs(new THREE.ConeGeometry(r + 0.15, 1.0, segments, 1, true).translate(tx, top + legs + 3.7, tz)));
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            plant.push(rod({ x: tx + lx * r * 0.7, y: top, z: tz + lz * r * 0.7 }, { x: tx + lx * r * 0.7, y: top + legs, z: tz + lz * r * 0.7 }, 0.1, 4));
        }
    }
}

/** The roof across the north street: a mid-rise with a big neon billboard on a steel frame facing the deck, floodlights under it. */
function buildBillboard(ctx, { x0, x1, z0, z1, ground, facades, roofs, plant, lit }) {
    const h = 24.2;
    const facade = facades.brick;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    facade.batch.setTint(0xd8ae9c);
    facadeBox(facade.batch, cx, ground, cz, w, h, d, 6, 0);
    const top = ground + h;
    roofs.push(metricUVs(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(cx, top, cz)));
    roofs.push(metricUVs(new THREE.BoxGeometry(w, 0.9, 0.3).translate(cx, top + 0.45, z0 + 0.15)));
    roofs.push(metricUVs(new THREE.BoxGeometry(w, 0.9, 0.3).translate(cx, top + 0.45, z1 - 0.15)));
    roofs.push(metricUVs(new THREE.BoxGeometry(0.3, 0.9, d).translate(x0 + 0.15, top + 0.45, cz)));
    roofs.push(metricUVs(new THREE.BoxGeometry(0.3, 0.9, d).translate(x1 - 0.15, top + 0.45, cz)));
    // the board: 20 × 7.5 m, its lower edge 3 m above the roof, the face towards the deck (−z)
    const bw = 20;
    const bh = 7.5;
    const by = top + 3 + bh / 2;
    const bz = z0 + 3;
    lit.wall(cx, by, bz - 0.02, -1, 0, bw / 2, bh / 2, LIT.billboard);
    plant.push(metricUVs(new THREE.BoxGeometry(bw + 0.4, bh + 0.4, 0.3).translate(cx, by, bz + 0.15)));
    // the frame: legs and braces back to the roof, a catwalk with floodlights
    for (let k = -2; k <= 2; k++) {
        const lx = cx + k * (bw / 4.4);
        plant.push(rod({ x: lx, y: top, z: bz + 0.3 }, { x: lx, y: by + bh / 2, z: bz + 0.3 }, 0.14, 6));
        plant.push(rod({ x: lx, y: top, z: bz + 3.5 }, { x: lx, y: by, z: bz + 0.35 }, 0.1, 5));
    }
    plant.push(metricUVs(new THREE.BoxGeometry(bw, 0.08, 1.0).translate(cx, top + 2.7, bz - 0.4)));
    for (let k = -3; k <= 3; k++) {
        const fx = cx + k * (bw / 7);
        plant.push(rod({ x: fx, y: top + 2.75, z: bz - 0.8 }, { x: fx, y: top + 2.95, z: bz - 1.6 }, 0.06, 4));
        lit.quad({ x: fx, y: top + 2.95, z: bz - 1.65 }, { x: 0.22, y: 0, z: 0 }, { x: 0, y: 0.12, z: 0.06 }, Batch.rect(LIT.lamp));
        ctx.glows.add(fx, top + 3.0, bz - 1.9, 1.6, 0xfff4e0);
    }
    // the board's colours spill into the night
    ctx.glows.add(cx - 5, by, bz - 1.2, 14, 0xff2e88);
    ctx.glows.add(cx + 4, by - 1, bz - 1.2, 10, 0x29e7ff);
    // shops at its foot
    lit.wall(cx, ground + 2.4, z0 - 0.02, -1, 0, w / 2 - 1, 2.0, LIT.shops, { u0: 0.2, u1: 0.8 });
}

// ---------------------------------------------------------------- facade atlases

/** A facade material: the style's albedo and lit-window canvases (owned by the world), PBR on medium/high, Lambert on low. */
function facadeMaterial(name, style, quality, envMap) {
    const { map, emissiveMap } = facadeTextures(name, style, quality);
    const params = { map, emissiveMap, emissive: 0xffffff, color: style.tint, vertexColors: true };
    if (quality === 'low') return new THREE.MeshLambertMaterial({ ...params, emissiveIntensity: 1.25 });
    // glass reflects the sky and the street below only faintly: the reflection map is a generic street, a whole tower face would mirror one
    // of its neon panels. The map is set on the material (it is shared: never disposed with it), so its own envMapIntensity counts
    return new THREE.MeshStandardMaterial({ ...params, emissiveIntensity: 1.7, roughness: style.roughness, metalness: 0, envMap, envMapIntensity: style.reflect });
}

/**
 * The two canvases of a facade style: one tile = style.bays bays × 32 storeys, drawn in 512 × 1024 units (half on low).
 * The textures repeat per metre (geometry UVs are metres).
 */
function facadeTextures(name, style, quality) {
    const scale = quality === 'low' ? 0.5 : 1;
    const W = 512;
    const H = 1024;
    const random = rng(style.seed);
    const bw = W / style.bays;
    const sh = H / 32;
    // decide every window once, so albedo and emission agree
    const windows = [];
    for (let row = 0; row < 32; row++) {
        // offices light whole floors; flats light single windows
        const floorLit = name === 'glass' ? random() : 0;
        const floorColour = random() < 0.6 ? [214, 228, 255] : [255, 236, 206];
        // an office floor is lit evenly (one level for the whole floor), a little dimmer than a lamp
        const floorLevel = 0.42 + random() * 0.3;
        for (let col = 0; col < style.bays; col++) {
            let on = false;
            let colour = floorColour;
            let level = 0.6 + random() * 0.4;
            if (name === 'glass') {
                on = floorLit < style.lit ? random() < 0.9 : floorLit < style.lit + 0.22 ? random() < 0.3 : random() < 0.03;
                level = floorLevel * (0.85 + random() * 0.15);
            } else {
                on = random() < style.lit;
                const r = random();
                colour = r < 0.55 ? [255, 206, 142] : r < 0.72 ? [255, 222, 176] : r < 0.84 ? [236, 242, 220] : r < 0.92 ? [255, 168, 120] : [110, 140, 255];
                if (r >= 0.92) level *= 0.5;
            }
            windows.push({ on, colour, level, blind: random() < 0.35 ? random() * 0.6 : 0, curtain: random() < 0.25 });
        }
    }
    const make = draw => {
        const t = canvasTexture(W * scale, H * scale, (c, w, h) => {
            c.scale(scale, scale);
            draw(c);
        }, { repeat: true });
        t.repeat.set(1 / (style.bays * style.bay), 1 / (32 * style.storey));
        t.anisotropy = 8;
        return t;
    };
    const map = make(c => {
        if (name === 'glass') {
            c.fillStyle = '#26303c';
            c.fillRect(0, 0, W, H);
            for (let row = 0; row < 32; row++) {
                for (let col = 0; col < style.bays; col++) {
                    const v = 30 + random() * 14;
                    c.fillStyle = `rgb(${v},${v + 8},${v + 18})`;
                    c.fillRect(col * bw + 1, row * sh + 1, bw - 2, sh - 8);
                }
                c.fillStyle = '#3a4048';
                c.fillRect(0, row * sh + sh - 7, W, 7);
            }
            c.fillStyle = '#6a727c';
            for (let col = 0; col <= style.bays; col++) c.fillRect(col * bw - 1, 0, 2, H);
        } else {
            const wall = name === 'flats' ? [124, 118, 108] : [104, 70, 58];
            c.fillStyle = `rgb(${wall.join(',')})`;
            c.fillRect(0, 0, W, H);
            for (let k = 0; k < 900; k++) {
                const v = (random() - 0.5) * 18;
                c.fillStyle = `rgba(${wall[0] + v},${wall[1] + v},${wall[2] + v},0.5)`;
                c.fillRect(random() * W, random() * H, 4 + random() * 30, 2 + random() * 8);
            }
            for (let row = 0; row < 32; row++) {
                // floor band / cornice
                c.fillStyle = name === 'flats' ? 'rgba(90,86,80,0.8)' : 'rgba(70,48,40,0.8)';
                c.fillRect(0, row * sh + sh - 3, W, 3);
                for (let col = 0; col < style.bays; col++) {
                    const [x, y, ww, hh] = windowRect(name, col, row, bw, sh);
                    c.fillStyle = '#c4beb2';
                    c.fillRect(x - 1, y - 1, ww + 2, hh + 2);
                    c.fillStyle = '#161a20';
                    c.fillRect(x, y, ww, hh);
                    // the frame: a mullion and a transom
                    c.fillStyle = '#a8a298';
                    c.fillRect(x + ww / 2 - 0.6, y, 1.2, hh);
                    c.fillRect(x, y + hh * 0.28, ww, 1.2);
                    if (name === 'flats' && col % 2 === 0) {
                        c.fillStyle = 'rgba(70,66,60,0.95)';
                        c.fillRect(col * bw + 1, row * sh + sh - 7, bw - 2, 4);
                        c.fillStyle = 'rgba(190,190,186,0.7)';
                        c.fillRect(col * bw + 1, row * sh + sh - 12, bw - 2, 1.5);
                    }
                }
            }
        }
    });
    const emissiveMap = make(c => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, W, H);
        windows.forEach((win, k) => {
            if (!win.on) return;
            const col = k % style.bays;
            const row = Math.floor(k / style.bays);
            const [x, y, ww, hh] = name === 'glass' ? [col * bw + 1, row * sh + 1, bw - 2, sh - 8] : windowRect(name, col, row, bw, sh);
            const [r, g, b] = win.colour.map(v => Math.round(v * win.level));
            const shade = f => `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
            const grad = c.createLinearGradient(0, y, 0, y + hh);
            grad.addColorStop(0, shade(1));
            grad.addColorStop(0.35, shade(0.62));
            grad.addColorStop(1, shade(0.38));
            c.fillStyle = grad;
            c.fillRect(x, y, ww, hh);
            if (name === 'glass') {
                // the ceiling lights: a bright line under the slab
                c.fillStyle = shade(1.25);
                c.fillRect(x, y + 1, ww, 2);
            }
            if (win.blind > 0) {
                c.fillStyle = 'rgba(0,0,0,0.55)';
                c.fillRect(x, y, ww, hh * win.blind);
            }
            if (win.curtain) {
                c.fillStyle = 'rgba(0,0,0,0.5)';
                c.fillRect(x, y, ww * 0.3, hh);
                c.fillRect(x + ww * 0.75, y, ww * 0.25, hh);
            }
            if (name !== 'glass') {
                c.fillStyle = 'rgba(0,0,0,0.85)';
                c.fillRect(x + ww / 2 - 0.6, y, 1.2, hh);
                c.fillRect(x, y + hh * 0.28, ww, 1.2);
            }
            if (name === 'glass' && random() < 0.35) {
                // a desk partition or a person: a dark shape in the lower part
                c.fillStyle = 'rgba(0,0,0,0.6)';
                c.fillRect(x + random() * ww * 0.6, y + hh * 0.55, ww * 0.4, hh * 0.45);
            }
        });
    });
    return { map, emissiveMap };
}

/** The window opening of a bay in atlas units [x, y, w, h]. */
function windowRect(name, col, row, bw, sh) {
    if (name === 'flats') return [col * bw + bw * 0.22, row * sh + sh * 0.2, bw * 0.56, sh * 0.6];
    return [col * bw + bw * 0.24, row * sh + sh * 0.18, bw * 0.52, sh * 0.6];
}

// ---------------------------------------------------------------- traffic

const TRAFFIC_VERTEX = /* glsl */ `
    attribute vec3 motion;   // x: offset along the street (m), y: speed (m/s), z: street length (m)
    attribute vec2 heading;  // unit direction on the ground
    attribute float size;
    attribute vec3 tint;
    uniform float time;
    uniform float scale;
    uniform float fogFar;
    varying vec3 vTint;
    varying float vFade;
    void main() {
        float s = mod(motion.x + motion.y * time, motion.z);
        vec3 p = position + vec3(heading.x, 0.0, heading.y) * s;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float distance = -mv.z;
        vTint = tint;
        vFade = clamp(1.0 - distance / fogFar, 0.0, 1.0);
        gl_PointSize = size * scale / max(distance, 0.5);
        gl_Position = projectionMatrix * mv;
    }`;

// display-referred like the kit's glow points (§9): as it is straight to the canvas, decoded into the HDR target
const TRAFFIC_FRAGMENT = /* glsl */ `
    uniform sampler2D map;
    uniform float gain;
    varying vec3 vTint;
    varying float vFade;
    void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        vec3 c = vTint * t.a * gain * vFade;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(c, 1.0);
        #else
            gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        #endif
    }`;

/** Head and tail lights moving along the streets (two lanes each way): one Points object animated in the vertex shader. */
function buildTraffic(ground, detail, random, fogFar) {
    const positions = [];
    const motion = [];
    const heading = [];
    const sizes = [];
    const tints = [];
    const extent = 640;
    const head = new THREE.Color(0xfff4e0);
    const tail = new THREE.Color(0xff2a1a);
    const addCar = (x, z, hx, hz, offset, speed) => {
        for (const [back, colour, size] of [[0, head, 1.5], [-4.2, tail, 1.1]]) {
            positions.push(x - hx * extent, ground + 0.7, z - hz * extent);
            motion.push(offset + back + extent * 2 * 4, speed, extent * 2);
            heading.push(hx, hz);
            sizes.push(size);
            tints.push(colour.r, colour.g, colour.b);
        }
    };
    const perLane = Math.round(26 * Math.min(1, detail + 0.2));
    for (const x of STREETS_X) {
        for (const [lane, dir] of [[-5.2, 1], [-1.8, 1], [1.8, -1], [5.2, -1]]) {
            for (let k = 0; k < perLane; k++) addCar(x + lane, 0, 0, dir, random() * extent * 2, 7 + random() * 8);
        }
    }
    for (const z of STREETS_Z) {
        for (const [lane, dir] of [[-5.2, 1], [-1.8, 1], [1.8, -1], [5.2, -1]]) {
            for (let k = 0; k < perLane; k++) addCar(0, z - lane, dir, 0, random() * extent * 2, 7 + random() * 8);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('motion', new THREE.Float32BufferAttribute(motion, 3));
    geometry.setAttribute('heading', new THREE.Float32BufferAttribute(heading, 2));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: sharedTexture('glow') },
            time: { value: 0 },
            scale: { value: 600 },
            fogFar: { value: fogFar },
            gain: { value: getGlowGain() },
        },
        vertexShader: TRAFFIC_VERTEX,
        fragmentShader: TRAFFIC_FRAGMENT,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
    });
    const size = new THREE.Vector2();
    material.onBeforeRender = (renderer, scene, camera) => {
        const height = renderer.getDrawingBufferSize(size).y;
        material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.isPerspectiveCamera ? camera.fov : 60) / 2));
        material.uniforms.gain.value = getGlowGain();
    };
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return points;
}

/** Antennas on the lift room (towers, and now and then a mid-rise) with a blinking aviation light on top. */
function antennas({ top, rx, rz, rw, rd, rh, random, plant, beacons, tall, height }) {
    if (!(tall ? random() < 0.75 : height > 40 && random() < 0.12)) return;
    const masts = 1 + Math.floor(random() * 2);
    for (let k = 0; k < masts; k++) {
        const mx = rx + (random() - 0.5) * rw * 0.8;
        const mz = rz + (random() - 0.5) * rd * 0.8;
        const mh = 6 + random() * (tall ? 18 : 8);
        plant.push(rod({ x: mx, y: top + rh, z: mz }, { x: mx, y: top + rh + mh, z: mz }, 0.12, 5));
        if (k === 0) beacons.push({ x: mx, y: top + rh + mh + 0.3, z: mz });
    }
}
