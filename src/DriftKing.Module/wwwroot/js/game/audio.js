// DriftKing · audio.js – every sound is synthesized with WebAudio (no samples, no network).
//
// Engines are a source-filter model per car. The source is the exhaust's pressure pulses: a wavetable oscillator runs at the engine-cycle
// rate (rpm / 120 – a four-stroke fires every cylinder once in two turns), so the firing frequency rpm / 60 × cylinders / 2 is its
// cylinders-th harmonic, and small differences between the cylinders give the half orders that make it sound like an engine, not a buzzer.
// Two wavetables (on load: sharp pulses; overrun: soft, uneven ones) are cross-faded by the throttle; white noise gated by the same pulses
// adds the exhaust rasp and the intake roar; a soft clip adds the grit under load. The filter is the exhaust system and does NOT move with
// the revs: a boom resonance and a formant per engine layout, and a low-pass that opens with load. Around it: the rev-limiter stutter (ignition cuts at 15 Hz like physics.js, the revs bounce), the gear-change dip (no load
// while the clutch is open), turbo whistle and hiss that follow the shaft speed and a blow-off (or compressor flutter) on a lift, overrun
// pops (once run.js reports the visible exhaust flames through voice.backfire(), exactly those – every bang has its flame), tyre squeal (noise in two resonant bands whose pitch, sharpness and loudness follow the slip – never a pure tone), wind and road
// noise by speed, impacts (thud + sheet-metal modes + debris); for the other cars distance attenuation, air absorption (the highs fade
// with distance), Doppler and stereo.
// One-shots (pops, blow-off, flutter, impacts, the shift clunk) are synthesized into buffers once per sample rate. One shared reverb
// places the cars in the map's space (audio.space(mapKey): open pass, harbour yard, city street, concrete parking deck).
// The mix ends in a master chain: 30 Hz high-pass → compressor (glue, its automatic make-up gain trimmed away) → a soft clipper with a hard
// ceiling at −0.3 dBFS, so nothing ever clips. Menu blips and a small synthwave loop as music stay simple.
// Volumes: settings.volume (master) and settings.music. Browsers start audio only after a gesture: call audio.unlock() on the first
// click/key – before the page has seen one, unlock() does nothing (no context, no autoplay warning) and engine() returns a silent voice.
// Test bench and offline self-test: dev/audio.html (createMixer works on any BaseAudioContext, an OfflineAudioContext included).

import { settings } from './settings.js';

const SPEED_OF_SOUND = 343;
/** physics.js cuts the power every 1/30 s on the limiter: 15 ignition cuts per second. */
const LIMITER_HZ = 15;
/** The soft clipper: linear up to KNEE (−3.1 dBFS), then saturating towards CEILING (−0.3 dBFS) – the output never passes it. */
const KNEE = 0.7;
const CEILING = 0.966;
/** The compressor adds make-up gain by itself ((1 / gain at 0 dBFS)^0.6, Web Audio spec); this takes it back (measured: dev/audio.html). */
const COMPRESSOR_TRIM = 0.712;
/** The old master chain (a default compressor) lifted quiet sounds by ~3.5 dB: the menu blips and the music keep that loudness. */
const UI_GAIN = 1.45;
/** Reference distance of the other cars (m): at this distance they sound half as loud as right beside the listener. */
const DISTANCE_REF = 8;
/** Mix levels (linear; calibrated with the offline self-test in dev/audio.html). */
const LEVEL = Object.freeze({
    engine: 0.34,
    tyres: 0.95,
    turbo: 0.028,
    wind: 0.2,
    pops: 0.72,
    blowOff: 0.45,
    flutter: 0.65,
    clunk: 0.1,
    impact: 0.75,
    other: 0.9,
});

/**
 * The engine layouts: cylinders, the pulse amplitude and timing per cylinder (on load / overrun), the pulse width (fraction of the cycle),
 * the exhaust's boom and formant ([Hz, dB, Q]), the band of the rasp noise (Hz) and a level. Invented characters, no real engine.
 */
export const ENGINE_LAYOUTS = Object.freeze({
    i4: {
        key: 'i4', cylinders: 4, width: 0.034,
        amps: [1, 0.9, 0.95, 0.86], overrun: [1, 0.55, 0.8, 0.42], offsets: [0, 0.006, -0.004, 0.003],
        boom: [125, 5, 1.1], formant: [700, 4, 1.4], rasp: 1600, level: 1,
    },
    i6: {
        key: 'i6', cylinders: 6, width: 0.024,
        amps: [1, 0.95, 0.97, 0.93, 0.98, 0.94], overrun: [1, 0.7, 0.88, 0.6, 0.82, 0.66], offsets: [0, 0.003, -0.002, 0.002, -0.003, 0.001],
        boom: [150, 4, 1], formant: [980, 5, 1.2], rasp: 2200, level: 0.92,
    },
    // a cross-plane V8: the two banks (pattern L R L L R L R R) reach the listener through different pipes – the burble
    v8: {
        key: 'v8', cylinders: 8, width: 0.019,
        amps: [1, 0.8, 1, 1, 0.8, 1, 0.8, 0.8], overrun: [1, 0.5, 0.9, 0.95, 0.45, 0.85, 0.55, 0.4],
        offsets: [0.004, -0.006, 0.004, 0.004, -0.006, 0.004, -0.006, -0.006],
        boom: [92, 7, 1], formant: [520, 4, 1.2], rasp: 1150, level: 1.08,
    },
});

/** The engine of each body (catalog.js BODIES): small fours, smooth sixes, the muscle car's V8. */
export const BODY_LAYOUT = Object.freeze({ coupe: 'i4', hatch: 'i4', sedan: 'i6', fastback: 'i6', wide: 'i6', muscle: 'v8' });

/**
 * The acoustic spaces (a shared reverb): length and RT60 of the late field (s), its damping (Hz: highs die first), the early reflections
 * ([delay s, gain]) and the send levels of the own car and the other cars (the others' reverb falls slower with distance than their direct
 * sound – that is what makes a car sound far away).
 */
const SPACES = Object.freeze({
    // the pass: mountain air, a rock face now and then
    open: { seconds: 0.9, decay: 0.5, damp: 2600, early: [[0.024, 0.3], [0.051, 0.18]], own: 0.035, others: 0.06 },
    // the harbour: container walls and sheds at some distance
    yard: { seconds: 1.6, decay: 1.0, damp: 3000, early: [[0.031, 0.38], [0.058, 0.3], [0.089, 0.2]], own: 0.06, others: 0.1 },
    // the city: house fronts on both sides of the street
    street: { seconds: 1.4, decay: 0.8, damp: 4000, early: [[0.012, 0.5], [0.019, 0.42], [0.031, 0.3], [0.047, 0.22]], own: 0.07, others: 0.12 },
    // the parking deck: bare concrete, a low ceiling
    hall: { seconds: 2.4, decay: 1.7, damp: 3000, early: [[0.008, 0.6], [0.013, 0.55], [0.021, 0.45], [0.029, 0.38], [0.04, 0.3]], own: 0.2, others: 0.24 },
});

/** The space of each map (catalog.js MAPS keys). */
const MAP_SPACE = Object.freeze({ pass: 'open', deck: 'hall', harbor: 'yard', city: 'street' });

// ---- small helpers

function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

