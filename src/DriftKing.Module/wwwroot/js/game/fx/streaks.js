// DriftKing · fx/streaks.js – the cars' lamps mirrored in the wet road: every tail light (and a headlight that faces the camera) draws a soft
// streak on the asphalt from below the lamp towards the camera, brightest at the mirror point (where the angle down to the road equals the angle
// up to the lamp) and stretched by the rough water film – the red streaks under the cars ahead are what a wet night street looks like. There is no
// screen-space reflection (docs/RENDERING.md §12); like maps/city-fx.js for the lamps of the city, but moving with the cars, one instanced
// additive draw call. Medium/high only (the PBR road is wet there; low keeps its flat road and pays nothing).

import * as THREE from 'three';
import { carMounts, CULL_GLSL, DISPLAY_GLSL } from './common.js';

const VERTEX = /* glsl */ `
    attribute vec4 foot;      // x, z below the lamp, height of the lamp above the road, road height
    attribute vec4 tint;      // linear colour × strength, w width (m)
    uniform float exposure;
    varying vec2 vUv;
    varying float vMirror;
    varying vec2 vWorld;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    ${DISPLAY_GLSL}
    ${CULL_GLSL}
    void main() {
        vec2 toCamera = cameraPosition.xz - foot.xy;
        float distance = length(toCamera);
        vec2 dir = toCamera / max(distance, 1e-3);
        vec2 side = vec2(-dir.y, dir.x);
        float cameraHeight = max(cameraPosition.y - foot.w, 0.3);
        float mirror = distance * foot.z / (foot.z + cameraHeight);
        float start = max(0.0, mirror * 0.35 - 0.15);
        float end = min(distance - 1.2, mirror + (distance - mirror) * 0.42);
        float fade = (1.0 - smoothstep(45.0, 80.0, distance)) * smoothstep(2.5, 6.0, distance);
        if (fade <= 0.0 || end <= start || dot(tint.rgb, vec3(1.0)) <= 0.0) {
            gl_Position = FX_HIDDEN;
            return;
        }
        float t = position.y + 0.5;
        float along = mix(start, end, t);
        vec2 p = foot.xy + dir * along + side * position.x * tint.w * mix(0.8, 1.9, t);
        vUv = vec2(position.x * 2.0, t);
        vMirror = (mirror - start) / max(end - start, 1e-3);
        vWorld = p;
        vLinear = tint.rgb * fade;
        vDisplay = fxDisplay(vLinear, exposure);
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, foot.w, p.y, 1.0);
    }`;

const FRAGMENT = /* glsl */ `
    varying vec2 vUv;
    varying float vMirror;
    varying vec2 vWorld;
    varying vec3 vLinear;
    varying vec3 vDisplay;
    void main() {
        float across = exp(-vUv.x * vUv.x * 3.0);
        float d = vUv.y - vMirror;
        float along = d < 0.0 ? exp(-d * d * 30.0) : exp(-d * 3.2) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
        // the water film breaks the reflection into wavering bands
        float ripple = 0.7 + 0.3 * sin(vWorld.x * 3.1 + vWorld.y * 2.4) * sin(vWorld.x * 0.9 - vWorld.y * 3.6);
        float k = across * along * ripple;
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(vDisplay * k, 1.0);
        #else
            gl_FragColor = vec4(vLinear * k, 1.0);
        #endif
    }`;

const TAIL = new THREE.Color(0xff1a14);
const HEAD = new THREE.Color(0xfff1df);
const v = new THREE.Vector3();
const toEye = new THREE.Vector3();
const back = new THREE.Vector3();

/** The reflections of all cars' lamps in a wet road. */
export class LampStreaks {
    /**
     * @param {number} cars how many cars at most
     * @param {{ wetness?: number, exposure?: number }} [options] wetness 0..1 of the road (how bright the reflections are)
     */
    constructor(cars, { wetness = 0.4, exposure = 1.3 } = {}) {
        this.capacity = cars * 4;
        this.wetness = wetness;
        this.cars = new Map();
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        this.feet = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.tints = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('foot', this.feet);
        geometry.setAttribute('tint', this.tints);
        geometry.instanceCount = 0;
        this.attributes = [this.feet, this.tints];
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: { exposure: { value: exposure } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
        }));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.mesh.visible = false;
    }

    /**
     * Once per frame after the cars are placed.
     * @param {THREE.Vector3} eye the camera position
     * @param {Iterable<{ model: THREE.Object3D, braking: boolean }>} cars
     */
    update(eye, cars) {
        const feet = this.feet.array;
        const tints = this.tints.array;
        let n = 0;
        for (const { model, braking } of cars) {
            if (!model.parent || !model.visible || n + 4 > this.capacity) continue;
            let mounts = this.cars.get(model);
            if (!mounts) this.cars.set(model, (mounts = carMounts(model)));
            model.updateMatrix();
            const m = model.matrix;
            const road = model.position.y;
            back.set(0, 0, -1).transformDirection(m);
            for (const lamp of mounts.tail) {
                v.set(lamp.x, lamp.y, lamp.z).applyMatrix4(m);
                // a tail light shines backwards: its reflection is seen from behind
                const facing = Math.max(0, toEye.set(eye.x - v.x, 0, eye.z - v.z).normalize().dot(back));
                const k = (braking ? 1.6 : 0.65) * this.wetness * (0.06 + 0.94 * facing * Math.sqrt(facing));
                n = this.put(feet, tints, n, v, road, TAIL, k, 0.26);
            }
            for (const lamp of mounts.head) {
                v.set(lamp.x, lamp.y, lamp.z).applyMatrix4(m);
                // a headlight shines forwards: only seen when the car faces the camera
                const facing = Math.max(0, -toEye.set(eye.x - v.x, 0, eye.z - v.z).normalize().dot(back));
                const k = 3 * this.wetness * facing * facing;
                if (k > 0.01) n = this.put(feet, tints, n, v, road, HEAD, k, 0.34);
            }
        }
        this.mesh.visible = n > 0;
        this.mesh.geometry.instanceCount = n;
        if (n === 0) return;
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, n * 4);
            attribute.needsUpdate = true;
        }
    }

    put(feet, tints, n, at, road, colour, strength, width) {
        if (n >= this.capacity) return n;
        feet[n * 4] = at.x;
        feet[n * 4 + 1] = at.z;
        feet[n * 4 + 2] = Math.max(0.2, at.y - road);
        feet[n * 4 + 3] = road + 0.04;
        tints[n * 4] = colour.r * strength;
        tints[n * 4 + 1] = colour.g * strength;
        tints[n * 4 + 2] = colour.b * strength;
        tints[n * 4 + 3] = width;
        return n + 1;
    }

    /** Forgets a car (it left the run). */
    forget(model) {
        this.cars.delete(model);
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
