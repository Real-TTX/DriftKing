// DriftKing · car/model-materials.js – the materials of the cars. Shared per quality (one program each, every car uses the same objects):
// glass, chrome, tyre rubber, rim metals and caliper paints from render/materials.js; the cars' own vertex-coloured trims (gloss black, matte
// dark), the lamp material (HDR vertex colours: projector 22, DRL 8, unlit lenses below 1) and the dark of the far model. Per car (owned,
// disposed with the car): the paint with its livery atlas and the tail and reverse lamps, whose brightness changes while driving.

import * as THREE from 'three';
import { markShared, sharedTexture, canvasTexture } from '../render/kit.js';
import { materialsFor } from '../render/materials.js';

/** quality → the shared car materials of that quality */
const cache = new Map();

/** The brightness of the lamps (linear HDR, docs/RENDERING.md §5): tail 2.6 (a deep red that still blooms), braking 8, reverse 6, headlight lenses ~20. */
export const LAMP = Object.freeze({ tail: 2.6, brake: 8, reverseOff: 0.09, reverse: 6, head: 20, drl: 7 });

/**
 * The shared materials of the cars for a quality (cached; other qualities' own materials are freed when a new quality comes in).
 * @param {string} quality low | medium | high
 */
export function carMaterials(quality) {
    const mat = materialsFor(quality);
    let set = cache.get(quality);
    // a trimMaterials() since (a quality switch) made a new factory: its materials replace the freed ones
    if (set && set.factory === mat) return set;
    for (const [q, old] of cache) {
        for (const m of old.own) m.dispose();
        cache.delete(q);
    }
    const pbr = quality !== 'low';
    const own = [];
    const keep = m => {
        markShared(m);
        own.push(m);
        return m;
    };
    const colours = new Map();
    const byColour = (kind, hex, make) => {
        const key = `${kind}:${hex}`;
        if (!colours.has(key)) colours.set(key, make());
        return colours.get(key);
    };
    set = {
        quality,
        factory: mat,
        own,
        glass: mat.glass({ tint: 0x0a0d12, opacity: 0.74, roughness: 0.03 }),
        /** Head lamp covers: clearer glass. */
        lens: mat.glass({ tint: 0x10141a, opacity: 0.22, roughness: 0.02 }),
        chrome: mat.chrome({ color: 0xd4d6da, roughness: 0.07 }),
        tyre: mat.rubber({ tread: true }),
        disc: mat.metal({ color: 0x8e9196, roughness: 0.38, brushed: pbr }),
        /** Gloss black trim (window surrounds, B-pillars, wing, lamp bezels); vertex colours tint it (dark red garnish, white cage). */
        gloss: keep(pbr
            ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0 })
            : new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x555566, shininess: 90 })),
        /** Matte dark (arch liners, underside, grilles, interior, tyre-wall details); vertex colours give the greys. */
        matte: keep(pbr
            ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 })
            : new THREE.MeshLambertMaterial({ vertexColors: true })),
        /** Lamps that do not change (headlights, DRL, indicators, gauges): vertex colours are the HDR emission. */
        lamp: keep(new THREE.MeshBasicMaterial({ vertexColors: true })),
        /** Everything dark of the far model in one: glass, tyres, trim. */
        far: keep(pbr
            ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 })
            : new THREE.MeshLambertMaterial({ vertexColors: true })),
        shadow: keep(new THREE.MeshBasicMaterial({ map: sharedTexture('blob'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })),
        beam: keep(new THREE.MeshBasicMaterial({ map: sharedTexture('beam'), color: 0x8a8270, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })),
        /** Rim finish by colour: polished metal for light colours, gloss paint for dark ones. */
        rim(hex) {
            const c = new THREE.Color(hex);
            const dark = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.2;
            return dark ? mat.painted({ color: c.getHex(), roughness: 0.3 }) : mat.metal({ color: c.getHex(), roughness: 0.28 });
        },
        caliper: hex => mat.painted({ color: hex, roughness: 0.35 }),
        /** The neon tube under the sills (emissive, blooms). */
        neonTube: hex => mat.emissive(new THREE.Color(hex).getHex(), 6),
        /** The neon's light on the ground under the car (additive, one plane: bright core and a wide spill). */
        neonGround: hex => byColour('neon', hex, () => keep(new THREE.MeshBasicMaterial({
            map: neonTexture(), color: new THREE.Color(hex), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -5,
        }))),
    };
    cache.set(quality, set);
    return set;
}

/**
 * The car's own paint: clear-coated, metallic flakes on high, a pearl shift on light colours; the livery atlas is its map (white base).
 * @param {string} quality
 * @param {THREE.Texture} livery the car's atlas (owned by the car)
 * @param {THREE.Color} paint the paint colour (for the finish)
 */
export function paintMaterial(quality, livery, paint) {
    const hsl = paint.getHSL({});
    const metallic = hsl.l > 0.82 ? 0.25 : hsl.s < 0.12 ? 0.55 : 0.6;
    const pearl = hsl.l > 0.82 ? 0.55 : 0;
    const m = materialsFor(quality).carPaint(0xffffff, { metallic, pearl });
    m.map = livery;
    return m;
}

/** The tail lamps of one car (owned: its brightness follows the brakes): red, vertex colours shade the lens segments. */
export function tailMaterial() {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 0.022, 0.016).multiplyScalar(LAMP.tail) });
    m.userData.base = new THREE.Color(1, 0.022, 0.016);
    return m;
}

/** The reverse lamps of one car (owned): a dim clear lens, white light while backing up. */
export function reverseMaterial() {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(LAMP.reverseOff) });
    m.userData.base = new THREE.Color(1, 0.97, 0.92);
    return m;
}

let neonCache = null;
/** The underglow's light on the ground: a bright rounded core under the car, a faint wide spill (shared). */
function neonTexture() {
    if (neonCache) return neonCache;
    neonCache = canvasTexture(128, 192, (c, w, h) => {
        // an elliptical spill that fades out before the edges of the plane
        c.save();
        c.translate(w / 2, h / 2);
        c.scale(w / h, 1);
        const spill = c.createRadialGradient(0, 0, 2, 0, 0, h / 2);
        spill.addColorStop(0, 'rgba(255,255,255,0.5)');
        spill.addColorStop(0.5, 'rgba(255,255,255,0.2)');
        spill.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = spill;
        c.fillRect(-h / 2, -h / 2, h, h);
        c.restore();
        // the core: an elongated pool the size of the car
        c.save();
        c.translate(w / 2, h / 2);
        c.scale((w / h) * 0.62, 0.78);
        const core = c.createRadialGradient(0, 0, 2, 0, 0, h / 2);
        core.addColorStop(0, 'rgba(255,255,255,0.75)');
        core.addColorStop(0.55, 'rgba(255,255,255,0.4)');
        core.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = core;
        c.fillRect(-h / 2, -h / 2, h, h);
        c.restore();
    });
    neonCache.userData.shared = true;
    return neonCache;
}
