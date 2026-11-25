// DriftKing · scenes/garage-art.js – the printed and painted things of the garage, drawn once on canvases: the wall atlas (four posters,
// a dyno sheet, a calendar, safety signs, a banner), the pegboard with its tools, the neon sign, the lit office behind the window and the
// yellow/black floor stripes. Everything is invented (no real brands, no real cars); words are German. Deterministic (seeded).
// The textures belong to the garage scene (not shared): disposeTree frees them with the materials that use them.

import * as THREE from 'three';
import { canvasTexture, drawGlyph, rng } from '../render/kit.js';

const DISPLAY = 'Anton, Impact, "Arial Narrow Bold", "Arial Black", sans-serif';
const UI = 'Inter, "Segoe UI", Arial, sans-serif';

/**
 * Where each picture lies in the wall atlas (u0, v0, u1, v1 in 0..1, v up like three's UVs).
 * The atlas is 2 : 1 – four portrait posters on top, a strip of small things below.
 */
export const ATLAS = Object.freeze({
    touge: [0, 0.29, 0.25, 1],
    tyres: [0.25, 0.29, 0.5, 1],
    oil: [0.5, 0.29, 0.75, 1],
    glyphs: [0.75, 0.29, 1, 1],
    dyno: [0, 0, 0.3, 0.29],
    calendar: [0.3, 0, 0.45, 0.29],
    extinguisher: [0.45, 0.145, 0.52, 0.29],
    noSmoking: [0.45, 0, 0.52, 0.145],
    firstAid: [0.52, 0.145, 0.59, 0.29],
    voltage: [0.52, 0, 0.59, 0.145],
    banner: [0.59, 0.145, 1, 0.29],
    plate: [0.59, 0, 1, 0.145],
});

/**
 * The wall atlas: posters, the dyno sheet, the calendar, signs, the banner and a door plate on one texture (one material, one draw call).
 * @param {number} width 1024 (low/medium) or 2048 (high); the height is half of it
 */
export function wallAtlas(width) {
    const height = width / 2;
    const texture = canvasTexture(width, height, (c) => {
        c.fillStyle = '#20222a';
        c.fillRect(0, 0, width, height);
        const box = key => {
            const [u0, v0, u1, v1] = ATLAS[key];
            return { x: u0 * width, y: (1 - v1) * height, w: (u1 - u0) * width, h: (v1 - v0) * height };
        };
        const draw = (key, fn) => {
            const b = box(key);
            c.save();
            c.translate(b.x, b.y);
            c.beginPath();
            c.rect(0, 0, b.w, b.h);
            c.clip();
            fn(c, b.w, b.h);
            c.restore();
        };
        draw('touge', posterTouge);
        draw('tyres', posterTyres);
        draw('oil', posterOil);
        draw('glyphs', posterGlyphs);
        draw('dyno', dynoSheet);
        draw('calendar', calendar);
        draw('extinguisher', (c, w, h) => sign(c, w, h, '#c8161d', 'extinguisher'));
        draw('noSmoking', (c, w, h) => sign(c, w, h, '#ffffff', 'noSmoking'));
        draw('firstAid', (c, w, h) => sign(c, w, h, '#0f8a4a', 'firstAid'));
        draw('voltage', (c, w, h) => sign(c, w, h, '#f2c014', 'voltage'));
        draw('banner', banner);
        draw('plate', plate);
    });
    texture.anisotropy = 8;
    return texture;
}

/** Sets the UVs of a placed plane (PlaneGeometry: u left→right, v bottom→top) to a region of the atlas. */
export function atlasUVs(geometry, key) {
    const [u0, v0, u1, v1] = ATLAS[key];
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return geometry;
}

// ---------------------------------------------------------------- posters (portrait, ~1 : 1.41)

/** Paper: a faint warm tint, a little dirt at the edges, a folded crease. */
function paper(c, w, h) {
    const g = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(40,30,10,0.35)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, h * 0.5 - 1, w, 2);
    c.fillStyle = 'rgba(0,0,0,0.08)';
    c.fillRect(0, h * 0.5 + 1, w, 2);
}

