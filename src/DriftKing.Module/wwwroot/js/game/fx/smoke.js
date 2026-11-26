// DriftKing · fx/smoke.js – tyre smoke: a pool of soft puffs in one instanced draw call. A puff is born small and dense at the tyre, billows up
// fast, then spreads slowly, rises a little, is carried by the car and a light breeze and thins out as it grows. The puffs are cloudy shapes
// (fx/textures.js, four in an atlas, turned and slowly spinning), soft where they meet the road and near the camera, and lit like the scene
// around them (fx/lighting.js, on the CPU per puff: the night fill, lamps, every car's head-, tail- and brake lights and underglow, brighter
// against the light); medium/high add a lighter top and a denser, darker core per pixel and draw them back to front.
// Without a lighting (the menu backdrop) the puffs take the given colour, as before. The output follows docs/RENDERING.md §9 (#ifdef TONE_MAPPING).

import * as THREE from 'three';
import { settings } from '../settings.js';
import { smokeAtlas } from './textures.js';
import { CULL_GLSL, DISPLAY_GLSL } from './common.js';

const VERTEX = /* glsl */ `
    attribute vec4 place;    // xyz centre, w radius
    attribute vec4 shape;    // x opacity, y turn, z ground height, w atlas cell 0..3
    attribute vec3 tint;     // linear light towards the camera × albedo
    uniform float fogFar;
    uniform float exposure;
    uniform float nearFade;
    uniform float focusDepth;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying float vAlpha;
    varying float vHeight;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    ${DISPLAY_GLSL}
    ${CULL_GLSL}
    void main() {
        float radius = place.w;
        vec4 mv = modelViewMatrix * vec4(place.xyz, 1.0);
        float depth = -mv.z;
        // far puffs fade with the fog; puffs right at the lens fade out (no screen-filling blobs, less overdraw)
        float alpha = shape.x * clamp(1.0 - depth / fogFar, 0.0, 1.0) * smoothstep(nearFade * 0.5, nearFade + radius * 1.2, depth);
        // between the camera and the followed car the smoke is thinner: the car stays in view
        alpha *= mix(0.55, 1.0, smoothstep(focusDepth - 2.5, focusDepth + 0.5, depth));
        if (alpha < 0.002) {
            gl_Position = FX_HIDDEN;
            return;
        }
        float c = cos(shape.y);
        float s = sin(shape.y);
        vec2 corner = position.xy;
        vec2 turned = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
        mv.xy += turned * radius;
        vLocal = turned;
        vUv = (corner * 0.5 + 0.5) * 0.5 + vec2(mod(shape.w, 2.0), floor(shape.w * 0.5)) * 0.5;
        // the height of this corner above the puff's ground (the road): the fragment fades it in from the road up
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float y = place.y + (right.y * turned.x + up.y * turned.y) * radius;
        vHeight = (y - shape.z) / max(0.3, radius * 0.6);
        vAlpha = alpha;
        vLinear = tint;
        vDisplay = fxDisplay(tint, exposure);
        gl_Position = projectionMatrix * mv;
    }`;

const FRAGMENT = /* glsl */ `
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying float vAlpha;
    varying float vHeight;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    void main() {
        vec4 texel = texture2D(map, vUv);
        float density = texel.a;
        float a = density * vAlpha * smoothstep(0.0, 1.0, vHeight);
        if (a < 0.003) discard;
        #ifdef SHADED
            // a volume lit from above: the light that comes through the cloud from its top (fx/textures.js), a little fill from around
            float shade = mix(0.5, 1.18, texel.r) + 0.08 * vLocal.y;
        #else
            float shade = 1.0;
        #endif
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(vDisplay * shade, a);
        #else
            gl_FragColor = vec4(vLinear * shade, a);
        #endif
    }`;

/** The albedo of tyre smoke (linear): a light, slightly cool grey. */
const ALBEDO = { r: 0.66, g: 0.66, b: 0.7 };
/**
 * The light a puff may take before it is compressed (linear, before the albedo): from KNEE up it rolls off softly towards LIMIT. A puff in the
 * beam of a car close behind (backlit, forward scattering) still glows white, but as a lit cloud, not as a burning ball that hides the car.
 */
const KNEE = 0.7;
const LIMIT = 2.2;
/** A light breeze (m/s) that carries the old smoke away. */
const WIND = { x: 0.45, z: 0.25 };

