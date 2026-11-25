// DriftKing · world/props-buildings.js – buildings: the near ones along the streets (the factory's PBR facade: recessed glass, lit windows in
// the emissive map) and the distant skyline (a window texture of 16 bays × 16 storeys with lit office floors, warm flats, blinds, curtains).
// Every building is snapped to its windows (3 m bays, 3.2 m storeys: no cut windows at the corners), tinted per building (beige tiles, grey
// concrete, blue glass...), may step back above a podium or a lower block, and carries a parapet and rooftop gear: plant rooms, air-con units,
// water tanks on legs, antenna masts with red aviation lights (steady or flashing). Merged: one draw call for the facades, one for the roofs.

import * as THREE from 'three';
import { canvasTexture, GlowPoints, mergeGeometries, rng } from '../render/kit.js';
import { settings } from '../settings.js';
import { isPbr, materialsOf, ownMaterial, paint, rod, seedFrom } from './props-common.js';

const BAY = 3;
const STOREY = 3.2;
/** One tile of windowTexture: 16 bays × 16 storeys (metres). */
const WINDOW_TILE = [48, 51.2];
/** A texel of plain wall in both window textures (metres): roofs and parapets sample it. */
const WALL_UV = [0.15, 0.3];
/** Facade tints (multiplied into the light grey of the textures): tiles, concrete, painted render, glass. */
const TINTS = [0xffffff, 0xeadfcc, 0xd4c9b9, 0xb5bdc8, 0xc8b39a, 0x9c9892, 0xdcd8d0, 0x8e8679, 0xa9b3b8, 0xc9c2cf];
const AVIATION_RED = 0xff2418;

/**
 * The window texture of the distant skyline (and of the old look): 16 bays × 16 storeys on 512² (256² on low). Each storey is an office
 * floor (most windows lit, cool white), a dark floor, or flats (scattered warm windows); lit windows are brighter at the ceiling, some
 * behind blinds or curtains. Returns the albedo texture (lit windows bright in it too, so it still works as map + emissiveMap of the old
 * look); userData.windows holds { emissive, roughness } – the lit windows alone and the gloss of the glass.
 */
