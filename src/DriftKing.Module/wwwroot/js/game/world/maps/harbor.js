// DriftKing · maps/harbor.js – "Kaikō-Docks": a container port at night. Wide asphalt, stacks of containers forming corridors, gantry cranes
// on the quay, a moored ship, sodium light masts, a fence around and the water in the south. Flat at y = 0, the course marked by cones.

import * as THREE from 'three';
import { buildCones, buildStartLine, coneSpots, ribbonGeometry } from '../road.js';
import { buildingGeometry, buildingMesh, windowTexture } from '../props.js';
import { box, canvasTexture, mergeGeometries, rng, tint } from '../../render/kit.js';

const MIN_X = -185;
const MAX_X = 185;
const MIN_Z = -125;
const QUAY_Z = 118;
const CONTAINER = { l: 12.2, w: 2.44, h: 2.6 };
const CONTAINER_COLOURS = [0x9c3b2e, 0x2f5f9e, 0x2f7a55, 0xd2702a, 0x8c8f99, 0x1f7f86, 0xc9a43a, 0x6a3a7a, 0xb4b8c0];

export function build(ctx) {
    const { root, course, colliders, glows, pools, random, detail } = ctx;
    const clear = course.width / 2 + 3;
    const free = (x, z, r = 0) => course.distanceTo(x, z) > clear + r;

    buildGround(root, course);
    buildCones(root, coneSpots(course, 0.6));
    buildStartLine(root, course, glows, { colour: 0xffb020 });
    buildFence(root, colliders, glows);
    buildQuay(root, colliders, glows, pools);
    buildContainers(root, colliders, random, free);
    buildMasts(root, colliders, glows, pools, free);
    buildCranes(root, colliders, glows);
    buildShip(root, glows);
    buildWarehouses(root, glows, pools, detail);
    return { flatY: 0 };
}

function buildGround(root, course) {
    const random = rng(12);
    const asphalt = canvasTexture(256, 256, (c, w) => {
        c.fillStyle = '#2b2a31';
        c.fillRect(0, 0, w, w);
        for (let k = 0; k < 40; k++) {
            c.fillStyle = `rgba(${random() < 0.5 ? '20,20,26' : '58,56,64'},${0.2 + random() * 0.3})`;
            c.fillRect(random() * w, random() * w, 10 + random() * 60, 10 + random() * 60);
        }
        for (let k = 0; k < 1800; k++) {
            const v = 30 + random() * 30;
            c.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
            c.fillRect(random() * w, random() * w, 2, 2);
        }
    }, { repeat: true });
    asphalt.repeat.set(40, 30);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAX_X - MIN_X + 40, QUAY_Z - MIN_Z + 20).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: asphalt }));
    ground.position.set(0, 0, (QUAY_Z + MIN_Z) / 2 - 10);
    ground.receiveShadow = true;
    root.add(ground);
    // painted lane marks of the yard (yellow) along the course
    const paint = new THREE.MeshBasicMaterial({ color: 0xd8a326, polygonOffset: true, polygonOffsetFactor: -2, transparent: true, opacity: 0.75 });
    root.add(new THREE.Mesh(mergeGeometries([
        ribbonGeometry(course, course.width / 2 - 0.35, course.width / 2 - 0.15, { lift: 0.02 }),
        ribbonGeometry(course, -course.width / 2 + 0.15, -course.width / 2 + 0.35, { lift: 0.02 }),
    ]), paint));
}

