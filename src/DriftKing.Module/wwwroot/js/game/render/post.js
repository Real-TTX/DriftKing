// DriftKing · render/post.js – the post-processing chain per picture quality. low renders straight to the canvas (no chain, as cheap as ever);
// medium renders the scene into a multisampled HDR target (packed float R11G11B10, MSAA), adds a bloom and finishes with tone mapping, sRGB,
// a soft vignette and dithering in one pass; high adds a fine film grain and a faint lens fringe at the edges.
// The bloom is a "dual filter" (a soft-threshold downsample from half resolution to 1/32, then tent upsamples back to 1/2) composited inside the
// finish pass: 9 small draws, no full-resolution blend, no second MSAA resolve – about a third of the cost of three's UnrealBloomPass on an iGPU.
// The stage owns the chain; a view tunes it with view.post (or scene.userData.post): { exposure, bloom: { strength, radius, threshold } | false, vignette, grain }.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * The look when a view says nothing: the exposure of a night scene (the maps set theirs per time of day, world/env.js PALETTES),
 * a bloom that only catches really bright things. The bloom threshold applies to the linear scene values BEFORE the exposure
 * (the exposure is applied in the finish pass only): with a soft knee from threshold / 2, values above ~1 bloom.
 */
export const POST_DEFAULTS = Object.freeze({
    exposure: 1.3,
    bloom: Object.freeze({ strength: 0.6, radius: 0.6, threshold: 0.9 }),
    vignette: 0.3,
    grain: 0.035,
});

/** What each quality does on top of a direct render (samples: MSAA of the scene target). */
export const POST_TIERS = Object.freeze({
    low: null,
    medium: Object.freeze({ samples: 4, grain: false, fringe: false }),
    high: Object.freeze({ samples: 4, grain: true, fringe: true }),
});

/** Draw calls the chain adds to a frame (bloom 9 + finish 1), for the budgets. */
export const POST_DRAW_CALLS = 10;

/**
 * The chain of a quality (null for low: render directly).
 * @param {THREE.WebGLRenderer} renderer
 * @param {string} quality low | medium | high
 * @returns {PostChain|null}
 */
export function createPost(renderer, quality) {
    const tier = POST_TIERS[quality];
    return tier ? new PostChain(renderer, tier) : null;
}

/** The HDR format of the targets: packed R11G11B10 float (half the bandwidth of RGBA16F) where it can be rendered to. */
function hdrFormat(renderer) {
    const packed = renderer.extensions.has('EXT_color_buffer_float');
    return packed ? { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat } : { type: THREE.HalfFloatType, format: THREE.RGBAFormat };
}

/** Scene pass → bloom → finish (tone mapping, sRGB, bloom composite, vignette, grain, dither) onto the canvas. */
export class PostChain {
    constructor(renderer, tier) {
        this.renderer = renderer;
        this.tier = tier;
        const size = renderer.getSize(new THREE.Vector2());
        const pixelRatio = renderer.getPixelRatio();
        const format = hdrFormat(renderer);
        // nothing reads the scene's depth after the scene pass: no depth resolve, and the multisampled depth may be dropped after it
        const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pixelRatio), Math.max(1, size.y * pixelRatio), {
            ...format,
            samples: tier.samples,
            resolveDepthBuffer: false,
            storeMultisampledDepthBuffer: false,
        });
        target.texture.name = 'DriftKing.scene';
        this.composer = new EffectComposer(renderer, target);
        // one scene target only: no pass of this chain swaps (the scene pass draws into the read buffer, bloom and finish only read it),
        // so make our target the read buffer – the composer's clone (renderTarget2) is then never bound and never allocated on the GPU
        this.composer.swapBuffers();
        this.scenePass = new RenderPass(null, null);
        this.bloom = new BloomPass(format);
        this.finish = new FinishPass(tier, this.bloom);
        this.composer.addPass(this.scenePass);
        this.composer.addPass(this.bloom);
        this.composer.addPass(this.finish);
        this.time = 0;
        this.setSize(size.x, size.y, pixelRatio);
    }

    /**
     * Renders one frame of the scene through the chain onto the canvas.
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {number} dt seconds since the last frame
     * @param {object} [post] the view's settings (see POST_DEFAULTS); missing values fall back to the defaults
     */
    render(scene, camera, dt, post) {
        this.time = (this.time + dt) % 1000;
        const bloom = post?.bloom;
        this.scenePass.scene = scene;
        this.scenePass.camera = camera;
        const strength = bloom === false ? 0 : bloom?.strength ?? POST_DEFAULTS.bloom.strength;
        this.bloom.enabled = strength > 0;
        this.bloom.radius = bloom?.radius ?? POST_DEFAULTS.bloom.radius;
        this.bloom.threshold = bloom?.threshold ?? POST_DEFAULTS.bloom.threshold;
        const u = this.finish.uniforms;
        u.bloomStrength.value = strength;
        u.vignette.value = post?.vignette ?? POST_DEFAULTS.vignette;
        u.grain.value = post?.grain ?? POST_DEFAULTS.grain;
        u.time.value = this.time;
        this.renderer.toneMappingExposure = post?.exposure ?? POST_DEFAULTS.exposure;
        this.composer.render(dt);
    }

    /** CSS size of the canvas and the pixel ratio (the targets are width × pixelRatio). */
    setSize(width, height, pixelRatio) {
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(Math.max(1, width), Math.max(1, height));
        this.finish.uniforms.resolution.value.set(Math.max(1, width * pixelRatio), Math.max(1, height * pixelRatio));
    }

    dispose() {
        this.bloom.dispose();
        this.finish.dispose();
        this.scenePass.dispose();
        this.composer.dispose();
    }
}

