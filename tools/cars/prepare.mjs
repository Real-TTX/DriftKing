#!/usr/bin/env node
// DriftKing · tools/cars/prepare.mjs – turns a downloaded car model (an unpacked Sketchfab glTF folder or a .glb) into the game's car:
// wwwroot/models/cars/<key>.glb plus its entries in wwwroot/data/car-models.json (what the runtime reads) and data/car-credits.json
// (the CC-BY attribution the credits screen shows). Everything about one car is in its tools/cars/cars.json entry (README.md).
//
//   node tools/cars/prepare.mjs <key> [input] [--config file.json] [--keep-temp]
//   node tools/cars/prepare.mjs --remove <key>          (deletes the GLB and both registry entries)
//
// What it does: bakes every node transform into the vertices (flat model), drops what "exclude" names, turns the car so it faces +z with
// y up, scales it to the real length (metres), puts the wheels on y = 0 and the middle between the axles on z = 0; finds the four wheels
// (also when they are one merged mesh: "split": true cuts it by quadrant), gives them stable nodes (wheel_fl/fr/rl/rr, pivot at the
// wheel centre; caliper_xx for parts that steer but do not spin); names the role materials (paint, glass, light_head, …) and merges
// each replaced role into one material; welds and simplifies to a triangle budget; builds a far model (a few thousand triangles, one
// vertex-coloured material for everything that is not paint, glass or a lamp); resizes and re-encodes the textures (WebP); compresses
// the geometry (EXT_meshopt_compression).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import {
    compactPrimitive, convertPrimitiveToTriangles, dedup, dequantize, joinPrimitives, meshopt, metalRough, normals, prune,
    textureCompress, transformPrimitive, uninstance, weldPrimitive,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
    REPO, WWWROOT, compileRule, createIO, emptyBounds, fmt, growBounds, isEmpty, listNodes, modelFile, primitiveBounds, readConfig, sizeOf,
    triangles,
} from './lib.mjs';

/** Roles whose materials the runtime replaces by DriftKing's own (one material per role; textures dropped unless keepTextures names the role). */
const REPLACED = new Set(['paint', 'glass', 'lens', 'chrome', 'metal', 'rubber', 'rim', 'trim', 'plastic', 'caliper']);
/** Lamp roles: every source material stays (with its texture) and gets the role's name; the runtime makes them glow. */
const LAMPS = new Set(['light_head', 'light_drl', 'light_tail', 'light_brake', 'light_reverse', 'light_indicator']);
const CORNERS = ['fl', 'fr', 'rl', 'rr'];
const DEFAULTS = { triangles: 80000, farTriangles: 9000, textureSize: 1024, smallTextureSize: 512, textureFormat: 'webp', textureQuality: 82 };

const MODELS_DIR = join(WWWROOT, 'models', 'cars');
const MANIFEST = join(WWWROOT, 'data', 'car-models.json');
const CREDITS = join(WWWROOT, 'data', 'car-credits.json');

// ---------------------------------------------------------------- command line

const args = process.argv.slice(2);
const option = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
};
const configFile = option('--config');
const removeKey = option('--remove');
if (removeKey) {
    remove(removeKey);
    process.exit(0);
}
const [key, inputArg] = args.filter(a => !a.startsWith('--'));
if (!key) {
    console.error('usage: node tools/cars/prepare.mjs <key> [input] [--config file.json]\n       node tools/cars/prepare.mjs --remove <key>');
    process.exit(1);
}
const all = readConfig(configFile ? resolve(configFile) : undefined);
const config = all[key];
if (!config) throw new Error(`no entry "${key}" in ${configFile ?? 'tools/cars/cars.json'}`);
const settings = { ...DEFAULTS, ...config };
const inputPath = inputArg ?? (config.input ? resolve(REPO, config.input) : join(REPO, 'tmp', 'cars', key));
if (!config.length) throw new Error(`${key}: "length" (the real car length in metres) is missing`);
if (!config.wheels?.match) throw new Error(`${key}: "wheels.match" is missing (run inspect.mjs and name the wheel nodes)`);

const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------- read and clean up

