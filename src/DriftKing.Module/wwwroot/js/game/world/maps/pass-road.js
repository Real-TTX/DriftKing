// DriftKing · maps/pass-road.js – the road surface of the Tenjō-Pass: PBR asphalt with a slight crown, darker patches of newer asphalt
// (lane repairs and trench cuts), worn paint (white edge lines, a yellow no-passing centre line in the bends, white dashes on the straights,
// speed-reduction bars before the hairpins), raised reflective studs that light up in the headlights, the concrete L-gutter along the
// mountain side, the gravel shoulder on the valley side, crack sealing and the black rubber of earlier drifters on the hairpins.

import * as THREE from 'three';
import { canvasTexture, mergeGeometries, rng } from '../../render/kit.js';
import { EDGE, ownSurface, retroMaterial, stripGeometry } from './pass-layout.js';

/**
 * Builds the road surface into ctx.root.
 * @param {object} ctx the map context (world.js)
 * @param {ReturnType<import('./pass-layout.js').layoutPass>} layout
 */
export function buildRoad(ctx, layout) {
    const { root, course, materials } = ctx;
    const random = rng(404);
    const half = course.width / 2;
    const y = i => course.y[i];

    // ---- asphalt: a 2 cm crown, UVs along the road (u across, v along, metres)
    const crown = [-EDGE.asphalt, -half * 0.5, 0, half * 0.5, EDGE.asphalt];
    const asphalt = stripGeometry(course, crown.length, (i, c, out) => {
        out.lat = crown[c];
        out.y = y(i) + 0.02 + 0.025 * (1 - Math.abs(crown[c]) / EDGE.asphalt);
    }, { step: ctx.quality === 'low' ? 2 : 1, uv: alongUv(course, crown) });
    const asphaltMaterial = materials.asphalt({ wet: 0.14, puddles: 0 });
    const road = new THREE.Mesh(asphalt, asphaltMaterial);
    road.receiveShadow = true;
    root.add(road);

    // ---- patches of newer, darker asphalt: lane repairs (long) and trench cuts across the road (short)
    const patches = [];
    const patchAt = (s0, length, a, b) => {
        const i0 = Math.floor(course.wrapS(s0) / course.step);
        const rows = Math.max(2, Math.round(length / course.step));
        const cols = [Math.min(a, b), (a + b) / 2, Math.max(a, b)];
        const g = stripGeometry(course, 3, (i, c, out) => {
            out.lat = cols[c];
            out.y = y(i) + 0.026 + 0.025 * (1 - Math.abs(cols[c]) / EDGE.asphalt) + 0.004;
        }, { step: 1, from: i0, to: i0 + rows, uv: alongUv(course, cols) });
        if (g) patches.push(g);
    };
    for (let s = 40; s < course.length - 40; s += 50 + random() * 90) {
        if (random() < 0.55) {
            const lane = random() < 0.5 ? 1 : -1;
            const inner = random() < 0.4 ? -0.6 : 0.15;
            patchAt(s, 8 + random() * 26, lane * inner, lane * (2.6 + random() * 2.4));
        } else {
            patchAt(s, 0.9 + random() * 0.8, -EDGE.asphalt + 0.05, EDGE.asphalt - 0.05);
        }
    }
    if (patches.length) {
        const mesh = new THREE.Mesh(mergeGeometries(patches), materials.asphalt({ wet: 0.14, puddles: 0, color: 0x8c8c94 }));
        mesh.receiveShadow = true;
        root.add(mesh);
    }

    // ---- paint: edge lines, the centre line (yellow solid in bends, white dashes on straights), bars before the hairpins
    const bendy = new Uint8Array(course.count);
    for (let i = 0; i < course.count; i++) {
        let max = 0;
        for (let o = -45; o <= 45; o += 3) max = Math.max(max, Math.abs(course.k[course.wrap(i + o)]));
        bendy[i] = max > 1 / 160 ? 1 : 0;
    }
    const white = new THREE.Color(0xe9e7df);
    const yellow = new THREE.Color(0xe7a51e);
    const paint = [];
    const line = (from, to, colour, keep) => {
        const a = Math.min(from, to);
        const b = Math.max(from, to);
        const g = stripGeometry(course, 2, (i, c, out) => {
            out.lat = c === 0 ? a : b;
            out.y = y(i) + 0.02 + 0.025 * (1 - Math.abs(out.lat) / EDGE.asphalt) + 0.008;
        }, { step: ctx.quality === 'low' ? 2 : 1, keep, uv: (i, c, out, k) => ((out.u = c === 0 ? a : b), (out.v = k * course.step)) });
        if (g) paint.push(colourise(g, colour));
    };
    line(EDGE.line, EDGE.line - 0.15, white);
    line(-EDGE.line + 0.15, -EDGE.line, white);
    line(0.075, -0.075, yellow, i => bendy[i] === 1);
    line(0.075, -0.075, white, i => bendy[i] === 0 && (i * course.step) % 10 < 5);
    // speed-reduction bars across the lane edges before every hairpin (one direction of travel: the lane on the left)
    for (const turn of layout.turns) {
        if (!turn.hairpin) continue;
        const s1 = turn.from * course.step - 8;
        for (let k = 0; k < 9; k++) {
            const s = s1 - k * (2.2 + k * 0.5);
            for (const lat of [EDGE.line - 0.6, 0.55]) paint.push(colourise(bar(course, s, lat, 0.6, 0.3), white));
        }
    }
    const wear = paintWear();
    const paintMaterial = ownSurface(ctx, null, { roughness: 0.55, vertexColors: true, alphaTest: 0.5 });
    paintMaterial.map = wear;
    paintMaterial.polygonOffset = true;
    paintMaterial.polygonOffsetFactor = -1;
    paintMaterial.polygonOffsetUnits = -2;
    if (ctx.quality !== 'low') {
        paintMaterial.normalMap = ctx.textures.asphalt({ wet: false }).normalMap;
        paintMaterial.normalScale.set(0.45, 0.45);
    }
    const paintMesh = new THREE.Mesh(mergeGeometries(paint), paintMaterial);
    paintMesh.receiveShadow = true;
    root.add(paintMesh);

    // ---- raised reflective studs: amber on the centre line every 8 m, white along the edge lines in the bends
    const centreStuds = [];
    const edgeStuds = [];
    for (let s = 3; s < course.length; s += 8) centreStuds.push(studAt(course, s, 0));
    for (let s = 1; s < course.length; s += 6) {
        const p = course.at(s);
        if (Math.abs(p.k) < 1 / 70) continue;
        edgeStuds.push(studAt(course, s, EDGE.line - 0.3), studAt(course, s, -EDGE.line + 0.3));
    }
    const studGeometry = new THREE.BoxGeometry(0.13, 0.022, 0.1).translate(0, 0.011, 0);
    addInstances(root, studGeometry, retroMaterial(0xffb22e, 7, { base: 0.1, near: 12, far: 85 }), centreStuds);
    addInstances(root, studGeometry.clone(), retroMaterial(0xf2f4ff, 6, { base: 0.1, near: 12, far: 85 }), edgeStuds);

    // ---- the concrete L-gutter (mountain side) and the gravel shoulder (valley side), with catch basins in the gutter
    const gutterLat = [EDGE.asphalt, 5.78, EDGE.foot];
    const gutterY = [0.03, -0.025, 0.05];
    const shoulderLat = [EDGE.asphalt, 6.1, EDGE.shoulder];
    const shoulderY = [0.0, -0.03, -0.08];
    for (const sign of [1, -1]) {
        const isMountain = i => layout.side[i] === sign;
        const gutter = stripGeometry(course, 3, (i, c, out) => {
            out.lat = gutterLat[c] * sign;
            out.y = y(i) + gutterY[c];
        }, { step: 1, keep: isMountain });
        const shoulder = stripGeometry(course, 3, (i, c, out) => {
            out.lat = shoulderLat[c] * sign;
            out.y = y(i) + shoulderY[c];
        }, { step: 1, keep: i => !isMountain(i) || !isMountain(course.wrap(i + 1)) || !isMountain(course.wrap(i - 1)) });
        for (const [g, material] of [[gutter, materials.concrete({ color: 0xb6b2aa, seams: false })], [shoulder, materials.ground({ kind: 'gravel', color: 0x9a948a })]]) {
            if (!g) continue;
            if (sign < 0) flip(g);
            const mesh = new THREE.Mesh(g, material);
            mesh.receiveShadow = true;
            root.add(mesh);
        }
    }
    const grates = [];
    for (let s = 12; s < course.length; s += 24) {
        const p = course.at(s);
        if (!layout.side[p.index]) continue;
        const lat = 5.81 * layout.side[p.index];
        grates.push({ x: p.x + p.tz * lat, y: p.y - 0.005, z: p.z - p.tx * lat, yaw: Math.atan2(p.tx, p.tz) });
    }
    addInstances(root, new THREE.BoxGeometry(0.5, 0.04, 0.62), materials.metal({ color: 0x3a3a3c, roughness: 0.6 }), grates);

    // ---- black marks: rubber of earlier drifters through the hairpins, sealed cracks
    buildMarks(ctx, layout, random);
}

