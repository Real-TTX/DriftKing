// DriftKing · car/model-wheels.js – the wheels: a tyre with a bulging sidewall, rounded shoulders and the tread texture (u around the tyre),
// rims in several invented styles (five spokes, cross-spoke mesh with a riveted lip, twin spokes, ten spokes, deep dishes), lug nuts, a
// brake disc with its hat and a caliper behind the spokes. The wheel's axle is x, its face looks to +x, its centre is the origin.
// Geometries are shared per quality and size (userData.shared: car disposal skips them).

import * as THREE from 'three';
import { markShared, mergeGeometries } from '../render/kit.js';

/** The rim styles. */
export const RIM_STYLES = ['five', 'mesh', 'six', 'ten', 'dish', 'dish5'];

const RADIUS = 0.33;
/** The rim's bead seat radius (~17 inch with a 45-profile tyre). */
const RIM = 0.222;
const cache = new Map();

const SEGMENTS = { low: 18, medium: 30, high: 40 };

/**
 * The wheel geometries of a quality (cached and shared): { tyre, rim, disc, caliper }.
 * @param {string} style a RIM_STYLES entry
 * @param {string} quality
 * @param {number} width tyre width in metres
 */
export function wheelGeometries(style, quality, width) {
    const w = Math.round(width * 100) / 100;
    const key = `${quality}|${style}|${w}`;
    if (cache.has(key)) return cache.get(key);
    const n = SEGMENTS[quality] ?? SEGMENTS.medium;
    const set = {
        tyre: shared(`tyre|${quality}|${w}`, () => tyre(w, n)),
        rim: shared(`rim|${quality}|${style}|${w}`, () => rim(style, w, n, quality)),
        disc: shared(`disc|${quality}|${w}`, () => disc(w, n)),
        caliper: shared(`caliper|${quality}|${w}`, () => caliper(w)),
        face: faceX(w),
    };
    cache.set(key, set);
    return set;
}

function shared(key, build) {
    if (!cache.has(key)) {
        const g = build();
        g.computeBoundingSphere();
        cache.set(key, markShared(g));
    }
    return cache.get(key);
}

/** The x of the rim's outer face for a tyre width. */
function faceX(width) {
    return width * 0.42;
}

/**
 * A surface of revolution around the x axis from a profile of [x, r] points (normal = the profile's left side, (-dr, dx));
 * smooth: averaged normals at the profile points, otherwise every profile segment is flat (creased). uvs: optional v per point.
 */
function lathe(points, segments, { smooth = true, vs = null } = {}) {
    const rings = [];
    if (smooth) {
        points.forEach((p, i) => {
            const a = points[Math.max(0, i - 1)];
            const b = points[Math.min(points.length - 1, i + 1)];
            rings.push({ x: p[0], r: p[1], nx: -(b[1] - a[1]), nr: b[0] - a[0], v: vs ? vs[i] : i / (points.length - 1) });
        });
    } else {
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const nx = -(b[1] - a[1]);
            const nr = b[0] - a[0];
            rings.push({ x: a[0], r: a[1], nx, nr, v: vs ? vs[i] : 0 }, { x: b[0], r: b[1], nx, nr, v: vs ? vs[i + 1] : 0 });
        }
    }
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    for (const ring of rings) {
        const l = Math.hypot(ring.nx, ring.nr) || 1;
        for (let k = 0; k <= segments; k++) {
            const t = (k / segments) * Math.PI * 2;
            const s = Math.sin(t);
            const c = Math.cos(t);
            pos.push(ring.x, ring.r * s, ring.r * c);
            nor.push(ring.nx / l, (ring.nr / l) * s, (ring.nr / l) * c);
            uv.push(k / segments, ring.v);
        }
    }
    const row = segments + 1;
    const step = smooth ? 1 : 2;
    for (let i = 0; i + 1 < rings.length; i += step) {
        for (let k = 0; k < segments; k++) {
            const a = i * row + k;
            const b = (i + 1) * row + k;
            idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    orient(g);
    return g;
}

/** Flips the winding of an indexed geometry where its triangles face against their vertex normals (so front faces are the outside). */
function orient(g) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const index = g.index.array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const face = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let i = 0; i < index.length; i += 3) {
        a.fromBufferAttribute(p, index[i]);
        b.fromBufferAttribute(p, index[i + 1]);
        c.fromBufferAttribute(p, index[i + 2]);
        face.subVectors(b, a).cross(c.sub(a));
        if (face.lengthSq() < 1e-14) continue;
        normal.fromBufferAttribute(n, index[i]).add(c.fromBufferAttribute(n, index[i + 1])).add(b.fromBufferAttribute(n, index[i + 2]));
        if (face.dot(normal) < 0) {
            const t = index[i + 1];
            index[i + 1] = index[i + 2];
            index[i + 2] = t;
        }
    }
}

