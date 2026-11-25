// DriftKing · maps/deck-atlas.js – the two canvas atlases of "Parkdeck 7" and the quad batcher that lays their cells into the world.
// paintAtlas: everything painted, worn or spilled on the deck (bay lines, digits, arrows, hatching, hazard stripes, joints, tyre marks, oil,
// drain grates); litAtlas: everything that shines (the stairwell and lift lobby behind glass, exit and parking signs, the "P7" sign, the
// billboard on the roof next door, the parking levels below, shop fronts in the street). A Batch collects quads and strips with atlas UVs
// and becomes one mesh – so all markings of the map are a handful of draw calls. Both atlases belong to the world (disposeTree frees them).

import * as THREE from 'three';
import { canvasTexture, drawGlyph, rng } from '../../render/kit.js';

/** The atlases are drawn in these units (1024²) and scaled to the quality's size. */
const UNITS = 1024;

/** Paint atlas cells [x, y, w, h] in atlas units (strips run along u). */
export const PAINT = {
    lineWhite: [0, 0, 1024, 32],
    lineYellow: [0, 40, 1024, 32],
    hazard: [0, 80, 1024, 64],
    joint: [0, 152, 1024, 64],
    tyre: [0, 224, 1024, 64],
    grate: [0, 296, 1024, 64],
    digit: k => [k * 64, 368, 64, 96],
    exitWord: [656, 368, 368, 96],
    arrow: [0, 472, 128, 256],
    turn: [136, 472, 192, 256],
    hatchWhite: [344, 472, 256, 128],
    hatchYellow: [344, 608, 256, 128],
    oil: [[616, 472, 128, 128], [752, 472, 128, 128], [888, 472, 128, 128]],
    stain: [616, 608, 128, 128],
    puddle: [752, 608, 128, 128],
    gully: [888, 608, 128, 128],
    paintYellow: [0, 744, 256, 64],
    paintWhite: [264, 744, 256, 64],
    rubber: [528, 744, 240, 64],
    redWhite: [776, 744, 248, 64],
    donut: [0, 816, 200, 200],
    zebra: [208, 816, 256, 200],
    slowWord: [472, 816, 352, 96],
    tags: [[832, 816, 192, 96]],
    steel: [472, 920, 256, 96],
    concreteGrey: [736, 920, 288, 96],
};

/** Lit atlas cells [x, y, w, h] in atlas units. */
export const LIT = {
    billboard: [0, 0, 1024, 384],
    sign: [0, 392, 512, 512],
    exit: [520, 392, 256, 128],
    parking: [784, 392, 128, 128],
    level: [920, 392, 104, 128],
    stairs: [520, 528, 256, 256],
    lobby: [784, 528, 240, 256],
    shops: [520, 792, 504, 112],
    levels: [0, 912, 1024, 56],
    lamp: [0, 976, 64, 40],
    window: [72, 976, 120, 40],
    exitBox: [200, 976, 160, 40],
    limit: [368, 976, 40, 40],
};

const sizeFor = quality => (quality === 'low' ? 512 : 1024);

/** A canvas in atlas units (the context is scaled from 1024² to the quality's size). */
function atlasCanvas(quality, draw, options) {
    const size = sizeFor(quality);
    return canvasTexture(size, size, ctx => {
        ctx.scale(size / UNITS, size / UNITS);
        draw(ctx);
    }, options);
}

/** Fills a cell's background with its colour at the lowest alpha, so mip filtering does not pull dark fringes into the paint. */
function prime(ctx, [x, y, w, h], rgb) {
    ctx.fillStyle = `rgba(${rgb},0.004)`;
    ctx.fillRect(x, y, w, h);
}

