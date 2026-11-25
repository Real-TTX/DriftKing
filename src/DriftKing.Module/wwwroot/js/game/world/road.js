// DriftKing · world/road.js – what every map builds along its course: the asphalt strip with its worn markings (decals: lines, wheel paths,
// drift marks – world/props-markings.js), barrier walls (colliders) and their look (W-beam guardrails on posts every 2 m, kerbs with gutters and
// drains), traffic cones with reflective collars, the start line with a truss gantry. Real dimensions (docs/RENDERING.md §11); materials from
// the factory of the quality (options.materials = ctx.materials, or the quality in the settings) – Lambert/Phong and simpler shapes on low.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries, rng } from '../render/kit.js';
import { LIGHT_PRESETS } from '../render/lights.js';
import { maxAnisotropy } from '../render/device.js';
import { buildRoadMarkings } from './props-markings.js';
import { flatUV, instanced, isPbr, lathe, materialsOf, ownMaterial, paint, placement, rod } from './props-common.js';

export { buildRoadMarkings } from './props-markings.js';

/**
 * The asphalt texture of the old look (repeats every 8 m along the road): grain, edge lines, a dashed centre line in white or yellow.
 * buildRoadStrip recognises it and builds the physically based asphalt with decal markings instead (centre colour and edges are kept).
 */
