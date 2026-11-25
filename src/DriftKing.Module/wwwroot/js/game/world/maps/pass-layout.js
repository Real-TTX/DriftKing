// DriftKing · maps/pass-layout.js – the shape of the Tenjō-Pass around its course: which side of the road is the mountain (a cut with a
// retaining wall, a rock face or a lattice frame) and which the valley (a fill slope behind a guardrail), the cross-section of the ground at
// every metre, the natural terrain away from the road, the hairpins – and the small helpers the other pass-* modules share
// (strips along the course, own materials of the quality, a retroreflective material for studs, signs and delineators).
// Pure geometry decisions; nothing here touches the colliders (pass.js keeps the course walls exactly as they were).

import * as THREE from 'three';
import { smoothstep } from '../../render/kit.js';

/** Lateral distances from the centre line (m): the asphalt, the concrete gutter and wall foot (mountain), the shoulder and guardrail (valley). */
export const EDGE = Object.freeze({
    /** Outer edge of the white edge line. */
    line: 5.05,
    /** End of the asphalt. */
    asphalt: 5.5,
    /** End of the L-gutter on the mountain side; the wall face starts here. */
    foot: 6.12,
    /** The road-facing side of the guardrail beam (the course walls stand at 6.05). */
    rail: 6.1,
    /** Guardrail posts. */
    post: 6.36,
    /** End of the gravel shoulder on the valley side; the fill slope starts here. */
    shoulder: 6.7,
});

/** How steep the face of each cut kind is (horizontal run per metre of height). */
export const BATTER = Object.freeze({ wall: 0.12, rock: 0.38, frame: 0.85 });

/** The bounds of the detailed terrain (the course area); the coarse rings reach out to FAR. */
export const TERRAIN = Object.freeze({ minX: -470, maxX: 450, minZ: -430, maxZ: 470, far: 950 });

const SUB = 3; // every SUB-th course sample feeds the terrain field
const HASH = 50; // cell size of the sub-sample hash (m)
const REACH = 150; // the field looks at road samples within this distance

/**
 * Analyses the course once: per sample the cross slope, the mountain side (+1 left, −1 right, 0 none), the cut height and kind, how far the
 * near-road ground strips reach on each side; the hairpins; the terrain field. Deterministic (fixed seeds).
 * @param {import('../course.js').Course} course
 */
