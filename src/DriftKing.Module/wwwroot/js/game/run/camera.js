// DriftKing · run/camera.js – the camera of a run, filmed like a modern racing game: a close chase camera just over the roof that has
// weight – it trails the turns a little, falls back when the car pulls and closes in under braking, looks into the drift, banks a few degrees
// in a slide and shivers at high speed and on hits. 'near' sits tighter and lower (the rear of the car fills the lower half), 'hood' rides
// on the bonnet and moves with the body; after the finish a slow orbit around the car.
// Chase cameras look along the direction of travel blended with the nose: in a drift the car is seen at an angle, the way drifting looks best.
// The camera never passes through walls, posts or containers: world.colliders pulls it in along the line from the car (and lifts it a little).

import * as THREE from 'three';

/**
 * The chase modes (metres, degrees): distance behind the car's centre, height of the eye above the ground (chase: over the roof), the point the
 * camera looks at (ahead of the car, at a height), the field of view at rest and how much it widens at top speed.
 */
const MODES = {
    chase: { distance: 5.5, height: 1.68, overRoof: 0.36, ahead: 6.5, lookHeight: 0.92, fov: 58, speedFov: 8, speedDistance: 0.45 },
    near: { distance: 4.35, height: 1.42, overRoof: 0.14, ahead: 8, lookHeight: 0.95, fov: 62, speedFov: 7, speedDistance: 0.25 },
};
/** The hood camera: just ahead of the windscreen base, a hand above the bonnet, looking far ahead (the bonnet's edge stays in view). */
const HOOD = { up: 0.15, back: 0.28, fov: 66, speedFov: 7 };
/** The orbit after the finish. */
const ORBIT = { radius: 7.2, height: 2.3, speed: 0.24, fov: 52 };
/** Keeps the eye this far from any obstacle; never closer to the car's centre than MIN_DISTANCE (it rises instead). */
const WALL_MARGIN = 0.4;
const MIN_DISTANCE = 1.6;
/** Speed (m/s) where the speed effects (wider view, shiver) are full. */
const FAST = 52;

const forward = new THREE.Vector3();
const local = new THREE.Vector3();
const bodyMatrix = new THREE.Matrix4();
const upVector = new THREE.Vector3();

