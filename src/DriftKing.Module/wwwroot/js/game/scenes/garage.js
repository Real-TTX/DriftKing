// DriftKing · scenes/garage.js – the car on a turntable in a tuning workshop at night (the room: scenes/garage-room.js): studio light from
// an overhead softbox, two strip boxes behind the car and a fill box behind the camera, tube lights under the roof; on medium/high the car
// reflects this very room (a reflection map baked from it once) and stands mirrored in the epoxy floor; on high the key light casts the
// car's shadow. show(carView) swaps the car at once (paint, rims, neon, decal or body changed in the menu); a change of the picture quality
// rebuilds the room for the new tier in the same frame (no flicker, the old tier's materials, lights and maps are freed).

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { buildCar } from '../car/models.js';
import { settings } from '../settings.js';
import { disposeTree, GlowPoints, LightPools } from '../render/kit.js';
import { kelvinHex, LIGHT_PRESETS } from '../render/lights.js';
import { materialsFor, trimMaterials } from '../render/materials.js';
import { texturesFor } from '../render/textures.js';
import { buildRoom, FLOOR, ROOM, STUDIO } from './garage-room.js';

/** Turntable radius and height of its top (m); the speed it turns (rad/s). */
const TURNTABLE = { radius: 3.3, top: 0.14, speed: 0.16 };

/** The post chain of the garage: a touch less exposure than the street (the softboxes are bright), a soft bloom on the panels. */
const POST = Object.freeze({ exposure: 1.15, bloom: { strength: 0.5, radius: 0.6, threshold: 0.9 }, vignette: 0.36, grain: 0.03 });

/** The camera: a slow, wide sway around the front quarter of the car (long lens, eye a little below standing height). */
const CAMERA = { fov: 34, distance: 9.8, height: 1.6, look: 0.62 };

/** In the menu the car stands between the car list (left) and the tuning panel (right): this many CSS pixels left of the middle. */
const MENU_SHIFT_PX = 70;

/**
 * Shows the garage on the stage (until dispose()).
 * @param {ReturnType<import('../render/stage.js').createStage>} stage
 * @returns {Promise<{ show(carView: object): void, dispose(): void }>}
 */
export async function createGarageScene(stage) {
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 80);
    const view = { scene: null, camera, update };
    let set = buildSet(stage, settings.get().quality);
    let car = null;
    let carView = null;
    let disposed = false;
    let time = 0;
    let spin = 0.4;
    let framedAspect = 0;

    view.scene = set.scene;

    function update(dt) {
        if (disposed) return;
        time += dt;
        spin += dt * TURNTABLE.speed;
        set.top.rotation.y = spin;
        const angle = 0.6 + Math.sin(time * 0.11) * 0.36;
        const distance = CAMERA.distance + Math.sin(time * 0.07 + 1) * 0.45;
        camera.position.set(Math.sin(angle) * distance, CAMERA.height + Math.sin(time * 0.09) * 0.18, Math.cos(angle) * distance);
        camera.lookAt(0, CAMERA.look, 0);
        if (camera.aspect !== framedAspect) frame();
        set.mirror?.fit(stage.renderer);
    }

    /** Shifts the lens so the car sits in the free middle of the garage screen (wide screens only). */
    function frame() {
        framedAspect = camera.aspect;
        const width = stage.size().width;
        const fraction = camera.aspect > 1.3 ? Math.min(0.06, MENU_SHIFT_PX / Math.max(1, width)) : 0;
        camera.filmOffset = fraction * 70 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
        camera.updateProjectionMatrix();
    }

    /** Builds the current car onto the turntable of the current set (replaces the one there). */
    function placeCar() {
        if (car) {
            car.removeFromParent();
            car.userData.dispose?.();
            car = null;
        }
        if (!carView) return;
        car = buildCar(carView);
        car.position.y = TURNTABLE.top;
        // the headlight beam lies on the road in a run; the turntable has no road
        if (car.userData.beam) car.userData.beam.visible = false;
        if (set.quality === 'high') {
            car.traverse(o => {
                if (o.isMesh && !(Array.isArray(o.material) ? o.material.some(x => x.transparent) : o.material?.transparent)) o.castShadow = true;
            });
        }
        set.top.add(car);
    }

    /** A new picture quality: the room, the lights and the car for the new tier, shown in the same frame; then the old set is freed. */
    function rebuild(quality) {
        const old = set;
        set = buildSet(stage, quality);
        set.top.rotation.y = spin;
        view.scene = set.scene;
        try {
            placeCar();
        } finally {
            // even when the car could not be built: the new room is shown and the old one freed
            stage.show(view);
            old.dispose();
        }
    }

    const unsubscribe = settings.onChange(s => {
        if (!disposed && s.quality !== set.quality) rebuild(s.quality);
    });

    stage.show(view);
    return {
        /** Puts this car on the turntable (replaces the one there). */
        show(next) {
            if (disposed) return;
            carView = next;
            placeCar();
        },

        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            if (stage.view === view) stage.clear();
            if (car) car.userData.dispose?.();
            car = null;
            set.dispose();
        },
    };
}

