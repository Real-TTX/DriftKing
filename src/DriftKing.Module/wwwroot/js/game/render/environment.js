// DriftKing · render/environment.js – the reflection maps: a PMREM (pre-filtered, every roughness) rendered once from a small procedural scene.
// 'night' is a street in the city at night (deep sky, a sodium/violet light dome, two rows of sodium lamps, cool LED strips, lit windows,
// a few neon panels, the moon); 'dusk' the same street in the afterglow; 'garage' a dark workshop with tube lights, softboxes and neon.
// Clearcoat paint, glass, chrome and wet asphalt reflect it; Lambert/Phong materials take its irradiance as a soft fill.
//   scene.environment = environmentMap('night');   scene.environmentIntensity = ENVIRONMENT_INTENSITY.night;
// The maps are cached for the page (userData.shared: disposeTree leaves them) and freed by disposeEnvironments() (the stage on dispose).

import * as THREE from 'three';
import { getRenderer } from './device.js';
import { rng } from './kit.js';
import { kelvinHex } from './lights.js';

/** The kinds of reflection map. */
export const ENVIRONMENTS = ['night', 'dusk', 'garage'];

/** A good scene.environmentIntensity per kind (with the tone mapping of the stage). */
export const ENVIRONMENT_INTENSITY = Object.freeze({ night: 1, dusk: 1, garage: 1 });

const cache = new Map();

/** Milliseconds the last map took to build (CPU side, including the GPU work it waited for); for the budgets in docs/RENDERING.md. */
export let lastBuildMs = 0;

/**
 * The reflection map of a kind (built on first use, then cached). null when no renderer is bound (no stage).
 * @param {'night'|'dusk'|'garage'} kind
 * @param {{ size?: number }} [options] size of a cube face (256 is plenty; 512 for close-up chrome in the garage on high)
 * @returns {THREE.Texture|null}
 */
export function environmentMap(kind = 'night', { size = 256 } = {}) {
    const renderer = getRenderer();
    if (!renderer) return null;
    const key = `${kind}:${size}`;
    if (cache.has(key)) return cache.get(key).texture;
    const started = performance.now();
    const scene = new THREE.Scene();
    if (kind === 'garage') buildGarage(scene);
    else buildStreet(scene, kind === 'dusk');
    const generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(scene, kind === 'garage' ? 0.01 : 0.02, 0.1, 400, { size, position: new THREE.Vector3(0, 1.2, 0) });
    generator.dispose();
    disposeScene(scene);
    target.texture.name = `DriftKing.environment.${kind}`;
    target.texture.userData.shared = true;
    cache.set(key, target);
    lastBuildMs = performance.now() - started;
    return target.texture;
}

/** The reflection map of a time of day of a map ('night' | 'dusk'). */
export function environmentFor(timeOfDay) {
    return environmentMap(timeOfDay === 'dusk' ? 'dusk' : 'night');
}

/** Frees every cached map (the stage calls it on dispose; a later call builds them again). */
export function disposeEnvironments() {
    for (const target of cache.values()) target.dispose();
    cache.clear();
}

// ---- the scenes (radiance in linear units: the sky ~0.005–0.1, windows ~1, lamps 10–40 – the PMREM keeps the HDR range)

/** An emissive colour: linear RGB × strength (MeshBasicMaterial: no lights, no tone mapping inside the cube render). */
function glow(hex, strength, extra = {}) {
    const color = new THREE.Color(hex).multiplyScalar(strength);
    return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false, ...extra });
}

const SKY_VERTEX = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

const SKY_FRAGMENT = /* glsl */ `
    uniform vec3 zenith;
    uniform vec3 horizon;
    uniform vec3 dome;
    uniform vec3 ground;
    uniform vec3 sunDir;
    uniform vec3 sunGlow;
    varying vec3 vDir;
    void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.85, h), 0.55));
        c += dome * exp(-max(h, 0.0) * 9.0);
        c += sunGlow * pow(max(dot(d, sunDir), 0.0), 6.0) * smoothstep(-0.1, 0.25, 0.4 - h);
        c = mix(c, ground, smoothstep(0.0, -0.06, h));
        gl_FragColor = vec4(c, 1.0);
    }`;

