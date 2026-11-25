// DriftKing · maps/city-street.js – the street furniture of the Neon-Viertel: road markings (edge, lane and centre lines, zebra crossings,
// stop lines, the diamond before a crossing), yellow tactile strips, manhole covers, LED street lamps with real light, traffic lights and
// pedestrian signals at the crossings, concrete utility poles with crossarms, transformers and a tangle of wires, vending machines, parked
// bicycles, bollards, stand signs, rubbish bags and crates in front of the bars.
// Everything stands on the sidewalk behind the kerb line (the wall colliders of city.js) or lies flat on the road – nothing new is solid.

import * as THREE from 'three';
import { courseStrip, Frame, groundQuad, pick } from './city-kit.js';
import { kelvinHex, LIGHT_PRESETS } from '../../render/lights.js';
import { SHOP } from './city-facade.js';
import { SIDEWALK } from './city-blocks.js';
import { buildLamps as buildLampPosts } from '../props.js';

const WHITE = 0xb6b4ac;
const YELLOW = 0xd6a21e;
const LAMP_COLOUR = kelvinHex(4300);
const LANE = 3.4;

/** Keeps props on the sidewalk from standing in each other: occupied s ranges per side and zone. */
class Occupied {
    constructor(length) {
        this.length = length;
        this.ranges = new Map();
    }

    free(side, zone, s, half) {
        const list = this.ranges.get(`${side}:${zone}`) ?? [];
        for (const [a, b] of list) {
            if (s + half > a && s - half < b) return false;
        }
        return true;
    }

    take(side, zone, s, half) {
        const key = `${side}:${zone}`;
        if (!this.ranges.has(key)) this.ranges.set(key, []);
        this.ranges.get(key).push([s - half, s + half]);
    }
}

/**
 * Builds the street furniture.
 * @param {object} ctx the map context
 * @param {{ props, emissive, paint, signs, reflect, wires: number[], fronts: Array, crossings: number[], steam: Array }} env
 */
export function buildStreet(ctx, env) {
    const occupied = new Occupied(ctx.course.length);
    buildMarkings(ctx, env);
    buildLamps(ctx, env, occupied);
    buildSignals(ctx, env, occupied);
    buildPoles(ctx, env, occupied);
    buildFrontProps(ctx, env);
}

/** A point at s and lateral offset (> 0 left), with the forward and left directions. */
function at(course, s, lateral = 0) {
    const p = course.at(s);
    return { x: p.x + p.tz * lateral, z: p.z - p.tx * lateral, tx: p.tx, tz: p.tz, k: p.k };
}

/** Is s within `margin` metres of a crossing? */
function nearCrossing(crossings, s, margin, length) {
    for (const c of crossings) {
        let d = Math.abs(s - c);
        d = Math.min(d, length - d);
        if (d < margin) return true;
    }
    return false;
}

