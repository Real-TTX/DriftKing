// DriftKing · car/models.js – the cars: six street-drift bodies built from sculpted shells (model-shell.js, model-bodies.js) with
// detailed parts (model-parts.js), PBR materials and a livery atlas (model-materials.js, model-livery.js), wheels with tyres, rims and
// brakes (model-wheels.js). A near model (≈ 15 draw calls: one per material) and a far model (4 draw calls) switch by distance (THREE.LOD).
// Geometry is shared by all cars of a body (per quality and tuning variant); paint, livery and the changing lamps belong to each car.
// The car faces +z, the ground is y = 0; the body rolls and pitches in userData.body, the wheels steer and spin.
// A car key with a real model (data/car-models.json, model-glb.js) gets it on medium/high: buildCar returns the procedural car at once and
// swaps the model in when it is loaded (at once when it is loaded already); userData.ready resolves to true then (false: procedural).

import * as THREE from 'three';
import { settings } from '../settings.js';
import { disposeMaterial, glowMaterial, isShared, markShared } from '../render/kit.js';
import { BODY_KEYS as KEYS, designOf } from './model-bodies.js';
import { carMaterials, paintMaterial, reverseMaterial, tailMaterial } from './model-materials.js';
import { liveryTexture } from './model-livery.js';
import { Buckets, buildParts } from './model-parts.js';
import { wheelGeometries } from './model-wheels.js';
import { applyMeasures, carManifestReady, carModelEntry, loadCarModel, loadedCarModel, releaseCarModels, swapInModel } from './model-glb.js';

/** Measures shared by all bodies (metres). */
export const CAR = { wheelbase: 2.5, track: 1.5, wheelRadius: 0.33, width: 1.78 };

/** The body keys (catalog.js BODIES has their names). */
export const BODY_KEYS = KEYS;

/** Beyond this distance (m) a car shows its far model. */
const LOD_DISTANCE = { low: 24, medium: 36, high: 46 };

/** body|quality|variant → { buckets, mounts } (shared geometry) */
const nearCache = new Map();
/** body|quality → far buckets */
const farCache = new Map();

/** The tuning a car shows (from view.levels): turbo → intercooler, engine → bigger pipes, suspension → lower and more camber, tires → wider. */
function variantOf(view, design) {
    const l = view.levels ?? {};
    const sum = (l.engine ?? 0) + (l.turbo ?? 0) + (l.suspension ?? 0) + (l.tires ?? 0) + (l.steering ?? 0);
    return {
        intercooler: (l.turbo ?? 0) >= 1,
        bigExhaust: (l.engine ?? 0) >= 3,
        cage: !!design.p.cage || sum >= 20,
        drop: 0.007 * Math.min(5, l.suspension ?? 0),
        camber: (0.6 + 0.35 * Math.min(5, l.suspension ?? 0)) * (Math.PI / 180),
        tyre: design.tyre + 0.006 * Math.min(5, l.tires ?? 0),
    };
}

function nearGeometry(design, quality, variant) {
    const key = `${design.key}|${quality}|${variant.intercooler ? 1 : 0}${variant.bigExhaust ? 1 : 0}${variant.cage ? 1 : 0}`;
    let entry = nearCache.get(key);
    if (entry) return entry;
    const buckets = new Buckets();
    const shells = design.shells(quality);
    for (const [name, g] of Object.entries(shells.lower)) buckets.add(name, g);
    for (const [name, g] of Object.entries(shells.cabin)) buckets.add(name, g);
    const mounts = buildParts(buckets, design, variant, quality);
    const merged = buckets.merge();
    for (const g of Object.values(merged)) markShared(g);
    entry = { buckets: merged, mounts };
    nearCache.set(key, entry);
    return entry;
}

