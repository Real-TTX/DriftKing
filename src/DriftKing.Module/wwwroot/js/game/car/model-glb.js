// DriftKing · car/model-glb.js – the real cars: glTF models made by tools/cars/prepare.mjs (models/cars/<key>.glb, listed in
// data/car-models.json with their measures, wheel centres and lamp mounts). models.js builds the procedural car first and swaps the model
// in here when it is loaded (medium/high only; low never downloads one): the same car object, the same userData interface (body, wheels,
// lamps, lightMounts, profile, lod, dispose) – runs, garage, backdrop and bots need no change.
//
// A model file has the nodes body, wheel_fl/fr/rl/rr (spin), caliper_xx (steer, no spin) and far (the far model), and role-named materials:
// paint, glass, lens, chrome, metal, rubber, rim, trim, plastic, caliper (replaced by DriftKing's own materials, docs/RENDERING.md §5),
// light_head/drl/tail/brake/reverse/indicator (lamps), far (vertex colours) and x_* (the model's own, textures kept).
// Geometry, the model's textures and its kept materials are loaded once per key and shared by every car (userData.shared); paint, tail,
// brake and reverse lamps belong to each car.

import * as THREE from 'three';
import { disposeMaterial, isShared, markShared } from '../render/kit.js';
import { materialsFor } from '../render/materials.js';
import { carMaterials, LAMP } from './model-materials.js';

const BASE = new URL('../../../', import.meta.url);
const CORNERS = ['fl', 'fr', 'rl', 'rr'];
/** Head lamp lenses of a model glow less than the procedural projectors: the role usually covers the whole lens. */
const LAMPS = { head: 6, drl: 4, indicator: 0.25 };
const TAIL_BASE = new THREE.Color(1, 0.022, 0.016);
const REVERSE_BASE = new THREE.Color(1, 0.97, 0.92);

/** key → the manifest entry (null until data/car-models.json is loaded). */
let manifest = null;
let manifestPromise = null;
/** key → Promise<template>; key → template once loaded (for a synchronous swap). */
const loading = new Map();
const loaded = new Map();
/** The glTF loader with the meshopt decoder: imported on the first model (low never pays for it). */
let loader = null;