function posterTouge(c, w, h) {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#060818');
    sky.addColorStop(0.55, '#1b1240');
    sky.addColorStop(0.75, '#4a1d4e');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    // the moon and mountain ridges
    c.fillStyle = '#f3ead2';
    c.beginPath();
    c.arc(w * 0.72, h * 0.2, w * 0.08, 0, Math.PI * 2);
    c.fill();
    const random = rng(7);
    for (const [y, colour] of [[0.5, '#2a1a4a'], [0.58, '#170f2e'], [0.66, '#0b0818']]) {
        c.fillStyle = colour;
        c.beginPath();
        c.moveTo(0, h);
        for (let x = 0; x <= 1.001; x += 0.05) c.lineTo(x * w, h * (y - Math.sin(x * 7 + y * 9) * 0.04 - random() * 0.03));
        c.lineTo(w, h);
        c.fill();
    }
    // a winding road with light trails
    c.lineCap = 'round';
    for (const [colour, width, shift] of [['rgba(255,46,136,0.9)', w * 0.012, 0], ['rgba(255,176,32,0.85)', w * 0.008, w * 0.02]]) {
        c.strokeStyle = colour;
        c.lineWidth = width;
        c.shadowColor = colour;
        c.shadowBlur = w * 0.03;
        c.beginPath();
        c.moveTo(w * 0.1 + shift, h * 0.98);
        c.bezierCurveTo(w * 0.95 + shift, h * 0.88, w * 0.05 + shift, h * 0.78, w * 0.75 + shift, h * 0.68);
        c.bezierCurveTo(w * 0.95, h * 0.64, w * 0.4, h * 0.6, w * 0.55, h * 0.57);
        c.stroke();
    }
    c.shadowBlur = 0;
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.font = `${Math.round(w * 0.2)}px ${DISPLAY}`;
    c.fillText('TOUGE', w / 2, h * 0.36);
    c.fillStyle = '#ff2e88';
    c.font = `${Math.round(w * 0.13)}px ${DISPLAY}`;
    c.fillText('NACHT', w / 2, h * 0.46);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.font = `600 ${Math.round(w * 0.045)}px ${UI}`;
    c.fillText('SAMSTAG · 23 UHR · PASSSTRASSE', w / 2, h * 0.08);
    paper(c, w, h);
}

function posterTyres(c, w, h) {
    c.fillStyle = '#d8d4cc';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c21d24';
    c.beginPath();
    c.moveTo(0, h * 0.62);
    c.lineTo(w, h * 0.48);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.fill();
    // a tyre seen from the side: tread blocks, sidewall, a five-spoke rim
    const cx = w * 0.5;
    const cy = h * 0.4;
    const r = w * 0.36;
    c.fillStyle = '#16161a';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#2c2c32';
    c.lineWidth = r * 0.06;
    for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
        c.lineTo(cx + Math.cos(a + 0.03) * r * 0.99, cy + Math.sin(a + 0.03) * r * 0.99);
        c.stroke();
    }
    const rim = c.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r * 0.62);
    rim.addColorStop(0, '#f4f5f7');
    rim.addColorStop(1, '#7b8089');
    c.fillStyle = rim;
    c.beginPath();
    c.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2a2b30';
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        c.beginPath();
        c.moveTo(cx + Math.cos(a - 0.32) * r * 0.55, cy + Math.sin(a - 0.32) * r * 0.55);
        c.lineTo(cx + Math.cos(a + 0.32) * r * 0.55, cy + Math.sin(a + 0.32) * r * 0.55);
        c.lineTo(cx + Math.cos(a) * r * 0.16, cy + Math.sin(a) * r * 0.16);
        c.fill();
    }
    c.fillStyle = '#9aa0a8';
    c.beginPath();
    c.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.font = `${Math.round(w * 0.24)}px ${DISPLAY}`;
    c.fillText('GRIP 7', w * 0.08, h * 0.86);
    c.font = `600 ${Math.round(w * 0.05)}px ${UI}`;
    c.fillText('Semi-Slick für Straße & Strecke', w * 0.08, h * 0.93);
    c.fillStyle = '#16161a';
    c.font = `700 ${Math.round(w * 0.05)}px ${UI}`;
    c.fillText('REIFENSERVICE', w * 0.08, h * 0.08);
    paper(c, w, h);
}