const QUAD_VERTEX = /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

// the first downsample: 4 bilinear taps (16 texels), a soft threshold (knee) and a Karis average, so single bright pixels
// (specular sparkles on wet asphalt) do not flicker
const PREFILTER_FRAGMENT = /* glsl */ `
    precision highp float;
    uniform sampler2D source;
    uniform vec2 texel;
    uniform float threshold;
    uniform float knee;
    varying vec2 vUv;
    vec3 pick(vec2 uv) {
        vec3 c = texture2D(source, uv).rgb;
        float l = max(c.r, max(c.g, c.b));
        // soft threshold: a quadratic knee below the threshold, linear above
        float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee + 1e-5);
        float contribution = max(soft, l - threshold) / max(l, 1e-5);
        return c * contribution / (1.0 + l);
    }
    void main() {
        vec3 a = pick(vUv + texel * vec2(-1.0, -1.0));
        vec3 b = pick(vUv + texel * vec2(1.0, -1.0));
        vec3 c = pick(vUv + texel * vec2(-1.0, 1.0));
        vec3 d = pick(vUv + texel * vec2(1.0, 1.0));
        // (a + b + c + d) / 4 of the Karis-weighted colours, back to linear weight
        vec3 sum = (a + b + c + d) * 0.25;
        float l = max(sum.r, max(sum.g, sum.b));
        gl_FragColor = vec4(sum / max(1.0 - l, 1e-3), 1.0);
    }`;

const DOWN_FRAGMENT = /* glsl */ `
    precision highp float;
    uniform sampler2D source;
    uniform vec2 texel;
    varying vec2 vUv;
    void main() {
        vec3 c = texture2D(source, vUv + texel * vec2(-1.0, -1.0)).rgb
            + texture2D(source, vUv + texel * vec2(1.0, -1.0)).rgb
            + texture2D(source, vUv + texel * vec2(-1.0, 1.0)).rgb
            + texture2D(source, vUv + texel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
    }`;

// a 9-tap tent of the smaller level, added onto the larger one (additive blending); radius weights the wide levels
const UP_FRAGMENT = /* glsl */ `
    precision highp float;
    uniform sampler2D source;
    uniform vec2 texel;
    uniform float weight;
    varying vec2 vUv;
    void main() {
        vec3 c = texture2D(source, vUv).rgb * 4.0;
        c += (texture2D(source, vUv + vec2(texel.x, 0.0)).rgb + texture2D(source, vUv - vec2(texel.x, 0.0)).rgb
            + texture2D(source, vUv + vec2(0.0, texel.y)).rgb + texture2D(source, vUv - vec2(0.0, texel.y)).rgb) * 2.0;
        c += texture2D(source, vUv + texel).rgb + texture2D(source, vUv - texel).rgb
            + texture2D(source, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(source, vUv + vec2(-texel.x, texel.y)).rgb;
        gl_FragColor = vec4(c / 16.0 * weight, 1.0);
    }`;

