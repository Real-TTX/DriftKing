// DriftKing · menu-play.js – the screens to start driving: alone against bots ("Fahren"), the competitions, and online rooms (lobby list,
// own room with seats, ready and start). A run starts when the room counts down (nav.run).

import { api, session, BASE } from './api.js';
import { nav } from './nav.js';
import { MAPS, MODES, formatMoney, formatPoints, formatTime } from './catalog.js';
import { html, raw, $, $$, icon, toast, busy, modal, medal } from './ui.js';
import { frame, wireBack } from './menu.js';

const DURATIONS = [60, 90, 120, 180, 300];

// ---------------------------------------------------------------- shared: map cards and run options

function mapCards(maps, selected) {
    return raw(maps.map(m => html`<button class="map-card map-card--${m.key} ${m.key === selected ? 'active' : ''}" data-map="${m.key}" ${m.locked ? 'disabled' : ''}>
        <span class="map-art" aria-hidden="true"></span>
        <span class="map-info"><b>${m.name}</b><small>${MAPS[m.key]?.kind ?? ''} · ${(m.lengthM / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km · ${m.timeOfDay === 'dusk' ? 'Dämmerung' : 'Nacht'}</small></span>
        ${m.locked ? raw(`<span class="lock">${icon('lock')} ab Level ${m.unlockLevel}</span>`) : ''}
    </button>`).join(''));
}

