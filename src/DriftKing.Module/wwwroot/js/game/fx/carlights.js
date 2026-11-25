// DriftKing · fx/carlights.js – the cars' lamps as light. The own car's headlights are one real SpotLight on its model (medium/high, outside the
// pool; on high it casts a soft shadow – a bot ahead throws its shadow up the road). Every other car registers a headlight source in the map's
// light rig (render/lights.js, moved every frame; the rig lights the nearest few with the pool lights buildWorld keeps for them – lightReserve).
// And every car's headlights, tail/brake lights and underglow light the tyre smoke (fx/lighting.js records, on every tier).
// The lamps sit where the model's userData.lightMounts says (fx/common.js carMounts: estimated from the body when a model has none).

import * as THREE from 'three';
import { LIGHT_PRESETS } from '../render/lights.js';
import { carMounts, centreOf } from './common.js';
import { lightRecord } from './lighting.js';

const HEAD = LIGHT_PRESETS.headlight;
/** Pool lights to keep for the other cars' headlights (buildWorld lightReserve): the nearest few are lit. */
export const HEADLIGHT_RESERVE = 3;

const head = new THREE.Color(HEAD.color);
const centre = { x: 0, y: 0, z: 0 };
const v = new THREE.Vector3();
const dir = new THREE.Vector3();

/** The lamps of all cars of a run. */
export class CarLights {
    /**
     * @param {{ lights?: import('../render/lights.js').LightRig }} world
     * @param {string} quality
     * @param {import('./lighting.js').FxLighting|null} lighting the smoke's light (gets the lamps of every car)
     */
    constructor(world, quality, lighting = null) {
        this.rig = quality === 'low' ? null : world.lights ?? null;
        this.quality = quality;
        this.lighting = lighting;
        this.cars = [];
    }

    /**
     * A car of the run.
     * @param {THREE.Object3D} model the car model (Vehicle.model)
     * @param {{ own?: boolean, neon?: string|null }} [options] own: the player's car (its own SpotLight); neon: the underglow colour
     */
    add(model, { own = false, neon = null } = {}) {
        const mounts = carMounts(model);
        const entry = {
            model,
            own,
            head: centreOf(mounts.head, { x: 0, y: 0, z: 0 }),
            tail: centreOf(mounts.tail, { x: 0, y: 0, z: 0 }),
            neon: neon ? new THREE.Color(neon).convertSRGBToLinear() : null,
            spot: null,
            handle: null,
            records: [lightRecord(), lightRecord(), lightRecord()],
        };
        if (own && this.quality !== 'low') entry.spot = this.ownHeadlight(model, entry.head);
        else if (!own && this.rig) {
            entry.handle = this.rig.add({ ...HEAD, x: 0, y: -100, z: 0 });
            // the smoke gets this car's lamps from its own records (fx/lighting.js skips rig sources marked car)
            entry.handle.car = true;
        }
        this.cars.push(entry);
        return entry;
    }

    /** The own car's headlights: one SpotLight between the lamps, aimed ~22 m ahead and a little down. */
    ownHeadlight(model, at) {
        const light = new THREE.SpotLight(HEAD.color, HEAD.intensity, HEAD.distance, HEAD.angle, HEAD.penumbra, HEAD.decay);
        light.position.set(at.x, at.y, at.z + 0.15);
        light.target.position.set(at.x, 0, at.z + 22);
        if (this.quality === 'high') {
            light.castShadow = true;
            light.shadow.mapSize.set(1024, 1024);
            light.shadow.camera.near = 0.4;
            light.shadow.camera.far = 32;
            light.shadow.bias = -0.0006;
            light.shadow.normalBias = 0.03;
            light.shadow.radius = 3;
        }
        model.add(light, light.target);
        return light;
    }

    /** Forgets a car (it left the run). */
    remove(model) {
        const index = this.cars.findIndex(c => c.model === model);
        if (index < 0) return;
        const [entry] = this.cars.splice(index, 1);
        if (entry.handle) this.rig?.remove(entry.handle);
        entry.spot?.dispose();
    }

