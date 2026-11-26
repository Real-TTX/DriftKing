// DriftKing · render/textures.js – procedural PBR textures: seeded (every client sees the same), tileable, cached for the page, sized per quality.
// Each recipe returns a set { map, normalMap, roughnessMap, metalnessMap, aoMap, tile, ... }: map is sRGB albedo; roughnessMap/metalnessMap/aoMap
// are ONE linear "ORM" texture (R = ambient occlusion, G = roughness, B = metalness – three's channel convention); normalMap is tangent space.
// tile = the size of one repeat in metres ([u, v]); the textures carry repeat = 1 / tile, so geometry UVs are in METRES.
// On low only the albedo map is made (Lambert materials); normal/ORM are null. All textures are shared (userData.shared): never dispose them yourself.
//   const set = textures.asphalt({ wet: true });  material.map = set.map; material.normalMap = set.normalMap; ...
//   (or simply use render/materials.js, which does all of this)

import * as THREE from 'three';
import { rng } from './kit.js';
import { maxAnisotropy } from './device.js';

/** The edge length of a texture per quality: 'large' for surfaces seen up close (the road), 'small' for the rest. */
export const TEXTURE_SIZE = Object.freeze({
    low: { large: 256, small: 128 },
    medium: { large: 512, small: 256 },
    high: { large: 1024, small: 512 },
});

const cache = new Map();
/** Milliseconds spent generating textures since the page loaded (for the budgets; see docs/RENDERING.md). */
export const stats = { ms: 0, count: 0, bytes: 0 };

/**
 * The texture recipes of a quality. Every call with the same options returns the same (cached) set.
 * @param {string} quality low | medium | high
 */
export function texturesFor(quality = 'medium') {
    const sizes = TEXTURE_SIZE[quality] ?? TEXTURE_SIZE.medium;
    const full = quality !== 'low';
    // the quality is part of the key: every texture belongs to exactly one quality (also the ones of the same size on medium and high, such as
    // macro and flakes), so trimTextures never frees a texture the current quality still uses
    const make = (name, options, size, build) => cached(`${quality}:${name}:${JSON.stringify(options)}:${size}`, quality, () => build(size, options, full));
    return {
        quality,
        /** Road asphalt, 4 m tile: binder, exposed aggregate, fine cracks; wet: water stands in the cavities (glossy), the binder darkens. */
        asphalt: (o = {}) => make('asphalt', { seed: 11, wet: false, cracks: true, ...o }, sizes.large, asphalt),
        /** Cast concrete, 4 m tile: mottling, pores, formwork seams (2 m panels), water stains running down. */
        concrete: (o = {}) => make('concrete', { seed: 21, seams: true, stains: true, ...o }, sizes.large, concrete),
        /** Painted / epoxy floor (parking deck, garage), 6 m tile: near-white albedo to tint with material.color, scuffs, tyre marks, chips. */
        floor: (o = {}) => make('floor', { seed: 31, ...o }, sizes.large, floor),
        /** Corrugated sheet (containers, sheds), 2.6 m tile (one container side): trapezoid ribs, light albedo to tint, rust and grime. */
        corrugated: (o = {}) => make('corrugated', { seed: 41, rust: 0.5, ...o }, sizes.small, corrugated),
        /** Brushed metal, 1 m tile: fine streaks along u, metalness 1. */
        brushed: (o = {}) => make('brushed', { seed: 51, ...o }, sizes.small, brushed),
        /** Tyre tread, one tile = the full circumference (u) × tread width (v): grooves, sipes, worn dusty blocks. */
        tread: (o = {}) => make('tread', { seed: 61, ...o }, sizes.small, tread),
        /** Ground, 3 m tile: kind 'grass' | 'dirt' | 'gravel'. */
        ground: (o = {}) => make('ground', { seed: 71, kind: 'grass', ...o }, sizes.small, ground),
        /** Rock face, 6 m tile: strata, cracks, ridges. */
        rock: (o = {}) => make('rock', { seed: 81, ...o }, sizes.small, rock),
        /** Tree bark, 1 × 2 m tile: vertical fibres and cracks. */
        bark: (o = {}) => make('bark', { seed: 91, ...o }, sizes.small, bark),
        /** Foliage card with alpha (kind 'needles' | 'leaves'), one card = tile: use alphaTest ~0.5, side DoubleSide. */
        foliage: (o = {}) => make('foliage', { seed: 101, kind: 'needles', ...o }, sizes.small, foliage),
        /** Brick wall, 0.9 × 0.6 m tile (running bond). */
        brick: (o = {}) => make('brick', { seed: 111, ...o }, sizes.small, brick),
        /** Ceramic tiles, 1.2 m tile (4 × 4 tiles of 0.3 m): glossy tiles, rough grout. */
        tiles: (o = {}) => make('tiles', { seed: 121, ...o }, sizes.small, tiles),
        /** Office/residential facade, 12 × 12.8 m tile (4 bays × 4 storeys): recessed glass windows, some lit (emissiveMap). */
        facade: (o = {}) => make('facade', { seed: 131, lit: 0.35, ...o }, sizes.large, facade),
        /** Overlay with alpha: kind 'grime' (soot, streaks) | 'rust' (orange-brown blooms). Use as a transparent decal layer or alphaMap. */
        overlay: (o = {}) => make('overlay', { seed: 141, kind: 'grime', ...o }, sizes.small, overlay),
        /** Metallic flakes for car paint (normal map only), 0.05 m tile – use normalScale ~0.15–0.3. */
        flakes: (o = {}) => make('flakes', { seed: 151, ...o }, Math.min(256, sizes.small), flakes),
        /** Large-scale variation (R: patches/puddles, G: tone, B: fine), 256², tile 64 m – the anti-tiling layer of render/materials.js. */
        macro: (o = {}) => make('macro', { seed: 161, ...o }, 256, macro),
    };
}

/**
 * Frees every cached texture made for another quality and forgets it. Call it through materials.js trimMaterials (buildWorld does): the
 * material factories hold these textures too, and only trimMaterials drops them together – this alone would leave the other qualities'
 * cached materials uploading the freed textures again.
 */
