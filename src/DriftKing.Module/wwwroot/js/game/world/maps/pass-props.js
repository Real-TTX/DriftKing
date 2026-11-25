// DriftKing · maps/pass-props.js – the furniture of the Tenjō-Pass: sodium lamps over the hairpins (real pool lights), blue chevron
// boards around the outside of every sharp bend, yellow diamond warning signs before them, round convex traffic mirrors at the blind
// hairpins, concrete utility poles with crossarms, insulators, a transformer here and there and sagging wires, kilometre posts every
// 100 m. Signs are retroreflective (they light up in the headlights). Everything stands behind the guardrail or on top of the cut.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries, rng } from '../../render/kit.js';
import { LIGHT_PRESETS } from '../../render/lights.js';
import { buildLamps } from '../props.js';
import { EDGE, retroMaterial } from './pass-layout.js';
import { addInstances } from './pass-road.js';

/**
 * Builds the furniture into ctx.root.
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 * @param {{ avoid?: { s0: number, s1: number }[] }} [options] stretches without poles and posts (the lay-by)
 */
export function buildProps(ctx, layout, { avoid = [] } = {}) {
    const atlas = signAtlas();
    const signs = { faces: [], boards: [], posts: [] };
    buildHairpins(ctx, layout, signs);
    buildKilometrePosts(ctx, layout, signs, avoid);
    buildRoadSigns(ctx, layout, signs);
    buildSigns(ctx, signs, atlas);
    buildPoles(ctx, layout, avoid);
}

// ---------------------------------------------------------------- the sign atlas

/** 4 × 2 cells of 128²: chevron right/left, hairpin warning right/left, bends warning right/left, falling rocks, a white plate. */
function signAtlas() {
    return canvasTexture(512, 256, (c) => {
        const cell = (col, row, draw) => {
            c.save();
            c.translate(col * 128, row * 128);
            draw();
            c.restore();
        };
        const chevron = dir => () => {
            c.fillStyle = '#1d4fa0';
            c.fillRect(4, 4, 120, 120);
            c.strokeStyle = '#f4f6ff';
            c.lineWidth = 4;
            c.strokeRect(8, 8, 112, 112);
            c.fillStyle = '#f4f6ff';
            c.beginPath();
            const m = dir > 0 ? 1 : -1;
            const cx = 64;
            c.moveTo(cx - 26 * m, 22);
            c.lineTo(cx + 22 * m, 64);
            c.lineTo(cx - 26 * m, 106);
            c.lineTo(cx - 8 * m, 106);
            c.lineTo(cx + 40 * m, 64);
            c.lineTo(cx - 8 * m, 22);
            c.closePath();
            c.fill();
        };
        const diamond = symbol => () => {
            c.translate(64, 64);
            c.rotate(Math.PI / 4);
            c.fillStyle = '#f2c018';
            c.fillRect(-43, -43, 86, 86);
            c.strokeStyle = '#141414';
            c.lineWidth = 5;
            c.strokeRect(-38, -38, 76, 76);
            c.rotate(-Math.PI / 4);
            c.strokeStyle = '#141414';
            c.fillStyle = '#141414';
            c.lineWidth = 7;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            symbol();
        };
        const hairpin = dir => () => {
            const m = dir;
            c.beginPath();
            c.moveTo(-10 * m, 30);
            c.lineTo(-10 * m, -6);
            c.arc(4 * m, -6, 14, Math.PI, 0, m < 0);
            c.lineTo(18 * m, 16);
            c.stroke();
            c.beginPath();
            c.moveTo(18 * m - 9, 12);
            c.lineTo(18 * m, 26);
            c.lineTo(18 * m + 9, 12);
            c.closePath();
            c.fill();
        };
        const bends = dir => () => {
            const m = dir;
            c.beginPath();
            c.moveTo(-4 * m, 32);
            c.bezierCurveTo(-24 * m, 14, 18 * m, 4, -2 * m, -16);
            c.lineTo(4 * m, -22);
            c.stroke();
            c.beginPath();
            c.moveTo(4 * m - 8, -16);
            c.lineTo(8 * m, -32);
            c.lineTo(4 * m + 10, -20);
            c.closePath();
            c.fill();
        };
        const rocks = () => {
            c.beginPath();
            c.moveTo(-30, 30);
            c.lineTo(-30, -26);
            c.lineTo(-12, -18);
            c.lineTo(-18, 30);
            c.closePath();
            c.fill();
            for (const [x, y, r] of [[2, -8, 6], [12, 8, 5], [20, 24, 7], [6, 26, 4]]) {
                c.beginPath();
                c.arc(x, y, r, 0, Math.PI * 2);
                c.fill();
            }
        };
        cell(0, 0, chevron(1));
        cell(1, 0, chevron(-1));
        cell(2, 0, diamond(hairpin(1)));
        cell(3, 0, diamond(hairpin(-1)));
        cell(0, 1, diamond(bends(1)));
        cell(1, 1, diamond(bends(-1)));
        cell(2, 1, diamond(rocks));
        // the speed limit: a red ring on white, blue numbers (transparent around the disc)
        cell(3, 1, () => {
            c.fillStyle = '#c81e24';
            c.beginPath();
            c.arc(64, 64, 60, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#f4f6ff';
            c.beginPath();
            c.arc(64, 64, 46, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#1d3f9a';
            c.font = 'bold 50px Inter, Arial, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('40', 64, 67);
        });
    });
}

const CELL = { chevronRight: [0, 0], chevronLeft: [1, 0], hairpinRight: [2, 0], hairpinLeft: [3, 0], bendsRight: [0, 1], bendsLeft: [1, 1], rocks: [2, 1], limit: [3, 1] };

/** A sign face (quad w × h) at (x, y, z) facing yaw, showing an atlas cell. */
function face(signs, cell, x, y, z, yaw, w, h) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    const [col, row] = cell;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 2);
    g.rotateY(yaw);
    g.translate(x, y, z);
    signs.faces.push(g);
}

