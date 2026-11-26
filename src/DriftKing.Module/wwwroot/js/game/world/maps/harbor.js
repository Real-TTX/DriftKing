// DriftKing · maps/harbor.js – "Kaikō-Docks": a container terminal at dusk. A wet asphalt yard with painted lanes, container slots, bay numbers
// and the rubber of drifting cars; container blocks (detailed ISO boxes of invented shipping lines), high-mast floodlights (real pool lights),
// a rail spur set into the asphalt, a chain-link fence on jersey barriers; the quay with bollards and fenders, ship-to-shore cranes, a moored
// container ship, the water with the lights' reflections; warehouses, depots, the town and the far shore around. Flat at y = 0.
// The course is marked by cones. Gameplay layout (colliders, the slots' sequence of ctx.random) is the one of the low-poly map – only the look
// changed; the parts live in harbor-*.js (containers, decals, water, quay, ship, cranes, land).

import * as THREE from 'three';
import { buildCones, buildStartLine, coneSpots } from '../road.js';
import { drawLast, rng } from '../../render/kit.js';
import { LIGHT_PRESETS } from '../../render/lights.js';
import { Batch, HARBOR, SODIUM, block, extrude, harborPalette, slab, tube } from './harbor-parts.js';
import { Decals, groundText } from './harbor-decals.js';
import { BOX, ContainerYard } from './harbor-containers.js';
import { buildWater, WaterStreaks } from './harbor-water.js';
import { buildQuay } from './harbor-quay.js';
import { buildShip } from './harbor-ship.js';
import { buildCranes } from './harbor-cranes.js';
import { buildLand } from './harbor-land.js';
import { harborEnvironment } from './harbor-sky.js';
import { WetStreaks } from '../wet-streaks.js';

const { minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, quayZ: QUAY_Z, waterY: WATER_Y } = HARBOR;
const CONTAINER = { l: 12.2, w: 2.44, h: 2.6 };
/** The rail spur runs along the aisle between two container blocks (centre z), set into a concrete band. */
const RAIL_Z = -64.89;

export function build(ctx) {
    const { root, course, glows, quality } = ctx;
    const clear = course.width / 2 + 3;
    const free = (x, z, r = 0) => course.distanceTo(x, z) > clear + r;
    // the static parts of every module go into one batch (one draw call per material for the whole map), the containers into the yard
    // (instanced), everything painted into the decals (one draw call), the lamps' reflections on the water into the streaks
    const batch = new Batch();
    const decals = new Decals(quality);
    const yard = new ContainerYard(ctx, decals);
    const streaks = new WaterStreaks({ waterY: WATER_Y, minZ: QUAY_Z + 0.8, fogFar: ctx.palette.fogFar * 1.3 });
    // the masts' sodium light streaking across the wet yard towards the camera (medium/high: low keeps its dry-looking yard and pays nothing)
    const wet = new WetStreaks(ctx, { roadY: 0.02, lowMin: Infinity, far: [70, 125], keep: 7 });
    const parts = { batch, decals, yard, streaks, wet };

    buildCones(root, coneSpots(course, 0.6), { lights: ctx.lights, materials: ctx.materials });
    buildStartLine(root, course, glows, { colour: 0xffb020, lights: ctx.lights, materials: ctx.materials });
    // the colliders in the old order: fence, quay and bollards, containers, masts, crane legs
    buildFence(ctx, parts);
    const { bollards } = buildQuay(ctx, parts);
    const slots = layoutContainers(ctx, free);
    yard.stackSlots(slots.filled, rng(4242));
    const masts = buildMasts(ctx, free, slots.filled, parts);
    buildCranes(ctx, parts);
    buildShip(ctx, { ...parts, bollards });
    buildLand(ctx, parts);
    buildGround(ctx, parts, slots);

    // the land around the port lies under everything: drawn last, so only its visible pixels are shaded
    const gravel = harborPalette(ctx.materials).gravel;
    drawLast(...batch.build(root, { receiveShadow: true }).filter(mesh => mesh.material === gravel));
    yard.build(root);
    decals.build(root);
    streaks.build(root);
    wet.build(root);
    const water = buildWater(root, quality, { x: 0, y: WATER_Y, z: QUAY_Z + 600, w: 3000, d: 1200, palette: ctx.palette });
    // medium/high: the harbour's own reflection map (open sky, masts, cranes) instead of the generic street
    if (ctx.envMap) {
        const environment = harborEnvironment(ctx, { masts, cranes: [-110, 10, 120] });
        if (environment) ctx.scene.environment = environment;
    }
    return {
        flatY: 0,
        update(dt) {
            water.update(dt);
            streaks.update(dt);
            wet.update(dt);
        },
    };
}

