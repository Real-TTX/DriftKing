// DriftKing · render/materials.js – the material library, bound to the picture quality: physically based on medium/high (MeshStandard/Physical
// with the procedural textures of render/textures.js, a large-scale anti-tiling layer and puddles), cheap Lambert/Phong look-alikes on low.
//   const mat = materialsFor('medium');
//   road.material = mat.asphalt({ wet: 0.6 });  rail.material = mat.metal({ color: 0xa9adb3, roughness: 0.45 });  lamp.material = mat.emissive(0xffb46b, 8);
// Every material except carPaint and emissive-with-a-map is cached and shared (userData.shared: disposeTree leaves it) – never change a
// shared material in place; ask for another one (options are part of the cache key). Geometry UVs are in metres (textures: repeat = 1 / tile).
// A quality switch: trimMaterials(quality) (buildWorld calls it) frees the other qualities' materials and textures together.

import * as THREE from 'three';
import { disposeTextures, texturesFor, trimTextures } from './textures.js';

/** quality → { factory, release() } */
const factories = new Map();

/**
 * The material factory of a quality (one per quality, cached until trimMaterials drops it).
 * @param {string} quality low | medium | high
 */
export function materialsFor(quality = 'medium') {
    let entry = factories.get(quality);
    if (!entry) {
        entry = createFactory(quality);
        factories.set(quality, entry);
    }
    return entry.factory;
}

/**
 * Frees what the other qualities made – their cached materials, re-tiled texture clones and (through trimTextures) their textures – and
 * drops their factories, so no cached material keeps a freed texture alive (a later materialsFor(q) makes a fresh factory).
 * buildWorld calls it before it builds; a scene that uses the factories without buildWorld (the garage) should call it as well.
 * Everything of the given quality stays.
 * @param {string} quality the quality in use
 */
export function trimMaterials(quality) {
    for (const [q, entry] of factories) {
        if (q === quality) continue;
        entry.release();
        factories.delete(q);
    }
    trimTextures(quality);
}

/** Frees every factory's materials and every cached texture (the stage on dispose). */
export function disposeMaterials() {
    for (const entry of factories.values()) entry.release();
    factories.clear();
    disposeTextures();
}

