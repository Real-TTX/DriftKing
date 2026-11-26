// DriftKing · maps/city.js – "Neon-Viertel": a closed street circuit through a dense entertainment district at night. A wet four-lane street
// with kerbs, gutters and tiled sidewalks behind a guard fence (the walls: just behind the kerb), narrow mixed-use buildings shoulder to shoulder
// with shops, bars and restaurants on the ground floor and real windows above (city-facade.js, city-blocks.js), sign towers and neon
// (city-signs.js), street furniture, crossings with traffic lights, utility poles and their wires (city-street.js), an elevated railway with
// passing trains (city-rail.js), reflections of the lights in the wet road and steam from the manholes (city-fx.js). Flat at y = 0.
// Draw calls: one per facade finish, one props batch, one emissive batch, one paint batch, one sign mesh, wires, reflections, steam, the
// shared road/kerb/lamp/start-line builders and the two trains.

import * as THREE from 'three';
import { drawLast } from '../../render/kit.js';
import { buildKerbs, buildRoadStrip, buildStartLine, courseEdges, ribbonGeometry } from '../road.js';
import { Batch, emissiveMaterial, pick, planarUVs, propsMaterial } from './city-kit.js';
import { Facades } from './city-facade.js';
import { CitySigns, NEON } from './city-signs.js';
import { buildBlocks, SIDEWALK } from './city-blocks.js';
import { buildStreet } from './city-street.js';
import { CityFx } from './city-fx.js';
import { buildRail, RAIL } from './city-rail.js';

/** The guard fence along the kerb (lateral offset behind the road edge) and its post spacing. */
const FENCE = 0.55;

export function build(ctx) {
    const { root, course, colliders, quality } = ctx;
    const half = course.width / 2;
    const props = new Batch();
    const emissive = new Batch({ emissive: true });
    const paint = new Batch();
    const facades = new Facades(ctx);
    const fx = new CityFx(ctx);
    const signs = new CitySigns(ctx, { props, reflect: fx.reflect });
    const wires = [];
    const steam = [];
    const crossings = crossingSpots(course);
    // the two straights the railway crosses (z of the road under the viaduct)
    const railRoads = [-120, 122];
    const avoid = (x, z) => Math.abs(x - RAIL.x) < RAIL.half && z > RAIL.from - 20 && z < RAIL.to + 20;
    const neonColour = random => pick(random, NEON);

    buildGround(ctx);
    // the walls: just behind the kerb (a car bounces off the kerb and the fence)
    courseEdges(course, 0.35, { every: 2, colliders });
    buildFence(ctx, props, crossings);
    buildStartLine(root, course, ctx.glows, { colour: 0x29e7ff, lights: ctx.lights, materials: ctx.materials });

    const propsMat = propsMaterial(quality);
    const emissiveMat = emissiveMaterial();
    const { fronts } = buildBlocks(ctx, { facades, props, emissive, signs, reflect: fx.reflect, avoid, neonColour });
    buildStreet(ctx, { props, emissive, paint, signs, reflect: fx.reflect, wires, fronts, crossings, steam });
    const rail = buildRail(ctx, { facades, props, emissive, wires, roads: railRoads, propsMaterial: propsMat, emissiveMaterial: emissiveMat });

    facades.build(root);
    // the big batches in squares of 128 m (frustum culling); the small ones whole
    props.buildChunks(root, propsMat, 'props', 128);
    emissive.buildChunks(root, emissiveMat, 'emissive', 192);
    addMesh(root, paint.build(propsMaterial(quality, { polygonOffset: 2 })), 'paint');
    signs.build(root);
    if (wires.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
        const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x0b0b0e }));
        lines.name = 'wires';
        root.add(lines);
    }
    fx.build(root, steam);

    const signals = emissiveMat.userData.signals;
    let time = 0;
    return {
        flatY: 0,
        update(dt) {
            time += dt;
            facades.time.value = time;
            fx.update(dt);
            rail.update(dt);
            updateSignals(signals, time);
        },
    };
}

function addMesh(root, mesh, name) {
    if (!mesh) return;
    mesh.name = name;
    root.add(mesh);
}

/** Mid-block crossings on the long straights: in a gap of the dashed lane lines (dashes 5 m / 5 m from s = 0). */
function crossingSpots(course) {
    const spots = [];
    for (let s = 67.5; s < course.length - 10; s += 150) {
        let straight = true;
        for (let d = -12; d <= 12; d += 4) if (Math.abs(course.at(s + d).k) > 1 / 200) straight = false;
        if (straight) spots.push(s);
    }
    return spots;
}