/** A number from a caller: NaN/undefined/non-numbers become the fallback, ±Infinity are clamped. */
function num(v, fallback, min, max) {
    return typeof v !== 'number' || Number.isNaN(v) ? fallback : clamp(v, min, max);
}

function smoothstep(x) {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
}

/** A seeded generator 0..1 (mulberry32): the same sound twice in the offline tests. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gainNode(ctx, value) {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
}

function biquadNode(ctx, type, frequency, q = 1, gain = 0) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
}

/** The last target per AudioParam: glide() skips a call that would not change anything (keeps the event lists short). */
const targets = new WeakMap();

/** Moves a parameter towards value with the time constant tau (0 = at once). */
function glide(param, value, t, tau) {
    const last = targets.get(param);
    if (last !== undefined && Math.abs(value - last) <= Math.abs(last) * 0.002 + 1e-6) return;
    targets.set(param, value);
    if (tau <= 0) param.setValueAtTime(value, t);
    else param.setTargetAtTime(value, t, tau);
}

// ---- engine wavetables (Fourier series of one engine cycle; plain arrays, cached for the page – PeriodicWaves are per context)

const WAVE_SIZE = 2048;
const WAVE_HARMONICS = 256;
const waveCache = new Map();
let trigTable = null;

/** A pulse with a fast rise and a slower decay (peak 1 at u = 1). */
function pulse(u) {
    return u > 0 ? u * Math.exp(1 - u) : 0;
}

/** The Fourier coefficients of one engine cycle: one exhaust pulse (and its suction wave) per cylinder. */
function engineWave(layout, overrun) {
    const key = `${layout.key}:${overrun ? 'off' : 'on'}`;
    let wave = waveCache.get(key);
    if (wave) return wave;
    const n = WAVE_SIZE;
    if (!trigTable) {
        trigTable = { cos: new Float64Array(n), sin: new Float64Array(n) };
        for (let i = 0; i < n; i++) {
            trigTable.cos[i] = Math.cos((2 * Math.PI * i) / n);
            trigTable.sin[i] = Math.sin((2 * Math.PI * i) / n);
        }
    }
    const x = new Float64Array(n);
    const width = layout.width * (overrun ? 1.9 : 1);
    const suction = overrun ? 0.6 : 0.42;
    const amps = overrun ? layout.overrun : layout.amps;
    for (let k = 0; k < layout.cylinders; k++) {
        const at = k / layout.cylinders + layout.offsets[k];
        for (let i = 0; i < n; i++) {
            const tau = (((i / n - at) % 1) + 1) % 1;
            x[i] += amps[k] * (pulse(tau / width) - suction * pulse((tau - 2.3 * width) / (2.6 * width)));
        }
    }
    const real = new Float32Array(WAVE_HARMONICS + 1);
    const imag = new Float32Array(WAVE_HARMONICS + 1);
    for (let h = 1; h <= WAVE_HARMONICS; h++) {
        let a = 0;
        let b = 0;
        for (let i = 0; i < n; i++) {
            const index = (h * i) % n;
            a += x[i] * trigTable.cos[index];
            b += x[i] * trigTable.sin[index];
        }
        real[h] = (2 * a) / n;
        imag[h] = (2 * b) / n;
    }
    wave = { real, imag };
    waveCache.set(key, wave);
    return wave;
}

// ---- one-shot buffers, synthesized once per sample rate (Float32Arrays; AudioBuffers per context)

const sampleCache = new Map();

/** RBJ biquad for the offline synthesis (type 'bandpass' with 0 dB peak, 'lowpass', 'highpass'). */
function jsBiquad(type, frequency, q, sr) {
    const f = { type, q, sr, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
    tuneBiquad(f, frequency);
    return f;
}

function tuneBiquad(f, frequency) {
    const w = (2 * Math.PI * Math.min(frequency, f.sr * 0.45)) / f.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * f.q);
    let b0;
    let b1;
    let b2;
    if (f.type === 'bandpass') {
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
    } else if (f.type === 'lowpass') {
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = b0;
    } else {
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = b0;
    }
    const a0 = 1 + alpha;
    f.b0 = b0 / a0;
    f.b1 = b1 / a0;
    f.b2 = b2 / a0;
    f.a1 = (-2 * cos) / a0;
    f.a2 = (1 - alpha) / a0;
}

function runBiquad(f, x) {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1;
    f.x1 = x;
    f.y2 = f.y1;
    f.y1 = y;
    return y;
}

function normalize(data, peak) {
    let max = 0;
    for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
    if (max > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
    return data;
}

/** A damped resonance (one mode) driven by the excitation, added into out with unit amplitude per unit impulse. */
function addMode(out, excitation, frequency, decay, gain, sr) {
    const r = Math.exp(-1 / (decay * sr));
    const w = (2 * Math.PI * frequency) / sr;
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    const scale = Math.sin(w) * gain;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
        const y = excitation[i] + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        out[i] += y * scale;
    }
}

/** White noise (RMS 0.4); 4 s so the narrow tyre bands never repeat audibly. */
function makeNoise(sr, rng) {
    const data = new Float32Array(Math.round(sr * 4));
    for (let i = 0; i < data.length; i++) data[i] = (rng() * 2 - 1) * 0.7;
    return data;
}

/** An overrun pop: a sharp crack, a low body and a few crackles after it. */
function makePop(sr, rng) {
    const n = Math.round(sr * 0.14);
    const out = new Float32Array(n);
    const f0 = 70 + rng() * 70;
    const crack = jsBiquad('lowpass', 2500 + rng() * 2500, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        phase += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t / 0.01))) / sr;
        const body = Math.sin(phase) * Math.exp(-t / 0.022) * (1 - Math.exp(-t / 0.0006));
        const noise = runBiquad(crack, rng() * 2 - 1) * Math.exp(-t / 0.005) * 2.2;
        const tail = rng() < 0.004 * Math.exp(-t / 0.035) ? (rng() * 2 - 1) * 0.7 : 0;
        out[i] = body * 0.9 + noise + tail;
    }
    // soften the single-sample crackles a little (a 2-tap mean)
    for (let i = n - 1; i > 0; i--) out[i] = (out[i] + out[i - 1]) * 0.5;
    return normalize(out, 0.95);
}

/** The body of a hit: a falling low thump and a short dull noise. */
function makeThud(sr, rng) {
    const n = Math.round(sr * 0.5);
    const out = new Float32Array(n);
    const dull = jsBiquad('lowpass', 700, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        phase += (2 * Math.PI * (42 + 60 * Math.exp(-t / 0.035))) / sr;
        const body = Math.sin(phase) * Math.exp(-t / 0.12) * (1 - Math.exp(-t / 0.0015));
        out[i] = body + runBiquad(dull, rng() * 2 - 1) * Math.exp(-t / 0.03) * 1.4;
    }
    return normalize(out, 0.95);
}

