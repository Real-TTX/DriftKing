// DriftKing · maps/city.js – "Neon-Viertel": a closed street circuit around city blocks. Wide streets, raised sidewalks with kerbs (the walls),
// facades with lit windows, invented neon signs, shop light on the pavement, crossings, a long sweeper. Flat at y = 0.

import * as THREE from 'three';
import { bandGeometry, buildRoadStrip, buildStartLine, courseEdges, ribbonGeometry, roadTexture } from '../road.js';
import { buildingGeometry, buildingMesh, buildLamps, NEON_COLOURS, Signs, signAtlases, windowTexture } from '../props.js';
import { canvasTexture, mergeGeometries } from '../../render/kit.js';

const SIDEWALK = 4.5;

export function build(ctx) {
    const { root, course, colliders, glows } = ctx;
    const half = course.width / 2;

    // the ground between the blocks, the road and the raised sidewalks with their kerb faces
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1b1a24 }));
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    root.add(ground);
    root.add(buildRoadStrip(course, new THREE.MeshLambertMaterial({ map: roadTexture({ centre: '#f2c94c', seed: 9 }) })));
    const paving = canvasTexture(128, 128, (c, w) => {
        c.fillStyle = '#4a4856';
        c.fillRect(0, 0, w, w);
        c.strokeStyle = '#3a3846';
        c.lineWidth = 3;
        for (let k = 0; k <= 4; k++) {
            c.beginPath();
            c.moveTo(0, k * 32);
            c.lineTo(w, k * 32);
            c.moveTo(k * 32, 0);
            c.lineTo(k * 32, w);
            c.stroke();
        }
    }, { repeat: true });
    const sidewalkMaterial = new THREE.MeshLambertMaterial({ map: paving });
    root.add(new THREE.Mesh(mergeGeometries([
        ribbonGeometry(course, half, half + SIDEWALK, { lift: 0.15, repeat: 2 }),
        ribbonGeometry(course, -half - SIDEWALK, -half, { lift: 0.15, repeat: 2 }),
    ]), sidewalkMaterial));
    const kerb = courseEdges(course, 0, { every: 1 });
    const kerbMaterial = new THREE.MeshLambertMaterial({ color: 0x8f8d9c, side: THREE.DoubleSide });
    root.add(new THREE.Mesh(mergeGeometries([bandGeometry(kerb.left, 0, 0.16), bandGeometry(kerb.right, 0, 0.16)]), kerbMaterial));
    // the walls: just behind the kerb (a car bounces off the kerb and the railing)
    courseEdges(course, 0.35, { every: 2, colliders });
    const rail = courseEdges(course, 0.55, { every: 2 });
    const railMaterial = new THREE.MeshLambertMaterial({ color: 0xc9c7d6, side: THREE.DoubleSide });
    root.add(new THREE.Mesh(mergeGeometries([bandGeometry(rail.left, 0.85, 0.95), bandGeometry(rail.right, 0.85, 0.95),
        bandGeometry(rail.left, 0.45, 0.5), bandGeometry(rail.right, 0.45, 0.5)]), railMaterial));

    buildStartLine(root, course, glows, { colour: 0x29e7ff });
    buildCrossings(root, course);
    buildStreetLamps(ctx);
    buildBlocks(ctx);
    return { flatY: 0 };
}

/** Lamps on the sidewalks every 34 m, alternating sides, the arm over the road. */
function buildStreetLamps({ root, course, glows, pools }) {
    const spots = [];
    const d = course.width / 2 + 1.2;
    let side = 1;
    for (let s = 10; s < course.length; s += 34) {
        const p = course.at(s);
        const lx = p.tz * side;
        const lz = -p.tx * side;
        spots.push({ x: p.x + lx * d, y: 0.15, z: p.z + lz * d, yaw: Math.atan2(-lx, -lz) });
        side = -side;
    }
    buildLamps(root, spots, glows, pools, { colour: 0xbfd8ff, height: 8.5, arm: 3, pool: 10, strength: 0.5 });
}

/** Zebra crossings on the long straights. */
function buildCrossings(root, course) {
    const stripes = [];
    for (let s = 60; s < course.length; s += 150) {
        const p = course.at(s);
        if (Math.abs(p.k) > 1 / 200) continue;
        const yaw = Math.atan2(p.tx, p.tz);
        for (let k = -5; k <= 5; k++) {
            const off = k * 1.2;
            const g = new THREE.PlaneGeometry(0.6, 3.2).rotateX(-Math.PI / 2);
            g.rotateY(yaw);
            g.translate(p.x + p.tz * off, 0.035, p.z - p.tx * off);
            stripes.push(g);
        }
    }
    if (stripes.length === 0) return;
    root.add(new THREE.Mesh(mergeGeometries(stripes), new THREE.MeshLambertMaterial({ color: 0xd8d6e2, polygonOffset: true, polygonOffsetFactor: -2 })));
}

/**
 * The blocks: a row of buildings along both sides of the road (fronts behind the sidewalk), filler buildings further away, neon signs and shop
 * light on the fronts. A footprint never comes near another part of the road.
 */
