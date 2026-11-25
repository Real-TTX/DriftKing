// DriftKing · fx/flames.js – exhaust backfire: when the throttle snaps shut at high revs (and on a quick upshift or the rev limiter) the exhaust
// pops a short flame – blue at the pipe, yellow-white in the core, orange to the tip – and flashes the road behind the car. A few smaller
// crackles follow while the revs fall. Flames and flashes are additive HDR quads (the bloom of medium/high makes them burn), two instanced draw
// calls that are skipped while nothing burns. watch() reads a car's revs and throttle; the pipes come from the model's lightMounts.exhaust.

import * as THREE from 'three';
import { REDLINE_RPM } from '../car/physics.js';
import { carMounts, CULL_GLSL, DISPLAY_GLSL } from './common.js';

const FLAME_VERTEX = /* glsl */ `
    attribute vec4 tip;      // xyz the pipe's end, w length (m)
    attribute vec4 axis;     // xyz direction out of the pipe, w width (m)
    attribute vec2 burn;     // x brightness, y seed
    uniform vec2 resolution;
    uniform float time;
    varying vec2 vUv;
    varying float vBright;
    ${CULL_GLSL}
    void main() {
        mat4 viewProjection = projectionMatrix * viewMatrix;
        vec4 c0 = viewProjection * vec4(tip.xyz, 1.0);
        vec4 c1 = viewProjection * vec4(tip.xyz + axis.xyz * tip.w, 1.0);
        if (c0.w < 0.35 || c1.w < 0.35 || burn.x <= 0.0) {
            gl_Position = FX_HIDDEN;
            return;
        }
        vec2 s0 = c0.xy / c0.w * resolution;
        vec2 s1 = c1.xy / c1.w * resolution;
        vec2 along = s1 - s0;
        float span = length(along);
        along = span > 1e-3 ? along / span : vec2(0.0, 1.0);
        vec2 side = vec2(-along.y, along.x);
        float pixels = axis.w * projectionMatrix[1][1] * resolution.y / c0.w;
        // seen end-on the flame still shows as a round burst
        span = max(span, pixels * 1.8);
        vec2 screen = s0 + along * (position.x * span - pixels * 0.3) + side * position.y * pixels;
        gl_Position = vec4(screen / resolution * c0.w, c0.z, c0.w);
        vUv = position.xy;
        // it flickers
        float flicker = 0.78 + 0.22 * sin(time * 71.0 + burn.y * 40.0) * sin(time * 43.0 + burn.y * 17.0);
        vBright = burn.x * flicker;
    }`;

const FLAME_FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    varying float vBright;
    void main() {
        float u = vUv.x;
        float r = sin(min(1.0, u * 2.6 + 0.2) * 1.5708) * (1.0 - u * 0.7);
        float v = abs(vUv.y);
        float body = smoothstep(r, r * 0.2, v) * (1.0 - smoothstep(0.55, 1.0, u));
        float core = smoothstep(r * 0.6, 0.0, v) * (1.0 - smoothstep(0.1, 0.7, u));
        vec3 colour = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.64, 0.28), core);
        colour = mix(vec3(0.45, 0.6, 1.0), colour, smoothstep(0.0, 0.18, u));
        vec3 c = colour * (body * 0.6 + core * 1.4) * vBright;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(c / (1.0 + c), 1.0);
        #else
            gl_FragColor = vec4(c, 1.0);
        #endif
    }`;

const FLASH_VERTEX = /* glsl */ `
    attribute vec4 spot;     // xyz centre on the road, w radius
    attribute float glow;    // brightness
    uniform float exposure;
    varying vec2 vUv;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    ${DISPLAY_GLSL}
    ${CULL_GLSL}
    void main() {
        if (glow <= 0.0) {
            gl_Position = FX_HIDDEN;
            return;
        }
        vUv = position.xy;
        vec3 world = spot.xyz + vec3(position.x, 0.0, position.y) * spot.w;
        vec3 colour = vec3(1.0, 0.42, 0.1) * glow;
        vLinear = colour;
        vDisplay = fxDisplay(colour, exposure);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }`;

const FLASH_FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    void main() {
        float r2 = dot(vUv, vUv);
        float a = (1.0 - min(1.0, r2));
        a *= a;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(vDisplay, a);
        #else
            gl_FragColor = vec4(vLinear, a);
        #endif
    }`;