/** Sheet metal: a crunch that rings the panel's inharmonic modes (each variant tuned a little differently). */
function makeMetal(sr, rng, variant) {
    const n = Math.round(sr * 0.9);
    const excitation = new Float32Array(n);
    const out = new Float32Array(n);
    for (let i = 0; i < Math.round(sr * 0.004); i++) excitation[i] = (rng() * 2 - 1) * Math.exp(-i / (sr * 0.003));
    for (let k = 0; k < 6; k++) excitation[Math.round(sr * 0.08 * rng())] += (rng() < 0.5 ? -1 : 1) * (0.3 + 0.5 * rng());
    const modes = [182, 297, 431, 618, 845, 1137, 1498, 1960, 2580, 3390, 4420];
    modes.forEach((f, j) => {
        const frequency = f * (0.9 + 0.2 * rng()) * (1 + 0.06 * variant);
        const decay = (0.45 / (1 + j * 0.4)) * (0.7 + 0.6 * rng());
        addMode(out, excitation, frequency, decay, 1 / (1 + 0.3 * j), sr);
    });
    const crunch = jsBiquad('highpass', 1800, 0.7, sr);
    for (let i = 0; i < n; i++) out[i] += runBiquad(crunch, rng() * 2 - 1) * Math.exp(-i / (sr * 0.03)) * 0.5;
    return normalize(out, 0.95);
}

/** Bits of plastic and glass after a hard hit: short high pings, dense at first. */
function makeDebris(sr, rng) {
    const n = Math.round(sr * 0.5);
    const out = new Float32Array(n);
    for (let k = 0; k < 30; k++) {
        const start = Math.round(sr * 0.45 * rng() ** 1.6);
        const frequency = 2500 + rng() * 5000;
        const decay = 0.002 + rng() * 0.004;
        const amplitude = (0.2 + 0.8 * rng()) * Math.exp(-start / (sr * 0.15));
        const w = (2 * Math.PI * frequency) / sr;
        const length = Math.min(n - start, Math.round(decay * sr * 6));
        for (let i = 0; i < length; i++) out[start + i] += Math.sin(w * i) * Math.exp(-i / (decay * sr)) * amplitude;
    }
    return normalize(out, 0.8);
}

/** A blow-off valve: a sharp "pssh" that falls in pitch, a thin whistle chirp in it. */
function makeBlowOff(sr, rng) {
    const n = Math.round(sr * 0.8);
    const out = new Float32Array(n);
    const band = jsBiquad('bandpass', 3000, 1.1, sr);
    const high = jsBiquad('highpass', 800, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 32 === 0) tuneBiquad(band, 1700 + 1500 * Math.exp(-t / 0.2));
        const env = (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.17);
        phase += (2 * Math.PI * (900 + 2300 * Math.exp(-t / 0.07))) / sr;
        out[i] = runBiquad(high, runBiquad(band, rng() * 2 - 1)) * env * 2.5 + Math.sin(phase) * 0.18 * Math.exp(-t / 0.09);
    }
    return normalize(out, 0.9);
}

/** Compressor surge without a blow-off valve: the air chuffs back through the compressor ("stu-tu-tu"), slowing down. */
function makeFlutter(sr, rng) {
    const n = Math.round(sr * 0.75);
    const out = new Float32Array(n);
    const low = jsBiquad('lowpass', 1800, 0.7, sr);
    const band = jsBiquad('bandpass', 700, 0.9, sr);
    let phase = 0;
    let chirp = 0;
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        phase += (2 * Math.PI * (13 + 14 * Math.exp(-t / 0.25))) / sr;
        const am = (0.5 + 0.5 * Math.cos(phase)) ** 3;
        const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.25);
        chirp += (2 * Math.PI * (650 + 700 * Math.exp(-t / 0.2))) / sr;
        out[i] = (runBiquad(band, runBiquad(low, rng() * 2 - 1)) * 3 * am + Math.sin(chirp) * 0.25 * am) * env;
    }
    return normalize(out, 0.9);
}

/** The gearbox: a short mechanical clunk. */
function makeClunk(sr, rng) {
    const n = Math.round(sr * 0.1);
    const excitation = new Float32Array(n);
    const out = new Float32Array(n);
    for (let i = 0; i < Math.round(sr * 0.001); i++) excitation[i] = rng() * 2 - 1;
    addMode(out, excitation, 140, 0.025, 1, sr);
    addMode(out, excitation, 420, 0.012, 0.6, sr);
    addMode(out, excitation, 1900, 0.004, 0.3, sr);
    return normalize(out, 0.8);
}

/** The impulse response of a space (stereo): early reflections, then a damped, decaying late field; energy normalised to ~1. */
function makeImpulse(sr, space, rng) {
    const n = Math.round(sr * space.seconds);
    const channels = [new Float32Array(n), new Float32Array(n)];
    const decayStep = Math.exp(-6.91 / (space.decay * sr));
    const onsetStep = Math.exp(-1 / (0.012 * sr));
    channels.forEach((data, c) => {
        let low = 0;
        let env = 1;
        let onset = 1;
        let coefficient = 0;
        for (let i = 0; i < n; i++) {
            // the damping closes over time (the highs die first); the coefficient changes slowly enough to update every 32 samples
            if ((i & 31) === 0) coefficient = 1 - Math.exp((-2 * Math.PI * (300 + space.damp * Math.exp(-i / sr / (space.decay * 0.5)))) / sr);
            low += coefficient * (rng() * 2 - 1 - low);
            data[i] = low * env * (1 - onset);
            env *= decayStep;
            onset *= onsetStep;
        }
        for (const [delay, gain] of space.early) {
            const at = Math.round(delay * (c === 0 ? 0.94 : 1.07) * sr);
            const sign = rng() < 0.5 ? -1 : 1;
            for (let k = 0; k < 3 && at + k < n; k++) data[at + k] += sign * gain * [0.5, 1, 0.5][k] * 0.35;
        }
        let energy = 0;
        for (let i = 0; i < n; i++) energy += data[i] * data[i];
        const scale = 1 / Math.sqrt(Math.max(energy, 1e-12));
        for (let i = 0; i < n; i++) data[i] *= scale;
    });
    return channels;
}

/** The noise of one sample rate (needed at once by every voice; ≈ 2–5 ms). */
function noiseFor(sr) {
    const key = `noise:${sr}`;
    if (!sampleCache.has(key)) sampleCache.set(key, makeNoise(sr, mulberry32(0x5eed)));
    return sampleCache.get(key);
}

/** The one-shots of one sample rate (pops, impacts, blow-off, flutter, clunk; ≈ 10–30 ms – made while nothing happens, see prepare()). */
function effectsFor(sr) {
    const key = `effects:${sr}`;
    if (!sampleCache.has(key)) {
        const rng = mulberry32(0xb0a7);
        sampleCache.set(key, {
            pops: [0, 1, 2, 3].map(() => makePop(sr, rng)),
            thud: makeThud(sr, rng),
            metal: [0, 1, 2].map(k => makeMetal(sr, rng, k)),
            debris: makeDebris(sr, rng),
            blowOff: makeBlowOff(sr, rng),
            flutter: makeFlutter(sr, rng),
            clunk: makeClunk(sr, rng),
        });
    }
    return sampleCache.get(key);
}

/** The impulse response of a space at one sample rate (≈ 5–15 ms on its first use). */
function impulseFor(sr, key) {
    const cacheKey = `space:${key}:${sr}`;
    if (!sampleCache.has(cacheKey)) sampleCache.set(cacheKey, makeImpulse(sr, SPACES[key], mulberry32([...key].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 0x5ace))));
    return sampleCache.get(cacheKey);
}

