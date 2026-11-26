#!/usr/bin/env node
// DriftKing · tools/cars/inspect.mjs – prints what a downloaded car model is made of, so its cars.json entry can be written:
// the node tree (meshes, materials, triangles, world bounds), the materials (textures, colour, alpha), the totals and hints
// (the long axis = the car's length, names that look like wheels, paint, glass, lamps).
//
//   node tools/cars/inspect.mjs <folder|scene.gltf|model.glb> [--depth 8] [--materials] [--all]
//
// --all lists every node (default: nodes with a mesh and their parents up to --depth), --materials only the materials.

import { getBounds } from '@gltf-transform/core';
import { createIO, modelFile, listNodes, triangles, primitiveBounds, emptyBounds, growBounds, fmt, fmtBounds, sizeOf } from './lib.mjs';

const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith('--'));
if (!input) {
    console.error('usage: node tools/cars/inspect.mjs <folder|scene.gltf|model.glb> [--depth 8] [--materials] [--all]');
    process.exit(1);
}
const depthArg = args.indexOf('--depth');
const maxDepth = depthArg >= 0 ? Number(args[depthArg + 1]) : 12;
const onlyMaterials = args.includes('--materials');
const all = args.includes('--all');

const io = await createIO();
const file = modelFile(input);
const doc = await io.read(file);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

console.log(`file      ${file}`);
console.log(`scenes    ${root.listScenes().length}  nodes ${root.listNodes().length}  meshes ${root.listMeshes().length}  materials ${root.listMaterials().length}` +
    `  textures ${root.listTextures().length}  animations ${root.listAnimations().length}  skins ${root.listSkins().length}`);
console.log(`extensions ${root.listExtensionsUsed().map(e => e.extensionName).join(', ') || '–'}`);

// ---- materials
const materialUse = new Map();
for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const m = prim.getMaterial();
        const t = triangles(prim) * Math.max(1, mesh.listParents().filter(p => p.propertyType === 'Node').length);
        materialUse.set(m, (materialUse.get(m) ?? 0) + t);
    }
}
console.log('\nMATERIALS (name · triangles · base colour · alpha · textures)');
for (const m of root.listMaterials()) {
    const c = m.getBaseColorFactor().map(v => fmt(v, 2)).join(' ');
    const tex = [];
    for (const [slot, t] of [['base', m.getBaseColorTexture()], ['normal', m.getNormalTexture()], ['mr', m.getMetallicRoughnessTexture()],
        ['ao', m.getOcclusionTexture()], ['emit', m.getEmissiveTexture()]]) {
        if (!t) continue;
        const size = t.getSize();
        tex.push(`${slot}:${t.getName() || t.getURI() || '?'}${size ? `(${size[0]}²)` : ''}`);
    }
    const e = m.getEmissiveFactor();
    const emissive = e.some(v => v > 0) ? ` emissive ${e.map(v => fmt(v, 2)).join(' ')}` : '';
    const ext = m.listExtensions().map(x => x.extensionName.replace(/^KHR_materials_/, '')).join(',');
    console.log(`  ${JSON.stringify(m.getName())}  ${materialUse.get(m) ?? 0} tris  rgba ${c}  ${m.getAlphaMode()}${m.getDoubleSided() ? ' double' : ''}` +
        `  metal ${fmt(m.getMetallicFactor())} rough ${fmt(m.getRoughnessFactor())}${emissive}${ext ? `  [${ext}]` : ''}${tex.length ? `\n      ${tex.join('  ')}` : ''}`);
}
if (onlyMaterials) process.exit(0);

// ---- nodes
console.log('\nNODES (path · mesh · per primitive: material and triangles · world bounds in model units)');
const nodes = listNodes(scene);
const withMesh = new Set();
for (const { node } of nodes) {
    if (!node.getMesh()) continue;
    for (let n = node; n; n = n.getParentNode()) withMesh.add(n);
}
let total = 0;
const overall = emptyBounds();
const hints = { wheel: [], brake: [], glass: [], paint: [], lamp: [] };
for (const { node, depth, path } of nodes) {
    if (!all && !withMesh.has(node)) continue;
    if (depth > maxDepth) continue;
    const mesh = node.getMesh();
    const indent = '  '.repeat(depth + 1);
    if (!mesh) {
        console.log(`${indent}${node.getName() || '#'}/`);
        continue;
    }
    const world = node.getWorldMatrix();
    const b = emptyBounds();
    const parts = [];
    for (const prim of mesh.listPrimitives()) {
        const t = triangles(prim);
        total += t;
        growBounds(b, primitiveBounds(prim, world));
        parts.push(`${prim.getMaterial()?.getName() ?? '(none)'}:${t}`);
    }
    growBounds(overall, b);
    console.log(`${indent}${node.getName() || '#'}  mesh "${mesh.getName()}"  ${parts.join(' ')}  ${fmtBounds(b)}`);
    const text = `${path} ${mesh.getName()} ${parts.join(' ')}`.toLowerCase();
    if (/wheel|tire|tyre|rim|felge|reifen/.test(text)) hints.wheel.push(path);
    if (/brake|caliper|disc|rotor/.test(text)) hints.brake.push(path);
    if (/glass|window|windshield|scheibe/.test(text)) hints.glass.push(path);
    if (/paint|body|carpaint|lack/.test(text)) hints.paint.push(path);
    if (/light|lamp|head|tail|brake_?light|indicator|blinker/.test(text)) hints.lamp.push(path);
}

// ---- totals and hints
const size = sizeOf(overall);
console.log(`\nTOTAL     ${total} triangles (instances counted once per node)`);
console.log(`bounds    ${fmtBounds(overall)}   size x ${fmt(size[0])}  y ${fmt(size[1])}  z ${fmt(size[2])}`);
const sceneBounds = getBounds(scene);
console.log(`scene     getBounds ${fmtBounds(sceneBounds)}`);
const long = size[0] > size[2] ? 'x' : 'z';
const tall = size[1] < Math.min(size[0], size[2]) ? 'y' : size[2] < size[0] ? 'z' : 'x';
console.log(`guess     length along ${long}, up along ${tall} → cars.json "forward": "+${long}" or "-${long}"` +
    `${tall !== 'y' ? `, and a "rotate" that brings ${tall} up` : ''} (check the sign in dev/cars.html: the headlights must face +z)`);
for (const [kind, list] of Object.entries(hints)) {
    if (list.length) console.log(`hint ${kind.padEnd(6)}${list.slice(0, 14).map(p => `\n    ${p}`).join('')}${list.length > 14 ? `\n    … ${list.length - 14} more` : ''}`);
}
