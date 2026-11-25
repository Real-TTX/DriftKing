// DriftKing · maps/deck.js – "Parkdeck 7": the open roof of a multi-storey car park above the city. A concrete deck with painted bays,
// light poles, stairwells and parked cars as obstacles, parapet walls around it, the course marked by cones; the city lies 26 m below.

import * as THREE from 'three';
import { buildCones, buildStartLine, coneSpots, ribbonGeometry } from '../road.js';
import { buildLamps, buildParkedCars, buildSkyline, windowTexture } from '../props.js';
import { box, canvasTexture, mergeGeometries, rng, tint } from '../../render/kit.js';

const HALF_X = 80;
const HALF_Z = 56;
const DROP = 26;

export function build(ctx) {
    const { root, course, colliders, glows, pools, random, detail } = ctx;
    const clear = course.width / 2 + 2.5;
    const free = (x, z, r = 0) => course.distanceTo(x, z) > clear + r;

    buildSlab(root);
    buildParapet(root, colliders, glows);
    // a faint painted guide line in the middle of the course
    root.add(new THREE.Mesh(ribbonGeometry(course, -0.12, 0.12, { lift: 0.03, repeat: 4 }), new THREE.MeshBasicMaterial({
        map: canvasTexture(8, 64, (c, w, h) => {
            c.fillStyle = 'rgba(255,214,90,0.9)';
            c.fillRect(0, 0, w, h * 0.5);
        }, { repeat: true }),
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
    })));
    buildCones(root, coneSpots(course, 0.5));
    buildStartLine(root, course, glows, { gantry: false });

    // light poles on a grid where the course leaves room
    const lamps = [];
    for (let x = -66; x <= 66; x += 22) {
        for (let z = -44; z <= 44; z += 22) {
            if (!free(x, z, 1)) continue;
            lamps.push({ x, y: 0, z, yaw: 0 }, { x, y: 0, z, yaw: Math.PI });
            colliders.addCircle(x, z, 0.3);
        }
    }
    buildLamps(root, lamps, glows, pools, { colour: 0xcfeaff, height: 7, arm: 1.2, pool: 9, strength: 0.13 });

    // stairwells in two corners, the lift tower with the "P7" sign
    const blocks = [
        { x: -72, z: -48, w: 10, d: 8, h: 4.2 },
        { x: 72, z: 49, w: 10, d: 8, h: 4.2 },
        { x: 70, z: -50, w: 7, d: 7, h: 7.5 },
    ];
    const blockGeometries = [];
    for (const b of blocks) {
        if (!free(b.x, b.z, Math.max(b.w, b.d) / 2)) continue;
        blockGeometries.push(box(b.w, b.h, b.d, b.x, b.h / 2, b.z));
        colliders.addBox(b.x, b.z, b.w / 2, b.d / 2);
        glows.add(b.x, b.h - 0.6, b.z + b.d / 2 + 0.1, 1.2, 0x3ef08a);
    }
    if (blockGeometries.length) root.add(new THREE.Mesh(mergeGeometries(blockGeometries), new THREE.MeshLambertMaterial({ color: 0x8c8a98 })));
    buildRoofSign(root, glows);

    // parked cars in the bays along the parapets
    const parked = [];
    for (let x = -62; x <= 62; x += 2.8) {
        for (const z of [-HALF_Z + 4, HALF_Z - 4]) {
            if (random() < 0.45 || !free(x, z, 2.5)) continue;
            parked.push({ x, y: 0, z, yaw: random() < 0.5 ? 0 : Math.PI });
            colliders.addBox(x, z, 0.95, 2.15);
        }
    }
    buildParkedCars(root, parked, random);
    buildBays(root);
    buildCityBelow(root, glows, detail);
    return { flatY: 0 };
}

/** The concrete deck with stains and the facade of the car park below it (levels and dark openings). */
function buildSlab(root) {
    const random = rng(71);
    const concrete = canvasTexture(256, 256, (c, w) => {
        c.fillStyle = '#44434f';
        c.fillRect(0, 0, w, w);
        for (let k = 0; k < 60; k++) {
            const r = 6 + random() * 30;
            const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
            g.addColorStop(0, 'rgba(30,28,40,0.25)');
            g.addColorStop(1, 'rgba(30,28,40,0)');
            c.save();
            c.translate(random() * w, random() * w);
            c.fillStyle = g;
            c.fillRect(-r, -r, r * 2, r * 2);
            c.restore();
        }
        c.strokeStyle = 'rgba(20,20,30,0.5)';
        c.lineWidth = 2;
        c.strokeRect(0, 0, w, w);
    }, { repeat: true });
    concrete.repeat.set(16, 12);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: concrete }));
    top.receiveShadow = true;
    root.add(top);
    const levels = canvasTexture(64, 256, (c, w, h) => {
        for (let k = 0; k < 4; k++) {
            const y = k * 64;
            c.fillStyle = '#7d7b88';
            c.fillRect(0, y, w, 18);
            c.fillStyle = k % 2 ? '#1c1a26' : '#221e2a';
            c.fillRect(0, y + 18, w, 46);
            c.fillStyle = 'rgba(255,190,110,0.35)';
            c.fillRect(0, y + 52, w, 6);
        }
    }, { repeat: true });
    levels.repeat.set(20, 1);
    const facade = new THREE.Mesh(new THREE.BoxGeometry(HALF_X * 2 + 1, DROP, HALF_Z * 2 + 1), new THREE.MeshLambertMaterial({ map: levels, emissive: 0x1a120a }));
    facade.position.y = -DROP / 2 - 0.05;
    root.add(facade);
}