export function trimTextures(quality) {
    for (const [key, entry] of cache) {
        if (entry.quality === quality) continue;
        for (const t of entry.textures) t.dispose();
        cache.delete(key);
    }
}

/** Frees every cached texture (materials.js disposeMaterials calls it together with dropping the material factories). */
export function disposeTextures() {
    for (const entry of cache.values()) for (const t of entry.textures) t.dispose();
    cache.clear();
}

function cached(key, quality, build) {
    const hit = cache.get(key);
    if (hit) return hit.set;
    const started = performance.now();
    const set = build();
    const textures = Object.values(set).filter(v => v?.isTexture);
    const unique = [...new Set(textures)];
    for (const t of unique) {
        t.userData.shared = true;
        stats.bytes += t.image.data ? Math.round(t.image.data.byteLength * 1.33) : 0;
    }
    stats.ms += performance.now() - started;
    stats.count += 1;
    cache.set(key, { set, quality, textures: unique });
    return set;
}

// ---------------------------------------------------------------- noise fields (Float32Array of n × n, tileable)

/** Adds amp × tileable value noise with cx × cy lattice cells (quintic interpolation) to out. */
function addValueNoise(out, n, seed, cx, cy, amp) {
    const random = rng(seed);
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const x0 = new Int32Array(n);
    const x1 = new Int32Array(n);
    const wx = new Float32Array(n);
    for (let x = 0; x < n; x++) {
        const f = (x * cx) / n;
        const i = Math.floor(f);
        const t = f - i;
        x0[x] = i % cx;
        x1[x] = (i + 1) % cx;
        wx[x] = t * t * t * (t * (t * 6 - 15) + 10);
    }
    // every lattice row interpolated along x once; a pixel then only blends two of these rows
    const rows = new Float32Array(cy * n);
    for (let j = 0; j < cy; j++) {
        const base = j * cx;
        const out0 = j * n;
        for (let x = 0; x < n; x++) {
            const a = lattice[base + x0[x]];
            rows[out0 + x] = a + (lattice[base + x1[x]] - a) * wx[x];
        }
    }
    for (let y = 0; y < n; y++) {
        const f = (y * cy) / n;
        const j = Math.floor(f);
        let t = f - j;
        t = t * t * t * (t * (t * 6 - 15) + 10);
        const r0 = (j % cy) * n;
        const r1 = ((j + 1) % cy) * n;
        const row = y * n;
        for (let x = 0; x < n; x++) {
            const top = rows[r0 + x];
            out[row + x] += amp * (top + (rows[r1 + x] - top) * t);
        }
    }
}

/** Fractal value noise 0..1 (normalised to the full range): cells = lattice of the first octave; stretch = [sx, sy] cell multipliers. */
function fbm(n, seed, cells, octaves = 5, gain = 0.5, stretch = [1, 1]) {
    const out = new Float32Array(n * n);
    let amp = 1;
    let cx = cells * stretch[0];
    let cy = cells * stretch[1];
    for (let o = 0; o < octaves && cx <= n && cy <= n; o++) {
        addValueNoise(out, n, seed + o * 1013, Math.max(1, Math.round(cx)), Math.max(1, Math.round(cy)), amp);
        amp *= gain;
        cx *= 2;
        cy *= 2;
    }
    return normalise(out);
}

/** Ridged fractal noise 0..1: sharp crests (rock, bark). */
function ridged(n, seed, cells, octaves = 4, stretch = [1, 1]) {
    const out = new Float32Array(n * n);
    const layer = new Float32Array(n * n);
    let amp = 1;
    let cx = cells * stretch[0];
    let cy = cells * stretch[1];
    for (let o = 0; o < octaves && cx <= n && cy <= n; o++) {
        layer.fill(0);
        addValueNoise(layer, n, seed + o * 733, Math.max(1, Math.round(cx)), Math.max(1, Math.round(cy)), 1);
        for (let i = 0; i < out.length; i++) {
            const r = 1 - Math.abs(layer[i] * 2 - 1);
            out[i] += amp * r * r;
        }
        amp *= 0.5;
        cx *= 2;
        cy *= 2;
    }
    return normalise(out);
}

/** Tileable cellular noise: f1 / f2 distances in cell units, id = a random value 0..1 of the nearest cell. */
function worley(n, seed, cells) {
    const random = rng(seed);
    const count = cells * cells;
    const jx = new Float32Array(count);
    const jy = new Float32Array(count);
    const jid = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        jx[i] = random();
        jy[i] = random();
        jid[i] = random();
    }
    const f1 = new Float32Array(n * n);
    const f2 = new Float32Array(n * n);
    const id = new Float32Array(n * n);
    const scale = cells / n;
    // per column: the position in cell units and the three wrapped neighbour columns (and their unwrapped cell origins)
    const colU = new Float32Array(n);
    const colK = new Int32Array(n * 3);
    const colO = new Float32Array(n * 3);
    for (let x = 0; x < n; x++) {
        const u = (x + 0.5) * scale;
        const ci = Math.floor(u);
        colU[x] = u;
        for (let d = 0; d < 3; d++) {
            const ii = ci + d - 1;
            colK[x * 3 + d] = ((ii % cells) + cells) % cells;
            colO[x * 3 + d] = ii;
        }
    }
    for (let y = 0; y < n; y++) {
        const v = (y + 0.5) * scale;
        const cj = Math.floor(v);
        const rows = [0, 1, 2].map(d => ((((cj + d - 1) % cells) + cells) % cells) * cells);
        const rowO = [cj - 1, cj, cj + 1];
        for (let x = 0; x < n; x++) {
            const u = colU[x];
            let d1 = 9;
            let d2 = 9;
            let best = 0;
            for (let dj = 0; dj < 3; dj++) {
                const base = rows[dj];
                const oy = v - rowO[dj];
                for (let di = 0; di < 3; di++) {
                    const k = base + colK[x * 3 + di];
                    const dx = u - colO[x * 3 + di] - jx[k];
                    const dy = oy - jy[k];
                    const d = dx * dx + dy * dy;
                    if (d < d1) {
                        d2 = d1;
                        d1 = d;
                        best = k;
                    } else if (d < d2) {
                        d2 = d;
                    }
                }
            }
            const p = y * n + x;
            f1[p] = Math.sqrt(d1);
            f2[p] = Math.sqrt(d2);
            id[p] = jid[best];
        }
    }
    return { f1, f2, id };
}

