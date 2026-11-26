// DriftKing · maps/pass-forest.js – the forest of the Tenjō-Pass: rows of tall cedars close along both sides of the road (on the fill
// slopes below the guardrail their crowns stand level with the road, on the mountain side they rise above the cut), a looser forest over
// the hills further out, none on the plain; bamboo grass and ferns along the foot of the trees, hanging over the top of the walls.
// The trees are world/props-trees.js (bark, needle cards near the road, silhouettes far away), built per patch of the map so the
// camera only draws the patches in view. Everything placed with fixed seeds.

import * as THREE from 'three';
import { mergeGeometries, rng } from '../../render/kit.js';
import { buildTrees } from '../props.js';
import { foliageShading } from '../props-trees.js';
import { TERRAIN, ownSurface } from './pass-layout.js';

/** Patches of the forest (each one buildTrees call: frustum culling per patch). */
const PATCH = 160;

/**
 * Plants the forest and the undergrowth.
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 * @param {{ clearings?: { s0: number, s1: number, sign: number, depth: number }[], views?: { x: number, z: number, nx: number, nz: number, length: number, half: number }[] }} [options]
 *        clearings: stretches of a side kept free up to depth metres from the centre line (the lay-by);
 *        views: cones kept free of tall trees (from x/z along the direction nx/nz, length long, half wide at the start, widening)
 */
export function buildForest(ctx, layout, { clearings = [], views = [] } = {}) {
    const { root, course, detail, quality } = ctx;
    const random = rng(2024);
    const spots = [];
    const cleared = (i, sign, d) => clearings.some(c => c.sign === sign && inRange(i * course.step, c.s0, c.s1, course.length) && d < c.depth);
    const inView = (x, z) => views.some(v => {
        const a = (x - v.x) * v.nx + (z - v.z) * v.nz;
        const b = Math.abs((x - v.x) * v.nz - (z - v.z) * v.nx);
        return a > 0 && a < v.length && b < v.half + a * 0.35;
    });

    // ---- rows along the road: the first row right behind the guardrail or on top of the cut, denser near the road
    const along = quality === 'low' ? 17 : quality === 'high' ? 6.8 : 8.5;
    const reach = quality === 'low' ? 26 : 36;
    for (let s = random() * along; s < course.length; s += along * (0.8 + random() * 0.4)) {
        const p = course.at(s);
        const i = p.index;
        for (const sign of [1, -1]) {
            const start = layout.startOf(i, sign);
            let d = start + 1.6 + random() * 2.2;
            let row = 0;
            while (d < reach) {
                const jitter = (random() - 0.5) * along * 0.8;
                const q = course.at(s + jitter);
                const x = q.x + q.tz * d * sign;
                const z = q.z - q.tx * d * sign;
                d += 4.6 + row * 1.4 + random() * 3.2;
                row++;
                if (cleared(i, sign, d) || inView(x, z)) continue;
                const at = layout.locate(x, z);
                if (!at || at.d < at.start + 1.4) continue;
                const y = layout.groundAt(x, z);
                if (y < -50) continue;
                // cedars: 15–26 m (props-trees: scale 1 ≈ 10 m)
                spots.push({ x, y, z, s: 1.45 + random() * 0.9, d: at.d });
            }
        }
    }
    // ---- the forest over the hills: looser, thinning out with distance; none on the plain or right at the road
    const far = Math.round(1150 * Math.min(detail, 1.2) * (quality === 'low' ? 0.7 : 1));
    let tries = 0;
    let placed = 0;
    while (placed < far && tries < far * 6) {
        tries++;
        const r = Math.sqrt(random());
        const x = TERRAIN.minX - 120 + random() * (TERRAIN.maxX - TERRAIN.minX + 240);
        const z = TERRAIN.minZ - 120 + random() * (TERRAIN.maxZ - TERRAIN.minZ + 240) * (0.4 + r * 0.6);
        const at = layout.locate(x, z);
        if ((at && at.d < 34) || inView(x, z)) continue;
        const y = layout.natural(x, z);
        if (y < -48) continue;
        spots.push({ x, y, z, s: 1.3 + random() * 0.9, d: 99 });
        placed++;
    }

    // ---- one buildTrees call per patch (the patches outside the view are not drawn)
    const patches = new Map();
    for (const spot of spots) {
        // the rows along the road in small patches, the forest further out (silhouettes only) in large ones
        const size = spot.d < 50 && quality !== 'low' ? PATCH : PATCH * 2;
        const key = `${size}:${Math.floor(spot.x / size)}:${Math.floor(spot.z / size)}`;
        if (!patches.has(key)) patches.set(key, []);
        patches.get(key).push(spot);
    }
    const treeRandom = rng(77);
    for (const key of [...patches.keys()].sort()) {
        buildTrees(root, patches.get(key), treeRandom, { materials: ctx.materials, course, near: quality === 'high' ? 25 : 22 });
    }

    buildUndergrowth(ctx, layout, cleared);
    return spots.length;
}

