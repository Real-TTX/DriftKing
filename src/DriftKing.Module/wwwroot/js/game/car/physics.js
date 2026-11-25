// DriftKing · car/physics.js – arcade drift physics: a bicycle model on the ground plane (x, z, yaw) with slip angles, weight transfer,
// friction circles front and rear (power-over and the handbrake take the rear's side grip away), a six-speed gearbox with rev limiter,
// counter-steer assist, wall collisions (impulses on three circles along the car) and soft car-to-car pushes. y comes from the map.
// Units: metres, seconds, kilograms, newtons. yaw 0 looks along +z; forward = (sin yaw, cos yaw), left = (cos yaw, −sin yaw); yaw rate > 0 turns left.

import { settings } from '../settings.js';

const G = 9.81;
const STEP = 1 / 120;
const HALF_BASE = 1.25;
const WHEELBASE = 2.5;
const CG_HEIGHT = 0.5;
const GEARS = [0.31, 0.47, 0.61, 0.74, 0.87, 1.0];
const IDLE_RPM = 900;
export const REDLINE_RPM = 7800;
const LIMIT_RPM = 8100;
const CIRCLES = [1.45, 0, -1.45];
const RADIUS = 0.92;
const DEG = 180 / Math.PI;

/** The input of a car for one step: throttle, brake, handbrake 0..1, steer −1 (left) … +1 (right), shift requests. */
export function emptyControls() {
    return { throttle: 0, brake: 0, handbrake: 0, steer: 0, shiftUp: false, shiftDown: false };
}

/** One car's physics. Create it with the CarView's spec; place it with reset(). */
export class CarPhysics {
    /**
     * @param {{ massKg:number, powerKw:number, topSpeedKmh:number, gripFront:number, gripRear:number, steerLockDeg:number, handbrakeGrip:number, stability:number, drive:'RWD'|'AWD' }} spec
     * @param {{ assist?: number, transmission?: 'auto'|'manual' }} [options] fixed aids (bots); the player's come from the settings
     */
    constructor(spec, options = {}) {
        this.spec = spec;
        this.options = options;
        this.mass = spec.massKg;
        this.inertia = spec.massKg * 1.55;
        this.power = spec.powerKw * 1000;
        this.vmax = spec.topSpeedKmh / 3.6;
        this.drag = (this.power / this.vmax ** 3) * 0.82;
        this.lock = (spec.steerLockDeg / DEG) * 0.95;
        this.rearShare = spec.drive === 'AWD' ? 0.62 : 1;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.yaw = 0;
        this.vx = 0;
        this.vz = 0;
        this.yawRate = 0;
        this.reset(0, 0, 0, 0);
    }

