// DriftKing · scenes/garage-room.js – the tuning workshop around the turntable, built from the material factory (render/materials.js):
// an epoxy floor, concrete walls with a dark dado, a trapezoid-sheet roof on steel beams, tube lights, a roller door with a lit window row,
// a workbench with a pegboard, tool chests, an engine on a stand, a two-post lift, a tyre rack, rims on the wall, posters and a neon sign,
// a lit office behind a window, hoses and cables, a light rig (an overhead softbox, two strip boxes on stands, a fill box behind the camera).
// Static geometry is merged per material (one draw call each). Scale: 1 unit = 1 m; the car stands at the origin facing +z, the camera
// looks from +x/+z, so the back wall (z = -8) and the left wall (x = -9) are the picture; the other walls are mostly seen in reflections.

import * as THREE from 'three';
import { box, GlowPoints, LightPools, mergeGeometries, metricUVs, rng } from '../render/kit.js';
import { kelvinHex } from '../render/lights.js';
import { materialsFor } from '../render/materials.js';
import { texturesFor } from '../render/textures.js';
import { atlasUVs, hazardTexture, neonTexture, officeTexture, pegboardTexture, wallAtlas } from './garage-art.js';

/** The room (metres): walls at x0/x1/z0/z1, the ceiling height. */
export const ROOM = Object.freeze({ x0: -9, x1: 9, z0: -8, z1: 10, height: 5.4 });

/** The studio lights: where the boxes are and what they aim at (garage.js puts the real lights there). */
export const STUDIO = Object.freeze({
    key: { x: 0, y: 4.22, z: 0.2, target: [0, 0, 0] },
    rimLeft: { x: -4.7, y: 2.05, z: -0.9, target: [0, 0.75, 0] },
    rimRight: { x: 3.9, y: 2.05, z: -2.9, target: [0, 0.75, 0] },
    fill: { x: 4.6, y: 2.4, z: 8.7, target: [0, 0.7, 0] },
    tubes: [{ x: -6, y: 4.6, z: -1 }, { x: 6, y: 4.6, z: -6 }],
});

const DOOR = { x: -2.9, width: 3.8, height: 3.6 };
/** The epoxy floor: its paint and how many metres one texture tile covers (larger than the 6 m of the recipe: fewer tyre marks). */
export const FLOOR = Object.freeze({ color: 0x9a9ea4, tile: 11 });

const WINDOW = { x0: 4.5, x1: 6.3, y0: 1.0, y1: 2.2 };

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

/** Moves a geometry: rotation (rx, ry, rz in YXZ order) about its origin, then translation. */
function place(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
    _euler.set(rx, ry, rz, 'YXZ');
    _quaternion.setFromEuler(_euler);
    geometry.applyMatrix4(_matrix.compose(_position.set(x, y, z), _quaternion, _scale));
    return geometry;
}

/** A cylinder standing on y (axis vertical), centred at (x, y, z). */
function cylinder(radius, height, x, y, z, segments = 16, rx = 0, ry = 0, rz = 0, radiusBottom = radius, open = false) {
    return place(new THREE.CylinderGeometry(radius, radiusBottom, height, segments, 1, open), x, y, z, rx, ry, rz);
}

/** A tube (hose, cable) through points [[x, y, z], ...]. */
function hose(points, radius, segments = 48) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    return new THREE.TubeGeometry(curve, segments, radius, 6, false);
}

/** Geometry collected per material; build() merges each list into one mesh. */
class Batches {
    constructor() {
        this.lists = new Map();
    }

    /** Adds a placed geometry; metric: give it box-projected UVs in metres (textured factory materials). */
    add(material, geometry, metric = false) {
        if (metric) metricUVs(geometry);
        if (!this.lists.has(material)) this.lists.set(material, []);
        this.lists.get(material).push(geometry);
        return geometry;
    }

    build(parent, receiveShadow = []) {
        for (const [material, list] of this.lists) {
            const mesh = new THREE.Mesh(mergeGeometries(list), material);
            mesh.receiveShadow = receiveShadow.includes(material);
            mesh.matrixAutoUpdate = false;
            parent.add(mesh);
        }
        this.lists.clear();
    }
}

/**
 * Builds the workshop for a quality.
 * @param {string} quality low | medium | high
 * @returns {{ group: THREE.Group, effects: THREE.Group, floor: THREE.Material }} group: the room (also baked into the reflection map);
 *          effects: glow points and light pools (added after the bake)
 */
