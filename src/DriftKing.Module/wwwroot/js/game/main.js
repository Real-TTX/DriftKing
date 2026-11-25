// DriftKing · main.js – the entry of the player app: the stage, the connection (master, app shell or offline), the menus, and the run when a room
// counts down (solo at once, online when the host starts). The run ends with the results; then the menus come back.

import { api, session } from './api.js';
import { createStage } from './render/stage.js';
import { menu, showPause, showResults } from './menu.js';
import { startSolo } from './menu-play.js';
import { nav } from './nav.js';
import { launchRun } from './net.js';
import { audio } from './audio.js';
import { toast, wireSounds } from './ui.js';

let stage = null;
let active = null;
let starting = null;
let offs = [];

async function start() {
    stage = createStage(document.getElementById('dk-stage'));
    menu.mount(stage);
    nav.run = room => run(room);
    wireSounds(document.body);
    addEventListener('pointerdown', () => audio.unlock(), { once: true });
    addEventListener('keydown', () => audio.unlock(), { once: true });
    await document.fonts.load('40px Anton').catch(() => {});
    try {
        await api.connect();
    } catch (error) {
        toast(error.message, 'bad', 6000);
    }
    listen();
    api.onSession(() => {
        listen();
        menu.refreshTop();
    });
    document.getElementById('dk-boot')?.remove();
    const code = menu.invitation();
    await menu.show(session.signedIn ? (code ? 'online' : 'home') : 'auth', { code });
}

/** The hub messages outside a run (registered again when the connection changes). */
function listen() {
    for (const off of offs) off();
    offs = [
        api.on('Room', room => {
            if (room.status === 'countdown' && nav.room && room.code === nav.room.code) run(room);
        }),
        api.on('Closed', reason => {
            if (!active) toast(reason, 'bad', 5000);
        }),
    ];
}

/** Starts the run of a room that counts down (once per room). */
async function run(room) {
    if ((active && active.room.token === room.token) || starting === room.token) return;
    starting = room.token;
    active?.dispose();
    active = null;
    menu.hide();
    document.getElementById('dk-loading').hidden = false;
    const levelBefore = session.player?.level ?? null;
    let closePause = null;
    try {
        active = await launchRun(stage, room, {
            pause: () => {
                if (closePause) return;
                active?.setPaused(true);
                closePause = showPause({
                    mode: room.mode,
                    online: !room.isSolo,
                    onResume: () => {
                        closePause = null;
                        active?.setPaused(false);
                    },
                    onQuit: () => {
                        closePause = null;
                        active?.setPaused(false);
                        quit(room);
                    },
                });
            },
            results: async results => {
                closePause?.();
                closePause = null;
                await api.refreshSession().catch(() => {});
                const again = room.isSolo && nav.lastSolo ? () => playAgain() : null;
                showResults(results, { mySeat: active?.mySeat, levelBefore, onAgain: again, onMenu: () => backToMenu(room) });
            },
            closed: reason => {
                toast(reason, 'bad', 5000);
                backToMenu(room);
            },
            error: error => toast(error.message, 'bad', 4000),
        });
    } catch (error) {
        console.error(error);
        toast(`Der Lauf ließ sich nicht laden: ${error.message}`, 'bad', 6000);
        await api.invoke('LeaveRoom').catch(() => {});
        backToMenu(room);
    } finally {
        starting = null;
        document.getElementById('dk-loading').hidden = true;
    }
}

/** Quitting from the pause menu: alone the run is scored as it is, online the room is left. */
function quit(room) {
    if (room.isSolo) {
        active?.finishNow();
        return;
    }
    api.invoke('LeaveRoom').catch(() => {});
    backToMenu(room);
}

async function playAgain() {
    const options = nav.lastSolo;
    end();
    try {
        await startSolo(options);
    } catch (error) {
        toast(error.message, 'bad', 4000);
        menu.show('home');
    }
}

function end() {
    active?.dispose();
    active = null;
    document.getElementById('dk-overlay').hidden = true;
}

async function backToMenu(room) {
    end();
    nav.room = null;
    await api.refreshSession().catch(() => {});
    menu.show(room.isSolo ? (room.competitionId ? 'competitions' : 'solo') : 'online');
}

start();