function inRange(s, s0, s1, length) {
    const a = ((s - s0) % length + length) % length;
    const b = ((s1 - s0) % length + length) % length;
    return a <= b;
}

/**
 * Bamboo grass and ferns: clumps of crossed leaf cards (alpha cut-out) along the foot of the forest on both sides and over the top of
 * the walls; one instanced mesh.
 */
function buildUndergrowth(ctx, layout, cleared) {
    const { root, course, detail, quality } = ctx;
    const random = rng(313);
    const spots = [];
    const step = 2.2 / detail;
    for (let s = 0; s < course.length; s += step * (0.6 + random() * 0.8)) {
        const p = course.at(s);
        const i = p.index;
        for (const sign of [1, -1]) {
            const start = layout.startOf(i, sign);
            const valley = layout.side[i] !== sign;
            const count = 1 + Math.floor(random() * 3);
            for (let c = 0; c < count; c++) {
                const d = start + (valley ? 0.6 : 0.2) + Math.pow(random(), 1.6) * 9;
                if (cleared(i, sign, d)) continue;
                const x = p.x + p.tz * d * sign + (random() - 0.5) * 1.5;
                const z = p.z - p.tx * d * sign + (random() - 0.5) * 1.5;
                const at = layout.locate(x, z);
                if (!at || at.d < at.start + 0.15) continue;
                spots.push({ x, y: layout.groundAt(x, z) - 0.08, z, yaw: random() * 6.28, s: 0.7 + random() * 0.9, tone: random() });
            }
        }
    }
    if (!spots.length) return;
    // a clump: three crossed cards, slightly leaning out
    const cards = [];
    for (let k = 0; k < 3; k++) {
        const g = new THREE.PlaneGeometry(1.3, 0.9, 1, 1).translate(0, 0.45, 0);
        g.rotateX(-0.12);
        g.rotateY((k / 3) * Math.PI);
        cards.push(g);
    }
    const geometry = mergeGeometries(cards);
    // normals out and up (soft light on both sides)
    const normal = geometry.attributes.normal;
    const position = geometry.attributes.position;
    for (let v = 0; v < normal.count; v++) {
        const x = position.getX(v);
        const z = position.getZ(v);
        const l = Math.hypot(x, 0.9, z);
        normal.setXYZ(v, x / l, 0.9 / l, z / l);
    }
    const set = ctx.textures.foliage({ kind: 'leaves' });
    const material = ownSurface(ctx, set, { color: 0x86966a, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: quality !== 'low', normal: 0.5 });
    // keep the clump's normal on both sides (three would flip it on back faces and light half the leaves from inside), no sky sheen from behind
    foliageShading(material, 'pass-undergrowth');
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    spots.forEach((spot, k) => {
        m.compose(new THREE.Vector3(spot.x, spot.y, spot.z), q.setFromAxisAngle(up, spot.yaw), new THREE.Vector3(spot.s, spot.s * (0.8 + spot.tone * 0.5), spot.s));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c.setHSL(0.17 + spot.tone * 0.08, 0.35, 0.3 + spot.tone * 0.18));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    root.add(mesh);
}
