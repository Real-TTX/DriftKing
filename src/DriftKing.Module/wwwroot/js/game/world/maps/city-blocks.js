// DriftKing · maps/city-blocks.js – the buildings of the Neon-Viertel: a dense row of narrow mixed-use buildings along both sides of the street
// (shops on the ground floor, flats, offices, small hotels and bars above), taller blocks behind them and a skyline in the haze.
// Every building gets its facades (city-facade.js) and the things that make a street believable: shop canopies with downlights, fascia signs,
// striped awnings, roller-shutter boxes, sign towers at the corners, neon words, air-conditioning units under the windows, balconies,
// drainpipes, external fire stairs, water tanks, condensers and stair houses on the roofs, rooftop billboards, red aviation lights.
// A footprint never comes near the road (or the rail corridor); nothing here is solid (the street's walls are the kerb line).

import * as THREE from 'three';
import { Frame } from './city-kit.js';
import { MODE, SHOP, STYLE } from './city-facade.js';
import { kelvinHex, LIGHT_PRESETS } from '../../render/lights.js';

/** Sidewalk width (the fronts stand behind it). */
export const SIDEWALK = 4.5;
/** Height of the ground floor (shops). */
const GROUND = 4.5;
const PARAPET = 0.9;

const TINTS = {
    tiles: [0xe8e2d6, 0xd9cdb8, 0xc9b9a0, 0xa89c8e, 0x8f8478, 0xbfc4c2, 0x9eaaa8, 0x7d6a5e, 0xd8d4cc, 0x6e6a66, 0xb8a8a0],
    concrete: [0xd8d4cc, 0xbab6ae, 0x9a978f, 0x7e7c78, 0xc8c0b0, 0x8a8c90],
    brick: [0xffffff, 0xd8c8c0, 0xb0a098, 0x9a8a80],
};

/** The window grid of a style (the cell, the opening, the share of lit windows). */
function styleGrid(style, random, { balconies = false } = {}) {
    switch (style) {
        case STYLE.APARTMENT: {
            const bay = 3.4 + random() * 0.5;
            return { bay, storey: 2.95, x0: 0.35, x1: bay - 0.35, y0: balconies ? 0.1 : 0.85, y1: 2.3, lit: 0.42 + random() * 0.2 };
        }
        case STYLE.OFFICE: {
            const bay = 1.8 + random() * 0.4;
            const storey = 3.5 + random() * 0.3;
            return { bay, storey, x0: 0.1, x1: bay - 0.1, y0: 0.78, y1: storey - 0.38, lit: 0.3 + random() * 0.25 };
        }
        case STYLE.HOTEL: {
            const bay = 2.2 + random() * 0.4;
            return { bay, storey: 3.0, x0: 0.5, x1: bay - 0.5, y0: 0.95, y1: 2.35, lit: 0.3 + random() * 0.15 };
        }
        case STYLE.OLD: {
            const bay = 2.8 + random() * 0.4;
            return { bay, storey: 3.3, x0: 0.8, x1: bay - 0.8, y0: 0.9, y1: 2.7, lit: 0.35 + random() * 0.2 };
        }
        default: {
            const bay = 2.6 + random() * 0.8;
            return { bay, storey: 3.2 + random() * 0.25, x0: 0.35, x1: bay - 0.35, y0: 0.85, y1: 2.55, lit: 0.45 + random() * 0.25 };
        }
    }
}

function pickStyle(random, weights) {
    let r = random() * weights.reduce((a, w) => a + w[1], 0);
    for (const [style, w] of weights) {
        r -= w;
        if (r <= 0) return style;
    }
    return weights[0][0];
}

const FRONT_STYLES = [[STYLE.MIXED, 0.46], [STYLE.APARTMENT, 0.18], [STYLE.OFFICE, 0.14], [STYLE.HOTEL, 0.12], [STYLE.OLD, 0.1]];
const FILLER_STYLES = [[STYLE.OFFICE, 0.35], [STYLE.APARTMENT, 0.35], [STYLE.MIXED, 0.2], [STYLE.HOTEL, 0.1]];

