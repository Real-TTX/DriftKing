// DriftKing · world/props-lamps.js – street lamps: a tapered pole on a base, a bracket arm, an LED luminaire (flat housing, a lens panel
// underneath) or a sodium "cobra head" (domed housing, a glowing refractor bowl you also see from the side). Instanced: three draw calls per
// call (pole and arm, housing, lens) however many lamps. The lens is emissive (it blooms on medium/high), the glow sprite and the light pool
// carry the look on low, and with options.lights every lamp registers a pool source of the light rig (render/lights.js).

import * as THREE from 'three';
import { mergeGeometries } from '../render/kit.js';
import { LIGHT_PRESETS } from '../render/lights.js';
import { instanced, isPbr, materialsOf, placement, rod } from './props-common.js';

/** The style of the luminaire per light preset. */
const STYLE = { sodium: 'cobra', led: 'led', mast: 'flood' };

/** True when a colour is warm (sodium-like): more red than blue. */
function isWarm(hex) {
    const c = new THREE.Color(hex);
    return c.r > c.b * 1.15;
}

/**
 * The parts of one lamp in its own frame (the arm reaches along +z, the pole stands at the origin): { metal, housing, lens } geometries,
 * and the head position (lens centre) – height h, arm length a, style 'led' | 'cobra' | 'flood'.
 */
