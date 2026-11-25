// DriftKing · maps/harbor-decals.js – everything painted in the harbour (Kaikō-Docks) in ONE texture and ONE draw call: the shipping lines'
// names and emblems on the containers, their owner codes, the ship's name, the hall signs, the yard's lines, slot frames, bay numbers,
// hatched zones, arrows and the rubber of the drifting cars. All names and emblems are invented.
//   const decals = new Decals(quality);
//   decals.define('aonami', 512, 128, (c, w, h) => { … });        // a cell of the atlas, drawn once (in atlas pixels of the 1024 layout)
//   decals.wall('aonami', centre, uAxis, width, height);          // a quad on a vertical face (text runs along uAxis, up is +y)
//   decals.ground('line', x, z, yaw, width, length, colour);       // a quad flat on the ground (length along yaw)
//   decals.build(root);                                           // packs and draws the atlas, one mesh
// Colours are multiplied (vertex colours): white cells take any paint colour, coloured cells (emblems) use white.

import * as THREE from 'three';
import { rng } from '../../render/kit.js';

const LAYOUT = 1024;
const PAD = 6;

/** The painted marks of the map in one atlas texture and one mesh. */
export class Decals {
    /** @param {string} quality low | medium | high (the atlas is 512² on low, 1024 wide above) */
    constructor(quality) {
        this.quality = quality;
        this.scale = quality === 'low' ? 0.5 : 1;
        this.cells = new Map();
        this.quads = [];
        defineCommon(this);
    }

    /**
     * Defines a cell of the atlas: w × h pixels of the 1024 layout; draw(ctx, w, h) paints it (the canvas is already scaled and clipped,
     * and the cell's background holds the alpha-0 ink colour so filtering does not bleed dark fringes).
     * @param {string} name
     * @param {number} w
     * @param {number} h
     * @param {(c: CanvasRenderingContext2D, w: number, h: number) => void} draw
     * @param {{ ink?: string }} [o] ink: the colour of the transparent background (the main colour of the cell)
     */
    define(name, w, h, draw, { ink = '#ffffff' } = {}) {
        if (!this.cells.has(name)) this.cells.set(name, { name, w, h, draw, ink, x: 0, y: 0 });
        return this;
    }

    /** True when the cell exists. */
    has(name) {
        return this.cells.has(name);
    }

    /**
     * A quad on a vertical face: centre {x, y, z}, uAxis {x, z} (the direction the text runs, horizontal), width × height metres.
     * The quad faces uAxis × up. sub: [u0, v0, u1, v1] a part of the cell (0..1).
     */
    wall(name, centre, uAxis, width, height, colour = 0xffffff, sub = null) {
        const ux = uAxis.x * width / 2;
        const uz = uAxis.z * width / 2;
        const hy = height / 2;
        this.quads.push({
            name, colour, sub,
            corners: [
                [centre.x - ux, centre.y - hy, centre.z - uz],
                [centre.x + ux, centre.y - hy, centre.z + uz],
                [centre.x + ux, centre.y + hy, centre.z + uz],
                [centre.x - ux, centre.y + hy, centre.z - uz],
            ],
            normal: [-uAxis.z, 0, uAxis.x],
        });
    }

    /**
     * A quad flat on the ground at (x, z), lift metres up: length along yaw (the direction (sin yaw, cos yaw)), width across.
     * The cell's v runs along the length (its top at the far end), u across (left to right seen from behind).
     */
    ground(name, x, z, yaw, width, length, colour = 0xffffff, { lift = 0.015, sub = null } = {}) {
        const fx = Math.sin(yaw) * length / 2;
        const fz = Math.cos(yaw) * length / 2;
        // right of the direction (seen from behind): (−cos yaw, sin yaw)
        const rx = -Math.cos(yaw) * width / 2;
        const rz = Math.sin(yaw) * width / 2;
        this.quads.push({
            name, colour, sub,
            corners: [
                [x - rx - fx, lift, z - rz - fz],
                [x + rx - fx, lift, z + rz - fz],
                [x + rx + fx, lift, z + rz + fz],
                [x - rx + fx, lift, z - rz + fz],
            ],
            normal: [0, 1, 0],
        });
    }

    /** A free quad: four corners [x, y, z] (counter-clockwise seen from the front: bottom-left, bottom-right, top-right, top-left) and its normal. */
    quad(name, corners, normal, colour = 0xffffff, sub = null) {
        this.quads.push({ name, colour, sub, corners, normal });
    }