/** The tyre: inner bead → bulging sidewall → rounded shoulder → tread → and back; the tread maps the texture, the walls a smooth groove. */
function tyre(w, n) {
    const h = RADIUS - RIM;
    const pts = [
        [-w * 0.45, RIM + 0.004], [-w * 0.5, RIM + h * 0.28], [-w * 0.515, RIM + h * 0.55], [-w * 0.495, RIM + h * 0.8],
        [-w * 0.455, RADIUS - 0.012], [-w * 0.4, RADIUS - 0.002], [-w * 0.2, RADIUS], [0, RADIUS], [w * 0.2, RADIUS],
        [w * 0.4, RADIUS - 0.002], [w * 0.455, RADIUS - 0.012], [w * 0.495, RIM + h * 0.8], [w * 0.515, RIM + h * 0.55],
        [w * 0.5, RIM + h * 0.28], [w * 0.45, RIM + 0.004],
    ];
    // v on the tread texture: the walls sit in a groove (smooth, dark), the shoulders on the shoulder blocks
    const vs = [0.2, 0.2, 0.2, 0.2, 0.03, 0.09, 0.3, 0.5, 0.7, 0.91, 0.97, 0.8, 0.8, 0.8, 0.8];
    return lathe(pts, n, { vs });
}

/** A flat-shaded prism between two cross-sections (4 corners each): a spoke. Corners: [x, y, z]; fronts face +x. */
function spokeGeometry(r0, a0, w0, r1, a1, w1, x0, x1, depth) {
    const p0 = [r0 * Math.sin(a0), r0 * Math.cos(a0)];
    const p1 = [r1 * Math.sin(a1), r1 * Math.cos(a1)];
    const d = [p1[0] - p0[0], p1[1] - p0[1]];
    const l = Math.hypot(d[0], d[1]);
    const s = [-d[1] / l, d[0] / l];
    const at = (p, w, side, x) => new THREE.Vector3(x, p[0] + (s[0] * w * side) / 2, p[1] + (s[1] * w * side) / 2);
    const f0a = at(p0, w0, 1, x0);
    const f0b = at(p0, w0, -1, x0);
    const f1a = at(p1, w1, 1, x1);
    const f1b = at(p1, w1, -1, x1);
    const b0a = at(p0, w0 * 0.8, 1, x0 - depth);
    const b0b = at(p0, w0 * 0.8, -1, x0 - depth);
    const b1a = at(p1, w1 * 0.8, 1, x1 - depth);
    const b1b = at(p1, w1 * 0.8, -1, x1 - depth);
    const out = [];
    const centre = new THREE.Vector3().addVectors(f0a, f1b).multiplyScalar(0.5).setX((x0 + x1) / 2 - depth / 2);
    const quad = (a, b, c, e) => {
        const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        const mid = new THREE.Vector3().add(a).add(b).add(c).add(e).multiplyScalar(0.25).sub(centre);
        if (nrm.dot(mid) < 0) out.push(a, c, b, a, e, c);
        else out.push(a, b, c, a, c, e);
    };
    quad(f0a, f1a, f1b, f0b);
    quad(f0a, b0a, b1a, f1a);
    quad(f0b, f1b, b1b, b0b);
    quad(b0a, b0b, b1b, b1a);
    const g = new THREE.BufferGeometry().setFromPoints(out);
    g.computeVertexNormals();
    return g;
}