/**
 * The ground of the district: asphalt between the blocks, the wet street with its decals (lane dashes, wheel paths, drift marks – the solid
 * lines and the crossings are city-street.js's), kerbs with gutters and drains, tiled sidewalks (raised 0.15 m).
 */
function buildGround(ctx) {
    const { root, course } = ctx;
    const half = course.width / 2;
    const m = ctx.materials;
    const ground = new THREE.Mesh(planarUVs(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2)), m.asphalt({ wet: 0.45, color: 0xb8b8b8 }));
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    ground.name = 'ground';
    // under the street, the kerbs and the blocks: drawn last, so only its visible pixels are shaded
    root.add(drawLast(ground));
    root.add(buildRoadStrip(course, m.asphalt({ wet: 0.8, puddles: 0.4 }), {
        lift: 0.02,
        materials: m,
        // the solid lines and the crossings are city-street.js's; low skips the wheel paths (they cost ~30 k triangles)
        markings: { centre: null, edges: false, lanes: 2, wear: 0.45, grime: ctx.quality !== 'low', skids: 1, seed: 9 },
    }));
    buildKerbs(root, course, { materials: m, gutter: 0.35, drains: 24 });
    const sidewalk = new THREE.Mesh(planarUVs(mergeSidewalks(course, half)), m.tiles({ color: 0x8e8a84 }));
    sidewalk.receiveShadow = true;
    sidewalk.name = 'sidewalks';
    root.add(sidewalk);
}

function mergeSidewalks(course, half) {
    const left = ribbonGeometry(course, half + 0.18, half + SIDEWALK, { lift: 0.15 });
    const right = ribbonGeometry(course, -half - SIDEWALK, -half - 0.18, { lift: 0.15 });
    const positions = new Float32Array(left.attributes.position.count * 3 + right.attributes.position.count * 3);
    positions.set(left.attributes.position.array, 0);
    positions.set(right.attributes.position.array, left.attributes.position.array.length);
    const offset = left.attributes.position.count;
    const index = [...left.index.array, ...Array.from(right.index.array, i => i + offset)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    left.dispose();
    right.dispose();
    return g;
}

/**
 * The guard fence along both kerbs (white painted steel: posts every 2 m, a top rail and a middle rail), open for the crossings.
 * Purely visual: the walls are the colliders of courseEdges.
 */
function buildFence(ctx, props, crossings) {
    const { course, quality } = ctx;
    const half = course.width / 2;
    const low = quality === 'low';
    const spacing = low ? 4 : 2;
    const colour = 0xd2d4d6;
    const o = { rough: 0.45, metal: 0.25 };
    const sides = 3;
    const L = course.length;
    const gap = s => crossings.some(c => {
        const d = Math.min(Math.abs(s - c), L - Math.abs(s - c));
        return d < 3;
    });
    for (const side of [-1, 1]) {
        const lateral = side * (half + FENCE);
        let previous = null;
        for (let s = 0; s <= L; s += spacing) {
            const p = course.at(s);
            const x = p.x + p.tz * lateral;
            const z = p.z - p.tx * lateral;
            if (gap(s)) {
                previous = null;
                continue;
            }
            props.cylinder(0.032, 0.032, 0.98, x, 0.15, z, colour, { ...o, open: true }, low ? 3 : 4);
            if (previous) {
                for (const y of [1.08, 0.62]) {
                    if (low) props.add(railBand(previous, { x, z }, y, side), colour, o);
                    else props.rod({ x: previous.x, y, z: previous.z }, { x, y, z }, y > 1 ? 0.03 : 0.02, colour, o, sides);
                }
            }
            previous = { x, z };
        }
    }
}

/** A flat rail between two fence posts (low): a band 6 cm tall facing the road (side +1: the road is to the right of a → b). */
function railBand(a, b, y, side) {
    const g = new THREE.BufferGeometry();
    const p = side > 0 ? [a, b] : [b, a];
    g.setAttribute('position', new THREE.Float32BufferAttribute([p[0].x, y - 0.03, p[0].z, p[1].x, y - 0.03, p[1].z, p[1].x, y + 0.03, p[1].z, p[0].x, y + 0.03, p[0].z], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
}

/** The signal cycle: cars green 16 s, amber 3 s, red 14 s; pedestrians walk in the middle of the red, the green blinks before it ends. */
function updateSignals(signals, time) {
    const t = time % 33;
    const car = signals.signalCar.value;
    car.set(t < 16 ? 1 : 0, t >= 16 && t < 19 ? 1 : 0, t >= 19 ? 1 : 0);
    const walk = t >= 20 && t < 29 ? 1 : t >= 29 && t < 31 ? (Math.floor(t * 4) % 2) : 0;
    signals.signalWalk.value.set(walk, walk > 0 ? 0 : 1);
}

