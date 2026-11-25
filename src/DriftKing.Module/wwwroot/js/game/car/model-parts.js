// DriftKing · car/model-parts.js – the details of a body, all placed on the sculpted shells (model-bodies.js surfaces) and sorted into the
// material buckets of models.js: lamp clusters (chrome bowls, projector lenses, DRL strips, segmented tail lamps, reverse and indicator
// lenses, clear covers), grilles and intakes with slats or mesh (an intercooler behind them when the car has a turbo), splitter, skirts,
// diffuser, exhaust tips, plates, mirrors on stalks, door handles, wipers, antenna, wings and spoilers, bonnet scoop and vents,
// the interior (dashboard with glowing gauges, steering wheel on the right, bucket seats, rear bench, a roll cage) and the neon tubes.
// Every part is plain geometry with position, normal, uv and colour: vertex colours tint the shared trim and lamp materials.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from '../render/kit.js';
import { atlasU, atlasV, PLAIN_UV, PLATE } from './model-livery.js';

const WHEELBASE = 2.5;

/** Geometry collected per material bucket, merged at the end (one draw call per bucket). */
export class Buckets {
    constructor() {
        this.lists = new Map();
    }

    /** Adds a geometry to a bucket; the colour (linear rgb, may exceed 1 for lamps) and a uv default are filled in. */
    add(name, geometry, colour = null, uv = null) {
        const g = geometry;
        if (!g.attributes.normal) g.computeVertexNormals();
        const count = g.attributes.position.count;
        if (uv) {
            const a = new Float32Array(count * 2);
            for (let k = 0; k < count; k++) {
                a[k * 2] = uv[0];
                a[k * 2 + 1] = uv[1];
            }
            g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
        } else if (!g.attributes.uv) {
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        if (colour || !g.attributes.color) {
            const c = colour ?? [1, 1, 1];
            const a = new Float32Array(count * 3);
            for (let k = 0; k < count; k++) a.set(c, k * 3);
            g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        }
        for (const name of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
        }
        if (!this.lists.has(name)) this.lists.set(name, []);
        this.lists.get(name).push(g);
        return g;
    }

    /** One merged geometry per bucket. */
    merge() {
        const out = {};
        for (const [name, list] of this.lists) out[name] = mergeGeometries(list);
        return out;
    }
}

// ---- shapes conformed to a surface

/** Rounds a point of a w × h rectangle (centred) onto the rounded rectangle with corner radius r (2D version of the shell's trick). */
function roundRect(x, y, w, h, r) {
    const ix = w / 2 - r;
    const iy = h / 2 - r;
    const qx = Math.max(-ix, Math.min(ix, x));
    const qy = Math.max(-iy, Math.min(iy, y));
    const dx = x - qx;
    const dy = y - qy;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9 || r <= 0) return [x, y];
    return [qx + (dx / l) * r, qy + (dy / l) * r];
}

/**
 * A rounded rectangle (centre cx, cy; size w × h; corner r; tilt: the shape's y grows by tilt × x – a sweep) laid onto a surface:
 * surface(a, b) → { p, n }; the grid ns × nt follows the surface's curvature; offset lifts it along the normal.
 * @returns {THREE.BufferGeometry}
 */
export function cap(surface, { cx, cy, w, h, r = 0, tilt = 0, offset = 0, ns = 6, nt = 3, flip = false }) {
    const pos = [];
    const nor = [];
    for (let i = 0; i <= ns; i++) {
        for (let j = 0; j <= nt; j++) {
            const [x, y] = roundRect(-w / 2 + (w * i) / ns, -h / 2 + (h * j) / nt, w, h, Math.min(r, w / 2, h / 2));
            const s = surface(cx + x, cy + y + tilt * x);
            pos.push(s.p.x + s.n.x * offset, s.p.y + s.n.y * offset, s.p.z + s.n.z * offset);
            nor.push(s.n.x, s.n.y, s.n.z);
        }
    }
    return gridGeometry(pos, nor, ns, nt, flip);
}

/** A ring between the outline of a rounded rectangle and its inset (border b) on a surface, from offset o0 (outside) to o1 (inside edge). */
export function ring(surface, { cx, cy, w, h, r = 0, tilt = 0, b = 0.01, o0 = 0, o1 = 0, n = 24, wall = 0 }) {
    const outline = (ww, hh, rr) => {
        const pts = [];
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            // a point on the square boundary at this angle, rounded
            const c = Math.cos(a);
            const s = Math.sin(a);
            const m = Math.max(Math.abs(c) / (ww / 2), Math.abs(s) / (hh / 2));
            pts.push(roundRect(c / m, s / m, ww, hh, Math.min(rr, ww / 2, hh / 2)));
        }
        return pts;
    };
    const outer = outline(w, h, r);
    const inner = outline(Math.max(0.002, w - 2 * b), Math.max(0.002, h - 2 * b), Math.max(0, r - b));
    const rows = wall > 0 ? [[outer, o0 - wall], [outer, o0], [inner, o1]] : [[outer, o0], [inner, o1]];
    const pos = [];
    const nor = [];
    for (const [pts, off] of rows) {
        for (let k = 0; k <= n; k++) {
            const [x, y] = pts[k % n];
            const s = surface(cx + x, cy + y + tilt * x);
            pos.push(s.p.x + s.n.x * off, s.p.y + s.n.y * off, s.p.z + s.n.z * off);
            nor.push(s.n.x, s.n.y, s.n.z);
        }
    }
    const g = gridGeometry(pos, nor, rows.length - 1, n, false);
    // the wall faces away from the lamp's centre line, the bezel top out of the body
    const centre = surface(cx, cy).p;
    const wallTriangles = wall > 0 ? n * 2 : 0;
    orient(g, (t, mid, normal) => (t < wallTriangles ? mid.clone().sub(centre) : normal));
    g.computeVertexNormals();
    return g;
}

/** Turns every triangle of an indexed geometry to face along want(triangle, centroid, vertex normal). */
function orient(g, want) {
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const index = g.index.array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const n0 = new THREE.Vector3();
    for (let i = 0; i < index.length; i += 3) {
        a.fromBufferAttribute(p, index[i]);
        b.fromBufferAttribute(p, index[i + 1]);
        c.fromBufferAttribute(p, index[i + 2]);
        mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        n0.fromBufferAttribute(nrm, index[i]);
        const target = want(i / 3, mid, n0);
        b.sub(a);
        c.sub(a);
        if (b.cross(c).dot(target) < 0) {
            const t = index[i + 1];
            index[i + 1] = index[i + 2];
            index[i + 2] = t;
        }
    }
}