function farGeometry(design, quality) {
    const key = `${design.key}|${quality}`;
    let entry = farCache.get(key);
    if (entry) return entry;
    const b = new Buckets();
    const shells = design.shells(quality, true);
    const glass = [0.012, 0.016, 0.024];
    const dark = [0.01, 0.01, 0.011];
    const put = (bucket, g, colour = null) => g && b.add(bucket, g, colour);
    put('paint', shells.lower.paint);
    put('far', shells.lower.matte, dark);
    put('paint', shells.cabin.paint);
    put('far', shells.cabin.glass, glass);
    put('far', shells.cabin.gloss, dark);
    // the wheels: tyre and a grey rim face, fixed to the body
    for (const z of [CAR.wheelbase / 2, -CAR.wheelbase / 2]) {
        for (const side of [1, -1]) {
            const x = side * design.halfTrack;
            b.add('far', new THREE.CylinderGeometry(0.33, 0.33, design.tyre, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z), [0.012, 0.012, 0.013]);
            b.add('far', new THREE.CircleGeometry(0.2, 10).rotateY(side * Math.PI / 2).translate(x + side * (design.tyre / 2 + 0.002), 0.33, z), [0.28, 0.29, 0.3]);
        }
    }
    // lamps as plain lit patches on the nose and tail
    const head = [];
    const tail = [];
    for (const side of [1, -1]) {
        const h = design.front(side * 0.56, 0.6);
        head.push(new THREE.PlaneGeometry(0.3, 0.09).lookAt(h.n).translate(h.p.x + h.n.x * 0.02, h.p.y + h.n.y * 0.02, h.p.z + h.n.z * 0.02));
        const t = design.rear(side * 0.6, 0.74);
        tail.push(new THREE.PlaneGeometry(0.34, 0.1).lookAt(t.n).translate(t.p.x + t.n.x * 0.02, t.p.y + t.n.y * 0.02, t.p.z + t.n.z * 0.02));
    }
    for (const g of head) b.add('lamp', g, [20, 19, 17]);
    for (const g of tail) b.add('tail', g, [1, 1, 1]);
    entry = b.merge();
    for (const g of Object.values(entry)) markShared(g);
    farCache.set(key, entry);
    return entry;
}

/**
 * Builds a car from its CarView (body, paint, rims, neon, number, decal, levels).
 * @param {object} view the CarView
 * @param {{ quality?: string }} [options] the picture quality (default: the settings)
 * @returns {THREE.Group} with userData { body, wheels: [{ pivot, spin, side, front }], headGlow, tailGlow, beam, neon, profile, lightMounts,
 *          tailMaterial, lamps: { tail, reverse }, lod, ready (Promise<boolean>: the real model is in), syncWheels(), dispose() }
 */