/** Speckled wear: knocks random holes into what is already painted in the cell (destination-out). */
function wear(ctx, [x, y, w, h], random, amount, size = 6) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = 'destination-out';
    const count = Math.round((w * h * amount) / (size * size));
    for (let k = 0; k < count; k++) {
        ctx.globalAlpha = 0.25 + random() * 0.75;
        const r = size * (0.3 + random() * 0.9);
        ctx.beginPath();
        ctx.ellipse(x + random() * w, y + random() * h, r * (1 + random() * 2.5), r, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/**
 * The paint atlas: worn road paint, digits, arrows, hatching, hazard stripes, joints, tyre marks, oil, grates.
 * @param {string} quality low | medium | high (512² on low, 1024² above)
 */
export function paintAtlas(quality) {
    const random = rng(707);
    const texture = atlasCanvas(quality, ctx => {
        // worn lines (white and yellow), u along the line
        for (const [cell, rgb, fill] of [[PAINT.lineWhite, '236,236,230', '#ecece6'], [PAINT.lineYellow, '240,196,60', '#f0c43c']]) {
            prime(ctx, cell, rgb);
            const [x, y, w, h] = cell;
            ctx.fillStyle = fill;
            ctx.fillRect(x, y + 4, w, h - 8);
            wear(ctx, cell, random, 0.22, 5);
        }
        // hazard stripes (opaque: walls, plinths, kerbs), period 64 so the strip tiles along u
        {
            const [x, y, w, h] = PAINT.hazard;
            ctx.fillStyle = '#1c1b1d';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#e8b21c';
            for (let k = -2; k < w / 64 + 2; k++) {
                ctx.beginPath();
                ctx.moveTo(x + k * 64, y + h);
                ctx.lineTo(x + k * 64 + 32, y + h);
                ctx.lineTo(x + k * 64 + 32 + h, y);
                ctx.lineTo(x + k * 64 + h, y);
                ctx.fill();
            }
            grime(ctx, PAINT.hazard, random, 0.35);
        }
        // expansion joint: aluminium edges, black rubber insert, grit
        {
            const cell = PAINT.joint;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '40,40,42');
            ctx.fillStyle = '#7d8084';
            ctx.fillRect(x, y + 8, w, 12);
            ctx.fillRect(x, y + h - 20, w, 12);
            ctx.fillStyle = '#18181a';
            ctx.fillRect(x, y + 20, w, h - 40);
            ctx.fillStyle = 'rgba(70,70,72,0.9)';
            for (let k = 0; k < w; k += 16) ctx.fillRect(x + k, y + 22, 3, h - 44);
            grime(ctx, cell, random, 0.25);
        }
        // tyre mark: two smeared streaks of rubber, faded at both ends
        {
            const cell = PAINT.tyre;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '16,16,18');
            for (let k = 0; k < 90; k++) {
                const yy = y + 6 + random() * (h - 12);
                ctx.strokeStyle = `rgba(14,14,16,${0.05 + random() * 0.12})`;
                ctx.lineWidth = 2 + random() * 6;
                ctx.beginPath();
                ctx.moveTo(x + random() * 80, yy);
                ctx.lineTo(x + w - random() * 80, yy + (random() - 0.5) * 6);
                ctx.stroke();
            }
            fadeEnds(ctx, cell, 0.18);
        }
        // linear drain grate (steel slots in a frame)
        {
            const [x, y, w, h] = PAINT.grate;
            ctx.fillStyle = '#5c5f63';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#0c0c0e';
            for (let k = 6; k < w - 6; k += 14) ctx.fillRect(x + k, y + 10, 8, h - 20);
            grime(ctx, PAINT.grate, random, 0.4);
        }
        // digits 0–9 (stencil style, tall: painted lettering is stretched along the view)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let k = 0; k < 10; k++) {
            const cell = PAINT.digit(k);
            const [x, y, w, h] = cell;
            prime(ctx, cell, '236,236,230');
            ctx.fillStyle = '#ecece6';
            ctx.font = 'bold 84px Anton, Impact, "Arial Narrow", sans-serif';
            ctx.fillText(String(k), x + w / 2, y + h / 2 + 4, w - 8);
            wear(ctx, cell, random, 0.18, 3);
        }
        word(ctx, PAINT.exitWord, 'AUSFAHRT', '236,236,230', random);
        word(ctx, PAINT.slowWord, 'LANGSAM', '240,196,60', random);
        for (const cell of PAINT.tags) tags(ctx, cell, random);
        // arrows (straight, turn) pointing up the cell (+v)
        {
            const cell = PAINT.arrow;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '236,236,230');
            ctx.fillStyle = '#ecece6';
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y + 6);
            ctx.lineTo(x + w - 10, y + 92);
            ctx.lineTo(x + w / 2 + 18, y + 92);
            ctx.lineTo(x + w / 2 + 18, y + h - 6);
            ctx.lineTo(x + w / 2 - 18, y + h - 6);
            ctx.lineTo(x + w / 2 - 18, y + 92);
            ctx.lineTo(x + 10, y + 92);
            ctx.closePath();
            ctx.fill();
            wear(ctx, cell, random, 0.2, 4);
        }
        {
            const cell = PAINT.turn;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '236,236,230');
            ctx.fillStyle = '#ecece6';
            ctx.strokeStyle = '#ecece6';
            ctx.lineWidth = 36;
            ctx.beginPath();
            ctx.moveTo(x + 60, y + h - 6);
            ctx.lineTo(x + 60, y + 120);
            ctx.quadraticCurveTo(x + 60, y + 70, x + 110, y + 70);
            ctx.lineTo(x + 120, y + 70);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + w - 6, y + 70);
            ctx.lineTo(x + 116, y + 14);
            ctx.lineTo(x + 116, y + 126);
            ctx.closePath();
            ctx.fill();
            wear(ctx, cell, random, 0.2, 4);
        }
        hatch(ctx, PAINT.hatchWhite, '#ecece6', '236,236,230', random);
        hatch(ctx, PAINT.hatchYellow, '#f0c43c', '240,196,60', random);
        // oil stains: dark brown blots with a darker core and drips
        for (const cell of PAINT.oil) {
            const [x, y, w, h] = cell;
            prime(ctx, cell, '22,18,14');
            for (let k = 0; k < 7; k++) {
                const cx = x + w / 2 + (random() - 0.5) * w * 0.35;
                const cy = y + h / 2 + (random() - 0.5) * h * 0.35;
                const r = w * (0.12 + random() * 0.22);
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                g.addColorStop(0, 'rgba(20,16,12,0.55)');
                g.addColorStop(0.6, 'rgba(26,22,18,0.3)');
                g.addColorStop(1, 'rgba(30,26,22,0)');
                ctx.fillStyle = g;
                ctx.fillRect(x, y, w, h);
            }
        }
        // light dirt / dried water marks
        {
            const cell = PAINT.stain;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '60,58,54');
            for (let k = 0; k < 10; k++) {
                const cx = x + w / 2 + (random() - 0.5) * w * 0.5;
                const cy = y + h / 2 + (random() - 0.5) * h * 0.5;
                const r = w * (0.1 + random() * 0.25);
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                g.addColorStop(0, 'rgba(58,56,52,0.22)');
                g.addColorStop(1, 'rgba(58,56,52,0)');
                ctx.fillStyle = g;
                ctx.fillRect(x, y, w, h);
            }
        }
        // a puddle: standing water darkens the concrete, its edge is soft and ragged (the glossy spill material makes it shine)
        {
            const cell = PAINT.puddle;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '24,25,27');
            for (let k = 0; k < 9; k++) {
                const cx = x + w / 2 + (random() - 0.5) * w * 0.42;
                const cy = y + h / 2 + (random() - 0.5) * h * 0.42;
                const r = w * (0.14 + random() * 0.18);
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                g.addColorStop(0, 'rgba(30,31,33,0.5)');
                g.addColorStop(0.65, 'rgba(30,31,33,0.36)');
                g.addColorStop(1, 'rgba(24,25,27,0)');
                ctx.fillStyle = g;
                ctx.fillRect(x, y, w, h);
            }
        }
        // a square gully grate in its frame
        {
            const [x, y, w, h] = PAINT.gully;
            ctx.fillStyle = '#55585c';
            ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
            ctx.fillStyle = '#0b0b0d';
            for (let k = 0; k < 7; k++) ctx.fillRect(x + 20 + k * 13, y + 20, 7, h - 40);
            grime(ctx, [x + 8, y + 8, w - 16, h - 16], random, 0.5);
        }
        // solid worn paint swatches (wheel stops, kerbs) and rubber / barrier boom stripes / steel / concrete
        for (const [cell, fill] of [[PAINT.paintYellow, '#e2b326'], [PAINT.paintWhite, '#e4e4de'], [PAINT.rubber, '#1d1d20'], [PAINT.steel, '#8e9296'], [PAINT.concreteGrey, '#8a8884']]) {
            const [x, y, w, h] = cell;
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, w, h);
            grime(ctx, cell, random, 0.3);
        }
        {
            const [x, y, w, h] = PAINT.redWhite;
            for (let k = 0; k < 8; k++) {
                ctx.fillStyle = k % 2 ? '#e8e6e2' : '#c4161c';
                ctx.fillRect(x + (k * w) / 8, y, w / 8 + 1, h);
            }
            grime(ctx, PAINT.redWhite, random, 0.15);
        }
        // a donut: a ring of rubber
        {
            const cell = PAINT.donut;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '16,16,18');
            for (let k = 0; k < 40; k++) {
                const r = w * (0.3 + random() * 0.16);
                ctx.strokeStyle = `rgba(14,14,16,${0.04 + random() * 0.1})`;
                ctx.lineWidth = 2 + random() * 7;
                ctx.beginPath();
                ctx.ellipse(x + w / 2 + (random() - 0.5) * 8, y + h / 2 + (random() - 0.5) * 8, r, r * (0.92 + random() * 0.08), random() * 3, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        // a zebra crossing (bars along v)
        {
            const cell = PAINT.zebra;
            const [x, y, w, h] = cell;
            prime(ctx, cell, '236,236,230');
            ctx.fillStyle = '#ecece6';
            for (let k = 0; k < 5; k++) ctx.fillRect(x + 6 + k * 52, y + 4, 30, h - 8);
            wear(ctx, cell, random, 0.22, 5);
        }
    }, { repeat: false });
    texture.anisotropy = 8;
    return texture;
}

