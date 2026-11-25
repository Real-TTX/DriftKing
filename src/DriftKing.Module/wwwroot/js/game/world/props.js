// DriftKing · world/props.js – the set pieces the maps share: buildings with lit windows (merged), neon signs from two atlases,
// street lamps (instanced, with glow and light pool), forest trees, parked cars, a distant skyline. Everything low-poly and batched.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, mergeGeometries, rng, tint } from '../render/kit.js';

export const NEON_COLOURS = [0xff2e88, 0x29e7ff, 0x8b5cf6, 0xffb020, 0x3ef08a, 0xff4040, 0xff7af0, 0x7affd7];

/** The facade texture: 8 × 8 windows, some lit warm or cool, dark frames between them (texel 0,0 is frame: roofs use it). */
export function windowTexture(seed = 11, lit = 0.36) {
    const random = rng(seed);
    return canvasTexture(256, 256, ctx => {
        ctx.fillStyle = '#121119';
        ctx.fillRect(0, 0, 256, 256);
        for (let gx = 0; gx < 8; gx++) {
            for (let gy = 0; gy < 8; gy++) {
                const r = random();
                let colour = '#1b1d2b';
                if (r < lit * 0.6) colour = ['#ffd58a', '#ffc36b', '#ffe2b0'][Math.floor(random() * 3)];
                else if (r < lit) colour = ['#bfe0ff', '#9fd0ff', '#d8b8ff'][Math.floor(random() * 3)];
                ctx.fillStyle = colour;
                ctx.fillRect(gx * 32 + 6, gy * 32 + 5, 20, 22);
                if (colour !== '#1b1d2b' && random() < 0.4) {
                    // a blind half down
                    ctx.fillStyle = 'rgba(30,20,40,0.55)';
                    ctx.fillRect(gx * 32 + 6, gy * 32 + 5, 20, 8 + random() * 8);
                }
            }
        }
    }, { repeat: true });
}

/** A building box with window UVs: one window every 3 m across, every 3 m up; the roof samples the frame colour. */
export function buildingGeometry(w, h, d, x, y, z, rot = 0, random = Math.random) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const ou = Math.floor(random() * 8) / 8;
    const ov = Math.floor(random() * 8) / 8;
    const faces = [d, d, 0, 0, w, w];
    for (let f = 0; f < 6; f++) {
        for (let v = 0; v < 4; v++) {
            const i = f * 4 + v;
            if (faces[f] === 0) {
                uv.setXY(i, 0.004, 0.004);
            } else {
                uv.setXY(i, ou + (uv.getX(i) * faces[f]) / 24, ov + (uv.getY(i) * h) / 24);
            }
        }
    }
    if (rot) g.rotateY(rot);
    g.translate(x, y + h / 2, z);
    return g;
}

/** One mesh of many building geometries with the window texture (lit windows glow through the emissive map). */
export function buildingMesh(geometries, texture, { colour = 0x8a88a0, glow = 1 } = {}) {
    const material = new THREE.MeshLambertMaterial({ color: colour, map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: glow });
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.receiveShadow = true;
    return mesh;
}

const SIGN_WORDS = ['RAMEN', 'BAR 24', 'KARAOKE', 'GARAGE', 'HOTEL', 'SUSHI', 'ARCADE', 'TUNING'];

/** The two sign atlases: wide signs (4 rows of 4:1 words) and tall signs (4 columns of glyph stacks). */
export function signAtlases(seed = 5) {
    const random = rng(seed);
    const colour = k => '#' + NEON_COLOURS[k % NEON_COLOURS.length].toString(16).padStart(6, '0');
    const wide = canvasTexture(512, 512, ctx => {
        for (let row = 0; row < 4; row++) {
            const c = colour(row * 3 + 1);
            const y = row * 128;
            panel(ctx, 6, y + 8, 500, 112);
            ctx.strokeStyle = c;
            ctx.lineWidth = 4;
            ctx.shadowColor = c;
            ctx.shadowBlur = 14;
            roundRect(ctx, 14, y + 16, 484, 96, 14);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 64px Anton, Impact, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(SIGN_WORDS[(row * 2 + Math.floor(random() * 2)) % SIGN_WORDS.length], 256, y + 66);
            ctx.shadowBlur = 0;
        }
    });
    const tall = canvasTexture(512, 512, ctx => {
        for (let col = 0; col < 4; col++) {
            const c = colour(col * 2);
            const x = col * 128;
            panel(ctx, x + 8, 6, 112, 500);
            ctx.strokeStyle = c;
            ctx.shadowColor = c;
            ctx.shadowBlur = 12;
            ctx.lineWidth = 4;
            roundRect(ctx, x + 14, 12, 100, 488, 12);
            ctx.stroke();
            ctx.lineWidth = 9;
            ctx.strokeStyle = '#ffffff';
            for (let k = 0; k < 5; k++) drawGlyph(ctx, random, x + 30, 30 + k * 92, 68);
            ctx.shadowBlur = 0;
        }
    });
    return { wide, tall };
}