const io = await createIO();
await MeshoptSimplifier.ready;
const file = modelFile(inputPath);
log(`reading ${file}`);
const doc = await io.read(file);
const root = doc.getRoot();
doc.setLogger({ debug() {}, info() {}, warn: m => console.warn('  gltf-transform:', m), error: m => console.error('  gltf-transform:', m) });
const used = root.listExtensionsUsed().map(e => e.extensionName);
if (used.includes('KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
await doc.transform(dequantize(), uninstance(), normals({ overwrite: false }));
if (config.pose != null) applyPose(Number(config.pose));
for (const a of root.listAnimations()) a.dispose();
for (const node of root.listNodes()) {
    if (node.getSkin()) {
        console.warn(`  warning: node "${node.getName()}" is skinned – taken in its bind pose`);
        node.setSkin(null);
    }
}
const scene = root.getDefaultScene() ?? root.listScenes()[0];
// "straighten": node path regex – those nodes lose their own rotation (a model shown with its front wheels steered)
if (config.straighten) {
    const re = new RegExp(config.straighten, 'i');
    for (const { node, path } of listNodes(scene)) if (re.test(path)) node.setRotation([0, 0, 0, 1]);
}

// ---------------------------------------------------------------- collect the primitives in the car's frame

const exclude = compileRule(normaliseRule(config.exclude, 'node'));
const roleRules = Object.entries(config.roles ?? {}).map(([role, rule]) => [role, compileRule(rule)]);
for (const role of Object.keys(config.roles ?? {})) {
    if (!REPLACED.has(role) && !LAMPS.has(role) && role !== 'exhaust') console.warn(`  note: role "${role}" is not one the game knows – its parts keep the model's material`);
}
const wheelRule = compileRule(normaliseRule(config.wheels.match, 'node'));
const brakeRule = compileRule(normaliseRule(config.wheels.brakes, 'node'));
const splitEndsRule = compileRule(config.splitEnds ?? null);
// "singleSided": a material rule – those lamp/kept materials lose double-siding (lamp lenses glowing through an open boot into the cabin)
const singleSidedRule = compileRule(config.singleSided ?? null);
const farExclude = compileRule(normaliseRule(config.farExclude ?? null, 'node'));
const orient = orientation(config);

/** { prim, info, source (material), role, wheel, brake, corner } */
let records = [];
let sourceTriangles = 0;
for (const { node, path } of listNodes(scene)) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = multiply(orient, node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
        if (![4, 5, 6].includes(prim.getMode())) continue;
        const material = prim.getMaterial();
        const info = { path, mesh: mesh.getName(), material: material?.getName() ?? '' };
        if (exclude(info)) continue;
        const copy = deepCopy(prim);
        if (copy.getMode() !== 4) convertPrimitiveToTriangles(copy);
        transformPrimitive(copy, world);
        sourceTriangles += triangles(copy);
        const brake = brakeRule(info);
        const wheel = brake || wheelRule(info);
        records.push({ prim: copy, info, source: material, role: null, wheel, brake, corner: null });
    }
}
if (!records.length) throw new Error('nothing left to prepare (all excluded?)');
// "end" (front | rear) of every part by its centre; "splitEnds" cuts the matching parts in two first (a lamp material that is
// both the head lamps and the reversing lamps) – role rules can then ask for { "material": …, "end": "rear" }
{
    const all = records.reduce((acc, r) => growBounds(acc, primitiveBounds(r.prim)), emptyBounds());
    const midZ = (all.min[2] + all.max[2]) / 2;
    records = records.flatMap(r => (!r.wheel && splitEndsRule(r.info) ? splitByEnd(r, midZ) : [r]));
    for (const r of records) {
        const b = primitiveBounds(r.prim);
        r.info = { ...r.info, end: (b.min[2] + b.max[2]) / 2 >= midZ ? 'front' : 'rear' };
        r.role = roleRules.find(([, test]) => test(r.info))?.[0] ?? null;
    }
}
log(`${records.length} primitives, ${sourceTriangles} triangles`);

// ---------------------------------------------------------------- scale, ground, centre

const bounds = emptyBounds();
const wheelBounds = emptyBounds();
for (const r of records) {
    r.bounds = primitiveBounds(r.prim);
    growBounds(bounds, r.bounds);
    if (r.wheel && !r.brake) growBounds(wheelBounds, r.bounds);
}
if (isEmpty(wheelBounds)) throw new Error('wheels.match found no wheel (check the regex against the node paths of inspect.mjs)');
const size = sizeOf(bounds);
if (size[0] > size[2]) console.warn(`  warning: the model is wider (x ${fmt(size[0])}) than long (z ${fmt(size[2])}) – is "forward" right?`);
if (size[1] > size[2]) console.warn(`  warning: the model is taller than long – is it lying on its side ("rotate")?`);
const scale = config.length / size[2];
const centreX = (bounds.min[0] + bounds.max[0]) / 2;
const axleMid = (wheelBounds.min[2] + wheelBounds.max[2]) / 2;
const ground = wheelBounds.min[1];
const normalise = multiply(translation(-centreX * scale, -ground * scale, -axleMid * scale), scaling(scale));
for (const r of records) {
    transformPrimitive(r.prim, normalise);
    r.bounds = primitiveBounds(r.prim);
}
log(`scale ${fmt(scale, 4)} (model length ${fmt(size[2], 3)} → ${config.length} m)`);
// "width": the real body width in metres (without mirrors) – narrows/widens a model built too fat or too thin (x only, wheels included)
if (config.width) {
    const measured = bodyWidth(records.filter(r => !r.wheel));
    const squeeze = [config.width / measured, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const r of records) {
        transformPrimitive(r.prim, squeeze);
        r.bounds = primitiveBounds(r.prim);
    }
    log(`width ×${fmt(config.width / measured, 3)} (body ${fmt(measured, 3)} → ${config.width} m)`);
}

// ---------------------------------------------------------------- the four wheels

const wheelRecords = records.filter(r => r.wheel);
const split = [];
for (const r of wheelRecords) {
    if (config.wheels.split) split.push(...splitByQuadrant(r));
    else {
        r.corner = cornerOf(centre(r.bounds));
        split.push(r);
    }
}
records = records.filter(r => !r.wheel).concat(split);
const wheels = {};
for (const corner of CORNERS) {
    const spinning = records.filter(r => r.corner === corner && !r.brake);
    if (!spinning.length) throw new Error(`no wheel parts at ${corner} (wheels.match / split?)`);
    const b = spinning.reduce((acc, r) => growBounds(acc, r.bounds), emptyBounds());
    wheels[corner] = { centre: centre(b), radius: (b.max[1] - b.min[1]) / 2, width: b.max[0] - b.min[0] };
}
const front = (wheels.fl.centre[2] + wheels.fr.centre[2]) / 2;
const rear = (wheels.rl.centre[2] + wheels.rr.centre[2]) / 2;
const wheelbase = front - rear;
const halfTrack = (Math.abs(wheels.fl.centre[0]) + Math.abs(wheels.fr.centre[0]) + Math.abs(wheels.rl.centre[0]) + Math.abs(wheels.rr.centre[0])) / 4;
const wheelRadius = CORNERS.reduce((s, c) => s + wheels[c].radius, 0) / 4;
log(`wheels: base ${fmt(wheelbase, 3)} m, half track ${fmt(halfTrack, 3)} m, radius ${fmt(wheelRadius, 3)} m`);
if (config.wheelbase && Math.abs(wheelbase - config.wheelbase) / config.wheelbase > 0.05) {
    console.warn(`  warning: measured wheelbase ${fmt(wheelbase, 3)} m differs from cars.json ${config.wheelbase} m by more than 5 % (length or wheels wrong?)`);
}
if (wheels.fl.centre[0] < 0 || wheels.fl.centre[2] < 0) console.warn('  warning: wheel corners look mirrored');

// ---------------------------------------------------------------- the car's measures and lamp mounts

const carBounds = records.reduce((acc, r) => growBounds(acc, r.bounds), emptyBounds());
const carWidth = bodyWidth(records.filter(r => !r.corner));
const mounts = {
    head: config.mounts?.head ?? lampMounts(records.filter(r => r.role === 'light_head' || r.role === 'light_drl'), 'front'),
    tail: config.mounts?.tail ?? lampMounts(records.filter(r => r.role === 'light_tail'), 'rear'),
    exhaust: config.mounts?.exhaust ?? lampMounts(records.filter(r => r.role === 'exhaust'), 'rear'),
};
for (const [kind, list] of Object.entries(mounts)) if (!list.length && kind !== 'exhaust') console.warn(`  warning: no ${kind} lamp mounts (map light_${kind} or set mounts.${kind})`);

// ---------------------------------------------------------------- materials: role names, merged replaced roles

const outputs = new Map(); // "role:<role>" (merged) or "<source id>|<role>" → output material
const sourceIds = new Map();
const counters = new Map();
const keepTextures = new Set(config.keepTextures ?? []);
for (const r of records) {
    r.source ??= doc.createMaterial('default');
    if (!sourceIds.has(r.source)) sourceIds.set(r.source, sourceIds.size);
    const merged = r.role && REPLACED.has(r.role) && !keepTextures.has(r.role);
    const id = merged ? `role:${r.role}` : `${sourceIds.get(r.source)}|${r.role ?? ''}`;
    let m = outputs.get(id);
    if (!m) {
        if (merged) {
            // one plain material per replaced role (the runtime swaps it for DriftKing's own): no textures, no extensions
            m = r.source.clone().setName(r.role);
            for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']) m[`set${slot}Texture`](null);
            for (const ext of m.listExtensions()) m.setExtension(ext.extensionName, null);
        } else {
            const base = r.role ?? `x_${(r.source.getName() || 'material').replace(/[^A-Za-z0-9_-]+/g, '_')}`;
            const n = (counters.get(base) ?? 0) + 1;
            counters.set(base, n);
            m = r.source.clone().setName(n === 1 ? base : `${base}.${n}`);
        }
        outputs.set(id, m);
    }
    if (merged && r.source.getDoubleSided()) m.setDoubleSided(true);
    if (!merged && singleSidedRule(r.info)) m.setDoubleSided(false);
    r.material = m;
}

// ---------------------------------------------------------------- the far model (from the full-detail parts, in place)

log('far model');
const meanColours = new Map();
for (const r of records) {
    const kind = farKind(r);
    if (kind !== 'far' || meanColours.has(r.material)) continue;
    // metal reads dark in diffuse light (its colour is in the reflection): the far model has no reflections worth the name
    const shine = ['chrome', 'metal', 'rim'].includes(r.role) ? 0.4 : 1 - 0.5 * (r.source?.getMetallicFactor() ?? 0);
    meanColours.set(r.material, (await meanColour(r.source)).map(v => Math.min(0.65, v * shine)));
}
const farMaterial = doc.createMaterial('far').setRoughnessFactor(0.45).setMetallicFactor(0);
const farGroups = new Map();
for (const r of records) {
    if (r.bounds && Math.max(...sizeOf(r.bounds)) < 0.04) continue; // bolts, badges, wiper nozzles
    if (farExclude(r.info)) continue; // "farExclude": detail the far model can do without (grille meshes that do not simplify)
    const kind = farKind(r);
    const copy = deepCopy(r.prim);
    // position and normal only (lamps keep their UVs: a lamp texture stays on the lens)
    const keep = kind === 'head' || kind === 'tail' ? ['POSITION', 'NORMAL', 'TEXCOORD_0'] : ['POSITION', 'NORMAL'];
    for (const semantic of copy.listSemantics()) if (!keep.includes(semantic)) copy.setAttribute(semantic, null);
    compactPrimitive(copy);
    let material;
    if (kind === 'far') {
        const c = meanColours.get(r.material) ?? [0.05, 0.05, 0.05];
        const count = copy.getAttribute('POSITION').getCount();
        // RGBA: the meshopt encoder wants 4-byte vertex attributes after quantisation
        const colours = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) colours.set([...c, 1], i * 4);
        copy.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colours));
        material = farMaterial;
    } else {
        material = kind === 'tail' ? firstMaterial('light_tail') : kind === 'head' ? firstMaterial('light_head') ?? firstMaterial('light_drl') : r.material;
    }
    copy.setMaterial(material);
    weldPrimitive(copy);
    if (!farGroups.has(material)) farGroups.set(material, []);
    farGroups.get(material).push(copy);
}
const farPrims = [];
for (const [material, prims] of farGroups) farPrims.push(...joinBySignature(prims, material));
simplifyAll(farPrims, settings.farTriangles, { prune: true, maxError: 0.15 });
dropEmpty(farPrims);
const farTriangles = farPrims.reduce((s, p) => s + triangles(p), 0);
log(`far: ${farTriangles} triangles, ${farPrims.length} draw calls`);

