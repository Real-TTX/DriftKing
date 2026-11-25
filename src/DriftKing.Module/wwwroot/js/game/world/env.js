// DriftKing · world/env.js – sky, fog and light of a map: a deep night sky with the light dome of the city (sodium orange low, violet higher),
// a slow cloud layer lit from below by the city, the moon with its halo, few small stars that fade towards the horizon and behind clouds;
// a hemisphere fill and the moon as the one directional light (medium/high; its shadow on high). Dusk: a blue hour with an orange afterglow.
// The palette also carries the reflection map kind, its intensity and the post settings of the time of day (exposure, bloom).

import * as THREE from 'three';
import { rng } from '../render/kit.js';
import { texturesFor } from '../render/textures.js';

/** The direction of the moon (from the viewer): the sky draws it there, the moon light comes from there. */
const MOON_DIR = new THREE.Vector3(-0.5, 0.55, -0.78).normalize();
/** The direction of the set sun at dusk (west-north-west, just below the horizon). */
const SUN_DIR = new THREE.Vector3(-0.85, -0.04, 0.52).normalize();

/**
 * The colours of a time of day (sRGB hex; the shader works in linear light).
 * top/mid/horizon: the sky gradient; pollution/dome: the city's light dome (low sodium, higher violet); cloudLit/cloudDark: the cloud underside
 * near the horizon / overhead; fog/fogNear/fogFar: linear fog (fogFar also bounds the glow sprites and smoke); hemi*: the fill light;
 * moon/moonPower: the directional light; envIntensity: scene.environmentIntensity; post: exposure and bloom of the stage.
 */
export const PALETTES = {
    night: {
        top: 0x020308, mid: 0x080b18, horizon: 0x2e2228, pollution: 0x6a3c22, dome: 0x1e1832, afterglow: 0x000000,
        cloudLit: 0x3c3030, cloudDark: 0x0c0d16, clouds: 0.5, moonDisc: 0xf2f0e8, moonGlow: 0x5a6a9a,
        fog: 0x1c1620, fogNear: 50, fogFar: 640,
        hemiSky: 0x5a63b8, hemiGround: 0x1c1820, hemi: 1.6, moon: 0x9fb4ff, moonPower: 0.35, stars: 1,
        envIntensity: 1, post: { exposure: 1.35, bloom: { strength: 0.6, radius: 0.55, threshold: 0.9 } },
    },
    dusk: {
        top: 0x0b1840, mid: 0x2a3270, horizon: 0xd86a3c, pollution: 0x8a4a2a, dome: 0x40306a, afterglow: 0xff7a3a,
        cloudLit: 0x9a5a5a, cloudDark: 0x2a2a52, clouds: 0.45, moonDisc: 0xffe8d0, moonGlow: 0x8a7aa0,
        fog: 0x4a3650, fogNear: 70, fogFar: 760,
        hemiSky: 0x7a7ad0, hemiGround: 0x2a1c22, hemi: 1.5, moon: 0xffb58a, moonPower: 0.6, stars: 0.3,
        envIntensity: 1, post: { exposure: 1.1, bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 } },
    },
};

// the smooth parts of the sky (gradient, the city's light dome, the afterglow) per vertex of a dense dome; the sharp ones (clouds, moon) per pixel.
// Low (SKY_DISPLAY, straight to the canvas): the dome is also tone-mapped and encoded per vertex with the cheap ACES fit of low
// (render/stage.js) and the moon is a small billboard (MOON_*) – the sky costs what the old flat gradient cost.
// The output path is picked when the sky is drawn, not when it is built: TONE_MAPPING (three defines it only for a draw straight to the
// canvas) → display values; otherwise linear light into the HDR target. So a sky built for low still reads right after a switch to
// medium/high, and one built for medium/high tone-maps itself after a switch to low (three compiles the second variant on demand).
const SKY_COMMON = /* glsl */ `
    #ifdef SKY_DISPLAY
        uniform float skyExposure;
        vec3 toDisplay(vec3 c) {
            c *= skyExposure * 0.8;
            c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
            return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
        }
    #endif`;