function buildSigns(ctx, signs, atlas) {
    const { root, materials, quality } = ctx;
    if (signs.faces.length) {
        // double sided: a chevron seen from behind points the other way – right for the traffic coming from there
        const mesh = new THREE.Mesh(mergeGeometries(signs.faces), retroMaterial(0xffffff, 2.6, { map: atlas, side: THREE.DoubleSide, base: 0.16, near: 18, far: 110, alphaTest: 0.5 }));
        root.add(mesh);
    } else {
        atlas.dispose();
    }
    if (signs.boards.length) root.add(new THREE.Mesh(mergeGeometries(signs.boards), materials.metal({ color: 0x8a8e94, roughness: 0.5 })));
    if (signs.posts.length) {
        const post = new THREE.CylinderGeometry(0.035, 0.035, 1, quality === 'low' ? 5 : 8, 1, true).translate(0, 0.5, 0);
        addInstances(root, post, materials.metal({ color: 0xa4a8ad, roughness: 0.45 }), signs.posts);
    }
}

// ---------------------------------------------------------------- hairpins: lamps, chevrons, warnings, mirrors

function buildHairpins(ctx, layout, signs) {
    const { root, course, glows, pools, materials, quality } = ctx;
    const lamps = [];
    const mirrors = [];
    for (const turn of layout.turns) {
        const out = -turn.dir; // the outside of the bend
        const sFrom = turn.from * course.step;
        const sTo = turn.to * course.step;
        // chevrons every 5–7 m around the outside, facing the arriving cars
        const spacing = turn.radius < 22 ? 5.5 : 8;
        for (let s = sFrom - 4; s <= sTo + 4; s += spacing) {
            const p = course.at(s);
            if (!layout.isValley(p.index, out)) continue;
            const d = EDGE.post + 0.28;
            const x = p.x + p.tz * d * out;
            const z = p.z - p.tx * d * out;
            const yaw = Math.atan2(-p.tx, -p.tz);
            face(signs, turn.dir > 0 ? CELL.chevronLeft : CELL.chevronRight, x, p.y + 1.25, z, yaw, 0.46, 0.58);
            signs.posts.push({ x, y: p.y - 0.1, z, sy: 1.05 });
        }
        // a warning sign 55 m before the bend on the side with a guardrail (the left one if both)
        const sWarn = sFrom - 55;
        const w = course.at(sWarn);
        const side = layout.isValley(w.index, 1) ? 1 : layout.isValley(w.index, -1) ? -1 : 0;
        if (side) {
            const d = EDGE.post + 0.5;
            const x = w.x + w.tz * d * side;
            const z = w.z - w.tx * d * side;
            const yaw = Math.atan2(-w.tx, -w.tz);
            const cell = turn.hairpin ? (turn.dir > 0 ? CELL.hairpinLeft : CELL.hairpinRight) : turn.dir > 0 ? CELL.bendsLeft : CELL.bendsRight;
            face(signs, cell, x + Math.sin(yaw) * 0.012, w.y + 2.15, z + Math.cos(yaw) * 0.012, yaw, 0.9, 0.9);
            signs.boards.push(new THREE.BoxGeometry(0.6, 0.6, 0.012).rotateZ(Math.PI / 4).rotateY(yaw).translate(x, w.y + 2.15, z));
            signs.posts.push({ x: x - Math.sin(yaw) * 0.045, y: w.y - 0.1, z: z - Math.cos(yaw) * 0.045, sy: 2.25 });
        }
        if (!turn.hairpin && turn.radius > 30) continue;
        // a sodium lamp at the apex, reaching over the road from the outside
        const a = course.at(turn.apex * course.step);
        if (layout.isValley(a.index, out)) {
            const d = EDGE.post + 1.1;
            lamps.push({ x: a.x + a.tz * d * out, y: a.y - 0.1, z: a.z - a.tx * d * out, yaw: Math.atan2(-a.tz * out, a.tx * out) });
        }
        // a convex mirror after the apex, turned to the cars coming into the bend
        if (turn.hairpin) {
            const m = course.at(turn.apex * course.step + 6);
            const entry = course.at(sFrom - 14);
            if (layout.isValley(m.index, out)) {
                const d = EDGE.post + 0.55;
                const x = m.x + m.tz * d * out;
                const z = m.z - m.tx * d * out;
                mirrors.push({ x, y: m.y - 0.1, z, yaw: Math.atan2(entry.x - x, entry.z - z) });
            }
        }
    }
    // the lamps: world/props.js (registers a real light per pole with ctx.lights)
    if (lamps.length) {
        const before = ctx.lights.sources?.length ?? 0;
        buildLamps(root, lamps, glows, pools, { colour: 0xffa95a, height: 8.2, arm: 2.4, pool: 13, strength: 0.55, lights: ctx.lights, materials, preset: 'sodium' });
        if ((ctx.lights.sources?.length ?? 0) === before) {
            for (const l of lamps) ctx.lights.add({ x: l.x + Math.sin(l.yaw) * 2.2, y: l.y + 8.0, z: l.z + Math.cos(l.yaw) * 2.2, ...LIGHT_PRESETS.sodium });
        }
    }
    if (mirrors.length) buildMirrors(ctx, mirrors);
    void quality;
}