/** The parapet: a low concrete wall around the deck (the walls of the arena) with a striped warning edge. */
function buildParapet(root, colliders, glows) {
    const h = 1.1;
    const t = 0.5;
    const parts = [
        box(HALF_X * 2 + t * 2, h, t, 0, h / 2, -HALF_Z - t / 2),
        box(HALF_X * 2 + t * 2, h, t, 0, h / 2, HALF_Z + t / 2),
        box(t, h, HALF_Z * 2, -HALF_X - t / 2, h / 2, 0),
        box(t, h, HALF_Z * 2, HALF_X + t / 2, h / 2, 0),
    ];
    root.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0x9a98a6 })));
    const stripes = canvasTexture(64, 16, (c, w, hh) => {
        for (let k = -1; k < 5; k++) {
            c.fillStyle = k % 2 ? '#ffb020' : '#16151f';
            c.beginPath();
            c.moveTo(k * 16, hh);
            c.lineTo(k * 16 + 16, hh);
            c.lineTo(k * 16 + 32, 0);
            c.lineTo(k * 16 + 16, 0);
            c.fill();
        }
    }, { repeat: true });
    stripes.repeat.set(40, 1);
    const band = [
        new THREE.PlaneGeometry(HALF_X * 2, 0.3).translate(0, 0.7, -HALF_Z + 0.01),
        new THREE.PlaneGeometry(HALF_X * 2, 0.3).rotateY(Math.PI).translate(0, 0.7, HALF_Z - 0.01),
        new THREE.PlaneGeometry(HALF_Z * 2, 0.3).rotateY(Math.PI / 2).translate(-HALF_X + 0.01, 0.7, 0),
        new THREE.PlaneGeometry(HALF_Z * 2, 0.3).rotateY(-Math.PI / 2).translate(HALF_X - 0.01, 0.7, 0),
    ];
    root.add(new THREE.Mesh(mergeGeometries(band), new THREE.MeshLambertMaterial({ map: stripes })));
    colliders.addSegment(-HALF_X, -HALF_Z, HALF_X, -HALF_Z);
    colliders.addSegment(HALF_X, -HALF_Z, HALF_X, HALF_Z);
    colliders.addSegment(HALF_X, HALF_Z, -HALF_X, HALF_Z);
    colliders.addSegment(-HALF_X, HALF_Z, -HALF_X, -HALF_Z);
    for (let x = -HALF_X; x <= HALF_X; x += 20) {
        glows.add(x, 1.25, -HALF_Z, 0.8, 0xff4040);
        glows.add(x, 1.25, HALF_Z, 0.8, 0xff4040);
    }
}

/** White bay lines in rows along the parapets and through the middle of the deck. */
function buildBays(root) {
    const lines = [];
    for (let x = -76; x <= 76; x += 2.8) {
        for (const z of [-HALF_Z + 4, HALF_Z - 4]) lines.push(new THREE.PlaneGeometry(0.12, 5).rotateX(-Math.PI / 2).translate(x - 1.4, 0.02, z));
    }
    for (let z = -46; z <= 46; z += 2.8) {
        for (const x of [-HALF_X + 4, HALF_X - 4]) lines.push(new THREE.PlaneGeometry(5, 0.12).rotateX(-Math.PI / 2).translate(x, 0.02, z - 1.4));
    }
    for (let x = -40; x <= 40; x += 2.8) lines.push(new THREE.PlaneGeometry(0.12, 10).rotateX(-Math.PI / 2).translate(x, 0.02, -2));
    root.add(new THREE.Mesh(mergeGeometries(lines), new THREE.MeshLambertMaterial({ color: 0xdcdae6, polygonOffset: true, polygonOffsetFactor: -1 })));
}

/** A big neon "P7" on a steel frame at the north edge, seen from everywhere on the deck. */
function buildRoofSign(root, glows) {
    const sign = canvasTexture(256, 256, (c, w) => {
        c.fillStyle = '#0d0b16';
        c.fillRect(0, 0, w, w);
        c.strokeStyle = '#29e7ff';
        c.shadowColor = '#29e7ff';
        c.shadowBlur = 18;
        c.lineWidth = 10;
        c.strokeRect(14, 14, w - 28, w - 28);
        c.fillStyle = '#ffffff';
        c.font = 'bold 150px Anton, Impact, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('P7', w / 2, w / 2 + 8);
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide }));
    panel.position.set(-20, 10.5, -HALF_Z - 1.5);
    root.add(panel);
    const frame = tint(box(0.4, 6, 0.4, -24, 3, -HALF_Z - 1.5), 0x2a2838);
    const frame2 = tint(box(0.4, 6, 0.4, -16, 3, -HALF_Z - 1.5), 0x2a2838);
    root.add(new THREE.Mesh(mergeGeometries([frame, frame2]), new THREE.MeshLambertMaterial({ vertexColors: true })));
    glows.add(-20, 10.5, -HALF_Z - 1, 16, 0x29e7ff);
}

/** The city 26 m below: a dark ground with street lights, towers around the car park. */
function buildCityBelow(root, glows, detail) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x15131e }));
    ground.position.y = -DROP;
    root.add(ground);
    const random = rng(404);
    const colours = [0xffc070, 0xffd9a0, 0xbfd8ff, 0xff2e88, 0x29e7ff];
    for (let k = 0; k < 900 * detail; k++) {
        const a = random() * Math.PI * 2;
        const r = 110 + random() * 600;
        glows.add(Math.cos(a) * r, -DROP + 0.5, Math.sin(a) * r, 3 + random() * 3, colours[Math.floor(random() * colours.length)]);
    }
    buildSkyline(root, glows, { y: -DROP, inner: 140, outer: 560, count: Math.round(110 * Math.min(1.4, detail + 0.2)), seed: 77, maxHeight: 130, texture: windowTexture(31, 0.4) });
}
