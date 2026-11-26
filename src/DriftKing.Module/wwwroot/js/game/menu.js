// DriftKing · menu.js – the menus around the runs: the top bar, sign-in (browser and app), the home screen, profile and leaderboard, settings,
// and the overlays of a run (pause, results). The screens for playing are in menu-play.js, the garage in menu-garage.js.

import { api, session, host } from './api.js';
import { nav } from './nav.js';
import { settings } from './settings.js';
import { audio } from './audio.js';
import { MAPS, MODES, formatMoney, formatPoints, formatTime } from './catalog.js';
import { html, raw, esc, $, $$, icon, toast, busy, modal, medal, confirmBox } from './ui.js';
import { playScreens } from './menu-play.js';
import { garageScreen } from './menu-garage.js';
import { createBackdrop } from './scenes/backdrop.js';
import { createGarageScene } from './scenes/garage.js';
import { showCredits } from './credits.js';

const root = () => document.getElementById('dk-menu');
const top = () => document.getElementById('dk-top');

let stage = null;
let current = { kind: null, scene: null };
let screen = null;

/** The 3D behind the menus (one at a time). */
async function useScene(kind) {
    if (current.kind === kind && current.scene) return current.scene;
    current.scene?.dispose();
    current = { kind, scene: null };
    if (!stage || !kind) return null;
    try {
        const scene = kind === 'garage' ? await createGarageScene(stage) : await createBackdrop(stage, { map: pickBackdropMap() });
        if (current.kind !== kind) {
            scene.dispose();
            return null;
        }
        current.scene = scene;
        return scene;
    } catch (error) {
        console.error(error);
        return null;
    }
}

function pickBackdropMap() {
    const keys = Object.keys(MAPS);
    return keys[Math.floor(Date.now() / 60000) % keys.length];
}

// ---------------------------------------------------------------- the top bar

function renderTop() {
    const t = top();
    const p = session.player;
    if (!p || root().hidden) {
        t.hidden = true;
        return;
    }
    t.hidden = false;
    const range = Math.max(1, p.xpNext - p.xpLevel);
    const progress = Math.max(0, Math.min(100, ((p.xp - p.xpLevel) / range) * 100));
    const mode = session.mode === 'offline' ? 'offline' : session.mode === 'online' ? 'online' : 'unreachable';
    t.innerHTML = html`
        <button class="top-logo" data-go="home" aria-label="Hauptmenü"><img src="img/logo/driftking-logo-dark.svg" alt="DriftKing" /></button>
        <div class="top-player">
            <span class="top-level" title="Level">${p.level}</span>
            <div class="top-name"><b>${p.displayName}</b>${p.isGuest ? raw('<em>Gast</em>') : ''}
                <span class="top-xp" title="${p.xp - p.xpLevel} / ${range} XP"><i style="width:${progress}%"></i></span></div>
        </div>
        <div class="top-money" title="Geld">${formatMoney(p.money)}</div>
        <span class="top-status top-status--${mode}" title="${mode === 'offline' ? 'Offline – gegen Bots' : session.serverName ?? 'Online'}">${mode === 'offline' ? 'OFFLINE' : 'ONLINE'}</span>
        <button class="icon-btn" data-go="settings" aria-label="Einstellungen">${raw(icon('settings'))}</button>`;
    $$('[data-go]', t).forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
}

// ---------------------------------------------------------------- screens

async function show(name, params = {}) {
    screen?.leave?.();
    screen = null;
    document.getElementById('dk-overlay').hidden = true;
    const el = root();
    el.hidden = false;
    document.body.dataset.screen = name;
    renderTop();
    if (!session.signedIn && name !== 'auth' && name !== 'servers') name = 'auth';
    const all = { home, auth, profile, settings: settingsScreen, servers, garage: garageScreen, ...playScreens };
    const render = all[name] ?? home;
    await nav.scene(name === 'garage' ? 'garage' : 'backdrop');
    try {
        screen = (await render(el, params)) ?? null;
    } catch (error) {
        console.error(error);
        el.innerHTML = html`<section class="screen"><div class="panel"><h2 class="title">Das hat nicht geklappt</h2><p>${error.message}</p>
            <button class="btn" data-go="home">Zum Menü</button></div></section>`;
        $('[data-go]', el)?.addEventListener('click', () => show('home'));
    }
}

