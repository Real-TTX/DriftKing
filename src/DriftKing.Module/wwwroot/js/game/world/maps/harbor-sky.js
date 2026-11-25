// DriftKing · maps/harbor-sky.js – the reflection map of Kaikō-Docks: what the harbour itself looks like from the middle of the yard, pre-filtered
// once per world (PMREM, like render/environment.js does for the generic street): the open sky of the time of day (the same gradient,
// light dome and afterglow as world/env.js draws), the dark wet yard with the sodium pools of the masts, the masts' lamp clusters at their
// real places, walls of containers, the cranes' cool floodlights and red aviation lights over the quay, the ship's lit superstructure,
// the town's windows in the north and the far shore's lamps in the south. So wet asphalt, puddles, the water, car paint and glass mirror
// this place – not a city street with neon signs. Freed with the world (scene.environment is not shared).

import * as THREE from 'three';
import { getRenderer } from '../../render/device.js';
import { rng } from '../../render/kit.js';
import { kelvinHex } from '../../render/lights.js';
import { HARBOR, LED, SODIUM } from './harbor-parts.js';

const { quayZ: QUAY_Z } = HARBOR;
/** The set sun of world/env.js (west-north-west, just below the horizon). */
const SUN = new THREE.Vector3(-0.85, -0.04, 0.52).normalize();

/** An unlit HDR colour (linear × strength) for the cube render. */
function glow(hex, strength, side = THREE.DoubleSide) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(strength), side, fog: false });
}