/** Round convex traffic mirrors on orange poles: chrome cap, orange rim and back. */
function buildMirrors(ctx, spots) {
    const { root, materials, quality } = ctx;
    const segments = quality === 'low' ? 12 : 24;
    const radius = 0.42;
    const sphere = 1.7;
    const theta = Math.asin(radius / sphere);
    // the mirror cap faces +z (its centre at the origin of the head, 3 m up)
    const cap = new THREE.SphereGeometry(sphere, segments, 4, 0, Math.PI * 2, 0, theta).rotateX(Math.PI / 2).translate(0, 3.0, -sphere * Math.cos(theta) + 0.06);
    const rim = new THREE.TorusGeometry(radius + 0.02, 0.035, 6, segments).translate(0, 3.0, 0.0);
    const back = new THREE.CylinderGeometry(radius + 0.03, radius + 0.06, 0.08, segments).rotateX(Math.PI / 2).translate(0, 3.0, -0.05);
    const pole = new THREE.CylinderGeometry(0.038, 0.038, 3.0, 8, 1, true).translate(0, 1.5, -0.12);
    const bracket = new THREE.BoxGeometry(0.06, 0.06, 0.14).translate(0, 3.0, -0.12);
    addInstances(root, cap, materials.chrome({ color: 0xd4d6da, roughness: 0.06 }), spots);
    addInstances(root, mergeGeometries([rim, back, pole, bracket]), materials.painted({ color: 0xe0581c, roughness: 0.5 }), spots);
}