/** A screen with a title row (back button) and a body. */
export function frame(title, sub = '', back = 'home') {
    return html`<section class="screen">
        <header class="screen-head">
            <button class="icon-btn" data-back="${back}" aria-label="Zurück">${raw(icon('back'))}</button>
            <div><h1 class="screen-title">${title}</h1><p class="screen-sub">${sub}</p></div>
        </header>
        <div class="screen-body"></div>
    </section>`;
}

/** Wires the back button of a frame. */
export function wireBack(el) {
    $$('[data-back]', el).forEach(b => b.addEventListener('click', () => show(b.dataset.back)));
}

async function home(el) {
    const data = await api.get('/home');
    session.player = data.player;
    renderTop();
    const car = data.car;
    const s = data.stats;
    el.innerHTML = html`<section class="screen screen--home">
        <nav class="home-menu" aria-label="Hauptmenü">
            <button class="home-btn home-btn--hero" data-go="solo">${raw(icon('play'))}<span><b>Fahren</b><small>Freies Fahren, Drift-Wertung, Rennen gegen Bots</small></span></button>
            <button class="home-btn" data-go="competitions">${raw(icon('trophy'))}<span><b>Wettbewerbe</b><small>Medaillen und Preisgeld</small></span></button>
            <button class="home-btn" data-go="online">${raw(icon('users'))}<span><b>Online</b><small>${session.mode === 'online' ? 'Räume mit Freunden' : 'braucht einen Server'}</small></span></button>
            <button class="home-btn" data-go="garage">${raw(icon('car'))}<span><b>Garage</b><small>Autos, Tuning, Lack</small></span></button>
            <button class="home-btn" data-go="profile">${raw(icon('user'))}<span><b>Profil</b><small>Rangliste und Verlauf</small></span></button>
        </nav>
        <aside class="home-side">
            ${data.announcement ? raw(html`<div class="panel panel--news"><h3>Ansage</h3><p>${data.announcement}</p></div>`) : ''}
            <div class="panel home-car" data-go="garage" data-action>
                <span class="kicker">Dein Auto</span>
                <h2>${car.name}</h2>
                <div class="home-car-specs">
                    <span><b>${car.spec.powerKw}</b> kW</span><span><b>${car.spec.topSpeedKmh}</b> km/h</span><span><b>${Math.round(car.spec.steerLockDeg)}°</b> Einschlag</span>
                    <span><b>${car.drive === 'AWD' ? 'Allrad' : 'Heck'}</b></span>
                </div>
            </div>
            <div class="panel home-stats">
                <div><b>${formatPoints(s.bestScore)}</b><span>Bester Lauf</span></div>
                <div><b>${formatPoints(s.bestCombo)}</b><span>Beste Kette</span></div>
                <div><b>${Math.round(s.maxAngle)}°</b><span>Max. Winkel</span></div>
                <div><b>${s.wins}</b><span>Siege</span></div>
            </div>
            ${data.history.length ? raw(html`<div class="panel home-history"><span class="kicker">Letzte Läufe</span><ul>${data.history.map(h => raw(html`<li>
                <span class="place place--${h.place}">${h.place}</span><span>${h.map}<small>${h.competition ?? MODES[h.mode]?.name ?? h.mode}</small></span>
                <b>${h.mode === 'race' && h.timeMs ? formatTime(h.timeMs) : formatPoints(h.score)}</b><em>+${formatMoney(h.money)}</em></li>`))}</ul></div>`) : ''}
        </aside>
    </section>`;
    $$('[data-go]', el).forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
}

// ---------------------------------------------------------------- sign-in