// ---------------------------------------------------------------- the near model: wheels around their centres, weld, join, simplify

for (const r of records) {
    if (r.corner) transformPrimitive(r.prim, translation(...wheels[r.corner].centre.map(v => -v)));
    r.prim.setMaterial(r.material);
    for (const target of r.prim.listTargets()) r.prim.removeTarget(target);
    weldPrimitive(r.prim);
}
const groups = new Map(); // part (body | wheel_fl | caliper_fl …) → material → prims
for (const r of records) {
    const part = r.corner ? `${r.brake ? 'caliper' : 'wheel'}_${r.corner}` : 'body';
    if (!groups.has(part)) groups.set(part, new Map());
    const byMaterial = groups.get(part);
    if (!byMaterial.has(r.material)) byMaterial.set(r.material, []);
    byMaterial.get(r.material).push(r.prim);
}
const parts = new Map();
for (const [part, byMaterial] of groups) {
    const prims = [];
    for (const [material, list] of byMaterial) prims.push(...joinBySignature(list, material));
    parts.set(part, prims);
}
const nearPrims = [...parts.values()].flat();
simplifyAll(nearPrims, settings.triangles, { maxError: 0.05 });
for (const list of parts.values()) dropEmpty(list);
const nearTriangles = nearPrims.reduce((s, p) => s + triangles(p), 0);
log(`near: ${nearTriangles} triangles (budget ${settings.triangles}), ${nearPrims.length} draw calls ` +
    `(body ${parts.get('body')?.length ?? 0}, wheels ${CORNERS.reduce((s, c) => s + (parts.get(`wheel_${c}`)?.length ?? 0) + (parts.get(`caliper_${c}`)?.length ?? 0), 0)})`);