function gltfLoader() {
    loader ??= Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
        .then(([{ GLTFLoader }, { MeshoptDecoder }]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
    return loader;
}

/** Loads data/car-models.json once (started when this module is imported). */
export function loadCarManifest() {
    manifestPromise ??= fetch(new URL('data/car-models.json', BASE), { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(data => {
            manifest = data?.cars ?? {};
            return manifest;
        });
    return manifestPromise;
}
loadCarManifest();

/** The manifest entry of a car key (null when there is no model or the manifest is not loaded yet). */
export function carModelEntry(key) {
    return key && manifest ? manifest[key] ?? null : null;
}

/** True once the manifest is loaded. */
export function carManifestReady() {
    return manifest !== null;
}

/** The loaded template of a key, or null (not loaded yet / no model). */
export function loadedCarModel(key) {
    return loaded.get(key) ?? null;
}

/**
 * Loads the model of a car key (once; the promise is shared). Resolves to the template, rejects when the file cannot be loaded.
 * @param {string} key the car key
 */
export function loadCarModel(key) {
    let promise = loading.get(key);
    if (promise) return promise;
    promise = loadCarManifest().then(cars => {
        const entry = cars[key];
        if (!entry) throw new Error(`no model for car "${key}"`);
        return gltfLoader().then(l => l.loadAsync(new URL(`${entry.url}?v=${entry.v ?? ''}`, BASE).href)).then(gltf => {
            const template = makeTemplate(gltf, entry, key);
            loaded.set(key, template);
            return template;
        });
    });
    promise.catch(() => loading.delete(key));
    loading.set(key, promise);
    return promise;
}

/** Starts loading the models of these car keys (the garage list, the cars of a run) – no error when one has none. */
export function preloadCarModels(keys) {
    return loadCarManifest().then(cars => Promise.all(keys.filter(k => cars[k]).map(k => loadCarModel(k).catch(() => null))));
}

/** The parts of a loaded model in the car's frame: body, far, and per corner the spinning wheel and the caliper, both around the wheel centre. */
function makeTemplate(gltf, entry, key) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const find = name => root.getObjectByName(name) ?? null;
    const local = new THREE.Matrix4();
    const take = (object, centre = null) => {
        if (!object) return null;
        local.copy(object.matrixWorld);
        if (centre) local.premultiply(new THREE.Matrix4().makeTranslation(-centre[0], -centre[1], -centre[2]));
        object.removeFromParent();
        local.decompose(object.position, object.quaternion, object.scale);
        object.updateMatrix();
        return object;
    };
    const template = {
        key,
        entry,
        body: take(find('body')),
        far: take(find('far')),
        wheels: {},
        /** quality → { factory, map: Map(source material → replacement), own: [] } */
        qualities: new Map(),
    };
    for (const c of CORNERS) {
        const centre = entry.wheels[c];
        template.wheels[c] = { spin: take(find(`wheel_${c}`), centre), caliper: take(find(`caliper_${c}`), centre), centre };
    }
    const parts = [template.body, template.far, ...CORNERS.flatMap(c => [template.wheels[c].spin, template.wheels[c].caliper])];
    for (const part of parts) {
        part?.traverse(o => {
            if (!o.isMesh) return;
            markShared(o.geometry);
            for (const m of list(o.material)) markShared(m);
        });
    }
    return template;
}

/** The role of a model material by its name ("light_tail.2" → light_tail). */
function roleOf(material) {
    return (material?.name ?? '').replace(/\.\d+$/, '');
}

/** The shared replacements of a template for a quality (DriftKing's own materials; cached until the factory changes). */
function sharedSet(template, quality) {
    const factory = materialsFor(quality);
    let set = template.qualities.get(quality);
    if (set && set.factory === factory) return set;
    if (set) for (const m of set.own) m.dispose();
    const mat = factory;
    const car = carMaterials(quality);
    const own = [];
    const keep = m => {
        markShared(m);
        own.push(m);
        return m;
    };
    const lamp = (colour, intensity, source) => keep(new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour).multiplyScalar(intensity), map: source.map ?? null, side: source.side ?? THREE.FrontSide,
    }));
    const lamps = { ...LAMPS, ...(template.entry.lamps ?? {}) };
    const byRole = {
        glass: () => car.glass,
        lens: () => car.lens,
        chrome: () => car.chrome,
        metal: () => mat.metal({ color: 0x8e9196, roughness: 0.38 }),
        rubber: () => mat.rubber({ color: 0x1c1c1e, roughness: 0.9 }),
        trim: () => mat.plastic({ color: 0x0c0d10, roughness: 0.24 }),
        plastic: () => mat.plastic({ color: 0x17181b, roughness: 0.55 }),
        caliper: source => mat.painted({ color: source.color.getHex(), roughness: 0.35 }),
        far: () => car.far,
        light_head: source => lamp(0xfff2df, lamps.head, source),
        light_drl: source => lamp(0xf4f6ff, lamps.drl, source),
        light_indicator: source => lamp(0xff8a1a, lamps.indicator, source),
    };
    const map = new Map();
    set = {
        factory,
        own,
        /** The shared replacement of a source material, or the source itself (kept: x_*, textured replaced roles). */
        get(source) {
            if (map.has(source)) return map.get(source);
            const role = roleOf(source);
            const make = byRole[role];
            let m = source;
            if (make && (role.startsWith('light_') || !source.map)) m = make(source);
            // the factory's materials are one-sided: a double-sided panel of the model gets a double-sided copy
            if (m !== source && source.side === THREE.DoubleSide && m.side !== THREE.DoubleSide) {
                m = keep(m.clone());
                m.side = THREE.DoubleSide;
            }
            map.set(source, m);
            return m;
        },
    };
    template.qualities.set(quality, set);
    return set;
}

