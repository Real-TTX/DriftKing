// DriftKing · maps/pass-terrain.js – the ground of the Tenjō-Pass: fine strips along both sides of the road (the top of the cut rising
// with the hillside, the fill slope falling away behind the guardrail) and one terrain grid around them – fine over the course area,
// coarser rings out to the hills around the basin and the plain of the town. The grid sinks under the strips and the road (it never
// pokes through) and leaves out what they cover. One own material: the ground texture tinted per vertex (forest floor, grass, rock).

import * as THREE from 'three';
import { smoothstep } from '../../render/kit.js';
import { flipWinding, ownSurface, stripGeometry, TERRAIN } from './pass-layout.js';

/** Where the columns of a strip lie between its start and its end (fractions). */
const COLUMNS = [0, 0.03, 0.08, 0.16, 0.28, 0.45, 0.7, 1];

/**
 * Builds the strips and the grid into ctx.root; returns the shared terrain material (the cut faces' tops use it too).
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 */
export function buildTerrain(ctx, layout) {
    const { root, course, quality } = ctx;
    const material = ownSurface(ctx, ctx.textures.ground({ kind: 'grass' }), { vertexColors: true, normal: 0.8 });

    // ---- the strips along both sides
    const step = quality === 'low' ? 3 : 2;
    for (const [index, sign] of [[0, 1], [1, -1]]) {
        const geometry = stripGeometry(course, COLUMNS.length, (i, c, out) => {
            const start = layout.startOf(i, sign);
            const end = layout.extent[index][i];
            const d = start + (end - start) * COLUMNS[c];
            out.lat = d * sign;
            const x = course.x[i] + course.tz[i] * out.lat;
            const z = course.z[i] - course.tx[i] * out.lat;
            out.y = c === 0 && layout.side[i] !== sign ? course.y[i] - 0.08 : layout.profile(i, sign, d, x, z);
        }, { step });
        if (!geometry) continue;
        if (sign < 0) flipWinding(geometry);
        paint(geometry, layout, true);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        root.add(mesh);
    }

    // ---- the grid: fine in the course area, growing cells out to TERRAIN.far
    const cell = quality === 'low' ? 12 : quality === 'high' ? 5.5 : 7;
    const xs = axis(TERRAIN.minX, TERRAIN.maxX, cell, TERRAIN.far);
    const zs = axis(TERRAIN.minZ, TERRAIN.maxZ, cell, TERRAIN.far);
    const nx = xs.length;
    const nz = zs.length;
    const positions = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const covered = new Uint8Array(nx * nz);
    const distance = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        for (let k = 0; k < nx; k++) {
            const v = j * nx + k;
            const x = xs[k];
            const z = zs[j];
            let y;
            const at = layout.locate(x, z);
            distance[v] = at ? at.d : 999;
            if (at && at.d < at.extent - 0.6) {
                // under a strip or the road: sink well below it (the strip shows, the grid never pokes through)
                const top = at.d <= at.start ? course.y[at.i] : layout.profile(at.i, at.sign, at.d, x, z);
                y = Math.min(top, course.y[at.i] + 1) - 2.6;
                covered[v] = 1;
            } else {
                y = layout.natural(x, z);
            }
            positions.set([x, y, z], v * 3);
            uvs.set([x, -z], v * 2);
        }
    }
    const indices = [];
    for (let j = 0; j < nz - 1; j++) {
        for (let k = 0; k < nx - 1; k++) {
            const a = j * nx + k;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            // grid rows run +z: (a, c, b) faces up
            if (!(covered[a] && covered[c] && covered[b])) indices.push(a, c, b);
            if (!(covered[b] && covered[c] && covered[d])) indices.push(b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    paint(geometry, layout, false, distance);
    geometry.computeBoundingSphere();
    const grid = new THREE.Mesh(geometry, material);
    grid.receiveShadow = true;
    root.add(grid);
    return material;
}

/** Axis coordinates: cell spacing between min and max, then cells growing by 1.3 per step out to ±far. */
function axis(min, max, cell, far) {
    const core = [];
    const count = Math.round((max - min) / cell);
    for (let k = 0; k <= count; k++) core.push(min + ((max - min) * k) / count);
    const before = [];
    let c = cell;
    let v = min;
    while (v > -far) {
        c *= 1.3;
        v = Math.max(-far, v - c);
        before.unshift(v);
    }
    const after = [];
    c = cell;
    v = max;
    while (v < far) {
        c *= 1.3;
        v = Math.min(far, v + c);
        after.push(v);
    }
    return [...before, ...core, ...after];
}

const tmp = new THREE.Color();

/**
 * Vertex colours (multiplied with the grass texture): dry grass and weeds near the road, a dark forest floor of needles beyond,
 * grey rock on steep ground, the dark fields of the plain far below; a little large-scale variation everywhere.
 */
function paint(geometry, layout, strip, distance = null) {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const colours = new Float32Array(p.count * 3);
    const grass = new THREE.Color(1.0, 0.96, 0.82);
    const litter = new THREE.Color(0.66, 0.5, 0.4);
    const rock = new THREE.Color(0.74, 0.72, 0.74);
    const field = new THREE.Color(0.5, 0.52, 0.42);
    const course = layout.course;
    for (let v = 0; v < p.count; v++) {
        const x = p.getX(v);
        const y = p.getY(v);
        const z = p.getZ(v);
        const up = n.getY(v);
        let d = distance ? distance[v] : 0;
        if (strip) {
            const i = layout.nearestSample(x, z);
            d = i >= 0 ? Math.hypot(x - course.x[i], z - course.z[i]) : 30;
        }
        const wobble = 0.5 + 0.25 * Math.sin(x * 0.043 + z * 0.031) + 0.25 * Math.sin(x * 0.11 - z * 0.087 + 1.7);
        tmp.copy(litter).lerp(grass, (1 - smoothstep(8, 17 + wobble * 6, d)) * 0.85);
        tmp.lerp(rock, smoothstep(0.62, 0.42, up) * 0.8);
        tmp.lerp(field, smoothstep(-40, -58, y));
        tmp.multiplyScalar(0.78 + wobble * 0.36);
        colours[v * 3] = tmp.r;
        colours[v * 3 + 1] = tmp.g;
        colours[v * 3 + 2] = tmp.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}
