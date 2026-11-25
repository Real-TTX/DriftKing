// DriftKing · car/bot.js – the AI driver. It looks ahead along the course: brakes so that it arrives at each corner with a speed it can carry,
// throws the car sideways at the corner (handbrake for tight ones, a throttle stab for open ones), holds an angle with the throttle and lets the
// counter-steer assist catch the slide, straightens out on the straights. skill 0..1 scales pace, angle and how many corners it drifts.
// Bots drive the same CarPhysics as the players.

import { emptyControls } from './physics.js';

const G = 9.81;

/** One bot's brain. drive() returns the controls for this frame (and controls.reset when it is stuck). */
export class BotDriver {
    /**
     * @param {import('../world/course.js').Course} course
     * @param {{ skill?: number, seed?: number }} [options]
     */
    constructor(course, { skill = 0.6, seed = 1 } = {}) {
        this.course = course;
        this.skill = Math.min(1, Math.max(0, skill));
        this.controls = emptyControls();
        this.mode = 'grip';
        this.modeTime = 0;
        this.stuck = 0;
        this.wrongWay = 0;
        this.seed = seed;
        this.drifty = 0.55 + 0.45 * this.skill;
        this.line = ((seed * 7919) % 100) / 100 - 0.5;
        this.point = {};
    }

    /**
     * @param {import('./physics.js').CarPhysics} car
     * @param {{ s:number, lateral:number, index:number, tx:number, tz:number }} at the car's place on the course
     * @param {number} dt
     * @param {boolean} [racing] false before the start: stand still
     */
    drive(car, at, dt, racing = true) {
        const c = this.controls;
        c.reset = false;
        c.shiftUp = false;
        c.shiftDown = false;
        if (!racing) {
            c.throttle = 0;
            c.brake = 1;
            c.steer = 0;
            c.handbrake = 0;
            return c;
        }
        this.modeTime += dt;
        const course = this.course;
        const speed = car.speed;
        const pace = 0.78 + 0.24 * this.skill;

        // where to go: a point ahead on the centre line, a little to the inside of the coming corner
        const look = 7 + speed * 0.5;
        const kAhead = course.curvatureAhead(at.s, 18 + speed * 0.8);
        const inside = Math.sign(kAhead) * Math.min(1, Math.abs(kAhead) * 40) * course.width * 0.18;
        const p = course.at(at.s + look, this.point);
        const offset = inside + this.line * course.width * 0.2;
        const tx = p.x + p.tz * offset - car.x;
        const tz = p.z - p.tx * offset - car.z;
        const targetHeading = Math.atan2(tx, tz);
        const travel = speed > 3 ? Math.atan2(car.vx, car.vz) : car.yaw;
        const pathError = wrap(targetHeading - travel);
        const headingError = wrap(targetHeading - car.yaw);

        // how fast it may go now: every corner in the next 140 m must be reachable with braking
        const allowed = this.allowedSpeed(at.s, pace, at.slope ?? 0);

        // close to the edge and still moving towards it: get out of trouble
        const half = course.width / 2;
        const outward = (car.vx * at.tz - car.vz * at.tx) * Math.sign(at.lateral);
        const danger = Math.abs(at.lateral) > half - 2.6 && outward > 1;

        // drifting: enter at a corner, hold the angle, leave on the straight
        const angle = car.driftAngle;
        const turn = Math.sign(kAhead);
        // the angle it aims for: bigger for good bots, smaller on narrow roads
        const want = (20 + 26 * this.skill) * clamp(course.width / 14, 0.7, 1) * (turn > 0 ? -1 : 1);
        if (this.mode === 'grip') {
            const cornerSoon = Math.abs(course.curvatureAhead(at.s + 2, 4 + speed * 0.35)) > 1 / 70;
            if (cornerSoon && speed > 13 && this.modeTime > 0.8 && this.decide(at.s)) this.setMode('entry');
        } else if (this.mode === 'entry') {
            if (Math.abs(angle) > Math.abs(want) * 0.6 || this.modeTime > 0.6) this.setMode('drift');
        } else if (this.mode === 'drift') {
            const straight = Math.abs(course.curvatureAhead(at.s, 10 + speed * 0.4)) < 1 / 140;
            if ((straight && this.modeTime > 0.6) || speed < 8 || this.modeTime > 9 || Math.abs(angle) > 80) this.setMode('grip');
        }

        if (this.mode === 'entry') {
            c.steer = turn > 0 ? -1 : 1;
            const tight = Math.abs(kAhead) > 1 / 30;
            c.handbrake = tight || speed > allowed * 1.05 ? 1 : 0;
            c.throttle = tight ? 0.2 : 1;
            c.brake = speed > allowed * 1.15 ? 0.6 : 0;
        } else if (this.mode === 'drift') {
            // the assist points the wheels along the slide; the bot steers the path and rides the throttle for the angle
            c.steer = clamp(-pathError * 2.4 - (angle - want) * 0.012, -1, 1);
            const error = Math.abs(angle) - Math.abs(want);
            c.throttle = clamp(0.78 - error * 0.03, 0.2, 1);
            if (Math.sign(angle) !== Math.sign(want) && Math.abs(angle) > 8) c.throttle = 0.3;
            c.handbrake = 0;
            c.brake = speed > allowed * 1.25 ? 0.5 : 0;
            if (Math.abs(angle) > 64 || danger) c.throttle = Math.min(c.throttle, 0.15);
        } else {
            c.steer = clamp(-headingError * 2.2 + (danger ? Math.sign(at.lateral) * 0.5 : 0), -1, 1);
            c.handbrake = 0;
            if (speed > allowed + 2) {
                c.throttle = 0;
                c.brake = clamp((speed - allowed) / 6, 0.2, 1);
            } else {
                c.brake = 0;
                c.throttle = clamp((allowed - speed) / 4, 0.25, 1);
            }
        }
        if (danger) this.keepOnRoad(car, at, dt);
        this.watchStuck(car, at, dt, speed);
        return c;
    }