/** The rim of a style: lip and barrel (inside faces the axle), spokes, hub, centre cap and lug nuts (and lip rivets on 'mesh'). */
function rim(style, w, n, quality) {
    const face = faceX(w);
    const deep = style === 'dish' || style === 'dish5';
    const dishWidth = deep ? 0.042 : style === 'mesh' ? 0.026 : 0.012;
    const dishDepth = deep ? 0.06 : style === 'mesh' ? 0.022 : 0.01;
    const spokeFront = face - dishDepth;
    const parts = [
        lathe([
            [face - 0.008, RIM + 0.016], [face, RIM + 0.008], [face, RIM - dishWidth], [face - dishDepth, RIM - dishWidth - 0.004],
            [face - dishDepth - 0.02, RIM - 0.014], [-w * 0.45, RIM - 0.014],
        ], n, { smooth: false }),
    ];
    const hub = 0.068;
    const tip = RIM - dishWidth - 0.004;
    const conc = { five: 0.035, mesh: 0.016, six: 0.04, ten: 0.024, dish: 0.012, dish5: 0.018 }[style] ?? 0.03;
    const hubX = spokeFront - conc;
    const spokes = [];
    if (style === 'five' || style === 'dish5') {
        for (let k = 0; k < 5; k++) spokes.push([hub, k * 1.2566, 0.058, tip, k * 1.2566, 0.046, 0.026]);
    } else if (style === 'dish') {
        for (let k = 0; k < 4; k++) spokes.push([hub, k * 1.5708 + 0.785, 0.07, tip, k * 1.5708 + 0.785, 0.075, 0.024]);
    } else if (style === 'six') {
        for (let k = 0; k < 6; k++) for (const o of [-0.075, 0.075]) spokes.push([hub, k * 1.0472 + o * 0.6, 0.024, tip, k * 1.0472 + o, 0.022, 0.024]);
    } else if (style === 'ten') {
        for (let k = 0; k < 10; k++) spokes.push([hub, k * 0.6283, 0.03, tip, k * 0.6283, 0.024, 0.022]);
    } else {
        // cross-spoke mesh: every spoke leans one way and crosses its neighbours leaning the other way
        for (let k = 0; k < 10; k++) for (const o of [-0.32, 0.32]) spokes.push([hub, k * 0.6283, 0.017, tip, k * 0.6283 + o, 0.014, 0.014]);
    }
    for (const [r0, a0, w0, r1, a1, w1, d] of spokes) parts.push(spokeGeometry(r0, a0, w0, r1, a1, w1, hubX, spokeFront, d));
    // hub disc, centre cap
    parts.push(lathe([[hubX - 0.02, hub + 0.008], [hubX, hub], [hubX, 0.04], [hubX + 0.012, 0.035], [hubX + 0.016, 0.02], [hubX + 0.017, 0]], n, { smooth: false }));
    // lug nuts
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        parts.push(new THREE.CylinderGeometry(0.0095, 0.0095, 0.018, 6).rotateZ(Math.PI / 2).translate(hubX + 0.009, Math.sin(a) * 0.052, Math.cos(a) * 0.052));
    }
    // the riveted lip of the two-piece mesh rim
    if (style === 'mesh' && quality !== 'low') {
        for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            const r = RIM - dishWidth * 0.5;
            parts.push(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 5).rotateZ(Math.PI / 2).translate(face + 0.002, Math.sin(a) * r, Math.cos(a) * r));
        }
    }
    return mergeGeometries(parts);
}

/** The brake disc with its hat (behind the spokes; does not spin in the model – it is round). */
function disc(w, n) {
    const x = faceX(w) - 0.1;
    return lathe([[x - 0.012, 0.162], [x + 0.012, 0.162], [x + 0.012, 0.072], [x + 0.045, 0.072], [x + 0.045, 0.0]], Math.max(16, n - 8), { smooth: false });
}

/** The caliper: a block over the top rear of the disc. */
function caliper(w) {
    const x = faceX(w) - 0.1;
    const shape = new THREE.Shape();
    const a0 = Math.PI * 0.56;
    const a1 = Math.PI * 0.86;
    const outer = 0.182;
    const inner = 0.118;
    const pt = (r, a) => [-r * Math.cos(a), r * Math.sin(a)];
    shape.moveTo(...pt(inner, a0));
    for (let k = 0; k <= 8; k++) shape.lineTo(...pt(outer, a0 + ((a1 - a0) * k) / 8));
    for (let k = 8; k >= 0; k--) shape.lineTo(...pt(inner, a0 + ((a1 - a0) * k) / 8));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 1 });
    g.rotateY(Math.PI / 2);
    g.translate(x - 0.03, 0, 0);
    return g;
}
