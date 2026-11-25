// DriftKing · car/vehicle.js – a car as seen: the model placed and leaning from a driving state (the own physics, a bot's, or a remote car's
// interpolated state). The body hangs on springs: it rolls out of corners, squats under power, dives under braking and heaves over crests
// and kerbs, with the overshoot and settle of real dampers (second-order springs, ~1.5 Hz). Wheels steer and spin, brake and reverse
// lamps light up, and the tyres leave skid marks and smoke where they slide.

import { buildCar, CAR } from './models.js';
import { LAMP } from './model-materials.js';

/** Body motion: natural frequency (Hz), damping ratio, gain and limit per axis. */
const ROLL = { hz: 1.6, damping: 0.45, gain: 0.05, limit: 0.075 };
const PITCH = { hz: 1.4, damping: 0.5, gain: -0.0065, limit: 0.05 };
const HEAVE = { hz: 1.8, damping: 0.42, limit: 0.05 };
const STEP = 1 / 120;

/** A damped spring x'' = ω²(target − x) − 2ζω x' − push. */
class Spring {
    constructor({ hz, damping }) {
        this.omega = 2 * Math.PI * hz;
        this.zeta = damping;
        this.x = 0;
        this.v = 0;
    }

    update(dt, target, push = 0) {
        let left = dt;
        while (left > 1e-6) {
            const h = Math.min(STEP, left);
            const a = this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v - push;
            this.v += a * h;
            this.x += this.v * h;
            left -= h;
        }
        return this.x;
    }
}

/**
 * The state the picture needs (physics fields or a remote snapshot):
 * { x, y, z, yaw, steer (front wheel angle, rad), forward (m/s), rearSlip, frontSlip, braking (0/1), lateralG, accel, pitch (slope along heading) }
 */
export class Vehicle {
    /** @param {object} view the CarView */
    constructor(view) {
        this.view = view;
        this.model = buildCar(view);
        this.model.rotation.order = 'YXZ';
        this.parts = this.model.userData;
        this.roll = new Spring(ROLL);
        this.pitch = new Spring(PITCH);
        this.heave = new Spring(HEAVE);
        this.rideHeight = this.parts.body.position.y;
        this.lastY = null;
        this.vy = null;
        this.time = 0;
        this.brake = 0;
        this.reverse = 0;
        this.brakeGlow = 0.55;
        this.wheelIds = [`${Math.random()}`, `${Math.random()}`, `${Math.random()}`, `${Math.random()}`];
    }

    /**
     * Places the model. fx (optional): { skids, smoke, quality } – the tyres leave marks and smoke where they slide.
     * @param {number} dt
     * @param {object} s the state (see above)
     */
    update(dt, s, fx = null) {
        const m = this.model;
        const body = this.parts.body;
        m.position.set(s.x, s.y, s.z);
        m.rotation.y = s.yaw;
        m.rotation.x = -Math.atan(s.pitch ?? 0);
        this.time += dt;

        // the ground's vertical acceleration pushes the body on its springs (crests, kerbs, landings); a jump in height resets
        let ay = 0;
        if (dt > 1e-4) {
            if (this.lastY !== null && Math.abs(s.y - this.lastY) < 0.6) {
                const vy = (s.y - this.lastY) / dt;
                if (this.vy !== null) ay = Math.max(-25, Math.min(25, (vy - this.vy) / dt));
                this.vy = vy;
            } else {
                this.vy = null;
            }
            this.lastY = s.y;
        }
        const speed = Math.abs(s.forward ?? 0);
        const roll = clamp((s.lateralG ?? 0) * ROLL.gain, ROLL.limit);
        const pitch = clamp((s.accel ?? 0) * PITCH.gain, PITCH.limit);
        // an idling engine shakes the body a little; at speed the road adds a fine buzz
        const idle = speed < 1 ? Math.sin(this.time * 2 * Math.PI * 13) * 0.0011 : 0;
        body.rotation.z = clamp(this.roll.update(dt, roll), ROLL.limit * 1.25) + idle;
        body.rotation.x = clamp(this.pitch.update(dt, pitch), PITCH.limit * 1.25);
        const heave = clamp(this.heave.update(dt, 0, ay * 0.6), HEAVE.limit);
        const buzz = Math.sin(this.time * 2 * Math.PI * 9.5) * 0.0008 * Math.min(1, speed / 25);
        body.position.y = this.rideHeight + heave + buzz;

        // wheels: the fronts steer, all spin (the rears a little faster when they spin up in a drift)
        const spin = ((s.forward ?? 0) / CAR.wheelRadius) * dt;
        for (const w of this.parts.wheels) {
            if (w.front) w.pivot.rotation.y = s.steer ?? 0;
            // the right wheels sit turned around: their spin runs the other way in their own frame
            w.spin.rotation.x += (w.front ? spin : spin + (s.rearSlip ?? 0) * 0.3 * dt * Math.sign(s.forward || 1)) * w.side;
        }
        this.parts.syncWheels?.();

        // lamps: brake lights flare up fast and fade quickly; reverse lights while rolling backwards
        const k = Math.min(1, dt * 18);
        this.brake += ((s.braking ? 1 : 0) - this.brake) * k;
        this.reverse += (((s.forward ?? 0) < -0.8 && !s.braking ? 1 : 0) - this.reverse) * Math.min(1, dt * 10);
        this.brakeGlow = 0.55 + 1.25 * this.brake;
        this.parts.tailGlow.material.uniforms.intensity.value = this.brakeGlow;
        const lamps = this.parts.lamps;
        if (lamps) {
            lamps.tail.color.copy(lamps.tail.userData.base).multiplyScalar(LAMP.tail + (LAMP.brake - LAMP.tail) * this.brake);
            lamps.reverse.color.copy(lamps.reverse.userData.base).multiplyScalar(LAMP.reverseOff + (LAMP.reverse - LAMP.reverseOff) * this.reverse);
        }
        if (fx) this.effects(dt, s, fx);
    }

    /** Skid marks under sliding tyres, smoke from the rear ones. */
    effects(dt, s, { skids, smoke, smokeRate = 1 }) {
        const sin = Math.sin(s.yaw);
        const cos = Math.cos(s.yaw);
        const profile = this.parts.profile;
        const half = profile.halfTrack ?? (profile.width - 0.26) / 2;
        const rear = Math.min(1, Math.max(0, ((s.rearSlip ?? 0) - 2.5) / 9));
        const front = Math.min(1, Math.max(0, ((s.frontSlip ?? 0) - 4) / 10));
        let k = 0;
        for (const z of [CAR.wheelbase / 2, -CAR.wheelbase / 2]) {
            for (const side of [1, -1]) {
                const x = s.x + cos * side * half + sin * z;
                const wz = s.z - sin * side * half + cos * z;
                const strength = z > 0 ? front : rear;
                skids?.mark(this.wheelIds[k], x, s.y, wz, strength);
                if (z < 0 && smoke && strength > 0.2 && Math.random() < strength * smokeRate * dt * 22) {
                    const vx = (s.vx ?? sin * (s.forward ?? 0)) * 0.5;
                    const vz = (s.vz ?? cos * (s.forward ?? 0)) * 0.5;
                    smoke.emit(x, s.y + 0.35, wz, vx, vz, 0.6, strength);
                }
                k++;
            }
        }
    }

    dispose() {
        this.model.removeFromParent();
        this.parts.dispose();
    }
}

function clamp(v, limit) {
    return Math.max(-limit, Math.min(limit, v));
}