export function buildRoom(quality) {
    const pbr = quality !== 'low';
    const high = quality === 'high';
    const M = materialsFor(quality);
    const T = texturesFor(quality);
    const group = new THREE.Group();
    group.name = 'garage-room';
    const glows = new GlowPoints();
    const pools = new LightPools();
    const b = new Batches();
    const random = rng(2771);

    // ---- materials (factory ones are shared and cached; the canvas ones belong to this room)
    const m = {
        floor: M.floor({ color: FLOOR.color, wet: 0.08, scale: FLOOR.tile }),
        wall: M.concrete({ color: 0xc9c5bd }),
        dado: M.painted({ color: 0x353a42, roughness: 0.5 }),
        roof: M.corrugated({ color: 0x9aa0a8, rust: 0.12 }),
        steel: M.painted({ color: 0x3e444e, roughness: 0.5 }),
        lift: M.painted({ color: 0x1f4f96, roughness: 0.4 }),
        rackFrame: M.painted({ color: 0x2a5aa0, roughness: 0.5 }),
        rackBeam: M.painted({ color: 0xd8631c, roughness: 0.45 }),
        red: M.painted({ color: 0x9e161c, roughness: 0.3 }),
        graphite: M.painted({ color: 0x2b2e34, roughness: 0.4 }),
        white: M.painted({ color: 0xd8d8d4, roughness: 0.55 }),
        cardboard: M.painted({ color: 0x9c7a50, roughness: 0.9 }),
        aluminium: M.metal({ color: 0xb4b8bd, roughness: 0.38 }),
        brushed: M.metal({ brushed: true, roughness: 0.3 }),
        chrome: M.chrome(),
        castIron: M.metal({ color: 0x62666d, roughness: 0.62 }),
        exhaust: M.metal({ color: 0x7c5c4a, roughness: 0.55 }),
        gold: M.metal({ color: 0xc8a048, roughness: 0.28 }),
        rimBlack: M.painted({ color: 0x1c1d21, roughness: 0.32 }),
        rubber: M.rubber(),
        tread: M.rubber({ tread: true }),
        black: M.plastic({ color: 0x1a1b1e, roughness: 0.55 }),
        yellow: M.plastic({ color: 0xe0b01c, roughness: 0.45 }),
        orange: M.plastic({ color: 0xd8561a, roughness: 0.5 }),
        blueBarrel: M.painted({ color: 0x1d4f8a, roughness: 0.45 }),
        door: M.painted({ color: 0xaeb4bc, roughness: 0.42 }),
        doorWorn: M.painted({ color: 0x969ca4, roughness: 0.55 }),
        glass: M.glass({ tint: 0x0c1016, opacity: 0.16, roughness: 0.03 }),
        tube: M.emissive(kelvinHex(5200), 7),
        softbox: M.emissive(kelvinHex(5600), 2.4),
        ledWhite: M.emissive(kelvinHex(6000), 4),
        screen: M.emissive(0x9fd0ff, 2),
        outside: M.emissive(0x4a5c8c, 0.9),
        gap: M.emissive(kelvinHex(2000), 3),
        exit: M.emissive(0x18d060, 2.5),
        officeLight: M.emissive(0xd6b48a, 0.75, { side: THREE.BackSide }),
        officeLamp: M.emissive(kelvinHex(3200), 4),
    };
    const lit = (map, o = {}) => (pbr
        ? new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0, ...o })
        : new THREE.MeshLambertMaterial({ map, ...pick(o, ['transparent', 'depthWrite', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'opacity']) }));
    const atlas = wallAtlas(high ? 2048 : 1024);
    const paper = lit(atlas, { roughness: 0.62 });
    const pegboard = lit(pegboardTexture(high ? 1024 : 512), { roughness: 0.6 });
    const hazardMap = hazardTexture();
    hazardMap.repeat.set(2, 1);
    const hazard = lit(hazardMap, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const neon = M.emissive(0xffffff, 5, { map: neonTexture(high ? 1024 : 512) });
    const office = M.emissive(0xffffff, 1.0, { map: officeTexture(high ? 512 : 256) });
    const grime = T.overlay({ kind: 'grime' }).map;
    const stains = lit(grime, { transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

    const { x0, x1, z0, z1, height: H } = ROOM;
    const width = x1 - x0;
    const depth = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;

    // ---- shell: floor, walls with the door and window openings, the dado, the roof, the steel frame
    b.add(m.floor, new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(cx, 0, cz), true);
    const wallT = 0.3;
    const back = z0 - wallT / 2;
    const doorL = DOOR.x - DOOR.width / 2;
    const doorR = DOOR.x + DOOR.width / 2;
    for (const g of [
        box(doorL - x0, H, wallT, (x0 + doorL) / 2, H / 2, back),
        box(DOOR.width, H - DOOR.height, wallT, DOOR.x, (DOOR.height + H) / 2, back),
        box(WINDOW.x0 - doorR, H, wallT, (doorR + WINDOW.x0) / 2, H / 2, back),
        box(WINDOW.x1 - WINDOW.x0, WINDOW.y0, wallT, (WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y0 / 2, back),
        box(WINDOW.x1 - WINDOW.x0, H - WINDOW.y1, wallT, (WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y1 + H) / 2, back),
        box(x1 - WINDOW.x1, H, wallT, (WINDOW.x1 + x1) / 2, H / 2, back),
        box(wallT, H, depth + wallT * 2, x0 - wallT / 2, H / 2, cz),
        box(wallT, H, depth + wallT * 2, x1 + wallT / 2, H / 2, cz),
        box(width, H, wallT, cx, H / 2, z1 + wallT / 2),
    ]) b.add(m.wall, g, true);
    // the dark dado (1 m), a hair in front of the walls
    const dado = 1.0;
    for (const g of [
        box(doorL - x0, dado, 0.02, (x0 + doorL) / 2, dado / 2, z0 + 0.01),
        box(x1 - doorR, dado, 0.02, (doorR + x1) / 2, dado / 2, z0 + 0.01),
        box(0.02, dado, depth, x0 + 0.01, dado / 2, cz),
        box(0.02, dado, depth, x1 - 0.01, dado / 2, cz),
        box(width, dado, 0.02, cx, dado / 2, z1 - 0.01),
    ]) b.add(m.dado, g);
    // the roof: trapezoid sheet seen from below, ribs running along z
    b.add(m.roof, new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2).translate(cx, H, cz), true);
    // steel columns (I-profiles) at the side walls, main beams across, purlins along
    const iProfile = (length, axis, x, y, z, size = 0.22) => {
        const flange = 0.016;
        const parts = axis === 'y'
            ? [box(size, length, flange, x, y, z - size / 2 + flange / 2), box(size, length, flange, x, y, z + size / 2 - flange / 2), box(0.012, length, size, x, y, z)]
            : axis === 'x'
                ? [box(length, flange, size * 0.7, x, y - size / 2 + flange / 2, z), box(length, flange, size * 0.7, x, y + size / 2 - flange / 2, z), box(length, size, 0.012, x, y, z)]
                : [box(size * 0.7, flange, length, x, y - size / 2 + flange / 2, z), box(size * 0.7, flange, length, x, y + size / 2 - flange / 2, z), box(0.012, size, length, x, y, z)];
        for (const g of parts) b.add(m.steel, g);
    };
    for (const z of [-2.2, 4.2]) {
        iProfile(H, 'y', x0 + 0.13, H / 2, z);
        iProfile(H, 'y', x1 - 0.13, H / 2, z);
        iProfile(width, 'x', cx, H - 0.2, z, 0.36);
    }
    for (const x of [-6, -3, 0, 3, 6]) iProfile(depth, 'z', x, H - 0.06, cz, 0.12);
    // a cable tray along the back wall, high up
    b.add(m.steel, box(width, 0.06, 0.22, cx, 4.86, z0 + 0.14));
    b.add(m.steel, box(width, 0.1, 0.02, cx, 4.9, z0 + 0.25));

    // ---- tube lights under the roof (double battens on wires)
    const tubes = [[-6, -6], [-6, -1], [-6, 4], [-6, 8.5], [6, -6], [6, -1], [6, 4], [6, 8.5], [0, -6], [0, 8]];
    for (const [x, z] of tubes) {
        b.add(m.white, box(0.2, 0.07, 1.56, x, 4.66, z));
        b.add(m.tube, box(0.05, 0.03, 1.5, x - 0.045, 4.615, z));
        b.add(m.tube, box(0.05, 0.03, 1.5, x + 0.045, 4.615, z));
        for (const dz of [-0.6, 0.6]) b.add(m.black, box(0.008, H - 4.7, 0.008, x, (H + 4.7) / 2, z + dz));
        for (const dz of [-0.55, 0, 0.55]) glows.add(x, 4.58, z + dz, 0.9, 0xdfe8ff);
        pools.add(x, 0, z, 2.6, 0xdfe8ff, 0.12);
    }

    // ---- the studio rig: overhead softbox, two strip boxes on stands, the fill box behind the camera
    {
        const k = STUDIO.key;
        b.add(m.black, box(3.5, 0.32, 1.8, k.x, k.y + 0.18, k.z));
        b.add(m.softbox, box(3.36, 0.02, 1.66, k.x, k.y, k.z));
        b.add(m.aluminium, box(3.56, 0.04, 0.04, k.x, k.y + 0.35, k.z - 0.9));
        b.add(m.aluminium, box(3.56, 0.04, 0.04, k.x, k.y + 0.35, k.z + 0.9));
        for (const [dx, dz] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) b.add(m.black, box(0.01, H - k.y - 0.34, 0.01, k.x + dx, (H + k.y + 0.34) / 2, k.z + dz));
        for (const dx of [-1.2, 0, 1.2]) glows.add(k.x + dx, k.y - 0.05, k.z, 2.2, 0xfff4e8);
    }
    for (const s of [STUDIO.rimLeft, STUDIO.rimRight]) {
        const yaw = Math.atan2(s.target[0] - s.x, s.target[2] - s.z);
        const parts = [];
        // tripod, pole, the strip box tilted a little down, its diffuser facing the car (local +z)
        for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + 0.4;
            const foot = new THREE.Vector3(Math.sin(a) * 0.55, 0.02, Math.cos(a) * 0.55);
            const hub = new THREE.Vector3(0, 0.6, 0);
            const length = foot.distanceTo(hub);
            const g = new THREE.CylinderGeometry(0.014, 0.014, length, 6).rotateX(Math.PI / 2);
            g.lookAt(new THREE.Vector3().subVectors(foot, hub));
            parts.push([m.black, g.translate((foot.x + hub.x) / 2, (foot.y + hub.y) / 2, (foot.z + hub.z) / 2)]);
            parts.push([m.rubber, new THREE.SphereGeometry(0.03, 6, 4).translate(foot.x, 0.02, foot.z)]);
        }
        parts.push([m.black, new THREE.CylinderGeometry(0.02, 0.02, s.y - 0.9, 8).translate(0, 0.6 + (s.y - 0.9) / 2, 0)]);
        parts.push([m.aluminium, new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8).translate(0, 0.62, 0)]);
        const tilt = -Math.atan2(s.y - s.target[1], Math.hypot(s.target[0] - s.x, s.target[2] - s.z));
        const head = [[m.black, new THREE.BoxGeometry(0.34, 1.5, 0.24)], [m.softbox, new THREE.BoxGeometry(0.29, 1.44, 0.01).translate(0, 0, 0.125)]];
        for (const [material, g] of head) parts.push([material, g.rotateX(-tilt).translate(0, s.y - 0.12, 0)]);
        for (const [material, g] of parts) b.add(material, place(g, s.x, 0, s.z, 0, yaw, 0));
        const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.2);
        for (const dy of [-0.5, 0, 0.5]) glows.add(s.x + f.x, s.y - 0.12 + dy, s.z + f.z, 1.1, 0xfff4e8);
    }
    {
        const s = STUDIO.fill;
        const yaw = Math.atan2(s.target[0] - s.x, s.target[2] - s.z);
        const face = [[m.black, new THREE.BoxGeometry(2.3, 1.7, 0.3)], [m.softbox, new THREE.BoxGeometry(2.16, 1.56, 0.01).translate(0, 0, 0.16)],
            [m.black, new THREE.CylinderGeometry(0.025, 0.025, s.y - 0.8, 8).translate(0, -(s.y - 0.8) / 2 - 0.4, -0.1)]];
        for (const [material, g] of face) b.add(material, place(g, s.x, s.y, s.z, 0.12, yaw, 0));
    }

    // ---- the roller door (closed): ribbed curtain with a window row, guides, the drum housing, light under the door
    {
        // the curtain: 0.1 m slats, each a shallow V (two faces catching the light differently), a little worn towards the bottom
        const slat = 0.1;
        for (let y = 0.07; y < DOOR.height - 0.01; y += slat) {
            const worn = y < 0.8 && random() < 0.5 ? m.doorWorn : m.door;
            b.add(worn, place(new THREE.BoxGeometry(DOOR.width, slat * 0.52, 0.02), DOOR.x, y + slat * 0.26, z0 - 0.1, -0.22));
            b.add(worn, place(new THREE.BoxGeometry(DOOR.width, slat * 0.52, 0.02), DOOR.x, y + slat * 0.74, z0 - 0.1, 0.22));
        }
        for (let k = 0; k < 6; k++) {
            const x = DOOR.x - DOOR.width / 2 + 0.55 + k * ((DOOR.width - 1.1) / 5);
            b.add(m.black, box(0.42, 0.18, 0.01, x, 2.3, z0 - 0.095));
            b.add(m.outside, box(0.36, 0.11, 0.01, x, 2.3, z0 - 0.088));
        }
        b.add(m.aluminium, box(DOOR.width, 0.07, 0.07, DOOR.x, 0.035, z0 - 0.08));
        b.add(m.rubber, box(DOOR.width, 0.02, 0.06, DOOR.x, 0.01, z0 - 0.08));
        b.add(m.gap, box(DOOR.width - 0.1, 0.008, 0.02, DOOR.x, 0.004, z0 - 0.03));
        for (const side of [-1, 1]) b.add(m.steel, box(0.1, DOOR.height + 0.1, 0.14, DOOR.x + side * (DOOR.width / 2 + 0.05), (DOOR.height + 0.1) / 2, z0 + 0.06));
        b.add(m.steel, box(DOOR.width + 0.5, 0.62, 0.55, DOOR.x, DOOR.height + 0.36, z0 + 0.27));
        b.add(m.graphite, box(0.26, 0.36, 0.3, DOOR.x + DOOR.width / 2 + 0.42, DOOR.height + 0.3, z0 + 0.17));
        b.add(m.yellow, box(0.12, 0.2, 0.08, DOOR.x + DOOR.width / 2 + 0.4, 1.35, z0 + 0.04));
        b.add(m.red, cylinder(0.025, 0.03, DOOR.x + DOOR.width / 2 + 0.4, 1.38, z0 + 0.09, 10, Math.PI / 2));
        b.add(m.black, box(0.02, DOOR.height - 1.4, 0.02, DOOR.x + DOOR.width / 2 + 0.4, (DOOR.height + 1.45) / 2, z0 + 0.03));
        // a floor drain in front of the door
        b.add(m.castIron, box(DOOR.width - 0.4, 0.008, 0.18, DOOR.x, 0.004, z0 + 0.7));
        pools.add(DOOR.x, 0, z0 + 0.2, 1.4, kelvinHex(2000), 0.08);
    }

    // ---- workbench, pegboard, shelf, the neon sign above, hose reel
    const bench = { x: 0.85, z: z0 + 0.38, length: 2.4 };
    {
        b.add(m.brushed, box(bench.length, 0.05, 0.75, bench.x, 0.9, bench.z), true);
        for (const dx of [-1.15, 1.15]) for (const dz of [-0.32, 0.32]) b.add(m.graphite, box(0.05, 0.88, 0.05, bench.x + dx, 0.44, bench.z + dz));
        b.add(m.graphite, box(bench.length - 0.1, 0.025, 0.65, bench.x, 0.18, bench.z));
        b.add(m.graphite, box(bench.length, 0.1, 0.03, bench.x, 0.82, bench.z + 0.36));
        // drawer unit under the right end
        b.add(m.red, box(0.62, 0.6, 0.66, bench.x + 0.82, 0.5, bench.z));
        for (const y of [0.72, 0.52, 0.32]) b.add(m.aluminium, box(0.42, 0.02, 0.025, bench.x + 0.82, y, bench.z + 0.34));
        // a vice, a brake disc, a turbo, a toolbox, a laptop, a mug
        const top = 0.925;
        b.add(m.lift, box(0.2, 0.08, 0.22, bench.x - 0.95, top + 0.04, bench.z + 0.2));
        b.add(m.lift, box(0.24, 0.12, 0.07, bench.x - 0.95, top + 0.14, bench.z + 0.26));
        b.add(m.lift, box(0.24, 0.12, 0.07, bench.x - 0.95, top + 0.14, bench.z + 0.12));
        b.add(m.chrome, cylinder(0.012, 0.3, bench.x - 0.95, top + 0.12, bench.z + 0.4, 8, Math.PI / 2));
        b.add(m.brushed, cylinder(0.16, 0.028, bench.x - 0.4, top + 0.014, bench.z + 0.05, 32), true);
        b.add(m.castIron, cylinder(0.085, 0.05, bench.x - 0.4, top + 0.05, bench.z + 0.05, 20));
        b.add(m.aluminium, place(new THREE.TorusGeometry(0.075, 0.038, 8, 18), bench.x + 0.05, top + 0.11, bench.z + 0.05, 0, 0.3, 0));
        b.add(m.aluminium, cylinder(0.04, 0.1, bench.x + 0.05, top + 0.11, bench.z + 0.05, 12, Math.PI / 2, 0.3));
        b.add(m.exhaust, place(new THREE.TorusGeometry(0.06, 0.032, 8, 18), bench.x + 0.19, top + 0.1, bench.z + 0.0, 0, 0.3, 0));
        b.add(m.red, box(0.46, 0.18, 0.22, bench.x + 0.78, top + 0.09, bench.z - 0.12));
        b.add(m.black, box(0.3, 0.03, 0.03, bench.x + 0.78, top + 0.2, bench.z - 0.12));
        b.add(m.graphite, box(0.34, 0.015, 0.24, bench.x + 0.42, top + 0.008, bench.z + 0.18));
        b.add(m.graphite, place(new THREE.BoxGeometry(0.34, 0.23, 0.012), bench.x + 0.42, top + 0.12, bench.z + 0.06, -0.25));
        b.add(m.screen, place(new THREE.BoxGeometry(0.31, 0.19, 0.002), bench.x + 0.42, top + 0.12, bench.z + 0.067, -0.25));
        b.add(m.white, cylinder(0.04, 0.1, bench.x + 1.02, top + 0.05, bench.z + 0.25, 14));
        // pegboard and the shelf with its LED strip
        b.add(pegboard, new THREE.PlaneGeometry(bench.length, 1.2).translate(bench.x, 1.72, z0 + 0.015));
        b.add(m.graphite, box(bench.length, 0.03, 0.3, bench.x, 2.46, z0 + 0.16));
        for (const dx of [-1, 1]) b.add(m.graphite, box(0.03, 0.2, 0.28, bench.x + dx * 1.05, 2.36, z0 + 0.15));
        b.add(m.ledWhite, box(bench.length - 0.2, 0.012, 0.03, bench.x, 2.44, z0 + 0.26));
        for (let k = 0; k < 4; k++) glows.add(bench.x - 0.9 + k * 0.6, 2.42, z0 + 0.3, 0.5, 0xffffff);
        for (const [x, w, h] of [[-0.95, 0.4, 0.28], [-0.5, 0.36, 0.22], [-0.1, 0.3, 0.3]]) b.add(m.cardboard, box(w, h, 0.26, bench.x + x, 2.475 + h / 2, z0 + 0.16));
        for (let k = 0; k < 5; k++) b.add([m.red, m.yellow, m.black, m.orange, m.red][k], cylinder(0.033, 0.2, bench.x + 0.4 + k * 0.1, 2.575, z0 + 0.16, 10));
        b.add(m.yellow, box(0.2, 0.26, 0.12, bench.x + 1.0, 2.605, z0 + 0.16));
        // the neon sign above
        b.add(neon, new THREE.PlaneGeometry(3.2, 0.8).translate(bench.x + 0.2, 3.3, z0 + 0.03));
        b.add(m.black, box(3.3, 0.9, 0.03, bench.x + 0.2, 3.3, z0 + 0.012));
        for (let k = 0; k < 7; k++) glows.add(bench.x - 0.9 + k * 0.38, 3.28, z0 + 0.2, 0.7, k < 4 ? 0x29e7ff : 0xff2e88);
        // hose reel (between the tool chest and the office window) and the yellow air hose over the floor to the engine
        const reel = { x: 4.15, y: 2.45 };
        b.add(m.graphite, box(0.5, 0.5, 0.06, reel.x, reel.y, z0 + 0.03));
        b.add(m.yellow, cylinder(0.2, 0.14, reel.x, reel.y, z0 + 0.14, 24, Math.PI / 2));
        b.add(m.graphite, cylinder(0.215, 0.012, reel.x, reel.y, z0 + 0.215, 24, Math.PI / 2));
        b.add(m.yellow, hose([[reel.x, reel.y - 0.18, z0 + 0.2], [reel.x + 0.05, 1.4, z0 + 0.28], [reel.x + 0.1, 0.3, z0 + 0.5], [reel.x - 0.05, 0.012, z0 + 1.0],
            [3.4, 0.012, z0 + 1.6], [2.6, 0.012, z0 + 1.9], [2.3, 0.012, z0 + 2.4]], 0.011, 64));
        b.add(m.black, box(0.04, 0.03, 0.16, 2.28, 0.02, z0 + 2.52, 0.3));
        // sockets and conduits down from the cable tray
        for (const x of [reel.x + 0.3, 2.2]) b.add(m.white, box(0.025, 4.86 - 0.47, 0.025, x, (4.86 + 0.47) / 2, z0 + 0.02));
        b.add(m.white, box(0.16, 0.1, 0.05, 2.2, 0.42, z0 + 0.025));
        b.add(m.orange, hose([[2.2, 0.4, z0 + 0.06], [2.18, 0.012, z0 + 0.3], [2.0, 0.012, z0 + 1.2], [1.2, 0.012, z0 + 2.0], [0.5, 0.3, z0 + 2.45]], 0.009, 48));
        // the signs above and beside
        b.add(paper, atlasUVs(new THREE.PlaneGeometry(0.76, 0.37), 'dyno').translate(3.1, 2.25, z0 + 0.012));
        b.add(paper, atlasUVs(new THREE.PlaneGeometry(0.3, 0.3), 'noSmoking').translate(reel.x, 3.2, z0 + 0.012));
        b.add(paper, atlasUVs(new THREE.PlaneGeometry(0.4, 0.39), 'calendar').translate(WINDOW.x1 + 0.45, 1.85, z0 + 0.012));
    }

    // ---- tool chest (roll cab + top chest) next to the bench
    {
        const x = 3.1;
        const z = z0 + 0.33;
        b.add(m.red, box(1.4, 0.9, 0.6, x, 0.55, z));
        b.add(m.red, box(1.4, 0.45, 0.5, x, 1.235, z - 0.05));
        b.add(m.graphite, box(1.42, 0.035, 0.62, x, 1.017, z));
        b.add(m.graphite, box(1.42, 0.03, 0.52, x, 1.475, z - 0.05));
        let y = 0.97;
        for (const h of [0.09, 0.09, 0.12, 0.16, 0.2, 0.18]) {
            y -= h;
            b.add(m.black, box(1.34, 0.006, 0.01, x, y, z + 0.3));
            b.add(m.aluminium, box(1.1, 0.022, 0.03, x, y + h - 0.03, z + 0.31));
        }
        y = 1.45;
        for (const h of [0.08, 0.1, 0.12, 0.13]) {
            y -= h;
            b.add(m.black, box(1.34, 0.006, 0.01, x, y, z + 0.2));
            b.add(m.aluminium, box(1.1, 0.02, 0.026, x, y + h - 0.028, z + 0.21));
        }
        b.add(m.chrome, cylinder(0.014, 0.7, x + 0.78, 0.95, z, 10, Math.PI / 2));
        for (const dz of [-0.22, 0.22]) b.add(m.chrome, box(0.08, 0.02, 0.02, x + 0.74, 0.95, z + dz));
        for (const dx of [-0.6, 0.6]) for (const dz of [-0.22, 0.22]) {
            b.add(m.rubber, cylinder(0.045, 0.035, x + dx, 0.05, z + dz, 12, 0, 0, Math.PI / 2));
            b.add(m.graphite, box(0.06, 0.03, 0.06, x + dx, 0.1, z + dz));
        }
        b.add(m.chrome, box(0.3, 0.025, 0.04, x - 0.3, 1.505, z - 0.05, 0.4));
        b.add(m.yellow, cylinder(0.04, 0.16, x + 0.4, 1.57, z - 0.1, 12));
    }

    // ---- the engine on its stand in front of the bench (an invented inline four)
    {
        const ex = 1.0;
        const ey = 0.82;
        const ez = -5.5;
        // stand: H-base on castors, post, the head plate
        b.add(m.red, box(1.1, 0.06, 0.07, ex - 0.1, 0.12, ez));
        b.add(m.red, box(0.07, 0.06, 0.9, ex - 0.55, 0.12, ez));
        b.add(m.red, box(0.07, 0.06, 0.6, ex + 0.42, 0.12, ez));
        for (const [dx, dz] of [[-0.55, -0.42], [-0.55, 0.42], [0.42, -0.28], [0.42, 0.28]]) {
            b.add(m.rubber, cylinder(0.05, 0.035, ex + dx, 0.05, ez + dz, 12, 0, 0, Math.PI / 2));
            b.add(m.graphite, box(0.05, 0.04, 0.05, ex + dx, 0.1, ez + dz));
        }
        b.add(m.red, box(0.08, 0.72, 0.08, ex - 0.55, 0.5, ez));
        b.add(m.red, box(0.26, 0.07, 0.07, ex - 0.45, ey, ez));
        b.add(m.graphite, cylinder(0.12, 0.03, ex - 0.32, ey, ez, 20, 0, 0, Math.PI / 2));
        for (const [dy, dz] of [[0.14, 0.14], [0.14, -0.14], [-0.14, 0.14], [-0.14, -0.14]]) b.add(m.red, box(0.12, 0.03, 0.03, ex - 0.26, ey + dy, ez + dz));
        // engine: flywheel, block, oil pan, head, cam cover, coil packs, timing cover, pulleys, alternator
        b.add(m.castIron, cylinder(0.17, 0.03, ex - 0.2, ey - 0.05, ez, 28, 0, 0, Math.PI / 2));
        b.add(m.castIron, box(0.62, 0.38, 0.34, ex + 0.12, ey - 0.02, ez));
        b.add(m.black, box(0.58, 0.13, 0.3, ex + 0.12, ey - 0.27, ez));
        b.add(m.aluminium, box(0.62, 0.15, 0.32, ex + 0.12, ey + 0.245, ez));
        b.add(m.red, box(0.58, 0.08, 0.24, ex + 0.12, ey + 0.36, ez));
        for (let k = 0; k < 4; k++) b.add(m.black, box(0.05, 0.07, 0.05, ex - 0.09 + k * 0.14, ey + 0.425, ez));
        b.add(m.black, box(0.04, 0.5, 0.3, ex + 0.45, ey + 0.05, ez));
        b.add(m.graphite, cylinder(0.08, 0.04, ex + 0.49, ey - 0.12, ez, 20, 0, 0, Math.PI / 2));
        b.add(m.graphite, cylinder(0.06, 0.03, ex + 0.48, ey + 0.2, ez - 0.06, 18, 0, 0, Math.PI / 2));
        b.add(m.graphite, cylinder(0.06, 0.03, ex + 0.48, ey + 0.2, ez + 0.06, 18, 0, 0, Math.PI / 2));
        b.add(m.aluminium, cylinder(0.065, 0.12, ex + 0.38, ey + 0.08, ez + 0.24, 16, 0, 0, Math.PI / 2));
        b.add(m.black, place(new THREE.TorusGeometry(0.15, 0.008, 4, 24), ex + 0.48, ey + 0.04, ez + 0.02, 0, Math.PI / 2, 0));
        // intake: four runners into a plenum (+z side), exhaust: four pipes into a collector (-z side)
        b.add(m.aluminium, cylinder(0.065, 0.56, ex + 0.12, ey + 0.2, ez + 0.36, 16, 0, 0, Math.PI / 2));
        for (let k = 0; k < 4; k++) {
            const x = ex - 0.09 + k * 0.14;
            b.add(m.aluminium, hose([[x, ey + 0.25, ez + 0.15], [x, ey + 0.32, ez + 0.24], [x, ey + 0.24, ez + 0.33]], 0.024, 8));
            b.add(m.exhaust, hose([[x, ey + 0.22, ez - 0.16], [x, ey + 0.18, ez - 0.27], [x + (ex + 0.12 - x) * 0.6, ey - 0.02, ez - 0.3], [ex + 0.12, ey - 0.12, ez - 0.28]], 0.022, 14));
        }
        b.add(m.exhaust, cylinder(0.04, 0.16, ex + 0.12, ey - 0.2, ez - 0.28, 12));
        // a hand lamp clipped to the stand (lit)
        b.add(m.black, box(0.05, 0.22, 0.04, ex - 0.55, 0.95, ez + 0.06));
        b.add(m.ledWhite, box(0.03, 0.16, 0.004, ex - 0.55, 0.95, ez + 0.082));
        glows.add(ex - 0.55, 0.95, ez + 0.1, 0.4, 0xffffff);
        b.add(stains, decal(1.4, 1.2, ex + 0.1, ez, 0.2));
    }

    // ---- the two-post lift on the left (arms down, no car on it)
    {
        const lz = -2.6;
        const posts = [-5.2, -8.3];
        for (const [k, x] of posts.entries()) {
            const inward = k === 0 ? -1 : 1;
            b.add(m.lift, box(0.32, 3.9, 0.28, x, 1.95, lz));
            b.add(m.steel, box(0.62, 0.025, 0.56, x, 0.0125, lz), true);
            b.add(m.graphite, box(0.08, 3.6, 0.12, x + inward * 0.2, 1.9, lz));
            b.add(m.graphite, box(0.4, 0.68, 0.36, x + inward * 0.36, 0.52, lz));
            b.add(hazard, new THREE.PlaneGeometry(0.32, 0.3).translate(x, 1.7, lz + 0.142));
            for (const side of [-1, 1]) {
                const yaw = Math.atan2(inward * 0.62, side * 0.78);
                const arm = new THREE.BoxGeometry(0.12, 0.08, 1.15).translate(0, 0, 0.575);
                b.add(m.graphite, place(arm, x + inward * 0.45, 0.2, lz + side * 0.12, 0, yaw, 0));
                const end = { x: x + inward * 0.45 + Math.sin(yaw) * 1.1, z: lz + side * 0.12 + Math.cos(yaw) * 1.1 };
                b.add(m.rubber, cylinder(0.075, 0.06, end.x, 0.27, end.z, 16));
                b.add(m.steel, cylinder(0.04, 0.05, end.x, 0.215, end.z, 10));
            }
        }
        b.add(m.lift, box(posts[0] - posts[1] + 0.32, 0.22, 0.24, (posts[0] + posts[1]) / 2, 3.98, lz));
        b.add(m.black, box(posts[0] - posts[1] - 0.4, 0.04, 0.04, (posts[0] + posts[1]) / 2, 3.82, lz + 0.06));
        b.add(m.brushed, box(posts[0] - posts[1] - 0.3, 0.025, 0.34, (posts[0] + posts[1]) / 2, 0.0125, lz), true);
        // power unit with its motor and tank on the outer face of the right post, cable up to the tray
        b.add(m.graphite, cylinder(0.09, 0.32, -4.92, 1.5, lz - 0.05, 16));
        b.add(m.black, box(0.16, 0.34, 0.16, -4.94, 1.1, lz - 0.05));
        b.add(m.red, box(0.04, 0.16, 0.04, -4.86, 1.32, lz + 0.08));
        b.add(m.black, cylinder(0.012, H - 1.66, -4.92, (H + 1.66) / 2, lz - 0.05, 6));
        b.add(m.black, hose([[-4.98, 0.95, lz - 0.05], [-5.0, 0.4, lz - 0.1], [-5.05, 0.15, lz - 0.16]], 0.012, 10));
        // the bay marked on the floor
        const bay = { x0: -8.75, x1: -4.65, z0: -5.0, z1: -0.3 };
        const line = 0.1;
        const strip = (length, x, z, yaw) => {
            const g = new THREE.PlaneGeometry(length, line).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, 0.003, z);
            const uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length);
            return g;
        };
        b.add(hazard, strip(bay.x1 - bay.x0, (bay.x0 + bay.x1) / 2, bay.z1, 0));
        b.add(hazard, strip(bay.z1 - bay.z0, bay.x1, (bay.z0 + bay.z1) / 2, Math.PI / 2));
        b.add(stains, decal(1.8, 2.4, -6.75, lz + 0.3, 1.3));
        // a floor jack and a creeper stool beside the bay
        b.add(m.red, box(0.32, 0.14, 0.72, -3.9, 0.12, 2.9, 0.5));
        b.add(m.red, cylinder(0.055, 0.1, -3.9 + Math.sin(0.5) * 0.36, 0.22, 2.9 + Math.cos(0.5) * 0.36, 14));
        // the handle rises from the rear of the jack, away from the saddle
        b.add(m.chrome, hose([[-3.9 - Math.sin(0.5) * 0.34, 0.16, 2.9 - Math.cos(0.5) * 0.34], [-3.9 - Math.sin(0.5) * 1.3, 0.72, 2.9 - Math.cos(0.5) * 1.3]], 0.016, 2));
        b.add(m.black, cylinder(0.022, 0.18, -3.9 - Math.sin(0.5) * 1.34, 0.745, 2.9 - Math.cos(0.5) * 1.34, 8, 2.11, 0.5, 0));
        for (const [dx, dz] of [[-0.14, -0.3], [0.14, -0.3], [-0.14, 0.3], [0.14, 0.3]]) {
            const c = Math.cos(0.5);
            const s = Math.sin(0.5);
            b.add(m.rubber, cylinder(0.05, 0.04, -3.9 + dx * c + dz * s, 0.05, 2.9 - dx * s + dz * c, 12, 0, 0.5, Math.PI / 2));
        }
        b.add(m.black, cylinder(0.19, 0.08, -3.4, 0.5, -5.0, 20));
        b.add(m.chrome, cylinder(0.025, 0.36, -3.4, 0.28, -5.0, 8));
        for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            b.add(m.graphite, box(0.04, 0.03, 0.3, -3.4 + Math.sin(a) * 0.15, 0.09, -5.0 + Math.cos(a) * 0.15, a));
            b.add(m.rubber, cylinder(0.03, 0.03, -3.4 + Math.sin(a) * 0.3, 0.03, -5.0 + Math.cos(a) * 0.3, 8, 0, a, Math.PI / 2));
        }
    }

    // ---- tyre rack on the left wall, a stack of tyres beside it, rims on the wall
    {
        const rack = { x: x0 + 0.42, z0: -7.75, z1: -4.85, depth: 0.62, height: 2.45 };
        const levels = [0.14, 0.94, 1.74];
        for (const z of [rack.z0, rack.z1]) {
            for (const dx of [-rack.depth / 2, rack.depth / 2]) b.add(m.rackFrame, box(0.08, rack.height, 0.07, rack.x + dx, rack.height / 2, z));
            for (let k = 0; k < 4; k++) {
                const y0 = 0.2 + k * 0.55;
                const g = new THREE.BoxGeometry(0.025, Math.hypot(0.55, rack.depth), 0.025).rotateZ((k % 2 ? 1 : -1) * Math.atan2(rack.depth, 0.55));
                b.add(m.rackFrame, g.translate(rack.x, y0 + 0.275, z));
            }
        }
        for (const y of levels) {
            for (const dx of [-rack.depth / 2, rack.depth / 2]) b.add(m.rackBeam, box(0.05, 0.1, rack.z1 - rack.z0, rack.x + dx, y, (rack.z0 + rack.z1) / 2));
            b.add(m.steel, box(rack.depth, 0.015, rack.z1 - rack.z0 - 0.1, rack.x, y + 0.05, (rack.z0 + rack.z1) / 2));
        }
        const tyre = tyreGeometries();
        const placeTyre = (x, y, z, rx, ry) => {
            b.add(m.tread, place(tyre.tread.clone(), x, y, z, rx, ry, 0));
            b.add(m.rubber, place(tyre.wall.clone(), x, y, z, rx, ry, 0));
        };
        const perLevel = 10;
        for (const [n, y] of levels.entries()) {
            const count = n === 2 ? 7 : perLevel;
            for (let k = 0; k < count; k++) placeTyre(rack.x, y + 0.06 + 0.325, rack.z0 + 0.2 + k * 0.27, 0, (random() - 0.5) * 0.08);
        }
        // lying stack (axis up) and two wheels leaning on it, their faces to the room
        for (let k = 0; k < 4; k++) placeTyre(-7.55, 0.11 + k * 0.215, -4.2, -Math.PI / 2, random());
        const rims = rimGeometries();
        for (const [k, design] of [[0, 1], [1, 3]]) {
            const x = -7.05 + k * 0.08;
            const z = -4.5 + k * 0.6;
            const yaw = Math.PI / 2 - 0.25 + k * 0.4;
            placeTyre(x, 0.335, z, -0.12, yaw);
            for (const [part, g] of Object.entries(rims[design])) b.add(rimMaterial(m, design, part), place(g.clone(), x, 0.335, z, -0.12, yaw, 0));
        }
        // rims on display on the left wall, on brackets
        const wallRims = [[3, 0.2], [0, 1.25], [2, 2.3], [4, 3.35], [1, 4.4]];
        for (const [k, [design, z]] of wallRims.entries()) {
            const y = 3.0 + (k % 2) * 0.18;
            for (const [part, g] of Object.entries(rims[design])) b.add(rimMaterial(m, design, part), place(g.clone(), x0 + 0.16, y, z, 0, Math.PI / 2, 0));
            b.add(m.steel, box(0.12, 0.05, 0.05, x0 + 0.06, y, z));
        }
        tyre.tread.dispose();
        tyre.wall.dispose();
        for (const set of rims) for (const g of Object.values(set)) g.dispose();
    }

    // ---- posters, signs, banner, electrical cabinet, extinguisher, first aid
    {
        const poster = (key, w, h, x, y, z, yaw) => b.add(paper, place(atlasUVs(new THREE.PlaneGeometry(w, h), key), x, y, z, 0, yaw, (random() - 0.5) * 0.03));
        poster('touge', 0.62, 0.87, x0 + 0.012, 2.3, -3.85, Math.PI / 2);
        poster('glyphs', 0.62, 0.87, x0 + 0.012, 2.25, -1.35, Math.PI / 2);
        poster('oil', 0.62, 0.87, x0 + 0.012, 1.75, 0.75, Math.PI / 2);
        poster('tyres', 0.62, 0.87, x0 + 0.012, 1.8, 2.85, Math.PI / 2);
        poster('banner', 3.4, 0.6, x0 + 0.015, 4.2, 2.3, Math.PI / 2);
        poster('plate', 0.82, 0.145, (WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y1 + 0.25, z0 + 0.012, 0);
        // electrical cabinet with its warning sign, the extinguisher and the first-aid box
        b.add(m.white, box(0.6, 0.8, 0.2, -5.6, 1.75, z0 + 0.1));
        b.add(m.black, box(0.02, 0.12, 0.03, -5.35, 1.75, z0 + 0.21));
        poster('voltage', 0.16, 0.16, -5.6, 1.95, z0 + 0.202, 0);
        b.add(m.steel, box(0.05, 4.86 - 2.15, 0.05, -5.45, (4.86 + 2.15) / 2, z0 + 0.03));
        poster('extinguisher', 0.22, 0.22, -6.3, 2.05, z0 + 0.012, 0);
        b.add(m.red, cylinder(0.08, 0.5, -6.3, 0.95, z0 + 0.12, 16));
        b.add(m.black, cylinder(0.03, 0.08, -6.3, 1.24, z0 + 0.12, 10));
        b.add(m.black, hose([[-6.27, 1.25, z0 + 0.12], [-6.19, 1.15, z0 + 0.2], [-6.2, 0.85, z0 + 0.2]], 0.01, 8));
        b.add(m.steel, box(0.06, 0.06, 0.04, -6.3, 1.12, z0 + 0.02));
        b.add(m.white, box(0.36, 0.3, 0.12, -7.0, 1.45, z0 + 0.06));
        poster('firstAid', 0.14, 0.14, -7.0, 1.45, z0 + 0.121, 0);
        // the right wall: a long shelf of boxed parts (mostly seen in reflections)
        for (const y of [0.4, 1.2, 2.0]) b.add(m.graphite, box(0.5, 0.03, 4.4, x1 - 0.3, y, 1.0));
        for (const z of [-1.2, 3.2]) b.add(m.graphite, box(0.5, 2.1, 0.04, x1 - 0.3, 1.05, z));
        for (const y of [0.4, 1.2, 2.0]) {
            for (let k = 0; k < 6; k++) {
                const h = 0.22 + random() * 0.3;
                b.add(random() < 0.7 ? m.cardboard : m.blueBarrel, box(0.42, h, 0.5 + random() * 0.2, x1 - 0.3, y + 0.015 + h / 2, -0.9 + k * 0.7));
            }
        }
        // oil drums in the corner
        for (const [x, z, material] of [[7.9, -2.8, m.blueBarrel], [8.35, -2.2, m.red], [7.7, -2.05, m.blueBarrel]]) {
            b.add(material, cylinder(0.29, 0.88, x, 0.44, z, 22));
            for (const y of [0.29, 0.59]) b.add(material, place(new THREE.TorusGeometry(0.292, 0.012, 4, 22), x, y, z, Math.PI / 2));
            b.add(m.steel, cylinder(0.03, 0.02, x + 0.12, 0.885, z, 8));
        }
        // the exit door in the front wall with a lit sign (behind the camera: seen in the paint)
        b.add(m.dado, box(1.0, 2.1, 0.06, -4.0, 1.05, z1 - 0.03));
        b.add(m.aluminium, box(0.16, 0.03, 0.04, -3.65, 1.05, z1 - 0.08));
        b.add(m.exit, box(0.4, 0.16, 0.04, -4.0, 2.35, z1 - 0.04));
        glows.add(-4.0, 2.35, z1 - 0.2, 0.6, 0x18d060);
    }

    // ---- the office behind the window: a lit room, blinds half down, frame, glass, sill
    {
        const o = { x0: WINDOW.x0 - 0.45, x1: WINDOW.x1 + 1.2, z0: z0 - 2.55, z1: z0 - wallT, height: 2.8 };
        const ox = (o.x0 + o.x1) / 2;
        const oz = (o.z0 + o.z1) / 2;
        b.add(m.officeLight, box(o.x1 - o.x0, o.height, o.z1 - o.z0, ox, o.height / 2, oz));
        b.add(office, new THREE.PlaneGeometry(o.x1 - o.x0 - 0.1, (o.x1 - o.x0 - 0.1) / 2).translate(ox, 1.25, o.z0 + 0.02));
        b.add(m.officeLamp, box(1.2, 0.02, 0.3, ox, o.height - 0.02, oz));
        const wy = (WINDOW.y0 + WINDOW.y1) / 2;
        const wx = (WINDOW.x0 + WINDOW.x1) / 2;
        const ww = WINDOW.x1 - WINDOW.x0;
        const wh = WINDOW.y1 - WINDOW.y0;
        b.add(m.glass, new THREE.PlaneGeometry(ww, wh).translate(wx, wy, z0 - 0.12));
        for (const g of [box(ww + 0.08, 0.05, 0.08, wx, WINDOW.y1, z0 - 0.1), box(ww + 0.08, 0.05, 0.08, wx, WINDOW.y0, z0 - 0.1),
            box(0.05, wh, 0.08, WINDOW.x0, wy, z0 - 0.1), box(0.05, wh, 0.08, WINDOW.x1, wy, z0 - 0.1), box(0.04, wh, 0.06, wx, wy, z0 - 0.1)]) b.add(m.aluminium, g);
        b.add(m.aluminium, box(ww + 0.2, 0.03, 0.22, wx, WINDOW.y0 - 0.02, z0 + 0.06));
        for (let k = 0; k < 9; k++) b.add(m.white, place(new THREE.BoxGeometry(ww - 0.06, 0.004, 0.05), wx, WINDOW.y1 - 0.06 - k * 0.055, z0 - 0.2, 0.5));
        b.add(m.white, box(ww - 0.04, 0.04, 0.05, wx, WINDOW.y1 - 0.04 - 9 * 0.055, z0 - 0.2));
        glows.add(wx, wy, z0 + 0.1, 1.6, 0xffd9a0);
    }

    // ---- the tool trolley in the foreground (right of the car) and oil stains under the car's spot
    {
        const x = 4.5;
        const z = 1.7;
        const yaw = -0.5;
        const parts = [];
        for (const y of [0.22, 0.52, 0.82]) {
            parts.push([m.graphite, box(0.78, 0.025, 0.46, 0, y, 0)]);
            parts.push([m.graphite, box(0.78, 0.05, 0.015, 0, y + 0.025, 0.23)]);
            parts.push([m.graphite, box(0.78, 0.05, 0.015, 0, y + 0.025, -0.23)]);
        }
        for (const [dx, dz] of [[-0.37, -0.21], [0.37, -0.21], [-0.37, 0.21], [0.37, 0.21]]) {
            parts.push([m.graphite, box(0.025, 0.8, 0.025, dx, 0.5, dz)]);
            parts.push([m.rubber, cylinder(0.04, 0.03, dx, 0.04, dz, 10, 0, 0, Math.PI / 2)]);
        }
        parts.push([m.chrome, cylinder(0.014, 0.46, -0.44, 0.9, 0, 8, Math.PI / 2)]);
        for (const dz of [-0.2, 0.2]) parts.push([m.chrome, box(0.08, 0.016, 0.016, -0.41, 0.9, dz)]);
        for (let k = 0; k < 4; k++) parts.push([[m.red, m.yellow, m.black, m.red][k], cylinder(0.033, 0.2, 0.18 + k * 0.075, 0.94, -0.1 + (k % 2) * 0.08, 10)]);
        parts.push([m.chrome, box(0.55, 0.025, 0.03, -0.02, 0.85, 0.08, 0.3)]);
        parts.push([m.black, box(0.16, 0.035, 0.04, -0.27, 0.855, 0.16, 0.3)]);
        parts.push([m.black, box(0.42, 0.09, 0.26, 0.05, 0.59, 0)]);
        parts.push([m.red, box(0.24, 0.03, 0.18, -0.2, 0.25, 0.05, 0.4)]);
        parts.push([m.yellow, box(0.12, 0.26, 0.08, 0.25, 0.36, -0.05)]);
        for (const [material, g] of parts) b.add(material, place(g, x, 0, z, 0, yaw, 0));
    }

    b.build(group, [m.floor, m.brushed]);
    const effects = new THREE.Group();
    effects.name = 'garage-effects';
    const glowPoints = glows.build({ fogFar: 80 });
    if (glowPoints) effects.add(glowPoints);
    const poolMesh = pools.build();
    if (poolMesh) effects.add(poolMesh);
    return { group, effects, floor: m.floor };
}

