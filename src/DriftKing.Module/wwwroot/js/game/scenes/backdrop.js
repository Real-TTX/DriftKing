// DriftKing · scenes/backdrop.js – the moving picture behind the menus: two bots drifting in tandem on a map, filmed like a drift video.
// A camera car low behind the pair, one ahead looking back at them, a camera tracking beside the slide, a camera arm on the leader looking
// back over its flank, a roadside tripod that pans as they pass, a slow crane over the pair – cutting every few seconds.
// Every camera stays over the road (no barrier or wall in front of the lens), swings around the cars (never through them), eases into its
// move with a little hand-held life, uses a long lens close to the cars and keeps them in the middle of the picture, where the menus leave
// room; a car that comes too close to the lens ends the shot. The cars look as in a run: their lamps light the road (medium/high) and the
// smoke, the wet road mirrors them, the exhaust pops. No HUD, no engine sound.
// A change of the picture quality rebuilds the world, the cars and the effects for the new tier in the same frame; the drive and the shot
// go on where they were.

import * as THREE from 'three';
import { settings } from '../settings.js';
import { buildWorld } from '../world/world.js';
import { CarPhysics, collideCars } from '../car/physics.js';
import { BotDriver } from '../car/bot.js';
import { Vehicle } from '../car/vehicle.js';
import { showcaseCar } from '../car/showcase.js';
import { rng } from '../render/kit.js';
import { Smoke } from '../fx/smoke.js';
import { Skids } from '../fx/skids.js';
import { Backfires } from '../fx/flames.js';
import { CarLights, HEADLIGHT_RESERVE } from '../fx/carlights.js';
import { FxLighting } from '../fx/lighting.js';
import { LampStreaks } from '../fx/streaks.js';
import { exposureOf } from '../fx/common.js';

/** The shots in the order they are cut, with their length in seconds (the roadside shot ends earlier when the pair has passed). */
const SHOTS = [
    { kind: 'chase', seconds: 7 },
    { kind: 'side', seconds: 6.5 },
    { kind: 'lead', seconds: 6.5 },
    { kind: 'roadside', seconds: 9 },
    { kind: 'mount', seconds: 5.5 },
    { kind: 'crane', seconds: 7 },
];

/** How high a camera may rise above the road per map (the parking deck has a ceiling over every storey). */
const CEILING = { deck: 1.9 };

/** A car centre closer to the lens than this (m) ends the shot (half a car's length plus room). */
const TOO_CLOSE = 2.9;

/**
 * Shows the backdrop on the stage (until dispose()).
 * @param {ReturnType<import('../render/stage.js').createStage>} stage
 * @param {{ map?: string, timeOfDay?: 'night'|'dusk' }} [options]
 * @returns {Promise<{ dispose(): void }>}
 */
