// DriftKing · maps/pass-roadside.js – what stands along the edges of the Tenjō-Pass: on the mountain side the face of the cut (a cast
// concrete retaining wall with weep-hole pipes, a rock cut under galvanised rock-fall netting held by wire ropes, or a lattice-frame slope
// of concrete beams with grass between them); on the valley side the white W-beam guardrail on round posts with reflectors, curled at its
// ends. All of it stands behind the course walls (colliders) – none of it narrows the road.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries } from '../../render/kit.js';
import { BATTER, EDGE, flipWinding, ownSurface, retroMaterial } from './pass-layout.js';
import { addInstances } from './pass-road.js';

/**
 * Builds the cut faces and the guardrails into ctx.root.
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 * @param {THREE.Material} terrainMaterial the ground material (the grass between the lattice beams)
 */
export function buildRoadside(ctx, layout, terrainMaterial) {
    buildCuts(ctx, layout, terrainMaterial);
    buildGuardrails(ctx, layout);
}

// ---------------------------------------------------------------- the faces of the cuts

const FACE_COLUMNS = 6;

/** Three small seeded numbers −1..1 per sample (the bulges of a rock face). */
function noise3(i) {
    const a = Math.sin(i * 0.37) * 0.5 + Math.sin(i * 0.113 + 2.1) * 0.5;
    const b = Math.sin(i * 0.29 + 1.3) * 0.6 + Math.sin(i * 0.071) * 0.4;
    const c = Math.sin(i * 0.53 + 0.7) * 0.5 + Math.sin(i * 0.17 + 4.0) * 0.5;
    return [a, b, c];
}

/**
 * The cross-section of the face at sample i: lateral distance d and height h above the road per column, and the material slot of the band
 * from each column to the next (0 concrete, 1 rock, 2 grass, −1 none: the crisp edge between the face and its top).
 */
function faceSection(layout, i, out) {
    const H = layout.wallHeight[i];
    const kind = layout.kind[i] ?? 'wall';
    const run = H * BATTER[kind];
    const start = layout.startOf(i, layout.side[i]);
    const foot = EDGE.foot;
    if (kind === 'rock') {
        const n = noise3(i);
        out.d[0] = foot; out.h[0] = 0.04;
        out.d[1] = Math.max(foot + 0.04, foot + run * 0.3 + n[0] * 0.22); out.h[1] = H * 0.3;
        out.d[2] = foot + run * 0.62 + n[1] * 0.28; out.h[2] = H * 0.62;
        out.d[3] = foot + run + n[2] * 0.2; out.h[3] = H;
        out.d[4] = out.d[3]; out.h[4] = H;
        out.d[5] = start; out.h[5] = H + n[0] * 0.15;
        out.slots = [1, 1, 1, -1, 2];
    } else if (kind === 'frame') {
        // a 0.6 m concrete footing, then the slope with the lattice on it
        out.d[0] = foot; out.h[0] = 0.04;
        out.d[1] = foot + 0.04; out.h[1] = 0.6;
        out.d[2] = out.d[1]; out.h[2] = 0.6;
        out.d[3] = foot + run; out.h[3] = H;
        out.d[4] = out.d[3]; out.h[4] = H;
        out.d[5] = start; out.h[5] = H;
        out.slots = [0, -1, 2, -1, 2];
    } else {
        out.d[0] = foot; out.h[0] = 0.04;
        out.d[1] = foot + 0.02; out.h[1] = 0.3;
        out.d[2] = foot + 0.02 + run * 0.5; out.h[2] = 0.3 + (H - 0.3) * 0.5;
        out.d[3] = foot + 0.02 + run; out.h[3] = H;
        out.d[4] = out.d[3]; out.h[4] = H;
        out.d[5] = start; out.h[5] = H;
        out.slots = [0, 0, 0, -1, 0];
    }
    return out;
}

/** The rock-fall net in front of a rock face: rows (fraction of the height) → lateral distance and height; the last row lies over the top. */
function netPoint(H, f, top = false) {
    const run = H * BATTER.rock;
    if (top) return { d: EDGE.foot + run + 0.55, h: H + 0.1 };
    return { d: Math.max(EDGE.foot + 0.03, EDGE.foot + run * f - 0.3 * Math.min(1, f * 4)), h: 0.25 + (H - 0.25) * f };
}
const NET_ROWS = [0, 0.3, 0.62, 1];