    /** Puts the car still at (x, y, z) looking along yaw, in first gear. */
    reset(x, y, z, yaw) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.yaw = yaw;
        this.vx = 0;
        this.vz = 0;
        this.yawRate = 0;
        this.steer = 0;
        this.gear = 1;
        this.reverse = false;
        this.rpm = IDLE_RPM;
        this.accel = 0;
        this.shiftTimer = 0;
        this.kick = 0;
        this.limiterTime = 0;
        this.throttleLow = 0;
        this.lastThrottle = 0;
        this.rearSlip = 0;
        this.frontSlip = 0;
        this.spin = 0;
        this.impact = 0;
        this.collisions = 0;
        this.accumulator = 0;
        this.lateralG = 0;
    }

    /** Speed over ground (m/s). */
    get speed() {
        return Math.hypot(this.vx, this.vz);
    }

    /** Forward speed along the heading (m/s, negative backwards). */
    get forwardSpeed() {
        return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    }

    /** The drift angle: between the heading and the direction of travel (degrees, > 0 = the car slides to its left). 0 when slow. */
    get driftAngle() {
        const speed = this.speed;
        if (speed < 2) return 0;
        const u = this.forwardSpeed;
        const lateral = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
        return Math.atan2(lateral, Math.abs(u)) * DEG;
    }

    /**
     * Advances the car by dt (fixed steps of 1/120 s inside).
     * @param {number} dt
     * @param {ReturnType<typeof emptyControls>} controls
     * @param {{ groundAt(x:number, z:number):number, slopeAt?(x:number, z:number):{ slope:number, tx:number, tz:number }, colliders?: import('../world/colliders.js').Colliders }} world
     */
    update(dt, controls, world) {
        this.impact = 0;
        this.accumulator += Math.min(dt, 0.1);
        this.handleShifts(controls);
        while (this.accumulator >= STEP) {
            this.step(STEP, controls, world);
            this.accumulator -= STEP;
        }
    }

    handleShifts(c) {
        const manual = (this.options.transmission ?? settings.get().transmission) === 'manual';
        if (!manual) return;
        if (c.shiftUp && this.gear < GEARS.length && this.shiftTimer <= 0) {
            this.gear++;
            this.shiftTimer = 0.12;
        }
        if (c.shiftDown && this.gear > 1 && this.shiftTimer <= 0) {
            this.gear--;
            this.shiftTimer = 0.12;
        }
        c.shiftUp = false;
        c.shiftDown = false;
    }

    step(dt, c, world) {
        const s = this.spec;
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        let u = this.vx * sin + this.vz * cos;
        let lat = this.vx * cos - this.vz * sin;
        const speed = Math.hypot(u, lat);
        const assist = this.options.assist ?? settings.get().assist;
        const manual = (this.options.transmission ?? settings.get().transmission) === 'manual';

        // ---- driver inputs: reverse when standing on the brake, clutch kick on a quick lift-and-stab of the throttle
        let throttle = c.throttle;
        let brake = c.brake;
        if (this.reverse) {
            if (throttle > 0.1 && u > -0.5) this.reverse = false;
            else [throttle, brake] = [brake, throttle];
        } else if (brake > 0.5 && throttle < 0.1 && speed < 0.8) {
            this.reverse = true;
        }
        if (throttle < 0.15) this.throttleLow = 0.22;
        else if (this.throttleLow > 0 && throttle > 0.85 && u > 12 && Math.abs(c.steer) > 0.3 && !this.reverse) this.kick = 0.4;
        this.throttleLow = Math.max(0, this.throttleLow - dt);
        this.kick = Math.max(0, this.kick - dt);

        // ---- steering: the wheels follow the slide on their own (assist), the stick steers relative to that
        const slip = speed > 3 ? Math.atan2(lat, Math.abs(u)) : 0;
        const sliding = Math.min(1, Math.max(0, (Math.abs(slip) - 0.12) / 0.35));
        const speedFactor = 1 - 0.78 * Math.min(1, Math.max(0, (speed - 6) / 38));
        const lock = this.lock * (speedFactor + (1 - speedFactor) * sliding);
        const counter = assist * Math.max(-this.lock, Math.min(this.lock, slip)) * (0.6 + 0.4 * sliding);
        const target = Math.max(-this.lock, Math.min(this.lock, -c.steer * lock + counter));
        const rate = (Math.abs(target) < Math.abs(this.steer) ? 6 : 4.2) * (1 + sliding);
        this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
        const delta = u >= 0 ? this.steer : -this.steer;

        // ---- loads with weight transfer
        const weight = this.mass * G;
        const transfer = (this.mass * this.accel * CG_HEIGHT) / WHEELBASE;
        const loadFront = Math.max(weight * 0.15, weight * 0.5 - transfer);
        const loadRear = Math.max(weight * 0.15, weight * 0.5 + transfer);
        const capFront = s.gripFront * loadFront;
        let capRear = s.gripRear * loadRear;

        // ---- engine and gearbox
        if (!manual && !this.reverse) this.autoShift(Math.max(Math.abs(u), speed * 0.85), slip);
        this.shiftTimer = Math.max(0, this.shiftTimer - dt);
        const gearTop = this.reverse ? 9 : this.vmax * GEARS[this.gear - 1];
        // the revs flare with wheelspin, but a burnout never pins the needle at the limiter
        const wheelSpeed = Math.abs(u) + Math.min(this.spin, gearTop * 0.4);
        const rpmTarget = IDLE_RPM + (REDLINE_RPM - IDLE_RPM) * Math.min(1.04, wheelSpeed / gearTop) + (throttle > 0.1 && speed < 2 ? throttle * 2600 : 0);
        this.rpm += (Math.min(LIMIT_RPM, rpmTarget) - this.rpm) * Math.min(1, dt * 14);
        // the limiter cuts on the road speed (plus a little of the wheelspin): a launch must not bounce off it
        const limiter = (Math.abs(u) + this.spin * 0.3) / gearTop >= 1.02 && throttle > 0.2;
        this.limiterTime = limiter ? this.limiterTime + dt : Math.max(0, this.limiterTime - dt * 0.5);
        const rn = this.rpm / REDLINE_RPM;
        const curve = rn < 0.88 ? 0.32 + 0.68 * Math.pow(rn / 0.88, 0.85) : Math.max(0.6, 1 - (rn - 0.88) * 1.6);
        let drive = 0;
        if (this.shiftTimer <= 0 && !(limiter && (this.limiterTime * 30) % 2 < 1)) {
            const cap = this.power / (0.45 * gearTop);
            drive = throttle * Math.min((this.power * curve) / Math.max(Math.abs(u), 1.5), cap);
            if (this.reverse) drive = -Math.min(drive, this.mass * 3);
        }
        if (this.kick > 0) drive *= 1.7;

        // ---- longitudinal forces with brakes and handbrake, friction circles
        const dir = Math.sign(u) || (this.reverse ? -1 : 1);
        const brakeForce = brake * 1.05 * weight;
        let fxFront = drive * (1 - this.rearShare) - dir * Math.min(brakeForce * 0.64, capFront * 0.95) * (speed > 0.3 ? 1 : 0);
        let fxRear = drive * this.rearShare - dir * Math.min(brakeForce * 0.36, capRear * 0.95) * (speed > 0.3 ? 1 : 0);
        let latCapRear;
        let spinning = 0;
        if (c.handbrake > 0.5) {
            fxRear = speed > 0.3 ? -dir * capRear * 0.55 : 0;
            latCapRear = capRear * s.handbrakeGrip;
            this.spin = Math.max(0, this.spin - dt * 20);
        } else {
            if (Math.abs(fxRear) > capRear * 0.92) {
                spinning = Math.min(1.5, (Math.abs(fxRear) - capRear * 0.92) / capRear);
                fxRear = Math.sign(fxRear) * capRear * 0.9;
            }
            latCapRear = Math.sqrt(Math.max(0, capRear * capRear - fxRear * fxRear));
            // a launch should not throw the car around: below ~30 km/h the rear keeps its side grip
            const fade = Math.min(1, Math.max(0, (speed - 5) / 6));
            latCapRear = capRear + (latCapRear - capRear) * fade;
            this.spin += ((spinning > 0 ? 3 + spinning * 6 : 0) - this.spin) * Math.min(1, dt * 6);
        }
        fxFront = Math.max(-capFront * 0.95, Math.min(capFront * 0.95, fxFront));
        const latCapFront = Math.sqrt(Math.max(0, capFront * capFront - fxFront * fxFront));

        // ---- lateral tyre forces from the slip angles
        const forwardAbs = Math.max(Math.abs(u), 2.5);
        const alphaFront = Math.atan2(lat + HALF_BASE * this.yawRate, forwardAbs) - delta;
        const alphaRear = Math.atan2(lat - HALF_BASE * this.yawRate, forwardAbs);
        const fyFront = -latCapFront * tyre(alphaFront / 0.15);
        const fyRear = -latCapRear * tyre(alphaRear / 0.13);

        // ---- sum up in the car's frame
        const cd = Math.cos(delta);
        const sd = Math.sin(delta);
        const rolling = 0.012 * weight * Math.min(1, Math.abs(u)) * Math.sign(u);
        const engineBrake = throttle < 0.05 && !this.reverse ? 0.05 * weight * rn * Math.sign(u) * Math.min(1, Math.abs(u) / 3) : 0;
        const fx = fxRear + fxFront * cd - fyFront * sd - this.drag * u * Math.abs(u) - rolling - engineBrake;
        const fy = fyRear + fyFront * cd + fxFront * sd - this.drag * lat * Math.abs(lat) * 0.5;
        const torque = HALF_BASE * (fyFront * cd + fxFront * sd) - HALF_BASE * fyRear;

        // ---- integrate (world frame), slopes push along the course
        let ax = (fx / this.mass) * sin + (fy / this.mass) * cos;
        let az = (fx / this.mass) * cos - (fy / this.mass) * sin;
        const slope = world.slopeAt?.(this.x, this.z);
        if (slope) {
            ax -= G * slope.slope * slope.tx;
            az -= G * slope.slope * slope.tz;
        }
        this.vx += ax * dt;
        this.vz += az * dt;
        this.yawRate += (torque / this.inertia) * dt;
        // stability: a little yaw damping (more with a good suspension) and help against spinning beyond ~70°
        this.yawRate *= 1 - dt * (0.35 + s.stability * 0.5);
        if (Math.abs(slip) > 0.85 && speed > 6) this.yawRate += Math.sign(slip) * (Math.abs(slip) - 0.85) * (0.4 + assist) * 7 * dt;
        // crawling: kinematic steering, no side slip
        if (speed < 3) {
            const blend = 1 - speed / 3;
            const kinematic = (u * Math.tan(delta)) / WHEELBASE;
            this.yawRate += (kinematic - this.yawRate) * Math.min(1, dt * 12 * blend);
            u = this.vx * sin + this.vz * cos;
            lat = (this.vx * cos - this.vz * sin) * (1 - Math.min(1, dt * 10 * blend));
            this.vx = u * sin + lat * cos;
            this.vz = u * cos - lat * sin;
            if (throttle < 0.05 && brake > 0.1 && speed < 0.25 && !this.reverse) {
                this.vx = 0;
                this.vz = 0;
            }
        }
        this.yaw += this.yawRate * dt;
        this.x += this.vx * dt;
        this.z += this.vz * dt;
        this.accel += (fx / this.mass - this.accel) * Math.min(1, dt * 8);
        this.lateralG += (fy / weight - this.lateralG) * Math.min(1, dt * 6);

        // ---- what the effects need: slip of the axles (m/s)
        this.rearSlip = Math.abs(Math.sin(alphaRear)) * speed + (spinning > 0 ? this.spin : 0) + (c.handbrake > 0.5 && speed > 2 ? speed * 0.6 : 0);
        this.frontSlip = Math.abs(Math.sin(alphaFront)) * speed;
        if (world.colliders) this.collide(world.colliders);
        this.y = world.groundAt(this.x, this.z);
    }

    /** The automatic gearbox: up at the top of a gear (or after a while on the limiter – later while drifting), down when the speed falls. */
    autoShift(v, slip) {
        if (this.shiftTimer > 0) return;
        const top = this.vmax * GEARS[this.gear - 1];
        const drifting = Math.abs(slip) > 0.25;
        const wheels = v + this.spin;
        if (this.gear < GEARS.length && (v > top * 0.97 || (!drifting && v > top * 0.72 && wheels > top) || this.limiterTime > (drifting ? 1.2 : 0.25))) {
            this.gear++;
            this.shiftTimer = 0.16;
        } else if (this.gear > 1 && v < this.vmax * GEARS[this.gear - 2] * 0.6) {
            this.gear--;
            this.shiftTimer = 0.1;
        }
    }

    /** Pushes the car out of walls and posts: an impulse at each of its three circles (bounce, scrape, a spin from off-centre hits). */
    collide(colliders) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        for (const offset of CIRCLES) {
            const ox = sin * offset;
            const oz = cos * offset;
            const contact = colliders.contact(this.x + ox, this.z + oz, RADIUS, hit);
            if (!contact) continue;
            this.x += contact.nx * contact.depth;
            this.z += contact.nz * contact.depth;
            this.applyImpulse(ox, oz, contact.nx, contact.nz, 0.2);
        }
    }

    /**
     * An impulse at the point (ox, oz) from the centre against a surface with normal n; otherInverseMass: 1/mass of the other car (0 = a wall or a car
     * that is not pushed), otherV: its velocity.
     * Returns the closing speed (m/s) – the strength of the hit.
     */
    applyImpulse(ox, oz, nx, nz, restitution, otherInverseMass = 0, otherVx = 0, otherVz = 0) {
        const pvx = this.vx + this.yawRate * oz - otherVx;
        const pvz = this.vz - this.yawRate * ox - otherVz;
        const vn = pvx * nx + pvz * nz;
        if (vn >= 0) return 0;
        const arm = oz * nx - ox * nz;
        const inverse = 1 / this.mass + (arm * arm) / this.inertia + otherInverseMass;
        const j = (-(1 + restitution) * vn) / inverse;
        this.vx += (j * nx) / this.mass;
        this.vz += (j * nz) / this.mass;
        this.yawRate += (arm * j) / this.inertia;
        // scraping along: lose some of the speed along the surface
        const tx = -nz;
        const tz = nx;
        const vt = pvx * tx + pvz * tz;
        const friction = Math.min(Math.abs(vt), (0.25 * j) / this.mass) * Math.sign(vt);
        this.vx -= friction * tx;
        this.vz -= friction * tz;
        const strength = -vn;
        if (strength > this.impact) this.impact = strength;
        if (strength > 2.5) this.collisions++;
        return strength;
    }
}