export function windowTexture(seed = 11, lit = 0.36, options = {}) {
    const quality = options.quality ?? settings.get().quality;
    const size = quality === 'low' ? 256 : 512;
    const cell = size / 16;
    const random = rng(seed * 977 + 13);
    const rows = Array.from({ length: 16 }, () => {
        const r = random();
        return r < 0.16 + lit * 0.12 ? 'office' : r < 0.3 + lit * 0.05 ? 'dark' : 'flats';
    });
    const warm = ['#ffd49a', '#ffc77e', '#ffe0b4', '#ffbf73', '#f8d8a8'];
    const cool = ['#e4eeff', '#d7e5ff', '#eef4ff', '#dff0ea'];
    const windows = [];
    for (let cy = 0; cy < 16; cy++) {
        for (let cx = 0; cx < 16; cx++) {
            const kind = rows[cy];
            const p = kind === 'office' ? 0.82 : kind === 'dark' ? 0.03 : lit * 0.85;
            const on = random() < p;
            const office = kind === 'office' || random() < 0.2;
            windows.push({
                on,
                colour: office ? cool[Math.floor(random() * cool.length)] : warm[Math.floor(random() * warm.length)],
                level: 0.55 + random() * 0.45,
                blind: random() < 0.3 ? 0.25 + random() * 0.7 : 0,
                curtain: !office && random() < 0.35,
                tv: random() < 0.04,
            });
        }
    }
    const rect = k => {
        const cx = k % 16;
        const cy = Math.floor(k / 16);
        return { x: cx * cell + cell * 0.12, y: cy * cell + cell * 0.1, w: cell * 0.76, h: cell * 0.62 };
    };
    // a lit window: the room light (brighter at the ceiling), blinds as slats, curtains at the sides
    const room = (c, k, r, emissive) => {
        const win = windows[k];
        const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, win.tv ? '#b4c8ff' : win.colour);
        g.addColorStop(1, emissive ? 'rgba(0,0,0,1)' : '#2a2620');
        c.globalAlpha = win.level;
        c.fillStyle = g;
        c.fillRect(r.x, r.y, r.w, r.h);
        c.globalAlpha = win.level * 0.6;
        c.fillStyle = win.tv ? '#b4c8ff' : win.colour;
        c.fillRect(r.x, r.y, r.w, r.h * 0.6);
        c.globalAlpha = 1;
        if (win.blind > 0) {
            c.fillStyle = emissive ? 'rgba(0,0,0,0.55)' : 'rgba(40,34,30,0.5)';
            for (let y = r.y; y < r.y + r.h * win.blind; y += Math.max(2, cell / 10)) c.fillRect(r.x, y, r.w, Math.max(1, cell / 20));
        }
        if (win.curtain) {
            c.fillStyle = emissive ? 'rgba(60,24,8,0.75)' : 'rgba(120,60,30,0.8)';
            c.fillRect(r.x, r.y, r.w * 0.22, r.h);
            c.fillRect(r.x + r.w * 0.8, r.y, r.w * 0.2, r.h);
        }
    };
    const albedo = canvasTexture(size, size, c => {
        const noise = rng(seed + 5);
        c.fillStyle = '#8f8e8b';
        c.fillRect(0, 0, size, size);
        for (let k = 0; k < size * 6; k++) {
            const v = 120 + Math.floor(noise() * 40);
            c.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
            c.fillRect(noise() * size, noise() * size, 1, 1 + noise() * 2);
        }
        for (let cy = 0; cy < 16; cy++) {
            // the slab edge at every storey
            c.fillStyle = 'rgba(40,40,44,0.35)';
            c.fillRect(0, cy * cell, size, Math.max(1, cell / 16));
        }
        for (let k = 0; k < 256; k++) {
            const r = rect(k);
            if (windows[k].on) {
                c.fillStyle = '#121216';
                c.fillRect(r.x, r.y, r.w, r.h);
                room(c, k, r, false);
            } else {
                const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
                g.addColorStop(0, '#2c3546');
                g.addColorStop(1, '#161b26');
                c.fillStyle = g;
                c.fillRect(r.x, r.y, r.w, r.h);
            }
            c.fillStyle = '#34343a';
            c.fillRect(r.x + r.w / 2 - Math.max(0.5, cell / 40), r.y, Math.max(1, cell / 20), r.h);
            c.strokeStyle = '#3c3c42';
            c.lineWidth = Math.max(1, cell / 24);
            c.strokeRect(r.x, r.y, r.w, r.h);
        }
    }, { repeat: true });
    const emissive = canvasTexture(size, size, c => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, size, size);
        for (let k = 0; k < 256; k++) {
            if (!windows[k].on) continue;
            const r = rect(k);
            room(c, k, r, true);
            c.fillStyle = '#000';
            c.fillRect(r.x + r.w / 2 - Math.max(0.5, cell / 40), r.y, Math.max(1, cell / 20), r.h);
        }
    }, { repeat: true });
    let roughness = null;
    if (quality !== 'low') {
        // the gloss: glass smooth (G 0.12), walls rough (G 0.85); R = 1 (no occlusion), B = 0 (no metal)
        roughness = canvasTexture(size / 2, size / 2, c => {
            c.fillStyle = 'rgb(255,217,0)';
            c.fillRect(0, 0, size / 2, size / 2);
            c.fillStyle = 'rgb(255,30,0)';
            for (let k = 0; k < 256; k++) {
                const r = rect(k);
                c.fillRect(r.x / 2, r.y / 2, r.w / 2, r.h / 2);
            }
        }, { repeat: true, srgb: false });
    }
    albedo.userData.windows = { seed, lit, emissive, roughness };
    return albedo;
}