/** A fence around the yard (north, east, west): jersey barriers with a mesh fence above, the walls of the arena. */
function buildFence(root, colliders, glows) {
    const corners = [[MIN_X, QUAY_Z], [MIN_X, MIN_Z], [MAX_X, MIN_Z], [MAX_X, QUAY_Z]];
    const barriers = [];
    const fences = [];
    for (let k = 0; k < corners.length - 1; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[k + 1];
        colliders.addSegment(ax, az, bx, bz);
        const length = Math.hypot(bx - ax, bz - az);
        const yaw = Math.atan2(bx - ax, bz - az);
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        barriers.push(box(0.6, 0.9, length, mx, 0.45, mz, yaw));
        fences.push(new THREE.PlaneGeometry(length, 2.6).rotateY(yaw + Math.PI / 2).translate(mx, 2.2, mz));
        for (let t = 0; t <= length; t += 30) glows.add(ax + ((bx - ax) * t) / length, 3.7, az + ((bz - az) * t) / length, 1.2, 0xffb84a);
    }
    root.add(new THREE.Mesh(mergeGeometries(barriers), new THREE.MeshLambertMaterial({ color: 0x9d9ba8 })));
    const mesh = canvasTexture(64, 64, (c, w) => {
        c.strokeStyle = 'rgba(190,195,210,0.55)';
        c.lineWidth = 2;
        for (let k = -w; k < w * 2; k += 12) {
            c.beginPath();
            c.moveTo(k, 0);
            c.lineTo(k + w, w);
            c.moveTo(k + w, 0);
            c.lineTo(k, w);
            c.stroke();
        }
    }, { repeat: true });
    mesh.repeat.set(120, 1);
    root.add(new THREE.Mesh(mergeGeometries(fences), new THREE.MeshLambertMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
}

/** The quay: its edge (a wall the cars bounce off), bollards, the water below and light streaks on it. */
function buildQuay(root, colliders, glows, pools) {
    colliders.addSegment(MAX_X, QUAY_Z, MIN_X, QUAY_Z);
    const edge = [box(MAX_X - MIN_X, 3, 1.2, 0, -1.5, QUAY_Z + 0.6), tint(box(MAX_X - MIN_X, 0.25, 0.5, 0, 0.12, QUAY_Z - 0.3), 0xe0c040)];
    edge[0] = tint(edge[0], 0x6a6874);
    const bollards = [];
    for (let x = MIN_X + 10; x < MAX_X; x += 16) {
        bollards.push(tint(new THREE.CylinderGeometry(0.25, 0.32, 0.7, 8).translate(x, 0.35, QUAY_Z - 1.2), 0x2c2a36));
        colliders.addCircle(x, QUAY_Z - 1.2, 0.35);
    }
    root.add(new THREE.Mesh(mergeGeometries([...edge, ...bollards]), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 700).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x0a1424, emissive: 0x050a18 }));
    water.position.set(0, -2.6, QUAY_Z + 350);
    root.add(water);
    const random = rng(88);
    for (let k = 0; k < 40; k++) {
        const x = MIN_X + random() * (MAX_X - MIN_X);
        pools.add(x, -2.55, QUAY_Z + 8 + random() * 60, 4 + random() * 6, random() < 0.7 ? 0xffae42 : 0x29e7ff, 0.25);
    }
}

/** Container stacks on a grid of blocks (4 rows, aisles between), only where the course leaves room. Instanced; colliders per footprint. */
function buildContainers(root, colliders, random, free) {
    const instances = [];
    for (let bz = MIN_Z + 6; bz < QUAY_Z - 16; bz += 20) {
        for (let row = 0; row < 4; row++) {
            const z = bz + row * (CONTAINER.w + 0.3);
            for (let x = MIN_X + 10; x < MAX_X - 10; x += CONTAINER.l + 0.5) {
                if (!free(x, z, CONTAINER.l / 2 + 1) || random() < 0.12) continue;
                const stack = 1 + Math.floor(random() * random() * 4);
                for (let level = 0; level < stack; level++) {
                    instances.push({ x, y: level * CONTAINER.h, z, colour: CONTAINER_COLOURS[Math.floor(random() * CONTAINER_COLOURS.length)] });
                }
                colliders.addBox(x, z, CONTAINER.l / 2, CONTAINER.w / 2);
            }
        }
    }
    const ribs = canvasTexture(128, 32, (c, w, h) => {
        c.fillStyle = '#d8d8de';
        c.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 4) {
            c.fillStyle = x % 8 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)';
            c.fillRect(x, 0, 2, h);
        }
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(0, 0, w, 2);
        c.fillRect(0, h - 2, w, 2);
    }, { repeat: true });
    ribs.repeat.set(4, 1);
    const geometry = new THREE.BoxGeometry(CONTAINER.l, CONTAINER.h - 0.04, CONTAINER.w).translate(0, CONTAINER.h / 2, 0);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ map: ribs }), instances.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    instances.forEach((p, k) => {
        mesh.setMatrixAt(k, m.makeTranslation(p.x, p.y, p.z));
        mesh.setColorAt(k, c.setHex(p.colour));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
}

/** Tall sodium light masts with four heads each: big orange pools, glows; posts are colliders. */
function buildMasts(root, colliders, glows, pools, free) {
    const masts = [];
    for (let x = MIN_X + 30; x < MAX_X; x += 55) {
        for (let z = MIN_Z + 25; z < QUAY_Z; z += 50) {
            if (!free(x, z, 1)) continue;
            masts.push([x, z]);
        }
    }
    const parts = [];
    for (const [x, z] of masts) {
        parts.push(new THREE.CylinderGeometry(0.25, 0.45, 20, 6).translate(x, 10, z));
        parts.push(box(3.2, 0.3, 0.3, x, 20, z));
        colliders.addCircle(x, z, 0.6);
        for (const o of [-1.2, -0.4, 0.4, 1.2]) glows.add(x + o, 19.7, z, 4.5, 0xffae42);
        pools.add(x, 0, z, 26, 0xffa040, 0.6);
    }
    if (parts.length) root.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0x4a4856 })));
}