/** The bloom: levels 1/2 … 1/32 of the scene; the result (bloom.texture, half resolution) is added by the finish pass. */
class BloomPass extends Pass {
    constructor(format, levels = 5) {
        super();
        this.needsSwap = false;
        this.threshold = POST_DEFAULTS.bloom.threshold;
        this.radius = POST_DEFAULTS.bloom.radius;
        this.levels = [];
        for (let k = 0; k < levels; k++) {
            const t = new THREE.WebGLRenderTarget(1, 1, { ...format, depthBuffer: false });
            t.texture.name = `DriftKing.bloom.${k}`;
            this.levels.push(t);
        }
        const material = (fragmentShader, extra = {}) => new THREE.RawShaderMaterial({
            uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 }, weight: { value: 1 } },
            vertexShader: QUAD_VERTEX,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
            ...extra,
        });
        this.prefilter = material(PREFILTER_FRAGMENT);
        this.down = material(DOWN_FRAGMENT);
        this.up = material(UP_FRAGMENT, { blending: THREE.AdditiveBlending, transparent: true });
        this.quad = new FullScreenQuad(this.prefilter);
    }

    /** The finished bloom (half resolution). */
    get texture() {
        return this.levels[0].texture;
    }

    setSize(width, height) {
        let w = Math.max(1, Math.round(width / 2));
        let h = Math.max(1, Math.round(height / 2));
        for (const level of this.levels) {
            level.setSize(w, h);
            w = Math.max(1, Math.round(w / 2));
            h = Math.max(1, Math.round(h / 2));
        }
    }

    render(renderer, writeBuffer, readBuffer) {
        const levels = this.levels;
        const src = readBuffer.texture.image;
        this.prefilter.uniforms.threshold.value = this.threshold;
        this.prefilter.uniforms.knee.value = Math.max(0.05, this.threshold * 0.5);
        // every pixel of every level is written: no clears needed
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        this.draw(renderer, this.prefilter, readBuffer.texture, levels[0], 1 / src.width, 1 / src.height);
        for (let k = 1; k < levels.length; k++) {
            const from = levels[k - 1];
            this.draw(renderer, this.down, from.texture, levels[k], 1 / from.width, 1 / from.height);
        }
        // back up: each smaller level is blurred (tent) and added onto the next larger one; radius favours the wide levels
        this.up.uniforms.weight.value = 0.35 + this.radius * 0.9;
        for (let k = levels.length - 1; k > 0; k--) {
            const from = levels[k];
            this.draw(renderer, this.up, from.texture, levels[k - 1], 1 / from.width, 1 / from.height);
        }
        renderer.autoClear = autoClear;
    }

    draw(renderer, material, source, target, texelX, texelY) {
        material.uniforms.source.value = source;
        material.uniforms.texel.value.set(texelX, texelY);
        this.quad.material = material;
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
    }

    dispose() {
        for (const level of this.levels) level.dispose();
        this.prefilter.dispose();
        this.down.dispose();
        this.up.dispose();
        this.quad.dispose();
    }
}