export async function createBackdrop(stage, { map = 'city', timeOfDay = 'night' } = {}) {
    const views = [showcaseCar('fastback', 3), showcaseCar('coupe', 0)];
    let set = await buildSet(map, timeOfDay, settings.get().quality, views);
    const course = set.world.course;
    const ceiling = CEILING[map] ?? 4.2;

    const drivers = views.map((view, k) => {
        const start = course.at(course.length * 0.08 - k * 9);
        const physics = new CarPhysics(view.spec, { assist: 0.7, transmission: 'auto' });
        physics.reset(start.x, start.y, start.z, Math.atan2(start.tx, start.tz));
        const at = course.locate(start.x, start.z, -1);
        // the ground of the world shown now (it is rebuilt on a quality change)
        const ground = {
            get colliders() {
                return set.world.colliders;
            },
            groundAt(x, z) {
                if (set.world.flat) return set.world.groundAt(x, z);
                course.locate(x, z, at.index, at);
                return at.y;
            },
            slopeAt: () => (set.world.flat ? null : at),
        };
        const driver = new BotDriver(course, { skill: k === 0 ? 0.95 : 0.8, seed: 11 + k });
        return { view, physics, at, ground, driver, state: {}, controls: null };
    });

    const camera = new THREE.PerspectiveCamera(32, 1, 0.25, 1400);
    const director = new Director(course, camera, ceiling);
    const view = { scene: set.scene, camera, update };
    let disposed = false;
    let rebuilds = 0;

    function update(dt) {
        if (disposed) return;
        dt = Math.min(dt, 0.05);
        for (const d of drivers) {
            course.locate(d.physics.x, d.physics.z, d.at.index, d.at);
            const c = d.driver.drive(d.physics, d.at, dt, true);
            if (c.reset) {
                const p = course.at(d.at.s - 4);
                d.physics.reset(p.x, p.y, p.z, Math.atan2(p.tx, p.tz));
                director.cut();
            }
            d.physics.update(dt, c, d.ground);
            d.controls = c;
        }
        collideCars(drivers[0].physics, drivers[1].physics);
        drivers.forEach((d, k) => set.place(k, d, dt));
        director.update(dt, drivers[0], drivers[1]);
        set.effects(dt, camera);
    }

    /** A new picture quality: world, cars and effects for the new tier, shown in the same frame as the old set is freed. */
    async function rebuild(quality) {
        const token = ++rebuilds;
        const next = await buildSet(map, timeOfDay, quality, views);
        if (disposed || token !== rebuilds) {
            next.dispose();
            return;
        }
        const old = set;
        set = next;
        view.scene = set.scene;
        stage.show(view);
        old.dispose();
    }

    const unsubscribe = settings.onChange(s => {
        if (!disposed && s.quality !== set.quality) rebuild(s.quality);
    });
    stage.show(view);
    // the quality may have changed while the world was being built
    if (settings.get().quality !== set.quality) rebuild(settings.get().quality);

    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            if (stage.view === view) stage.clear();
            set.dispose();
        },
    };
}

/**
 * Everything of the backdrop that depends on the picture quality: the world, the cars' models and lamps, skid marks, smoke, exhaust pops,
 * the lamps' streaks on the wet road – wired as in a run (run/run.js).
 * place(k, driver, dt) puts car k where its physics is; effects(dt, camera) runs the effects once the camera has moved.
 */
async function buildSet(map, timeOfDay, quality, views) {
    const pbr = quality !== 'low';
    const lightReserve = pbr ? Math.min(HEADLIGHT_RESERVE, views.length) : 0;
    const world = await buildWorld(map, { timeOfDay, quality, lightReserve });
    const { scene } = world;
    const exposure = exposureOf(scene);
    const lighting = new FxLighting(world);
    const skids = new Skids(pbr ? 1000 : 400, { quality });
    const smoke = new Smoke(pbr ? 200 : 90, { fogFar: world.env.palette.fogFar * 0.7, lighting, exposure, quality });
    const backfires = new Backfires(8, { exposure });
    const carLights = new CarLights(world, quality, lighting);
    const streaks = pbr ? new LampStreaks(views.length, { wetness: world.wetness ?? 0.4, exposure }) : null;
    scene.add(skids.mesh, smoke.mesh, backfires.group);
    if (streaks) scene.add(streaks.mesh);
    const vehicles = views.map(v => {
        const vehicle = new Vehicle(v);
        scene.add(vehicle.model);
        carLights.add(vehicle.model, { neon: v.neon ?? null });
        return vehicle;
    });
    smoke.focus = vehicles[0].model.position;
    const states = new Map();
    const stateOf = model => states.get(model);
    const lamps = vehicles.map(v => ({ model: v.model, braking: false }));
    const fx = { skids, smoke, smokeRate: pbr ? 1 : 0.5 };
    return {
        quality,
        world,
        scene,
        place(k, driver, dt) {
            const state = picture(driver);
            const model = vehicles[k].model;
            states.set(model, state);
            vehicles[k].update(dt, state, fx);
            lamps[k].braking = !!state.braking;
            backfires.watch(model, driver.physics, driver.controls, dt, 0.55);
        },
        effects(dt, camera) {
            camera.updateMatrixWorld();
            carLights.update(stateOf);
            streaks?.update(camera.position, lamps);
            skids.update();
            smoke.update(dt, camera);
            backfires.update(dt);
            world.update(dt, camera.position, camera);
        },
        dispose() {
            carLights.dispose();
            for (const v of vehicles) v.dispose();
            skids.dispose();
            smoke.dispose();
            backfires.dispose();
            streaks?.dispose();
            world.dispose();
        },
    };
}

