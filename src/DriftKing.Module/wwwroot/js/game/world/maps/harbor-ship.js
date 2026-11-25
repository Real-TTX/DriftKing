// DriftKing · maps/harbor-ship.js – the container ship moored at Kaikō-Docks (invented: the "AONAMI HIKARI" of the AONAMI line): a lofted hull
// with a flared, raked bow and a transom stern, red antifouling at the waterline, rust runs on the paint; container bays on deck with lashing
// bridges, the white accommodation block with lit windows and the bridge, the funnel in the line's colours, masts with navigation lights
// (red to port, green to starboard), deck floodlights, a gangway and mooring lines to the quay's bollards. Not a collider (it lies beyond the quay).

import * as THREE from 'three';
import { HARBOR, block, harborPalette, rope, slab, tube } from './harbor-parts.js';
import { fitText, wear } from './harbor-decals.js';
import { BOX, LINES, TIER } from './harbor-containers.js';
import { rng } from '../../render/kit.js';

const { quayZ: QUAY_Z, waterY: WATER_Y } = HARBOR;

/** The ship's frame: stern and bow x at the deck, the centre line z, half the beam, keel and deck height. */
const SHIP = Object.freeze({ stern: -102, bow: 128, zc: QUAY_Z + 3.2 + 16, half: 16, bottom: WATER_Y - 2.2, deck: 8 });
const LINE = LINES.find(l => l.key === 'aonami');

/** Half the breadth of the hull at the fraction t (0 stern … 1 bow) and the height fraction h (0 bottom … 1 deck). */
function halfBreadth(t, h) {
    const B = SHIP.half;
    if (t < 0.1) {
        const s = t / 0.1;
        return B * (0.62 + 0.24 * h + (0.14 + 0.0 * h) * s * (2 - s)) * (1 - (1 - s) * (1 - h) * 0.25);
    }
    if (t <= 0.7) return B * (h < 0.12 ? 0.9 + h * 0.83 : 1);
    const s = (t - 0.7) / 0.3;
    const p = 1.35 + 1.1 * h;
    return B * Math.max(0, 1 - Math.pow(s, p)) * (h < 0.12 ? 0.9 + h * 0.83 : 1);
}

/** The x of a station: the stern overhangs and the stem rakes forward towards the deck. */
function stationX(t, h) {
    const stern = SHIP.stern + (1 - h) * 3.5;
    const bow = SHIP.bow - (1 - h) * 7;
    return stern + (bow - stern) * t;
}

/** Station fractions (denser towards the bow). */
function stations(count) {
    const list = [];
    for (let i = 0; i <= count; i++) {
        const u = i / count;
        list.push(u < 0.6 ? u * (0.7 / 0.6) : 0.7 + Math.pow((u - 0.6) / 0.4, 0.85) * 0.3);
    }
    return list;
}

/**
 * Builds the ship and its cargo (through the container yard), mooring lines to the bollards.
 * @param {object} ctx the map context
 * @param {{ yard: import('./harbor-containers.js').ContainerYard, decals: import('./harbor-decals.js').Decals,
 *           streaks: import('./harbor-water.js').WaterStreaks, bollards: { x: number, z: number }[] }} parts
 */