/** Speed limit and falling-rock signs along the straights, on the guardrail side (round boards on a post, a grey back). */
function buildRoadSigns(ctx, layout, signs) {
    const { course } = ctx;
    const place = (s, cell, round) => {
        const p = course.at(s);
        const side = layout.isValley(p.index, 1) ? 1 : layout.isValley(p.index, -1) ? -1 : 0;
        if (!side) return;
        const d = EDGE.post + 0.5;
        const x = p.x + p.tz * d * side;
        const z = p.z - p.tx * d * side;
        const yaw = Math.atan2(-p.tx, -p.tz);
        face(signs, cell, x + Math.sin(yaw) * 0.012, p.y + 2.1, z + Math.cos(yaw) * 0.012, yaw, 0.62, 0.62);
        signs.boards.push(round
            ? new THREE.CylinderGeometry(0.29, 0.29, 0.012, 20).rotateX(Math.PI / 2).rotateY(yaw).translate(x, p.y + 2.1, z)
            : new THREE.BoxGeometry(0.42, 0.42, 0.012).rotateZ(Math.PI / 4).rotateY(yaw).translate(x, p.y + 2.1, z));
        signs.posts.push({ x: x - Math.sin(yaw) * 0.045, y: p.y - 0.1, z: z - Math.cos(yaw) * 0.045, sy: 2.25 });
    };
    // the limit after the start and after the ridge, falling rocks where a rock cut follows
    for (const s of [35, course.length * 0.52, course.length * 0.71]) place(s, CELL.limit, true);
    let lastRock = -200;
    for (let i = 0; i < course.count; i += 5) {
        const s = i * course.step;
        if (layout.kind[i] !== 'rock' || s - lastRock < 260) continue;
        lastRock = s;
        place(s - 40, CELL.rocks, false);
    }
}

// ---------------------------------------------------------------- kilometre posts

function buildKilometrePosts(ctx, layout, signs, avoid) {
    const { root, course, materials } = ctx;
    const posts = [];
    const numbers = canvasTexture(256, 128, (c) => {
        c.fillStyle = '#f4f6ff';
        c.fillRect(0, 0, 256, 128);
        c.fillStyle = '#1d3f8a';
        c.font = 'bold 26px Inter, Arial, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (let k = 0; k < 16; k++) {
            const col = k % 4;
            const row = Math.floor(k / 4);
            c.fillText(((k + 1) / 10).toFixed(1), col * 64 + 32, row * 32 + 17);
        }
    });
    const plates = [];
    for (let k = 1; k * 100 < course.length - 20; k++) {
        const s = k * 100;
        if (avoid.some(a => s > a.s0 - 10 && s < a.s1 + 10)) continue;
        const p = course.at(s);
        const side = layout.isValley(p.index, 1) ? 1 : layout.isValley(p.index, -1) ? -1 : 0;
        if (!side) continue;
        const d = EDGE.post + 0.35;
        const x = p.x + p.tz * d * side;
        const z = p.z - p.tx * d * side;
        posts.push({ x, y: p.y - 0.05, z, yaw: Math.atan2(p.tx, p.tz) });
        // the plate on both faces of the post (one per direction)
        for (const dir of [1, -1]) {
            const g = new THREE.PlaneGeometry(0.11, 0.055);
            const uv = g.attributes.uv;
            const cell = Math.min(15, k - 1);
            const col = cell % 4;
            const row = Math.floor(cell / 4);
            for (let v = 0; v < uv.count; v++) uv.setXY(v, (col + uv.getX(v)) / 4, 1 - (row + 1 - uv.getY(v)) / 4);
            const yaw = Math.atan2(p.tx, p.tz) + (dir > 0 ? Math.PI : 0);
            g.rotateY(yaw);
            g.translate(x + Math.sin(yaw) * 0.062, p.y + 0.62, z + Math.cos(yaw) * 0.062);
            plates.push(g);
        }
    }
    if (posts.length) {
        addInstances(root, new THREE.BoxGeometry(0.12, 0.75, 0.12).translate(0, 0.375, 0), materials.concrete({ color: 0xe4e2dc, seams: false, stains: false }), posts);
        root.add(new THREE.Mesh(mergeGeometries(plates), retroMaterial(0xffffff, 1.8, { map: numbers, base: 0.2, near: 10, far: 60 })));
    } else {
        numbers.dispose();
    }
    void signs;
}

// ---------------------------------------------------------------- utility poles and wires

