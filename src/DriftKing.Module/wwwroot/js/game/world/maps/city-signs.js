// DriftKing · maps/city-signs.js – the signs of the Neon-Viertel: one canvas atlas (backlit acrylic panels with invented glyphs, neon words
// in tubes on dark backings, shop fascias, rooftop billboards, vending-machine fronts, stand signs) and a builder that places the faces
// (one unlit mesh: the atlas × an HDR gain, so tubes burn at 5–6 and acrylic faces at 2–3 and bloom), their housings and brackets (the props
// batch), glow points for low, real light for the big ones near the road and reflection sources for the wet street.
// Words are German or neutral; every glyph is invented (kit.drawGlyph); nothing copies a real brand.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, rng } from '../../render/kit.js';
import { LIGHT_PRESETS } from '../../render/lights.js';

/** Neon colours of the district (sRGB). */
export const NEON = [0xff2e88, 0x29e7ff, 0x8b5cf6, 0xffb020, 0x3ef08a, 0xff3030, 0xff7af0, 0x7affd7];

const NEON_WORDS = ['BAR', 'KARAOKE', 'HOTEL', 'RAMEN', 'NACHTCAFÉ', 'SPIELHALLE', 'TANZBAR', 'IMBISS'];
const FASCIA_WORDS = ['KIOSK', 'NUDELN', 'SUSHI', 'GRILL', 'BÄCKEREI', 'APOTHEKE', 'WÄSCHEREI', 'TABAK', 'CAFÉ', 'BLUMEN'];
const PANEL_WORDS = ['BAR', 'CAFÉ', 'KARAOKE', 'SAKE', 'BILLARD', 'KINO'];
const STAND_WORDS = ['OFFEN', 'BAR', 'HEUTE', '24 H'];
const ACRYLIC = ['#f4f1e6', '#f5d000', '#e8402a', '#2a62d8', '#121218', '#1fa35a', '#f07a1a', '#e83c8c', '#f4f1e6', '#8a3cd8'];
const FONT = 'Anton, Impact, "Arial Narrow", sans-serif';

/** The atlas layout in px at 1024 × 2048 (low draws it at half size): section → { x, y, w, h, columns, count }. */
const LAYOUT = {
    panel: { x: 0, y: 0, w: 128, h: 128, columns: 8, count: 32 },
    neon: { x: 0, y: 512, w: 512, h: 128, columns: 2, count: 8 },
    fascia: { x: 0, y: 1024, w: 512, h: 96, columns: 2, count: 10 },
    billboard: { x: 0, y: 1504, w: 512, h: 256, columns: 2, count: 2 },
    vending: { x: 0, y: 1760, w: 128, h: 224, columns: 4, count: 4 },
    stand: { x: 512, y: 1760, w: 128, h: 224, columns: 4, count: 4 },
};

/** The UV rectangle [u0, v0, u1, v1] of a cell (v up). */
function cellUv(section, index) {
    const l = LAYOUT[section];
    const k = index % l.count;
    const x = l.x + (k % l.columns) * l.w;
    const y = l.y + Math.floor(k / l.columns) * l.h;
    const inset = 1.5;
    return [(x + inset) / 1024, 1 - (y + l.h - inset) / 2048, (x + l.w - inset) / 1024, 1 - (y + inset) / 2048];
}

const PANEL_DARK = '#121218';
const FASCIA_BACKGROUNDS = ['#f4f1e6', '#1d2a6a', '#b0201c', '#f5d000', '#0e5a3a', '#f4f1e6', '#202024', '#e86a1a', '#f4f1e6', '#5a1a6a'];
const STAND_BACKGROUNDS = ['#f4f1e6', '#f5d000', '#121218', '#e83c8c'];
const css = c => parseInt(c.slice(1), 16);