/** UVs in metres along the road: u = the lateral offset, v = s. */
function alongUv(course, lats) {
    return (i, c, out, k) => {
        out.u = lats[c];
        out.v = k * course.step;
    };
}

function colourise(geometry, colour) {
    const count = geometry.attributes.position.count;
    const array = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) array.set([colour.r, colour.g, colour.b], k * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
    return geometry;
}

function flip(geometry) {
    const index = geometry.index.array;
    for (let k = 0; k < index.length; k += 3) {
        const t = index[k + 1];
        index[k + 1] = index[k + 2];
        index[k + 2] = t;
    }
    geometry.computeVertexNormals();
}

/** A painted bar across the road at s, centred at lateral lat (width across, depth along). */
function bar(course, s, lat, width, depth) {
    const p = course.at(s);
    const g = new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(p.tx, p.tz));
    const x = p.x + p.tz * lat;
    const z = p.z - p.tx * lat;
    g.translate(x, p.y + 0.02 + 0.025 * (1 - Math.abs(lat) / EDGE.asphalt) + 0.009, z);
    // the wear texture in metres across the bar
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * width + lat, uv.getY(k) * depth + s);
    return g;
}

function studAt(course, s, lat) {
    const p = course.at(s);
    return { x: p.x + p.tz * lat, y: p.y + 0.02 + 0.025 * (1 - Math.abs(lat) / EDGE.asphalt), z: p.z - p.tx * lat, yaw: Math.atan2(p.tx, p.tz) };
}

