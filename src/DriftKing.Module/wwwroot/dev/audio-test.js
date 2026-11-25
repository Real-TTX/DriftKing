// DriftKing · dev/audio-test.js – the offline self-test of js/game/audio.js (used by dev/audio.html). Renders scenes with an
// OfflineAudioContext – no speakers, no user gesture, the same nodes the game uses – drives the voices every 1/60 s like the game's frames
// (suspend/resume) and measures the result: finite samples, peak and RMS, the engine's firing frequency against rpm × cylinders / 120,
// tyre squeal against slip, the limiter's stutter rate, the shift dip, turbo whistle and blow-off, pops (also driven by the exhaust flames),
// distance, stereo, Doppler, the reverb of a space, levels and the ceiling – and a test drive with the real car physics (read only).

import { createMixer, ENGINE_LAYOUTS } from '../js/game/audio.js';
import { CarPhysics, REDLINE_RPM } from '../js/game/car/physics.js';
import { showcaseCar } from '../js/game/car/showcase.js';

export const RATE = 48000;
const FRAME = 1 / 60;

/**
 * Renders a scene offline.
 * @param {number} seconds
 * @param {(mixer: object, ctx: OfflineAudioContext) => object} setup builds the voices; returns the state step() gets
 * @param {(state: object, t: number, mixer: object) => void} step called at t = 0 and then every 1/60 s
 * @param {{ volume?: number, music?: number }} [options]
 */
export async function render(seconds, setup, step, { volume = 0.8, music = 0 } = {}) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
    const mixer = createMixer(ctx, { volume, music });
    const state = setup(mixer, ctx) ?? {};
    step(state, 0, mixer);
    for (let k = 1; k * FRAME < seconds - 0.02; k++) {
        ctx.suspend(k * FRAME).then(() => {
            step(state, ctx.currentTime, mixer);
            ctx.resume();
        });
    }
    const started = performance.now();
    const buffer = await ctx.startRendering();
    return { buffer, state, mixer, renderMs: performance.now() - started };
}

// ---- analysis

/** One channel (or the mean of all) between two times (s). */
export function samples(buffer, from = 0, to = buffer.duration, channel = -1) {
    const a = Math.max(0, Math.floor(from * buffer.sampleRate));
    const b = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
    const out = new Float32Array(Math.max(0, b - a));
    const channels = channel >= 0 ? [channel] : [...Array(buffer.numberOfChannels).keys()];
    for (const c of channels) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < out.length; i++) out[i] += data[a + i] / channels.length;
    }
    return out;
}

export function rms(x) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt(sum / Math.max(1, x.length));
}

export function peak(x) {
    let max = 0;
    for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
    return max;
}

export function db(v) {
    return 20 * Math.log10(Math.max(v, 1e-12));
}

/** Non-finite samples over all channels. */
export function nonFinite(buffer) {
    let bad = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) bad++;
    }
    return bad;
}

function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci;
                const ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                const next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
    }
}

/** Power spectrum (Hann window, zero-padded to a power of two ≥ the signal). */
export function spectrum(x) {
    let n = 1;
    while (n < x.length) n <<= 1;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
    fft(re, im);
    const power = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    return { power, binHz: RATE / n };
}

/** Energy between two frequencies (dB, relative). */
export function band(spec, lo, hi) {
    let sum = 0;
    for (let i = Math.ceil(lo / spec.binHz); i <= Math.floor(hi / spec.binHz) && i < spec.power.length; i++) sum += spec.power[i];
    return 10 * Math.log10(Math.max(sum, 1e-24));
}

/** The strongest bin between two frequencies, refined by a parabola through its neighbours: { hz, db }. */
export function peakIn(spec, lo, hi) {
    let best = -1;
    for (let i = Math.max(1, Math.ceil(lo / spec.binHz)); i <= Math.floor(hi / spec.binHz) && i < spec.power.length - 1; i++) {
        if (best < 0 || spec.power[i] > spec.power[best]) best = i;
    }
    if (best < 0) return { hz: 0, db: -240 };
    const [a, b, c] = [spec.power[best - 1], spec.power[best], spec.power[best + 1]].map(p => 10 * Math.log10(Math.max(p, 1e-24)));
    const offset = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    return { hz: (best + offset) * spec.binHz, db: b };
}