function posterOil(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0c3b2e');
    g.addColorStop(1, '#06140f');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // a can of oil, the drop
    c.fillStyle = '#e8b21a';
    roundRect(c, w * 0.25, h * 0.2, w * 0.5, h * 0.5, w * 0.04);
    c.fill();
    c.fillStyle = '#0c3b2e';
    roundRect(c, w * 0.3, h * 0.32, w * 0.4, h * 0.22, w * 0.02);
    c.fill();
    c.fillStyle = '#e8b21a';
    c.fillRect(w * 0.42, h * 0.14, w * 0.16, h * 0.07);
    c.textAlign = 'center';
    c.font = `${Math.round(w * 0.11)}px ${DISPLAY}`;
    c.fillText('10W-60', w / 2, h * 0.47);
    c.fillStyle = '#ffffff';
    c.font = `${Math.round(w * 0.15)}px ${DISPLAY}`;
    c.fillText('MOTORÖL', w / 2, h * 0.84);
    c.font = `600 ${Math.round(w * 0.045)}px ${UI}`;
    c.fillText('VOLLSYNTHETISCH · FÜR HOHE DREHZAHL', w / 2, h * 0.91);
    c.strokeStyle = '#e8b21a';
    c.lineWidth = w * 0.012;
    c.strokeRect(w * 0.05, h * 0.04, w * 0.9, h * 0.92);
    paper(c, w, h);
}

function posterGlyphs(c, w, h) {
    c.fillStyle = '#efe8da';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c4161c';
    c.beginPath();
    c.arc(w * 0.5, h * 0.3, w * 0.28, 0, Math.PI * 2);
    c.fill();
    const random = rng(23);
    c.strokeStyle = '#141414';
    c.lineWidth = w * 0.035;
    for (let k = 0; k < 4; k++) drawGlyph(c, random, w * 0.36, h * (0.52 + k * 0.1), w * 0.26);
    c.lineWidth = w * 0.012;
    for (let k = 0; k < 6; k++) drawGlyph(c, random, w * 0.12, h * (0.56 + k * 0.06), w * 0.1);
    c.fillStyle = '#141414';
    c.textAlign = 'center';
    c.font = `${Math.round(w * 0.09)}px ${DISPLAY}`;
    c.fillText('DRIFT · KLUB', w / 2, h * 0.08);
    paper(c, w, h);
}