export function layoutPass(course) {
    const n = course.count;
    const half = course.width / 2;

    // ---- the road samples that shape the terrain, in a hash
    const sub = [];
    for (let i = 0; i < n; i += SUB) sub.push(i);
    const hash = new Map();
    const key = (cx, cz) => cx * 4099 + cz;
    sub.forEach((i, k) => {
        const h = key(Math.floor(course.x[i] / HASH), Math.floor(course.z[i] / HASH));
        let list = hash.get(h);
        if (!list) hash.set(h, (list = []));
        list.push(k);
    });
    const nearSubs = (x, z, reach, fn) => {
        const r = Math.ceil(reach / HASH);
        const cx = Math.floor(x / HASH);
        const cz = Math.floor(z / HASH);
        for (let gx = cx - r; gx <= cx + r; gx++) {
            for (let gz = cz - r; gz <= cz + r; gz++) {
                const list = hash.get(key(gx, gz));
                if (list) for (const k of list) fn(k, sub[k]);
            }
        }
    };

    // ---- the cross slope: how much higher the left side is than the right, from the plain field (roads + the mountain far away)
    const plain = (x, z) => field(x, z, null);
    const rawSlope = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const lx = course.tz[i];
        const lz = -course.tx[i];
        const x = course.x[i];
        const z = course.z[i];
        const a = plain(x + lx * 25, z + lz * 25) - plain(x - lx * 25, z - lz * 25);
        const b = plain(x + lx * 55, z + lz * 55) - plain(x - lx * 55, z - lz * 55);
        rawSlope[i] = (a / 50) * 0.5 + (b / 110) * 0.5;
    }
    const slope = smoothLoop(rawSlope, 18, 3);
    /** The cross slope of the hillside the road is cut into (> 0: the left side rises), exaggerated from the plain field. */
    const cross = new Float32Array(n);
    for (let i = 0; i < n; i++) cross[i] = clamp(slope[i] * 2.4, -0.85, 0.85);

    // ---- the mountain side per sample, with clean runs (no flicker), never on the outside of a tight turn
    const side = new Int8Array(n);
    let state = 0;
    // start from a sample with a clear side so the hysteresis has a defined state
    for (let k = 0; k < n * 2; k++) {
        const i = k % n;
        const c = cross[i];
        if (state === 0 && Math.abs(c) > 0.13) state = Math.sign(c);
        else if (state !== 0 && c * state < 0.07) state = Math.abs(c) > 0.13 ? Math.sign(c) : 0;
        if (k >= n) side[i] = state;
    }
    for (let i = 0; i < n; i++) {
        const k = course.k[i];
        // k > 0 turns left: the outside is the right (−1)
        if (Math.abs(k) > 1 / 38 && side[i] === -Math.sign(k)) side[i] = 0;
    }
    cleanRuns(side, 28);

    // ---- cut heights (a ramp at the ends of each mountain stretch) and kinds (runs of 35–95 m)
    const noise = smoothLoop(Float32Array.from({ length: n }, (_, i) => hashNoise(i * 0.021 + 3.7)), 25, 2);
    const wallHeight = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        if (!side[i]) continue;
        const q = Math.abs(cross[i]);
        wallHeight[i] = clamp(0.9 + (q - 0.1) * 7.5 + noise[i] * 2.2, 0.9, 6.2);
    }
    // ramp over 14 m at both ends of every mountain run
    const toEnd = distanceToChange(side, n);
    for (let i = 0; i < n; i++) {
        if (!side[i]) continue;
        const t = smoothstep(0, 14, toEnd[i] * course.step);
        wallHeight[i] = 0.9 + (wallHeight[i] - 0.9) * t;
    }
    const kind = new Array(n).fill(null);
    let runKind = 'wall';
    let runLeft = 0;
    let runSeed = 11;
    for (let i = 0; i < n; i++) {
        if (!side[i]) {
            runLeft = 0;
            continue;
        }
        if (runLeft <= 0) {
            runSeed = (runSeed * 16807) % 2147483647;
            const r = (runSeed % 1000) / 1000;
            runKind = r < 0.36 ? 'wall' : r < 0.74 ? 'rock' : 'frame';
            runLeft = 35 + ((runSeed >> 4) % 60);
        }
        // low cuts are always a concrete wall (a lattice frame or a rock face needs height)
        kind[i] = wallHeight[i] < 1.7 ? 'wall' : runKind;
        runLeft -= course.step;
    }

    // ---- the hairpins and sharp turns: runs of strong curvature
    const turns = [];
    {
        let i0 = -1;
        for (let k = 0; k <= n; k++) {
            const i = k % n;
            const sharp = Math.abs(course.k[i]) > 1 / 34 && k < n;
            if (sharp && i0 < 0) i0 = k;
            if (!sharp && i0 >= 0) {
                let apex = i0;
                for (let j = i0; j < k; j++) if (Math.abs(course.k[j]) > Math.abs(course.k[apex])) apex = j;
                const radius = 1 / Math.abs(course.k[apex]);
                const dir = Math.sign(course.k[apex]);
                const last = turns[turns.length - 1];
                if (last && last.dir === dir && i0 - last.to < 16) {
                    // one bend whose curvature dips under the threshold for a moment
                    last.to = k - 1;
                    if (radius < last.radius) {
                        last.apex = apex;
                        last.radius = radius;
                        last.hairpin = radius < 22;
                    }
                } else {
                    turns.push({ from: i0, to: k - 1, apex, radius, dir, hairpin: radius < 22 });
                }
                i0 = -1;
            }
        }
    }

    // ---- the lay-by: a straight stretch with a guardrail side, facing the valley in the south (the view of the town), clear of the start
    const layby = findLayby(course, side, turns);
    /** The extra width of the lay-by on its side at sample i (0 elsewhere): 7 m, tapered over 14 m at both ends. */
    const laybyWidth = new Float32Array(n);
    if (layby) {
        for (let s = layby.s0 - 14; s <= layby.s1 + 14; s += course.step) {
            const i = course.wrap(Math.round(s / course.step));
            laybyWidth[i] = layby.depth * smoothstep(layby.s0 - 14, layby.s0, s) * (1 - smoothstep(layby.s1, layby.s1 + 14, s));
        }
    }

    // ---- how far the ground strips reach on each side: to the middle between two legs, inside a turn not past its centre
    const extent = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
        const lx = course.tz[i];
        const lz = -course.tx[i];
        for (const [index, sign] of [[0, 1], [1, -1]]) {
            const start = startOf(i, sign);
            let reach = 26;
            for (let d = start + 2; d <= 26; d += 1.5) {
                const x = course.x[i] + lx * d * sign;
                const z = course.z[i] + lz * d * sign;
                const j = nearestSample(x, z);
                if (j >= 0 && Math.abs(wrapDelta(j - i, n)) * course.step > 30 + d * 0.6) {
                    reach = d - 1.5;
                    break;
                }
            }
            const k = course.k[i] * sign;
            if (k > 0) reach = Math.min(reach, 0.82 / k);
            extent[index][i] = Math.max(start + 4, reach);
        }
    }
    for (const e of extent) {
        const min = minLoop(e, 3);
        e.set(smoothLoop(min, 2, 1));
    }

    // ---- the terrain field: road planes near the road (each road sample a plane tilted by its cross slope), the mountain far away
    const planeSlope = new Float32Array(sub.length);
    sub.forEach((i, k) => (planeSlope[k] = cross[i]));
    function field(x, z, slopes) {
        let sum = 0;
        let weight = 0;
        let nearest = Infinity;
        nearSubs(x, z, REACH, (k, i) => {
            const dx = x - course.x[i];
            const dz = z - course.z[i];
            const d2 = dx * dx + dz * dz;
            if (d2 < nearest) nearest = d2;
            const w = 1 / (d2 + 30) ** 1.5;
            let y = course.y[i];
            if (slopes) {
                const lat = dx * course.tz[i] - dz * course.tx[i];
                y += slopes[k] * clamp(lat, -26, 26);
            }
            sum += y * w;
            weight += w;
        });
        const m = mountain(x, z);
        if (weight === 0) return m;
        const d = Math.sqrt(nearest);
        const road = sum / weight;
        return road + (m - road) * smoothstep(slopes ? 26 : 16, slopes ? 115 : 90, d);
    }
    /** The natural ground (no cuts, no fills) at (x, z). */
    const natural = (x, z) => field(x, z, planeSlope);

    function nearestSample(x, z) {
        let best = -1;
        let bestD = Infinity;
        nearSubs(x, z, 60, (k, i) => {
            const d = (course.x[i] - x) ** 2 + (course.z[i] - z) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        if (best < 0) return -1;
        // refine between the sub-samples
        let i = best;
        for (let o = -SUB; o <= SUB; o++) {
            const j = (best + o + n) % n;
            const d = (course.x[j] - x) ** 2 + (course.z[j] - z) ** 2;
            if (d < bestD) {
                bestD = d;
                i = j;
            }
        }
        return i;
    }

    /** Where the strip of a side starts (the top of the cut on the mountain side, the end of the shoulder on the valley side). */
    function startOf(i, sign) {
        if (side[i] === sign) return EDGE.foot + wallHeight[i] * BATTER[kind[i] ?? 'wall'] + 0.25;
        return EDGE.shoulder + (layby && layby.sign === sign ? laybyWidth[i] : 0);
    }

    /**
     * The ground height of the cross-section of sample i on side sign (+1 left) at lateral distance d (≥ the strip start):
     * the top of the cut rising with the hillside, or the fill slope falling to the natural ground; blended into the natural terrain
     * towards the end of the strip.
     */
    function profile(i, sign, d, x, z) {
        const y = course.y[i];
        const q = cross[i] * sign;
        const start = startOf(i, sign);
        let p;
        if (side[i] === sign) {
            p = y + wallHeight[i] + Math.max(0, d - start) * Math.max(0.12, q * 0.9);
        } else {
            const from = y - 0.08;
            p = Math.max(from - Math.max(0, d - EDGE.shoulder) * 0.72, from + q * Math.max(0, d - EDGE.shoulder));
        }
        const end = extent[sign > 0 ? 0 : 1][i];
        const t = smoothstep(Math.max(start + 2, end * 0.45), end, d);
        return t > 0 ? p + (natural(x, z) - p) * t : p;
    }

    /** The visible ground at (x, z): the strip profile near the road (or the road platform), the natural terrain elsewhere. */
    function groundAt(x, z) {
        const i = nearestSample(x, z);
        if (i < 0) return natural(x, z);
        const lat = (x - course.x[i]) * course.tz[i] - (z - course.z[i]) * course.tx[i];
        const sign = lat >= 0 ? 1 : -1;
        const d = Math.abs(lat);
        if (d <= startOf(i, sign)) return course.y[i] - 0.05;
        if (d < extent[sign > 0 ? 0 : 1][i]) return profile(i, sign, d, x, z);
        return natural(x, z);
    }

    /** Nearest sample, lateral offset and whether (x, z) lies under a near-road strip (or the road). */
    function locate(x, z) {
        const i = nearestSample(x, z);
        if (i < 0) return null;
        const lat = (x - course.x[i]) * course.tz[i] - (z - course.z[i]) * course.tx[i];
        const sign = lat >= 0 ? 1 : -1;
        return { i, lat, sign, d: Math.abs(lat), extent: extent[sign > 0 ? 0 : 1][i], start: startOf(i, sign) };
    }

    return {
        course,
        half,
        count: n,
        /** Cross slope per sample (> 0: left rises). */
        cross,
        /** Mountain side per sample: +1 left, −1 right, 0 none (guardrails both sides). */
        side,
        /** Height of the cut face on the mountain side. */
        wallHeight,
        /** Kind of the cut: 'wall' | 'rock' | 'frame' (null without a mountain side). */
        kind,
        /** Reach of the ground strips: [left, right] per sample. */
        extent,
        /** Sharp turns: { from, to, apex, radius, dir (+1 left), hairpin }. */
        turns,
        natural,
        groundAt,
        locate,
        nearestSample,
        profile,
        startOf,
        mountain,
        /** True when side sign of sample i is a guardrail (valley) side. */
        isValley: (i, sign) => side[i] !== sign,
        /** The lay-by { s0, s1, sign, depth } (null when the course has no place for one). */
        layby,
        /** How far the guardrail of side sign stands out from its usual place at sample i (around the lay-by). */
        railOffset: (i, sign) => (layby && layby.sign === sign ? laybyWidth[i] : 0),
    };
}

/**
 * The best place for a lay-by: 60 m of a guardrail side with hardly any curvature, away from bends and the start line, preferring a
 * side that faces south (the town in the valley). Returns { s0, s1, sign, depth } or null.
 */
function findLayby(course, side, turns) {
    const n = course.count;
    const length = Math.round(60 / course.step);
    const margin = Math.round(18 / course.step);
    let best = null;
    for (let i0 = 0; i0 < n; i0 += 5) {
        const s0 = i0 * course.step;
        // clear of the start line and the grid behind it
        if (s0 < 45 || s0 + 60 > course.length - 70) continue;
        if (turns.some(t => t.from * course.step < s0 + 100 && t.to * course.step > s0 - 40)) continue;
        for (const sign of [1, -1]) {
            let ok = true;
            for (let k = -margin; k <= length + margin && ok; k++) {
                const i = course.wrap(i0 + k);
                if (side[i] === sign || Math.abs(course.k[i]) > 1 / 160) ok = false;
            }
            if (!ok) continue;
            const mid = course.wrap(i0 + length / 2);
            // the outward normal of the side: (tz, −tx) × sign; south is +z
            const south = -course.tx[mid] * sign;
            const score = south - course.y[mid] * 0.01;
            if (!best || score > best.score) best = { s0, s1: s0 + 60, sign, depth: 7, score };
        }
    }
    return best;
}

/** The mountain far from the road: a ridge rising to the north, a summit inside the loop, valleys falling away on three sides, the plain in the south. */
export function mountain(x, z) {
    let y = 28 - z * 0.13 + 26 * Math.exp(-((x - 20) ** 2 + (z + 40) ** 2) / (2 * 110 ** 2)) + 5 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + 3 * Math.sin(x * 0.05 + z * 0.04);
    y -= smoothstep(225, 500, z) * 52;
    y -= smoothstep(215, 430, x) * 46;
    y -= smoothstep(-225, -440, x) * 46;
    y -= smoothstep(-215, -430, z) * 64;
    // far hills around the basin (not in the south, where the town lies on the plain)
    const r = Math.max(Math.abs(x), Math.abs(z));
    y += smoothstep(560, 940, r) * (1 - smoothstep(300, 700, z)) * (70 + 30 * Math.sin(x * 0.006 + z * 0.004));
    return Math.max(y, -62);
}

// ---------------------------------------------------------------- strips along the course

/**
 * A strip along the course: rows at every `step` samples (closed loop), `columns` vertices per row from column(i, c, out) →
 * out = { lat, y } (lat: signed lateral offset, > 0 left). UVs in metres: 'top' (world x / −z) or 'along' (s / height), or a custom uv(i, c, out).
 * Rows where keep(i) is false are left out (the strip is cut into pieces there).
 * @returns {THREE.BufferGeometry|null}
 */
export function stripGeometry(course, columns, column, { step = 2, uv = 'top', keep = null, from = 0, to = course.count } = {}) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const out = { lat: 0, y: 0, u: 0, v: 0 };
    let previous = -1;
    let rowCount = 0;
    const n = course.count;
    const closed = from === 0 && to === n;
    const last = closed ? n : to;
    for (let k = from; k <= last; k += step) {
        const i = k % n;
        if (keep && !keep(i)) {
            previous = -1;
            continue;
        }
        const lx = course.tz[i];
        const lz = -course.tx[i];
        const base = positions.length / 3;
        for (let c = 0; c < columns; c++) {
            column(i, c, out);
            const x = course.x[i] + lx * out.lat;
            const z = course.z[i] + lz * out.lat;
            positions.push(x, out.y, z);
            if (typeof uv === 'function') {
                uv(i, c, out, k);
                uvs.push(out.u, out.v);
            } else if (uv === 'along') {
                uvs.push(k * course.step, out.y - course.y[i]);
            } else {
                uvs.push(x, -z);
            }
        }
        if (previous >= 0) {
            for (let c = 0; c < columns - 1; c++) {
                const a = previous + c;
                const b = base + c;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        previous = base;
        rowCount++;
    }
    if (rowCount < 2) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // the winding depends on the side: make every face point up / towards the road
    return geometry;
}

/** Flips the winding of an indexed geometry (and its normals) in place. */
export function flipWinding(geometry) {
    const index = geometry.index.array;
    for (let k = 0; k < index.length; k += 3) {
        const t = index[k + 1];
        index[k + 1] = index[k + 2];
        index[k + 2] = t;
    }
    geometry.index.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

// ---------------------------------------------------------------- materials of the map (own ones, freed with the world)

/**
 * A lit surface of the map's own (vertex colours, a texture set of ctx.textures): MeshStandard on medium/high, Lambert on low.
 * Not shared – disposeTree frees it with the world; its textures are the shared ones of the recipes.
 */
export function ownSurface(ctx, set, { color = 0xffffff, roughness = 1, metalness = 0, vertexColors = false, side = THREE.FrontSide, normal = 1, alphaTest = 0, alphaToCoverage = false, map = true } = {}) {
    if (ctx.quality === 'low') {
        return new THREE.MeshLambertMaterial({ map: map ? set?.map ?? null : null, color, vertexColors, side, alphaTest });
    }
    const m = new THREE.MeshStandardMaterial({
        map: map ? set?.map ?? null : null,
        normalMap: set?.normalMap ?? null,
        roughnessMap: set?.roughnessMap ?? null,
        aoMap: set?.aoMap ?? null,
        color,
        roughness,
        metalness,
        vertexColors,
        side,
        alphaTest,
        alphaToCoverage,
    });
    m.normalScale.set(normal, normal);
    return m;
}

/**
 * Retroreflective surfaces (road studs, delineators, chevron boards, sign faces): they shine back towards the camera – where the own car's
 * headlights are – bright when faced and near, faint far away or seen from the side. Unlit (MeshBasic): colour × intensity in linear HDR,
 * so the bright ones bloom. Instancing works. Own material (freed with the world, its map with it unless shared).
 */
export function retroMaterial(color, intensity, { map = null, side = THREE.FrontSide, base = 0.06, near = 22, far = 120, alphaTest = 0 } = {}) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), map, side, alphaTest, fog: true });
    const twoSided = side === THREE.DoubleSide;
    m.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vRetro;')
            .replace(
                '#include <project_vertex>',
                `#include <project_vertex>
                vec4 retroWorld = vec4(transformed, 1.0);
                vec3 retroNormal = normal;
                #ifdef USE_INSTANCING
                    retroWorld = instanceMatrix * retroWorld;
                    retroNormal = mat3(instanceMatrix) * retroNormal;
                #endif
                retroWorld = modelMatrix * retroWorld;
                retroNormal = normalize(mat3(modelMatrix) * retroNormal);
                vec3 retroView = cameraPosition - retroWorld.xyz;
                float retroDistance = length(retroView);
                float retroFacing = dot(retroNormal, retroView / max(retroDistance, 0.001));
                retroFacing = ${twoSided ? 'abs(retroFacing)' : 'max(retroFacing, 0.0)'};
                vRetro = mix(${base.toFixed(3)}, 1.0, retroFacing * retroFacing * (1.0 - smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, retroDistance)));`,
            );
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vRetro;')
            .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vRetro;');
    };
    m.customProgramCacheKey = () => `pass-retro:${twoSided}:${base}:${near}:${far}`;
    return m;
}

