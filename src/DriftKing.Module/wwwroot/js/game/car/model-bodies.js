// DriftKing · car/model-bodies.js – the six body designs: invented street-drift cars in the spirit of 80s/90s/2000s Japanese sports cars
// (never a real model). Each design is a set of measures (side profile curves, plan view, glasshouse, lamps, wings, wheels) that
// makeDesign turns into the deformation functions of the two shells (model-shell.js): the lower body and the glasshouse.
// Coordinates: the car faces +z, x across (+x is the car's left), y up from the ground; the wheel centres sit at z = ±1.25, y = 0.33.

import { buildShell, girth, gridAxis, surfacePoint } from './model-shell.js';

const WHEELBASE = 2.5;
const WHEEL_RADIUS = 0.33;

/**
 * The measures of the bodies (metres). top/bottom: the side profile of the lower body (centre line of the bonnet, beltline and boot lid;
 * underside) as [z, y] points from the tail to the nose. cabin: windscreen base z (ws), roof front/rear z, rear window base z (rw), roof
 * height, half width of the roof, the side windows as [from, to] along the glasshouse (0 = rear end, 1 = front end).
 */
const BODIES = {
    coupe: {
        nose: 2.08, tail: -2.2, halfWidth: 0.845, halfTrack: 0.722, tyre: 0.205, arch: 0.385, sill: 0.2, belt: 0.925,
        top: [[-2.2, 0.915], [-2.04, 0.962], [-1.65, 0.976], [-1.2, 0.958], [-0.6, 0.936], [0.55, 0.925], [1.05, 0.878], [1.62, 0.8], [2.08, 0.722]],
        bottom: [[-2.2, 0.31], [-1.92, 0.25], [-1.55, 0.21], [-0.8, 0.2], [0.8, 0.2], [1.6, 0.19], [1.95, 0.165], [2.08, 0.18]],
        radius: [0.075, 0.07, 0.09], crown: 0.03, tuck: 0.035, roll: 0.035, shoulder: 0.66,
        noseLen: 0.45, noseSlant: 0.075, noseBreak: 0.5, chin: 0.035, nosePlan: 0.17, noseTaper: 0.03,
        tailLen: 0.35, tailSlant: 0.025, tailTuck: 0.06, tailPlan: 0.11, tailTaper: 0.025,
        cabin: { ws: 0.55, roofFront: -0.22, roofRear: -0.96, rw: -1.5, roof: 1.3, half: 0.6, inset: 0.05, crown: 0.035, wrap: 0.07, wrapRear: 0.05,
            bow: 0.1, bowRear: 0.06, taper: 0.06, radius: [0.06, 0.05, 0.07], windows: [[0.17, 0.4], [0.43, 1]], bBlack: true },
        doors: [{ z0: -0.62, z1: 0.6 }],
        lamps: { head: 'rect', tail: 'strip' }, wing: 'duck', rim: 'mesh', exhaust: { x: -0.5, count: 1 }, plate: 0.0,
        intakes: 'slats', seat: [0.32, 0.03, 0.03], caliper: 0xb8121b,
    },
    hatch: {
        nose: 1.92, tail: -1.98, halfWidth: 0.83, halfTrack: 0.712, tyre: 0.195, arch: 0.38, sill: 0.21, belt: 0.93,
        top: [[-1.98, 0.93], [-1.86, 0.965], [-1.4, 0.958], [-0.6, 0.94], [0.62, 0.93], [1.1, 0.888], [1.6, 0.825], [1.92, 0.752]],
        bottom: [[-1.98, 0.3], [-1.76, 0.24], [-1.5, 0.21], [1.5, 0.2], [1.82, 0.172], [1.92, 0.19]],
        radius: [0.07, 0.065, 0.08], crown: 0.028, tuck: 0.03, roll: 0.035, shoulder: 0.66,
        noseLen: 0.4, noseSlant: 0.06, noseBreak: 0.5, chin: 0.03, nosePlan: 0.14, noseTaper: 0.03,
        tailLen: 0.28, tailSlant: 0.015, tailTuck: 0.05, tailPlan: 0.08, tailTaper: 0.02,
        cabin: { ws: 0.62, roofFront: 0.0, roofRear: -1.46, rw: -1.92, roof: 1.37, half: 0.62, inset: 0.048, crown: 0.03, wrap: 0.06, wrapRear: 0.03,
            bow: 0.08, bowRear: 0.0, taper: 0.03, radius: [0.06, 0.05, 0.06], windows: [[0.07, 0.31], [0.35, 1]], bBlack: false },
        doors: [{ z0: -0.76, z1: 0.66 }],
        lamps: { head: 'square', tail: 'vertical' }, wing: 'roof', rim: 'dish', exhaust: { x: -0.42, count: 1 }, plate: 0.0,
        intakes: 'slats', seat: [0.05, 0.12, 0.3], caliper: 0xd4a017,
    },
    sedan: {
        nose: 2.15, tail: -2.38, halfWidth: 0.865, halfTrack: 0.74, tyre: 0.215, arch: 0.39, sill: 0.21, belt: 0.95,
        top: [[-2.38, 0.95], [-2.2, 0.998], [-1.72, 1.01], [-1.0, 0.975], [0.6, 0.95], [1.1, 0.902], [1.7, 0.822], [2.15, 0.742]],
        bottom: [[-2.38, 0.33], [-2.02, 0.26], [-1.6, 0.22], [1.6, 0.2], [2.0, 0.17], [2.15, 0.19]],
        radius: [0.08, 0.075, 0.1], crown: 0.032, tuck: 0.035, roll: 0.035, shoulder: 0.64,
        noseLen: 0.45, noseSlant: 0.08, noseBreak: 0.5, chin: 0.035, nosePlan: 0.17, noseTaper: 0.03,
        tailLen: 0.35, tailSlant: 0.03, tailTuck: 0.06, tailPlan: 0.12, tailTaper: 0.025,
        cabin: { ws: 0.66, roofFront: -0.1, roofRear: -1.12, rw: -1.62, roof: 1.39, half: 0.64, inset: 0.05, crown: 0.035, wrap: 0.07, wrapRear: 0.05,
            bow: 0.1, bowRear: 0.06, taper: 0.05, radius: [0.065, 0.05, 0.07], windows: [[0.12, 0.215], [0.23, 0.49], [0.53, 1]], bBlack: true },
        doors: [{ z0: -0.1, z1: 0.66 }, { z0: -0.86, z1: -0.1 }],
        lamps: { head: 'slim', tail: 'wide' }, wing: 'lip', rim: 'ten', exhaust: { x: -0.52, count: 2 }, plate: 0.0,
        intakes: 'mesh', seat: [0.04, 0.04, 0.045], caliper: 0x1c3f9e,
    },
    fastback: {
        nose: 2.12, tail: -2.28, halfWidth: 0.87, halfTrack: 0.75, tyre: 0.225, arch: 0.39, sill: 0.19, belt: 0.9,
        top: [[-2.28, 0.9], [-2.14, 0.94], [-1.9, 0.935], [-1.2, 0.918], [0.5, 0.9], [1.0, 0.842], [1.6, 0.762], [2.12, 0.682]],
        bottom: [[-2.28, 0.3], [-2.0, 0.24], [-1.6, 0.2], [1.6, 0.18], [2.0, 0.155], [2.12, 0.17]],
        radius: [0.09, 0.08, 0.11], crown: 0.04, tuck: 0.04, roll: 0.04, shoulder: 0.62,
        noseLen: 0.5, noseSlant: 0.1, noseBreak: 0.45, chin: 0.04, nosePlan: 0.2, noseTaper: 0.035,
        tailLen: 0.35, tailSlant: 0.03, tailTuck: 0.07, tailPlan: 0.14, tailTaper: 0.03,
        cabin: { ws: 0.5, roofFront: -0.28, roofRear: -0.76, rw: -1.94, roof: 1.27, half: 0.6, inset: 0.055, crown: 0.04, wrap: 0.1, wrapRear: 0.08,
            bow: 0.12, bowRear: 0.12, taper: 0.1, radius: [0.07, 0.055, 0.08], windows: [[0.2, 0.38], [0.42, 1]], bBlack: true },
        doors: [{ z0: -0.7, z1: 0.5 }],
        lamps: { head: 'projector', tail: 'round' }, wing: 'gt', rim: 'five', exhaust: { x: -0.54, count: 1, big: true }, plate: -0.28,
        intakes: 'mesh', seat: [0.03, 0.03, 0.035], caliper: 0xc8161d,
    },
    wide: {
        nose: 2.18, tail: -2.3, halfWidth: 0.87, flare: 0.095, halfTrack: 0.8, tyre: 0.255, arch: 0.405, sill: 0.17, belt: 0.88,
        top: [[-2.3, 0.88], [-2.16, 0.93], [-1.8, 0.926], [-1.2, 0.9], [0.45, 0.88], [1.0, 0.822], [1.6, 0.735], [2.18, 0.642]],
        bottom: [[-2.3, 0.28], [-2.0, 0.22], [-1.6, 0.18], [1.6, 0.16], [2.05, 0.13], [2.18, 0.15]],
        radius: [0.09, 0.08, 0.12], crown: 0.04, tuck: 0.04, roll: 0.045, shoulder: 0.6,
        noseLen: 0.5, noseSlant: 0.11, noseBreak: 0.42, chin: 0.045, nosePlan: 0.22, noseTaper: 0.03,
        tailLen: 0.35, tailSlant: 0.035, tailTuck: 0.07, tailPlan: 0.15, tailTaper: 0.03,
        cabin: { ws: 0.45, roofFront: -0.32, roofRear: -0.92, rw: -1.62, roof: 1.235, half: 0.58, inset: 0.06, crown: 0.04, wrap: 0.1, wrapRear: 0.08,
            bow: 0.12, bowRear: 0.08, taper: 0.1, radius: [0.07, 0.055, 0.08], windows: [[0.15, 0.36], [0.4, 1]], bBlack: true },
        doors: [{ z0: -0.72, z1: 0.44 }],
        lamps: { head: 'swept', tail: 'slim' }, wing: 'gtBig', rim: 'six', exhaust: { x: 0.56, count: 1, both: true, big: true }, plate: 0.3,
        intakes: 'mesh', vents: true, cage: true, seat: [0.36, 0.02, 0.02], caliper: 0xe0b010,
    },
    muscle: {
        nose: 2.25, tail: -2.35, halfWidth: 0.9, hips: 0.035, halfTrack: 0.77, tyre: 0.245, arch: 0.398, sill: 0.22, belt: 0.96,
        top: [[-2.35, 0.97], [-2.2, 1.008], [-1.75, 1.02], [-1.2, 0.99], [0.25, 0.97], [0.8, 0.952], [1.6, 0.9], [2.25, 0.842]],
        bottom: [[-2.35, 0.33], [-2.05, 0.26], [-1.6, 0.22], [1.6, 0.21], [2.1, 0.19], [2.25, 0.21]],
        radius: [0.08, 0.07, 0.08], crown: 0.035, tuck: 0.03, roll: 0.04, shoulder: 0.7,
        noseLen: 0.35, noseSlant: 0.035, noseBreak: 0.55, chin: 0.04, nosePlan: 0.13, noseTaper: 0.025,
        tailLen: 0.3, tailSlant: 0.02, tailTuck: 0.06, tailPlan: 0.1, tailTaper: 0.02,
        cabin: { ws: 0.22, roofFront: -0.42, roofRear: -1.08, rw: -1.58, roof: 1.34, half: 0.64, inset: 0.055, crown: 0.035, wrap: 0.06, wrapRear: 0.05,
            bow: 0.08, bowRear: 0.06, taper: 0.04, radius: [0.06, 0.05, 0.07], windows: [[0.1, 0.33], [0.36, 1]], bBlack: false },
        doors: [{ z0: -0.86, z1: 0.26 }],
        lamps: { head: 'quad', tail: 'bar' }, wing: 'duck', rim: 'dish5', exhaust: { x: 0.6, count: 2, both: true }, plate: 0.0,
        intakes: 'slats', scoop: true, seat: [0.03, 0.03, 0.03], caliper: 0x16151a,
    },
};