/** An indexed grid of (ns + 1) × (nt + 1) points (rows of nt + 1); winding facing the given normals. */
function gridGeometry(pos, nor, ns, nt, flip) {
    const idx = [];
    const cols = nt + 1;
    for (let i = 0; i < ns; i++) {
        for (let j = 0; j < nt; j++) {
            const a = i * cols + j;
            const b = (i + 1) * cols + j;
            idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    faceOut(g, flip);
    return g;
}

/** Turns every triangle to face along its vertex normals (flip: against them). */
function faceOut(g, flip = false) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const index = g.index.array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const want = new THREE.Vector3();
    for (let i = 0; i < index.length; i += 3) {
        a.fromBufferAttribute(p, index[i]);
        b.fromBufferAttribute(p, index[i + 1]).sub(a);
        c.fromBufferAttribute(p, index[i + 2]).sub(a);
        b.cross(c);
        want.fromBufferAttribute(n, index[i]);
        if ((b.dot(want) < 0) !== flip) {
            const t = index[i + 1];
            index[i + 1] = index[i + 2];
            index[i + 2] = t;
        }
    }
    if (flip) {
        for (let k = 0; k < n.count; k++) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
    }
}

/** A geometry built in a local frame (+z = out of the surface, +y = up) placed at a surface point. */
function placeOn(geometry, s, offset = 0, spin = 0) {
    const m = new THREE.Matrix4();
    const eye = s.p.clone().addScaledVector(s.n, 1);
    const up = Math.abs(s.n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    m.lookAt(eye, s.p, up);
    if (spin) m.multiply(new THREE.Matrix4().makeRotationZ(spin));
    m.setPosition(s.p.clone().addScaledVector(s.n, offset));
    return geometry.applyMatrix4(m);
}

/** A thin box between two points (a rod, a wiper arm, a tube): width across, thickness along up. */
function bar(a, b, width, thickness, up = new THREE.Vector3(0, 1, 0)) {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.BoxGeometry(width, thickness, d.length());
    const m = new THREE.Matrix4().lookAt(b, a, up);
    m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    return g.applyMatrix4(m);
}

/** A round tube between two points (cage, antenna, exhaust). */
function tube(a, b, radius, segments = 8, open = false) {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(radius, radius, d.length(), segments, 1, open);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Matrix4().lookAt(b, a, Math.abs(d.y) / d.length() > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
    m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    return g.applyMatrix4(m);
}

/** A tube of radius r along points on a surface (normals: the surface's), its centre sunk half into the surface: a rolled lip. */
function sweep(points, normals, r, sides = 6) {
    const pos = [];
    const nor = [];
    const t = new THREE.Vector3();
    const bn = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)];
        const c = points[Math.min(points.length - 1, i + 1)];
        t.subVectors(c, a).normalize();
        const n = normals[i];
        bn.crossVectors(t, n).normalize();
        const centre = points[i].clone().addScaledVector(n, r * 0.2);
        for (let k = 0; k <= sides; k++) {
            const ang = (k / sides) * Math.PI * 2;
            const dir = n.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
            const v = centre.clone().addScaledVector(dir, r);
            pos.push(v.x, v.y, v.z);
            nor.push(dir.x, dir.y, dir.z);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const idx = [];
    for (let i = 0; i < points.length - 1; i++) {
        for (let k = 0; k < sides; k++) {
            const a = i * (sides + 1) + k;
            const c = (i + 1) * (sides + 1) + k;
            idx.push(a, c, c + 1, a, c + 1, a + 1);
        }
    }
    g.setIndex(idx);
    faceOut(g);
    return g;
}

/** UVs of a geometry inside an atlas rectangle (u0..u1 along its local x, t0..t1 along y) – the plates. */
function plateUV(g, w, h) {
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    g.computeBoundingBox();
    for (let k = 0; k < p.count; k++) {
        const fx = (p.getX(k) + w / 2) / w;
        const fy = (p.getY(k) + h / 2) / h;
        uv[k * 2] = atlasU(PLATE.u0 + (PLATE.u1 - PLATE.u0) * fx);
        uv[k * 2 + 1] = atlasV(PLATE.t0 + (PLATE.t1 - PLATE.t0) * fy);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
}

const BLACK = [0.012, 0.012, 0.014];
const DARK = [0.02, 0.02, 0.022];
const AMBER_OFF = [1.0, 0.36, 0.02].map(v => v * 0.32);
const WHITE_OFF = [0.32, 0.33, 0.35];

// ---- the lamp clusters

/** Headlamp layouts: a unit (centre x, y; size; corner; sweep) with its cells. x is the left lamp (+x); the right one mirrors it. */
const HEAD = {
    rect: { x: 0.53, y: 0.6, w: 0.4, h: 0.13, r: 0.02, tilt: 0, cells: [{ k: 'bowl', dx: -0.085, r: 0.052 }, { k: 'bowl', dx: 0.085, r: 0.052 }], cover: true },
    square: { x: 0.54, y: 0.6, w: 0.3, h: 0.17, r: 0.03, tilt: 0, cells: [{ k: 'bowl', dx: -0.03, r: 0.07 }, { k: 'amber', dx: 0.115, w: 0.05, h: 0.13 }], cover: true },
    slim: { x: 0.56, y: 0.6, w: 0.46, h: 0.11, r: 0.035, tilt: 0.07, cells: [{ k: 'proj', dx: -0.1, r: 0.036 }, { k: 'bowl', dx: 0.045, r: 0.046 }, { k: 'amber', dx: 0.175, w: 0.07, h: 0.07 }], cover: true },
    projector: { x: 0.56, y: 0.575, w: 0.42, h: 0.12, r: 0.05, tilt: 0.09, cells: [{ k: 'proj', dx: -0.1, r: 0.036 }, { k: 'proj', dx: 0.01, r: 0.036 }, { k: 'drl', dx: -0.02, dy: -0.043, w: 0.3, h: 0.012 }, { k: 'amber', dx: 0.155, w: 0.06, h: 0.06 }], cover: true },
    swept: { x: 0.6, y: 0.55, w: 0.44, h: 0.11, r: 0.045, tilt: 0.14, cells: [{ k: 'proj', dx: -0.11, r: 0.034 }, { k: 'proj', dx: -0.01, r: 0.03 }, { k: 'drl', dx: 0.01, dy: 0.038, w: 0.34, h: 0.012 }, { k: 'amber', dx: 0.16, w: 0.07, h: 0.05 }], cover: true },
    quad: { x: 0.6, y: 0.67, w: 0.34, h: 0.14, r: 0.02, tilt: 0, cells: [{ k: 'bowl', dx: -0.08, r: 0.056 }, { k: 'bowl', dx: 0.08, r: 0.056 }], cover: false },
};

/** Tail layouts (on the rear face; x is the left lamp at +x): cells red (level 0..1), reverse, amber, garnish across the middle. */
const TAIL = {
    strip: { x: 0.6, y: 0.72, w: 0.42, h: 0.13, r: 0.018, cells: [{ k: 'red', dx: 0.03, w: 0.34, h: 0.13, ribs: 3 }, { k: 'rev', dx: -0.175, w: 0.07, h: 0.13 }], garnish: { h: 0.1 } },
    vertical: { x: 0.65, y: 0.72, w: 0.17, h: 0.3, r: 0.02, cells: [{ k: 'red', dy: 0.07, w: 0.17, h: 0.16 }, { k: 'amber', dy: -0.04, w: 0.17, h: 0.06 }, { k: 'rev', dy: -0.11, w: 0.17, h: 0.08 }] },
    wide: { x: 0.56, y: 0.77, w: 0.5, h: 0.14, r: 0.03, cells: [{ k: 'red', dx: 0.08, w: 0.34, h: 0.14, ribs: 2 }, { k: 'amber', dx: -0.13, dy: 0.035, w: 0.14, h: 0.07 }, { k: 'rev', dx: -0.13, dy: -0.035, w: 0.14, h: 0.07 }] },
    round: { x: 0.57, y: 0.72, w: 0.38, h: 0.15, r: 0.075, cells: [{ k: 'round', dx: 0.095, r: 0.066 }, { k: 'round', dx: -0.095, r: 0.066, rev: true }] },
    slim: { x: 0.6, y: 0.75, w: 0.46, h: 0.085, r: 0.035, tilt: -0.06, cells: [{ k: 'red', dx: 0.04, w: 0.38, h: 0.085, line: true }, { k: 'rev', dx: -0.19, w: 0.06, h: 0.06 }] },
    bar: { x: 0.4, y: 0.77, w: 0.72, h: 0.12, r: 0.012, cells: [{ k: 'red', dx: 0.06, w: 0.6, h: 0.12, segments: 4 }, { k: 'rev', dx: -0.3, w: 0.1, h: 0.12 }] },
};

/** Builds both headlamps; returns the projector centres (lightMounts.head). */
function headlamps(b, d, quality) {
    const style = HEAD[d.p.lamps.head] ?? HEAD.rect;
    const centres = [];
    const segs = quality === 'low' ? 10 : 18;
    for (const side of [1, -1]) {
        const front = (x, y) => d.front(side * x, y);
        const face = (x, y) => {
            const s = front(x, y);
            return s;
        };
        const u = { cx: style.x, cy: style.y, w: style.w, h: style.h, r: style.r, tilt: style.tilt };
        // housing: the dark back of the lamp, a bezel wall up to the cover
        b.add('matte', cap(face, { ...u, offset: 0.004, ns: 8, nt: 3 }), [0.03, 0.03, 0.034]);
        b.add('gloss', ring(face, { ...u, b: 0.008, o0: 0.0, o1: 0.03, wall: 0.004, n: 32 }), BLACK);
        for (const c of style.cells) {
            const cx = style.x + (c.dx ?? 0);
            const cy = style.y + (c.dy ?? 0) + style.tilt * (c.dx ?? 0);
            const s = face(cx, cy);
            if (c.k === 'bowl' || c.k === 'proj') {
                // a chrome reflector bowl (concave) and the lamp in its centre: a big lens (projector) or a small bulb
                // the cap around the sphere's bottom pole turned to face out of the body (its inside shows), its floor just above the housing
                const bowl = new THREE.SphereGeometry(c.r, segs, 5, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3);
                bowl.rotateX(Math.PI / 2);
                bowl.translate(0, 0, c.r + 0.005);
                faceInward(bowl);
                b.add('chrome', placeOn(bowl, s, 0));
                const lens = c.k === 'proj'
                    ? new THREE.SphereGeometry(c.r * 0.62, segs, 6, 0, Math.PI * 2, 0, Math.PI * 0.45)
                    : new THREE.SphereGeometry(c.r * 0.28, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
                lens.rotateX(Math.PI / 2);
                b.add('lamp', placeOn(lens, s, c.k === 'proj' ? 0.006 : 0.01), [22, 21, 19]);
                if (c.k === 'proj') b.add('chrome', ring(face, { cx, cy, w: c.r * 1.55, h: c.r * 1.55, r: c.r, b: 0.006, o0: 0.016, o1: 0.016, n: segs }));
                centres.push(s.p.clone().addScaledVector(s.n, 0.02));
            } else if (c.k === 'drl') {
                b.add('lamp', cap(face, { cx, cy, w: c.w, h: c.h, r: c.h / 2, tilt: style.tilt, offset: 0.014, ns: 8, nt: 1 }), [7.5, 7.8, 8.2]);
            } else if (c.k === 'amber') {
                b.add('lamp', cap(face, { cx, cy, w: c.w, h: c.h, r: 0.012, tilt: style.tilt, offset: 0.01, ns: 2, nt: 2 }), AMBER_OFF);
            }
        }
        // the clear cover
        if (style.cover) b.add('lens', cap(face, { ...u, offset: 0.032, ns: 10, nt: 4 }));
        else b.add('gloss', ring(face, { ...u, b: 0.02, o0: 0.006, o1: 0.012, n: 32 }), BLACK);
    }
    return centres;
}

/** Turns a geometry's faces inwards (the inside of a bowl is what shows). */
function faceInward(g) {
    const index = g.index.array;
    for (let i = 0; i < index.length; i += 3) {
        const t = index[i + 1];
        index[i + 1] = index[i + 2];
        index[i + 2] = t;
    }
    const n = g.attributes.normal;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
}

/** Builds both tail lamps (and the garnish between them); returns the lamp centres (lightMounts.tail). */
function taillamps(b, d, quality) {
    const style = TAIL[d.p.lamps.tail] ?? TAIL.strip;
    const centres = [];
    const segs = quality === 'low' ? 12 : 24;
    for (const side of [1, -1]) {
        const face = (x, y) => d.rear(side * x, y);
        const tilt = style.tilt ?? 0;
        const u = { cx: style.x, cy: style.y, w: style.w, h: style.h, r: style.r, tilt };
        b.add('gloss', ring(face, { ...u, b: 0.008, o0: 0.0, o1: 0.012, wall: 0.004, n: 32 }), BLACK);
        b.add('matte', cap(face, { ...u, offset: 0.004, ns: 6, nt: 2 }), [0.04, 0.004, 0.004]);
        for (const c of style.cells) {
            const cx = style.x + (c.dx ?? 0);
            const cy = style.y + (c.dy ?? 0) + tilt * (c.dx ?? 0);
            if (c.k === 'red') {
                if (c.line) {
                    b.add('tail', cap(face, { cx, cy: cy + c.h * 0.3, w: c.w - 0.02, h: 0.016, r: 0.008, tilt, offset: 0.013, ns: 10, nt: 1 }), [1, 1, 1]);
                    b.add('tail', cap(face, { cx, cy: cy - 0.008, w: c.w - 0.02, h: c.h * 0.5, r: 0.012, tilt, offset: 0.01, ns: 10, nt: 1 }), [0.42, 0.42, 0.42]);
                } else {
                    const n = c.segments ?? 1;
                    const ribs = c.ribs ?? 1;
                    for (let k = 0; k < n; k++) {
                        const sx = cx - c.w / 2 + (c.w / n) * (k + 0.5);
                        for (let j = 0; j < ribs; j++) {
                            const sy = cy - c.h / 2 + (c.h / ribs) * (j + 0.5);
                            const level = ribs > 1 ? (j % 2 === 0 ? 0.62 : 1) : 1;
                            b.add('tail', cap(face, { cx: sx, cy: sy, w: c.w / n - 0.012, h: c.h / ribs - 0.01, r: 0.008, tilt, offset: 0.011, ns: 6, nt: 1 }), [level, level, level]);
                        }
                    }
                }
                centres.push(face(cx, cy).p);
            } else if (c.k === 'round') {
                const s = face(cx, cy);
                b.add('chrome', ring(face, { cx, cy, w: c.r * 2, h: c.r * 2, r: c.r, b: 0.008, o0: 0.006, o1: 0.012, n: segs }));
                b.add('tail', ring(face, { cx, cy, w: c.r * 2 - 0.016, h: c.r * 2 - 0.016, r: c.r, b: 0.022, o0: 0.012, o1: 0.012, n: segs }), [0.55, 0.55, 0.55]);
                if (c.rev) b.add('reverse', cap(face, { cx, cy, w: c.r * 0.9, h: c.r * 0.9, r: c.r * 0.45, offset: 0.012, ns: 4, nt: 4 }));
                else b.add('tail', cap(face, { cx, cy, w: c.r * 0.9, h: c.r * 0.9, r: c.r * 0.45, offset: 0.013, ns: 4, nt: 4 }), [1, 1, 1]);
                if (!c.rev) centres.push(s.p);
            } else if (c.k === 'rev') {
                b.add('reverse', cap(face, { cx, cy, w: c.w - 0.01, h: c.h - 0.012, r: 0.008, tilt, offset: 0.011, ns: 2, nt: 2 }));
            } else if (c.k === 'amber') {
                b.add('lamp', cap(face, { cx, cy, w: c.w - 0.01, h: c.h - 0.01, r: 0.008, tilt, offset: 0.011, ns: 2, nt: 2 }), AMBER_OFF);
            }
        }
    }
    // the garnish between the lamps: a dark red lens band
    if (style.garnish) {
        const inner = style.x - style.w / 2 - 0.01;
        b.add('gloss', cap((x, y) => d.rear(x, y), { cx: 0, cy: style.y, w: inner * 2, h: style.garnish.h, r: 0.01, offset: 0.006, ns: 12, nt: 1 }), [0.3, 0.012, 0.01]);
    }
    // left = +x first
    return centres.length >= 2 ? [centres[0], centres[Math.floor(centres.length / 2)]] : centres;
}

// ---- front and rear

/** Grille openings and intakes per body: [cx, cy, w, h, r, kind] (kind: slats | mesh), mirrored pairs when side is set. */
const INTAKES = {
    coupe: [{ x: 0, y: 0.6, w: 0.5, h: 0.075, r: 0.012, kind: 'slats', n: 3 }, { x: 0, y: 0.3, w: 0.86, h: 0.1, r: 0.03, kind: 'slats', n: 2, main: true }, { x: 0.62, y: 0.33, w: 0.13, h: 0.05, r: 0.012, kind: 'amber', pair: true }],
    hatch: [{ x: 0, y: 0.6, w: 0.42, h: 0.1, r: 0.014, kind: 'slats', n: 4 }, { x: 0, y: 0.31, w: 0.78, h: 0.1, r: 0.03, kind: 'slats', n: 2, main: true }, { x: 0.58, y: 0.35, w: 0.1, h: 0.05, r: 0.01, kind: 'amber', pair: true }],
    sedan: [{ x: 0, y: 0.6, w: 0.46, h: 0.09, r: 0.02, kind: 'mesh' }, { x: 0, y: 0.3, w: 0.94, h: 0.13, r: 0.04, kind: 'mesh', main: true }, { x: 0.64, y: 0.34, w: 0.08, h: 0.08, r: 0.04, kind: 'fog', pair: true }],
    fastback: [{ x: 0, y: 0.31, w: 0.96, h: 0.15, r: 0.05, kind: 'mesh', main: true }, { x: 0.66, y: 0.33, w: 0.2, h: 0.09, r: 0.03, kind: 'mesh', pair: true }],
    wide: [{ x: 0, y: 0.29, w: 0.98, h: 0.18, r: 0.05, kind: 'mesh', main: true }, { x: 0.69, y: 0.3, w: 0.24, h: 0.13, r: 0.04, kind: 'mesh', pair: true }, { x: 0, y: 0.5, w: 0.36, h: 0.05, r: 0.02, kind: 'mesh' }],
    muscle: [{ x: 0, y: 0.66, w: 0.74, h: 0.16, r: 0.015, kind: 'slats', n: 5 }, { x: 0, y: 0.33, w: 1.0, h: 0.08, r: 0.02, kind: 'slats', n: 1, main: true }],
};

function front(b, d, variant, quality) {
    const face = (x, y) => d.front(x, y);
    const list = INTAKES[d.key] ?? INTAKES.coupe;
    for (const it of list) {
        for (const side of it.pair ? [1, -1] : [1]) {
            const cx = it.x * side;
            const u = { cx, cy: it.y, w: it.w, h: it.h, r: it.r };
            if (it.kind === 'amber' || it.kind === 'fog') {
                b.add('gloss', ring(face, { ...u, b: 0.006, o0: 0, o1: 0.008, wall: 0.003, n: 20 }), BLACK);
                b.add('lamp', cap(face, { ...u, w: it.w - 0.012, h: it.h - 0.012, offset: 0.008, ns: 4, nt: 2 }), it.kind === 'fog' ? WHITE_OFF : AMBER_OFF);
                continue;
            }
            // the opening: a dark back, a black surround, slats or a mesh across
            b.add('matte', cap(face, { ...u, offset: 0.003, ns: 10, nt: 2 }), [0.006, 0.006, 0.007]);
            b.add('gloss', ring(face, { ...u, b: 0.012, o0: 0.0, o1: 0.012, wall: 0.004, n: 28 }), BLACK);
            if (it.main && variant.intercooler) {
                // the intercooler core behind the slats (aluminium fins) with its end tanks
                b.add('matte', cap(face, { ...u, w: it.w - 0.05, h: it.h - 0.025, offset: 0.006, ns: 10, nt: 2 }), [0.16, 0.165, 0.17]);
                for (const e of [-1, 1]) {
                    const s = face(cx + e * (it.w / 2 - 0.035), it.y);
                    b.add('chrome', placeOn(new THREE.BoxGeometry(0.04, it.h - 0.03, 0.03), s, 0.008));
                }
            }
            if (it.kind === 'slats') {
                const n = it.n ?? 3;
                for (let k = 0; k < n; k++) {
                    const y = it.y - it.h / 2 + (it.h / (n + 1)) * (k + 1);
                    b.add('gloss', cap(face, { cx, cy: y, w: it.w - 0.03, h: 0.012, r: 0.004, offset: 0.012, ns: 8, nt: 1 }), BLACK);
                }
            } else {
                // a diamond mesh: thin bars both ways
                const pitch = 0.032;
                const nx = Math.floor((it.w - 0.03) / pitch);
                for (let k = 0; k <= nx; k++) {
                    const x = cx - (it.w - 0.03) / 2 + k * pitch;
                    b.add('gloss', cap(face, { cx: x, cy: it.y, w: 0.005, h: it.h - 0.022, offset: 0.009, ns: 1, nt: 2, tilt: 0 }), [0.025, 0.025, 0.028]);
                }
                const ny = Math.max(1, Math.floor((it.h - 0.02) / pitch));
                for (let k = 1; k < ny + 1; k++) {
                    const y = it.y - it.h / 2 + ((it.h) / (ny + 1)) * k;
                    b.add('gloss', cap(face, { cx, cy: y, w: it.w - 0.024, h: 0.005, offset: 0.01, ns: 8, nt: 1 }), [0.025, 0.025, 0.028]);
                }
            }
        }
    }
    // splitter: a thin black lip under the bumper following the nose
    const yb = d.bottomLine(d.nose) + 0.012;
    const hw = d.halfWidth - (d.p.flare ? d.p.flare : 0) - 0.16;
    const pts = [];
    const n = quality === 'low' ? 8 : 14;
    for (let k = 0; k <= n; k++) {
        const x = -hw + (2 * hw * k) / n;
        const s = face(x, yb);
        pts.push(new THREE.Vector3(x, yb - 0.012, s.p.z + 0.045 - 0.02 * Math.abs(x / hw) ** 3));
    }
    b.add('matte', slab(pts, -0.32, 0.012), [0.012, 0.012, 0.013]);
    // tow strap on the tuned bodies
    if (d.key === 'wide' || d.key === 'fastback') {
        const s = face(0.36, d.bottomLine(d.nose) + 0.08);
        b.add('gloss', placeOn(new THREE.BoxGeometry(0.035, 0.09, 0.006).translate(0, -0.04, 0), s, 0.012), [0.5, 0.02, 0.015]);
    }
    // the front plate (offset on some bodies, none on the widebody)
    if (d.key !== 'wide') plate(b, face, d.p.plate, d.key === 'muscle' ? 0.46 : 0.45);
}

/** A horizontal slab from a front edge (points along x) back by depth (negative z), thickness t: splitter, diffuser. */
function slab(front, depth, t) {
    const pos = [];
    const edge = new THREE.Vector3(0, 0, -Math.sign(depth));
    // each quad turned to face its side: the top up, the bottom down, the edge away from the slab
    const add = (a, b, c, e, want) => {
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (n.dot(want) < 0) pos.push(a, c, b, a, e, c);
        else pos.push(a, b, c, a, c, e);
    };
    for (let k = 0; k < front.length - 1; k++) {
        const a = front[k];
        const c = front[k + 1];
        const ab = a.clone().setZ(a.z + depth);
        const cb = c.clone().setZ(c.z + depth);
        const up = v => v.clone().setY(v.y + t);
        add(up(a), up(c), up(cb), up(ab), new THREE.Vector3(0, 1, 0));
        add(a, ab, cb, c, new THREE.Vector3(0, -1, 0));
        add(a, c, up(c), up(a), edge);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pos);
    g.computeVertexNormals();
    return g;
}

/** A licence plate on a face (the picture is in the livery atlas): a dark frame and the plate. */
function plate(b, face, x, y) {
    const w = 0.33;
    const h = 0.165;
    const s = face(x, y);
    const g = new RoundedBoxGeometry(w, h, 0.006, 1, 0.008);
    plateUV(g, w, h);
    b.add('paint', placeOn(g, s, 0.012));
    b.add('gloss', placeOn(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.008), s, 0.006), BLACK);
}

function rear(b, d, variant, quality) {
    const face = (x, y) => d.rear(x, y);
    const p = d.p;
    // the plate in a dark recess between the lamps or below the garnish
    const plateY = p.lamps.tail === 'strip' || p.lamps.tail === 'bar' ? 0.54 : 0.58;
    plate(b, face, 0, plateY);
    // diffuser: a black slab with fins under the rear bumper
    const yb = d.bottomLine(d.tail) + 0.005;
    const hw = d.halfWidth - (p.flare ?? 0) - 0.22;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
        const x = -hw + (2 * hw * k) / 10;
        pts.push(new THREE.Vector3(x, yb - 0.02, face(x, yb + 0.02).p.z - 0.015));
    }
    pts.forEach(v => (v.z = Math.min(v.z, pts[5].z + 0.02)));
    // the slab extends forward under the car (positive depth)
    const diff = slab(pts.map(v => v.clone()), 0.3, 0.012);
    b.add('matte', diff, [0.012, 0.012, 0.013]);
    for (let k = -2; k <= 2; k++) {
        const x = k * 0.16;
        const z = face(x, yb + 0.02).p.z;
        b.add('matte', new THREE.BoxGeometry(0.008, 0.07, 0.26).translate(x, yb - 0.04, z + 0.12), [0.016, 0.016, 0.018]);
    }
    // exhaust tips: chrome tubes with sooty insides
    const tips = [];
    const r = (variant.bigExhaust || p.exhaust.big ? 0.05 : 0.041);
    const xs = [];
    if (p.exhaust.both) xs.push(p.exhaust.x, -p.exhaust.x);
    else xs.push(p.exhaust.x);
    const twin = p.exhaust.count === 2 && !p.exhaust.both;
    const ty = Math.max(0.24, d.bottomLine(d.tail) + 0.03);
    const segs = quality === 'low' ? 10 : 18;
    for (const x0 of xs) {
        for (const x of twin ? [x0 - 0.06 * Math.sign(x0 || 1), x0 + 0.06 * Math.sign(x0 || 1)] : [x0]) {
            const s = face(x, ty + 0.05);
            const zEnd = Math.min(s.p.z, d.tail + 0.2) - 0.07;
            const a = new THREE.Vector3(x, ty, zEnd + 0.16);
            const e = new THREE.Vector3(x, ty - 0.004, zEnd);
            b.add('chrome', tube(a, e, r, segs, true));
            const inner = tube(a, e.clone().add(new THREE.Vector3(0, 0, 0.004)), r * 0.86, segs, true);
            faceInward(inner);
            b.add('matte', inner, [0.006, 0.006, 0.006]);
            b.add('chrome', new THREE.TorusGeometry(r * 0.93, r * 0.08, 5, segs).translate(x, ty - 0.004, zEnd));
            b.add('matte', new THREE.CircleGeometry(r * 0.86, segs).rotateY(Math.PI).translate(x, ty - 0.004, zEnd + 0.06), [0.004, 0.004, 0.004]);
            tips.push(new THREE.Vector3(x, ty - 0.004, zEnd - 0.01));
        }
    }
    // the high-mounted brake lamp at the top of the rear window
    if (p.wing !== 'roof' && d.key !== 'coupe' && d.key !== 'muscle') {
        const s = d.rearWindow(0, p.cabin.roof - 0.07);
        b.add('gloss', placeOn(new RoundedBoxGeometry(0.34, 0.03, 0.02, 1, 0.008), s, 0.008), BLACK);
        b.add('tail', placeOn(new THREE.BoxGeometry(0.3, 0.012, 0.01), s, 0.016), [0.8, 0.8, 0.8]);
    }
    return tips;
}

// ---- sides

function sides(b, d, quality) {
    const p = d.p;
    const ws = p.cabin.ws;
    for (const sign of [1, -1]) {
        const side = (z, y) => d.side(sign, z, y);
        // side skirt: a black lip along the sill between the arches
        const z0 = -WHEELBASE / 2 + p.arch + 0.05;
        const z1 = WHEELBASE / 2 - p.arch - 0.05;
        const n = quality === 'low' ? 4 : 8;
        const pos = [];
        const nor = [];
        const rows = 4;
        for (let i = 0; i <= n; i++) {
            const z = z0 + ((z1 - z0) * i) / n;
            const s = side(z, p.sill + 0.07);
            const out = new THREE.Vector3(Math.sign(sign), 0, 0);
            const base = s.p.clone();
            const prof = [
                base.clone().addScaledVector(s.n, 0.002),
                base.clone().addScaledVector(out, 0.022).setY(p.sill + 0.04),
                base.clone().addScaledVector(out, 0.026).setY(p.sill - 0.01),
                base.clone().addScaledVector(out, -0.05).setY(p.sill - 0.03),
            ];
            prof.forEach(v => {
                pos.push(v.x, v.y, v.z);
                nor.push(out.x, 0.3, 0);
            });
        }
        const skirt = new THREE.BufferGeometry();
        skirt.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        skirt.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        const idx = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < rows - 1; j++) {
            const a = i * rows + j;
            const c = (i + 1) * rows + j;
            idx.push(a, c, c + 1, a, c + 1, a + 1);
        }
        skirt.setIndex(idx);
        faceOut(skirt);
        skirt.computeVertexNormals();
        b.add('matte', skirt, [0.014, 0.014, 0.016]);

        // door handles near the rear edge of each door
        for (const door of p.doors) {
            const s = side(door.z0 + 0.13, p.belt - 0.105);
            b.add('gloss', placeOn(new RoundedBoxGeometry(0.13, 0.03, 0.022, 1, 0.009), s, 0.004), BLACK);
        }
        // side repeater on the front wing
        const rep = side(WHEELBASE / 2 - p.arch - 0.12, Math.min(p.belt - 0.2, 0.68));
        b.add('lamp', placeOn(new RoundedBoxGeometry(0.06, 0.022, 0.01, 1, 0.006), rep, 0.003), AMBER_OFF);

        // mirror on a stalk at the front corner of the side window
        const base = side(ws - 0.12, p.belt - 0.03);
        const stalkEnd = base.p.clone().add(new THREE.Vector3(sign * 0.1, 0.08, -0.02));
        b.add('gloss', bar(base.p.clone().addScaledVector(base.n, -0.01), stalkEnd, 0.03, 0.022), BLACK);
        const housing = new RoundedBoxGeometry(0.17, 0.095, 0.085, 2, 0.032);
        // the front of the housing rounder and narrower
        const hp = housing.attributes.position;
        for (let k = 0; k < hp.count; k++) {
            const z = hp.getZ(k);
            if (z > 0) {
                hp.setY(k, hp.getY(k) * (1 - z * 1.6));
                hp.setX(k, hp.getX(k) * (1 - z * 0.9));
            }
        }
        housing.computeVertexNormals();
        housing.translate(sign * 0.075, 0.0, 0);
        housing.translate(stalkEnd.x, stalkEnd.y + 0.01, stalkEnd.z);
        b.add('paint', housing, null, PLAIN_UV);
        const glass = new THREE.PlaneGeometry(0.15, 0.075).rotateY(Math.PI);
        glass.translate(stalkEnd.x + sign * 0.075, stalkEnd.y + 0.01, stalkEnd.z - 0.0435);
        b.add('chrome', glass);

        // rolled lips around the wheel arches (they also soften the carved edge), the liner's inner wall behind each wheel
        for (const az of [WHEELBASE / 2, -WHEELBASE / 2]) {
            const wall = new THREE.Shape();
            const r = p.arch - 0.004;
            const low = p.sill - 0.06 - d.archY;
            wall.moveTo(r, low);
            for (let k = 0; k <= 16; k++) wall.lineTo(Math.cos((k / 16) * Math.PI) * r, Math.sin((k / 16) * Math.PI) * r);
            wall.lineTo(-r, low);
            const inner = new THREE.ShapeGeometry(wall, 1);
            // shape x → car z, shape y → car y; the wall faces out of the car
            const xIn = sign * (d.halfTrack - d.tyre / 2 - 0.07);
            inner.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
            inner.translate(xIn, d.archY, az);
            b.add('matte', inner, [0.012, 0.012, 0.013]);
            // the liner: a half cylinder over the wheel from the inner wall out to the body side, facing the axle
            const segs = quality === 'low' ? 10 : 18;
            const pos = [];
            const nor = [];
            for (let k = 0; k <= segs; k++) {
                const a = -0.15 + ((Math.PI + 0.3) * k) / segs;
                const z = az + Math.cos(a) * r;
                const y = d.archY + Math.sin(a) * r;
                const xOut = side(z, Math.max(y, p.sill + 0.02)).p.x - sign * 0.006;
                for (const x of [xIn, xOut]) {
                    pos.push(x, y, z);
                    nor.push(0, -Math.sin(a), -Math.cos(a));
                }
            }
            const liner = new THREE.BufferGeometry();
            liner.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            liner.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            const idx = [];
            for (let k = 0; k < segs; k++) idx.push(k * 2, k * 2 + 2, k * 2 + 3, k * 2, k * 2 + 3, k * 2 + 1);
            liner.setIndex(idx);
            faceOut(liner);
            b.add('matte', liner, [0.016, 0.016, 0.017]);
            const pts = [];
            const normals = [];
            const n = quality === 'low' ? 10 : 20;
            for (let k = 0; k <= n; k++) {
                const a = -0.1 + ((Math.PI + 0.2) * k) / n;
                const r = p.arch + 0.004;
                const s = side(az + Math.cos(a) * r, d.archY + Math.sin(a) * r);
                pts.push(s.p);
                normals.push(s.n);
            }
            b.add('paint', sweep(pts, normals, 0.012, quality === 'low' ? 4 : 6), null, PLAIN_UV);
        }

        // the widebody's bolted flares: bolt heads around the arches
        if (p.flare && quality !== 'low') {
            for (const az of [WHEELBASE / 2, -WHEELBASE / 2]) {
                for (let k = 0; k <= 8; k++) {
                    const a = Math.PI * (0.06 + (0.88 * k) / 8);
                    const z = az + Math.cos(a) * (p.arch + 0.045);
                    const y = d.archY + Math.sin(a) * (p.arch + 0.045);
                    const s = side(z, y);
                    b.add('chrome', placeOn(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 6).rotateX(Math.PI / 2), s, 0.002));
                }
            }
        }
    }
}

