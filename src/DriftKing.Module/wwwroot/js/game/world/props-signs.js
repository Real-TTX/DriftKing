// DriftKing · world/props-signs.js – neon signs: two atlases (wide signs with words, tall blade signs with invented glyphs), drawn as glass
// tubes (a white-hot core in a saturated colour) or as backlit boxes, on a near-black ground. Each sign is a dark metal box with the face on
// both sides; the faces are emissive (HDR, they bloom on medium/high), the box catches the light of the street. Three draw calls for all
// signs of a map (boxes, wide faces, tall faces), optional real light spill (options.lights) for the street in front of them.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, mergeGeometries, rng } from '../render/kit.js';
import { LIGHT_PRESETS } from '../render/lights.js';
import { settings } from '../settings.js';
import { isPbr, materialsOf } from './props-common.js';

export const NEON_COLOURS = [0xff2e88, 0x29e7ff, 0x8b5cf6, 0xffb020, 0x3ef08a, 0xff4040, 0xff7af0, 0x7affd7];

/** Plain words (German or used in German) and invented glyphs only. */
const SIGN_WORDS = ['RAMEN', 'BAR 24', 'KARAOKE', 'GARAGE', 'HOTEL', 'SUSHI', 'SPIELHALLE', 'TUNING'];

const hexColour = k => '#' + NEON_COLOURS[k % NEON_COLOURS.length].toString(16).padStart(6, '0');

/** The colour of a cell (the glow and the light use it): wide row r → NEON_COLOURS[r × 3 + 1], tall column c → NEON_COLOURS[c × 2]. */
function cellColour(kind, cell) {
    return NEON_COLOURS[(kind === 'wide' ? cell * 3 + 1 : cell * 2) % NEON_COLOURS.length];
}