function word(ctx, cell, text, rgb, random) {
    const [x, y, w, h] = cell;
    prime(ctx, cell, rgb);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.font = 'bold 86px Anton, Impact, "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 4, w - 12);
    wear(ctx, cell, random, 0.2, 4);
}

function hatch(ctx, cell, fill, rgb, random) {
    const [x, y, w, h] = cell;
    prime(ctx, cell, rgb);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.lineWidth = 12;
    for (let k = -h; k < w; k += 34) {
        ctx.beginPath();
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
        ctx.stroke();
    }
    ctx.restore();
    wear(ctx, cell, random, 0.2, 5);
}

/** Dirt over an opaque cell: soft dark blotches and fine speckles. */
function grime(ctx, [x, y, w, h], random, amount) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const count = Math.round((w * h) / 900);
    for (let k = 0; k < count; k++) {
        ctx.fillStyle = `rgba(20,18,16,${random() * amount * 0.5})`;
        const r = 2 + random() * 14;
        ctx.beginPath();
        ctx.ellipse(x + random() * w, y + random() * h, r * 1.8, r, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Fades the two ends of a strip cell (along u) to transparent. */
function fadeEnds(ctx, [x, y, w, h], share) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const fade = w * share;
    let g = ctx.createLinearGradient(x, 0, x + fade, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, fade, h);
    g = ctx.createLinearGradient(x + w - fade, 0, x + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(x + w - fade, y, fade, h);
    ctx.restore();
}

/**
 * The lit atlas: interiors behind glass, signs, the billboard, the parking levels below, shop fronts. Colours are linear-ish brightness
 * levels for one emissive material (intensity ~4): pure colours become lamps that bloom, ~60 % grey a lit room.
 * @param {string} quality
 */
export function litAtlas(quality) {
    const random = rng(808);
    return atlasCanvas(quality, ctx => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, UNITS, UNITS);
        billboard(ctx, LIT.billboard, random);
        bigSign(ctx, LIT.sign);
        exitSign(ctx, LIT.exit);
        // the blue parking sign
        {
            const [x, y, w, h] = LIT.parking;
            ctx.fillStyle = '#d8dce0';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#1550b8';
            ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 100px Inter, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('P', x + w / 2, y + h / 2 + 6);
        }
        // the level number box ("7")
        {
            const [x, y, w, h] = LIT.level;
            ctx.fillStyle = '#e8b21c';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#161618';
            ctx.font = 'bold 104px Anton, Impact, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('7', x + w / 2, y + h / 2 + 6);
        }
        stairwell(ctx, LIT.stairs, random);
        lobby(ctx, LIT.lobby);
        shops(ctx, LIT.shops, random);
        levels(ctx, LIT.levels, random);
        // a plain lamp face and a warm window
        {
            const [x, y, w, h] = LIT.lamp;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, y, w, h);
            const [wx, wy, ww, wh] = LIT.window;
            const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
            g.addColorStop(0, '#c8a070');
            g.addColorStop(1, '#8a6a44');
            ctx.fillStyle = g;
            ctx.fillRect(wx, wy, ww, wh);
        }
        exitBox(ctx, LIT.exitBox);
        speedLimit(ctx, LIT.limit);
    });
}