function finishOf(style, random) {
    if (style === STYLE.OLD) return 'brick';
    if (style === STYLE.OFFICE) return random() < 0.75 ? 'concrete' : 'tiles';
    return random() < 0.62 ? 'tiles' : 'concrete';
}

/** A coarse occupancy grid of footprints (10 m cells): keeps fillers from stacking inside each other. */
class Occupancy {
    constructor() {
        this.cells = new Set();
    }

    corners(frame, w, d, margin = 0) {
        return [frame.p(-w / 2 - margin, 0, margin), frame.p(w / 2 + margin, 0, margin), frame.p(w / 2 + margin, 0, -d - margin), frame.p(-w / 2 - margin, 0, -d - margin)];
    }

    /** The share of the footprint's sample points that fall into taken cells. */
    taken(frame, w, d) {
        let hits = 0;
        let total = 0;
        for (let u = 0; u <= 1.001; u += 0.25) {
            for (let v = 0; v <= 1.001; v += 0.25) {
                const p = frame.p(-w / 2 + u * w, 0, -v * d);
                total++;
                if (this.cells.has(this.key(p.x, p.z))) hits++;
            }
        }
        return hits / total;
    }

    mark(frame, w, d) {
        for (let u = 0; u <= w; u += 5) {
            for (let v = 0; v <= d; v += 5) {
                const p = frame.p(-w / 2 + u, 0, -v);
                this.cells.add(this.key(p.x, p.z));
            }
        }
    }