/** The median level between two frequencies (the floor around a peak). */
function medianDb(spec, lo, hi) {
    const values = [];
    for (let i = Math.ceil(lo / spec.binHz); i <= Math.floor(hi / spec.binHz); i++) values.push(10 * Math.log10(Math.max(spec.power[i], 1e-24)));
    values.sort((p, q) => p - q);
    return values[Math.floor(values.length / 2)] ?? -240;
}

/** Width (Hz) of a peak where the smoothed spectrum stays within 6 dB of its top. */
function peakWidth(spec, hz) {
    const smooth = i => {
        let sum = 0;
        for (let k = -3; k <= 3; k++) sum += spec.power[Math.max(0, i + k)];
        return sum / 7;
    };
    const top = Math.round(hz / spec.binHz);
    const limit = smooth(top) / 4;
    let lo = top;
    let hi = top;
    while (lo > 1 && smooth(lo - 1) > limit) lo--;
    while (hi < spec.power.length - 2 && smooth(hi + 1) > limit) hi++;
    return (hi - lo + 1) * spec.binHz;
}

/** RMS envelope in windows of `ms`. */
function envelope(x, ms) {
    const size = Math.round((RATE * ms) / 1000);
    const out = [];
    for (let i = 0; i + size <= x.length; i += size) out.push(rms(x.subarray(i, i + size)));
    return out;
}

/** The strongest modulation frequency of an envelope (Hz) between lo and hi. */
function modulationPeak(env, rate, lo, hi) {
    const mean = env.reduce((s, v) => s + v, 0) / env.length;
    let best = { hz: 0, power: -1 };
    for (let f = lo; f <= hi; f += 0.25) {
        let re = 0;
        let im = 0;
        env.forEach((v, i) => {
            re += (v - mean) * Math.cos((2 * Math.PI * f * i) / rate);
            im += (v - mean) * Math.sin((2 * Math.PI * f * i) / rate);
        });
        const power = re * re + im * im;
        if (power > best.power) best = { hz: f, power };
    }
    return best.hz;
}

/** Pearson correlation of [x, y] pairs. */
function pearson(pairs) {
    const n = pairs.length;
    const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
    const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [x, y] of pairs) {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) ** 2;
        syy += (y - my) ** 2;
    }
    return sxy / Math.sqrt(Math.max(sxx * syy, 1e-24));
}

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const fmt = (v, digits = 1) => v.toFixed(digits).replace('.', ',');

// ---- the tests

/** The firing frequency must be the dominant low component: rpm / 60 × cylinders / 2. */
async function pitchCase(layout, rpm) {
    const { buffer } = await render(1.35, m => ({ voice: m.engine({ own: true, layout, seed: 3 }) }), s => s.voice.update({ rpm, throttle: 0.7, speed: 0 }), { volume: 1 });
    const spec = spectrum(samples(buffer, 0.6, 0.6 + 32768 / RATE));
    const f = (rpm / 60) * (ENGINE_LAYOUTS[layout].cylinders / 2);
    const main = peakIn(spec, f * 0.85, f * 1.15);
    const below = peakIn(spec, Math.max(12, f * 0.3), f * 0.85);
    const floor = medianDb(spec, f * 0.5, f * 2);
    const error = (main.hz - f) / f;
    return {
        group: 'Motor: Zündfrequenz folgt der Drehzahl',
        name: `${layout} · ${rpm} U/min`,
        pass: Math.abs(error) < 0.025 && main.db > below.db && main.db - floor > 15,
        value: `${fmt(main.hz)} Hz (soll ${fmt(f)}), Fehler ${fmt(error * 100, 2)} %, Halbordnungen ${fmt(below.db - main.db)} dB, über Grund ${fmt(main.db - floor)} dB`,
        spec,
        f,
    };
}

