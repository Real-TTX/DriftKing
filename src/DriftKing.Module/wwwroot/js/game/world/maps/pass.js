// DriftKing · maps/pass.js – "Tenjō-Pass": a mountain loop at night. Up the east face in hairpins, over the ridge, down the west side in esses,
// guardrails on both sides, chevron signs before the hairpins, a forest of low-poly conifers, the lights of the town far below in the south.

import * as THREE from 'three';
import { buildGuardrails, buildRoadStrip, buildStartLine, courseEdges, ribbonGeometry, roadTexture } from '../road.js';
import { buildLamps, buildSkyline, buildTrees, windowTexture } from '../props.js';
import { canvasTexture, mergeGeometries, rng, smoothstep } from '../../render/kit.js';

const TERRAIN = { minX: -480, maxX: 460, minZ: -440, maxZ: 480 };

export function build(ctx) {
    const { root, course, colliders, glows, pools, random, detail } = ctx;
    const half = course.width / 2;
    const field = heightField(course);

    root.add(buildRoadStrip(course, new THREE.MeshLambertMaterial({ map: roadTexture({ centre: '#f4f2ff', seed: 4 }) })));
    root.add(new THREE.Mesh(mergeGeometries([
        ribbonGeometry(course, half, half + 1.6, { lift: 0.0 }),
        ribbonGeometry(course, -half - 1.6, -half, { lift: 0.0 }),
    ]), new THREE.MeshLambertMaterial({ color: 0x3b3a40 })));
    courseEdges(course, 0.55, { every: 2, colliders });
    buildGuardrails(root, courseEdges(course, 0.75, { every: 2 }), glows);
    buildStartLine(root, course, glows, { colour: 0xff2e88 });
    root.add(buildTerrain(field, course, detail));
    buildForest(root, field, course, random, detail);
    buildHairpins(root, course, glows, pools);
    buildTownBelow(root, glows, detail);
    return {};
}

/**
 * The height of the mountain at (x, z): close to the road it is the road's height (weighted by distance over all road parts nearby, so
 * the slope between two legs of a switchback is even), far away a ridge rising to the north with a summit inside the loop and gentle hills.
 */
function heightField(course) {
    const xs = [];
    const zs = [];
    const ys = [];
    for (let i = 0; i < course.count; i += 4) {
        xs.push(course.x[i]);
        zs.push(course.z[i]);
        ys.push(course.y[i]);
    }
    const mountain = (x, z) =>
        28 - z * 0.13 + 26 * Math.exp(-((x - 20) ** 2 + (z + 40) ** 2) / (2 * 110 ** 2)) + 5 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + 3 * Math.sin(x * 0.05 + z * 0.04);
    return (x, z) => {
        let sum = 0;
        let weight = 0;
        let nearest = Infinity;
        let nearestY = 0;
        for (let k = 0; k < xs.length; k++) {
            const d2 = (xs[k] - x) ** 2 + (zs[k] - z) ** 2;
            if (d2 < nearest) {
                nearest = d2;
                nearestY = ys[k];
            }
            const w = 1 / (d2 + 30) ** 1.5;
            sum += ys[k] * w;
            weight += w;
        }
        const d = Math.sqrt(nearest);
        const road = sum / weight;
        const far = smoothstep(16, 90, d);
        let y = road + (mountain(x, z) - road) * far;
        // close to the road the ground lies just below the asphalt
        const edge = course.width / 2 + 2;
        if (d < edge + 8) y = nearestY - 0.35 + (y - nearestY + 0.35) * smoothstep(edge, edge + 8, d);
        return { y, d };
    };
}

/** The terrain grid with colours: grass in the valleys, darker forest floor, rock on the steep parts. */
function buildTerrain(field, course, detail) {
    const cell = detail < 0.7 ? 9 : detail > 1.2 ? 5 : 6.5;
    const width = TERRAIN.maxX - TERRAIN.minX;
    const depth = TERRAIN.maxZ - TERRAIN.minZ;
    const nx = Math.round(width / cell);
    const nz = Math.round(depth / cell);
    const geometry = new THREE.PlaneGeometry(width, depth, nx, nz).rotateX(-Math.PI / 2);
    geometry.translate((TERRAIN.minX + TERRAIN.maxX) / 2, 0, (TERRAIN.minZ + TERRAIN.maxZ) / 2);
    const position = geometry.attributes.position;
    const distances = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
        const { y, d } = field(position.getX(i), position.getZ(i));
        position.setY(i, y);
        distances[i] = d;
    }
    geometry.computeVertexNormals();
    const normal = geometry.attributes.normal;
    const colours = new Float32Array(position.count * 3);
    const grass = new THREE.Color(0x2a4a3a);
    const moss = new THREE.Color(0x1f3a30);
    const rock = new THREE.Color(0x4c4a58);
    const gravel = new THREE.Color(0x3a3940);
    const c = new THREE.Color();
    const random = rng(3);
    for (let i = 0; i < position.count; i++) {
        const steep = 1 - normal.getY(i);
        const d = distances[i];
        c.copy(grass).lerp(moss, random() * 0.6);
        c.lerp(rock, smoothstep(0.12, 0.35, steep));
        c.lerp(gravel, 1 - smoothstep(course.width / 2 + 1, course.width / 2 + 5, d));
        colours.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    return mesh;
}