// ---- top: wipers, antenna, wings, scoop, vents

function top(b, d, quality) {
    const p = d.p;
    const c = p.cabin;
    // wipers parked along the bottom of the windscreen
    const yb = p.belt + 0.05;
    for (const [x0, x1] of [[-0.52, 0.02], [0.02, 0.54]]) {
        const a = d.windscreen(x0, yb).p;
        const e = d.windscreen(x1, yb + 0.035);
        b.add('gloss', bar(a.clone().addScaledVector(e.n, 0.014), e.p.clone().addScaledVector(e.n, 0.014), 0.014, 0.01, e.n), BLACK);
        b.add('gloss', placeOn(new THREE.CylinderGeometry(0.012, 0.014, 0.02, 8).rotateX(Math.PI / 2), d.windscreen(x0, yb - 0.005), 0.008), BLACK);
    }
    // antenna on the right rear wing
    const ant = d.top(-(d.halfWidth - (p.flare ?? 0) - 0.16), d.tail + 0.62);
    b.add('gloss', tube(ant.p, ant.p.clone().add(new THREE.Vector3(0, 0.52, -0.16)), 0.0035, 4), BLACK);
    b.add('gloss', placeOn(new THREE.CylinderGeometry(0.014, 0.016, 0.02, 8).rotateX(Math.PI / 2), ant, 0.005), BLACK);

    wing(b, d, quality);

    if (p.scoop) {
        // a bonnet scoop: a raised lofted hump open at the front
        const nx = 6;
        const nz = 6;
        const pos = [];
        const nor = [];
        const x0 = 0.27;
        const zA = c.ws + 0.45;
        const zB = zA + 0.62;
        for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= nz; j++) {
                const fx = -1 + (2 * i) / nx;
                const fz = j / nz;
                const s = d.top(fx * x0, zA + (zB - zA) * fz);
                const hgt = 0.085 * smoothstep(fz) * (1 - Math.abs(fx) ** 6);
                pos.push(s.p.x, s.p.y + hgt, s.p.z);
                nor.push(0, 1, 0);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        const idx = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
            const a = i * (nz + 1) + j;
            const e = (i + 1) * (nz + 1) + j;
            idx.push(a, e, e + 1, a, e + 1, a + 1);
        }
        g.setIndex(idx);
        faceOut(g);
        g.computeVertexNormals();
        b.add('paint', g, null, PLAIN_UV);
        // the opening at the front
        const front = d.top(0, zB);
        const opening = new THREE.PlaneGeometry(x0 * 1.7, 0.075).translate(0, 0.04, 0);
        opening.translate(0, front.p.y, front.p.z + 0.002);
        b.add('matte', opening, [0.004, 0.004, 0.005]);
    }
    if (p.vents) {
        // two vents in the bonnet above the engine: slats over a dark well, a black surround
        for (const sign of [1, -1]) {
            const surface = (x, z) => d.top(x, z);
            const u = { cx: sign * 0.33, cy: c.ws + 0.62, w: 0.24, h: 0.2, r: 0.03 };
            b.add('matte', cap(surface, { ...u, offset: 0.002, ns: 4, nt: 4 }), [0.006, 0.006, 0.007]);
            b.add('gloss', ring(surface, { ...u, b: 0.01, o0: 0.0, o1: 0.008, wall: 0.002, n: 20 }), BLACK);
            for (let k = 0; k < 5; k++) {
                b.add('gloss', cap(surface, { cx: u.cx, cy: u.cy - 0.075 + k * 0.0375, w: 0.21, h: 0.012, offset: 0.007, ns: 3, nt: 1 }), BLACK);
            }
        }
    }
}

