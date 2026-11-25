// DriftKing · world/props-markings.js – the decals of a road: worn paint lines (edge lines, the centre line solid or dashed, lane lines on wide
// roads), the darker wheel paths and the oil line in the middle of each lane, sealed cracks, and black drift marks through the corners.
// Two merged meshes per road: the paint (lit, alpha blended) and the darkening (an unlit multiply pass – grime and rubber darken whatever
// light lies on the asphalt, at the cost of one texture fetch). One shared RGBA atlas, colours and alpha per vertex. Dimensions: lines 0.15 m,
// rural centre dashes 3 m / gaps 6 m, lane lines 5 m / 5 m (docs/RENDERING.md §11).

import * as THREE from 'three';
import { rng } from '../render/kit.js';
import { maxAnisotropy } from '../render/device.js';
import { isPbr, materialsOf, ownMaterial } from './props-common.js';

/** The atlas columns (u ranges of a quarter each): worn paint, a soft grime band, a tyre mark, a sealed crack. */
const COLUMN = Object.freeze({ paint: 0, grime: 1, skid: 2, seam: 3 });
/** One repeat of the atlas along the road, in metres. */
const ATLAS_LENGTH = 8;
const PAD = 3 / 256;

let atlas = null;

/**
 * The decal atlas (shared for the life of the page, 256 × 1024): white RGB everywhere (the colour comes from the vertices, so mip-mapping
 * never darkens a fringe) and the coverage in alpha; tiles along v (8 m).
 */
