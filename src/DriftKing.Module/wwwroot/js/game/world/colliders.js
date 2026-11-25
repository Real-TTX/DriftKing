// DriftKing · world/colliders.js – what a car can hit: wall segments (guardrails, parapets, kerbs), circles (pillars, poles, bollards)
// and turned boxes (containers, stairwells, parked cars), in a grid for fast queries. Flat (x, z) only; pure math.

/** The obstacles of a map. */
export class Colliders {
    constructor(cell = 16) {
        this.cell = cell;
        this.items = [];
        this.grid = new Map();
        this.stamp = 0;
        this.seen = [];
    }

    /** A wall from (ax, az) to (bx, bz) (both sides solid). Long walls are split to fit the grid. */
    addSegment(ax, az, bx, bz) {
        const length = Math.hypot(bx - ax, bz - az);
        const parts = Math.max(1, Math.ceil(length / this.cell));
        for (let k = 0; k < parts; k++) {
            const x0 = ax + ((bx - ax) * k) / parts;
            const z0 = az + ((bz - az) * k) / parts;
            const x1 = ax + ((bx - ax) * (k + 1)) / parts;
            const z1 = az + ((bz - az) * (k + 1)) / parts;
            this.insert({ type: 0, ax: x0, az: z0, bx: x1, bz: z1 }, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
        }
    }

    /** A round post at (x, z) with radius r. */
    addCircle(x, z, r) {
        this.insert({ type: 1, x, z, r }, x - r, z - r, x + r, z + r);
    }

    /** A box centred at (x, z), half sizes hw (along its local x) and hd (local z), turned by rot (yaw). */
    addBox(x, z, hw, hd, rot = 0) {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const ex = Math.abs(c) * hw + Math.abs(s) * hd;
        const ez = Math.abs(s) * hw + Math.abs(c) * hd;
        this.insert({ type: 2, x, z, hw, hd, c, s }, x - ex, z - ez, x + ex, z + ez);
    }

    insert(item, minX, minZ, maxX, maxZ) {
        const id = this.items.length;
        this.items.push(item);
        this.seen.push(0);
        for (let gx = Math.floor(minX / this.cell); gx <= Math.floor(maxX / this.cell); gx++) {
            for (let gz = Math.floor(minZ / this.cell); gz <= Math.floor(maxZ / this.cell); gz++) {
                const key = gx * 73856093 ^ gz * 19349663;
                let list = this.grid.get(key);
                if (!list) this.grid.set(key, (list = []));
                list.push(id);
            }
        }
    }

    /** Calls fn(item) once for every obstacle whose cell touches the square around (x, z) with half size reach. */
    near(x, z, reach, fn) {
        this.stamp++;
        for (let gx = Math.floor((x - reach) / this.cell); gx <= Math.floor((x + reach) / this.cell); gx++) {
            for (let gz = Math.floor((z - reach) / this.cell); gz <= Math.floor((z + reach) / this.cell); gz++) {
                const list = this.grid.get(gx * 73856093 ^ gz * 19349663);
                if (!list) continue;
                for (const id of list) {
                    if (this.seen[id] === this.stamp) continue;
                    this.seen[id] = this.stamp;
                    fn(this.items[id]);
                }
            }
        }
    }

    /**
     * The deepest contact of a circle (x, z, r) with any obstacle: { nx, nz, depth } (the normal points out of the obstacle), or null.
     * The car resolves its three circles with it.
     */
    contact(x, z, r, out = {}) {
        let best = 0;
        this.near(x, z, r + 1, item => {
            const hit = touch(item, x, z, r, tmp);
            if (hit && tmp.depth > best) {
                best = tmp.depth;
                out.nx = tmp.nx;
                out.nz = tmp.nz;
                out.depth = tmp.depth;
            }
        });
        return best > 0 ? out : null;
    }

    /** The distance from (x, z) to the nearest obstacle surface, up to max (returns max when nothing is nearer). */
    distance(x, z, max) {
        let best = max;
        this.near(x, z, max, item => {
            const d = surfaceDistance(item, x, z);
            if (d < best) best = d;
        });
        return best;
    }
}

const tmp = { nx: 0, nz: 0, depth: 0 };

function touch(item, x, z, r, out) {
    if (item.type === 0) {
        const p = closestOnSegment(item, x, z);
        const dx = x - p.x;
        const dz = z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= r) return false;
        if (d < 1e-6) {
            // exactly on the wall: push along the wall's normal
            const lx = item.bx - item.ax;
            const lz = item.bz - item.az;
            const l = Math.hypot(lx, lz) || 1;
            out.nx = lz / l;
            out.nz = -lx / l;
        } else {
            out.nx = dx / d;
            out.nz = dz / d;
        }
        out.depth = r - d;
        return true;
    }
    if (item.type === 1) {
        const dx = x - item.x;
        const dz = z - item.z;
        const d = Math.hypot(dx, dz);
        if (d >= r + item.r) return false;
        out.nx = d > 1e-6 ? dx / d : 1;
        out.nz = d > 1e-6 ? dz / d : 0;
        out.depth = r + item.r - d;
        return true;
    }
    // box: into its local frame (local x = (c, -s), local z = (s, c) for yaw rot)
    const dx = x - item.x;
    const dz = z - item.z;
    const lx = dx * item.c - dz * item.s;
    const lz = dx * item.s + dz * item.c;
    const cx = Math.max(-item.hw, Math.min(item.hw, lx));
    const cz = Math.max(-item.hd, Math.min(item.hd, lz));
    let nlx = lx - cx;
    let nlz = lz - cz;
    let d = Math.hypot(nlx, nlz);
    let depth;
    if (d < 1e-6) {
        // the centre is inside: out along the nearest side
        const px = item.hw - Math.abs(lx);
        const pz = item.hd - Math.abs(lz);
        if (px < pz) {
            nlx = Math.sign(lx) || 1;
            nlz = 0;
            depth = px + r;
        } else {
            nlx = 0;
            nlz = Math.sign(lz) || 1;
            depth = pz + r;
        }
        d = 1;
    } else {
        if (d >= r) return false;
        depth = r - d;
    }
    nlx /= d;
    nlz /= d;
    out.nx = nlx * item.c + nlz * item.s;
    out.nz = -nlx * item.s + nlz * item.c;
    out.depth = depth;
    return true;
}

function surfaceDistance(item, x, z) {
    if (item.type === 0) {
        const p = closestOnSegment(item, x, z);
        return Math.hypot(x - p.x, z - p.z);
    }
    if (item.type === 1) return Math.max(0, Math.hypot(x - item.x, z - item.z) - item.r);
    const dx = x - item.x;
    const dz = z - item.z;
    const lx = Math.abs(dx * item.c - dz * item.s) - item.hw;
    const lz = Math.abs(dx * item.s + dz * item.c) - item.hd;
    return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}

const point = { x: 0, z: 0 };

function closestOnSegment(item, x, z) {
    const vx = item.bx - item.ax;
    const vz = item.bz - item.az;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - item.ax) * vx + (z - item.az) * vz) / l2));
    point.x = item.ax + vx * t;
    point.z = item.az + vz * t;
    return point;
}