function smoothstep(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}

/** Duck tail, roof spoiler, boot lip or a GT wing on stands. */
function wing(b, d, quality) {
    const p = d.p;
    const c = p.cabin;
    const hw = d.halfWidth - (p.flare ?? 0);
    if (p.wing === 'duck' || p.wing === 'lip') {
        // part of the shell: the boot lid kicks up (model-bodies.js)
        return;
    } else if (p.wing === 'roof') {
        // a spoiler extending the roof over the hatch glass, the high-mounted brake lamp under its trailing edge
        const n = quality === 'low' ? 6 : 10;
        const span = c.half - 0.06;
        const rows = [];
        for (let i = 0; i <= n; i++) {
            const x = -span + (2 * span * i) / n;
            const s = d.roof(x, c.roofRear + 0.06);
            const a = s.p.clone().add(new THREE.Vector3(0, 0.004, 0));
            const t = a.clone().add(new THREE.Vector3(0, -0.035, -0.26));
            const u = a.clone().add(new THREE.Vector3(0, -0.035, -0.04));
            rows.push([a, t, u]);
        }
        const tri = [];
        for (let i = 0; i < n; i++) {
            const [a0, t0, u0] = rows[i];
            const [a1, t1, u1] = rows[i + 1];
            tri.push(a0, a1, t1, a0, t1, t0, t0, t1, u1, t0, u1, u0);
        }
        for (const [a, t, u] of [rows[0], rows[n]]) tri.push(a, t, u);
        const g = new THREE.BufferGeometry().setFromPoints(tri);
        orientAwayFrom(g, new THREE.Vector3(0, c.roof - 0.4, c.roofRear));
        b.add('paint', g, null, PLAIN_UV);
        const mid = rows[Math.floor(n / 2)][1];
        b.add('tail', new THREE.BoxGeometry(0.3, 0.012, 0.012).translate(0, mid.y - 0.004, mid.z + 0.015), [0.8, 0.8, 0.8]);
    } else {
        // GT wing: an inverted airfoil on two stands with end plates (carbon black, or body colour on the fastback)
        const big = p.wing === 'gtBig';
        const span = big ? 1.62 : 1.44;
        const chord = big ? 0.31 : 0.27;
        const lift = big ? 0.34 : 0.27;
        const zc = d.tail + (big ? 0.3 : 0.27);
        const base = d.top(0, zc).p;
        const y = base.y + lift;
        const shape = new THREE.Shape();
        const thick = chord * 0.12;
        const pts = 10;
        // upper surface flat-ish, lower surface cambered (downforce): leading edge at x = 0, trailing at -chord
        for (let k = 0; k <= pts; k++) {
            const t = k / pts;
            const xx = -chord * t;
            const yy = thick * 0.35 * Math.sin(Math.PI * t) * (1 - t * 0.4);
            if (k === 0) shape.moveTo(xx, yy);
            else shape.lineTo(xx, yy);
        }
        for (let k = pts; k >= 0; k--) {
            const t = k / pts;
            shape.lineTo(-chord * t, -thick * (1.1 * Math.sqrt(t) - t) * 1.6 - thick * 0.1 * t);
        }
        const foil = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 1 });
        foil.rotateY(-Math.PI / 2);
        foil.translate(span / 2, 0, 0);
        foil.rotateX(big ? 0.1 : 0.07);
        foil.translate(0, y, zc + chord / 2);
        const carbon = big;
        if (carbon) b.add('gloss', foil, [0.02, 0.02, 0.022]);
        else b.add('paint', foil, null, PLAIN_UV);
        for (const sign of [1, -1]) {
            // the end plate: a thin trapezoid, taller at the trailing edge, its lower edge sweeping up to the front
            const ph = big ? 0.15 : 0.12;
            const pl = chord + 0.07;
            const outline = new THREE.Shape();
            // shape x runs to the rear (rotated: z = −x), y up
            outline.moveTo(-pl / 2, -ph * 0.25);
            outline.lineTo(-pl / 2, ph * 0.3);
            outline.lineTo(pl / 2, ph * 0.55);
            outline.lineTo(pl / 2, -ph * 0.45);
            outline.lineTo(-pl / 2 + 0.05, -ph * 0.4);
            const plate = new THREE.ExtrudeGeometry(outline, { depth: 0.007, bevelEnabled: false, curveSegments: 1 });
            plate.rotateY(Math.PI / 2);
            plate.translate(sign * (span / 2 + 0.002) - 0.0035, y, zc - 0.01);
            b.add('gloss', plate, [0.02, 0.02, 0.022]);
            const sx = sign * (big ? 0.48 : 0.42);
            const foot = d.top(sx, zc + 0.02).p;
            const stand = new THREE.BoxGeometry(0.012, y - foot.y + 0.01, 0.12);
            stand.translate(sx, (y + foot.y) / 2 - 0.01, zc + 0.02);
            b.add('gloss', stand, [0.02, 0.02, 0.022]);
        }
    }
}