/** A mono AudioBuffer of the context with the data. */
function toBuffer(context, data) {
    const buffer = context.createBuffer(1, data.length, context.sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
}

/** The soft clipper's curve. The shaper sees half the signal (the trim before it is × 0.5): its input −1..1 is the signal −2..2. */
function clipCurve() {
    const n = 4097;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const y = ((i / (n - 1)) * 2 - 1) * 2;
        const a = Math.abs(y);
        const out = a <= KNEE ? a : KNEE + (CEILING - KNEE) * Math.tanh((a - KNEE) / (CEILING - KNEE));
        curve[i] = Math.sign(y) * out;
    }
    return curve;
}

/** The engine's grit: tanh, normalised to ±1. */
function driveCurve() {
    const n = 1025;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2) / Math.tanh(2);
    return curve;
}

// ---- the mixer: buses, master chain, buffers and wavetables of one audio context

class Mixer {
    /**
     * @param {BaseAudioContext} context
     * @param {{ volume?: number, music?: number, space?: string }} [options]
     */
    constructor(context, { volume = 0.8, music = 0.5, space = 'street' } = {}) {
        const started = typeof performance !== 'undefined' ? performance.now() : 0;
        this.context = context;
        this.rng = mulberry32(0xd71f7);
        this.seed = 1;
        this.waves = new Map();
        this.sequencer = null;
        this.master = gainNode(context, 0);
        this.cars = gainNode(context, 1);
        this.musicBus = gainNode(context, 0);
        this.ui = gainNode(context, UI_GAIN);
        this.cars.connect(this.master);
        this.musicBus.connect(this.master);
        this.ui.connect(this.master);
        const highpass = biquadNode(context, 'highpass', 30, 0.7);
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 6;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.2;
        const trim = gainNode(context, COMPRESSOR_TRIM * 0.5);
        const clipper = context.createWaveShaper();
        clipper.curve = clipCurve();
        clipper.oversample = 'none';
        this.master.connect(highpass).connect(compressor).connect(trim).connect(clipper).connect(context.destination);
        /** The last node before the speakers (the bench hangs its analyser here). */
        this.output = clipper;
        // the shared reverb: the voices send into reverbIn, the convolver of the current space returns into the cars' bus
        this.reverbIn = gainNode(context, 1);
        this.reverbOut = gainNode(context, 1);
        this.reverbOut.connect(this.cars);
        this.convolver = null;
        this.spaceKey = null;
        this.spaceLevels = SPACES.street;
        this.noiseBuffer = toBuffer(context, noiseFor(context.sampleRate));
        this.effectBuffers = null;
        this.setVolumes(volume, music, true);
        this.setSpace(space);
        /** How long building the mixer took (ms; noise and the space's reverb are synthesized on the first mixer of a sample rate). */
        this.buildMs = typeof performance !== 'undefined' ? performance.now() - started : 0;
    }

    /** The one-shot buffers (pops, thud, metal, debris, blowOff, flutter, clunk) – synthesized on first use unless prepare() made them. */
    get buffers() {
        if (!this.effectBuffers) {
            const effects = effectsFor(this.context.sampleRate);
            const one = data => toBuffer(this.context, data);
            this.effectBuffers = {
                pops: effects.pops.map(one),
                thud: one(effects.thud),
                metal: effects.metal.map(one),
                debris: one(effects.debris),
                blowOff: one(effects.blowOff),
                flutter: one(effects.flutter),
                clunk: one(effects.clunk),
            };
        }
        return this.effectBuffers;
    }

    /** Makes what is otherwise made on first use – the one-shots and every engine wavetable; call it while nothing happens. */
    prepare() {
        for (const layout of Object.values(ENGINE_LAYOUTS)) for (const overrun of [false, true]) this.wave(layout, overrun);
        return this.buffers;
    }

    /** Master and music volume 0..1. */
    setVolumes(volume, music, now = false) {
        const t = this.context.currentTime;
        const v = num(volume, 0.8, 0, 1) * 0.9;
        const m = num(music, 0.5, 0, 1) * 0.35 * UI_GAIN;
        if (now) {
            this.master.gain.value = v;
            this.musicBus.gain.value = m;
        } else {
            this.master.gain.setTargetAtTime(v, t, 0.05);
            this.musicBus.gain.setTargetAtTime(m, t, 0.05);
        }
    }

    /** The acoustic space: 'open' | 'yard' | 'street' | 'hall', or a map key (pass, deck, harbor, city). */
    setSpace(kind) {
        const key = SPACES[kind] ? kind : MAP_SPACE[kind] ?? 'street';
        if (key === this.spaceKey) return;
        const ctx = this.context;
        const [left, right] = impulseFor(ctx.sampleRate, key);
        const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
        ir.copyToChannel(left, 0);
        ir.copyToChannel(right, 1);
        const convolver = ctx.createConvolver();
        convolver.normalize = false;
        convolver.buffer = ir;
        const old = this.convolver;
        this.reverbIn.connect(convolver).connect(this.reverbOut);
        if (old) {
            this.reverbIn.disconnect(old);
            setTimeout(() => old.disconnect(), 3000);
        }
        this.convolver = convolver;
        this.spaceKey = key;
        this.spaceLevels = SPACES[key];
    }

    nextSeed() {
        return this.seed++ * 7919;
    }

    /** The PeriodicWave of an engine layout (on load / overrun), made once per context. */
    wave(layout, overrun) {
        const key = `${layout.key}:${overrun}`;
        let wave = this.waves.get(key);
        if (!wave) {
            const { real, imag } = engineWave(layout, overrun);
            wave = this.context.createPeriodicWave(real, imag);
            this.waves.set(key, wave);
        }
        return wave;
    }

    /** A looping white-noise source (not started; start it at a random offset). */
    noise() {
        const source = this.context.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.loop = true;
        return source;
    }

    /** Plays a one-shot buffer: at (context time), gain, playback rate, destination node, fadeAfter (s: fade out from then on). */
    play(buffer, { at = this.context.currentTime, gain = 1, rate = 1, dest = this.cars, fadeAfter = 0 } = {}) {
        if (!buffer || !(gain > 0)) return;
        const ctx = this.context;
        const start = Math.max(at, ctx.currentTime);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const g = gainNode(ctx, gain);
        if (fadeAfter > 0) g.gain.setTargetAtTime(0, start + fadeAfter, fadeAfter * 0.3);
        source.connect(g).connect(dest);
        source.onended = () => g.disconnect();
        source.start(start);
    }

    /** A short tone: frequency (or [from, to]), duration, type, volume, delay, bus. */
    tone(freq, duration, { type = 'sine', volume = 0.2, delay = 0, bus = this.ui } = {}) {
        const ctx = this.context;
        const t = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        osc.type = type;
        const [from, to] = Array.isArray(freq) ? freq : [freq, freq];
        osc.frequency.setValueAtTime(from, t);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain).connect(bus);
        osc.onended = () => gain.disconnect();
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    /** A burst of filtered noise (snare, hats, hits). */
    burst(duration, { type = 'bandpass', frequency = 1000, q = 1, volume = 0.2, delay = 0, bus = this.ui } = {}) {
        const ctx = this.context;
        const t = ctx.currentTime + delay;
        const source = this.noise();
        const filter = biquadNode(ctx, type, frequency, q);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        source.connect(filter).connect(gain).connect(bus);
        source.onended = () => gain.disconnect();
        source.start(t, this.rng() * 3.5);
        source.stop(t + duration + 0.05);
    }