function dynoSheet(c, w, h) {
    c.fillStyle = '#f2f1ec';
    c.fillRect(0, 0, w, h);
    const x0 = w * 0.1;
    const y0 = h * 0.85;
    const x1 = w * 0.95;
    const y1 = h * 0.18;
    c.strokeStyle = '#c9c9c2';
    c.lineWidth = Math.max(1, w * 0.002);
    for (let k = 0; k <= 10; k++) {
        const x = x0 + ((x1 - x0) * k) / 10;
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x, y1);
        c.stroke();
    }
    for (let k = 0; k <= 6; k++) {
        const y = y0 + ((y1 - y0) * k) / 6;
        c.beginPath();
        c.moveTo(x0, y);
        c.lineTo(x1, y);
        c.stroke();
    }
    const curve = (colour, fn) => {
        c.strokeStyle = colour;
        c.lineWidth = Math.max(2, w * 0.006);
        c.beginPath();
        for (let k = 0; k <= 60; k++) {
            const t = k / 60;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * fn(t);
            if (k === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.stroke();
    };
    curve('#c4161c', t => Math.min(0.92, 0.15 + t * 1.25 - t * t * 0.5) * (t > 0.88 ? 1 - (t - 0.88) * 2 : 1));
    curve('#1f5fbf', t => 0.35 + Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.45 - t * t * 0.22);
    c.fillStyle = '#141414';
    c.textAlign = 'left';
    c.font = `700 ${Math.round(h * 0.09)}px ${UI}`;
    c.fillText('LEISTUNGSPRÜFSTAND', x0, h * 0.11);
    c.font = `${Math.round(h * 0.06)}px ${UI}`;
    c.fillStyle = '#c4161c';
    c.fillText('Leistung kW', x1 - w * 0.3, h * 0.11);
    c.fillStyle = '#1f5fbf';
    c.fillText('Drehmoment Nm', x1 - w * 0.3, h * 0.17);
}

function calendar(c, w, h) {
    c.fillStyle = '#f5f3ee';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1d2a44';
    c.fillRect(0, 0, w, h * 0.42);
    c.fillStyle = '#ff2e88';
    c.fillRect(0, h * 0.38, w, h * 0.04);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.font = `${Math.round(h * 0.11)}px ${DISPLAY}`;
    c.fillText('NOVEMBER', w / 2, h * 0.3);
    c.fillStyle = '#333';
    c.font = `${Math.round(h * 0.045)}px ${UI}`;
    // November 2026 starts on a Sunday: Monday-first grid, offset 6
    for (let d = 1; d <= 30; d++) {
        const cell = d + 5;
        const col = cell % 7;
        const row = Math.floor(cell / 7);
        if (col >= 5) c.fillStyle = '#c4161c';
        else c.fillStyle = '#333';
        c.fillText(String(d), w * (0.1 + col * 0.135), h * (0.5 + row * 0.085));
    }
}

/** A safety sign: square, a pictogram. */
function sign(c, w, h, colour, kind) {
    c.fillStyle = kind === 'noSmoking' ? '#ffffff' : colour;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ffffff';
    c.lineWidth = w * 0.07;
    const cx = w / 2;
    const cy = h / 2;
    if (kind === 'extinguisher') {
        roundRect(c, cx - w * 0.12, cy - h * 0.2, w * 0.24, h * 0.5, w * 0.06);
        c.fill();
        c.fillRect(cx - w * 0.04, cy - h * 0.32, w * 0.08, h * 0.12);
        c.beginPath();
        c.moveTo(cx + w * 0.04, cy - h * 0.28);
        c.quadraticCurveTo(cx + w * 0.3, cy - h * 0.3, cx + w * 0.25, cy + h * 0.1);
        c.stroke();
    } else if (kind === 'noSmoking') {
        c.fillStyle = '#222';
        c.fillRect(cx - w * 0.28, cy - h * 0.04, w * 0.5, h * 0.1);
        c.strokeStyle = '#c8161d';
        c.lineWidth = w * 0.09;
        c.beginPath();
        c.arc(cx, cy, w * 0.36, 0, Math.PI * 2);
        c.moveTo(cx - w * 0.25, cy - h * 0.25);
        c.lineTo(cx + w * 0.25, cy + h * 0.25);
        c.stroke();
    } else if (kind === 'firstAid') {
        c.fillRect(cx - w * 0.1, cy - h * 0.3, w * 0.2, h * 0.6);
        c.fillRect(cx - w * 0.3, cy - h * 0.1, w * 0.6, h * 0.2);
    } else {
        c.fillStyle = '#111';
        c.beginPath();
        c.moveTo(cx, cy - h * 0.36);
        c.lineTo(cx + w * 0.38, cy + h * 0.3);
        c.lineTo(cx - w * 0.38, cy + h * 0.3);
        c.closePath();
        c.fill();
        c.fillStyle = colour;
        c.beginPath();
        c.moveTo(cx + w * 0.04, cy - h * 0.18);
        c.lineTo(cx - w * 0.08, cy + h * 0.06);
        c.lineTo(cx + w * 0.02, cy + h * 0.06);
        c.lineTo(cx - w * 0.04, cy + h * 0.24);
        c.lineTo(cx + w * 0.1, cy - h * 0.02);
        c.lineTo(cx, cy - h * 0.02);
        c.closePath();
        c.fill();
    }
}

function banner(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#15121f');
    g.addColorStop(1, '#241033');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff2e88';
    c.fillRect(0, h * 0.84, w, h * 0.06);
    c.fillStyle = '#29e7ff';
    c.fillRect(0, h * 0.1, w, h * 0.03);
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = `italic ${Math.round(h * 0.52)}px ${DISPLAY}`;
    c.fillText('DRIFT', w * 0.04, h * 0.7);
    const drift = c.measureText('DRIFT').width;
    c.fillStyle = '#ff2e88';
    c.fillText('KING', w * 0.04 + drift + h * 0.05, h * 0.7);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = `600 ${Math.round(h * 0.17)}px ${UI}`;
    c.fillText('TUNING · FAHRWERK · REIFEN · LACK', w * 0.47, h * 0.62);
    // grommets
    c.fillStyle = '#9aa0a8';
    for (const x of [0.012, 0.988]) for (const y of [0.18, 0.82]) {
        c.beginPath();
        c.arc(w * x, h * y, h * 0.035, 0, Math.PI * 2);
        c.fill();
    }
}

function plate(c, w, h) {
    c.fillStyle = '#1b1d22';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e8e8';
    c.textAlign = 'center';
    c.font = `700 ${Math.round(h * 0.34)}px ${UI}`;
    c.fillText('BÜRO · ANNAHME', w / 2, h * 0.5);
    c.font = `${Math.round(h * 0.2)}px ${UI}`;
    c.fillStyle = '#ffb020';
    c.fillText('Bitte klingeln', w / 2, h * 0.82);
}

// ---------------------------------------------------------------- the pegboard (2.4 × 1.2 m)

/**
 * The pegboard behind the workbench: a perforated board with a shadow board of tools (wrenches, screwdrivers, pliers, a hammer, sockets).
 * @param {number} width 512 (low) | 1024
 */
export function pegboardTexture(width) {
    const height = width / 2;
    return canvasTexture(width, height, (c) => {
        c.fillStyle = '#8e969f';
        c.fillRect(0, 0, width, height);
        const pitch = width / 96;
        c.fillStyle = '#2c3036';
        for (let y = pitch / 2; y < height; y += pitch) {
            for (let x = pitch / 2; x < width; x += pitch) {
                c.beginPath();
                c.arc(x, y, pitch * 0.17, 0, Math.PI * 2);
                c.fill();
            }
        }
        const s = width / 1024;
        const metal = (x0, y0, x1, y1) => {
            const g = c.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, '#e6e9ee');
            g.addColorStop(0.5, '#9ba1aa');
            g.addColorStop(1, '#d4d8de');
            return g;
        };
        // shadow-board outlines (black marker) and the tools in them
        const outline = fn => {
            c.save();
            c.strokeStyle = '#111';
            c.lineWidth = 6 * s;
            c.globalAlpha = 0.85;
            fn();
            c.stroke();
            c.restore();
        };
        // a row of combination wrenches, growing
        for (let k = 0; k < 10; k++) {
            const x = (60 + k * 34) * s;
            const len = (150 + k * 12) * s;
            const y = 40 * s;
            const wide = (10 + k * 0.9) * s;
            outline(() => {
                c.beginPath();
                c.rect(x - wide / 2, y, wide, len);
            });
            c.fillStyle = metal(x - wide, 0, x + wide, 0);
            c.fillRect(x - wide / 2, y, wide, len);
            c.beginPath();
            c.arc(x, y + len, wide * 1.15, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#8e969f';
            c.beginPath();
            c.arc(x, y + len, wide * 0.55, 0, Math.PI * 2);
            c.fill();
        }
        // screwdrivers: coloured handles, steel shafts
        const handles = ['#c4161c', '#c4161c', '#1f5fbf', '#1f5fbf', '#e8b21a', '#2a2b30'];
        handles.forEach((colour, k) => {
            const x = (460 + k * 30) * s;
            const y = 50 * s;
            outline(() => {
                c.beginPath();
                c.rect(x - 9 * s, y, 18 * s, 190 * s);
            });
            c.fillStyle = colour;
            roundRect(c, x - 9 * s, y, 18 * s, 80 * s, 6 * s);
            c.fill();
            c.fillStyle = metal(x - 4 * s, 0, x + 4 * s, 0);
            c.fillRect(x - 3 * s, y + 80 * s, 6 * s, (80 + k * 8) * s);
        });
        // pliers
        for (let k = 0; k < 3; k++) {
            const x = (680 + k * 60) * s;
            const y = 60 * s;
            c.fillStyle = k === 1 ? '#c4161c' : '#1f5fbf';
            c.save();
            c.translate(x, y);
            for (const side of [-1, 1]) {
                c.save();
                c.rotate(side * 0.09);
                roundRect(c, -8 * s, 70 * s, 16 * s, 120 * s, 6 * s);
                c.fill();
                c.restore();
            }
            c.fillStyle = metal(-20 * s, 0, 20 * s, 0);
            c.beginPath();
            c.moveTo(-14 * s, 75 * s);
            c.lineTo(14 * s, 75 * s);
            c.lineTo(4 * s, 0);
            c.lineTo(-4 * s, 0);
            c.closePath();
            c.fill();
            c.restore();
        }
        // a hammer
        outline(() => {
            c.beginPath();
            c.rect(880 * s, 40 * s, 90 * s, 34 * s);
        });
        c.fillStyle = metal(880 * s, 40 * s, 880 * s, 74 * s);
        c.fillRect(880 * s, 40 * s, 90 * s, 34 * s);
        c.fillStyle = '#6b4a2c';
        c.fillRect(918 * s, 74 * s, 16 * s, 170 * s);
        // a socket rail with sockets
        c.fillStyle = '#c4161c';
        c.fillRect(60 * s, 300 * s, 400 * s, 16 * s);
        for (let k = 0; k < 12; k++) {
            const r = (10 + k * 1.2) * s;
            const x = (80 + k * 32) * s;
            c.fillStyle = metal(x - r, 0, x + r, 0);
            c.fillRect(x - r, 316 * s, r * 2, 50 * s);
            c.fillStyle = '#2c3036';
            c.beginPath();
            c.ellipse(x, 366 * s, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
            c.fill();
        }
        // a torque wrench and a ratchet, lying across
        c.fillStyle = metal(0, 400 * s, 0, 420 * s);
        c.fillRect(520 * s, 330 * s, 420 * s, 18 * s);
        c.fillStyle = '#16161a';
        c.fillRect(840 * s, 326 * s, 110 * s, 26 * s);
        c.fillStyle = metal(0, 420 * s, 0, 440 * s);
        c.fillRect(520 * s, 410 * s, 260 * s, 16 * s);
        c.beginPath();
        c.arc(520 * s, 418 * s, 18 * s, 0, Math.PI * 2);
        c.fill();
        // grime
        const random = rng(41);
        for (let k = 0; k < 60; k++) {
            c.fillStyle = `rgba(30,24,16,${0.03 + random() * 0.06})`;
            c.beginPath();
            c.arc(random() * width, random() * height, (6 + random() * 30) * s, 0, Math.PI * 2);
            c.fill();
        }
    });
}

// ---------------------------------------------------------------- the neon sign

/**
 * The neon sign over the workbench: "DRIFT" in cyan, "KING" in pink, the crown – bright tubes on black (an emissive map: black does not glow).
 * @param {number} width 512 | 1024
 */
export function neonTexture(width) {
    const height = width / 4;
    return canvasTexture(width, height, (c) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, width, height);
        const s = width / 1024;
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.font = `italic ${Math.round(150 * s)}px ${DISPLAY}`;
        c.textBaseline = 'middle';
        const tube = (text, x, colour) => {
            // the soft halo in the glass, then the tube, then the hot core
            c.strokeStyle = colour;
            c.globalAlpha = 0.25;
            c.lineWidth = 16 * s;
            c.strokeText(text, x, height * 0.55);
            c.globalAlpha = 1;
            c.lineWidth = 7 * s;
            c.strokeText(text, x, height * 0.55);
            c.strokeStyle = '#ffffff';
            c.globalAlpha = 0.65;
            c.lineWidth = 2.5 * s;
            c.strokeText(text, x, height * 0.55);
            c.globalAlpha = 1;
        };
        c.textAlign = 'left';
        const driftWidth = c.measureText('DRIFT').width;
        const start = (width - driftWidth - c.measureText('KING').width - 140 * s) / 2 + 110 * s;
        tube('DRIFT', start, '#29e7ff');
        tube('KING', start + driftWidth + 30 * s, '#ff2e88');
        // the crown
        const cx = start - 70 * s;
        const cy = height * 0.55;
        c.strokeStyle = '#ffb020';
        c.lineWidth = 7 * s;
        c.beginPath();
        c.moveTo(cx - 44 * s, cy + 30 * s);
        c.lineTo(cx - 50 * s, cy - 30 * s);
        c.lineTo(cx - 22 * s, cy);
        c.lineTo(cx, cy - 42 * s);
        c.lineTo(cx + 22 * s, cy);
        c.lineTo(cx + 50 * s, cy - 30 * s);
        c.lineTo(cx + 44 * s, cy + 30 * s);
        c.closePath();
        c.stroke();
    });
}

