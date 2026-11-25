#!/usr/bin/env node
// Writes the logo of DriftKing in its levels of detail (docs/logo and src/DriftKing.Module/wwwroot/img/logo, the favicon of wwwroot):
//   mark      the full mark (64 x 64): a night tile, a neon crown riding on a drift line – two tyre tracks sweeping through the turn,
//             a puff of tyre smoke behind, the crown's jewels as neon dots (pink, cyan), a soft glow
//   favicon   the small mark (32 x 32) for 16-32 px: tile, a three-point crown and one thick drift line, no smoke, no glow
//   maskable  full-bleed night square, crown and line inside the safe zone (the inner 80 % circle of Android adaptive icons)
//   mono      one colour (currentColor): crown and line only, for places that tint it
//   logo      the mark with the word mark "DRIFTKING" (Anton as paths, slanted like speed) for light surfaces: DRIFT in night ink, KING in pink
//   logo-dark the same for dark surfaces: DRIFT in white, KING in neon pink with glow, cyan speed streaks
//   hero      the wide picture (1200 x 630): night sky, a skyline with lit windows, the road vanishing into the night, the mark, the word mark, the tagline
// The word mark is converted to paths with fontkit (npm install in tools/ once), so the SVGs need no web font.
// The PNG icons, the Windows icon and the hero/cover PNGs are made from these files with scripts/icons.ps1 (Edge headless).
//   node scripts/logo.js
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
const fontkit = createRequire(path.join(root, 'tools', 'package.json'))('fontkit');
const anton = fontkit.openSync(path.join(root, 'src', 'DriftKing.Module', 'wwwroot', 'fonts', 'anton-regular.woff2'));

const night = '#0b0a18';
const night2 = '#1e1b3a';
const ink = '#16151f';
const white = '#f4f2ff';
const pink = '#ff2e88';
const pinkDeep = '#c0135f';
const cyan = '#29e7ff';
const amber = '#ffb020';

const n = v => String(Math.round(v * 100) / 100);

/** The text as one SVG path in Anton (baseline at y, left at x, cap height ~ size * 0.72). */
function textPath(text, x, y, size, slant = 0) {
  const run = anton.layout(text);
  const scale = size / anton.unitsPerEm;
  let pen = 0;
  const parts = [];
  run.glyphs.forEach((glyph, i) => {
    const commands = glyph.path.commands;
    let d = '';
    for (const c of commands) {
      const pts = [];
      for (let k = 0; k < c.args.length; k += 2) {
        const gx = c.args[k];
        const gy = c.args[k + 1];
        const px = x + (pen + gx) * scale + gy * scale * slant;
        const py = y - gy * scale;
        pts.push(`${n(px)} ${n(py)}`);
      }
      const op = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }[c.command];
      d += op + pts.join(' ');
    }
    parts.push(d);
    pen += run.positions[i].xAdvance;
  });
  return { d: parts.join(''), width: pen * scale };
}

// ---- the parts of the mark (in a 64 x 64 box) ----

/** The crown: a band and three points, the middle one tallest. */
const crownPath = 'M17 33 L14 17 L24.5 25 L32 12 L39.5 25 L50 17 L47 33 Z';
const crownBand = 'M17 33 H47 L46 37.5 H18 Z';

/** The drift line: two tyre tracks sweeping from the lower left through the turn to the right. */
const trackOuter = 'M7 55 C 16 44, 30 41, 44 43 S 58 49, 61 46';
const trackInner = 'M10 60 C 20 50, 33 47.5, 46 49.5 S 58 54, 62 51.5';

function defs(id) {
  return `<defs>
    <linearGradient id="${id}-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night2}"/><stop offset="1" stop-color="${night}"/></linearGradient>
    <linearGradient id="${id}-crown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6fae"/><stop offset="1" stop-color="${pink}"/></linearGradient>
    <linearGradient id="${id}-track" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${cyan}" stop-opacity="0"/><stop offset=".35" stop-color="${cyan}"/><stop offset="1" stop-color="${cyan}"/></linearGradient>
    <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="${id}-smoke"><stop offset="0" stop-color="${white}" stop-opacity=".22"/><stop offset="1" stop-color="${white}" stop-opacity="0"/></radialGradient>
  </defs>`;
}