export function decalAtlas() {
    if (atlas) return atlas;
    const w = 256;
    const h = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    const random = rng(907);
    // draws fn at y and, near the ends, one period up or down (the atlas tiles along v)
    const wrap = (y, r, fn) => {
        fn(y);
        if (y - r < 0) fn(y + h);
        if (y + r > h) fn(y - h);
    };
    const blob = (x, y, rx, ry, alpha) => wrap(y, ry, yy => {
        const g = c.createRadialGradient(x, yy, 0, x, yy, Math.max(rx, ry));
        g.addColorStop(0, `rgba(0,0,0,${alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.save();
        c.translate(x, yy);
        c.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
        c.translate(-x, -yy);
        c.fillStyle = g;
        c.fillRect(x - Math.max(rx, ry), yy - Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
        c.restore();
    });

    // paint: full coverage with soft edges, then the wear erased: aggregate showing through, worn patches, cracks running across
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(3, 0, 58, h);
    c.fillStyle = '#fff';
    c.fillRect(5, 0, 54, h);
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 5200; k++) {
        c.fillStyle = `rgba(0,0,0,${0.25 + random() * 0.6})`;
        c.fillRect(3 + random() * 58, random() * h, 1 + random() * 1.5, 1 + random() * 2);
    }
    for (let k = 0; k < 70; k++) blob(4 + random() * 56, random() * h, 3 + random() * 9, 6 + random() * 30, 0.35 + random() * 0.55);
    for (let k = 0; k < 9; k++) {
        const y = random() * h;
        c.strokeStyle = `rgba(0,0,0,${0.6 + random() * 0.4})`;
        c.lineWidth = 1 + random() * 1.5;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 8; x <= 64; x += 8) c.lineTo(x, y + (random() - 0.5) * 10);
        c.stroke();
    }

    // grime: a soft band (a gaussian across), broken up along the road
    c.globalCompositeOperation = 'source-over';
    for (let x = 0; x < 64; x++) {
        const t = (x - 31.5) / 18;
        c.fillStyle = `rgba(255,255,255,${(0.85 * Math.exp(-t * t)).toFixed(3)})`;
        c.fillRect(64 + x, 0, 1, h);
    }
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 90; k++) blob(64 + random() * 64, random() * h, 8 + random() * 20, 20 + random() * 60, 0.2 + random() * 0.45);
    for (let k = 0; k < 2400; k++) {
        c.fillStyle = `rgba(0,0,0,${0.2 + random() * 0.4})`;
        c.fillRect(64 + random() * 64, random() * h, 1, 1 + random() * 3);
    }

    // tyre mark: the tread as streaks along the road, a darker core, fading and coming back
    c.globalCompositeOperation = 'source-over';
    for (let x = 0; x < 64; x++) {
        const t = (x - 31.5) / 26;
        c.fillStyle = `rgba(255,255,255,${(0.55 * Math.max(0, 1 - t * t * t * t)).toFixed(3)})`;
        c.fillRect(128 + x, 0, 1, h);
    }
    for (let k = 0; k < 14; k++) {
        const x = 132 + random() * 56;
        c.fillStyle = `rgba(255,255,255,${0.3 + random() * 0.5})`;
        c.fillRect(x, 0, 1 + random() * 3, h);
    }
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 40; k++) blob(128 + random() * 64, random() * h, 20 + random() * 20, 30 + random() * 80, 0.15 + random() * 0.4);

    // sealed crack: a meandering tar line with a few branches
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    let x = 224;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x, 0);
    for (let y = 16; y <= h; y += 16) {
        x = y === h ? 224 : Math.max(206, Math.min(242, x + (random() - 0.5) * 12));
        c.lineTo(x, y);
    }
    c.stroke();
    for (let k = 0; k < 6; k++) {
        const y0 = 40 + random() * (h - 120);
        c.lineWidth = 2 + random() * 2;
        c.beginPath();
        c.moveTo(224, y0);
        c.lineTo(224 + (random() - 0.5) * 50, y0 + 20 + random() * 50);
        c.stroke();
    }

    const pixels = c.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h * 4);
    const tone = rng(911);
    // texture rows run bottom-up; the atlas tiles along v, so the flip does not matter – copy the alpha, make the colour white with specks
    for (let i = 0; i < w * h; i++) {
        const v = 255 - Math.floor(tone() * tone() * 60);
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = pixels[i * 4 + 3];
    }
    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, maxAnisotropy());
    texture.needsUpdate = true;
    texture.userData.shared = true;
    texture.name = 'road-decals';
    atlas = texture;
    return atlas;
}

/** Collects decal strips along a course and builds them into one geometry (position, normal, uv, rgba colour). */
class DecalStrips {
    constructor(course, lift) {
        this.course = course;
        this.lift = lift;
        this.positions = [];
        this.uvs = [];
        this.colors = [];
        this.indices = [];
        this.at = {};
    }

    /**
     * A strip from s0 to s1 (metres along the course, may pass the start), centred at a lateral offset (> 0 left; a number or a function of
     * t = 0..1 along the strip) with a half width, in an atlas column, colour × alpha (fading in and out over `fade` metres).
     * transverse: the strip runs across the road (the atlas' v runs across, u along s).
     */
    strip(s0, s1, centre, half, column, colour, alpha, { fade = 0, v0 = 0, transverse = false } = {}) {
        const course = this.course;
        const length = s1 - s0;
        if (length <= 0) return;
        // the samples: dense in corners and over crests, up to 4 m apart on straights (the chord stays within ~1.5 cm of the road)
        const samples = [s0];
        for (let s = s0; s < s1;) {
            const i = course.at(s, this.at).index;
            const bend = Math.abs(course.k[i]);
            const crest = Math.abs(course.slope[(i + 1) % course.count] - course.slope[i]) / course.step;
            const ds = Math.max(course.step, Math.min(4, Math.sqrt(0.12 / Math.max(bend, 1e-5)), Math.sqrt(0.12 / Math.max(crest, 1e-5))));
            s = Math.min(s1, s + ds);
            samples.push(s);
        }
        const n = samples.length - 1;
        const base = this.positions.length / 3;
        const c = new THREE.Color(colour);
        const u0 = column / 4 + PAD;
        const u1 = (column + 1) / 4 - PAD;
        for (let k = 0; k <= n; k++) {
            const s = samples[k];
            const t = (s - s0) / length;
            const p = course.at(s, this.at);
            const lx = p.tz;
            const lz = -p.tx;
            const mid = typeof centre === 'function' ? centre(t) : centre;
            const y = p.y + this.lift;
            this.positions.push(p.x + lx * (mid + half), y, p.z + lz * (mid + half), p.x + lx * (mid - half), y, p.z + lz * (mid - half));
            if (transverse) {
                const u = u0 + (u1 - u0) * t;
                this.uvs.push(u, v0, u, v0 + (half * 2) / ATLAS_LENGTH);
            } else {
                const v = v0 + (s - s0) / ATLAS_LENGTH;
                this.uvs.push(u0, v, u1, v);
            }
            let a = alpha;
            if (fade > 0) a *= Math.min(1, (s - s0) / fade, (s1 - s) / fade);
            this.colors.push(c.r, c.g, c.b, a, c.r, c.g, c.b, a);
            if (k < n) {
                const i = base + k * 2;
                this.indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
            }
        }
    }

    /** The merged geometry (null when empty). */
    build() {
        if (this.indices.length === 0) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 4));
        g.setIndex(this.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
    }
}

// the darkening pass: result = destination × mix(1, colour, alpha) – unlit, so grime and rubber darken the asphalt under every light alike.
// It writes a multiplier, not a colour: straight to the canvas (low) the destination is display-referred, so the factor is encoded once
// (§9: no tone mapping of a multiplier); in fog it fades back to 1.
const MULTIPLY_VERTEX = /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    varying vec2 vUv;
    varying vec4 vColor;
    void main() {
        vUv = uv;
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }`;

const MULTIPLY_FRAGMENT = /* glsl */ `
    uniform sampler2D map;
    #include <common>
    #include <fog_pars_fragment>
    varying vec2 vUv;
    varying vec4 vColor;
    void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vColor.a;
        #ifdef USE_FOG
            #ifdef FOG_EXP2
                a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
                a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
            #endif
        #endif
        vec3 factor = mix(vec3(1.0), vColor.rgb * t.rgb, a);
        #ifdef TONE_MAPPING
            factor = pow(factor, vec3(0.4545));
        #endif
        gl_FragColor = vec4(factor, 1.0);
    }`;

/** The material of the darkening decals (owned by the mesh). */
function multiplyMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
        vertexShader: MULTIPLY_VERTEX,
        fragmentShader: MULTIPLY_FRAGMENT,
        vertexColors: true,
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
    });
}

/** Lighter colours of road paint (sRGB): what a spec's colour strings mean. */
const PAINT = { white: 0xdcdad2, yellow: 0xe0a92e };

/** A paint colour from a spec value ('#rrggbb', a number, 'white' / 'yellow'); yellowish inputs become road yellow, everything else white. */
function paintColour(value) {
    if (value === 'yellow') return PAINT.yellow;
    if (value === 'white' || value === true) return PAINT.white;
    const c = new THREE.Color(value);
    return c.b < c.r * 0.6 ? PAINT.yellow : PAINT.white;
}

/**
 * The decals of a road along a course, as a Group of up to two meshes (null when the spec asks for nothing).
 * spec: centre (colour of the centre line or null), centreStyle 'dashed' | 'solid' | 'double' (default: dashed when white, solid when yellow),
 * edges (true / a colour / false: solid edge lines edgeInset (default 0.25) m inside the edge), lanes (lanes per direction, default 2 from 13 m width, else 1),
 * laneLines (default: when centre or edges are on), wear 0..1 (how worn the paint is), grime (wheel paths, oil line, sealed cracks; default true), skids 0..1 (drift marks in corners; default 1),
 * seed. options: materials (the factory), lift (metres above the course, default 0.032), wet 0..1 (glossier paint).
 * @returns {THREE.Group|null}
 */
export function buildRoadMarkings(course, spec = {}, options = {}) {
    const mats = materialsOf(options);
    const { lift = 0.032, wet = 0 } = options;
    const {
        centre = '#e9e6dc',
        edges = true,
        wear = 0.5,
        grime = true,
        skids = 1,
        seed = 3,
        width = 0.15,
        extra = 0,
    } = spec;
    const random = rng(seed * 7919 + 17);
    const half = course.width / 2 + extra;
    const lanes = spec.lanes ?? (course.width >= 13 ? 2 : 1);
    const L = course.length;
    const paintStrips = new DecalStrips(course, lift);
    const darkStrips = new DecalStrips(course, lift - 0.002);
    const lineAlpha = 1 - wear * 0.35;
    const w = width / 2;
    // a solid line around the whole course (pieces of 40–80 m, each with its own wear and a slightly different shade)
    const solid = (offset, colour) => {
        let s = 0;
        while (s < L) {
            const next = Math.min(L, s + 40 + random() * 40);
            paintStrips.strip(s, next, offset, w, COLUMN.paint, colour, lineAlpha * (0.85 + random() * 0.15), { v0: random() * 4 });
            s = next;
        }
    };
    const dashed = (offset, colour, dash, gap) => {
        for (let s = 0; s + dash <= L; s += dash + gap) {
            paintStrips.strip(s, s + dash, offset, w, COLUMN.paint, colour, lineAlpha * (0.75 + random() * 0.25), { v0: random() * 4 });
        }
    };
    if (edges) {
        const colour = paintColour(edges);
        const inset = spec.edgeInset ?? 0.25;
        solid(half - inset - w, colour);
        solid(-half + inset + w, colour);
    }
    if (centre) {
        const colour = paintColour(centre);
        const style = spec.centreStyle ?? (colour === PAINT.yellow ? 'solid' : 'dashed');
        if (style === 'double') {
            solid(w + 0.08, colour);
            solid(-w - 0.08, colour);
        } else if (style === 'solid') {
            solid(0, colour);
        } else {
            dashed(0, colour, spec.dash ?? 3, spec.gap ?? 6);
        }
    }
    // lane lines on wide roads: white dashes 5 m / 5 m between the lanes of one direction (not when the map paints its own lines:
    // centre and edges both off – then lanes only place the wheel paths – unless laneLines asks for them)
    const laneWidth = (half - 0.25) / lanes;
    const laneLines = spec.laneLines ?? (Boolean(centre) || Boolean(edges));
    for (let k = 1; k < lanes && laneLines; k++) {
        for (const side of [1, -1]) dashed(side * laneWidth * k, PAINT.white, 5, 5);
    }

    if (grime) {
        // every lane: two wheel paths (track 1.5 m) and the oil line between them, in pieces with gaps
        for (const side of [1, -1]) {
            for (let k = 0; k < lanes; k++) {
                const middle = side * laneWidth * (k + 0.5);
                for (const offset of [-0.78, 0.78, 0]) {
                    const oil = offset === 0;
                    let s = random() * 20;
                    while (s < L) {
                        const piece = 30 + random() * 90;
                        const end = Math.min(L, s + piece);
                        darkStrips.strip(s, end, middle + offset + (random() - 0.5) * 0.12, oil ? 0.22 : 0.42, COLUMN.grime,
                            oil ? 0x2a2622 : 0x34343a, (oil ? 0.42 : 0.32) * (0.7 + random() * 0.3), { fade: 6, v0: random() * 4 });
                        s = end + random() * 25;
                    }
                }
            }
        }
        // sealed cracks: one along the paving joint near the centre on some stretches, a few across the road
        let s = random() * 60;
        while (s < L) {
            const piece = 15 + random() * 45;
            darkStrips.strip(s, Math.min(L, s + piece), 0.35 + (random() - 0.5) * 0.2, 0.09, COLUMN.seam, 0x15151a, 0.8, { fade: 1, v0: random() * 4 });
            s += piece + 40 + random() * 120;
        }
        for (let t = random() * 40; t < L; t += 25 + random() * 70) {
            darkStrips.strip(t, t + 0.18, 0, half - 0.1, COLUMN.seam, 0x15151a, 0.75, { transverse: true, v0: random() * 4 });
        }
    }

    if (skids > 0) {
        // drift marks: through every corner (radius < 90 m) a few pairs of black arcs – outside at the entry, inside at the apex, out again
        const corners = [];
        let start = -1;
        for (let i = 0; i <= course.count; i++) {
            const k = i < course.count ? course.k[i] : 0;
            if (Math.abs(k) > 1 / 90 && start < 0) start = i;
            if ((Math.abs(k) <= 1 / 90 || i === course.count) && start >= 0) {
                if (i - start > 4) corners.push({ s0: start * course.step, s1: i * course.step, k: course.k[Math.floor((start + i) / 2)] });
                start = -1;
            }
        }
        const reach = half - 1.2;
        for (const corner of corners) {
            const outside = corner.k > 0 ? -1 : 1;
            const pairs = Math.max(1, Math.round((1 + random() * 3) * skids));
            for (let n = 0; n < pairs; n++) {
                const s0 = corner.s0 - 12 - random() * 14;
                const s1 = corner.s1 + 6 + random() * 14;
                const amplitude = reach * (0.55 + random() * 0.45);
                const shift = (random() - 0.5) * 1.2;
                const phase = (random() - 0.5) * 0.25;
                const line = t => outside * amplitude * Math.cos(Math.PI * 2 * Math.min(1, Math.max(0, t + phase * Math.sin(Math.PI * t)))) + shift;
                const alpha = (0.45 + random() * 0.4) * Math.min(1, skids);
                const colour = 0x0f0f12;
                const fade = 8 + random() * 8;
                // the rear tyres of a car going sideways: two marks ~1.5 m apart, each a little wavy
                for (const tyre of [-0.76, 0.76]) {
                    const wobble = random() * 6;
                    darkStrips.strip(s0, s1, t => line(t) + tyre + Math.sin(t * 9 + wobble) * 0.06, 0.13, COLUMN.skid, colour, alpha, { fade, v0: random() * 4 });
                }
            }
        }
    }

    const group = new THREE.Group();
    group.name = 'road-decals';
    const map = decalAtlas();
    const paintGeometry = paintStrips.build();
    if (paintGeometry) {
        const material = ownMaterial(mats, {
            map,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -6,
            ...(isPbr(mats) ? { roughness: 0.62 - wet * 0.35 } : {}),
        });
        const mesh = new THREE.Mesh(paintGeometry, material);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        group.add(mesh);
    }
    const darkGeometry = darkStrips.build();
    if (darkGeometry) {
        const material = multiplyMaterial();
        material.uniforms.map.value = map;
        const mesh = new THREE.Mesh(darkGeometry, material);
        mesh.renderOrder = 0;
        group.add(mesh);
    }
    return group.children.length ? group : null;
}
