// DriftKing · car/models.js – the low-poly cars: six bodies (side profiles extruded, a tapered glasshouse), wheels that steer and spin,
// emissive lights with glow points, neon underglow, headlight beams on the road, a livery on the doors (number, decal) and a shadow blob.
// Every body is invented: proportions of classic sports coupés, never a real model. The car faces +z, the ground is y = 0.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, glowMaterial, rng, sharedTexture } from '../render/kit.js';

/** Measures shared by all bodies (metres). */
export const CAR = { wheelbase: 2.5, track: 1.5, wheelRadius: 0.33, width: 1.78 };

/**
 * The side profiles: half length, nose height, cowl height (base of the windscreen), roof, deck (trunk) height, tail height,
 * the z of the windscreen base (aFront), the roof's front and rear (aTop, cTop), the base of the rear window (cBase); width, wing, extras.
 */
const BODIES = {
    coupe: { len: 2.15, nose: 0.6, cowl: 0.84, roof: 1.3, deck: 0.86, tail: 0.84, aFront: 0.55, aTop: -0.12, cTop: -0.86, cBase: -1.3, width: 1.74, wing: 'duck' },
    hatch: { len: 1.98, nose: 0.62, cowl: 0.86, roof: 1.42, deck: 0.9, tail: 0.9, aFront: 0.72, aTop: 0.05, cTop: -1.5, cBase: -1.9, width: 1.7, wing: 'roof' },
    sedan: { len: 2.3, nose: 0.62, cowl: 0.85, roof: 1.36, deck: 0.88, tail: 0.86, aFront: 0.66, aTop: -0.05, cTop: -0.98, cBase: -1.48, width: 1.78, wing: 'lip' },
    fastback: { len: 2.2, nose: 0.55, cowl: 0.78, roof: 1.25, deck: 0.8, tail: 0.8, aFront: 0.5, aTop: -0.2, cTop: -0.66, cBase: -1.98, width: 1.78, wing: 'gt' },
    wide: { len: 2.25, nose: 0.5, cowl: 0.74, roof: 1.2, deck: 0.8, tail: 0.78, aFront: 0.42, aTop: -0.26, cTop: -0.86, cBase: -1.55, width: 1.96, wing: 'gt', flares: true },
    muscle: { len: 2.35, nose: 0.74, cowl: 0.92, roof: 1.33, deck: 0.94, tail: 0.92, aFront: 0.22, aTop: -0.42, cTop: -1.02, cBase: -1.42, width: 1.84, wing: 'duck', scoop: true },
};

/** The body keys (catalog.js BODIES has their names). */
export const BODY_KEYS = Object.keys(BODIES);

/**
 * Builds a car from its CarView (body, paint, rims, neon, number, decal).
 * @returns {THREE.Group} with userData { body, wheels: [{ pivot, spin, side, front }], tailGlow, beam, neon, profile, dispose() }
 */
export function buildCar(view) {
    const profile = BODIES[view.body] ?? BODIES.coupe;
    const paint = new THREE.Color(view.paint ?? '#f4f2ff');
    const materials = carMaterials(paint, view.rims ?? '#c9ccd6');
    const car = new THREE.Group();
    car.name = view.name ?? 'car';
    const body = new THREE.Group();
    car.add(body);

    body.add(mesh(lowerBody(profile), materials.paint, true));
    body.add(mesh(cabin(profile), materials.glass, true));
    body.add(mesh(roofPanel(profile), materials.paint, true));
    addPillars(body, profile, materials.paint);
    addTrim(body, profile, materials);
    addWing(body, profile, materials);
    if (profile.scoop) body.add(mesh(new THREE.BoxGeometry(0.5, 0.1, 0.7).translate(0, profile.cowl + 0.02, profile.aFront + 0.75), materials.trim));
    if (profile.flares) addFlares(body, profile, materials.paint);
    addLivery(body, profile, view, paint);
    const lights = addLights(car, body, profile);

    const wheels = [];
    const wheelGeometry = wheelGeometries();
    for (const front of [true, false]) {
        for (const side of [1, -1]) {
            const pivot = new THREE.Group();
            const halfTrack = (profile.width - 0.26) / 2;
            pivot.position.set(side * halfTrack, CAR.wheelRadius, front ? CAR.wheelbase / 2 : -CAR.wheelbase / 2);
            const spin = new THREE.Group();
            if (side < 0) spin.rotation.y = Math.PI;
            const wheel = new THREE.Group();
            wheel.add(mesh(wheelGeometry.tyre, materials.tyre, true), mesh(wheelGeometry.rim, materials.rim));
            spin.add(wheel);
            pivot.add(spin);
            car.add(pivot);
            wheels.push({ pivot, spin: wheel, side, front });
        }
    }

    const neon = view.neon ? addNeon(car, view.neon) : null;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(profile.width + 0.5, profile.len * 2 + 0.6).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: sharedTexture('blob'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    car.add(shadow);

    car.userData = {
        body,
        wheels,
        profile,
        neon,
        ...lights,
        dispose() {
            car.traverse(o => {
                o.geometry?.dispose();
                const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
                for (const m of list) {
                    if (m.map && !isShared(m.map)) m.map.dispose();
                    m.dispose();
                }
            });
        },
    };
    return car;
}

function isShared(texture) {
    return texture === neonCache || ['glow', 'pool', 'blob', 'beam'].some(name => sharedTexture(name) === texture);
}

function mesh(geometry, material, shadow = false) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow;
    return m;
}