/** An oil stain on the floor: a patch of the grime overlay (transparent), turned by yaw, the pattern shifted per stain. */
function decal(w, d, x, z, yaw) {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, 0.002, z);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + x * 0.13, uv.getY(i) * 0.5 + z * 0.17);
    return g;
}

/**
 * A tyre (235/40 R18-like): the tread band (u around, v across – the tread texture) and the sidewalls with the inner bead, axis along y.
 * Returns geometries to clone and place.
 */
function tyreGeometries() {
    const r = 0.325;
    const half = 0.11;
    // the lathe turns a profile around y; walked counter-clockwise (up the outside, inwards over the top, down the bead, outwards under
    // the bottom) its normals point out of the rubber
    const tread = [[r - 0.022, -half + 0.004], [r - 0.006, -half + 0.01], [r, -half + 0.03], [r, half - 0.03], [r - 0.006, half - 0.01], [r - 0.022, half - 0.004]]
        .map(([x, y]) => new THREE.Vector2(x, y));
    const wall = [[r - 0.022, half - 0.004], [0.27, half], [0.24, half - 0.004], [0.225, half - 0.012], [0.225, -half + 0.012], [0.24, -half + 0.004], [0.27, -half], [r - 0.022, -half + 0.004]]
        .map(([x, y]) => new THREE.Vector2(x, y));
    // turned so the axis runs along z like the rims (the +y sidewall becomes the +z face)
    return {
        tread: new THREE.LatheGeometry(tread, 40).rotateX(Math.PI / 2),
        wall: new THREE.LatheGeometry(wall, 32).rotateX(Math.PI / 2),
    };
}