/** One InstancedMesh of geometry at spots [{ x, y, z, yaw, scale? }]. */
export function addInstances(root, geometry, material, spots, { shadow = false } = {}) {
    if (!spots.length) {
        geometry.dispose();
        return null;
    }
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    spots.forEach((spot, k) => {
        q.setFromAxisAngle(up, spot.yaw ?? 0);
        if (spot.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spot.tilt));
        const scale = spot.scale ?? 1;
        mesh.setMatrixAt(k, m.compose(p.set(spot.x, spot.y, spot.z), q, s.set(spot.sx ?? scale, spot.sy ?? scale, spot.sz ?? scale)));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    root.add(mesh);
    return mesh;
}

/** The worn paint: white with the aggregate showing through, tyre-polished stretches and faded patches (alpha cut at 0.5); 2 m × 16 m. */
function paintWear() {
    const random = rng(77);
    const texture = canvasTexture(128, 1024, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        // grime and faded tone
        for (let k = 0; k < 900; k++) {
            const v = 200 + random() * 55;
            c.fillStyle = `rgba(${v},${v},${v - 6},0.5)`;
            c.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 6);
        }
        // holes where the aggregate shows through (alpha out)
        c.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 2600; k++) {
            c.fillStyle = `rgba(0,0,0,${0.55 + random() * 0.45})`;
            const r = 0.6 + random() * 1.8;
            c.beginPath();
            c.arc(random() * w, random() * h, r, 0, Math.PI * 2);
            c.fill();
        }
        // worn stretches: long faded blotches
        for (let k = 0; k < 26; k++) {
            const x = random() * w;
            const y0 = random() * h;
            const length = 20 + random() * 120;
            for (let j = 0; j < length; j += 2) {
                c.fillStyle = `rgba(0,0,0,${0.25 + random() * 0.4})`;
                c.fillRect(x + (random() - 0.5) * 10, y0 + j, 2 + random() * 6, 3);
            }
        }
        c.globalCompositeOperation = 'source-over';
    }, { repeat: true });
    texture.repeat.set(1 / 2, 1 / 16);
    return texture;
}