function createFactory(quality) {
    const textures = texturesFor(quality);
    const pbr = quality !== 'low';
    const high = quality === 'high';
    // the shared materials; their textures are shared already (they come from texturesFor or are re-tiled clones of those)
    const cache = new Map();
    const once = (key, build) => {
        let material = cache.get(key);
        if (!material) {
            material = build();
            material.userData.shared = true;
            cache.set(key, material);
        }
        return material;
    };
    // materials owned by the caller (emissive with a sign texture): not shared – disposeTree frees them with their texture; until then the
    // same request returns the same material (a disposed one is forgotten)
    const owned = new Map();
    const ownedOnce = (key, build) => {
        let material = owned.get(key);
        if (!material) {
            material = build();
            owned.set(key, material);
            const forget = () => {
                if (owned.get(key) === material) owned.delete(key);
                material.removeEventListener('dispose', forget);
            };
            material.addEventListener('dispose', forget);
        }
        return material;
    };
    // re-tiled clones of texture sets (the scale option), per quality: freed with the factory
    const rescaledSets = new Map();
    const key = (name, o) => `${name}:${JSON.stringify(o)}`;
    const macroMap = pbr ? textures.macro().map : null;

    /** A textured surface: Lambert on low, MeshStandard with normal + ORM (+ the macro layer) above. */
    function surface(set, { color = 0xffffff, roughness = 1, metalness = null, normal = 1, macro = null, scale = null, side = THREE.FrontSide, emissive = null, extra = {} } = {}) {
        const s = scale ? rescaled(rescaledSets, set, scale) : set;
        if (!pbr) {
            return new THREE.MeshLambertMaterial({ map: s.map, color, side, ...(emissive ? { emissive: emissive.color, emissiveMap: s.emissiveMap, emissiveIntensity: emissive.intensity } : {}), ...pick(extra, ['transparent', 'alphaTest', 'opacity']) });
        }
        const m = new THREE.MeshStandardMaterial({
            map: s.map,
            normalMap: s.normalMap,
            roughnessMap: s.roughnessMap,
            metalnessMap: metalness === null ? s.metalnessMap : null,
            aoMap: s.aoMap,
            color,
            roughness,
            metalness: metalness ?? 1,
            side,
            ...(emissive ? { emissive: emissive.color, emissiveMap: s.emissiveMap, emissiveIntensity: emissive.intensity } : {}),
            ...extra,
        });
        m.normalScale.set(normal, normal);
        if (macro) addMacro(m, macroMap, macro);
        return m;
    }

    const factory = {
        quality,
        /** The texture recipes of the same quality. */
        textures,

        /**
         * Road asphalt. wet 0..1: a wet film (darker, glossy, lamps streak in it); puddles 0..1 (default = wet): standing water in large patches.
         * @param {{ wet?: number, puddles?: number, color?: number, scale?: number }} [o] scale: metres per texture tile (default 4)
         */
        asphalt(o = {}) {
            const { wet = 0, puddles = wet, color = 0xffffff, scale = null } = o;
            return once(key('asphalt', { wet, puddles, color, scale }), () => surface(textures.asphalt({ wet: wet >= 0.35 }), {
                color,
                scale,
                roughness: 1 - wet * 0.25,
                metalness: 0,
                normal: 1 - wet * 0.55,
                macro: { albedo: 0.22, roughness: 0.25, puddles, wet },
            }));
        },

        /** Cast concrete (walls, barriers, deck structure, quay). */
        concrete(o = {}) {
            const { color = 0xffffff, seams = true, stains = true, wet = 0, scale = null } = o;
            return once(key('concrete', { color, seams, stains, wet, scale }), () => surface(textures.concrete({ seams, stains }), {
                color, scale, metalness: 0, roughness: 1 - wet * 0.3, macro: { albedo: 0.18, roughness: 0.2, puddles: wet * 0.6, wet },
            }));
        },

        /** A painted / epoxy floor: color = the paint (parking deck green, garage grey). */
        floor(o = {}) {
            const { color = 0x8a8d90, wet = 0, scale = null } = o;
            return once(key('floor', { color, wet, scale }), () => surface(textures.floor(), {
                color, scale, metalness: 0, roughness: 1 - wet * 0.4, macro: { albedo: 0.12, roughness: 0.3, puddles: wet * 0.5, wet },
            }));
        },

        /** Ground off the road: kind 'grass' | 'dirt' | 'gravel'. */
        ground(o = {}) {
            const { kind = 'grass', color = 0xffffff, scale = null } = o;
            return once(key('ground', { kind, color, scale }), () => surface(textures.ground({ kind }), {
                color, scale, metalness: 0, macro: { albedo: 0.3, roughness: 0.1, puddles: 0, wet: 0 },
            }));
        },

        /** Rock faces (cuttings along the pass). */
        rock(o = {}) {
            const { color = 0xffffff, scale = null } = o;
            return once(key('rock', { color, scale }), () => surface(textures.rock(), { color, scale, metalness: 0, macro: { albedo: 0.25, roughness: 0.1, puddles: 0, wet: 0 } }));
        },

        /** Tree bark. */
        bark(o = {}) {
            const { color = 0xffffff } = o;
            return once(key('bark', { color }), () => surface(textures.bark(), { color, metalness: 0 }));
        },

        /** Foliage cards (alpha cut-out, double sided): kind 'needles' | 'leaves'. */
        foliage(o = {}) {
            const { kind = 'needles', color = 0xffffff } = o;
            return once(key('foliage', { kind, color }), () => surface(textures.foliage({ kind }), {
                color, metalness: 0, normal: 0.6, side: THREE.DoubleSide, extra: { alphaTest: 0.45, transparent: false },
            }));
        },

        /** Brick walls. */
        brick(o = {}) {
            const { color = 0xffffff, scale = null } = o;
            return once(key('brick', { color, scale }), () => surface(textures.brick(), { color, scale, metalness: 0, macro: { albedo: 0.15, roughness: 0.1, puddles: 0, wet: 0 } }));
        },

        /** Ceramic tiles (shop fronts, underpasses). */
        tiles(o = {}) {
            const { color = 0xffffff, scale = null } = o;
            return once(key('tiles', { color, scale }), () => surface(textures.tiles(), { color, scale, metalness: 0 }));
        },

        /**
         * A building facade with windows (4 bays × 4 storeys per 12 × 12.8 m tile); lit windows glow (emissive, blooms when glow > ~1).
         * @param {{ lit?: number, glow?: number, color?: number, seed?: number }} [o] lit: share of lit windows, glow: their brightness
         */
        facade(o = {}) {
            const { lit = 0.35, glow = 1.6, color = 0xffffff, seed = 131 } = o;
            return once(key('facade', { lit, glow, color, seed }), () => surface(textures.facade({ lit, seed }), {
                color, metalness: 0, emissive: { color: 0xffffff, intensity: glow }, macro: { albedo: 0.15, roughness: 0, puddles: 0, wet: 0 },
            }));
        },

        /** Corrugated sheet (containers, sheds): color = the paint; rust 0..1. */
        corrugated(o = {}) {
            const { color = 0x2f6fa8, rust = 0.5 } = o;
            return once(key('corrugated', { color, rust }), () => surface(textures.corrugated({ rust }), { color, metalness: 0 }));
        },

        /**
         * Bare metal (metalness 1): steel, aluminium, zinc. brushed adds the streak texture.
         * @param {{ color?: number, roughness?: number, brushed?: boolean }} [o]
         */
        metal(o = {}) {
            const { color = 0xa9adb3, roughness = 0.4, brushed = false } = o;
            return once(key('metal', { color, roughness, brushed }), () => {
                if (!pbr) return new THREE.MeshPhongMaterial({ color, specular: 0x777777, shininess: Math.round(80 * (1 - roughness) + 10) });
                if (brushed) return surface(textures.brushed(), { color, roughness: roughness / 0.28 });
                return new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 });
            });
        },

        /** Painted metal (poles, gantries, guardrail paint, car parts): a dielectric coat. */
        painted(o = {}) {
            const { color = 0x4a4f57, roughness = 0.5 } = o;
            return once(key('painted', { color, roughness }), () => pbr
                ? new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
                : new THREE.MeshLambertMaterial({ color }));
        },

        /** Chrome / polished metal (trim, exhausts, rims): a near-perfect mirror of the environment. */
        chrome(o = {}) {
            const { color = 0xd0d2d6, roughness = 0.08 } = o;
            return once(key('chrome', { color, roughness }), () => pbr
                ? new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 })
                : new THREE.MeshPhongMaterial({ color, specular: 0xffffff, shininess: 120 }));
        },

        /** Rubber: tyres (tread: the tread texture, u around the tyre), seals, bumpers. */
        rubber(o = {}) {
            const { color = 0x1b1b1d, tread = false, roughness = 0.88 } = o;
            return once(key('rubber', { color, tread, roughness }), () => {
                if (tread) return surface(textures.tread(), { color: 0xffffff, metalness: 0, roughness: roughness / 0.88 });
                return pbr ? new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }) : new THREE.MeshLambertMaterial({ color });
            });
        },

        /**
         * Glass: reflections at full strength, the background seen through it dimmed by opacity (premultiplied blending).
         * @param {{ tint?: number, opacity?: number, roughness?: number }} [o] tint: the colour of the glass body (dark for tinted car windows)
         */
        glass(o = {}) {
            const { tint = 0x0c1016, opacity = 0.55, roughness = 0.04 } = o;
            return once(key('glass', { tint, opacity, roughness }), () => {
                const options = { color: tint, transparent: true, opacity, depthWrite: false };
                const m = pbr
                    ? new THREE.MeshPhysicalMaterial({ ...options, roughness, metalness: 0, ior: 1.5, specularIntensity: 1 })
                    : new THREE.MeshPhongMaterial({ ...options, specular: 0xaaaaaa, shininess: 140 });
                // src × 1 + dst × (1 − a): the reflection is not dimmed by the opacity, the view through is
                m.blending = THREE.CustomBlending;
                m.blendSrc = THREE.OneFactor;
                m.blendDst = THREE.OneMinusSrcAlphaFactor;
                return m;
            });
        },

        /**
         * Car paint: a clear-coated MeshPhysicalMaterial (medium/high), metallic flakes on high, an optional pearl (thin-film) shift.
         * NOT shared: the car owns it and disposes it (its flake texture is shared).
         * @param {THREE.ColorRepresentation} color
         * @param {{ metallic?: number, pearl?: number, roughness?: number, clearcoat?: number }} [o] metallic 0..1 (solid … metallic), pearl 0..1
         */
        carPaint(color, o = {}) {
            const { metallic = 0.5, pearl = 0, roughness = 0.42 - metallic * 0.12, clearcoat = 1 } = o;
            if (!pbr) return new THREE.MeshPhongMaterial({ color, specular: 0x9a9aaa, shininess: 80 });
            const m = new THREE.MeshPhysicalMaterial({
                color,
                metalness: metallic * 0.75,
                roughness,
                clearcoat,
                clearcoatRoughness: 0.04,
                iridescence: pearl,
                iridescenceIOR: 1.35,
                iridescenceThicknessMinimum: 180,
                iridescenceThicknessMaximum: 420,
            });
            if (high && metallic > 0.05) {
                const flakes = textures.flakes();
                m.normalMap = flakes.normalMap;
                m.normalScale.set(0.22 * metallic, 0.22 * metallic);
            }
            return m;
        },

        /** Plastic (bumpers, mirrors, cones, signs' backs). */
        plastic(o = {}) {
            const { color = 0x1d1e22, roughness = 0.5 } = o;
            return once(key('plastic', { color, roughness }), () => pbr
                ? new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
                : new THREE.MeshLambertMaterial({ color }));
        },

        /**
         * A light-emitting surface (lamp lenses, neon tubes, LED strips, lit signs): unlit, linear HDR colour = colour × intensity.
         * The bloom (medium/high) starts where the brightest channel × intensity passes ~1: 1.5–2 a soft glow, 3–8 a lamp, 10–30 a bare bulb.
         * map: an optional sign texture (sRGB). Without a map the material is cached and shared. WITH a map it belongs to the caller like the
         * texture: not shared, so disposeTree frees material and texture with the world (a shared texture – userData.shared – stays);
         * until then every request with the same texture and options returns the same material.
         */
        emissive(color = 0xffffff, intensity = 4, o = {}) {
            const { map = null, fog = true, side = THREE.FrontSide } = o;
            const build = () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), map, fog, side });
            if (!map) return once(key('emissive', { color, intensity, fog, side }), build);
            return ownedOnce(key('emissive', { color, intensity, map: map.uuid, fog, side }), build);
        },
    };

    /** Frees the factory's shared materials and re-tiled clones (trimMaterials); the owned materials are their trees' business. */
    function release() {
        for (const material of cache.values()) material.dispose();
        cache.clear();
        for (const set of rescaledSets.values()) {
            for (const t of new Set([set.map, set.normalMap, set.roughnessMap, set.emissiveMap])) t?.dispose();
        }
        rescaledSets.clear();
        owned.clear();
    }
    return { factory, release };
}

