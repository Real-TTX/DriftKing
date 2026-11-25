// DriftKing · world/course.js – the course of a map: the closed centre line every client and the server agree on.
// Pure math (no three.js), so scripts/maps-length.mjs computes the lap length with the same code.
//
// A course is described by its corners in data/maps.json: points [[x, z, y, radius], ...] (metres; y = height, radius = the fillet of the corner).
// The path runs straight between the corners and on circular arcs through them; it is sampled every ~1 m. s = 0 is the start line on the first
// straight (corner 0 → corner 1, at the fraction `start`). Conventions: yaw 0 looks along +z, forward = (sin yaw, cos yaw), left = (cos yaw, −sin yaw);
// lateral > 0 is left of the centre line, curvature > 0 turns left.

/** A closed course built from the corner list of a map. */
export class Course {
    /**
     * @param {{ points: number[][], width: number, start?: number }} def
     */
    constructor(def) {
        this.width = def.width;
        const dense = buildDense(def.points, def.start ?? 0.6);
        this.resample(dense);
        this.buildGrid();
    }

    resample({ xs, zs, cornerS, cornerY, length }) {
        const count = Math.max(16, Math.round(length));
        const step = length / count;
        this.length = length;
        this.count = count;
        this.step = step;
        this.x = new Float32Array(count);
        this.z = new Float32Array(count);
        this.y = new Float32Array(count);
        this.tx = new Float32Array(count);
        this.tz = new Float32Array(count);
        this.k = new Float32Array(count);
        this.slope = new Float32Array(count);
        // walk the dense polyline at equal steps
        let j = 0;
        let walked = 0;
        for (let i = 0; i < count; i++) {
            const target = i * step;
            while (j < xs.length - 2 && walked + dist(xs[j], zs[j], xs[j + 1], zs[j + 1]) < target) {
                walked += dist(xs[j], zs[j], xs[j + 1], zs[j + 1]);
                j++;
            }
            const segment = dist(xs[j], zs[j], xs[j + 1], zs[j + 1]) || 1;
            const f = Math.min(1, Math.max(0, (target - walked) / segment));
            this.x[i] = xs[j] + (xs[j + 1] - xs[j]) * f;
            this.z[i] = zs[j] + (zs[j + 1] - zs[j]) * f;
            this.y[i] = heightAlong(target, cornerS, cornerY, length);
        }
        for (let i = 0; i < count; i++) {
            const a = this.wrap(i - 1);
            const b = this.wrap(i + 1);
            const dx = this.x[b] - this.x[a];
            const dz = this.z[b] - this.z[a];
            const d = Math.hypot(dx, dz) || 1;
            this.tx[i] = dx / d;
            this.tz[i] = dz / d;
            this.slope[i] = (this.y[b] - this.y[a]) / (2 * step);
        }
        for (let i = 0; i < count; i++) {
            const a = this.wrap(i - 2);
            const b = this.wrap(i + 2);
            const ha = Math.atan2(this.tx[a], this.tz[a]);
            const hb = Math.atan2(this.tx[b], this.tz[b]);
            this.k[i] = angleDelta(ha, hb) / (4 * step);
        }
    }

    buildGrid() {
        this.cell = 20;
        this.grid = new Map();
        for (let i = 0; i < this.count; i++) {
            const key = this.cellKey(this.x[i], this.z[i]);
            let list = this.grid.get(key);
            if (!list) this.grid.set(key, (list = []));
            list.push(i);
        }
    }

    cellKey(x, z) {
        return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    }

    /** The sample index i wrapped into 0..count-1. */
    wrap(i) {
        return ((i % this.count) + this.count) % this.count;
    }

    /** s wrapped into 0..length. */
    wrapS(s) {
        return ((s % this.length) + this.length) % this.length;
    }

