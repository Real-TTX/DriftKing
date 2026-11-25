// DriftKing · maps/city-kit.js – the Neon-Viertel's modelling helpers. Everything small in the district is collected in a few batches and drawn
// with one material each: the props batch (vertex colours, roughness and metalness per vertex), the emissive batch (HDR vertex colours: lamp
// heads, lenses, neon tubes; traffic-light phases) and the paint batch (road markings, tactile strips, manhole covers). Plus placed primitives,
// strips along the course and a local frame for buildings.
// Props carry their roughness/metalness in the uv attribute (they have no textures); the emissive batch carries the signal phase there.

import * as THREE from 'three';
import { mergeGeometries } from '../../render/kit.js';

const colour = new THREE.Color();

/**
 * Collects placed geometries with one colour each and builds one mesh of them.
 * add(geometry, hex, { rough, metal, gain, phase }) – gain scales the colour (HDR for the emissive batch), phase marks traffic-light lenses.
 */
export class Batch {
    /** @param {{ emissive?: boolean }} [o] emissive: the uv attribute carries the signal phase (−1 = always on) instead of roughness/metalness */
    constructor({ emissive = false } = {}) {
        this.parts = [];
        this.emissive = emissive;
    }

    /** Adds a geometry that is already placed in the world. Returns the geometry. */
    add(geometry, hex, { rough = 0.6, metal = 0, gain = 1, phase = -1, shade = 1 } = {}) {
        const g = geometry;
        const count = g.attributes.position.count;
        colour.set(hex).multiplyScalar(gain);
        const colours = new Float32Array(count * 3);
        for (let k = 0; k < count; k++) {
            colours[k * 3] = colour.r;
            colours[k * 3 + 1] = colour.g;
            colours[k * 3 + 2] = colour.b;
        }
        if (shade !== 1) shadeBottom(g, colours, shade);
        g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
        const uv = new Float32Array(count * 2);
        for (let k = 0; k < count; k++) {
            uv[k * 2] = this.emissive ? phase : rough;
            uv[k * 2 + 1] = this.emissive ? 0 : metal;
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        this.parts.push(g);
        return g;
    }

    /** A box centred at (x, y, z), turned by yaw. */
    box(w, h, d, x, y, z, yaw, hex, o) {
        return this.add(place(new THREE.BoxGeometry(w, h, d), x, y, z, yaw), hex, o);
    }

    /** A vertical cylinder standing on y (radius r0 at the bottom, r1 at the top); o.open drops the caps (posts, poles). */
    cylinder(r0, r1, h, x, y, z, hex, o = {}, segments = 8) {
        return this.add(place(new THREE.CylinderGeometry(r1, r0, h, segments, 1, o.open === true), x, y + h / 2, z, 0), hex, o);
    }

    /** A cylinder from point a to point b ({x, y, z}), radius r. */
    rod(a, b, r, hex, o, segments = 6) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-4) return null;
        const g = new THREE.CylinderGeometry(r, r, length, segments, 1, true);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(dx / length, dy / length, dz / length));
        g.applyQuaternion(q);
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        return this.add(g, hex, o);
    }

    get empty() {
        return this.parts.length === 0;
    }

    /** One mesh of everything added (null when empty); the parts are consumed. */
    build(material) {
        if (this.parts.length === 0) return null;
        const mesh = new THREE.Mesh(mergeGeometries(this.parts), material);
        this.parts = [];
        return mesh;
    }

    /**
     * Meshes per square of `cell` metres (by the centre of each part), all with the same material, added to root: the camera's frustum then
     * skips the parts of the district behind it (a chase camera sees about a third of the course). Returns the meshes; the parts are consumed.
     */
    buildChunks(root, material, name, cell = 128) {
        const buckets = new Map();
        for (const g of this.parts) {
            const p = g.attributes.position.array;
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (let k = 0; k < p.length; k += 3) {
                if (p[k] < minX) minX = p[k];
                if (p[k] > maxX) maxX = p[k];
                if (p[k + 2] < minZ) minZ = p[k + 2];
                if (p[k + 2] > maxZ) maxZ = p[k + 2];
            }
            const key = `${Math.floor((minX + maxX) / 2 / cell)},${Math.floor((minZ + maxZ) / 2 / cell)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(g);
        }
        const meshes = [];
        for (const [key, parts] of buckets) {
            const mesh = new THREE.Mesh(mergeGeometries(parts), material);
            mesh.name = `${name}-${key}`;
            root.add(mesh);
            meshes.push(mesh);
        }
        this.parts = [];
        return meshes;
    }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Darkens the lower vertices of a geometry (a cheap contact shadow / grime at the foot of tall props). */
function shadeBottom(geometry, colours, shade) {
    const p = geometry.attributes.position;
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < p.count; k++) {
        min = Math.min(min, p.getY(k));
        max = Math.max(max, p.getY(k));
    }
    const span = Math.max(1e-3, max - min);
    for (let k = 0; k < p.count; k++) {
        const t = (p.getY(k) - min) / span;
        const f = shade + (1 - shade) * Math.min(1, t * 3);
        colours[k * 3] *= f;
        colours[k * 3 + 1] *= f;
        colours[k * 3 + 2] *= f;
    }
}

/** Turns a geometry by yaw around the vertical and moves it to (x, y, z). */
export function place(geometry, x, y, z, yaw = 0) {
    if (yaw) geometry.rotateY(yaw);
    geometry.translate(x, y, z);
    return geometry;
}

/**
 * A local frame on the ground: origin (x, z), local +z = (sin yaw, cos yaw), local +x = (cos yaw, −sin yaw) (three's rotateY convention).
 * p(lx, y, lz) gives the world point of a local one.
 */
export class Frame {
    constructor(x, z, yaw) {
        this.x = x;
        this.z = z;
        this.yaw = yaw;
        this.c = Math.cos(yaw);
        this.s = Math.sin(yaw);
    }

    p(lx, y, lz) {
        return { x: this.x + lx * this.c + lz * this.s, y, z: this.z - lx * this.s + lz * this.c };
    }

    /** A geometry built in local coordinates, moved into the world. */
    put(geometry) {
        geometry.rotateY(this.yaw);
        geometry.translate(this.x, 0, this.z);
        return geometry;
    }

    /** A box in local coordinates (centre lx, y, lz), turned by the frame (plus an extra local yaw). */
    box(batch, w, h, d, lx, y, lz, hex, o, yaw = 0) {
        const g = new THREE.BoxGeometry(w, h, d);
        if (yaw) g.rotateY(yaw);
        g.translate(lx, y, lz);
        return batch.add(this.put(g), hex, o);
    }

    /** A vertical cylinder in local coordinates standing on y. */
    cylinder(batch, r0, r1, h, lx, y, lz, hex, o, segments = 8) {
        const p = this.p(lx, y, lz);
        return batch.cylinder(r0, r1, h, p.x, p.y, p.z, hex, o, segments);
    }

    /** A rod between two local points. */
    rod(batch, a, b, r, hex, o, segments = 6) {
        return batch.rod(this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), r, hex, o, segments);
    }
}

/**
 * A flat strip along the course between s0 and s1 (metres) and the lateral offsets from..to (> 0 left), at height y; UVs in metres (x/z).
 * Samples every `step` metres (curves follow the course).
 */
export function courseStrip(course, s0, s1, from, to, y, step = 2) {
    const positions = [];
    const indices = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    const p = {};
    for (let i = 0; i <= n; i++) {
        course.at(s0 + ((s1 - s0) * i) / n, p);
        const lx = p.tz;
        const lz = -p.tx;
        positions.push(p.x + lx * to, y, p.z + lz * to, p.x + lx * from, y, p.z + lz * from);
        if (i < n) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** A flat rectangle on the ground (or at height y) centred at (x, z), size along its local x (w) and z (d), turned by yaw; normal up. */
export function groundQuad(w, d, x, y, z, yaw = 0) {
    return place(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), x, y, z, yaw);
}

/** World-space x/z UVs in metres for flat geometry (the convention of render/textures.js). */
export function planarUVs(geometry, scale = 1) {
    const p = geometry.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let k = 0; k < p.count; k++) {
        uv[k * 2] = p.getX(k) * scale;
        uv[k * 2 + 1] = -p.getZ(k) * scale;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geometry;
}

const PROPS_VERTEX_PARS = /* glsl */ `
    varying vec2 vPropPbr;`;
const PROPS_VERTEX = /* glsl */ `
    vPropPbr = uv;`;
const PROPS_FRAGMENT_PARS = /* glsl */ `
    varying vec2 vPropPbr;`;

/**
 * The material of the props batch: MeshStandard with vertex colours and the roughness/metalness of every vertex (medium/high), Lambert on low.
 * Owned by the world (disposeTree frees it).
 */
export function propsMaterial(quality, { side = THREE.FrontSide, polygonOffset = 0 } = {}) {
    const offset = polygonOffset ? { polygonOffset: true, polygonOffsetFactor: -polygonOffset, polygonOffsetUnits: -polygonOffset } : {};
    if (quality === 'low') return new THREE.MeshLambertMaterial({ vertexColors: true, side, ...offset });
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, side, ...offset });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${PROPS_VERTEX_PARS}`)
            .replace('#include <uv_vertex>', `#include <uv_vertex>\n${PROPS_VERTEX}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${PROPS_FRAGMENT_PARS}`)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPropPbr.x;')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPropPbr.y;');
    };
    material.customProgramCacheKey = () => 'city-props';
    return material;
}

