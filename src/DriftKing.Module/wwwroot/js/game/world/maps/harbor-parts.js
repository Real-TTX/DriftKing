// DriftKing · maps/harbor-parts.js – small modelling helpers of the harbour map (Kaikō-Docks): boxes with only the faces that can be seen,
// metric UVs (the convention of render/textures.js), prisms and tubes between two points, extruded profiles, and a batch that merges
// everything per material (one draw call per material). Pure geometry: materials come from ctx.materials or the harbour modules.

import * as THREE from 'three';
import { mergeGeometries } from '../../render/kit.js';
import { kelvinHex } from '../../render/lights.js';

/** The frame of the harbour map: the fenced yard (x, z), the quay edge (z, colliders there) and the water level. */
export const HARBOR = Object.freeze({ minX: -185, maxX: 185, minZ: -125, quayZ: 118, waterY: -2.6 });

/** High-pressure sodium (masts, wall packs) and LED (cranes) light colours. */
export const SODIUM = kelvinHex(2100);
export const LED = kelvinHex(4300);

const palettes = new WeakMap();

/**
 * The materials of the whole harbour, asked once per factory: every module paints with these, so the shared batch makes one draw call per
 * entry (the factories cache them; they are shared – never change them).
 * @param {object} materials ctx.materials
 */
export function harborPalette(materials) {
    let p = palettes.get(materials);
    if (p) return p;
    p = {
        concrete: materials.concrete({ color: 0xb8b4aa }),
        apron: materials.concrete({ color: 0xbcb8b0, seams: true, wet: 0.35 }),
        roofs: materials.concrete({ color: 0x6c6a66, seams: false, stains: false }),
        zinc: materials.metal({ color: 0xa6aab0, roughness: 0.45 }),
        steel: materials.metal({ color: 0x8e9399, roughness: 0.42 }),
        rail: materials.metal({ color: 0xb8bcc2, roughness: 0.28 }),
        dark: materials.painted({ color: 0x2a2d32, roughness: 0.55 }),
        black: materials.painted({ color: 0x141518, roughness: 0.7 }),
        glass: materials.painted({ color: 0x0c1117, roughness: 0.06 }),
        white: materials.painted({ color: 0xd6d6d0, roughness: 0.45 }),
        cream: materials.painted({ color: 0xb4b2aa, roughness: 0.55 }),
        yellow: materials.painted({ color: 0xd2a124, roughness: 0.5 }),
        red: materials.painted({ color: 0xbe4722, roughness: 0.5 }),
        grey: materials.painted({ color: 0x7c828a, roughness: 0.5 }),
        algae: materials.painted({ color: 0x1e241c, roughness: 0.3 }),
        blue: materials.painted({ color: 0x1f4b87, roughness: 0.5 }),
        rubber: materials.rubber({ color: 0x18181a }),
        rope: materials.plastic({ color: 0xc9c0ac, roughness: 0.85 }),
        gravel: materials.ground({ kind: 'gravel', color: 0x5e5c56 }),
        cladding: [materials.corrugated({ color: 0x8e98a2, rust: 0.25 }), materials.corrugated({ color: 0xb3ab98, rust: 0.25 })],
        doors: [materials.corrugated({ color: 0x3d6aa0, rust: 0.3 }), materials.corrugated({ color: 0xc39a2c, rust: 0.3 })],
        roof: materials.corrugated({ color: 0x6a6e72, rust: 0.7 }),
        facade: materials.facade({ lit: 0.4, glow: 1.5, color: 0xcfcbc3, seed: 131 }),
        sodium: materials.emissive(SODIUM, 12),
        led: materials.emissive(LED, 12),
        warm: materials.emissive(kelvinHex(3300), 1.6),
        strip: materials.emissive(kelvinHex(4200), 1.1),
        redLight: materials.emissive(0xff2a1a, 9),
        greenLight: materials.emissive(0x30ff70, 8),
        whiteLight: materials.emissive(0xfff4e0, 10),
    };
    palettes.set(materials, p);
    return p;
}