    /**
     * Where (x, z) lies on the course: the nearest centre-line point, its s (0..length), lap fraction t, lateral offset (> 0 left), height y,
     * the tangent and the distance. hint: the index of the last call (searches near it first).
     */
    locate(x, z, hint = -1, out = {}) {
        let best = -1;
        let bestD = Infinity;
        if (hint >= 0) {
            for (let o = -40; o <= 40; o++) {
                const i = this.wrap(hint + o);
                const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
        }
        if (best < 0 || bestD > (this.width * 1.6) ** 2) {
            const found = this.nearestIndex(x, z);
            const d = (this.x[found] - x) ** 2 + (this.z[found] - z) ** 2;
            if (d < bestD) best = found;
        }
        return this.project(best, x, z, out);
    }

    /** The nearest sample index of the whole course (grid first, everything when the grid has nothing near). */
    nearestIndex(x, z) {
        let best = -1;
        let bestD = Infinity;
        const cx = Math.floor(x / this.cell);
        const cz = Math.floor(z / this.cell);
        for (let ring = 1; ring <= 3 && best < 0; ring++) {
            for (let gx = cx - ring; gx <= cx + ring; gx++) {
                for (let gz = cz - ring; gz <= cz + ring; gz++) {
                    const list = this.grid.get(`${gx},${gz}`);
                    if (!list) continue;
                    for (const i of list) {
                        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
                        if (d < bestD) {
                            bestD = d;
                            best = i;
                        }
                    }
                }
            }
        }
        if (best >= 0) return best;
        for (let i = 0; i < this.count; i++) {
            const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    }

    project(i, x, z, out) {
        // between sample i and its better neighbour
        const tx = this.tx[i];
        const tz = this.tz[i];
        const dx = x - this.x[i];
        const dz = z - this.z[i];
        const along = Math.max(-this.step, Math.min(this.step, dx * tx + dz * tz));
        const lateral = dx * tz - dz * tx;
        const s = this.wrapS(i * this.step + along);
        const f = along / this.step;
        const j = this.wrap(i + Math.sign(f));
        out.index = i;
        out.s = s;
        out.t = s / this.length;
        out.lateral = lateral;
        out.y = this.y[i] + (this.y[j] - this.y[i]) * Math.abs(f);
        out.tx = tx;
        out.tz = tz;
        out.slope = this.slope[i];
        out.distance = Math.abs(lateral);
        return out;
    }

    /** The centre-line point at s (any value, wraps): x, y, z, tangent, curvature, index. */
    at(s, out = {}) {
        const w = this.wrapS(s);
        const f = w / this.step;
        const i = Math.floor(f) % this.count;
        const j = this.wrap(i + 1);
        const r = f - Math.floor(f);
        out.index = i;
        out.x = this.x[i] + (this.x[j] - this.x[i]) * r;
        out.y = this.y[i] + (this.y[j] - this.y[i]) * r;
        out.z = this.z[i] + (this.z[j] - this.z[i]) * r;
        out.tx = this.tx[i];
        out.tz = this.tz[i];
        out.k = this.k[i];
        return out;
    }

    /** The strongest curvature (signed, the sharpest one) between s and s + distance. */
    curvatureAhead(s, distance) {
        let best = 0;
        const steps = Math.max(1, Math.round(distance / this.step));
        const start = Math.floor(this.wrapS(s) / this.step);
        for (let n = 0; n <= steps; n += 2) {
            const k = this.k[this.wrap(start + n)];
            if (Math.abs(k) > Math.abs(best)) best = k;
        }
        return best;
    }

    /** The start grid: slot 0 at the front, two columns, 8 m between the rows. */
    spawn(slot) {
        const row = Math.floor(slot / 2);
        const side = slot % 2 === 0 ? 1 : -1;
        const p = this.at(-8 - row * 8);
        const offset = side * this.width * 0.22;
        return {
            x: p.x + p.tz * offset,
            y: p.y,
            z: p.z - p.tx * offset,
            yaw: Math.atan2(p.tx, p.tz),
        };
    }

    /** The distance of (x, z) to the centre line (for placing props). */
    distanceTo(x, z) {
        const i = this.nearestIndex(x, z);
        return this.project(i, x, z, {}).distance;
    }
}

function dist(ax, az, bx, bz) {
    return Math.hypot(bx - ax, bz - az);
}

function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** The height at s: a monotone cubic through the heights of the corners (even grades on a climb, no overshoot at a crest). */
function heightAlong(s, cornerS, cornerY, length) {
    const n = cornerS.length;
    if (n === 0) return 0;
    if (n === 1) return cornerY[0];
    // k counts corners over the laps: corner k mod n, in lap floor(k / n)
    const at = k => {
        const i = ((k % n) + n) % n;
        return { s: cornerS[i] + Math.floor(k / n) * length, y: cornerY[i] };
    };
    let k1 = -1;
    for (let k = 0; k < n; k++) {
        if (cornerS[k] <= s) k1 = k;
    }
    const p0 = at(k1 - 1);
    const p1 = at(k1);
    const p2 = at(k1 + 1);
    const p3 = at(k1 + 2);
    const d0 = (p1.y - p0.y) / (p1.s - p0.s);
    const d1 = (p2.y - p1.y) / (p2.s - p1.s);
    const d2 = (p3.y - p2.y) / (p3.s - p2.s);
    const m1 = d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1);
    const m2 = d1 * d2 <= 0 ? 0 : (2 * d1 * d2) / (d1 + d2);
    const h = p2.s - p1.s;
    const t = (s - p1.s) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1.y + (t3 - 2 * t2 + t) * h * m1 + (-2 * t3 + 3 * t2) * p2.y + (t3 - t2) * h * m2;
}

/**
 * The dense polyline: straights between the corners' tangent points, arcs through the corners, rotated so that it starts at the start line.
 * Returns the points, the s of every corner (the middle of its arc) with its height, and the length.
 */
function buildDense(points, start) {
    const n = points.length;
    const corners = points.map((p, i) => filletOf(points, i));
    const xs = [];
    const zs = [];
    const cornerS = [];
    const cornerY = [];
    let length = 0;
    const push = (x, z) => {
        if (xs.length) length += dist(xs[xs.length - 1], zs[zs.length - 1], x, z);
        xs.push(x);
        zs.push(z);
    };
    // corner 0's exit, then straight + arc of corner 1, ..., straight + arc of corner 0
    const first = corners[0];
    push(first.t2x, first.t2z);
    const firstStraight = dist(first.t2x, first.t2z, corners[1 % n].t1x, corners[1 % n].t1z);
    for (let step = 1; step <= n; step++) {
        const c = corners[step % n];
        straight(push, xs, zs, c.t1x, c.t1z);
        const before = length;
        arc(push, c);
        cornerS.push((before + length) / 2);
        cornerY.push(points[step % n][2] ?? 0);
    }
    // s = 0 at the start line on the first straight
    const offset = firstStraight * start;
    const shiftedS = cornerS.map(s => (s - offset + length) % length);
    const order = shiftedS.map((s, i) => i).sort((a, b) => shiftedS[a] - shiftedS[b]);
    const rotated = rotateToStart(xs, zs, offset);
    return { xs: rotated.xs, zs: rotated.zs, cornerS: order.map(i => shiftedS[i]), cornerY: order.map(i => cornerY[i]), length };
}

function straight(push, xs, zs, x, z) {
    const x0 = xs[xs.length - 1];
    const z0 = zs[zs.length - 1];
    const d = dist(x0, z0, x, z);
    const steps = Math.max(1, Math.ceil(d / 2));
    for (let k = 1; k <= steps; k++) push(x0 + ((x - x0) * k) / steps, z0 + ((z - z0) * k) / steps);
}

function arc(push, c) {
    if (c.radius <= 0 || c.turn === 0) return;
    const steps = Math.max(2, Math.ceil((c.radius * Math.abs(c.turn)) / 0.5));
    for (let k = 1; k <= steps; k++) {
        const h = c.heading + (c.turn * k) / steps;
        const lx = Math.cos(h);
        const lz = -Math.sin(h);
        // left turn: p = C − r·L(h); right turn: p = C + r·L(h)
        const sign = c.turn > 0 ? -1 : 1;
        push(c.cx + sign * c.radius * lx, c.cz + sign * c.radius * lz);
    }
}

/** The fillet of corner i: tangent points, centre, radius, the heading at its entry and the turn (signed, > 0 left). */
function filletOf(points, i) {
    const n = points.length;
    const [px, pz] = points[i];
    const [ax, az] = points[(i - 1 + n) % n];
    const [bx, bz] = points[(i + 1) % n];
    const wanted = points[i][3] ?? 10;
    const l1 = dist(ax, az, px, pz);
    const l2 = dist(px, pz, bx, bz);
    const u1x = (px - ax) / l1;
    const u1z = (pz - az) / l1;
    const u2x = (bx - px) / l2;
    const u2z = (bz - pz) / l2;
    const heading = Math.atan2(u1x, u1z);
    const turn = angleDelta(heading, Math.atan2(u2x, u2z));
    if (Math.abs(turn) < 1e-4) {
        return { t1x: px, t1z: pz, t2x: px, t2z: pz, cx: px, cz: pz, radius: 0, heading, turn: 0 };
    }
    const tan = Math.tan(Math.abs(turn) / 2);
    const d = Math.min(wanted * tan, 0.48 * Math.min(l1, l2));
    const radius = d / tan;
    const t1x = px - u1x * d;
    const t1z = pz - u1z * d;
    const lx = Math.cos(heading);
    const lz = -Math.sin(heading);
    const side = turn > 0 ? 1 : -1;
    return {
        t1x,
        t1z,
        t2x: px + u2x * d,
        t2z: pz + u2z * d,
        cx: t1x + side * lx * radius,
        cz: t1z + side * lz * radius,
        radius,
        heading,
        turn,
    };
}

/** The polyline from s = offset on (closed): the points from there to the end, then from the start up to there. */
function rotateToStart(xs, zs, offset) {
    let walked = 0;
    let j = 0;
    while (j < xs.length - 1 && walked + dist(xs[j], zs[j], xs[j + 1], zs[j + 1]) < offset) {
        walked += dist(xs[j], zs[j], xs[j + 1], zs[j + 1]);
        j++;
    }
    const seg = dist(xs[j], zs[j], xs[j + 1], zs[j + 1]) || 1;
    const f = (offset - walked) / seg;
    const sx = xs[j] + (xs[j + 1] - xs[j]) * f;
    const sz = zs[j] + (zs[j + 1] - zs[j]) * f;
    const outX = [sx];
    const outZ = [sz];
    for (let k = j + 1; k < xs.length; k++) {
        outX.push(xs[k]);
        outZ.push(zs[k]);
    }
    // the closing point of the dense list equals its first point: skip it once
    for (let k = 1; k <= j; k++) {
        outX.push(xs[k]);
        outZ.push(zs[k]);
    }
    outX.push(sx);
    outZ.push(sz);
    return { xs: outX, zs: outZ };
}
