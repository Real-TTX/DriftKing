# DriftKing – Rendering

How the browser client draws a believable night: the renderer and its quality tiers, post-processing, reflections, procedural PBR textures
and materials, real lights, the sky. This is the contract for everyone who builds cars, roads, props, maps, effects or scenes.
All code lives in `src/DriftKing.Module/wwwroot/js/game/render/` (plus `world/env.js` and `world/world.js`); three.js r187 and its addons
are vendored in `lib/three/` (`import … from 'three/addons/…'` works in every page through the importmap).

Look development: `dev/materials.html?quality=medium&view=road|row|close&time=night|dusk&env=garage&orbit=1` shows every material of this
document on a dry/wet street under the real sky, reflection map and light rig (`&hemi=`, `&envi=`, `&exposure=`, `&bloom=` override the
lighting for tuning). Use it before you put a material into a map.

## Contents

1. [Pipeline and quality tiers](#1-pipeline-and-quality-tiers)
2. [Stage and post-processing](#2-stage-and-post-processing)
3. [Reflections (environment.js)](#3-reflections-environmentjs)
4. [Textures (textures.js)](#4-textures-texturesjs)
5. [Materials (materials.js)](#5-materials-materialsjs)
6. [Real lights (lights.js)](#6-real-lights-lightsjs)
7. [Sky, fog, fill light (world/env.js)](#7-sky-fog-fill-light-worldenvjs)
8. [The kit (kit.js) and the map context (world.js)](#8-the-kit-kitjs-and-the-map-context-worldjs)
9. [Custom shaders](#9-custom-shaders)
10. [Budgets (measured)](#10-budgets-measured)
11. [Realism reference](#11-realism-reference)
12. [Notes for phase 2](#12-notes-for-phase-2)
13. [Real car models (GLB)](#13-real-car-models-glb)

## 1. Pipeline and quality tiers

Linear HDR lighting → ACES filmic tone mapping → sRGB. 1 unit = 1 metre. Geometry UVs are **in metres** (textures carry `repeat = 1 / tile`).

| | low | medium | high |
|---|---|---|---|
| pixel ratio (capped by the screen) | 0.75 | 1.25 | 2 |
| rendering | straight to the canvas | HDR target R11G11B10F, MSAA 4× → bloom → finish pass | as medium |
| tone mapping | cheap ACES fit per fragment (`CustomToneMapping`, Narkowicz) | full ACES once per pixel (finish pass) | as medium |
| post | – | bloom, vignette, dither | + film grain, faint lens fringe |
| reflections (`scene.environment`) | none (hemisphere fill only) | PMREM 256 | PMREM 256 (garage may use 512) |
| materials | Lambert/Phong with albedo maps | MeshStandard/Physical, normal + ORM maps, macro layer | as medium, 2× texture size, paint flakes |
| real lights (pool) | 0 | 6 | 10 |
| shadows | – | – | moon (2048 PCF, radius 3) |
| sky | gradient per vertex, moon billboard, stars | + clouds, moon disc per pixel | as medium |
| glow sprites / light pools | full strength (they are the bloom) | 0.55 | 0.5 |
| detail (`ctx.detail`) | 0.45 | 1 | 1.5 |

The tone mapping is ACES (`import { TONE_MAPPING } from '../render/stage.js'` – a module export, not a property of the stage object):
it keeps a night deep (a real toe) and lets lamps and neon burn out to a white core.
AgX (greyer, washes out sodium and neon) and Neutral (keeps hue but neon halos turn garish) were compared on the same scenes and rejected.
Consequence: very dark albedos (< 0.05) sink into the toe – use realistic albedos (table in §11) and the fill light, not black.

## 2. Stage and post-processing

`createStage(host)` (unchanged API): `stage.show({ scene, camera, update(dt, time), post? })`, `clear()`, `size()`, `dispose()`, `renderer`,
`quality`, `fps`, `time`; new: `stage.post` (the chain of medium/high or null).

A view tunes the post chain with `view.post`, or – what maps do – `scene.userData.post` (world.js sets it from the palette):

```js
scene.userData.post = { exposure: 1.35, bloom: { strength: 0.6, radius: 0.55, threshold: 0.9 }, vignette: 0.3, grain: 0.035 };
stage.show({ scene, camera, update, post: false });   // this view without post even on medium/high
```

`POST_DEFAULTS` (post.js) apply to whatever a view leaves out (exposure 1.3, bloom 0.6/0.6/0.9, vignette 0.3, grain 0.035).
`renderer.info` counts **one whole frame** (scene pass + 10 post draws); it is reset right before rendering, so it is readable in
`update()` and between frames. The chain is rebuilt on a quality change (`settings.onChange`), sized on resize, disposed with the stage.
It keeps **one** full-resolution scene target (no pass swaps buffers; the EffectComposer's second target is never bound, so never
allocated) and resolves only its colour – nothing reads the scene depth after the scene pass (`resolveDepthBuffer: false`). An effect
that needs the depth (SSAO, depth of field, soft particles) must change that and budget the extra resolve.

**Bloom**: a dual-filter bloom (soft threshold with a knee and a Karis average on the first downsample, 1/2 … 1/32, tent upsamples),
composited in the finish pass – 9 small draws, no full-resolution blend, no second MSAA resolve. three's `UnrealBloomPass` is vendored
but cost about three times as much on an integrated GPU. **What blooms**: the threshold applies to the **linear scene values before the
exposure** (the exposure is applied in the finish pass only): with the default 0.9 and its soft knee (from 0.45) a pixel starts to bloom
where its brightest linear channel passes ~1. That is emissive materials whose brightest channel × intensity is above ~1 (§5: 1.5–2 a soft
glow, 3–8 a lamp) and the specular highlights of real lights on glossy surfaces.

## 3. Reflections (environment.js)

```js
import { environmentMap, environmentFor, ENVIRONMENT_INTENSITY } from '../render/environment.js';
scene.environment = environmentMap('garage', { size: 512 });   // 'night' | 'dusk' | 'garage'; null without a stage
scene.environmentIntensity = ENVIRONMENT_INTENSITY.garage;
```

PMREM maps rendered once from small procedural scenes: **night** (dark sky, sodium/violet light dome, two rows of sodium lamps overhead,
cool LED strips, lit windows all around, neon panels, the moon), **dusk** (blue hour, afterglow, dimmer lamps), **garage** (tube lights
under the ceiling, two softboxes, neon on the back wall). Cached per kind and size, `userData.shared` (disposeTree leaves them), freed by
`disposeEnvironments()` (the stage on dispose). First build ≈ 180–220 ms (includes shader compilation), then free. `buildWorld` sets
`scene.environment` for medium/high (not on low). In r187 MeshLambert/Phong take the map's irradiance as a soft fill; Standard/Physical
get reflections. **Never dispose** a map you got from here; `scene.environmentIntensity` applies to every material that has no own `envMap`.

## 4. Textures (textures.js)

```js
const t = texturesFor(quality);           // or ctx.textures in a map builder
const set = t.asphalt({ wet: true });     // { map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, tile }
```

Seeded (same picture on every client), tileable, cached per quality and options (every texture belongs to exactly one quality, also
`macro` and `flakes`, which have the same size on medium and high), sized per quality (`TEXTURE_SIZE`: large 256/512/1024, small 128/256/512),
`map` sRGB, the rest linear. `roughnessMap`, `metalnessMap` and `aoMap` are **one ORM texture** (R = AO, G = roughness, B = metalness).
On low only `map` (and `emissiveMap`) are made. All textures are shared – do not dispose them, do not change them; get a re-tiled clone
through the material factory's `scale` option instead.

| recipe | tile (m) | options | notes |
|---|---|---|---|
| `asphalt` | 4 | `seed, wet, cracks` | binder, exposed aggregate, hairline cracks; wet: water fills the cavities up to a level (flat glossy film) |
| `concrete` | 4 | `seams, stains` | mottling, pores, 2 m formwork seams, run-off stains |
| `floor` | 6 | – | painted/epoxy deck floor, near-white (tint with the material colour), scuffs, tyre marks, chips |
| `corrugated` | 2.6 | `rust` 0..1 | one tile = one container side (9 trapezoid ribs), light albedo to tint, rust and grime at the edges |
| `brushed` | 1 | – | streaks along u, metalness 1 |
| `tread` | 1 | – | u = around the tyre (one tile = circumference), v = across: 4 grooves, sipes, shoulder slots |
| `ground` | 3 | `kind: grass\|dirt\|gravel` | |
| `rock` | 6 | – | ridges, strata, a few cracks |
| `bark` | 1 × 2 | – | vertical fibres, plates |
| `foliage` | 1 | `kind: needles\|leaves` | alpha card (v = 1 is the top of the twig); alphaTest 0.45, DoubleSide |
| `brick` | 0.9 × 0.6 | – | running bond, 10 mm joints |
| `tiles` | 1.2 | – | 4 × 4 ceramic tiles, glossy, rough grout |
| `facade` | 12 × 12.8 | `lit` 0..1, `seed` | 4 bays × 4 storeys, recessed glass, lit windows in `emissiveMap` (vary `seed` per building) |
| `overlay` | 2 | `kind: grime\|rust` | RGBA overlay with alpha for decals / a second layer |
| `flakes` | 0.05 | – | metallic paint flakes (normal map only) |
| `macro` | 64 | – | 256² RGB noise: the anti-tiling layer, the clouds |

**Quality switch**: `trimMaterials(quality)` (materials.js; `buildWorld` calls it before it builds) frees everything the other
qualities made – their cached materials, re-tiled clones and, through `trimTextures(quality)`, their textures – and drops their material
factories, so no cached material keeps a freed texture alive. Do not call `trimTextures` alone (the factories would upload the freed
textures again, untracked). A scene that uses the factories without `buildWorld` (the garage) calls `trimMaterials(quality)` itself.
`disposeMaterials()` frees all of it (the stage on dispose). `stats` = `{ ms, count, bytes }` since page load.
Helpers: `metricUVs(geometry)` (kit.js) gives any placed geometry box-projected UVs in metres.

## 5. Materials (materials.js)

```js
const mat = materialsFor(quality);        // or ctx.materials in a map builder
road.material = mat.asphalt({ wet: 0.6 });
wall.material = mat.concrete({ color: 0xd8d4cc });
rail.material = mat.metal({ color: 0xb4b8bd, roughness: 0.45 });
lens.material = mat.emissive(LIGHT_PRESETS.sodium.color, 12);
body.material = mat.carPaint('#1d4fa8', { metallic: 0.8, pearl: 0 });   // owned by the car: dispose it with the car
```

| factory | options | medium/high | low |
|---|---|---|---|
| `asphalt` | `wet` 0..1, `puddles` 0..1 (= wet), `color`, `scale` | Standard + macro layer: tone variation, wet film, puddles (mirror, flat) on surfaces facing up | Lambert + map |
| `concrete` | `color, seams, stains, wet, scale` | Standard + macro | Lambert |
| `floor` | `color` (the paint), `wet`, `scale` | Standard + macro | Lambert |
| `ground` | `kind, color, scale` | Standard + macro | Lambert |
| `rock`, `brick`, `tiles`, `bark` | `color, scale` | Standard (+ macro) | Lambert |
| `foliage` | `kind, color` | Standard, alphaTest, DoubleSide | Lambert |
| `facade` | `lit, glow` (lit-window brightness, default 1.6), `color, seed` | Standard + emissiveMap | Lambert + emissiveMap |
| `corrugated` | `color, rust` | Standard | Lambert |
| `metal` | `color, roughness, brushed` | Standard metalness 1 | Phong |
| `painted` | `color, roughness` | Standard dielectric | Lambert |
| `chrome` | `color, roughness` (0.08) | Standard metalness 1 | Phong |
| `rubber` | `color, roughness, tread` | Standard (+ tread maps) | Lambert |
| `glass` | `tint, opacity, roughness` | Physical, premultiplied blending: reflection at full strength, view through dimmed by `opacity` | Phong, same blending |
| `carPaint(color, o)` | `metallic, pearl, roughness, clearcoat` | Physical, clear coat 1 / 0.04, iridescence for pearl, flakes on high | Phong |
| `plastic` | `color, roughness` | Standard | Lambert |
| `emissive(color, intensity, o)` | `map, fog, side` | Basic, colour × intensity (HDR) | same |

Everything except `carPaint` and `emissive` **with a map** is **cached and shared** (`userData.shared`): never change a shared material in
place, ask for another one (the options are the cache key). `emissive(c, i, { map })` (a sign texture) returns a material that belongs to
the caller like the texture: not shared, so `disposeTree` frees material and texture with the world (a texture marked shared stays);
until then every request with the same texture and options returns the same material. The factories never mark a caller's texture shared.

The macro layer samples world x/z (two scales of a 64 m noise), so it is continuous across meshes and hides tiling; puddles and the wet film
only land on faces whose world normal points up (instance, batch and model rotation included). It also does **specular anti-aliasing** in
GGX α²: the screen-space variance of the shading normal plus the variance the normal map's mips have averaged away (Toksvig), together at
most 0.25; the wet film flattens the normal three quarters of the way (water between the stones) and keeps roughness ≥ 0.08. Wet roads
show soft glossy reflections under lights, no salt-and-pepper glitter; tiny mirror puddles may still catch a lamp as a single bright dot.

Emissive values are linear: the bloom starts where the brightest channel × intensity passes ~1 (§2). Intensities that read right: tail light
3–4 (brake 8), indicator 6, headlight lens 15–25, street-lamp lens 10–14, neon tube 5–8, lit sign face 2–4, lit windows 1.2–2, screens 1.5–3.

## 6. Real lights (lights.js)

A **fixed pool** of SpotLights per quality (`LIGHT_POOL`: low 0, medium 6, high 10) handed every frame to the most relevant registered
sources: distance to a point 10 m ahead of the camera divided by the source's reach (`distance`) and `priority`, a 20 % keep bonus
(hysteresis), 0.35 s fades. The light count never changes after the build, so shaders never recompile.

```js
// in a map builder (ctx.lights is the rig; world.update() updates it)
ctx.lights.add({ x, y: 8.5, z, ...LIGHT_PRESETS.sodium });                         // cone straight down (dir default (0,-1,0))
ctx.lights.add({ x, y: 4, z, ...LIGHT_PRESETS.neon, color: 0x29e7ff, dir: { x: 0, y: -0.5, z: 1 } });   // 'point' = hemisphere
const mast = ctx.lights.add({ x, y: 22, z, ...LIGHT_PRESETS.mast, priority: 1.5 });
mast.intensity = 0;                                                                 // handles are live (flicker, switch off)
```

`add()` returns a handle: `position`, `target` (Vector3), `color`, `intensity`, `distance`, `decay`, `angle`, `penumbra`, `priority`,
`enabled` are live. `type: 'spot'` is a cone (≤ π/2) around `dir`/`target`; `type: 'point'` becomes a hemisphere (90° spot) around `dir`
(down by default) – one kind of pool light keeps the selection and the shaders simple. `reserve(n)`, `seal()`, `remove(handle)`,
`active()`, `size`, `dispose()`. **buildWorld seals the rig after the map is built**: pool lights that no registered source can use are
dropped (a map without lamps pays nothing). Sources added after the build (dynamic ones) need `buildWorld(key, { lightReserve: n })`.
`world.update(dt, cameraPosition, camera?)` – pass the camera so the rig favours what is in front (otherwise it uses the direction of travel).

`LIGHT_PRESETS` (intensity in candela with decay 2, distance in m): `sodium` 2000 K 420 cd/30 m 60° cone, `led` 4300 K 380/28,
`mast` 2200 K 2600/70, `tube` 5000 K 45/12, `neon` 60/14, `shop` 3200 K 70/12, `headlight` 5200 K 900/60 24° cone, `taillight` red 6/5.
`kelvinHex(k)` gives a black-body colour.

## 7. Sky, fog, fill light (world/env.js)

`buildEnvironment(scene, { timeOfDay, quality, seed })` (signature unchanged) returns `{ moon, hemi, palette, sky, follow(target),
update(dt, target) }`. The sky: gradient and the city's light dome (sodium low, violet higher) and the dusk afterglow per vertex of a dense
dome; clouds lit from below by the city (medium/high), the moon (disc, maria, tight and wide halo) per pixel; 260/520 small stars that fade
near the horizon and behind clouds. It is drawn **after** the opaque geometry on the far plane, so only visible sky pixels are shaded.
Low: the dome is tone-mapped per vertex and the moon is a billboard – the sky costs what the old flat gradient cost.
The sky, the low moon billboard, the stars, the glow sprites and the smoke pick their output **when they are drawn** (`#ifdef TONE_MAPPING`,
§9), not when they are built: a scene built for one quality still looks right for a while after the player switches the quality (the
menu backdrop stays until it is rebuilt) – it only keeps the old tier's materials, lights and cost until then.

`PALETTES.night|dusk` hold the colours (sRGB hex), linear fog (`fogNear/fogFar` – `fogFar` also bounds glow sprites and smoke), the
hemisphere fill (night 1.6, dusk 1.5 – high because ACES's toe eats dark fill), the moon light (night 0.35; not on low, where the hemisphere
takes its share), `envIntensity` and `post` (night exposure 1.35, dusk 1.1). On low three mixes fog **after** tone mapping; the stage
hands three a tone-mapped fog colour for that render, so the haze matches the sky on every tier.

## 8. The kit (kit.js) and the map context (world.js)

kit.js keeps every old export. New: `markShared(obj)`, `isShared(obj)`, `disposeMaterial(m)` (respects sharing), `metricUVs(geometry)`,
`setGlowGain/getGlowGain` (one shared uniform for all glow points and light pools – cars included; the stage sets it per quality),
`LightPools.build({ strength })`. `disposeTree(root)` skips everything with `userData.shared`, frees the shadow maps of the lights it finds
(`Light.dispose()` – the moon's 2048² map on high) and also frees a scene's own (non-shared) environment/background textures.

`buildWorld(key, { timeOfDay, quality, lightReserve })` → the old fields plus `lights` (the rig) and `quality`; it first calls
`trimMaterials(quality)` (§4). The builder's `ctx` adds:
`ctx.lights` (rig), `ctx.materials` (factory), `ctx.textures` (recipes), `ctx.envMap` (the reflection map or null), besides
`def, key, root, scene, course, colliders, glows, pools, quality, detail, timeOfDay, palette, random`. `world.dispose()` frees the rig and
the tree (shared resources stay; lights' shadow maps go): starting and disposing runs again and again does not grow GPU memory on any tier.

## 9. Custom shaders

Every custom `ShaderMaterial` writes **linear light** and ends with

```glsl
gl_FragColor = vec4(linearColour, alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

so it looks the same straight to the canvas (low: tone-mapped and encoded here) and through the post chain (medium/high: the chunks are
no-ops, the finish pass does it). A colour given as an sRGB hex through `THREE.Color` is already linear. A `RawShaderMaterial` gets no chunks.

`#ifdef TONE_MAPPING` is true only when three draws straight to the canvas (low, or a view with `post: false`). Cheap effects whose colour
is meant "as displayed" and that cover much of the screen (smoke, glow sprites) use it instead of the two chunks, so low pays nothing extra:

```glsl
#ifdef TONE_MAPPING
    gl_FragColor = vec4(colour, a);         // straight to the canvas: the display colour as it is (no per-fragment tone mapping)
#else
    gl_FragColor = vec4(linearColour, a);   // into the HDR target: the same colour decoded once on the CPU
#endif                                       // (new THREE.Color(hex).convertSRGBToLinear() – fx/smoke.js)
```

Never decode, tone-map or encode a constant per fragment; do it once on the CPU (kit.js's glow decodes per fragment only on medium/high,
because its value varies per sprite and texel).

## 10. Budgets (measured)

Measured on an **AMD Radeon 610M** (2-CU integrated GPU, the weakest current class), 1366 × 768, dpr 1, Edge/ANGLE D3D11, the dev drive
page with 4 cars driving (autopilot, freeride), uncapped frame rate, 1500 frames per sample, A/B in the same session against the low-poly
build of this commit's parent. Use the **plain mean of all frames** (or fps), never a trimmed mean: the frames a trim throws away are
exactly the ones where extra GPU work shows. Absolute numbers drift ±20 % with the machine's thermal state – compare A/B, not across days.

| | before | phase 1 (maps still have no real light sources) |
|---|---|---|
| low (plain mean frame time) | pass 1.02, deck 0.99, harbor 1.07, city 1.35 ms | pass 1.04, deck 0.91, harbor 1.02, city 1.42 ms (parity: run-to-run spread ±7 %) |
| medium | 191–263 fps | 143–196 fps (0.71–0.76 ×: ≈ 1.3–1.9 ms more per frame, the post chain ≈ 1.8 ms of it) |
| high | 198–242 fps | 143–177 fps (0.70–0.75 ×) |
| each real light (city, Lambert-heavy) | – | ≈ 0.3–0.4 ms: 6 lights ≈ 2 ms, 12 ≈ 4.5 ms |
| reflection map, first build | – | 180–220 ms, cached |
| post chain GPU memory (medium, 1366 × 768 × 1.25) | – | ≈ 60 MB: one 4× MSAA R11G11B10 scene target + depth, its resolve, the bloom levels |
| draw calls (incl. 10 post draws) | 106–177 | 107–187 |
| triangles | 20 k (deck low) – 397 k (pass high) | same + 4.6 k sky dome |

Texture generation (main thread, first use, then cached): medium – asphalt 51 ms, concrete 30, floor 38, facade 18, the small recipes
2–8 ms each (a typical map's set ≈ 150–250 ms, ≈ 15–20 MB); high – asphalt ≈ 200 ms, concrete 105, floor 132, facade 61
(a map ≈ 500–650 ms, ≈ 50–70 MB); low ≈ 40 ms. A 512² texture with mips = 1.4 MB, 1024² = 5.6 MB; a reflection map ≈ 6 MB.

Recommended budgets per map (keep the 610M class ≥ 60 fps on medium with headroom):

| | low | medium | high |
|---|---|---|---|
| draw calls per frame | ≤ 150 | ≤ 250 | ≤ 350 |
| triangles in view | ≤ 150 k | ≤ 400 k | ≤ 900 k |
| procedural texture memory | ≤ 16 MB | ≤ 48 MB | ≤ 120 MB |
| real lights | 0 | 6 (pool) + own headlight | 10 + own headlight |
| distinct materials (programs) | ≤ 25 | ≤ 30 | ≤ 35 |

Rules: merge static geometry per material (`mergeGeometries`, `BufferGeometryUtils.mergeGeometries`); `InstancedMesh` for every repeat
(trees, posts, lamps, cones, containers); share materials (the factories do); no allocations per frame (reuse vectors and arrays);
the light pool is fixed – register sources, never add `Light`s to the scene; scale props with `ctx.detail`; LOD or fade far detail;
prefer emissive + bloom over extra lights for far lamps; keep transparent overdraw (smoke, glows, glass) small; textures: get them from
`ctx.textures`, never per object.

**Phase 2 maps (measured after the map polish, same 610M, 1366 × 768, dpr 1, uncapped):** the map alone – `dev/maps.html?view=road&at=0.2`
(camera 3 m above the course, no cars), plain mean of 800–1000 frames, A/B/C in one session against phase 1 (0d77c11) and the phase-2
commit (c1d9e72). The machine was shared with other jobs (spread ±10 %, single A/B/A toggles up to ±5 ms – compare rows, not digits).

| map | low ms (phase 1 → 2) | medium ms | high ms | draw calls / triangles in view (low · medium · high) |
|---|---|---|---|---|
| pass | 0.49 → 1.08 | 2.9 → 17.6–19.6 (51–57 fps) | 4.1 → 47–49 (≈ 21 fps) | 92 / 185 k · 164 / 415 k · 203 / 869 k |
| deck | 0.59 → 0.87–1.06 | 2.4 → 9.1–9.4 | 2.7 → 11.8–12.3 | 37 / 71 k · 47 / 104 k · 59 / 195 k |
| harbor | 0.44 → 0.78–0.80 | 2.6 → 7.4 | 3.1 → 11.9–12.0 | 48 / 84 k · 61 / 156 k · 60 / 242 k |
| city | 0.59 → 1.86–1.90 | 3.2 → 17.3–18.1 (55–58 fps) | 3.0 → 17.8–17.9 | 40 / 76 k · 49 / 135 k · 51 / 127 k |

The polish (foliage shading, wet streaks, faceted guardrail, one needle-card tier and one silhouette tip less on medium) is at parity with
the phase-2 commit on every map and tier (same draw calls; pass medium 441 k → 415 k triangles). Draw calls and triangles are within the
budgets except the pass: low 185 k (budget 150 k) and medium 415 k at its densest view (400 k). **Open:** phase 2 made the maps 3–6× more
expensive on medium/high and ≈ 2× on low (still ≈ 1–2 ms); the pass and the city miss "≥ 60 fps on medium" on this class even without
cars, the pass on high (moon shadow of the forest, 869 k triangles) runs at ≈ 21 fps. Hiding the whole map saves it; per-group toggles (trees,
terrain, lights, env map) were too noisy on the shared machine to rank – it is fill and shading, not triangles (the triangle cut did not
move the time). Profile it again on a quiet machine.
Candidates: cheaper far trees (Lambert-like silhouettes), no shadow casting for the forest cards on high, fewer alpha-to-coverage layers.

## 11. Realism reference

**Dimensions** (metres): lane 3.5 (city 3.0–3.25), road markings 0.12–0.15 wide (dashes 3 m / gaps 6 m on rural roads), kerb 0.15 high,
pavement 2–3, street-lamp pole 8–10 (arm 1.5–2.5, head 0.6 × 0.3), harbour mast 20–25, W-beam guardrail 0.75 high (beam 0.31 tall) on
posts every 2 m, concrete barrier 0.8–1.1 high, traffic cone 0.5–0.75, bollard 1.0, ISO container 12.19 × 2.44 × 2.59 (20 ft: 6.06),
parking bay 2.5 × 5.0, parking-deck storey 2.6–3.0 (clearance 2.1–2.3), building storey 3–3.5 (ground floor shops 4–5), window 1.2–1.5 wide,
door 0.9 × 2.1, shop sign 0.6–1.2 high, telephone pole 9–12, pine 15–30 (crown from 1/3), car: length 4.2–4.6, width 1.7–1.85,
height 1.25–1.4, wheel ⌀ 0.6–0.66, track 1.5.

**PBR values** (albedo in sRGB, roughness, metalness):

| surface | albedo | roughness | metal | notes |
|---|---|---|---|---|
| asphalt dry | #3a3a3c–#5a5a5c | 0.85–0.95 | 0 | |
| asphalt wet | darker × 0.7 | 0.25–0.4 (puddles 0.03–0.08) | 0 | flat normal in water |
| concrete | #8c8a86–#b4b0a8 | 0.85–0.95 | 0 | |
| painted deck floor | paint | 0.35–0.55 | 0 | |
| car paint (clear coat) | paint | base 0.3–0.45, coat 0.03–0.06 | 0–0.75 (metallic) | clearcoat 1 |
| chrome | #c4c5c8–#d0d2d6 | 0.04–0.1 | 1 | |
| aluminium / zinc | #b4b8bd | 0.3–0.55 | 1 | galvanised rail |
| painted metal | paint | 0.4–0.6 | 0 | |
| rubber (tyre) | #1a1a1c–#242426 | 0.85–0.95 | 0 | |
| glass | dark tint | 0.02–0.06 | 0 | opacity 0.3 clear, 0.75 tinted |
| plastic | colour | 0.35–0.6 | 0 | |
| grass (night) | #3a4e2a | 0.9 | 0 | |
| brick | #8a4a3a | 0.8–0.9 | 0 | |

**Light at night**: high-pressure sodium ~2000 K (orange), low-pressure sodium ~1800 K (almost monochrome amber), LED street light
4000–5000 K (cool white), fluorescent tubes 4000–6500 K, warm shop light 2700–3200 K, headlights: halogen 3200 K, xenon/LED 4500–6000 K.
Neon: pink #ff2e88, cyan #29e7ff, violet #8b5cf6, amber #ffb020, green #3ef08a, red #ff3030 (argon blue, neon red-orange in reality).
Intensities that read right with this tone mapping: the `LIGHT_PRESETS`; ambient night fill is the hemisphere light (env.js).

**How to make signs and lamps bloom**: give the glowing part `mat.emissive(colour, intensity)` – the bloom starts where the brightest
linear channel × intensity passes ~1, so 1.5–2 for a soft glow, 3–8 for a lamp (saturated neon colours have one channel near 1; a dim
or desaturated colour needs more, see §2/§5) – keep the rest of the sign dark (a dark backing makes the tubes pop), add a real light source only for the few big ones near the road, and a
`GlowPoints` sprite only where you want a halo on low as well (it is halved automatically on medium/high).

## 12. Notes for phase 2

- **Car headlights/taillights**: the own car keeps its own `SpotLight` (run.js `addHeadlight`, medium/high) outside the pool – one fixed
  light, it never moves between owners. Other cars: register a `LIGHT_PRESETS.headlight` source per car (`world.lights.add`, then move
  `handle.position`/`handle.target` every frame) and pass `lightReserve` (e.g. the number of other cars, max 3) to `buildWorld`; the rig
  lights the nearest. Lamps themselves: emissive lenses (15–25 head, 3–4 tail, 8 when braking) + the glow sprites; no light for
  taillights except the own car's optional `taillight` source.
- **Wet roads** reflect the environment map, not the scene: puddles and the wet film show the generic night street and the specular
  highlights of the real lights. For the classic wet-road look add view-dependent reflection streaks (additive quads on the road below
  each lamp/neon, stretched towards the camera) in the road/fx code; there is no SSR. Done: `world/wet-streaks.js` (`WetStreaks`:
  `reflect(x, z, height, hex, width, strength, { roadY, reach })`, one instanced draw call per map; `keep` keeps the bright part of tall
  lights in front of the camera) – the city's lamps, signs and shop windows (maps/city-fx.js), the harbour's mast floodlights on the wet
  yard (medium/high only); `fx/streaks.js` does the cars' lamps, `harbor-water.js` the sea. The pass (damp, 0.14) and the deck (dry with
  wet patches) have none on purpose.
- **Foliage cards** (`world/props-trees.js foliageShading`): double-sided cards keep the crown's normal on both faces; seen from below,
  that normal faces away from the eye, N·V clamps to 0 and the Fresnel term turned the branches overhead into a mirror of the night sky
  (frost-white). The shader bends the normal towards the eye until N·V ≥ 0.25 and damps the specular – use it for every such card.
- **Disposal**: car dispose code must skip `isShared()` materials/textures (`disposeMaterial` does); `carPaint` is the car's own, and so
  is an `emissive(…, { map })` sign material (with its texture).
- **Quality switch in the menu**: the stage switches at once, but a scene keeps what it was built with (the sky, smoke and glows adapt their
  output, §7) – menu.js should rebuild the backdrop/garage when `settings.quality` changes, so a switch to low also drops the PBR
  materials, pool lights and per-pixel sky at once. A garage that uses the factories calls `trimMaterials(quality)` before it builds.
- **fx/smoke.js** got a minimal compatibility change in phase 1: the §9 `#ifdef TONE_MAPPING` pattern (display colour on low exactly as
  before, the CPU-decoded colour into the HDR chain), otherwise it read twice as bright through the HDR chain. Follow §9 for every new
  effect shader.
- The old maps' Lambert/Phong materials still look as before (now under ACES, with the env fill on medium/high). The old garage scene has
  no environment map yet – use `environmentMap('garage', { size: quality === 'high' ? 512 : 256 })` and `mat.floor()`/`mat.glass()` there.
- `ctx.random` stays the only randomness for map content (every client builds the same world); texture seeds are fixed per recipe.
- Low must stay as cheap as today: on low the factories already return Lambert/Phong, the pool is empty, there is no env map –
  don't add per-pixel work that only exists for the look of medium/high without a quality check.

## 13. Real car models (GLB)

The cars with a real model (downloaded CC BY models, prepared by `tools/cars/` – the steps are in `tools/cars/README.md`) are
`models/cars/<key>.glb`, listed in `data/car-models.json` (measures, wheel centres, lamp mounts, size, a content hash `v`) and credited in
`data/car-credits.json` (settings → Credits). `car/model-glb.js` does the runtime; `buildCar(view)` (unchanged API) uses it when `view.key`
has an entry:

- **Low never loads a model** (no download, the procedural car as before). Medium/high: buildCar returns the procedural car at once and
  swaps the model in when it is loaded – synchronously when it is loaded already (the garage repaints without a flicker);
  `userData.ready` resolves to `true` then. The model's measures (lamp mounts, profile, beam, shadow, neon) are put on the car at once when
  the manifest is loaded, so the run's lamps (`fx/carlights.js` reads `lightMounts` in `add()`) and the camera get the real car's.
  `preloadCarModels(keys)` (model-glb.js) can start the downloads early (the menu, the garage list – not wired yet).
- **One file per car, loaded once**: geometry, the model's textures and kept materials are shared by every car of that key
  (`userData.shared`); per car: the paint (`carPaint` in the garage colour, no flakes – the model's UVs are not metric), the tail, brake
  and reverse lamps (Vehicle drives them as before). `trimCarCache('low')` frees all loaded models.
- **Materials by role** (the prepared file names them): `paint` → `carPaint`; `glass`, `lens`, `chrome`, `rim` (the garage's rim colour),
  `metal`, `rubber`, `trim` (gloss black), `plastic`, `caliper` → the factory's (§5; a role material that kept its texture stays the
  model's); `light_head` 6, `light_drl` 4 (emissive, `lamps` in the manifest overrides), `light_tail` 2.6 / brake 8, `light_brake`
  (lit only when braking), `light_reverse`; `far` (the far model's vertex colours); `x_*` the model's own (textures kept).
- **Wheels**: `wheel_fl/fr/rl/rr` hang in the procedural car's pivots (steer, camber, spin – Vehicle unchanged), `caliper_xx` steer
  without spinning. **LOD**: the file has a far model (≈ 9 k triangles, 4–5 draw calls) behind the same THREE.LOD; the wheels switch
  3 m later than the body. Neon tubes and the ground glow, glow points and the contact shadow follow the model's measures.
  Decals and the number are **procedural only** (the livery atlas needs the procedural shells' UVs): a car with a model shows none.
- **Budgets per car**: file ≤ 3 MB (meshopt geometry, WebP textures), near ≈ 60–90 k triangles (default 80 k), far ≈ 9 k, textures
  ≤ 1024² (base colour, emissive) and ≤ 512² (normal, ORM), ≈ 20 body + ≈ 12–16 wheel draw calls (merge roles to stay there).
  Measured with the test car (a 359 k triangle model → 78 k / 9 k, 0.73 MB): +15 draw calls and +30 k triangles per car in view on
  medium compared with the procedural car; first load ≈ 20–50 ms from the local server (parse + meshopt decode), then free.
- **Serving**: the master's static files do not know `.glb`; `Web/PlayerApp.cs` serves `models/cars/*.glb` (`model/gltf-binary`, cached
  for good with `?v=`). The Windows app (MatGame.Shell) and `scripts/serve.mjs` serve them as they are.