// ---------------------------------------------------------------- the output scene

const entry = {
    url: `models/cars/${key}.glb`,
    v: '',
    bytes: 0,
    triangles: nearTriangles,
    farTriangles,
    length: round(carBounds.max[2] - carBounds.min[2]),
    width: round(carWidth),
    span: round(carBounds.max[0] - carBounds.min[0]),
    height: round(carBounds.max[1]),
    front: round(carBounds.max[2]),
    rear: round(carBounds.min[2]),
    wheelbase: round(wheelbase),
    halfTrack: round(halfTrack),
    wheelRadius: round(wheelRadius),
    wheels: Object.fromEntries(CORNERS.map(c => [c, wheels[c].centre.map(round)])),
    mounts: Object.fromEntries(Object.entries(mounts).map(([k, list]) => [k, list.map(p => p.map(round))])),
    paintable: config.paintable !== false,
    ...(config.lamps ? { lamps: config.lamps } : {}),
    ...(config.profile ? { profile: config.profile } : {}),
};
for (const old of scene.listChildren()) scene.removeChild(old);
for (const s of root.listScenes()) if (s !== scene) s.dispose();
const car = doc.createNode('car').setExtras({ driftking: { key, ...entry, url: undefined } });
scene.addChild(car);
scene.setName('car');
const addPart = (name, prims, at = null) => {
    if (!prims?.length) return;
    const mesh = doc.createMesh(name);
    for (const p of prims) mesh.addPrimitive(p);
    const node = doc.createNode(name).setMesh(mesh);
    if (at) node.setTranslation(at);
    car.addChild(node);
};
addPart('body', parts.get('body'));
for (const c of CORNERS) {
    addPart(`wheel_${c}`, parts.get(`wheel_${c}`), wheels[c].centre);
    addPart(`caliper_${c}`, parts.get(`caliper_${c}`), wheels[c].centre);
}
addPart('far', farPrims);
for (const node of root.listNodes()) if (!isUnder(node, car)) node.dispose();
for (const mesh of root.listMeshes()) if (!mesh.listParents().some(p => p.propertyType === 'Node')) mesh.dispose();
// materials keep their names: two role materials cloned from one source (light_head / light_reverse) are identical but must stay two
await doc.transform(
    prune({ keepAttributes: false, keepLeaves: false }),
    dedup({ propertyTypes: ['Accessor', 'Mesh', 'Texture'] }),
    dedup({ propertyTypes: ['Material'], keepUniqueNames: true }),
);