export function roadTexture({ centre = '#e9e6dc', edges = true, seed = 3 } = {}) {
    const random = rng(seed);
    const texture = canvasTexture(256, 512, (ctx, w, h) => {
        ctx.fillStyle = '#26252c';
        ctx.fillRect(0, 0, w, h);
        for (let k = 0; k < 2600; k++) {
            const v = 28 + random() * 34;
            ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.35 + random() * 0.4})`;
            ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
        }
        // tyre tracks: two darker bands
        for (const x of [0.3, 0.7]) {
            const g = ctx.createLinearGradient((x - 0.08) * w, 0, (x + 0.08) * w, 0);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect((x - 0.08) * w, 0, 0.16 * w, h);
        }
        if (edges) {
            ctx.fillStyle = 'rgba(235,232,220,0.85)';
            ctx.fillRect(0.035 * w, 0, 0.022 * w, h);
            ctx.fillRect(0.943 * w, 0, 0.022 * w, h);
        }
        if (centre) {
            ctx.fillStyle = centre;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(0.489 * w, 0, 0.022 * w, h * 0.42);
            ctx.globalAlpha = 1;
        }
    }, { repeat: true });
    texture.userData.roadMarkings = { centre, edges, seed };
    return texture;
}

/** True for a material (or its map) from the factories of render/materials.js / textures.js: their UVs are in metres. */
function isFactoryMaterial(material) {
    return material?.userData?.shared === true || material?.map?.userData?.shared === true;
}

/** The wetness (0..1) of a factory surface material (its macro layer), 0 for anything else. */
function wetnessOf(material) {
    return material?.userData?.macro?.macroAmount?.value?.w ?? 0;
}

/**
 * The road strip along the course (width of the course + extra), lying lift metres above the course height.
 * The material decides the look: a material with a roadTexture() map (the old look) or none at all (null) becomes the factory asphalt
 * (options.wet, default 0.3, puddles half of it, a 2.5 m texture tile for a fine aggregate; options.asphalt: other factory options) with decal markings (the roadTexture's centre colour and edge lines,
 * or options.markings) as children of the mesh; any other material is used as it is (with UVs in metres for factory materials, decals only
 * when options.markings is given).
 * @param {object} course
 * @param {THREE.Material|null} material
 * @param {{ extra?: number, lift?: number, repeat?: number, materials?: object, wet?: number, asphalt?: object, markings?: object|false,
 *           uv?: 'metric'|'strip' }} [options] markings: see buildRoadMarkings (false: none)
 * @returns {THREE.Mesh}
 */
export function buildRoadStrip(course, material, options = {}) {
    const { extra = 0, lift = 0.02, repeat = 8 } = options;
    const legacy = material?.map?.userData?.roadMarkings ?? null;
    const upgrade = !material || legacy !== null;
    const mats = materialsOf(options);
    const wet = options.wet ?? 0.3;
    const surface = upgrade ? mats.asphalt({ wet, puddles: wet * 0.5, scale: 2.5, ...(options.asphalt ?? {}) }) : material;
    const metric = options.uv ? options.uv === 'metric' : upgrade || isFactoryMaterial(material);
    const half = course.width / 2 + extra;
    const mesh = new THREE.Mesh(ribbonGeometry(course, -half, half, { lift, repeat, metric }), surface);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    let spec = null;
    if (options.markings !== undefined) spec = options.markings || null;
    else if (legacy) spec = { centre: legacy.centre, edges: legacy.edges, seed: legacy.seed };
    else if (!material) spec = {};
    if (spec) {
        const decals = buildRoadMarkings(course, { extra, ...spec }, { materials: mats, lift: lift + 0.012, wet: wetnessOf(surface) });
        if (decals) mesh.add(decals);
    }
    // the old material was never drawn: free what it holds (it is uploaded again should the caller still use it)
    if (legacy) {
        material.map.dispose();
        material.dispose();
    }
    return mesh;
}

/**
 * A ribbon along the course between the lateral offsets from and to (> 0 left of the centre line), lift metres above the course:
 * sidewalks, shoulders, painted lines. u runs 0..1 across, v along the course (one unit per `repeat` metres);
 * metric: u = metres to the right of the centre line, v = metres along the course (the convention of the material factory).
 */
export function ribbonGeometry(course, from, to, { lift = 0, repeat = 8, metric = false } = {}) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= course.count; i++) {
        const k = i % course.count;
        const lx = course.tz[k];
        const lz = -course.tx[k];
        const y = course.y[k] + lift;
        positions.push(course.x[k] + lx * to, y, course.z[k] + lz * to, course.x[k] + lx * from, y, course.z[k] + lz * from);
        if (metric) {
            const v = i * course.step;
            uvs.push(-to, v, -from, v);
        } else {
            const v = (i * course.step) / repeat;
            uvs.push(0, v, 1, v);
        }
        if (i < course.count) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The two edges of the course at lateral ±(width/2 + offset) as polylines [{ x, y, z }] (every `every` samples),
 * and (when colliders are given) walls along them.
 */
export function courseEdges(course, offset, { every = 2, colliders = null } = {}) {
    const left = [];
    const right = [];
    const d = course.width / 2 + offset;
    for (let i = 0; i < course.count; i += every) {
        const lx = course.tz[i];
        const lz = -course.tx[i];
        left.push({ x: course.x[i] + lx * d, y: course.y[i], z: course.z[i] + lz * d });
        right.push({ x: course.x[i] - lx * d, y: course.y[i], z: course.z[i] - lz * d });
    }
    if (colliders) {
        for (const line of [left, right]) {
            for (let k = 0; k < line.length; k++) {
                const a = line[k];
                const b = line[(k + 1) % line.length];
                colliders.addSegment(a.x, a.z, b.x, b.z);
            }
        }
    }
    return { left, right };
}

/** A vertical band along a closed polyline from height y0 to y1 above it (guardrail beam, parapet face), as geometry. */
export function bandGeometry(line, y0, y1, { closed = true } = {}) {
    const positions = [];
    const indices = [];
    const n = line.length;
    const last = closed ? n : n - 1;
    for (let k = 0; k <= last; k++) {
        const p = line[k % n];
        positions.push(p.x, p.y + y0, p.z, p.x, p.y + y1, p.z);
        if (k < last) {
            const a = k * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

// ---------------------------------------------------------------- guardrails

/** The W-beam cross-section: [depth towards the road, height above the beam's lower edge] (metres), bottom to top: two crests, a valley. */
const W_BEAM = [[0.012, 0], [0.04, 0.022], [0.079, 0.055], [0.083, 0.078], [0.079, 0.1], [0.03, 0.13], [0.022, 0.155], [0.03, 0.18],
    [0.079, 0.21], [0.083, 0.232], [0.079, 0.255], [0.04, 0.288], [0.012, 0.31]];
/** The cross-section of medium: the same W with fewer bends. */
const W_BEAM_MEDIUM = [[0.012, 0], [0.055, 0.032], [0.083, 0.078], [0.055, 0.118], [0.022, 0.155], [0.055, 0.192], [0.083, 0.232], [0.055, 0.278], [0.012, 0.31]];
/** The cheap cross-section of low: the two crests only as a bent strip. */
const W_BEAM_LOW = [[0.02, 0], [0.083, 0.07], [0.025, 0.155], [0.083, 0.24], [0.02, 0.31]];

/**
 * The extruded beam along a polyline: the crests at the polyline, the profile facing the road (roadSide +1: the road is to the left of the
 * polyline's direction, -1: to the right). u = metres along, v = metres along the profile (the brushed texture streaks along u).
 */
function beamGeometry(line, roadSide, profile, bottom, closed) {
    const n = line.length;
    const count = closed ? n + 1 : n;
    const P = profile.length;
    // profile normals in (depth, height), averaged at the bends
    const pn = profile.map((_, j) => {
        let nd = 0;
        let ny = 0;
        for (const [a, b] of [[j - 1, j], [j, j + 1]]) {
            if (a < 0 || b >= P) continue;
            const dd = profile[b][0] - profile[a][0];
            const dy = profile[b][1] - profile[a][1];
            const l = Math.hypot(dd, dy) || 1;
            nd += dy / l;
            ny += -dd / l;
        }
        const l = Math.hypot(nd, ny) || 1;
        return [nd / l, ny / l];
    });
    const pv = [0];
    for (let j = 1; j < P; j++) pv.push(pv[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
    const positions = new Float32Array(count * P * 3);
    const normals = new Float32Array(count * P * 3);
    const uvs = new Float32Array(count * P * 2);
    let walked = 0;
    for (let k = 0; k < count; k++) {
        const p = line[k % n];
        const prev = closed ? line[(k - 1 + n) % n] : line[Math.max(0, k - 1)];
        const next = closed ? line[(k + 1) % n] : line[Math.min(n - 1, k + 1)];
        let tx = next.x - prev.x;
        let tz = next.z - prev.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // towards the road: left of the direction (tz, -tx)·(-1)… the left normal is (tz, -tx); roadSide picks it or its opposite
        const rx = tz * roadSide;
        const rz = -tx * roadSide;
        if (k > 0) walked += Math.hypot(p.x - line[(k - 1) % n].x, p.z - line[(k - 1) % n].z);
        for (let j = 0; j < P; j++) {
            const [d, h] = profile[j];
            const i = (k * P + j) * 3;
            positions[i] = p.x + rx * (d - 0.083);
            positions[i + 1] = p.y + bottom + h;
            positions[i + 2] = p.z + rz * (d - 0.083);
            normals[i] = rx * pn[j][0];
            normals[i + 1] = pn[j][1];
            normals[i + 2] = rz * pn[j][0];
            uvs[(k * P + j) * 2] = walked;
            uvs[(k * P + j) * 2 + 1] = pv[j];
        }
    }
    const indices = [];
    // the front (crests) faces the road: counter-clockwise seen from there
    const flip = roadSide < 0;
    for (let k = 0; k < count - 1; k++) {
        for (let j = 0; j < P - 1; j++) {
            const a = k * P + j;
            const b = (k + 1) * P + j;
            const c = b + 1;
            const d = a + 1;
            if (flip) indices.push(a, b, c, a, c, d);
            else indices.push(a, c, b, a, d, c);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(count * P > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
    g.computeBoundingSphere();
    return g;
}

/**
 * The guardrail material (owned by the rail): galvanised zinc (brushed streaks, part metal – aged zinc is dull) or white paint;
 * double sided for the beam (a single sheet seen from both sides), front sided for posts and blocks.
 */
function railMaterial(mats, color, painted, side) {
    if (!isPbr(mats)) return new THREE.MeshPhongMaterial({ color, specular: painted ? 0x333333 : 0x5a5a5a, shininess: painted ? 20 : 30, side });
    const set = mats.textures.brushed();
    const m = new THREE.MeshStandardMaterial({
        color,
        map: painted ? null : set.map,
        normalMap: set.normalMap,
        roughnessMap: painted ? null : set.roughnessMap,
        roughness: painted ? 0.42 : 1.6,
        metalness: painted ? 0 : 0.6,
        side,
    });
    m.normalScale.set(painted ? 0.12 : 0.35, painted ? 0.12 : 0.35);
    return m;
}

/**
 * Guardrails along both edges: W-beams (a real profile, 0.31 m tall, top at 0.76 m) on posts every 2 m (4 m on low) with spacer blocks,
 * reflectors on every fourth post, the crests at the edge polylines (nothing comes closer to the road than before), glow points on some posts.
 * options: color (the tint), finish 'galvanised' | 'painted' (default: painted when the colour is near white – Japanese rails are often
 * white – else galvanised), materials (the factory), closed (false: flared end terminals at both ends of open edges).
 */
export function buildGuardrails(root, edges, glows, options = {}) {
    const { color = 0xb8bcc8, closed = true } = options;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const high = mats.quality === 'high';
    const base = new THREE.Color(color);
    const painted = options.finish ? options.finish === 'painted' : Math.min(base.r, base.g, base.b) > 0.8;
    // aged zinc: a light grey with the slight hue of the given tint; paint: the colour as it is
    const zinc = painted ? base.getHex() : base.clone().lerp(new THREE.Color(0xaeb2b6), 0.6).getHex();
    const group = new THREE.Group();
    group.name = 'guardrails';
    const beams = [];
    const posts = [];
    const reflectors = [];
    const spacing = pbr ? 2 : 4;
    for (const [line, roadSide] of [[edges.left, -1], [edges.right, 1]]) {
        if (line.length < 2) continue;
        const path = closed ? line : flare(line, roadSide);
        beams.push(beamGeometry(path, roadSide, high ? W_BEAM : pbr ? W_BEAM_MEDIUM : W_BEAM_LOW, 0.45, closed));
        // posts every `spacing` metres along the polyline (the glows keep the old rhythm of one every 16 m)
        let next = spacing / 2;
        let along = 0;
        let count = 0;
        const n = line.length;
        for (let k = 0; k < (closed ? n : n - 1); k++) {
            const a = line[k];
            const b = line[(k + 1) % n];
            const segment = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
            const rx = ((b.z - a.z) / segment) * roadSide;
            const rz = (-(b.x - a.x) / segment) * roadSide;
            const yaw = Math.atan2(rx, rz);
            while (next <= along + segment) {
                const f = (next - along) / segment;
                const x = a.x + (b.x - a.x) * f;
                const y = a.y + (b.y - a.y) * f;
                const z = a.z + (b.z - a.z) * f;
                posts.push({ x, y, z, yaw });
                if (pbr && count % 4 === 0) reflectors.push({ x, y, z, yaw, warm: count % 8 === 0 });
                const every = 16 / spacing;
                if (glows && count % every === 0) glows.add(x, y + 0.75, z, 0.35, count % (every * 2) === 0 ? 0xffb84a : 0xdfe6ff);
                count++;
                next += spacing;
            }
            along += segment;
        }
    }
    const beam = new THREE.Mesh(mergeGeometries(beams), railMaterial(mats, zinc, painted, THREE.DoubleSide));
    beam.receiveShadow = true;
    beam.castShadow = high;
    group.add(beam);

    // the post (a C-channel on high, a box below), the spacer block between post and beam, a bolt head in the valley; local +z = the road
    const parts = [];
    const back = -0.083 - 0.15 - 0.06;
    // posts reach 0.6 m below the road (the ground beside a road lies lower)
    if (high) {
        parts.push(new THREE.BoxGeometry(0.1, 1.32, 0.007).translate(0, 0.06, back - 0.05));
        for (const side of [-1, 1]) parts.push(new THREE.BoxGeometry(0.007, 1.32, 0.1).translate(side * 0.046, 0.06, back));
    } else {
        parts.push(new THREE.BoxGeometry(0.08, 1.32, 0.1).translate(0, 0.06, back));
    }
    if (pbr) parts.push(new THREE.BoxGeometry(0.075, 0.34, 0.15).translate(0, 0.6, -0.083 - 0.075 + 0.005));
    if (high) parts.push(new THREE.CircleGeometry(0.016, 6).translate(0, 0.45 + 0.155, -0.083 + 0.022 + 0.008));
    const matrices = posts.map(p => placement(p.x, p.y, p.z, p.yaw));
    const postMesh = instanced(mergeGeometries(parts), railMaterial(mats, zinc, painted, THREE.FrontSide), matrices, { castShadow: high, receiveShadow: pbr, name: 'guardrail-posts' });
    if (postMesh) group.add(postMesh);

    // reflectors (delineators) on the bolt in the valley: amber and white, retro-reflective – a faint emissive face
    if (pbr && reflectors.length) {
        const plate = new THREE.PlaneGeometry(0.07, 0.09).translate(0, 0.45 + 0.155, -0.083 + 0.045);
        const colours = reflectors.map(r => new THREE.Color(r.warm ? 0xffa030 : 0xe8eeff));
        const mesh = instanced(plate, mats.emissive(0xffffff, 1.6), reflectors.map(r => placement(r.x, r.y, r.z, r.yaw)), { colors: colours, name: 'guardrail-reflectors' });
        if (mesh) group.add(mesh);
    }
    root.add(group);
    return group;
}

/** An open edge polyline extended at both ends by a flared terminal: the beam bends away from the road over 4 m. */
function flare(line, roadSide) {
    const n = line.length;
    // the direction of travel at both ends; the road lies at roadSide × its left normal (tz, -tx)
    const ends = [
        { end: line[0], dx: line[1].x - line[0].x, dz: line[1].z - line[0].z, out: -1 },
        { end: line[n - 1], dx: line[n - 1].x - line[n - 2].x, dz: line[n - 1].z - line[n - 2].z, out: 1 },
    ];
    const extended = [];
    for (const { end, dx, dz, out } of ends) {
        const l = Math.hypot(dx, dz) || 1;
        const tx = dx / l;
        const tz = dz / l;
        const rx = tz * roadSide;
        const rz = -tx * roadSide;
        extended.push([1, 2, 3, 4].map(m => ({ x: end.x + tx * m * out - rx * 0.06 * m * m, y: end.y, z: end.z + tz * m * out - rz * 0.06 * m * m })));
    }
    return [...extended[0].reverse(), ...line, ...extended[1]];
}

// ---------------------------------------------------------------- cones

let coneGlowMap = null;

/** A 2 × 1 emissive lookup for the cones: u < 0.5 the faint glow of fluorescent orange, u > 0.5 the reflective collar (shared). */
function coneEmissiveMap() {
    if (coneGlowMap) return coneGlowMap;
    const data = new Uint8Array([46, 14, 3, 255, 70, 70, 74, 255]);
    const t = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    t.userData.shared = true;
    coneGlowMap = t;
    return t;
}

/**
 * Traffic cones (0.7 m, fluorescent orange PVC on a black rubber base, two reflective collars) at the given spots [{ x, y, z }],
 * one InstancedMesh. options: materials (the factory).
 */
export function buildCones(root, spots, options = {}) {
    if (spots.length === 0) return;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const segments = mats.quality === 'high' ? 14 : pbr ? 10 : 7;
    // the cone's radius at a height (a straight cone from 0.165 at 0.04 m to 0.03 at 0.68 m)
    const r = y => 0.165 - ((y - 0.04) * 0.135) / 0.64;
    const piece = (y0, y1, colour, collar) => {
        const g = lathe([[r(y0) + (collar ? 0.003 : 0), y0], [r(y1) + (collar ? 0.003 : 0), y1]], segments);
        flatUV(g, collar ? 0.75 : 0.25, 0.5);
        return paint(g, colour);
    };
    const orange = 0xff5a12;
    const white = 0xf2f2ee;
    const parts = [
        paint(flatUV(new THREE.BoxGeometry(0.38, 0.035, 0.38).translate(0, 0.0175, 0), 0.1, 0.5), 0x1c1c1e),
        paint(flatUV(lathe([[0.19, 0.035], [0.175, 0.045], [0.165, 0.045]], segments), 0.1, 0.5), 0x1c1c1e),
        piece(0.04, 0.26, orange, false),
        piece(0.26, 0.4, white, true),
        piece(0.4, 0.47, orange, false),
        piece(0.47, 0.55, white, true),
        piece(0.55, 0.68, orange, false),
        paint(flatUV(lathe([[0.03, 0.68], [0.0001, 0.69]], segments), 0.25, 0.5), orange),
    ];
    const material = ownMaterial(mats, { vertexColors: true, roughness: 0.5, emissive: 0xffffff, emissiveMap: coneEmissiveMap() });
    // a fixed turn per cone from its position (no randomness of the map is used)
    const matrices = spots.map(p => placement(p.x, p.y, p.z, ((Math.abs(p.x * 12.9898 + p.z * 78.233) * 43.758) % 1) * Math.PI * 2));
    const mesh = instanced(mergeGeometries(parts), material, matrices, { castShadow: mats.quality === 'high', receiveShadow: pbr, name: 'cones' });
    if (mesh) root.add(mesh);
}

/** Cone spots along both edges of the course: dense in corners, sparse on straights. */
export function coneSpots(course, offset = 0.4) {
    const spots = [];
    let next = 0;
    const d = course.width / 2 + offset;
    for (let i = 0; i < course.count; i++) {
        if (i * course.step < next) continue;
        const corner = Math.abs(course.k[i]) > 1 / 45;
        next = i * course.step + (corner ? 5 : 16);
        const lx = course.tz[i];
        const lz = -course.tx[i];
        spots.push({ x: course.x[i] + lx * d, y: course.y[i], z: course.z[i] + lz * d });
        spots.push({ x: course.x[i] - lx * d, y: course.y[i], z: course.z[i] - lz * d });
    }
    return spots;
}

// ---------------------------------------------------------------- start line

let checker = null;

/** The worn checker of the start line (shared): 16 × 2 squares of 0.5 m = 8 m across, 1 m along; white paint in alpha, white colour. */
function checkerTexture() {
    if (checker) return checker;
    const w = 1024;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    const random = rng(4242);
    c.fillStyle = '#fff';
    for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 2; y++) if ((x + y) % 2 === 0) c.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
    }
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9000; k++) {
        c.fillStyle = `rgba(0,0,0,${0.2 + random() * 0.6})`;
        c.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    for (let k = 0; k < 60; k++) {
        const x = random() * w;
        const y = random() * h;
        const g = c.createRadialGradient(x, y, 0, x, y, 6 + random() * 18);
        g.addColorStop(0, `rgba(0,0,0,${0.3 + random() * 0.5})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - 24, y - 24, 48, 48);
    }
    const pixels = c.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 245;
        data[i * 4 + 3] = pixels[i * 4 + 3];
    }
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, maxAnisotropy());
    t.needsUpdate = true;
    t.userData.shared = true;
    checker = t;
    return t;
}

