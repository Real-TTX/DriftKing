// DriftKing · audio.js – every sound is synthesized with WebAudio (no samples): engines by RPM and load (with turbo whistle, blow-off and
// crackle on the overrun), tyre squeal, hits, countdown beeps, the menu blips and a small synthwave loop as music.
// Volumes: settings.volume (master) and settings.music. Browsers start audio only after a gesture: call audio.unlock() on the first click/key.

import { settings } from './settings.js';

let ctx = null;
let master = null;
let musicBus = null;
let noise = null;
let musicOn = false;
let musicTimer = 0;

function ready() {
    return ctx !== null && ctx.state === 'running';
}

function applyVolumes() {
    if (!ctx) return;
    const s = settings.get();
    master.gain.setTargetAtTime(s.volume * 0.9, ctx.currentTime, 0.05);
    musicBus.gain.setTargetAtTime(s.music * 0.35, ctx.currentTime, 0.05);
}

function noiseBuffer() {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
}

function noiseSource() {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer();
    source.loop = true;
    return source;
}

/** A short tone: frequency (or [from, to]), duration, type, volume, delay. */
function tone(freq, duration, { type = 'sine', volume = 0.2, delay = 0, bus = master } = {}) {
    if (!ready()) return;
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
    osc.start(t);
    osc.stop(t + duration + 0.05);
}

/** A burst of filtered noise (hits, blow-off, snare, hats). */
function burst(duration, { type = 'bandpass', frequency = 1000, q = 1, volume = 0.2, delay = 0, bus = master } = {}) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const source = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(bus);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
}

const UI = {
    click: () => tone(880, 0.05, { volume: 0.12 }),
    hover: () => tone(1320, 0.025, { volume: 0.04 }),
    buy: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.14, { type: 'triangle', volume: 0.16, delay: k * 0.07 })),
    error: () => tone([220, 140], 0.22, { type: 'square', volume: 0.08 }),
    medal: () => [784, 988, 1175, 1568].forEach((f, k) => tone(f, 0.6, { type: 'triangle', volume: 0.12, delay: k * 0.09 })),
    countdown: () => tone(523, 0.22, { type: 'square', volume: 0.1 }),
    go: () => tone(1047, 0.55, { type: 'square', volume: 0.12 }),
    bank: () => [659, 988].forEach((f, k) => tone(f, 0.12, { type: 'triangle', volume: 0.1, delay: k * 0.06 })),
    crash: () => tone([200, 70], 0.35, { type: 'sawtooth', volume: 0.1 }),
};

/** One engine (and the tyres of its car). update() every frame; distance in metres from the listener (0 = the own car). */
class EngineVoice {
    constructor({ turbo = 0, cylinders = 4, own = false } = {}) {
        this.own = own;
        this.turbo = turbo;
        this.cylinders = cylinders;
        this.boost = 0;
        this.lastThrottle = 0;
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(master);
        // engine: two saws and a square sub through a soft clip and a low-pass
        this.oscs = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
        this.oscs[0].type = 'sawtooth';
        this.oscs[1].type = 'sawtooth';
        this.oscs[1].detune.value = 9;
        this.oscs[2].type = 'square';
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0.18;
        this.shaper = ctx.createWaveShaper();
        this.shaper.curve = softClip();
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = 2.5;
        const mix = ctx.createGain();
        mix.gain.value = 0.4;
        for (const o of this.oscs) o.connect(mix);
        mix.connect(this.shaper).connect(this.filter).connect(this.engineGain).connect(this.out);
        // turbo whistle
        this.whistle = ctx.createOscillator();
        this.whistle.type = 'sine';
        this.whistleGain = ctx.createGain();
        this.whistleGain.gain.value = 0;
        this.whistle.connect(this.whistleGain).connect(this.out);
        // tyre squeal: noise through a resonant band-pass
        this.tyres = noiseSource();
        this.tyreFilter = ctx.createBiquadFilter();
        this.tyreFilter.type = 'bandpass';
        this.tyreFilter.Q.value = 6;
        this.tyreFilter.frequency.value = 1100;
        this.tyreGain = ctx.createGain();
        this.tyreGain.gain.value = 0;
        this.tyres.connect(this.tyreFilter).connect(this.tyreGain).connect(this.out);
        for (const o of [...this.oscs, this.whistle]) o.start();
        this.tyres.start();
    }