/** Makes every triangle of a non-indexed geometry face away from a point. */
function orientAwayFrom(g, centre) {
    const p = g.attributes.position;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const m = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i);
        b.fromBufferAttribute(p, i + 1);
        c.fromBufferAttribute(p, i + 2);
        n.subVectors(b, a).cross(m.subVectors(c, a));
        m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
        if (n.dot(m) < 0) {
            p.setXYZ(i + 1, c.x, c.y, c.z);
            p.setXYZ(i + 2, b.x, b.y, b.z);
        }
    }
    g.computeVertexNormals();
}

// ---- interior

function interior(b, d, variant, quality) {
    const p = d.p;
    const rs = quality === 'high' ? 2 : 1;
    const c = p.cabin;
    const tub = d.tub;
    const floor = tub.floor;
    const fabric = [0.022, 0.022, 0.024];
    const accent = p.seat;
    // dashboard under the windscreen, the gauge hood on the right (driver) side, glowing gauges
    const dashZ = c.ws - 0.3;
    b.add('matte', new RoundedBoxGeometry(tub.x * 2 - 0.02, 0.26, 0.4, rs, 0.05).translate(0, p.belt - 0.1, dashZ), [0.018, 0.018, 0.02]);
    b.add('matte', new RoundedBoxGeometry(0.36, 0.09, 0.16, rs, 0.03).translate(-0.36, p.belt + 0.05, dashZ - 0.1), [0.014, 0.014, 0.016]);
    for (const dx of [-0.085, 0.085]) {
        b.add('lamp', new THREE.CircleGeometry(0.048, 16).rotateY(Math.PI).translate(-0.36 + dx, p.belt + 0.035, dashZ - 0.181), [0.62, 0.34, 0.14]);
    }
    b.add('lamp', new THREE.PlaneGeometry(0.16, 0.06).rotateY(Math.PI).rotateX(-0.3).translate(0, p.belt + 0.0, dashZ - 0.205), [0.1, 0.24, 0.42]);
    // steering wheel (right-hand drive), tilted towards the driver
    const wheelC = new THREE.Vector3(-0.36, p.belt - 0.04, dashZ - 0.34);
    const ring = new THREE.TorusGeometry(0.17, 0.016, 6, quality === 'low' ? 14 : 24).rotateX(0.42);
    b.add('matte', ring.translate(wheelC.x, wheelC.y, wheelC.z), [0.012, 0.012, 0.013]);
    const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10).rotateX(Math.PI / 2 + 0.42).translate(wheelC.x, wheelC.y, wheelC.z);
    b.add('matte', hub, [0.012, 0.012, 0.013]);
    for (const a of [0, 2.2, 4.1]) {
        const e = new THREE.Vector3(Math.cos(a) * 0.16, Math.sin(a) * 0.16 * Math.cos(0.42), Math.sin(a) * 0.16 * Math.sin(0.42)).add(wheelC);
        b.add('matte', bar(wheelC, e, 0.03, 0.012), [0.012, 0.012, 0.013]);
    }
    // bucket seats: cushion, backrest with integrated headrest, side bolsters, a coloured centre panel
    const seatZ = c.ws - 1.12;
    for (const x of [-0.36, 0.36]) {
        b.add('matte', new RoundedBoxGeometry(0.5, 0.1, 0.48, rs, 0.04).translate(x, floor + 0.07, seatZ + 0.26), fabric);
        const back = new RoundedBoxGeometry(0.5, 0.62, 0.12, rs, 0.05);
        back.translate(0, 0.31, 0).rotateX(-0.2).translate(x, floor + 0.03, seatZ);
        b.add('matte', back, fabric);
        const panel = new RoundedBoxGeometry(0.2, 0.42, 0.02, 1, 0.008);
        panel.translate(0, 0.3, 0.065).rotateX(-0.2).translate(x, floor + 0.03, seatZ);
        b.add('matte', panel, accent);
        for (const s of [-1, 1]) {
            const bolster = new RoundedBoxGeometry(0.09, 0.42, 0.2, rs, 0.035);
            bolster.translate(s * 0.22, 0.26, 0.05).rotateX(-0.2).translate(x, floor + 0.03, seatZ);
            b.add('matte', bolster, fabric);
        }
    }
    // the rear bench (four-seaters)
    if (!variant.cage && d.key !== 'fastback') {
        const z = Math.max(c.rw + 0.42, seatZ - 0.7);
        const back = new RoundedBoxGeometry(tub.x * 2 - 0.1, 0.42, 0.14, rs, 0.05);
        back.translate(0, 0.21, 0).rotateX(-0.3).translate(0, floor + 0.06, z);
        b.add('matte', back, fabric);
    }
    // the headliner under the roof
    const nx = 4;
    const nz = 4;
    const pos = [];
    const nor = [];
    for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
            const x = (-1 + (2 * i) / nx) * (c.half - 0.1);
            const z = c.roofRear + 0.08 + ((c.roofFront - c.roofRear - 0.12) * j) / nz;
            const s = d.roof(x, z);
            pos.push(s.p.x, s.p.y - 0.035, s.p.z);
            nor.push(0, -1, 0);
        }
    }
    b.add('matte', gridGeometry(pos, nor, nx, nz, false), [0.05, 0.05, 0.052]);
    // the rear-view mirror
    const m = d.windscreen(0, c.roof - 0.1);
    b.add('gloss', placeOn(new RoundedBoxGeometry(0.22, 0.06, 0.03, 1, 0.012), m, -0.05), BLACK);
    // a roll cage on the tuned bodies: main hoop, diagonal, roof bars to the windscreen, rear stays
    if (variant.cage) {
        const white = [0.55, 0.56, 0.58];
        const r = 0.018;
        const seg = quality === 'low' ? 5 : 8;
        const hx = tub.x - 0.05;
        const hz = seatZ - 0.16;
        const roofAt = z => d.roof(0, z).p.y - 0.07;
        const top = roofAt(hz);
        const fl = floor + 0.02;
        const A = [new THREE.Vector3(hx, fl, hz), new THREE.Vector3(hx, top, hz), new THREE.Vector3(-hx, top, hz), new THREE.Vector3(-hx, fl, hz)];
        b.add('gloss', tube(A[0], A[1], r, seg), white);
        b.add('gloss', tube(A[1], A[2], r, seg), white);
        b.add('gloss', tube(A[2], A[3], r, seg), white);
        b.add('gloss', tube(A[0], A[2], r, seg), white);
        const fz = c.roofFront - 0.1;
        for (const s of [1, -1]) {
            const front = new THREE.Vector3(s * (hx - 0.06), roofAt(fz), fz);
            b.add('gloss', tube(new THREE.Vector3(s * hx, top, hz), front, r, seg), white);
            b.add('gloss', tube(front, new THREE.Vector3(s * (hx - 0.02), p.belt - 0.05, c.ws - 0.18), r, seg), white);
            b.add('gloss', tube(new THREE.Vector3(s * hx, top - 0.02, hz), new THREE.Vector3(s * (hx - 0.08), fl + 0.1, c.rw + 0.25), r, seg), white);
        }
    }
}

