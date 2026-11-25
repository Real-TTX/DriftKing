// DriftKing · run/camera.js – the camera of a run. Chase cameras look along the direction of travel, not the nose: in a drift the car is seen
// sideways, the way drifting looks best. 'near' sits closer and lower, 'hood' on the bonnet; after the finish a slow orbit around the car.

import * as THREE from 'three';

const MODES = {
    chase: { distance: 7.0, height: 2.9, look: 1.2, fov: 64 },
    near: { distance: 5.0, height: 1.8, look: 0.9, fov: 68 },
};

/** The camera rig: update(dt, car) every frame; mode 'chase' | 'near' | 'hood' | 'orbit'. */
export class RunCamera {
    constructor() {
        this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 1400);
        this.mode = 'chase';
        this.direction = 0;
        this.position = new THREE.Vector3();
        this.target = new THREE.Vector3();
        this.goal = new THREE.Vector3();
        this.ready = false;
        this.orbit = 0;
        this.shake = 0;
    }

    /** Jumps to the car without easing (start, reset). */
    snap() {
        this.ready = false;
    }

    /**
     * @param {number} dt
     * @param {{ x:number, y:number, z:number, yaw:number, vx:number, vz:number, speed:number }} car
     */
    update(dt, car) {
        const cam = this.camera;
        if (this.mode === 'orbit') {
            this.orbit += dt * 0.25;
            const r = 9;
            cam.position.set(car.x + Math.sin(this.orbit) * r, car.y + 3.2, car.z + Math.cos(this.orbit) * r);
            cam.lookAt(car.x, car.y + 0.8, car.z);
            this.setFov(55);
            return;
        }
        const fwdX = Math.sin(car.yaw);
        const fwdZ = Math.cos(car.yaw);
        if (this.mode === 'hood') {
            cam.position.set(car.x + fwdX * 0.6, car.y + 1.22, car.z + fwdZ * 0.6);
            cam.lookAt(car.x + fwdX * 20, car.y + 0.9, car.z + fwdZ * 20);
            this.setFov(72 + Math.min(14, car.speed * 0.22));
            return;
        }
        const m = MODES[this.mode] ?? MODES.chase;
        // blend the heading with the direction of travel (more of it the faster and the more sideways)
        let wanted = car.yaw;
        if (car.speed > 4) {
            const travel = Math.atan2(car.vx, car.vz);
            const forward = car.vx * fwdX + car.vz * fwdZ;
            if (forward > -1) wanted = car.yaw + wrap(travel - car.yaw) * 0.68;
        }
        if (!this.ready) {
            this.direction = wanted;
        } else {
            this.direction += wrap(wanted - this.direction) * Math.min(1, dt * 4.5);
        }
        const dx = Math.sin(this.direction);
        const dz = Math.cos(this.direction);
        const distance = m.distance + Math.min(2.2, car.speed * 0.035);
        const goal = this.goal.set(car.x - dx * distance, car.y + m.height + Math.min(0.8, car.speed * 0.012), car.z - dz * distance);
        if (!this.ready) {
            this.position.copy(goal);
            this.ready = true;
        } else {
            this.position.lerp(goal, Math.min(1, dt * 7));
            // never fall below the car's ground (hairpins on the pass)
            this.position.y = Math.max(this.position.y, car.y + 1.2);
        }
        this.target.set(car.x + dx * 3.5, car.y + m.look, car.z + dz * 3.5);
        cam.position.copy(this.position);
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 3);
            cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
            cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
        }
        cam.lookAt(this.target);
        this.setFov(m.fov + Math.min(12, car.speed * 0.18));
    }

    /** A jolt after a hit (strength in m/s). */
    bump(strength) {
        this.shake = Math.max(this.shake, Math.min(1.5, strength / 8));
    }

    setFov(fov) {
        if (Math.abs(this.camera.fov - fov) < 0.05) return;
        this.camera.fov += (fov - this.camera.fov) * 0.1;
        this.camera.updateProjectionMatrix();
    }
}

function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
