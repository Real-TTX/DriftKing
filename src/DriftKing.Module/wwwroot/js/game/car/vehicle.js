// DriftKing · car/vehicle.js – a car as seen: the model placed and leaning from a driving state (the own physics, a bot's, or a remote car's
// interpolated state), wheels turning and spinning, brake lights, and the tyre effects (skid marks, smoke) where the tyres slide.

import { buildCar, CAR } from './models.js';

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
        this.roll = 0;
        this.pitch = 0;
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
        m.position.set(s.x, s.y, s.z);
        m.rotation.y = s.yaw;
        m.rotation.x = -Math.atan(s.pitch ?? 0);
        // the body leans out of the corner and dips under braking (springy, not instant)
        const roll = Math.max(-0.07, Math.min(0.07, (s.lateralG ?? 0) * 0.055));
        const pitch = Math.max(-0.05, Math.min(0.05, (s.accel ?? 0) * -0.006));
        this.roll += (roll - this.roll) * Math.min(1, dt * 7);
        this.pitch += (pitch - this.pitch) * Math.min(1, dt * 7);
        this.parts.body.rotation.z = this.roll;
        this.parts.body.rotation.x = this.pitch;
        const spin = ((s.forward ?? 0) / CAR.wheelRadius) * dt;
        for (const w of this.parts.wheels) {
            if (w.front) w.pivot.rotation.y = s.steer ?? 0;
            // the right wheels sit turned around: their spin runs the other way in their own frame
            w.spin.rotation.x += (w.front ? spin : spin + (s.rearSlip ?? 0) * 0.3 * dt * Math.sign(s.forward || 1)) * w.side;
        }
        const brake = s.braking ? 1.8 : 0.55;
        this.brakeGlow += (brake - this.brakeGlow) * Math.min(1, dt * 18);
        this.parts.tailGlow.material.uniforms.intensity.value = this.brakeGlow;
        this.parts.tailMaterial.color.setRGB(Math.min(1, 0.55 + this.brakeGlow * 0.3), 0.08, 0.12);
        if (fx) this.effects(dt, s, fx);
    }

    /** Skid marks under sliding tyres, smoke from the rear ones. */
    effects(dt, s, { skids, smoke, smokeRate = 1 }) {
        const sin = Math.sin(s.yaw);
        const cos = Math.cos(s.yaw);
        const half = (this.parts.profile.width - 0.26) / 2;
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