/** The car's own paint: clear-coated, metallic in the middle tones, a pearl shift on light colours (no flakes: the model's UVs are not metric). */
function ownPaint(quality, colour, source) {
    const hsl = colour.getHSL({});
    const metallic = hsl.l > 0.82 ? 0.25 : hsl.s < 0.12 ? 0.55 : 0.6;
    const pearl = hsl.l > 0.82 ? 0.55 : 0;
    const m = materialsFor(quality).carPaint(colour, { metallic, pearl });
    m.normalMap = null;
    m.side = source.side ?? THREE.FrontSide;
    return m;
}

function ownLamp(base, level, source) {
    const m = new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(level), map: source.map ?? null, side: source.side ?? THREE.FrontSide });
    m.userData.base = base.clone();
    return m;
}

/**
 * Puts the model's measures on a car right away (before the model is loaded): lamp mounts, profile, beam, shadow, neon, glow points –
 * so whoever reads them after buildCar (the run's lamps, the camera) gets the real car's. Returns a function that restores the old ones.
 * @param {THREE.Group} car the procedural car (models.js)
 * @param {object} entry the manifest entry
 * @param {object} ctx models.js's internals of this car
 */
export function applyMeasures(car, entry, ctx) {
    const data = car.userData;
    const saved = {
        profile: { ...data.profile },
        mounts: Object.fromEntries(Object.entries(data.lightMounts).map(([k, v]) => [k, v.map(p => p.clone())])),
        beam: data.beam.position.clone(),
        shadow: [ctx.shadow.position.clone(), ctx.shadow.scale.clone()],
        neon: ctx.neonPlane ? ctx.neonPlane.scale.clone() : null,
    };
    const drop = ctx.variant.drop;
    const set = (target, points) => {
        if (!points?.length) return;
        target.length = 0;
        for (const p of points) target.push(new THREE.Vector3(p[0], p[1] - drop, p[2]));
    };
    set(data.lightMounts.head, entry.mounts?.head);
    set(data.lightMounts.tail, entry.mounts?.tail);
    if (entry.mounts?.exhaust?.length) set(data.lightMounts.exhaust, entry.mounts.exhaust);
    // no pipes named: the body's guess, moved to this car's tail
    else for (const p of data.lightMounts.exhaust) p.z = entry.rear + 0.04;
    const head = entry.mounts?.head ?? [];
    const tail = entry.mounts?.tail ?? [];
    Object.assign(data.profile, {
        width: entry.width,
        halfTrack: entry.halfTrack,
        len: (entry.front - entry.rear) / 2,
        front: entry.front,
        rear: entry.rear,
        nose: head[0]?.[1] ?? data.profile.nose,
        tail: tail[0]?.[1] ?? data.profile.tail,
        roof: entry.height,
        wheelbase: entry.wheelbase,
        ...(entry.profile ?? {}),
    });
    data.beam.position.z = entry.front + 8.5;
    ctx.shadow.scale.set(entry.width + 0.45, 1, entry.length + 0.5);
    ctx.shadow.position.z = (entry.front + entry.rear) / 2;
    ctx.neonPlane?.scale.set(entry.width + 2.6, 1, entry.length + 2.4);
    if (head.length) placePoints(data.headGlow, head.map(p => [p[0], p[1], p[2] + 0.04]));
    if (tail.length) placePoints(data.tailGlow, tail.map(p => [p[0], p[1], p[2] - 0.04]));
    return () => {
        Object.assign(data.profile, saved.profile);
        for (const [k, v] of Object.entries(saved.mounts)) {
            data.lightMounts[k].length = 0;
            data.lightMounts[k].push(...v);
        }
        data.beam.position.copy(saved.beam);
        ctx.shadow.position.copy(saved.shadow[0]);
        ctx.shadow.scale.copy(saved.shadow[1]);
        if (saved.neon) ctx.neonPlane.scale.copy(saved.neon);
        placePoints(data.headGlow, data.lightMounts.head.map(v => [v.x, v.y + drop, v.z + 0.06]));
        placePoints(data.tailGlow, data.lightMounts.tail.map(v => [v.x, v.y + drop, v.z - 0.06]));
    };
}