export function buildShip(ctx, { batch, yard, decals, streaks, bollards }) {
    const { root, materials, quality, glows } = ctx;
    const random = rng(5);
    const pbr = quality !== 'low';
    root.add(buildHull(quality));

    const p = harborPalette(materials);
    const { white, steel } = p;
    const deckPaint = p.grey;
    const funnelPaint = p.blue;
    const soot = p.black;
    const glassBand = p.glass;
    const lashing = p.cream;
    const deckY = SHIP.deck;
    const zc = SHIP.zc;

    // the accommodation block: white decks stepping back, rows of cabin windows (some lit), the bridge on top with wings over the full beam
    const ax0 = -82;
    const ax1 = -64;
    const lit = p.warm;
    batch.add(white, slab(ax0, ax1, deckY, deckY + 17.8, zc - 12, zc + 12, { faces: '-x+x+y-z+z' }));
    for (let deck = 0; deck < 6; deck++) {
        const y = deckY + 1.2 + deck * 2.8;
        // along the sides (the quay side first) and across the front
        for (const [face, from, to, at] of [['-z', ax0 + 1.2, ax1 - 1.2, zc - 12], ['+z', ax0 + 1.2, ax1 - 1.2, zc + 12], ['+x', zc - 10.5, zc + 10.5, ax1]]) {
            for (let s = from; s <= to; s += 2.3) {
                const material = random() < 0.42 ? lit : glassBand;
                if (face === '+x') batch.add(material, slab(at - 0.02, at + 0.03, y, y + 1.1, s - 0.45, s + 0.45, { faces: '+x' }));
                else batch.add(material, slab(s - 0.45, s + 0.45, y, y + 1.1, at - 0.03, at + 0.03, { faces: face }));
            }
        }
        // the deck's edge: a thin overhang
        batch.add(white, slab(ax0 - 0.3, ax1 + 0.3, y + 1.55, y + 1.7, zc - 12.3, zc + 12.3, { faces: '-x+x-y+y-z+z' }));
    }
    const bridgeY = deckY + 17.8;
    batch.add(white, slab(ax0 + 2, ax1 - 1, bridgeY, bridgeY + 3.4, zc - SHIP.half + 0.4, zc + SHIP.half - 0.4, { faces: '-x+x+y-z+z' }));
    batch.add(glassBand, slab(ax0 + 2, ax1 - 1 + 0.03, bridgeY + 1.5, bridgeY + 2.9, zc - SHIP.half + 0.37, zc + SHIP.half - 0.37, { faces: '+x-z+z' }));
    // radar mast on the bridge roof, the funnel behind
    batch.add(steel, tube({ x: ax1 - 6, y: bridgeY + 3.4, z: zc }, { x: ax1 - 6, y: bridgeY + 11, z: zc }, 0.18, { sides: 6 }));
    batch.add(steel, tube({ x: ax1 - 6, y: bridgeY + 9, z: zc - 3 }, { x: ax1 - 6, y: bridgeY + 9, z: zc + 3 }, 0.08, { sides: 4 }));
    batch.add(funnelPaint, slab(-97, -86, deckY, deckY + 24, zc - 5.5, zc + 5.5, { faces: '-x+x-z+z' }));
    batch.add(white, slab(-97.05, -85.95, deckY + 16, deckY + 18.5, zc - 5.55, zc + 5.55, { faces: '-x+x-z+z' }));
    batch.add(soot, slab(-97.05, -85.95, deckY + 22.5, deckY + 24.4, zc - 5.55, zc + 5.55, { faces: '-x+x+y-z+z' }));
    decals.define('ship-emblem', 112, 112, (c, w, h) => {
        c.fillStyle = LINE.ink;
        c.lineWidth = 9;
        c.strokeStyle = LINE.ink;
        for (let k = 0; k < 3; k++) {
            const y = h * (0.3 + k * 0.22);
            c.beginPath();
            c.moveTo(w * 0.08, y + 6);
            c.bezierCurveTo(w * 0.3, y - 18, w * 0.5, y + 20, w * 0.7, y - 2);
            c.quadraticCurveTo(w * 0.82, y - 12, w * 0.94, y - 6);
            c.stroke();
        }
    }, { ink: LINE.ink });
    decals.wall('ship-emblem', { x: -91.5, y: deckY + 20.2, z: zc - 5.58 }, { x: -1, z: 0 }, 5.5, 5.5);

    // deck, the breakwater at the bow, lashing bridges and the containers in bays
    const bays = [];
    for (let xc = -52; xc + BOX.l40 / 2 < 113; xc += BOX.l40 + 1.3) bays.push(xc);
    batch.add(white, slab(112, 113, deckY, deckY + 2.6, zc - 9, zc + 9, { faces: '-x+x+y-z+z' }));
    const lineWeights = LINES.map(l => ({ ...l, weight: l.key === LINE.key ? 40 : l.weight }));
    for (const xc of bays) {
        // the narrowest half breadth over the bay (towards the bow the hull closes in)
        const t = Math.max(...[xc - 6.1, xc + 6.1].map(x => (x - SHIP.stern) / (SHIP.bow - SHIP.stern)));
        const half = halfBreadth(t, 1) - 0.6;
        const rows = Math.max(2, Math.floor((half * 2) / 2.5));
        const base = 2 + Math.floor(random() * 4);
        const tiers = [];
        for (let r = 0; r < rows; r++) tiers.push(Math.max(1, base + (random() < 0.3 ? -1 : 0) + (random() < 0.15 ? 1 : 0)));
        for (let r = 0; r < rows; r++) {
            const z = zc + (r - (rows - 1) / 2) * 2.5;
            for (let level = 0; level < tiers[r]; level++) {
                const exposed = r === 0 || r === rows - 1 || level === tiers[r] - 1 || level >= Math.min(tiers[r - 1], tiers[r + 1]);
                if (!exposed) continue;
                const line = pickLine(lineWeights, random);
                yard.add({ x: xc, y: deckY + 0.6 + level * TIER, z, yaw: Math.PI, size: 40, line, colour: yard.shade(line, random), lod: quality === 'low' ? 'box' : 'mid', chunk: 'ship', marks: r === 0 ? 'always' : false });
            }
        }
        // the hatch cover under the stack, a lashing bridge aft of it with a floodlight
        batch.add(deckPaint, slab(xc - 6.3, xc + 6.3, deckY, deckY + 0.6, zc - half, zc + half, { faces: '-x+x+y-z+z' }));
        const lx = xc - BOX.l40 / 2 - 0.65;
        if (lx > -60) {
            for (const zz of [zc - half + 0.3, zc - half / 3, zc + half / 3, zc + half - 0.3]) batch.add(lashing, block(0.25, 5.4, 0.25, lx, deckY + 2.7, zz));
            for (const yy of [deckY + 2.8, deckY + 5.4]) batch.add(lashing, block(0.9, 0.12, half * 2, lx, yy, zc));
            const light = { x: lx, y: deckY + 5.9, z: zc - half + 0.6 };
            glows.add(light.x, light.y, light.z, 1.8, 0xffb860);
            streaks.add(light.x, light.y, light.z, 0xffa850, { width: 0.7, length: 0.8, strength: 0.55 });
        }
    }
    // the gangway down to the quay, its handrails
    const top = { x: -60, y: deckY + 0.4, z: SHIP.zc - SHIP.half - 0.2 };
    const foot = { x: -48, y: 0.3, z: QUAY_Z - 2.4 };
    const ramp = new THREE.BoxGeometry(0.9, 0.08, Math.hypot(top.x - foot.x, top.y - foot.y, top.z - foot.z));
    ramp.lookAt(new THREE.Vector3(top.x - foot.x, top.y - foot.y, top.z - foot.z));
    ramp.translate((top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2);
    batch.add(steel, ramp);
    for (const side of [-0.45, 0.45]) batch.add(steel, tube({ x: foot.x + side, y: foot.y + 1, z: foot.z }, { x: top.x + side, y: top.y + 1, z: top.z }, 0.025, { sides: 4 }));
    // mooring lines: head and stern lines and springs from fairleads on the deck edge to the nearest bollards
    const ropeMaterial = p.rope;
    const fairleads = [-95, -90, -40, 60, 112, 116];
    for (const fx of fairleads) {
        const t = (fx - SHIP.stern) / (SHIP.bow - SHIP.stern);
        const from = { x: fx, y: deckY - 0.3, z: zc - halfBreadth(t, 0.95) };
        const reach = fx < 0 ? fx - 14 - random() * 10 : fx + 12 + random() * 10;
        const bollard = bollards.reduce((best, b) => (Math.abs(b.x - reach) < Math.abs(best.x - reach) ? b : best), bollards[0]);
        batch.add(ropeMaterial, rope(from, { x: bollard.x, y: 0.55, z: bollard.z }, 0.07, 1.6, { segments: pbr ? 10 : 5 }));
    }

    // navigation lights, the lit bridge windows' glow, the floodlights on the accommodation
    const lights = [
        { x: ax1 - 2, y: bridgeY + 2.2, z: zc - SHIP.half + 0.2, colour: 0xff2a20, size: 1.4 },
        { x: ax1 - 2, y: bridgeY + 2.2, z: zc + SHIP.half - 0.2, colour: 0x30ff70, size: 1.4 },
        { x: ax1 - 6, y: bridgeY + 11.2, z: zc, colour: 0xfff4e0, size: 1.6 },
        { x: 122, y: deckY + 10, z: zc, colour: 0xfff4e0, size: 1.4 },
        { x: -97, y: deckY + 25.6, z: zc, colour: 0xff3030, size: 1.6 },
    ];
    for (const l of lights) {
        glows.add(l.x, l.y, l.z, l.size, l.colour);
        // only the lights on the quay side can be seen mirrored between the quay and the hull
        if (l.z < zc - 1) streaks.add(l.x, l.y, l.z, l.colour, { width: 0.5, length: 0.7, strength: 0.6 });
    }
    batch.add(p.redLight, block(0.3, 0.3, 0.3, ax1 - 2, bridgeY + 2.2, zc - SHIP.half + 0.2));
    batch.add(p.greenLight, block(0.3, 0.3, 0.3, ax1 - 2, bridgeY + 2.2, zc + SHIP.half - 0.2));
    batch.add(p.whiteLight, block(0.3, 0.3, 0.3, ax1 - 6, bridgeY + 11.2, zc), block(0.3, 0.3, 0.3, 122, deckY + 10, zc));
    batch.add(steel, tube({ x: 122, y: deckY, z: zc }, { x: 122, y: deckY + 9.8, z: zc }, 0.15, { sides: 6 }));
    const flood = p.sodium;
    for (const zz of [zc - 11, zc + 11]) {
        batch.add(flood, block(0.5, 0.35, 0.35, ax1 + 0.3, deckY + 17.2, zz));
        glows.add(ax1 + 0.5, deckY + 17.2, zz, 2.4, 0xffc070);
        if (zz < zc) streaks.add(ax1 + 0.5, deckY + 17.2, zz, 0xffb060, { width: 0.9, length: 0.8, strength: 0.5 });
    }
    paintHull(decals);
}

function pickLine(list, random) {
    let total = 0;
    for (const l of list) total += l.weight;
    let r = random() * total;
    for (const l of list) {
        r -= l.weight;
        if (r <= 0) return LINES.find(x => x.key === l.key);
    }
    return LINE;
}

/** The hull: two bands (antifouling below the boot-top, the hull paint above), smooth normals, the deck, the transom. */
function buildHull(quality) {
    const ts = stations(quality === 'low' ? 24 : 44);
    const bands = [
        { ys: [SHIP.bottom, WATER_Y + 0.9], colour: 0x6e2a22 },
        { ys: [WATER_Y + 0.9, 0.8, 4.5, SHIP.deck - 0.8, SHIP.deck], colour: 0x2c3646 },
    ];
    const positions = [];
    const colours = [];
    const uvs = [];
    const indices = [];
    const colour = new THREE.Color();
    const span = SHIP.deck - SHIP.bottom;
    const point = (t, y, side) => {
        const h = (y - SHIP.bottom) / span;
        return [stationX(t, h), y, SHIP.zc + side * halfBreadth(t, h)];
    };
    for (const band of bands) {
        colour.set(band.colour);
        for (const side of [-1, 1]) {
            const base = positions.length / 3;
            const columns = ts.length;
            for (const y of band.ys) {
                for (const t of ts) {
                    const p = point(t, y, side);
                    positions.push(...p);
                    colours.push(colour.r, colour.g, colour.b);
                    uvs.push(p[0] * side, y);
                }
            }
            for (let j = 0; j < band.ys.length - 1; j++) {
                for (let i = 0; i < columns - 1; i++) {
                    const a = base + j * columns + i;
                    const b = a + 1;
                    const c = a + columns + 1;
                    const d = a + columns;
                    if (side > 0) indices.push(a, b, c, a, c, d);
                    else indices.push(a, c, b, a, d, c);
                }
            }
        }
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    hull.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    hull.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    hull.setIndex(indices);
    hull.computeVertexNormals();
    // the transom (the flat stern face) and the deck: separate flat parts
    const flat = [];
    const deckPositions = [];
    const deckIndices = [];
    for (const t of ts) {
        deckPositions.push(...point(t, SHIP.deck, -1), ...point(t, SHIP.deck, 1));
    }
    for (let i = 0; i < ts.length - 1; i++) {
        const a = i * 2;
        deckIndices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const deck = new THREE.BufferGeometry();
    deck.setAttribute('position', new THREE.Float32BufferAttribute(deckPositions, 3));
    deck.setIndex(deckIndices);
    deck.computeVertexNormals();
    flat.push(deck);
    const transom = [];
    const ys = [SHIP.bottom, WATER_Y + 0.9, SHIP.deck];
    for (const y of ys) transom.push(...point(0, y, -1), ...point(0, y, 1));
    const transomIndices = [];
    for (let j = 0; j < ys.length - 1; j++) {
        const a = j * 2;
        transomIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const stern = new THREE.BufferGeometry();
    stern.setAttribute('position', new THREE.Float32BufferAttribute(transom, 3));
    stern.setIndex(transomIndices);
    stern.computeVertexNormals();
    flat.push(stern);
    for (const g of flat) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const c = new Float32Array(g.attributes.position.count * 3);
        colour.set(0x2c3646);
        for (let k = 0; k < c.length; k += 3) c.set([colour.r, colour.g, colour.b], k);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const group = new THREE.Group();
    group.name = 'Ship';
    const material = hullMaterial(quality);
    group.add(new THREE.Mesh(hull, material));
    for (const g of flat) group.add(new THREE.Mesh(g, material));
    return group;
}

/** Hull paint with rust runs and weld seams (a small canvas texture, tile 6 × 10 m), tinted by the vertex colours. */
function hullMaterial(quality) {
    const random = rng(23);
    const size = quality === 'low' ? 128 : 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    c.fillStyle = '#d0d0d0';
    c.fillRect(0, 0, size, size);
    for (let k = 0; k < 40; k++) {
        c.fillStyle = `rgba(${random() < 0.5 ? '255,255,255' : '90,90,90'},${0.05 + random() * 0.08})`;
        c.fillRect(random() * size, random() * size, 10 + random() * 50, 10 + random() * 40);
    }
    // rust and grime running down from the deck edge and the scuppers
    for (let k = 0; k < 26; k++) {
        const x = random() * size;
        const g = c.createLinearGradient(0, 0, 0, size * (0.3 + random() * 0.7));
        g.addColorStop(0, `rgba(${random() < 0.5 ? '120,64,40' : '40,36,34'},${0.25 + random() * 0.3})`);
        g.addColorStop(1, 'rgba(120,64,40,0)');
        c.fillStyle = g;
        c.fillRect(x, 0, 1 + random() * 4, size);
    }
    // plate seams
    c.fillStyle = 'rgba(40,40,40,0.25)';
    c.fillRect(0, size * 0.5, size, 1);
    c.fillRect(size * 0.5, 0, 1, size);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1 / 6, 1 / 10);
    map.offset.set(0, 0.2);
    map.anisotropy = 4;
    return quality === 'low'
        ? new THREE.MeshLambertMaterial({ map, vertexColors: true })
        : new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.55, metalness: 0.1 });
}

/** The line's name along the hull midships, the ship's name at the bow (both on the side facing the quay). */
function paintHull(decals) {
    decals.define('hull-aonami', 896, 168, (c, w, h) => {
        fitText(c, 'AONAMI', 0, 0, w, h, { colour: '#f2f4f6', size: h * 0.95 });
        wear(c, w, h, 91, 0.3);
    });
    decals.define('ship-name', 448, 56, (c, w, h) => {
        fitText(c, 'AONAMI HIKARI', 0, 0, w, h, { font: '700 {s}px "Arial", sans-serif', colour: '#f2f4f6', size: h * 0.9 });
    });
    const side = SHIP.zc - SHIP.half - 0.06;
    // the hull is straight there: one quad facing the quay (text runs towards −x as seen from the quay)
    decals.wall('hull-aonami', { x: -5, y: 3.2, z: side }, { x: -1, z: 0 }, 36, 6.75);
    // the bow curves: the name in vertical strips that follow the hull
    const strips = 10;
    const x0 = 100;
    const x1 = 88;
    const y0 = 5.2;
    const y1 = 6.6;
    for (let k = 0; k < strips; k++) {
        const xa = x0 + ((x1 - x0) * k) / strips;
        const xb = x0 + ((x1 - x0) * (k + 1)) / strips;
        const corner = (x, y) => {
            const h = (y - SHIP.bottom) / (SHIP.deck - SHIP.bottom);
            // find the station of x at that height (the stem rakes)
            let t = (x - SHIP.stern) / (SHIP.bow - SHIP.stern);
            for (let i = 0; i < 4; i++) t += (x - stationX(t, h)) / (SHIP.bow - SHIP.stern);
            return [x, y, SHIP.zc - halfBreadth(t, h) - 0.07];
        };
        decals.quad('ship-name', [corner(xa, y0), corner(xb, y0), corner(xb, y1), corner(xa, y1)], [0, 0, -1], 0xffffff, [k / strips, 0, (k + 1) / strips, 1]);
    }
}
