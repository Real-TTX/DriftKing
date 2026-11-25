// DriftKing · fx/textures.js – the procedural textures of the effects, made once per page and shared (never disposed by their users):
// the smoke puffs (an atlas of four cloudy shapes, density in alpha) and the tyre print of the skid marks (rubber density in alpha).
// Seeded, so every client draws the same shapes.

import * as THREE from 'three';
import { rng } from '../render/kit.js';

const cache = new Map();

/** A small seeded value noise (smooth, 0..1) on a 256-lattice. */
function valueNoise(seed) {
    const random = rng(seed);
    const table = new Float32Array(256 * 256);
    for (let k = 0; k < table.length; k++) table[k] = random();
    const at = (x, y) => table[(y & 255) * 256 + (x & 255)];
    return (x, y) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        return a + (b - a) * sy;
    };
}

function fbm(noise, x, y, octaves) {
    let sum = 0;
    let amplitude = 0.5;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
        sum += noise(x, y) * amplitude;
        total += amplitude;
        x = x * 2.03 + 17.1;
        y = y * 2.03 + 9.7;
        amplitude *= 0.5;
    }
    return sum / total;
}

function dataTexture(width, height, data, { repeatV = false } = {}) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.userData.shared = true;
    return texture;
}

/**
 * The smoke puffs: a 2 × 2 atlas of billowing clouds – a cluster of soft balls (a union, so the edge is a row of round billows) worn by noise
 * into wisps. Alpha = density; red = the light that reaches a texel from above through the cloud (self-shadowing: bright tops, dark bellies),
 * for the shaded tiers. cell: pixels per puff (low 64, else 128). v = 1 is the top of a puff.
 * @returns {THREE.DataTexture}
 */
export function smokeAtlas(cell = 128) {
    const key = `smoke:${cell}`;
    if (cache.has(key)) return cache.get(key);
    const size = cell * 2;
    const data = new Uint8Array(size * size * 4);
    const density = new Float32Array(cell * cell);
    for (let v = 0; v < 4; v++) {
        const random = rng(401 + v * 31);
        const coarse = valueNoise(101 + v * 7);
        const fine = valueNoise(211 + v * 13);
        // the billows: a big ball in the middle and a ring of smaller ones around it, a little more on top
        const balls = [{ x: 0, y: -0.06, r: 0.6 }];
        const count = 6 + Math.floor(random() * 4);
        for (let b = 0; b < count; b++) {
            const a = (b / count) * Math.PI * 2 + random() * 0.6;
            const d = 0.3 + random() * 0.22;
            balls.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85 + 0.04, r: 0.26 + random() * 0.2 });
        }
        for (let j = 0; j < cell; j++) {
            for (let i = 0; i < cell; i++) {
                const u = ((i + 0.5) / cell) * 2 - 1;
                const w = ((j + 0.5) / cell) * 2 - 1;
                // a soft union of the balls
                let clear = 1;
                for (const b of balls) {
                    const q = ((u - b.x) ** 2 + (w - b.y) ** 2) / (b.r * b.r);
                    if (q < 1) clear *= 1 - (1 - q) * (1 - q) * 0.95;
                }
                const n = fbm(coarse, u * 2.4 + 5, w * 2.4 + 3, 4);
                const m = fbm(fine, u * 5.1 + 1, w * 5.1 + 8, 4);
                // worn into wisps at the edge, a little mottled inside; nothing near the border of the cell
                let d = (1 - clear) * (0.6 + 0.65 * n) * (0.62 + 0.55 * m);
                d = smooth(0.06, 0.95, d) * (1 - smooth(0.86, 0.99, Math.hypot(u, w)));
                density[j * cell + i] = d;
            }
        }
        const ox = (v % 2) * cell;
        const oy = Math.floor(v / 2) * cell;
        // light from above: the density between a texel and the top of the puff dims it (Beer–Lambert)
        for (let i = 0; i < cell; i++) {
            let depth = 0;
            for (let j = cell - 1; j >= 0; j--) {
                const d = density[j * cell + i];
                const light = Math.exp(-depth * 3.2);
                depth += (d * 2) / cell;
                const k = ((oy + j) * size + ox + i) * 4;
                data[k] = Math.round(light * 255);
                data[k + 1] = 255;
                data[k + 2] = 255;
                data[k + 3] = Math.round(Math.min(1, d) * 255);
            }
        }
    }
    const texture = dataTexture(size, size, data);
    cache.set(key, texture);
    return texture;
}

/**
 * The tyre print of a skid mark: u across the tyre (soft edges, four lighter grooves), v along the track (one tile = 2 m: streaks, blotches).
 * Alpha = rubber density.
 * @returns {THREE.DataTexture}
 */
export function skidPrint() {
    const key = 'skid';
    if (cache.has(key)) return cache.get(key);
    const width = 64;
    const height = 256;
    const data = new Uint8Array(width * height * 4);
    const noise = valueNoise(307);
    const streaks = valueNoise(419);
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const u = (i + 0.5) / width;
            const v = (j + 0.5) / height;
            const across = smooth(0, 0.16, u) * smooth(1, 0.84, u);
            // the grooves of the tread leave lighter lines
            const groove = 1 - 0.45 * Math.max(0, Math.cos((u - 0.12) * Math.PI * 2 * 4.2)) ** 18;
            // streaks along the track (the rubber is smeared, not printed): stretched noise, tileable along v
            const s = tiled(streaks, u * 24, v, 3);
            const blotch = tiled(noise, u * 3, v, 2);
            const density = across * groove * (0.55 + 0.45 * s) * (0.7 + 0.5 * blotch);
            const k = (j * width + i) * 4;
            data[k] = 255;
            data[k + 1] = 255;
            data[k + 2] = 255;
            data[k + 3] = Math.round(Math.min(1, density) * 255);
        }
    }
    const texture = dataTexture(width, height, data, { repeatV: true });
    cache.set(key, texture);
    return texture;
}

/** Noise that tiles along v (period 1): blended with its copy one period on. */
function tiled(noise, x, v, scale) {
    const a = fbm(noise, x, v * scale * 8, 3);
    const b = fbm(noise, x, (v - 1) * scale * 8, 3);
    return a * (1 - v) + b * v;
}

function smooth(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
