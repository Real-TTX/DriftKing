// DriftKing · run/run.js – one run on a map: the world, the cars of all seats, the countdown, laps, drift scores, the HUD, the camera, the sound,
// and the network glue the menu needs (state of the own car ~12×/s, finish results, remote cars interpolated ~100 ms behind).
//   const run = await startRun(stage, { map, mode, laps, durationS, seats, simulateBots, countdownAt, goals, hud, events });
// See the contract in the doc of startRun. Seats: 'me' (input), 'bot' (BotDriver here when simulateBots, else like a remote), 'remote' (run.remote).

import { settings } from '../settings.js';
import { audio } from '../audio.js';
import { createInput } from '../input.js';
import { createHud } from '../hud.js';
import { formatPoints, formatTime } from '../catalog.js';
import { buildWorld } from '../world/world.js';
import { CarPhysics, collideCars, emptyControls, REDLINE_RPM } from '../car/physics.js';
import { BotDriver } from '../car/bot.js';
import { Vehicle } from '../car/vehicle.js';
import { Smoke } from '../fx/smoke.js';
import { Skids } from '../fx/skids.js';
import { Sparks } from '../fx/sparks.js';
import { Backfires } from '../fx/flames.js';
import { CarLights, HEADLIGHT_RESERVE } from '../fx/carlights.js';
import { FxLighting } from '../fx/lighting.js';
import { LampStreaks } from '../fx/streaks.js';
import { exposureOf } from '../fx/common.js';
import { DriftScore, DRIFT_MIN_ANGLE } from './drift.js';
import { RunCamera } from './camera.js';

const STATE_INTERVAL = 1 / 12;
const REMOTE_DELAY = 100;
const CHECKPOINTS = [0.25, 0.5, 0.75];
const CAPACITY = {
    low: { smoke: 110, skids: 600, sparks: 48 },
    medium: { smoke: 280, skids: 1500, sparks: 120 },
    high: { smoke: 440, skids: 2600, sparks: 200 },
};
/** The car's collision circles (car/physics.js): where along the car (m) and how wide – the sparks look for the wall there. */
const BODY_CIRCLES = [1.45, 0, -1.45];
const BODY_RADIUS = 0.92;
const DOT_COLOURS = ['#29e7ff', '#ffb020', '#3ef08a', '#8b5cf6', '#ff7a1a', '#f4f2ff', '#ffe14a', '#7affd7'];

/**
 * Starts a run and returns its handle.
 * @param {ReturnType<import('../render/stage.js').createStage>} stage
 * @param {{
 *   map: { key: string, name?: string, timeOfDay?: 'night'|'dusk' },
 *   mode: 'freeride'|'score'|'race',
 *   laps?: number, durationS?: number,
 *   seats: { seat: number, name: string, kind: 'me'|'bot'|'remote', car: object, skill?: number }[],
 *   simulateBots?: boolean, countdownAt?: number|null,
 *   goals?: null|{ metric: 'score'|'time', bronze: number, silver: number, gold: number },
 *   hud: HTMLElement,
 *   events?: { state?(seat: number, packed: number[]): void, finish?(seat: number, result: object): void, pause?(): void },
 *   autopilot?: boolean,
 * }} options autopilot (developer): a bot drives the own car
 * @returns {Promise<{ remote(seat: number, packed: number[]): void, leave(seat: number): void, finishNow(): void, setPaused(paused: boolean): void,
 *                     standings(): { seat: number, name: string, score: number, lap: number, progress: number, finished: boolean }[], dispose(): void }>}
 */