/** A street at night (or at dusk): what a car on a city street sees around it. */
function buildStreet(scene, dusk) {
    const random = rng(dusk ? 913 : 517);
    const sky = new THREE.ShaderMaterial({
        uniforms: {
            zenith: { value: dusk ? new THREE.Color(0.012, 0.022, 0.07) : new THREE.Color(0.0016, 0.0022, 0.006) },
            horizon: { value: dusk ? new THREE.Color(0.32, 0.12, 0.07) : new THREE.Color(0.05, 0.026, 0.045) },
            dome: { value: dusk ? new THREE.Color(0.2, 0.07, 0.03) : new THREE.Color(0.06, 0.025, 0.018) },
            ground: { value: new THREE.Color(0.006, 0.006, 0.008) },
            sunDir: { value: new THREE.Vector3(-0.8, 0.05, -0.6).normalize() },
            sunGlow: { value: dusk ? new THREE.Color(0.9, 0.3, 0.08) : new THREE.Color(0, 0, 0) },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), sky));

    // the street: dark asphalt with warm lamp pools along both sides
    const road = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), glow(0x1a1a1e, dusk ? 0.06 : 0.025));
    scene.add(road);
    const poolMaterial = glow(0xffa860, dusk ? 0.25 : 0.4);
    const pool = new THREE.CircleGeometry(4.5, 20).rotateX(-Math.PI / 2);
    for (let x = -150; x <= 150; x += 25) {
        for (const z of [-6, 6]) {
            const m = new THREE.Mesh(pool, poolMaterial);
            m.position.set(x + (z > 0 ? 12 : 0), 0.02, z * 0.7);
            scene.add(m);
        }
    }

    // two rows of sodium lamps overhead, running away along x (seen as lines of hot dots in paint and glass)
    const sodium = glow(kelvinHex(2000), dusk ? 18 : 30);
    const lamp = new THREE.BoxGeometry(1.4, 0.25, 0.6);
    for (let x = -200; x <= 200; x += 25) {
        for (const z of [-7.5, 7.5]) {
            const m = new THREE.Mesh(lamp, sodium);
            m.position.set(x + (z > 0 ? 12 : 0), 9, z);
            scene.add(m);
        }
    }

    // cool LED strips: a canopy of a filling station, a lit underpass – long thin panels
    const led = glow(kelvinHex(4800), dusk ? 6 : 10);
    for (const [x, y, z, w, d] of [[30, 6, 26, 18, 0.5], [30, 6, 30, 18, 0.5], [-48, 5, -30, 0.5, 22], [-70, 14, 18, 26, 0.4]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), led);
        m.position.set(x, y, z);
        scene.add(m);
    }

    // buildings all around with lit windows
    const windows = windowTexture(random);
    const facade = new THREE.MeshBasicMaterial({ map: windows, color: new THREE.Color(1, 1, 1).multiplyScalar(dusk ? 0.7 : 1.2), fog: false });
    for (let k = 0; k < 26; k++) {
        const a = (k / 26) * Math.PI * 2 + random() * 0.15;
        const r = 45 + random() * 70;
        const w = 18 + random() * 22;
        const h = 14 + random() * 60;
        const g = new THREE.BoxGeometry(w, h, 16);
        // window texture: repeat by the size of the face (one window ≈ 3 × 3.2 m)
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 12), uv.getY(i) * (h / 12.8));
        const m = new THREE.Mesh(g, facade);
        m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
        m.lookAt(0, h / 2, 0);
        scene.add(m);
    }

    // neon panels at shop height: pink, cyan, violet, a warm amber
    const neons = [0xff2e88, 0x29e7ff, 0x8b5cf6, 0xffb020, 0x3ef08a];
    for (let k = 0; k < 12; k++) {
        const a = random() * Math.PI * 2;
        const r = 22 + random() * 26;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2 + random() * 4, 0.6 + random() * 1.6), glow(neons[k % neons.length], dusk ? 4 : 7));
        m.position.set(Math.cos(a) * r, 3 + random() * 6, Math.sin(a) * r);
        m.lookAt(0, m.position.y, 0);
        scene.add(m);
    }

    // the moon (night) – a small bright disc in the same direction as in world/env.js
    if (!dusk) {
        const moon = new THREE.Mesh(new THREE.CircleGeometry(4, 20), glow(0xdfe6ff, 6));
        moon.position.set(-420, 380, -640).setLength(250);
        moon.lookAt(0, 0, 0);
        scene.add(moon);
    }
}

/** A dark workshop: grey walls, rows of tube lights under the ceiling, two softboxes over the turntable, neon on the back wall. */
function buildGarage(scene) {
    const room = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 20), glow(0x2a2a30, 0.03, { side: THREE.BackSide }));
    room.position.y = 3.5;
    scene.add(room);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 20).rotateX(-Math.PI / 2), glow(0x202024, 0.02));
    floor.position.y = 0.01;
    scene.add(floor);
    const tube = glow(kelvinHex(5200), 14);
    for (const x of [-7, -2.3, 2.3, 7]) {
        for (const z of [-6, 0, 6]) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 3.6), tube);
            m.position.set(x, 6.85, z);
            scene.add(m);
        }
    }
    const soft = glow(kelvinHex(5600), 3.2);
    for (const [x, z, ry] of [[-3.5, 1.5, 0.5], [3.5, -1.5, -0.5]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), soft);
        m.position.set(x, 4.6, z);
        m.rotation.set(-Math.PI / 2 + 0.6 * Math.sign(x), ry, 0);
        scene.add(m);
    }
    const pink = new THREE.Mesh(new THREE.BoxGeometry(10, 0.08, 0.08), glow(0xff2e88, 9));
    pink.position.set(0, 5.6, -9.8);
    const cyan = new THREE.Mesh(new THREE.BoxGeometry(10, 0.08, 0.08), glow(0x29e7ff, 9));
    cyan.position.set(0, 5.9, -9.8);
    const violet = glow(0x8b5cf6, 7);
    scene.add(pink, cyan);
    for (const x of [-11.8, 11.8]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5, 0.08), violet);
        m.position.set(x, 3, -6);
        scene.add(m);
    }
    // the roller door: a slightly lighter, ribbed panel behind the car
    const door = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), glow(0x3a3a44, 0.05));
    door.position.set(0, 2.5, -9.9);
    scene.add(door);
}

/** Windows of a facade: a grid, some lit warm, some cool, most dark. */
function windowTexture(random) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d');
    c.fillStyle = '#030305';
    c.fillRect(0, 0, 128, 128);
    const colours = ['#ffcf8a', '#ffd9a8', '#cfe3ff', '#fff1d6', '#ff9f5a'];
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            if (random() > 0.38) continue;
            c.fillStyle = colours[Math.floor(random() * colours.length)];
            c.globalAlpha = 0.35 + random() * 0.65;
            c.fillRect(x * 32 + 5, y * 32 + 6, 22, 18);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

function disposeScene(scene) {
    scene.traverse(o => {
        o.geometry?.dispose();
        if (o.material) {
            o.material.map?.dispose();
            o.material.dispose();
        }
    });
}