/** Per-pixel white noise 0..1. */
function grain(n, seed) {
    const random = rng(seed);
    const out = new Float32Array(n * n);
    for (let i = 0; i < out.length; i++) out[i] = random();
    return out;
}

function normalise(field) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const k = max > min ? 1 / (max - min) : 0;
    for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) * k;
    return field;
}

/** A separable box blur with wrap-around (soft stains, rounded seams). */
function blur(field, n, radius) {
    if (radius < 1) return field;
    const tmp = new Float32Array(n * n);
    const k = 1 / (radius * 2 + 1);
    for (let y = 0; y < n; y++) {
        const row = y * n;
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += field[row + ((i + n) % n)];
        for (let x = 0; x < n; x++) {
            tmp[row + x] = sum * k;
            sum += field[row + ((x + radius + 1) % n)] - field[row + ((x - radius + n) % n)];
        }
    }
    for (let x = 0; x < n; x++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += tmp[((i + n) % n) * n + x];
        for (let y = 0; y < n; y++) {
            field[y * n + x] = sum * k;
            sum += tmp[((y + radius + 1) % n) * n + x] - tmp[((y - radius + n) % n) * n + x];
        }
    }
    return field;
}

const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- packing into textures

/** An RGBA8 DataTexture, repeat-wrapped and mip-mapped. */
function dataTexture(data, n, { srgb = false, tile = [1, 1], name = '' } = {}) {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.name = name;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    // the albedo keeps its detail at grazing angles (8×); normal and ORM maps get 2×: a sharper normal far away would only sparkle (the
    // macro layer's specular anti-aliasing widens it again), and 8× on the data maps cost ≈ 1.2 ms per frame on the 610M (pass, city, medium)
    t.anisotropy = Math.min(srgb ? 8 : 2, maxAnisotropy());
    t.repeat.set(1 / tile[0], 1 / tile[1]);
    t.needsUpdate = true;
    return t;
}

/** A tangent-space normal map from a height field (0..1); strength = height difference in texels per unit height. */
function normalMap(height, n, strength, tile, name) {
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
        const up = ((y - 1 + n) % n) * n;
        const down = ((y + 1) % n) * n;
        const row = y * n;
        for (let x = 0; x < n; x++) {
            const left = (x - 1 + n) % n;
            const right = (x + 1) % n;
            // Sobel
            const tl = height[up + left], t = height[up + x], tr = height[up + right];
            const l = height[row + left], r = height[row + right];
            const bl = height[down + left], b = height[down + x], br = height[down + right];
            const dx = (tr + 2 * r + br - tl - 2 * l - bl) * strength;
            // texture v runs up (flipY is off for DataTextures: row 0 is v = 0), so +y in the field is +v
            const dy = (bl + 2 * b + br - tl - 2 * t - tr) * strength;
            const len = Math.sqrt(dx * dx + dy * dy + 1);
            const p = (row + x) * 4;
            data[p] = ((-dx / len) * 0.5 + 0.5) * 255;
            data[p + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
            data[p + 2] = ((1 / len) * 0.5 + 0.5) * 255;
            data[p + 3] = 255;
        }
    }
    return dataTexture(data, n, { tile, name });
}

/** Builds the texture set from per-pixel callbacks: albedo(i) → [r,g,b] sRGB 0..255 written into rgb; orm(i) → ao, roughness, metalness 0..1. */
function assemble(n, name, tile, { albedo, orm, height, strength = 2, alpha = null, emissive = null }, full) {
    const rgb = [0, 0, 0];
    const map = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        albedo(i, rgb);
        const p = i * 4;
        map[p] = rgb[0];
        map[p + 1] = rgb[1];
        map[p + 2] = rgb[2];
        map[p + 3] = alpha ? alpha(i) * 255 : 255;
    }
    const set = { map: dataTexture(map, n, { srgb: true, tile, name: `${name}.map` }), normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null, emissiveMap: null, tile };
    if (emissive) {
        const e = new Uint8Array(n * n * 4);
        for (let i = 0; i < n * n; i++) {
            emissive(i, rgb);
            const p = i * 4;
            e[p] = rgb[0];
            e[p + 1] = rgb[1];
            e[p + 2] = rgb[2];
            e[p + 3] = 255;
        }
        set.emissiveMap = dataTexture(e, n, { srgb: true, tile, name: `${name}.emissive` });
    }
    if (!full) return set;
    const o = new Uint8Array(n * n * 4);
    const out = [1, 1, 0];
    for (let i = 0; i < n * n; i++) {
        orm(i, out);
        const p = i * 4;
        o[p] = clamp01(out[0]) * 255;
        o[p + 1] = clamp01(out[1]) * 255;
        o[p + 2] = clamp01(out[2]) * 255;
        o[p + 3] = 255;
    }
    const ormTexture = dataTexture(o, n, { tile, name: `${name}.orm` });
    set.roughnessMap = set.metalnessMap = set.aoMap = ormTexture;
    if (height) set.normalMap = normalMap(height, n, strength * (n / 512), tile, `${name}.normal`);
    return set;
}

// ---------------------------------------------------------------- recipes

