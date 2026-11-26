// DriftKing · tools/cars/lib.mjs – what inspect.mjs and prepare.mjs share: reading a downloaded model (glTF folder or .glb, Draco and
// meshopt inputs included), the node paths, the matching of cars.json rules, triangle counts and bounds.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

export const TOOLS = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(TOOLS, '..', '..');
export const WWWROOT = join(REPO, 'src', 'DriftKing.Module', 'wwwroot');

/** A NodeIO that reads every extension Sketchfab and the usual exporters write (Draco and meshopt geometry included). */
export async function createIO() {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
            'draco3d.decoder': await draco3d.createDecoderModule(),
            'meshopt.decoder': MeshoptDecoder,
            'meshopt.encoder': MeshoptEncoder,
        });
}

/** The model file of an input: a .glb/.gltf file, or a folder with scene.gltf / *.gltf / *.glb (an unpacked Sketchfab download). */
export function modelFile(input) {
    const path = resolve(input);
    if (!existsSync(path)) throw new Error(`not found: ${path}`);
    if (statSync(path).isFile()) return path;
    const files = readdirSync(path);
    const pick = files.find(f => f.toLowerCase() === 'scene.gltf') ?? files.find(f => /\.gltf$/i.test(f)) ?? files.find(f => /\.glb$/i.test(f));
    if (!pick) throw new Error(`no .gltf or .glb in ${path}`);
    return join(path, pick);
}

/** Reads cars.json (or another config file). */
export function readConfig(file = join(TOOLS, 'cars.json')) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

/** The name path of a node from the scene root: "Sketchfab_model/root/GLTF_SceneRootNode/wheel_fl/tire". */
export function nodePath(node) {
    const names = [];
    for (let n = node; n; n = n.getParentNode()) names.unshift(n.getName() || '#');
    return names.join('/');
}

/** Every node of a scene with its path (depth first). */
export function listNodes(scene) {
    const out = [];
    const walk = (node, depth) => {
        out.push({ node, depth, path: nodePath(node) });
        for (const child of node.listChildren()) walk(child, depth + 1);
    };
    for (const node of scene.listChildren()) walk(node, 0);
    return out;
}

/**
 * Compiles a rule of cars.json: a regex string (matched against the material name), or { material, node, mesh } (regexes, all given ones
 * must match; node = the node path, mesh = the mesh name). Case-insensitive. Returns (info) => boolean, info = { path, mesh, material }.
 */
export function compileRule(rule) {
    if (rule == null || rule === false) return () => false;
    if (typeof rule === 'string') {
        const re = new RegExp(rule, 'i');
        return info => re.test(info.material ?? '');
    }
    if (Array.isArray(rule)) {
        const parts = rule.map(compileRule);
        return info => parts.some(p => p(info));
    }
    const tests = [];
    if (rule.material) tests.push([new RegExp(rule.material, 'i'), 'material']);
    if (rule.node) tests.push([new RegExp(rule.node, 'i'), 'path']);
    if (rule.mesh) tests.push([new RegExp(rule.mesh, 'i'), 'mesh']);
    if (!tests.length) return () => false;
    return info => tests.every(([re, field]) => re.test(info[field] ?? ''));
}

/** Triangles of a primitive (triangle lists, strips and fans). */
export function triangles(prim) {
    const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
    const mode = prim.getMode();
    if (mode === 4) return Math.floor(count / 3);
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    return 0;
}

/** World-space bounds of a primitive under a matrix (column-major 4×4), or of its raw positions without one. */
export function primitiveBounds(prim, matrix = null) {
    const pos = prim.getAttribute('POSITION');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    if (!pos) return { min, max };
    const v = [0, 0, 0];
    const indices = prim.getIndices();
    // only the vertices the primitive uses (a shared vertex buffer may hold others)
    const used = indices ? new Set(indices.getArray()) : null;
    for (let i = 0; i < pos.getCount(); i++) {
        if (used && !used.has(i)) continue;
        pos.getElement(i, v);
        const p = matrix ? apply(matrix, v) : v;
        for (let k = 0; k < 3; k++) {
            if (p[k] < min[k]) min[k] = p[k];
            if (p[k] > max[k]) max[k] = p[k];
        }
    }
    return { min, max };
}

/** Applies a column-major 4×4 matrix to a point. */
export function apply(m, v) {
    const [x, y, z] = v;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

export function emptyBounds() {
    return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function growBounds(target, b) {
    for (let k = 0; k < 3; k++) {
        target.min[k] = Math.min(target.min[k], b.min[k]);
        target.max[k] = Math.max(target.max[k], b.max[k]);
    }
    return target;
}

export function isEmpty(b) {
    return !(b.max[0] >= b.min[0]);
}

export const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '–');
export const fmtBounds = b => (isEmpty(b) ? '(empty)' : `[${b.min.map(v => fmt(v)).join(', ')}] .. [${b.max.map(v => fmt(v)).join(', ')}]`);
export const sizeOf = b => b.max.map((v, k) => v - b.min[k]);