const SKY_VERTEX = /* glsl */ `
    uniform vec3 top;
    uniform vec3 mid;
    uniform vec3 horizon;
    uniform vec3 pollution;
    uniform vec3 dome;
    uniform vec3 afterglow;
    uniform vec3 sunDir;
    uniform vec3 below;
    varying vec3 vDir;
    varying vec3 vBase;
    ${SKY_COMMON}
    #ifdef SKY_DISPLAY
        varying vec3 vDisplay;
    #endif
    void main() {
        vec3 d = normalize(position);
        float h = d.y;
        float hp = max(h, 0.0);
        // the gradient: haze at the horizon, a deep blue-black overhead
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, hp));
        c = mix(c, top, smoothstep(0.2, 0.85, hp));
        // the light dome of the city: sodium orange low, violet higher
        c += pollution * exp(-hp * 9.0) + dome * exp(-hp * 3.0) * 0.5;
        // dusk: the afterglow above the set sun
        float toSun = max(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)), 0.0);
        c += afterglow * (pow(toSun, 4.0) * exp(-hp * 6.0) + pow(toSun, 1.5) * exp(-hp * 2.0) * 0.25);
        // below the horizon: the far ground in the haze (the fog colour)
        vBase = mix(c, below, smoothstep(0.0, -0.06, h));
        #ifdef SKY_DISPLAY
            vDisplay = toDisplay(vBase);
        #endif
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
    }`;

const SKY_FRAGMENT = /* glsl */ `
    uniform vec3 cloudLit;
    uniform vec3 cloudDark;
    uniform vec3 moonDisc;
    uniform vec3 moonGlow;
    uniform vec3 moonDir;
    uniform vec3 moonSide;
    uniform float clouds;
    uniform float time;
    uniform sampler2D noise;
    varying vec3 vDir;
    varying vec3 vBase;
    ${SKY_COMMON}
    #ifdef SKY_DISPLAY
        varying vec3 vDisplay;
    #endif

    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    // the moon in linear light: a wide halo, a tight glow and the disc (a soft edge, a little mottling); powers by repeated squaring
    vec3 moonLight(vec3 d, float m, float maria) {
        float m8 = m * m;
        m8 *= m8;
        m8 *= m8;
        float m64 = m8 * m8;
        m64 *= m64;
        m64 *= m64;
        float m1024 = m64 * m64;
        m1024 *= m1024;
        m1024 *= m1024;
        m1024 *= m1024;
        vec3 moon = moonGlow * (m1024 * 0.8 + m64 * 0.18 + m8 * 0.04);
        moon += moonDisc * (3.2 - maria * 1.4) * smoothstep(0.99992, 0.99994, m);
        return moon;
    }

    void main() {
        #ifdef SKY_DISPLAY
            // low: nothing per pixel (the moon is its own small billboard there)
            #ifdef TONE_MAPPING
                gl_FragColor = vec4(vDisplay, 1.0);
            #else
                // built for low, drawn into the HDR target after a quality switch (until the scene is rebuilt): linear light
                gl_FragColor = vec4(vBase, 1.0);
            #endif
        #else
            vec3 d = normalize(vDir);
            float m = max(dot(d, moonDir), 0.0);
            float hp = max(d.y, 0.0);
            vec3 c = vBase;
            float cover = 0.0;
            float maria = 0.4;
            #ifdef CLOUDS
                // clouds: a layer overhead, projected onto a plane; lit from below by the city (warm near the horizon), dark overhead
                vec2 uv = d.xz / (hp + 0.15) * 0.22 + vec2(time * 0.0016, time * 0.0007);
                float n = texture2D(noise, uv).r * 0.62 + texture2D(noise, uv * 3.1 + vec2(0.37, 0.11)).g * 0.28 + texture2D(noise, uv * 9.0).b * 0.1;
                cover = smoothstep(1.0 - clouds, 1.0 - clouds + 0.28, n) * smoothstep(0.0, 0.1, d.y);
                float m16 = m * m;
                m16 *= m16;
                m16 *= m16;
                m16 *= m16;
                vec3 cloud = mix(cloudLit, cloudDark, smoothstep(0.02, 0.55, hp));
                cloud += moonGlow * 0.6 * m16 * smoothstep(0.2, 0.9, n);
                c = mix(c, cloud, cover * 0.92);
                if (m > 0.9998) maria = texture2D(noise, vec2(dot(d, moonSide), d.y - moonDir.y) * 60.0 + 0.5).b;
            #endif
            // the moon, dimmed by the clouds
            c += moonLight(d, m, maria) * (1.0 - cover * 0.85);
            // dithering against banding (in linear light before the output encoding)
            c += (hash12(gl_FragCoord.xy) - 0.5) * 0.0025;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        #endif
    }`;