function asphalt(n, { seed, wet, cracks }, full) {
    const tile = [4, 4];
    const mottle = fbm(n, seed, 3, 5, 0.55);
    const fine = fbm(n, seed + 7, 24, 3, 0.5);
    const g = grain(n, seed + 3);
    // aggregate: stones of ~1–1.5 cm (3–4 texels at 512 per 4 m)
    const stones = worley(n, seed + 5, Math.round(n / 3.2));
    // a few hairline cracks: the edges of large cells, only where a mask allows (most of the surface has none)
    const crack = cracks ? worley(n, seed + 9, 3) : null;
    const crackMask = cracks ? fbm(n, seed + 13, 3, 3) : null;
    const height = new Float32Array(n * n);
    const exposed = new Float32Array(n * n);
    const crackLine = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        // a stone is exposed where the binder is worn: more in the mottled lighter patches
        const e = smooth(0.38, 0.62, stones.id[i] * 0.7 + mottle[i] * 0.5);
        const bump = 1 - smooth(0.15, 0.62, stones.f1[i]);
        exposed[i] = e * bump;
        let h = 0.35 + bump * (0.25 + e * 0.35) + (g[i] - 0.5) * 0.12 + (fine[i] - 0.5) * 0.15;
        if (crack) {
            const edge = crack.f2[i] - crack.f1[i];
            const c = (1 - smooth(0.0, 0.018, edge)) * smooth(0.7, 0.82, crackMask[i]);
            crackLine[i] = c;
            h -= c * 0.45;
        }
        height[i] = h;
    }
    // wet: water fills the surface up to a level – a flat, glossy film there, only the stone tops stick out (no glitter of a bumpy mirror)
    const level = 0.5;
    const surface = wet ? height.map(h => Math.max(h, level)) : height;
    return assemble(n, 'asphalt', tile, {
        height: surface,
        strength: wet ? 2.2 : 3.2,
        albedo(i, out) {
            // binder: very dark, slightly blue-grey; worn patches lighter; stones grey with a warm or cool cast
            const binder = 34 + mottle[i] * 22 + (g[i] - 0.5) * 10 - (wet ? 9 : 0);
            const stone = 70 + stones.id[i] * 70 + (g[i] - 0.5) * 16;
            let v = binder + (stone - binder) * exposed[i] * (wet ? 0.7 : 1);
            v *= 1 - crackLine[i] * 0.4;
            const warm = (stones.id[i] - 0.5) * 8 * exposed[i];
            out[0] = v + warm;
            out[1] = v + warm * 0.4;
            out[2] = v + 2 - warm * 0.3;
        },
        orm(i, out) {
            const cavity = clamp01((height[i] - 0.2) * 1.6);
            out[0] = 0.55 + cavity * 0.45;
            let r = 0.9 - exposed[i] * 0.2 + (g[i] - 0.5) * 0.08 + (mottle[i] - 0.5) * 0.06;
            if (wet) {
                const under = smooth(level + 0.06, level - 0.02, height[i]);
                r = r * 0.55 * (1 - under) + (0.1 + (mottle[i] - 0.5) * 0.04) * under;
            }
            out[1] = Math.max(wet ? 0.08 : 0.45, r + crackLine[i] * 0.08);
            out[2] = 0;
        },
    }, full);
}

function concrete(n, { seed, seams, stains }, full) {
    const tile = [4, 4];
    const mottle = fbm(n, seed, 4, 5, 0.55);
    const fine = fbm(n, seed + 3, 32, 3, 0.5);
    const g = grain(n, seed + 5);
    const streak = stains ? fbm(n, seed + 7, 10, 3, 0.5, [1, 0.12]) : null;
    const blotch = stains ? blur(fbm(n, seed + 9, 3, 4, 0.5), n, 2) : null;
    const height = new Float32Array(n * n);
    const seam = new Float32Array(n * n);
    const panel = n / 2;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            // pores: small dark pits
            const pore = g[i] > 0.985 ? 1 : 0;
            let s = 0;
            if (seams) {
                const dx = Math.min(x % panel, panel - (x % panel));
                const dy = Math.min(y % panel, panel - (y % panel));
                s = 1 - smooth(0.6, 2.2, Math.min(dx, dy) * (512 / n));
            }
            seam[i] = s;
            height[i] = 0.5 + (fine[i] - 0.5) * 0.25 + (mottle[i] - 0.5) * 0.1 - pore * 0.35 - s * 0.5;
        }
    }
    return assemble(n, 'concrete', tile, {
        height,
        strength: 2.2,
        albedo(i, out) {
            let v = 118 + (mottle[i] - 0.5) * 34 + (fine[i] - 0.5) * 14 + (g[i] - 0.5) * 8;
            if (stains) {
                v -= Math.max(0, streak[i] - 0.55) * 60 + Math.max(0, blotch[i] - 0.6) * 55;
            }
            v -= seam[i] * 30;
            out[0] = v + 2;
            out[1] = v;
            out[2] = v - 3;
        },
        orm(i, out) {
            out[0] = 1 - seam[i] * 0.5 - (height[i] < 0.3 ? 0.25 : 0);
            out[1] = 0.86 + (g[i] - 0.5) * 0.08 - (stains ? Math.max(0, blotch[i] - 0.65) * 0.4 : 0);
            out[2] = 0;
        },
    }, full);
}

