// DriftKing · render/kit.js – the small modelling kit of the low-poly look: merging geometries (one draw call per material), canvas textures,
// the additive glow points (lamps, neon, lights without real lights) and the light pools on the ground, seeded randomness, disposal.

import * as THREE from 'three';

/** A seeded random generator (mulberry32): the same map looks the same on every client. */
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Merges indexed or non-indexed geometries (position, normal, uv, color) into one indexed BufferGeometry.
 * Missing uvs become 0, missing colours white. The input geometries are disposed.
 * @param {THREE.BufferGeometry[]} geometries
 */
export function mergeGeometries(geometries) {
    const withColor = geometries.some(g => g.attributes.color);
    let vertexCount = 0;
    let indexCount = 0;
    for (const g of geometries) {
        vertexCount += g.attributes.position.count;
        indexCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const color = withColor ? new Float32Array(vertexCount * 3).fill(1) : null;
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let v = 0;
    let i = 0;
    for (const g of geometries) {
        if (!g.attributes.normal) g.computeVertexNormals();
        const count = g.attributes.position.count;
        position.set(g.attributes.position.array.subarray(0, count * 3), v * 3);
        normal.set(g.attributes.normal.array.subarray(0, count * 3), v * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, count * 2), v * 2);
        if (color && g.attributes.color) color.set(g.attributes.color.array.subarray(0, count * 3), v * 3);
        if (g.index) {
            for (let k = 0; k < g.index.count; k++) index[i++] = g.index.array[k] + v;
        } else {
            for (let k = 0; k < count; k++) index[i++] = k + v;
        }
        v += count;
        g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (color) merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    merged.computeBoundingSphere();
    return merged;
}

/** Paints a whole geometry in one colour (vertex colours, for merged meshes with vertexColors). */
export function tint(geometry, hex) {
    const c = new THREE.Color(hex);
    const count = geometry.attributes.position.count;
    const array = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
        array[k * 3] = c.r;
        array[k * 3 + 1] = c.g;
        array[k * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
    return geometry;
}

/** A box placed in the world: centre (x, y, z), size (w, h, d), turned by rotY around the vertical. */
export function box(w, h, d, x, y, z, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return g;
}

/** A texture drawn on a canvas: draw(ctx, w, h). */
export function canvasTexture(width, height, draw, { repeat = false, srgb = true } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

const shared = new Map();

/** A texture shared by everyone for the life of the page (never disposed): radial glow, soft blob, smoke puff. */
export function sharedTexture(name) {
    if (shared.has(name)) return shared.get(name);
    let texture;
    if (name === 'glow') {
        texture = canvasTexture(128, 128, (ctx, w) => {
            const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
            g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, w);
        });
    } else if (name === 'pool') {
        texture = canvasTexture(128, 128, (ctx, w) => {
            const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
            g.addColorStop(0, 'rgba(255,255,255,0.9)');
            g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, w);
        });
    } else if (name === 'blob') {
        texture = canvasTexture(64, 64, (ctx, w) => {
            const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.1, w / 2, w / 2, w / 2);
            g.addColorStop(0, 'rgba(0,0,0,0.75)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, w);
        });
    } else if (name === 'beam') {
        // the headlight pool: bright near the car, long and fading forward (v = 0 at the car)
        texture = canvasTexture(64, 128, (ctx, w, h) => {
            for (let y = 0; y < h; y++) {
                const t = y / h;
                const a = Math.pow(1 - t, 1.6) * Math.min(1, t * 6);
                const g = ctx.createLinearGradient(0, 0, w, 0);
                g.addColorStop(0, 'rgba(255,255,255,0)');
                g.addColorStop(0.5, `rgba(255,255,255,${a})`);
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, h - 1 - y, w, 1);
            }
        });
    } else {
        throw new Error(`unknown shared texture ${name}`);
    }
    shared.set(name, texture);
    return texture;
}

const GLOW_VERTEX = /* glsl */ `
    attribute float size;
    attribute vec3 tint;
    varying vec3 vTint;
    varying float vFade;
    uniform float scale;
    uniform float fogFar;
    void main() {
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float distance = -mv.z;
        vFade = clamp(1.0 - distance / fogFar, 0.0, 1.0);
        gl_PointSize = size * scale / max(distance, 0.5);
        gl_Position = projectionMatrix * mv;
    }`;

const GLOW_FRAGMENT = /* glsl */ `
    uniform sampler2D map;
    uniform float intensity;
    varying vec3 vTint;
    varying float vFade;
    void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vTint * t.a * intensity * vFade, 1.0);
    }`;