/** Moves the glow sprites of a lamp set (models.js glowPoints) to these points (same size and tint as before). */
function placePoints(points, list) {
    const g = points.geometry;
    const size = g.attributes.size.array[0] ?? 1;
    const tint = Array.from(g.attributes.tint.array.slice(0, 3));
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(list.map(() => size), 1));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(list.flatMap(() => tint), 3));
}

/**
 * Swaps the loaded model into a procedural car: the near and far body, the wheels (into the same pivots: steering, camber and spin keep
 * working), the lamps (userData.lamps: Vehicle drives tail and reverse as before), paint, rims and neon of the view. Frees what the
 * procedural car no longer needs.
 * @param {THREE.Group} car
 * @param {object} template from loadCarModel
 * @param {object} view the CarView
 * @param {string} quality
 * @param {object} ctx models.js's internals of this car
 */
export function swapInModel(car, template, view, quality, ctx) {
    const data = car.userData;
    const { entry } = template;
    const shared = sharedSet(template, quality);
    const carShared = carMaterials(quality);
    const own = new Map();
    const followers = [];
    let paint = null;
    let tail = null;
    let reverse = null;
    const paintColour = new THREE.Color(view.paint ?? '#f4f2ff');
    const pick = source => {
        if (own.has(source)) return own.get(source);
        const role = roleOf(source);
        let m;
        if (role === 'paint' && entry.paintable !== false) {
            m = paint ??= ownPaint(quality, paintColour, source);
        } else if (role === 'rim' && !source.map) {
            m = carShared.rim(view.rims ?? '#c9ccd6');
        } else if (role === 'light_tail') {
            m = ownLamp(TAIL_BASE, LAMP.tail, source);
            if (tail) followers.push({ m, kind: 'tail' });
            else tail = m;
        } else if (role === 'light_brake') {
            m = ownLamp(TAIL_BASE, 0.15, source);
            followers.push({ m, kind: 'brake' });
        } else if (role === 'light_reverse') {
            m = ownLamp(REVERSE_BASE, LAMP.reverseOff, source);
            if (reverse) followers.push({ m, kind: 'reverse' });
            else reverse = m;
        } else {
            m = shared.get(source);
        }
        own.set(source, m);
        return m;
    };
    const castAll = ctx.nearBody.children.some(m => m.castShadow && m.name !== 'paint');
    const dress = (object, shadows) => {
        object.traverse(o => {
            if (!o.isMesh) return;
            o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
            const opaque = !list(o.material).some(m => m.transparent);
            const role = roleOf(list(o.material)[0]);
            o.castShadow = shadows && opaque && (castAll || role === 'paint' || role === 'rubber' || o.material === paint);
        });
        return object;
    };

    // the body: near and far into the LOD the procedural car had (the LOD sits in userData.body: it rolls and pitches)
    const lod = ctx.bodyLod;
    // (the parts keep their node transforms – the file's quantisation lives there – so additions go next to them, not into them)
    const near = new THREE.Group().add(dress(template.body.clone(), true));
    const far = new THREE.Group();
    if (template.far) far.add(dress(template.far.clone(), false));
    near.name = 'model';
    far.name = 'model-far';
    for (const level of lod.levels) level.object.removeFromParent();
    lod.levels.length = 0;
    lod.addLevel(near, 0, 0.05);
    lod.addLevel(far, ctx.lodDistance, 0.05);
    freeTree(ctx.nearBody);
    freeTree(ctx.farBody);

    // neon tubes under the sills
    if (view.neon) {
        const length = Math.max(0.6, entry.wheelbase - entry.wheelRadius * 2 - 0.12);
        const geometry = new THREE.BoxGeometry(0.03, 0.03, length);
        for (const side of [1, -1]) {
            const tube = new THREE.Mesh(geometry, carShared.neonTube(view.neon));
            tube.position.set(side * (entry.width / 2 - 0.16), 0.17, (entry.wheels.fl[2] + entry.wheels.rl[2]) / 2);
            near.add(tube);
        }
    }

    // the wheels: the model's wheels into the pivots (no flip: a right wheel is modelled facing right), calipers steer but do not spin
    ctx.wheelLod.removeFromParent();
    ctx.wheelLod.traverse(o => o.isInstancedMesh && o.dispose());
    const wheelLods = [];
    const wheelLod = part => {
        const l = new THREE.LOD();
        l.addLevel(part, 0, 0.05);
        // a little farther than the body's switch: the far model has its wheels fixed in place, never a gap
        l.addLevel(new THREE.Object3D(), ctx.lodDistance + 3, 0.05);
        wheelLods.push(l);
        return l;
    };
    for (const w of data.wheels) {
        const corner = `${w.front ? 'f' : 'r'}${w.side > 0 ? 'l' : 'r'}`;
        const t = template.wheels[corner];
        w.pivot.position.set(t.centre[0], t.centre[1], t.centre[2]);
        // the spin node sits inside the flip (a half turn for the right wheels): turn the model back, so the spin still runs the right way
        const unflip = new THREE.Group();
        if (w.side < 0) unflip.rotation.y = Math.PI;
        if (t.spin) unflip.add(wheelLod(dress(t.spin.clone(), true)));
        w.spin.add(unflip);
        if (t.caliper) w.camber.add(wheelLod(dress(t.caliper.clone(), false)));
        w.model = unflip;
    }
    data.syncWheels = followers.length ? syncLamps : () => {};
    data.lod = { body: lod, wheels: null, wheelLods };
    data.wheelRadius = entry.wheelRadius;

    // the lamps Vehicle drives: the model's (procedural ones freed); a model without tail or reverse lamps keeps unused ones
    tail ??= ownLamp(TAIL_BASE, LAMP.tail, {});
    reverse ??= ownLamp(REVERSE_BASE, LAMP.reverseOff, {});
    const old = data.lamps;
    data.lamps = { tail, reverse };
    data.tailMaterial = tail;
    if (old) for (const m of [old.tail, old.reverse]) disposeMaterial(m);
    data.model = { key: template.key, entry };

    /** Extra tail/brake/reverse materials follow the primary ones (Vehicle sets those): once per frame through syncWheels. */
    function syncLamps() {
        const brake = Math.max(0, Math.min(1, (tail.color.r / TAIL_BASE.r - LAMP.tail) / (LAMP.brake - LAMP.tail)));
        for (const f of followers) {
            if (f.kind === 'tail') f.m.color.copy(tail.color);
            else if (f.kind === 'reverse') f.m.color.copy(reverse.color);
            else f.m.color.copy(TAIL_BASE).multiplyScalar(0.15 + (LAMP.brake - 0.15) * brake);
        }
    }
}

/** Frees the meshes of a procedural body part: its geometry is cached (shared), the car's own materials (paint, livery, lamps) go. */
function freeTree(root) {
    root.traverse(o => {
        if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
        for (const m of list(o.material)) disposeMaterial(m);
    });
}

function list(material) {
    return Array.isArray(material) ? material : material ? [material] : [];
}

/** Frees the loaded models and their replacement materials (a switch to low: no car of medium/high is shown any more). */
export function releaseCarModels() {
    for (const template of loaded.values()) {
        for (const set of template.qualities.values()) for (const m of set.own) m.dispose();
        const parts = [template.body, template.far, ...CORNERS.flatMap(c => [template.wheels[c].spin, template.wheels[c].caliper])];
        for (const part of parts) {
            part?.traverse(o => {
                if (!o.isMesh) return;
                o.geometry.dispose();
                for (const m of list(o.material)) {
                    for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
                    m.dispose();
                }
            });
        }
    }
    loaded.clear();
    loading.clear();
}
