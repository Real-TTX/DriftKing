// DriftKing · world/road.js – what every map builds along its course: the asphalt strip with its markings, barrier walls (colliders) and their
// look (guardrails on the pass, kerbs and railings in the city), cones that mark a course on open ground, the start line.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries, rng, tint } from '../render/kit.js';

/** The asphalt texture (repeats every 8 m along the road): grain, edge lines, a dashed centre line in white or yellow. */
export function roadTexture({ centre = '#e9e6dc', edges = true, seed = 3 } = {}) {
    const random = rng(seed);
    return canvasTexture(256, 512, (ctx, w, h) => {
        ctx.fillStyle = '#26252c';
        ctx.fillRect(0, 0, w, h);
        for (let k = 0; k < 2600; k++) {
            const v = 28 + random() * 34;
            ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.35 + random() * 0.4})`;
            ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
        }
        // tyre tracks: two darker bands
        for (const x of [0.3, 0.7]) {
            const g = ctx.createLinearGradient((x - 0.08) * w, 0, (x + 0.08) * w, 0);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect((x - 0.08) * w, 0, 0.16 * w, h);
        }
        if (edges) {
            ctx.fillStyle = 'rgba(235,232,220,0.85)';
            ctx.fillRect(0.035 * w, 0, 0.022 * w, h);
            ctx.fillRect(0.943 * w, 0, 0.022 * w, h);
        }
        if (centre) {
            ctx.fillStyle = centre;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(0.489 * w, 0, 0.022 * w, h * 0.42);
            ctx.globalAlpha = 1;
        }
    }, { repeat: true });
}

/**
 * The road strip along the course (width of the course + extra), lying lift metres above the course height.
 * @returns {THREE.Mesh}
 */
export function buildRoadStrip(course, material, { extra = 0, lift = 0.02, repeat = 8 } = {}) {
    const half = course.width / 2 + extra;
    const mesh = new THREE.Mesh(ribbonGeometry(course, -half, half, { lift, repeat }), material);
    mesh.receiveShadow = true;
    return mesh;
}

/**
 * A ribbon along the course between the lateral offsets from and to (> 0 left of the centre line), lift metres above the course:
 * sidewalks, shoulders, painted lines. u runs 0..1 across, v along the course (one unit per `repeat` metres).
 */
export function ribbonGeometry(course, from, to, { lift = 0, repeat = 8 } = {}) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= course.count; i++) {
        const k = i % course.count;
        const lx = course.tz[k];
        const lz = -course.tx[k];
        const y = course.y[k] + lift;
        positions.push(course.x[k] + lx * to, y, course.z[k] + lz * to, course.x[k] + lx * from, y, course.z[k] + lz * from);
        const v = (i * course.step) / repeat;
        uvs.push(0, v, 1, v);
        if (i < course.count) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The two edges of the course at lateral ±(width/2 + offset) as polylines [{ x, y, z }] (every `every` samples),
 * and (when colliders are given) walls along them.
 */
export function courseEdges(course, offset, { every = 2, colliders = null } = {}) {
    const left = [];
    const right = [];
    const d = course.width / 2 + offset;
    for (let i = 0; i < course.count; i += every) {
        const lx = course.tz[i];
        const lz = -course.tx[i];
        left.push({ x: course.x[i] + lx * d, y: course.y[i], z: course.z[i] + lz * d });
        right.push({ x: course.x[i] - lx * d, y: course.y[i], z: course.z[i] - lz * d });
    }
    if (colliders) {
        for (const line of [left, right]) {
            for (let k = 0; k < line.length; k++) {
                const a = line[k];
                const b = line[(k + 1) % line.length];
                colliders.addSegment(a.x, a.z, b.x, b.z);
            }
        }
    }
    return { left, right };
}

/** A vertical band along a closed polyline from height y0 to y1 above it (guardrail beam, parapet face), as geometry. */
export function bandGeometry(line, y0, y1, { closed = true } = {}) {
    const positions = [];
    const indices = [];
    const n = line.length;
    const last = closed ? n : n - 1;
    for (let k = 0; k <= last; k++) {
        const p = line[k % n];
        positions.push(p.x, p.y + y0, p.z, p.x, p.y + y1, p.z);
        if (k < last) {
            const a = k * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** Guardrails along both edges: the beam (double-sided band) and posts every 4 m, plus glow points on some posts (reflectors). */
export function buildGuardrails(root, edges, glows, { color = 0xb8bcc8 } = {}) {
    const beamMaterial = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const posts = [];
    for (const line of [edges.left, edges.right]) {
        root.add(new THREE.Mesh(bandGeometry(line, 0.48, 0.82), beamMaterial));
        let walked = 0;
        for (let k = 0; k < line.length; k++) {
            const a = line[k];
            const b = line[(k + 1) % line.length];
            walked += Math.hypot(b.x - a.x, b.z - a.z);
            if (walked < 4) continue;
            walked = 0;
            posts.push(a);
        }
    }
    const postGeometry = new THREE.BoxGeometry(0.12, 0.9, 0.12);
    postGeometry.translate(0, 0.45, 0);
    const mesh = new THREE.InstancedMesh(postGeometry, new THREE.MeshLambertMaterial({ color: 0x8c8f9a }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((p, k) => {
        mesh.setMatrixAt(k, m.makeTranslation(p.x, p.y, p.z));
        if (glows && k % 4 === 0) glows.add(p.x, p.y + 0.75, p.z, 0.35, k % 8 === 0 ? 0xffb84a : 0xdfe6ff);
    });
    mesh.computeBoundingSphere();
    root.add(mesh);
}

/** Orange traffic cones (white band) at the given spots [{ x, y, z }], one InstancedMesh. */
export function buildCones(root, spots) {
    if (spots.length === 0) return;
    const base = tint(new THREE.BoxGeometry(0.5, 0.06, 0.5).translate(0, 0.03, 0), 0x222222);
    const lower = tint(new THREE.CylinderGeometry(0.12, 0.2, 0.36, 8).translate(0, 0.24, 0), 0xff6a1a);
    const band = tint(new THREE.CylinderGeometry(0.085, 0.12, 0.14, 8).translate(0, 0.49, 0), 0xf4f2ff);
    const top = tint(new THREE.CylinderGeometry(0.03, 0.085, 0.2, 8).translate(0, 0.66, 0), 0xff6a1a);
    const geometry = mergeGeometries([base, lower, band, top]);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a1204 });
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((p, k) => mesh.setMatrixAt(k, m.makeTranslation(p.x, p.y, p.z)));
    mesh.computeBoundingSphere();
    root.add(mesh);
}

/** Cone spots along both edges of the course: dense in corners, sparse on straights. */
export function coneSpots(course, offset = 0.4) {
    const spots = [];
    let next = 0;
    const d = course.width / 2 + offset;
    for (let i = 0; i < course.count; i++) {
        if (i * course.step < next) continue;
        const corner = Math.abs(course.k[i]) > 1 / 45;
        next = i * course.step + (corner ? 5 : 16);
        const lx = course.tz[i];
        const lz = -course.tx[i];
        spots.push({ x: course.x[i] + lx * d, y: course.y[i], z: course.z[i] + lz * d });
        spots.push({ x: course.x[i] - lx * d, y: course.y[i], z: course.z[i] - lz * d });
    }
    return spots;
}

/** The start line: a checkered band across the road at s = 0 and a gantry with lights above it. */
export function buildStartLine(root, course, glows, { gantry = true, colour = 0xff2e88 } = {}) {
    const p = course.at(0);
    const yaw = Math.atan2(p.tx, p.tz);
    const texture = canvasTexture(128, 16, (ctx, w, h) => {
        for (let x = 0; x < 16; x++) {
            for (let y = 0; y < 2; y++) {
                ctx.fillStyle = (x + y) % 2 ? '#f4f2ff' : '#16151f';
                ctx.fillRect(x * 8, y * 8, 8, 8);
            }
        }
    });
    const line = new THREE.Mesh(
        new THREE.PlaneGeometry(course.width, 1.4).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    // local x of the plane runs across the road (the left normal), local z along it
    line.position.set(p.x, p.y + 0.03, p.z);
    line.rotation.y = yaw;
    root.add(line);
    if (!gantry) return;
    const half = course.width / 2 + 1.2;
    const frame = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: 0x2a2838 });
    const legGeometry = new THREE.BoxGeometry(0.35, 6, 0.35).translate(0, 3, 0);
    for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeometry, steel);
        leg.position.set(side * half, 0, 0);
        frame.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.4, 0.9, 0.5), steel);
    beam.position.y = 6.2;
    frame.add(beam);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 1, 0.12, 0.1), new THREE.MeshBasicMaterial({ color: colour }));
    // the neon faces the cars that come towards the line
    neon.position.set(0, 5.8, -0.28);
    frame.add(neon);
    frame.position.set(p.x, p.y, p.z);
    frame.rotation.y = yaw;
    root.add(frame);
    if (glows) {
        for (let k = -2; k <= 2; k++) {
            const off = (k / 2) * (half - 1);
            glows.add(p.x + p.tz * off, p.y + 5.8, p.z - p.tx * off, 2.2, colour);
        }
    }
}