    /** rpm, throttle 0..1, slip (m/s of the rear), distance (m) from the listener, limiter (bool) */
    update({ rpm, throttle, slip = 0, distance = 0, limiter = false }) {
        const t = ctx.currentTime;
        const f = (rpm / 60) * (this.cylinders / 2);
        this.oscs[0].frequency.setTargetAtTime(f, t, 0.02);
        this.oscs[1].frequency.setTargetAtTime(f * 2, t, 0.02);
        this.oscs[2].frequency.setTargetAtTime(f * 0.5, t, 0.02);
        const load = limiter ? throttle * 0.4 : throttle;
        this.filter.frequency.setTargetAtTime(300 + load * 2200 + rpm * 0.18, t, 0.03);
        this.engineGain.gain.setTargetAtTime(0.1 + load * 0.16, t, 0.03);
        // turbo: spools with throttle and revs, whistles, blows off when the throttle closes
        const target = this.turbo > 0 ? throttle * Math.min(1, rpm / 6000) : 0;
        this.boost += (target - this.boost) * (target > this.boost ? 0.04 : 0.25);
        this.whistle.frequency.setTargetAtTime(1800 + this.boost * 2200, t, 0.05);
        this.whistleGain.gain.setTargetAtTime(this.boost * 0.012 * (this.turbo / 5 + 0.4), t, 0.05);
        if (this.turbo > 0 && this.lastThrottle > 0.7 && throttle < 0.2 && this.boost > 0.4 && this.own) {
            burst(0.32, { frequency: 2400, q: 0.8, volume: 0.09 * this.boost });
        }
        if (this.own && throttle < 0.05 && rpm > 4200 && Math.random() < 0.05) burst(0.05, { type: 'lowpass', frequency: 700, volume: 0.12 });
        this.lastThrottle = throttle;
        const squeal = Math.min(1, Math.max(0, (slip - 3) / 10));
        this.tyreFilter.frequency.setTargetAtTime(900 + squeal * 500 + Math.sin(t * 13) * 60, t, 0.05);
        this.tyreGain.gain.setTargetAtTime(squeal * 0.22, t, 0.06);
        const near = this.own ? 1 : 0.5 / (1 + distance / 10);
        this.out.gain.setTargetAtTime(near, t, 0.1);
    }

    /** A hit of the given strength (m/s). */
    impact(strength) {
        if (!this.own) return;
        const v = Math.min(0.5, strength / 25);
        burst(0.25, { type: 'lowpass', frequency: 500, volume: v });
        tone([110, 45], 0.25, { volume: v * 0.8 });
    }

    dispose() {
        const t = ctx.currentTime;
        this.out.gain.setTargetAtTime(0, t, 0.05);
        for (const o of [...this.oscs, this.whistle, this.tyres]) o.stop(t + 0.3);
        setTimeout(() => this.out.disconnect(), 400);
    }
}

function softClip() {
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.tanh(x * 2.2);
    }
    return curve;
}

/** A silent stand-in while audio is locked (the run keeps calling update). */
const SILENT = { update() {}, impact() {}, dispose() {} };

// ---- music: a small synthwave loop (110 BPM, A minor), scheduled ahead
const BASS = [45, 45, 57, 45, 41, 41, 53, 41, 43, 43, 55, 43, 40, 40, 52, 47];
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];

function midi(n) {
    return 440 * 2 ** ((n - 69) / 12);
}

function scheduleMusic() {
    const sixteenth = 60 / 110 / 4;
    let step = 0;
    let next = ctx.currentTime + 0.1;
    const tick = () => {
        while (next < ctx.currentTime + 0.25) {
            const bar = Math.floor(step / 16) % 4;
            const s = step % 16;
            const delay = next - ctx.currentTime;
            if (s % 4 === 0) tone([140, 45], 0.28, { volume: 0.5, delay, bus: musicBus });
            if (s === 4 || s === 12) burst(0.16, { frequency: 1800, q: 0.7, volume: 0.22, delay, bus: musicBus });
            if (s % 2 === 1) burst(0.04, { type: 'highpass', frequency: 7000, volume: 0.08, delay, bus: musicBus });
            tone(midi(BASS[s] - (bar === 3 ? 2 : 0)), sixteenth * 0.9, { type: 'sawtooth', volume: 0.1, delay, bus: musicBus });
            if (s === 0) for (const n of CHORDS[bar]) tone(midi(n + 12), sixteenth * 15, { type: 'triangle', volume: 0.035, delay, bus: musicBus });
            next += sixteenth;
            step++;
        }
    };
    tick();
    return setInterval(tick, 80);
}

export const audio = {
    /** Starts the audio context (call on the first user gesture). */
    unlock() {
        if (!ctx) {
            const Context = window.AudioContext ?? window.webkitAudioContext;
            if (!Context) return;
            ctx = new Context();
            master = ctx.createGain();
            const compressor = ctx.createDynamicsCompressor();
            master.connect(compressor).connect(ctx.destination);
            musicBus = ctx.createGain();
            musicBus.connect(master);
            applyVolumes();
            settings.onChange(applyVolumes);
        }
        if (ctx.state === 'suspended') ctx.resume().then(() => musicOn && this.music(true));
        if (musicOn && !musicTimer && ready()) musicTimer = scheduleMusic();
    },

    /** A menu or game blip: 'click' | 'hover' | 'buy' | 'error' | 'medal' | 'countdown' | 'go' | 'bank' | 'crash'. */
    ui(name) {
        UI[name]?.();
    },

    /** Music on or off (plays once the audio is unlocked). */
    music(on) {
        musicOn = on;
        if (!on && musicTimer) {
            clearInterval(musicTimer);
            musicTimer = 0;
        } else if (on && !musicTimer && ready()) {
            musicTimer = scheduleMusic();
        }
    },

    /** An engine voice for a car: { turbo: level 0..5, own: the player's car (loud, with overrun crackle and blow-off) }. */
    engine(options) {
        return ready() ? new EngineVoice(options) : SILENT;
    },

    get unlocked() {
        return ready();
    },
};