async function squealCase() {
    const slips = [0, 3, 6, 9, 12, 15];
    const energies = [];
    const peaks = [];
    let width = 0;
    for (const slip of slips) {
        const { buffer } = await render(1.25, m => ({ voice: m.engine({ own: true, layout: 'i4', seed: 5 }) }), s => s.voice.update({ rpm: 3000, throttle: 0.3, slip, speed: 15 }));
        const spec = spectrum(samples(buffer, 0.5, 0.5 + 32768 / RATE));
        energies.push(band(spec, 500, 3500));
        const p = peakIn(spec, 450, 1500);
        peaks.push(p.hz);
        if (slip === 12) width = peakWidth(spec, p.hz);
    }
    const rising = energies.every((e, k) => k === 0 || e >= energies[k - 1] - 0.5);
    const gain = energies[energies.length - 1] - energies[0];
    return [
        {
            group: 'Reifen',
            name: 'Quietschen steigt mit dem Schlupf',
            pass: rising && gain >= 10,
            value: slips.map((s, k) => `${s} m/s: ${fmt(energies[k] - energies[0])} dB`).join(' · '),
            plot: { kind: 'bars', labels: slips.map(s => `${s}`), values: energies.map(e => e - energies[0]), unit: 'dB' },
        },
        {
            group: 'Reifen',
            name: 'Tonhöhe folgt dem Schlupf, Rauschband statt Sinus',
            pass: peaks[4] > peaks[2] && width > 20,
            value: `Spitze bei 6 m/s ${fmt(peaks[2], 0)} Hz, bei 12 m/s ${fmt(peaks[4], 0)} Hz; Breite (−6 dB) ${fmt(width, 0)} Hz`,
        },
    ];
}

async function limiterCase() {
    const { buffer, state } = await render(1.6, m => ({ voice: m.engine({ own: true, layout: 'i4', seed: 7 }) }), s => s.voice.update({ rpm: 8100, throttle: 1, limiter: true, speed: 30 }));
    const env = envelope(samples(buffer, 0.4, 1.6), 4);
    const hz = modulationPeak(env, 250, 5, 40);
    const depth = (percentile(env, 0.9) - percentile(env, 0.1)) / percentile(env, 0.9);
    return {
        group: 'Motor',
        name: 'Begrenzer stottert (Zündunterbrechung ~15 Hz)',
        pass: hz >= 12 && hz <= 18 && depth > 0.4 && state.voice.stats.cuts > 15,
        value: `Modulation ${fmt(hz)} Hz, Tiefe ${fmt(depth * 100, 0)} %, ${state.voice.stats.cuts} Unterbrechungen, ${state.voice.stats.pops} Fehlzündungen`,
        plot: { kind: 'line', values: env.slice(0, 150), unit: 'RMS / 4 ms' },
    };
}

async function shiftCase(withGear) {
    const rpmAt = t => (t < 1 ? 7400 : 5600 + 1800 * Math.exp(-(t - 1) / 0.07));
    const { buffer, state } = await render(
        1.6,
        m => ({ voice: m.engine({ own: true, layout: 'i6', seed: 9 }) }),
        (s, t) => s.voice.update({ rpm: rpmAt(t), throttle: 1, speed: 30, ...(withGear ? { gear: t < 1 ? 2 : 3 } : {}) }),
    );
    const before = db(rms(samples(buffer, 0.8, 0.98)));
    const during = db(rms(samples(buffer, 1.03, 1.13)));
    const after = db(rms(samples(buffer, 1.3, 1.55)));
    return {
        group: 'Motor',
        name: withGear ? 'Schaltdelle (Gang gemeldet)' : 'Schaltdelle (aus der Drehzahl erkannt)',
        pass: during - before <= -3 && state.voice.stats.shifts >= 1 && after - during > 2,
        value: `während ${fmt(during - before)} dB, danach ${fmt(after - before)} dB, Schaltvorgänge ${state.voice.stats.shifts}`,
    };
}

