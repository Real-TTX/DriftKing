// DriftKing · car/model-livery.js – the paint of a car as one texture (the livery atlas): the paint colour, panel gaps, the decal on both doors,
// the start number in a roundel, stripes over bonnet, roof and boot, and the licence plate. The shells (model-shell.js) map into it with
// u = along the car (z in metres) and v = around it (the girth from the top centre line, + on the car's left side (+x), - on the right),
// so a decal wraps the curved body the way vinyl does. Plates and plain painted parts sample their own corners of the atlas.

import * as THREE from 'three';
import { drawGlyph, rng } from '../render/kit.js';

/** The atlas in body coordinates: u0..u1 along z (m), t0..t1 around the body (m); plates live above PLATE_T. */
export const ATLAS = Object.freeze({ u0: -2.55, u1: 2.55, t0: -1.75, t1: 2.15 });

/** Where painted parts without a livery (mirrors, spoilers) sample the atlas: plain paint beyond the nose of every body. */
export const PLAIN_UV = Object.freeze([atlasU(2.45), atlasV(1.0)]);

/** The plate image in the atlas (u, t rectangle in metres): drawn at about twice its real size for sharper characters. */
export const PLATE = Object.freeze({ u0: -2.35, u1: -1.69, t0: 1.8, t1: 2.13 });

/** The largest girth a shell samples (the underside clamps to plain paint below the plate). */
export const GIRTH_LIMIT = 1.72;

/** The atlas width in pixels per quality (the height keeps metres square). */
const ATLAS_WIDTH = { low: 512, medium: 768, high: 1024 };

/** Atlas u (0..1) of a body z. */
export function atlasU(z) {
    return (z - ATLAS.u0) / (ATLAS.u1 - ATLAS.u0);
}

/** Atlas v (0..1) of a girth t. */
export function atlasV(t) {
    return (t - ATLAS.t0) / (ATLAS.t1 - ATLAS.t0);
}

/**
 * Paints the livery texture of a car.
 * @param {object} view the CarView (paint, decal, number)
 * @param {object} design the body design (model-bodies.js): livery layout (doors, bonnet, boot, fuel flap, side girth)
 * @param {string} quality low | medium | high
 * @returns {THREE.CanvasTexture} owned by the car (dispose it with the car)
 */
