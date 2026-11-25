// DriftKing · maps/harbor-containers.js – ISO containers for the harbour (Kaikō-Docks): 40 ft (12.19 m) and 20 ft (6.06 m) × 2.44 × 2.59 m boxes
// with corrugated sides (the corrugated texture), a steel frame (corner posts, rails, castings), door ends with locking bars and handles,
// invented shipping lines (names, emblems, owner codes – painted through harbor-decals.js), faded and dirty paint, stacked in blocks.
// All containers of the map are instanced: one material, per area chunk (frustum culling) × length × level of detail one InstancedMesh.
// Every container gets its own rust/grime pattern by a rib-aligned shift of the texture (from its position, in the vertex shader).

import * as THREE from 'three';
import { slab, pickWeighted } from './harbor-parts.js';
import { fitText, wear } from './harbor-decals.js';
import { mergeGeometries } from '../../render/kit.js';

/** ISO sizes in metres. */
export const BOX = Object.freeze({ l40: 12.192, l20: 6.058, w: 2.438, h: 2.591 });
/** Vertical pitch of a stack (a container plus the gap of the castings). */
export const TIER = BOX.h + 0.012;

/**
 * The shipping lines (invented): name, owner code (4 letters ending in U), paint, ink and emblem; weight = share of the yard.
 * Lines without a name are lessors' boxes (plain paint, only the code).
 */
export const LINES = [
    { key: 'aonami', name: 'AONAMI', code: 'AOQU', colour: 0x1f4b87, ink: '#eef2f6', emblem: 'wave', weight: 16 },
    { key: 'kaiko', name: 'KAIKŌ LINE', code: 'KQLU', colour: 0x7c2620, ink: '#f3ede4', emblem: 'ring', weight: 14 },
    { key: 'tora', name: 'TORAMARU', code: 'TZMU', colour: 0xc05a1a, ink: '#ffffff', emblem: 'diamond', weight: 9 },
    { key: 'hokusei', name: 'HOKUSEI', code: 'HXSU', colour: 0x2a5c43, ink: '#eef0ea', emblem: 'star', weight: 10 },
    { key: 'isora', name: 'ISORA', code: 'IZRU', colour: 0x878d94, ink: '#1d3558', emblem: 'crescent', weight: 8 },
    { key: 'umiboshi', name: 'UMIBOSHI', code: 'UQBU', colour: 0xd8d4c8, ink: '#b3302a', emblem: 'starfish', weight: 7 },
    { key: 'beige', name: null, code: 'DKZU', colour: 0xb8ab8e, ink: '#1c1c1c', weight: 8 },
    { key: 'grey', name: null, code: 'NQRU', colour: 0x9a9ea3, ink: '#1c1c1c', weight: 6 },
    { key: 'dark', name: null, code: 'TQXU', colour: 0x474c54, ink: '#e8e8e8', weight: 5 },
    { key: 'teal', name: null, code: 'GZWU', colour: 0x2a666a, ink: '#f0f0f0', weight: 5 },
    { key: 'brown', name: null, code: 'BQKU', colour: 0x6c3a25, ink: '#f0f0f0', weight: 6 },
    { key: 'yellow', name: null, code: 'YXQU', colour: 0xbf9b35, ink: '#1c1c1c', weight: 3 },
    { key: 'sky', name: null, code: 'SZQU', colour: 0x56829f, ink: '#f4f4f4', weight: 3 },
];

const INSET = 0.03;
const POST = 0.15;

/** Which level of detail a container gets, by quality and distance to the course (m). */
export function containerLod(quality, distance) {
    if (quality === 'low') return distance < 26 ? 'lite' : 'box';
    const high = quality === 'high';
    if (distance < (high ? 42 : 26)) return 'full';
    return distance < (high ? 75 : 50) ? 'mid' : 'box';
}