/**
 * Collects additive glow points (street lamps, neon dots, reflectors) and makes one Points object of them – the "bloom" of the low-poly look.
 * add(x, y, z, size in metres, colour)
 */
export class GlowPoints {
    constructor() {
        this.positions = [];
        this.sizes = [];
        this.tints = [];
    }

    add(x, y, z, size, hex) {
        const c = new THREE.Color(hex);
        this.positions.push(x, y, z);
        this.sizes.push(size);
        this.tints.push(c.r, c.g, c.b);
    }

    /** The Points object (null when empty). fogFar: where the glows have faded out. */
    build({ fogFar = 900, intensity = 1 } = {}) {
        if (this.sizes.length === 0) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(this.sizes, 1));
        geometry.setAttribute('tint', new THREE.Float32BufferAttribute(this.tints, 3));
        const material = glowMaterial({ fogFar, intensity });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 5;
        return points;
    }
}

/** The material of glow points (shared shader; scale follows the window height). */
export function glowMaterial({ fogFar = 900, intensity = 1 } = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: sharedTexture('glow') },
            scale: { value: 600 },
            fogFar: { value: fogFar },
            intensity: { value: intensity },
        },
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
    });
    // the point size in pixels for "size" metres at 1 m distance: half the drawing buffer height / tan(fov/2), close enough for fov 60–75°
    material.onBeforeRender = (renderer, scene, camera) => {
        const height = renderer.getDrawingBufferSize(tmpSize).y;
        const fov = camera.isPerspectiveCamera ? camera.fov : 60;
        material.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    };
    return material;
}

const tmpSize = new THREE.Vector2();

/**
 * Light pools on the ground (lamps, neon, headlights of parked cars): additive discs, one InstancedMesh.
 * add(x, y, z, radius, colour, strength 0..1)
 */
export class LightPools {
    constructor() {
        this.items = [];
    }

    add(x, y, z, radius, hex, strength = 0.6) {
        this.items.push({ x, y, z, radius, color: new THREE.Color(hex).multiplyScalar(strength) });
    }

    build() {
        if (this.items.length === 0) return null;
        const geometry = new THREE.PlaneGeometry(2, 2);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
            map: sharedTexture('pool'),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            fog: true,
        });
        const mesh = new THREE.InstancedMesh(geometry, material, this.items.length);
        const m = new THREE.Matrix4();
        this.items.forEach((p, k) => {
            m.makeScale(p.radius, 1, p.radius).setPosition(p.x, p.y + 0.03, p.z);
            mesh.setMatrixAt(k, m);
            mesh.setColorAt(k, p.color);
        });
        mesh.renderOrder = 2;
        mesh.computeBoundingSphere();
        return mesh;
    }
}

/** Frees the geometries, materials and (not shared) textures of everything below root. */
export function disposeTree(root) {
    const sharedTextures = new Set(shared.values());
    root.traverse(object => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if (value?.isTexture && !sharedTextures.has(value)) value.dispose();
            }
            if (material.uniforms) {
                for (const u of Object.values(material.uniforms)) {
                    if (u.value?.isTexture && !sharedTextures.has(u.value)) u.value.dispose();
                }
            }
            material.dispose();
        }
        if (object.isInstancedMesh) object.dispose();
    });
}

/** Smooth step 0..1 between edge0 and edge1. */
export function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** Draws an invented glyph (brush strokes like a sign character, but no real writing) into a box of size s at (x, y). */
export function drawGlyph(ctx, random, x, y, s) {
    const strokes = 3 + Math.floor(random() * 4);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < strokes; k++) {
        const horizontal = random() < 0.5;
        ctx.beginPath();
        if (horizontal) {
            const yy = (0.15 + random() * 0.7) * s;
            const x0 = random() * 0.35 * s;
            const x1 = (0.65 + random() * 0.35) * s;
            ctx.moveTo(x0, yy);
            ctx.lineTo(x1, yy + (random() - 0.5) * 0.15 * s);
        } else {
            const xx = (0.15 + random() * 0.7) * s;
            const y0 = random() * 0.3 * s;
            const y1 = (0.6 + random() * 0.4) * s;
            ctx.moveTo(xx, y0);
            if (random() < 0.4) ctx.quadraticCurveTo(xx + (random() - 0.5) * 0.6 * s, (y0 + y1) / 2, xx + (random() - 0.5) * 0.5 * s, y1);
            else ctx.lineTo(xx, y1);
        }
        ctx.stroke();
    }
    ctx.restore();
}
