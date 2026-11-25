// DriftKing · world/props-cars.js – parked cars: three generic shapes (a saloon, a hatchback, a boxy minivan – invented, no real model),
// each an extruded side profile with wheel arches and rounded edges, a glasshouse with pillars and a roof, wheels with rims, lamps (off),
// grille, plates and mirrors. Instanced per shape and material (paint with a colour per car, trim with vertex colours, glass): at most
// nine draw calls for any number of cars. Car local frame: +z = the front, origin on the ground in the middle; fits a 1.9 × 4.3 m box.

import * as THREE from 'three';
import { mergeGeometries, rng } from '../render/kit.js';
import { instanced, isPbr, materialsOf, ownMaterial, paint, rod, seedFrom } from './props-common.js';

/** The shapes (metres): length, width, roof height, beltline, wheelbase, front overhang, hood length, windscreen and rear-window run, deck. */
const SHAPES = {
    saloon: { length: 4.25, width: 1.76, height: 1.4, belt: 0.88, wheelbase: 2.66, front: 0.86, hood: 1.18, screen: 0.72, rear: 0.5, deck: 0.92 },
    hatch: { length: 3.95, width: 1.7, height: 1.47, belt: 0.9, wheelbase: 2.5, front: 0.8, hood: 0.88, screen: 0.66, rear: 0.24, deck: 0.1 },
    minivan: { length: 4.2, width: 1.7, height: 1.82, belt: 0.98, wheelbase: 2.75, front: 0.78, hood: 0.62, screen: 0.6, rear: 0.06, deck: 0.04 },
};

/** Paint colours of parked cars as they are on the street (pearl white, silver and black the most). */
const COLOURS = [[0xe6e6e2, 30], [0xa3a7ad, 18], [0x121316, 16], [0x575b62, 10], [0x1c2a46, 8], [0x8a171c, 7], [0xb6a888, 4], [0x22372d, 3], [0x7590ab, 4]];

const WHEEL = 0.31;