/**
 * The container slots: blocks of four rows every 20 m, a slot every 12.7 m where the course leaves room – exactly the old sequence of
 * ctx.random (a skipped slot, the stack height, a colour per level) so every client and the colliders stay as they were.
 * Returns { filled: slots with a stack (and a collider), all: every slot the course leaves free (for the painted frames) }.
 */
function layoutContainers({ colliders, random, course }, free) {
    const filled = [];
    const all = [];
    let blockIndex = 0;
    for (let bz = MIN_Z + 6; bz < QUAY_Z - 16; bz += 20, blockIndex++) {
        for (let row = 0; row < 4; row++) {
            const z = bz + row * (CONTAINER.w + 0.3);
            let bay = 0;
            for (let x = MIN_X + 10; x < MAX_X - 10; x += CONTAINER.l + 0.5) {
                bay++;
                if (!free(x, z, CONTAINER.l / 2 + 1)) continue;
                const slot = { x, z, row, bay, block: blockIndex, distance: course.distanceTo(x, z) };
                all.push(slot);
                if (random() < 0.12) continue;
                slot.stack = 1 + Math.floor(random() * random() * 4);
                // the old colour draws (one per level) keep the sequence
                for (let level = 0; level < slot.stack; level++) random();
                colliders.addBox(x, z, CONTAINER.l / 2, CONTAINER.w / 2);
                filled.push(slot);
            }
        }
    }
    return { filled, all };
}

/**
 * The yard surface: wet asphalt with puddles (split around the rail band), the concrete apron along the quay, the rail spur set into a
 * concrete band, and the paint – lane lines, slot frames, bay numbers, hatched zones, arrows, tyre rubber in the corners, oil stains.
 */
function buildGround(ctx, { batch, decals }, slots) {
    const { course, materials } = ctx;
    const wet = ctx.timeOfDay === 'dusk' ? 0.45 : 0.5;
    const asphalt = materials.asphalt({ wet, puddles: 0.3, scale: 3 });
    const x0 = -262;
    const x1 = 262;
    const apron = QUAY_Z - 7.4;
    batch.add(asphalt,
        slab(x0, x1, 0, 0, -152, RAIL_Z - 1.4, { faces: '+y' }),
        slab(x0, x1, 0, 0, RAIL_Z + 1.4, apron, { faces: '+y' }));
    // the quay apron: cast concrete slabs
    const pal = harborPalette(materials);
    batch.add(pal.apron, slab(x0, x1, 0, 0, apron, QUAY_Z, { faces: '+y' }));
    // the rail spur: a concrete band with two steel rails and their flangeways
    batch.add(pal.apron, slab(x0, x1, 0, 0, RAIL_Z - 1.4, RAIL_Z + 1.4, { faces: '+y' }));
    const steel = pal.rail;
    const groove = pal.black;
    for (const zr of [RAIL_Z - 0.7175, RAIL_Z + 0.7175, QUAY_Z - 12, QUAY_Z - 2]) {
        batch.add(steel, slab(x0, x1, 0, 0.008, zr - 0.036, zr + 0.036, { faces: '+y' }));
        batch.add(groove, slab(x0, x1, 0, 0.004, zr - 0.036 - 0.06 * Math.sign(zr - RAIL_Z || 1), zr - 0.036, { faces: '+y' }));
    }
    // the land around the port (beyond the paved areas)
    batch.add(pal.gravel, slab(-1400, 1400, -0.06, -0.06, -900, -152, { faces: '+y' }));
    for (const side of [-1, 1]) batch.add(pal.gravel, slab(side > 0 ? x1 : -1400, side > 0 ? 1400 : x0, -0.06, -0.06, -152, QUAY_Z, { faces: '+y' }));

    // ---- paint
    const yellow = 0xe0a624;
    const white = 0xd2d0c8;
    // the course: yellow edge lines, a dashed white centre line, arrows on the straights
    stripe(decals, course, course.width / 2 - 0.35, 0.15, yellow, { dash: 0 });
    stripe(decals, course, -course.width / 2 + 0.35, 0.15, yellow, { dash: 0 });
    stripe(decals, course, 0, 0.13, white, { dash: 3, gap: 6 });
    const p = {};
    for (let s = 20; s < course.length; s += 55) {
        course.at(s, p);
        if (Math.abs(p.k) > 1 / 80) continue;
        const yaw = Math.atan2(p.tx, p.tz);
        for (const side of [-1, 1]) decals.ground('arrow', p.x + p.tz * side * 3.6, p.z - p.tx * side * 3.6, yaw, 1.4, 4.6, white);
    }
    // the rubber of drifting cars: dark arcs through the corners, a few sets per corner
    const random = rng(77);
    for (let s = 0; s < course.length; s += 3) {
        course.at(s, p);
        if (Math.abs(p.k) < 1 / 40 || random() > 0.22) continue;
        const run = 12 + random() * 26;
        const offset = (random() - 0.5) * course.width * 0.55;
        skid(decals, course, s, run, offset);
    }
    // container slots: white frames, bay numbers and block letters facing the aisles
    const letters = 'ABCDEFGHJKLMN';
    for (const slot of slots.all) {
        // only the slots in sight of the course get their frames painted (nearer on low)
        if (slot.distance > (ctx.quality === 'low' ? 40 : 60)) continue;
        const hl = 6.22;
        const hw = 1.37;
        for (const [ax, az, bx, bz] of [[-hl, -hw, hl, -hw], [-hl, hw, hl, hw], [-hl, -hw, -hl, hw], [hl, -hw, hl, hw]]) {
            const length = Math.hypot(bx - ax, bz - az);
            decals.ground('line', slot.x + (ax + bx) / 2, slot.z + (az + bz) / 2, Math.atan2(bx - ax, bz - az), 0.1, length, white, { lift: 0.012 });
        }
        if (slot.row === 0 || slot.row === 3) {
            const outside = slot.row === 0 ? -1 : 1;
            const yaw = slot.row === 0 ? 0 : Math.PI;
            const label = `${letters[slot.block % letters.length]}${String(slot.bay).padStart(2, '0')}`;
            groundText(decals, label, slot.x, slot.z + outside * 2.5, yaw, 0.85, white);
        }
    }
    // oil and rubber stains on the yard
    for (let k = 0; k < 90 * ctx.detail; k++) {
        const x = MIN_X + random() * (MAX_X - MIN_X);
        const z = MIN_Z + random() * (QUAY_Z - MIN_Z);
        const size = 1.2 + random() * 3.5;
        decals.ground('stain', x, z, random() * 6.28, size, size * (0.6 + random() * 0.8), 0x1c1a18, { lift: 0.011 });
    }
}