export async function startRun(stage, options) {
    const { map, mode, seats, simulateBots = true, goals = null, events = {} } = options;
    // the developer autopilot: the URL flag of the dev pages or localStorage 'driftking.autopilot' = '1' (end-to-end tests of the menus)
    const autopilot = options.autopilot === true || readAutopilot();
    const quality = settings.get().quality;
    // pool lights for the other cars' headlights (the rig lights the nearest few; none on low)
    const lightReserve = quality === 'low' ? 0 : Math.min(HEADLIGHT_RESERVE, Math.max(0, seats.length - 1));
    const world = await buildWorld(map.key, { timeOfDay: map.timeOfDay ?? 'night', quality, lightReserve });
    const course = world.course;
    const scene = world.scene;
    const laps = options.laps ?? world.def.defaultLaps;
    const durationMs = (options.durationS ?? 120) * 1000;
    const capacity = CAPACITY[quality] ?? CAPACITY.medium;
    const exposure = exposureOf(scene);
    // the effects: rubber on the road, smoke lit like the scene, sparks, backfire; the cars' lamps light the road (rig) and the smoke
    const lighting = new FxLighting(world);
    const skids = new Skids(capacity.skids, { quality });
    const smoke = new Smoke(capacity.smoke, { fogFar: world.env.palette.fogFar * 0.7, lighting, exposure, quality });
    const sparks = new Sparks(capacity.sparks, { exposure });
    const backfires = new Backfires(16, { exposure });
    const carLights = new CarLights(world, quality, lighting);
    // the lamps mirrored in the wet road (medium/high: the PBR road is wet there)
    const streaks = quality === 'low' ? null : new LampStreaks(seats.length, { wetness: world.wetness ?? 0.4, exposure });
    scene.add(skids.mesh, smoke.mesh, sparks.mesh, backfires.group);
    if (streaks) scene.add(streaks.mesh);
    const rig = new RunCamera();
    rig.mode = settings.get().camera;
    rig.colliders = world.colliders;
    audio.unlock();

    const cars = seats.map((seat, slot) => createCar(seat, slot));
    const me = cars.find(c => c.kind === 'me') ?? cars[0];
    rig.follow(me.vehicle.model);
    smoke.focus = me.vehicle.model.position;
    window.__fxDebug = { smoke, lighting, world, me, rig, sparks, backfires, skids };
    for (const car of cars) carLights.add(car.vehicle.model, { own: car === me && !!me.physics, neon: car.view.neon ?? null });
    const stateByModel = new Map();
    const stateOf = model => stateByModel.get(model);
    const carHits = [];
    const lampList = [];
    const hud = createHud(options.hud, { mode, laps, durationS: durationMs / 1000, goals, course, mapName: world.name });
    const input = createInput({ touchHost: options.hud });

    // the clock: race time 0 = green light; local performance time keeps it smooth, the epoch countdownAt aligns all clients
    const countdownAt = options.countdownAt ?? Date.now() + 3200;
    let startPerf = performance.now() + (countdownAt - Date.now());
    let paused = false;
    let pausedAt = 0;
    let lastCount = null;
    let countDone = false;
    let ownFinishedAt = null;
    let disposed = false;
    let wrongWay = 0;
    const raceTime = () => (paused ? pausedAt : performance.now()) - startPerf;

    function createCar(seat, slot) {
        const kind = seat.kind === 'bot' && !simulateBots ? 'remote' : seat.kind;
        const vehicle = new Vehicle(seat.car);
        scene.add(vehicle.model);
        const spawn = course.spawn(slot);
        const car = {
            seat: seat.seat,
            name: seat.name,
            kind,
            isBot: seat.kind === 'bot',
            view: seat.car,
            vehicle,
            colour: DOT_COLOURS[slot % DOT_COLOURS.length],
            at: course.locate(spawn.x, spawn.z, -1),
            lap: -1,
            checkpoint: CHECKPOINTS.length,
            lastT: 0,
            lapStart: 0,
            bestLapMs: null,
            finished: false,
            result: null,
            stateTimer: Math.random() * STATE_INTERVAL,
            snapshots: [],
            offset: Infinity,
            remoteState: null,
            voice: null,
        };
        car.lastT = car.at.t;
        if (kind === 'me' || kind === 'bot') {
            car.physics = new CarPhysics(seat.car.spec, kind === 'bot' ? { assist: 0.65, transmission: 'auto' } : autopilot ? { assist: 0.65 } : {});
            car.physics.reset(spawn.x, spawn.y, spawn.z, spawn.yaw);
            car.score = new DriftScore();
            car.ground = groundFor(car);
            if (kind === 'bot' || autopilot) car.driver = new BotDriver(course, { skill: seat.skill ?? 0.7, seed: seat.seat + 1 });
        } else {
            car.kinematic = { x: spawn.x, z: spawn.z, yaw: spawn.yaw, vx: 0, vz: 0, mass: seat.car.spec?.massKg ?? 1300 };
            car.remoteState = { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, vx: 0, vz: 0, steer: 0, forward: 0, rearSlip: 0, frontSlip: 0, braking: 1, lateralG: 0,
                accel: 0, pitch: 0, angle: 0, score: 0, combo: 0, lap: -1, progress: car.at.t, finished: false, drifting: false };
        }
        vehicle.update(0, car.physics ? physicsState(car) : car.remoteState);
        return car;
    }

    /** The ground of one car: the course near the car's last place (its own hint), the slope along the course on the pass. */
    function groundFor(car) {
        const at = car.at;
        return {
            colliders: world.colliders,
            groundAt(x, z) {
                if (world.flat) return world.groundAt(x, z);
                course.locate(x, z, at.index, at);
                return at.y;
            },
            slopeAt() {
                return world.flat ? null : at;
            },
        };
    }

    // ---- sound: the own engine loud, three others by distance; audio may only start after a key or a touch
    const unlock = () => audio.unlock();
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    function ensureVoices() {
        if (me.voice || !audio.unlocked) return;
        me.voice = audio.engine({ turbo: me.view.levels?.turbo ?? 0, own: true });
        cars.filter(c => c !== me).slice(0, 3).forEach(c => (c.voice = audio.engine({ turbo: c.view.levels?.turbo ?? 0 })));
    }

    // ---- per frame
    const view = {
        scene,
        camera: rig.camera,
        update(dt) {
            if (disposed) return;
            frame(Math.min(dt, 0.05));
        },
    };
    stage.show(view);
    let hudTimer = 0;

    function frame(dt) {
        const controls = input.read(dt);
        ensureVoices();
        if (controls.pause) events.pause?.();
        if (controls.camera) cycleCamera();
        const t = raceTime();
        countdown(t);
        const live = !paused;
        const racing = t >= 0 && live;
        const simDt = live ? dt : 0;

        for (const car of cars) {
            if (!car.physics || !live) continue;
            if (!racing) {
                // on the grid: rev the engine, stay put
                const revs = car === me && !autopilot ? controls.throttle : 0;
                car.physics.rpm += (900 + revs * 6200 - car.physics.rpm) * Math.min(1, dt * 6);
                continue;
            }
            let c;
            // bots, the autopilot and the own car after its finish drive themselves; the player's car takes the controls
            if (car.driver && (car.kind === 'bot' || autopilot || car.finished)) {
                c = car.driver.drive(car.physics, car.at, simDt, true);
                if (c.reset) resetCar(car);
            } else {
                c = controls;
                if (controls.reset) resetCar(car);
            }
            car.controls = c;
            car.physics.update(simDt, c, car.ground);
        }
        if (racing) collideAll();
        for (const car of cars) {
            if (car.physics) {
                if (racing) progress(car, t, simDt);
            } else {
                interpolate(car);
            }
        }
        const ownState = me.physics ? physicsState(me) : me.remoteState;
        for (const car of cars) {
            const s = car.physics ? physicsState(car) : car.remoteState;
            stateByModel.set(car.vehicle.model, s);
            car.vehicle.update(dt, s, live ? { skids, smoke, smokeRate: quality === 'low' ? 0.5 : 1 } : null);
            car.voice?.update({
                rpm: car.physics?.rpm ?? 900 + Math.abs(s.forward) * 160,
                throttle: car.controls?.throttle ?? (s.drifting ? 0.8 : 0.4),
                slip: s.rearSlip,
                distance: Math.hypot(s.x - ownState.x, s.z - ownState.z),
                limiter: car.physics ? car.physics.rpm > REDLINE_RPM * 1.02 : false,
            });
        }
        if (me.physics?.impact > 2.5) {
            rig.bump(me.physics.impact);
            me.voice?.impact(me.physics.impact);
        }
        if (racing) contactEffects(simDt);
        carHits.length = 0;
        rig.update(dt, ownState);
        rig.camera.updateMatrixWorld();
        hideCarsAtCamera();
        carLights.update(stateOf);
        if (streaks) {
            for (const car of cars) {
                car.lamps ??= { model: car.vehicle.model, braking: false };
                car.lamps.braking = !!stateByModel.get(car.vehicle.model)?.braking;
            }
            lampList.length = 0;
            for (const car of cars) lampList.push(car.lamps);
            streaks.update(rig.camera.position, lampList);
        }
        skids.update();
        smoke.update(simDt, rig.camera);
        sparks.update(simDt);
        backfires.update(simDt);
        world.update(dt, rig.camera.position, rig.camera);
        emitStates(dt);
        hudTimer += dt;
        if (hudTimer >= 1 / 30) {
            hudTimer = 0;
            updateHud(t, controls);
        }
        if (racing) checkEnd(t);
    }

    /** A car right at the camera (a bot tailgating, the close camera passing one) would fill the screen from inside: hidden while the eye is in it. */
    function hideCarsAtCamera() {
        const eye = rig.camera.position;
        for (const car of cars) {
            if (car === me) continue;
            const model = car.vehicle.model;
            const at = model.position;
            const profile = model.userData.profile ?? {};
            const dx = eye.x - at.x;
            const dz = eye.z - at.z;
            const sin = Math.sin(model.rotation.y);
            const cos = Math.cos(model.rotation.y);
            // within ~1 m of its body (the lens would be in or right at it): it would block the whole picture
            const inside = Math.abs(dx * sin + dz * cos) < (profile.len ?? 2.3) + 1.2
                && Math.abs(dx * cos - dz * sin) < (profile.width ?? 1.8) / 2 + 0.9
                && eye.y < at.y + (profile.roof ?? 1.4) + 0.8;
            model.visible = rig.mode === 'hood' || !inside;
        }
    }

    // ---- effects of contact and of the throttle (visual only): sparks off walls and cars, exhaust pops
    const contact = { nx: 0, nz: 0, depth: 0 };

    function contactEffects(dt) {
        for (const car of cars) {
            const p = car.physics;
            if (!p) continue;
            if (p.impact > 0.4 && p.speed > 3) wallSparks(p, dt);
            const pop = backfires.watch(car.vehicle.model, p, car.controls, dt, car === me ? 1 : 0.55);
            if (pop > 0) car.voice?.backfire?.(pop);
        }
        for (const hit of carHits) carSparks(hit);
    }

    /** Sparks where the body touches a wall: a burst on a hit, a trickle while it scrapes along. */
    function wallSparks(p, dt) {
        const sin = Math.sin(p.yaw);
        const cos = Math.cos(p.yaw);
        const reach = BODY_RADIUS + 0.06;
        for (const offset of BODY_CIRCLES) {
            const cx = p.x + sin * offset;
            const cz = p.z + cos * offset;
            const c = world.colliders.contact(cx, cz, reach, contact);
            if (!c) continue;
            const inside = reach - c.depth;
            const hard = p.impact > 3;
            const n = hard ? Math.min(34, Math.round(6 + p.impact * 2.5)) : Math.random() < p.speed * dt * 2.4 ? 1 + Math.floor(Math.random() * 3) : 0;
            if (n > 0) {
                sparks.emit(n, cx - c.nx * inside, p.y + 0.26 + Math.random() * 0.22, cz - c.nz * inside, p.y, p.vx * 0.85, p.vz * 0.85, c.nx, c.nz,
                    Math.min(1, p.impact / 8 + p.speed / 60));
            }
            return;
        }
    }

    /** Sparks between two cars that hit each other hard (at their nearest body circles). */
    function carSparks({ a, b, strength }) {
        let best = Infinity;
        let mx = 0;
        let mz = 0;
        let nx = 0;
        let nz = 0;
        for (const oa of BODY_CIRCLES) {
            for (const ob of BODY_CIRCLES) {
                const ax = a.x + Math.sin(a.yaw) * oa;
                const az = a.z + Math.cos(a.yaw) * oa;
                const bx = b.x + Math.sin(b.yaw) * ob;
                const bz = b.z + Math.cos(b.yaw) * ob;
                const d = Math.hypot(ax - bx, az - bz);
                if (d >= best || d < 1e-6) continue;
                best = d;
                mx = (ax + bx) / 2;
                mz = (az + bz) / 2;
                nx = (ax - bx) / d;
                nz = (az - bz) / d;
            }
        }
        if (best === Infinity) return;
        const n = Math.min(26, Math.round(strength * 2.6));
        sparks.emit(n, mx, a.y + 0.3 + Math.random() * 0.2, mz, a.y, (a.vx + (b.vx ?? 0)) / 2, (a.vz + (b.vz ?? 0)) / 2, nx, nz, Math.min(1, strength / 10));
    }

    function cycleCamera() {
        const order = ['chase', 'near', 'hood'];
        const next = order[(order.indexOf(rig.mode) + 1) % order.length];
        settings.set({ camera: next });
        if (rig.mode !== 'orbit') rig.mode = next;
        rig.snap();
    }

    /** 3 – 2 – 1 – LOS! (beeps on every number); joining after the green light shows the LOS! only. */
    function countdown(t) {
        if (countDone) return;
        if (t < 0) {
            const n = Math.ceil(-t / 1000);
            if (n <= 3 && n !== lastCount) {
                lastCount = n;
                hud.countdown(n);
                audio.ui('countdown');
            }
            return;
        }
        countDone = true;
        hud.countdown(0);
        audio.ui('go');
        setTimeout(() => !disposed && hud.countdown(null), 900);
    }

    /** Back onto the course (R, or a stuck bot): a few metres back, in the middle, standing; the running chain is lost. */
    function resetCar(car) {
        const p = course.at(car.at.s - 4);
        car.physics.reset(p.x, p.y, p.z, Math.atan2(p.tx, p.tz));
        car.score.resetChain();
        if (car === me) rig.snap();
    }

    function collideAll() {
        for (let i = 0; i < cars.length; i++) {
            const a = cars[i];
            if (!a.physics) continue;
            for (let j = 0; j < cars.length; j++) {
                const b = cars[j];
                if (i === j || (b.physics && j < i)) continue;
                const other = b.physics ?? b.kinematic;
                const strength = b.physics ? collideCars(a.physics, b.physics, false) : collideCars(a.physics, b.kinematic, true);
                // remembered for the sparks only
                if (strength > 2.5) carHits.push({ a: a.physics, b: other, strength });
            }
        }
    }

    /** Course position, checkpoints, laps, the drift score and the finish of a car this client drives. */
    function progress(car, t, dt) {
        const p = car.physics;
        const at = course.locate(p.x, p.z, car.at.index, car.at);
        // checkpoints in order, then the line
        const next = CHECKPOINTS[car.checkpoint];
        if (next !== undefined && at.t >= next && at.t < next + 0.15) car.checkpoint++;
        const crossed = car.lastT > 0.85 && at.t < 0.15;
        if (crossed && car.checkpoint >= CHECKPOINTS.length) {
            car.checkpoint = 0;
            if (car.lap >= 0) {
                const lapMs = t - car.lapStart;
                const best = car.bestLapMs === null || lapMs < car.bestLapMs;
                if (best) car.bestLapMs = lapMs;
                if (car === me) hud.event({ kind: 'lap', timeMs: lapMs, best });
            }
            car.lap++;
            car.lapStart = t;
        }
        car.lastT = at.t;
        if (car.finished) return;
        const speedKmh = p.speed * 3.6;
        const angle = p.driftAngle;
        const wallDistance = world.colliders.distance(p.x, p.z, 3.5) - 0.95;
        const tandem = Math.abs(angle) >= DRIFT_MIN_ANGLE && cars.some(o => o !== car && isDrifting(o) && distance(o, p) < 8);
        const happened = car.score.update(dt, { angle, speedKmh, wallDistance, tandem, impact: p.impact });
        if (car === me) {
            for (const e of happened) {
                hud.event(e);
                if (e.kind === 'bank') audio.ui('bank');
                if (e.kind === 'crash') audio.ui('crash');
            }
            const along = p.vx * at.tx + p.vz * at.tz;
            wrongWay = along < -3 ? wrongWay + dt : 0;
        }
        if (mode === 'race' && car.lap >= laps) finish(car, t, false);
    }

    function isDrifting(car) {
        if (car.physics) return Math.abs(car.physics.driftAngle) >= DRIFT_MIN_ANGLE && car.physics.speed > 8.3;
        return car.remoteState.drifting;
    }

    function distance(car, p) {
        const s = car.physics ?? car.remoteState;
        return Math.hypot(s.x - p.x, s.z - p.z);
    }

    /** The end of the run for a car this client drives: the result goes to the menu; the own car drives on by itself. */
    function finish(car, t, early) {
        if (car.finished) return;
        if (car.score.chain > 0) {
            const e = car.score.bank();
            if (car === me) hud.event(e);
        }
        car.finished = true;
        let timeMs = Math.max(0, Math.round(t));
        if (mode === 'race' && car.lap < laps) {
            // not across the line: estimate the time from the distance still to drive and the average pace
            const done = Math.max(0, car.lap) + car.at.t;
            const pace = done > 0.05 ? t / done : 120000;
            timeMs = Math.round(t + (laps - done) * pace);
        }
        car.result = {
            score: Math.round(car.score.total),
            timeMs,
            bestLapMs: car.bestLapMs === null ? null : Math.round(car.bestLapMs),
            laps: Math.max(0, Math.min(car.lap, laps)),
            bestCombo: Math.round(car.score.bestCombo),
            maxAngle: Math.round(car.score.maxAngle),
            driftDistanceM: Math.round(car.score.distance),
            collisions: car.physics.collisions,
        };
        if (car === me) {
            ownFinishedAt = t;
            car.driver ??= new BotDriver(course, { skill: 0.35, seed: 99 });
            rig.mode = 'orbit';
            const title = mode === 'race' ? (early ? 'BEENDET' : 'ZIEL') : mode === 'score' ? (early ? 'BEENDET' : 'ZEIT UM') : 'BEENDET';
            const sub = mode === 'race' && !early ? `${formatTime(timeMs)} · ${formatPoints(car.result.score)} Punkte` : `${formatPoints(car.result.score)} Punkte`;
            hud.banner(title, sub);
        }
        events.finish?.(car.seat, car.result);
        emitState(car, raceTime());
    }

    function checkEnd(t) {
        if (mode === 'score' && t >= durationMs) {
            for (const car of cars) if (car.physics && !car.finished) finish(car, durationMs, false);
        }
        // a race: once the player is through, the bots get 45 s more
        if (mode === 'race' && ownFinishedAt !== null && t - ownFinishedAt > 45000) {
            for (const car of cars) if (car.physics && !car.finished) finish(car, t, true);
        }
    }

    // ---- network: own state out, remote states in
    function emitStates(dt) {
        if (!events.state) return;
        for (const car of cars) {
            if (!car.physics) continue;
            car.stateTimer += dt;
            if (car.stateTimer < STATE_INTERVAL) continue;
            car.stateTimer = 0;
            emitState(car, raceTime());
        }
    }

    function emitState(car, t) {
        if (!events.state || !car.physics) return;
        const p = car.physics;
        const c = car.controls ?? emptyControls();
        const flags = (car.finished ? 1 : 0) | (isDrifting(car) ? 2 : 0) | (c.brake > 0.1 || c.handbrake > 0.5 ? 4 : 0);
        events.state(car.seat, [
            Math.round(t),
            round(p.x, 2), round(p.y, 2), round(p.z, 2), round(p.yaw, 3),
            round(p.vx, 2), round(p.vz, 2), round(p.steer, 3),
            round(c.throttle, 2), round(c.brake, 2), round(c.handbrake, 2),
            round(p.driftAngle, 1),
            Math.round(car.score.live), Math.round(car.score.chain),
            Math.max(0, car.lap), round(car.at.t, 4), flags,
        ]);
    }

    function interpolate(car) {
        const list = car.snapshots;
        if (list.length === 0) return;
        const now = performance.now();
        const renderT = now - car.offset - REMOTE_DELAY;
        let a = list[0];
        let b = list[list.length - 1];
        for (let k = list.length - 1; k > 0; k--) {
            if (list[k - 1].t <= renderT) {
                a = list[k - 1];
                b = list[k];
                break;
            }
        }
        const s = car.remoteState;
        const span = b.t - a.t;
        let f = span > 0 ? (renderT - a.t) / span : 1;
        f = Math.max(0, Math.min(1.5, f));
        const lerp = (i) => a.d[i] + (b.d[i] - a.d[i]) * f;
        s.x = lerp(1);
        s.y = lerp(2);
        s.z = lerp(3);
        let dyaw = b.d[4] - a.d[4];
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        s.yaw = a.d[4] + dyaw * f;
        s.vx = lerp(5);
        s.vz = lerp(6);
        s.steer = lerp(7);
        s.angle = lerp(11);
        const speed = Math.hypot(s.vx, s.vz);
        s.forward = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
        s.rearSlip = Math.abs(s.angle) > DRIFT_MIN_ANGLE ? speed * Math.sin((Math.abs(s.angle) * Math.PI) / 180) + 3 : 0;
        s.frontSlip = 0;
        s.score = b.d[12];
        s.combo = b.d[13];
        s.lap = b.d[14];
        s.progress = b.d[15];
        s.finished = (b.d[16] & 1) === 1;
        // the race time of its finish: the first state that says so
        if (s.finished && s.finishMs == null) s.finishMs = b.d[0];
        s.drifting = (b.d[16] & 2) === 2;
        s.braking = (b.d[16] & 4) === 4 ? 1 : 0;
        s.lateralG = Math.max(-1, Math.min(1, -s.angle / 60));
        s.pitch = world.flat ? 0 : course.locate(s.x, s.z, car.at.index, car.at).slope * Math.cos(s.yaw - Math.atan2(car.at.tx, car.at.tz));
        Object.assign(car.kinematic, { x: s.x, z: s.z, yaw: s.yaw, vx: s.vx, vz: s.vz });
    }

    // ---- HUD
    function updateHud(t, controls) {
        const p = me.physics;
        const standings = rank();
        const position = standings.findIndex(s => s.car === me) + 1;
        const lapTime = me.lap >= 0 ? t - me.lapStart : Math.max(0, t);
        hud.update({
            speedKmh: p ? p.speed * 3.6 : 0,
            gear: p?.gear ?? 1,
            reverse: p?.reverse ?? false,
            rpm: p?.rpm ?? 900,
            rpmMax: REDLINE_RPM * 1.04,
            throttle: me.controls?.throttle ?? controls.throttle,
            brake: me.controls?.brake ?? controls.brake,
            handbrake: me.controls?.handbrake ?? controls.handbrake,
            steer: me.controls?.steer ?? controls.steer,
            angle: p ? p.driftAngle : 0,
            drifting: isDrifting(me),
            chainMaxAngle: me.score?.chainMaxAngle ?? 0,
            total: me.score?.total ?? 0,
            chain: me.score?.chain ?? 0,
            multiplier: me.score?.multiplier ?? 1,
            wall: me.score?.wall ?? false,
            tandem: me.score?.tandem ?? false,
            timeMs: me.finished ? me.result.timeMs : t,
            remainingMs: Math.max(0, durationMs - t),
            lap: Math.max(0, Math.min(me.lap, laps - 1)),
            lapTimeMs: me.finished ? 0 : lapTime,
            bestLapMs: me.bestLapMs,
            position: position || 1,
            count: cars.length,
            standings: standings.map(s => ({ seat: s.car.seat, name: s.car.name, me: s.car === me, value: s.value })),
            cars: cars.map(c => {
                const s = c.physics ?? c.remoteState;
                return { x: s.x, z: s.z, yaw: s.yaw, me: c === me, color: c.colour };
            }),
            wrongWay: wrongWay > 1.5 && !me.finished,
        });
    }

    /** The live order: races by finish time, then laps and lap fraction; drift modes by points. */
    function rank() {
        const list = cars.map(car => {
            const score = car.physics ? car.score.live : car.remoteState.score;
            const lap = car.physics ? car.lap : car.remoteState.lap;
            const fraction = car.physics ? car.at.t : car.remoteState.progress;
            const finished = car.physics ? car.finished : car.remoteState.finished;
            const done = lap < 0 ? fraction - 1 : lap + fraction;
            return { car, score, lap, fraction, finished, done, time: car.result?.timeMs ?? car.remoteState?.finishMs ?? null };
        });
        if (mode === 'race') {
            list.sort(raceOrder);
            for (const s of list) s.value = s.finished && s.time !== null ? formatTime(s.time) : `R${Math.min(laps, Math.max(1, s.lap + 1))}`;
        } else {
            list.sort((a, b) => b.score - a.score);
            for (const s of list) s.value = formatPoints(s.score);
        }
        return list;
    }

    return {
        remote(seat, packed) {
            const car = cars.find(c => c.seat === seat);
            if (!car || car.physics || !Array.isArray(packed) || packed.length < 17) return;
            const now = performance.now();
            car.offset = Math.min(car.offset, now - packed[0]);
            car.snapshots.push({ t: packed[0], d: packed });
            if (car.snapshots.length > 30) car.snapshots.shift();
        },

        leave(seat) {
            const index = cars.findIndex(c => c.seat === seat && c !== me);
            if (index < 0) return;
            const [car] = cars.splice(index, 1);
            car.voice?.dispose();
            carLights.remove(car.vehicle.model);
            backfires.forget(car.vehicle.model);
            streaks?.forget(car.vehicle.model);
            stateByModel.delete(car.vehicle.model);
            car.vehicle.dispose();
        },

        finishNow() {
            const t = Math.max(0, raceTime());
            for (const car of cars) if (car.physics && !car.finished) finish(car, t, true);
        },

        setPaused(value) {
            if (value === paused) return;
            if (value) {
                pausedAt = performance.now();
            } else {
                startPerf += performance.now() - pausedAt;
            }
            paused = value;
        },

        standings() {
            return rank().map(s => ({ seat: s.car.seat, name: s.car.name, score: Math.round(s.score), lap: Math.max(0, s.lap), progress: s.fraction, finished: s.finished }));
        },

        dispose() {
            if (disposed) return;
            disposed = true;
            if (stage.view === view) stage.clear();
            input.dispose();
            removeEventListener('keydown', unlock);
            removeEventListener('pointerdown', unlock);
            hud.dispose();
            carLights.dispose();
            for (const car of cars) {
                car.voice?.dispose();
                car.vehicle.dispose();
            }
            skids.dispose();
            smoke.dispose();
            sparks.dispose();
            backfires.dispose();
            streaks?.dispose();
            world.dispose();
        },
    };
}