export function liveryTexture(view, design, quality) {
    const width = ATLAS_WIDTH[quality] ?? ATLAS_WIDTH.medium;
    const scale = width / (ATLAS.u1 - ATLAS.u0);
    const height = Math.round((ATLAS.t1 - ATLAS.t0) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    const paint = new THREE.Color(view.paint ?? '#f4f2ff');
    const paintHex = `#${paint.getHexString()}`;
    const light = paint.r * 0.3 + paint.g * 0.59 + paint.b * 0.11 > 0.55;
    const ink = light ? '#16151f' : '#f4f2ff';
    const accent = light ? '#ff2e88' : '#29e7ff';
    const decal = view.decal ?? 'none';
    const number = view.number ?? 0;
    const layout = design.livery;

    c.fillStyle = paintHex;
    c.fillRect(0, 0, width, height);
    // atlas metres → canvas pixels (canvas y runs down from t1: the texture is flipped on upload)
    const px = (u, t) => [(u - ATLAS.u0) * scale, (ATLAS.t1 - t) * scale];

    // the door art on both sides, drawn in the old 512 × 160 door space (x from the door's front end to the rear, y down)
    const door = layout.door;
    const doorLength = door.z1 - door.z0;
    const doorHeight = door.y1 - door.y0;
    const options = { decal, number, ink, accent, paint: paintHex, seed: (view.number ?? 7) + 3 };
    for (const side of [1, -1]) {
        c.save();
        const tTop = side * layout.sideT(door.y1);
        if (side > 0) {
            // left side (+x): the viewer sees the front on the left; u runs to the rear, t grows downwards → both canvas axes flip (a rotation)
            const [x0, y0] = px(door.z1, tTop);
            c.setTransform(-scale * doorLength / 512, 0, 0, -scale * doorHeight / 160, x0, y0);
        } else {
            // right side (−x): the viewer sees the front on the right; image x runs from the rear end forwards, t falls downwards
            const [x0, y0] = px(door.z0, tTop);
            c.setTransform(scale * doorLength / 512, 0, 0, scale * doorHeight / 160, x0, y0);
        }
        drawDoor(c, 512, 160, { ...options, front: side > 0 ? 'left' : 'right' });
        c.restore();
    }

    // stripes over bonnet, roof and boot (the girth around the top centre line), down the front and rear faces too
    if (decal === 'stripes') {
        c.fillStyle = ink;
        for (const sign of [1, -1]) {
            const [, ya] = px(0, sign * 0.075);
            const [, yb] = px(0, sign * 0.235);
            c.fillRect(0, Math.min(ya, yb), width, Math.abs(yb - ya));
        }
        c.fillStyle = accent;
        const [, yc] = px(0, 0.012);
        const [, yd] = px(0, -0.012);
        c.fillRect(0, Math.min(yc, yd), width, Math.abs(yd - yc));
    } else if (decal === 'split') {
        // a dark bonnet and roof: the "split" theme continues over the top
        c.fillStyle = ink;
        c.globalAlpha = 0.9;
        const [, ya] = px(0, 0.42);
        const [, yb] = px(0, -0.42);
        const [xa] = px(layout.bonnet.z0 - 0.4, 0);
        c.fillRect(xa, ya, width - xa, yb - ya);
        c.globalAlpha = 1;
    }

    drawOcclusion(c, px, scale, layout, width);
    drawPanelGaps(c, px, scale, layout);
    drawPlate(c, px, scale, number);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = quality === 'low' ? 2 : 8;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
}

/** Baked ambient occlusion: the paint darkens towards the sills (the road and the underside see little sky) and around the wheel arches. */
function drawOcclusion(c, px, scale, layout, width) {
    c.save();
    for (const side of [1, -1]) {
        const [, ya] = px(0, side * layout.sideT(layout.sill + 0.32));
        const [, yb] = px(0, side * GIRTH_LIMIT);
        const g = c.createLinearGradient(0, ya, 0, yb);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.75, 'rgba(0,0,0,0.26)');
        g.addColorStop(1, 'rgba(0,0,0,0.4)');
        c.fillStyle = g;
        c.fillRect(0, Math.min(ya, yb), width, Math.abs(yb - ya));
        for (const z of [1.25, -1.25]) {
            const [x, y] = px(z, side * layout.sideT(layout.archY));
            const r0 = layout.arch * scale;
            const r1 = (layout.arch + 0.16) * scale;
            const ring = c.createRadialGradient(x, y, r0 * 0.9, x, y, r1);
            ring.addColorStop(0, 'rgba(0,0,0,0.42)');
            ring.addColorStop(0.35, 'rgba(0,0,0,0.16)');
            ring.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = ring;
            c.beginPath();
            c.arc(x, y, r1, 0, Math.PI * 2);
            c.fill();
        }
    }
    c.restore();
}