    key(x, z) {
        return `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    }
}

/**
 * Builds every building of the district.
 * @param {object} ctx the map context
 * @param {{ facades, props, emissive, signs, reflect, avoid: (x:number, z:number) => boolean }} env
 * @returns {{ fronts: Array<{ side: number, s0: number, s1: number, frame: Frame, width: number, shops: Array }> }}
 */
export function buildBlocks(ctx, env) {
    const { course, random } = ctx;
    const half = course.width / 2;
    const front = half + SIDEWALK + 0.4;
    const clear = half + SIDEWALK;
    const occupancy = new Occupancy();
    const fits = (frame, w, d, margin = 0) => {
        for (const p of occupancy.corners(frame, w, d, margin).concat([frame.p(0, 0, -d / 2), frame.p(0, 0, 0), frame.p(0, 0, -d), frame.p(-w / 2, 0, -d / 2), frame.p(w / 2, 0, -d / 2)])) {
            if (course.distanceTo(p.x, p.z) < clear + margin) return false;
            if (env.avoid(p.x, p.z)) return false;
        }
        return true;
    };
    const fronts = [];
    // the street fronts: narrow buildings shoulder to shoulder, now and then a wide one or an alley
    for (const side of [1, -1]) {
        let s = random() * 6;
        while (s < course.length) {
            const wide = random() < 0.16;
            let width = wide ? 15 + random() * 9 : 7 + random() * 7;
            const alley = random() < 0.2 ? 1.4 + random() * 1.6 : 0.1;
            // in a tight corner only the outside is built up, with narrow fronts (the gaps between them stay small)
            const corner = Math.abs(course.at(s + 4).k) > 1 / 30;
            if (corner) width = 6 + random() * 2.5;
            const p = course.at(s + width / 2);
            const s0 = s;
            s += width + (corner ? 0.1 : alley);
            if (Math.abs(p.k) > 1 / 30 && Math.sign(p.k) === side) continue;
            const lx = p.tz * side;
            const lz = -p.tx * side;
            const depth = 13 + random() * 10;
            const frame = new Frame(p.x + lx * front, p.z + lz * front, Math.atan2(-lx, -lz));
            if (!fits(frame, width, depth)) continue;
            const style = pickStyle(random, FRONT_STYLES);
            const tall = random() < 0.1;
            const storeys = style === STYLE.OLD ? 2 + Math.floor(random() * 3) : tall ? 11 + Math.floor(random() * 8) : 3 + Math.floor(Math.pow(random(), 1.2) * 7);
            const b = makeBuilding(random, { frame, width, depth, style, storeys, shops: true });
            occupancy.mark(frame, width, depth);
            const shops = addBuilding(ctx, env, b, { street: true });
            fronts.push({ side, s0, s1: s0 + width, frame, width, shops, building: b });
        }
    }
    // the blocks behind: taller, plainer, filling the inner blocks and the edge of the district
    const fillers = Math.round(200 * Math.min(1.2, 0.6 + ctx.detail * 0.4));
    let placed = 0;
    for (let k = 0; k < 700 && placed < fillers; k++) {
        const x = -330 + random() * 660;
        const z = -280 + random() * 560;
        const w = 14 + random() * 18;
        const d = 14 + random() * 18;
        const yaw = Math.floor(random() * 4) * (Math.PI / 2);
        const frame = new Frame(x, z, yaw);
        if (!fits(frame, w, d, 6)) continue;
        if (occupancy.taken(frame, w, d) > 0.2) continue;
        occupancy.mark(frame, w, d);
        placed++;
        const style = pickStyle(random, FILLER_STYLES);
        const storeys = 5 + Math.floor(Math.pow(random(), 1.3) * 18);
        addBuilding(ctx, env, makeBuilding(random, { frame, width: w, depth: d, style, storeys, shops: false }), { street: false });
    }
    // the skyline in the haze: towers on a ring around the district
    for (let k = 0; k < 70; k++) {
        const a = random() * Math.PI * 2;
        const r = 380 + random() * 260;
        const frame = new Frame(11 + Math.cos(a) * r, Math.sin(a) * r, random() * Math.PI);
        if (env.avoid(frame.x, frame.z)) continue;
        const w = 18 + random() * 26;
        const style = random() < 0.6 ? STYLE.OFFICE : STYLE.APARTMENT;
        addBuilding(ctx, env, makeBuilding(random, { frame, width: w, depth: 16 + random() * 20, style, storeys: 10 + Math.floor(Math.pow(random(), 1.5) * 35), shops: false }), { street: false, far: true });
    }
    return { fronts };
}

/** The numbers of a building: its grid, finish, tint, heights. */
function makeBuilding(random, { frame, width, depth, style, storeys, shops }) {
    const balconies = style === STYLE.APARTMENT && random() < 0.7;
    const grid = styleGrid(style, random, { balconies });
    const finish = finishOf(style, random);
    const tints = TINTS[finish];
    const ground = shops ? GROUND : 0;
    const top = ground + storeys * grid.storey + PARAPET;
    return {
        frame, width, depth, style, storeys, shops, balconies, grid, finish, ground, top,
        tint: tints[Math.floor(random() * tints.length)],
        seed: Math.floor(random() * 997) + 1,
        textureOffset: random() * 40,
    };
}

/** The window grid of one wall of a building (centred columns). */
function wallGrid(b, length, mode = MODE.WINDOWS) {
    const g = b.grid;
    const cols = Math.max(0, Math.floor((length - 0.6) / g.bay));
    return { ...g, seed: b.seed + length * 0.17, mode, style: b.style, cols, rows: b.storeys, u0: (length - cols * g.bay) / 2, v0: b.ground };
}

/** Facades, shops and details of one building; returns its shop units (local x ranges and kinds) for the street. */
function addBuilding(ctx, env, b, { street, far = false }) {
    const { facades, props } = env;
    const random = ctx.random;
    const f = b.frame;
    const w = b.width;
    const d = b.depth;
    const fl = f.p(-w / 2, 0, 0);
    const fr = f.p(w / 2, 0, 0);
    const br = f.p(w / 2, 0, -d);
    const bl = f.p(-w / 2, 0, -d);
    const tex = b.textureOffset;
    // the walls: windows on the front and the back, the sides blank party walls now and then
    const sideMode = () => (street && random() < 0.55 ? MODE.PLAIN : MODE.WINDOWS);
    if (b.shops) facades.wall(b.finish, fl, fr, b.ground, b.top, b.tint, wallGrid(b, w), tex);
    else facades.wall(b.finish, fl, fr, 0, b.top, b.tint, wallGrid(b, w), tex);
    facades.wall(b.finish, fr, br, 0, b.top, b.tint, wallGrid(b, d, sideMode()), tex + w);
    facades.wall(b.finish, br, bl, 0, b.top, b.tint, wallGrid(b, w), tex + w + d);
    facades.wall(b.finish, bl, fl, 0, b.top, b.tint, wallGrid(b, d, sideMode()), tex + 2 * w + d);
    facades.roof('concrete', [fl, fr, br, bl], b.top, 0x55534f);
    if (far) return [];
    const shops = b.shops ? addShops(ctx, env, b) : [];
    if (street) addFrontDetails(ctx, env, b);
    addRoof(ctx, env, b, { street });
    // a coping on the parapet
    f.box(props, w + 0.08, 0.1, 0.28, 0, b.top + 0.05, -0.1, 0x77777a, { rough: 0.45, metal: 0.6 });
    return shops;
}

/** The ground floor: shop units with their fronts (in the facade shader), fascias, canopy, awnings, light. */
function addShops(ctx, env, b) {
    const { facades, props, emissive, signs, reflect } = env;
    const random = ctx.random;
    const f = b.frame;
    const w = b.width;
    // split the front into units: shops of 3.5–6 m, an entrance to the upper floors in taller buildings
    const units = [];
    const entrance = b.storeys >= 3 && random() < 0.7 ? 2.3 : 0;
    const rest = w - entrance;
    const count = Math.max(1, Math.round(rest / (3.6 + random() * 2.2)));
    const entranceFirst = random() < 0.5;
    let x = -w / 2;
    if (entrance && entranceFirst) {
        units.push({ xa: x, xb: x + entrance, kind: SHOP.ENTRANCE });
        x += entrance;
    }
    for (let k = 0; k < count; k++) {
        const r = random();
        const kind = r < 0.4 ? SHOP.OPEN : r < 0.64 ? SHOP.SHUTTER : r < 0.8 ? SHOP.RESTAURANT : SHOP.BAR;
        units.push({ xa: x, xb: x + rest / count, kind });
        x += rest / count;
    }
    if (entrance && !entranceFirst) units.push({ xa: x, xb: x + entrance, kind: SHOP.ENTRANCE });
    const canopy = random() < 0.65;
    for (const u of units) {
        const uw = u.xb - u.xa;
        const a = f.p(u.xa, 0, 0);
        const bb = f.p(u.xb, 0, 0);
        const narrow = u.kind === SHOP.ENTRANCE;
        facades.wall(b.finish, a, bb, 0, GROUND, b.tint, {
            bay: uw, storey: GROUND, seed: b.seed * 3.1 + u.xa, lit: 1,
            x0: narrow ? uw / 2 - 0.85 : 0.2, x1: narrow ? uw / 2 + 0.85 : uw - 0.2, y0: 0.06, y1: narrow ? 2.5 : 3.0,
            mode: MODE.SHOP, style: u.kind, cols: 1, rows: 1, u0: 0, v0: 0,
        }, b.textureOffset + (u.xa + w / 2));
        const cx = (u.xa + u.xb) / 2;
        const open = u.kind === SHOP.OPEN || u.kind === SHOP.RESTAURANT || u.kind === SHOP.BAR;
        if (open) {
            const colour = signs.fascia(f, u.xa + 0.16, u.xb - 0.16, 3.18, 4.02, { lit: true });
            u.colour = colour;
            const lightColour = u.kind === SHOP.RESTAURANT ? kelvinHex(2700) : u.kind === SHOP.BAR ? (random() < 0.5 ? 0xff5ab0 : 0xffa048) : kelvinHex(4200);
            u.light = lightColour;
            const p = f.p(cx, 2.7, 0.9);
            const out = f.p(cx, 0, 2.2);
            ctx.lights.add({ ...LIGHT_PRESETS.shop, x: p.x, y: p.y, z: p.z, color: lightColour, dir: { x: out.x - p.x, y: -2.2, z: out.z - p.z }, priority: 0.7 });
            const pool = f.p(cx, 0, 1.7);
            ctx.pools.add(pool.x, 0.15, pool.z, Math.min(3.2, uw * 0.55), lightColour, 0.3);
            const foot = f.p(cx, 0, 0.3);
            reflect(foot.x, foot.z, 1.6, lightColour, uw * 0.55, 0.45);
            if (random() < 0.3 && !canopy) addAwning(env, f, u.xa + 0.15, u.xb - 0.15, random);
            if (u.kind === SHOP.BAR && random() < 0.5) {
                // a neon line along the shop front
                const c = env.neonColour(random);
                const g = new THREE.BoxGeometry(uw - 0.5, 0.035, 0.035);
                g.translate(cx, 3.08, 0.08);
                emissive.add(f.put(g), c, { gain: 6 });
                const m = f.p(cx, 3.08, 0.4);
                ctx.glows.add(m.x, m.y, m.z, uw * 0.6, c);
            }
        } else if (u.kind === SHOP.SHUTTER) {
            // the shutter's box above the opening, a dark sign board
            f.box(props, uw - 0.3, 0.32, 0.26, cx, 3.17, 0.13, 0x8a8c90, { rough: 0.45, metal: 0.6 });
            if (random() < 0.6) signs.fascia(f, u.xa + 0.16, u.xb - 0.16, 3.4, 4.05, { lit: false });
        } else {
            // the entrance: a small lit canopy and a light over the door
            f.box(props, 2.0, 0.12, 0.9, cx, 2.62, 0.45, 0x2a2a2e, { rough: 0.5, metal: 0.5 });
            const lens = new THREE.PlaneGeometry(0.9, 0.18).rotateX(Math.PI / 2);
            lens.translate(cx, 2.555, 0.5);
            emissive.add(f.put(lens), 0xfff0e0, { gain: 6 });
        }
    }
    if (canopy) {
        // a concrete canopy over the shop fronts with downlights
        f.box(props, w, 0.24, 0.85, 0, GROUND - 0.3, 0.42, 0x66666a, { rough: 0.85, metal: 0 });
        for (let x = -w / 2 + 0.8; x < w / 2 - 0.5; x += 1.6) {
            const lens = new THREE.PlaneGeometry(0.16, 0.16).rotateX(Math.PI / 2);
            lens.translate(x, GROUND - 0.425, 0.5);
            emissive.add(f.put(lens), 0xffe2c0, { gain: 9 });
        }
    }
    return units;
}


/** A striped fabric awning over a shop window. */
function addAwning(env, f, xa, xb, random) {
    const colours = [[0xb81c24, 0xf2ece0], [0x1c6a3a, 0xf2ece0], [0x1c2a6a, 0xe8e2d0], [0xe07a1a, 0xf6f0e0], [0x5a1a4a, 0xe8d8e0]][Math.floor(random() * 5)];
    const strips = Math.max(2, Math.round((xb - xa) / 0.34));
    const sw = (xb - xa) / strips;
    const slope = Math.atan2(0.45, 1.15);
    for (let k = 0; k < strips; k++) {
        const x = xa + sw * (k + 0.5);
        const colour = colours[k % 2];
        for (const flip of [0, Math.PI]) {
            const top = new THREE.PlaneGeometry(sw, 1.24).rotateX(-Math.PI / 2 + flip);
            top.rotateX(slope);
            top.translate(x, 2.88, 0.6);
            env.props.add(f.put(top), colour, { rough: 0.8, metal: 0 });
            const valance = new THREE.PlaneGeometry(sw, 0.26).rotateY(flip);
            valance.translate(x, 2.55, 1.18);
            env.props.add(f.put(valance), colour, { rough: 0.8, metal: 0 });
        }
    }
}

/** The front above the shops: balconies, AC units, drainpipes, sign towers, neon words. */
function addFrontDetails(ctx, env, b) {
    const { props, signs } = env;
    const random = ctx.random;
    const f = b.frame;
    const w = b.width;
    const g = wallGrid(b, w);
    const x0 = -w / 2 + g.u0;
    if (b.balconies) {
        const panel = random() < 0.5 ? 0xb4bcc2 : b.tint;
        for (let row = 0; row < b.storeys; row++) {
            const y = b.ground + row * g.storey;
            f.box(props, w - 0.3, 0.16, 1.25, 0, y - 0.08, 0.62, 0x8e8c88, { rough: 0.85, metal: 0 });
            f.box(props, w - 0.3, 1.0, 0.06, 0, y + 0.5, 1.22, panel, { rough: panel === b.tint ? 0.85 : 0.25, metal: 0 });
            f.box(props, w - 0.3, 0.05, 0.08, 0, y + 1.02, 1.22, 0x9a9ca0, { rough: 0.4, metal: 0.8 });
            if (ctx.detail > 0.5) for (let c = 0; c <= g.cols; c += 2) f.box(props, 0.06, g.storey - 0.1, 1.2, x0 + c * g.bay, y + (g.storey - 0.1) / 2, 0.62, 0xc8c4bc, { rough: 0.8, metal: 0 });
            for (let c = 0; c < g.cols; c++) {
                if (random() < 0.14 * Math.min(1, ctx.detail)) addAcUnit(props, f, x0 + (c + 0.3 + random() * 0.4) * g.bay, y + 0.31, 0.85, false, ctx.quality === 'low');
            }
        }
    } else if (b.style !== STYLE.APARTMENT) {
        let units = 0;
        const most = Math.round(8 * Math.min(1, ctx.detail));
        for (let row = 0; row < b.storeys && units < most; row++) {
            for (let c = 0; c < g.cols; c++) {
                if (random() > 0.12 * Math.min(1, ctx.detail + 0.2)) continue;
                const x = x0 + (c + 0.5) * g.bay + (random() - 0.5) * 0.4;
                addAcUnit(props, f, x, b.ground + row * g.storey + Math.max(0.33, g.y0 - 0.42), 0.2, true, ctx.quality === 'low');
                units++;
            }
        }
    }
    // drainpipes down the front corners
    for (const side of [-1, 1]) {
        if (random() < 0.6) f.rod(props, [side * (w / 2 - 0.14), 0, 0.09], [side * (w / 2 - 0.14), b.top - 0.2, 0.09], 0.055, 0x8e8e8a, { rough: 0.5, metal: 0.3 }, 6);
    }
    // signs: a tower at a corner of the bar buildings, neon words, small blade signs
    const bars = b.style === STYLE.MIXED || b.style === STYLE.HOTEL || (b.style === STYLE.OLD && random() < 0.5);
    if (bars && b.storeys >= 2 && random() < 0.85) {
        const side = random() < 0.5 ? -1 : 1;
        const floors = Math.min(Math.floor((b.top - b.ground - 1.2) / 1.05), 3 + Math.floor(random() * 9));
        if (floors >= 2) signs.tower(f, side * (w / 2 - 0.55), b.ground + 0.25, floors);
        if (w > 11 && random() < 0.45) signs.tower(f, -side * (w / 2 - 0.55), b.ground + 0.25, Math.max(2, floors - 2 - Math.floor(random() * 3)), { near: false });
    }
    if (random() < (bars ? 0.5 : 0.22) && b.storeys >= 2) {
        const width = Math.min(w - 2.5, 4 + random() * 3);
        const row = Math.floor(random() * Math.min(2, b.storeys));
        signs.neon(f, (random() - 0.5) * (w - width - 1), b.ground + row * g.storey + g.storey * 0.5 + 0.1, width);
    }
    if (random() < 0.45) signs.blade(f, (random() < 0.5 ? -1 : 1) * (w / 2 - 1.6), 3.5 + random() * 0.6);
}

/** An outdoor AC unit: casing, the dark fan grille, (on walls) a bracket under it. */
function addAcUnit(props, f, x, y, lz, bracket = false, simple = false) {
    f.box(props, 0.78, 0.56, 0.28, x, y, lz, 0xd6d4cc, { rough: 0.55, metal: 0 });
    if (simple) return;
    const fan = new THREE.CircleGeometry(0.19, 8);
    fan.translate(x - 0.12, y, lz + 0.142);
    props.add(f.put(fan), 0x2a2a2c, { rough: 0.7, metal: 0.2 });
    if (bracket) f.box(props, 0.7, 0.04, 0.3, x, y - 0.3, lz - 0.02, 0x4a4a4c, { rough: 0.5, metal: 0.7 });
}

/** The roof: water tank, condensers, stair house, antennas, a billboard facing the street, aviation lights, a fire stair on a side. */
function addRoof(ctx, env, b, { street }) {
    const { props, emissive, signs } = env;
    const random = ctx.random;
    const f = b.frame;
    const w = b.width;
    const d = b.depth;
    const y = b.top - PARAPET;
    const detail = street ? ctx.detail : ctx.detail * 0.3;
    if (random() < 0.6 * Math.min(1, detail + 0.3) && (street || ctx.quality !== 'low')) {
        // the stair house
        const sx = (random() - 0.5) * (w - 4);
        f.box(props, 2.8, 2.9, 3.2, sx, y + 1.45, -d + 2.2, b.tint === 0xffffff ? 0x9a9690 : b.tint, { rough: 0.85, metal: 0 });
        if (ctx.quality !== 'low') f.box(props, 3.0, 0.14, 3.4, sx, y + 2.95, -d + 2.2, 0x5a5a5c, { rough: 0.7, metal: 0.2 });
    }
    if (random() < (street ? 0.55 : 0.25) * Math.min(1, detail + 0.4)) {
        // a panel water tank on a steel stand
        const tx = (random() - 0.5) * (w - 4);
        const tz = -d * (0.35 + random() * 0.3);
        const tank = random() < 0.5 ? 0xd8dcd6 : 0x9ab8c8;
        if (ctx.quality === 'low') {
            f.box(props, 1.8, 1.3, 1.4, tx, y + 0.65, tz, 0x4a4c50, { rough: 0.5, metal: 0.7 });
        } else {
            for (const [ox, oz] of [[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]]) f.box(props, 0.1, 1.3, 0.1, tx + ox, y + 0.65, tz + oz, 0x4a4c50, { rough: 0.5, metal: 0.7 });
            f.box(props, 2.0, 0.08, 1.6, tx, y + 1.3, tz, 0x4a4c50, { rough: 0.5, metal: 0.7 });
            f.box(props, 2.24, 0.04, 1.84, tx, y + 2.2, tz, 0x8a9aa0, { rough: 0.5, metal: 0 });
        }
        f.box(props, 2.2, 1.7, 1.8, tx, y + 2.2, tz, tank, { rough: 0.45, metal: 0 });
    }
    const condensers = Math.floor(random() * 4 * detail);
    for (let k = 0; k < condensers; k++) {
        const cx = (random() - 0.5) * (w - 2.5);
        const cz = -1.5 - random() * (d - 3);
        f.box(props, 1.0, 0.8, 0.7, cx, y + 0.4, cz, 0xc8c6c0, { rough: 0.55, metal: 0.1 });
        const fan = new THREE.CircleGeometry(0.3, 8).rotateX(-Math.PI / 2);
        fan.translate(cx, y + 0.805, cz);
        props.add(f.put(fan), 0x222226, { rough: 0.6, metal: 0.3 });
    }
    if (random() < 0.35 * Math.min(1, detail)) {
        const ax = (random() - 0.5) * (w - 3);
        f.rod(props, [ax, y, -d + 1.5], [ax, y + 4 + random() * 4, -d + 1.5], 0.04, 0x8a8c90, { rough: 0.4, metal: 0.8 }, 4);
    }
    if (b.top > 42) {
        // red aviation lights on the corners of tall buildings
        for (const [ox, oz] of [[-w / 2 + 0.3, -0.3], [w / 2 - 0.3, -d + 0.3]]) {
            const p = f.p(ox, b.top + 0.2, oz);
            emissive.box(0.18, 0.18, 0.18, p.x, p.y, p.z, 0, 0xff2018, { gain: 7 });
            ctx.glows.add(p.x, p.y, p.z, 3.5, 0xff3030);
        }
    }
    if (street && b.storeys <= 6 && b.storeys >= 2 && w > 8 && random() < 0.3) signs.billboard(f, 0, b.top, Math.min(11, w - 1.5), -1.2);
    if (street && ctx.quality !== 'low' && (b.style === STYLE.MIXED || b.style === STYLE.OLD) && b.storeys >= 3 && random() < 0.22) addFireStair(env, b, random() < 0.5 ? 1 : -1);
}

/** External steel fire stairs on a side wall near the back: landings at every floor, flights zig-zagging between them, one down to the street. */
function addFireStair(env, b, side) {
    const { props } = env;
    const f = b.frame;
    const g = b.grid;
    const colour = 0x4a524e;
    const x = side * (b.width / 2 + 0.65);
    const z0 = -b.depth + 1.0;
    const z1 = z0 + 3.4;
    const o = { rough: 0.55, metal: 0.6 };
    for (let k = 0; k <= b.storeys; k++) {
        const y = b.ground + k * g.storey;
        f.box(props, 1.3, 0.08, 3.6, x, y, (z0 + z1) / 2, colour, o);
        f.box(props, 0.04, 1.0, 3.6, x + side * 0.63, y + 0.5, (z0 + z1) / 2, colour, o);
        f.box(props, 1.3, 1.0, 0.04, x, y + 0.5, z0 - 0.02, colour, o);
        if (k === b.storeys) break;
        const rise = g.storey;
        const run = z1 - z0 - 0.4;
        const up = k % 2 === 0;
        const flight = new THREE.BoxGeometry(0.85, 0.07, Math.hypot(rise, run));
        flight.rotateX((up ? -1 : 1) * Math.atan2(rise, run));
        flight.translate(x, y + rise / 2, (z0 + z1) / 2);
        props.add(f.put(flight), colour, o);
        f.rod(props, [x + side * 0.43, y + 0.95, up ? z0 + 0.2 : z1 - 0.2], [x + side * 0.43, y + rise + 0.95, up ? z1 - 0.2 : z0 + 0.2], 0.025, colour, o, 4);
    }
    // the last flight down to the street, along the wall
    const down = new THREE.BoxGeometry(0.85, 0.07, Math.hypot(b.ground, 4.4));
    down.rotateX(Math.atan2(b.ground, 4.4));
    down.translate(x, b.ground / 2, z1 + 2.2);
    props.add(f.put(down), colour, o);
    f.box(props, 0.08, b.top - 0.3, 0.08, x + side * 0.63, (b.top - 0.3) / 2, z0, colour, o);
    f.box(props, 0.08, b.top - 0.3, 0.08, x + side * 0.63, (b.top - 0.3) / 2, z1, colour, o);
}