// ---------------------------------------------------------------- the office behind the window

/**
 * The lit office seen through the window (an emissive picture on the walls of a small box): back wall with a shelf of binders,
 * a desk with a screen, a clock, a plant; warm light from above.
 * @param {number} width 256 | 512
 */
export function officeTexture(width) {
    const height = width / 2;
    return canvasTexture(width, height, (c) => {
        const s = width / 512;
        const wall = c.createLinearGradient(0, 0, 0, height);
        wall.addColorStop(0, '#fff1d8');
        wall.addColorStop(1, '#a8957a');
        c.fillStyle = wall;
        c.fillRect(0, 0, width, height);
        // floor strip
        c.fillStyle = '#5a4a3c';
        c.fillRect(0, height * 0.86, width, height * 0.14);
        // shelf with binders
        c.fillStyle = '#6b5a48';
        c.fillRect(30 * s, 70 * s, 200 * s, 6 * s);
        const random = rng(5);
        const colours = ['#1f5fbf', '#c4161c', '#2a2b30', '#e8b21a', '#3a7a3a'];
        for (let x = 34 * s; x < 226 * s; x += 14 * s) {
            c.fillStyle = colours[Math.floor(random() * colours.length)];
            c.fillRect(x, 26 * s, 12 * s, 44 * s);
        }
        // a clock
        c.fillStyle = '#fafafa';
        c.beginPath();
        c.arc(330 * s, 50 * s, 18 * s, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#222';
        c.lineWidth = 2 * s;
        c.beginPath();
        c.moveTo(330 * s, 50 * s);
        c.lineTo(330 * s, 38 * s);
        c.moveTo(330 * s, 50 * s);
        c.lineTo(340 * s, 54 * s);
        c.stroke();
        // the desk, a screen (bright), a lamp
        c.fillStyle = '#3c3026';
        c.fillRect(150 * s, 170 * s, 300 * s, 12 * s);
        c.fillRect(160 * s, 182 * s, 10 * s, 40 * s);
        c.fillRect(430 * s, 182 * s, 10 * s, 40 * s);
        c.fillStyle = '#111';
        c.fillRect(260 * s, 110 * s, 110 * s, 64 * s);
        c.fillStyle = '#bfe0ff';
        c.fillRect(264 * s, 114 * s, 102 * s, 54 * s);
        c.fillStyle = '#2a6fd0';
        c.fillRect(270 * s, 122 * s, 50 * s, 6 * s);
        c.fillRect(270 * s, 134 * s, 80 * s, 4 * s);
        // a plant
        c.fillStyle = '#2f6a34';
        for (let k = 0; k < 7; k++) {
            c.beginPath();
            c.ellipse((470 + Math.sin(k) * 14) * s, (150 + k * 3) * s, 6 * s, 20 * s, Math.sin(k * 2) * 0.8, 0, Math.PI * 2);
            c.fill();
        }
        c.fillStyle = '#8a4a2a';
        c.fillRect(458 * s, 170 * s, 24 * s, 30 * s);
    });
}

// ---------------------------------------------------------------- floor markings

/** Yellow/black hazard stripes (tile 0.5 m along u): the lift bay, the edges of the turntable path. */
export function hazardTexture() {
    const texture = canvasTexture(128, 32, (c, w, h) => {
        c.fillStyle = '#1a1a1a';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#e8b51c';
        for (let x = -h; x < w + h; x += 32) {
            c.beginPath();
            c.moveTo(x, h);
            c.lineTo(x + 16, h);
            c.lineTo(x + 16 + h, 0);
            c.lineTo(x + h, 0);
            c.closePath();
            c.fill();
        }
        // worn paint
        const random = rng(17);
        for (let k = 0; k < 40; k++) {
            c.fillStyle = `rgba(90,90,90,${0.2 + random() * 0.4})`;
            c.fillRect(random() * w, random() * h, 2 + random() * 6, 1 + random() * 3);
        }
    }, { repeat: true });
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}
