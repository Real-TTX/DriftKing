// DriftKing · maps/pass-layby.js – the lay-by of the Tenjō-Pass: a strip of older asphalt behind a kerbed island with a clipped hedge,
// three glowing vending machines (invented drinks and labels, no brands) with a can-and-bottle bin, a bench, a light that spills onto
// the asphalt (a real pool light) – and the open view down to the town. The island stands right on the course wall, so a car that
// touches it touches the wall; the lay-by itself lies outside the course.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, mergeGeometries, rng } from '../../render/kit.js';
import { kelvinHex, LIGHT_PRESETS } from '../../render/lights.js';
import { EDGE, stripGeometry } from './pass-layout.js';
import { addInstances } from './pass-road.js';

/**
 * Builds the lay-by (if the layout found a place for one).
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 */
export function buildLayby(ctx, layout) {
    const lay = layout.layby;
    if (!lay) return;
    const { root, course, materials, glows, pools, quality } = ctx;
    const sign = lay.sign;
    const i0 = Math.floor((lay.s0 - 14) / course.step);
    const i1 = Math.ceil((lay.s1 + 14) / course.step);
    const width = i => layout.railOffset(course.wrap(i), sign);

    // ---- the pavement: from the island to the guardrail, older and lighter asphalt
    const lats = [6.0, 6.9, 9, 11, 13.6];
    const pavement = stripGeometry(course, lats.length, (i, c, out) => {
        const w = width(i);
        out.lat = sign * Math.min(lats[c], EDGE.shoulder + w + 0.05);
        out.y = course.y[i] + 0.015;
    }, { step: 1, from: i0, to: i1, uv: (i, c, out, k) => ((out.u = (out.lat ?? 0) * sign), (out.v = k * course.step)) });
    if (pavement) {
        if (sign < 0) flip(pavement);
        const mesh = new THREE.Mesh(pavement, materials.asphalt({ wet: 0.14, puddles: 0, color: 0xa4a4a8 }));
        mesh.receiveShadow = true;
        root.add(mesh);
    }

    // ---- the island: a kerb on the course wall, a clipped hedge on it (only where the lay-by is wide enough)
    const islandFrom = lay.s0 - 8;
    const islandTo = lay.s1 + 8;
    const kerbLat = [6.02, 6.04, 6.86, 6.88];
    const kerbH = [0.0, 0.2, 0.2, 0.0];
    const kerb = stripGeometry(course, 4, (i, c, out) => {
        out.lat = sign * kerbLat[c];
        out.y = course.y[i] + 0.02 + kerbH[c];
    }, { step: 1, from: Math.floor(islandFrom / course.step), to: Math.ceil(islandTo / course.step), uv: 'along' });
    if (kerb) {
        if (sign < 0) flip(kerb);
        root.add(new THREE.Mesh(kerb, materials.concrete({ color: 0xc8c6c0, seams: false, stains: true })));
    }
    const random = rng(616);
    const hedge = [];
    for (let s = islandFrom + 1; s < islandTo - 1; s += 1.1) {
        const p = course.at(s);
        const d = 6.45;
        hedge.push({ x: p.x + p.tz * d * sign, y: p.y + 0.18, z: p.z - p.tx * d * sign, yaw: random() * 6.28, sx: 0.85 + random() * 0.3, sy: 0.75 + random() * 0.3, sz: 0.85 + random() * 0.3 });
    }
    const bush = new THREE.IcosahedronGeometry(0.5, quality === 'low' ? 0 : 1).scale(1, 0.75, 1).translate(0, 0.3, 0);
    addInstances(root, bush, materials.ground({ kind: 'grass', color: 0x7a9458 }), hedge);
    // a reflector post at each end of the island
    for (const s of [islandFrom + 0.6, islandTo - 0.6]) {
        const p = course.at(s);
        glows.add(p.x + p.tz * 6.45 * sign, p.y + 0.9, p.z - p.tx * 6.45 * sign, 0.3, 0xffb84a);
    }

    // ---- the vending machines at the back, facing the road
    const mid = course.at((lay.s0 + lay.s1) / 2 + 6);
    const back = EDGE.shoulder + lay.depth - 0.7;
    const yaw = Math.atan2(-mid.tz * sign, mid.tx * sign); // facing the road
    const ax = mid.tx; // along the road
    const az = mid.tz;
    const nx = mid.tz * sign; // outward
    const nz = -mid.tx * sign;
    const machines = [
        { body: 0xc8202a, offset: -1.15 },
        { body: 0xe8e8e6, offset: 0 },
        { body: 0x1f4f9a, offset: 1.15 },
    ];
    const fronts = frontTexture();
    const bodies = [];
    const faces = [];
    for (const m of machines) {
        const x = mid.x + nx * back + ax * m.offset;
        const z = mid.z + nz * back + az * m.offset;
        const y = mid.y + 0.02;
        const body = new THREE.BoxGeometry(1.02, 1.83, 0.72).translate(0, 0.915, 0);
        body.rotateY(yaw);
        body.translate(x, y, z);
        tintGeometry(body, m.body);
        bodies.push(body);
        // the lit front: display window, label panel, buttons (one texture, three variants side by side)
        const front = new THREE.PlaneGeometry(0.92, 1.62);
        const uv = front.attributes.uv;
        const cell = machines.indexOf(m);
        for (let k = 0; k < uv.count; k++) uv.setX(k, (cell + uv.getX(k)) / 3);
        front.translate(0, 0.94, 0.362);
        front.rotateY(yaw);
        front.translate(x, y, z);
        faces.push(front);
    }
    // the bin for cans and bottles, the bench
    const bin = new THREE.BoxGeometry(0.62, 0.9, 0.42).translate(0, 0.45, 0).rotateY(yaw).translate(mid.x + nx * (back + 0.1) + ax * 2.05, mid.y + 0.02, mid.z + nz * (back + 0.1) + az * 2.05);
    tintGeometry(bin, 0x2a6a3a);
    bodies.push(bin);
    const benchAt = (lay.s0 + lay.s1) / 2 - 8;
    const b = course.at(benchAt);
    const benchYaw = Math.atan2(-b.tz * sign, b.tx * sign);
    const bench = mergeGeometries([
        new THREE.BoxGeometry(1.8, 0.05, 0.42).translate(0, 0.45, 0),
        new THREE.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.7, -0.2),
        new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(-0.8, 0.225, 0),
        new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(0.8, 0.225, 0),
    ]).rotateY(benchYaw).translate(b.x + b.tz * sign * (back + 0.2), b.y + 0.02, b.z - b.tx * sign * (back + 0.2));
    tintGeometry(bench, 0x6a5a48);
    bodies.push(bench);
    const bodyMesh = new THREE.Mesh(mergeGeometries(bodies), vertexPainted(ctx));
    bodyMesh.castShadow = quality === 'high';
    bodyMesh.receiveShadow = true;
    root.add(bodyMesh);
    root.add(new THREE.Mesh(mergeGeometries(faces), materials.emissive(0xffffff, quality === 'low' ? 1.1 : 2.4, { map: fronts })));
    // their light on the asphalt: a real pool light (medium/high), a glow and a pool on low
    const lx = mid.x + nx * (back - 1.2);
    const lz = mid.z + nz * (back - 1.2);
    ctx.lights.add({ x: lx, y: mid.y + 1.6, z: lz, ...LIGHT_PRESETS.shop, color: kelvinHex(5600), intensity: 90, distance: 13, dir: { x: -nx, y: -0.35, z: -nz }, priority: 1.4 });
    glows.add(mid.x + nx * (back - 0.45), mid.y + 1.1, mid.z + nz * (back - 0.45), 3.4, 0xd8ecff);
    pools.add(mid.x + nx * (back - 2.2), mid.y, mid.z + nz * (back - 2.2), 4.5, 0xcfe4ff, 0.28);
}