// ---------------------------------------------------------------- textures and compression

const format = settings.textureFormat;
const textureOptions = { encoder: sharp, targetFormat: format === 'keep' ? undefined : format, quality: settings.textureQuality };
await doc.transform(
    textureCompress({ ...textureOptions, resize: [settings.textureSize, settings.textureSize], slots: /^(baseColor|emissive)/ }),
    textureCompress({ ...textureOptions, resize: [settings.smallTextureSize, settings.smallTextureSize], slots: /^(?!baseColor|emissive)/ }),
);
if (root.listTextures().some(t => t.getMimeType() === 'image/webp')) doc.createExtension(EXTTextureWebP).setRequired(true);
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

mkdirSync(MODELS_DIR, { recursive: true });
const out = join(MODELS_DIR, `${key}.glb`);
await io.write(out, doc);
const bytes = statSync(out).size;
entry.bytes = bytes;
entry.v = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 10);
const textureBytes = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
log(`wrote ${relative(REPO, out)}: ${(bytes / 1048576).toFixed(2)} MB (textures ${(textureBytes / 1048576).toFixed(2)} MB, ` +
    `${root.listTextures().length} textures, ${root.listMaterials().length} materials)`);
if (bytes > 3 * 1048576) console.warn('  warning: more than 3 MB – lower "triangles", "textureSize" or exclude hidden parts (engine bay, underbody)');

writeRegistry(key, entry, config);
log(`registered "${key}" in data/car-models.json and data/car-credits.json`);
console.log(`\ncheck it: node scripts/serve.mjs → /driftking/dev/cars.html?view=close&car=${key}&quality=high`);

// ================================================================ helpers

/** "pose": puts every animated node in its pose at `time` seconds (linear between keyframes; the model's static pose otherwise). */
function applyPose(time) {
    for (const animation of root.listAnimations()) {
        for (const channel of animation.listChannels()) {
            const node = channel.getTargetNode();
            const path = channel.getTargetPath();
            const sampler = channel.getSampler();
            if (!node || !sampler || !['translation', 'rotation', 'scale'].includes(path)) continue;
            const times = sampler.getInput().getArray();
            const values = sampler.getOutput().getArray();
            const size = path === 'rotation' ? 4 : 3;
            const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
            const value = k => Array.from(values.slice((cubic ? 3 * k + 1 : k) * size, (cubic ? 3 * k + 1 : k) * size + size));
            let k = 0;
            while (k < times.length - 1 && times[k + 1] <= time) k++;
            let v = value(k);
            if (k < times.length - 1 && time > times[k] && sampler.getInterpolation() !== 'STEP') {
                const f = (time - times[k]) / (times[k + 1] - times[k]);
                const w = value(k + 1);
                const sign = path === 'rotation' && v.reduce((s, x, i) => s + x * w[i], 0) < 0 ? -1 : 1;
                v = v.map((x, i) => x + (sign * w[i] - x) * f);
                if (path === 'rotation') {
                    const n = Math.hypot(...v);
                    v = v.map(x => x / n);
                }
            }
            if (path === 'translation') node.setTranslation(v);
            else if (path === 'rotation') node.setRotation(v);
            else node.setScale(v);
        }
    }
}