    /** An engine voice (see EngineVoice). */
    engine(options) {
        return new EngineVoice(this, options);
    }

    /** Schedules the music a quarter second ahead; call it every ~80 ms while the music plays. */
    musicTick() {
        const ctx = this.context;
        const sixteenth = 60 / 110 / 4;
        const m = (this.sequencer ??= { step: 0, next: ctx.currentTime + 0.1 });
        while (m.next < ctx.currentTime + 0.25) {
            const bar = Math.floor(m.step / 16) % 4;
            const s = m.step % 16;
            const delay = Math.max(0, m.next - ctx.currentTime);
            const bus = this.musicBus;
            if (s % 4 === 0) this.tone([140, 45], 0.28, { volume: 0.5, delay, bus });
            if (s === 4 || s === 12) this.burst(0.16, { frequency: 1800, q: 0.7, volume: 0.22, delay, bus });
            if (s % 2 === 1) this.burst(0.04, { type: 'highpass', frequency: 7000, volume: 0.08, delay, bus });
            this.tone(midi(BASS[s] - (bar === 3 ? 2 : 0)), sixteenth * 0.9, { type: 'sawtooth', volume: 0.1, delay, bus });
            if (s === 0) for (const n of CHORDS[bar]) this.tone(midi(n + 12), sixteenth * 15, { type: 'triangle', volume: 0.035, delay, bus });
            m.next += sixteenth;
            m.step++;
        }
    }

    stopMusic() {
        this.sequencer = null;
    }
}

/**
 * A mixer on any audio context – the game's live one, or an OfflineAudioContext for tests (dev/audio.html).
 * @param {BaseAudioContext} context
 * @param {{ volume?: number, music?: number, space?: string }} [options] master and music volume 0..1, the acoustic space
 */
export function createMixer(context, options) {
    return new Mixer(context, options);
}

// ---- one car

function pickLayout({ layout, cylinders, body }) {
    if (layout && ENGINE_LAYOUTS[layout]) return ENGINE_LAYOUTS[layout];
    if (cylinders === 6) return ENGINE_LAYOUTS.i6;
    if (cylinders === 8) return ENGINE_LAYOUTS.v8;
    if (cylinders === 4) return ENGINE_LAYOUTS.i4;
    return ENGINE_LAYOUTS[BODY_LAYOUT[body] ?? 'i4'];
}

/**
 * One car: engine, turbo, tyres, wind (own car), pops, impacts. update() every frame.
 * About 20 native nodes per voice (oscillators, biquads, gains, one shaper; no worklet, no script processor) – four voices at once are
 * cheap. The reverb is one convolver for all voices (in the mixer).
 */
class EngineVoice {
    /**
     * @param {Mixer} mixer
     * @param {{ turbo?: number, own?: boolean, body?: string, layout?: 'i4'|'i6'|'v8', cylinders?: number, seed?: number }} [options]
     */
    constructor(mixer, { turbo = 0, own = false, body, layout, cylinders, seed } = {}) {
        const ctx = mixer.context;
        this.mixer = mixer;
        this.context = ctx;
        this.own = own;
        this.turbo = num(turbo, 0, 0, 5);
        this.layout = pickLayout({ layout, cylinders, body });
        this.cylinders = this.layout.cylinders;
        this.rng = mulberry32(seed ?? mixer.nextSeed());
        /** What happened (the self-test reads it). */
        this.stats = { pops: 0, blowOffs: 0, shifts: 0, cuts: 0, impacts: 0 };
        this.disposed = false;
        this.lastTime = null;
        this.lastRpm = null;
        this.lastGear = null;
        this.lastDistance = null;
        this.radial = 0;
        this.shaft = 0;
        this.load = 0;
        this.throttlePeak = 0;
        this.lifted = true;
        this.shiftUntil = 0;
        this.shiftCooldown = 0;
        this.crackleUntil = 0;
        this.limiting = false;
        this.nextCut = 0;
        this.speedGuess = 0;
        this.lastImpactAt = -1;
        this.lastImpact = 0;
        /** True once the visual exhaust flames drive the pops (backfire()): then every bang has its flame and the voice's own guesses stop. */
        this.flames = false;
        this.phase = [this.rng() * 6.283, this.rng() * 6.283, this.rng() * 6.283];
        const t = ctx.currentTime;

        // ---- output: distance (the other cars: air absorption and stereo) and the send into the space's reverb
        this.out = gainNode(ctx, 0);
        if (own) {
            this.out.connect(mixer.cars);
        } else {
            this.air = biquadNode(ctx, 'lowpass', 20000, 0.5);
            this.out.connect(this.air);
            if (typeof ctx.createStereoPanner === 'function') {
                this.panner = ctx.createStereoPanner();
                this.air.connect(this.panner).connect(mixer.cars);
            } else {
                this.air.connect(mixer.cars);
            }
        }
        // the send follows the air absorption: a far car's reverb is dull too
        this.send = gainNode(ctx, 0);
        (this.air ?? this.out).connect(this.send).connect(mixer.reverbIn);
        const noise = mixer.noise();
        this.sources = [noise];

        // ---- engine: pulses (on load / overrun) + gated rasp → limiter cut → grit → exhaust (boom, formant, low-pass) → level
        const on = ctx.createOscillator();
        on.setPeriodicWave(mixer.wave(this.layout, false));
        const off = ctx.createOscillator();
        off.setPeriodicWave(mixer.wave(this.layout, true));
        for (const o of [on, off]) o.frequency.value = 900 / 120;
        this.pulses = [on, off];
        this.oscillators = [on, off];
        this.onGain = gainNode(ctx, 0);
        this.offGain = gainNode(ctx, 0);
        this.raspBand = biquadNode(ctx, 'bandpass', this.layout.rasp, 0.7);
        this.raspGate = gainNode(ctx, 0);
        this.raspDepth = gainNode(ctx, 0);
        this.mix = gainNode(ctx, 1);
        const shaper = ctx.createWaveShaper();
        shaper.curve = driveCurve();
        const [boomF, boomGain, boomQ] = this.layout.boom;
        const [formantF, formantGain, formantQ] = this.layout.formant;
        const boom = biquadNode(ctx, 'peaking', boomF, boomQ, boomGain);
        const formant = biquadNode(ctx, 'peaking', formantF, formantQ, formantGain);
        this.tone = biquadNode(ctx, 'lowpass', 1200, 0.75);
        this.level = gainNode(ctx, 0);
        on.connect(this.onGain).connect(this.mix);
        off.connect(this.offGain).connect(this.mix);
        noise.connect(this.raspBand).connect(this.raspGate).connect(this.mix);
        on.connect(this.raspDepth).connect(this.raspGate.gain);
        this.mix.connect(shaper).connect(boom).connect(formant).connect(this.tone).connect(this.level).connect(this.out);

        // ---- turbo: the compressor wheel's whistle and the air's hiss
        if (this.turbo > 0) {
            this.whistle = ctx.createOscillator();
            this.whistle.frequency.value = 1800;
            this.hiss = biquadNode(ctx, 'bandpass', 2600, 1.6);
            this.turboGain = gainNode(ctx, 0);
            this.whistle.connect(this.turboGain);
            noise.connect(this.hiss).connect(this.turboGain);
            this.turboGain.connect(this.out);
            this.oscillators.push(this.whistle);
        }

        // ---- tyres: two resonant bands of noise (a squeal with a pitch, never a pure tone)
        this.squealA = biquadNode(ctx, 'bandpass', 800, 4);
        this.squealB = biquadNode(ctx, 'bandpass', 1660, 3);
        this.tyreGain = gainNode(ctx, 0);
        noise.connect(this.squealA).connect(this.tyreGain);
        noise.connect(this.squealB).connect(this.tyreGain);
        this.tyreGain.connect(this.out);

        // ---- wind and road (the own car: it is the listener's)
        if (own) {
            this.windBand = biquadNode(ctx, 'lowpass', 300, 0.5);
            this.windGain = gainNode(ctx, 0);
            noise.connect(this.windBand).connect(this.windGain).connect(this.out);
        }

        for (const o of this.oscillators) o.start(t);
        noise.start(t, this.rng() * 3.5);
    }

