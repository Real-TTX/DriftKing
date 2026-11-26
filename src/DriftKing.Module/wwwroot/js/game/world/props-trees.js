// DriftKing · world/props-trees.js – conifers like the cedar plantations on Japanese mountain slopes: a straight trunk with bark, a narrow
// crown from a third of the height. Near the road (medium/high) every tree is a bark trunk, an opaque core and layered drooping branch cards
// with the needle texture (alpha cut-out); further away and on low a cheap silhouette of jagged tiers with shaded vertex colours.
// Instanced: at most four draw calls for a whole forest, scale/turn/colour varying per tree.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries, rng, shadowOnly } from '../render/kit.js';
import { instanced, isPbr, materialsOf, ownMaterial, paint, perWorld, seedFrom } from './props-common.js';

/** The tree in its own frame (scale 1): crown from 2.2 m to 9.6 m, ~2.2 m wide at the bottom. */
const CROWN_BOTTOM = 2.2;
const CROWN_TOP = 9.6;

/** Vertex colours of the silhouette trees (light tips, darker notches) and of the cores inside the needle cards (dark, even). */
const FAR_PALETTE = { tip: 0x4c6e42, notch: 0x283a24, apex: 0x405c38, under: 0x141c12 };
const CORE_PALETTE = { tip: 0x142313, notch: 0x0f1a0e, apex: 0x182a17, under: 0x0a1209 };

/** The crown radius at a height (a slightly convex cone). */
function crownRadius(y) {
    const t = Math.min(1, Math.max(0, (y - CROWN_BOTTOM) / (CROWN_TOP - CROWN_BOTTOM)));
    return 0.25 + 1.95 * Math.pow(1 - t, 0.85);
}

/**
 * Jagged tiers (the silhouette of a conifer): per tier a rim of irregular tips (drooping) and notches under an apex, shaded per vertex
 * (light tips, dark notches and undersides); normals point out of the crown (soft, volume-like light); UVs in metres around and up the
 * slope for the needle detail texture. radiusScale shrinks it (the core inside the needle cards).
 */
function tierGeometry(tiers, tips, radiusScale, { underside = 'lowest', palette = FAR_PALETTE } = {}) {
    const positions = [];
    const normals = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const tipColour = new THREE.Color(palette.tip);
    const notchColour = new THREE.Color(palette.notch);
    const apexColour = new THREE.Color(palette.apex);
    const underColour = new THREE.Color(palette.under);
    const push = (x, y, z, nx, ny, nz, c, u, v) => {
        positions.push(x, y, z);
        const l = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / l, ny / l, nz / l);
        colors.push(c.r, c.g, c.b);
        uvs.push(u, v);
        return positions.length / 3 - 1;
    };
    // the same irregular rims in every tree (instances differ by turn and scale)
    const jitter = rng(1337 + tiers * 31 + tips);
    const span = CROWN_TOP - CROWN_BOTTOM;
    for (let k = 0; k < tiers; k++) {
        const base = CROWN_BOTTOM + (span * k * 0.82) / tiers;
        const apex = k === tiers - 1 ? CROWN_TOP : base + (span / tiers) * 1.9;
        const R = crownRadius(base) * radiusScale;
        const turn = k * 0.7;
        const n = tips * 2;
        const rim = [];
        for (let i = 0; i <= n; i++) {
            const a = turn + (i / n) * Math.PI * 2;
            const tip = i % 2 === 0;
            const j = i % n;
            const r = (tip ? R * (0.78 + ((j * 7919) % 13) / 13 * 0.4) : R * (0.5 + jitter() * 0.18));
            const y = base + (tip ? -0.32 - ((j * 104729) % 7) / 7 * 0.3 : 0.22) * radiusScale;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            rim.push(push(ca * r, y, sa * r, ca * 0.8, 0.6, sa * 0.8, tip ? tipColour : notchColour, (i / n) * Math.PI * 2 * R, 0));
        }
        const slant = Math.hypot(R, apex - base);
        for (let i = 0; i < n; i++) {
            const top = push(0, apex, 0, 0, 1, 0, apexColour, ((i + 0.5) / n) * Math.PI * 2 * R, slant);
            indices.push(top, rim[i + 1], rim[i]);
        }
        if (underside === 'all' || (underside === 'lowest' && k === 0)) {
            const centre = push(0, base + 0.5 * radiusScale, 0, 0, -1, 0, underColour, 0, 0);
            const under = rim.map(i => push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], 0, -1, 0, underColour, uvs[i * 2], 0.5));
            for (let i = 0; i < n; i++) indices.push(centre, under[i], under[i + 1]);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    return g;
}