/**
 * The set with its textures re-tiled: scale = metres per tile along u (v keeps the aspect of the recipe), cached in sets (the factory's).
 * Clones share the image and the GPU texture; only the repeat differs.
 */
function rescaled(rescaledSets, set, scale) {
    const key = `${set.map?.uuid}:${scale}`;
    if (rescaledSets.has(key)) return rescaledSets.get(key);
    const tile = [scale, scale * (set.tile[1] / set.tile[0])];
    const out = { ...set, tile };
    for (const name of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
        if (!set[name]) continue;
        const t = set[name].clone();
        t.repeat.set(1 / tile[0], 1 / tile[1]);
        t.userData.shared = true;
        out[name] = t;
    }
    out.metalnessMap = out.aoMap = out.roughnessMap;
    rescaledSets.set(key, out);
    return out;
}

function pick(object, keys) {
    const out = {};
    for (const k of keys) if (object[k] !== undefined) out[k] = object[k];
    return out;
}

// ---- the macro layer: large-scale variation in world space (no visible tiling), wet film and puddles on surfaces facing up

const MACRO_VERTEX_PARS = /* glsl */ `
    varying vec3 vMacroWorld;
    varying float vMacroUp;`;

const MACRO_VERTEX = /* glsl */ `
    vec4 macroWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
        macroWorld = instanceMatrix * macroWorld;
    #endif
    macroWorld = modelMatrix * macroWorld;
    vMacroWorld = macroWorld.xyz;
    // the world normal: three's view-space normal (instance and batch rotation and scale included) turned back by the camera
    vec3 macroNormal = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
    #ifdef FLIP_SIDED
        macroNormal = -macroNormal;
    #endif
    vMacroUp = macroNormal.y;`;