function buildCuts(ctx, layout, terrainMaterial) {
    const { root, course, materials, quality } = ctx;
    const n = course.count;
    const section = { d: new Float32Array(FACE_COLUMNS), h: new Float32Array(FACE_COLUMNS), slots: null };
    const pipes = [];
    const ropes = [];
    const beams = [];
    for (const sign of [1, -1]) {
        // one geometry per side, three index lists (concrete, rock, grass between the lattice beams)
        const positions = [];
        const uvs = [];
        const lists = [[], [], []];
        const netPositions = [];
        const netUvs = [];
        const netIndex = [];
        let previous = -1;
        let previousNet = -1;
        let previousSlots = null;
        for (let k = 0; k <= n; k++) {
            const i = k % n;
            if (layout.side[i] !== sign) {
                previous = -1;
                previousNet = -1;
                continue;
            }
            faceSection(layout, i, section);
            const lx = course.tz[i] * sign;
            const lz = -course.tx[i] * sign;
            const y = course.y[i];
            const s = k * course.step;
            const base = positions.length / 3;
            for (let c = 0; c < FACE_COLUMNS; c++) {
                positions.push(course.x[i] + lx * section.d[c], y + section.h[c], course.z[i] + lz * section.d[c]);
                uvs.push(s, c === FACE_COLUMNS - 1 ? section.h[c] + (section.d[c] - section.d[c - 1]) : section.h[c]);
            }
            if (previous >= 0) {
                for (let c = 0; c < FACE_COLUMNS - 1; c++) {
                    const slot = previousSlots[c];
                    if (slot < 0) continue;
                    const a = previous + c;
                    const b = base + c;
                    lists[slot].push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
            previous = base;
            previousSlots = section.slots;

            const H = layout.wallHeight[i];
            const kind = layout.kind[i];
            // weep-hole pipes in a concrete wall: every 2.5 m, rows at 0.7 m and every 1.5 m above
            if (kind === 'wall' && k % 5 === 2 && H > 1.2) {
                for (let h = 0.7; h < H - 0.35; h += 1.5) {
                    const d = EDGE.foot + 0.02 + (H * BATTER.wall * (h - 0.3)) / (H - 0.3) - 0.05;
                    pipes.push({ x: course.x[i] + lx * d, y: y + h, z: course.z[i] + lz * d, yaw: Math.atan2(-lx, -lz) });
                }
            }
            // the rock-fall net: in front of the bulges, over the top edge
            if (kind === 'rock') {
                const netBase = netPositions.length / 3;
                const points = [...NET_ROWS.map(f => netPoint(H, f)), netPoint(H, 1, true)];
                for (const p of points) {
                    netPositions.push(course.x[i] + lx * p.d, y + p.h, course.z[i] + lz * p.d);
                    netUvs.push(s, p.h);
                }
                if (previousNet >= 0) {
                    for (let r = 0; r < points.length - 1; r++) {
                        const a = previousNet + r;
                        const b = netBase + r;
                        netIndex.push(a, b, a + 1, a + 1, b, b + 1);
                    }
                }
                previousNet = netBase;
                if (k % 4 === 0) ropes.push({ i, sign });
            } else {
                previousNet = -1;
            }
            // the lattice: beams along the slope at four levels, beams down the slope every 2–2.5 m
            if (kind === 'frame' && k % 2 === 0) beams.push({ i, k, sign, down: true });
        }
        if (positions.length === 0) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        const index = [];
        lists.forEach((list, slot) => {
            if (!list.length) return;
            geometry.addGroup(index.length, list.length, slot);
            for (const v of list) index.push(v);
        });
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        if (sign < 0) flipWinding(geometry);
        const faceMaterials = [
            materials.concrete({ color: 0xb4b4b0, seams: true, stains: true }),
            materials.rock({ color: 0xf2ece4 }),
            terrainMaterial,
        ];
        const mesh = new THREE.Mesh(geometry, faceMaterials);
        mesh.receiveShadow = true;
        mesh.castShadow = quality === 'high';
        root.add(mesh);

        if (netIndex.length && quality !== 'low') {
            const net = new THREE.BufferGeometry();
            net.setAttribute('position', new THREE.Float32BufferAttribute(netPositions, 3));
            net.setAttribute('uv', new THREE.Float32BufferAttribute(netUvs, 2));
            net.setIndex(netIndex);
            net.computeVertexNormals();
            if (sign < 0) flipWinding(net);
            root.add(new THREE.Mesh(net, netMaterial(ctx)));
        }
    }

    // weep-hole pipes (grey plastic stubs)
    const pipe = new THREE.CylinderGeometry(0.055, 0.055, 0.16, 8).rotateX(Math.PI / 2);
    addInstances(root, pipe, materials.plastic({ color: 0x55585a, roughness: 0.6 }), pipes);

    // wire ropes over the nets: down the face every 4 m, along it at three heights (thin lines just in front of the net)
    if (ropes.length && quality !== 'low') {
        const points = [];
        const at = (i, sign, f, top = false) => {
            const H = layout.wallHeight[i];
            const p = netPoint(H, f, top);
            const d = p.d - 0.04;
            return [course.x[i] + course.tz[i] * sign * d, course.y[i] + p.h + 0.02, course.z[i] - course.tx[i] * sign * d];
        };
        for (const { i, sign } of ropes) {
            for (let r = 0; r < NET_ROWS.length - 1; r++) points.push(...at(i, sign, NET_ROWS[r]), ...at(i, sign, NET_ROWS[r + 1]));
            points.push(...at(i, sign, 1), ...at(i, sign, 1, true));
        }
        for (const sign of [1, -1]) {
            for (const f of [0.3, 0.62, 1]) {
                let last = null;
                for (let i = 0; i < n; i += 2) {
                    if (layout.side[i] !== sign || layout.kind[i] !== 'rock') {
                        last = null;
                        continue;
                    }
                    const p = at(i, sign, f);
                    if (last) points.push(...last, ...p);
                    last = p;
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        root.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x2c2f32 })));
    }

    // the lattice beams: concrete, 0.3 m wide, standing out of the slope
    if (beams.length) {
        const geometries = [];
        const levels = [0, 0.34, 0.67, 1];
        const point = (i, sign, f) => {
            const H = layout.wallHeight[i];
            const run = H * BATTER.frame;
            const d = EDGE.foot + 0.04 + (run - 0.04) * f;
            return new THREE.Vector3(course.x[i] + course.tz[i] * sign * d, course.y[i] + 0.6 + (H - 0.6) * f, course.z[i] - course.tx[i] * sign * d);
        };
        for (let b = 0; b < beams.length; b++) {
            const { i, k, sign, down } = beams[b];
            if (down) geometries.push(beamBetween(point(i, sign, 0), point(i, sign, 1), 0.3, 0.24));
            const next = beams[b + 1];
            if (next && next.sign === sign && next.k - k === 2) {
                for (const f of levels) geometries.push(beamBetween(point(i, sign, f), point(next.i, sign, f), 0.3, 0.24, 0.15));
            }
        }
        if (geometries.length) {
            const mesh = new THREE.Mesh(mergeGeometries(geometries), materials.concrete({ color: 0xbcb8b0, seams: false, stains: true }));
            mesh.receiveShadow = true;
            root.add(mesh);
        }
    }
}

/** A concrete beam from a to b (cross-section w × t, lengthened by extra at both ends), its thickness standing out of the slope. */
function beamBetween(a, b, w, t, extra = 0.08) {
    const length = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, t, length + extra * 2);
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
    g.applyMatrix4(m);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.translate(mid.x, mid.y + t * 0.3, mid.z);
    return metricBox(g);
}

