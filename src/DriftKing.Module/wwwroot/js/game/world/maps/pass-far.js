// DriftKing · maps/pass-far.js – what lies beyond the Tenjō-Pass: two rings of mountain ridges around the basin as silhouettes against
// the light-polluted sky (paler the farther, aerial perspective), the town on the plain far below in the south – thousands of tiny lights
// along its streets, a lit centre, a highway, a few hamlets in the side valleys, red lights on masts – and mist lying in the valleys,
// lit faintly by the town. The lights are one Points draw with their own small shader (no fog: they shine through the haze).

import * as THREE from 'three';
import { rng } from '../../render/kit.js';

/** The town: centre and extent on the plain (y −62). */
const TOWN = { x: 60, z: 760, y: -61.5 };

/**
 * Builds the horizon, the town lights and the valley mist.
 * @param {object} ctx the map context
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 */
export function buildFar(ctx, layout) {
    buildRidges(ctx);
    buildTownLights(ctx, layout);
    if (ctx.quality !== 'low') buildMist(ctx);
}

// ---------------------------------------------------------------- ridges

function buildRidges(ctx) {
    const { root, palette } = ctx;
    const fog = new THREE.Color(palette.fog);
    const horizon = new THREE.Color(palette.horizon);
    const mid = new THREE.Color(palette.mid);
    const glow = new THREE.Color(palette.pollution);
    const layers = [
        { radius: 1010, base: 70, amp: 150, seed: 31, haze: 0.28 },
        { radius: 1075, base: 120, amp: 190, seed: 47, haze: 0.55 },
    ];
    const positions = [];
    const colours = [];
    const indices = [];
    const segments = ctx.quality === 'low' ? 160 : 260;
    for (const layer of layers) {
        const random = rng(layer.seed);
        const phases = Array.from({ length: 6 }, () => random() * Math.PI * 2);
        const peaks = Array.from({ length: 9 }, () => ({ a: random() * Math.PI * 2, w: 0.08 + random() * 0.18, h: 0.4 + random() * 0.8 }));
        // a silhouette a little darker than the sky behind it, bluer and paler the farther (aerial perspective)
        const top = new THREE.Color().copy(fog).lerp(mid, 0.35).lerp(horizon, layer.haze * 0.3).multiplyScalar(0.8 + layer.haze * 0.2);
        const bottom = new THREE.Color().copy(top).lerp(glow, 0.12);
        const base = positions.length / 3;
        for (let k = 0; k <= segments; k++) {
            const a = (k / segments) * Math.PI * 2;
            let h = 0.5
                + 0.25 * Math.sin(a * 3 + phases[0]) + 0.18 * Math.sin(a * 7 + phases[1]) + 0.1 * Math.sin(a * 13 + phases[2])
                + 0.05 * Math.sin(a * 29 + phases[3]) + 0.025 * Math.sin(a * 61 + phases[4]);
            for (const p of peaks) {
                const d = Math.abs(((a - p.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
                h += p.h * Math.max(0, 1 - d / p.w) ** 1.6;
            }
            // lower in the south, where the plain of the town runs out between the hills
            const south = Math.max(0, Math.sin(a));
            h *= 1 - 0.55 * south ** 3;
            const x = Math.cos(a) * layer.radius;
            const z = Math.sin(a) * layer.radius;
            const y = layer.base * (1 - 0.6 * south ** 3) + layer.amp * h;
            positions.push(x, -140, z, x, y, z);
            colours.push(bottom.r, bottom.g, bottom.b, top.r, top.g, top.b);
            if (k < segments) {
                const v = base + k * 2;
                // seen from inside the ring
                indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    // behind everything of the map, before the sky
    mesh.renderOrder = -1;
    root.add(mesh);
}

// ---------------------------------------------------------------- town lights

const TOWN_VERTEX = /* glsl */ `
    attribute float size;
    attribute vec3 tint;
    varying vec3 vTint;
    uniform float scale;
    void main() {
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float distance = max(-mv.z, 1.0);
        gl_PointSize = clamp(size * scale / distance, 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
    }`;

// a soft round point in linear light; through the haze the lights keep their colour but lose some strength (uniform `haze`)
const TOWN_FRAGMENT = /* glsl */ `
    uniform float haze;
    varying vec3 vTint;
    void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0) discard;
        float a = exp(-r * 3.2);
        gl_FragColor = vec4(vTint * a * haze, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

function buildTownLights(ctx, layout) {
    const { root, detail } = ctx;
    const random = rng(1717);
    const positions = [];
    const sizes = [];
    const tints = [];
    const colour = new THREE.Color();
    const add = (x, z, size, hex, strength) => {
        positions.push(x, TOWN.y + random() * 1.5, z);
        sizes.push(size);
        colour.set(hex).multiplyScalar(strength);
        tints.push(colour.r, colour.g, colour.b);
    };
    const sodium = 0xffa04a;
    const warm = [0xffd9a0, 0xffc890, 0xffe6c0];
    const cool = [0xd8ecff, 0xbfd8ff, 0xf0f4ff];
    // the street grid: blocks of ~70 m turned a little, lamps along the streets, windows in the blocks, denser near the centre
    const blocks = Math.round(240 * detail);
    for (let b = 0; b < blocks; b++) {
        const r = Math.pow(random(), 0.7) * 520;
        const a = random() * Math.PI * 2;
        const bx = TOWN.x + Math.cos(a) * r * 1.5;
        const bz = TOWN.z + Math.sin(a) * r * 0.45;
        if (bz < 560 || Math.hypot(bx, bz) > 960) continue;
        const centre = 1 - Math.min(1, r / 520);
        // a street along the block (sodium or LED lamps every ~25 m)
        const along = random() < 0.5;
        const led = random() < 0.35;
        for (let k = 0; k < 3; k++) add(bx + (along ? k * 25 : 0), bz + (along ? 0 : k * 25), 2.2, led ? 0xe8f0ff : sodium, 2.2 + centre * 1.5);
        // windows and yards in the block
        const lit = 4 + Math.floor(centre * 14 * random());
        for (let k = 0; k < lit; k++) {
            const list = random() < 0.75 ? warm : cool;
            add(bx + (random() - 0.5) * 60, bz + (random() - 0.5) * 60, 1.4 + random() * 1.2, list[Math.floor(random() * list.length)], 1.1 + centre * 1.2);
        }
        // a lit sign or a shop front now and then (the centre)
        if (centre > 0.5 && random() < 0.25) add(bx + (random() - 0.5) * 40, bz + (random() - 0.5) * 40, 3.2, [0xff4a6a, 0x4ae8ff, 0xffb020, 0x8b5cf6][Math.floor(random() * 4)], 2.6);
    }
    // a highway across the plain: a chain of sodium lamps and the lights of a few cars
    for (let t = -1; t <= 1; t += 0.006) {
        const x = TOWN.x + t * 900;
        const z = 640 + Math.sin(t * 2.2) * 80 + t * 120;
        if (Math.hypot(x, z) > 980) continue;
        add(x, z, 2.4, sodium, 2.6);
        if (random() < 0.12) add(x + 6, z + 2, 1.6, random() < 0.5 ? 0xfff2e0 : 0xff2a1a, 2.4);
    }
    // hamlets in the side valleys (east and west) and a few lone farms
    for (const [hx, hz, count] of [[560, 60, 26], [-560, 140, 22], [430, 380, 18], [-420, 420, 20], [620, -260, 12], [60, -540, 26], [-320, -500, 14]]) {
        for (let k = 0; k < count * detail; k++) {
            const x = hx + (random() - 0.5) * 120;
            const z = hz + (random() - 0.5) * 90;
            const ground = Math.max(-62, layout.natural(x, z));
            positions.push(x, ground + 1, z);
            sizes.push(1.6 + random());
            colour.set(random() < 0.3 ? sodium : warm[Math.floor(random() * 3)]).multiplyScalar(1.6);
            tints.push(colour.r, colour.g, colour.b);
        }
    }
    // red aviation lights on two masts on the hills
    for (const [x, z] of [[-700, -560], [760, -420]]) {
        positions.push(x, 190, z);
        sizes.push(5);
        colour.set(0xff2a1a).multiplyScalar(3.5);
        tints.push(colour.r, colour.g, colour.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 600 }, haze: { value: ctx.timeOfDay === 'dusk' ? 0.55 : 0.8 } },
        vertexShader: TOWN_VERTEX,
        fragmentShader: TOWN_FRAGMENT,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
    });
    material.onBeforeRender = (renderer, scene, camera) => {
        const height = renderer.getDrawingBufferSize(drawingSize).y;
        const fov = camera.isPerspectiveCamera ? camera.fov : 60;
        material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    };
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    root.add(points);
}

const drawingSize = new THREE.Vector2();

// ---------------------------------------------------------------- mist

/**
 * Mist in the valleys: two large sheets (the plain of the town, the side valleys) with the macro noise as their density, lit faintly by
 * the town; the terrain hides them where it rises above (they only show in the low ground). Medium/high only.
 */
function buildMist(ctx) {
    const { root, palette, textures } = ctx;
    const noise = textures.macro().map;
    const tint = new THREE.Color(palette.fog).lerp(new THREE.Color(palette.pollution), 0.2).lerp(new THREE.Color(palette.horizon), 0.3).multiplyScalar(1.45);
    for (const [y, size, cx, cz, opacity] of [[-44, 1900, 0, 560, 0.55], [-16, 1800, 0, 0, 0.32]]) {
        const geometry = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
        const uv = geometry.attributes.uv;
        // the noise in world metres / 3 (a 192 m period of the 64 m macro texture)
        const p = geometry.attributes.position;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (p.getX(k) + cx) / 3, -(p.getZ(k) + cz) / 3);
        geometry.translate(cx, y, cz);
        const material = new THREE.MeshBasicMaterial({ color: tint, alphaMap: noise, transparent: true, opacity, depthWrite: false, fog: false });
        material.onBeforeCompile = shader => {
            // patchy: only the denser half of the noise, softly; fading towards the edges of the sheet
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                `#include <alphamap_fragment>
                diffuseColor.a = opacity * smoothstep(0.42, 0.78, texture2D(alphaMap, vAlphaMapUv).g);`,
            );
        };
        material.customProgramCacheKey = () => 'pass-mist';
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 3;
        root.add(mesh);
    }
}