/**
 * The camera operator: picks the shots, places the camera relative to the cars and the road and moves it smoothly.
 * The cars stay framed in the middle of the screen (the menus sit at the edges).
 */
class Director {
    constructor(course, camera, ceiling) {
        this.course = course;
        this.camera = camera;
        this.ceiling = ceiling;
        this.random = rng(7);
        this.index = -1;
        this.shot = null;
        this.time = 0;
        this.clock = 0;
        this.snap = true;
        this.side = 1;
        this.position = new THREE.Vector3();
        this.look = new THREE.Vector3();
        this.goal = new THREE.Vector3();
        this.aim = new THREE.Vector3();
        this.offset = new THREE.Vector3();
        this.lookOffset = new THREE.Vector3();
        this.travel = new THREE.Vector3(0, 0, 1);
        this.spot = new THREE.Vector3();
        this.hint = { index: -1 };
        this.point = {};
        this.fov = 32;
        this.next();
    }

    /** Ends the shot now (a car was reset: never show the jump). */
    cut() {
        this.time = Infinity;
    }

    next() {
        this.index = (this.index + 1) % SHOTS.length;
        this.shot = SHOTS[this.index];
        this.time = 0;
        this.snap = true;
        this.side = this.random() < 0.5 ? -1 : 1;
        this.placed = false;
    }

    /**
     * @param {number} dt
     * @param {object} leader the driver in front ({ physics, at })
     * @param {object} follower the driver behind
     */
    update(dt, leader, follower) {
        this.time += dt;
        this.clock += dt;
        if (this.time > this.shot.seconds) this.next();
        // a car too close to the lens: the next shot at once, in the same frame
        for (let tries = 0; tries < SHOTS.length && this.place(dt, leader, follower); tries++) this.next();
    }