/** The colour (sRGB hex) a cell glows in – for glow points, reflections and light; known without drawing the atlas. */
const cellColours = {
    panel: Array.from({ length: LAYOUT.panel.count }, (_, k) => (ACRYLIC[k % ACRYLIC.length] === PANEL_DARK ? NEON[k % NEON.length] : css(ACRYLIC[k % ACRYLIC.length]))),
    neon: Array.from({ length: LAYOUT.neon.count }, (_, k) => NEON[(k * 3 + 1) % NEON.length]),
    fascia: Array.from({ length: LAYOUT.fascia.count }, (_, k) => (['#f4f1e6', '#f5d000'].includes(FASCIA_BACKGROUNDS[k]) ? 0xf4ead0 : css(FASCIA_BACKGROUNDS[k]))),
    billboard: [0xc04aa0, 0xf08a40],
    vending: [0xe8f0ff, 0xe8f0ff, 0xe8f0ff, 0xe8f0ff],
    stand: Array.from({ length: LAYOUT.stand.count }, (_, k) => (STAND_BACKGROUNDS[k] === PANEL_DARK ? NEON[1] : css(STAND_BACKGROUNDS[k]))),
};

/** Draws the atlas (deterministic: seeded). half = low quality (512 × 1024). */
function drawAtlas(half) {
    const scale = half ? 0.5 : 1;
    const random = rng(4711);
    return canvasTexture(1024 * scale, 2048 * scale, ctx => {
        ctx.scale(scale, scale);
        ctx.fillStyle = '#050508';
        ctx.fillRect(0, 0, 1024, 2048);
        const cell = (section, k) => {
            const l = LAYOUT[section];
            return { x: l.x + (k % l.columns) * l.w, y: l.y + Math.floor(k / l.columns) * l.h, w: l.w, h: l.h };
        };
        for (let k = 0; k < LAYOUT.panel.count; k++) drawPanel(ctx, random, cell('panel', k), k);
        for (let k = 0; k < LAYOUT.neon.count; k++) drawNeonWord(ctx, random, cell('neon', k), k);
        for (let k = 0; k < LAYOUT.fascia.count; k++) drawFascia(ctx, random, cell('fascia', k), k);
        for (let k = 0; k < LAYOUT.billboard.count; k++) drawBillboard(ctx, random, cell('billboard', k), k);
        for (let k = 0; k < LAYOUT.vending.count; k++) drawVending(ctx, random, cell('vending', k), k);
        for (let k = 0; k < LAYOUT.stand.count; k++) drawStand(ctx, random, cell('stand', k), k);
    });
}

const hex = n => '#' + n.toString(16).padStart(6, '0');

/** A backlit acrylic panel of a sign tower: a coloured face with an invented glyph pair, a floor number or a short word. */
function drawPanel(ctx, random, c, k) {
    const background = ACRYLIC[k % ACRYLIC.length];
    const dark = background === PANEL_DARK;
    // the face is drawn a little below full white: × the sign gain it lands at 2–3 (a lit face), the tubes of the dark ones at 5–6
    const pale = ['#f4f1e6', '#f5d000'].includes(background);
    ctx.fillStyle = dark ? '#0c0c12' : shade(background, pale ? 0.6 : 0.78);
    ctx.fillRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
    const ink = dark ? hex(NEON[k % NEON.length]) : (['#f5d000', '#f4f1e6', '#f07a1a'].includes(background) ? '#16141c' : '#f4f1e6');
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    if (dark) {
        ctx.shadowColor = ink;
        ctx.shadowBlur = 10;
    }
    const kind = k % 4;
    if (kind === 0 || kind === 3) {
        ctx.lineWidth = dark ? 7 : 9;
        drawGlyph(ctx, random, c.x + 18, c.y + 12, 46);
        drawGlyph(ctx, random, c.x + 64, c.y + 66, 46);
        if (kind === 3) drawGlyph(ctx, random, c.x + 64, c.y + 12, 46);
    } else if (kind === 1) {
        ctx.font = `bold 58px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${2 + (k % 7)}F`, c.x + 40, c.y + 66);
        ctx.lineWidth = 8;
        drawGlyph(ctx, random, c.x + 76, c.y + 30, 44);
    } else {
        ctx.font = `bold 34px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PANEL_WORDS[k % PANEL_WORDS.length], c.x + 64, c.y + 88);
        ctx.lineWidth = 7;
        drawGlyph(ctx, random, c.x + 40, c.y + 10, 46);
    }
    ctx.shadowBlur = 0;
    // the aluminium edge of the panel
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
}

/** A neon word: glass tubes on a black backing – a wide coloured glow, the tube in full colour and a pale core. */
function drawNeonWord(ctx, random, c, k) {
    const colour = NEON[(k * 3 + 1) % NEON.length];
    const tube = hex(colour);
    ctx.fillStyle = '#08070c';
    roundRect(ctx, c.x + 4, c.y + 6, c.w - 8, c.h - 12, 14);
    ctx.fill();
    const word = NEON_WORDS[k % NEON_WORDS.length];
    ctx.font = `${k % 2 ? 'italic ' : ''}bold ${word.length > 7 ? 62 : 78}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = c.x + c.w / 2;
    const y = c.y + c.h / 2 + 3;
    ctx.lineJoin = 'round';
    ctx.shadowColor = tube;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = shade(tube, 0.55);
    ctx.lineWidth = 9;
    ctx.strokeText(word, x, y);
    ctx.shadowBlur = 6;
    ctx.strokeStyle = tube;
    ctx.lineWidth = 5;
    ctx.strokeText(word, x, y);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = mixWhite(tube, 0.6);
    ctx.lineWidth = 1.6;
    ctx.strokeText(word, x, y);
    // an outline tube around the word on some signs
    if (k % 3 !== 2) {
        const second = hex(NEON[(k * 3 + 4) % NEON.length]);
        ctx.shadowColor = second;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = second;
        ctx.lineWidth = 4;
        roundRect(ctx, c.x + 14, c.y + 14, c.w - 28, c.h - 28, 18);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = mixWhite(second, 0.5);
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }
}