function carMaterials(paint, rims) {
    return {
        // a little self-light keeps the paint readable at night
        paint: new THREE.MeshPhongMaterial({ color: paint, emissive: paint.clone().multiplyScalar(0.14), shininess: 70, specular: 0x8888aa, flatShading: true }),
        glass: new THREE.MeshPhongMaterial({ color: 0x10131f, shininess: 120, specular: 0xaab4ff, flatShading: true }),
        trim: new THREE.MeshLambertMaterial({ color: 0x15141c }),
        tyre: new THREE.MeshLambertMaterial({ color: 0x141318, flatShading: true }),
        rim: new THREE.MeshPhongMaterial({ color: new THREE.Color(rims), shininess: 90, specular: 0xffffff, flatShading: true }),
    };
}

/** The lower body: the side profile (with wheel arches cut into its bottom edge) extruded over the width. */
function lowerBody(p) {
    const shape = new THREE.Shape();
    const wb = CAR.wheelbase / 2;
    const archR = 0.43;
    const archY = CAR.wheelRadius + 0.02;
    // top line, front to rear (shape x = car z)
    shape.moveTo(p.len, 0.26);
    shape.lineTo(p.len + 0.02, p.nose - 0.1);
    shape.lineTo(p.len - 0.1, p.nose);
    shape.lineTo(p.aFront + 0.2, p.cowl - 0.04);
    shape.lineTo(p.aFront, p.cowl);
    shape.lineTo(p.cBase, p.deck);
    shape.lineTo(-p.len + 0.16, p.tail);
    shape.lineTo(-p.len, p.tail - 0.1);
    shape.lineTo(-p.len - 0.02, 0.3);
    shape.lineTo(-p.len + 0.12, 0.2);
    // bottom line, rear to front, with the arches
    for (const centre of [-wb, wb]) {
        shape.lineTo(centre - archR, 0.2);
        for (let k = 0; k <= 6; k++) {
            const a = Math.PI - (k / 6) * Math.PI;
            shape.lineTo(centre + Math.cos(a) * archR, archY + Math.sin(a) * archR * 0.92);
        }
        shape.lineTo(centre + archR, 0.2);
    }
    shape.lineTo(p.len - 0.12, 0.2);
    return extrude(shape, p.width);
}

/** The glasshouse: windscreen, roof, rear window, narrower than the body and tapered towards the roof (tumblehome). */
function cabin(p) {
    const shape = new THREE.Shape();
    shape.moveTo(p.aFront, p.cowl - 0.01);
    shape.lineTo(p.aTop, p.roof);
    shape.lineTo(p.cTop, p.roof);
    shape.lineTo(p.cBase, p.deck - 0.01);
    const geometry = extrude(shape, p.width * 0.9);
    taper(geometry, Math.min(p.cowl, p.deck), p.roof, 0.82);
    return geometry;
}

/** The painted roof skin over the glasshouse (the windows stay dark around it). */
function roofPanel(p) {
    const shape = new THREE.Shape();
    const front = p.aTop - 0.05;
    const rear = p.cTop + 0.05;
    shape.moveTo(front - 0.06, p.roof + 0.02);
    shape.lineTo(rear + 0.06, p.roof + 0.02);
    shape.lineTo(rear, p.roof - 0.05);
    shape.lineTo(front, p.roof - 0.05);
    return extrude(shape, p.width * 0.9 * 0.82 + 0.03);
}