/** The inside of the full mark (tile excluded), at its 64-box coordinates. */
function markBody(id) {
  return `
  <circle cx="11" cy="50" r="9" fill="url(#${id}-smoke)"/>
  <circle cx="6" cy="44" r="6" fill="url(#${id}-smoke)"/>
  <g filter="url(#${id}-glow)" fill="none" stroke-linecap="round">
    <path d="${trackOuter}" stroke="url(#${id}-track)" stroke-width="3.2"/>
    <path d="${trackInner}" stroke="url(#${id}-track)" stroke-width="3.2" opacity=".75"/>
  </g>
  <g filter="url(#${id}-glow)">
    <path d="${crownPath}" fill="url(#${id}-crown)" stroke="${white}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="${crownBand}" fill="${pinkDeep}" stroke="${white}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="14" cy="17" r="2.4" fill="${cyan}"/>
    <circle cx="32" cy="12" r="2.8" fill="${amber}"/>
    <circle cx="50" cy="17" r="2.4" fill="${cyan}"/>
    <circle cx="32" cy="29" r="2" fill="${night}"/>
  </g>`;
}

function mark() {
  const id = 'dkm';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="DriftKing">
  ${defs(id)}
  <rect width="64" height="64" rx="14" fill="url(#${id}-tile)"/>
  <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${pink}" stroke-opacity=".35" stroke-width="1"/>${markBody(id)}
</svg>
`;
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="DriftKing">
  <rect width="32" height="32" rx="7" fill="${night2}"/>
  <path d="M3.5 28 C 9 22, 17 20.5, 29 23" fill="none" stroke="${cyan}" stroke-width="3" stroke-linecap="round"/>
  <path d="M8 18.5 L6 8 L12.2 12.8 L16 5 L19.8 12.8 L26 8 L24 18.5 Z" fill="${pink}" stroke="${white}" stroke-width="1.3" stroke-linejoin="round"/>
</svg>
`;
}

function maskable() {
  const id = 'dkx';
  // the 64-box body scaled into the safe zone of a 512 square (inner 80 % circle: the body fits a 300 box centred)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="DriftKing">
  ${defs(id)}
  <rect width="512" height="512" fill="url(#${id}-tile)"/>
  <g transform="translate(106 100) scale(4.7)">${markBody(id)}
  </g>
</svg>
`;
}

function mono() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="DriftKing" fill="currentColor">
  <path d="${crownPath}"/>
  <path d="${crownBand}"/>
  <circle cx="14" cy="17" r="2.6"/><circle cx="32" cy="12" r="3"/><circle cx="50" cy="17" r="2.6"/>
  <g fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="${trackOuter}"/><path d="${trackInner}"/></g>
</svg>
`;
}