async function auth(el) {
    const app = host.isApp;
    const online = session.mode === 'online';
    el.innerHTML = html`<section class="screen screen--auth">
        <div class="panel auth-box">
            <img class="auth-logo" src="img/logo/driftking-logo-dark.svg" alt="DriftKing" />
            ${online ? raw(html`
                <div class="tabs" role="tablist">
                    ${session.guests ? raw('<button class="tab active" data-tab="guest">Als Gast</button>') : ''}
                    <button class="tab ${session.guests ? '' : 'active'}" data-tab="login">Anmelden</button>
                    ${session.canRegister ? raw('<button class="tab" data-tab="register">Registrieren</button>') : ''}
                </div>
                ${session.guests ? raw(html`<form class="form" data-pane="guest">
                    <label>Dein Fahrername<input name="name" maxlength="40" autocomplete="nickname" placeholder="z. B. Nachtfalke" required /></label>
                    <button class="btn btn--go" type="submit">Los geht’s</button>
                    <p class="hint">Gäste fahren sofort los – ein Konto für die Ranglisten geht später.</p></form>`) : ''}
                <form class="form" data-pane="login" ${session.guests ? 'hidden' : ''}>
                    <label>Benutzername<input name="login" autocomplete="username" required /></label>
                    <label>Passwort<input name="password" type="password" autocomplete="current-password" required /></label>
                    <button class="btn btn--go" type="submit">Anmelden</button>
                    ${app ? raw('<button class="btn btn--ghost" type="button" data-device>Mit Code im Browser anmelden</button>') : ''}
                </form>
                ${session.canRegister ? raw(html`<form class="form" data-pane="register" hidden>
                    <label>Fahrername<input name="displayName" maxlength="40" required /></label>
                    <label>Benutzername<input name="login" autocomplete="username" required /></label>
                    <label>Passwort<input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
                    <button class="btn btn--go" type="submit">Konto anlegen</button></form>`) : ''}`) : raw(html`
                <p class="auth-problem">${session.problem ?? 'Kein Server erreichbar.'}</p>`)}
            ${app ? raw(html`<div class="row auth-app">
                <button class="btn" data-servers>Server wählen</button>
                <button class="btn btn--ghost" data-offline>Offline gegen Bots</button></div>`) : ''}
        </div>
    </section>`;
    $$('.tab', el).forEach(tab => tab.addEventListener('click', () => {
        $$('.tab', el).forEach(t => t.classList.toggle('active', t === tab));
        $$('[data-pane]', el).forEach(p => (p.hidden = p.dataset.pane !== tab.dataset.tab));
    }));
    const done = () => {
        toast(`Willkommen, ${session.player?.displayName ?? 'Fahrer'}!`, 'good');
        show(invitation() ? 'online' : 'home', { code: invitation() });
    };
    $('[data-pane="guest"]', el)?.addEventListener('submit', e => {
        e.preventDefault();
        busy(e.submitter, async () => {
            await api.guest(new FormData(e.target).get('name'));
            done();
        });
    });
    $('[data-pane="login"]', el)?.addEventListener('submit', e => {
        e.preventDefault();
        const form = new FormData(e.target);
        busy(e.submitter, async () => {
            await api.login(form.get('login'), form.get('password'));
            done();
        });
    });
    $('[data-pane="register"]', el)?.addEventListener('submit', e => {
        e.preventDefault();
        const form = new FormData(e.target);
        busy(e.submitter, async () => {
            await api.register(form.get('displayName'), form.get('login'), form.get('password'));
            done();
        });
    });
    $('[data-device]', el)?.addEventListener('click', e => busy(e.currentTarget, async () => {
        const box = modal('<h2 class="title">Anmelden mit Code</h2><p>Öffne im Browser <b>/link</b> auf deinem Server und gib diesen Code ein:</p><p class="device-code">…</p>');
        try {
            await api.deviceLogin(({ code }) => ($('.device-code', box.el).textContent = code));
            box.close();
            done();
        } catch (error) {
            box.close();
            throw error;
        }
    }));
    $('[data-servers]', el)?.addEventListener('click', () => show('servers'));
    $('[data-offline]', el)?.addEventListener('click', e => busy(e.currentTarget, async () => {
        await api.playOffline();
        show('home');
    }));
}

/** The invitation of the address (?raum=ABCD), once. */
function invitation() {
    return new URLSearchParams(location.search).get('raum');
}