let needleDetail = null;

/**
 * A small grey detail texture of needle strokes (shared for the page, 128², tile 1 m): multiplied into the silhouettes' vertex colours it
 * breaks their flat facets up into foliage.
 */
function needleDetailMap() {
    if (needleDetail) return needleDetail;
    const n = 128;
    const random = rng(2024);
    needleDetail = canvasTexture(n, n, c => {
        c.fillStyle = '#d8d8d8';
        c.fillRect(0, 0, n, n);
        c.lineCap = 'round';
        for (let k = 0; k < 900; k++) {
            const x = random() * n;
            const y = random() * n;
            const a = -Math.PI / 2 + (random() - 0.5) * 2.2;
            const l = 3 + random() * 7;
            const v = Math.floor(60 + random() * 150);
            c.strokeStyle = `rgba(${v},${v},${v},0.8)`;
            c.lineWidth = 0.8 + random() * 0.8;
            for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {
                c.beginPath();
                c.moveTo(x + ox, y + oy);
                c.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
                c.stroke();
            }
        }
    }, { repeat: true });
    needleDetail.userData.shared = true;
    return needleDetail;
}

/** A tapered trunk from below the ground to `top` (bark UVs in metres: u around, v up). */
function trunkGeometry(top, segments, r0 = 0.24, r1 = 0.07) {
    const g = new THREE.CylinderGeometry(r1, r0, top + 0.6, segments, 1, true);
    g.translate(0, (top + 0.6) / 2 - 0.6, 0);
    const uv = g.attributes.uv;
    const p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r0, p.getY(i));
    return g;
}

/**
 * The branch cards: per tier a ring of drooping cards (two quads each: from the trunk out and down), v = 0 at the trunk, 1 at the tip
 * (the needle texture's twigs grow towards v = 1); the leader at the top as two crossed cards. Normals point out of the crown.
 */
function cardGeometry(tiers, perTier, bent = true) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const span = CROWN_TOP - 0.6 - CROWN_BOTTOM;
    // the same small irregularities in every tree (they differ by turn and scale per instance)
    const jitter = rng(4711);
    for (let k = 0; k < tiers; k++) {
        const y = CROWN_BOTTOM + 0.1 + (span * k) / tiers;
        const turn = k * 2.39996;
        for (let n = 0; n < perTier; n++) {
            const a = turn + ((n + (jitter() - 0.5) * 0.5) / perTier) * Math.PI * 2;
            const R = (crownRadius(y) * 1.1 + 0.25) * (0.85 + jitter() * 0.3);
            const width = ((Math.PI * 2 * R) / perTier) * 1.6;
            const droop = 0.3 + R * (0.12 + jitter() * 0.14);
            const ox = Math.cos(a);
            const oz = Math.sin(a);
            const sx = -oz;
            const sz = ox;
            // bent: inner, middle and outer row (two quads, the branch arches down); straight: inner and outer only
            const rows = bent
                ? [[0.1, y + 0.5, 0.3, 0.02], [R * 0.55, y + 0.16, 0.9, 0.55], [R, y - droop, 1, 0.98]]
                : [[0.1, y + 0.45, 0.45, 0.02], [R, y - droop, 1, 0.98]];
            const base = positions.length / 3;
            for (const [r, yy, w, v] of rows) {
                const half = (width * w) / 2;
                for (const side of [-1, 1]) {
                    positions.push(ox * r + sx * half * side, yy, oz * r + sz * half * side);
                    const nl = Math.hypot(ox * 0.75, 0.66, oz * 0.75);
                    normals.push((ox * 0.75) / nl, 0.66 / nl, (oz * 0.75) / nl);
                    uvs.push(side < 0 ? 0 : 1, v);
                }
            }
            for (let row = 0; row < rows.length - 1; row++) {
                const i = base + row * 2;
                indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
            }
        }
    }
    // the leader: two crossed vertical cards at the top
    for (const a of [0, Math.PI / 2]) {
        const sx = Math.cos(a) * 0.55;
        const sz = Math.sin(a) * 0.55;
        const base = positions.length / 3;
        for (const [y, v] of [[CROWN_TOP - 1.6, 0.02], [CROWN_TOP + 0.3, 0.98]]) {
            for (const side of [-1, 1]) {
                positions.push(sx * side * (v < 0.5 ? 1 : 0.35), y, sz * side * (v < 0.5 ? 1 : 0.35));
                normals.push(0, 1, 0);
                uvs.push(side < 0 ? 0 : 1, v);
            }
        }
        indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    return g;
}