/** Painted lines, crossings, diamonds, tactile strips and manhole covers (the paint batch); a few manholes steam. */
function buildMarkings(ctx, env) {
    const { course, random } = ctx;
    const { paint, crossings } = env;
    const half = course.width / 2;
    const y = 0.026;
    const L = course.length;
    // the solid lines are interrupted at the crossings
    const runs = [];
    const sorted = [...crossings].sort((a, b) => a - b);
    if (sorted.length === 0) runs.push([0, L]);
    for (let k = 0; k < sorted.length; k++) {
        const a = sorted[k] + 4;
        const b = (k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + L) - 4;
        runs.push([a, b]);
    }
    for (const [a, b] of runs) {
        for (const side of [-1, 1]) {
            // inside the gutter (buildKerbs: 0.35 m)
            const g = courseStrip(course, a, b, side * (half - 0.63), side * (half - 0.48), y, 2);
            paint.add(g, WHITE, { rough: 0.45 });
        }
        paint.add(courseStrip(course, a, b, -0.07, 0.07, y, 2), YELLOW, { rough: 0.45 });
    }
    for (const c of crossings) {
        const p = at(course, c);
        const yaw = Math.atan2(p.tx, p.tz);
        // zebra bars along the road, 0.45 m wide with 0.45 m gaps, 4 m long
        for (let lateral = -half + 0.7; lateral <= half - 0.6; lateral += 0.9) {
            const q = at(course, c, lateral);
            paint.add(groundQuad(0.45, 4, q.x, y + 0.002, q.z, yaw), WHITE, { rough: 0.42 });
        }
        // stop lines (left-hand traffic: the approach of +s traffic is the left half) and the diamonds before the crossing
        for (const dir of [1, -1]) {
            const s = c - dir * 4.6;
            paint.add(courseStrip(course, s - 0.225, s + 0.225, dir > 0 ? 0.15 : -half + 0.3, dir > 0 ? half - 0.3 : -0.15, y + 0.001, 1), WHITE, { rough: 0.45 });
            for (const back of [30, 50]) {
                if (Math.abs(course.at(c - dir * back).k) > 1 / 200) continue;
                for (const lane of [LANE / 2, LANE + 1.6]) diamond(paint, course, c - dir * back, dir * lane, y);
            }
        }
    }
    // the yellow tactile strip on both sidewalks, in the walking zone behind the lamps
    for (const side of [-1, 1]) paint.add(courseStrip(course, 0, L, side * (half + 2.0), side * (half + 2.3), 0.156, 2), 0xc9a018, { rough: 0.55 });
    // manhole covers in the lanes; some of them breathe steam
    let steam = 0;
    for (let s = 20 + random() * 20; s < L - 10; s += 32 + random() * 30) {
        const lateral = (random() < 0.5 ? -1 : 1) * (1.2 + random() * 3.6);
        const q = at(course, s, lateral);
        const disc = new THREE.CircleGeometry(0.32, 14).rotateX(-Math.PI / 2);
        disc.translate(q.x, y + 0.003, q.z);
        paint.add(disc, 0x2c2a28, { rough: 0.38 });
        const ring = new THREE.RingGeometry(0.32, 0.36, 14).rotateX(-Math.PI / 2);
        ring.translate(q.x, y + 0.003, q.z);
        paint.add(ring, 0x4a4846, { rough: 0.6 });
        if (steam < 5 && random() < 0.35) {
            env.steam.push({ x: q.x, z: q.z });
            steam++;
        }
    }
}

/** A diamond (rhombus outline) on the road: a crossing ahead. */
function diamond(paint, course, s, lateral, y) {
    const c = at(course, s, lateral);
    const yaw = Math.atan2(c.tx, c.tz);
    const len = 4.5;
    const w = 1.4;
    const corners = [[0, len / 2], [w / 2, 0], [0, -len / 2], [-w / 2, 0]];
    for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const length = Math.hypot(bx - ax, bz - az);
        const g = new THREE.PlaneGeometry(0.15, length).rotateX(-Math.PI / 2);
        g.rotateY(Math.atan2(bx - ax, bz - az));
        g.translate(mx, 0, mz);
        g.rotateY(yaw);
        g.translate(c.x, y + 0.001, c.z);
        paint.add(g, WHITE, { rough: 0.45 });
    }
}

/** LED street lamps on the sidewalks (the shared builder of props.js), alternating sides, the arm over the road; their reflections. */
function buildLamps(ctx, env, occupied) {
    const { course } = ctx;
    const d = course.width / 2 + 1.2;
    const height = 8.5;
    const arm = 2.6;
    const spots = [];
    let side = 1;
    for (let s = 10; s < course.length - 5; s += 34) {
        if (nearCrossing(env.crossings, s, 6, course.length)) {
            side = -side;
            continue;
        }
        const p = at(course, s, side * d);
        occupied.take(side, 'kerb', s, 1.5);
        // the arm reaches over the road (yaw = the direction of the arm)
        const yaw = Math.atan2(-p.tz * side, p.tx * side);
        spots.push({ x: p.x, y: 0.15, z: p.z, yaw });
        const hx = p.x + Math.sin(yaw) * (arm + 0.2);
        const hz = p.z + Math.cos(yaw) * (arm + 0.2);
        env.reflect(hx, hz, height, LAMP_COLOUR, 0.9, 1.1);
        side = -side;
    }
    buildLampPosts(ctx.root, spots, ctx.glows, ctx.pools, { colour: LAMP_COLOUR, height, arm, pool: 9, strength: 0.42, lights: ctx.lights, materials: ctx.materials, preset: 'led' });
}