/** The containers of the map: add() them, then build(root). */
export class ContainerYard {
    /**
     * @param {object} ctx the map context (quality, textures)
     * @param {import('./harbor-decals.js').Decals} decals the painted marks (names, codes)
     */
    constructor(ctx, decals) {
        this.ctx = ctx;
        this.decals = decals;
        this.lists = new Map();
        this.count = 0;
        defineLiveries(decals);
    }

    /**
     * One container.
     * @param {{ x: number, y: number, z: number, yaw?: number, size?: 40|20, line: object, colour?: THREE.Color, lod?: string, chunk?: string, marks?: boolean }} c
     *        yaw 0: doors towards +x, π: towards −x; marks: paint names and codes (default true)
     */
    add({ x, y, z, yaw = 0, size = 40, line, colour = null, lod = 'mid', chunk = null, marks = true }) {
        // area chunks for frustum culling: small ones for the detailed boxes near the course, quarters of the yard for the far ones
        const near = lod === 'full' || lod === 'lite';
        const key = `${chunk ?? (near ? chunkOf(x, z) : farChunkOf(x, z))}|${size}|${lod}`;
        let list = this.lists.get(key);
        if (!list) this.lists.set(key, (list = []));
        list.push({ x, y, z, yaw, colour: colour ?? new THREE.Color(line.colour) });
        this.count++;
        if (marks) this.paint({ x, y, z, yaw, size, line, lod, marks });
    }

    /** A colour of the line, faded or dirty a little (deterministic with random). */
    shade(line, random) {
        const c = new THREE.Color(line.colour);
        const hsl = {};
        c.getHSL(hsl);
        // sun-bleached: lighter and greyer; or dirty: darker
        const fade = random();
        const s = hsl.s * (1 - fade * fade * 0.4);
        const l = hsl.l * (0.88 + random() * 0.18) + fade * fade * 0.06;
        return c.setHSL(hsl.h + (random() - 0.5) * 0.012, s, Math.min(0.92, l));
    }

    /**
     * Stacks containers on the yard slots: blocks keep one door direction and often one main line, 20 ft or 40 ft per stack.
     * @param {{ x: number, z: number, stack: number, block: number, distance: number }[]} slots
     * @param {() => number} random a seeded generator (NOT ctx.random – the slots' colliders depend on that sequence)
     */
    stackSlots(slots, random) {
        const blocks = new Map();
        for (const slot of slots) {
            let b = blocks.get(slot.block);
            if (!b) {
                b = { doors: random() < 0.5 ? 0 : Math.PI, main: pickWeighted(LINES, random), share: random() < 0.6 ? 0.55 : 0.15, twenty: random() < 0.3 ? 0.45 : 0.1 };
                blocks.set(slot.block, b);
            }
            // the yard is busier than the colliders say: the visual stacks are a level higher on half the slots (colliders are 2D)
            let height = slot.stack;
            if (height < 4 && random() < 0.5) height++;
            if (slot.distance < 21) height = Math.min(height, 3);
            const lod = containerLod(this.ctx.quality, slot.distance);
            const twenty = random() < b.twenty;
            for (let level = 0; level < height; level++) {
                const y = level * TIER;
                const jitter = () => (random() - 0.5) * 0.07;
                if (!twenty) {
                    const line = random() < b.share ? b.main : pickWeighted(LINES, random);
                    this.add({ x: slot.x + jitter(), y, z: slot.z + jitter() * 0.6, yaw: b.doors, size: 40, line, colour: this.shade(line, random), lod });
                } else {
                    for (const side of [-1, 1]) {
                        const line = random() < b.share ? b.main : pickWeighted(LINES, random);
                        const x = slot.x + side * (BOX.l20 / 2 + 0.038) + jitter();
                        this.add({ x, y, z: slot.z + jitter() * 0.6, yaw: b.doors, size: 20, line, colour: this.shade(line, random), lod });
                    }
                }
            }
        }
    }