/** Sets the textures of the skyline material to the metric tile of windowTexture (or the old 24 m tile for a foreign texture). */
function tileWindows(texture) {
    const windows = texture.userData.windows;
    const [tu, tv] = windows ? WINDOW_TILE : [24, 24];
    for (const t of [texture, windows?.emissive, windows?.roughness]) {
        if (!t) continue;
        t.repeat.set(1 / tu, 1 / tv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
    }
}

/** The tint of the old colour option, kept as a hint: its hue at a third of the strength on white. */
function softTint(hex) {
    const c = new THREE.Color(hex);
    const max = Math.max(c.r, c.g, c.b, 1e-3);
    return new THREE.Color(c.r / max, c.g / max, c.b / max).lerp(new THREE.Color(1, 1, 1), 0.65);
}

/**
 * A box of facade (no bottom) from y0 to y0 + h, centred at (ox, oz), with UVs in metres snapped to the window grid: every face spans whole
 * bays (bayScale > 1: narrower bays), storeys count from the building's base (vScale stretches them to fit its height); faces get their own
 * offsets into the texture.
 * The top samples a wall texel. Vertex colour = the building's tint.
 */
function facadeBox(w, h, d, ox, y0, oz, { vScale, offsets, tint, bayScale = 1 }) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(ox, y0 + h / 2, oz);
    const uv = g.attributes.uv;
    const position = g.attributes.position;
    const widths = [d, d, 0, 0, w, w];
    for (let f = 0; f < 6; f++) {
        const width = widths[f];
        const bays = Math.max(1, Math.round((width * bayScale) / BAY));
        for (let v = 0; v < 4; v++) {
            const i = f * 4 + v;
            if (width === 0) uv.setXY(i, WALL_UV[0], WALL_UV[1]);
            else uv.setXY(i, uv.getX(i) * bays * BAY + offsets[f][0], position.getY(i) * vScale + offsets[f][1]);
        }
    }
    // drop the bottom face (indices 18..23)
    const index = Array.from(g.index.array);
    index.splice(18, 6);
    g.setIndex(index);
    g.clearGroups();
    return paint(g, tint);
}

/** Per-face texture offsets in whole bays and storeys (from a local random stream). */
function faceOffsets(random) {
    return Array.from({ length: 6 }, () => [Math.floor(random() * 16) * BAY, Math.floor(random() * 16) * STOREY]);
}

/** A parapet ring (1 m high, 0.3 m thick) on a roof at height top, as facade boxes sampling the wall texel. */
function parapet(list, w, d, ox, oz, top, tint) {
    const t = 0.3;
    const h = 1.0;
    const pieces = [[w, d / 2 - t / 2, 'x'], [w, -d / 2 + t / 2, 'x'], [d - 2 * t, w / 2 - t / 2, 'z'], [d - 2 * t, -w / 2 + t / 2, 'z']];
    for (const [length, offset, axis] of pieces) {
        const g = axis === 'x' ? new THREE.BoxGeometry(length, h, t).translate(ox, top + h / 2, oz + offset) : new THREE.BoxGeometry(t, h, length).translate(ox + offset, top + h / 2, oz);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, WALL_UV[0], WALL_UV[1]);
        list.push(paint(g, tint));
    }
}

/**
 * Rooftop gear on a roof (w × d at height top, centred at ox/oz): a plant room, air-con units, a water tank on legs, an antenna mast.
 * Pushes painted geometries to roof and returns the mast top (or null).
 */