/** The tyre curve: linear up to the peak (x = 1), then a slow fall to 82 % – slides stay controllable. */
function tyre(x) {
    const a = Math.abs(x);
    const f = a < 1 ? a * (2 - a) : Math.max(0.82, 1 - (a - 1) * 0.08);
    return Math.sign(x) * f;
}

const hit = { nx: 0, nz: 0, depth: 0 };

/**
 * Soft collision between two cars (three circles each). b may be kinematic (a remote car: only a is pushed).
 * Returns the strength of the hit (m/s) or 0.
 */
export function collideCars(a, b, bKinematic = false) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 36) return 0;
    let strongest = 0;
    const sa = Math.sin(a.yaw);
    const ca = Math.cos(a.yaw);
    const sb = Math.sin(b.yaw);
    const cb = Math.cos(b.yaw);
    for (const oa of CIRCLES) {
        for (const ob of CIRCLES) {
            const ax = a.x + sa * oa;
            const az = a.z + ca * oa;
            const bx = b.x + sb * ob;
            const bz = b.z + cb * ob;
            const ddx = ax - bx;
            const ddz = az - bz;
            const d = Math.hypot(ddx, ddz);
            if (d >= RADIUS * 2 || d < 1e-6) continue;
            const nx = ddx / d;
            const nz = ddz / d;
            const depth = RADIUS * 2 - d;
            if (bKinematic) {
                a.x += nx * depth;
                a.z += nz * depth;
                strongest = Math.max(strongest, a.applyImpulse(sa * oa, ca * oa, nx, nz, 0.3, 0, b.vx ?? 0, b.vz ?? 0));
            } else {
                const share = b.mass / (a.mass + b.mass);
                a.x += nx * depth * share;
                a.z += nz * depth * share;
                b.x -= nx * depth * (1 - share);
                b.z -= nz * depth * (1 - share);
                const bvx = b.vx;
                const bvz = b.vz;
                const avx = a.vx;
                const avz = a.vz;
                const strength = a.applyImpulse(sa * oa, ca * oa, nx, nz, 0.3, 1 / b.mass, bvx, bvz);
                b.applyImpulse(sb * ob, cb * ob, -nx, -nz, 0.3, 1 / a.mass, avx, avz);
                strongest = Math.max(strongest, strength);
            }
        }
    }
    return strongest;
}