function buildBlocks({ root, course, glows, pools, random, detail }) {
    const facade = windowTexture(17, 0.42);
    const signs = new Signs(glows);
    const geometries = [];
    const shopFronts = [];
    const front = course.width / 2 + SIDEWALK + 0.4;
    const clear = course.width / 2 + SIDEWALK;
    const fits = (x, z, w, d, yaw) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
            const px = x + (u * w * c) / 2 + (v * d * s) / 2;
            const pz = z - (u * w * s) / 2 + (v * d * c) / 2;
            if (course.distanceTo(px, pz) < clear) return false;
        }
        return true;
    };
    for (const side of [1, -1]) {
        let s = random() * 10;
        while (s < course.length) {
            const width = 12 + random() * 16;
            const p = course.at(s + width / 2);
            s += width + 0.8;
            if (Math.abs(p.k) > 1 / 30) continue;
            const depth = 14 + random() * 18;
            const height = 10 + Math.pow(random(), 1.5) * 46;
            const lx = p.tz * side;
            const lz = -p.tx * side;
            const cx = p.x + lx * (front + depth / 2);
            const cz = p.z + lz * (front + depth / 2);
            // the front (local +z) looks at the road
            const yaw = Math.atan2(-lx, -lz);
            if (!fits(cx, cz, width, depth, yaw)) continue;
            geometries.push(buildingGeometry(width, height, depth, cx, 0, cz, yaw, random));
            const fx = p.x + lx * (front - 0.05);
            const fz = p.z + lz * (front - 0.05);
            shopFronts.push({ x: fx, z: fz, yaw, width, colour: NEON_COLOURS[Math.floor(random() * NEON_COLOURS.length)] });
            decorate(signs, pools, random, { x: fx, z: fz, lx, lz, yaw, width, height, colour: shopFronts[shopFronts.length - 1].colour });
        }
    }
    // fillers behind the first row (inside the blocks and around), a little taller
    const fillers = Math.round(140 * Math.min(1.3, detail));
    for (let k = 0; k < fillers; k++) {
        const x = -320 + random() * 640;
        const z = -260 + random() * 520;
        const w = 14 + random() * 22;
        const d = 14 + random() * 22;
        const yaw = Math.floor(random() * 4) * (Math.PI / 2);
        if (!fits(x, z, w + 14, d + 14, yaw)) continue;
        geometries.push(buildingGeometry(w, 16 + Math.pow(random(), 1.4) * 70, d, x, 0, z, yaw, random));
    }
    root.add(buildingMesh(geometries, facade, { colour: 0x7c7a92 }));
    buildShopFronts(root, shopFronts);
    signs.build(root, signAtlases(23));
}

/** A neon sign on a front: a tall one at a corner (sticking out) or a wide one above the shop, sometimes both; the shop light on the pavement. */
function decorate(signs, pools, random, f) {
    const tangentX = Math.cos(f.yaw);
    const tangentZ = -Math.sin(f.yaw);
    if (random() < 0.7 && f.height > 12) {
        const along = (random() < 0.5 ? -1 : 1) * (f.width / 2 - 1.2);
        const h = 6 + random() * 4;
        // perpendicular to the front: readable for cars coming along the road
        signs.add('tall', Math.floor(random() * 4), f.x + tangentX * along - f.lx * 0.9, 4 + h / 2 + random() * 3, f.z + tangentZ * along - f.lz * 0.9, 1.4, h, f.yaw + Math.PI / 2);
    }
    if (random() < 0.65) {
        const w = Math.min(f.width - 2, 7 + random() * 3);
        signs.add('wide', Math.floor(random() * 4), f.x - f.lx * 0.12, 4.6 + random() * 2.5, f.z - f.lz * 0.12, w, w / 4, f.yaw);
    }
    // the shop light on the sidewalk
    pools.add(f.x - f.lx * 2.4, 0.15, f.z - f.lz * 2.4, f.width * 0.45, f.colour, 0.35);
}

/** Lit shop windows on the ground floor of the fronts (panes in dark frames, a neon awning line), tinted by the shop's colour. */
function buildShopFronts(root, fronts) {
    const texture = canvasTexture(256, 96, (c, w, h) => {
        c.fillStyle = '#16141f';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, 8);
        for (let k = 0; k < 4; k++) {
            const g = c.createLinearGradient(0, 18, 0, h - 6);
            g.addColorStop(0, '#fff3dc');
            g.addColorStop(1, '#b89a78');
            c.fillStyle = g;
            c.fillRect(8 + k * 62, 18, 52, h - 26);
            c.fillStyle = 'rgba(20,16,30,0.55)';
            c.fillRect(8 + k * 62 + 10 + (k * 7) % 20, 40, 14, h - 48);
        }
    }, { repeat: true });
    const geometries = [];
    const colours = [];
    for (const f of fronts) {
        const g = new THREE.PlaneGeometry(f.width - 1.6, 2.8);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) * (f.width - 1.6)) / 7);
        g.rotateY(f.yaw);
        g.translate(f.x, 1.75, f.z);
        const c = new THREE.Color(f.colour).lerp(new THREE.Color(0xffe6c0), 0.6).multiplyScalar(0.8);
        const count = g.attributes.position.count;
        for (let k = 0; k < count; k++) colours.push(c.r, c.g, c.b);
        geometries.push(g);
    }
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries);
    merged.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    root.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ map: texture, vertexColors: true })));
}
