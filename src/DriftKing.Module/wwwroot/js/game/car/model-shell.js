// DriftKing · car/model-shell.js – sculpted body shells. A box on a grid (dense where its edges round off) is rounded into a soft-edged block,
// then a body design (model-bodies.js) deforms every point into the car: side profile, plan view, crown, tumblehome, nose and tail shape.
// Wheel arches are carved as cylinders through the lower body (the carved walls are the arch liners). Every quad is sorted into a material
// bucket (paint, glass, black trim, the dark matte of liners, underside and interior); every vertex gets the livery UV (model-livery.js):
// u along the car, v around it (the girth from the top centre line).

import * as THREE from 'three';
import { atlasU, atlasV, GIRTH_LIMIT } from './model-livery.js';

/**
 * The grid lines of one box axis from min to max: in each rounding zone (radius r) `zone` lines spaced evenly in angle, between them lines
 * at most `step` apart, more lines in the `dense` ranges ({ from, to, step }) and exactly at the `extra` coordinates (crisp region edges).
 */
export function gridAxis(min, max, r, step, { zone = 4, extra = [], dense = [] } = {}) {
    // exact lines (zones, extras) always stay; soft lines (the regular spacing, dense ranges) give way where they would make skinny quads
    const lines = [];
    for (let k = 0; k <= zone; k++) {
        const f = Math.tan((k / zone) * (Math.PI / 4));
        lines.push({ v: max - r + r * f, exact: true }, { v: min + r - r * f, exact: true });
    }
    const a = min + r;
    const b = max - r;
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let k = 1; k < n; k++) lines.push({ v: a + ((b - a) * k) / n, exact: false });
    for (const d of dense) {
        const m = Math.max(1, Math.ceil((d.to - d.from) / d.step));
        for (let k = 0; k <= m; k++) lines.push({ v: d.from + ((d.to - d.from) * k) / m, exact: false });
    }
    for (const e of extra) lines.push({ v: e, exact: true });
    const inside = lines.filter(l => l.v >= min - 1e-6 && l.v <= max + 1e-6).sort((p, q) => p.v - q.v);
    const gap = Math.min(step, r) * 0.3;
    const kept = [];
    for (const l of inside) {
        const last = kept[kept.length - 1];
        if (last && l.v - last.v < 1e-5) {
            last.exact ||= l.exact;
            continue;
        }
        if (last && l.v - last.v < gap) {
            if (!l.exact) continue;
            if (!last.exact) kept.pop();
        }
        kept.push(l);
    }
    return kept.map(l => l.v);
}

// the six faces of the box: the fixed axis, its side, and the two axes that run over the face (u, v)
const FACES = [
    { name: 'px', axis: 0, sign: 1, u: 2, v: 1 },
    { name: 'nx', axis: 0, sign: -1, u: 2, v: 1 },
    { name: 'py', axis: 1, sign: 1, u: 0, v: 2 },
    { name: 'ny', axis: 1, sign: -1, u: 0, v: 2 },
    { name: 'pz', axis: 2, sign: 1, u: 0, v: 1 },
    { name: 'nz', axis: 2, sign: -1, u: 0, v: 1 },
];

/** Rounds a point of the box surface onto the rounded box (elliptic edges with radii r per axis). In place. */
export function roundPoint(p, min, max, r) {
    let len = 0;
    const q = [0, 0, 0];
    const d = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
        q[k] = Math.min(max[k] - r[k], Math.max(min[k] + r[k], p[k]));
        d[k] = (p[k] - q[k]) / r[k];
        len += d[k] * d[k];
    }
    len = Math.sqrt(len);
    if (len < 1e-9) return p;
    for (let k = 0; k < 3; k++) p[k] = q[k] + (r[k] * d[k]) / len;
    return p;
}

