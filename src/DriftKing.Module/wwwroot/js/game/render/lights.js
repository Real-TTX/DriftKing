// DriftKing · render/lights.js – the real lights of a map: a FIXED pool of SpotLights per quality (the light count never changes, so no shader
// ever recompiles) that is handed to the most relevant of any number of registered sources – the nearest to the camera, weighted by their reach –
// with hysteresis and short fades, so lamps do not pop. Far lamps keep their emissive heads, glows and pools.
// A 'spot' source is a cone (street lamp, floodlight, headlight); a 'point' source becomes a hemisphere (a spot of 90°) aimed along dir, down by
// default – a neon sign lighting the street in front of it, a tube under a ceiling. One kind of pool light keeps the shaders and the slots simple.
//   const rig = new LightRig(scene, 'medium');
//   rig.add({ x, y: 8.5, z, ...LIGHT_PRESETS.sodium });                      // a street lamp, aimed down
//   rig.add({ x, y: 4, z, ...LIGHT_PRESETS.neon, color: 0x29e7ff, dir: { x: 0, y: -0.4, z: 1 } });
//   rig.update(cameraPosition, dt);   // once per frame (world.update does it)
// Dynamic sources (other cars' headlights): keep the handle add() returns and move handle.position / handle.target every frame.

import * as THREE from 'three';

/**
 * Every lit material pays for every pool light on every pixel – three evaluates the whole BRDF of a spot light even where the pixel is
 * outside its cone or beyond its distance (the colour is 0 there). One branch per light skips that: on most pixels no pool light reaches,
 * and those pixels come in large coherent areas, so whole GPU wavefronts skip the BRDF. The picture stays exactly the same (a light that
 * is skipped added 0). Measured on the 610M: the pass on medium 19 → ~12 ms per frame. Patched once, before any program is compiled.
 */