/** The camera rig: update(dt, car) every frame; mode 'chase' | 'near' | 'hood' | 'orbit'. */
export class RunCamera {
    constructor() {
        this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1400);
        this.mode = 'chase';
        /** world.colliders (optional): keeps the camera out of walls. */
        this.colliders = null;
        /** The car model the camera follows (optional): its profile sets the heights, its body carries the hood camera. */
        this.model = null;
        this.direction = 0;
        this.directionRate = 0;
        this.lookDirection = 0;
        this.position = new THREE.Vector3();
        this.target = new THREE.Vector3();
        this.goal = new THREE.Vector3();
        this.ready = false;
        this.orbit = 0;
        this.shake = 0;
        this.time = 0;
        this.roll = 0;
        this.lag = 0;
        this.lastSpeed = 0;
        this.pull = Infinity;
        this.rise = 0;
        this.fov = 58;
        this.hits = { t: 1 };
        this.probe = { ax: 0, az: 0, dx: 0, dz: 0, length: 0 };
        this.testItem = item => this.testObstacle(item);
    }

    /** Jumps to the car without easing (start, reset, a new mode). */
    snap() {
        this.ready = false;
    }

    /** The car the camera follows (its model: userData.profile gives the roof height, userData.body carries the hood camera). */
    follow(model) {
        this.model = model;
    }

    /**
     * @param {number} dt
     * @param {{ x:number, y:number, z:number, yaw:number, vx:number, vz:number, speed?:number, lateralG?:number, rearSlip?:number }} car
     */
    update(dt, car) {
        const cam = this.camera;
        const speed = car.speed ?? Math.hypot(car.vx, car.vz);
        this.time += dt;
        cam.up.set(0, 1, 0);
        if (this.mode === 'orbit') {
            this.updateOrbit(dt, car);
        } else if (this.mode === 'hood' && this.model?.userData?.body) {
            this.updateHood(dt, car, speed);
        } else {
            this.updateChase(dt, car, speed);
        }
        this.lastSpeed = speed;
    }

    updateOrbit(dt, car) {
        const cam = this.camera;
        this.orbit += dt * ORBIT.speed;
        let distance = ORBIT.radius;
        const dx = Math.sin(this.orbit);
        const dz = Math.cos(this.orbit);
        distance = this.clip(car.x, car.z, dx, dz, distance, dt);
        cam.position.set(car.x + dx * distance, car.y + ORBIT.height + this.rise, car.z + dz * distance);
        cam.lookAt(car.x, car.y + 0.7, car.z);
        this.setFov(ORBIT.fov, dt);
        this.ready = false;
    }

    updateHood(dt, car, speed) {
        const cam = this.camera;
        const model = this.model;
        const body = model.userData.body;
        const profile = model.userData.profile ?? {};
        // the body's frame (the model's place and heading, the body's lean): the camera rides with the roll and the pitch
        model.updateMatrix();
        body.updateMatrix();
        bodyMatrix.multiplyMatrices(model.matrix, body.matrix);
        // the bonnet at the base of the windscreen (models without these measures: a typical coupé)
        const cowl = profile.cowl ?? 0.92;
        const front = (profile.aFront ?? 0.58) + HOOD.back;
        cam.position.copy(local.set(0, cowl + HOOD.up, front).applyMatrix4(bodyMatrix));
        upVector.set(0, 1, 0).transformDirection(bodyMatrix);
        cam.up.copy(upVector);
        this.addShake(cam.position, dt, speed, car, 0.4);
        this.target.copy(local.set(0, cowl - 0.25, front + 24).applyMatrix4(bodyMatrix));
        cam.lookAt(this.target);
        this.setFov(HOOD.fov + HOOD.speedFov * smooth(speed / FAST), dt);
        this.ready = false;
    }

    updateChase(dt, car, speed) {
        const cam = this.camera;
        const m = MODES[this.mode] ?? MODES.chase;
        const fwdX = Math.sin(car.yaw);
        const fwdZ = Math.cos(car.yaw);
        // where the car goes: the direction of travel (in a drift that is not where the nose points)
        let travel = car.yaw;
        if (speed > 4) {
            const along = car.vx * fwdX + car.vz * fwdZ;
            if (along > -1) travel = Math.atan2(car.vx, car.vz);
        }
        const slide = wrap(travel - car.yaw);
        // the camera's heading: the nose blended with the travel (more of it the faster), on a soft spring – it trails a turn and catches up
        const blend = 0.62 * smooth((speed - 3) / 10);
        const wanted = car.yaw + slide * blend;
        // the look: further into the travel than the camera itself – into the corner, into the drift
        const wantedLook = car.yaw + slide * Math.min(0.95, blend + 0.3);
        const roof = this.model?.userData?.profile?.roof;
        const height = roof ? Math.max(m.height - 0.12, roof + m.overRoof) : m.height;
        if (!this.ready) {
            this.direction = wanted;
            this.directionRate = 0;
            this.lookDirection = wantedLook;
            this.lag = 0;
            this.roll = 0;
            this.pull = Infinity;
            this.rise = 0;
        } else {
            // a critically damped spring (ω = 4.2): no overshoot, a little weight
            const omega = 4.2;
            const error = wrap(wanted - this.direction);
            this.directionRate += (error * omega * omega - this.directionRate * 2 * omega) * dt;
            this.direction += this.directionRate * dt;
            this.lookDirection += wrap(wantedLook - this.lookDirection) * Math.min(1, dt * 6);
        }
        // falls back when the car pulls away, closes in under braking (the speed change, smoothed)
        const accel = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
        const lagGoal = this.ready ? Math.max(-0.45, Math.min(0.55, accel * 0.07)) : 0;
        this.lag += (lagGoal - this.lag) * Math.min(1, dt * 2.5);
        const dx = Math.sin(this.direction);
        const dz = Math.cos(this.direction);
        let distance = m.distance + m.speedDistance * smooth(speed / FAST) + this.lag;
        distance = this.clip(car.x, car.z, -dx, -dz, distance, dt);
        const goal = this.goal.set(car.x - dx * distance, car.y + height + this.rise, car.z - dz * distance);
        if (!this.ready) {
            this.position.copy(goal);
            this.ready = true;
        } else {
            // across the ground the spring above carries the weight; the height follows crests and dips a little softer
            this.position.x = goal.x;
            this.position.z = goal.z;
            this.position.y += (goal.y - this.position.y) * Math.min(1, dt * 7);
            // never below the car's ground (hairpins and crests on the pass)
            this.position.y = Math.max(this.position.y, car.y + 1.05);
        }
        const lx = Math.sin(this.lookDirection);
        const lz = Math.cos(this.lookDirection);
        this.target.set(car.x + lx * m.ahead, car.y + m.lookHeight, car.z + lz * m.ahead);
        cam.position.copy(this.position);
        this.addShake(cam.position, dt, speed, car, 1);
        cam.lookAt(this.target);
        // banks a little into a slide (a few degrees at most)
        const bank = Math.max(-0.045, Math.min(0.045, (car.lateralG ?? 0) * 0.03 + slide * 0.025 * smooth((speed - 6) / 12)));
        this.roll += (bank - this.roll) * Math.min(1, dt * 3);
        cam.rotateZ(this.roll);
        this.setFov(m.fov + m.speedFov * smooth(speed / FAST), dt);
    }

    /**
     * The free distance along the ground from the car (x, z) in the unit direction (dx, dz), up to `distance`: walls, posts and boxes
     * (world.colliders) pull the camera in at once; it eases back out. Below MIN_DISTANCE it stays there and rises instead.
     */
    clip(x, z, dx, dz, distance, dt) {
        let free = distance;
        if (this.colliders) {
            const probe = this.probe;
            probe.ax = x;
            probe.az = z;
            probe.dx = dx;
            probe.dz = dz;
            probe.length = distance + WALL_MARGIN;
            this.hits.t = probe.length;
            this.colliders.near(x + dx * probe.length * 0.5, z + dz * probe.length * 0.5, probe.length * 0.5 + 1, this.testItem);
            free = Math.min(distance, this.hits.t - WALL_MARGIN);
        }
        // in at once, out slowly (no pumping along a wall)
        if (!this.ready || free < this.pull) this.pull = free;
        else this.pull = Math.min(free, this.pull + dt * 2.2);
        const used = Math.max(MIN_DISTANCE, Math.min(distance, this.pull));
        const squeezed = smooth((distance - used) / 2.5);
        this.rise += (squeezed * 0.8 - this.rise) * Math.min(1, dt * 4);
        return used;
    }

    /** Where the probe line first meets one obstacle (world/colliders.js items: 0 segment, 1 circle, 2 turned box). */
    testObstacle(item) {
        const p = this.probe;
        let t;
        if (item.type === 0) t = raySegment(p, item.ax, item.az, item.bx, item.bz);
        else if (item.type === 1) t = rayCircle(p, item.x, item.z, item.r + 0.05);
        else t = rayBox(p, item);
        if (t >= 0 && t < this.hits.t) this.hits.t = t;
    }

    /** A jolt after a hit (strength in m/s). */
    bump(strength) {
        this.shake = Math.max(this.shake, Math.min(1.5, strength / 8));
    }

    /** The shiver of speed, of a sliding rear and of hits: smooth noise (a few unrelated sines), not white jitter. */
    addShake(position, dt, speed, car, scale) {
        if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.6);
        const fast = smooth((speed - 22) / (FAST - 22)) * 0.016;
        const rumble = Math.min(1, Math.max(0, ((car.rearSlip ?? 0) - 3) / 10)) * 0.008;
        const hit = this.shake * this.shake * 0.14;
        const a = (fast + rumble + hit) * scale;
        if (a <= 0) return;
        const t = this.time;
        position.x += a * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3 + 1.7) * 0.4);
        position.y += a * (Math.sin(t * 41.7 + 0.6) * 0.6 + Math.sin(t * 19.9 + 2.9) * 0.4);
        position.z += a * (Math.sin(t * 31.3 + 4.1) * 0.6 + Math.sin(t * 27.7 + 0.3) * 0.4);
    }

    setFov(fov, dt = 1 / 60) {
        this.fov += (fov - this.fov) * Math.min(1, dt * 5);
        if (Math.abs(this.camera.fov - this.fov) < 0.02) return;
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
    }
}