const tmp = new THREE.Vector3();
const axisTmp = new THREE.Vector3();

/** The backfires of a run: watch() every car each frame, update() once per frame. */
export class Backfires {
    /** @param {number} capacity flames at once (each pipe of a pop is one) */
    constructor(capacity = 16, { exposure = 1.3 } = {}) {
        this.capacity = capacity;
        this.next = 0;
        this.time = 0;
        this.flames = Array.from({ length: capacity }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, length: 0.4, width: 0.12, power: 0, seed: 0, ground: 0, model: null, mount: null }));
        this.states = new Map();
        this.group = new THREE.Group();
        this.group.name = 'Backfires';

        const flameGeometry = new THREE.InstancedBufferGeometry();
        flameGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
        flameGeometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.tips = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.axes = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.burns = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
        flameGeometry.setAttribute('tip', this.tips);
        flameGeometry.setAttribute('axis', this.axes);
        flameGeometry.setAttribute('burn', this.burns);
        flameGeometry.instanceCount = 0;
        const flameMaterial = new THREE.ShaderMaterial({
            uniforms: { resolution: { value: new THREE.Vector2(683, 384) }, time: { value: 0 } },
            vertexShader: FLAME_VERTEX,
            fragmentShader: FLAME_FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        this.flameMesh = new THREE.Mesh(flameGeometry, flameMaterial);
        const size = new THREE.Vector2();
        this.flameMesh.onBeforeRender = renderer => {
            renderer.getDrawingBufferSize(size);
            flameMaterial.uniforms.resolution.value.set(size.x * 0.5, size.y * 0.5);
        };

        const flashGeometry = new THREE.InstancedBufferGeometry();
        flashGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
        flashGeometry.setIndex([0, 2, 1, 0, 3, 2]);
        this.spots = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.glows = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
        flashGeometry.setAttribute('spot', this.spots);
        flashGeometry.setAttribute('glow', this.glows);
        flashGeometry.instanceCount = 0;
        this.flashMesh = new THREE.Mesh(flashGeometry, new THREE.ShaderMaterial({
            uniforms: { exposure: { value: exposure } },
            vertexShader: FLASH_VERTEX,
            fragmentShader: FLASH_FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        }));
        for (const mesh of [this.flameMesh, this.flashMesh]) {
            mesh.frustumCulled = false;
            mesh.visible = false;
            this.group.add(mesh);
        }
        this.flameMesh.renderOrder = 9;
        this.flashMesh.renderOrder = 2;
        this.attributes = [this.tips, this.axes, this.burns, this.spots, this.glows];
    }

    /**
     * Reads a car this frame and pops when it should. Returns the strength of a pop this frame (0 = none) – for the sound.
     * @param {THREE.Object3D} model the car model (placed this frame)
     * @param {{ rpm: number, gear: number }} physics
     * @param {{ throttle: number }|undefined} controls
     * @param {number} dt
     * @param {number} [eagerness] 0..1: how often this car pops (the own car more than a bot)
     */
    watch(model, physics, controls, dt, eagerness = 1) {
        let state = this.states.get(model);
        if (!state) {
            state = { throttle: 0, gear: physics.gear, crackle: 0, timer: 0, mounts: carMounts(model).exhaust, cool: 0 };
            this.states.set(model, state);
        }
        const throttle = controls?.throttle ?? 0;
        const revs = physics.rpm / REDLINE_RPM;
        let pop = 0;
        state.cool = Math.max(0, state.cool - dt);
        // the throttle snaps shut at high revs: a bang, then a crackle while the revs fall
        if (state.throttle > 0.6 && throttle < 0.2 && revs > 0.62 && state.cool <= 0 && Math.random() < 0.55 + 0.45 * eagerness) {
            pop = 0.65 + 0.35 * Math.min(1, (revs - 0.62) / 0.35);
            state.crackle = 0.35 + 0.5 * revs * eagerness;
            state.timer = 0.07 + Math.random() * 0.1;
            state.cool = 0.25;
        } else if (physics.gear > state.gear && revs > 0.55 && throttle > 0.5 && Math.random() < 0.6 * eagerness) {
            // a quick upshift
            pop = 0.5;
        } else if (revs > 1.0 && throttle > 0.8 && Math.random() < dt * 5 * eagerness) {
            // bouncing off the rev limiter
            pop = 0.35 + Math.random() * 0.2;
        } else if (state.crackle > 0) {
            state.crackle -= dt;
            state.timer -= dt;
            if (state.timer <= 0 && throttle < 0.3 && physics.rpm > 3200) {
                pop = 0.22 + Math.random() * 0.3;
                state.timer = 0.05 + Math.random() * 0.17;
            }
        }
        state.throttle = throttle;
        state.gear = physics.gear;
        if (pop > 0) this.pop(model, state.mounts, pop);
        return pop;
    }

    /** A pop of strength 0..1 out of every pipe of the model. */
    pop(model, mounts, strength) {
        for (const mount of mounts) {
            const f = this.flames[this.next];
            this.next = (this.next + 1) % this.capacity;
            f.life = 0.07 + strength * 0.09 + Math.random() * 0.04;
            f.age = 0;
            // the flame stays on its pipe while it burns (update places it from the car every frame)
            f.model = model;
            f.mount = mount;
            f.length = 0.22 + strength * (0.45 + Math.random() * 0.25);
            f.width = 0.07 + strength * 0.08;
            f.power = 3 + strength * 8;
            f.seed = Math.random();
        }
    }

    update(dt) {
        this.time += dt;
        this.flameMesh.material.uniforms.time.value = this.time;
        const tips = this.tips.array;
        const axes = this.axes.array;
        const burns = this.burns.array;
        const spots = this.spots.array;
        const glows = this.glows.array;
        let n = 0;
        for (const f of this.flames) {
            if (f.age >= f.life) continue;
            f.age += dt;
            if (f.age >= f.life) continue;
            const t = f.age / f.life;
            // at the pipe's end, out of it: backwards and a little down in the car's frame
            f.model.updateMatrix();
            const m = f.model.matrix;
            tmp.set(f.mount.x, f.mount.y, f.mount.z).applyMatrix4(m);
            axisTmp.set(0, -0.12, -1).transformDirection(m);
            f.x = tmp.x;
            f.y = tmp.y;
            f.z = tmp.z;
            f.dx = axisTmp.x;
            f.dy = axisTmp.y;
            f.dz = axisTmp.z;
            f.ground = f.model.position.y;
            // a burst: at once full, a short tail
            const envelope = t < 0.15 ? 1 : Math.pow(1 - (t - 0.15) / 0.85, 1.5);
            const grow = 0.6 + 0.4 * Math.min(1, t * 4);
            tips[n * 4] = f.x;
            tips[n * 4 + 1] = f.y;
            tips[n * 4 + 2] = f.z;
            tips[n * 4 + 3] = f.length * grow;
            axes[n * 4] = f.dx;
            axes[n * 4 + 1] = f.dy;
            axes[n * 4 + 2] = f.dz;
            axes[n * 4 + 3] = f.width;
            burns[n * 2] = f.power * envelope;
            burns[n * 2 + 1] = f.seed;
            spots[n * 4] = f.x + f.dx * f.length * 0.6;
            spots[n * 4 + 1] = f.ground + 0.04;
            spots[n * 4 + 2] = f.z + f.dz * f.length * 0.6;
            spots[n * 4 + 3] = 0.9 + f.length * 1.6;
            glows[n] = f.power * envelope * 0.05;
            n++;
        }
        this.flameMesh.visible = this.flashMesh.visible = n > 0;
        this.flameMesh.geometry.instanceCount = this.flashMesh.geometry.instanceCount = n;
        if (n === 0) return;
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, n * attribute.itemSize);
            attribute.needsUpdate = true;
        }
    }

    /** Forgets a car (it left the run). */
    forget(model) {
        this.states.delete(model);
        for (const f of this.flames) if (f.model === model) f.life = 0;
    }

    dispose() {
        this.group.removeFromParent();
        for (const mesh of [this.flameMesh, this.flashMesh]) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }
}
