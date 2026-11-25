// DriftKing · net.js – one run between the room (hub or the app's offline game) and the 3D run (run/run.js):
// the seats as the run sees them (me / bot / remote), the clock of the server, the states and finishes to the room, the states of the others into the run,
// and the room's end (Results) or loss (Closed) back to the menus.

import { api, session } from './api.js';
import { startRun } from './run/run.js';

/**
 * Starts the run of a room that is counting down. handlers: pause(), results(ResultsView), closed(reason), error(error).
 * Returns { room, mySeat, online, finishNow(), setPaused(bool), dispose() }.
 */
export async function launchRun(stage, room, handlers) {
    const me = session.player?.id;
    const mySeat = room.seats.find(s => s.playerId === me)?.seat ?? null;
    // the server's clock: startAt is server time, the run counts in this browser's Date.now()
    const offset = room.serverNow - Date.now();
    const countdownAt = room.startAt != null ? room.startAt - offset : null;
    const simulateBots = room.hostSeat === mySeat;
    const finished = new Set();
    const offs = [];

    const run = await startRun(stage, {
        map: room.map,
        mode: room.mode,
        laps: room.laps,
        durationS: room.durationS,
        seats: room.seats.map(s => ({
            seat: s.seat,
            name: s.name,
            kind: s.playerId != null && s.playerId === me ? 'me' : s.kind === 'bot' ? 'bot' : 'remote',
            car: s.car,
            skill: Math.max(0.05, Math.min(1, (s.skill || 5) / 10)),
        })),
        simulateBots,
        countdownAt,
        goals: room.goals ?? null,
        hud: document.getElementById('dk-hud'),
        events: {
            state: (seat, packed) => api.send('State', seat, packed),
            finish: (seat, result) => {
                if (finished.has(seat)) return;
                finished.add(seat);
                api.invoke('Finish', seat, toFinishInput(result)).catch(error => handlers.error?.(error));
            },
            pause: () => handlers.pause?.(),
        },
    });

    offs.push(api.on('State', (seat, packed) => run.remote(seat, packed)));
    offs.push(api.on('Left', seat => seat !== mySeat && run.leave(seat)));
    offs.push(api.on('Results', results => handlers.results?.(results)));
    offs.push(api.on('Closed', reason => handlers.closed?.(reason)));

    return {
        room,
        mySeat,
        online: !room.isSolo,
        finishNow: () => run.finishNow(),
        setPaused: paused => {
            if (room.isSolo) run.setPaused(paused);
        },
        dispose() {
            for (const off of offs) off();
            run.dispose();
        },
    };
}

/** The result in the shapes the server binds (whole numbers where it expects them). */
function toFinishInput(result) {
    const int = v => (Number.isFinite(v) ? Math.round(v) : 0);
    const optional = v => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    return {
        score: int(result.score),
        timeMs: optional(result.timeMs),
        bestLapMs: optional(result.bestLapMs),
        laps: int(result.laps),
        bestCombo: int(result.bestCombo),
        maxAngle: Number.isFinite(result.maxAngle) ? Math.round(result.maxAngle * 10) / 10 : 0,
        driftDistanceM: Number.isFinite(result.driftDistanceM) ? Math.round(result.driftDistanceM) : 0,
        collisions: int(result.collisions),
    };
}