/** A rule of cars.json where a plain string means `field` (node path for wheels/exclude, material for roles). */
function normaliseRule(rule, field) {
    if (typeof rule === 'string') return { [field]: rule };
    return rule;
}

/** The rotation that makes the model face +z with y up: "forward" names the model's front axis, "up" its up axis, "rotate" (degrees XYZ) comes first. */
function orientation({ forward = '+z', up = '+y', rotate = null }) {
    const axis = s => {
        const v = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[s[1]];
        if (!v) throw new Error(`bad axis "${s}" (use +x, -x, +y, -y, +z, -z)`);
        return s[0] === '-' ? v.map(c => -c) : v;
    };
    const f = axis(forward);
    const u = axis(up);
    const l = cross(u, f);
    const rows = [l, u, f];
    const basis = new Array(16).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) basis[c * 4 + r] = rows[r][c];
    basis[15] = 1;
    if (!rotate) return basis;
    const [rx, ry, rz] = rotate.map(d => (d * Math.PI) / 180);
    return multiply(basis, multiply(rotationZ(rz), multiply(rotationY(ry), rotationX(rx))));
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Column-major 4×4 product a·b. */
function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
}

function translation(x, y, z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function scaling(s) {
    return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

function rotationX(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotationY(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotationZ(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** A primitive with its own copies of the vertices it uses (indexed; morph targets dropped). */
function deepCopy(prim) {
    const copy = prim.clone();
    for (const target of copy.listTargets()) copy.removeTarget(target);
    if (!copy.getIndices()) {
        const count = copy.getAttribute('POSITION').getCount();
        const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        copy.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices));
    }
    compactPrimitive(copy);
    return copy;
}

function centre(b) {
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** fl = front left: the car faces +z, its left is +x. */
function cornerOf(p) {
    return `${p[2] >= 0 ? 'f' : 'r'}${p[0] >= 0 ? 'l' : 'r'}`;
}

/** Cuts a primitive into up to four by the quadrant of each triangle's centre (merged wheels). */
function splitByQuadrant(record) {
    const prim = record.prim;
    const pos = prim.getAttribute('POSITION');
    const index = prim.getIndices().getArray();
    const lists = Object.fromEntries(CORNERS.map(c => [c, []]));
    const a = [0, 0, 0];
    for (let i = 0; i < index.length; i += 3) {
        let x = 0;
        let z = 0;
        for (let k = 0; k < 3; k++) {
            pos.getElement(index[i + k], a);
            x += a[0];
            z += a[2];
        }
        lists[cornerOf([x / 3, 0, z / 3])].push(index[i], index[i + 1], index[i + 2]);
    }
    const out = [];
    for (const c of CORNERS) {
        if (!lists[c].length) continue;
        const part = prim.clone();
        part.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(lists[c])));
        compactPrimitive(part);
        out.push({ ...record, prim: part, corner: c, bounds: primitiveBounds(part) });
    }
    return out;
}

/** Cuts a primitive in two by the end (front: centre z ≥ midZ) of each triangle's centre. */
function splitByEnd(record, midZ) {
    const prim = record.prim;
    const pos = prim.getAttribute('POSITION');
    const index = prim.getIndices().getArray();
    const lists = { front: [], rear: [] };
    const a = [0, 0, 0];
    for (let i = 0; i < index.length; i += 3) {
        let z = 0;
        for (let k = 0; k < 3; k++) {
            pos.getElement(index[i + k], a);
            z += a[2];
        }
        lists[z / 3 >= midZ ? 'front' : 'rear'].push(index[i], index[i + 1], index[i + 2]);
    }
    const out = [];
    for (const end of ['front', 'rear']) {
        if (!lists[end].length) continue;
        const part = prim.clone();
        part.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(lists[end])));
        compactPrimitive(part);
        out.push({ ...record, prim: part });
    }
    return out;
}

/**
 * Lamp mounts from the lamp parts: one point per side – the middle of the lens vertices within 12 cm of the car's end (the front face of
 * the head lamps, the rear face of the tail lamps), so a lamp that wraps around the corner still gets its point on the face.
 */
