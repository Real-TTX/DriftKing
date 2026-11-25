// DriftKing · maps/harbor-water.js – the harbour basin of Kaikō-Docks: dark water with gentle waves (a procedural, tileable wave normal map
// sampled twice and drifting, so the reflections of the sky and the reflection map move; specular anti-aliasing against glitter in the
// distance) and the long broken reflections of the lights on it (quads that stretch from the mirror point of each lamp towards the viewer,
// rippling – the classic night-harbour look, without a second render of the scene). Low: the old flat water, the streaks in display colours.

import * as THREE from 'three';

/** The water surface's own wave normal map (tileable, tile metres), made once per world (freed with it). */
function waveNormals(size, seed = 7) {
    // a sum of sine waves with integer wave vectors (tileable), mostly along the wind (from the south-west), amplitude falling with frequency
    let s = seed >>> 0;
    const random = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
    const waves = [];
    for (let k = 0; k < 28; k++) {
        const f = 1 + Math.floor(Math.pow(random(), 1.6) * 14);
        const angle = 0.6 + (random() - 0.5) * 2.2;
        const kx = Math.round(Math.cos(angle) * f);
        const ky = Math.round(Math.sin(angle) * f);
        if (kx === 0 && ky === 0) continue;
        const amplitude = 1 / Math.pow(Math.hypot(kx, ky), 1.35);
        waves.push({ kx, ky, amplitude, phase: random() * Math.PI * 2 });
    }
    const data = new Uint8Array(size * size * 4);
    const tau = Math.PI * 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let dx = 0;
            let dy = 0;
            const u = x / size;
            const v = y / size;
            for (const w of waves) {
                const c = Math.cos(tau * (w.kx * u + w.ky * v) + w.phase) * w.amplitude * tau;
                dx += c * w.kx;
                dy += c * w.ky;
            }
            // slope scale: steep enough to break the reflections, the material's normalScale tunes it
            const nx = -dx * 0.018;
            const ny = -dy * 0.018;
            const length = Math.hypot(nx, ny, 1);
            const i = (y * size + x) * 4;
            data[i] = Math.round((nx / length * 0.5 + 0.5) * 255);
            data[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
            data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
}

const WAVE_TILE = 13;

// two drifting samples of the wave map instead of one; then specular anti-aliasing (the screen-space variance of the normal widens the lobe)
const WATER_NORMAL = /* glsl */ `
    #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 waveA = texture2D( normalMap, vNormalMapUv + waterTime * vec2( 0.0071, 0.0043 ) ).xyz * 2.0 - 1.0;
        vec3 waveB = texture2D( normalMap, vNormalMapUv * 2.37 + vec2( 0.31, 0.77 ) + waterTime * vec2( -0.0093, 0.0121 ) ).xyz * 2.0 - 1.0;
        vec3 mapN = normalize( vec3( waveA.xy + waveB.xy * 0.6, waveA.z * waveB.z ) );
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
        vec3 waterDx = dFdx( normal );
        vec3 waterDy = dFdy( normal );
        roughnessFactor = clamp( sqrt( roughnessFactor * roughnessFactor + min( 0.5 * ( dot( waterDx, waterDx ) + dot( waterDy, waterDy ) ), 0.18 ) ), 0.0, 1.0 );
    #endif`;

/**
 * The sky as the water sees it: a small equirectangular HDR picture of the palette's gradient – horizon haze, the city's light dome, the dusk
 * afterglow towards the set sun, the dark far shore below the horizon – so the basin mirrors the open sky above it (the scene's reflection
 * map is seen from the middle of the yard, walled in by containers; three turns this one into a PMREM on first use; freed with the water).
 */
function skyReflection(palette) {
    const width = 128;
    const height = 64;
    const data = new Uint16Array(width * height * 4);
    const c = hex => new THREE.Color(hex);
    const top = c(palette.top);
    const mid = c(palette.mid);
    const horizon = c(palette.horizon);
    const pollution = c(palette.pollution);
    const dome = c(palette.dome);
    const afterglow = c(palette.afterglow);
    const below = c(palette.fog).multiplyScalar(0.35);
    // the set sun of world/env.js (west-north-west, just below the horizon)
    const sun = new THREE.Vector2(-0.85, 0.52).normalize();
    const out = new THREE.Color();
    const tmp = new THREE.Color();
    const smooth = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    for (let j = 0; j < height; j++) {
        const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
        const h = Math.sin(elevation);
        const hp = Math.max(h, 0);
        for (let i = 0; i < width; i++) {
            const azimuth = ((i + 0.5) / width - 0.5) * Math.PI * 2;
            const dx = Math.cos(azimuth);
            const dz = Math.sin(azimuth);
            out.copy(horizon).lerp(mid, smooth(0, 0.25, hp));
            out.lerp(top, smooth(0.2, 0.85, hp));
            out.add(tmp.copy(pollution).multiplyScalar(Math.exp(-hp * 9)));
            out.add(tmp.copy(dome).multiplyScalar(Math.exp(-hp * 3) * 0.5));
            const toSun = Math.max(dx * sun.x + dz * sun.y, 0);
            out.add(tmp.copy(afterglow).multiplyScalar(Math.pow(toSun, 4) * Math.exp(-hp * 6) + Math.pow(toSun, 1.5) * Math.exp(-hp * 2) * 0.25));
            if (h < 0) out.lerp(below, smooth(0, -0.08, h));
            const k = (j * width + i) * 4;
            data[k] = THREE.DataUtils.toHalfFloat(out.r);
            data[k + 1] = THREE.DataUtils.toHalfFloat(out.g);
            data[k + 2] = THREE.DataUtils.toHalfFloat(out.b);
            data[k + 3] = THREE.DataUtils.toHalfFloat(1);
        }
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/**
 * The water plane (centre x/z, size w × d at height y). Medium/high: a glossy dielectric with drifting waves mirroring the open sky;
 * low: the flat dark water of the low-poly look. Returns { mesh, update(dt) }.
 */
export function buildWater(root, quality, { x, y, z, w, d, palette, colour = 0x0b1a22 }) {
    const geometry = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    // uvs in metres (the wave tile repeats on the texture)
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    let material;
    const time = { value: 0 };
    if (quality === 'low') {
        material = new THREE.MeshLambertMaterial({ color: 0x0a1424, emissive: 0x050a18 });
    } else {
        const normalMap = waveNormals(quality === 'high' ? 512 : 256);
        normalMap.repeat.set(1 / WAVE_TILE, 1 / WAVE_TILE);
        material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.05, metalness: 0, normalMap, envMap: skyReflection(palette), envMapIntensity: 1 });
        material.normalScale.set(0.28, 0.28);
        material.onBeforeCompile = shader => {
            shader.uniforms.waterTime = time;
            shader.fragmentShader = 'uniform float waterTime;\n' + shader.fragmentShader.replace('#include <normal_fragment_maps>', WATER_NORMAL);
        };
        material.customProgramCacheKey = () => 'harbor-water';
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.name = 'HarborWater';
    root.add(mesh);
    return {
        mesh,
        update(dt) {
            time.value = (time.value + dt) % 10000;
        },
    };
}

const STREAK_VERTEX = /* glsl */ `
    attribute vec3 source;
    attribute vec3 tint;
    attribute vec3 tintLinear;
    attribute vec2 shape;
    uniform float waterY;
    uniform float fogFar;
    uniform float minZ;
    varying vec2 vQuad;
    varying vec3 vTint;
    varying float vFade;
    void main() {
        float hc = max(cameraPosition.y - waterY, 0.3);
        float hl = max(source.y - waterY, 0.2);
        vec2 toLight = source.xz - cameraPosition.xz;
        float dist = max(length(toLight), 0.001);
        vec2 dir = toLight / dist;
        // where the mirror image of the lamp is seen; waves smear it towards and away from the viewer, more the farther it is
        vec2 mirror = cameraPosition.xz + toLight * (hc / (hc + hl));
        float len = shape.y * (1.5 + dist * 0.16);
        vec2 side = vec2(-dir.y, dir.x);
        vec2 p = mirror + side * position.x * shape.x + dir * position.y * len;
        vQuad = position.xy;
        #ifdef TONE_MAPPING
            vTint = tint;
        #else
            vTint = tintLinear;
        #endif
        vec4 mv = viewMatrix * vec4(p.x, waterY + 0.04, p.y, 1.0);
        vFade = clamp(1.0 - (-mv.z) / fogFar, 0.0, 1.0) * step(minZ, mirror.y);
        gl_Position = projectionMatrix * mv;
    }`;

const STREAK_FRAGMENT = /* glsl */ `
    uniform float time;
    uniform float gain;
    varying vec2 vQuad;
    varying vec3 vTint;
    varying float vFade;
    void main() {
        // narrower towards both ends, fading along; broken into glints by the ripples (a fixed number of irregular bands per streak, drifting)
        float y = vQuad.y;
        float across = exp(-vQuad.x * vQuad.x * 3.5 * (1.0 + abs(y) * 1.5));
        float along = 1.0 - smoothstep(0.1, 1.0, abs(y));
        float ripple = sin(y * 23.0 + time * 1.7) * 0.5 + sin(y * 41.0 - time * 2.3 + vQuad.x * 3.0) * 0.35 + sin(y * 9.0 + time * 0.8) * 0.4;
        float broken = clamp(0.55 + ripple * 0.7, 0.0, 1.0);
        float a = across * along * broken * vFade * gain;
        // straight to the canvas (low): the display colour as it is; into the HDR target: the colour decoded on the CPU (docs/RENDERING.md §9)
        gl_FragColor = vec4(vTint * a, 1.0);
    }`;

/**
 * The reflections of lamps on the water: add(x, y, z, colour, { width, length, strength }), then build(root) – one instanced draw.
 * The streaks are hidden where their mirror point would lie on land (z < minZ).
 */
export class WaterStreaks {
    constructor({ waterY, minZ, fogFar }) {
        this.waterY = waterY;
        this.minZ = minZ;
        this.fogFar = fogFar;
        this.items = [];
        this.time = { value: 0 };
    }

    add(x, y, z, colour, { width = 0.9, length = 1, strength = 1 } = {}) {
        this.items.push({ x, y, z, colour: new THREE.Color(colour), width, length, strength });
    }

    /** The mesh (null without streaks). */
    build(root) {
        const n = this.items.length;
        if (n === 0) return null;
        const geometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(2, 2);
        geometry.index = quad.index;
        geometry.setAttribute('position', quad.attributes.position);
        const source = new Float32Array(n * 3);
        const tint = new Float32Array(n * 3);
        const tintLinear = new Float32Array(n * 3);
        const shape = new Float32Array(n * 2);
        const display = new THREE.Color();
        this.items.forEach((s, k) => {
            source.set([s.x, s.y, s.z], k * 3);
            // the colour as displayed (sRGB values) for low, the linear one for the HDR chain
            display.copy(s.colour).convertLinearToSRGB();
            tint.set([display.r * s.strength, display.g * s.strength, display.b * s.strength], k * 3);
            tintLinear.set([s.colour.r * s.strength * 1.6, s.colour.g * s.strength * 1.6, s.colour.b * s.strength * 1.6], k * 3);
            shape.set([s.width, s.length], k * 2);
        });
        geometry.setAttribute('source', new THREE.InstancedBufferAttribute(source, 3));
        geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
        geometry.setAttribute('tintLinear', new THREE.InstancedBufferAttribute(tintLinear, 3));
        geometry.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 2));
        geometry.instanceCount = n;
        const material = new THREE.ShaderMaterial({
            uniforms: {
                waterY: { value: this.waterY },
                fogFar: { value: this.fogFar },
                minZ: { value: this.minZ },
                time: this.time,
                gain: { value: 1 },
            },
            vertexShader: STREAK_VERTEX,
            fragmentShader: STREAK_FRAGMENT,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        mesh.name = 'WaterStreaks';
        root.add(mesh);
        return mesh;
    }

    update(dt) {
        this.time.value = (this.time.value + dt) % 10000;
    }
}
