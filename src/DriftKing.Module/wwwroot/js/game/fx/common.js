// DriftKing · fx/common.js – what the effect shaders share. Effects write linear light into the HDR target of the post chain (medium/high) and the
// colour as displayed straight to the canvas (low) – docs/RENDERING.md §9: the display colour is worked out per vertex here (the stage's cheap
// ACES fit and the sRGB curve), never per fragment, and the fragment only picks it (#ifdef TONE_MAPPING).

/** GLSL (vertex shader): fxDisplay(linear, exposure) – the colour as the direct path of low would show it after tone mapping and encoding. */
export const DISPLAY_GLSL = /* glsl */ `
    vec3 fxDisplay(vec3 linearColour, float exposure) {
        vec3 c = max(linearColour, vec3(0.0)) * exposure * 0.8;
        c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
        return pow(c, vec3(1.0 / 2.2));
    }`;

/** GLSL (vertex shader): moves a vertex out of the clip volume – an instance that is not shown costs no fragment. */
export const CULL_GLSL = /* glsl */ `
    const vec4 FX_HIDDEN = vec4(0.0, 0.0, 2.0, 1.0);`;

/** The exposure a scene is shown with (render/post.js reads scene.userData.post; the same default). */
export function exposureOf(scene) {
    return scene?.userData?.post?.exposure ?? 1.3;
}

/** The points of a light mount of a car model (userData.lightMounts.head | tail | exhaust): one point, a list or { left, right }. */
export function mountPoints(mount) {
    if (!mount) return null;
    if (Array.isArray(mount)) return mount.length ? mount : null;
    if (typeof mount.x === 'number') return [mount];
    const list = [mount.left, mount.right].filter(p => p && typeof p.x === 'number');
    return list.length ? list : null;
}

/**
 * Where a car's lamps and exhaust sit (car-local metres; the car faces +z, the ground is y = 0): from userData.lightMounts of the model
 * when the model has them, otherwise estimated from its body profile.
 * @returns {{ head: {x:number,y:number,z:number}[], tail: {x:number,y:number,z:number}[], exhaust: {x:number,y:number,z:number}[] }}
 */
export function carMounts(model) {
    const data = model?.userData ?? {};
    const mounts = data.lightMounts ?? {};
    const p = data.profile ?? {};
    const len = p.len ?? 2.2;
    const half = (p.width ?? 1.78) / 2;
    const headY = Math.max(0.55, (p.nose ?? 0.6) + 0.02);
    const tailY = Math.max(0.6, (p.tail ?? 0.86) - 0.1);
    const twin = p.width >= 1.84;
    return {
        head: mountPoints(mounts.head) ?? [{ x: half - 0.3, y: headY, z: len - 0.1 }, { x: -half + 0.3, y: headY, z: len - 0.1 }],
        tail: mountPoints(mounts.tail) ?? [{ x: half - 0.24, y: tailY, z: -len + 0.06 }, { x: -half + 0.24, y: tailY, z: -len + 0.06 }],
        exhaust: mountPoints(mounts.exhaust) ?? (twin
            ? [{ x: 0.52, y: 0.3, z: -len - 0.04 }, { x: -0.52, y: 0.3, z: -len - 0.04 }]
            : [{ x: -0.48, y: 0.3, z: -len - 0.04 }]),
    };
}

/** The centre of a list of points (into out). */
export function centreOf(points, out) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    for (const p of points) {
        out.x += p.x;
        out.y += p.y;
        out.z += p.z;
    }
    out.x /= points.length;
    out.y /= points.length;
    out.z /= points.length;
    return out;
}