/** A pillar on each side between the doors' windows (B) and behind them (C, as a band). */
function addPillars(body, p, material) {
    const width = p.width * 0.9 * 0.91;
    const mid = (p.aTop + p.cTop) / 2 - 0.1;
    const geometry = new THREE.BoxGeometry(width + 0.02, p.roof - p.cowl, 0.1);
    geometry.translate(0, (p.roof + p.cowl) / 2, mid);
    body.add(mesh(geometry, material));
}

/** Bumper lips, grille, side skirts and mirrors in dark trim. */
function addTrim(body, p, m) {
    body.add(mesh(new THREE.BoxGeometry(p.width + 0.02, 0.16, 0.18).translate(0, 0.28, p.len - 0.02), m.trim));
    body.add(mesh(new THREE.BoxGeometry(p.width * 0.55, 0.12, 0.04).translate(0, p.nose - 0.22, p.len + 0.01), m.trim));
    body.add(mesh(new THREE.BoxGeometry(p.width + 0.02, 0.14, 0.16).translate(0, 0.28, -p.len + 0.02), m.trim));
    body.add(mesh(new THREE.BoxGeometry(p.width + 0.04, 0.1, CAR.wheelbase - 0.9).translate(0, 0.24, 0), m.trim));
    for (const side of [-1, 1]) {
        body.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.18).translate(side * (p.width / 2 + 0.06), p.cowl + 0.12, p.aFront - 0.12), m.paint));
    }
}

/** Duck tail, roof spoiler, lip or a GT wing on two posts. */
function addWing(body, p, m) {
    if (p.wing === 'duck') {
        body.add(mesh(new THREE.BoxGeometry(p.width - 0.1, 0.07, 0.24).rotateX(-0.25).translate(0, p.tail + 0.05, -p.len + 0.16), m.paint));
    } else if (p.wing === 'roof') {
        body.add(mesh(new THREE.BoxGeometry(p.width * 0.78, 0.05, 0.3).rotateX(0.18).translate(0, p.roof - 0.02, p.cTop - 0.12), m.paint));
    } else if (p.wing === 'lip') {
        body.add(mesh(new THREE.BoxGeometry(p.width - 0.2, 0.04, 0.14).translate(0, p.deck + 0.03, -p.len + 0.22), m.trim));
    } else if (p.wing === 'gt') {
        body.add(mesh(new THREE.BoxGeometry(p.width + 0.04, 0.05, 0.36).rotateX(0.08).translate(0, p.deck + 0.42, -p.len + 0.32), m.trim));
        for (const side of [-1, 1]) {
            body.add(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.16).translate(side * (p.width / 2 - 0.3), p.deck + 0.21, -p.len + 0.34), m.trim));
            body.add(mesh(new THREE.BoxGeometry(0.03, 0.22, 0.4).translate(side * (p.width / 2 + 0.03), p.deck + 0.45, -p.len + 0.32), m.paint));
        }
    }
}

/** Bolt-on fender flares of the widebody. */
function addFlares(body, p, material) {
    for (const z of [CAR.wheelbase / 2, -CAR.wheelbase / 2]) {
        for (const side of [-1, 1]) {
            body.add(mesh(new THREE.BoxGeometry(0.1, 0.14, 1.05).translate(side * (p.width / 2 + 0.02), CAR.wheelRadius + 0.43, z), material));
        }
    }
}

/** Headlights and taillights: emissive plates on the body, glow points (the tail glow brightens on braking), the headlight beam on the road. */
function addLights(car, body, p) {
    const head = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2030 });
    const headY = p.nose - 0.12;
    const tailY = p.tail - 0.18;
    for (const side of [-1, 1]) {
        body.add(mesh(new THREE.BoxGeometry(0.42, 0.11, 0.04).translate(side * (p.width / 2 - 0.3), headY, p.len + 0.005), head));
    }
    body.add(mesh(new THREE.BoxGeometry(p.width - 0.24, 0.1, 0.04).translate(0, tailY, -p.len - 0.015), tail));

    const headGlow = glowPoints([[-(p.width / 2 - 0.3), headY, p.len + 0.15], [p.width / 2 - 0.3, headY, p.len + 0.15]], 1.5, 0xfff0d0);
    const tailGlow = glowPoints([[-(p.width / 2 - 0.3), tailY, -p.len - 0.12], [p.width / 2 - 0.3, tailY, -p.len - 0.12]], 1.1, 0xff1a2a);
    tailGlow.material.uniforms.intensity.value = 0.55;
    body.add(headGlow, tailGlow);

    const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 18).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: sharedTexture('beam'), color: 0x8a8270, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    beam.position.set(0, 0.05, p.len + 9);
    beam.renderOrder = 3;
    car.add(beam);
    return { tailGlow, headGlow, beam, tailMaterial: tail };
}