/**
 * An LED matrix display (a texture owned by the caller's world): the text rendered at a low resolution, every lit pixel a round LED in
 * the colour, unlit LEDs a faint dark dot. aspect = width / height of the display.
 */
function ledText(text, colour, aspect) {
    const rows = 14;
    const cols = Math.round(rows * aspect);
    const mask = document.createElement('canvas');
    mask.width = cols;
    mask.height = rows;
    const m = mask.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, cols, rows);
    m.fillStyle = '#fff';
    m.font = `bold ${rows - 3}px sans-serif`;
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    m.fillText(text, cols / 2, rows / 2 + 1);
    const lit = m.getImageData(0, 0, cols, rows).data;
    const pitch = 8;
    const hex = '#' + new THREE.Color(colour).getHexString();
    return canvasTexture(cols * pitch, rows * pitch, c => {
        c.fillStyle = '#030304';
        c.fillRect(0, 0, cols * pitch, rows * pitch);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const on = lit[(y * cols + x) * 4] > 110;
                c.fillStyle = on ? hex : '#121116';
                c.beginPath();
                c.arc(x * pitch + pitch / 2, y * pitch + pitch / 2, pitch * 0.36, 0, Math.PI * 2);
                c.fill();
                if (on) {
                    c.fillStyle = 'rgba(255,255,255,0.55)';
                    c.beginPath();
                    c.arc(x * pitch + pitch / 2, y * pitch + pitch / 2, pitch * 0.16, 0, Math.PI * 2);
                    c.fill();
                }
            }
        }
    });
}