/** Traffic lights at the crossings: a pole on each side, an arm over the approaching lanes with the signal head, pedestrian signals. */
function buildSignals(ctx, env, occupied) {
    const { course } = ctx;
    const { props, emissive } = env;
    const half = course.width / 2;
    const o = { rough: 0.5, metal: 0.4 };
    for (const c of env.crossings) {
        for (const dir of [1, -1]) {
            // for +s traffic the pole stands after the crossing on the left (left-hand traffic), the head faces the oncoming cars
            const s = c + dir * 4.2;
            const side = dir;
            occupied.take(side, 'kerb', s, 1.5);
            const p = at(course, s, side * (half + 1.0));
            const frame = new Frame(p.x, p.z, Math.atan2(-p.tz * side, p.tx * side));
            frame.cylinder(props, 0.12, 0.1, 6.0, 0, 0.15, 0, 0x8c8a84, { ...o, shade: 0.7, open: true }, 8);
            frame.rod(props, [0, 5.75, 0], [0, 5.75, 4.4], 0.07, 0x8c8a84, o, 6);
            frame.rod(props, [0, 4.6, 0], [0, 5.72, 1.6], 0.035, 0x8c8a84, o, 4);
            // the head: a horizontal box of three lamps under visors, facing back along the course (towards the approaching cars)
            const head = frame.p(0, 5.4, 3.9);
            const back = Math.atan2(-p.tx * dir, -p.tz * dir);
            const hf = new Frame(head.x, head.z, back);
            hf.box(props, 1.28, 0.42, 0.24, 0, 5.4, 0, 0x6a6c70, o);
            const phases = [0, 1, 2];
            const colours = [0x20e0b4, 0xffb020, 0xff2a1a];
            for (let k = 0; k < 3; k++) {
                // seen from the driver: green left, amber, red right – the head faces back, so local +x is the driver's right… flipped
                const x = (k - 1) * 0.4;
                const lens = new THREE.CircleGeometry(0.15, 14);
                lens.translate(x, 5.4, 0.125);
                emissive.add(hf.put(lens), colours[k], { gain: 7, phase: phases[k] });
                hf.box(props, 0.36, 0.03, 0.18, x, 5.58, 0.2, 0x4a4c50, o);
            }
            // pedestrian signals on the pole, facing across the road
            const ped = new Frame(p.x, p.z, frame.yaw);
            ped.box(props, 0.36, 0.8, 0.22, 0, 2.75, 0.2, 0x6a6c70, o);
            const stop = new THREE.PlaneGeometry(0.26, 0.28);
            stop.translate(0, 2.95, 0.312);
            emissive.add(ped.put(stop), 0xff3020, { gain: 5, phase: 4 });
            const walk = new THREE.PlaneGeometry(0.26, 0.28);
            walk.translate(0, 2.57, 0.312);
            emissive.add(ped.put(walk), 0x30e0b0, { gain: 5, phase: 3 });
        }
        // bollards where the railing opens for the crossing
        for (const side of [-1, 1]) {
            for (const dir of [-1, 1]) {
                const q = at(course, c + dir * 2.6, side * (half + 0.62));
                props.cylinder(0.085, 0.075, 0.9, q.x, 0.15, q.z, 0xd8d8d4, { rough: 0.4, metal: 0.1 }, 8);
                props.cylinder(0.088, 0.088, 0.08, q.x, 0.86, q.z, 0x3a3a3c, { rough: 0.4, metal: 0.1, open: true }, 8);
            }
        }
    }
}