function flip(geometry) {
    const index = geometry.index.array;
    for (let k = 0; k < index.length; k += 3) {
        const t = index[k + 1];
        index[k + 1] = index[k + 2];
        index[k + 2] = t;
    }
    geometry.computeVertexNormals();
}

function tintGeometry(geometry, hex) {
    const c = new THREE.Color(hex);
    const n = geometry.attributes.position.count;
    const colours = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) colours.set([c.r, c.g, c.b], k * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return geometry;
}

/** The painted metal of the machines, the bin and the bench: one own material with vertex colours. */
function vertexPainted(ctx) {
    return ctx.quality === 'low'
        ? new THREE.MeshLambertMaterial({ vertexColors: true })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.1 });
}

/** The fronts of three machines side by side (each 0.92 × 1.62 m): a lit window with rows of cans and bottles, a label panel, buttons. */
function frontTexture() {
    const random = rng(4242);
    return canvasTexture(384, 224, (c, w, h) => {
        const cellW = w / 3;
        const colours = ['#e83a3a', '#2a7ae8', '#f2b81c', '#2ab86a', '#f4f4f4', '#8a4ae8', '#e86a1c', '#1c2a4a', '#c8e8ff'];
        for (let m = 0; m < 3; m++) {
            const x0 = m * cellW;
            // frame
            c.fillStyle = '#1a1a1e';
            c.fillRect(x0, 0, cellW, h);
            // the header label panel with invented glyphs
            c.fillStyle = ['#ffe8e0', '#f0f8ff', '#e8f0ff'][m];
            c.fillRect(x0 + 6, 6, cellW - 12, 24);
            c.strokeStyle = ['#c8202a', '#2a5aa8', '#1f4f9a'][m];
            c.lineWidth = 3;
            for (let g = 0; g < 4; g++) drawGlyph(c, random, x0 + 14 + g * 26, 9, 18);
            // the window: four shelves of samples, brightly lit
            c.fillStyle = '#fdfcf4';
            c.fillRect(x0 + 6, 34, cellW - 12, 118);
            for (let row = 0; row < 4; row++) {
                const y = 38 + row * 29;
                for (let k = 0; k < 7; k++) {
                    const cx = x0 + 12 + k * 15.5;
                    const bottle = random() < 0.4;
                    c.fillStyle = colours[Math.floor(random() * colours.length)];
                    if (bottle) {
                        c.fillRect(cx, y + 2, 10, 20);
                        c.fillRect(cx + 3, y - 2, 4, 5);
                    } else {
                        c.fillRect(cx, y + 6, 11, 16);
                    }
                    c.fillStyle = 'rgba(255,255,255,0.55)';
                    c.fillRect(cx + 2, y + 9, 2, 10);
                    // the price buttons under each sample
                    c.fillStyle = random() < 0.15 ? '#ff4a3a' : '#5aff8a';
                    c.fillRect(cx + 2, y + 24, 7, 3);
                }
            }
            // the lower panel: coin slot, display, the dispense bay
            c.fillStyle = '#2a2a30';
            c.fillRect(x0 + 6, 156, cellW - 12, 62);
            c.fillStyle = '#0a0a0c';
            c.fillRect(x0 + 14, 190, cellW - 28, 22);
            c.fillStyle = '#ff7a2a';
            c.fillRect(x0 + cellW - 36, 162, 22, 8);
            c.fillStyle = '#c8c8cc';
            c.fillRect(x0 + cellW - 30, 175, 6, 10);
        }
    });
}