/** A band across the course from s0 to s1 (lateral ±half), following its height, u = metres across / 8, v = 0..1 along. */
function crossBand(course, s0, s1, half, lift) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const steps = Math.max(1, Math.ceil((s1 - s0) / course.step));
    const p = {};
    for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        course.at(s, p);
        const lx = p.tz;
        const lz = -p.tx;
        positions.push(p.x + lx * half, p.y + lift, p.z + lz * half, p.x - lx * half, p.y + lift, p.z - lz * half);
        const v = k / steps;
        uvs.push(0, v, (half * 2) / 8, v);
        if (k < steps) indices.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}

/**
 * The start line: a worn checkered band across the road at s = 0 and (gantry) an aluminium truss portal above it with a dark display
 * panel, an LED strip in `colour` facing the arriving cars, start lights and floodlights. options: materials (the factory), lights (the
 * light rig: one LED floodlight over the line).
 */
export function buildStartLine(root, course, glows, options = {}) {
    const { gantry = true, colour = 0xff2e88 } = options;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const p = course.at(0);
    const yaw = Math.atan2(p.tx, p.tz);
    const lineMaterial = ownMaterial(mats, {
        map: checkerTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
        ...(pbr ? { roughness: 0.6 } : {}),
    });
    const line = new THREE.Mesh(crossBand(course, -0.5, 0.5, course.width / 2, 0.034), lineMaterial);
    line.receiveShadow = true;
    line.renderOrder = 2;
    root.add(line);
    if (!gantry) return;

    // local frame: x across the road (left), z along it, y up; the face of the panel looks at the cars coming towards the line (-z)
    const half = course.width / 2 + 1.6;
    const top = 6.3;
    const truss = [];
    const r = pbr ? 0.025 : 0.035;
    const lace = 0.012;
    const segs = pbr ? 6 : 4;
    const v = (x, y, z) => ({ x, y, z });
    // two square towers (0.4 m) with zig-zag lacing every 0.5 m
    for (const side of [-1, 1]) {
        const cx = side * half;
        const corners = [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]];
        for (const [ox, oz] of corners) truss.push(rod(v(cx + ox, 0.25, oz), v(cx + ox, top + 0.25, oz), r, r, segs));
        if (pbr) {
            for (let y = 0.25; y < top; y += 0.5) {
                for (let c = 0; c < 4; c++) {
                    const [ax, az] = corners[c];
                    const [bx, bz] = corners[(c + 1) % 4];
                    truss.push(rod(v(cx + ax, y, az), v(cx + bx, y + 0.5, bz), lace, lace, 4));
                }
            }
        }
    }
    // the top girder: a 0.5 m box truss across, lacing on all four faces
    const y0 = top + 0.25;
    const y1 = top + 0.75;
    const zs = [-0.25, 0.25];
    for (const y of [y0, y1]) for (const z of zs) truss.push(rod(v(-half - 0.2, y, z), v(half + 0.2, y, z), r, r, segs));
    if (pbr) {
        // per 0.5 m bay: verticals and alternating diagonals on both faces, cross members top and bottom, a diagonal on top
        let flip = false;
        for (let x = -half - 0.2; x < half + 0.19; x += 0.5) {
            const x1 = Math.min(half + 0.2, x + 0.5);
            const [ya, yb] = flip ? [y1, y0] : [y0, y1];
            for (const z of zs) truss.push(rod(v(x, y0, z), v(x, y1, z), lace, lace, 4), rod(v(x, ya, z), v(x1, yb, z), lace, lace, 4));
            for (const y of [y0, y1]) truss.push(rod(v(x, y, zs[0]), v(x, y, zs[1]), lace, lace, 4));
            truss.push(rod(v(x, y1, zs[0]), v(x1, y1, zs[1]), lace, lace, 4));
            flip = !flip;
        }
    }
    const frame = new THREE.Group();
    frame.name = 'start-gantry';
    const trussMesh = new THREE.Mesh(mergeGeometries(truss), mats.metal({ color: 0xc4c8cc, roughness: 0.38 }));
    trussMesh.castShadow = mats.quality === 'high';
    frame.add(trussMesh);

    // the display panel hanging in front of the girder, the start-light pods under it, two floodlights on top
    const panelWidth = Math.min(half * 2 - 1.2, 9);
    const dark = [];
    // ballast blocks under the towers
    for (const side of [-1, 1]) dark.push(new THREE.BoxGeometry(0.7, 0.25, 0.7).translate(side * half, 0.125, 0));
    dark.push(new THREE.BoxGeometry(panelWidth, 1.1, 0.16).translate(0, top - 0.25, -0.38));
    const pods = [];
    for (let k = -2; k <= 2; k++) {
        const x = k * 0.55;
        dark.push(new THREE.BoxGeometry(0.42, 0.24, 0.18).translate(x, top - 1.0, -0.4));
        pods.push(x);
    }
    for (const side of [-1, 1]) {
        dark.push(new THREE.BoxGeometry(0.5, 0.18, 0.4).rotateX(0.5).translate(side * (panelWidth / 2 - 0.4), y1 + 0.2, -0.1));
    }
    frame.add(new THREE.Mesh(mergeGeometries(dark), mats.painted({ color: 0x1d1e22, roughness: 0.45 })));

    // what glows: the LED strips along the panel (top and bottom), the lenses of the pods (red above, green lit), the floodlight lenses
    const glowing = [];
    const strip = new THREE.Color(colour);
    const lit = (g, c, intensity) => paint(g, new THREE.Color(c).multiplyScalar(intensity));
    glowing.push(lit(new THREE.BoxGeometry(panelWidth - 0.2, 0.05, 0.02).translate(0, top + 0.22, -0.47), strip, 6));
    glowing.push(lit(new THREE.BoxGeometry(panelWidth - 0.2, 0.05, 0.02).translate(0, top - 0.72, -0.47), strip, 6));
    for (const x of pods) {
        glowing.push(lit(new THREE.CircleGeometry(0.075, 12).rotateY(Math.PI).translate(x - 0.1, top - 1.0, -0.495), 0xff2a1a, 0.6));
        glowing.push(lit(new THREE.CircleGeometry(0.075, 12).rotateY(Math.PI).translate(x + 0.1, top - 1.0, -0.495), 0x2aff6a, 7));
    }
    for (const side of [-1, 1]) {
        glowing.push(lit(new THREE.PlaneGeometry(0.42, 0.3).rotateX(Math.PI / 2 + 0.5).translate(side * (panelWidth / 2 - 0.4), y1 + 0.2 - 0.085, -0.1 - 0.047), 0xf4f6ff, 14));
    }
    const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    frame.add(new THREE.Mesh(mergeGeometries(glowing), glowMaterial));
    // the face of the panel: an LED matrix showing "START · ZIEL" in the strip colour
    const face = new THREE.PlaneGeometry(panelWidth - 0.3, 0.8).rotateY(Math.PI).translate(0, top - 0.25, -0.465);
    frame.add(new THREE.Mesh(face, mats.emissive(0xffffff, pbr ? 3.5 : 1.2, { map: ledText('START · ZIEL', colour, (panelWidth - 0.3) / 0.8) })));

    frame.position.set(p.x, p.y, p.z);
    frame.rotation.y = yaw;
    root.add(frame);
    if (glows) {
        for (let k = -2; k <= 2; k++) {
            const off = (k / 2) * (panelWidth / 2 - 0.4);
            glows.add(p.x + p.tz * off - p.tx * 0.5, p.y + top - 0.72, p.z - p.tx * off - p.tz * 0.5, 1.6, colour);
        }
    }
    if (options.lights) {
        options.lights.add({ x: p.x - p.tx * 1.5, y: p.y + y1, z: p.z - p.tz * 1.5, ...LIGHT_PRESETS.led, priority: 1.1, dir: { x: p.tx * 0.25, y: -1, z: p.tz * 0.25 } });
    }
}