function glowPoints(points, size, hex) {
    const geometry = new THREE.BufferGeometry();
    const c = new THREE.Color(hex);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(points.map(() => size), 1));
    geometry.setAttribute('tint', new THREE.Float32BufferAttribute(points.flatMap(() => [c.r, c.g, c.b]), 3));
    const p = new THREE.Points(geometry, glowMaterial({ fogFar: 700 }));
    p.frustumCulled = false;
    p.renderOrder = 6;
    return p;
}

/** The neon underglow: a bright rounded patch under the car and a wide faint spill around it. */
function addNeon(car, hex) {
    const texture = neonTexture();
    const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(hex), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.0).rotateX(-Math.PI / 2), material);
    core.position.y = 0.04;
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 7.6).rotateX(-Math.PI / 2), material.clone());
    spill.material.opacity = 0.45;
    spill.position.y = 0.035;
    group.add(spill, core);
    group.renderOrder = 2;
    car.add(group);
    return group;
}

let neonCache = null;
function neonTexture() {
    neonCache ??= canvasTexture(64, 128, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, h / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
    });
    return neonCache;
}

/** The livery on both doors: the decal style, the start number in a roundel; stripes over hood, roof and trunk. */
function addLivery(body, p, view, paint) {
    const light = paint.r * 0.3 + paint.g * 0.59 + paint.b * 0.11 > 0.55;
    const ink = light ? '#16151f' : '#f4f2ff';
    const accent = light ? '#ff2e88' : '#29e7ff';
    const decal = view.decal ?? 'none';
    const options = { decal, number: view.number ?? 0, ink, accent, paint: `#${paint.getHexString()}`, seed: (view.number ?? 7) + 3 };
    const length = CAR.wheelbase - 0.95;
    const height = Math.min(p.cowl, p.deck) - 0.34;
    for (const side of [-1, 1]) {
        // the left side's texture runs front to back, the right side's back to front: the number stays readable, the roundel sits at the front
        const front = side > 0 ? 'left' : 'right';
        const texture = canvasTexture(512, 160, (c, w, h) => drawLivery(c, w, h, { ...options, front }));
        const material = new THREE.MeshPhongMaterial({ map: texture, transparent: true, shininess: 70, specular: 0x8888aa, polygonOffset: true, polygonOffsetFactor: -1 });
        const plane = new THREE.PlaneGeometry(length, height);
        plane.rotateY(side * Math.PI / 2);
        plane.translate(side * (p.width / 2 + 0.006), 0.27 + height / 2, -0.02);
        body.add(mesh(plane, material));
    }
    if (decal === 'stripes') {
        const stripe = new THREE.MeshPhongMaterial({ color: light ? 0x16151f : 0xf4f2ff, shininess: 70, flatShading: true });
        for (const x of [-0.16, 0.16]) {
            body.add(mesh(new THREE.BoxGeometry(0.16, 0.012, p.len - p.aFront - 0.12).translate(x, (p.nose + p.cowl) / 2 + 0.008, (p.len + p.aFront) / 2 - 0.02), stripe));
            body.add(mesh(new THREE.BoxGeometry(0.16, 0.012, p.aTop - p.cTop).translate(x, p.roof + 0.03, (p.aTop + p.cTop) / 2), stripe));
        }
    }
}