/**
 * The girth of a point of the rounded box around the long axis (metres from the top centre line, signed: + on the +x side), the v of the
 * livery. Inner points of the end faces count as top: stripes run down the nose and the tail.
 * @param {number} x
 * @param {number} y
 * @param {{ A:number, y0:number, y1:number, rx:number, ry:number }} g the box section (half width, bottom, top, radii)
 */
export function girth(x, y, g) {
    const ax = Math.abs(x);
    const innerX = g.A - g.rx;
    const top = g.y1 - g.ry;
    const bottom = g.y0 + g.ry;
    const quarter = (Math.PI / 4) * (g.rx + g.ry);
    const side = top - bottom;
    const total = 2 * innerX + 2 * quarter + side;
    const dx = Math.max(0, ax - innerX) / g.rx;
    const dy = y > top ? (y - top) / g.ry : y < bottom ? (y - bottom) / g.ry : 0;
    let t;
    if (dx < 1e-4 && dy === 0) t = ax;
    else if (dx < 1e-4) t = dy > 0 ? ax : total - ax;
    else if (dy > 0) t = innerX + quarter * (Math.atan2(dx, dy) / (Math.PI / 2));
    else if (dy < 0) t = innerX + quarter + side + quarter * (Math.atan2(-dy, dx) / (Math.PI / 2));
    else t = innerX + quarter + (top - y);
    return x < 0 ? -t : t;
}

/**
 * Builds a shell: the rounded box of `box` on the grid `axes`, deformed, carved, sorted into buckets.
 * @param {object} spec
 * @param {{ min:number[], max:number[], r:number[] }} spec.box the nominal box (metres) and its edge radii per axis
 * @param {number[][]} spec.axes grid lines per axis (gridAxis)
 * @param {(p:number[], out:number[]) => void} spec.deform nominal (rounded) point → car point
 * @param {{ z:number, y:number, r:number }[]} [spec.arches] wheel arches carved through the whole width
 * @param {(face:string, centre:number[], carved:number) => string|null} spec.classify the bucket of a quad (null: drop it) from its face,
 *        the nominal centre and how many of its corners were carved
 * @param {(nominal:number[], carved:boolean) => number} [spec.shade] the grey of a vertex in the matte bucket (vertex colour)
 * @param {(nominal:number[]) => number} spec.girth the livery girth of a nominal point
 * @returns {Record<string, THREE.BufferGeometry>} one indexed geometry per bucket (position, normal, uv, color)
 */