/** The pops follow the visible exhaust flames once run.js reports them (voice.backfire): no extra guesses of the voice's own. */
async function backfireCase() {
    // the first flame (a limiter pop) comes before the lift: from then on only the flames make pops
    const calls = [[0.3, 0.4], [1.02, 0.9], [1.25, 0.35], [1.5, 0.3]];
    const { buffer, state } = await render(
        2.2,
        m => ({ voice: m.engine({ own: true, layout: 'i4', seed: 13 }), next: 0 }),
        (s, t) => {
            s.voice.update({ rpm: t < 1 ? 6500 : 2000 + 4500 * Math.exp(-(t - 1) / 0.8), throttle: t < 1 ? 1 : 0, speed: 30 });
            if (s.next < calls.length && t >= calls[s.next][0]) s.voice.backfire(calls[s.next++][1]);
        },
    );
    const bang = db(peak(samples(buffer, 1.0, 1.12)));
    const before = db(peak(samples(buffer, 0.6, 0.98)));
    return {
        group: 'Motor',
        name: 'Fehlzündungen synchron zu den Auspuffflammen (backfire)',
        pass: state.voice.stats.pops === calls.length && bang - before > 3,
        value: `${state.voice.stats.pops} Knaller bei ${calls.length} Flammen (keine eigenen dazu), Knall ${fmt(bang - before)} dB über dem Motor`,
    };
}

async function turboCase() {
    const run = turbo =>
        render(
            2.6,
            m => {
                // the turbo alone: no exhaust pops in the window (as if the flames of run.js drove them and showed none)
                const voice = m.engine({ own: true, layout: 'i4', turbo, seed: 11 });
                voice.flames = true;
                return { voice };
            },
            (s, t) => s.voice.update({ rpm: t < 2 ? 6000 : 3000 + 3000 * Math.exp(-(t - 2) / 0.4), throttle: t < 2 ? 1 : 0, speed: 0 }),
        );
    const [none, big, small] = await Promise.all([run(0), run(4), run(2)]);
    const whistle = r => band(spectrum(samples(r.buffer, 1.5, 1.98)), 2500, 7000);
    const release = (r, lo, hi) => band(spectrum(samples(r.buffer, 2.02, 2.45)), lo, hi);
    const valve = release(big, 1200, 6000) - release(none, 1200, 6000);
    const flutter = release(small, 300, 2500) - release(none, 300, 2500);
    const pitch = peakIn(spectrum(samples(big.buffer, 1.5, 1.98)), 2500, 7000).hz;
    return [
        {
            group: 'Turbo',
            name: 'Pfeifen folgt dem Ladedruck',
            pass: whistle(big) - whistle(none) >= 6,
            value: `+${fmt(whistle(big) - whistle(none))} dB im Band 2,5–7 kHz, Pfeifton ${fmt(pitch, 0)} Hz`,
        },
        {
            group: 'Turbo',
            name: 'Abblasen / Flattern beim Gaswegnehmen',
            pass: valve >= 6 && flutter >= 4 && big.state.voice.stats.blowOffs >= 1 && small.state.voice.stats.blowOffs >= 1,
            value: `Stufe 4 (Abblasventil) +${fmt(valve)} dB bei 1,2–6 kHz, Stufe 2 (Flattern) +${fmt(flutter)} dB bei 0,3–2,5 kHz`,
        },
    ];
}

async function crackleCase() {
    const { buffer, state } = await render(
        2.2,
        m => ({ voice: m.engine({ own: true, layout: 'i4', seed: 13 }) }),
        (s, t) => s.voice.update({ rpm: t < 1 ? 6500 : 2000 + 4500 * Math.exp(-(t - 1) / 0.8), throttle: t < 1 ? 1 : 0, speed: 30 }),
    );
    const crest = x => peak(x) / rms(x);
    const on = crest(samples(buffer, 0.3, 0.95));
    const off = crest(samples(buffer, 1.0, 1.8));
    return {
        group: 'Motor',
        name: 'Schubknallen nach dem Gaswegnehmen',
        pass: state.voice.stats.pops >= 4 && off > on * 1.5,
        value: `${state.voice.stats.pops} Knaller, Crest-Faktor ${fmt(on)} → ${fmt(off)}`,
    };
}