/** The geometries of one shape: { body, trim, glass } (paint / vertex-coloured trim / glass). */
function shapeGeometries(shape, quality) {
    const s = SHAPES[shape];
    const pbr = quality !== 'low';
    const L = s.length;
    const W = s.width;
    const zFront = L / 2;
    const zRear = -L / 2;
    const axleF = zFront - s.front;
    const axleR = axleF - s.wheelbase;
    const bevel = 0.05;
    // the side profile (z, y) of the lower body, shrunk by the bevel that ExtrudeGeometry adds around it
    const b = bevel;
    const pts = [];
    pts.push([zFront - 0.1 - b, 0.24 + b], [zFront - b, 0.42], [zFront - 0.03 - b, 0.62 - b], [zFront - 0.3, s.belt - 0.07 - b], [zFront - s.hood, s.belt - b]);
    pts.push([zRear + s.deck + (s.deck > 0.3 ? 0 : 0.02), s.belt + 0.01 - b], [zRear + 0.06 + b, s.belt - 0.04 - b], [zRear + b, 0.5], [zRear + 0.07 + b, 0.25 + b]);
    // a wheel arch over an axle: a half circle from behind the wheel to in front of it
    const arch = cz => {
        const r = WHEEL + 0.09 - b;
        const steps = pbr ? 8 : 5;
        for (let k = 0; k <= steps; k++) {
            const a = Math.PI - (k / steps) * Math.PI;
            pts.push([cz + Math.cos(a) * r, WHEEL + Math.sin(a) * r]);
        }
    };
    pts.push([axleR - WHEEL - 0.09 + b, 0.22 + b]);
    arch(axleR);
    pts.push([axleR + WHEEL + 0.09 - b, 0.22 + b], [axleF - WHEEL - 0.09 + b, 0.22 + b]);
    arch(axleF);
    pts.push([axleF + WHEEL + 0.09 - b, 0.22 + b]);
    const profile = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const depth = W - 2 * bevel;
    const lower = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: quality === 'high' ? 2 : 1, curveSegments: 4, steps: 1 });
    lower.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0);
    const body = [lower];

    // the glasshouse: a frustum from the beltline to the roof, narrower on top (tumblehome)
    const yb = s.belt + 0.01;
    const yt = s.height - 0.04;
    const zbF = zFront - s.hood;
    const zbR = zRear + s.deck + (s.deck > 0.3 ? 0 : 0.03);
    const ztF = zbF - s.screen;
    const ztR = zbR + s.rear;
    const hb = W / 2 - 0.07;
    const ht = W / 2 - (shape === 'minivan' ? 0.12 : 0.22);
    const corner = (side, top, front) => new THREE.Vector3(side * (top ? ht : hb), top ? yt : yb, top ? (front ? ztF : ztR) : (front ? zbF : zbR));
    const quad = (a, b2, c, d) => {
        const g = new THREE.BufferGeometry().setFromPoints([a, b2, c, a, c, d]);
        g.computeVertexNormals();
        return g;
    };
    const glass = [];
    glass.push(quad(corner(-1, false, true), corner(1, false, true), corner(1, true, true), corner(-1, true, true)));
    glass.push(quad(corner(1, false, false), corner(-1, false, false), corner(-1, true, false), corner(1, true, false)));
    glass.push(quad(corner(1, false, true), corner(1, false, false), corner(1, true, false), corner(1, true, true)));
    glass.push(quad(corner(-1, false, false), corner(-1, false, true), corner(-1, true, true), corner(-1, true, false)));
    // roof panel and pillars in the paint
    body.push(new THREE.BoxGeometry(ht * 2 + 0.05, 0.06, ztF - ztR + 0.08).translate(0, yt + 0.01, (ztF + ztR) / 2));
    const pillarSegments = pbr ? 6 : 4;
    for (const side of [-1, 1]) {
        body.push(rod(corner(side, false, true), corner(side, true, true), 0.04, 0.035, pillarSegments));
        body.push(rod(corner(side, false, false), corner(side, true, false), shape === 'saloon' ? 0.09 : 0.06, 0.05, pillarSegments));
        const zm = (zbF + zbR) / 2 + 0.1;
        const tm = (zm - zbR) / (zbF - zbR);
        body.push(rod(new THREE.Vector3(side * hb, yb, zm), new THREE.Vector3(side * ht, yt, ztR + (ztF - ztR) * tm), 0.04, 0.04, pillarSegments));
        if (shape === 'minivan') {
            const zq = zbR + (zbF - zbR) * 0.3;
            body.push(rod(new THREE.Vector3(side * hb, yb, zq), new THREE.Vector3(side * ht, yt, ztR + (ztF - ztR) * 0.3), 0.04, 0.04, pillarSegments));
        }
    }

    // trim: wheels, the dark interior behind the glass, lamps, grille, bumper lips, plates, mirrors
    const trim = [];
    const wheelSegments = quality === 'high' ? 18 : pbr ? 14 : 8;
    for (const z of [axleF, axleR]) {
        for (const side of [-1, 1]) {
            const x = side * (W / 2 - 0.13);
            // the tyre's tread (open), its outer sidewall as a ring, the rim face and the hub, all facing out
            trim.push(paint(new THREE.CylinderGeometry(WHEEL, WHEEL, 0.2, wheelSegments, 1, true).rotateZ(Math.PI / 2).translate(x, WHEEL, z), 0x1b1b1d));
            const out = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            trim.push(paint(new THREE.RingGeometry(0.21, WHEEL, wheelSegments, 1).rotateY(-out).translate(x + side * 0.1, WHEEL, z), 0x202022));
            trim.push(paint(new THREE.CircleGeometry(0.21, wheelSegments).rotateY(-out).translate(x + side * 0.092, WHEEL, z), 0x8c9095));
            if (pbr) trim.push(paint(new THREE.CircleGeometry(0.055, 6).rotateY(-out).translate(x + side * 0.097, WHEEL, z), 0x3a3c40));
        }
    }
    trim.push(paint(new THREE.BoxGeometry(hb * 2 - 0.12, yt - yb - 0.06, zbF - zbR - 0.25).translate(0, (yb + yt) / 2 - 0.02, (zbF + zbR) / 2), 0x09090b));
    for (const side of [-1, 1]) {
        trim.push(paint(new THREE.BoxGeometry(0.34, 0.11, 0.06).translate(side * (W / 2 - 0.27), 0.64, zFront - 0.05), 0xc9cfd6));
        trim.push(paint(new THREE.BoxGeometry(0.36, shape === 'minivan' ? 0.3 : 0.12, 0.05).translate(side * (W / 2 - 0.22), shape === 'minivan' ? s.belt - 0.05 : s.belt - 0.13, zRear + 0.04), 0x5a0b10));
        if (pbr) trim.push(paint(new THREE.BoxGeometry(0.06, 0.09, 0.14).translate(side * (W / 2 - 0.02), yb + 0.12, zbF - 0.18), 0x15161a));
    }
    trim.push(paint(new THREE.BoxGeometry(W - 0.82, 0.13, 0.04).translate(0, 0.5, zFront - 0.02), 0x111214));
    trim.push(paint(new THREE.BoxGeometry(W - 0.1, 0.09, 0.06).translate(0, 0.28, zFront - 0.07), 0x18191c));
    trim.push(paint(new THREE.BoxGeometry(W - 0.1, 0.09, 0.06).translate(0, 0.29, zRear + 0.08), 0x18191c));
    if (pbr) {
        trim.push(paint(new THREE.BoxGeometry(0.33, 0.165, 0.02).translate(0, 0.42, zFront + 0.005), 0xd8d8cf));
        trim.push(paint(new THREE.BoxGeometry(0.33, 0.165, 0.02).translate(0, shape === 'minivan' ? 0.62 : s.belt - 0.3, zRear - 0.005), 0xd8d8cf));
    }
    return { body: mergeGeometries(body), trim: mergeGeometries(trim), glass: mergeGeometries(glass) };
}