/** A shop fascia: a backlit sign board with the shop's word and an invented glyph, a coloured band. */
function drawFascia(ctx, random, c, k) {
    const background = FASCIA_BACKGROUNDS[k % FASCIA_BACKGROUNDS.length];
    const lightFace = ['#f4f1e6', '#f5d000'].includes(background);
    ctx.fillStyle = shade(background, lightFace ? 0.6 : 0.74);
    ctx.fillRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6);
    const band = hex(NEON[(k * 5 + 2) % NEON.length]);
    ctx.fillStyle = shade(band, 0.8);
    ctx.fillRect(c.x + 3, c.y + c.h - 16, c.w - 6, 10);
    ctx.fillStyle = lightFace ? '#1a1820' : '#f2efe6';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.font = `bold 54px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(FASCIA_WORDS[k % FASCIA_WORDS.length], c.x + 96, c.y + c.h / 2 - 4);
    ctx.lineWidth = 7;
    drawGlyph(ctx, random, c.x + 22, c.y + 14, 58);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 5;
    ctx.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6);
}

/** A rooftop billboard: a gradient, big invented glyphs, a round emblem and a short German line. */
function drawBillboard(ctx, random, c, k) {
    const g = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
    const a = k === 0 ? '#2a1a6a' : '#6a1030';
    const b = k === 0 ? '#c02a8a' : '#f08a20';
    g.addColorStop(0, shade(a, 0.8));
    g.addColorStop(1, shade(b, 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(c.x + c.w * 0.78, c.y + c.h * 0.48, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = k === 0 ? '#3a1a7a' : '#7a1a20';
    ctx.font = `bold 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(k === 0 ? 'NEU' : '24 H', c.x + c.w * 0.78, c.y + c.h * 0.48);
    ctx.strokeStyle = '#f6f2ea';
    ctx.lineWidth = 11;
    for (let i = 0; i < 3; i++) drawGlyph(ctx, random, c.x + 26 + i * 96, c.y + 30, 84);
    ctx.fillStyle = '#f6f2ea';
    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(k === 0 ? 'NACHTMARKT' : 'HEISS & FRISCH', c.x + 28, c.y + c.h - 44);
}