async function distanceCase() {
    const run = (distance, pan = 0) =>
        render(1.2, m => ({ voice: m.engine({ layout: 'i4', seed: 15 }) }), s => s.voice.update({ rpm: 4500, throttle: 0.6, distance, pan }), { volume: 0.5 });
    const [near, far, right, left] = await Promise.all([run(5), run(60), run(20, 0.8), run(20, -0.8)]);
    const level = r => db(rms(samples(r.buffer, 0.5, 1.15)));
    const highs = r => {
        const spec = spectrum(samples(r.buffer, 0.5, 1.15));
        return band(spec, 1500, 9000) - band(spec, 40, 1500);
    };
    const expected = 20 * Math.log10((8 + 60) / (8 + 5));
    const balance = r => db(rms(samples(r.buffer, 0.5, 1.15, 1))) - db(rms(samples(r.buffer, 0.5, 1.15, 0)));
    return [
        {
            group: 'Andere Autos',
            name: 'Abstand: leiser und dumpfer',
            pass: level(near) - level(far) > 9 && level(near) - level(far) < expected + 1 && highs(far) < highs(near) - 4,
            value: `5 m → 60 m: −${fmt(level(near) - level(far))} dB (direkt −${fmt(expected)}, der Hall fällt langsamer), Höhenanteil über 1,5 kHz ${fmt(highs(near))} → ${fmt(highs(far))} dB`,
        },
        {
            group: 'Andere Autos',
            name: 'Stereo',
            pass: balance(right) >= 3 && balance(left) <= -3,
            value: `rechts ${fmt(balance(right))} dB, links ${fmt(balance(left))} dB (R − L)`,
        },
    ];
}

async function dopplerCase() {
    const run = (from, speed) =>
        render(1.7, m => ({ voice: m.engine({ layout: 'i4', seed: 17 }) }), (s, t) => s.voice.update({ rpm: 4500, throttle: 0.6, distance: from + speed * t }), { volume: 0.5 });
    const [coming, going] = await Promise.all([run(80, -25), run(20, 25)]);
    const f = 150;
    const measure = r => peakIn(spectrum(samples(r.buffer, 0.95, 0.95 + 32768 / RATE)), f * 0.85, f * 1.25).hz / f;
    const up = measure(coming);
    const down = measure(going);
    const expectUp = 343 / (343 - 25);
    const expectDown = 343 / (343 + 25);
    return {
        group: 'Andere Autos',
        name: 'Doppler (25 m/s)',
        pass: Math.abs(up - expectUp) < 0.015 && Math.abs(down - expectDown) < 0.015,
        value: `kommend ×${fmt(up, 3)} (soll ${fmt(expectUp, 3)}), fahrend ×${fmt(down, 3)} (soll ${fmt(expectDown, 3)})`,
    };
}

/** The space: a hard hit rings on in the parking deck, hardly on the open pass (the engine muted: only the hit and its reverb). */
async function spaceCase() {
    const run = space =>
        render(
            2.5,
            m => {
                m.setSpace(space);
                return { voice: m.engine({ own: true, layout: 'i4', seed: 37 }) };
            },
            (s, t) => {
                if (t === 0) {
                    s.voice.update({ rpm: 900, throttle: 0, speed: 0 });
                    s.voice.level.gain.setValueAtTime(0, 0.02);
                }
                if (t > 0.3 && !s.hit) {
                    s.voice.impact(16);
                    s.hit = true;
                }
            },
        );
    const [open, hall] = await Promise.all([run('pass'), run('deck')]);
    const energy = (r, from, to) => db(rms(samples(r.buffer, from, to)));
    const tail = r => energy(r, 1.6, 2.3);
    const hit = r => db(peak(samples(r.buffer, 0.3, 0.5)));
    // reverberation time of the deck: a straight line through the level (dB, 50 ms windows) after the metal has died away
    const points = [];
    for (let from = 1.35; from < 2.4; from += 0.05) points.push([from, energy(hall, from, from + 0.05)]);
    const mx = points.reduce((s, [x]) => s + x, 0) / points.length;
    const my = points.reduce((s, [, y]) => s + y, 0) / points.length;
    const slope = points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
    const rt60 = slope < 0 ? -60 / slope : 0;
    return {
        group: 'Raum',
        name: 'Nachhall: Parkdeck (Beton) gegen Pass (offen)',
        pass: tail(hall) - tail(open) >= 10 && Math.abs(hit(hall) - hit(open)) < 3 && rt60 > 1 && rt60 < 2.5,
        value: `Nachklang 1,3–2 s nach einem Treffer: Pass ${fmt(tail(open))} dBFS, Parkdeck ${fmt(tail(hall))} dBFS (Nachhallzeit ≈ ${fmt(rt60, 2)} s); Treffer selbst ${fmt(hit(open))} / ${fmt(hit(hall))} dBFS`,
    };
}