// ---------------------------------------------------------------- small math

/** Box filter over a closed loop (radius r samples), repeated passes ≈ a Gaussian. */
export function smoothLoop(values, r, passes = 1) {
    const n = values.length;
    let a = Float32Array.from(values);
    let b = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[(k + n) % n];
        for (let i = 0; i < n; i++) {
            b[i] = sum / (2 * r + 1);
            sum += a[(i + r + 1) % n] - a[(i - r + n) % n];
        }
        [a, b] = [b, a];
    }
    return a;
}

function minLoop(values, r) {
    const n = values.length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let m = Infinity;
        for (let k = -r; k <= r; k++) m = Math.min(m, values[(i + k + n) % n]);
        out[i] = m;
    }
    return out;
}

/** Runs of the same value shorter than min samples take the value of the run before them. */
function cleanRuns(values, min) {
    const n = values.length;
    for (let pass = 0; pass < 3; pass++) {
        let start = 0;
        while (start < n && values[start] === values[(start - 1 + n) % n]) start++;
        if (start >= n) return;
        let k = 0;
        while (k < n) {
            const i0 = (start + k) % n;
            const v = values[i0];
            let length = 0;
            while (length < n && values[(i0 + length) % n] === v) length++;
            if (length < min) {
                const before = values[(i0 - 1 + n) % n];
                for (let j = 0; j < length; j++) values[(i0 + j) % n] = before;
            }
            k += length;
        }
    }
}

/** Samples to the nearest change of value (either direction) on a closed loop. */
function distanceToChange(values, n) {
    const out = new Float32Array(n).fill(n);
    for (let i = 0; i < n; i++) {
        if (values[i] !== values[(i + 1) % n]) {
            for (let k = 0; k < 40; k++) {
                const a = (i - k + n) % n;
                const b = (i + 1 + k) % n;
                out[a] = Math.min(out[a], k);
                out[b] = Math.min(out[b], k);
            }
        }
    }
    return out;
}

function wrapDelta(d, n) {
    return ((d % n) + n + n / 2) % n - n / 2;
}

function hashNoise(t) {
    const s = Math.sin(t * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.1));
}

export function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
}