/** The billboard on the roof next door: an invented noodle bar ad – glyph lettering in neon, a steaming bowl, a German claim. */
function billboard(ctx, [x, y, w, h], random) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#120a24');
    g.addColorStop(1, '#2a0c2c');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // the frame tube
    neonStroke(ctx, '#ff2e88', 8, () => roundRect(ctx, x + 16, y + 16, w - 32, h - 32, 26));
    // a bowl with steam
    const cx = x + 210;
    const cy = y + 220;
    neonStroke(ctx, '#ffb020', 9, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 120, cy);
        ctx.quadraticCurveTo(cx, cy + 170, cx + 120, cy);
        ctx.closePath();
    });
    neonStroke(ctx, '#ffffff', 6, () => {
        ctx.beginPath();
        for (const dx of [-50, 0, 50]) {
            ctx.moveTo(cx + dx, cy - 20);
            ctx.bezierCurveTo(cx + dx - 30, cy - 60, cx + dx + 30, cy - 90, cx + dx, cy - 130);
        }
    });
    neonStroke(ctx, '#29e7ff', 7, () => {
        ctx.beginPath();
        ctx.moveTo(cx + 40, cy - 150);
        ctx.lineTo(cx + 140, cy - 30);
        ctx.moveTo(cx + 70, cy - 160);
        ctx.lineTo(cx + 160, cy - 40);
    });
    // invented glyph lettering
    ctx.save();
    ctx.lineWidth = 16;
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = 22;
    ctx.strokeStyle = '#ffd6ea';
    for (let k = 0; k < 4; k++) drawGlyph(ctx, random, x + 400 + k * 140, y + 60, 120);
    ctx.restore();
    ctx.fillStyle = '#29e7ff';
    ctx.shadowColor = '#29e7ff';
    ctx.shadowBlur = 16;
    ctx.font = 'bold 62px Anton, Impact, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('NUDELBAR · RUND UM DIE UHR', x + 400, y + 270, w - 440);
    ctx.shadowBlur = 0;
}