// both sides of a card keep the normal of the crown (out and up): three flips it on back faces, which would light half the cards from inside.
// Seen from below or from inside the crown that normal faces away from the eye: the BRDF clamps N·V to 0, the Fresnel term goes to 1 and the
// card mirrors the bright night sky of the reflection map (and the diffuse share drops to nothing) – the branches overhead turned frost-white.
// So the normal is bent towards the eye just enough that N·V stays ≥ ~0.25: seen from below it then leans down (a darker underside, as it
// should be), seen from above nothing changes; the specular sheen of needles and leaves is damped as well (they are dull).
const FOLIAGE_NORMAL = THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0');
const FOLIAGE_BEND = /* glsl */ `#include <normal_fragment_maps>
    {
        vec3 foliageEye = normalize(vViewPosition);
        normal = normalize(normal + foliageEye * max(0.0, 0.25 - dot(normal, foliageEye)));
    }`;
const FOLIAGE_LIGHT = /* glsl */ `#include <lights_fragment_end>
    reflectedLight.directSpecular *= 0.6;
    reflectedLight.indirectSpecular *= 0.5;`;

/**
 * Lights alpha-cut foliage cards (double sided, one normal for both sides) like foliage: the crown's normal on both faces, no sky mirror on
 * the faces seen from behind. For the MeshStandardMaterials of trees and undergrowth (medium/high; low has no specular to fix).
 */
export function foliageShading(material, key) {
    if (!material.isMeshStandardMaterial) return material;
    material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <normal_fragment_begin>', FOLIAGE_NORMAL)
            .replace('#include <normal_fragment_maps>', FOLIAGE_BEND)
            .replace('#include <lights_fragment_end>', FOLIAGE_LIGHT);
    };
    material.customProgramCacheKey = () => key;
    return material;
}

/**
 * The needle cards' material (owned by the forest; its textures are the factory's, shared): the foliage texture set, alpha cut-out with
 * alpha to coverage (soft edges under MSAA), double sided with the crown's normals on both sides.
 */
function needleMaterial(mats, colour) {
    const set = mats.textures.foliage({ kind: 'needles' });
    const m = new THREE.MeshStandardMaterial({
        color: colour,
        map: set.map,
        normalMap: set.normalMap,
        roughnessMap: set.roughnessMap,
        aoMap: set.aoMap,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        alphaTest: 0.42,
        alphaToCoverage: true,
    });
    m.normalScale.set(0.5, 0.5);
    return foliageShading(m, 'driftking-needles');
}

/**
 * Conifers at spots [{ x, y, z, s, d? }] (s = scale; d = distance to the road, optional), instanced with variation in turn, height,
 * width and colour. Uses exactly four numbers of `random` per tree (as before), so whatever the map draws afterwards stays where it was.
 * options: materials (the factory), course (to find the trees near the road – they get bark and needle cards on medium/high),
 * near (metres from the centre line that count as near, default 45).
 */