function buildPoles(ctx, layout, avoid) {
    const { root, course, materials, quality } = ctx;
    const random = rng(8080);
    const poles = [];
    let side = -1;
    for (let s = 20; s < course.length - 25; s += 36 + random() * 10) {
        if (avoid.some(a => s > a.s0 - 6 && s < a.s1 + 6)) continue;
        const p = course.at(s);
        // stay on the valley side when it is there; otherwise on top of the cut
        if (!layout.isValley(p.index, side) && layout.isValley(p.index, -side)) side = -side;
        const d = layout.isValley(p.index, side) ? EDGE.shoulder + 1.0 : layout.startOf(p.index, side) + 0.9;
        const x = p.x + p.tz * d * side;
        const z = p.z - p.tx * d * side;
        // never on another leg of the road
        const at = layout.locate(x, z);
        if (!at || at.d < at.start + 0.4) continue;
        const y = layout.groundAt(x, z) - 0.2;
        poles.push({ x, y, z, yaw: Math.atan2(p.tx, p.tz) + (random() - 0.5) * 0.2, transformer: random() < 0.18 });
    }
    if (poles.length < 2) return;
    const segments = quality === 'low' ? 6 : 10;
    const H = 11.5;
    // the pole: tapered concrete, a steel crossarm with three insulators, a bracket for the telephone cable
    const shaft = new THREE.CylinderGeometry(0.095, 0.16, H, segments, 1, true).translate(0, H / 2, 0);
    const concrete = materials.concrete({ color: 0xc6c4bc, seams: false, stains: true });
    addInstances(root, shaft, concrete, poles, { shadow: quality === 'high' });
    const arm = new THREE.BoxGeometry(1.9, 0.09, 0.09).translate(0, H - 0.45, 0);
    const brace = new THREE.BoxGeometry(0.05, 0.6, 0.05).rotateZ(0.9).translate(0.35, H - 0.75, 0);
    const brace2 = new THREE.BoxGeometry(0.05, 0.6, 0.05).rotateZ(-0.9).translate(-0.35, H - 0.75, 0);
    const bracket = new THREE.BoxGeometry(0.5, 0.06, 0.06).translate(0.2, H - 3.6, 0);
    addInstances(root, mergeGeometries([arm, brace, brace2, bracket]), materials.metal({ color: 0x5c6066, roughness: 0.55 }), poles);
    const insulators = [];
    for (const x of [-0.85, 0, 0.85]) insulators.push(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8).translate(x, H - 0.3, 0));
    addInstances(root, mergeGeometries(insulators), materials.plastic({ color: 0x8a8070, roughness: 0.25 }), poles);
    const transformers = poles.filter(p => p.transformer);
    if (transformers.length) {
        const can = mergeGeometries([
            new THREE.CylinderGeometry(0.32, 0.32, 1.0, segments).translate(0, H - 2.4, 0.42),
            new THREE.CylinderGeometry(0.34, 0.34, 0.06, segments).translate(0, H - 1.88, 0.42),
        ]);
        addInstances(root, can, materials.painted({ color: 0x7c8a86, roughness: 0.5 }), transformers);
    }
    // the wires: three power lines and one heavier telephone cable per span, sagging (parabola)
    const points = [];
    const attach = (pole, x, h) => {
        const c = Math.cos(pole.yaw);
        const s = Math.sin(pole.yaw);
        // the crossarm runs across the road direction (local x)
        return [pole.x + c * x, pole.y + h, pole.z - s * x];
    };
    for (let k = 0; k < poles.length; k++) {
        const a = poles[k];
        const b = poles[(k + 1) % poles.length];
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        if (span > 70) continue;
        const wires = [[-0.85, H - 0.22, 0.55], [0, H - 0.22, 0.6], [0.85, H - 0.22, 0.55], [0.4, H - 3.62, 0.9]];
        for (const [x, h, sagPer] of wires) {
            const p0 = attach(a, x, h);
            const p1 = attach(b, x, h);
            const sag = sagPer * (span / 40) ** 2;
            const steps = 10;
            let last = p0;
            for (let t = 1; t <= steps; t++) {
                const f = t / steps;
                const q = [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f - 4 * sag * f * (1 - f), p0[2] + (p1[2] - p0[2]) * f];
                points.push(...last, ...q);
                last = q;
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    root.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x121316 })));
}