/** The "P7" sign of the car park: a backlit box with the blue P and a neon 7. */
function bigSign(ctx, [x, y, w, h]) {
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1450c0';
    roundRect(ctx, x + 40, y + 40, 280, 280, 24);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 250px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', x + 180, y + 192);
    ctx.save();
    ctx.shadowColor = '#29e7ff';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#c8fbff';
    ctx.font = 'bold 300px Anton, Impact, sans-serif';
    ctx.fillText('7', x + 410, y + 196);
    ctx.restore();
    ctx.fillStyle = '#e8eef8';
    ctx.font = 'bold 92px Anton, Impact, sans-serif';
    ctx.fillText('PARKDECK', x + w / 2, y + 410, w - 60);
    neonStroke(ctx, '#29e7ff', 6, () => roundRect(ctx, x + 14, y + 14, w - 28, h - 28, 18));
}

/** The green emergency exit sign: a running figure, a door, an arrow (a generic pictogram, drawn here). */
function exitSign(ctx, [x, y, w, h]) {
    ctx.fillStyle = '#0ea04a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    // the door
    ctx.fillRect(x + 150, y + 18, 70, 92);
    ctx.fillStyle = '#0ea04a';
    ctx.fillRect(x + 160, y + 28, 50, 82);
    // the figure
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 128, y + 30, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 122, y + 48);
    ctx.lineTo(x + 108, y + 78);
    ctx.lineTo(x + 126, y + 104);
    ctx.moveTo(x + 108, y + 78);
    ctx.lineTo(x + 88, y + 98);
    ctx.moveTo(x + 120, y + 54);
    ctx.lineTo(x + 140, y + 70);
    ctx.moveTo(x + 118, y + 54);
    ctx.lineTo(x + 96, y + 60);
    ctx.stroke();
    // the arrow
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(x + 22, y + 64);
    ctx.lineTo(x + 72, y + 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 64);
    ctx.lineTo(x + 38, y + 42);
    ctx.lineTo(x + 38, y + 86);
    ctx.closePath();
    ctx.fill();
}