export function buildCar(view, { quality = settings.get().quality } = {}) {
    const design = designOf(view.body);
    const variant = variantOf(view, design);
    const near = nearGeometry(design, quality, variant);
    const far = farGeometry(design, quality);
    const shared = carMaterials(quality);
    const paintColour = new THREE.Color(view.paint ?? '#f4f2ff');
    // a model that is loaded already replaces the procedural body in this call: no livery to paint for it
    const modelNow = quality !== 'low' && view.key ? loadedCarModel(view.key) : null;
    const livery = modelNow ? null : liveryTexture(view, design, quality);
    const paint = paintMaterial(quality, livery, paintColour);
    const tail = tailMaterial();
    const reverse = reverseMaterial();
    const materials = {
        paint, tail, reverse,
        glass: shared.glass, lens: shared.lens, gloss: shared.gloss, matte: shared.matte, chrome: shared.chrome, lamp: shared.lamp, far: shared.far,
        neon: view.neon ? shared.neonTube(view.neon) : null,
    };

    const car = new THREE.Group();
    car.name = view.name ?? 'car';
    const body = new THREE.Group();
    body.position.y = -variant.drop;
    car.add(body);
    const bodyLod = new THREE.LOD();
    const nearBody = new THREE.Group();
    const farBody = new THREE.Group();
    for (const [name, geometry] of Object.entries(near.buckets)) {
        const material = materials[name];
        if (!material) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = name === 'paint';
        mesh.name = name;
        nearBody.add(mesh);
    }
    for (const [name, geometry] of Object.entries(far)) {
        const mesh = new THREE.Mesh(geometry, materials[name]);
        mesh.castShadow = name === 'paint';
        farBody.add(mesh);
    }
    const lodDistance = LOD_DISTANCE[quality] ?? LOD_DISTANCE.medium;
    bodyLod.addLevel(nearBody, 0, 0.05);
    bodyLod.addLevel(farBody, lodDistance, 0.05);
    body.add(bodyLod);

    // the wheels: four pivots (steer) with camber and spin, drawn as instanced tyres, rims, discs and calipers
    const wg = wheelGeometries(design.p.rim, quality, variant.tyre);
    const instanced = {
        tyre: new THREE.InstancedMesh(wg.tyre, shared.tyre, 4),
        rim: new THREE.InstancedMesh(wg.rim, shared.rim(view.rims ?? '#c9ccd6'), 4),
        disc: new THREE.InstancedMesh(wg.disc, shared.disc, 4),
        caliper: new THREE.InstancedMesh(wg.caliper, shared.caliper(design.p.caliper), 4),
    };
    const nearWheels = new THREE.Group();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.33, 0), 2.2);
    for (const m of Object.values(instanced)) {
        m.boundingSphere = sphere.clone();
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        nearWheels.add(m);
    }
    instanced.tyre.castShadow = true;
    const wheelLod = new THREE.LOD();
    wheelLod.addLevel(nearWheels, 0, 0.05);
    wheelLod.addLevel(new THREE.Group(), lodDistance, 0.05);
    car.add(wheelLod);

    const wheels = [];
    for (const front of [true, false]) {
        for (const side of [1, -1]) {
            const pivot = new THREE.Object3D();
            pivot.position.set(side * design.halfTrack, CAR.wheelRadius, front ? CAR.wheelbase / 2 : -CAR.wheelbase / 2);
            const camber = new THREE.Object3D();
            camber.rotation.z = side * variant.camber * (front ? 1 : 0.6);
            const flip = new THREE.Object3D();
            if (side < 0) flip.rotation.y = Math.PI;
            const spin = new THREE.Object3D();
            pivot.add(camber);
            camber.add(flip);
            flip.add(spin);
            car.add(pivot);
            wheels.push({ pivot, camber, flip, spin, side, front });
        }
    }
    const base = new THREE.Matrix4();
    const full = new THREE.Matrix4();
    function syncWheels() {
        wheels.forEach((w, k) => {
            w.pivot.updateMatrix();
            w.camber.updateMatrix();
            w.flip.updateMatrix();
            w.spin.updateMatrix();
            base.multiplyMatrices(w.pivot.matrix, w.camber.matrix).multiply(w.flip.matrix);
            instanced.disc.setMatrixAt(k, base);
            instanced.caliper.setMatrixAt(k, base);
            full.multiplyMatrices(base, w.spin.matrix);
            instanced.tyre.setMatrixAt(k, full);
            instanced.rim.setMatrixAt(k, full);
        });
        for (const m of Object.values(instanced)) m.instanceMatrix.needsUpdate = true;
    }
    syncWheels();

    // light mounts (car-local, with the ride height) and the glow points of the lamps
    const lift = v => new THREE.Vector3(v.x, v.y - variant.drop, v.z);
    const lightMounts = { head: near.mounts.head.map(lift), tail: near.mounts.tail.map(lift), exhaust: near.mounts.exhaust.map(lift) };
    const headGlow = glowPoints(near.mounts.head.map(v => [v.x, v.y, v.z + 0.06]), 1.3, 0xfff0d8);
    const tailGlow = glowPoints(near.mounts.tail.map(v => [v.x, v.y, v.z - 0.06]), 0.9, 0xff1a2a);
    tailGlow.material.uniforms.intensity.value = 0.55;
    body.add(headGlow, tailGlow);

    // the headlight beam on the road (the garage hides it)
    const beam = new THREE.Mesh(beamGeometry(), shared.beam);
    beam.position.set(0, 0.05, design.nose + 8.5);
    beam.renderOrder = 3;
    car.add(beam);

    // neon: tubes under the sills (near model) and their light on the ground
    let neon = null;
    let neonPlane = null;
    if (view.neon) {
        neon = new THREE.Group();
        const plane = new THREE.Mesh(neonGeometry(), shared.neonGround(view.neon));
        neonPlane = plane;
        plane.position.y = 0.035;
        plane.scale.set(design.halfWidth * 2 + 2.6, 1, design.nose - design.tail + 2.4);
        neon.add(plane);
        neon.renderOrder = 2;
        car.add(neon);
    }

    // a soft contact shadow
    const shadow = new THREE.Mesh(shadowGeometry(), shared.shadow);
    shadow.scale.set(design.halfWidth * 2 + 0.45, 1, design.nose - design.tail + 0.5);
    shadow.position.set(0, 0.03, (design.nose + design.tail) / 2);
    shadow.renderOrder = 1;
    car.add(shadow);

    const width = design.halfWidth * 2;
    car.userData = {
        body,
        wheels,
        neon,
        headGlow,
        tailGlow,
        beam,
        lightMounts,
        tailMaterial: tail,
        lamps: { tail, reverse },
        /** The far model's body (it rolls with the near one: it is inside body). */
        lod: { body: bodyLod, wheels: wheelLod },
        profile: {
            body: design.key,
            width,
            halfTrack: design.halfTrack,
            len: (design.nose - design.tail) / 2,
            front: design.nose,
            rear: design.tail,
            nose: lightMounts.head[0]?.y ?? 0.6,
            tail: lightMounts.tail[0]?.y ?? 0.75,
            drop: variant.drop,
        },
        /** Copies the wheels' pivot/spin transforms into the instanced wheels (Vehicle.update calls it every frame). */
        syncWheels,
        dispose() {
            car.userData.disposed = true;
            car.traverse(o => {
                if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
                const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
                for (const m of list) disposeMaterial(m);
                if (o.isInstancedMesh) o.dispose();
                if (o.isLight) o.dispose?.();
            });
        },
    };
    car.userData.ready = attachModel(car, view, quality, { bodyLod, nearBody, farBody, wheelLod, shadow, neonPlane, variant, lodDistance });
    return car;
}