async function robustnessCase() {
    let error = null;
    const { buffer } = await render(
        0.6,
        m => ({ voice: m.engine({ own: true, turbo: 3, seed: 19 }), other: m.engine({ turbo: Number.NaN, body: 'unbekannt' }) }),
        (s, t) => {
            try {
                s.voice.update({ rpm: Number.NaN, throttle: undefined, slip: Infinity, distance: -5, limiter: 'ja', speed: Number.NaN, gear: Number.NaN, pan: Infinity });
                s.other.update({ rpm: Infinity, throttle: -3, slip: Number.NaN, distance: Infinity, pan: Number.NaN });
                if (t > 0.2) s.other.update({});
                s.voice.impact(Number.NaN);
                s.voice.impact(-1);
                s.voice.impact(Infinity);
            } catch (e) {
                error = e;
            }
        },
    );
    const bad = nonFinite(buffer);
    return {
        group: 'Sicherheit',
        name: 'Unsinnige Eingaben (NaN, ∞, fehlend)',
        pass: !error && bad === 0,
        value: error ? `Fehler: ${error.message}` : `${bad} ungültige Samples, Spitze ${fmt(db(peak(samples(buffer))))} dBFS`,
    };
}

async function levelCase() {
    const run = params => render(1.3, m => ({ voice: m.engine({ own: true, layout: 'i4', turbo: params.turbo ?? 0, seed: 21 }) }), s => s.voice.update(params));
    const [idle, cruise, full] = await Promise.all([
        run({ rpm: 900, throttle: 0, speed: 0 }),
        run({ rpm: 4500, throttle: 0.5, speed: 25 }),
        run({ rpm: 7500, throttle: 1, speed: 45, slip: 12, turbo: 3 }),
    ]);
    const level = r => db(rms(samples(r.buffer, 0.5, 1.25)));
    const [a, b, c] = [level(idle), level(cruise), level(full)];
    return {
        group: 'Pegel (Lautstärke 0,8)',
        name: 'Leerlauf < Teillast < Vollgas im Drift',
        pass: a >= -42 && a <= -22 && b >= -28 && b <= -14 && c >= -22 && c <= -8 && a < b - 6 && b < c,
        value: `Leerlauf ${fmt(a)} dBFS, Teillast ${fmt(b)} dBFS, Vollgas + Drift + Turbo ${fmt(c)} dBFS (RMS)`,
    };
}

async function masterCase() {
    const sine = amplitude => (m, ctx) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = 440;
        const g = ctx.createGain();
        g.gain.value = amplitude;
        osc.connect(g).connect(m.master);
        osc.start(0);
        return {};
    };
    const quiet = await render(1, sine(0.0316), () => {}, { volume: 1 });
    const loud = await render(1, sine(4), () => {}, { volume: 1 });
    const gain = db(rms(samples(quiet.buffer, 0.3, 1))) - db(0.0316 / Math.SQRT2) - db(0.9);
    const ceiling = db(peak(samples(loud.buffer)));
    return [
        {
            group: 'Summe',
            name: 'Leise Signale unverändert (Make-up des Kompressors abgezogen)',
            pass: Math.abs(gain) <= 1,
            value: `${fmt(gain, 2)} dB`,
        },
        {
            group: 'Summe',
            name: 'Decke: +12 dB hinein, kein Übersteuern',
            pass: ceiling < 0,
            value: `Spitze ${fmt(ceiling, 2)} dBFS`,
        },
    ];
}