function rooftop(roof, random, { w, d, ox, oz, top, tint, mast, quality }) {
    const pbr = quality !== 'low';
    const margin = 1.6;
    const inner = (extent, size) => (random() - 0.5) * Math.max(0, extent - size - margin * 2);
    if (w > 8 && d > 8 && random() < 0.6) {
        const bw = 3 + random() * 2.5;
        const bd = 3 + random() * 2;
        roof.push(paint(new THREE.BoxGeometry(bw, 3.2, bd).translate(ox + inner(w, bw), top + 1.6, oz + inner(d, bd)), new THREE.Color(tint).multiplyScalar(0.62)));
    }
    const units = pbr ? 1 + Math.floor(random() * 4) : 1 + Math.floor(random() * 2);
    for (let k = 0; k < units; k++) {
        const uw = 1.2 + random() * 1.6;
        const ud = 1.2 + random() * 1.4;
        const uh = 0.9 + random() * 0.8;
        roof.push(paint(new THREE.BoxGeometry(uw, uh, ud).translate(ox + inner(w, uw), top + uh / 2, oz + inner(d, ud)), random() < 0.5 ? 0x8c9094 : 0xa4a6a2));
    }
    if (pbr && w > 7 && d > 7 && random() < 0.4) {
        // a water tank on a steel frame (typical of mid-rise roofs)
        const r = 1 + random() * 0.6;
        const tx = ox + inner(w, r * 2);
        const tz = oz + inner(d, r * 2);
        const legs = 1.4;
        roof.push(paint(new THREE.CylinderGeometry(r, r, 1.8 + random() * 0.8, 12).translate(tx, top + legs + 1.1, tz), random() < 0.5 ? 0xbdb6a6 : 0x9fa6ab));
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            roof.push(paint(new THREE.BoxGeometry(0.12, legs + 0.2, 0.12).translate(tx + lx * r * 0.7, top + legs / 2, tz + lz * r * 0.7), 0x4a4c50));
        }
    }
    if (!mast) return null;
    const mx = ox + inner(w, 1);
    const mz = oz + inner(d, 1);
    const height = 4 + random() * 9;
    roof.push(paint(rod({ x: mx, y: top, z: mz }, { x: mx, y: top + height, z: mz }, 0.12, 0.05, pbr ? 6 : 4), 0x8a8d90));
    if (pbr) {
        for (let y = top + 1.5; y < top + height - 1; y += 2.2) roof.push(paint(new THREE.BoxGeometry(0.9, 0.06, 0.06).translate(mx, y, mz), 0x8a8d90));
    }
    return { x: mx, y: top + height + 0.3, z: mz };
}

/**
 * A building (w × h × d, standing on y, centred at x/z, turned by rot): returns its merged facade geometry with UVs in metres;
 * userData.roof = rooftop gear geometries and userData.beacons = aviation lights (buildingMesh makes them). The ground footprint is always
 * exactly w × d (colliders made from it stay right); taller buildings may step back above 20 m. Uses two numbers of `random` (as before).
 */