/** Thin dark lines where the panels meet: bonnet, doors, boot lid, bumpers, the fuel flap. */
function drawPanelGaps(c, px, scale, layout) {
    c.save();
    c.strokeStyle = 'rgba(6,6,10,0.72)';
    c.lineWidth = Math.max(1, 0.008 * scale);
    c.lineJoin = 'round';
    const line = points => {
        c.beginPath();
        points.forEach(([u, t], k) => {
            const [x, y] = px(u, t);
            if (k === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        });
        c.stroke();
    };
    const { bonnet, boot, doors, sideT, bumpers, fuel } = layout;
    for (const side of [1, -1]) {
        // bonnet: its rear edge under the windscreen, the shut lines along the wings, the front edge above the grille
        line([[bonnet.z0, 0], [bonnet.z0, side * bonnet.half], [bonnet.z1, side * bonnet.half], [bonnet.z1, 0]]);
        // boot lid
        if (boot) line([[boot.z0, 0], [boot.z0, side * boot.half], [boot.z1, side * boot.half], [boot.z1, 0]]);
        // doors: front and rear edges from the window line down to the sill, the bottom edge along the sill
        for (const d of doors) {
            const top = side * sideT(d.top);
            const bottom = side * sideT(d.bottom);
            line([[d.z1, top], [d.z1, bottom], [d.z0, bottom], [d.z0, top]]);
        }
        // the bumper seams on the wings
        for (const b of bumpers) line([[b.z, side * sideT(b.y0)], [b.z, side * sideT(b.y1)]]);
    }
    // the fuel flap on the left rear wing
    if (fuel) {
        const t = sideT(fuel.y);
        const [x, y] = px(fuel.z, t);
        const w = 0.15 * scale;
        const h = 0.11 * scale;
        c.beginPath();
        c.roundRect(x - w / 2, y - h / 2, w, h, 0.025 * scale);
        c.stroke();
    }
    c.restore();
}

/** The licence plate: white, a dark frame, an invented region in brush glyphs and the number (front and rear use the same picture). */
function drawPlate(c, px, scale, number) {
    const [x0, y0] = px(PLATE.u0, PLATE.t1);
    const [x1, y1] = px(PLATE.u1, PLATE.t0);
    const w = x1 - x0;
    const h = y1 - y0;
    c.save();
    c.fillStyle = '#1a1b1e';
    c.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    c.fillStyle = '#eef0ea';
    c.beginPath();
    c.roundRect(x0 + w * 0.03, y0 + h * 0.06, w * 0.94, h * 0.88, h * 0.08);
    c.fill();
    c.strokeStyle = '#1f5a3a';
    c.fillStyle = '#1f5a3a';
    c.lineWidth = Math.max(1, h * 0.05);
    const random = rng(1000 + number);
    // top line: two invented glyphs and a small class number
    for (let k = 0; k < 2; k++) drawGlyph(c, random, x0 + w * (0.26 + k * 0.14), y0 + h * 0.12, h * 0.28);
    c.font = `bold ${Math.round(h * 0.26)}px Inter, Arial, sans-serif`;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(String(300 + (number % 700)), x0 + w * 0.58, y0 + h * 0.12);
    // the number: "NN-NN"
    const digits = String(1000 + ((number * 7919) % 9000)).padStart(4, '0');
    c.font = `bold ${Math.round(h * 0.5)}px Inter, Arial, sans-serif`;
    c.textAlign = 'center';
    c.fillText(`${digits.slice(0, 2)}-${digits.slice(2)}`, x0 + w * 0.56, y0 + h * 0.42);
    drawGlyph(c, random, x0 + w * 0.08, y0 + h * 0.48, h * 0.32);
    c.restore();
}

/** The door art; front: the end of the canvas at the car's front ('left' or 'right'). The decal is mirrored with it, the number never. */
function drawDoor(c, w, h, { decal, number, ink, accent, paint, seed, front }) {
    const random = rng(seed);
    c.save();
    if (front === 'right') {
        c.translate(w, 0);
        c.scale(-1, 1);
    }
    if (decal === 'split') {
        c.fillStyle = ink;
        c.beginPath();
        c.moveTo(0, h * 0.55);
        c.lineTo(w, h * 0.3);
        c.lineTo(w, h);
        c.lineTo(0, h);
        c.fill();
        c.fillStyle = accent;
        c.fillRect(0, h * 0.5, w, 6);
    } else if (decal === 'kanji') {
        c.strokeStyle = accent;
        c.lineWidth = 12;
        for (let k = 0; k < 3; k++) drawGlyph(c, random, 210 + k * 96, 20, 110);
    } else if (decal === 'sakura') {
        for (let k = 0; k < 9; k++) flower(c, 160 + random() * 340, 20 + random() * 120, 14 + random() * 18, k % 3 ? '#ffb7d5' : '#ff6fa8');
        c.strokeStyle = '#3a2430';
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(w, 10);
        c.quadraticCurveTo(320, 60, 170, 150);
        c.stroke();
    } else if (decal === 'flames') {
        const g = c.createLinearGradient(0, 0, w * 0.8, 0);
        g.addColorStop(0, '#ffe14a');
        g.addColorStop(0.45, '#ff7a1a');
        g.addColorStop(1, 'rgba(255,40,40,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, h * 0.15);
        for (let k = 0; k < 6; k++) {
            const y = h * (0.15 + k * 0.14);
            c.quadraticCurveTo(w * (0.35 + random() * 0.35), y - 10, w * (0.5 + random() * 0.35), y + 8);
            c.quadraticCurveTo(w * 0.3, y + 16, 0, y + h * 0.14);
        }
        c.lineTo(0, h * 0.15);
        c.fill();
    } else if (decal === 'stripes') {
        c.fillStyle = ink;
        c.fillRect(0, h * 0.62, w, 14);
        c.fillStyle = accent;
        c.fillRect(0, h * 0.62 + 20, w, 6);
    }
    c.restore();
    // the roundel with the number (front part of the door)
    const x = front === 'right' ? w - 92 : 92;
    const y = h * 0.47;
    c.fillStyle = '#f4f2ff';
    c.beginPath();
    c.arc(x, y, 56, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = paint;
    c.stroke();
    c.fillStyle = '#16151f';
    c.font = 'bold 74px Anton, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(number % 100), x, y + 4);
}

function flower(c, x, y, r, colour) {
    c.fillStyle = colour;
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        c.beginPath();
        c.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
        c.fill();
    }
    c.fillStyle = '#fff3a8';
    c.beginPath();
    c.arc(x, y, r * 0.18, 0, Math.PI * 2);
    c.fill();
}
