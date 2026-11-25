// DriftKing · scenes/backdrop.js – the moving picture behind the menus: two bots drifting in tandem on a map, filmed like a car show –
// a low camera at the roadside, a slow orbit around the leader, a high crane shot – cutting every few seconds. No HUD, no engine sound.

import * as THREE from 'three';
import { settings } from '../settings.js';
import { buildWorld } from '../world/world.js';
import { CarPhysics, collideCars } from '../car/physics.js';
import { BotDriver } from '../car/bot.js';
import { Vehicle } from '../car/vehicle.js';
import { showcaseCar } from '../car/showcase.js';
import { Smoke } from '../fx/smoke.js';
import { Skids } from '../fx/skids.js';

const SHOT_SECONDS = 7;

/**
 * Shows the backdrop on the stage (until dispose()).
 * @param {ReturnType<import('../render/stage.js').createStage>} stage
 * @param {{ map?: string, timeOfDay?: 'night'|'dusk' }} [options]
 * @returns {Promise<{ dispose(): void }>}
 */
export async function createBackdrop(stage, { map = 'city', timeOfDay = 'night' } = {}) {
    const world = await buildWorld(map, { timeOfDay });
    const { scene, course } = world;
    const quality = settings.get().quality;
    const skids = new Skids(quality === 'low' ? 400 : 1000);
    const smoke = new Smoke(quality === 'low' ? 90 : 200, { colour: 0xa9a7c4, fogFar: world.env.palette.fogFar * 0.7 });
    scene.add(skids.mesh, smoke.mesh);

    const drivers = [showcaseCar('fastback', 3), showcaseCar('coupe', 0)].map((view, k) => {
        const vehicle = new Vehicle(view);
        scene.add(vehicle.model);
        const start = course.at(course.length * 0.08 - k * 9);
        const physics = new CarPhysics(view.spec, { assist: 0.7, transmission: 'auto' });
        physics.reset(start.x, start.y, start.z, Math.atan2(start.tx, start.tz));
        const at = course.locate(start.x, start.z, -1);
        const ground = {
            colliders: world.colliders,
            groundAt(x, z) {
                if (world.flat) return world.groundAt(x, z);
                course.locate(x, z, at.index, at);
                return at.y;
            },
            slopeAt: () => (world.flat ? null : at),
        };
        const driver = new BotDriver(course, { skill: k === 0 ? 0.95 : 0.8, seed: 11 + k });
        return { view, vehicle, physics, at, ground, driver, state: {} };
    });

    const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 1400);
    const look = new THREE.Vector3();
    const spot = new THREE.Vector3();
    let shot = 0;
    let shotTime = 0;
    let disposed = false;

    /** Places a fixed roadside camera a little ahead of the leader. */
    function roadside(leader) {
        const ahead = course.at(leader.at.s + 38);
        const side = Math.random() < 0.5 ? 1 : -1;
        const offset = course.width / 2 + 2.5;
        spot.set(ahead.x + ahead.tz * offset * side, ahead.y + 1.1, ahead.z - ahead.tx * offset * side);
    }

    function update(dt) {
        if (disposed) return;
        dt = Math.min(dt, 0.05);
        for (const d of drivers) {
            course.locate(d.physics.x, d.physics.z, d.at.index, d.at);
            const c = d.driver.drive(d.physics, d.at, dt, true);
            if (c.reset) {
                const p = course.at(d.at.s - 4);
                d.physics.reset(p.x, p.y, p.z, Math.atan2(p.tx, p.tz));
            }
            d.physics.update(dt, c, d.ground);
            d.controls = c;
        }
        collideCars(drivers[0].physics, drivers[1].physics);
        for (const d of drivers) d.vehicle.update(dt, picture(d), { skids, smoke, smokeRate: 1 });
        skids.update();
        smoke.update(dt);

        const leader = drivers[0];
        const p = leader.physics;
        shotTime += dt;
        if (shotTime > SHOT_SECONDS) {
            shotTime = 0;
            shot = (shot + 1) % 3;
            if (shot === 0) roadside(leader);
        }
        if (shot === 0) {
            if (spot.lengthSq() === 0) roadside(leader);
            camera.position.copy(spot);
            look.set(p.x, p.y + 0.8, p.z);
            camera.fov = 38;
        } else if (shot === 1) {
            const a = shotTime * 0.32 + 1.2;
            camera.position.set(p.x + Math.sin(a) * 8.5, p.y + 1.6, p.z + Math.cos(a) * 8.5);
            look.set(p.x, p.y + 0.7, p.z);
            camera.fov = 52;
        } else {
            const back = Math.atan2(p.vx, p.vz) + Math.PI + 0.6;
            camera.position.set(p.x + Math.sin(back) * 16, p.y + 11 - shotTime * 0.6, p.z + Math.cos(back) * 16);
            look.set(p.x, p.y, p.z);
            camera.fov = 48;
        }
        camera.updateProjectionMatrix();
        camera.lookAt(look);
        world.update(dt, camera.position);
    }

    stage.show({ scene, camera, update });
    const view = stage.view;
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            if (stage.view === view) stage.clear();
            for (const d of drivers) d.vehicle.dispose();
            skids.dispose();
            smoke.dispose();
            world.dispose();
        },
    };
}

function picture(d) {
    const p = d.physics;
    const s = d.state;
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.yaw = p.yaw;
    s.vx = p.vx;
    s.vz = p.vz;
    s.steer = p.steer;
    s.forward = p.forwardSpeed;
    s.rearSlip = p.rearSlip;
    s.frontSlip = p.frontSlip;
    s.braking = (d.controls?.brake ?? 0) > 0.1 || (d.controls?.handbrake ?? 0) > 0.5;
    s.lateralG = p.lateralG;
    s.accel = p.accel;
    s.pitch = d.at.slope ? d.at.slope * Math.cos(p.yaw - Math.atan2(d.at.tx, d.at.tz)) : 0;
    return s;
}