const SIGNAL_VERTEX_PARS = /* glsl */ `
    varying float vSignalPhase;`;
const SIGNAL_VERTEX = /* glsl */ `
    vSignalPhase = uv.x;`;
const SIGNAL_FRAGMENT_PARS = /* glsl */ `
    uniform vec3 signalCar;   // green, amber, red (1 = on)
    uniform vec2 signalWalk;  // walk, stop
    varying float vSignalPhase;`;
// lenses of a phase that is off keep a dark glass tint; everything without a phase (uv.x < 0) always glows
const SIGNAL_FRAGMENT = /* glsl */ `
    if (vSignalPhase > -0.5) {
        float on = vSignalPhase < 0.5 ? signalCar.x : vSignalPhase < 1.5 ? signalCar.y : vSignalPhase < 2.5 ? signalCar.z
                 : vSignalPhase < 3.5 ? signalWalk.x : signalWalk.y;
        diffuseColor.rgb *= mix(0.012, 1.0, on);
    }`;

/**
 * The material of the emissive batch: unlit, the vertex colour is the linear HDR radiance (lamp heads 10–14, lenses 6–8, tubes 5–8).
 * Traffic-light lenses (phase ≥ 0) follow the uniforms signalCar / signalWalk (userData.signals). Owned by the world.
 */
export function emissiveMaterial() {
    const signals = { signalCar: { value: new THREE.Vector3(1, 0, 0) }, signalWalk: { value: new THREE.Vector2(0, 1) } };
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    material.userData.signals = signals;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, signals);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${SIGNAL_VERTEX_PARS}`)
            .replace('#include <uv_vertex>', `#include <uv_vertex>\n${SIGNAL_VERTEX}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${SIGNAL_FRAGMENT_PARS}`)
            .replace('#include <color_fragment>', `#include <color_fragment>\n${SIGNAL_FRAGMENT}`);
    };
    material.customProgramCacheKey = () => 'city-emissive';
    return material;
}

/** A small seeded helper: pick an element of a list. */
export function pick(random, list) {
    return list[Math.floor(random() * list.length) % list.length];
}