/** The body keys (catalog.js BODIES has their names). */
export const BODY_KEYS = Object.keys(BODIES);

const designs = new Map();

/** The design of a body (cached): its measures and the shell functions. */
export function designOf(body) {
    const key = BODIES[body] ? body : 'coupe';
    if (!designs.has(key)) designs.set(key, makeDesign(key, BODIES[key]));
    return designs.get(key);
}

/** A smooth curve through [z, y] points (Catmull-Rom, clamped at the ends): y(z). */
function curve(points) {
    const n = points.length;
    return z => {
        if (z <= points[0][0]) return points[0][1];
        if (z >= points[n - 1][0]) return points[n - 1][1];
        let k = 0;
        while (k < n - 2 && z > points[k + 1][0]) k++;
        const p0 = points[Math.max(0, k - 1)];
        const p1 = points[k];
        const p2 = points[k + 1];
        const p3 = points[Math.min(n - 1, k + 2)];
        const t = (z - p1[0]) / (p2[0] - p1[0]);
        const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * (p2[0] - p1[0]);
        const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * (p2[0] - p1[0]);
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
    };
}

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = v => {
    const t = clamp01(v);
    return t * t * (3 - 2 * t);
};

function makeDesign(key, p) {
    const topLine = curve(p.top);
    const bottomLine = curve(p.bottom);
    const A = p.halfWidth;
    const H = p.belt - p.sill;
    const [rx, ry, rz] = p.radius;
    const archY = WHEEL_RADIUS + 0.005;
    const arches = [WHEELBASE / 2, -WHEELBASE / 2].map(z => ({ z, y: archY, r: p.arch }));
    const c = p.cabin;
    // the interior tub under the glasshouse: the floor sinks between the door panels
    const tub = { x: A - c.inset - 0.085, front: c.ws - 0.07, rear: c.rw + (key === 'hatch' ? 0.1 : 0.2), floor: 0.5 };

    /** Plan-view width factor along z (narrower towards nose and tail). */
    const plan = z => 1 - p.noseTaper * smooth((z - (p.nose - 0.9)) / 0.9) ** 2 - p.tailTaper * smooth((p.tail + 0.9 - z) / 0.9) ** 2;
    /** The side section: the sill tucks under, the shoulder rolls into the top. */
    const section = yN => (yN < p.shoulder ? 1 - p.tuck * ((p.shoulder - yN) / p.shoulder) ** 2 : 1 - p.roll * ((yN - p.shoulder) / (1 - p.shoulder)) ** 2);
    /** The flare (widebody) or hips (muscle) bulge over the wheels, 0..1. */
    const bulge = (z, y) => {
        let b = 0;
        for (const a of arches) {
            if (p.hips && a.z > 0) continue;
            const d = Math.hypot(z - a.z, y - a.y);
            b = Math.max(b, 1 - smooth((d - a.r - 0.02) / (p.flare ? 0.3 : 0.45)));
        }
        return b * smooth((p.belt - 0.03 - y) / 0.14) * smooth((y - 0.1) / 0.1);
    };

    const lowerBox = { min: [-A, 0, p.tail], max: [A, H, p.nose], r: [rx, ry, rz] };
    const creaseY = p.shoulder - 0.1;
    const kick = p.wing === 'duck' ? 0.048 : p.wing === 'lip' ? 0.022 : 0;
    function lowerDeform(n, out) {
        const [bx, by, bz] = n;
        const xN = bx / A;
        const yN = by / H;
        const bot = bottomLine(bz);
        // the boot lid kicks up into a duck tail (or a small lip) at its rear edge
        let top = topLine(bz) - p.crown * xN * xN + kick * smooth((p.tail + 0.36 - bz) / 0.3) * (1 - 0.35 * Math.abs(xN) ** 6);
        // the tub: the top face between the door panels sinks to the floor inside the glasshouse
        if (by >= H - 1e-6 && Math.abs(bx) < tub.x && bz > tub.rear && bz < tub.front) {
            const wx = clamp01((tub.x - Math.abs(bx)) / 0.02);
            const wz = clamp01((tub.front - bz) / 0.03) * clamp01((bz - tub.rear) / 0.03);
            top -= (top - tub.floor) * wx * wz;
        }
        const y = bot + yN * (top - bot);
        let x = xN * A * plan(bz) * section(yN);
        // a character line: a fine ridge along the side just under the shoulder (fades out towards nose and tail)
        const crease = (p.crease ?? 0.005) * Math.exp(-(((yN - creaseY) / 0.035) ** 2)) * Math.abs(xN) ** 10 * smooth((bz - p.tail - 0.25) / 0.4) * smooth((p.nose - 0.3 - bz) / 0.4);
        x += Math.sign(xN) * crease;
        const flare = (p.flare ?? 0) + (p.hips ?? 0);
        if (flare) x += Math.sign(xN) * flare * bulge(bz, y) * smooth((Math.abs(xN) - 0.55) / 0.4);
        let z = bz;
        const wn = smooth((bz - (p.nose - p.noseLen)) / p.noseLen);
        if (wn > 0) {
            const slant = p.noseSlant * smooth((yN - p.noseBreak) / (1 - p.noseBreak)) ** 1.5 + (yN < 0.3 ? p.chin * (1 - yN / 0.3) ** 2 : 0);
            z -= wn * (slant + p.nosePlan * Math.abs(xN) ** 4);
        }
        const wt = smooth((p.tail + p.tailLen - bz) / p.tailLen);
        if (wt > 0) {
            const slant = p.tailSlant * smooth((yN - 0.5) / 0.5) + (yN < 0.35 ? p.tailTuck * (1 - yN / 0.35) ** 2 : 0);
            z += wt * (slant + p.tailPlan * Math.abs(xN) ** 4);
        }
        out[0] = x;
        out[1] = y;
        out[2] = z;
    }
    const lowerGirth = { A, y0: 0, y1: H, rx, ry };
    // the door tops inside the glasshouse (between the tub and the glass) are interior trim, not paint
    const trimX = A - c.inset - 0.012;
    const inTrim = n => n[1] >= H - 1e-6 && Math.abs(n[0]) < trimX && n[2] > tub.rear && n[2] < tub.front;
    const lower = {
        box: lowerBox,
        deform: lowerDeform,
        arches,
        girth: n => girth(n[0], n[1], lowerGirth),
        classify(face, centre, carved) {
            // the side panel inside an arch collapses onto the arch: its quads would span chords across the opening
            if (carved === 4 && (face === 'px' || face === 'nx')) return null;
            if (carved >= 3) return 'matte';
            // the flat underside is never seen: only its rounded edges stay
            if (face === 'ny') return carved === 0 && Math.abs(centre[0]) < A - rx - 0.05 && centre[2] > p.tail + rz + 0.05 && centre[2] < p.nose - rz - 0.05 ? null : 'matte';
            if (face === 'py' && inTrim(centre)) return 'matte';
            return 'paint';
        },
        shade(n, carved) {
            if (carved) return 0.018;
            if (n[1] <= 1e-6) return 0.014;
            if (inTrim(n)) return 0.03;
            return 0.02;
        },
        axes(quality, far = false) {
            const s = far ? 3 : quality === 'high' ? 1.1 : quality === 'medium' ? 1.35 : 2.3;
            const zone = far ? 2 : quality === 'low' ? 2 : quality === 'medium' ? 3 : 4;
            const tubX = far ? [] : [tub.x, tub.x - 0.02, trimX].flatMap(v => [v, -v]);
            const tubZ = far ? [] : [tub.front, tub.front - 0.03, tub.rear, tub.rear + 0.03];
            const archDense = arches.map(a => ({ from: a.z - a.r - 0.05, to: a.z + a.r + 0.05, step: 0.034 * s }));
            return [
                gridAxis(-A, A, rx, 0.11 * s, { zone, extra: [0, ...tubX] }),
                gridAxis(0, H, ry, 0.075 * s, { zone, dense: [
                    { from: 0, to: archY + p.arch - p.sill + 0.05, step: 0.032 * s },
                    ...(far ? [] : [{ from: (creaseY - 0.08) * H, to: (creaseY + 0.08) * H, step: 0.018 * s }]),
                ] }),
                gridAxis(p.tail, p.nose, rz, 0.1 * s, { zone, dense: archDense, extra: tubZ }),
            ];
        },
    };

    // ---- the glasshouse: a rounded box from the rear window base (z = 0) to the windscreen base (z = L), belt (y = 0) to roof (y = HC)
    const L = 2;
    const HC = c.roof - p.belt;
    const [crx, cry, crz] = c.radius;
    const cabinBox = { min: [-c.half, -cry, 0], max: [c.half, HC, L], r: [crx, cry, crz] };
    const beltAt = (z, x) => topLine(z) - p.crown * (x / A) ** 2;
    function cabinDeform(n, out) {
        const [bx, by, bz] = n;
        const xN = bx / c.half;
        const yN = clamp01(by / HC);
        const zN = bz / L;
        const front = c.ws + (c.roofFront - c.ws) * (yN - c.bow * yN * (1 - yN));
        const rear = c.rw + (c.roofRear - c.rw) * (yN - c.bowRear * yN * (1 - yN));
        const z = rear + (front - rear) * zN - c.wrap * xN * xN * zN ** 6 + c.wrapRear * xN * xN * (1 - zN) ** 6;
        const beltHalf = (A * plan(z) - c.inset) * (1 - c.taper * (1 - zN) ** 2);
        const half = beltHalf + (c.half * (1 - c.taper * 0.6 * (1 - zN) ** 2) - beltHalf) * yN ** 0.9;
        const x = xN * half;
        const belt = beltAt(z, x) - 0.012;
        const y = by < 0 ? belt + by : belt + yN * (c.roof - belt) - c.crown * xN * xN * yN ** 4;
        out[0] = x;
        out[1] = y;
        out[2] = z;
    }
    const cabinGirth = { A: c.half, y0: -cry, y1: HC, rx: crx, ry: cry };
    const roofEdge = c.half - crx;
    // the side windows between the pillar zones, each framed by a thin black seal
    const zoneLo = crz / L;
    const zoneHi = 1 - crz / L;
    const windows = c.windows.map(([a, b]) => [Math.max(a, zoneLo + 0.01), Math.min(b, zoneHi - 0.004)]);
    const frame = 0.012;
    const beltTrim = 0.035;
    const topFrame = HC - cry - 0.03;
    const cabin = {
        box: cabinBox,
        deform: cabinDeform,
        girth(n) {
            const t = girth(n[0], n[1], cabinGirth);
            const a = Math.abs(t);
            // beyond the roof the girth is squeezed into the band of the bonnet/boot top (the tub there is hidden): no door art on pillars
            return a <= roofEdge ? t : Math.sign(t) * (roofEdge + (a - roofEdge) * 0.22);
        },
        classify(face, [bx, by, bz]) {
            if (face === 'ny') return null;
            if (face === 'py') return 'paint';
            if (face === 'pz' || face === 'nz') {
                if (Math.abs(bx) > c.half - crx || by > HC - cry) return 'paint';
                if (by < 0) return 'paint';
                if (Math.abs(bx) > c.half - crx - 0.06 || by > HC - cry - 0.045 || by < 0.04) return 'gloss';
                return 'glass';
            }
            // the sides
            if (bz > L - crz || bz < crz || by > HC - cry || by < 0) return 'paint';
            if (by < beltTrim || by > topFrame) return 'gloss';
            const zN = bz / L;
            for (const [a, b] of windows) {
                if (zN > a + frame && zN < b - frame) return 'glass';
                if (zN >= a && zN <= b) return 'gloss';
            }
            if (c.bBlack) {
                for (let k = 0; k < windows.length - 1; k++) if (zN > windows[k][1] && zN < windows[k + 1][0]) return 'gloss';
            }
            return 'paint';
        },
        axes(quality, far = false) {
            const s = far ? 3 : quality === 'high' ? 1.1 : quality === 'medium' ? 1.35 : 2.3;
            const zone = far ? 2 : quality === 'low' ? 2 : 3;
            const zLines = far ? [] : windows.flatMap(([a, b]) => [a, a + frame, b - frame, b]).map(v => v * L);
            const frit = far ? [] : [c.half - crx - 0.06, -(c.half - crx - 0.06)];
            return [
                gridAxis(-c.half, c.half, crx, 0.12 * s, { zone, extra: [0, ...frit] }),
                gridAxis(-cry, HC, cry, 0.07 * s, { zone, extra: far ? [0] : [0, beltTrim, 0.04, topFrame, HC - cry - 0.045] }),
                gridAxis(0, L, crz, 0.09 * s, { zone, extra: zLines }),
            ];
        },
    };

    // ---- surfaces for the parts: a point on a face from car coordinates (Newton on the two in-face coordinates)
    const faceAxes = { pz: [0, 1], nz: [0, 1], px: [2, 1], nx: [2, 1], py: [0, 2] };
    // the last solution per shell face: neighbouring points of a part start from it and converge in a step or two
    const memo = new Map();
    function onFace(spec, face, u, v, start) {
        const [iu, iv] = faceAxes[face];
        const key = `${spec === lower ? 'l' : 'c'}${face}`;
        const last = memo.get(key);
        let a = start[0];
        let b = start[1];
        if (last && Math.abs(last.u - u) + Math.abs(last.v - v) < 0.3) {
            a = last.a + (u - last.u);
            b = last.b + (v - last.v);
        }
        let hit = surfacePoint(spec, face, a, b);
        for (let k = 0; k < 8; k++) {
            const ru = u - hit.p.getComponent(iu);
            const rv = v - hit.p.getComponent(iv);
            if (Math.abs(ru) + Math.abs(rv) < 2e-4) break;
            const e = 0.01;
            const pa = surfacePoint(spec, face, a + e, b).p;
            const pb = surfacePoint(spec, face, a, b + e).p;
            const j00 = (pa.getComponent(iu) - hit.p.getComponent(iu)) / e;
            const j01 = (pb.getComponent(iu) - hit.p.getComponent(iu)) / e;
            const j10 = (pa.getComponent(iv) - hit.p.getComponent(iv)) / e;
            const j11 = (pb.getComponent(iv) - hit.p.getComponent(iv)) / e;
            const det = j00 * j11 - j01 * j10;
            if (Math.abs(det) < 1e-9) break;
            // damped steps keep the solution on the face where the rounding flattens the mapping
            const da = (ru * j11 - rv * j01) / det;
            const db = (rv * j00 - ru * j10) / det;
            const limit = 0.25;
            a += Math.max(-limit, Math.min(limit, da));
            b += Math.max(-limit, Math.min(limit, db));
            hit = surfacePoint(spec, face, a, b);
        }
        memo.set(key, { u, v, a, b });
        return hit;
    }

    const design = {
        key,
        p,
        nose: p.nose,
        tail: p.tail,
        /** Half the overall width (flares included). */
        halfWidth: A + (p.flare ?? 0),
        halfTrack: p.halfTrack,
        tyre: p.tyre,
        arch: p.arch,
        archY,
        tub,
        lower,
        cabin,
        topLine,
        bottomLine,
        /** The half width of the body side at z and height y (no flares). */
        sideAt: (z, y) => {
            const yN = clamp01((y - bottomLine(z)) / (topLine(z) - bottomLine(z)));
            return A * plan(z) * section(yN);
        },
        /** Lower-body surface point on the nose / tail / side / top at car coordinates (approximately inverted). */
        front: (x, y) => onFace(lower, 'pz', x, y, [x, y - bottomLine(p.nose)]),
        rear: (x, y) => onFace(lower, 'nz', x, y, [x, y - bottomLine(p.tail)]),
        side: (sign, z, y) => onFace(lower, sign > 0 ? 'px' : 'nx', z, y, [z, y - bottomLine(z)]),
        top: (x, z) => onFace(lower, 'py', x, z, [x, z]),
        /** Glasshouse surface points: windscreen, rear window (x, car y), sides (sign, car z, car y), roof (x, car z). */
        windscreen: (x, y) => onFace(cabin, 'pz', x, y, [x, (y - p.belt) * 0.9]),
        rearWindow: (x, y) => onFace(cabin, 'nz', x, y, [x, (y - p.belt) * 0.9]),
        roof: (x, z) => onFace(cabin, 'py', x, z, [x, ((z - c.roofRear) / (c.roofFront - c.roofRear)) * L]),
        /** Builds the two shells of a quality as buckets of geometry. */
        shells(quality, far = false) {
            const l = buildShell({ ...lower, axes: lower.axes(quality, far) });
            const g = buildShell({ ...cabin, axes: cabin.axes(quality, far) });
            return { lower: l, cabin: g };
        },
        livery: liveryLayout(p, A, H, rx, ry, topLine),
    };
    return design;
}