function skipUnlitSpotLights() {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    if (chunk.includes('/* dk-skip-unlit */')) return;
    const start = chunk.indexOf('NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
    const call = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    const at = chunk.indexOf(call, start);
    if (start < 0 || at < 0) return;   // another three.js: leave its chunk alone
    THREE.ShaderChunk.lights_fragment_begin = `${chunk.slice(0, at)}/* dk-skip-unlit */ if ( directLight.visible ) { ${call} }${chunk.slice(at + call.length)}`;
}
skipUnlitSpotLights();

/**
 * The pool per quality: real lights that exist all the time (unused ones have intensity 0). Every lit material pays for every pool light on
 * every pixel – measured on an AMD Radeon 610M (city, 1366×768): 0 lights ≈ 5.4 ms, 6 ≈ 7.1 ms, 12 ≈ 9.9 ms per frame (docs/RENDERING.md).
 */
export const LIGHT_POOL = Object.freeze({ low: 0, medium: 6, high: 10 });

/**
 * The colour of a black body at a temperature (Kelvin), as an sRGB hex for THREE.Color: 2000 K high-pressure sodium, 2700–3000 K warm white,
 * 4000–5000 K LED street light, 6500 K daylight. (Tanner Helland's fit – good enough for light colours.)
 */
export function kelvinHex(kelvin) {
    const t = kelvin / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

/**
 * Sources that look right with the stage's tone mapping (intensity in candela, decay 2, distance = where the light ends, in metres).
 * Spread them into add(): rig.add({ x, y, z, ...LIGHT_PRESETS.sodium }).
 */
export const LIGHT_PRESETS = Object.freeze({
    /** High-pressure sodium street lamp (~2000 K), mounted 8–10 m: a warm pool of ~25 m. */
    sodium: Object.freeze({ type: 'spot', color: kelvinHex(2000), intensity: 420, distance: 30, decay: 2, angle: 1.05, penumbra: 0.6 }),
    /** LED street lamp (~4300 K), 8–10 m: whiter, a sharper cone. */
    led: Object.freeze({ type: 'spot', color: kelvinHex(4300), intensity: 380, distance: 28, decay: 2, angle: 0.95, penumbra: 0.45 }),
    /** A floodlight mast (harbour, parking lot), 18–25 m: wide and strong. */
    mast: Object.freeze({ type: 'spot', color: kelvinHex(2200), intensity: 2600, distance: 70, decay: 2, angle: 1.15, penumbra: 0.7 }),
    /** Fluorescent / LED tube under a deck ceiling (~5000 K), 2.5–3 m. */
    tube: Object.freeze({ type: 'point', color: kelvinHex(5000), intensity: 45, distance: 12, decay: 2 }),
    /** A neon sign's spill on the street (pass the sign's colour and dir = out of the wall): coloured, short. */
    neon: Object.freeze({ type: 'point', color: 0xff2e88, intensity: 60, distance: 14, decay: 2 }),
    /** A shop window / vending machine (dir = out of the window): warm, short. */
    shop: Object.freeze({ type: 'point', color: kelvinHex(3200), intensity: 70, distance: 12, decay: 2 }),
    /** A car headlight (one centred source for both lamps), aimed ~20 m ahead and a little down. */
    headlight: Object.freeze({ type: 'spot', color: kelvinHex(5200), intensity: 900, distance: 60, decay: 2, angle: 0.42, penumbra: 0.55 }),
    /** Car tail/brake lights: red, very short (only the road right behind), aimed back. */
    taillight: Object.freeze({ type: 'point', color: 0xff1a1a, intensity: 6, distance: 5, decay: 2 }),
});

const FADE_SECONDS = 0.35;
/** A source that has a light keeps it until another is clearly (20 %) more relevant. */
const KEEP_BONUS = 0.8;
/** Sources farther than 1.5 × their reach from the focus are never lit. */
const CUTOFF = 1.5;
const HEMISPHERE = Math.PI / 2;
const tmp = new THREE.Vector3();

/** A fixed pool of real lights shared by many light sources. */
export class LightRig {
    /**
     * @param {THREE.Object3D} parent where the pool lights live (the scene)
     * @param {string} quality low | medium | high (the pool size, see LIGHT_POOL)
     * @param {number} [size] overrides the pool size of the quality
     */
    constructor(parent, quality = 'medium', size = null) {
        const count = size ?? LIGHT_POOL[quality] ?? LIGHT_POOL.medium;
        this.group = new THREE.Group();
        this.group.name = 'LightRig';
        parent.add(this.group);
        /** All registered sources (handles). */
        this.sources = [];
        this.slots = [];
        for (let k = 0; k < count; k++) {
            const light = new THREE.SpotLight(0xffffff, 0, 30, 1, 0.5, 2);
            this.group.add(light, light.target);
            this.slots.push({ light, source: null, weight: 0 });
        }
        this.reserved = 0;
        this.sealed = false;
        this.focus = new THREE.Vector3();
        this.lastPosition = new THREE.Vector3();
        this.hasLast = false;
        this.heading = new THREE.Vector3();
        this.scores = new Float32Array(64);
        this.chosen = [];
    }

    /** How many real lights the pool has (fixed for the life of the rig). */
    get size() {
        return this.slots.length;
    }

    /**
     * Registers a light source. Returns its handle: position, target, color, intensity, distance, decay, angle, penumbra, priority and enabled
     * are live – change them any time (dynamic sources: move position and target every frame).
     * @param {{ x?: number, y?: number, z?: number, position?: THREE.Vector3, color?: THREE.ColorRepresentation, intensity?: number,
     *           distance?: number, decay?: number, type?: 'point'|'spot', target?: {x:number,y:number,z:number}, dir?: {x:number,y:number,z:number},
     *           angle?: number, penumbra?: number, priority?: number }} o
     *        type 'spot': a cone of angle (rad, ≤ π/2) around dir/target; 'point': a hemisphere around dir (default straight down).
     *        priority > 1 wins a light from farther away (a big mast), < 1 only when very near.
     */
    add(o) {
        const position = o.position ? o.position.clone() : new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0);
        const point = o.type === 'point';
        const target = o.target
            ? new THREE.Vector3(o.target.x, o.target.y, o.target.z)
            : position.clone().add(tmp.set(o.dir?.x ?? 0, o.dir?.y ?? -1, o.dir?.z ?? 0).normalize().multiplyScalar(10));
        const source = {
            type: point ? 'point' : 'spot',
            position,
            target,
            color: new THREE.Color(o.color ?? 0xffffff),
            intensity: o.intensity ?? 100,
            distance: o.distance ?? 25,
            decay: o.decay ?? 2,
            angle: point ? HEMISPHERE : Math.min(HEMISPHERE, o.angle ?? 1),
            penumbra: point ? 0.35 : o.penumbra ?? 0.5,
            priority: o.priority ?? 1,
            enabled: true,
            slot: null,
        };
        this.sources.push(source);
        if (this.scores.length < this.sources.length) this.scores = new Float32Array(this.sources.length * 2);
        return source;
    }

    /** Keeps n pool lights for sources that are added after the build (dynamic: other cars' headlights) when the rig is sealed. */
    reserve(n) {
        this.reserved += Math.max(0, n);
    }

    /**
     * Ends the build: drops the pool lights no registered or reserved source can ever use (each light costs every lit pixel).
     * Call it once, before the first render (buildWorld does) – from then on the light count is fixed.
     */
    seal() {
        if (this.sealed) return;
        this.sealed = true;
        const keep = Math.min(this.slots.length, this.sources.length + this.reserved);
        while (this.slots.length > keep) {
            const slot = this.slots.pop();
            slot.light.target.removeFromParent();
            slot.light.removeFromParent();
            slot.light.dispose();
        }
    }

    /** Removes a source (its light fades out). */
    remove(source) {
        const index = this.sources.indexOf(source);
        if (index < 0) return;
        this.sources.splice(index, 1);
        source.enabled = false;
    }

    /**
     * Hands the pool to the most relevant sources around the viewer; once per frame.
     * @param {THREE.Vector3} position the camera
     * @param {number} dt seconds
     * @param {THREE.Vector3} [forward] the viewing direction (unit); without it the direction of travel of the camera is used
     */
    update(position, dt, forward) {
        if (this.slots.length === 0) return;
        // look a little ahead: what is in front of the camera matters more than what is behind it
        if (forward) {
            this.heading.copy(forward);
        } else if (this.hasLast) {
            tmp.subVectors(position, this.lastPosition);
            if (tmp.lengthSq() > 1e-4) this.heading.lerp(tmp.normalize(), Math.min(1, dt * 4));
        }
        this.lastPosition.copy(position);
        this.hasLast = true;
        this.focus.copy(position).addScaledVector(this.heading, 10);
        this.assign(dt);
    }

    assign(dt) {
        const slots = this.slots;
        const sources = this.sources;
        const scores = this.scores;
        const f = this.focus;
        for (let i = 0; i < sources.length; i++) {
            const s = sources[i];
            if (!s.enabled || s.intensity <= 0) {
                scores[i] = Infinity;
                continue;
            }
            const p = s.position;
            const d = Math.sqrt((p.x - f.x) ** 2 + (p.y - f.y) ** 2 + (p.z - f.z) ** 2);
            let score = d / (Math.max(1, s.distance) * s.priority);
            if (s.slot) score *= KEEP_BONUS;
            scores[i] = score < CUTOFF ? score : Infinity;
        }
        // the best len(slots) sources (a few passes of selection: the pool is small)
        const chosen = this.chosen;
        chosen.length = 0;
        for (let k = 0; k < slots.length; k++) {
            let best = -1;
            let bestScore = Infinity;
            for (let i = 0; i < sources.length; i++) {
                if (scores[i] < bestScore) {
                    bestScore = scores[i];
                    best = i;
                }
            }
            if (best < 0) break;
            chosen.push(sources[best]);
            scores[best] = Infinity;
        }
        const step = dt / FADE_SECONDS;
        // lights whose source is no longer wanted fade out and become free; the others fade in
        for (const slot of slots) {
            const s = slot.source;
            if (!s) continue;
            if (!s.enabled || !chosen.includes(s)) {
                slot.weight -= step;
                if (slot.weight <= 0) {
                    slot.weight = 0;
                    s.slot = null;
                    slot.source = null;
                }
            } else {
                slot.weight = Math.min(1, slot.weight + step);
            }
        }
        // free lights take the chosen sources that have none yet
        let next = 0;
        for (const source of chosen) {
            if (source.slot) continue;
            while (next < slots.length && slots[next].source) next++;
            if (next >= slots.length) break;
            const free = slots[next];
            free.source = source;
            free.weight = 0;
            source.slot = free;
        }
        for (const slot of slots) this.apply(slot);
    }

    apply(slot) {
        const light = slot.light;
        const s = slot.source;
        if (!s) {
            light.intensity = 0;
            return;
        }
        const w = slot.weight * slot.weight * (3 - 2 * slot.weight);
        light.position.copy(s.position);
        light.color.copy(s.color);
        light.intensity = s.intensity * w;
        light.distance = s.distance;
        light.decay = s.decay;
        light.angle = s.angle;
        light.penumbra = s.penumbra;
        light.target.position.copy(s.target);
        light.target.updateMatrixWorld();
    }

    /** Which sources have a light right now (debugging, the dev pages). */
    active() {
        return this.slots.filter(s => s.source).map(s => ({ type: s.source.type, weight: s.weight, position: s.source.position }));
    }

    /** Removes the pool from the scene. */
    dispose() {
        this.group.removeFromParent();
        for (const slot of this.slots) slot.light.dispose();
        this.sources.length = 0;
    }
}