/** Concrete utility poles along one side with crossarms, insulators, transformers, a striped guard, and the wires between them. */
function buildPoles(ctx, env, occupied) {
    const { course, random } = ctx;
    const { props, wires } = env;
    const half = course.width / 2;
    const side = -1;
    const poles = [];
    for (let s = 18; s < course.length - 10; s += 30) {
        const q = at(course, s, side * (half + 1.15));
        if (Math.abs(q.k) > 1 / 40) {
            poles.push(null);
            continue;
        }
        if (!occupied.free(side, 'kerb', s, 2.2)) {
            s += 3;
        }
        const p = at(course, s, side * (half + 1.15));
        occupied.take(side, 'kerb', s, 1);
        const frame = new Frame(p.x, p.z, Math.atan2(p.tx, p.tz));
        const concrete = { rough: 0.85, metal: 0 };
        frame.cylinder(props, 0.2, 0.15, 11.2, 0, 0.15, 0, 0xa09e98, { ...concrete, shade: 0.75, open: true }, 8);
        // the yellow-black guard sleeve at the foot
        for (let k = 0; k < 4; k++) frame.cylinder(props, 0.215, 0.215, 0.4, 0, 0.15 + k * 0.4, 0, k % 2 ? 0x1a1a1a : 0xe0b020, { rough: 0.5, metal: 0, open: true }, 8);
        const arms = [];
        for (const [y, w] of [[10.6, 1.9], [9.7, 1.5]]) {
            frame.box(props, w, 0.1, 0.1, 0, y, 0, 0x6a6a6c, { rough: 0.5, metal: 0.6 }, 0);
            for (const x of [-w / 2 + 0.12, 0.3, w / 2 - 0.12]) {
                if (ctx.detail > 0.5) frame.cylinder(props, 0.045, 0.035, 0.14, x, y + 0.05, 0, 0xe8e6e0, { rough: 0.3, metal: 0 }, 4);
                arms.push(frame.p(x, y + 0.19, 0));
            }
        }
        if (random() < 0.4) {
            frame.cylinder(props, 0.3, 0.3, 1.0, 0.5, 7.6, 0, 0x8a8e90, { rough: 0.5, metal: 0.4 }, 10);
            frame.box(props, 0.08, 0.6, 0.08, 0.25, 8.0, 0, 0x5a5a5c, { rough: 0.5, metal: 0.6 });
        }
        frame.box(props, 0.3, 0.5, 0.03, 0, 3.0, 0.21, 0x2a4a9a, { rough: 0.4, metal: 0 }, 0);
        const low = frame.p(0, 7.2, 0);
        poles.push({ s, arms, low, p });
    }
    // wires: along the poles (sagging), down to the buildings, now and then across the street
    for (let k = 0; k < poles.length; k++) {
        const a = poles[k];
        const b = poles[(k + 1) % poles.length];
        if (!a) continue;
        if (b && Math.abs(b.s - a.s) < 45 && k + 1 < poles.length) {
            for (let i = 0; i < a.arms.length; i++) catenary(wires, a.arms[i], b.arms[i], 0.35 + random() * 0.3);
            for (let i = 0; i < 2; i++) catenary(wires, { ...a.low, y: a.low.y - i * 0.4 }, { ...b.low, y: b.low.y - i * 0.4 }, 0.5 + random() * 0.4);
        }
        // service drops to the fronts on both sides
        for (let i = 0; i < 3; i++) {
            const other = random() < 0.35 ? 1 : -1;
            const q = at(course, a.s + (random() - 0.5) * 16, other * (half + SIDEWALK + 0.35));
            const from = random() < 0.5 ? a.low : a.arms[Math.floor(random() * a.arms.length)];
            catenary(wires, from, { x: q.x, y: 6.5 + random() * 3, z: q.z }, 0.3 + random() * 0.4);
        }
    }
}

/** A sagging wire from a to b (8 segments) into the wire list. */
function catenary(wires, a, b, sag) {
    const n = 8;
    let px = a.x;
    let py = a.y;
    let pz = a.z;
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
        const z = a.z + (b.z - a.z) * t;
        wires.push(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
    }
}