async function servers(el) {
    el.innerHTML = frame('Server', 'Wo DriftKing online fährt – oder offline gegen Bots.', session.signedIn ? 'settings' : 'auth');
    wireBack(el);
    const body = $('.screen-body', el);
    const render = async () => {
        const list = await api.servers();
        const currentServer = await api.currentServer();
        body.innerHTML = html`<div class="panel">
            <ul class="server-list">${list.map(s => raw(html`<li class="${s.url === currentServer ? 'active' : ''}">
                <span><b>${s.name ?? s.url}</b><small>${s.url}</small></span>
                <button class="btn btn--small" data-use="${s.url}">${s.url === currentServer ? 'Verbunden' : 'Verbinden'}</button>
                <button class="icon-btn" data-remove="${s.url}" aria-label="Entfernen">${raw(icon('close'))}</button></li>`))}</ul>
            <form class="form row" data-add><input name="url" placeholder="https://games.example.com" required /><button class="btn" type="submit">Hinzufügen</button></form>
            <button class="btn btn--ghost" data-offline>Offline spielen</button>
        </div>`;
        $$('[data-use]', body).forEach(b => b.addEventListener('click', () => busy(b, async () => {
            await api.useServer(b.dataset.use);
            show(session.signedIn ? 'home' : 'auth');
        })));
        $$('[data-remove]', body).forEach(b => b.addEventListener('click', () => busy(b, async () => {
            await api.removeServer(b.dataset.remove);
            render();
        })));
        $('[data-add]', body).addEventListener('submit', e => {
            e.preventDefault();
            const url = new FormData(e.target).get('url');
            busy(e.submitter, async () => {
                const doc = await api.testServer(url);
                toast(`${doc.name ?? 'Server'} gefunden.`, 'good');
                await api.useServer(url);
                show(session.signedIn ? 'home' : 'auth');
            });
        });
        $('[data-offline]', body).addEventListener('click', e => busy(e.currentTarget, async () => {
            await api.playOffline();
            show('home');
        }));
    };
    await render();
}

// ---------------------------------------------------------------- profile