/**
 * The garage for one quality: room, turntable, lights, the baked reflection map and the floor mirror (medium/high).
 * Frees the other qualities' factory materials first (render/materials.js trimMaterials).
 */
function buildSet(stage, quality) {
    trimMaterials(quality);
    const pbr = quality !== 'low';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c10);
    scene.fog = new THREE.Fog(0x0b0c10, 18, 60);
    scene.userData.post = POST;
    const room = buildRoom(quality);
    scene.add(room.group);
    const turntable = buildTurntable(quality);
    scene.add(turntable.base, turntable.top);
    addLights(scene, quality);

    // the reflection map is this room seen from the car (before the glows, pools and the mirror go in)
    let environment = null;
    if (pbr && stage.renderer) {
        const generator = new THREE.PMREMGenerator(stage.renderer);
        environment = generator.fromScene(scene, 0.015, 0.1, 60, { size: quality === 'high' ? 512 : 256, position: new THREE.Vector3(0, 1.0, 0) });
        generator.dispose();
        scene.environment = environment.texture;
        scene.environmentIntensity = 1;
    }
    scene.add(room.effects, turntable.effects);
    const mirror = pbr ? floorMirror(quality, stage.renderer) : null;
    if (mirror) scene.add(mirror.mesh);

    return {
        quality,
        scene,
        top: turntable.top,
        mirror,
        dispose() {
            if (mirror) {
                mirror.mesh.removeFromParent();
                mirror.dispose();
            }
            scene.environment = null;
            environment?.dispose();
            disposeTree(scene);
        },
    };
}

/** The turntable: a brushed plinth with an LED ring at its foot (fixed) and the anthracite top in segments with a chrome edge (turning). */
function buildTurntable(quality) {
    const M = materialsFor(quality);
    const { radius: R, top: TOP } = TURNTABLE;
    const base = new THREE.Group();
    const band = new THREE.CylinderGeometry(R + 0.03, R + 0.06, TOP - 0.03, 120, 1, true).translate(0, (TOP - 0.03) / 2, 0);
    // brushed around: u along the circumference in metres
    const uv = band.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * R, uv.getY(i) * 0.1);
    base.add(new THREE.Mesh(band, M.metal({ brushed: true, roughness: 0.22 })));
    base.add(new THREE.Mesh(new THREE.RingGeometry(R - 0.1, R + 0.03, 120).rotateX(-Math.PI / 2).translate(0, TOP - 0.03, 0), M.painted({ color: 0x15161a, roughness: 0.6 })));
    base.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.014, 6, 180).rotateX(Math.PI / 2).translate(0, 0.014, 0), M.emissive(0xff2e88, 3.5)));

    const top = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.025, 120).translate(0, TOP - 0.0125, 0), M.painted({ color: 0x2b2d33, roughness: 0.42 }));
    disc.receiveShadow = true;
    top.add(disc);
    top.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.012, 6, 180).rotateX(Math.PI / 2).translate(0, TOP, 0), M.chrome()));
    // the plates' seams (radial) and two grooves: the turning shows
    const seams = [];
    for (let k = 0; k < 8; k++) seams.push(new THREE.PlaneGeometry(0.014, R - 0.5).rotateX(-Math.PI / 2).translate(0, TOP + 0.001, 0.5 + (R - 0.5) / 2).rotateY((k / 8) * Math.PI * 2));
    for (const r of [0.5, R - 0.35]) seams.push(new THREE.RingGeometry(r - 0.008, r + 0.008, 120).rotateX(-Math.PI / 2).translate(0, TOP + 0.001, 0));
    for (const g of seams) top.add(new THREE.Mesh(g, M.painted({ color: 0x111215, roughness: 0.7 })));

    const glows = new GlowPoints();
    for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        glows.add(Math.sin(a) * (R + 0.1), 0.03, Math.cos(a) * (R + 0.1), 0.5, 0xff2e88);
    }
    const pools = new LightPools();
    pools.add(0, 0, 0, R + 0.9, 0xff2e88, 0.16);
    pools.add(0, 0, 0, R + 0.4, 0xfff2e0, 0.08);
    const effects = new THREE.Group();
    effects.add(glows.build({ fogFar: 80 }), pools.build());
    return { base, top, effects };
}