/** A painted line along the course at lateral offset (> 0 left), width metres; dash/gap metres (dash 0 = solid). */
function stripe(decals, course, offset, width, colour, { dash = 0, gap = 0 } = {}) {
    const piece = dash || 6;
    const a = {};
    const b = {};
    for (let s = 0; s < course.length; s += piece + gap) {
        const end = Math.min(s + piece, course.length);
        // short pieces follow the curve
        for (let t = s; t < end - 0.01; t += 3) {
            const u = Math.min(t + 3, end);
            course.at(t, a);
            course.at(u, b);
            const ax = a.x + a.tz * offset;
            const az = a.z - a.tx * offset;
            const bx = b.x + b.tz * offset;
            const bz = b.z - b.tx * offset;
            const length = Math.hypot(bx - ax, bz - az);
            if (length < 0.05) continue;
            decals.ground('line', (ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), width, length + 0.02, colour, {
                lift: 0.014,
                sub: [0, ((t - s) / piece) % 1, 1, ((u - s) / piece) % 1 || 1],
            });
        }
    }
}

/** Two dark tyre bands along the course from s for run metres at lateral offset (a drift's rear tyres). */
function skid(decals, course, s, run, offset) {
    const a = {};
    const b = {};
    const colour = 0x141414;
    for (let t = 0; t < run; t += 2.5) {
        course.at(s + t, a);
        course.at(s + t + 2.5, b);
        // the drift swings outwards through the corner
        const drift = offset + Math.sin((t / run) * Math.PI) * 1.2 * Math.sign(-a.k || 1);
        const ax = a.x + a.tz * drift;
        const az = a.z - a.tx * drift;
        const bx = b.x + b.tz * drift;
        const bz = b.z - b.tx * drift;
        const fade = Math.sin((t / run) * Math.PI);
        if (fade < 0.15) continue;
        decals.ground('skid', (ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), 1.9, Math.hypot(bx - ax, bz - az) + 0.05, colour, {
            lift: 0.013,
            sub: [0, (t / 2.5) % 1 * 0.5, 1, (t / 2.5) % 1 * 0.5 + 0.5],
        });
    }
}