    /** Paints names, emblems and owner codes on the container's sides (and its doors at full detail). */
    paint({ x, y, z, yaw, size, line, lod, marks = true }) {
        const decals = this.decals;
        const length = size === 40 ? BOX.l40 : BOX.l20;
        const dir = Math.cos(yaw) >= 0 ? 1 : -1;
        const face = BOX.w / 2 - INSET + 0.012;
        for (const side of [1, -1]) {
            // seen from outside the side: text runs along +x on the +z side, along −x on the −z side
            const u = { x: side, z: 0 };
            if (line.name && (lod !== 'box' || this.ctx.quality !== 'low' || marks === 'always')) {
                const w = size === 40 ? 6.4 : 4.1;
                decals.wall(`logo-${line.key}`, { x, y: y + 1.4, z: z + side * face }, u, w, w / 4);
            }
            if (lod === 'full' || (line.name === null && lod === 'mid')) {
                const at = x + side * (length / 2 - 1.05);
                decals.wall(`code-${line.key}-${Math.abs(Math.round(x * 7 + y)) % 2}`, { x: at, y: y + BOX.h - 0.42, z: z + side * face }, u, 1.3, 0.195);
            }
        }
        if (lod !== 'full') return;
        // the door end: the code on the right leaf, the emblem on the left one (behind the locking bars)
        const doorX = x + dir * (length / 2 - 0.004);
        const u = { x: 0, z: -dir };
        decals.wall(`code-${line.key}-${Math.abs(Math.round(z * 5 + y)) % 2}`, { x: doorX, y: y + BOX.h - 0.5, z: z - dir * 0.6 }, u, 0.95, 0.1425);
        if (line.name) decals.wall(`logo-${line.key}`, { x: doorX, y: y + BOX.h - 0.62, z: z + dir * 0.6 }, u, 0.92, 0.23);
    }

    /** Makes the instanced meshes (one per chunk × length × detail, one shared material) and adds them to root. */
    build(root) {
        if (this.count === 0) return;
        const material = containerMaterial(this.ctx);
        const geometries = new Map();
        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Matrix4();
        for (const [key, list] of this.lists) {
            const [, size, lod] = key.split('|');
            const gKey = `${size}|${lod}`;
            if (!geometries.has(gKey)) geometries.set(gKey, containerGeometry(size === '40' ? BOX.l40 : BOX.l20, lod));
            const mesh = new THREE.InstancedMesh(geometries.get(gKey), material, list.length);
            list.forEach((c, k) => {
                matrix.makeTranslation(c.x, c.y, c.z).multiply(rotation.makeRotationY(c.yaw));
                mesh.setMatrixAt(k, matrix);
                mesh.setColorAt(k, c.colour);
            });
            mesh.computeBoundingSphere();
            mesh.name = `Containers ${key}`;
            root.add(mesh);
        }
        // the geometries are shared by several instanced meshes: disposeTree frees a geometry twice harmlessly (dispose is idempotent)
    }
}

/** The quarter of the yard a far container belongs to. */
function farChunkOf(x, z) {
    return `far-${x < 0 ? 'w' : 'e'}${z < 0 ? 'n' : 's'}`;
}

/** The chunk of the yard a position belongs to (frustum culling per ~120 × 120 m). */
function chunkOf(x, z) {
    return `${Math.max(-2, Math.min(2, Math.floor((x + 62) / 124)))}:${z < 0 ? 0 : 1}`;
}

// the u shift per container: a whole number of ribs (1/9 of a texture tile) from a hash of the instance position, so frame parts keep sampling
// a flat strip and each box shows other rust patches and grime streaks
const UV_SHIFT = /* glsl */ `
    vBoxRust = 0.0;
    #ifdef USE_INSTANCING
        vec3 boxAt = instanceMatrix[3].xyz;
        float boxShift = floor(fract(sin(dot(boxAt, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 9.0) / 9.0;
        vBoxRust = fract(sin(dot(boxAt, vec3(7.131, 157.17, 113.73))) * 24634.6345);
        #ifdef USE_MAP
            vMapUv.x += boxShift;
        #endif
        #ifdef USE_NORMALMAP
            vNormalMapUv.x += boxShift;
        #endif
        #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv.x += boxShift;
        #endif
        #ifdef USE_AOMAP
            vAoMapUv.x += boxShift;
        #endif
    #endif`;