/** A vending machine front: a lit display of drinks in four rows, the dark slot area below, a coloured top band. */
function drawVending(ctx, random, c, k) {
    const body = ['#e8e6e0', '#c8202a', '#2050b0', '#f0f0ea'][k];
    ctx.fillStyle = shade(body, 0.55);
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(c.x + 8, c.y + 14, c.w - 16, 118);
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 6; col++) {
            const x = c.x + 12 + col * 17.5;
            const y = c.y + 20 + row * 28;
            const colour = ['#c8202a', '#2a8a3a', '#f0a020', '#1a4ab0', '#e8e8e8', '#6a3a1a', '#d040a0'][Math.floor(random() * 7)];
            ctx.fillStyle = colour;
            ctx.fillRect(x, y + 4, 12, 18);
            ctx.fillStyle = '#c8c8c8';
            ctx.fillRect(x + 3, y, 6, 4);
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(x, y + 23, 12, 3);
        }
    }
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(c.x + 10, c.y + 142, c.w - 20, 30);
    ctx.fillRect(c.x + 18, c.y + 188, c.w - 36, 22);
    ctx.fillStyle = '#3ef08a';
    ctx.fillRect(c.x + c.w - 30, c.y + 148, 12, 6);
}

/** A small stand sign on the pavement: a lit face with a word and a glyph. */
function drawStand(ctx, random, c, k) {
    const background = STAND_BACKGROUNDS[k];
    ctx.fillStyle = shade(background, 0.75);
    ctx.fillRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
    const ink = background === PANEL_DARK ? hex(NEON[1]) : '#16141c';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.font = `bold 36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STAND_WORDS[k], c.x + c.w / 2, c.y + 46);
    ctx.lineWidth = 7;
    drawGlyph(ctx, random, c.x + 30, c.y + 84, 68);
    drawGlyph(ctx, random, c.x + 30, c.y + 150, 56);
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

function shade(css, f) {
    const n = parseInt(css.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return `rgb(${r},${g},${b})`;
}

function mixWhite(css, f) {
    const n = parseInt(css.slice(1), 16);
    const m = c => Math.round(c + (255 - c) * f);
    return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

/** The HDR gain of the sign material: an atlas texel of 1.0 (a tube core) burns at this value. */
const SIGN_GAIN = 5.5;

/**
 * Places the district's signs. Faces go into one mesh (atlas × SIGN_GAIN × vertex brightness), housings into the props batch.
 * Every placement takes a Frame (city-kit.js) of the building it hangs on: local +z out of the facade, local x along it.
 */
export class CitySigns {
    /**
     * @param {object} ctx the map context
     * @param {{ props: import('./city-kit.js').Batch, reflect: (x:number, z:number, y:number, hex:number, width:number, strength:number) => void }} o
     */
    constructor(ctx, { props, reflect }) {
        this.ctx = ctx;
        this.props = props;
        this.reflect = reflect;
        this.random = ctx.random;
        this.positions = [];
        this.uvs = [];
        this.colours = [];
        this.indices = [];
        this.count = 0;
        this.lightBudget = 0;
    }

    /** A face: centre (local lx, y, lz), size w × h, facing local yaw (0 = out of the facade), a cell of a section, brightness. */
    face(frame, lx, y, lz, w, h, yaw, section, index, brightness = 1) {
        const [u0, v0, u1, v1] = cellUv(section, index);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        // local corners of a plane facing +z turned by yaw (x along the face)
        const corners = [[-w / 2, -h / 2, u0, v0], [w / 2, -h / 2, u1, v0], [w / 2, h / 2, u1, v1], [-w / 2, h / 2, u0, v1]];
        const base = this.count;
        for (const [cx, cy, u, v] of corners) {
            const p = frame.p(lx + cx * c, y + cy, lz - cx * s);
            this.positions.push(p.x, p.y, p.z);
            this.uvs.push(u, v);
            this.colours.push(brightness, brightness, brightness);
            this.count++;
        }
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** The world point and outward direction of a local point on a frame. */
    worldOf(frame, lx, y, lz) {
        return frame.p(lx, y, lz);
    }

    /** A real light for a sign near the road (the rig gives the nearest ones a pool light). */
    light(frame, lx, y, lz, colour, { near = true, intensity = 1 } = {}) {
        if (!near) return;
        const p = frame.p(lx, y, lz);
        const out = frame.p(lx, y, lz + 1);
        this.ctx.lights.add({ ...LIGHT_PRESETS.neon, x: p.x, y: p.y, z: p.z, color: colour, intensity: LIGHT_PRESETS.neon.intensity * intensity,
            dir: { x: out.x - p.x, y: -0.7, z: out.z - p.z }, priority: 0.85 });
    }

    /**
     * A sign tower: a narrow box sticking out of the facade at local x, from y0 up, one acrylic panel per floor on both of its sides
     * (readable along the street). Returns its height.
     */
    tower(frame, lx, y0, floors, { panel = 1.05, width = 1.0, out = 0.25, near = true } = {}) {
        const random = this.random;
        const height = floors * panel;
        const depth = 0.32;
        const lz = out + width / 2;
        frame.box(this.props, depth, height + 0.16, width + 0.08, lx, y0 + height / 2, lz, 0x2a2a30, { rough: 0.5, metal: 0.4 });
        // brackets to the wall
        for (const y of [y0 + 0.3, y0 + height - 0.3]) frame.box(this.props, 0.08, 0.08, out + 0.05, lx, y, out / 2, 0x3a3a40, { rough: 0.5, metal: 0.6 });
        let colour = 0xffffff;
        for (let k = 0; k < floors; k++) {
            const cell = Math.floor(random() * LAYOUT.panel.count);
            const y = y0 + panel * (k + 0.5);
            const b = 0.7 + random() * 0.35;
            this.face(frame, lx + depth / 2 + 0.006, y, lz, width, panel - 0.06, Math.PI / 2, 'panel', cell, b);
            this.face(frame, lx - depth / 2 - 0.006, y, lz, width, panel - 0.06, -Math.PI / 2, 'panel', (cell + 5) % LAYOUT.panel.count, b);
            colour = cellColours.panel[cell] ?? colour;
        }
        const top = frame.p(lx, y0 + height / 2, lz);
        this.ctx.glows.add(top.x, top.y, top.z, Math.max(2.5, height * 0.5), colour);
        const foot = frame.p(lx, 0, lz + 0.5);
        this.reflect(foot.x, foot.z, y0 + height * 0.4, colour, width * 1.1, 0.8);
        if (near) this.light(frame, lx, y0 + 1.5, lz + 0.6, colour, { intensity: 0.8 });
        return height;
    }

    /** A neon word on a dark backing flat on the facade (centre lx, y), width w. */
    neon(frame, lx, y, w, { near = true } = {}) {
        const cell = Math.floor(this.random() * LAYOUT.neon.count);
        const h = w / 4;
        frame.box(this.props, w + 0.1, h + 0.1, 0.12, lx, y, 0.08, 0x141418, { rough: 0.6, metal: 0.2 });
        this.face(frame, lx, y, 0.145, w, h, 0, 'neon', cell, 1);
        const colour = cellColours.neon[cell];
        const p = frame.p(lx, y, 0.6);
        this.ctx.glows.add(p.x, p.y, p.z, w * 0.9, colour);
        const foot = frame.p(lx, 0, 0.6);
        this.reflect(foot.x, foot.z, y, colour, w * 0.8, 1);
        this.light(frame, lx, y - h, 0.8, colour, { near, intensity: 1.1 });
    }

    /** A tall neon column (one glyph stack) sticking out at the corner: a panel stack with dark panels only. */
    blade(frame, lx, y, { near = true } = {}) {
        const cell = Math.floor(this.random() * LAYOUT.panel.count);
        const lz = 0.2 + 0.35;
        frame.box(this.props, 0.16, 0.95, 0.75, lx, y, lz, 0x26262c, { rough: 0.5, metal: 0.4 });
        frame.box(this.props, 0.06, 0.06, 0.25, lx, y + 0.35, 0.1, 0x3a3a40, { rough: 0.5, metal: 0.6 });
        this.face(frame, lx + 0.086, y, lz, 0.7, 0.88, Math.PI / 2, 'panel', cell, 0.9);
        this.face(frame, lx - 0.086, y, lz, 0.7, 0.88, -Math.PI / 2, 'panel', cell, 0.9);
        const p = frame.p(lx, y, lz);
        this.ctx.glows.add(p.x, p.y, p.z, 1.2, cellColours.panel[cell] ?? 0xffffff);
        void near;
    }

    /** A shop fascia from local xa to xb, between y0 and y1, lit or (closed shops) dark. Returns its colour. */
    fascia(frame, xa, xb, y0, y1, { lit = true } = {}) {
        // never the same sign as the shop next door
        let cell = Math.floor(this.random() * LAYOUT.fascia.count);
        if (cell === this.lastFascia) cell = (cell + 1 + Math.floor(this.random() * (LAYOUT.fascia.count - 1))) % LAYOUT.fascia.count;
        this.lastFascia = cell;
        const w = xb - xa;
        const h = y1 - y0;
        frame.box(this.props, w + 0.06, h + 0.06, 0.2, (xa + xb) / 2, (y0 + y1) / 2, 0.1, 0x202024, { rough: 0.5, metal: 0.3 });
        this.face(frame, (xa + xb) / 2, (y0 + y1) / 2, 0.205, w, h, 0, 'fascia', cell, lit ? 0.85 + this.random() * 0.3 : 0.06);
        const colour = cellColours.fascia[cell];
        if (lit) {
            const foot = frame.p((xa + xb) / 2, 0, 0.4);
            this.reflect(foot.x, foot.z, (y0 + y1) / 2, colour, w * 0.7, 0.6);
        }
        return colour;
    }

    /** A rooftop billboard on a steel frame, facing out of the facade, standing on y. */
    billboard(frame, lx, y, w, lz = -1) {
        const cell = Math.floor(this.random() * LAYOUT.billboard.count);
        const h = w / 2;
        const lift = 1.6;
        for (const x of [-w * 0.4, 0, w * 0.4]) {
            frame.box(this.props, 0.14, lift + h, 0.14, lx + x, y + (lift + h) / 2, lz - 0.4, 0x3a3c42, { rough: 0.55, metal: 0.7 });
            frame.rod(this.props, [lx + x, y, lz - 1.6], [lx + x, y + lift + h * 0.7, lz - 0.45], 0.05, 0x3a3c42, { rough: 0.55, metal: 0.7 });
        }
        frame.box(this.props, w + 0.2, h + 0.2, 0.25, lx, y + lift + h / 2, lz - 0.15, 0x1a1a20, { rough: 0.6, metal: 0.3 });
        this.face(frame, lx, y + lift + h / 2, lz - 0.02, w, h, 0, 'billboard', cell, 0.75);
        const p = frame.p(lx, y + lift + h / 2, lz + 1);
        this.ctx.glows.add(p.x, p.y, p.z, w * 0.6, cellColours.billboard[cell]);
    }

    /** A vending machine's lit front (the body is the caller's). */
    vending(frame, lx, lz, kind) {
        this.face(frame, lx, 1.12, lz, 0.9, 1.58, 0, 'vending', kind, 0.62);
    }

    /** A stand sign on the pavement (both faces). */
    stand(frame, lx, lz) {
        const cell = Math.floor(this.random() * LAYOUT.stand.count);
        frame.box(this.props, 0.5, 0.9, 0.12, lx, 0.15 + 0.62, lz, 0x202024, { rough: 0.5, metal: 0.2 });
        frame.box(this.props, 0.36, 0.1, 0.36, lx, 0.15 + 0.05, lz, 0x202024, { rough: 0.5, metal: 0.2 });
        this.face(frame, lx, 0.15 + 0.66, lz + 0.065, 0.44, 0.76, 0, 'stand', cell, 0.6);
        this.face(frame, lx, 0.15 + 0.66, lz - 0.065, 0.44, 0.76, Math.PI, 'stand', cell, 0.6);
        return cellColours.stand[cell];
    }

    /** Builds the face mesh and adds it to root. */
    build(root) {
        if (this.count === 0) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
        geometry.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
        geometry.computeBoundingSphere();
        const atlas = drawAtlas(this.ctx.quality === 'low');
        atlas.anisotropy = 8;
        const material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, color: new THREE.Color(SIGN_GAIN, SIGN_GAIN, SIGN_GAIN) });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'signs';
        root.add(mesh);
        return mesh;
    }
}