/** Box-projected UVs in metres for a placed box (concrete beams). */
function metricBox(g) {
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
        const ax = Math.abs(nrm.getX(k));
        const ay = Math.abs(nrm.getY(k));
        const az = Math.abs(nrm.getZ(k));
        if (ay >= ax && ay >= az) uv.setXY(k, p.getX(k), p.getZ(k));
        else if (ax >= az) uv.setXY(k, p.getZ(k), p.getY(k));
        else uv.setXY(k, p.getX(k), p.getY(k));
    }
    return g;
}

/** The galvanised diamond mesh of the rock-fall nets (alpha cut-out, ~0.25 m diamonds), own material. */
function netMaterial(ctx) {
    const texture = canvasTexture(256, 256, (c, w) => {
        c.clearRect(0, 0, w, w);
        c.strokeStyle = 'rgba(205,210,214,1)';
        c.lineWidth = 3.2;
        const cells = 4;
        const s = w / cells;
        for (let k = -cells; k <= cells * 2; k++) {
            c.beginPath();
            c.moveTo(k * s, 0);
            c.lineTo(k * s + w, w);
            c.stroke();
            c.beginPath();
            c.moveTo(k * s, w);
            c.lineTo(k * s + w, 0);
            c.stroke();
        }
    }, { repeat: true });
    const m = ownSurface(ctx, null, { color: 0xb8bcc0, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide, alphaTest: 0.5 });
    m.map = texture;
    return m;
}

// ---------------------------------------------------------------- guardrails

/** The W-beam profile: outward offset from the rail face and height above the road, bottom to top. */
const PROFILE = [
    [0.075, 0.44], [0.0, 0.49], [0.0, 0.545], [0.055, 0.595], [0.0, 0.645], [0.0, 0.7], [0.075, 0.75],
];

