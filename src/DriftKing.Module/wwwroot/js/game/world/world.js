// DriftKing · world/world.js – builds a map: its course (data/maps.json), colliders, environment and set pieces, in one THREE.Scene.
//   const world = await buildWorld('pass', { timeOfDay: 'night' });
//   world.scene, world.course, world.colliders, world.lights, world.groundAt(x, z, hint), world.update(dt, cameraTarget, camera?), world.dispose()
// The map builders (world/maps/*) get a ctx with the course, colliders, the glow/pool collectors, the light rig (real lights), the material
// and texture factories of the quality and the reflection map – see docs/RENDERING.md.

import * as THREE from 'three';
import { settings } from '../settings.js';
import { Course } from './course.js';
import { Colliders } from './colliders.js';
import { buildEnvironment } from './env.js';
import { disposeTree, GlowPoints, LightPools, rng } from '../render/kit.js';
import { LightRig } from '../render/lights.js';
import { materialsFor, trimMaterials } from '../render/materials.js';
import { environmentFor } from '../render/environment.js';
import * as pass from './maps/pass.js';
import * as deck from './maps/deck.js';
import * as harbor from './maps/harbor.js';
import * as city from './maps/city.js';

const BUILDERS = { pass, deck, harbor, city };

/** How much a map builds per quality (props, trees, particles). */
export const DETAIL = { low: 0.45, medium: 1, high: 1.5 };

let mapsPromise = null;

/** The map definitions of data/maps.json (loaded once). */
export function loadMaps() {
    mapsPromise ??= fetch(new URL('../../../data/maps.json', import.meta.url)).then(r => {
        if (!r.ok) throw new Error('Die Karten konnten nicht geladen werden.');
        return r.json();
    });
    return mapsPromise;
}

/** The definition of one map (throws for an unknown key). */
export async function mapDef(key) {
    const def = (await loadMaps()).find(m => m.key === key);
    if (!def) throw new Error(`Diese Karte gibt es nicht: ${key}`);
    return def;
}

/**
 * Builds the world of a map.
 * @param {string} key pass | deck | harbor | city
 * @param {{ timeOfDay?: 'night'|'dusk', quality?: string, lightReserve?: number }} [options]
 *        lightReserve: pool lights to keep for sources added after the build (world.lights.add – e.g. the cars' headlights)
 */
export async function buildWorld(key, { timeOfDay = 'night', quality = settings.get().quality, lightReserve = 0 } = {}) {
    const def = await mapDef(key);
    const builder = BUILDERS[key];
    // materials and textures made for another quality are not needed any more (a world still showing them would upload them again)
    trimMaterials(quality);
    const course = new Course(def);
    const colliders = new Colliders();
    const scene = new THREE.Scene();
    const env = buildEnvironment(scene, { timeOfDay, quality, seed: key.length * 13 });
    // reflections and the image-based fill: a night (or dusk) street (not on low: Lambert would only pay for an ambient term the hemisphere
    // light gives for free); the stage reads the post settings of the time of day from the scene
    const envMap = quality === 'low' ? null : environmentFor(timeOfDay);
    scene.environment = envMap;
    scene.environmentIntensity = env.palette.envIntensity;
    scene.userData.post = env.palette.post;
    // the real lights: a fixed pool per quality, handed to the nearest registered sources every frame
    const lights = new LightRig(scene, quality);
    const root = new THREE.Group();
    scene.add(root);
    const glows = new GlowPoints();
    const pools = new LightPools();
    const materials = materialsFor(quality);
    const ctx = {
        def,
        key,
        root,
        scene,
        course,
        colliders,
        glows,
        pools,
        /** The light rig (render/lights.js): ctx.lights.add({ x, y, z, ...LIGHT_PRESETS.sodium }) for every real lamp. */
        lights,
        /** The material factory of the quality (render/materials.js). */
        materials,
        /** The texture recipes of the quality (render/textures.js). */
        textures: materials.textures,
        /** The reflection map of the scene (null without a renderer). */
        envMap,
        quality,
        detail: DETAIL[quality] ?? 1,
        timeOfDay,
        palette: env.palette,
        random: rng(key.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)),
    };
    const extra = builder.build(ctx) ?? {};
    // the light count is fixed from here on: pool lights without a source are dropped before anything is compiled
    lights.reserve(lightReserve);
    lights.seal();
    const glowPoints = glows.build({ fogFar: env.palette.fogFar * 1.6, intensity: timeOfDay === 'dusk' ? 0.8 : 1 });
    if (glowPoints) root.add(glowPoints);
    const poolMesh = pools.build();
    if (poolMesh) root.add(poolMesh);
    root.traverse(o => {
        if (o.isMesh && !o.isInstancedMesh) o.matrixAutoUpdate = false;
        o.updateMatrix();
    });

    const flatY = extra.flatY ?? null;
    const hint = { index: -1 };
    const forward = new THREE.Vector3();
    return {
        key,
        def,
        name: def.name,
        scene,
        course,
        colliders,
        env,
        /** The light rig of the map (real lights; add dynamic sources such as other cars' headlights here). */
        lights,
        /** The quality the world was built for. */
        quality,
        /** True when the ground is flat (no slopes: deck, harbour, city). */
        flat: flatY !== null,
        /** The height of the ground at (x, z) (the course height on the pass, flat elsewhere). */
        groundAt(x, z, hintIndex = hint.index) {
            if (flatY !== null) return flatY;
            const at = course.locate(x, z, hintIndex);
            hint.index = at.index;
            return at.y;
        },
        /**
         * Once per frame: animations of the map, the sky around the camera target, the real lights near it.
         * @param {number} dt
         * @param {THREE.Vector3} target the camera position
         * @param {THREE.Camera} [camera] the camera (its view direction lets the lights favour what is in front)
         */
        update(dt, target, camera) {
            env.update(dt, target);
            lights.update(target, dt, camera ? camera.getWorldDirection(forward) : undefined);
            extra.update?.(dt);
        },
        dispose() {
            lights.dispose();
            disposeTree(scene);
            scene.environment = null;
            scene.clear();
        },
    };
}