/**
 * Five rim designs (18-inch, ⌀ 0.46 m, axis along z, the face towards +z): barrel, lip, spokes, hub, nuts – each design a set of parts
 * { face, barrel, nuts } so the face can take the design's finish.
 */
function rimGeometries() {
    const designs = [
        { spokes: 5, width: 0.075, twin: false },
        { spokes: 10, width: 0.03, twin: false },
        { spokes: 6, width: 0.06, twin: true },
        { spokes: 14, width: 0.018, twin: false },
        { spokes: 8, width: 0.045, twin: false },
    ];
    return designs.map(d => {
        const face = [];
        for (let k = 0; k < d.spokes; k++) {
            const a = (k / d.spokes) * Math.PI * 2;
            for (const off of d.twin ? [-0.09, 0.09] : [0]) {
                const g = new THREE.BoxGeometry(d.width, 0.15, 0.028).translate(0, 0.135, 0.06);
                face.push(g.rotateZ(a + off));
            }
        }
        face.push(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 24).rotateX(Math.PI / 2).translate(0, 0, 0.06));
        face.push(new THREE.TorusGeometry(0.222, 0.014, 6, 40).translate(0, 0, 0.085));
        const barrel = [
            new THREE.CylinderGeometry(0.215, 0.215, 0.2, 40, 1, true).rotateX(Math.PI / 2),
            new THREE.CylinderGeometry(0.2, 0.2, 0.01, 32).rotateX(Math.PI / 2).translate(0, 0, -0.02),
        ];
        const nuts = [];
        for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            nuts.push(new THREE.CylinderGeometry(0.011, 0.011, 0.025, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.09));
        }
        nuts.push(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16).rotateX(Math.PI / 2).translate(0, 0, 0.09));
        return { face: mergeGeometries(face), barrel: mergeGeometries(barrel), nuts: mergeGeometries(nuts) };
    });
}

/** The finish of a rim part per design: chrome, gold, black, silver mesh, a polished lip on black. */
function rimMaterial(m, design, part) {
    if (part === 'barrel') return m.castIron;
    if (part === 'nuts') return m.chrome;
    return [m.chrome, m.gold, m.rimBlack, m.aluminium, m.rimBlack][design];
}

function pick(object, keys) {
    const out = {};
    for (const k of keys) if (object[k] !== undefined) out[k] = object[k];
    return out;
}