/**
 * The fence around the yard (north, east, west): precast jersey barriers (the colliders, as before) with a galvanised chain-link fence on
 * posts above, wall-pack lamps every 30 m facing the yard.
 */
function buildFence(ctx, { batch }) {
    const { root, colliders, glows, materials, quality } = ctx;
    const corners = [[MIN_X, QUAY_Z], [MIN_X, MIN_Z], [MAX_X, MIN_Z], [MAX_X, QUAY_Z]];
    const p = harborPalette(materials);
    const { concrete, zinc } = p;
    const housing = p.dark;
    const lens = p.sodium;
    const meshes = [];
    // jersey profile (u across, y up; counter-clockwise)
    const jersey = [[-0.3, 0], [0.3, 0], [0.3, 0.075], [0.19, 0.33], [0.085, 0.81], [-0.085, 0.81], [-0.19, 0.33], [-0.3, 0.075]];
    for (let k = 0; k < corners.length - 1; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[k + 1];
        colliders.addSegment(ax, az, bx, bz);
        const length = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / length;
        const dz = (bz - az) / length;
        // inwards (towards the yard): the centre is at (0, 0)… the inner side is the one facing the origin
        const nx = -dz;
        const nz = dx;
        const inward = nx * -(ax + bx) / 2 + nz * -(az + bz) / 2 > 0 ? 1 : -1;
        const units = Math.floor(length / 3.84);
        for (let u = 0; u < units; u++) {
            const s0 = u * 3.84 + 0.02;
            const s1 = s0 + 3.8;
            batch.add(concrete, extrude(jersey, ax + dx * s0, az + dz * s0, ax + dx * s1, az + dz * s1));
        }
        // posts every 3 m, a top rail, the mesh between 0.85 and 3.2 m
        for (let s = 0; s <= length; s += 3) {
            const x = ax + dx * s;
            const z = az + dz * s;
            batch.add(zinc, tube({ x, y: 0.78, z }, { x, y: 3.3, z }, 0.032, { sides: quality === 'low' ? 4 : 6 }));
        }
        batch.add(zinc, tube({ x: ax, y: 3.2, z: az }, { x: bx, y: 3.2, z: bz }, 0.022, { sides: 4 }));
        const panel = new THREE.PlaneGeometry(length, 2.35);
        const uv = panel.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * 2.35);
        panel.rotateY(Math.atan2(dx, dz) - Math.PI / 2).translate((ax + bx) / 2, 2.03, (az + bz) / 2);
        meshes.push(panel);
        // wall packs on every tenth post, facing the yard
        for (let s = 15; s < length; s += 30) {
            const x = ax + dx * s + nx * inward * 0.12;
            const z = az + dz * s + nz * inward * 0.12;
            const g = block(0.36, 0.26, 0.24, 0, 0, 0);
            g.rotateY(Math.atan2(nx * inward, nz * inward)).translate(x, 3.45, z);
            batch.add(housing, g);
            const l = block(0.28, 0.02, 0.16, 0, 0, 0);
            l.rotateY(Math.atan2(nx * inward, nz * inward)).translate(x + nx * inward * 0.02, 3.315, z + nz * inward * 0.02);
            batch.add(lens, l);
            glows.add(x + nx * inward * 0.05, 3.3, z + nz * inward * 0.05, 1.3, 0xffb84a);
            ctx.pools.add(x + nx * inward * 3, 0, z + nz * inward * 3, 5.5, 0xffb060, 0.3);
        }
    }
    const mesh = new THREE.Mesh(mergePanels(meshes), chainLinkMaterial(quality));
    mesh.name = 'Fence';
    root.add(mesh);
}