function floor(n, { seed }, full) {
    const tile = [6, 6];
    const mottle = fbm(n, seed, 3, 5, 0.5);
    const scuff = fbm(n, seed + 3, 6, 4, 0.55, [1, 0.35]);
    const chips = worley(n, seed + 5, 24);
    const g = grain(n, seed + 7);
    // tyre marks: long soft dark arcs (a few sine bands, blurred)
    const marks = new Float32Array(n * n);
    const random = rng(seed + 11);
    for (let k = 0; k < 5; k++) {
        const phase = random() * Math.PI * 2;
        const offset = random() * n;
        const amp = n * (0.05 + random() * 0.12);
        const width = n * (0.008 + random() * 0.01);
        for (let x = 0; x < n; x++) {
            const yc = offset + Math.sin((x / n) * Math.PI * 2 + phase) * amp;
            for (const side of [-1, 1]) {
                const centre = yc + side * width * 2.6;
                for (let d = -Math.ceil(width); d <= Math.ceil(width); d++) {
                    const y = ((Math.round(centre) + d) % n + n) % n;
                    marks[y * n + x] = Math.max(marks[y * n + x], 1 - Math.abs(d) / (width + 1));
                }
            }
        }
    }
    blur(marks, n, 2);
    const height = new Float32Array(n * n);
    const chip = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        chip[i] = (1 - smooth(0.0, 0.08, chips.f1[i])) * (chips.id[i] > 0.82 ? 1 : 0);
        height[i] = 0.6 - chip[i] * 0.4 + (g[i] - 0.5) * 0.04;
    }
    return assemble(n, 'floor', tile, {
        height,
        strength: 1.6,
        albedo(i, out) {
            // near white: the material colour is the paint; chips show grey concrete, tyre marks dark rubber
            let v = 228 + (mottle[i] - 0.5) * 26 + (g[i] - 0.5) * 6 - Math.max(0, scuff[i] - 0.5) * 50;
            v = v * (1 - marks[i] * 0.55);
            const c = chip[i];
            out[0] = v * (1 - c) + 150 * c;
            out[1] = v * (1 - c) + 148 * c;
            out[2] = v * (1 - c) + 144 * c;
        },
        orm(i, out) {
            out[0] = 1 - chip[i] * 0.3;
            out[1] = 0.32 + Math.max(0, scuff[i] - 0.45) * 0.6 + marks[i] * 0.2 + chip[i] * 0.5 + (g[i] - 0.5) * 0.04;
            out[2] = 0;
        },
    }, full);
}

function corrugated(n, { seed, rust }, full) {
    // one tile = 2.6 m high (a container side) × 2.6 m wide; 9 trapezoid ribs across
    const tile = [2.6, 2.6];
    const ribs = 9;
    const mottle = fbm(n, seed, 4, 5, 0.5);
    const rustField = fbm(n, seed + 3, 6, 5, 0.6);
    const streaks = fbm(n, seed + 5, 14, 3, 0.5, [1, 0.1]);
    const g = grain(n, seed + 7);
    const height = new Float32Array(n * n);
    const rustMask = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        const v = y / n;
        // grime collects towards the bottom edge, rust starts there and at the top rail
        const edge = Math.max(1 - smooth(0.0, 0.18, v), 1 - smooth(0.0, 0.06, 1 - v));
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const phase = ((x / n) * ribs) % 1;
            // trapezoid: flat top, slanted flanks, flat valley
            const p = phase < 0.3 ? 1 : phase < 0.45 ? 1 - (phase - 0.3) / 0.15 : phase < 0.8 ? 0 : (phase - 0.8) / 0.2;
            height[i] = p * 0.85 + (g[i] - 0.5) * 0.02;
            rustMask[i] = clamp01(smooth(0.62 - rust * 0.25, 0.8, rustField[i] + edge * 0.25) + Math.max(0, streaks[i] - 0.7) * rust * 1.5 * edge);
        }
    }
    return assemble(n, 'corrugated', tile, {
        height,
        strength: 5,
        albedo(i, out) {
            const v = 214 + (mottle[i] - 0.5) * 30 - Math.max(0, streaks[i] - 0.5) * 50;
            const r = rustMask[i];
            out[0] = v * (1 - r) + (120 + rustField[i] * 40) * r;
            out[1] = v * (1 - r) + (62 + rustField[i] * 20) * r;
            out[2] = v * (1 - r) + 34 * r;
        },
        orm(i, out) {
            out[0] = 0.75 + height[i] * 0.25;
            out[1] = 0.48 + (mottle[i] - 0.5) * 0.12 + rustMask[i] * 0.42;
            out[2] = 0;
        },
    }, full);
}

function brushed(n, { seed }, full) {
    const tile = [1, 1];
    const lines = fbm(n, seed, 1, 6, 0.6, [2, 96]);
    const mottle = fbm(n, seed + 3, 3, 4, 0.5);
    const g = grain(n, seed + 5);
    const height = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) height[i] = lines[i] * 0.3 + (g[i] - 0.5) * 0.02;
    return assemble(n, 'brushed', tile, {
        height,
        strength: 0.8,
        albedo(i, out) {
            const v = 222 + (lines[i] - 0.5) * 20 + (mottle[i] - 0.5) * 10;
            out[0] = out[1] = v;
            out[2] = v + 3;
        },
        orm(i, out) {
            out[0] = 1;
            out[1] = 0.28 + (lines[i] - 0.5) * 0.14 + (mottle[i] - 0.5) * 0.08;
            out[2] = 1;
        },
    }, full);
}

function tread(n, { seed }, full) {
    // u: around the tyre (one tile = the circumference), v: across the tread
    const tile = [1, 1];
    const g = grain(n, seed);
    const wear = fbm(n, seed + 3, 4, 4, 0.5);
    const height = new Float32Array(n * n);
    const blocks = 64;
    for (let y = 0; y < n; y++) {
        const v = y / n;
        // four circumferential grooves
        const groove = [0.2, 0.4, 0.6, 0.8].some(c => Math.abs(v - c) < 0.025);
        const shoulder = v < 0.08 || v > 0.92;
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const u = (x / n) * blocks;
            // lateral sipes: angled, offset per rib
            const rib = Math.floor(v * 5);
            const s = (u + v * 3 + rib * 0.5) % 1;
            const sipe = s < 0.08 && !shoulder;
            const shoulderSlot = shoulder && ((u * 0.5) % 1) < 0.18;
            height[i] = groove ? 0 : sipe || shoulderSlot ? 0.35 : 0.85 + (g[i] - 0.5) * 0.05;
        }
    }
    blur(height, n, 1);
    return assemble(n, 'tread', tile, {
        height,
        strength: 4,
        albedo(i, out) {
            // nearly black rubber, the raised blocks a little dusty and scrubbed
            const v = 26 + height[i] * 10 + (wear[i] - 0.5) * 8 + (g[i] - 0.5) * 3;
            out[0] = v + 1;
            out[1] = v;
            out[2] = v;
        },
        orm(i, out) {
            out[0] = 0.5 + height[i] * 0.5;
            out[1] = 0.82 + (1 - height[i]) * 0.12 + (g[i] - 0.5) * 0.04;
            out[2] = 0;
        },
    }, full);
}