function buildGuardrails(ctx, layout) {
    const { root, course, quality } = ctx;
    const n = course.count;
    const positions = [];
    const normals = [];
    const uvs = [];
    const index = [];
    const posts = [];
    const reflectors = [];
    for (const sign of [1, -1]) {
        // runs of valley samples on this side (closed loop: start from a change)
        let start = 0;
        while (start < n && layout.isValley(start, sign) === layout.isValley((start - 1 + n) % n, sign)) start++;
        const allValley = start >= n && layout.isValley(0, sign);
        if (start >= n) start = 0;
        let k = 0;
        while (k < n) {
            const i0 = (start + k) % n;
            if (!layout.isValley(i0, sign)) {
                k++;
                continue;
            }
            let length = 0;
            while (length < n && layout.isValley((i0 + length) % n, sign)) length++;
            // rows by s: the rail overlaps the end of the wall by a metre and curls away from the road at both ends
            const s0 = i0 * course.step - (allValley ? 0 : 1);
            const s1 = (i0 + length) * course.step + (allValley ? 0 : 1);
            const rows = [];
            const offset = s => layout.railOffset(course.at(s).index, sign);
            if (!allValley) for (let e = 3; e >= 1; e--) rows.push({ s: s0 - e * 0.7, out: 0.12 * e * e, drop: 0.03 * e });
            for (let s = s0; s <= s1; s += 2) rows.push({ s, out: offset(s), drop: 0 });
            if (!allValley) for (let e = 1; e <= 3; e++) rows.push({ s: s1 + e * 0.7, out: 0.12 * e * e, drop: 0.03 * e });
            railStrip(course, rows, sign, positions, normals, uvs, index);
            for (let s = s0 + 2; s < s1; s += 4) {
                const p = course.at(s);
                const lx = p.tz * sign;
                const lz = -p.tx * sign;
                const d = EDGE.post + layout.railOffset(p.index, sign);
                posts.push({ x: p.x + lx * d, y: p.y - 0.06, z: p.z + lz * d });
                if (posts.length % 3 === 0) reflectors.push({ x: p.x + lx * d, y: p.y + 1.02, z: p.z + lz * d, yaw: Math.atan2(p.tx, p.tz) });
            }
            k += length;
            if (allValley) break;
        }
    }
    if (!index.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const rail = new THREE.Mesh(geometry, ownSurface(ctx, null, { color: 0xdedcd4, roughness: 0.38, side: THREE.DoubleSide }));
    rail.castShadow = quality === 'high';
    rail.receiveShadow = true;
    root.add(rail);
    // round posts with a cap, a reflector on a stem on every third post
    const segments = quality === 'low' ? 6 : quality === 'high' ? 10 : 8;
    const post = mergeGeometries([
        new THREE.CylinderGeometry(0.07, 0.07, 1.0, segments, 1, true).translate(0, 0.5, 0),
        new THREE.ConeGeometry(0.074, 0.035, segments, 1, true).translate(0, 1.017, 0),
    ]);
    addInstances(root, post, ctx.materials.painted({ color: 0xd4d2ca, roughness: 0.45 }), posts, { shadow: quality === 'high' });
    addInstances(root, new THREE.CylinderGeometry(0.05, 0.05, 0.014, 10, 1).rotateX(Math.PI / 2), retroMaterial(0xf4f6ff, 5, { base: 0.12, near: 15, far: 95 }), reflectors);
}

/**
 * Appends the W-beam rows ({ s, out, drop }) to the buffers: the profile swept along the side, one flat facet per profile segment (its own
 * normal across the wave) – the pressed steel reads as bands: the upper slopes catch the sky, the lower ones fall dark, the flats face the road.
 */
function railStrip(course, rows, sign, positions, normals, uvs, index) {
    const base = positions.length / 3;
    const segments = PROFILE.length - 1;
    const perRow = segments * 2;
    const p = {};
    for (let r = 0; r < rows.length; r++) {
        const { s, out, drop } = rows[r];
        course.at(s, p);
        const lx = p.tz * sign;
        const lz = -p.tx * sign;
        for (let c = 0; c < segments; c++) {
            const [o0, h0] = PROFILE[c];
            const [o1, h1] = PROFILE[c + 1];
            const dh = h1 - h0;
            const dout = o1 - o0;
            const len = Math.hypot(dh, dout) || 1;
            for (const [o, h] of [[o0, h0], [o1, h1]]) {
                const d = EDGE.rail + o + out;
                positions.push(p.x + lx * d, p.y + h - drop, p.z + lz * d);
                normals.push(lx * (-dh / len), dout / len, lz * (-dh / len));
                uvs.push(s, h);
            }
        }
        if (r > 0) {
            const a = base + (r - 1) * perRow;
            const b = base + r * perRow;
            for (let c = 0; c < segments; c++) {
                const i = c * 2;
                if (sign > 0) index.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1);
                else index.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
            }
        }
    }
}