// rust only on some boxes (a quarter, by the hash): on the others the rusty texels of the recipe (red well over blue) become clean paint
const RUST_MAP = /* glsl */ `
    #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float rustMask = clamp( ( sampledDiffuseColor.r - sampledDiffuseColor.b ) * 3.5, 0.0, 1.0 );
        float clean = 1.0 - smoothstep( 0.8, 0.92, vBoxRust );
        sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.6 + sampledDiffuseColor.g * 0.1 ), rustMask * clean );
        diffuseColor *= sampledDiffuseColor;
    #endif`;

/** The containers' paint: the corrugated recipe (normal + ORM on medium/high), vertex colours for frame parts, instance colours for the paint. */
function containerMaterial(ctx) {
    const set = ctx.textures.corrugated({ rust: 0.25 });
    const material = ctx.quality === 'low'
        ? new THREE.MeshLambertMaterial({ map: set.map, vertexColors: true })
        : new THREE.MeshStandardMaterial({
            map: set.map,
            normalMap: set.normalMap,
            roughnessMap: set.roughnessMap,
            aoMap: set.aoMap,
            aoMapIntensity: 0.8,
            vertexColors: true,
            roughness: 1,
            metalness: 0,
        });
    material.onBeforeCompile = shader => {
        shader.vertexShader = 'varying float vBoxRust;\n' + shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n${UV_SHIFT}`);
        shader.fragmentShader = 'varying float vBoxRust;\n' + shader.fragmentShader.replace('#include <map_fragment>', RUST_MAP);
    };
    material.customProgramCacheKey = () => 'harbor-container';
    return material;
}

// vertex colours of the parts (multiplied with the paint of the instance)
const PAINT = [1, 1, 1];
const CASTING = [0.36, 0.35, 0.34];
const GAP = [0.1, 0.1, 0.1];
const BAR = [0.9, 0.9, 0.9];
const SEAL = [0.18, 0.18, 0.18];

/**
 * A container in its own frame: length along x (centred), base at y = 0, width along z, the doors at +x.
 * lod 'full' (≈ 125 triangles: locking bars, handles, all castings), 'mid' (≈ 70: frame and castings), 'lite' (≈ 40: posts and top castings,
 * for low), 'box' (10: the painted box).
 */
export function containerGeometry(length, lod) {
    const hl = length / 2;
    const hw = BOX.w / 2;
    const H = BOX.h;
    const parts = [];
    // door panels: ribs run across (u = height), wider than the side corrugation
    const doorUV = (x, y, z) => [y * 0.62, z];
    if (lod === 'box' || lod === 'lite') {
        parts.push(slab(-hl, hl, 0, H, -hw, hw, { faces: '-x+y-z+z', colour: PAINT }));
        parts.push(slab(-hl, hl, 0, H, -hw, hw, { faces: '+x', uv: doorUV, colour: PAINT }));
        if (lod === 'lite') {
            // corner posts a little proud of the box, the top castings dark
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const x0 = sx > 0 ? hl - POST : -hl - 0.01;
                    const z0 = sz > 0 ? hw - POST + 0.01 : -hw - 0.01;
                    const faces = `${sx > 0 ? '+x' : '-x'}${sz > 0 ? '+z' : '-z'}`;
                    parts.push(slab(x0, x0 + POST + 0.01, 0, H - 0.12, z0, z0 + POST, { faces, uv: 'flat', colour: PAINT }));
                    parts.push(slab(x0, x0 + POST + 0.01, H - 0.12, H, z0, z0 + POST, { faces, uv: 'flat', colour: CASTING }));
                }
            }
        }
        return mergeGeometries(parts);
    }
    // the corrugated body: sides inside the frame, roof, front wall
    parts.push(slab(-hl + 0.02, hl - 0.02, 0, H - 0.008, -hw + INSET, hw - INSET, { faces: '-x+y-z+z', colour: PAINT }));
    // the door end: both leaves in one quad (ribs across), the dark gap between them, header and sill
    parts.push(slab(hl - 0.06, hl - 0.012, 0.17, H - 0.16, -hw + POST, hw - POST, { faces: '+x', uv: doorUV, colour: PAINT }));
    parts.push(slab(hl - 0.06, hl - 0.006, 0.17, H - 0.16, -0.012, 0.012, { faces: '+x', colour: GAP }));
    parts.push(slab(hl - 0.1, hl, H - 0.16, H, -hw + POST, hw - POST, { faces: '+x', uv: 'flat', colour: PAINT }));
    parts.push(slab(hl - 0.1, hl, 0, 0.17, -hw + POST, hw - POST, { faces: '+x', uv: 'flat', colour: PAINT }));
    // corner posts (their outer faces; the castings cap them)
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const x0 = sx > 0 ? hl - POST : -hl;
            const z0 = sz > 0 ? hw - POST : -hw;
            const faces = `${sx > 0 ? '+x' : '-x'}${sz > 0 ? '+z' : '-z'}`;
            parts.push(slab(x0, x0 + POST, 0, H, z0, z0 + POST, { faces, uv: 'flat', colour: PAINT }));
        }
    }
    // top and bottom side rails
    for (const sz of [-1, 1]) {
        const z0 = sz > 0 ? hw - 0.05 : -hw;
        const outer = sz > 0 ? '+z' : '-z';
        parts.push(slab(-hl + POST, hl - POST, H - 0.13, H, z0, z0 + 0.05, { faces: lod === 'full' ? `${outer}+y` : outer, uv: 'flat', colour: PAINT }));
        parts.push(slab(-hl + POST, hl - POST, 0, 0.16, z0, z0 + 0.05, { faces: outer, uv: 'flat', colour: PAINT }));
    }
    // corner castings: dark cast steel, a few millimetres proud of the posts
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            for (const top of [false, true]) {
                const x0 = sx > 0 ? hl - 0.178 : -hl - 0.004;
                const z0 = sz > 0 ? hw - 0.162 : -hw - 0.004;
                const y0 = top ? H - 0.118 : 0;
                let faces = `${sx > 0 ? '+x' : '-x'}${sz > 0 ? '+z' : '-z'}`;
                if (top && lod === 'full') faces += '+y';
                parts.push(slab(x0, x0 + 0.182, y0, y0 + 0.118, z0, z0 + 0.166, { faces, uv: 'flat', colour: CASTING }));
            }
        }
    }
    if (lod === 'full') {
        // the front wall's header and sill
        parts.push(slab(-hl, -hl + 0.1, H - 0.14, H, -hw + POST, hw - POST, { faces: '-x', uv: 'flat', colour: PAINT }));
        parts.push(slab(-hl, -hl + 0.1, 0, 0.15, -hw + POST, hw - POST, { faces: '-x', uv: 'flat', colour: PAINT }));
        // four locking bars with their handles (two per leaf), rubber seals along the outer edges of the leaves
        for (const z of [-0.93, -0.36, 0.36, 0.93]) {
            parts.push(slab(hl - 0.012, hl + 0.038, 0.1, H - 0.1, z - 0.022, z + 0.022, { faces: '+x-z+z', uv: 'flat', colour: BAR }));
            const toward = z > 0 ? -1 : 1;
            const z0 = Math.min(z, z + toward * 0.34);
            parts.push(slab(hl + 0.01, hl + 0.06, 1.02, 1.09, z0, z0 + 0.34, { faces: '+x', uv: 'flat', colour: BAR }));
        }
        for (const z of [-hw + POST, hw - POST - 0.025]) parts.push(slab(hl - 0.06, hl - 0.008, 0.17, H - 0.16, z, z + 0.025, { faces: '+x', colour: SEAL }));
    }
    return mergeGeometries(parts);
}

/** Paints the liveries into the decal atlas: each line's name with its emblem, and two owner codes per line. */
function defineLiveries(decals) {
    for (const line of LINES) {
        if (line.name) {
            decals.define(`logo-${line.key}`, 448, 112, (c, w, h) => {
                emblem(c, line.emblem, line.ink, 8, 6, h - 12);
                fitText(c, line.name, h + 8, 0, w - h - 16, h, { colour: line.ink, size: h * 0.62, align: 'left' });
                wear(c, w, h, line.code.charCodeAt(1) * 7, 0.35);
            }, { ink: line.ink });
        }
        for (let k = 0; k < 2; k++) {
            const serial = String(100000 + ((line.code.charCodeAt(0) * 7919 + k * 104729) % 899999)).slice(0, 6);
            const check = (line.code.charCodeAt(2) + k * 3) % 10;
            const text = `${line.code} ${serial} ${check}   ${k ? '22G1' : '45G1'}`;
            decals.define(`code-${line.key}-${k}`, 240, 36, (c, w, h) => {
                fitText(c, text, 2, 0, w - 4, h, { font: '700 {s}px "Arial", sans-serif', colour: line.ink, size: h * 0.8, align: 'left' });
            }, { ink: line.ink });
        }
    }
}

/** Draws an invented emblem into the square (x, y, size). */
function emblem(c, kind, colour, x, y, size) {
    c.save();
    c.translate(x + size / 2, y + size / 2);
    const r = size / 2;
    c.fillStyle = colour;
    c.strokeStyle = colour;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (kind === 'wave') {
        c.lineWidth = r * 0.17;
        for (let k = 0; k < 3; k++) {
            const yy = (k - 1) * r * 0.48;
            c.beginPath();
            c.moveTo(-r * 0.9, yy + r * 0.12);
            c.bezierCurveTo(-r * 0.45, yy - r * 0.38, -r * 0.05, yy + r * 0.42, r * 0.35, yy - r * 0.05);
            c.quadraticCurveTo(r * 0.62, yy - r * 0.3, r * 0.9, yy - r * 0.12);
            c.stroke();
        }
    } else if (kind === 'ring') {
        c.lineWidth = r * 0.18;
        c.beginPath();
        c.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        c.stroke();
        c.fillRect(-r * 0.95, -r * 0.1, r * 1.9, r * 0.2);
        c.beginPath();
        c.arc(0, 0, r * 0.28, 0, Math.PI * 2);
        c.fill();
    } else if (kind === 'diamond') {
        c.beginPath();
        c.moveTo(0, -r * 0.95);
        c.lineTo(r * 0.95, 0);
        c.lineTo(0, r * 0.95);
        c.lineTo(-r * 0.95, 0);
        c.closePath();
        c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.lineWidth = r * 0.14;
        for (const o of [-0.4, 0, 0.4]) {
            c.beginPath();
            c.moveTo(-r + o * r, -r * 0.2 + o * r);
            c.lineTo(r * 0.2 + o * r, r * 0.7 + o * r);
            c.stroke();
        }
    } else if (kind === 'star' || kind === 'starfish') {
        const inner = kind === 'star' ? 0.4 : 0.36;
        c.beginPath();
        for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + (k * Math.PI) / 5;
            const rr = k % 2 ? r * inner : r * 0.95;
            if (kind === 'starfish' && k % 2 === 0) c.quadraticCurveTo(Math.cos(a - 0.2) * rr * 1.05, Math.sin(a - 0.2) * rr * 1.05, Math.cos(a) * rr, Math.sin(a) * rr);
            else if (k === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath();
        c.fill();
    } else if (kind === 'crescent') {
        c.beginPath();
        c.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath();
        c.arc(r * 0.38, -r * 0.2, r * 0.72, 0, Math.PI * 2);
        c.fill();
    }
    c.restore();
}