async function profile(el, params) {
    const tab = params.tab ?? 'stats';
    el.innerHTML = frame('Profil', session.player?.displayName ?? '');
    wireBack(el);
    const body = $('.screen-body', el);
    body.innerHTML = html`<div class="tabs" role="tablist">
        <button class="tab ${tab === 'stats' ? 'active' : ''}" data-tab="stats">Statistik</button>
        <button class="tab ${tab === 'board' ? 'active' : ''}" data-tab="board">Rangliste</button>
        <button class="tab ${tab === 'history' ? 'active' : ''}" data-tab="history">Verlauf</button></div><div class="tab-body"></div>`;
    $$('.tab', body).forEach(t => t.addEventListener('click', () => show('profile', { tab: t.dataset.tab })));
    const pane = $('.tab-body', body);
    if (tab === 'stats') {
        const [p, bests] = await Promise.all([api.get('/profile'), api.get('/bests')]);
        const s = p.stats;
        pane.innerHTML = html`<div class="grid-2">
            <div class="panel stat-grid">
                <div><b>${p.player.level}</b><span>Level</span></div>
                <div><b>${s.rank ?? '–'}</b><span>Rang</span></div>
                <div><b>${s.runsPlayed}</b><span>Läufe</span></div>
                <div><b>${s.wins}</b><span>Siege</span></div>
                <div><b>${formatPoints(s.bestScore)}</b><span>Bester Lauf</span></div>
                <div><b>${formatPoints(s.bestCombo)}</b><span>Beste Kette</span></div>
                <div><b>${Math.round(s.maxAngle)}°</b><span>Max. Winkel</span></div>
                <div><b>${s.driftDistanceKm.toLocaleString('de-DE')} km</b><span>Quer gefahren</span></div>
                <div><b>${formatPoints(s.totalScore)}</b><span>Punkte gesamt</span></div>
                <div><b>${p.cars}</b><span>Autos</span></div>
            </div>
            <div class="panel">
                <span class="kicker">Medaillen</span>
                <div class="medal-row">${raw(medal('gold'))}<b>${p.gold}</b>${raw(medal('silver'))}<b>${p.silver}</b>${raw(medal('bronze'))}<b>${p.bronze}</b></div>
                <span class="kicker">Bestwerte je Strecke</span>
                ${bests.length ? raw(html`<table class="table"><thead><tr><th>Strecke</th><th>Modus</th><th class="num">Punkte</th><th class="num">Zeit</th><th class="num">Runde</th></tr></thead><tbody>
                    ${bests.map(b => raw(html`<tr><td>${MAPS[b.map]?.name ?? b.map}</td><td>${MODES[b.mode]?.name ?? b.mode}</td><td class="num">${formatPoints(b.score)}</td>
                        <td class="num">${b.timeMs ? formatTime(b.timeMs) : '–'}</td><td class="num">${b.bestLapMs ? formatTime(b.bestLapMs) : '–'}</td></tr>`))}</tbody></table>`) : raw('<p class="hint">Noch keine Läufe.</p>')}
            </div></div>
            ${session.player?.isGuest && session.mode === 'online' && session.canRegister ? raw(html`<div class="panel"><h3>Aus dem Gast ein Konto machen</h3>
                <p class="hint">Mit Konto stehst du in den Ranglisten; Geld, Autos und Medaillen bleiben.</p>
                <form class="form row" data-upgrade><input name="displayName" placeholder="Fahrername" value="${session.player.displayName}" required />
                <input name="login" placeholder="Benutzername" autocomplete="username" required /><input name="password" type="password" placeholder="Passwort" autocomplete="new-password" minlength="8" required />
                <button class="btn btn--go" type="submit">Konto anlegen</button></form></div>`) : ''}`;
        $('[data-upgrade]', pane)?.addEventListener('submit', e => {
            e.preventDefault();
            const f = new FormData(e.target);
            busy(e.submitter, async () => {
                await api.upgrade(f.get('displayName'), f.get('login'), f.get('password'));
                toast('Dein Konto ist da.', 'good');
                show('profile');
            });
        });
    } else if (tab === 'board') {
        const by = params.by ?? 'xp';
        const rows = await api.get(`/leaderboard?by=${by}`);
        const labels = { xp: 'Level', score: 'Bester Lauf', wins: 'Siege', total: 'Punkte gesamt' };
        pane.innerHTML = html`<div class="chips">${Object.entries(labels).map(([k, v]) => raw(html`<button class="chip ${k === by ? 'active' : ''}" data-by="${k}">${v}</button>`))}</div>
            <div class="panel">${rows.length ? raw(html`<table class="table"><thead><tr><th class="num">#</th><th>Fahrer</th><th class="num">Level</th><th class="num">${labels[by]}</th></tr></thead><tbody>
                ${rows.map(r => raw(html`<tr class="${r.isMe ? 'me' : ''}"><td class="num"><span class="place place--${r.rank}">${r.rank}</span></td><td>${r.name}</td><td class="num">${r.level}</td>
                <td class="num">${by === 'xp' ? `${formatPoints(r.value)} XP` : formatPoints(r.value)}</td></tr>`))}</tbody></table>`)
                : raw(`<p class="hint">${session.mode === 'offline' ? 'Ranglisten gibt es nur online.' : 'Noch niemand mit Konto in der Rangliste – Gäste zählen nicht.'}</p>`)}</div>`;
        $$('[data-by]', pane).forEach(c => c.addEventListener('click', () => show('profile', { tab: 'board', by: c.dataset.by })));
    } else {
        const rows = await api.get('/history');
        pane.innerHTML = html`<div class="panel">${rows.length ? raw(html`<table class="table"><thead><tr><th>Wann</th><th>Strecke</th><th>Modus</th><th class="num">Platz</th><th class="num">Ergebnis</th><th class="num">Yen</th><th class="num">XP</th></tr></thead><tbody>
            ${rows.map(h => raw(html`<tr><td>${new Date(h.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${h.map}</td><td>${h.competition ?? MODES[h.mode]?.name ?? h.mode}</td>
            <td class="num"><span class="place place--${h.place}">${h.place}</span>/${h.field}</td><td class="num">${h.mode === 'race' && h.timeMs ? formatTime(h.timeMs) : formatPoints(h.score)}</td>
            <td class="num">${formatPoints(h.money)}</td><td class="num">${h.xp}</td></tr>`))}</tbody></table>`) : raw('<p class="hint">Noch keine Läufe.</p>')}</div>`;
    }
}

// ---------------------------------------------------------------- settings