/** Three gantry cranes on the quay: legs (colliders), a beam and a boom out over the water, red lights on top. */
function buildCranes(root, colliders, glows) {
    const orange = [];
    const white = [];
    for (const x of [-110, 10, 120]) {
        for (const dx of [-7, 7]) {
            for (const z of [QUAY_Z - 12, QUAY_Z - 2]) {
                orange.push(box(1.1, 34, 1.1, x + dx, 17, z));
                colliders.addBox(x + dx, z, 0.7, 0.7);
            }
            orange.push(box(1, 1, 11, x + dx, 4, QUAY_Z - 7));
        }
        orange.push(box(16, 2.2, 2, x, 33, QUAY_Z - 12), box(16, 2.2, 2, x, 33, QUAY_Z - 2));
        white.push(box(3, 2.4, 70, x, 36, QUAY_Z + 18));
        white.push(box(5, 4, 6, x, 31.5, QUAY_Z + 4));
        glows.add(x, 38.5, QUAY_Z + 52, 3, 0xff3030);
        glows.add(x, 38.5, QUAY_Z - 16, 3, 0xff3030);
        glows.add(x, 31.5, QUAY_Z + 7.2, 2.5, 0xfff0c0);
    }
    root.add(new THREE.Mesh(mergeGeometries(orange), new THREE.MeshLambertMaterial({ color: 0xd2642a })));
    root.add(new THREE.Mesh(mergeGeometries(white), new THREE.MeshLambertMaterial({ color: 0xd8d6e0 })));
}

/** A container ship moored beyond the quay: dark hull, a deck of containers, the lit bridge. */
function buildShip(root, glows) {
    const random = rng(5);
    const hull = tint(box(190, 14, 30, 10, -4, QUAY_Z + 34), 0x1c2232);
    const stripe = tint(box(190.2, 1.2, 30.2, 10, -8, QUAY_Z + 34), 0x8a2a2a);
    const bridge = tint(box(16, 14, 24, -70, 10, QUAY_Z + 34), 0xd8d6e0);
    const cargo = [];
    for (let x = -50; x < 95; x += 12.6) {
        const h = 2 + Math.floor(random() * 4);
        cargo.push(tint(box(12.2, h * 2.6, 26, x, 3 + h * 1.3, QUAY_Z + 34), CONTAINER_COLOURS[Math.floor(random() * CONTAINER_COLOURS.length)]));
    }
    root.add(new THREE.Mesh(mergeGeometries([hull, stripe, bridge, ...cargo]), new THREE.MeshLambertMaterial({ vertexColors: true })));
    for (let k = 0; k < 6; k++) glows.add(-70 + (k - 2.5) * 2.4, 14, QUAY_Z + 21.8, 1.4, 0xfff0c0);
    glows.add(-70, 19, QUAY_Z + 34, 3, 0xff3030);
    glows.add(100, 6, QUAY_Z + 34, 3, 0x3ef08a);
}

/** Warehouses north of the fence with lit loading doors, and the town behind. */
function buildWarehouses(root, glows, pools, detail) {
    const random = rng(19);
    const geometries = [];
    for (let x = MIN_X + 20; x < MAX_X; x += 62) {
        const w = 52 + random() * 6;
        geometries.push(buildingGeometry(w, 14 + random() * 6, 30, x + w / 2 - 20, 0, MIN_Z - 30, 0, random));
        for (let d = -2; d <= 2; d++) {
            const dx = x + w / 2 - 20 + d * 9;
            glows.add(dx, 4.5, MIN_Z - 14.6, 2.2, 0xffd9a0);
            pools.add(dx, 0, MIN_Z - 12, 5, 0xffd090, 0.35);
        }
    }
    for (let k = 0; k < 70 * detail; k++) {
        const x = -500 + random() * 1000;
        const z = MIN_Z - 90 - random() * 300;
        geometries.push(buildingGeometry(16 + random() * 24, 10 + random() * 50, 16 + random() * 24, x, 0, z, random() * Math.PI, random));
    }
    root.add(buildingMesh(geometries, windowTexture(41, 0.3), { colour: 0x6e6c80 }));
    const land = new THREE.Mesh(new THREE.PlaneGeometry(1600, 700).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x17161f }));
    land.position.set(0, -0.06, MIN_Z - 330);
    root.add(land);
}