function lampMounts(list, end) {
    const front = end === 'front';
    const v = [0, 0, 0];
    let extreme = front ? -Infinity : Infinity;
    for (const r of list) extreme = front ? Math.max(extreme, r.bounds.max[2]) : Math.min(extreme, r.bounds.min[2]);
    const sides = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (const r of list) {
        const pos = r.prim.getAttribute('POSITION');
        for (let i = 0; i < pos.getCount(); i++) {
            pos.getElement(i, v);
            if (Math.abs(v[2] - extreme) > 0.12) continue;
            const side = sides[v[0] >= 0 ? 0 : 1];
            side[0] += v[0];
            side[1] += v[1];
            side[2] += v[2];
            side[3]++;
        }
    }
    return sides.filter(s => s[3] > 0).map(s => [s[0] / s[3], s[1] / s[3], s[2] / s[3] + (front ? 0.02 : -0.02)]);
}

/** The body width without the mirrors: twice the 98th percentile of |x| over the vertices of the body (not the wheels). */
function bodyWidth(list) {
    const xs = [];
    const v = [0, 0, 0];
    for (const r of list) {
        const pos = r.prim.getAttribute('POSITION');
        const step = Math.max(1, Math.floor(pos.getCount() / 4000));
        for (let i = 0; i < pos.getCount(); i += step) {
            pos.getElement(i, v);
            xs.push(Math.abs(v[0]));
        }
    }
    xs.sort((p, q) => p - q);
    return 2 * (xs[Math.floor(xs.length * 0.98)] ?? 0.9);
}

/** What a part becomes in the far model: paint, glass, head, tail or far (vertex colour). */
function farKind(r) {
    if (r.role === 'paint') return 'paint';
    if (r.role === 'glass' || r.role === 'lens' || r.source?.getAlphaMode() === 'BLEND') return 'glass';
    if (r.role === 'light_head' || r.role === 'light_drl') return 'head';
    if (r.role === 'light_tail' || r.role === 'light_brake') return 'tail';
    return 'far';
}

function firstMaterial(role) {
    return records.find(r => r.role === role)?.material ?? null;
}

/** The average linear colour of a source material (base colour × the texture's mean). */
async function meanColour(material) {
    if (!material) return [0.05, 0.05, 0.05];
    const factor = material.getBaseColorFactor();
    let mean = [1, 1, 1];
    const texture = material.getBaseColorTexture();
    const image = texture?.getImage();
    if (image) {
        try {
            const stats = await sharp(Buffer.from(image)).stats();
            mean = stats.channels.slice(0, 3).map(ch => srgbToLinear(ch.mean / 255));
        } catch {
            mean = [0.5, 0.5, 0.5];
        }
    }
    return [0, 1, 2].map(k => Math.min(1, factor[k] * mean[k]));
}

function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Joins primitives of one material that have the same vertex layout (one draw call each). */
function joinBySignature(prims, material) {
    const bySignature = new Map();
    for (const p of prims) {
        const signature = p.listSemantics().sort().map(s => {
            const a = p.getAttribute(s);
            return `${s}:${a.getType()}:${a.getComponentType()}:${a.getNormalized()}`;
        }).join('|');
        if (!bySignature.has(signature)) bySignature.set(signature, []);
        bySignature.get(signature).push(p);
    }
    const out = [];
    for (const list of bySignature.values()) {
        const joined = list.length === 1 ? list[0] : joinPrimitives(list);
        joined.setMaterial(material);
        out.push(joined);
    }
    return out;
}

/**
 * Simplifies a set of primitives together to a triangle budget with one error limit (metres) for all: a binary search for the smallest
 * limit whose result fits. One limit spends the triangles where they change the shape (wheel arches, lamps, curved panels) and takes
 * them from flat panels and hidden parts – better than the same ratio everywhere. Normals (and the UVs of textured parts) weigh in, so
 * creases and texture seams stay where they matter; "Permissive" lets the simplifier collapse across the split vertices models are full
 * of (it still pays for the attribute error it makes). prune: drop small disconnected bits (the far model).
 */