    /**
     * Called every frame.
     * @param {{ rpm: number, throttle: number, slip?: number, distance?: number, limiter?: boolean,
     *           speed?: number, gear?: number, pan?: number }} state
     *   rpm; throttle 0..1; slip: sideways speed of the rear (m/s); distance (m) from the listener (0 = the own car); limiter: on the rev
     *   limiter; optional: speed over ground (m/s: wind and road noise; estimated from the revs without it), gear (exact shift dips;
     *   detected from the revs without it), pan −1 (left) … +1 (right) for the other cars (audio.pan(camera, x, z) computes it).
     */
    update({ rpm, throttle, slip = 0, distance = 0, limiter = false, speed, gear, pan } = {}) {
        if (this.disposed) return;
        const t = this.context.currentTime;
        const first = this.lastTime === null;
        const dt = first ? 0 : clamp(t - this.lastTime, 0, 0.1);
        this.lastTime = t;
        rpm = num(rpm, 900, 300, 11000);
        throttle = num(throttle, 0, 0, 1);
        slip = num(slip, 0, 0, 60);
        distance = num(distance, 0, 0, 10000);
        const rn = clamp((rpm - 700) / 7400, 0, 1);

        // ---- gear changes: the gearbox tells (gear), or a fast fall of the revs under throttle gives an upshift away
        let shift = 0;
        if (typeof gear === 'number' && Number.isFinite(gear)) {
            if (this.lastGear !== null && gear !== this.lastGear) shift = gear > this.lastGear ? 1 : -1;
            this.lastGear = gear;
        } else if (dt > 0 && this.lastRpm !== null && (this.lastRpm - rpm) / dt > 9000 && throttle > 0.4 && this.lastRpm > 3000 && t > this.shiftCooldown) {
            shift = 1;
        }
        this.lastRpm = rpm;
        if (shift !== 0) this.shifted(shift, t, rpm);
        const load = t < this.shiftUntil ? throttle * 0.12 : throttle;
        this.load += (load - this.load) * (dt > 0 ? 1 - Math.exp(-dt / 0.03) : 1);

        // ---- turbo: the shaft spools up with load and revs (lag grows with the turbo's size) and runs down slowly after a lift
        if (this.turbo > 0 && dt > 0) {
            const target = load * smoothstep((rpm - 2000) / 3000);
            const tau = target > this.shaft ? 0.35 + 0.08 * this.turbo : 0.9;
            this.shaft += (target - this.shaft) * (1 - Math.exp(-dt / tau));
        }

        // ---- lift-off (the peak throttle is held a moment, so a gamepad's slower lift counts too): pops, blow-off
        this.throttlePeak = Math.max(throttle, this.throttlePeak - dt * 3);
        if (throttle > 0.45) this.lifted = false;
        if (!this.lifted && this.throttlePeak > 0.6 && throttle < 0.2) {
            this.lifted = true;
            if (rpm > 3600) this.crackleUntil = t + 0.3 + 0.9 * rn;
            const boost = this.shaft * this.throttlePeak;
            if (this.turbo > 0 && boost > 0.3) this.blowOff(t + 0.015, boost, false);
        }
        if (dt > 0 && throttle < 0.25 && rpm > 2600 && t < this.crackleUntil) {
            const left = clamp((this.crackleUntil - t) / 0.6, 0.25, 1);
            const rate = (this.own ? 11 : 7) * left;
            if (!this.flames && this.rng() < rate * dt) this.pop(t + this.rng() * dt, 0.35 + 0.65 * this.rng());
        }

        // ---- rev limiter: ignition cuts
        this.limiterStep(limiter && throttle > 0.2, t);

        // ---- distance, Doppler, stereo (other cars)
        let doppler = 1;
        if (!this.own) {
            if (dt > 0 && this.lastDistance !== null) {
                const step = distance - this.lastDistance;
                if (Math.abs(step) < 30) this.radial += (clamp(step / dt, -70, 70) - this.radial) * Math.min(1, dt / 0.15);
            }
            this.lastDistance = distance;
            doppler = SPEED_OF_SOUND / (SPEED_OF_SOUND + this.radial);
        }
        const tau = first ? 0 : 1;

        // ---- engine
        const L = this.load;
        const cents = 6 * Math.sin(t * 3.1 + this.phase[0]) + 4 * Math.sin(t * 7.7 + this.phase[1]) + (this.rng() - 0.5) * 4 * (1 - rn);
        const cycle = (rpm / 120) * doppler * 2 ** (cents / 1200);
        for (const o of this.pulses) glide(o.frequency, cycle, t, 0.015 * tau);
        const rasp = this.layout.key === 'i6' ? 0.85 : 1;
        glide(this.onGain.gain, (0.18 + 0.82 * L) * (0.55 + 0.5 * rn), t, 0.02 * tau);
        glide(this.offGain.gain, (1 - L) * (0.42 + 0.4 * rn) * 0.85, t, 0.02 * tau);
        glide(this.raspGate.gain, (0.02 + 0.07 * L * rn + 0.02 * rn) * rasp, t, 0.03 * tau);
        glide(this.raspDepth.gain, (0.03 + 0.22 * L) * (0.35 + 0.65 * rn) * rasp, t, 0.03 * tau);
        glide(this.tone.frequency, (650 + 2400 * L + 1800 * rn * (0.35 + 0.65 * L)) * doppler, t, 0.04 * tau);
        const rough = 1 + (this.rng() - 0.5) * 0.12 * (1 - rn);
        glide(this.level.gain, LEVEL.engine * this.layout.level * (0.5 + 0.5 * rn) * (0.55 + 0.45 * L) * rough, t, 0.025 * tau);

        // ---- turbo
        if (this.turbo > 0) {
            const size = 0.55 + this.turbo * 0.09;
            glide(this.whistle.frequency, (1400 + 3400 * this.shaft) * doppler, t, 0.05 * tau);
            glide(this.hiss.frequency, (2200 + 3000 * this.shaft) * doppler, t, 0.05 * tau);
            glide(this.turboGain.gain, LEVEL.turbo * size * this.shaft ** 1.5 * (0.35 + 0.65 * L), t, 0.05 * tau);
        }

        // ---- tyres: onset at 2.5 m/s of slip, full at 12.5; a scrub at first (low Q), a sharper, higher squeal the more it slides
        const s = smoothstep((slip - 2.5) / 10);
        const wobble = Math.sin(t * 4.3 + this.phase[2]) * 0.6 + Math.sin(t * 10.1 + this.phase[0]) * 0.4;
        const pitch = (640 + 460 * s + 70 * wobble) * doppler;
        const q = 3 + 11 * s;
        glide(this.squealA.frequency, pitch, t, 0.05 * tau);
        glide(this.squealA.Q, q, t, 0.08 * tau);
        glide(this.squealB.frequency, pitch * 2.07, t, 0.05 * tau);
        glide(this.squealB.Q, 2 + 7 * s, t, 0.08 * tau);
        const chatter = 1 + (this.rng() - 0.5) * 0.5 * s;
        glide(this.tyreGain.gain, LEVEL.tyres * s ** 1.2 * chatter * Math.sqrt(q / 6), t, 0.03 * tau);

        // ---- wind and road noise
        if (this.windGain) {
            // without the speed a weak guess from the revs, slow enough that revving on the grid hardly makes wind
            if (dt > 0) this.speedGuess += (clamp((rpm - 1000) / 7000, 0, 1) * 42 - this.speedGuess) * (1 - Math.exp(-dt / 3));
            const v = typeof speed === 'number' && Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 120) : this.speedGuess * 0.5;
            glide(this.windBand.frequency, 220 + 24 * v, t, 0.2 * tau);
            glide(this.windGain.gain, LEVEL.wind * (v / 50) ** 1.8, t, 0.2 * tau);
        }