/** 0..1 with a soft start and end. */
function smooth(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

/** The distance along the probe to the segment (a, b), or -1. */
function raySegment(p, ax, az, bx, bz) {
    const ex = bx - ax;
    const ez = bz - az;
    const denominator = p.dx * ez - p.dz * ex;
    if (Math.abs(denominator) < 1e-9) return -1;
    const wx = ax - p.ax;
    const wz = az - p.az;
    const t = (wx * ez - wz * ex) / denominator;
    const u = (wx * p.dz - wz * p.dx) / denominator;
    return t >= 0 && t <= p.length && u >= 0 && u <= 1 ? t : -1;
}

/** The distance along the probe to the circle (cx, cz, r), or -1 (0 when the probe starts inside it). */
function rayCircle(p, cx, cz, r) {
    const ox = p.ax - cx;
    const oz = p.az - cz;
    const b = ox * p.dx + oz * p.dz;
    const c = ox * ox + oz * oz - r * r;
    if (c <= 0) return 0;
    const h = b * b - c;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t >= 0 && t <= p.length ? t : -1;
}

/** The distance along the probe to a turned box (local x = (c, -s), local z = (s, c)), or -1 (0 when the probe starts inside it). */
function rayBox(p, box) {
    const ox = p.ax - box.x;
    const oz = p.az - box.z;
    const lx = ox * box.c - oz * box.s;
    const lz = ox * box.s + oz * box.c;
    const dx = p.dx * box.c - p.dz * box.s;
    const dz = p.dx * box.s + p.dz * box.c;
    slab.near = -Infinity;
    slab.far = Infinity;
    if (!clipSlab(lx, dx, box.hw) || !clipSlab(lz, dz, box.hd)) return -1;
    if (slab.far < 0) return -1;
    if (slab.near < 0) return 0;
    return slab.near <= p.length ? slab.near : -1;
}

const slab = { near: 0, far: 0 };

/** Narrows slab.near/far to where the line o + d·t lies within ±h; false when it never does. */
function clipSlab(o, d, h) {
    if (Math.abs(d) < 1e-9) return o >= -h && o <= h;
    let t0 = (-h - o) / d;
    let t1 = (h - o) / d;
    if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
    }
    slab.near = Math.max(slab.near, t0);
    slab.far = Math.min(slab.far, t1);
    return slab.near <= slab.far;
}
