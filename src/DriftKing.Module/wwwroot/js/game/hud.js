// DriftKing · hud.js – the head-up display of a run (inside #dk-hud): position, lap and times top left; timer, score and the goals of a
// competition top centre; the live standings top right; the drift chain with its multiplier and popups in the middle; the minimap bottom left;
// the drift-angle gauge bottom centre; speed, gear, rev bar, pedals and steering bottom right; countdown and banners on top.
// Text is written only when it changes; the whole HUD updates ~30 times a second.

import { formatPoints, formatTime } from './catalog.js';
import { settings } from './settings.js';

const MEDALS = [['gold', 'Gold'], ['silver', 'Silber'], ['bronze', 'Bronze']];

/**
 * Builds the HUD in host.
 * @param {HTMLElement} host
 * @param {{ mode: 'freeride'|'score'|'race', laps: number, durationS: number, goals: null|{ metric:'score'|'time', bronze:number, silver:number, gold:number },
 *           course: import('./world/course.js').Course, mapName: string }} options
 */
export function createHud(host, { mode, laps, durationS, goals, course, mapName }) {
    host.innerHTML = template(mode, goals, mapName);
    host.hidden = false;
    host.dataset.mode = mode;
    const $ = name => host.querySelector(`[data-hud="${name}"]`);
    const text = new Map();
    const set = (name, value) => {
        if (text.get(name) === value) return;
        text.set(name, value);
        const el = $(name);
        if (el) el.textContent = value;
    };
    const minimap = createMinimap($('minimap'), course);
    const needle = $('needle');
    const maxMark = $('max');
    const rpmFill = $('rpm-fill');
    const bars = { throttle: $('gas'), brake: $('brake'), handbrake: $('hand') };
    const steer = $('steer');
    const chain = $('chain');
    const popups = $('popups');
    let popupAt = -Infinity;
    let popupRow = 0;
    const standings = $('standings');
    const goalFill = $('goal-fill');
    let lastStandings = '';
    let lastMinimap = 0;
    let unit = settings.get().unit;
    const unsubscribe = settings.onChange(s => {
        unit = s.unit;
        host.classList.toggle('hud--no-map', !s.minimap);
    });
    host.classList.toggle('hud--no-map', !settings.get().minimap);
    if (goals) layoutGoals(host, goals);

    return {
        /** Every frame with the numbers of the own car and the run (see run.js). */
        update(d) {
            const speed = unit === 'mph' ? d.speedKmh * 0.6214 : d.speedKmh;
            set('speed', String(Math.round(speed)));
            set('unit', unit === 'mph' ? 'MPH' : 'KM/H');
            set('gear', d.reverse ? 'R' : String(d.gear));
            const rpm = Math.min(1, d.rpm / d.rpmMax);
            rpmFill.style.clipPath = `inset(0 ${(100 - rpm * 100).toFixed(1)}% 0 0)`;
            host.classList.toggle('hud--limiter', rpm > 0.97);
            bars.throttle.style.transform = `scaleY(${d.throttle.toFixed(2)})`;
            bars.brake.style.transform = `scaleY(${d.brake.toFixed(2)})`;
            bars.handbrake.style.transform = `scaleY(${d.handbrake.toFixed(2)})`;
            steer.style.transform = `translateX(${(d.steer * 50).toFixed(1)}%)`;
            const angle = Math.max(-90, Math.min(90, d.angle));
            needle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
            maxMark.style.transform = `rotate(${(Math.sign(angle || 1) * Math.min(90, d.chainMaxAngle)).toFixed(1)}deg)`;
            set('angle', `${Math.round(Math.abs(angle))}°`);
            host.classList.toggle('hud--drifting', d.drifting);

            set('total', formatPoints(d.total));
            set('chain-points', d.chain > 0 ? `+${formatPoints(d.chain)}` : '');
            set('chain-mult', d.chain > 0 ? `×${d.multiplier}` : '');
            chain.classList.toggle('is-live', d.chain > 0);
            chain.dataset.mult = String(d.multiplier);
            set('tags', [d.wall ? 'WANDKUSS ×1,25' : '', d.tandem ? 'TANDEM ×1,5' : ''].filter(Boolean).join('  ·  '));

            if (mode === 'score') set('timer', formatClock(d.remainingMs));
            else if (mode === 'race') set('timer', formatTime(Math.max(0, d.timeMs)));
            else set('timer', formatClock(Math.max(0, d.timeMs)));
            host.classList.toggle('hud--hurry', mode === 'score' && d.remainingMs < 10000 && d.remainingMs > 0);
            set('pos', String(d.position));
            set('count', `/${d.count}`);
            set('lap', String(Math.min(d.lap + 1, laps)));
            set('laps', `/${laps}`);
            set('lap-time', formatTime(d.lapTimeMs));
            set('best-lap', d.bestLapMs ? formatTime(d.bestLapMs) : '–');
            set('wrong', d.wrongWay ? 'FALSCHE RICHTUNG' : '');

            if (goals) updateGoals(host, goals, d, goalFill, mode);
            const key = d.standings.map(s => `${s.seat}:${s.name}:${s.value}`).join('|');
            if (key !== lastStandings) {
                lastStandings = key;
                standings.innerHTML = d.standings
                    .slice(0, 5)
                    .map((s, k) => `<li class="${s.me ? 'is-me' : ''}"><b>${k + 1}</b><span>${escape(s.name)}</span><i>${s.value}</i></li>`)
                    .join('');
            }
            const now = performance.now();
            if (now - lastMinimap > 50) {
                lastMinimap = now;
                minimap?.draw(d.cars);
            }
        },

        /** A drift event (drift.js): popups for banked points, crashes, wall and tandem bonus, a new multiplier. */
        event(e) {
            const label = {
                bank: () => [`+${formatPoints(e.points)}`, 'bank'],
                crash: () => ['CRASH', 'crash'],
                wall: () => ['WANDKUSS ×1,25', 'wall'],
                tandem: () => ['TANDEM ×1,5', 'tandem'],
                multiplier: () => [`×${e.value}`, 'mult'],
                lap: () => [e.best ? `RUNDE ${formatTime(e.timeMs)} · BESTZEIT` : `RUNDE ${formatTime(e.timeMs)}`, 'lap'],
            }[e.kind]?.();
            if (!label) return;
            const el = document.createElement('div');
            el.className = `hud-popup hud-popup--${label[1]}`;
            el.textContent = label[0];
            // popups that come together (wall and tandem in the same moment) stack downwards instead of on top of each other
            const now = performance.now();
            popupRow = now - popupAt < 600 ? (popupRow + 1) % 3 : 0;
            popupAt = now;
            if (popupRow) el.style.top = `${popupRow * 32}px`;
            el.addEventListener('animationend', () => el.remove());
            popups.appendChild(el);
            while (popups.children.length > 4) popups.firstChild.remove();
        },

        /** 3, 2, 1, 0 (= "LOS!"), null hides it. */
        countdown(n) {
            const el = $('countdown');
            if (n === null) {
                el.hidden = true;
                return;
            }
            el.hidden = false;
            el.textContent = n === 0 ? 'LOS!' : String(n);
            el.classList.toggle('is-go', n === 0);
            el.classList.remove('is-tick');
            void el.offsetWidth;
            el.classList.add('is-tick');
        },

        /** A big banner ("ZIEL", "ZEIT UM") with a line below; null hides it. */
        banner(title, sub = '') {
            const el = $('banner');
            el.hidden = title === null;
            if (title === null) return;
            el.querySelector('b').textContent = title;
            el.querySelector('span').textContent = sub;
        },

        dispose() {
            unsubscribe();
            host.innerHTML = '';
            host.hidden = true;
            host.className = 'hud';
            delete host.dataset.mode;
        },
    };
}