async function settingsScreen(el) {
    const s = settings.get();
    el.innerHTML = frame('Einstellungen', 'Gelten für dieses Gerät.');
    wireBack(el);
    const body = $('.screen-body', el);
    const select = (name, label, options) => raw(html`<label>${label}<select name="${name}">${Object.entries(options).map(([v, t]) => raw(html`<option value="${v}" ${String(s[name]) === v ? 'selected' : ''}>${t}</option>`))}</select></label>`);
    const range = (name, label, value) => raw(html`<label>${label}<input type="range" name="${name}" min="0" max="1" step="0.05" value="${value}" /></label>`);
    body.innerHTML = html`<div class="grid-2">
        <form class="panel form" data-settings>
            <span class="kicker">Ton</span>
            ${range('volume', 'Lautstärke', s.volume)}
            ${range('music', 'Musik', s.music)}
            <span class="kicker">Bild</span>
            ${select('quality', 'Grafik', { low: 'Niedrig (schnell)', medium: 'Mittel', high: 'Hoch' })}
            ${select('camera', 'Kamera', { chase: 'Verfolger', near: 'Nah', hood: 'Motorhaube' })}
            ${select('unit', 'Tempo in', { kmh: 'km/h', mph: 'mph' })}
            ${select('minimap', 'Minikarte', { true: 'An', false: 'Aus' })}
            <span class="kicker">Fahren</span>
            ${select('transmission', 'Getriebe', { auto: 'Automatik', manual: 'Manuell (Q/E)' })}
            ${range('assist', 'Gegenlenk-Hilfe', s.assist)}
        </form>
        <div class="panel">
            <span class="kicker">Steuerung</span>
            <dl class="keys">
                <dt>W / ↑</dt><dd>Gas</dd><dt>S / ↓</dt><dd>Bremse / Rückwärts</dd><dt>A D / ← →</dt><dd>Lenken</dd><dt>Leertaste</dt><dd>Handbremse – Drift einleiten</dd>
                <dt>Q / E</dt><dd>Schalten (manuell)</dd><dt>C</dt><dd>Kamera</dd><dt>R</dt><dd>Zurück auf die Strecke</dd><dt>Esc</dt><dd>Pause</dd>
                <dt>Gamepad</dt><dd>RT Gas · LT Bremse · Stick lenken · A Handbremse · LB/RB schalten · Y Kamera</dd>
            </dl>
            <span class="kicker">Konto</span>
            <p class="hint">${session.mode === 'offline' ? 'Offline – dein Fortschritt bleibt auf diesem Gerät.' : `Angemeldet als ${session.player?.displayName ?? '–'}${session.serverName ? ` auf ${session.serverName}` : ''}.`}</p>
            <div class="row">
                ${host.isApp ? raw('<button class="btn" data-servers>Server</button>') : ''}
                ${session.mode === 'online' ? raw('<button class="btn btn--ghost" data-logout>Abmelden</button>') : ''}
                <button class="btn btn--ghost" data-credits>Credits</button>
            </div>
            <p class="version">DriftKing ${session.version || ''}</p>
        </div></div>`;
    $('[data-settings]', body).addEventListener('input', e => {
        const t = e.target;
        const value = t.type === 'range' ? Number(t.value) : t.value === 'true' ? true : t.value === 'false' ? false : t.value;
        settings.set({ [t.name]: value });
        if (t.name === 'music') audio.music(Number(t.value) > 0);
    });
    $('[data-servers]', body)?.addEventListener('click', () => show('servers'));
    $('[data-credits]', body)?.addEventListener('click', () => showCredits());
    $('[data-logout]', body)?.addEventListener('click', async e => {
        if (!(await confirmBox('Abmelden?', 'Gäste verlieren ihren Fortschritt, wenn sie sich abmelden.', { yes: 'Abmelden', danger: true }))) return;
        busy(e.target, async () => {
            await api.logout();
            show('auth');
        });
    });
}

// ---------------------------------------------------------------- the overlays of a run

/** The pause menu. online: the run keeps going. Returns a function that closes it. */
export function showPause({ mode, online, onResume, onQuit }) {
    const layer = document.getElementById('dk-overlay');
    const quitLabel = online ? 'Raum verlassen' : mode === 'freeride' ? 'Beenden & werten' : 'Aufgeben';
    layer.innerHTML = html`<div class="panel pause-box" role="dialog" aria-modal="true">
        <h2 class="title">Pause</h2>
        ${online ? raw('<p class="hint">Online läuft die Uhr weiter.</p>') : ''}
        <div class="col">
            <button class="btn btn--go" data-resume>Weiter</button>
            <label class="pause-volume">Lautstärke<input type="range" min="0" max="1" step="0.05" value="${settings.get().volume}" /></label>
            <button class="btn btn--danger" data-quit>${quitLabel}</button>
        </div></div>`;
    layer.hidden = false;
    const close = () => {
        layer.hidden = true;
        layer.innerHTML = '';
        removeEventListener('keydown', onKey, true);
    };
    const onKey = e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
            onResume();
        }
    };
    addEventListener('keydown', onKey, true);
    $('[data-resume]', layer).addEventListener('click', () => {
        close();
        onResume();
    });
    $('[data-quit]', layer).addEventListener('click', () => {
        close();
        onQuit();
    });
    $('input[type=range]', layer).addEventListener('input', e => settings.set({ volume: Number(e.target.value) }));
    $('[data-resume]', layer).focus();
    return close;
}