/** Where the livery atlas draws doors, panel gaps and the fuel flap of a body (model-livery.js). */
function liveryLayout(p, A, H, rx, ry, topLine) {
    const g = { A, y0: 0, y1: H, rx, ry };
    // the girth of a height on the side at the doors (the nominal box there spans sill..belt)
    const sideT = y => girth(A, Math.min(H - ry - 0.001, Math.max(ry + 0.001, y - p.sill)), g);
    const doorTop = p.belt - 0.035;
    const doors = p.doors.map(d => ({ ...d, top: doorTop, bottom: p.sill + 0.035 }));
    const front = Math.max(...p.doors.map(d => d.z1));
    const rear = Math.min(...p.doors.map(d => d.z0));
    const half = A - rx - 0.1;
    return {
        sideT,
        sill: p.sill,
        archY: WHEEL_RADIUS + 0.005,
        arch: p.arch,
        door: { z0: Math.max(rear, -0.8), z1: Math.min(front, 0.8), y0: p.sill + 0.07, y1: Math.min(p.belt - 0.08, p.sill + 0.62) },
        doors,
        bonnet: { z0: p.cabin.ws + 0.06, z1: p.nose - 0.14, half },
        boot: p.cabin.rw < p.tail + 0.4 ? null : { z0: p.cabin.rw - 0.04, z1: p.tail + 0.1, half },
        bumpers: [
            { z: p.nose - 0.42, y0: WHEEL_RADIUS + p.arch * 0.75, y1: Math.min(topLine(p.nose - 0.42) - 0.06, WHEEL_RADIUS + p.arch + 0.12) },
            { z: p.tail + 0.4, y0: WHEEL_RADIUS + p.arch * 0.75, y1: Math.min(topLine(p.tail + 0.4) - 0.06, WHEEL_RADIUS + p.arch + 0.12) },
        ],
        fuel: { z: -WHEELBASE / 2 + 0.05, y: p.belt - 0.12 },
    };
}