function ground(n, { seed, kind }, full) {
    const tile = [3, 3];
    const patches = fbm(n, seed, 3, 5, 0.55);
    const fine = fbm(n, seed + 3, 48, 2, 0.5);
    const g = grain(n, seed + 5);
    const pebbles = kind === 'grass' ? null : worley(n, seed + 7, kind === 'gravel' ? Math.round(n / 6) : Math.round(n / 16));
    const blades = kind === 'grass' ? fbm(n, seed + 9, 6, 4, 0.6, [12, 1]) : null;
    const height = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        let h = 0.5 + (fine[i] - 0.5) * 0.3 + (patches[i] - 0.5) * 0.2;
        if (pebbles) h += (1 - smooth(0.1, 0.5, pebbles.f1[i])) * (kind === 'gravel' ? 0.45 : 0.2) * (pebbles.id[i] > 0.4 ? 1 : 0);
        if (blades) h += (g[i] * 0.6 + blades[i] * 0.4 - 0.5) * 0.5;
        height[i] = h;
    }
    return assemble(n, `ground-${kind}`, tile, {
        height,
        strength: kind === 'grass' ? 2.5 : 3,
        albedo(i, out) {
            if (kind === 'grass') {
                // night grass: dark olive greens, dry straw patches, bits of soil
                const dry = smooth(0.55, 0.8, patches[i]);
                const soil = smooth(0.25, 0.1, patches[i]) * 0.8;
                const lum = 0.75 + g[i] * 0.4 + (blades[i] - 0.5) * 0.4;
                let r = (58 + dry * 50) * lum;
                let gg = (78 + dry * 30) * lum;
                let b = (34 + dry * 10) * lum;
                r = r * (1 - soil) + 70 * soil;
                gg = gg * (1 - soil) + 56 * soil;
                b = b * (1 - soil) + 40 * soil;
                out[0] = r;
                out[1] = gg;
                out[2] = b;
            } else {
                const stone = pebbles ? (1 - smooth(0.1, 0.5, pebbles.f1[i])) * (pebbles.id[i] > 0.4 ? 1 : 0) : 0;
                const base = kind === 'gravel' ? 96 : 78;
                const v = base + (patches[i] - 0.5) * 30 + (g[i] - 0.5) * 14;
                const s = 110 + pebbles.id[i] * 70;
                out[0] = (v + 8) * (1 - stone) + s * stone;
                out[1] = v * (1 - stone) + (s - 4) * stone;
                out[2] = (v - 12) * (1 - stone) + (s - 8) * stone;
            }
        },
        orm(i, out) {
            out[0] = 0.6 + clamp01(height[i]) * 0.4;
            out[1] = kind === 'grass' ? 0.88 + (g[i] - 0.5) * 0.1 : 0.92 - (pebbles ? (1 - smooth(0.1, 0.5, pebbles.f1[i])) * 0.15 : 0);
            out[2] = 0;
        },
    }, full);
}

function rock(n, { seed }, full) {
    const tile = [6, 6];
    const ridges = ridged(n, seed, 4, 6);
    const strata = fbm(n, seed + 3, 2, 4, 0.55, [1, 5]);
    const cracks = worley(n, seed + 5, 3);
    const g = grain(n, seed + 7);
    const mottle = fbm(n, seed + 9, 5, 4, 0.5);
    const height = new Float32Array(n * n);
    const crack = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        crack[i] = (1 - smooth(0.0, 0.03, cracks.f2[i] - cracks.f1[i])) * smooth(0.45, 0.7, mottle[i]);
        height[i] = ridges[i] * 0.6 + strata[i] * 0.35 + (g[i] - 0.5) * 0.05 - crack[i] * 0.15;
    }
    return assemble(n, 'rock', tile, {
        height,
        strength: 4,
        albedo(i, out) {
            const v = 88 + (mottle[i] - 0.5) * 36 + (strata[i] - 0.5) * 34 + (ridges[i] - 0.5) * 20 + (g[i] - 0.5) * 12 - crack[i] * 18;
            out[0] = v + 6;
            out[1] = v + 2;
            out[2] = v - 4;
        },
        orm(i, out) {
            out[0] = 0.55 + clamp01(height[i]) * 0.45;
            out[1] = 0.86 + (g[i] - 0.5) * 0.08;
            out[2] = 0;
        },
    }, full);
}

function bark(n, { seed }, full) {
    const tile = [1, 2];
    const fibres = ridged(n, seed, 3, 4, [6, 1]);
    const plates = worley(n, seed + 3, 8);
    const g = grain(n, seed + 5);
    const height = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        const gap = 1 - smooth(0.0, 0.08, plates.f2[i] - plates.f1[i]);
        height[i] = fibres[i] * 0.6 + (1 - gap) * 0.3 + (g[i] - 0.5) * 0.06;
    }
    return assemble(n, 'bark', tile, {
        height,
        strength: 5,
        albedo(i, out) {
            const v = 50 + height[i] * 45 + (plates.id[i] - 0.5) * 14;
            out[0] = v + 10;
            out[1] = v + 2;
            out[2] = v - 8;
        },
        orm(i, out) {
            out[0] = 0.5 + height[i] * 0.5;
            out[1] = 0.9;
            out[2] = 0;
        },
    }, full);
}