/**
 * The real model of the car's key (medium/high): swapped in now when it is loaded, else when it arrives. The model's measures (lamp mounts,
 * profile) are put on the car at once when the list of models is loaded, so the run's lamps and the camera read the real car's.
 * @returns {Promise<boolean>} true when the model is in
 */
function attachModel(car, view, quality, ctx) {
    if (quality === 'low' || !view.key) return Promise.resolve(false);
    let restore = null;
    const swap = template => {
        if (car.userData.disposed) return false;
        restore ??= applyMeasures(car, template.entry, ctx);
        swapInModel(car, template, view, quality, ctx);
        return true;
    };
    const now = loadedCarModel(view.key);
    if (now) return Promise.resolve(swap(now));
    const entry = carModelEntry(view.key);
    if (carManifestReady() && !entry) return Promise.resolve(false);
    if (entry) restore = applyMeasures(car, entry, ctx);
    return loadCarModel(view.key).then(swap, error => {
        if (entry) console.warn(`DriftKing: the model of "${view.key}" could not be loaded`, error);
        if (restore && !car.userData.disposed) restore();
        return false;
    });
}

/** Glow sprites on the lamps (the halo on low, a soft extra on medium/high). */
function glowPoints(points, size, hex) {
    const geometry = new THREE.BufferGeometry();
    const c = new THREE.Color(hex);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(points.map(() => size), 1));
    geometry.setAttribute('tint', new THREE.Float32BufferAttribute(points.flatMap(() => [c.r, c.g, c.b]), 3));
    const p = new THREE.Points(geometry, glowMaterial({ fogFar: 700 }));
    p.frustumCulled = false;
    p.renderOrder = 6;
    return p;
}

let beamShared = null;
let neonShared = null;
let shadowShared = null;

function beamGeometry() {
    beamShared ??= markShared(new THREE.PlaneGeometry(7, 17).rotateX(-Math.PI / 2));
    return beamShared;
}

function neonGeometry() {
    neonShared ??= markShared(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    return neonShared;
}

function shadowGeometry() {
    shadowShared ??= markShared(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    return shadowShared;
}

/** Drops the cached geometry of other qualities (call after a quality switch, when no car of the old quality is shown any more); low also frees the loaded real models. */
export function trimCarCache(quality) {
    if (quality === 'low') releaseCarModels();
    for (const cache of [nearCache, farCache]) {
        for (const [key, entry] of cache) {
            if (key.split('|')[1] === quality) continue;
            const buckets = entry.buckets ?? entry;
            for (const g of Object.values(buckets)) g.dispose();
            cache.delete(key);
        }
    }
}