async function worstCase() {
    const { buffer, renderMs } = await render(
        4,
        m => {
            const own = m.engine({ own: true, layout: 'i4', turbo: 5, seed: 23 });
            const others = ['v8', 'i6', 'i4'].map((layout, k) => m.engine({ layout, turbo: 5, seed: 29 + k }));
            return { own, others, nextHit: 0.3 };
        },
        (s, t, m) => {
            const lift = t % 1 > 0.8;
            s.own.update({ rpm: lift ? 6000 : 8100, throttle: lift ? 0 : 1, slip: 20, speed: 70, limiter: !lift, gear: Math.floor(t / 1.3) });
            s.others.forEach((v, k) => v.update({ rpm: 8000, throttle: 1, slip: 20, distance: 1.5, pan: k - 1, limiter: true }));
            if (t >= s.nextHit) {
                s.own.impact(30);
                s.nextHit += 0.5;
            }
            m.musicTick();
            if (Math.abs(t - 1) < 0.01) [784, 988, 1175, 1568].forEach((f, k) => m.tone(f, 0.6, { type: 'triangle', volume: 0.12, delay: k * 0.09 }));
        },
        { volume: 1, music: 1 },
    );
    const x = samples(buffer, 0, 4, 0);
    const y = samples(buffer, 0, 4, 1);
    const top = Math.max(peak(x), peak(y));
    const level = db(Math.max(rms(x), rms(y)));
    const env = envelope(samples(buffer), 20).map((_, k) => peak(samples(buffer, k * 0.02, k * 0.02 + 0.02)));
    return {
        group: 'Sicherheit',
        name: 'Schlimmster Fall: 4 Autos am Begrenzer, Turbo 5, Drift, Treffer, Musik, Lautstärke 1',
        pass: nonFinite(buffer) === 0 && top < 1 && level > -20 && level < -5,
        value: `Spitze ${fmt(db(top), 2)} dBFS, RMS ${fmt(level)} dBFS, ${nonFinite(buffer)} ungültige Samples; Rechenzeit ${fmt(renderMs, 0)} ms für 4 s (${fmt(4000 / renderMs)}× Echtzeit inkl. 240 Pausen)`,
        plot: { kind: 'line', values: env, unit: 'Spitze / 20 ms', ceiling: 0.966 },
    };
}

// ---- the test drive: the real car physics (car/physics.js, read only) on an endless flat plane with a fixed script

/** [end of the step (s), controls] – launch and shifts, a lift, a handbrake flick into a power-over drift, a lift, a sprint, brakes. */
export const DRIVE_SCRIPT = [
    [0.6, { throttle: 0 }],
    [4.6, { throttle: 1 }],
    [5.4, { throttle: 0 }],
    [5.7, { throttle: 1, steer: 0.7, handbrake: 1 }],
    [10.5, { throttle: 0.9, steer: 0.55 }],
    [11.3, { throttle: 0 }],
    [14.5, { throttle: 1 }],
    [16, { throttle: 0, brake: 0.6 }],
];
export const DRIVE_SECONDS = 16;

/** The controls of the script at a time (it loops every 16 s). */
export function driveControls(clock) {
    const t = clock % DRIVE_SECONDS;
    const step = DRIVE_SCRIPT.find(([end]) => t < end) ?? DRIVE_SCRIPT[DRIVE_SCRIPT.length - 1];
    return { throttle: 0, brake: 0, handbrake: 0, steer: 0, shiftUp: false, shiftDown: false, ...step[1] };
}

/** The voice's input from a car's physics (what run.js hands over, plus speed and gear). */
export function physicsInput(physics, throttle) {
    return { rpm: physics.rpm, throttle, slip: physics.rearSlip, speed: physics.speed, gear: physics.gear, limiter: physics.rpm > REDLINE_RPM * 1.02 };
}

/** Short-time spectra (dB) of a signal: frames of `size`, every `hop` samples. */
export function spectrogram(x, size = 2048, hop = 512) {
    const columns = [];
    for (let start = 0; start + size <= x.length; start += hop) {
        const { power } = spectrum(x.subarray(start, start + size));
        const column = new Float32Array(power.length);
        for (let i = 0; i < power.length; i++) column[i] = 10 * Math.log10(Math.max(power[i], 1e-20));
        columns.push(column);
    }
    return { columns, binHz: RATE / size, hopS: hop / RATE };
}