/**
 * The real lights: the overhead key (with the car's shadow on high), two rims from the strip boxes; on medium/high also the fill from
 * behind the camera and two tube lights over the props. Low keeps the old cost: a hemisphere and three spots.
 */
function addLights(scene, quality) {
    const pbr = quality !== 'low';
    scene.add(new THREE.HemisphereLight(0xa4acc4, 0x2c2824, pbr ? 0.3 : 1.9));
    const spot = (s, color, intensity, distance, angle, penumbra) => {
        const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
        light.position.set(s.x, s.y, s.z);
        light.target.position.set(...(s.target ?? [s.x, 0, s.z]));
        scene.add(light, light.target);
        return light;
    };
    const key = spot(STUDIO.key, kelvinHex(5600), pbr ? 170 : 170, 16, 0.62, 0.8);
    if (quality === 'high') {
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 4;
        key.shadow.camera.near = 1.5;
        key.shadow.camera.far = 7;
    }
    spot(STUDIO.rimLeft, kelvinHex(5600), 170, 12, 0.5, 0.85);
    spot(STUDIO.rimRight, kelvinHex(5600), 170, 12, 0.5, 0.85);
    if (!pbr) return;
    spot(STUDIO.fill, kelvinHex(5000), 260, 18, 0.5, 0.95);
    for (const t of STUDIO.tubes) spot(t, LIGHT_PRESETS.tube.color, LIGHT_PRESETS.tube.intensity * 2.2, LIGHT_PRESETS.tube.distance, Math.PI / 2 - 0.01, 0.4);
}

// ---- the floor mirror: the room rendered mirrored at reduced resolution, laid over the epoxy floor with its Fresnel factor, blurred
// through the mip chain where the floor is rough (scuffs and tyre marks break it up)

const MIRROR_SHADER = {
    name: 'GarageFloorMirror',
    uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        roughnessMap: { value: null },
        floorTile: { value: FLOOR.tile },
        strength: { value: 0.62 },
        blur: { value: 1.2 },
    },
    vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vMirrorUv;
        varying vec3 vWorld;
        void main() {
            vMirrorUv = textureMatrix * vec4(position, 1.0);
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
        }`,
    fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform sampler2D roughnessMap;
        uniform float strength;
        uniform float blur;
        uniform float floorTile;
        varying vec4 vMirrorUv;
        varying vec3 vWorld;
        void main() {
            vec3 toEye = normalize(cameraPosition - vWorld);
            float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(toEye.y, 0.0, 1.0), 5.0);
            // the floor's roughness (ORM green, 6 m tile, the floor's metric UVs)
            float rough = texture2D(roughnessMap, vec2(vWorld.x, -vWorld.z) / floorTile, 3.0).g;
            float gloss = 1.0 - 0.6 * smoothstep(0.38, 0.7, rough);
            vec3 mirrored = texture2DProj(tDiffuse, vMirrorUv, blur + rough * 2.5).rgb;
            gl_FragColor = vec4(mirrored * color, clamp(fresnel * strength * gloss, 0.0, 1.0));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
};

/** The mirror over the floor (medium/high): { mesh, fit(renderer) – follows the canvas size, dispose() }. */
function floorMirror(quality, renderer) {
    const scale = quality === 'high' ? 0.5 : 0.4;
    const size = new THREE.Vector2(1024, 576);
    if (renderer) renderer.getDrawingBufferSize(size);
    const width = ROOM.x1 - ROOM.x0;
    const depth = ROOM.z1 - ROOM.z0;
    const mesh = new Reflector(new THREE.PlaneGeometry(width, depth), {
        color: 0xffffff,
        textureWidth: Math.max(64, Math.round(size.x * scale)),
        textureHeight: Math.max(64, Math.round(size.y * scale)),
        clipBias: 0.002,
        multisample: 0,
        shader: MIRROR_SHADER,
    });
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((ROOM.x0 + ROOM.x1) / 2, 0.004, (ROOM.z0 + ROOM.z1) / 2);
    mesh.renderOrder = -1;
    const target = mesh.getRenderTarget();
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const material = mesh.material;
    material.transparent = true;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    material.uniforms.roughnessMap.value = texturesFor(quality).floor().roughnessMap;
    const last = size.clone();
    return {
        mesh,
        fit(r) {
            r.getDrawingBufferSize(size);
            if (size.equals(last)) return;
            last.copy(size);
            target.setSize(Math.max(64, Math.round(size.x * scale)), Math.max(64, Math.round(size.y * scale)));
        },
        dispose() {
            mesh.geometry.dispose();
            mesh.dispose();
        },
    };
}