const FINISH_FRAGMENT = /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D bloom;
    uniform float bloomStrength;
    uniform vec2 resolution;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;

    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
        vec2 centred = vUv - 0.5;
        #ifdef FRINGE
            // a faint lateral chromatic aberration that grows towards the corners (a real lens, not an effect)
            vec2 shift = centred * dot(centred, centred) * 0.006;
            vec4 colour = texture2D(tDiffuse, vUv);
            colour.r = texture2D(tDiffuse, vUv - shift).r;
            colour.b = texture2D(tDiffuse, vUv + shift).b;
        #else
            vec4 colour = texture2D(tDiffuse, vUv);
        #endif
        colour.rgb += texture2D(bloom, vUv).rgb * bloomStrength;
        // optical vignette in linear light: wide and soft, the corners lose about a third
        float aspect = resolution.x / max(resolution.y, 1.0);
        float r = length(centred * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
        colour.rgb *= 1.0 - vignette * smoothstep(0.35, 1.05, r);

        #ifdef LINEAR_TONE_MAPPING
            colour.rgb = LinearToneMapping(colour.rgb);
        #elif defined( REINHARD_TONE_MAPPING )
            colour.rgb = ReinhardToneMapping(colour.rgb);
        #elif defined( CINEON_TONE_MAPPING )
            colour.rgb = CineonToneMapping(colour.rgb);
        #elif defined( ACES_FILMIC_TONE_MAPPING )
            colour.rgb = ACESFilmicToneMapping(colour.rgb);
        #elif defined( AGX_TONE_MAPPING )
            colour.rgb = AgXToneMapping(colour.rgb);
        #elif defined( NEUTRAL_TONE_MAPPING )
            colour.rgb = NeutralToneMapping(colour.rgb);
        #elif defined( CUSTOM_TONE_MAPPING )
            colour.rgb = CustomToneMapping(colour.rgb);
        #endif
        #ifdef SRGB_TRANSFER
            colour = sRGBTransferOETF(colour);
        #endif

        vec2 pixel = gl_FragCoord.xy;
        #ifdef GRAIN
            // film grain in display space, strongest in the mid tones, moving every frame
            float luma = dot(colour.rgb, vec3(0.2126, 0.7152, 0.0722));
            float n = hash12(pixel + fract(time * 7.13) * 431.0) - 0.5;
            colour.rgb += n * grain * (0.35 + luma * (1.0 - luma) * 2.6);
        #endif
        // dithering: no banding in the dark sky gradients of an 8-bit canvas
        colour.rgb += (hash12(pixel * 1.37 + 11.0) - 0.5) / 255.0;
        gl_FragColor = vec4(colour.rgb, 1.0);
    }`;

/** The last pass: tone mapping + output colour space (like three's OutputPass) plus the bloom, vignette, grain, lens fringe and dither. */
class FinishPass extends Pass {
    constructor(tier, bloomPass) {
        super();
        this.uniforms = {
            tDiffuse: { value: null },
            bloom: { value: null },
            bloomStrength: { value: POST_DEFAULTS.bloom.strength },
            toneMappingExposure: { value: 1 },
            resolution: { value: new THREE.Vector2(1, 1) },
            vignette: { value: POST_DEFAULTS.vignette },
            grain: { value: POST_DEFAULTS.grain },
            time: { value: 0 },
        };
        this.tier = tier;
        this.bloomPass = bloomPass;
        this.material = new THREE.RawShaderMaterial({
            name: 'DriftKing.finish',
            uniforms: this.uniforms,
            vertexShader: QUAD_VERTEX,
            fragmentShader: FINISH_FRAGMENT,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
        // it always draws onto the canvas: no buffer swap (a swap would make the next frame's scene pass bind the composer's second target)
        this.needsSwap = false;
        this.outputColorSpace = null;
        this.toneMapping = null;
        this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        this.black.needsUpdate = true;
    }

    render(renderer, writeBuffer, readBuffer) {
        this.uniforms.tDiffuse.value = readBuffer.texture;
        this.uniforms.bloom.value = this.bloomPass.enabled ? this.bloomPass.texture : this.black;
        this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
        if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
            this.outputColorSpace = renderer.outputColorSpace;
            this.toneMapping = renderer.toneMapping;
            const defines = {};
            if (THREE.ColorManagement.getTransfer(this.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
            const toneDefine = TONE_DEFINES[this.toneMapping];
            if (toneDefine) defines[toneDefine] = '';
            if (this.tier.grain) defines.GRAIN = '';
            if (this.tier.fringe) defines.FRINGE = '';
            this.material.defines = defines;
            this.material.needsUpdate = true;
        }
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        if (!this.renderToScreen && this.clear) renderer.clear();
        this.quad.render(renderer);
    }

    dispose() {
        this.material.dispose();
        this.quad.dispose();
        this.black.dispose();
    }
}

/**
 * The tone mapping of three's shader on the CPU (ACES filmic, and the cheap ACES fit of low as CustomToneMapping – render/stage.js; other
 * modes pass through): for colours three mixes in AFTER tone mapping when it renders straight to the canvas – the fog colour on low.
 * Writes into target (default: the colour itself).
 */
export function toneMapColor(color, toneMapping, exposure, target = color) {
    if (toneMapping === THREE.CustomToneMapping) {
        const k = exposure * 0.8;
        return target.setRGB(narkowicz(color.r * k), narkowicz(color.g * k), narkowicz(color.b * k));
    }
    if (toneMapping !== THREE.ACESFilmicToneMapping) return target.copy(color);
    const k = exposure / 0.6;
    const r = color.r * k;
    const g = color.g * k;
    const b = color.b * k;
    // input matrix (sRGB → ACES-ish), the RRT/ODT fit, the output matrix – the numbers of tonemapping_pars_fragment
    const ir = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
    const ig = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
    const ib = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
    return target.setRGB(clamp(1.60475 * ir - 0.53108 * ig - 0.07367 * ib), clamp(-0.10208 * ir + 1.10813 * ig - 0.00605 * ib), clamp(-0.00327 * ir - 0.07276 * ig + 1.07602 * ib));
}

function narkowicz(x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

function fit(v) {
    return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

function clamp(v) {
    return Math.min(1, Math.max(0, v));
}

const TONE_DEFINES = {
    [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
    [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
    [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
    [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
    [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
    [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
    [THREE.CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
};