/** A stairwell seen through glass: cool fluorescent light, the zigzag of the flights, a handrail. */
function stairwell(ctx, [x, y, w, h], random) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#848e90');
    g.addColorStop(1, '#3c4244');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // ceiling tube
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 40, y + 6, w - 80, 8);
    // flights
    ctx.strokeStyle = '#3a4042';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(x, y + h - 20);
    ctx.lineTo(x + w * 0.55, y + h * 0.5);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.moveTo(x + w * 0.45, y + h * 0.5);
    ctx.lineTo(x + w, y + 40);
    ctx.stroke();
    ctx.strokeStyle = '#e8b21c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + h - 60);
    ctx.lineTo(x + w * 0.55, y + h * 0.5 - 40);
    ctx.stroke();
    // grime on the glass
    for (let k = 0; k < 30; k++) {
        ctx.fillStyle = `rgba(40,44,46,${random() * 0.25})`;
        ctx.fillRect(x + random() * w, y + random() * h, 4 + random() * 30, 2 + random() * 40);
    }
}

/** The lift lobby: warm light, the steel lift doors, a call panel. */
function lobby(ctx, [x, y, w, h]) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#9a8c72');
    g.addColorStop(1, '#4a4032');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 30, y + 6, w - 60, 8);
    ctx.fillStyle = '#6c7074';
    ctx.fillRect(x + 60, y + 70, 110, h - 70);
    ctx.fillStyle = '#6c7074';
    ctx.fillRect(x + 114, y + 70, 2, h - 70);
    ctx.fillStyle = '#ffd890';
    ctx.fillRect(x + 186, y + 140, 14, 22);
}

/** Shop fronts at street level: a row of lit windows in different light, shutters, signs. */
function shops(ctx, [x, y, w, h], random) {
    ctx.fillStyle = '#060606';
    ctx.fillRect(x, y, w, h);
    const colours = ['#ffd49a', '#fff0d8', '#d8ecff', '#ffb070', '#ff7ab0', '#7ae8ff', '#c8ffd8'];
    let px = x;
    while (px < x + w - 20) {
        const sw = 50 + random() * 70;
        const shut = random() < 0.3;
        if (!shut) {
            const c = colours[Math.floor(random() * colours.length)];
            ctx.fillStyle = c;
            ctx.globalAlpha = 0.55 + random() * 0.4;
            ctx.fillRect(px + 4, y + 40, sw - 8, h - 46);
            ctx.globalAlpha = 1;
            // a sign band above
            ctx.fillStyle = colours[Math.floor(random() * colours.length)];
            ctx.fillRect(px + 6, y + 12, sw - 12, 18);
        } else {
            ctx.fillStyle = '#26262a';
            ctx.fillRect(px + 4, y + 40, sw - 8, h - 46);
        }
        px += sw;
    }
}

/** A parking level seen from outside: ceiling tubes in rows, columns, the odd car. */
function levels(ctx, [x, y, w, h], random) {
    ctx.fillStyle = '#0e0f10';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(116,124,116,0.5)');
    g.addColorStop(0.5, 'rgba(60,64,60,0.4)');
    g.addColorStop(1, 'rgba(24,26,25,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 24; k++) {
        ctx.fillStyle = '#f4fff4';
        ctx.fillRect(x + k * 43 + 6, y + 2, 24, 4);
    }
    for (let k = 0; k < 8; k++) {
        ctx.fillStyle = '#1a1b1c';
        ctx.fillRect(x + k * 128 + 60, y, 10, h);
    }
    for (let k = 0; k < 14; k++) {
        if (random() < 0.4) continue;
        ctx.fillStyle = `rgba(${20 + random() * 40},${20 + random() * 40},${24 + random() * 40},1)`;
        ctx.fillRect(x + k * 73 + random() * 20, y + h - 22, 44, 18);
    }
}

function neonStroke(ctx, colour, width, path) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = colour;
    ctx.shadowBlur = width * 3;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * 1.8;
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = width * 0.6;
    path();
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