// ---- neon tubes

function neonTubes(b, d) {
    const p = d.p;
    for (const sign of [1, -1]) {
        const x = sign * (d.sideAt(0, p.sill) - 0.1);
        b.add('neon', new THREE.BoxGeometry(0.022, 0.022, WHEELBASE - 2 * p.arch - 0.2).translate(x, p.sill - 0.035, 0));
    }
    b.add('neon', new THREE.BoxGeometry(1.0, 0.022, 0.022).translate(0, d.bottomLine(d.nose - 0.4) - 0.03, d.nose - 0.45));
    b.add('neon', new THREE.BoxGeometry(1.0, 0.022, 0.022).translate(0, d.bottomLine(d.tail + 0.45) - 0.03, d.tail + 0.5));
}

/**
 * All parts of a body: fills the buckets, returns the light mounts { head, tail, exhaust } (car-local, without the ride height).
 * @param {Buckets} buckets
 * @param {object} design model-bodies.js design
 * @param {{ intercooler:boolean, bigExhaust:boolean, cage:boolean }} variant
 * @param {string} quality
 */
export function buildParts(buckets, design, variant, quality) {
    const head = headlamps(buckets, design, quality);
    const tail = taillamps(buckets, design, quality);
    front(buckets, design, variant, quality);
    const exhaust = rear(buckets, design, variant, quality);
    sides(buckets, design, quality);
    top(buckets, design, quality);
    interior(buckets, design, variant, quality);
    neonTubes(buckets, design);
    // left (+x) lamp first
    const pick = list => {
        const left = list.filter(v => v.x > 0).sort((a, c) => c.x - a.x);
        const right = list.filter(v => v.x <= 0).sort((a, c) => a.x - c.x);
        return [left[0] ?? list[0], right[0] ?? list[list.length - 1]];
    };
    return { head: pick(head), tail: pick(tail), exhaust };
}