function readAutopilot() {
    try {
        return localStorage.getItem('driftking.autopilot') === '1';
    } catch {
        return false;
    }
}

/** Race order: finished cars first (by time), then the rest by distance done. */
function raceOrder(a, b) {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && a.time !== null && b.time !== null) return a.time - b.time;
    return b.done - a.done;
}

/** What the picture of a driven car needs, read from its physics. */
function physicsState(car) {
    const p = car.physics;
    const s = (car.picture ??= {});
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.yaw = p.yaw;
    s.vx = p.vx;
    s.vz = p.vz;
    s.speed = p.speed;
    s.steer = p.steer;
    s.forward = p.forwardSpeed;
    s.rearSlip = p.rearSlip;
    s.frontSlip = p.frontSlip;
    s.braking = (car.controls?.brake ?? 0) > 0.1 || (car.controls?.handbrake ?? 0) > 0.5;
    s.lateralG = p.lateralG;
    s.accel = p.accel;
    s.pitch = car.at.slope ? car.at.slope * Math.cos(p.yaw - Math.atan2(car.at.tx, car.at.tz)) : 0;
    s.drifting = Math.abs(p.driftAngle) >= DRIFT_MIN_ANGLE && p.speed > 8.3;
    return s;
}

function round(v, digits) {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}