function panel(ctx, x, y, w, h) {
    ctx.fillStyle = '#0d0b16';
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Collects neon signs and builds them as two meshes (one per atlas).
 * add(kind 'wide'|'tall', cell 0..3, centre x/y/z, size w × h, yaw of its face) – the colour of the cell is NEON_COLOURS of the atlas.
 */
export class Signs {
    constructor(glows) {
        this.glows = glows;
        this.lists = { wide: [], tall: [] };
    }

    add(kind, cell, x, y, z, w, h, yaw) {
        const g = new THREE.PlaneGeometry(w, h);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            if (kind === 'wide') uv.setXY(i, uv.getX(i), (3 - cell + uv.getY(i)) / 4);
            else uv.setXY(i, (cell + uv.getX(i)) / 4, uv.getY(i));
        }
        g.rotateY(yaw);
        g.translate(x, y, z);
        this.lists[kind].push(g);
        const colour = NEON_COLOURS[(kind === 'wide' ? cell * 3 + 1 : cell * 2) % NEON_COLOURS.length];
        const fx = Math.sin(yaw) * 0.6;
        const fz = Math.cos(yaw) * 0.6;
        this.glows?.add(x + fx, y, z + fz, Math.max(w, h) * 1.4, colour);
    }

    build(root, atlases) {
        for (const kind of ['wide', 'tall']) {
            if (this.lists[kind].length === 0) continue;
            const material = new THREE.MeshBasicMaterial({ map: atlases[kind], side: THREE.DoubleSide, fog: true });
            root.add(new THREE.Mesh(mergeGeometries(this.lists[kind]), material));
        }
    }
}

/**
 * Street lamps at spots [{ x, y, z, yaw }] (yaw = the direction the arm reaches): pole + arm instanced, a lit head, a glow and a light pool below.
 */
export function buildLamps(root, spots, glows, pools, { colour = 0xffd9a0, height = 8, arm = 2.2, pool = 9, strength = 0.55 } = {}) {
    if (spots.length === 0) return;
    const pole = tint(new THREE.CylinderGeometry(0.09, 0.14, height, 6).translate(0, height / 2, 0), 0x3a3946);
    const reach = tint(new THREE.BoxGeometry(0.1, 0.1, arm).translate(0, height - 0.05, arm / 2), 0x3a3946);
    const geometry = mergeGeometries([pole, reach]);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.7).translate(0, height - 0.16, arm - 0.2);
    const poles = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const heads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: colour }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, k) => {
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(up, s.yaw), new THREE.Vector3(1, 1, 1));
        poles.setMatrixAt(k, m);
        heads.setMatrixAt(k, m);
        const hx = s.x + Math.sin(s.yaw) * (arm - 0.2);
        const hz = s.z + Math.cos(s.yaw) * (arm - 0.2);
        glows.add(hx, s.y + height - 0.3, hz, 3.2, colour);
        pools.add(hx, s.y, hz, pool, colour, strength);
    });
    poles.computeBoundingSphere();
    heads.computeBoundingSphere();
    root.add(poles, heads);
}

/** Low-poly conifers at spots [{ x, y, z, s }] (s = scale), one InstancedMesh with colour variation. */
export function buildTrees(root, spots, random) {
    if (spots.length === 0) return;
    const trunk = tint(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5).translate(0, 0.8, 0), 0x4a3426);
    const low = tint(new THREE.ConeGeometry(2.1, 3.6, 6).translate(0, 2.9, 0), 0x2e5a3c);
    const high = tint(new THREE.ConeGeometry(1.5, 3.0, 6).translate(0, 4.9, 0), 0x376b46);
    const geometry = mergeGeometries([trunk, low, high]);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    spots.forEach((p, k) => {
        m.compose(new THREE.Vector3(p.x, p.y - 0.2, p.z), q.setFromAxisAngle(up, random() * 6.28), new THREE.Vector3(p.s, p.s * (0.85 + random() * 0.4), p.s));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c.setHSL(0.36 + random() * 0.08, 0.35, 0.32 + random() * 0.22));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    root.add(mesh);
}

/** Parked cars (generic low boxes, never a real model) at spots [{ x, y, z, yaw }]; returns nothing – colliders are the map's business. */
export function buildParkedCars(root, spots, random) {
    if (spots.length === 0) return;
    const body = tint(new THREE.BoxGeometry(1.76, 0.62, 4.2).translate(0, 0.56, 0), 0xffffff);
    const cabin = tint(new THREE.BoxGeometry(1.5, 0.5, 2.1).translate(0, 1.1, -0.2), 0x9aa0b4);
    const glass = tint(new THREE.BoxGeometry(1.52, 0.36, 2.0).translate(0, 1.12, -0.2), 0x161a26);
    const wheels = [];
    for (const x of [-0.8, 0.8]) {
        for (const z of [-1.3, 1.3]) wheels.push(tint(new THREE.BoxGeometry(0.26, 0.6, 0.6).translate(x, 0.3, z), 0x0d0d10));
    }
    const geometry = mergeGeometries([body, cabin, glass, ...wheels]);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const colours = [0xd8d8e0, 0x23232c, 0x8a1a2a, 0x2a4d8a, 0x9aa0aa, 0xe0c060, 0x1f5a44];
    const c = new THREE.Color();
    spots.forEach((p, k) => {
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c.setHex(colours[Math.floor(random() * colours.length)]));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    root.add(mesh);
}

/**
 * A distant skyline: towers in a ring between inner and outer radius around (cx, cz) on ground y, with lit windows and red aviation lights.
 */
export function buildSkyline(root, glows, { cx = 0, cz = 0, y = 0, inner = 300, outer = 520, count = 90, seed = 21, maxHeight = 150, texture }) {
    const random = rng(seed);
    const geometries = [];
    for (let k = 0; k < count; k++) {
        const a = random() * Math.PI * 2;
        const r = inner + random() * (outer - inner);
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const w = 14 + random() * 26;
        const d = 14 + random() * 26;
        const h = 20 + Math.pow(random(), 1.6) * maxHeight;
        geometries.push(buildingGeometry(w, h, d, x, y, z, random() * Math.PI, random));
        if (h > maxHeight * 0.45 && random() < 0.6) glows.add(x, y + h + 1.5, z, 5, 0xff3030);
    }
    root.add(buildingMesh(geometries, texture, { colour: 0x6c6a86, glow: 1.15 }));
}
