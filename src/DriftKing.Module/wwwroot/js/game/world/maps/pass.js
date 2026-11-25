// DriftKing · maps/pass.js – "Tenjō-Pass": a Japanese mountain pass road (touge) at night. Up the east face in hairpins, over the ridge,
// down the west side in esses. The road is cut into the hillside: on the mountain side a concrete gutter and a retaining wall, a rock
// cut under rock-fall netting or a lattice-frame slope; on the valley side a gravel shoulder and a white W-beam guardrail above the drop.
// Cedar forest on the slopes, sodium lamps, mirrors and chevrons at the hairpins, a lay-by with vending machines, utility poles,
// kilometre posts, the hills around the basin and the lights of the town far below in the south, mist in the valleys.
// The parts live in pass-*.js: layout (cross-sections, terrain field, lay-by), terrain, road, roadside (cuts, guardrails), props,
// forest, layby, far (ridges, town, mist).

import { buildStartLine, courseEdges } from '../road.js';
import { layoutPass } from './pass-layout.js';
import { buildTerrain } from './pass-terrain.js';
import { buildRoad } from './pass-road.js';
import { buildRoadside } from './pass-roadside.js';
import { buildProps } from './pass-props.js';
import { buildForest } from './pass-forest.js';
import { buildLayby } from './pass-layby.js';
import { buildFar } from './pass-far.js';

export function build(ctx) {
    const { root, course, colliders, glows } = ctx;
    // the walls a car hits: both edges of the course, exactly as always (the guardrail and the walls stand right behind them)
    courseEdges(course, 0.55, { every: 2, colliders });
    const layout = layoutPass(course);
    const lay = layout.layby;
    const terrainMaterial = buildTerrain(ctx, layout);
    buildRoad(ctx, layout);
    buildRoadside(ctx, layout, terrainMaterial);
    buildProps(ctx, layout, { avoid: lay ? [{ s0: lay.s0 - 16, s1: lay.s1 + 16 }] : [] });
    buildLayby(ctx, layout);
    // views kept open: from the lay-by, and from the bottom straight down to the town in the south (a clear-cut slope)
    const views = lay ? [laybyView(course, lay)] : [];
    const clearings = lay ? [{ s0: lay.s0 - 22, s1: lay.s1 + 22, sign: lay.sign, depth: 60 }] : [];
    const town = townView(course, layout);
    if (town) {
        views.push(town.view);
        clearings.push(town.clearing);
    }
    buildForest(ctx, layout, { clearings, views });
    buildFar(ctx, layout);
    buildStartLine(root, course, glows, { colour: 0xff2e88, materials: ctx.materials, lights: ctx.lights });
    return {};
}

/** The stretch of the course whose guardrail side looks most directly south (towards the town): a clear-cut view cone there. */
function townView(course, layout) {
    let best = null;
    for (let s = 20; s < course.length; s += 10) {
        const p = course.at(s);
        for (const sign of [1, -1]) {
            const south = -p.tx * sign;
            if (south < 0.85 || !layout.isValley(p.index, sign) || Math.abs(p.k) > 1 / 120 || p.z < 150) continue;
            const score = south + p.z * 0.002;
            if (!best || score > best.score) best = { score, s, sign, p };
        }
    }
    if (!best) return null;
    const { s, sign, p } = best;
    return {
        view: { x: p.x, z: p.z, nx: p.tz * sign, nz: -p.tx * sign, length: 320, half: 34 },
        clearing: { s0: s - 45, s1: s + 45, sign, depth: 70 },
    };
}

/** The view from the lay-by down into the valley: a cone outwards from its middle, kept free of tall trees. */
function laybyView(course, lay) {
    const p = course.at((lay.s0 + lay.s1) / 2);
    return { x: p.x, z: p.z, nx: p.tz * lay.sign, nz: -p.tx * lay.sign, length: 240, half: 40 };
}