const MACRO_FRAGMENT_PARS = /* glsl */ `
    uniform sampler2D macroMap;
    uniform vec4 macroAmount; // x albedo variation, y roughness variation, z puddles, w wet film
    varying vec3 vMacroWorld;
    varying float vMacroUp;`;

// after map_fragment: tone variation at ~25 m and ~70 m, the puddle mask (only on surfaces facing up)
const MACRO_ALBEDO = /* glsl */ `
    vec2 macroUv = (vMacroWorld.xz + vec2(vMacroWorld.y * 0.6, -vMacroWorld.y * 0.4)) / 64.0;
    vec3 macroA = texture2D(macroMap, macroUv).rgb;
    vec3 macroB = texture2D(macroMap, macroUv * 0.37 + vec2(0.31, 0.57)).rgb;
    float macroTone = macroA.g * 0.55 + macroB.g * 0.45;
    diffuseColor.rgb *= 1.0 + (macroTone - 0.5) * macroAmount.x * 2.0;
    float macroFlat = smoothstep(0.85, 0.97, vMacroUp);
    float puddleField = macroA.r * 0.65 + macroB.r * 0.35;
    float puddle = macroAmount.z > 0.0 ? smoothstep(0.66 - macroAmount.z * 0.16, 0.69 - macroAmount.z * 0.16, puddleField) * macroFlat : 0.0;
    float wetFilm = macroAmount.w * macroFlat * smoothstep(0.35, 0.6, puddleField + macroAmount.w * 0.3);
    diffuseColor.rgb *= 1.0 - puddle * 0.45 - wetFilm * 0.2;`;