function foliage(n, { seed, kind }, full) {
    // drawn on a canvas (seeded): twigs with needles or clusters of leaves; alpha cut-out
    const tile = [1, 1];
    const random = rng(seed);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, n, n);
    c.lineCap = 'round';
    const s = n / 256;
    if (kind === 'leaves') {
        for (let k = 0; k < 140; k++) {
            const x = (0.1 + random() * 0.8) * n;
            const y = (0.1 + random() * 0.8) * n;
            const r = (6 + random() * 7) * s;
            const a = random() * Math.PI;
            const l = 30 + random() * 40;
            c.fillStyle = `hsl(${95 + random() * 30}, ${35 + random() * 25}%, ${l * 0.45}%)`;
            c.beginPath();
            c.ellipse(x, y, r, r * 0.55, a, 0, Math.PI * 2);
            c.fill();
        }
    } else {
        for (let b = 0; b < 5; b++) {
            const x0 = (0.2 + random() * 0.6) * n;
            const y0 = n * (0.95 - random() * 0.1);
            const angle = -Math.PI / 2 + (random() - 0.5) * 0.9;
            const length = n * (0.55 + random() * 0.35);
            c.strokeStyle = '#3a2b1e';
            c.lineWidth = 2.2 * s;
            c.beginPath();
            c.moveTo(x0, y0);
            const x1 = x0 + Math.cos(angle) * length;
            const y1 = y0 + Math.sin(angle) * length;
            c.lineTo(x1, y1);
            c.stroke();
            const needles = Math.round(length / (1.6 * s));
            for (let k = 0; k < needles; k++) {
                const t = k / needles;
                const px = x0 + (x1 - x0) * t;
                const py = y0 + (y1 - y0) * t;
                const l = (14 - t * 6 + random() * 4) * s;
                for (const side of [-1, 1]) {
                    const a = angle + side * (0.7 + random() * 0.5);
                    c.strokeStyle = `hsl(${105 + random() * 25}, ${30 + random() * 20}%, ${12 + random() * 14}%)`;
                    c.lineWidth = (1 + random() * 0.6) * s;
                    c.beginPath();
                    c.moveTo(px, py);
                    c.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
                    c.stroke();
                }
            }
        }
    }
    // canvas rows run top-down, texture rows bottom-up (v = 0 first): flip, so v = 1 is the top of the drawing (the twig grows up)
    const drawn = c.getImageData(0, 0, n, n).data;
    const pixels = new Uint8ClampedArray(drawn.length);
    for (let y = 0; y < n; y++) pixels.set(drawn.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4);
    const lum = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lum[i] = pixels[i * 4 + 3] / 255;
    blur(lum, n, 1);
    return assemble(n, `foliage-${kind}`, tile, {
        height: lum,
        strength: 2,
        alpha: i => pixels[i * 4 + 3] / 255,
        albedo(i, out) {
            // the transparent texels take the colour of the needles (no dark fringes when mip-mapped)
            out[0] = pixels[i * 4 + 3] ? pixels[i * 4] : 40;
            out[1] = pixels[i * 4 + 3] ? pixels[i * 4 + 1] : 56;
            out[2] = pixels[i * 4 + 3] ? pixels[i * 4 + 2] : 30;
        },
        orm(i, out) {
            out[0] = 0.7 + lum[i] * 0.3;
            out[1] = 0.75;
            out[2] = 0;
        },
    }, full);
}

function brick(n, { seed }, full) {
    // running bond: 4 bricks across (0.225 m each incl. 10 mm joint), 8 courses (0.075 m) → 0.9 × 0.6 m
    const tile = [0.9, 0.6];
    const random = rng(seed);
    const tints = Array.from({ length: 64 }, () => [random(), random()]);
    const g = grain(n, seed + 3);
    const mottle = fbm(n, seed + 5, 6, 4, 0.5);
    const height = new Float32Array(n * n);
    const brickId = new Int32Array(n * n);
    const mortar = new Float32Array(n * n);
    const jointU = 0.01 / 0.9;
    const jointV = 0.01 / 0.6;
    for (let y = 0; y < n; y++) {
        const v = y / n;
        const course = Math.floor(v * 8);
        const fv = v * 8 - course;
        for (let x = 0; x < n; x++) {
            const u = x / n + (course % 2 ? 0.125 : 0);
            const col = Math.floor(u * 4) % 4;
            const fu = u * 4 - Math.floor(u * 4);
            const du = Math.min(fu, 1 - fu) / 4;
            const dv = Math.min(fv, 1 - fv) / 8;
            const m = 1 - smooth(0.0, 1, Math.min(du / jointU, dv / jointV) * 1.6);
            const i = y * n + x;
            mortar[i] = m;
            brickId[i] = (course * 4 + col) % 64;
            height[i] = (1 - m) * (0.8 + (g[i] - 0.5) * 0.1 + (mottle[i] - 0.5) * 0.1) + m * 0.2;
        }
    }
    return assemble(n, 'brick', tile, {
        height,
        strength: 3,
        albedo(i, out) {
            const [a, b] = tints[brickId[i]];
            const m = mortar[i];
            const lum = 0.8 + a * 0.35 + (mottle[i] - 0.5) * 0.3 + (g[i] - 0.5) * 0.1;
            const r = (128 + b * 30) * lum;
            const gg = (62 + b * 18) * lum;
            const bb = (48 + b * 10) * lum;
            out[0] = r * (1 - m) + 150 * m;
            out[1] = gg * (1 - m) + 146 * m;
            out[2] = bb * (1 - m) + 138 * m;
        },
        orm(i, out) {
            out[0] = 1 - mortar[i] * 0.4;
            out[1] = 0.82 + mortar[i] * 0.12 + (g[i] - 0.5) * 0.06;
            out[2] = 0;
        },
    }, full);
}

function tiles(n, { seed }, full) {
    const tile = [1.2, 1.2];
    const random = rng(seed);
    const tint = Array.from({ length: 16 }, () => random());
    const g = grain(n, seed + 3);
    const dirt = fbm(n, seed + 5, 4, 4, 0.5);
    const height = new Float32Array(n * n);
    const grout = new Float32Array(n * n);
    const cell = n / 4;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const dx = Math.min(x % cell, cell - (x % cell));
            const dy = Math.min(y % cell, cell - (y % cell));
            const gr = 1 - smooth(0.5, 2.5, Math.min(dx, dy) * (256 / n));
            grout[i] = gr;
            height[i] = 0.8 - gr * 0.6 + (g[i] - 0.5) * 0.01;
        }
    }
    return assemble(n, 'tiles', tile, {
        height,
        strength: 2,
        albedo(i, out) {
            const x = (i % n) / cell | 0;
            const y = (i / n / cell) | 0;
            const t = tint[(y % 4) * 4 + (x % 4)];
            const v = 200 + t * 30 - dirt[i] * 25;
            const gr = grout[i];
            out[0] = v * (1 - gr) + 92 * gr;
            out[1] = v * (1 - gr) + 90 * gr;
            out[2] = (v + 4) * (1 - gr) + 86 * gr;
        },
        orm(i, out) {
            out[0] = 1 - grout[i] * 0.4;
            out[1] = 0.18 + dirt[i] * 0.15 + grout[i] * 0.7;
            out[2] = 0;
        },
    }, full);
}

