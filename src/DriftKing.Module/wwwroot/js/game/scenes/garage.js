// DriftKing · scenes/garage.js – the car on a turntable in a dark garage: a glossy floor, neon tubes on the walls, tool shelves,
// a ring of light around the turntable. show(carView) swaps the car at once (paint, rims, neon, decal or body changed in the menu).

import * as THREE from 'three';
import { buildCar } from '../car/models.js';
import { box, canvasTexture, disposeTree, GlowPoints, LightPools, mergeGeometries, tint } from '../render/kit.js';

/**
 * Shows the garage on the stage (until dispose()).
 * @param {ReturnType<import('../render/stage.js').createStage>} stage
 * @returns {Promise<{ show(carView: object): void, dispose(): void }>}
 */
export async function createGarageScene(stage) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07060f);
    scene.fog = new THREE.Fog(0x07060f, 18, 46);
    scene.add(new THREE.HemisphereLight(0x8a90d8, 0x1a1420, 0.9));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.4);
    key.position.set(4, 9, 6);
    scene.add(key);
    const rimPink = new THREE.PointLight(0xff2e88, 30, 16, 1.6);
    rimPink.position.set(-5, 2.5, -3);
    const rimCyan = new THREE.PointLight(0x29e7ff, 30, 16, 1.6);
    rimCyan.position.set(5, 2.5, -3);
    scene.add(rimPink, rimCyan);

    const room = buildRoom();
    scene.add(room);
    const turntable = new THREE.Group();
    scene.add(turntable);
    turntable.add(new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.12, 48), new THREE.MeshPhongMaterial({ color: 0x24222e, shininess: 90, specular: 0x666688 })));
    turntable.children[0].position.y = 0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.04, 6, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2e88 }));
    ring.position.y = 0.12;
    scene.add(ring);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    let car = null;
    let disposed = false;
    let time = 0;

    function update(dt) {
        if (disposed) return;
        time += dt;
        turntable.rotation.y += dt * 0.28;
        const sway = Math.sin(time * 0.25) * 0.35;
        camera.position.set(Math.sin(0.65 + sway) * 9.2, 2.7 + Math.sin(time * 0.4) * 0.15, Math.cos(0.65 + sway) * 9.2);
        camera.lookAt(0, 0.75, 0);
        ring.material.color.setHSL(0.92 + Math.sin(time * 0.6) * 0.04, 1, 0.58);
    }

    stage.show({ scene, camera, update });
    const view = stage.view;
    return {
        /** Puts this car on the turntable (replaces the one there). */
        show(carView) {
            if (disposed) return;
            if (car) {
                car.removeFromParent();
                car.userData.dispose();
            }
            car = buildCar(carView);
            car.position.y = 0.12;
            // the headlight beam lies on the road in a run; the turntable has no road
            car.userData.beam.visible = false;
            turntable.add(car);
        },

        dispose() {
            if (disposed) return;
            disposed = true;
            if (stage.view === view) stage.clear();
            if (car) car.userData.dispose();
            car = null;
            turntable.clear();
            disposeTree(scene);
        },
    };
}

/** Floor, walls, neon tubes, shelves and the roller door: one batch per material. */
function buildRoom() {
    const room = new THREE.Group();
    const floorTexture = canvasTexture(256, 256, (c, w) => {
        c.fillStyle = '#1b1a24';
        c.fillRect(0, 0, w, w);
        c.strokeStyle = 'rgba(255,255,255,0.05)';
        c.lineWidth = 2;
        for (let k = 0; k <= 4; k++) {
            c.beginPath();
            c.moveTo(k * 64, 0);
            c.lineTo(k * 64, w);
            c.moveTo(0, k * 64);
            c.lineTo(w, k * 64);
            c.stroke();
        }
    }, { repeat: true });
    floorTexture.repeat.set(8, 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshPhongMaterial({ map: floorTexture, shininess: 120, specular: 0x444466 }));
    room.add(floor);
    const walls = mergeGeometries([
        box(28, 8, 0.4, 0, 4, -9),
        box(0.4, 8, 22, -12, 4, 0),
        box(0.4, 8, 22, 12, 4, 0),
    ]);
    room.add(new THREE.Mesh(walls, new THREE.MeshLambertMaterial({ color: 0x1e1c2a })));
    // the roller door behind the car
    const door = canvasTexture(64, 128, (c, w, h) => {
        c.fillStyle = '#2c2a38';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = 0; y < h; y += 8) c.fillRect(0, y, w, 2);
    }, { repeat: true });
    door.repeat.set(4, 2);
    const doorMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshLambertMaterial({ map: door }));
    doorMesh.position.set(0, 2.5, -8.78);
    room.add(doorMesh);
    // neon tubes: two horizontal lines on the back wall, vertical ones in the corners
    const glows = new GlowPoints();
    const tubes = [
        { g: box(10, 0.08, 0.08, 0, 5.6, -8.75), colour: 0xff2e88 },
        { g: box(10, 0.08, 0.08, 0, 5.9, -8.75), colour: 0x29e7ff },
        { g: box(0.08, 5, 0.08, -11.75, 3, -6), colour: 0x8b5cf6 },
        { g: box(0.08, 5, 0.08, 11.75, 3, -6), colour: 0x8b5cf6 },
    ];
    for (const t of tubes) {
        room.add(new THREE.Mesh(t.g, new THREE.MeshBasicMaterial({ color: t.colour })));
        t.g.computeBoundingBox();
        const b = t.g.boundingBox;
        const steps = 8;
        for (let k = 0; k <= steps; k++) {
            const f = k / steps;
            glows.add(b.min.x + (b.max.x - b.min.x) * f, b.min.y + (b.max.y - b.min.y) * f, (b.min.z + b.max.z) / 2 + 0.2, 1.6, t.colour);
        }
    }
    // shelves with boxes and tyre stacks at the side walls
    const shelf = [];
    for (const x of [-10.8, 10.8]) {
        for (const y of [1, 2.2, 3.4]) shelf.push(tint(box(1.2, 0.08, 5, x, y, -3), 0x3a3846));
        for (let k = 0; k < 5; k++) shelf.push(tint(box(0.8, 0.6, 0.8, x, 1.34 + (k % 3) * 1.2, -5 + k * 1.1), [0xd2702a, 0x2f5f9e, 0x8a8f99, 0xc9a43a, 0x1f7f86][k]));
    }
    for (let k = 0; k < 4; k++) shelf.push(tint(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12).translate(-8.5, 0.14 + k * 0.29, -6.5), 0x111016));
    room.add(new THREE.Mesh(mergeGeometries(shelf), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const pools = new LightPools();
    pools.add(0, 0.01, 0, 5.5, 0xffffff, 0.22);
    pools.add(0, 0.01, -7, 6, 0xff2e88, 0.35);
    pools.add(-9, 0.01, -5, 4, 0x8b5cf6, 0.3);
    pools.add(9, 0.01, -5, 4, 0x8b5cf6, 0.3);
    room.add(pools.build(), glows.build({ fogFar: 60 }));
    return room;
}