    /** Packs the cells (shelves), draws the atlas, makes the mesh and adds it to root. Returns the mesh (null without quads). */
    build(root) {
        if (this.quads.length === 0) return null;
        const used = new Set(this.quads.map(q => q.name));
        const cells = [...this.cells.values()].filter(c => used.has(c.name)).sort((a, b) => b.h - a.h);
        let x = 0;
        let y = 0;
        let shelf = 0;
        for (const cell of cells) {
            if (x + cell.w + PAD * 2 > LAYOUT) {
                x = 0;
                y += shelf;
                shelf = 0;
            }
            cell.x = x + PAD;
            cell.y = y + PAD;
            x += cell.w + PAD * 2;
            shelf = Math.max(shelf, cell.h + PAD * 2);
        }
        const height = Math.pow(2, Math.ceil(Math.log2(Math.max(64, y + shelf))));
        const s = this.scale;
        const canvas = document.createElement('canvas');
        canvas.width = LAYOUT * s;
        canvas.height = height * s;
        const c = canvas.getContext('2d');
        for (const cell of cells) {
            c.save();
            c.scale(s, s);
            c.translate(cell.x, cell.y);
            // the transparent background carries the ink colour (alpha ~0), so mip filtering does not darken the edges
            c.fillStyle = hexAlpha(cell.ink, 1 / 255);
            c.fillRect(-PAD, -PAD, cell.w + PAD * 2, cell.h + PAD * 2);
            c.beginPath();
            c.rect(0, 0, cell.w, cell.h);
            c.clip();
            cell.draw(c, cell.w, cell.h);
            c.restore();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.quality === 'low' ? 4 : 8;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;

        const count = this.quads.length;
        const positions = new Float32Array(count * 12);
        const normals = new Float32Array(count * 12);
        const uvs = new Float32Array(count * 8);
        const colours = new Float32Array(count * 12);
        const index = count * 4 > 65535 ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
        const colour = new THREE.Color();
        const inset = 0.5;
        this.quads.forEach((q, k) => {
            const cell = this.cells.get(q.name);
            const [s0, t0, s1, t1] = q.sub ?? [0, 0, 1, 1];
            const u0 = (cell.x + inset + s0 * (cell.w - inset * 2)) / LAYOUT;
            const u1 = (cell.x + inset + s1 * (cell.w - inset * 2)) / LAYOUT;
            // canvas y runs down, texture v up (flipY): the cell's bottom edge is v0
            const vBottom = 1 - (cell.y + inset + (1 - t0) * (cell.h - inset * 2)) / height;
            const vTop = 1 - (cell.y + inset + (1 - t1) * (cell.h - inset * 2)) / height;
            const uv = [[u0, vBottom], [u1, vBottom], [u1, vTop], [u0, vTop]];
            colour.set(q.colour);
            for (let i = 0; i < 4; i++) {
                positions.set(q.corners[i], (k * 4 + i) * 3);
                normals.set(q.normal, (k * 4 + i) * 3);
                uvs.set(uv[i], (k * 4 + i) * 2);
                colours.set([colour.r, colour.g, colour.b], (k * 4 + i) * 3);
            }
            index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, decalMaterial(this.quality, texture));
        mesh.name = 'HarborDecals';
        mesh.renderOrder = 1;
        root.add(mesh);
        return mesh;
    }
}

/** The paint: lit like the surface below (Lambert on low, a dielectric MeshStandard above), blended, pulled towards the camera in depth. */
function decalMaterial(quality, map) {
    const options = {
        map,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -6,
    };
    return quality === 'low'
        ? new THREE.MeshLambertMaterial(options)
        : new THREE.MeshStandardMaterial({ ...options, roughness: 0.62, metalness: 0 });
}

function hexAlpha(hex, alpha) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

/** Erases small specks and scratches from what is drawn in the cell (worn paint); amount 0..1. */
export function wear(c, w, h, seed, amount = 0.35) {
    const random = rng(seed);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const specks = Math.round(w * h * 0.004 * amount);
    for (let k = 0; k < specks; k++) {
        c.fillStyle = `rgba(0,0,0,${0.3 + random() * 0.7})`;
        const r = 0.6 + random() * random() * 3.5;
        c.beginPath();
        c.arc(random() * w, random() * h, r, 0, Math.PI * 2);
        c.fill();
    }
    // a few long scratches (fewer on small cells)
    const scratches = Math.round((2 + amount * 6) * Math.min(1, (w * h) / 40000));
    for (let k = 0; k < scratches; k++) {
        c.strokeStyle = `rgba(0,0,0,${0.15 + random() * 0.35})`;
        c.lineWidth = 1 + random() * 3;
        c.beginPath();
        const x0 = random() * w;
        c.moveTo(x0, random() * h);
        c.lineTo(x0 + (random() - 0.5) * w * 0.5, random() * h);
        c.stroke();
    }
    c.restore();
}

/** Writes text into the box (x, y, w, h), squeezed horizontally when it is too wide. */
export function fitText(c, text, x, y, w, h, { font = '900 {s}px "Arial Black", "Arial", sans-serif', colour = '#ffffff', align = 'center', size = h * 0.86 } = {}) {
    c.save();
    c.font = font.replace('{s}', String(Math.round(size)));
    c.fillStyle = colour;
    c.textBaseline = 'middle';
    const width = c.measureText(text).width;
    const squeeze = Math.min(1, w / Math.max(1, width));
    const cx = align === 'left' ? x : align === 'right' ? x + w - width * squeeze : x + w / 2 - (width * squeeze) / 2;
    c.translate(cx, y + h / 2);
    c.scale(squeeze, 1);
    c.fillText(text, 0, 0);
    c.restore();
}

/** The cells every part of the map uses: line paint, digits and letters, hatching, arrows, tyre rubber. */
function defineCommon(decals) {
    // road paint: a worn white stripe (one cell = one dash / 6 m of line, v along)
    decals.define('line', 32, 256, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.fillRect(2, 0, w - 4, h);
        wear(c, w, h, 7, 0.9);
    });
    // digits and capital letters for slot numbers, block letters, hall numbers
    for (const ch of '0123456789ABCDEFGHJKLMN') {
        decals.define(`ch-${ch}`, 40, 56, (c, w, h) => {
            fitText(c, ch, 0, 0, w, h, { font: '700 {s}px "Arial", sans-serif', size: h * 1.02 });
            wear(c, w, h, ch.charCodeAt(0), 0.7);
        });
    }
    // yellow-black hatching (no-parking boxes around masts and crane legs), 1 cell = 2 × 2 m
    decals.define('hatch', 128, 128, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.lineWidth = 6;
        c.strokeStyle = '#ffffff';
        c.strokeRect(3, 3, w - 6, h - 6);
        c.save();
        c.beginPath();
        c.rect(0, 0, w, h);
        c.clip();
        for (let k = -h; k < w; k += 28) {
            c.beginPath();
            c.moveTo(k, h);
            c.lineTo(k + h, 0);
            c.lineWidth = 11;
            c.stroke();
        }
        c.restore();
        wear(c, w, h, 31, 0.8);
    });
    // a straight arrow (v up = forward)
    decals.define('arrow', 64, 192, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.moveTo(w / 2, 2);
        c.lineTo(w - 2, h * 0.32);
        c.lineTo(w * 0.66, h * 0.32);
        c.lineTo(w * 0.66, h - 2);
        c.lineTo(w * 0.34, h - 2);
        c.lineTo(w * 0.34, h * 0.32);
        c.lineTo(2, h * 0.32);
        c.closePath();
        c.fill();
        wear(c, w, h, 41, 0.8);
    });
    // tyre rubber: two streaky dark bands along v (the rear tyres of a drifting car); paint it dark
    decals.define('skid', 64, 256, (c, w, h) => {
        const random = rng(53);
        for (const centre of [0.2, 0.8]) {
            for (let k = 0; k < 14; k++) {
                const x = (centre + (random() - 0.5) * 0.16) * w;
                c.strokeStyle = `rgba(255,255,255,${0.05 + random() * 0.12})`;
                c.lineWidth = 1 + random() * 3;
                c.beginPath();
                c.moveTo(x, 0);
                c.lineTo(x + (random() - 0.5) * 3, h);
                c.stroke();
            }
            const g = c.createLinearGradient((centre - 0.13) * w, 0, (centre + 0.13) * w, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g;
            c.fillRect((centre - 0.13) * w, 0, 0.26 * w, h);
        }
    });
    // a soft dark stain (oil, rubber dust, wet patches under parked machines)
    decals.define('stain', 64, 64, (c, w, h) => {
        const random = rng(61);
        for (let k = 0; k < 9; k++) {
            const x = w * (0.3 + random() * 0.4);
            const y = h * (0.3 + random() * 0.4);
            const r = w * (0.12 + random() * 0.22);
            const g = c.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(255,255,255,0.2)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g;
            c.fillRect(0, 0, w, h);
        }
    });
}

/** Paints a string of the common characters (digits, capitals) as ground quads, centred at (x, z), reading along yaw's right. */
export function groundText(decals, text, x, z, yaw, height, colour, { spacing = 0.72, lift = 0.016 } = {}) {
    const chars = [...text];
    const width = height * spacing;
    // the text reads from left to right for a viewer standing behind it (looking along yaw)
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    chars.forEach((ch, k) => {
        if (ch === ' ' || !decals.has(`ch-${ch}`)) return;
        const offset = (k - (chars.length - 1) / 2) * width;
        decals.ground(`ch-${ch}`, x + rx * offset, z + rz * offset, yaw, width * 1.02, height, colour, { lift });
    });
}