function facade(n, { seed, lit }, full) {
    // 4 bays (3 m) × 4 storeys (3.2 m): concrete panels, recessed windows (glass), some lit warm or cool
    const tile = [12, 12.8];
    const random = rng(seed);
    const windows = Array.from({ length: 16 }, () => ({
        on: random() < lit,
        warm: random() < 0.7,
        level: 0.45 + random() * 0.55,
        blind: random() * 0.6,
    }));
    const g = grain(n, seed + 3);
    const mottle = fbm(n, seed + 5, 4, 4, 0.5);
    const height = new Float32Array(n * n);
    const glass = new Float32Array(n * n);
    const index = new Int32Array(n * n);
    const blindRow = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        const fv = (y / n) * 4;
        const storey = Math.floor(fv);
        const sv = fv - storey;
        for (let x = 0; x < n; x++) {
            const fu = (x / n) * 4;
            const bay = Math.floor(fu);
            const su = fu - bay;
            // the window opening: 70 % of the bay, from 30 % to 85 % of the storey height
            const inside = su > 0.15 && su < 0.85 && sv > 0.3 && sv < 0.88;
            const frame = inside && (Math.abs(su - 0.5) < 0.012 || su < 0.17 || su > 0.83 || sv < 0.32 || sv > 0.86);
            const i = y * n + x;
            glass[i] = inside && !frame ? 1 : 0;
            index[i] = storey * 4 + bay;
            blindRow[i] = sv;
            height[i] = inside ? (frame ? 0.55 : 0.2) : 0.8 + (g[i] - 0.5) * 0.04;
        }
    }
    const isLit = i => {
        const w = windows[index[i]];
        return glass[i] && w.on && blindRow[i] < 0.88 - w.blind * 0.5;
    };
    return assemble(n, 'facade', tile, {
        height,
        strength: 2.5,
        albedo(i, out) {
            if (glass[i]) {
                out[0] = out[1] = 18;
                out[2] = 24;
                return;
            }
            const v = 112 + (mottle[i] - 0.5) * 30 + (g[i] - 0.5) * 8 - (height[i] < 0.6 ? 40 : 0);
            out[0] = v;
            out[1] = v - 1;
            out[2] = v - 3;
        },
        emissive(i, out) {
            if (!isLit(i)) {
                out[0] = out[1] = out[2] = 0;
                return;
            }
            const w = windows[index[i]];
            const l = w.level * 255;
            out[0] = l;
            out[1] = l * (w.warm ? 0.78 : 0.9);
            out[2] = l * (w.warm ? 0.5 : 1);
        },
        orm(i, out) {
            out[0] = glass[i] ? 0.7 : 1;
            out[1] = glass[i] ? 0.06 : 0.85;
            out[2] = 0;
        },
    }, full);
}

function overlay(n, { seed, kind }, full) {
    const tile = [2, 2];
    const field = fbm(n, seed, 3, 5, 0.6);
    const streak = fbm(n, seed + 3, 12, 3, 0.5, [1, 0.1]);
    const g = grain(n, seed + 5);
    const alpha = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
        const a = kind === 'rust' ? smooth(0.55, 0.75, field[i]) + Math.max(0, streak[i] - 0.7) * 1.4 : smooth(0.45, 0.8, field[i]) * 0.8 + Math.max(0, streak[i] - 0.6) * 1.2;
        alpha[i] = clamp01(a * (0.85 + g[i] * 0.3));
    }
    return assemble(n, `overlay-${kind}`, tile, {
        height: kind === 'rust' ? alpha : null,
        strength: 1.5,
        alpha: i => alpha[i],
        albedo(i, out) {
            if (kind === 'rust') {
                out[0] = 110 + field[i] * 50;
                out[1] = 52 + field[i] * 20;
                out[2] = 28;
            } else {
                const v = 22 + field[i] * 18;
                out[0] = v + 3;
                out[1] = v + 1;
                out[2] = v;
            }
        },
        orm(i, out) {
            out[0] = 1;
            out[1] = kind === 'rust' ? 0.92 : 0.8;
            out[2] = 0;
        },
    }, full);
}

function flakes(n, { seed }, full) {
    const tile = [0.05, 0.05];
    const random = rng(seed);
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        // each texel a tiny tilted mirror
        const x = (random() - 0.5) * 1.6;
        const y = (random() - 0.5) * 1.6;
        const len = Math.sqrt(x * x + y * y + 1);
        data[i * 4] = (x / len * 0.5 + 0.5) * 255;
        data[i * 4 + 1] = (y / len * 0.5 + 0.5) * 255;
        data[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
        data[i * 4 + 3] = 255;
    }
    const normal = dataTexture(data, n, { tile, name: 'flakes.normal' });
    return { map: null, normalMap: full ? normal : null, roughnessMap: null, metalnessMap: null, aoMap: null, emissiveMap: null, tile };
}

function macro(n, { seed }) {
    const tile = [64, 64];
    const a = fbm(n, seed, 3, 5, 0.55);
    const b = fbm(n, seed + 3, 2, 5, 0.5);
    const c = fbm(n, seed + 5, 12, 3, 0.5);
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        data[i * 4] = a[i] * 255;
        data[i * 4 + 1] = b[i] * 255;
        data[i * 4 + 2] = c[i] * 255;
        data[i * 4 + 3] = 255;
    }
    const t = dataTexture(data, n, { tile, name: 'macro' });
    return { map: t, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null, emissiveMap: null, tile };
}