/** The word mark next to the mark: dark = for dark surfaces. */
function logo(dark) {
  const id = dark ? 'dkld' : 'dkll';
  const size = 64;
  const slant = 0.18;
  const drift = textPath('DRIFT', 84, 62, size, slant);
  const king = textPath('KING', 84 + drift.width + 4, 62, size, slant);
  const width = Math.ceil(84 + drift.width + 4 + king.width + 18);
  const streaks = dark
    ? `<g stroke="${cyan}" stroke-linecap="round" filter="url(#${id}-glow)"><path d="M86 74 H${n(84 + drift.width * 0.9)}" stroke-width="2.4"/><path d="M${n(84 + drift.width * 0.35)} 79 H${n(width - 30)}" stroke-width="1.6" opacity=".7"/></g>`
    : `<g stroke="${pink}" stroke-linecap="round"><path d="M86 74 H${n(84 + drift.width * 0.9)}" stroke-width="2.4"/><path d="M${n(84 + drift.width * 0.35)} 79 H${n(width - 30)}" stroke-width="1.6" opacity=".55"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 84" width="${width}" height="84" role="img" aria-label="DriftKing">
  ${defs(id)}
  <g transform="translate(4 10)">
    <rect width="64" height="64" rx="14" fill="url(#${id}-tile)"/>${markBody(id)}
  </g>
  <path d="${drift.d}" fill="${dark ? white : ink}"/>
  <path d="${king.d}" fill="${pink}"${dark ? ` filter="url(#${id}-glow)"` : ''}/>
  ${streaks}
</svg>
`;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function hero() {
  const id = 'dkh';
  const W = 1200;
  const H = 630;
  const random = rng(86);
  const horizon = 400;
  // a skyline: blocks of different heights with lit windows
  let skyline = '';
  let windows = '';
  for (let x = -20; x < W + 40;) {
    const w = 40 + random() * 70;
    const h = 90 + random() * 210 * (x > 380 && x < 820 ? 0.55 : 1);
    const top = horizon - h;
    skyline += `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(h)}"/>`;
    for (let wy = top + 10; wy < horizon - 12; wy += 13) {
      for (let wx = x + 6; wx < x + w - 8; wx += 11) {
        if (random() < 0.32) {
          const colour = random() < 0.12 ? pink : random() < 0.2 ? cyan : '#ffd98a';
          windows += `<rect x="${n(wx)}" y="${n(wy)}" width="5" height="6" fill="${colour}" opacity="${n(0.35 + random() * 0.5)}"/>`;
        }
      }
    }
    x += w + 4 + random() * 10;
  }
  // the road: perspective lines to the vanishing point
  const vx = W / 2;
  let road = '';
  for (let i = -8; i <= 8; i++) {
    road += `<path d="M${vx} ${horizon} L${n(vx + i * 170)} ${H}" stroke="${i === 0 ? amber : cyan}" stroke-opacity="${i === 0 ? 0.5 : 0.18}" stroke-width="${i === 0 ? 3 : 1.5}"/>`;
  }
  for (let k = 1; k <= 7; k++) {
    const y = horizon + (H - horizon) * Math.pow(k / 7, 2.1);
    road += `<path d="M0 ${n(y)} H${W}" stroke="${cyan}" stroke-opacity="${n(0.08 + k * 0.025)}" stroke-width="1.5"/>`;
  }
  const size = 132;
  const slant = 0.18;
  const drift = textPath('DRIFT', 0, 0, size, slant);
  const king = textPath('KING', 0, 0, size, slant);
  const total = drift.width + 8 + king.width;
  const x0 = (W - total) / 2 + 70;
  const baseline = 322;
  const driftAt = textPath('DRIFT', x0, baseline, size, slant);
  const kingAt = textPath('KING', x0 + drift.width + 8, baseline, size, slant);
  const tagline = textPath('QUER DURCH DIE NACHT', 0, 0, 34, 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="DriftKing – Quer durch die Nacht">
  ${defs(id)}
  <defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07061a"/><stop offset=".55" stop-color="#241848"/><stop offset="1" stop-color="#4a1d5e"/></linearGradient>
    <linearGradient id="${id}-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1236"/><stop offset="1" stop-color="${night}"/></linearGradient>
    <radialGradient id="${id}-moon"><stop offset="0" stop-color="#ffe9f3"/><stop offset=".5" stop-color="${pink}" stop-opacity=".35"/><stop offset="1" stop-color="${pink}" stop-opacity="0"/></radialGradient>
    <filter id="${id}-big" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>
  <circle cx="${vx}" cy="${horizon - 40}" r="230" fill="url(#${id}-moon)"/>
  <g fill="#120d28">${skyline}</g>
  <g>${windows}</g>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#${id}-ground)"/>
  <g>${road}</g>
  <g transform="translate(${n(x0 - 190)} 168) scale(2.6)">
    <rect width="64" height="64" rx="14" fill="url(#${id}-tile)"/>
    <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${pink}" stroke-opacity=".5"/>${markBody(id)}
  </g>
  <path d="${driftAt.d}" fill="${white}" filter="url(#${id}-big)"/>
  <path d="${kingAt.d}" fill="${pink}" filter="url(#${id}-big)"/>
  <path d="M${n(x0 + 6)} 346 H${n(x0 + total * 0.85)}" stroke="${cyan}" stroke-width="5" stroke-linecap="round" filter="url(#${id}-glow)"/>
  <path d="M${n(x0 + total * 0.3)} 358 H${n(x0 + total)}" stroke="${cyan}" stroke-width="3" stroke-linecap="round" opacity=".6"/>
  <g transform="translate(${n(x0 + total - tagline.width)} 408)"><path d="${tagline.d}" fill="${cyan}" filter="url(#${id}-glow)"/></g>
</svg>
`;
}

const files = {
  'driftking-mark.svg': mark(),
  'driftking-favicon.svg': favicon(),
  'driftking-maskable.svg': maskable(),
  'driftking-mono.svg': mono(),
  'driftking-logo.svg': logo(false),
  'driftking-logo-dark.svg': logo(true),
  'driftking-hero.svg': hero(),
};

const targets = [path.join(root, 'docs', 'logo'), path.join(root, 'src', 'DriftKing.Module', 'wwwroot', 'img', 'logo')];
for (const dir of targets) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), svg);
  }
}
fs.writeFileSync(path.join(root, 'src', 'DriftKing.Module', 'wwwroot', 'favicon.svg'), files['driftking-favicon.svg']);
console.log(`DriftKing logo: ${Object.keys(files).length} files → ${targets.map(t => path.relative(root, t)).join(', ')} and wwwroot/favicon.svg`);