/** The form of a run: mode, time or laps, bots and their skill. withBots = false for rooms where friends drive. */
function optionsForm(o, { withBots = true } = {}) {
    return html`<div class="options">
        <div class="field"><span>Modus</span><div class="seg">${Object.entries(MODES).map(([k, m]) => raw(html`<button type="button" class="${k === o.mode ? 'active' : ''}" data-mode="${k}" title="${m.text}">${m.name}</button>`))}</div>
            <small class="hint">${MODES[o.mode].text}</small></div>
        <div class="field" ${o.mode === 'score' ? '' : 'hidden'}><span>Zeit</span><div class="seg">${DURATIONS.map(d => raw(html`<button type="button" class="${d === o.durationS ? 'active' : ''}" data-duration="${d}">${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')} min</button>`))}</div></div>
        <div class="field" ${o.mode === 'race' ? '' : 'hidden'}><span>Runden</span><div class="seg">${[1, 2, 3, 4, 5, 8].map(l => raw(html`<button type="button" class="${l === o.laps ? 'active' : ''}" data-laps="${l}">${l}</button>`))}</div></div>
        <div class="field"><span>${withBots ? 'Gegner' : 'Bots dazu'}</span><div class="seg">${[0, 1, 2, 3, 5, 7].map(b => raw(html`<button type="button" class="${b === o.bots ? 'active' : ''}" data-bots="${b}">${b === 0 ? 'keine' : b}</button>`))}</div></div>
        <div class="field" ${o.bots > 0 ? '' : 'hidden'}><span>Können der Gegner <b data-skill-label>${o.botSkill}</b></span><input type="range" min="1" max="10" step="1" value="${o.botSkill}" data-skill /></div>
    </div>`;
}

/** Wires an options form: every change calls changed(o) after updating o. */
function wireOptions(el, o, changed) {
    $$('[data-mode]', el).forEach(b => b.addEventListener('click', () => changed({ ...o, mode: b.dataset.mode })));
    $$('[data-duration]', el).forEach(b => b.addEventListener('click', () => changed({ ...o, durationS: Number(b.dataset.duration) })));
    $$('[data-laps]', el).forEach(b => b.addEventListener('click', () => changed({ ...o, laps: Number(b.dataset.laps) })));
    $$('[data-bots]', el).forEach(b => b.addEventListener('click', () => changed({ ...o, bots: Number(b.dataset.bots) })));
    const skill = $('[data-skill]', el);
    skill?.addEventListener('input', () => ($('[data-skill-label]', el).textContent = skill.value));
    skill?.addEventListener('change', () => changed({ ...o, botSkill: Number(skill.value) }));
}

// ---------------------------------------------------------------- alone against bots

async function solo(el) {
    const catalog = await api.get('/catalog');
    const maps = catalog.maps;
    const saved = nav.lastSolo ?? {};
    let o = {
        map: maps.find(m => m.key === saved.map && !m.locked)?.key ?? maps.find(m => !m.locked)?.key,
        mode: saved.mode ?? 'score',
        durationS: saved.durationS ?? 120,
        laps: saved.laps ?? 3,
        bots: saved.bots ?? 3,
        botSkill: saved.botSkill ?? 4,
    };
    el.innerHTML = frame('Fahren', 'Allein gegen Bots – auf Zeit, auf Punkte oder einfach so.');
    wireBack(el);
    const body = $('.screen-body', el);
    const render = () => {
        body.innerHTML = html`<div class="map-grid">${mapCards(maps, o.map)}</div>
            <div class="panel">${raw(optionsForm(o))}
                <div class="row row--end"><button class="btn btn--go btn--big" data-start>${raw(icon('play'))} Los!</button></div></div>`;
        $$('[data-map]', body).forEach(b => b.addEventListener('click', () => {
            o = { ...o, map: b.dataset.map };
            render();
        }));
        wireOptions(body, o, next => {
            o = next;
            render();
        });
        $('[data-start]', body).addEventListener('click', e => busy(e.currentTarget, () => startSolo(o)));
    };
    render();
}

/** Starts a solo run (also "Nochmal" from the results). */
export async function startSolo(o) {
    nav.lastSolo = { ...o };
    const room = await api.invoke('Solo', {
        map: o.map ?? null,
        mode: o.mode ?? null,
        laps: o.laps ?? null,
        durationS: o.durationS ?? null,
        bots: o.bots ?? null,
        botSkill: o.botSkill ?? null,
        isPrivate: true,
        competitionId: o.competitionId ?? null,
    });
    await nav.run(room);
}

// ---------------------------------------------------------------- competitions

function goalText(goals, value) {
    return goals.metric === 'time' ? formatTime(value) : formatPoints(value);
}

async function competitions(el) {
    const list = await api.get('/competitions');
    el.innerHTML = frame('Wettbewerbe', 'Feste Aufgaben mit Medaillen – jede Medaille zahlt einmal Preisgeld.');
    wireBack(el);
    const body = $('.screen-body', el);
    if (!list.length) {
        body.innerHTML = '<div class="panel"><p class="hint">Gerade läuft kein Wettbewerb.</p></div>';
        return;
    }
    body.innerHTML = html`<div class="comp-grid">${list.map(c => raw(html`<article class="panel comp-card ${c.locked ? 'locked' : ''}">
        <header><span class="kicker">${c.map.name} · ${MODES[c.mode]?.name ?? c.mode} · ${c.mode === 'race' ? `${c.laps} Runden` : `${c.durationS} s`}</span>
            <h2>${c.name}</h2>${c.mine ? raw(medal(c.mine.medal)) : ''}</header>
        <p>${c.description}</p>
        <ul class="goals">
            ${['gold', 'silver', 'bronze'].map(k => raw(html`<li class="${c.mine && rank(c.mine.medal) >= rank(k) ? 'reached' : ''}">${raw(medal(k))}<b>${goalText(c.goals, c.goals[k])}</b><em>${formatMoney(c.rewards[k])}</em></li>`))}
        </ul>
        <footer>
            <span class="hint">${c.mine ? `Bestwert: ${c.goals.metric === 'time' ? (c.mine.bestTimeMs ? formatTime(c.mine.bestTimeMs) : '–') : formatPoints(c.mine.bestScore)} · ${c.mine.attempts}× gefahren` : `${c.bots} Gegner · Können ${c.botSkill}`}${c.endDate ? ` · bis ${new Date(c.endDate).toLocaleDateString('de-DE')}` : ''}</span>
            <div class="row">
                <button class="btn btn--small btn--ghost" data-board="${c.id}" data-name="${c.name}" data-metric="${c.goals.metric}">Rangliste</button>
                ${c.locked ? raw(`<span class="lock">${icon('lock')} ab Level ${c.unlockLevel}</span>`) : raw(html`<button class="btn btn--go btn--small" data-enter="${c.id}">${raw(icon('play'))} Starten</button>`)}
            </div>
        </footer></article>`))}</div>`;
    $$('[data-enter]', body).forEach(b => b.addEventListener('click', () => busy(b, () => startSolo({ competitionId: Number(b.dataset.enter) }))));
    $$('[data-board]', body).forEach(b => b.addEventListener('click', () => busy(b, async () => {
        const rows = await api.get(`/competitions/${b.dataset.board}/leaderboard`);
        const time = b.dataset.metric === 'time';
        modal(html`<h2 class="title">${b.dataset.name}</h2>${rows.length ? raw(html`<table class="table"><thead><tr><th class="num">#</th><th>Fahrer</th><th class="num">${time ? 'Zeit' : 'Punkte'}</th><th>Medaille</th></tr></thead><tbody>
            ${rows.map(r => raw(html`<tr class="${r.isMe ? 'me' : ''}"><td class="num"><span class="place place--${r.rank}">${r.rank}</span></td><td>${r.name}</td>
            <td class="num">${time ? formatTime(r.timeMs) : formatPoints(r.value)}</td><td>${raw(medal(r.medal))}</td></tr>`))}</tbody></table>`) : raw('<p class="hint">Noch niemand mit Konto ist angetreten.</p>')}`);
    })));
}

function rank(medalKind) {
    return { none: 0, bronze: 1, silver: 2, gold: 3 }[medalKind] ?? 0;
}

// ---------------------------------------------------------------- online rooms

async function online(el, params) {
    el.innerHTML = frame('Online', 'Räume mit Freunden – Code teilen, bereit machen, los.');
    wireBack(el);
    const body = $('.screen-body', el);
    if (session.mode !== 'online') {
        body.innerHTML = html`<div class="panel"><p>Online-Räume brauchen eine Verbindung zu einem Server.</p>
            ${api.isApp ? raw('<button class="btn" data-servers>Server wählen</button>') : ''}</div>`;
        $('[data-servers]', body)?.addEventListener('click', () => nav.show('servers'));
        return null;
    }
    const code = params.code ?? null;
    if (code) {
        history.replaceState(null, '', location.pathname);
        const joined = await busy(null, () => api.invoke('JoinRoom', code));
        if (joined) nav.room = joined;
    }
    if (nav.room && nav.room.status === 'lobby') return roomScreen(el, body);
    nav.room = null;
    return lobbyScreen(body);
}

async function lobbyScreen(body) {
    const catalog = await api.get('/catalog');
    const maps = catalog.maps;
    let o = { map: maps.find(m => !m.locked)?.key, mode: 'score', durationS: 120, laps: 3, bots: 0, botSkill: 5, isPrivate: false };
    let timer = null;
    const renderList = async () => {
        const list = await api.invoke('ListRooms').catch(() => []);
        const host = $('[data-rooms]', body);
        if (!host) return;
        host.innerHTML = list.length
            ? html`<ul class="room-list">${list.map(r => raw(html`<li><span><b>${r.host}</b><small>${r.map.name} · ${MODES[r.mode]?.name ?? r.mode}${r.bots ? ` · ${r.bots} Bots` : ''}</small></span>
                <span class="room-count">${r.humans}/${r.maxPlayers}</span><span class="code">${r.code}</span><button class="btn btn--small btn--go" data-join="${r.code}">Beitreten</button></li>`))}</ul>`
            : '<p class="hint">Gerade ist kein offener Raum da – mach einen auf!</p>';
        $$('[data-join]', host).forEach(b => b.addEventListener('click', () => busy(b, () => join(b.dataset.join))));
    };
    const join = async code => {
        nav.room = await api.invoke('JoinRoom', code);
        nav.show('online');
    };
    const render = () => {
        body.innerHTML = html`<div class="grid-2">
            <div class="panel">
                <div class="row row--between"><span class="kicker">Offene Räume</span><button class="icon-btn" data-refresh aria-label="Aktualisieren">${raw(icon('route'))}</button></div>
                <div data-rooms><p class="hint">Suche Räume …</p></div>
                <form class="form row" data-code><input name="code" maxlength="4" placeholder="CODE" autocomplete="off" class="code-input" required /><button class="btn" type="submit">Mit Code beitreten</button></form>
            </div>
            <div class="panel">
                <span class="kicker">Neuer Raum</span>
                <div class="map-grid map-grid--small">${mapCards(maps, o.map)}</div>
                ${raw(optionsForm(o, { withBots: false }))}
                <label class="check"><input type="checkbox" data-private ${o.isPrivate ? 'checked' : ''} /> Privat (nur mit Code)</label>
                <div class="row row--end"><button class="btn btn--go" data-create>${raw(icon('plus'))} Raum eröffnen</button></div>
            </div></div>`;
        $$('[data-map]', body).forEach(b => b.addEventListener('click', () => {
            o = { ...o, map: b.dataset.map };
            render();
        }));
        wireOptions(body, o, next => {
            o = next;
            render();
        });
        $('[data-private]', body).addEventListener('change', e => (o.isPrivate = e.target.checked));
        $('[data-refresh]', body).addEventListener('click', renderList);
        $('[data-code]', body).addEventListener('submit', e => {
            e.preventDefault();
            busy(e.submitter, () => join(String(new FormData(e.target).get('code')).trim().toUpperCase()));
        });
        $('[data-create]', body).addEventListener('click', e => busy(e.currentTarget, async () => {
            nav.room = await api.invoke('CreateRoom', { ...o, competitionId: null });
            nav.show('online');
        }));
        renderList();
    };
    render();
    timer = setInterval(renderList, 5000);
    return { leave: () => clearInterval(timer) };
}

function roomScreen(el, body) {
    const me = session.player?.id;
    const render = room => {
        nav.room = room;
        const mine = room.seats.find(s => s.playerId === me);
        const isHost = mine && mine.seat === room.hostSeat;
        const others = room.seats.filter(s => s.kind === 'human' && s.seat !== room.hostSeat);
        const allReady = others.every(s => s.ready);
        const link = `${location.origin}${BASE}?raum=${room.code}`;
        body.innerHTML = html`<div class="grid-2">
            <div class="panel">
                <div class="room-code"><span class="kicker">Raum-Code</span><b class="code code--big">${room.code}</b>
                    <button class="btn btn--small" data-copy>${raw(icon('link'))} Einladung kopieren</button></div>
                <dl class="room-facts"><dt>Strecke</dt><dd>${room.map.name}</dd><dt>Modus</dt><dd>${MODES[room.mode]?.name ?? room.mode}</dd>
                    <dt>${room.mode === 'race' ? 'Runden' : 'Zeit'}</dt><dd>${room.mode === 'race' ? room.laps : room.mode === 'score' ? `${room.durationS} s` : 'ohne Uhr'}</dd>
                    <dt>Bots</dt><dd>${room.bots ? `${room.bots} (Können ${room.botSkill})` : 'keine'}</dd><dt>Plätze</dt><dd>${room.seats.length}/${room.maxPlayers}</dd></dl>
            </div>
            <div class="panel">
                <span class="kicker">Fahrer</span>
                <ul class="seat-list">${room.seats.map(s => raw(html`<li class="${s.playerId === me ? 'me' : ''}">
                    <span class="swatch" style="background:${s.car.paint}"></span><span><b>${s.name}</b><small>${s.car.name}</small></span>
                    ${s.seat === room.hostSeat ? raw(`<em class="tag">${icon('crown')} Gastgeber</em>`) : raw(`<em class="tag ${s.ready ? 'tag--ok' : ''}">${s.ready ? 'bereit' : 'wartet'}</em>`)}</li>`))}</ul>
                <div class="row row--end">
                    <button class="btn btn--ghost" data-leave>Verlassen</button>
                    <button class="btn" data-car>Auto wechseln</button>
                    ${isHost ? raw(html`<button class="btn btn--go" data-start ${allReady ? '' : 'disabled'} title="${allReady ? '' : 'Noch nicht alle sind bereit'}">${raw(icon('play'))} Start</button>`)
                        : raw(html`<button class="btn ${mine?.ready ? '' : 'btn--go'}" data-ready>${mine?.ready ? 'Doch nicht' : 'Bereit!'}</button>`)}
                </div>
            </div></div>`;
        $('[data-copy]', body).addEventListener('click', () => {
            navigator.clipboard?.writeText(link).then(() => toast('Einladung kopiert.', 'good'), () => toast(link, 'info', 8000));
        });
        $('[data-leave]', body).addEventListener('click', e => busy(e.currentTarget, async () => {
            await api.invoke('LeaveRoom');
            nav.room = null;
            nav.show('online');
        }));
        $('[data-car]', body).addEventListener('click', () => nav.show('garage', { back: 'online' }));
        $('[data-ready]', body)?.addEventListener('click', e => busy(e.currentTarget, async () => render(await api.invoke('Ready', !mine.ready))));
        $('[data-start]', body)?.addEventListener('click', e => busy(e.currentTarget, () => api.invoke('StartRoom')));
    };
    render(nav.room);
    const off = api.on('Room', room => {
        if (room.code !== nav.room?.code) return;
        if (room.status === 'lobby') render(room);
    });
    // after a garage visit the room takes the selected car
    api.invoke('ChangeCar').then(render, () => {});
    return { leave: off };
}

export const playScreens = { solo, competitions, online };