function lampParts(h, a, style, quality) {
    const pbr = quality !== 'low';
    const segments = quality === 'high' ? 12 : pbr ? 8 : 6;
    const metal = [];
    // base cover and the tapered pole (galvanised steel, 0.24 → 0.12 m)
    const top = h - 0.25;
    metal.push(new THREE.CylinderGeometry(0.13, 0.16, 0.45, segments).translate(0, 0.225, 0));
    metal.push(new THREE.CylinderGeometry(0.06, 0.11, top - 0.2, segments, 1, true).translate(0, 0.2 + (top - 0.2) / 2, 0));
    // the bracket: out of the pole below its top in a bend, then on with a slight rise; a cap on the pole
    const elbow = { x: 0, y: h - 0.02, z: Math.min(0.5, a * 0.3) };
    const end = { x: 0, y: h + 0.12, z: a };
    metal.push(rod({ x: 0, y: top - 0.45, z: 0 }, elbow, 0.055, 0.045, Math.max(6, segments - 2)));
    metal.push(rod(elbow, end, 0.045, 0.035, Math.max(6, segments - 2)));
    metal.push(new THREE.SphereGeometry(0.062, segments, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, top, 0));
    if (pbr) metal.push(new THREE.CylinderGeometry(0.18, 0.18, 0.04, segments).translate(0, 0.02, 0));
    const housing = [];
    const lens = [];
    let head;
    if (style === 'cobra') {
        // a long dome (0.85 × 0.36 m) with the bowl refractor under it
        const dome = new THREE.SphereGeometry(1, pbr ? 14 : 8, pbr ? 6 : 4, 0, Math.PI * 2, 0, Math.PI / 2);
        dome.scale(0.19, 0.13, 0.44).translate(0, h + 0.1, a + 0.22);
        housing.push(dome);
        housing.push(new THREE.CircleGeometry(1, pbr ? 14 : 8).rotateX(Math.PI / 2).scale(0.19, 1, 0.44).translate(0, h + 0.1, a + 0.22));
        const bowl = new THREE.SphereGeometry(1, pbr ? 14 : 8, pbr ? 5 : 3, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        bowl.scale(0.15, 0.1, 0.33).translate(0, h + 0.1, a + 0.24);
        lens.push(bowl);
        head = { y: h + 0.02, z: a + 0.24 };
    } else if (style === 'flood') {
        housing.push(new THREE.BoxGeometry(0.7, 0.16, 0.5).translate(0, h + 0.12, a + 0.15));
        lens.push(new THREE.PlaneGeometry(0.62, 0.42).rotateX(Math.PI / 2).translate(0, h + 0.035, a + 0.15));
        head = { y: h + 0.03, z: a + 0.15 };
    } else {
        // a slim LED luminaire: 0.72 × 0.09 × 0.3 m, the lens panel underneath, slightly tilted up like the arm
        const body = new THREE.BoxGeometry(0.3, 0.09, 0.72);
        const tilt = 0.06;
        body.rotateX(-tilt).translate(0, h + 0.15, a + 0.26);
        housing.push(body);
        const panel = new THREE.PlaneGeometry(0.24, 0.6).rotateX(Math.PI / 2).rotateX(-tilt).translate(0, h + 0.103, a + 0.26);
        lens.push(panel);
        head = { y: h + 0.1, z: a + 0.26 };
    }
    return { metal, housing, lens, head };
}

/**
 * Street lamps at spots [{ x, y, z, yaw }] (yaw = the direction the arm reaches): instanced poles, arms and heads with an emissive lens, a
 * glow and a light pool below each, and (options.lights) a real light per pole.
 * options: colour (the lens/glow colour), height, arm, pool (radius of the pool), strength (of the pool) – as before;
 * lights (the light rig, ctx.lights): registers one source per pole (lamps sharing a pole share one source),
 * preset 'sodium' | 'led' | 'mast' (default: sodium for a warm colour, led for a cool one), materials (the factory),
 * pole 'galvanised' | 'painted' (default galvanised).
 */
export function buildLamps(root, spots, glows, pools, options = {}) {
    const { colour = 0xffd9a0, height = 8, arm = 2.2, pool = 9, strength = 0.55 } = options;
    if (spots.length === 0) return;
    const mats = materialsOf(options);
    const pbr = isPbr(mats);
    const preset = options.preset ?? (isWarm(colour) ? 'sodium' : 'led');
    const style = STYLE[preset] ?? 'led';
    const parts = lampParts(height, arm, style, mats.quality);
    const poleMaterial = options.pole === 'painted'
        ? mats.painted({ color: 0x4a4e55, roughness: 0.5 })
        : mats.metal({ color: 0x9a9ea3, roughness: 0.5 });
    const housingMaterial = mats.painted({ color: style === 'cobra' ? 0x8d9096 : 0x34373c, roughness: 0.45 });
    const lensMaterial = mats.emissive(colour, pbr ? 12 : 1.6);
    const matrices = spots.map(s => placement(s.x, s.y, s.z, s.yaw));
    const group = new THREE.Group();
    group.name = 'lamps';
    for (const [list, material, name] of [[parts.metal, poleMaterial, 'lamp-poles'], [parts.housing, housingMaterial, 'lamp-heads'], [parts.lens, lensMaterial, 'lamp-lenses']]) {
        const mesh = instanced(mergeGeometries(list), material, matrices, { castShadow: mats.quality === 'high' && name !== 'lamp-lenses', receiveShadow: pbr && name === 'lamp-poles', name });
        if (mesh) group.add(mesh);
    }
    root.add(group);
    // glows and pools as before; one real light per pole (two arms on one pole: one source between the heads, twice as strong).
    // With real lights (medium/high) the painted pool only keeps far lamps from going dark: a third of its strength
    const poolStrength = options.lights && pbr ? strength * 0.35 : strength;
    const poles = new Map();
    for (const s of spots) {
        const hx = s.x + Math.sin(s.yaw) * parts.head.z;
        const hz = s.z + Math.cos(s.yaw) * parts.head.z;
        // the sprite is the whole glare on low; with bloom (medium/high) a smaller halo is enough
        glows?.add(hx, s.y + parts.head.y - 0.05, hz, pbr ? 2.4 : 3.2, colour);
        pools?.add(s.x + Math.sin(s.yaw) * (arm - 0.2), s.y, s.z + Math.cos(s.yaw) * (arm - 0.2), pool, colour, poolStrength);
        if (!options.lights) continue;
        const key = `${Math.round(s.x * 4)}:${Math.round(s.z * 4)}`;
        const entry = poles.get(key);
        if (entry) {
            entry.x += hx;
            entry.z += hz;
            entry.n++;
        } else {
            poles.set(key, { x: hx, y: s.y + parts.head.y - 0.1, z: hz, n: 1 });
        }
    }
    const light = LIGHT_PRESETS[preset] ?? LIGHT_PRESETS.sodium;
    for (const p of poles.values()) {
        options.lights.add({ ...light, x: p.x / p.n, y: p.y, z: p.z / p.n, intensity: light.intensity * p.n });
    }
    return group;
}