// the moon of low: a billboard on the far plane, added in display space (tone-mapped and encoded like the dome; slightly damped,
// since display values do not add up like light)
const MOON_VERTEX = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
    }`;

const MOON_FRAGMENT = /* glsl */ `
    uniform vec3 moonDisc;
    uniform vec3 moonGlow;
    uniform float halfAngle;
    varying vec2 vUv;
    ${SKY_COMMON}
    void main() {
        float a = length(vUv) * halfAngle;
        float a2 = a * a;
        vec3 light = moonGlow * (exp(-512.0 * a2) * 0.8 + exp(-30.0 * a2) * 0.18) + moonDisc * 2.6 * smoothstep(0.0125, 0.0105, a);
        float edge = smoothstep(1.0, 0.7, length(vUv));
        #ifdef TONE_MAPPING
            gl_FragColor = vec4(toDisplay(light) * 0.7 * edge, 1.0);
        #else
            // into the HDR target (a low-built sky after a quality switch): linear light, it adds up as light does
            gl_FragColor = vec4(light * edge, 1.0);
        #endif
    }`;

const STAR_VERTEX = /* glsl */ `
    attribute float size;
    attribute float brightness;
    uniform float pixelRatio;
    uniform float time;
    uniform float clouds;
    uniform sampler2D noise;
    varying float vAlpha;
    void main() {
        vec3 d = normalize(position);
        float hp = max(d.y, 0.0);
        #ifdef CLOUDS
            vec2 uv = d.xz / (hp + 0.15) * 0.22 + vec2(time * 0.0016, time * 0.0007);
            float n = texture2D(noise, uv).r * 0.62 + texture2D(noise, uv * 3.1 + vec2(0.37, 0.11)).g * 0.28;
            float cover = smoothstep(1.0 - clouds - 0.05, 1.0 - clouds + 0.2, n);
        #else
            float cover = 0.0;
        #endif
        // fewer stars near the horizon (haze, light pollution), a faint twinkle
        float twinkle = 0.85 + 0.15 * sin(time * (1.3 + brightness * 2.0) + position.x * 0.37);
        vAlpha = brightness * smoothstep(0.05, 0.45, d.y) * (1.0 - cover) * twinkle;
        gl_PointSize = size * pixelRatio;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
    }`;

const STAR_FRAGMENT = /* glsl */ `
    varying float vAlpha;
    void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(q)) * vAlpha;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

/**
 * Puts sky, stars, moon, fog and the lights into the scene.
 * @returns {{ moon: THREE.DirectionalLight, hemi: THREE.HemisphereLight, palette: object, sky: THREE.Mesh,
 *            follow(target: THREE.Vector3): void, update(dt: number, target: THREE.Vector3): void }}
 *          follow keeps the sky and the moon's shadow around the player; update also moves the clouds (world.update calls it)
 */