const FACES = ['-x', '+x', '-y', '+y', '-z', '+z'];

/**
 * An axis-aligned box between (x0, y0, z0) and (x1, y1, z1) with only the listed faces ('-x+x+y-z+z' …; default all but the bottom).
 * UVs in metres (floors: u = x, v = −z; walls: along the wall and up), or uv: 'flat' (u fixed at flatU, v = y: frame parts that should sample
 * one flat strip of a ribbed texture), or a function (x, y, z, face) → [u, v]. colour: vertex colour (hex or [r, g, b] linear) for vertexColors materials.
 * @returns {THREE.BufferGeometry} indexed, with position, normal, uv (and color when given)
 */
export function slab(x0, x1, y0, y1, z0, z1, { faces = '-x+x+y-z+z', uv = 'metric', flatU = 0.05, colour = null } = {}) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const quad = (corners, n, face) => {
        const base = positions.length / 3;
        for (const [x, y, z] of corners) {
            positions.push(x, y, z);
            normals.push(n[0], n[1], n[2]);
            uvs.push(...faceUV(x, y, z, face, uv, flatU));
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const face of FACES) {
        if (!faces.includes(face)) continue;
        if (face === '+x') quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], face);
        if (face === '-x') quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], face);
        if (face === '+y') quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], face);
        if (face === '-y') quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], face);
        if (face === '+z') quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], face);
        if (face === '-z') quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], face);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    if (colour !== null) paint(geometry, colour);
    return geometry;
}

function faceUV(x, y, z, face, mode, flatU) {
    if (typeof mode === 'function') return mode(x, y, z, face);
    if (mode === 'flat') return [flatU, y];
    if (face === '+y' || face === '-y') return [x, -z];
    if (face === '+x') return [-z, y];
    if (face === '-x') return [z, y];
    if (face === '+z') return [x, y];
    return [-x, y];
}

/** A centred box (size w × h × d, centre x/y/z) with metric UVs; faces as in slab (default all six). */
export function block(w, h, d, x, y, z, { faces = '-x+x-y+y-z+z', uv = 'metric', colour = null } = {}) {
    return slab(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, { faces, uv, colour });
}

/** Sets one vertex colour on the whole geometry (hex sRGB, or [r, g, b] already linear). Returns the geometry. */
export function paint(geometry, colour) {
    const c = Array.isArray(colour) ? new THREE.Color(colour[0], colour[1], colour[2]) : new THREE.Color(colour);
    const count = geometry.attributes.position.count;
    const array = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
        array[k * 3] = c.r;
        array[k * 3 + 1] = c.g;
        array[k * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
    return geometry;
}

const up = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * A prism (n sides, radius r; n = 4 a square bar) from point a to point b – struts, stays, cables, pipes, mooring lines.
 * open: no end caps. UVs: u around (metres), v along (metres).
 */
export function tube(a, b, r, { sides = 6, open = true, r2 = r } = {}) {
    tmpA.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const length = tmpA.length();
    const geometry = new THREE.CylinderGeometry(r2, r, length, sides, 1, open);
    // metric uvs: u around the circumference, v along the axis
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * length);
    geometry.translate(0, length / 2, 0);
    tmpQ.setFromUnitVectors(up, tmpA.normalize());
    geometry.applyQuaternion(tmpQ);
    geometry.translate(a.x, a.y, a.z);
    return geometry;
}

/** A sagging line (catenary-ish parabola) from a to b with sag metres at the middle, as a chain of thin tubes. */
export function rope(a, b, r, sag, { segments = 8, sides = 4 } = {}) {
    const parts = [];
    let last = { x: a.x, y: a.y, z: a.z };
    for (let k = 1; k <= segments; k++) {
        const t = k / segments;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), z: a.z + (b.z - a.z) * t };
        parts.push(tube(last, p, r, { sides }));
        last = p;
    }
    return mergeGeometries(parts);
}