        // ---- output: the direct sound falls with the distance (1/r beyond a few metres), the reverb slower (it fills the space)
        const space = this.mixer.spaceLevels;
        const fade = first ? 0.02 : 0.06;
        if (this.own) {
            glide(this.out.gain, 1, t, fade);
            glide(this.send.gain, space.own, t, fade);
        } else {
            const near = DISTANCE_REF / (DISTANCE_REF + distance);
            glide(this.out.gain, LEVEL.other * near, t, fade);
            glide(this.send.gain, (space.others * Math.sqrt(near)) / (LEVEL.other * near), t, fade);
            // air absorbs the highs over distance – exaggerated a little, as ground and buildings do in reality
            glide(this.air.frequency, clamp(20000 / (1 + distance / 4), 700, 20000), t, fade);
            if (this.panner) glide(this.panner.pan, num(pan, 0, -1, 1) * clamp(distance / 5, 0, 1), t, 0.06);
        }
    }

    /**
     * A gear change: the load drops while the clutch is open (upshift) with a chirp of the blow-off valve under boost; a downshift at high
     * revs (the throttle blip) leaves a few pops in the hot exhaust; a clunk for the own car.
     */
    shifted(direction, t, rpm) {
        this.stats.shifts++;
        this.shiftCooldown = t + 0.35;
        if (direction > 0) {
            this.shiftUntil = t + 0.14;
            if (this.turbo > 0 && this.shaft * this.load > 0.45) this.blowOff(t + 0.01, this.shaft * 0.5, true);
        } else if (rpm > 3500) {
            this.crackleUntil = Math.max(this.crackleUntil, t + 0.4);
        }
        if (this.own) this.mixer.play(this.mixer.buffers.clunk, { at: t + 0.02, gain: LEVEL.clunk, rate: 0.9 + 0.2 * this.rng(), dest: this.out });
    }

    /** The limiter: ignition cuts at ~15 Hz scheduled a little ahead – the sound drops out, the revs sag and recover, now and then a pop. */
    limiterStep(active, t) {
        if (!active) {
            this.limiting = false;
            return;
        }
        if (!this.limiting) {
            this.limiting = true;
            this.nextCut = Math.max(this.nextCut, t + 0.01);
        }
        const gain = this.mix.gain;
        while (this.nextCut < t + 0.1) {
            const c = this.nextCut;
            const period = 1 / LIMITER_HZ;
            const cut = period * 0.45;
            gain.setValueAtTime(1, c);
            gain.linearRampToValueAtTime(0.1, c + 0.004);
            gain.setValueAtTime(0.1, c + cut);
            gain.linearRampToValueAtTime(1, c + cut + 0.006);
            for (const o of this.pulses) {
                o.detune.setValueAtTime(0, c);
                o.detune.linearRampToValueAtTime(-55, c + cut);
                o.detune.linearRampToValueAtTime(0, c + period * 0.9);
            }
            if (!this.flames && this.rng() < 0.3) this.pop(c + cut * this.rng(), 0.3 + 0.4 * this.rng());
            this.stats.cuts++;
            this.nextCut = c + period * (0.93 + 0.14 * this.rng());
        }
    }

    /**
     * A backfire the exhaust flames show (fx/flames.js through run.js): strength 0..1 – a lift-off bang ~0.65–1, an upshift 0.5, the limiter
     * ~0.4, the crackle after a lift ~0.2–0.5. A bigger pop is louder and deeper. From the first call on, the voice's own pops stop.
     * @param {number} strength
     */
    backfire(strength) {
        if (this.disposed || typeof strength !== 'number' || !(strength > 0)) return;
        this.flames = true;
        const s = clamp(strength, 0, 1);
        this.stats.pops++;
        const pops = this.mixer.buffers.pops;
        const t = this.context.currentTime;
        this.mixer.play(pops[Math.floor(this.rng() * pops.length)], { at: t, gain: LEVEL.pops * (0.3 + 0.9 * s), rate: 1.2 - 0.4 * s + 0.1 * this.rng(), dest: this.out });
        // a big bang shakes a little crackle loose after it
        if (s > 0.6) this.mixer.play(pops[Math.floor(this.rng() * pops.length)], { at: t + 0.03 + 0.05 * this.rng(), gain: LEVEL.pops * 0.3 * s, rate: 1.1 + 0.2 * this.rng(), dest: this.out });
    }

    /** One overrun pop (unburnt fuel in the hot exhaust). */
    pop(at, strength) {
        this.stats.pops++;
        const pops = this.mixer.buffers.pops;
        this.mixer.play(pops[Math.floor(this.rng() * pops.length)], { at, gain: LEVEL.pops * strength, rate: 0.8 + 0.4 * this.rng(), dest: this.out });
    }

    /** The boost escapes: a blow-off valve (bigger turbos) or the compressor's flutter (small ones); short = a chirp at a shift. */
    blowOff(at, strength, short) {
        this.stats.blowOffs++;
        const buffers = this.mixer.buffers;
        const flutter = this.turbo <= 2;
        const gain = (flutter ? LEVEL.flutter : LEVEL.blowOff) * clamp(strength, 0, 1) * (0.6 + 0.08 * this.turbo) * (short ? 0.6 : 1);
        const buffer = flutter ? buffers.flutter : buffers.blowOff;
        this.mixer.play(buffer, { at, gain, rate: (short ? 1.15 : 1) * (0.94 + 0.12 * this.rng()), dest: this.out, fadeAfter: short ? 0.12 : 0 });
    }

    /** A hit of the given strength (m/s into the wall or the other car): thud, sheet metal from ~4 m/s, debris from ~9 m/s. */
    impact(strength) {
        if (this.disposed || typeof strength !== 'number' || !(strength > 0)) return;
        const t = this.context.currentTime;
        // a contact over several frames is one hit (unless it gets much harder)
        if (t - this.lastImpactAt < 0.12 && strength < this.lastImpact * 1.5) return;
        this.lastImpactAt = t;
        this.lastImpact = strength;
        this.stats.impacts++;
        const s = clamp((strength - 2) / 14, 0, 1);
        const b = this.mixer.buffers;
        const rate = () => 0.9 + 0.2 * this.rng();
        this.mixer.play(b.thud, { at: t, gain: LEVEL.impact * (0.3 + 0.5 * s), rate: rate(), dest: this.out });
        if (strength > 4) this.mixer.play(b.metal[Math.floor(this.rng() * b.metal.length)], { at: t + 0.003, gain: LEVEL.impact * (0.15 + 0.55 * s ** 1.2), rate: rate(), dest: this.out });
        if (strength > 9) this.mixer.play(b.debris, { at: t + 0.02, gain: LEVEL.impact * 0.35 * s, rate: rate(), dest: this.out });
    }

    /** Fades out and frees the voice. */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        const t = this.context.currentTime;
        this.out.gain.cancelScheduledValues(t);
        this.out.gain.setTargetAtTime(0, t, 0.05);
        for (const source of [...this.oscillators, ...this.sources]) {
            try {
                source.stop(t + 0.4);
            } catch {
                // already stopped
            }
        }
        setTimeout(() => {
            this.out.disconnect();
            this.send.disconnect();
            this.air?.disconnect();
            this.panner?.disconnect();
        }, 600);
    }
}