async function driveCase(body) {
    const physics = new CarPhysics(showcaseCar(body, 0).spec, { assist: 0.65, transmission: 'auto' });
    const world = { groundAt: () => 0 };
    const trace = [];
    let gearChanges = 0;
    const { buffer, state } = await render(DRIVE_SECONDS, m => ({ voice: m.engine({ own: true, body, turbo: 2, seed: 31 }), last: 0, gear: 1 }), (s, t) => {
        const controls = driveControls(t);
        if (t > s.last) physics.update(t - s.last, controls, world);
        s.last = t;
        if (physics.gear !== s.gear) gearChanges++;
        s.gear = physics.gear;
        s.voice.update(physicsInput(physics, controls.throttle));
        trace.push({ t, rpm: physics.rpm, slip: physics.rearSlip, speed: physics.speed, gear: physics.gear });
    });
    const mean = (from, to, key) => {
        const part = trace.filter(p => p.t >= from && p.t < to);
        return part.reduce((sum, p) => sum + p[key], 0) / Math.max(1, part.length);
    };
    // the squeal band (dB) of each frame against the slip of that frame
    const picture = spectrogram(samples(buffer));
    const lo = Math.ceil(900 / picture.binHz);
    const hi = Math.floor(2600 / picture.binHz);
    const pairs = trace.map(p => {
        const column = picture.columns[Math.min(picture.columns.length - 1, Math.round(p.t / picture.hopS))];
        let sum = 0;
        for (let i = lo; i <= hi; i++) sum += 10 ** (column[i] / 10);
        return [p.slip, 10 * Math.log10(sum)];
    });
    const r = pearson(pairs);
    const quiet = pairs.filter(([s]) => s < 2).map(([, e]) => e);
    const loud = pairs.filter(([s]) => s > 10).map(([, e]) => e);
    const avg = list => list.reduce((sum, v) => sum + v, 0) / Math.max(1, list.length);
    const squealGain = quiet.length && loud.length ? avg(loud) - avg(quiet) : 0;
    const driftSlip = mean(7, 10, 'slip');
    const straightSlip = mean(2.5, 4.5, 'slip');
    const top = db(peak(samples(buffer)));
    const stats = state.voice.stats;
    return {
        group: 'Probefahrt (echte Fahrphysik, 16 s)',
        name: `${body}: Schalten, Gas weg, Drift, Sprint`,
        pass: nonFinite(buffer) === 0 && top < 0 && stats.shifts === gearChanges && gearChanges >= 2 && stats.pops >= 1 && r > 0.3 && squealGain > 6,
        value:
            `Gangwechsel ${gearChanges} (gehört ${stats.shifts}), Knaller ${stats.pops}, Abblasen ${stats.blowOffs}; Schlupf Anfahren ${fmt(straightSlip)}, Drift ${fmt(driftSlip)} m/s; ` +
            `Quietschband: Schlupf > 10 gegen < 2 m/s +${fmt(squealGain)} dB, Korrelation ${fmt(r, 2)}; Spitze ${fmt(top, 2)} dBFS, max. ${Math.round(Math.max(...trace.map(p => p.rpm)))} U/min, ${Math.round(Math.max(...trace.map(p => p.speed)) * 3.6)} km/h`,
        plot: { kind: 'spectrogram', data: picture },
    };
}

/**
 * Runs every test; onResult(result) after each. Results: { group, name, pass, value, plot?, spec?, f? }.
 * @param {(result: object) => void} [onResult]
 */
export async function runAudioTests(onResult = () => {}) {
    const results = [];
    const add = list => {
        for (const r of [list].flat()) {
            results.push(r);
            onResult(r);
        }
    };
    for (const [layout, rpm] of [['i4', 1500], ['i4', 3000], ['i4', 5000], ['i4', 7000], ['i6', 2000], ['i6', 6000], ['v8', 1500], ['v8', 5000]]) add(await pitchCase(layout, rpm));
    add(await limiterCase());
    add(await shiftCase(true));
    add(await shiftCase(false));
    add(await crackleCase());
    add(await backfireCase());
    add(await turboCase());
    add(await squealCase());
    add(await distanceCase());
    add(await dopplerCase());
    add(await spaceCase());
    add(await levelCase());
    add(await masterCase());
    add(await robustnessCase());
    add(await worstCase());
    add(await driveCase('coupe'));
    add(await driveCase('muscle'));
    return results;
}