/**
 * Parked cars (generic, never a real model) at spots [{ x, y, z, yaw }]; returns the group – colliders are the map's business.
 * Uses exactly one number of `random` per car (as before). options: materials (the factory).
 */
export function buildParkedCars(root, spots, random, options = {}) {
    if (spots.length === 0) return;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const high = mats.quality === 'high';
    const total = COLOURS.reduce((a, [, w]) => a + w, 0);
    const byShape = { saloon: [], hatch: [], minivan: [] };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    spots.forEach((p, k) => {
        const local = rng(seedFrom(random(), k));
        const pick = local();
        const shape = pick < 0.45 ? 'saloon' : pick < 0.8 ? 'hatch' : 'minivan';
        let w = local() * total;
        let hex = COLOURS[0][0];
        for (const [c, weight] of COLOURS) {
            w -= weight;
            if (w <= 0) {
                hex = c;
                break;
            }
        }
        const matrix = m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), one).clone();
        byShape[shape].push({ matrix, colour: new THREE.Color(hex) });
    });
    const group = new THREE.Group();
    group.name = 'parked-cars';
    const paintMaterial = mats.carPaint(0xffffff, { metallic: 0.45 });
    const trimMaterial = ownMaterial(mats, { vertexColors: true, roughness: 0.5 });
    const glassMaterial = mats.glass({ tint: 0x0b0e14, opacity: 0.82 });
    for (const [shape, cars] of Object.entries(byShape)) {
        if (cars.length === 0) continue;
        const g = shapeGeometries(shape, mats.quality);
        const matrices = cars.map(c => c.matrix);
        const meshes = [
            instanced(g.body, paintMaterial, matrices, { colors: cars.map(c => c.colour), castShadow: high, receiveShadow: pbr, name: `parked-${shape}-paint` }),
            instanced(g.trim, trimMaterial, matrices, { castShadow: high, receiveShadow: pbr, name: `parked-${shape}-trim` }),
            instanced(g.glass, glassMaterial, matrices, { name: `parked-${shape}-glass` }),
        ];
        for (const mesh of meshes) if (mesh) group.add(mesh);
    }
    root.add(group);
    return group;
}