/** Strokes the current path as a neon tube: a soft coloured halo, the coloured glass, a white-hot core. */
function tube(ctx, colour, width) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = colour;
    ctx.shadowBlur = width * 1.6;
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = width * 1.9;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, width * 0.35);
    ctx.stroke();
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** The dark ground of a sign: matt black with a faint frame (the metal edge of the box face). */
function ground(ctx, x, y, w, h) {
    ctx.fillStyle = '#060509';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#17151d';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

/**
 * The two sign atlases: wide signs (4 rows of 4:1 words) and tall signs (4 columns of glyph stacks). Rows/columns alternate between neon
 * tubes and backlit boxes. The textures belong to the caller's world (disposed with it).
 * options.size: the edge of each atlas in pixels (default 1024 on high, 512 below).
 */
export function signAtlases(seed = 5, options = {}) {
    const random = rng(seed);
    const size = options.size ?? (settings.get().quality === 'high' ? 1024 : 512);
    const wide = canvasTexture(size, size, ctx => {
        ctx.scale(size / 1024, size / 1024);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1024, 1024);
        for (let row = 0; row < 4; row++) {
            const c = hexColour(row * 3 + 1);
            const y = row * 256;
            const word = SIGN_WORDS[(row * 2 + Math.floor(random() * 2)) % SIGN_WORDS.length];
            ground(ctx, 0, y, 1024, 256);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${word.length > 8 ? 112 : 136}px Anton, Impact, sans-serif`;
            if (row % 2 === 0) {
                // neon: a tube frame and the letters as tube outlines
                roundRect(ctx, 26, y + 24, 972, 208, 30);
                tube(ctx, c, 7);
                ctx.save();
                ctx.lineJoin = 'round';
                ctx.shadowColor = c;
                ctx.shadowBlur = 10;
                ctx.strokeStyle = c;
                ctx.lineWidth = 9;
                ctx.strokeText(word, 512, y + 134);
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(255,255,255,0.92)';
                ctx.lineWidth = 3.2;
                ctx.strokeText(word, 512, y + 134);
                ctx.restore();
            } else {
                // a backlit box: an even coloured face, dark letters cut out, a bright rim
                const g = ctx.createLinearGradient(0, y + 20, 0, y + 236);
                g.addColorStop(0, c);
                g.addColorStop(0.5, '#ffffff');
                g.addColorStop(1, c);
                ctx.globalAlpha = 0.75;
                ctx.fillStyle = g;
                roundRect(ctx, 20, y + 20, 984, 216, 18);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = c;
                ctx.globalAlpha = 0.55;
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#0b0910';
                ctx.fillText(word, 512, y + 134);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 4;
                roundRect(ctx, 20, y + 20, 984, 216, 18);
                ctx.stroke();
            }
        }
    });
    const tall = canvasTexture(size, size, ctx => {
        ctx.scale(size / 1024, size / 1024);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1024, 1024);
        for (let col = 0; col < 4; col++) {
            const c = hexColour(col * 2);
            const x = col * 256;
            ground(ctx, x, 0, 256, 1024);
            if (col % 2 === 0) {
                roundRect(ctx, x + 22, 18, 212, 988, 24);
                tube(ctx, c, 6);
                ctx.save();
                ctx.strokeStyle = c;
                ctx.shadowColor = c;
                ctx.shadowBlur = 8;
                ctx.lineWidth = 12;
                for (let k = 0; k < 5; k++) drawGlyph(ctx, random, x + 58, 60 + k * 186, 140);
                ctx.restore();
                ctx.save();
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 4;
                const again = rng(seed * 31 + col);
                for (let k = 0; k < 5; k++) drawGlyph(ctx, again, x + 58, 60 + k * 186, 140);
                ctx.restore();
            } else {
                ctx.fillStyle = c;
                ctx.globalAlpha = 0.85;
                roundRect(ctx, x + 16, 14, 224, 996, 14);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#0b0910';
                ctx.lineWidth = 16;
                for (let k = 0; k < 5; k++) drawGlyph(ctx, random, x + 58, 60 + k * 186, 140);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 4;
                roundRect(ctx, x + 16, 14, 224, 996, 14);
                ctx.stroke();
            }
        }
    });
    return { wide, tall };
}

/**
 * Collects neon signs and builds them (boxes, wide faces, tall faces: three meshes).
 * add(kind 'wide'|'tall', cell 0..3, centre x/y/z, size w × h, yaw of its face) – the colour of the cell is NEON_COLOURS of the atlas.
 * options: materials (the factory), lights (the light rig: every sign lights the street in front of it as a 'neon' pool source),
 * intensity (of the faces, default 3.2 on medium/high).
 */
export class Signs {
    constructor(glows, options = {}) {
        this.glows = glows;
        this.options = options;
        this.lists = { wide: [], tall: [] };
        this.boxes = [];
    }

    add(kind, cell, x, y, z, w, h, yaw) {
        // a wide sign hangs on a wall (its box behind the face), a tall blade sticks out (the box centred, a face on both sides)
        const depth = kind === 'wide' ? 0.2 : 0.3;
        const nx = Math.sin(yaw);
        const nz = Math.cos(yaw);
        const centre = kind === 'wide' ? -depth / 2 : 0;
        const box = new THREE.BoxGeometry(w + 0.1, h + 0.1, depth).translate(0, 0, centre).rotateY(yaw).translate(x, y, z);
        this.boxes.push(box);
        for (const side of [1, -1]) {
            const g = new THREE.PlaneGeometry(w, h);
            const uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                // the back face is mirrored in u, so it reads the right way round from behind
                const u = side > 0 ? uv.getX(i) : 1 - uv.getX(i);
                if (kind === 'wide') uv.setXY(i, u, (3 - cell + uv.getY(i)) / 4);
                else uv.setXY(i, (cell + u) / 4, uv.getY(i));
            }
            const offset = side > 0 ? centre + depth / 2 + 0.004 : centre - depth / 2 - 0.004;
            if (side < 0) g.rotateY(Math.PI);
            g.translate(0, 0, offset).rotateY(yaw).translate(x, y, z);
            this.lists[kind].push(g);
        }
        const colour = cellColour(kind, cell);
        const fx = nx * 0.6;
        const fz = nz * 0.6;
        this.glows?.add(x + fx, y, z + fz, Math.max(w, h) * 1.4, colour);
        if (this.options.lights) {
            const area = Math.min(2, Math.max(0.5, (w * h) / 8));
            this.options.lights.add({ ...LIGHT_PRESETS.neon, color: colour, intensity: LIGHT_PRESETS.neon.intensity * area, x: x + nx * 0.8, y, z: z + nz * 0.8, dir: { x: nx, y: -0.45, z: nz }, priority: 0.85 });
        }
    }

    build(root, atlases) {
        const mats = materialsOf(this.options);
        const intensity = this.options.intensity ?? (isPbr(mats) ? 3.2 : 1);
        const group = new THREE.Group();
        group.name = 'signs';
        if (this.boxes.length) {
            const boxes = new THREE.Mesh(mergeGeometries(this.boxes), mats.painted({ color: 0x1c1c22, roughness: 0.42 }));
            boxes.receiveShadow = true;
            group.add(boxes);
        }
        for (const kind of ['wide', 'tall']) {
            if (this.lists[kind].length === 0) continue;
            atlases[kind].anisotropy = 8;
            group.add(new THREE.Mesh(mergeGeometries(this.lists[kind]), mats.emissive(0xffffff, intensity, { map: atlases[kind] })));
        }
        root.add(group);
    }
}