/**
 * Collects quads and strips with atlas UVs (cells in atlas units) and turns them into one indexed mesh.
 * Every quad is given by its centre and two half axes: a (texture +u) and b (texture +v); the face looks along a × b.
 */
export class Batch {
    constructor() {
        this.position = [];
        this.normal = [];
        this.uv = [];
        this.color = [];
        this.index = [];
        /** The vertex colour of the next quads (linear rgb); the mesh gets a colour attribute once any tint was set. */
        this.tint = [1, 1, 1];
        this.tinted = false;
    }

    /** Tints the next quads (multiplies the material colour: use with vertexColors), or back to white with null. */
    setTint(hex) {
        const c = new THREE.Color(hex ?? 0xffffff);
        this.tint = [c.r, c.g, c.b];
        if (hex !== null) this.tinted = true;
    }

    get empty() {
        return this.index.length === 0;
    }

    /** UV rectangle of a cell, optionally a part of it (u0..u1, v0..v1 as fractions of the cell). */
    static rect([x, y, w, h], u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
        const left = x / UNITS;
        const width = w / UNITS;
        const bottom = 1 - (y + h) / UNITS;
        const height = h / UNITS;
        return [left + width * u0, left + width * u1, bottom + height * v0, bottom + height * v1];
    }

    /** A quad: centre c, half axes a and b ({x,y,z}), the uv rectangle [u0, u1, v0, v1]. */
    quad(c, a, b, [u0, u1, v0, v1]) {
        const n = new THREE.Vector3(a.x, a.y, a.z).cross(new THREE.Vector3(b.x, b.y, b.z)).normalize();
        const base = this.position.length / 3;
        const corners = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
        for (const [sa, sb, u, v] of corners) {
            this.position.push(c.x + a.x * sa + b.x * sb, c.y + a.y * sa + b.y * sb, c.z + a.z * sa + b.z * sb);
            this.normal.push(n.x, n.y, n.z);
            this.uv.push(u, v);
            this.color.push(...this.tint);
        }
        this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /**
     * A quad lying on the deck at height y: texture u along (ux, uz) (a unit vector), v to its left as seen from above.
     * @param {number[]} cell atlas cell
     * @param {{ u0?, u1?, v0?, v1?, flipU?: boolean }} [o] a part of the cell, mirrored along u
     */
    floor(x, y, z, ux, uz, halfU, halfV, cell, o = {}) {
        const r = Batch.rect(cell, o.u0, o.u1, o.v0, o.v1);
        if (o.flipU) [r[0], r[1]] = [r[1], r[0]];
        this.quad({ x, y, z }, { x: ux * halfU, y: 0, z: uz * halfU }, { x: uz * halfV, y: 0, z: -ux * halfV }, r);
    }

    /** Lettering on the deck read by someone looking along (fx, fz): the glyph's up points away from the reader. */
    lettering(x, y, z, fx, fz, halfWidth, halfLength, cell) {
        this.floor(x, y, z, -fz, fx, halfWidth, halfLength, cell);
    }

    /** A vertical quad: centre, u along (ux, uz) on the ground, v up; it faces (uz, −ux) – to the right of u. */
    wall(x, y, z, ux, uz, halfU, halfV, cell, o = {}) {
        const r = Batch.rect(cell, o.u0, o.u1, o.v0, o.v1);
        this.quad({ x, y, z }, { x: ux * halfU, y: 0, z: uz * halfU }, { x: 0, y: halfV, z: 0 }, r);
    }

    /** An axis-aligned box (all six faces) with one cell stretched over every face. */
    box(x, y, z, w, h, d, cell) {
        const r = Batch.rect(cell);
        const hw = w / 2;
        const hh = h / 2;
        const hd = d / 2;
        this.quad({ x, y: y + hh, z }, { x: hw, y: 0, z: 0 }, { x: 0, y: 0, z: -hd }, r);
        this.quad({ x, y: y - hh, z }, { x: hw, y: 0, z: 0 }, { x: 0, y: 0, z: hd }, r);
        this.quad({ x, y, z: z + hd }, { x: hw, y: 0, z: 0 }, { x: 0, y: hh, z: 0 }, r);
        this.quad({ x, y, z: z - hd }, { x: -hw, y: 0, z: 0 }, { x: 0, y: hh, z: 0 }, r);
        this.quad({ x: x + hw, y, z }, { x: 0, y: 0, z: -hd }, { x: 0, y: hh, z: 0 }, r);
        this.quad({ x: x - hw, y, z }, { x: 0, y: 0, z: hd }, { x: 0, y: hh, z: 0 }, r);
    }

    /**
     * A strip along a polyline on the deck [{ x, z }] at height y, halfWidth to each side; u runs along the cell from start to end.
     */
    strip(points, y, halfWidth, cell, o = {}) {
        if (points.length < 2) return;
        const [u0, u1, v0, v1] = Batch.rect(cell, o.u0, o.u1, o.v0, o.v1);
        let total = 0;
        const along = [0];
        for (let k = 1; k < points.length; k++) {
            total += Math.hypot(points[k].x - points[k - 1].x, points[k].z - points[k - 1].z);
            along.push(total);
        }
        const base = this.position.length / 3;
        for (let k = 0; k < points.length; k++) {
            const a = points[Math.max(0, k - 1)];
            const b = points[Math.min(points.length - 1, k + 1)];
            const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const tx = (b.x - a.x) / len;
            const tz = (b.z - a.z) / len;
            const p = points[k];
            const w = (p.w ?? 1) * halfWidth;
            const u = u0 + ((u1 - u0) * along[k]) / (total || 1);
            // v1 on the left (tz, −tx), v0 on the right
            this.position.push(p.x - tz * w, y, p.z + tx * w, p.x + tz * w, y, p.z - tx * w);
            this.normal.push(0, 1, 0, 0, 1, 0);
            this.color.push(...this.tint, ...this.tint);
            this.uv.push(u, v0, u, v1);
            if (k < points.length - 1) {
                const i = base + k * 2;
                this.index.push(i, i + 2, i + 3, i, i + 3, i + 1);
            }
        }
    }

    /** The mesh of everything collected (null when empty); the batch can be reused afterwards. */
    mesh(material) {
        if (this.empty) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        if (this.tinted) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        geometry.setIndex(this.position.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
        geometry.computeBoundingSphere();
        this.position = [];
        this.normal = [];
        this.uv = [];
        this.color = [];
        this.index = [];
        this.tint = [1, 1, 1];
        this.tinted = false;
        return new THREE.Mesh(geometry, material);
    }
}

/** Spray-paint tags (invented glyph scribbles, two colours, an outline, a few drips) – for tower walls and the parapet. */
function tags(ctx, cell, random) {
    const [x, y, w, h] = cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const colours = [['#e83a8a', '#1a1a1e'], ['#3ab0e8', '#f4f4f0'], ['#f0d040', '#26262a']];
    const [fill, outline] = colours[Math.floor(random() * colours.length)];
    for (const [stroke, width] of [[outline, 13], [fill, 7]]) {
        const r = rng(9090);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        for (let k = 0; k < 4; k++) drawGlyph(ctx, r, x + 8 + k * 44, y + 14, 52);
    }
    // drips
    ctx.fillStyle = fill;
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 14 + random() * (w - 28), y + 62, 2.5, 8 + random() * 20);
    ctx.restore();
}

/** A small lit box sign: AUSFAHRT with an arrow, white on green. */
function exitBox(ctx, [x, y, w, h]) {
    ctx.fillStyle = '#0c8a40';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e8f4ec';
    ctx.font = 'bold 26px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('AUSFAHRT', x + 8, y + h / 2 + 1, w - 52);
    ctx.beginPath();
    ctx.moveTo(x + w - 34, y + 12);
    ctx.lineTo(x + w - 14, y + 12);
    ctx.lineTo(x + w - 14, y + 6);
    ctx.lineTo(x + w - 4, y + h / 2);
    ctx.lineTo(x + w - 14, y + h - 6);
    ctx.lineTo(x + w - 14, y + h - 12);
    ctx.lineTo(x + w - 34, y + h - 12);
    ctx.closePath();
    ctx.fill();
}

/** A round speed limit sign (10), dimmer than a lamp: it only catches the light. */
function speedLimit(ctx, [x, y, w, h]) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.fillStyle = '#7a1418';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5e5e5c';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c0c0c';
    ctx.font = 'bold 18px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10', cx, cy + 1);
}