/** The rubber of earlier drifters through the hairpins and sealed cracks: one transparent black mesh. */
function buildMarks(ctx, layout, random) {
    const { root, course } = ctx;
    const geometries = [];
    const markY = (y, lat) => y + 0.02 + 0.025 * (1 - Math.min(1, Math.abs(lat) / EDGE.asphalt)) + 0.011;
    // a ribbon along s0..s1 following lateral(s), width w; u across 0..1, v along (m / 6)
    const ribbon = (s0, s1, lateral, w, fade = 6) => {
        const positions = [];
        const uvs = [];
        const colours = [];
        const indices = [];
        let rows = 0;
        for (let s = s0; s <= s1; s += 1.5) {
            const p = course.at(s);
            const lat = lateral(s);
            const t = Math.min(1, (s - s0) / fade, (s1 - s) / fade);
            for (const side of [-0.5, 0.5]) {
                const l = lat + side * w;
                positions.push(p.x + p.tz * l, markY(p.y, l), p.z - p.tx * l);
                uvs.push(side + 0.5, s / 6);
                colours.push(t, t, t);
            }
            if (rows > 0) {
                const a = (rows - 1) * 2;
                indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
            rows++;
        }
        if (rows < 2) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        geometries.push(g);
    };
    // drift lines: outside at the entry, clipping the inside at the apex, wide at the exit; rear tyres 1.5 m apart, several cars
    for (const turn of layout.turns) {
        const sharp = turn.radius < 30;
        if (!sharp) continue;
        const sA = turn.from * course.step;
        const sApex = turn.apex * course.step;
        const sB = turn.to * course.step + (turn.to < turn.from ? course.length : 0);
        const sets = turn.hairpin ? 5 : 2;
        for (let m = 0; m < sets; m++) {
            const outside = -turn.dir * (2.6 + random() * 1.6);
            const inside = turn.dir * (1.6 + random() * 2.2);
            const entry = sA - 18 - random() * 14;
            const exit = sB + 12 + random() * 18;
            const apex = sApex + (random() - 0.5) * 6;
            const lateral = s => {
                if (s < apex) {
                    const t = smooth01((s - entry) / (apex - entry));
                    return outside + (inside - outside) * t;
                }
                const t = smooth01((s - apex) / (exit - apex));
                return inside + (outside * 1.1 - inside) * t;
            };
            const start = entry + random() * 10;
            const end = exit - random() * 10;
            const wobble = random() * 10;
            for (const o of [-0.78, 0.78]) {
                ribbon(start, end, s => lateral(s) + o + Math.sin(s * 0.21 + wobble) * 0.08, 0.2 + random() * 0.08, 8);
            }
        }
    }
    // sealed cracks: thin wavy lines along the lanes and across (not on low)
    for (let s = 20; ctx.quality !== 'low' && s < course.length - 30; s += 35 + random() * 60) {
        const lat0 = (random() - 0.5) * 8;
        const length = 6 + random() * 18;
        const phase = random() * 6;
        ribbon(s, s + length, t => lat0 + Math.sin(t * 0.7 + phase) * 0.35 + Math.sin(t * 2.3) * 0.08, 0.05, 1);
    }
    if (!geometries.length) return;
    const random2 = rng(91);
    // rubber: dense streaks along the ribbon, soft edges, a slow change of strength along it (no breaks)
    const texture = canvasTexture(64, 512, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        for (let k = 0; k < 220; k++) {
            const x = w * (0.08 + random2() * 0.84);
            c.fillStyle = `rgba(255,255,255,${0.05 + random2() * 0.16})`;
            c.fillRect(x, 0, 1 + random2() * 3, h);
        }
        const fade = c.createLinearGradient(0, 0, 0, h);
        for (let k = 0; k <= 8; k++) fade.addColorStop(k / 8, `rgba(0,0,0,${k % 8 === 0 ? 0.2 : 0.05 + random2() * 0.4})`);
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = fade;
        c.fillRect(0, 0, w, h);
        const edge = c.createLinearGradient(0, 0, w, 0);
        edge.addColorStop(0, 'rgba(0,0,0,1)');
        edge.addColorStop(0.2, 'rgba(0,0,0,0)');
        edge.addColorStop(0.8, 'rgba(0,0,0,0)');
        edge.addColorStop(1, 'rgba(0,0,0,1)');
        c.fillStyle = edge;
        c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'source-over';
    }, { repeat: true });
    const material = new THREE.MeshBasicMaterial({
        color: 0x020202,
        map: texture,
        vertexColors: false,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
    });
    // the vertex colour fades the ends: used as alpha
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying float vFade;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = color.r;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vFade;')
            .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vFade;');
    };
    material.customProgramCacheKey = () => 'pass-marks';
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.renderOrder = 1;
    root.add(mesh);
}

function smooth01(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}