function template(mode, goals, mapName) {
    const ticks = [];
    for (let a = -90; a <= 90; a += 15) {
        const long = a % 45 === 0;
        ticks.push(`<line x1="120" y1="${long ? 16 : 22}" x2="120" y2="30" transform="rotate(${a} 120 120)" class="${long ? 'long' : ''}"/>`);
    }
    return `
    <div class="hud-tl">
        <div class="hud-box hud-pos"><span class="hud-label">POS</span><b data-hud="pos">1</b><i data-hud="count">/1</i></div>
        <div class="hud-box hud-lapbox"><span class="hud-label">RUNDE</span><b data-hud="lap">1</b><i data-hud="laps">/1</i></div>
        <div class="hud-box hud-times">
            <div><span class="hud-label">RUNDE</span><b data-hud="lap-time">0:00.000</b></div>
            <div><span class="hud-label">BESTE</span><b data-hud="best-lap">–</b></div>
        </div>
    </div>
    <div class="hud-tc">
        <div class="hud-map-name">${escape(mapName ?? '')}</div>
        <div class="hud-timer" data-hud="timer">0:00</div>
        <div class="hud-score"><b data-hud="total">0</b><span>PUNKTE</span></div>
        ${goals ? `<div class="hud-goals" data-metric="${goals.metric}"><div class="hud-goals__track"><div class="hud-goals__fill" data-hud="goal-fill"></div></div>
            ${MEDALS.map(([key, name]) => `<div class="hud-goal hud-goal--${key}" data-goal="${key}"><i></i><span>${name}</span><b></b></div>`).join('')}</div>` : ''}
    </div>
    <ol class="hud-standings" data-hud="standings"></ol>
    <div class="hud-chain" data-hud="chain">
        <div class="hud-chain__points" data-hud="chain-points"></div>
        <div class="hud-chain__mult" data-hud="chain-mult"></div>
        <div class="hud-chain__tags" data-hud="tags"></div>
    </div>
    <div class="hud-popups" data-hud="popups"></div>
    <div class="hud-wrong" data-hud="wrong"></div>
    <div class="hud-minimap"><canvas data-hud="minimap"></canvas></div>
    <div class="hud-angle">
        <svg viewBox="0 0 240 132" aria-hidden="true">
            <path class="hud-angle__track" d="M 22 120 A 98 98 0 0 1 218 120" />
            <path class="hud-angle__zone hud-angle__zone--grip" d="${arc(-12, 12)}" />
            <path class="hud-angle__zone hud-angle__zone--drift" d="${arc(-70, -12)} ${arc(12, 70)}" />
            <path class="hud-angle__zone hud-angle__zone--over" d="${arc(-90, -70)} ${arc(70, 90)}" />
            <g class="hud-angle__ticks">${ticks.join('')}</g>
            <g data-hud="max" class="hud-angle__max"><path d="M 120 10 l -6 -9 h 12 z" /></g>
            <g data-hud="needle" class="hud-angle__needle"><path d="M 117.5 92 L 120 26 L 122.5 92 Z" /><circle cx="120" cy="92" r="3" /></g>
        </svg>
        <div class="hud-angle__value"><b data-hud="angle">0°</b><span>DRIFTWINKEL</span></div>
    </div>
    <div class="hud-cluster">
        <div class="hud-rpm"><div class="hud-rpm__fill" data-hud="rpm-fill"></div><div class="hud-rpm__red"></div></div>
        <div class="hud-cluster__main">
            <div class="hud-speed"><b data-hud="speed">0</b><span data-hud="unit">KM/H</span></div>
            <div class="hud-gear"><span class="hud-label">GANG</span><b data-hud="gear">1</b></div>
            <div class="hud-pedals">
                <div class="hud-pedal hud-pedal--brake"><i data-hud="brake"></i><span>B</span></div>
                <div class="hud-pedal hud-pedal--hand"><i data-hud="hand"></i><span>H</span></div>
                <div class="hud-pedal hud-pedal--gas"><i data-hud="gas"></i><span>G</span></div>
            </div>
        </div>
        <div class="hud-steer"><i data-hud="steer"></i></div>
    </div>
    <div class="hud-countdown" data-hud="countdown" hidden></div>
    <div class="hud-banner" data-hud="banner" hidden><b></b><span></span></div>
    <span hidden data-mode="${mode}"></span>`;
}