/** Conifers everywhere off the road (a clearing around it), denser further away. */
function buildForest(root, field, course, random, detail) {
    const target = Math.round(2200 * detail);
    const spots = [];
    let tries = 0;
    while (spots.length < target && tries < target * 4) {
        tries++;
        const x = TERRAIN.minX + 20 + random() * (TERRAIN.maxX - TERRAIN.minX - 40);
        const z = TERRAIN.minZ + 20 + random() * (TERRAIN.maxZ - TERRAIN.minZ - 40);
        const { y, d } = field(x, z);
        if (d < course.width / 2 + 7) continue;
        if (d < 30 && random() < 0.5) continue;
        spots.push({ x, y, z, s: 0.9 + random() * 1.1 });
    }
    buildTrees(root, spots, random);
}

/** Chevron boards on the outside of the hairpins and a sodium lamp at each one. */
function buildHairpins(root, course, glows, pools) {
    const chevron = canvasTexture(128, 64, (c, w, h) => {
        c.fillStyle = '#16151f';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffd23a';
        for (let k = 0; k < 3; k++) {
            const x = 18 + k * 34;
            c.beginPath();
            c.moveTo(x, 8);
            c.lineTo(x + 18, h / 2);
            c.lineTo(x, h - 8);
            c.lineTo(x + 12, h - 8);
            c.lineTo(x + 30, h / 2);
            c.lineTo(x + 12, 8);
            c.fill();
        }
    });
    const boards = [];
    const lamps = [];
    let last = -100;
    for (let i = 0; i < course.count; i++) {
        const s = i * course.step;
        const k = course.k[i];
        if (Math.abs(k) < 1 / 22 || s - last < 60) continue;
        last = s;
        const side = k > 0 ? -1 : 1; // the outside of the turn
        const p = course.at(s + 6);
        const lx = p.tz * side;
        const lz = -p.tx * side;
        const d = course.width / 2 + 1.6;
        // boards face the cars arriving (looking back along the course); the arrows point into the turn
        const yaw = Math.atan2(-p.tx, -p.tz);
        for (const o of [-6, 0, 6]) {
            const q = course.at(s + 6 + o);
            const g = new THREE.PlaneGeometry(1.6, 0.8);
            if (side > 0) g.scale(-1, 1, 1);
            g.rotateY(yaw);
            g.translate(q.x + q.tz * side * d, q.y + 1.3, q.z - q.tx * side * d);
            boards.push(g);
        }
        lamps.push({ x: p.x + lx * (d + 1), y: p.y, z: p.z + lz * (d + 1), yaw: Math.atan2(-lx, -lz) });
    }
    if (boards.length) root.add(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshBasicMaterial({ map: chevron, side: THREE.DoubleSide, color: 0xb8b0a0 })));
    buildLamps(root, lamps, glows, pools, { colour: 0xffb050, height: 7.5, arm: 2.6, pool: 12, strength: 0.6 });
}

/** The town far below in the south: a plain with thousands of lights and a few towers. */
function buildTownBelow(root, glows, detail) {
    const random = rng(99);
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x0f0e18 }));
    plain.position.set(0, -60, 980);
    root.add(plain);
    const colours = [0xffc070, 0xffd9a0, 0xbfd8ff, 0xff2e88, 0x29e7ff, 0xffae42];
    for (let k = 0; k < 1400 * detail; k++) {
        glows.add(-900 + random() * 1800, -59, 520 + random() * 700, 4 + random() * 5, colours[Math.floor(random() * colours.length)]);
    }
    buildSkyline(root, glows, { cx: 0, cz: 900, y: -60, inner: 0, outer: 340, count: Math.round(50 * detail), seed: 61, maxHeight: 110, texture: windowTexture(51, 0.45) });
}