/** The smoke of a run. emit() puffs, update() moves them (once per frame). */
export class Smoke {
    /**
     * @param {number} capacity how many puffs at most (low ~120, medium ~260, high ~420)
     * @param {{ colour?: THREE.ColorRepresentation, fogFar?: number, lighting?: import('./lighting.js').FxLighting|null, exposure?: number,
     *           quality?: string }} [options] colour: the colour of unlit smoke (no lighting given, as displayed); lighting: light the puffs like the scene
     */
    constructor(capacity, { colour = 0xb9b8cc, fogFar = 400, lighting = null, exposure = 1.3, quality = settings.get().quality } = {}) {
        this.capacity = capacity;
        this.lighting = lighting;
        this.shaded = quality !== 'low';
        this.next = 0;
        this.alive = 0;
        this.particles = Array.from({ length: capacity }, () => ({
            life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r0: 0.5, grow: 2, radius: 0.5, peak: 0, alpha: 0,
            turn: 0, spin: 0, ground: 0, cell: 0, r: 0, g: 0, b: 0, depth: 0,
        }));
        this.order = [];
        this.refresh = 0;
        this.eye = new THREE.Vector3();
        this.view = new THREE.Vector3(0, 0, -1);
        this.hasEye = false;
        this.box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
        this.light = { r: 0, g: 0, b: 0 };
        // without a lighting the puffs keep one colour: the given display colour, decoded once for the linear path
        const unlit = new THREE.Color(colour).convertSRGBToLinear();
        this.unlit = { r: unlit.r * 0.75, g: unlit.g * 0.75, b: unlit.b * 0.75 };
        this.byDepth = (a, b) => this.particles[b].depth - this.particles[a].depth;
        /** The car the camera follows (optional, a Vector3): smoke between it and the camera is drawn thinner. */
        this.focus = null;

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.places = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.tints = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('place', this.places);
        geometry.setAttribute('shape', this.shapes);
        geometry.setAttribute('tint', this.tints);
        geometry.instanceCount = 0;
        this.attributes = [this.places, this.shapes, this.tints];
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: {
                map: { value: smokeAtlas(quality === 'low' ? 64 : 128) },
                fogFar: { value: fogFar },
                exposure: { value: exposure },
                nearFade: { value: 2.0 },
                focusDepth: { value: 0 },
            },
            defines: this.shaded ? { SHADED: '' } : {},
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            transparent: true,
            depthWrite: false,
        }));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 8;
        this.mesh.visible = false;
        // the camera of the last frame (the backdrop does not pass one): for the sorting, the near fade and the light's phase
        this.mesh.onBeforeRender = (renderer, scene, camera) => this.setEye(camera);
    }

    /** The camera this frame (run.js passes it before update; otherwise the one of the last render is used). */
    setEye(camera) {
        this.eye.setFromMatrixPosition(camera.matrixWorld);
        camera.getWorldDirection(this.view);
        this.hasEye = true;
    }

    /**
     * A puff at (x, y, z) – y about 0.35 m above the road, as car/vehicle.js emits – moving with (vx, vz), starting size and strength 0..1
     * (the slip). ground: the road height (default y − 0.35).
     */
    emit(x, y, z, vx, vz, size, strength, ground = y - 0.35) {
        // a free puff or one at the end of its life; when the pool is full of young smoke the new puff is skipped (no popping)
        let index = -1;
        for (let k = 0; k < 6; k++) {
            const i = (this.next + k) % this.capacity;
            const q = this.particles[i];
            if (q.age >= q.life || q.age > q.life * 0.72) {
                index = i;
                break;
            }
        }
        if (index < 0) {
            this.next = (this.next + 1) % this.capacity;
            return;
        }
        this.next = (index + 1) % this.capacity;
        const p = this.particles[index];
        const s = Math.min(1, Math.max(0, strength));
        p.life = (1.5 + s * 2.6) * (0.85 + Math.random() * 0.3);
        p.age = 0;
        p.x = x + (Math.random() - 0.5) * 0.3;
        p.y = y - 0.1;
        p.z = z + (Math.random() - 0.5) * 0.3;
        p.vx = vx * 0.4 + (Math.random() - 0.5) * 1.4;
        p.vy = 0.35 + Math.random() * 0.45;
        p.vz = vz * 0.4 + (Math.random() - 0.5) * 1.4;
        p.r0 = size * (0.7 + Math.random() * 0.35);
        p.grow = (1.3 + s * 2.1) * (0.8 + Math.random() * 0.4);
        p.radius = p.r0;
        p.peak = 0.24 + s * 0.42;
        p.alpha = 0;
        // turned a little only: the atlas is lit from above
        p.turn = (Math.random() - 0.5) * 0.8;
        p.spin = (Math.random() - 0.5) * 0.35;
        p.ground = ground;
        p.cell = Math.floor(Math.random() * 4);
        this.lightUp(p);
    }

    /** The colour of a puff: the light around it × the albedo (or the unlit colour). */
    lightUp(p) {
        if (!this.lighting) {
            p.r = this.unlit.r;
            p.g = this.unlit.g;
            p.b = this.unlit.b;
            return;
        }
        const l = this.lighting.sample(p.x, p.y, p.z, this.light, p.radius);
        const peak = Math.max(l.r, l.g, l.b);
        // the hue stays, only the strength is compressed
        const k = peak > KNEE ? (KNEE + (peak - KNEE) / (1 + (peak - KNEE) / (LIMIT - KNEE))) / peak : 1;
        p.r = l.r * k * ALBEDO.r;
        p.g = l.g * k * ALBEDO.g;
        p.b = l.b * k * ALBEDO.b;
    }

    /**
     * Moves the puffs (once per frame).
     * @param {number} dt
     * @param {THREE.Camera} [camera] the camera of this frame (else the one of the last render)
     */
    update(dt, camera = null) {
        if (camera) this.setEye(camera);
        const list = this.particles;
        const order = this.order;
        order.length = 0;
        const box = this.box;
        box.minX = box.minY = box.minZ = Infinity;
        box.maxX = box.maxY = box.maxZ = -Infinity;
        const drag = Math.exp(-dt * 1.5);
        const rise = Math.exp(-dt * 0.9);
        for (let k = 0; k < this.capacity; k++) {
            const p = list[k];
            if (p.age >= p.life) continue;
            p.age += dt;
            if (p.age >= p.life) continue;
            const t = p.age / p.life;
            // the air slows the puff to the breeze; it rises a little and slows down
            p.vx = WIND.x + (p.vx - WIND.x) * drag;
            p.vz = WIND.z + (p.vz - WIND.z) * drag;
            p.vy = 0.18 + (p.vy - 0.18) * rise;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            // billows fast, then spreads slowly; the bottom rolls along the road
            const grown = 1 - Math.pow(1 - t, 2.4);
            p.radius = p.r0 + p.grow * grown;
            p.y = Math.max(p.y, p.ground + p.radius * 0.42);
            p.turn += p.spin * dt * (1 - t);
            // dense at the tyre, thinner as it spreads (the same smoke in more air), gone at the end
            const fadeIn = Math.min(1, t / 0.06);
            const fadeOut = Math.pow(1 - t, 1.4);
            p.alpha = p.peak * fadeIn * fadeOut * Math.pow((p.r0 + 0.5) / (p.radius + 0.5), 0.6);
            order.push(k);
            if (p.x - p.radius < box.minX) box.minX = p.x - p.radius;
            if (p.y - p.radius < box.minY) box.minY = p.y - p.radius;
            if (p.z - p.radius < box.minZ) box.minZ = p.z - p.radius;
            if (p.x + p.radius > box.maxX) box.maxX = p.x + p.radius;
            if (p.y + p.radius > box.maxY) box.maxY = p.y + p.radius;
            if (p.z + p.radius > box.maxZ) box.maxZ = p.z + p.radius;
        }
        this.alive = order.length;
        this.mesh.visible = order.length > 0;
        this.mesh.geometry.instanceCount = order.length;
        if (order.length === 0) return;
        // the light: every puff every third frame (it moves slowly; the lamps of the frame are picked once)
        if (this.lighting) {
            this.lighting.prepare(this.eye, box);
            this.refresh = (this.refresh + 1) % 3;
            for (let n = this.refresh; n < order.length; n += 3) this.lightUp(list[order[n]]);
        }
        const f = this.focus;
        this.mesh.material.uniforms.focusDepth.value = f && this.hasEye
            ? (f.x - this.eye.x) * this.view.x + (f.y - this.eye.y) * this.view.y + (f.z - this.eye.z) * this.view.z : 0;
        // back to front (medium/high): the puffs blend in the right order
        if (this.shaded && this.hasEye) {
            const e = this.eye;
            const v = this.view;
            for (const k of order) {
                const p = list[k];
                p.depth = (p.x - e.x) * v.x + (p.y - e.y) * v.y + (p.z - e.z) * v.z;
            }
            order.sort(this.byDepth);
        }
        const places = this.places.array;
        const shapes = this.shapes.array;
        const tints = this.tints.array;
        for (let n = 0; n < order.length; n++) {
            const p = list[order[n]];
            places[n * 4] = p.x;
            places[n * 4 + 1] = p.y;
            places[n * 4 + 2] = p.z;
            places[n * 4 + 3] = p.radius;
            shapes[n * 4] = p.alpha;
            shapes[n * 4 + 1] = p.turn;
            shapes[n * 4 + 2] = p.ground;
            shapes[n * 4 + 3] = p.cell;
            tints[n * 3] = p.r;
            tints[n * 3 + 1] = p.g;
            tints[n * 3 + 2] = p.b;
        }
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, order.length * attribute.itemSize);
            attribute.needsUpdate = true;
        }
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