    /** Places the camera for the current shot; returns true when a car is too close to the lens. */
    place(dt, leader, follower) {
        const kind = this.shot.kind;
        const p = leader.physics;
        const q = follower.physics;
        // the car the shot is built around: the chase rides behind the follower (both cars ahead), the others work on the leader
        const anchor = kind === 'chase' ? q : p;
        // its direction of travel, smoothed (in a drift the car points elsewhere: the framing follows where it goes)
        const speed = Math.hypot(anchor.vx, anchor.vz);
        if (speed > 2) {
            const k = this.snap ? 1 : 1 - Math.exp(-dt * 2.5);
            this.travel.x += (anchor.vx / speed - this.travel.x) * k;
            this.travel.z += (anchor.vz / speed - this.travel.z) * k;
        } else if (this.snap) {
            this.travel.set(Math.sin(anchor.yaw), 0, Math.cos(anchor.yaw));
        }
        this.travel.y = 0;
        this.travel.normalize();
        const tx = this.travel.x;
        const tz = this.travel.z;
        // left of the direction of travel (the course's convention: lateral > 0 is left)
        const lx = tz;
        const lz = -tx;
        const side = this.side;
        const goal = this.goal;
        const aim = this.aim;
        let follow = 3;
        let fov = 32;
        let near = 0.25;
        let road = 0.35;
        let fixed = false;

        switch (kind) {
            case 'chase': {
                // a camera car low behind the follower, a little off to one side: the pair ahead, the follower big
                goal.set(q.x - tx * 6.2 + lx * side * 1.4, q.y + 0.9, q.z - tz * 6.2 + lz * side * 1.4);
                aim.set(q.x * 0.6 + p.x * 0.4 + tx * 1.5, q.y + 0.85, q.z * 0.6 + p.z * 0.4 + tz * 1.5);
                fov = 34;
                follow = 2.5;
                break;
            }
            case 'lead': {
                // ahead of the pair looking back: the leader big, the follower over its shoulder
                goal.set(p.x + tx * 7.5 + lx * side * 1.8, p.y + 0.8, p.z + tz * 7.5 + lz * side * 1.8);
                aim.set(p.x * 0.75 + q.x * 0.25, p.y + 0.8, p.z * 0.75 + q.z * 0.25);
                fov = 30;
                follow = 2;
                break;
            }
            case 'side': {
                // tracking beside the slide, on the side of the road with more room
                const room = -Math.sign(leader.at.lateral || 1);
                goal.set(p.x + lx * room * 6 + tx * 1.2, p.y + 1.15, p.z + lz * room * 6 + tz * 1.2);
                aim.set(p.x + tx * 0.8, p.y + 0.75, p.z + tz * 0.8);
                fov = 38;
                follow = 1.8;
                road = 0.3;
                break;
            }
            case 'mount': {
                // a camera arm on the leader (as in car commercials): rigid with the car, beside its front wheel, looking back over the flank
                const fx = Math.sin(p.yaw);
                const fz = Math.cos(p.yaw);
                const rx = -fz * side;
                const rz = fx * side;
                goal.set(p.x + rx * 2.6 + fx * 1.4, p.y + 0.85, p.z + rz * 2.6 + fz * 1.4);
                aim.set(p.x - fx * 0.9, p.y + 0.45, p.z - fz * 0.9);
                fov = 46;
                follow = 30;
                near = 0.15;
                road = 0.25;
                break;
            }
            case 'roadside': {
                // a tripod at the edge of the road ahead, on the inside of the bend (the cars swing wide), panning as they come and pass
                if (!this.placed) {
                    const at = this.course.at(leader.at.s + 34, this.point);
                    const inside = Math.sign(this.course.curvatureAhead(leader.at.s + 26, 16) || side);
                    const offset = inside * (this.course.width / 2 - 1.7);
                    this.spot.set(at.x + at.tz * offset, at.y + 0.9, at.z - at.tx * offset);
                    this.placed = true;
                }
                goal.copy(this.spot);
                aim.set(p.x * 0.8 + q.x * 0.2, p.y + 0.5, p.z * 0.8 + q.z * 0.2);
                const distance = Math.hypot(p.x - goal.x, p.z - goal.z);
                // a zoom that keeps the pair about the same size: long lens while they are far, wider as they pass
                fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(3.4 / Math.max(1, distance))), 14, 56);
                fixed = true;
                follow = 12;
                // once the leader has passed and is moving away, cut
                const behind = (goal.x - p.x) * tx + (goal.z - p.z) * tz;
                if (behind < -9 && this.time > 2) this.time = Infinity;
                break;
            }
            default: {
                // a slow crane coming down behind and beside the pair
                const t = Math.min(1, this.time / this.shot.seconds);
                const mx = (p.x + q.x) / 2;
                const mz = (p.z + q.z) / 2;
                const rise = Math.min(this.ceiling, 3.8 - t * 2.1);
                goal.set(mx - tx * 7.5 + lx * side * 4.5, (p.y + q.y) / 2 + rise, mz - tz * 7.5 + lz * side * 4.5);
                aim.set(mx + tx * 2.5, (p.y + q.y) / 2 + 0.4, mz + tz * 2.5);
                fov = 40;
                follow = 1.6;
                break;
            }
        }

        // the moves are eased in the anchor car's frame (relative to it): no lag behind a fast car, only the swing of the framing;
        // the tripod shot stands still in the world
        const base = fixed ? 0 : 1;
        goal.x -= anchor.x * base;
        goal.y -= anchor.y * base;
        goal.z -= anchor.z * base;
        aim.x -= anchor.x * base;
        aim.y -= anchor.y * base;
        aim.z -= anchor.z * base;
        if (this.snap || fixed) {
            this.offset.copy(goal);
            if (this.snap) this.lookOffset.copy(aim);
        } else {
            swing(this.offset, goal, 1 - Math.exp(-dt * follow));
        }
        if (!this.snap) this.lookOffset.lerp(aim, 1 - Math.exp(-dt * Math.max(5, follow * 2)));
        this.position.set(anchor.x * base + this.offset.x, anchor.y * base + this.offset.y, anchor.z * base + this.offset.z);
        this.look.set(anchor.x * base + this.lookOffset.x, anchor.y * base + this.lookOffset.y, anchor.z * base + this.lookOffset.z);
        // keep the camera over the road (never behind a barrier or inside a wall) and between the road and the ceiling
        const roadY = this.overRoad(this.position, road);
        this.position.y = Math.min(Math.max(this.position.y, roadY + 0.3), roadY + Math.max(this.ceiling, 0.9));
        // a little hand-held life (none on the car mount: that one shakes with the car)
        if (kind !== 'mount') {
            const c = this.clock;
            this.position.x += Math.sin(c * 1.3) * 0.03 + Math.sin(c * 2.9 + 1) * 0.01;
            this.position.y += Math.sin(c * 1.7 + 2) * 0.02;
            this.position.z += Math.sin(c * 1.1 + 4) * 0.03;
            this.look.y += Math.sin(c * 0.9 + 3) * 0.015;
        }
        this.fov = this.snap ? fov : this.fov + (fov - this.fov) * (1 - Math.exp(-dt * 3));
        this.snap = false;
        // a car right at the lens (it drove into the tripod, cut a corner past the camera car, spun towards it)
        const close = car => Math.hypot(car.x - this.position.x, car.z - this.position.z) < TOO_CLOSE && Math.abs(car.y - this.position.y) < 3;
        if ((kind !== 'mount' && close(p)) || close(q)) return true;
        const cam = this.camera;
        cam.position.copy(this.position);
        cam.lookAt(this.look);
        if (Math.abs(cam.fov - this.fov) > 1e-3 || cam.near !== near) {
            cam.fov = this.fov;
            cam.near = near;
            cam.updateProjectionMatrix();
        }
        return false;
    }

    /** Pulls a point back over the road (at most margin inside its edges); returns the road height there. */
    overRoad(point, margin) {
        const course = this.course;
        const at = course.locate(point.x, point.z, this.hint.index, this.hint);
        const half = course.width / 2 - margin;
        if (Math.abs(at.lateral) > half) {
            const c = course.at(at.s, this.point);
            const lateral = Math.sign(at.lateral) * half;
            point.x = c.x + c.tz * lateral;
            point.z = c.z - c.tx * lateral;
        }
        return at.y;
    }
}

/**
 * Eases a camera's offset from its car towards the goal around the car – direction and distance separately (shortest turn), so a camera
 * swinging to the other side when the car turns goes around it, never through it.
 */
function swing(offset, goal, k) {
    const r0 = Math.hypot(offset.x, offset.z);
    const r1 = Math.hypot(goal.x, goal.z);
    const a0 = Math.atan2(offset.x, offset.z);
    let turn = Math.atan2(goal.x, goal.z) - a0;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    const a = a0 + turn * k;
    const r = r0 + (r1 - r0) * k;
    offset.x = Math.sin(a) * r;
    offset.z = Math.cos(a) * r;
    offset.y += (goal.y - offset.y) * k;
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
