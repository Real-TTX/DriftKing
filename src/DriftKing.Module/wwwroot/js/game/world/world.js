// DriftKing · world/world.js – builds a map: its course (data/maps.json), colliders, environment and set pieces, in one THREE.Scene.
//   const world = await buildWorld('pass', { timeOfDay: 'night' });
//   world.scene, world.course, world.colliders, world.groundAt(x, z, hint), world.update(dt, cameraTarget), world.dispose()

import * as THREE from 'three';
import { settings } from '../settings.js';
import { Course } from './course.js';
import { Colliders } from './colliders.js';
import { buildEnvironment } from './env.js';
import { disposeTree, GlowPoints, LightPools, rng } from '../render/kit.js';
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
 * @param {{ timeOfDay?: 'night'|'dusk', quality?: string }} [options]
 */
export async function buildWorld(key, { timeOfDay = 'night', quality = settings.get().quality } = {}) {
    const def = await mapDef(key);
    const builder = BUILDERS[key];
    const course = new Course(def);
    const colliders = new Colliders();
    const scene = new THREE.Scene();
    const env = buildEnvironment(scene, { timeOfDay, quality, seed: key.length * 13 });
    const root = new THREE.Group();
    scene.add(root);
    const glows = new GlowPoints();
    const pools = new LightPools();
    const ctx = {
        def,
        key,
        root,
        scene,
        course,
        colliders,
        glows,
        pools,
        quality,
        detail: DETAIL[quality] ?? 1,
        timeOfDay,
        palette: env.palette,
        random: rng(key.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)),
    };
    const extra = builder.build(ctx) ?? {};
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
    return {
        key,
        def,
        name: def.name,
        scene,
        course,
        colliders,
        env,
        /** True when the ground is flat (no slopes: deck, harbour, city). */
        flat: flatY !== null,
        /** The height of the ground at (x, z) (the course height on the pass, flat elsewhere). */
        groundAt(x, z, hintIndex = hint.index) {
            if (flatY !== null) return flatY;
            const at = course.locate(x, z, hintIndex);
            hint.index = at.index;
            return at.y;
        },
        /** Once per frame: animations of the map and the sky around the camera target. */
        update(dt, target) {
            env.follow(target);
            extra.update?.(dt);
        },
        dispose() {
            disposeTree(scene);
            scene.clear();
        },
    };
}