/** The door art; front: the end of the canvas at the car's front ('left' or 'right'). The decal is mirrored with it, the number never. */
function drawLivery(c, w, h, { decal, number, ink, accent, paint, seed, front }) {
    const random = rng(seed);
    c.save();
    if (front === 'right') {
        c.translate(w, 0);
        c.scale(-1, 1);
    }
    if (decal === 'split') {
        c.fillStyle = ink;
        c.beginPath();
        c.moveTo(0, h * 0.55);
        c.lineTo(w, h * 0.3);
        c.lineTo(w, h);
        c.lineTo(0, h);
        c.fill();
        c.fillStyle = accent;
        c.fillRect(0, h * 0.5, w, 6);
    } else if (decal === 'kanji') {
        c.strokeStyle = accent;
        c.lineWidth = 12;
        for (let k = 0; k < 3; k++) drawGlyph(c, random, 210 + k * 96, 20, 110);
    } else if (decal === 'sakura') {
        for (let k = 0; k < 9; k++) flower(c, 160 + random() * 340, 20 + random() * 120, 14 + random() * 18, k % 3 ? '#ffb7d5' : '#ff6fa8');
        c.strokeStyle = '#3a2430';
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(w, 10);
        c.quadraticCurveTo(320, 60, 170, 150);
        c.stroke();
    } else if (decal === 'flames') {
        const g = c.createLinearGradient(0, 0, w * 0.8, 0);
        g.addColorStop(0, '#ffe14a');
        g.addColorStop(0.45, '#ff7a1a');
        g.addColorStop(1, 'rgba(255,40,40,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, h * 0.15);
        for (let k = 0; k < 6; k++) {
            const y = h * (0.15 + k * 0.14);
            c.quadraticCurveTo(w * (0.35 + random() * 0.35), y - 10, w * (0.5 + random() * 0.35), y + 8);
            c.quadraticCurveTo(w * 0.3, y + 16, 0, y + h * 0.14);
        }
        c.lineTo(0, h * 0.15);
        c.fill();
    } else if (decal === 'stripes') {
        c.fillStyle = ink;
        c.fillRect(0, h * 0.62, w, 14);
        c.fillStyle = accent;
        c.fillRect(0, h * 0.62 + 20, w, 6);
    }
    c.restore();
    // the roundel with the number (front part of the door)
    const x = front === 'right' ? w - 92 : 92;
    const y = h * 0.47;
    c.fillStyle = '#f4f2ff';
    c.beginPath();
    c.arc(x, y, 56, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = paint;
    c.stroke();
    c.fillStyle = '#16151f';
    c.font = 'bold 74px Anton, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(number % 100), x, y + 4);
}

function flower(c, x, y, r, colour) {
    c.fillStyle = colour;
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        c.beginPath();
        c.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
        c.fill();
    }
    c.fillStyle = '#fff3a8';
    c.beginPath();
    c.arc(x, y, r * 0.18, 0, Math.PI * 2);
    c.fill();
}

/** The wheel (tyre and rim with five spokes, face to +x), shared by the four wheels of a car. */
function wheelGeometries() {
    const r = CAR.wheelRadius;
    const tyre = new THREE.CylinderGeometry(r, r, 0.24, 12).rotateZ(Math.PI / 2);
    const rimParts = [new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.05, 10).rotateZ(Math.PI / 2).translate(0.11, 0, 0)];
    for (let k = 0; k < 5; k++) {
        const spoke = new THREE.BoxGeometry(0.04, r * 0.62, 0.07).translate(0.14, r * 0.3, 0);
        spoke.rotateX((k / 5) * Math.PI * 2);
        rimParts.push(spoke);
    }
    rimParts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 6).rotateZ(Math.PI / 2).translate(0.15, 0, 0));
    return { tyre, rim: mergeParts(rimParts) };
}

function mergeParts(parts) {
    const positions = [];
    const normals = [];
    for (const g of parts) {
        const n = g.toNonIndexed();
        positions.push(...n.attributes.position.array);
        normals.push(...n.attributes.normal.array);
        n.dispose();
        g.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geometry;
}

/** Extrudes a side profile (shape x = car z) over the width, centred: the result has the car's axes (x across, y up, z forward). */
function extrude(shape, width) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
    geometry.translate(0, 0, -width / 2);
    geometry.rotateY(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

/** Narrows the vertices above `from` towards `to` (x scaled down to `factor` at the top). */
function taper(geometry, from, to, factor) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
        const t = Math.min(1, Math.max(0, (position.getY(i) - from) / (to - from)));
        position.setX(i, position.getX(i) * (1 - (1 - factor) * t));
    }
    geometry.computeVertexNormals();
}
