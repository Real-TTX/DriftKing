#!/usr/bin/env node
// Computes the lap length of every map (the course of js/game/world/course.js, the same code the game uses) and writes it into data/maps.json
// as "lengthM" (rounded metres). The server reads key, name, lengthM and defaultLaps from that file (lap plausibility).
//   node scripts/maps-length.mjs           writes the lengths
//   node scripts/maps-length.mjs --check   only checks (exit 1 when a length is stale or two road parts come too close)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'DriftKing.Module', 'wwwroot');
const file = join(root, 'data', 'maps.json');
const { Course } = await import(pathToFileURL(join(root, 'js', 'game', 'world', 'course.js')).href);
const check = process.argv.includes('--check');

const maps = JSON.parse(readFileSync(file, 'utf8'));
let problems = 0;
for (const map of maps) {
    const course = new Course(map);
    const length = Math.round(course.length);
    const gap = closestApproach(course);
    const climb = Math.max(...course.y) - Math.min(...course.y);
    const steepest = Math.max(...Array.from(course.slope, Math.abs));
    console.log(`${map.key.padEnd(7)} ${String(length).padStart(5)} m  laps ${map.defaultLaps}  closest other road ${gap.toFixed(1)} m  climb ${climb.toFixed(0)} m  max grade ${(steepest * 100).toFixed(0)} %`);
    if (gap < map.width * 1.6) {
        console.error(`  ${map.key}: two parts of the road are only ${gap.toFixed(1)} m apart (width ${map.width})`);
        problems++;
    }
    if (map.lengthM !== length) {
        if (check) {
            console.error(`  ${map.key}: lengthM is ${map.lengthM}, the course is ${length} m`);
            problems++;
        }
        map.lengthM = length;
    }
}

if (!check) {
    const text = JSON.stringify(maps, null, 2)
        // keep each corner on one line
        .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3, $4]');
    writeFileSync(file, text + '\n');
}
process.exit(problems ? 1 : 0);

/** The smallest distance between two samples that are more than 3 road widths apart along the course (parallel legs, hairpins). */
function closestApproach(course) {
    let best = Infinity;
    const apart = Math.ceil((course.width * 3) / course.step);
    for (let i = 0; i < course.count; i += 2) {
        for (let j = i + apart; j < course.count; j += 2) {
            if (course.count - (j - i) < apart) continue;
            const d = Math.hypot(course.x[i] - course.x[j], course.z[i] - course.z[j]);
            if (d < best) best = d;
        }
    }
    return best;
}