export function buildEnvironment(scene, { timeOfDay = 'night', quality = 'medium', seed = 7 } = {}) {
    const palette = PALETTES[timeOfDay] ?? PALETTES.night;
    scene.background = new THREE.Color(palette.top);
    scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);
    const noise = texturesFor(quality).macro().map;

    const color = hex => new THREE.Color(hex);
    const uniforms = {
        top: { value: color(palette.top) },
        mid: { value: color(palette.mid) },
        horizon: { value: color(palette.horizon) },
        pollution: { value: color(palette.pollution) },
        dome: { value: color(palette.dome) },
        afterglow: { value: color(palette.afterglow) },
        cloudLit: { value: color(palette.cloudLit) },
        cloudDark: { value: color(palette.cloudDark) },
        moonDisc: { value: color(palette.moonDisc) },
        moonGlow: { value: color(palette.moonGlow) },
        moonDir: { value: MOON_DIR.clone() },
        moonSide: { value: new THREE.Vector3().crossVectors(MOON_DIR, new THREE.Vector3(0, 1, 0)).normalize() },
        sunDir: { value: SUN_DIR.clone() },
        below: { value: color(palette.fog) },
        clouds: { value: quality === 'low' ? palette.clouds * 0.8 : palette.clouds },
        time: { value: (seed * 37) % 600 },
        noise: { value: noise },
        skyExposure: { value: 1 },
    };
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1000, 48, 48),
        new THREE.ShaderMaterial({
            uniforms,
            vertexShader: SKY_VERTEX,
            fragmentShader: SKY_FRAGMENT,
            defines: quality === 'low' ? { SKY_DISPLAY: '' } : { CLOUDS: '' },
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        }),
    );
    // drawn after the opaque geometry: it sits on the far plane (depth 1), so only the sky pixels that are really visible are shaded
    sky.renderOrder = 1000;
    sky.onBeforeRender = renderer => {
        uniforms.skyExposure.value = renderer.toneMappingExposure;
    };
    sky.frustumCulled = false;
    scene.add(sky);

    if (quality === 'low') {
        // the moon of low: a billboard in the moon's direction, a child of the dome (it follows the camera with it)
        const halfAngle = 0.2;
        const size = 900 * Math.tan(halfAngle) * 2;
        const moonMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(size, size),
            new THREE.ShaderMaterial({
                uniforms: { moonDisc: uniforms.moonDisc, moonGlow: uniforms.moonGlow, skyExposure: uniforms.skyExposure, halfAngle: { value: halfAngle } },
                vertexShader: MOON_VERTEX,
                fragmentShader: MOON_FRAGMENT,
                defines: { SKY_DISPLAY: '' },
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
                fog: false,
            }),
        );
        moonMesh.position.copy(MOON_DIR).multiplyScalar(900);
        moonMesh.lookAt(0, 0, 0);
        moonMesh.frustumCulled = false;
        moonMesh.renderOrder = -8;
        sky.add(moonMesh);
    }

    const stars = buildStars(seed, palette.stars, quality, uniforms);
    scene.add(stars);

    // low has no moon light (every Lambert fragment would pay for an unshadowed, faint directional): the hemisphere takes its share
    const hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemi + (quality === 'low' ? palette.moonPower * 0.5 : 0));
    scene.add(hemi);

    const moon = new THREE.DirectionalLight(palette.moon, palette.moonPower);
    const offset = MOON_DIR.clone().multiplyScalar(240);
    moon.position.copy(offset);
    if (quality === 'high') {
        moon.castShadow = true;
        moon.shadow.mapSize.set(2048, 2048);
        const cam = moon.shadow.camera;
        cam.left = -60;
        cam.right = 60;
        cam.top = 60;
        cam.bottom = -60;
        cam.near = 10;
        cam.far = 500;
        moon.shadow.bias = -0.0008;
        moon.shadow.normalBias = 0.02;
        moon.shadow.radius = 3;
    }
    if (quality !== 'low') scene.add(moon);
    scene.add(moon.target);

    function follow(target) {
        sky.position.copy(target);
        stars.position.copy(target);
        moon.target.position.copy(target);
        moon.position.copy(target).add(offset);
    }
    return {
        moon,
        hemi,
        palette,
        sky,
        follow,
        update(dt, target) {
            uniforms.time.value += dt;
            follow(target);
        },
    };
}

function buildStars(seed, density, quality, skyUniforms) {
    const random = rng(seed);
    // a city sky: a few hundred stars, most faint, a handful bright
    const count = Math.round((quality === 'low' ? 260 : 520) * density);
    const positions = [];
    const sizes = [];
    const brightness = [];
    for (let k = 0; k < count; k++) {
        const u = random() * Math.PI * 2;
        const y = 0.06 + Math.pow(random(), 0.8) * 0.94;
        const ring = Math.sqrt(1 - y * y);
        const r = 900;
        positions.push(Math.cos(u) * ring * r, y * r, Math.sin(u) * ring * r);
        const b = Math.pow(random(), 3);
        sizes.push(1.4 + b * 1.8);
        brightness.push(0.25 + b * 1.6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('brightness', new THREE.Float32BufferAttribute(brightness, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: 1 }, time: skyUniforms.time, clouds: skyUniforms.clouds, noise: skyUniforms.noise },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        defines: quality === 'low' ? {} : { CLOUDS: '' },
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
    });
    material.onBeforeRender = renderer => {
        material.uniforms.pixelRatio.value = renderer.getPixelRatio();
    };
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    return stars;
}