const MACRO_ROUGHNESS = /* glsl */ `
    roughnessFactor *= 1.0 + (macroA.b - 0.5) * macroAmount.y * 2.0;
    roughnessFactor = mix(roughnessFactor, max(roughnessFactor * 0.45, 0.08), wetFilm);
    roughnessFactor = mix(roughnessFactor, 0.035, puddle);`;

// puddles are flat water, the wet film evens out the surface between the stones (three quarters of the way); then specular anti-aliasing
// in GGX α² (α = roughness²), so a glossy bumpy surface widens its lobe instead of sparkling: the screen-space variance of the shading normal
// (Tokuyoshi & Kaplanyan 2019) plus the variance the normal map's mip filtering has averaged away (Toksvig: a filtered normal is shorter
// than 1; the 8-bit quantisation, ~0.004, is not variance), together at most 0.25 – more would turn a wet road matt in the distance
const MACRO_NORMAL = /* glsl */ `
    float macroFlatten = max(puddle, wetFilm * 0.75);
    normal = normalize(mix(normal, nonPerturbedNormal, macroFlatten));
    vec3 macroDx = dFdx(normal);
    vec3 macroDy = dFdy(normal);
    float macroKernel = 0.5 * (dot(macroDx, macroDx) + dot(macroDy, macroDy));
    #ifdef USE_NORMALMAP_TANGENTSPACE
        float macroLength = length(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0);
        float macroToksvig = max(0.0, 1.0 - macroLength - 0.004) / max(macroLength, 0.25);
        macroKernel += macroToksvig * normalScale.x * normalScale.x * (1.0 - macroFlatten);
    #endif
    roughnessFactor = sqrt(sqrt(min(1.0, pow4(roughnessFactor) + min(macroKernel, 0.25))));`;

/**
 * Adds the macro layer to a MeshStandardMaterial: { albedo, roughness, puddles, wet } (0..1 each).
 * The macro texture is sampled in world space (x/z, 64 m period at two scales), so it is continuous across meshes.
 */
function addMacro(material, macroMap, { albedo = 0.2, roughness = 0.2, puddles = 0, wet = 0 }) {
    const uniforms = { macroMap: { value: macroMap }, macroAmount: { value: new THREE.Vector4(albedo, roughness, puddles, wet) } };
    material.userData.macro = uniforms;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${MACRO_VERTEX_PARS}`)
            .replace('#include <project_vertex>', `#include <project_vertex>\n${MACRO_VERTEX}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${MACRO_FRAGMENT_PARS}`)
            .replace('#include <map_fragment>', `#include <map_fragment>\n${MACRO_ALBEDO}`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${MACRO_ROUGHNESS}`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${MACRO_NORMAL}`);
    };
    material.customProgramCacheKey = () => 'driftking-macro';
}
