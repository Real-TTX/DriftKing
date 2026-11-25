// DriftKing · world/env.js – sky, fog and light of a map: a gradient dome with stars and moon, a hemisphere fill and one moon light.
// The look is "night in the city": deep indigo above, a violet city glow at the horizon; dusk has an orange rim.

import * as THREE from 'three';
import { rng } from '../render/kit.js';

/** The colours of a time of day. */
export const PALETTES = {
    night: { top: 0x04030c, mid: 0x0f0b26, horizon: 0x3a1f5c, fog: 0x161030, fogNear: 60, fogFar: 650, hemiSky: 0x5a63b8, hemiGround: 0x16121f, hemi: 0.75, moon: 0x9fb4ff, moonPower: 0.7, stars: 1 },
    dusk: { top: 0x101a46, mid: 0x3a2c6a, horizon: 0xff7a45, fog: 0x3a2742, fogNear: 80, fogFar: 760, hemiSky: 0x8a87d8, hemiGround: 0x2a1c22, hemi: 0.95, moon: 0xffb58a, moonPower: 1.0, stars: 0.35 },
};

const SKY_VERTEX = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
    }`;

const SKY_FRAGMENT = /* glsl */ `
    uniform vec3 top;
    uniform vec3 mid;
    uniform vec3 horizon;
    varying vec3 vDir;
    void main() {
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.75, h));
        // below the horizon: the city glow fades into the fog colour
        c = mix(c, horizon * 0.55, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(c, 1.0);
    }`;

/**
 * Puts sky, stars, moon, fog and the lights into the scene.
 * @returns {{ moon: THREE.DirectionalLight, palette: object, follow(target: THREE.Vector3): void }} follow keeps the sky and the moon's shadow around the player
 */
export function buildEnvironment(scene, { timeOfDay = 'night', quality = 'medium', seed = 7 } = {}) {
    const palette = PALETTES[timeOfDay] ?? PALETTES.night;
    scene.background = new THREE.Color(palette.top);
    scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);

    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1000, 24, 12),
        new THREE.ShaderMaterial({
            uniforms: { top: { value: new THREE.Color(palette.top) }, mid: { value: new THREE.Color(palette.mid) }, horizon: { value: new THREE.Color(palette.horizon) } },
            vertexShader: SKY_VERTEX,
            fragmentShader: SKY_FRAGMENT,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);

    const stars = buildStars(seed, palette.stars, quality);
    scene.add(stars);

    const moonDisc = new THREE.Mesh(
        new THREE.CircleGeometry(22, 24),
        new THREE.MeshBasicMaterial({ color: timeOfDay === 'dusk' ? 0xffd2b0 : 0xe8ecff, fog: false, transparent: true, opacity: timeOfDay === 'dusk' ? 0.55 : 0.95 }),
    );
    moonDisc.position.set(-420, 380, -640);
    moonDisc.lookAt(0, 0, 0);
    scene.add(moonDisc);

    const hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemi);
    scene.add(hemi);

    const moon = new THREE.DirectionalLight(palette.moon, palette.moonPower);
    moon.position.set(-120, 160, -180);
    if (quality === 'high') {
        moon.castShadow = true;
        moon.shadow.mapSize.set(2048, 2048);
        const cam = moon.shadow.camera;
        cam.left = -60;
        cam.right = 60;
        cam.top = 60;
        cam.bottom = -60;
        cam.near = 10;
        cam.far = 500;
        moon.shadow.bias = -0.0008;
    }
    scene.add(moon);
    scene.add(moon.target);

    const offset = moon.position.clone();
    return {
        moon,
        palette,
        follow(target) {
            sky.position.copy(target);
            stars.position.copy(target);
            moonDisc.position.set(target.x - 420, 380, target.z - 640);
            moon.target.position.copy(target);
            moon.position.copy(target).add(offset);
        },
    };
}

function buildStars(seed, density, quality) {
    const random = rng(seed);
    const count = Math.round((quality === 'low' ? 500 : 1100) * density);
    const positions = [];
    const colors = [];
    for (let k = 0; k < count; k++) {
        const u = random() * Math.PI * 2;
        const v = 0.08 + random() * 0.9;
        const r = 900;
        const y = v * v;
        const ring = Math.sqrt(1 - y * y);
        positions.push(Math.cos(u) * ring * r, y * r, Math.sin(u) * ring * r);
        const b = 0.45 + random() * 0.55;
        colors.push(b, b, b * (0.9 + random() * 0.2));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.9 }));
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    return stars;
}