    /**
     * Once per frame after the cars are placed: moves the rig's headlight sources and hands every car's lamps to the smoke.
     * @param {(model: THREE.Object3D) => { braking?: boolean|number }} stateOf the driving state of a car (brake lights)
     */
    update(stateOf) {
        const out = this.lighting?.carSources;
        if (out) out.length = 0;
        for (const car of this.cars) {
            const model = car.model;
            if (!model.parent) continue;
            model.updateMatrix();
            const m = model.matrix;
            v.set(car.head.x, car.head.y, car.head.z).applyMatrix4(m);
            dir.set(0, -0.09, 1).transformDirection(m);
            // a low beam puts its hot spot on the road below the horizon: a car close ahead only gets the bumper's share, not the full cone
            const dim = this.lowBeam(car, v, dir);
            if (car.handle) {
                car.handle.position.copy(v);
                car.handle.target.copy(v).addScaledVector(dir, 20);
                car.handle.intensity = HEAD.intensity * dim;
            }
            if (car.spot) car.spot.intensity = HEAD.intensity * dim;
            if (!out) continue;
            const front = car.records[0];
            const back = car.records[1];
            const glow = car.records[2];
            // the smoke right in front sits low, under the cut-off line: it keeps more of the light than the car ahead
            const beam = HEAD.intensity * (0.45 + 0.55 * dim);
            setRecord(front, v, dir, head.r * beam, head.g * beam, head.b * beam, HEAD.distance, Math.cos(HEAD.angle),
                Math.cos(HEAD.angle * (1 - HEAD.penumbra)));
            out.push(front);
            // tail lights: a red glow behind the car, three times as strong when braking
            const braking = stateOf(model)?.braking ? 1 : 0;
            v.set(car.tail.x, car.tail.y, car.tail.z).applyMatrix4(m);
            dir.set(0, 0, -1).transformDirection(m);
            const red = braking ? 3.2 : 1.1;
            setRecord(back, v, dir, red, red * 0.035, red * 0.03, 7, 0, 0.55);
            out.push(back);
            if (car.neon) {
                v.set(0, 0.15, 0).applyMatrix4(m);
                setRecord(glow, v, dir, car.neon.r * 0.8, car.neon.g * 0.8, car.neon.b * 0.8, 4, -2, -1);
                out.push(glow);
            }
        }
    }

    /** 1, or less when another car is right in front of these lamps (the cone of a SpotLight has no cut-off line: it would flood that car). */
    lowBeam(car, at, forward) {
        let nearest = Infinity;
        for (const other of this.cars) {
            if (other === car || !other.model.parent) continue;
            const p = other.model.position;
            const dx = p.x - at.x;
            const dz = p.z - at.z;
            const along = dx * forward.x + dz * forward.z;
            if (along <= 0 || along >= nearest) continue;
            // inside the cone (with the other car's half width)
            if (Math.abs(dx * forward.z - dz * forward.x) < along * 0.5 + 1.6) nearest = along;
        }
        if (nearest > 16) return 1;
        const t = Math.max(0, Math.min(1, (nearest - 2.5) / 13.5));
        return 0.04 + 0.96 * t * t;
    }

    dispose() {
        for (const car of this.cars) {
            if (car.handle) this.rig?.remove(car.handle);
            car.spot?.dispose();
        }
        this.cars.length = 0;
    }
}

function setRecord(r, position, direction, red, green, blue, reach, coneCos, penumbraCos) {
    r.x = position.x;
    r.y = position.y;
    r.z = position.z;
    r.dx = direction.x;
    r.dy = direction.y;
    r.dz = direction.z;
    r.r = red;
    r.g = green;
    r.b = blue;
    r.reach = reach;
    r.decay = 2;
    r.coneCos = coneCos;
    r.penumbraCos = penumbraCos;
    r.car = true;
}
