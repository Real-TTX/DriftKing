// DriftKing · world/props-common.js – helpers the road and prop builders share (world/road.js, world/props*.js): the material factory of a
// builder call, materials a builder owns (Standard on medium/high, Lambert on low), placed primitives (rods between two points, lathe rings,
// boxes), per-vertex colours with alpha, and the instanced-mesh boilerplate.

import * as THREE from 'three';
import { settings } from '../settings.js';
import { materialsFor } from '../render/materials.js';

/**
 * The material factory of a builder call: options.materials (ctx.materials of the map) or – for callers that do not pass it – the factory
 * of the picture quality in the settings, so they still get the physically based look.
 * @param {{ materials?: object }} [options]
 */
export function materialsOf(options) {
    return options?.materials ?? materialsFor(settings.get().quality);
}

/** True when the factory makes physically based materials (medium/high); low gets Lambert/Phong. */
export function isPbr(materials) {
    return materials.quality !== 'low';
}

const LAMBERT_KEYS = ['color', 'map', 'emissive', 'emissiveMap', 'emissiveIntensity', 'vertexColors', 'transparent', 'opacity', 'alphaTest', 'side',
    'depthWrite', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'fog', 'alphaMap', 'aoMap', 'blending', 'alphaToCoverage'];

/**
 * A lit material owned by the caller (disposeTree frees it with the world; its textures should be shared): MeshStandardMaterial on
 * medium/high, MeshLambertMaterial on low (only the parameters Lambert knows are passed on).
 * @param {object} materials the factory (its quality decides)
 * @param {object} params material parameters (roughness/metalness/normalMap... are dropped on low)
 */
export function ownMaterial(materials, params) {
    if (isPbr(materials)) return new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...params });
    const lambert = {};
    for (const key of LAMBERT_KEYS) if (params[key] !== undefined) lambert[key] = params[key];
    return new THREE.MeshLambertMaterial(lambert);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * A round rod from a to b (radius r0 at a, r1 at b), open ended, as a placed geometry: truss chords, pole arms, antenna masts.
 * @returns {THREE.BufferGeometry}
 */
export function rod(a, b, r0, r1 = r0, segments = 6, open = true) {
    tmpDir.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = tmpDir.length();
    const g = new THREE.CylinderGeometry(r1, r0, length, segments, 1, open);
    g.translate(0, length / 2, 0);
    g.applyQuaternion(tmpQ.setFromUnitVectors(UP, tmpDir.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
}

/**
 * A surface of revolution around the y axis from a profile [[radius, y], ...] (bottom to top), with u around (metres along the
 * circumference at the first radius) and v = y in metres – a cone body, a lamp bowl, a water tank.
 * @returns {THREE.BufferGeometry}
 */
export function lathe(profile, segments = 12, { phase = 0 } = {}) {
    const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
    const g = new THREE.LatheGeometry(points, segments, phase, Math.PI * 2);
    const uv = g.attributes.uv;
    const position = g.attributes.position;
    const circumference = 2 * Math.PI * profile[0][0];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circumference, position.getY(i));
    return g;
}

/** Sets one colour (and alpha) on every vertex of a geometry: a colour attribute with 3 (or 4, when alpha is given) components. */
export function paint(geometry, hex, alpha = null) {
    const c = new THREE.Color(hex);
    const count = geometry.attributes.position.count;
    const size = alpha === null ? 3 : 4;
    const array = new Float32Array(count * size);
    for (let k = 0; k < count; k++) {
        array[k * size] = c.r;
        array[k * size + 1] = c.g;
        array[k * size + 2] = c.b;
        if (size === 4) array[k * size + 3] = alpha;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(array, size));
    return geometry;
}

/** Sets the uv of every vertex to one point (a geometry that samples one texel region of an atlas or emissive map). */
export function flatUV(geometry, u, v) {
    const count = geometry.attributes.position.count;
    const array = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) {
        array[k * 2] = u;
        array[k * 2 + 1] = v;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(array, 2));
    return geometry;
}

/**
 * An InstancedMesh of a geometry at the given matrices (Matrix4[]), with optional per-instance colours (Color[]).
 * Returns null when there is nothing to place (the geometry is disposed then).
 */
export function instanced(geometry, material, matrices, { colors = null, castShadow = false, receiveShadow = false, name = '' } = {}) {
    if (matrices.length === 0) {
        geometry.dispose();
        return null;
    }
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let k = 0; k < matrices.length; k++) mesh.setMatrixAt(k, matrices[k]);
    if (colors) for (let k = 0; k < colors.length; k++) mesh.setColorAt(k, colors[k]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    if (name) mesh.name = name;
    return mesh;
}

const placeQ = new THREE.Quaternion();
const placeP = new THREE.Vector3();
const placeS = new THREE.Vector3();

/** A placement matrix: position, yaw around y, scale (number or { x, y, z }). */
export function placement(x, y, z, yaw = 0, scale = 1) {
    placeP.set(x, y, z);
    placeQ.setFromAxisAngle(UP, yaw);
    if (typeof scale === 'number') placeS.set(scale, scale, scale);
    else placeS.set(scale.x, scale.y, scale.z);
    return new THREE.Matrix4().compose(placeP, placeQ, placeS);
}

/** A seed from a value 0..1 of the caller's random stream (to derive a local generator without consuming more of the caller's numbers). */
export function seedFrom(value, salt = 0) {
    return (Math.floor(value * 0x7fffffff) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
}

const worlds = new WeakMap();

/**
 * Resources a builder shares between its calls into the same world (the same root): built once by build(), then reused – e.g. the tree
 * geometries and materials when a map builds its forest patch by patch. They are owned by the world (disposeTree frees them with it).
 */
export function perWorld(root, key, build) {
    let cache = worlds.get(root);
    if (!cache) {
        cache = new Map();
        worlds.set(root, cache);
    }
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
}