function mergePanels(panels) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let base = 0;
    for (const g of panels) {
        positions.push(...g.attributes.position.array);
        normals.push(...g.attributes.normal.array);
        uvs.push(...g.attributes.uv.array);
        for (const i of g.index.array) indices.push(i + base);
        base += g.attributes.position.count;
        g.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

/** Chain-link mesh (a 0.6 m tile of diamonds): galvanised wire with alpha-to-coverage on medium/high (MSAA), blended on low. */
function chainLinkMaterial(quality) {
    const size = quality === 'high' ? 256 : 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    c.strokeStyle = '#ffffff';
    c.lineWidth = size / 64;
    const n = 10;
    const step = size / n;
    for (let k = -n; k <= n * 2; k++) {
        c.beginPath();
        c.moveTo(k * step, 0);
        c.lineTo(k * step + size, size);
        c.moveTo(k * step + size, 0);
        c.lineTo(k * step, size);
        c.stroke();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1 / 0.6, 1 / 0.6);
    map.anisotropy = 8;
    if (quality === 'low') return new THREE.MeshLambertMaterial({ map, color: 0xb4b8c0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    return new THREE.MeshStandardMaterial({ map, color: 0xb9bdc3, metalness: 0.85, roughness: 0.45, side: THREE.DoubleSide, alphaToCoverage: true });
}

/**
 * High-mast floodlights on the yard grid (their posts are the old colliders): a concrete foundation, a tapered galvanised pole of 24 m, a
 * ring of six sodium floodlights – one real pool light per mast (LIGHT_PRESETS.mast), glows and a light pool below.
 * A mast whose spot lies inside a container block stands at the block's edge instead (with its own collider; the old one is covered by the block).
 */
function buildMasts(ctx, free, filled, { batch, decals, streaks, wet }) {
    const { root, colliders, glows, pools, materials, quality, lights } = ctx;
    const p = harborPalette(materials);
    const { concrete, zinc } = p;
    const housing = p.dark;
    const lens = p.sodium;
    const sides = quality === 'low' ? 8 : 14;
    const pbr = quality !== 'low';
    const placed = [];
    for (let x = MIN_X + 30; x < MAX_X; x += 55) {
        for (let z0 = MIN_Z + 25; z0 < QUAY_Z; z0 += 50) {
            if (!free(x, z0, 1)) continue;
            colliders.addCircle(x, z0, 0.6);
            let z = z0;
            const blocked = filled.filter(s => Math.abs(s.x - x) < BOX.l40 / 2 + 0.7 && Math.abs(s.z - z0) < BOX.w / 2 + 0.7);
            if (blocked.length) {
                const rows = filled.filter(s => s.block === blocked[0].block).map(s => s.z);
                const north = Math.min(...rows) - BOX.w / 2 - 0.75;
                const south = Math.max(...rows) + BOX.w / 2 + 0.75;
                const target = Math.abs(north - z0) < Math.abs(south - z0) ? north : south;
                if (free(x, target, 0.6)) {
                    z = target;
                    colliders.addCircle(x, z, 0.6);
                }
            }
            // the foundation, the pole, the head ring with six floodlights
            batch.add(concrete, new THREE.CylinderGeometry(0.5, 0.58, 0.6, sides).translate(x, 0.3, z));
            const pole = new THREE.CylinderGeometry(0.16, 0.34, 23.2, sides, 1, true).translate(x, 0.6 + 11.6, z);
            batch.add(zinc, pole);
            batch.add(zinc, new THREE.CylinderGeometry(0.42, 0.42, 0.12, sides).translate(x, 0.66, z));
            if (pbr) batch.add(zinc, new THREE.TorusGeometry(1.25, 0.06, 4, sides).rotateX(Math.PI / 2).translate(x, 23.7, z));
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2 + 0.3;
                const ox = Math.cos(a) * 1.25;
                const oz = Math.sin(a) * 1.25;
                batch.add(zinc, tube({ x, y: 23.7, z }, { x: x + ox, y: 23.7, z: z + oz }, 0.04, { sides: 4 }));
                const head = block(0.62, 0.2, 0.5, 0, 0, 0);
                const face = block(0.54, 0.02, 0.42, 0, -0.11, 0);
                for (const g of [head, face]) {
                    g.rotateZ(0.42).rotateY(-a).translate(x + ox * 1.12, 23.55, z + oz * 1.12);
                }
                batch.add(housing, head);
                batch.add(lens, face);
                glows.add(x + ox * 1.12, 23.35, z + oz * 1.12, 3.2, 0xffae42);
            }
            lights.add({ x, y: 23.4, z, ...LIGHT_PRESETS.mast, color: SODIUM, priority: 1.5 });
            placed.push({ x, z });
            pools.add(x, 0, z, 26, 0xffa040, pbr ? 0.26 : 0.6);
            // the foundation sits in a hatched no-parking square
            decals.ground('hatch', x, z, 0, 2.6, 2.6, 0xe0a624, { lift: 0.017 });
            wet.reflect(x, z, 23.4, 0xffa040, 2.6, 0.85, { reach: 1.8 });
            if (z > QUAY_Z - 30) streaks.add(x, 23.5, z, 0xffa040, { width: 1.4, length: 1.2, strength: 0.6 });
        }
    }
    return placed;
}