/** The results of a run (ResultsView). onAgain is null when there is nothing to repeat. */
export function showResults(results, { mySeat, levelBefore, onAgain, onMenu }) {
    const layer = document.getElementById('dk-overlay');
    const race = results.mode === 'race';
    const mine = results.entries.find(e => e.seat === mySeat);
    const comp = results.competition;
    const levelUp = levelBefore != null && session.player && session.player.level > levelBefore;
    layer.innerHTML = html`<div class="panel results-box" role="dialog" aria-modal="true">
        <span class="kicker">${results.map.name} · ${MODES[results.mode]?.name ?? results.mode}</span>
        <h2 class="title results-title">${!mine ? 'Ergebnis' : !mine.finished ? 'Aufgegeben' : mine.place === 1 && results.entries.length > 1 ? 'Sieg!' : `Platz ${mine.place}`}</h2>
        ${comp ? raw(html`<div class="results-medal medal-banner medal-banner--${comp.medal}">${raw(medal(comp.medal))}
            <div><b>${comp.medal === 'none' ? 'Keine Medaille' : `${{ gold: 'Gold', silver: 'Silber', bronze: 'Bronze' }[comp.medal]}!`}</b>
            <small>${comp.name}${comp.isNewBest ? ' · neuer Bestwert' : ''}${comp.reward ? ` · +${formatMoney(comp.reward)} Preisgeld` : ''}</small></div></div>`) : ''}
        <table class="table results-table"><thead><tr><th class="num">#</th><th>Fahrer</th><th class="hide-sm">Auto</th><th class="num">${race ? 'Zeit' : 'Punkte'}</th><th class="num hide-sm">Beste Kette</th><th class="num hide-sm">Max. Winkel</th><th class="num">Yen</th></tr></thead><tbody>
        ${results.entries.map(e => raw(html`<tr class="${e.seat === mySeat ? 'me' : ''}"><td class="num"><span class="place place--${e.place}">${e.place}</span></td>
            <td>${e.name}${e.isBot ? raw(' <em class="tag">Bot</em>') : ''}${e.flagged ? raw(' <em class="tag tag--warn" title="nicht plausibel, gekappt">!</em>') : ''}</td><td class="hide-sm">${e.carName}</td>
            <td class="num">${race ? (e.finished && e.timeMs ? formatTime(e.timeMs) : 'DNF') : formatPoints(e.score)}</td>
            <td class="num hide-sm">${formatPoints(e.bestCombo)}</td><td class="num hide-sm">${Math.round(e.maxAngle)}°</td><td class="num">${e.isBot ? '' : formatPoints(e.money)}</td></tr>`))}
        </tbody></table>
        ${mine ? raw(html`<p class="results-earned">+${formatMoney(mine.money + (comp?.reward ?? 0))} · +${mine.xp} XP${levelUp ? raw(` · <b class="level-up">Level ${session.player.level}!</b>`) : ''}</p>`) : ''}
        <div class="row">${onAgain ? raw('<button class="btn btn--go" data-again>Nochmal</button>') : ''}<button class="btn" data-menu>Zum Menü</button></div>
    </div>`;
    layer.hidden = false;
    if (comp && comp.medal !== 'none' && comp.medal !== comp.previousMedal) audio.ui('medal');
    $('[data-again]', layer)?.addEventListener('click', () => {
        layer.hidden = true;
        onAgain();
    });
    $('[data-menu]', layer).addEventListener('click', () => {
        layer.hidden = true;
        onMenu();
    });
    ($('[data-again]', layer) ?? $('[data-menu]', layer)).focus();
}

// ---------------------------------------------------------------- the menu object

export const menu = {
    mount(theStage) {
        stage = theStage;
        nav.show = show;
        nav.scene = useScene;
    },
    show,
    hide() {
        screen?.leave?.();
        screen = null;
        root().hidden = true;
        top().hidden = true;
        current.scene?.dispose();
        current = { kind: null, scene: null };
    },
    refreshTop: renderTop,
    invitation,
};