export function buildTrees(root, spots, random, options = {}) {
    if (spots.length === 0) return;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const high = mats.quality === 'high';
    const nearDistance = options.near ?? 45;
    const course = options.course ?? null;
    const near = [];
    const far = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    spots.forEach((p, k) => {
        const yaw = random() * 6.28;
        const tall = 0.85 + random() * 0.4;
        const hue = random();
        const light = random();
        const local = rng(seedFrom(hue, k));
        const wide = 0.82 + local() * 0.36;
        position.set(p.x, p.y - 0.2, p.z);
        scale.set(p.s * wide, p.s * tall, p.s * wide * (0.9 + local() * 0.2));
        const matrix = m.compose(position, q.setFromAxisAngle(up, yaw), scale).clone();
        const colour = new THREE.Color().setHSL(0.2 + hue * 0.13, 0.22 + local() * 0.15, 0.62 + light * 0.3);
        const bark = new THREE.Color().setHSL(0.07, 0.15, 0.55 + light * 0.3);
        let detailed = false;
        if (pbr) {
            if (p.d !== undefined) detailed = p.d < nearDistance;
            else if (course) detailed = course.distanceTo(p.x, p.z) < nearDistance;
            else detailed = spots.length <= 400;
        }
        (detailed ? near : far).push({ matrix, colour, bark });
    });
    const group = new THREE.Group();
    group.name = 'trees';
    // geometries and materials are shared by all calls into the same world (maps build their forest patch by patch) and by the grid cells
    const kit = perWorld(root, `trees:${mats.quality}`, () => ({
        shade: foliageShading(ownMaterial(mats, { vertexColors: true, roughness: 0.88, map: needleDetailMap() }), 'driftking-tree-shade'),
        farGeometry: mergeGeometries([paint(trunkGeometry(3.2, pbr ? 6 : 5, 0.22, 0.1), 0x4a3c30), tierGeometry(3, high ? 7 : 5, 1)]),
        near: pbr ? {
            trunk: trunkGeometry(CROWN_TOP * 0.92, high ? 9 : 7),
            core: tierGeometry(high ? 4 : 3, 6, 0.52, { underside: 'none', palette: CORE_PALETTE }),
            // medium: one tier less than it had (the pass stayed above the 400 k triangles in view of RENDERING.md §10)
            cards: high ? cardGeometry(8, 6) : cardGeometry(5, 5),
            // high: the crown's shadow comes from an opaque silhouette (a shadow proxy) – the layered, alpha-tested cards in the moon's
            // shadow map cost ≈ 21 ms per frame on the 610M (the pass); moonlit forest shade reads the same at night
            shadow: high ? tierGeometry(4, 7, 0.92, { underside: 'none' }) : null,
            bark: mats.bark({ color: 0xc0a088 }),
            needles: needleMaterial(mats, 0xc4ceb8),
        } : null,
    }));
    const { shade, farGeometry } = kit;
    const nearGeometry = kit.near;
    const barkMaterial = kit.near?.bark;
    const cardMaterial = kit.near?.needles;
    // coarse grids (3 × 3 for the silhouettes, 2 × 2 for the detailed trees, cells of at least 150 m): every cell is culled on its own
    const cells = new Map();
    const all = [...near, ...far];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const t of all) {
        const e = t.matrix.elements;
        minX = Math.min(minX, e[12]);
        maxX = Math.max(maxX, e[12]);
        minZ = Math.min(minZ, e[14]);
        maxZ = Math.max(maxZ, e[14]);
    }
    const cellX = Math.max(150, (maxX - minX) / 3 + 1e-3);
    const cellZ = Math.max(150, (maxZ - minZ) / 3 + 1e-3);
    const cellOf = (t, scale) => {
        const e = t.matrix.elements;
        const key = `${scale}:${Math.floor((e[12] - minX) / (cellX * scale))}:${Math.floor((e[14] - minZ) / (cellZ * scale))}`;
        if (!cells.has(key)) cells.set(key, { near: [], far: [] });
        return cells.get(key);
    };
    for (const t of near) cellOf(t, 1.5).near.push(t);
    for (const t of far) cellOf(t, 1).far.push(t);
    for (const cell of cells.values()) {
        if (cell.far.length) {
            group.add(instanced(farGeometry, shade, cell.far.map(t => t.matrix), { colors: cell.far.map(t => t.colour), castShadow: high, receiveShadow: pbr, name: 'trees-far' }));
        }
        if (cell.near.length) {
            const matrices = cell.near.map(t => t.matrix);
            const colors = cell.near.map(t => t.colour);
            group.add(instanced(nearGeometry.trunk, barkMaterial, matrices, { colors: cell.near.map(t => t.bark), castShadow: high, receiveShadow: true, name: 'trees-trunks' }));
            group.add(instanced(nearGeometry.core, shade, matrices, { colors, receiveShadow: true, name: 'trees-cores' }));
            group.add(instanced(nearGeometry.cards, cardMaterial, matrices, { colors, receiveShadow: true, name: 'trees-cards' }));
            if (nearGeometry.shadow) group.add(shadowOnly(instanced(nearGeometry.shadow, shade, matrices, { name: 'trees-shadow' })));
        }
    }
    root.add(group);
    return group;
}
