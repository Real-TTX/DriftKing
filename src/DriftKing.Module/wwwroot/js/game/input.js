// DriftKing · input.js – the controls of a run: keyboard, gamepad (standard mapping) and on touch screens big buttons over the HUD.
//   W/↑ gas · S/↓ brake (reverse when standing) · A/D/←/→ steer · Space handbrake · Q/E shift down/up (manual) · C camera · R reset · Esc pause
//   Gamepad: RT gas · LT brake · left stick steer · A handbrake · LB/RB shift · Y camera · B reset · Start pause

const KEYS = {
    gas: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'],
};
const EDGES = { KeyQ: 'shiftDown', KeyE: 'shiftUp', KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause' };
const PAD = { gas: 7, brake: 6, handbrake: 0, shiftDown: 4, shiftUp: 5, camera: 3, reset: 1, pause: 9 };

/**
 * Starts listening. touchHost: where the touch buttons go (the HUD element), only on coarse pointers.
 * @returns {{ read(dt: number): { throttle:number, brake:number, steer:number, handbrake:number, shiftUp:boolean, shiftDown:boolean, camera:boolean, reset:boolean, pause:boolean }, dispose(): void }}
 */
export function createInput({ touchHost = null } = {}) {
    const down = new Set();
    const edges = { shiftUp: false, shiftDown: false, camera: false, reset: false, pause: false };
    const touch = { gas: false, brake: false, left: false, right: false, handbrake: false };
    const padBefore = {};
    const state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false, camera: false, reset: false, pause: false };

    const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
    const onKeyDown = e => {
        if (typing(e)) return;
        if (EDGES[e.code] && !e.repeat) edges[EDGES[e.code]] = true;
        down.add(e.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = e => down.delete(e.code);
    const onBlur = () => down.clear();
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', onBlur);
    const touchPanel = touchHost && matchMedia('(pointer: coarse)').matches ? buildTouch(touchHost, touch, edges) : null;

    const held = name => KEYS[name].some(code => down.has(code)) || touch[name];

    return {
        read(dt) {
            const pad = readPad(padBefore, edges);
            const gas = Math.max(held('gas') ? 1 : 0, pad.gas);
            const brake = Math.max(held('brake') ? 1 : 0, pad.brake);
            state.throttle = approach(state.throttle, gas, dt * (gas > state.throttle ? 7 : 12));
            state.brake = approach(state.brake, brake, dt * 10);
            const keySteer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
            if (Math.abs(pad.steer) > 0.01) {
                state.steer = pad.steer;
            } else {
                const back = keySteer === 0 || Math.sign(keySteer) !== Math.sign(state.steer);
                state.steer = approach(state.steer, keySteer, dt * (back ? 9 : 5.5));
            }
            state.handbrake = held('handbrake') || pad.handbrake > 0.5 ? 1 : 0;
            Object.assign(state, edges);
            for (const k of Object.keys(edges)) edges[k] = false;
            return state;
        },
        dispose() {
            removeEventListener('keydown', onKeyDown);
            removeEventListener('keyup', onKeyUp);
            removeEventListener('blur', onBlur);
            touchPanel?.remove();
        },
    };
}

function approach(value, target, step) {
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/** The first gamepad: analog values and the edges of its buttons. */
function readPad(before, edges) {
    const result = { gas: 0, brake: 0, steer: 0, handbrake: 0 };
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find(p => p && p.connected);
    if (!pad) return result;
    const value = i => pad.buttons[i]?.value ?? 0;
    result.gas = value(PAD.gas);
    result.brake = value(PAD.brake);
    result.handbrake = value(PAD.handbrake);
    const x = pad.axes[0] ?? 0;
    result.steer = Math.abs(x) < 0.12 ? 0 : Math.sign(x) * ((Math.abs(x) - 0.12) / 0.88) ** 1.4;
    for (const name of ['shiftDown', 'shiftUp', 'camera', 'reset', 'pause']) {
        const pressed = value(PAD[name]) > 0.5;
        if (pressed && !before[name]) edges[name] = true;
        before[name] = pressed;
    }
    return result;
}

/** Big touch buttons: steer left/right on the left, gas, brake and handbrake on the right, pause at the top. */
function buildTouch(host, touch, edges) {
    const panel = document.createElement('div');
    panel.className = 'dk-touch';
    panel.innerHTML = `
        <button type="button" class="dk-touch__btn dk-touch__left" data-hold="left" aria-label="Links">◀</button>
        <button type="button" class="dk-touch__btn dk-touch__right" data-hold="right" aria-label="Rechts">▶</button>
        <button type="button" class="dk-touch__btn dk-touch__gas" data-hold="gas">GAS</button>
        <button type="button" class="dk-touch__btn dk-touch__brake" data-hold="brake">BREMSE</button>
        <button type="button" class="dk-touch__btn dk-touch__hand" data-hold="handbrake">HAND</button>
        <button type="button" class="dk-touch__btn dk-touch__pause" data-edge="pause" aria-label="Pause">❚❚</button>`;
    for (const button of panel.querySelectorAll('[data-hold]')) {
        const name = button.dataset.hold;
        const on = e => {
            e.preventDefault();
            touch[name] = true;
            button.classList.add('is-down');
        };
        const off = () => {
            touch[name] = false;
            button.classList.remove('is-down');
        };
        button.addEventListener('pointerdown', on);
        button.addEventListener('pointerup', off);
        button.addEventListener('pointercancel', off);
        button.addEventListener('pointerleave', off);
    }
    panel.querySelector('[data-edge]').addEventListener('pointerdown', e => {
        e.preventDefault();
        edges.pause = true;
    });
    host.appendChild(panel);
    return panel;
}