export function buildingGeometry(w, h, d, x, y, z, rot = 0, random = Math.random) {
    const local = rng(seedFrom(random(), 1) ^ seedFrom(random(), 2));
    const quality = settings.get().quality;
    const tint = new THREE.Color(TINTS[Math.floor(local() * TINTS.length)]);
    const storeys = Math.max(1, Math.round(h / STOREY));
    const vScale = (storeys * STOREY) / h;
    const facade = [];
    const roof = [];
    const beacons = [];
    const opts = { vScale, offsets: faceOffsets(local), tint };
    // the blocks: the full footprint up to the first setback, then smaller ones further back
    const blocks = [];
    if (h > 32 && local() < 0.55) {
        const s1 = Math.max(Math.ceil(20 / STOREY), Math.round(storeys * (0.5 + local() * 0.25)));
        const h1 = (s1 * STOREY) / vScale;
        const w2 = w * (0.7 + local() * 0.16);
        const d2 = d * (0.68 + local() * 0.16);
        blocks.push({ w, d, ox: 0, oz: 0, y0: 0, h: h1 });
        blocks.push({ w: w2, d: d2, ox: (w - w2) * (local() - 0.5) * 0.6, oz: -(d - d2) / 2 * (0.4 + local() * 0.6), y0: h1, h: h - h1 });
    } else {
        blocks.push({ w, d, ox: 0, oz: 0, y0: 0, h });
    }
    for (const b of blocks) {
        facade.push(facadeBox(b.w, b.h, b.d, b.ox, b.y0, b.oz, opts));
        parapet(facade, b.w, b.d, b.ox, b.oz, b.y0 + b.h, tint);
    }
    const crown = blocks[blocks.length - 1];
    const top = crown.y0 + crown.h;
    const tip = rooftop(roof, local, { ...crown, top, tint, mast: h > 34 && local() < 0.4, quality });
    if (tip && tip.y > 45) beacons.push({ ...tip, flash: local() < 0.5 });
    else if (top > 45) beacons.push({ x: crown.ox + crown.w / 2 - 0.4, y: top + 1.2, z: crown.oz + crown.d / 2 - 0.4, flash: false });
    const merged = mergeGeometries(facade);
    const place = g => {
        if (rot) g.rotateY(rot);
        g.translate(x, y, z);
        return g;
    };
    place(merged);
    const v = new THREE.Vector3();
    merged.userData.roof = roof.map(place);
    merged.userData.beacons = beacons.map(b => {
        v.set(b.x, b.y, b.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        return { x: v.x + x, y: v.y + y, z: v.z + z, flash: b.flash };
    });
    return merged;
}

/** The roof gear material (painted metal and concrete per vertex colour). */
function roofMaterial(mats) {
    return ownMaterial(mats, { vertexColors: true, roughness: 0.62 });
}

/**
 * Aviation lights: steady ones into the map's glow points (when given), flashing ones (synchronised, ~40 per minute) as their own glow
 * object whose brightness follows the clock. Returns the flashing object or null.
 */
function aviationLights(beacons, glows, size = 4.5) {
    const flashing = new GlowPoints();
    for (const b of beacons) {
        if (b.flash || !glows) flashing.add(b.x, b.y, b.z, size, AVIATION_RED);
        else glows.add(b.x, b.y, b.z, size, AVIATION_RED);
    }
    const points = flashing.build({ fogFar: 1500, intensity: 1 });
    if (!points) return null;
    points.name = 'aviation-lights';
    const uniforms = points.material.uniforms;
    points.onBeforeRender = () => {
        const t = (performance.now() / 1000) % 1.5;
        uniforms.intensity.value = t < 0.45 ? 1.25 * Math.sin((t / 0.45) * Math.PI) ** 0.5 : 0.04;
    };
    return points;
}

/**
 * One mesh of many building geometries (buildingGeometry): the factory's facade (recessed glass, lit windows; PBR on medium/high),
 * tinted per building, with the roofs' gear and the aviation lights as children. texture: the old window texture – not drawn any more
 * (the facade replaces it; freed here). options: colour (a hint of hue), glow (lit-window brightness, default 1), lit (share of lit windows,
 * default 0.35), materials (the factory), glows (where steady aviation lights go; flashing ones are a child of the mesh).
 */
export function buildingMesh(geometries, texture, options = {}) {
    const { colour = 0x8a88a0, glow = 1 } = options;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const roofs = [];
    const beacons = [];
    for (const g of geometries) {
        if (g.userData.roof) roofs.push(...g.userData.roof);
        if (g.userData.beacons) beacons.push(...g.userData.beacons);
    }
    const set = mats.textures.facade({ lit: options.lit ?? 0.35, seed: 131 });
    const tint = softTint(colour);
    const material = pbr
        ? new THREE.MeshStandardMaterial({
            map: set.map,
            normalMap: set.normalMap,
            roughnessMap: set.roughnessMap,
            metalnessMap: set.metalnessMap,
            aoMap: set.aoMap,
            color: tint,
            vertexColors: true,
            roughness: 1,
            metalness: 1,
            emissive: 0xffffff,
            emissiveMap: set.emissiveMap,
            emissiveIntensity: 1.15 * glow,
        })
        : new THREE.MeshLambertMaterial({ map: set.map, color: tint, vertexColors: true, emissive: 0xffffff, emissiveMap: set.emissiveMap, emissiveIntensity: glow });
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = 'buildings';
    mesh.receiveShadow = true;
    mesh.castShadow = mats.quality === 'high';
    if (roofs.length) {
        const roof = new THREE.Mesh(mergeGeometries(roofs), roofMaterial(mats));
        roof.receiveShadow = pbr;
        mesh.add(roof);
    }
    const lights = aviationLights(beacons, options.glows ?? null, 3.5);
    if (lights) mesh.add(lights);
    // the old window texture is not used: free what it holds (never uploaded)
    if (texture?.isTexture) {
        texture.userData.windows?.emissive?.dispose();
        texture.userData.windows?.roughness?.dispose();
        texture.dispose();
    }
    return mesh;
}

/**
 * A distant skyline: towers in a ring between inner and outer radius around (cx, cz) on ground y – slabs, towers on podiums, stepped
 * towers, a few round ones – with the window texture (lit offices and flats), parapets, rooftop gear, masts and red aviation lights
 * (steady ones into glows, flashing ones as their own object). The towers stand where they always stood (same seed, same draws).
 * options: texture (windowTexture(...)), glow (lit-window brightness, default 1.15), colour (hue hint), materials (the factory).
 */
export function buildSkyline(root, glows, options) {
    const { cx = 0, cz = 0, y = 0, inner = 300, outer = 520, count = 90, seed = 21, maxHeight = 150, texture } = options;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const random = rng(seed);
    const shape = rng(seed * 7 + 3);
    const facade = [];
    const roof = [];
    const beacons = [];
    for (let k = 0; k < count; k++) {
        const a = random() * Math.PI * 2;
        const r = inner + random() * (outer - inner);
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const w = 14 + random() * 26;
        const d = 14 + random() * 26;
        const h = 20 + Math.pow(random(), 1.6) * maxHeight;
        const rot = random() * Math.PI;
        // the two draws the old building geometry made, and the old beacon draw (the stream stays the same for every tower after this one)
        random();
        random();
        const beaconDraw = h > maxHeight * 0.45 ? random() : 1;
        const tint = new THREE.Color(TINTS[Math.floor(shape() * TINTS.length)]).multiplyScalar(0.85 + shape() * 0.15);
        // offices with taller storeys and wider bays, flats with narrow ones
        const storeys = Math.max(2, Math.round((h * (shape() < 0.4 ? 0.84 : 1)) / STOREY));
        const vScale = (storeys * STOREY) / h;
        const opts = { vScale, offsets: faceOffsets(shape), tint, bayScale: [0.8, 1, 1, 1.25, 1.5][Math.floor(shape() * 5)] };
        const parts = [];
        const roofParts = [];
        const kind = shape();
        let crown;
        if (h > 60 && kind < 0.3) {
            // a tower on a podium: 3–5 storeys over the whole plot, the tower narrower on it
            const ph = (Math.round(3 + shape() * 2) * STOREY) / vScale;
            parts.push(facadeBox(w * 1.25, ph, d * 1.25, 0, 0, 0, opts));
            parapet(parts, w * 1.25, d * 1.25, 0, 0, ph, tint);
            const tw = w * 0.8;
            const td = d * 0.8;
            parts.push(facadeBox(tw, h - ph, td, 0, ph, 0, opts));
            crown = { w: tw, d: td, ox: 0, oz: 0, top: h };
        } else if (h > 45 && kind < 0.65) {
            // stepped: two or three setbacks
            const steps = kind < 0.5 ? 2 : 3;
            let y0 = 0;
            let cw = w;
            let cd = d;
            for (let s = 0; s < steps; s++) {
                const part = s === steps - 1 ? h - y0 : (Math.round((storeys * (0.45 + shape() * 0.2)) / (s + 1)) * STOREY) / vScale;
                parts.push(facadeBox(cw, part, cd, 0, y0, 0, opts));
                parapet(parts, cw, cd, 0, 0, y0 + part, tint);
                y0 += part;
                if (s < steps - 1) {
                    cw *= 0.72 + shape() * 0.12;
                    cd *= 0.72 + shape() * 0.12;
                }
            }
            crown = { w: cw, d: cd, ox: 0, oz: 0, top: h };
        } else if (kind > 0.92 && h > 40) {
            // a round tower (12 sides, the window grid wraps around it)
            const radius = Math.min(w, d) / 2;
            const sides = pbr ? 16 : 10;
            const g = new THREE.CylinderGeometry(radius, radius, h, sides, 1, false);
            g.translate(0, h / 2, 0);
            const uv = g.attributes.uv;
            const p = g.attributes.position;
            const circumference = Math.round((2 * Math.PI * radius) / BAY) * BAY;
            for (let i = 0; i < uv.count; i++) {
                const n = g.attributes.normal.getY(i);
                if (Math.abs(n) > 0.5) uv.setXY(i, WALL_UV[0], WALL_UV[1]);
                else uv.setXY(i, uv.getX(i) * circumference + opts.offsets[0][0], p.getY(i) * vScale + opts.offsets[0][1]);
            }
            parts.push(paint(g, tint));
            crown = { w: radius * 1.2, d: radius * 1.2, ox: 0, oz: 0, top: h };
        } else {
            parts.push(facadeBox(w, h, d, 0, 0, 0, opts));
            parapet(parts, w, d, 0, 0, h, tint);
            crown = { w, d, ox: 0, oz: 0, top: h };
        }
        const wantsBeacon = beaconDraw < 0.6;
        const tip = rooftop(roofParts, shape, { ...crown, tint, mast: wantsBeacon && shape() < 0.6, quality: mats.quality });
        const local = [];
        if (wantsBeacon) {
            if (tip) local.push({ ...tip, flash: shape() < 0.5 });
            // the corners of the roof as well on the tallest
            if (h > maxHeight * 0.7) {
                for (const [sx, sz] of [[-1, -1], [1, 1]]) local.push({ x: crown.ox + sx * (crown.w / 2 - 0.3), y: h + 1.2, z: crown.oz + sz * (crown.d / 2 - 0.3), flash: false });
            } else if (!tip) {
                local.push({ x: crown.ox, y: h + 1.5, z: crown.oz, flash: false });
            }
        }
        const place = g => g.rotateY(rot).translate(x, y, z);
        for (const g of parts) facade.push(place(g));
        for (const g of roofParts) roof.push(place(g));
        const v = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        for (const b of local) {
            v.set(b.x, b.y, b.z).applyAxisAngle(up, rot);
            beacons.push({ x: v.x + x, y: v.y + y, z: v.z + z, flash: b.flash });
        }
    }
    const group = new THREE.Group();
    group.name = 'skyline';
    const glow = options.glow ?? 1.15;
    const tint = softTint(options.colour ?? 0x8a8aa0);
    let material;
    if (texture?.isTexture) {
        tileWindows(texture);
        const windows = texture.userData.windows;
        const emissiveMap = windows?.emissive ?? texture;
        material = pbr
            ? new THREE.MeshStandardMaterial({ map: texture, color: tint, vertexColors: true, roughness: 1, roughnessMap: windows?.roughness ?? null, metalness: 0, emissive: 0xffffff, emissiveMap, emissiveIntensity: 1.5 * glow })
            : new THREE.MeshLambertMaterial({ map: texture, color: tint, vertexColors: true, emissive: 0xffffff, emissiveMap, emissiveIntensity: glow });
    } else {
        // no texture given: the factory facade
        const set = mats.textures.facade({ lit: 0.35, seed: 131 });
        material = ownMaterial(mats, { map: set.map, color: tint, vertexColors: true, emissive: 0xffffff, emissiveMap: set.emissiveMap, emissiveIntensity: 1.5 * glow });
    }
    const towers = new THREE.Mesh(mergeGeometries(facade), material);
    towers.name = 'skyline-towers';
    group.add(towers);
    if (roof.length) group.add(new THREE.Mesh(mergeGeometries(roof), roofMaterial(mats)));
    const flashing = aviationLights(beacons, glows, 5);
    if (flashing) group.add(flashing);
    root.add(group);
    return group;
}