// ---------------------------------------------------------------- kerbs

/**
 * Sample indices along the course (0 … count, the last one wraps to the start) for long straight parts: every sample in bends, on
 * straights up to maxStep metres apart (a new one when the heading has turned by ~1.5° or the slope changed).
 */
function adaptiveSamples(course, maxStep) {
    const out = [0];
    let turned = 0;
    let walked = 0;
    let slope = course.slope[0];
    for (let i = 1; i < course.count; i++) {
        turned += Math.abs(course.k[i]) * course.step;
        walked += course.step;
        if (turned > 0.026 || walked >= maxStep || Math.abs(course.slope[i] - slope) > 0.004) {
            out.push(i);
            turned = 0;
            walked = 0;
            slope = course.slope[i];
        }
    }
    out.push(course.count);
    return out;
}

/** A flat ribbon between lateral offsets from/to over the given samples (UVs in metres, like ribbonGeometry's metric option). */
function sampledRibbon(course, samples, from, to, lift) {
    const positions = [];
    const uvs = [];
    const indices = [];
    samples.forEach((i, n) => {
        const k = i % course.count;
        const lx = course.tz[k];
        const lz = -course.tx[k];
        const y = course.y[k] + lift;
        positions.push(course.x[k] + lx * to, y, course.z[k] + lz * to, course.x[k] + lx * from, y, course.z[k] + lz * from);
        const v = i * course.step;
        uvs.push(-to, v, -from, v);
        if (n < samples.length - 1) indices.push(n * 2, n * 2 + 1, n * 2 + 2, n * 2 + 1, n * 2 + 3, n * 2 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}

/**
 * Kerbs along both edges of the road (new, optional): granite-grey concrete kerb stones 0.16 m high with a chamfered top, a concrete gutter
 * (gutter metres wide, at road level, inside the edge) and drain grates in it every `drains` metres. Purely visual (the map makes colliders).
 * options: offset (lateral offset of the kerb face from the road edge), height, gutter (0: none), drains (spacing in m, 0: none), materials.
 * Put the edge lines further in when there is a gutter (buildRoadStrip({ markings: { edgeInset: gutter + 0.2 } })).
 * @returns {THREE.Group}
 */
export function buildKerbs(root, course, options = {}) {
    const { offset = 0, height = 0.16, gutter = 0.35, drains = 24, lift = 0.02 } = options;
    const mats = materialsOf(options);
    const group = new THREE.Group();
    group.name = 'kerbs';
    const edge = course.width / 2 + offset;
    // the profile outwards from the kerb face: [lateral from the edge, height] (with a chamfer above low)
    const profile = isPbr(mats) ? [[0, 0], [0, height - 0.03], [0.03, height], [0.2, height]] : [[0, 0], [0, height], [0.2, height]];
    const samples = adaptiveSamples(course, 6);
    const kerbs = [];
    for (const side of [1, -1]) {
        const positions = [];
        const uvs = [];
        const indices = [];
        const P = profile.length;
        for (let n = 0; n < samples.length; n++) {
            const i = samples[n];
            const k = i % course.count;
            const lx = course.tz[k] * side;
            const lz = -course.tx[k] * side;
            for (let j = 0; j < P; j++) {
                const [d, h] = profile[j];
                positions.push(course.x[k] + lx * (edge + d), course.y[k] + h, course.z[k] + lz * (edge + d));
                uvs.push(i * course.step, j < 2 ? h : height + d);
            }
            if (n < samples.length - 1) {
                for (let j = 0; j < P - 1; j++) {
                    const a = n * P + j;
                    const b = a + P;
                    if (side > 0) indices.push(a, b, b + 1, a, b + 1, a + 1);
                    else indices.push(a, b + 1, b, a, a + 1, b + 1);
                }
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(indices);
        g.computeVertexNormals();
        kerbs.push(g);
    }
    const kerb = new THREE.Mesh(mergeGeometries(kerbs), mats.concrete({ color: 0xc8c6c0, seams: false, stains: true }));
    kerb.receiveShadow = true;
    group.add(kerb);
    if (gutter > 0) {
        const strips = [sampledRibbon(course, samples, edge - gutter, edge, lift + 0.004), sampledRibbon(course, samples, -edge, -edge + gutter, lift + 0.004)];
        const g = new THREE.Mesh(mergeGeometries(strips), mats.concrete({ color: 0x9c9a94, seams: true, stains: true, wet: 0.4 }));
        g.receiveShadow = true;
        group.add(g);
        if (drains > 0) {
            const matrices = [];
            const p = {};
            for (let s = drains / 2; s < course.length; s += drains) {
                course.at(s, p);
                for (const side of [1, -1]) {
                    const d = (edge - gutter / 2) * side;
                    matrices.push(placement(p.x + p.tz * d, p.y + lift + 0.006, p.z - p.tx * d, Math.atan2(p.tx, p.tz)));
                }
            }
            const grate = [];
            grate.push(new THREE.BoxGeometry(Math.min(0.4, gutter - 0.04), 0.012, 0.7).translate(0, 0.006, 0));
            const mesh = instanced(mergeGeometries(grate), mats.metal({ color: 0x3a3b3e, roughness: 0.62 }), matrices, { receiveShadow: true, name: 'drains' });
            if (mesh) group.add(mesh);
        }
    }
    root.add(group);
    return group;
}