    /**
     * A bot's guardian angel: close to the edge and sliding towards it, a gentle push back to the road (bots should drift, not bounce off
     * every guardrail). Players never get it.
     */
    keepOnRoad(car, at, dt) {
        const side = Math.sign(at.lateral);
        const push = 10 * dt;
        car.vx -= at.tz * side * push;
        car.vz += at.tx * side * push;
    }

    /** The speed the bot may have now so it can brake down to every corner ahead (drifting corners a little faster: no grip limit on angle). */
    allowedSpeed(s, pace, slope) {
        const course = this.course;
        let allowed = Infinity;
        // downhill the brakes have less to give
        const decel = Math.max(3, 6.5 + this.skill * 2 + G * slope);
        for (let d = 0; d <= 140; d += 4) {
            const k = Math.abs(course.at(s + d, this.point).k);
            if (k < 1e-4) continue;
            // hairpins are drifted slowly and tight
            const grip = k > 1 / 30 ? 0.72 : 0.92;
            const corner = Math.sqrt((grip * G) / k) * Math.min(pace, k > 1 / 30 ? 0.92 : pace);
            allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * decel * d));
        }
        return Math.min(allowed, 80);
    }

    /** Whether to drift the corner at s (most of them; fewer for weak bots). Stable per corner and bot. */
    decide(s) {
        const corner = Math.floor(s / 40);
        const r = Math.abs(Math.sin(corner * 12.9898 + this.seed * 78.233) * 43758.5453) % 1;
        return r < this.drifty;
    }

    setMode(mode) {
        this.mode = mode;
        this.modeTime = 0;
    }

    /** Stuck (standing for 2.5 s) or driving the wrong way for 2 s: ask for a reset onto the course. */
    watchStuck(car, at, dt, speed) {
        this.stuck = speed < 1.5 ? this.stuck + dt : 0;
        const along = car.vx * at.tx + car.vz * at.tz;
        this.wrongWay = along < -2 ? this.wrongWay + dt : 0;
        if (this.stuck > 2.5 || this.wrongWay > 2) {
            this.controls.reset = true;
            this.stuck = 0;
            this.wrongWay = 0;
            this.setMode('grip');
        }
    }
}

function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
}

function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