/** The sky dome with the palette's gradient per vertex (world/env.js's formula, without clouds and stars). */
function skyDome(palette) {
    const geometry = new THREE.SphereGeometry(500, 48, 24);
    const c = hex => new THREE.Color(hex);
    const [top, mid, horizon, pollution, dome, afterglow, below] = [palette.top, palette.mid, palette.horizon, palette.pollution, palette.dome, palette.afterglow, palette.fog].map(c);
    below.multiplyScalar(0.3);
    const p = geometry.attributes.position;
    const colours = new Float32Array(p.count * 3);
    const out = new THREE.Color();
    const tmp = new THREE.Color();
    const d = new THREE.Vector3();
    const smooth = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    const sunXZ = new THREE.Vector2(SUN.x, SUN.z).normalize();
    for (let i = 0; i < p.count; i++) {
        d.fromBufferAttribute(p, i).normalize();
        const hp = Math.max(d.y, 0);
        out.copy(horizon).lerp(mid, smooth(0, 0.25, hp)).lerp(top, smooth(0.2, 0.85, hp));
        out.add(tmp.copy(pollution).multiplyScalar(Math.exp(-hp * 9)));
        out.add(tmp.copy(dome).multiplyScalar(Math.exp(-hp * 3) * 0.5));
        const flat = Math.hypot(d.x, d.z) || 1;
        const toSun = Math.max((d.x / flat) * sunXZ.x + (d.z / flat) * sunXZ.y, 0);
        out.add(tmp.copy(afterglow).multiplyScalar(Math.pow(toSun, 4) * Math.exp(-hp * 6) + Math.pow(toSun, 1.5) * Math.exp(-hp * 2) * 0.25));
        if (d.y < 0) out.lerp(below, smooth(0, -0.06, d.y));
        colours.set([out.r, out.g, out.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

/**
 * Builds the harbour's reflection map (null without a renderer – then the scene keeps what it has).
 * @param {object} ctx the map context (palette, timeOfDay)
 * @param {{ masts: { x: number, z: number }[], cranes: number[] }} places where the real lamps stand
 * @returns {THREE.Texture|null}
 */
export function harborEnvironment(ctx, { masts, cranes }) {
    const renderer = getRenderer();
    if (!renderer) return null;
    const dusk = ctx.timeOfDay === 'dusk';
    const random = rng(dusk ? 611 : 307);
    const scene = new THREE.Scene();
    scene.add(skyDome(ctx.palette));
    // the yard: dark wet asphalt, warm pools under the masts
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), glow(0x1a1a1e, dusk ? 0.05 : 0.022)));
    const poolMaterial = glow(0xffa860, dusk ? 0.16 : 0.3);
    const lampMaterial = glow(SODIUM, dusk ? 22 : 34);
    const pool = new THREE.CircleGeometry(16, 20).rotateX(-Math.PI / 2);
    const lamp = new THREE.BoxGeometry(2.6, 0.35, 2.6);
    for (const m of masts) {
        const p = new THREE.Mesh(pool, poolMaterial);
        p.position.set(m.x, 0.03, m.z);
        scene.add(p);
        const l = new THREE.Mesh(lamp, lampMaterial);
        l.position.set(m.x, 23.6, m.z);
        scene.add(l);
    }
    // container walls along the rows (dim, lit from the masts)
    const paints = [0x1f4b87, 0x7c2620, 0xc05a1a, 0x2a5c43, 0x878d94, 0xd8d4c8, 0x6c3a25];
    const boxMaterials = paints.map(hex => glow(hex, dusk ? 0.05 : 0.03));
    for (let z = HARBOR.minZ + 8; z < QUAY_Z - 10; z += 20) {
        for (let x = HARBOR.minX + 10; x < HARBOR.maxX - 10; x += 12.7) {
            if (random() < 0.35) continue;
            const h = 2.6 * (1 + Math.floor(random() * 3));
            const g = new THREE.BoxGeometry(12.2, h, 10);
            const mesh = new THREE.Mesh(g, boxMaterials[Math.floor(random() * boxMaterials.length)]);
            mesh.position.set(x, h / 2, z + 5);
            scene.add(mesh);
        }
    }
    // the cranes: dark steel against the sky, cool floodlights under the portal and the boom, red lights on top
    const steel = glow(0x2a1a16, dusk ? 0.08 : 0.03);
    const flood = glow(LED, dusk ? 18 : 26);
    const red = glow(0xff2a1a, 10);
    for (const x of cranes) {
        for (const dx of [-7, 7]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(1.3, 32, 10), steel);
            leg.position.set(x + dx, 16, QUAY_Z - 7);
            scene.add(leg);
        }
        const boom = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 80), steel);
        boom.position.set(x, 34, QUAY_Z + 10);
        scene.add(boom);
        for (const z of [QUAY_Z - 11, QUAY_Z - 3, QUAY_Z + 14, QUAY_Z + 30]) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 1.2), flood);
            f.position.set(x, 31, z);
            scene.add(f);
        }
        const r = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), red);
        r.position.set(x, 58, QUAY_Z - 5);
        scene.add(r);
    }
    // the ship: a dark hull, the white accommodation with lit windows
    const hull = new THREE.Mesh(new THREE.BoxGeometry(230, 12, 32), glow(0x1c222c, dusk ? 0.05 : 0.02));
    hull.position.set(13, 2, QUAY_Z + 19);
    scene.add(hull);
    const house = new THREE.Mesh(new THREE.BoxGeometry(18, 20, 24), glow(0xd6d6d0, dusk ? 0.12 : 0.05));
    house.position.set(-73, 18, QUAY_Z + 19);
    scene.add(house);
    const lit = glow(kelvinHex(3300), 1.6);
    for (let k = 0; k < 30; k++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), lit);
        w.position.set(-81 + (k % 8) * 2.3, 10 + Math.floor(k / 8) * 2.8, QUAY_Z + 6.9);
        w.rotation.y = Math.PI;
        scene.add(w);
    }
    // the town in the north: dark blocks with rows of lit windows; the far shore's lamps in the south
    const block = glow(0x15151a, dusk ? 0.06 : 0.02);
    const windows = glow(kelvinHex(3000), dusk ? 0.9 : 1.4);
    for (let k = 0; k < 40; k++) {
        const x = -500 + random() * 1000;
        const z = HARBOR.minZ - 90 - random() * 300;
        const h = 12 + random() * 45;
        const b = new THREE.Mesh(new THREE.BoxGeometry(24, h, 20), block);
        b.position.set(x, h / 2, z);
        scene.add(b);
        for (let y = 3; y < h - 2; y += 3.2) {
            if (random() < 0.45) continue;
            const w = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.2), windows);
            w.position.set(x, y, z + 10.1);
            scene.add(w);
        }
    }
    const shore = glow(SODIUM, dusk ? 14 : 22);
    for (let x = -680; x < 700; x += 38) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), shore);
        s.position.set(x, 9, QUAY_Z + 364);
        scene.add(s);
    }
    const generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(scene, 0.02, 0.1, 900, { size: 256, position: new THREE.Vector3(0, 1.6, 0) });
    generator.dispose();
    scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
    });
    const texture = target.texture;
    texture.name = 'DriftKing.environment.harbor';
    // disposeTree frees the scene's own environment texture: take the render target with it
    let freed = false;
    texture.addEventListener('dispose', () => {
        if (freed) return;
        freed = true;
        target.dispose();
    });
    return texture;
}