/**
 * Extrudes a closed 2D profile [[u, y], …] (u across, counter-clockwise seen from +along) along a straight line from (ax, az) to (bx, bz)
 * on the ground (y added to the profile's y). No end caps unless caps = true. UVs: u along the line (metres), v around the profile (metres).
 */
export function extrude(profile, ax, az, bx, bz, { y = 0, caps = true } = {}) {
    const length = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / length;
    const dz = (bz - az) / length;
    // across = the left normal of the direction (dz, −dx)… with u > 0 to the left
    const lx = dz;
    const lz = -dx;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let around = 0;
    const n = profile.length;
    for (let k = 0; k < n; k++) {
        const [u0, y0] = profile[k];
        const [u1, y1] = profile[(k + 1) % n];
        const edge = Math.hypot(u1 - u0, y1 - y0);
        // outward normal of the edge in the profile plane (profile counter-clockwise: the outside is to the right of the edge)
        const nu = (y1 - y0) / edge;
        const ny = -(u1 - u0) / edge;
        const base = positions.length / 3;
        const corners = [[u0, y0, 0], [u1, y1, 0], [u1, y1, length], [u0, y0, length]];
        for (const [u, yy, s] of corners) {
            positions.push(ax + dx * s + lx * u, y + yy, az + dz * s + lz * u);
            normals.push(lx * nu, ny, lz * nu);
        }
        uvs.push(0, around, 0, around + edge, length, around + edge, length, around);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        around += edge;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    if (!caps) return geometry;
    const shape = new THREE.Shape(profile.map(([u, yy]) => new THREE.Vector2(u, yy)));
    const capGeometry = new THREE.ShapeGeometry(shape);
    const ends = [];
    for (const [s, flip] of [[0, true], [length, false]]) {
        const cap = capGeometry.clone();
        // shape x = across (u), y = up, its +z normal = the direction: the end cap faces forward, the start cap (normal and winding flipped) back
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(lx, 0, lz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz));
        if (flip) cap.scale(1, 1, -1).index.array.reverse();
        cap.applyMatrix4(m);
        cap.translate(ax + dx * s, y, az + dz * s);
        cap.deleteAttribute('uv');
        ends.push(cap);
    }
    capGeometry.dispose();
    return mergeGeometries([geometry, ...ends]);
}

/** Turns a geometry around the vertical through (cx, cz) by yaw (radians) – normals follow. Returns the geometry. */
export function turn(geometry, yaw, cx = 0, cz = 0) {
    geometry.translate(-cx, 0, -cz);
    geometry.rotateY(yaw);
    geometry.translate(cx, 0, cz);
    return geometry;
}

/**
 * Collects geometries per material and merges each group into one mesh (one draw call per material).
 * batch.add(material, geometry…); batch.build(root) – the material may be a factory material (shared) or the map's own.
 */
export class Batch {
    constructor() {
        this.groups = new Map();
    }

    /** Adds geometries drawn with material. */
    add(material, ...geometries) {
        let list = this.groups.get(material);
        if (!list) this.groups.set(material, (list = []));
        for (const g of geometries) if (g) list.push(g);
        return this;
    }

    /** Merges and adds the meshes to root; returns them. */
    build(root, { name = '', castShadow = false, receiveShadow = false, renderOrder = 0 } = {}) {
        const meshes = [];
        for (const [material, list] of this.groups) {
            if (list.length === 0) continue;
            const mesh = new THREE.Mesh(list.length === 1 && list[0].index && list[0].attributes.uv ? list[0] : mergeGeometries(list), material);
            mesh.name = name;
            mesh.castShadow = castShadow;
            mesh.receiveShadow = receiveShadow;
            mesh.renderOrder = renderOrder;
            root.add(mesh);
            meshes.push(mesh);
        }
        this.groups.clear();
        return meshes;
    }
}

/** A seeded pick from a weighted list [{ weight, … }]. */
export function pickWeighted(list, random) {
    let total = 0;
    for (const item of list) total += item.weight;
    let r = random() * total;
    for (const item of list) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return list[list.length - 1];
}