/** The medal marks: for points along a bar, for times as a list of targets. */
function layoutGoals(host, goals) {
    for (const [key] of MEDALS) {
        const el = host.querySelector(`[data-goal="${key}"]`);
        el.querySelector('b').textContent = goals.metric === 'time' ? formatTime(goals[key]) : formatPoints(goals[key]);
        if (goals.metric === 'score') el.style.left = `${Math.min(100, (goals[key] / (goals.gold * 1.12)) * 100)}%`;
    }
}

function updateGoals(host, goals, d, fill, mode) {
    if (goals.metric === 'score') {
        const value = d.total + d.chain;
        fill.style.transform = `scaleX(${Math.min(1, value / (goals.gold * 1.12)).toFixed(3)})`;
        for (const [key] of MEDALS) host.querySelector(`[data-goal="${key}"]`).classList.toggle('is-reached', value >= goals[key]);
    } else {
        const elapsed = mode === 'race' ? d.timeMs : 0;
        for (const [key] of MEDALS) host.querySelector(`[data-goal="${key}"]`).classList.toggle('is-lost', elapsed > goals[key]);
    }
}

/** The minimap: the course as a line, every car as a dot (the own one bigger, pink). */
function createMinimap(canvas, course) {
    if (!canvas || !course) return null;
    const size = 180;
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const g = canvas.getContext('2d');
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < course.count; i++) {
        minX = Math.min(minX, course.x[i]);
        maxX = Math.max(maxX, course.x[i]);
        minZ = Math.min(minZ, course.z[i]);
        maxZ = Math.max(maxZ, course.z[i]);
    }
    const scale = ((size - 24) * ratio) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size * ratio - (maxX - minX) * scale) / 2;
    const oz = (size * ratio - (maxZ - minZ) * scale) / 2;
    // seen from above, north (−z) at the top, +x to the right (like the top view of the map preview)
    const px = x => ox + (x - minX) * scale;
    const pz = z => oz + (z - minZ) * scale;
    const path = new Path2D();
    for (let i = 0; i <= course.count; i += 3) {
        const k = i % course.count;
        if (i === 0) path.moveTo(px(course.x[k]), pz(course.z[k]));
        else path.lineTo(px(course.x[k]), pz(course.z[k]));
    }
    path.closePath();
    const start = course.at(0);
    return {
        draw(cars) {
            g.clearRect(0, 0, canvas.width, canvas.height);
            g.lineJoin = 'round';
            g.strokeStyle = 'rgba(10,8,24,0.85)';
            g.lineWidth = 9 * ratio;
            g.stroke(path);
            g.strokeStyle = 'rgba(200,196,240,0.75)';
            g.lineWidth = 3.2 * ratio;
            g.stroke(path);
            g.fillStyle = '#f4f2ff';
            g.fillRect(px(start.x) - 3 * ratio, pz(start.z) - 3 * ratio, 6 * ratio, 6 * ratio);
            for (const car of cars) {
                if (car.me) continue;
                g.fillStyle = car.color ?? '#29e7ff';
                g.beginPath();
                g.arc(px(car.x), pz(car.z), 3.6 * ratio, 0, Math.PI * 2);
                g.fill();
            }
            const me = cars.find(c => c.me);
            if (me) {
                g.save();
                g.translate(px(me.x), pz(me.z));
                // the arrow points along +y; turned by −yaw it points along the heading (sin yaw, cos yaw)
                g.rotate(-me.yaw);
                g.fillStyle = '#ff2e88';
                g.shadowColor = '#ff2e88';
                g.shadowBlur = 8 * ratio;
                g.beginPath();
                g.moveTo(0, 7 * ratio);
                g.lineTo(5 * ratio, -5 * ratio);
                g.lineTo(-5 * ratio, -5 * ratio);
                g.closePath();
                g.fill();
                g.restore();
            }
        },
    };
}

/** An arc of the angle gauge from angle a0 to a1 (degrees from straight up, clockwise). */
function arc(a0, a1, r = 98) {
    const point = a => `${(120 + r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(120 - r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
    return `M ${point(a0)} A ${r} ${r} 0 0 1 ${point(a1)}`;
}

/** Milliseconds as m:ss (timers). */
function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