export function buildShell(spec) {
    const { box, axes, deform, arches = [], classify, shade = () => 0.05 } = spec;
    const [xs, ys, zs] = axes;
    const counts = [xs.length, ys.length, zs.length];
    const index = new Map();
    const nominal = [];
    const vertex = (ix, iy, iz) => {
        const key = (ix * counts[1] + iy) * counts[2] + iz;
        let v = index.get(key);
        if (v === undefined) {
            v = nominal.length;
            index.set(key, v);
            nominal.push(roundPoint([xs[ix], ys[iy], zs[iz]], box.min, box.max, box.r));
        }
        return v;
    };
    const quads = [];
    for (const f of FACES) {
        const nu = counts[f.u];
        const nv = counts[f.v];
        const fixed = f.sign > 0 ? counts[f.axis] - 1 : 0;
        // e_u × e_v points along +axis when (u, v, axis) is cyclic; flip the winding where that is not outwards
        const cyclic = (f.u + 1) % 3 === f.v;
        const flip = (cyclic ? 1 : -1) * f.sign < 0;
        const ids = [];
        for (let i = 0; i < nu; i++) {
            ids.push([]);
            for (let j = 0; j < nv; j++) {
                const at = [0, 0, 0];
                at[f.axis] = fixed;
                at[f.u] = i;
                at[f.v] = j;
                ids[i].push(vertex(at[0], at[1], at[2]));
            }
        }
        for (let i = 0; i < nu - 1; i++) {
            for (let j = 0; j < nv - 1; j++) {
                const a = ids[i][j];
                const b = ids[i + 1][j];
                const c = ids[i + 1][j + 1];
                const d = ids[i][j + 1];
                quads.push({ face: f.name, corners: flip ? [a, d, c, b] : [a, b, c, d] });
            }
        }
    }

    // deform and carve
    const count = nominal.length;
    const position = new Float32Array(count * 3);
    const carved = new Uint8Array(count);
    const out = [0, 0, 0];
    for (let v = 0; v < count; v++) {
        deform(nominal[v], out);
        for (const a of arches) {
            const dz = out[2] - a.z;
            const dy = out[1] - a.y;
            if (dy >= 0) {
                const d = Math.hypot(dz, dy);
                if (d < a.r) {
                    const s = d < 1e-6 ? 0 : a.r / d;
                    out[2] = a.z + (d < 1e-6 ? 0 : dz * s);
                    out[1] = a.y + (d < 1e-6 ? a.r : dy * s);
                    carved[v] = 1;
                }
            } else if (Math.abs(dz) < a.r) {
                out[2] = a.z + (dz < 0 ? -a.r : a.r);
                carved[v] = 1;
            }
        }
        position.set(out, v * 3);
    }

    // sort the quads into buckets
    const buckets = new Map();
    const centre = [0, 0, 0];
    for (const q of quads) {
        centre[0] = centre[1] = centre[2] = 0;
        let cut = 0;
        for (const v of q.corners) {
            const n = nominal[v];
            centre[0] += n[0] / 4;
            centre[1] += n[1] / 4;
            centre[2] += n[2] / 4;
            cut += carved[v];
        }
        const bucket = classify(q.face, centre, cut);
        if (!bucket) continue;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        const [a, b, c, d] = q.corners;
        buckets.get(bucket).push(a, b, c, a, c, d);
    }

    // one compact geometry per bucket: its own vertices (crisp shading at bucket borders), normals per bucket
    const result = {};
    for (const [name, triangles] of buckets) {
        const remap = new Map();
        const pos = [];
        const uv = [];
        const col = [];
        const idx = [];
        for (const v of triangles) {
            let w = remap.get(v);
            if (w === undefined) {
                w = remap.size;
                remap.set(v, w);
                pos.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
                uv.push(atlasU(position[v * 3 + 2]), atlasV(Math.max(-GIRTH_LIMIT, Math.min(GIRTH_LIMIT, spec.girth(nominal[v])))));
                const g = shade(nominal[v], carved[v] === 1);
                col.push(g, g, g);
            }
            idx.push(w);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geometry.setIndex(idx);
        geometry.computeVertexNormals();
        result[name] = geometry;
    }
    return result;
}

/**
 * A point on a face of a deformed shell and the surface normal there (outwards): for parts that sit on the body (lamps, plates, vents).
 * face 'pz' (front), 'nz' (rear), 'px'/'nx' (sides), 'py' (top); a and b are the nominal coordinates along the face's u and v axes.
 * @returns {{ p: THREE.Vector3, n: THREE.Vector3 }}
 */
export function surfacePoint(spec, face, a, b) {
    const f = FACES.find(x => x.name === face);
    const at = (da, db) => {
        const p = [0, 0, 0];
        p[f.axis] = f.sign > 0 ? spec.box.max[f.axis] : spec.box.min[f.axis];
        p[f.u] = a + da;
        p[f.v] = b + db;
        roundPoint(p, spec.box.min, spec.box.max, spec.box.r);
        const out = [0, 0, 0];
        spec.deform(p, out);
        return new THREE.Vector3(out[0], out[1], out[2]);
    };
    const e = 0.004;
    const p = at(0, 0);
    const du = at(e, 0).sub(at(-e, 0));
    const dv = at(0, e).sub(at(0, -e));
    const n = new THREE.Vector3().crossVectors(du, dv).normalize();
    const cyclic = (f.u + 1) % 3 === f.v;
    if ((cyclic ? 1 : -1) * f.sign < 0) n.negate();
    return { p, n };
}