/** A silent stand-in while audio is locked (the run keeps calling update). */
const SILENT = Object.freeze({ update() {}, impact() {}, backfire() {}, dispose() {}, stats: null });

// ---- menu blips and music

const UI = {
    click: m => m.tone(880, 0.05, { volume: 0.12 }),
    hover: m => m.tone(1320, 0.025, { volume: 0.04 }),
    buy: m => [523, 659, 784, 1047].forEach((f, k) => m.tone(f, 0.14, { type: 'triangle', volume: 0.16, delay: k * 0.07 })),
    error: m => m.tone([220, 140], 0.22, { type: 'square', volume: 0.08 }),
    medal: m => [784, 988, 1175, 1568].forEach((f, k) => m.tone(f, 0.6, { type: 'triangle', volume: 0.12, delay: k * 0.09 })),
    countdown: m => m.tone(523, 0.22, { type: 'square', volume: 0.1 }),
    go: m => m.tone(1047, 0.55, { type: 'square', volume: 0.12 }),
    bank: m => [659, 988].forEach((f, k) => m.tone(f, 0.12, { type: 'triangle', volume: 0.1, delay: k * 0.06 })),
    crash: m => m.tone([200, 70], 0.35, { type: 'sawtooth', volume: 0.1 }),
};

// the synthwave loop (110 BPM, A minor)
const BASS = [45, 45, 57, 45, 41, 41, 53, 41, 43, 43, 55, 43, 40, 40, 52, 47];
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];

function midi(n) {
    return 440 * 2 ** ((n - 69) / 12);
}

// ---- the page's live audio

let live = null;
let musicOn = false;
let musicTimer = 0;
let hiddenPause = false;
let spaceKind = 'street';

function ready() {
    return live !== null && live.context.state === 'running';
}

function applyVolumes() {
    if (!live) return;
    const s = settings.get();
    live.setVolumes(s.volume, s.music);
}

function startMusic() {
    if (musicTimer || !ready()) return;
    live.musicTick();
    musicTimer = setInterval(() => live.musicTick(), 80);
}

function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = 0;
    live?.stopMusic();
}

/** A hidden tab freezes the game loop: pause the sound with it (no engine droning on in the background). */
function onVisibility() {
    if (!live) return;
    const ctx = live.context;
    if (document.hidden) {
        if (ctx.state === 'running') {
            hiddenPause = true;
            stopMusic();
            ctx.suspend().catch(() => {});
        }
    } else if (hiddenPause) {
        hiddenPause = false;
        ctx.resume().then(() => musicOn && startMusic()).catch(() => {});
    }
}

export const audio = {
    /** Starts the audio context (call on a user gesture; does nothing before the page has seen one). */
    unlock() {
        if (!live) {
            // without a gesture the browser would only create a suspended context and warn about it
            if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
            const Context = window.AudioContext ?? window.webkitAudioContext;
            if (!Context) return;
            let ctx;
            try {
                ctx = new Context({ latencyHint: 'interactive' });
            } catch {
                return;
            }
            const s = settings.get();
            live = createMixer(ctx, { volume: s.volume, music: s.music, space: spaceKind });
            settings.onChange(applyVolumes);
            document.addEventListener('visibilitychange', onVisibility);
            // the one-shots and the engine wavetables while nothing happens, so neither the gesture nor the first run hitches
            const idle = window.requestIdleCallback ?? (fn => setTimeout(fn, 300));
            idle(() => live.prepare());
        }
        if (live.context.state === 'suspended' && !document.hidden) {
            hiddenPause = false;
            live.context.resume().then(() => musicOn && startMusic()).catch(() => {});
        }
        if (musicOn) startMusic();
    },

    /** A menu or game blip: 'click' | 'hover' | 'buy' | 'error' | 'medal' | 'countdown' | 'go' | 'bank' | 'crash'. */
    ui(name) {
        if (ready()) UI[name]?.(live);
    },

    /** Music on or off (plays once the audio is unlocked). */
    music(on) {
        musicOn = on;
        if (on) startMusic();
        else stopMusic();
    },

    /**
     * An engine voice for a car (a silent stand-in while the audio is locked).
     * @param {{ turbo?: number, own?: boolean, body?: string, layout?: 'i4'|'i6'|'v8', cylinders?: number }} options turbo: level 0..5;
     *   own: the player's car (loud, with wind and the gearbox clunk; the others get distance, Doppler and stereo); body: catalog body key
     *   (picks the engine: coupe/hatch four, sedan/fastback/wide six, muscle V8) – or layout / cylinders directly
     */
    engine(options) {
        return ready() ? live.engine(options) : SILENT;
    },

    /**
     * The acoustic space of the run (a shared reverb): a map key (pass: open air, deck: concrete hall, harbor: yard, city: street)
     * or 'open' | 'yard' | 'street' | 'hall'. Kept for a mixer that starts later.
     * @param {string} kind
     */
    space(kind) {
        spaceKind = kind;
        live?.setSpace(kind);
    },

    get unlocked() {
        return ready();
    },

    /** The live mixer (null until unlocked) – the dev bench taps its output. */
    get mixer() {
        return live;
    },

    /**
     * The stereo position of a point for voice.update({ pan }): −1 left … +1 right of the camera (x/z plane).
     * @param {{ matrixWorld: { elements: ArrayLike<number> } }} camera a three.js camera (world matrix up to date)
     * @param {number} x
     * @param {number} z
     */
    pan(camera, x, z) {
        const e = camera?.matrixWorld?.elements;
        if (!e) return 0;
        const dx = x - e[12];
        const dz = z - e[14];
        const d = Math.hypot(dx, dz);
        const r = Math.hypot(e[0], e[2]);
        if (d < 0.5 || r < 1e-6) return 0;
        return clamp((dx * e[0] + dz * e[2]) / (d * r), -1, 1);
    },
};