/** Against the fronts: vending machines, bicycles, stand signs, rubbish, crates, planters. */
function buildFrontProps(ctx, env) {
    const { random, detail } = ctx;
    const { props, signs, reflect } = env;
    for (const front of env.fronts) {
        const f = front.frame;
        const w = front.width;
        // a group of vending machines at one end of the front
        if (random() < 0.24) {
            const count = 1 + Math.floor(random() * 3);
            const end = random() < 0.5 ? -1 : 1;
            for (let k = 0; k < count; k++) {
                const x = end * (w / 2 - 0.6 - k * 1.06);
                if (Math.abs(x) > w / 2 - 0.5) break;
                const kind = Math.floor(random() * 4);
                const body = [0xe8e6e0, 0xc8202a, 0x2050b0, 0xf0f0ea][kind];
                f.box(props, 1.0, 1.83, 0.78, x, 0.15 + 0.915, 0.4, body, { rough: 0.35, metal: 0.1 });
                f.box(props, 1.02, 0.08, 0.8, x, 0.15 + 1.86, 0.4, 0x2a2a2e, { rough: 0.5, metal: 0.3 });
                signs.vending(f, x, 0.795, kind);
                const front0 = f.p(x, 1.1, 1.1);
                ctx.glows.add(front0.x, front0.y, front0.z, 1.8, 0xdfeaff);
                const pool = f.p(x, 0, 1.4);
                ctx.pools.add(pool.x, 0.15, pool.z, 1.8, 0xdfeaff, 0.4);
                reflect(pool.x, pool.z, 1.1, 0xdfeaff, 0.8, 0.3);
                if (k === 0) {
                    const lp = f.p(x, 1.4, 1.0);
                    const out = f.p(x, 0, 2.5);
                    ctx.lights.add({ ...LIGHT_PRESETS.shop, color: kelvinHex(6200), intensity: 40, distance: 8, x: lp.x, y: lp.y, z: lp.z, dir: { x: out.x - lp.x, y: -1, z: out.z - lp.z }, priority: 0.55 });
                }
            }
            const bin = end * (w / 2 - 0.6 - count * 1.06 + 0.2);
            if (Math.abs(bin) < w / 2 - 0.3) f.box(props, 0.5, 0.92, 0.42, bin, 0.15 + 0.46, 0.25, 0x3a6a9a, { rough: 0.5, metal: 0 });
        }
        // a row of parked bicycles
        if (random() < 0.16 * Math.min(1.2, detail + 0.2)) {
            const count = 2 + Math.floor(random() * 4 * Math.min(1, detail));
            const x0 = (random() - 0.5) * Math.max(0, w - count * 0.62 - 1);
            for (let k = 0; k < count; k++) bicycle(props, f, x0 + (k - count / 2) * 0.62, 1.05, (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 0.25, random, detail < 0.5);
        }
        // in front of bars and restaurants: stand signs, rubbish bags, crates
        for (const u of front.shops ?? []) {
            const cx = (u.xa + u.xb) / 2;
            if ((u.kind === SHOP.BAR || u.kind === SHOP.RESTAURANT) && random() < 0.45) signs.stand(f, cx + (random() - 0.5) * 1.5, 1.55);
            if ((u.kind === SHOP.RESTAURANT || u.kind === SHOP.SHUTTER) && random() < 0.3 * detail) {
                const bags = 2 + Math.floor(random() * 3);
                for (let k = 0; k < bags; k++) {
                    const g = new THREE.IcosahedronGeometry(0.28 + random() * 0.08, 0);
                    g.scale(1, 0.75, 1);
                    g.rotateY(random() * 3);
                    g.translate(u.xb - 0.5 - (k % 2) * 0.45, 0.15 + 0.2 + Math.floor(k / 2) * 0.3, 0.4 + random() * 0.3);
                    props.add(f.put(g), pick(random, [0x18181c, 0x22304a, 0xc8c8c0]), { rough: 0.35, metal: 0 });
                }
            }
            if (u.kind === SHOP.RESTAURANT && random() < 0.4 * detail) {
                const colour = pick(random, [0xd8b020, 0x2050a0, 0xb02020]);
                for (let k = 0; k < 3 + Math.floor(random() * 3); k++) f.box(props, 0.46, 0.3, 0.36, u.xa + 0.5, 0.15 + 0.15 + k * 0.3, 0.3, colour, { rough: 0.5, metal: 0 });
            }
        }
        if (random() < 0.12 * detail) {
            const x = (random() - 0.5) * (w - 2);
            f.box(props, 1.3, 0.5, 0.5, x, 0.15 + 0.25, 0.35, 0x8a8884, { rough: 0.85, metal: 0 });
            const shrub = new THREE.IcosahedronGeometry(0.5, 1);
            shrub.scale(1.2, 0.7, 0.55);
            shrub.translate(x, 0.15 + 0.75, 0.35);
            props.add(f.put(shrub), 0x2a4426, { rough: 0.8, metal: 0 });
        }
    }
}

/** A city bicycle (step-through frame, front basket, rear carrier) standing on the sidewalk at local (x, lz), turned by yaw. */
function bicycle(props, f, x, lz, yaw, random, simple = false) {
    const colour = pick(random, [0xb8bcc0, 0x1c1c20, 0xe8e6e0, 0x8a1c24, 0x1c3a6a, 0x4a6a4a]);
    const metal = { rough: 0.4, metal: 0.6 };
    const parts = [];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // local bike coordinates: along = z, up = y; turned by yaw, then into the front's frame
    const P = (bz, by, bx = 0) => [x + bx * c + bz * s, 0.15 + by, lz - bx * s + bz * c];
    for (const bz of [-0.52, 0.52]) {
        const wheel = new THREE.TorusGeometry(0.31, 0.025, 3, simple ? 6 : 8);
        wheel.rotateY(Math.PI / 2 + yaw);
        const [wx, wy, wz] = P(bz, 0.33);
        wheel.translate(wx, wy, wz);
        parts.push([wheel, 0x1a1a1c, { rough: 0.8, metal: 0 }]);
    }
    for (const [a, b] of [[[-0.52, 0.33], [-0.05, 0.3]], [[-0.05, 0.3], [-0.2, 0.86]], [[-0.05, 0.3], [0.38, 0.82]], [[0.38, 0.82], [0.52, 0.33]], [[-0.52, 0.33], [-0.2, 0.8]], [[0.38, 0.82], [0.34, 1.02]]]) {
        const pa = P(a[0], a[1]);
        const pb = P(b[0], b[1]);
        const g = rodGeometry(pa, pb, 0.024, 3);
        if (g) parts.push([g, colour, metal]);
    }
    const bar = rodGeometry(P(0.34, 1.02, -0.28), P(0.34, 1.02, 0.28), 0.016, 3);
    if (bar) parts.push([bar, 0x2a2a2c, metal]);
    const saddle = new THREE.BoxGeometry(0.15, 0.06, 0.26);
    saddle.rotateY(yaw);
    saddle.translate(...P(-0.21, 0.9));
    parts.push([saddle, 0x1a1a1c, { rough: 0.6, metal: 0 }]);
    const basket = new THREE.BoxGeometry(0.34, 0.24, 0.28);
    basket.rotateY(yaw);
    basket.translate(...P(0.62, 0.86));
    parts.push([basket, 0x6a6c70, metal]);
    if (!simple) {
        const carrier = new THREE.BoxGeometry(0.28, 0.025, 0.36);
        carrier.rotateY(yaw);
        carrier.translate(...P(-0.46, 0.7));
        parts.push([carrier, 0x6a6c70, metal]);
    }
    for (const [g, hex, o] of parts) props.add(f.put(g), hex, o);
}

const UP = new THREE.Vector3(0, 1, 0);

/** An open cylinder between two local points [x, y, z] (in the caller's frame, not yet placed). */
function rodGeometry(a, b, r, sides = 4) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const length = d.length();
    if (length < 1e-4) return null;
    const g = new THREE.CylinderGeometry(r, r, length, sides, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return g;
}