function simplifyAll(prims, target, { prune = false, maxError = 0.05 } = {}) {
    const total = prims.reduce((sum, p) => sum + triangles(p), 0);
    if (total <= target) return;
    const flags = ['ErrorAbsolute', 'Permissive', ...(prune ? ['Prune'] : [])];
    const inputs = prims.map(p => {
        const indices = Uint32Array.from(p.getIndices().getArray());
        const position = p.getAttribute('POSITION');
        const normal = p.getAttribute('NORMAL');
        const uv = p.getMaterial()?.getBaseColorTexture() ? p.getAttribute('TEXCOORD_0') : null;
        const stride = (normal ? 3 : 0) + (uv ? 2 : 0);
        const count = position.getCount();
        const attributes = new Float32Array(Math.max(1, count * stride));
        const n = [0, 0, 0];
        const t = [0, 0];
        for (let i = 0; stride && i < count; i++) {
            let o = i * stride;
            if (normal) {
                normal.getElement(i, n);
                attributes[o++] = n[0];
                attributes[o++] = n[1];
                attributes[o++] = n[2];
            }
            if (uv) {
                uv.getElement(i, t);
                attributes[o++] = t[0];
                attributes[o++] = t[1];
            }
        }
        const weights = [...(normal ? [0.4, 0.4, 0.4] : []), ...(uv ? [1.5, 1.5] : [])];
        return { p, indices, positions: position.getArray(), attributes, stride, weights };
    });
    const run = error => inputs.map(x => {
        if (x.indices.length < 48) return x.indices;
        const [result] = x.stride
            ? MeshoptSimplifier.simplifyWithAttributes(x.indices, x.positions, 3, x.attributes, x.stride, x.weights, null, 0, error, flags)
            : MeshoptSimplifier.simplify(x.indices, x.positions, 3, 0, error, flags);
        return result;
    });
    const count = results => results.reduce((sum, r) => sum + r.length / 3, 0);
    // log-space binary search: the smallest error limit that fits the budget
    let low = 1e-5;
    let high = maxError;
    let best = run(high);
    if (count(best) > target) console.warn(`  warning: ${count(best)} triangles even at ${maxError} m error (budget ${target}) – exclude hidden parts`);
    else {
        for (let i = 0; i < 14; i++) {
            const mid = Math.sqrt(low * high);
            const results = run(mid);
            if (count(results) <= target) {
                best = results;
                high = mid;
            } else {
                low = mid;
            }
            if (high / low < 1.06) break;
        }
    }
    inputs.forEach((x, i) => {
        if (best[i].length === x.indices.length) return;
        x.p.setIndices(doc.createAccessor().setType('SCALAR').setArray(best[i]));
        compactPrimitive(x.p);
    });
    log(`  simplified ${total} → ${count(best)} triangles (error limit ${(high * 1000).toFixed(2)} mm)`);
}

/** Removes (and frees) the primitives the simplifier emptied. */
function dropEmpty(list) {
    for (let i = list.length - 1; i >= 0; i--) {
        if (triangles(list[i]) > 0) continue;
        list[i].dispose();
        list.splice(i, 1);
    }
}

function isUnder(node, ancestor) {
    for (let n = node; n; n = n.getParentNode()) if (n === ancestor) return true;
    return false;
}

function round(v) {
    return Math.round(v * 1000) / 1000;
}

/** JSON with two-space indents, number arrays on one line. */
function pretty(value) {
    const json = JSON.stringify(value, null, 2).replace(/\[\s+(-?[\d.e-]+(?:,\s+-?[\d.e-]+)*)\s+\]/g, (_, inner) => `[${inner.replace(/,\s+/g, ', ')}]`);
    return `${json}\n`;
}

function readJson(path, fallback) {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

/** Writes the car into data/car-models.json and its attribution into data/car-credits.json (sorted by key). */
function writeRegistry(carKey, carEntry, cfg) {
    const manifest = readJson(MANIFEST, { version: 1, cars: {} });
    manifest.cars[carKey] = carEntry;
    manifest.cars = Object.fromEntries(Object.entries(manifest.cars).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(MANIFEST, pretty(manifest));
    const credits = readJson(CREDITS, { models: [] });
    const source = cfg.source ?? {};
    const item = {
        key: carKey,
        car: cfg.car ?? cfg.title ?? carKey,
        title: cfg.title ?? cfg.car ?? carKey,
        author: cfg.author ?? '',
        authorUrl: cfg.authorUrl ?? '',
        licence: cfg.licence ?? '',
        licenceUrl: cfg.licenceUrl ?? '',
        source: source.url ?? (source.uid ? `https://sketchfab.com/3d-models/${source.uid}` : ''),
        changes: cfg.changes ?? 'Reduced, re-textured and re-materialised for the game (DriftKing).',
    };
    credits.models = credits.models.filter(m => m.key !== carKey).concat(item).sort((a, b) => a.key.localeCompare(b.key));
    writeFileSync(CREDITS, pretty(credits));
}

/** --remove: the car's GLB and both registry entries go. */
function remove(carKey) {
    const glb = join(MODELS_DIR, `${carKey}.glb`);
    if (existsSync(glb)) rmSync(glb);
    const manifest = readJson(MANIFEST, { version: 1, cars: {} });
    delete manifest.cars[carKey];
    writeFileSync(MANIFEST, pretty(manifest));
    const credits = readJson(CREDITS, { models: [] });
    credits.models = credits.models.filter(m => m.key !== carKey);
    writeFileSync(CREDITS, pretty(credits));
    console.log(`removed "${carKey}" (${relative(REPO, glb)}, registry entries)`);
}

