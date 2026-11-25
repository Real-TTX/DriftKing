// DriftKing · ui.js – small DOM helpers of the menus: html templating with escaping, icons, toasts, confirm, busy buttons, sounds.

import { audio } from './audio.js';

export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Tagged template: html`<b>${name}</b>` escapes values; raw(...) and arrays of raw pass html through. Returns a string. */
export function html(strings, ...values) {
    let out = '';
    strings.forEach((s, i) => {
        out += s;
        if (i < values.length) {
            const v = values[i];
            if (v && v.__raw) out += v.html;
            else if (Array.isArray(v)) out += v.map(x => (x && x.__raw ? x.html : esc(x))).join('');
            else out += esc(v);
        }
    });
    return out;
}

export function raw(markup) {
    return { __raw: true, html: markup };
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** The line icons of the menus (24 × 24, stroke = currentColor). */
const ICONS = {
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    car: '<path d="M5 17H3.5A1.5 1.5 0 0 1 2 15.5V13a1 1 0 0 1 .7-1l3.8-1.2L9 7.5A1 1 0 0 1 9.8 7h4.8a1 1 0 0 1 .8.4l2.6 3.4 2.8.9A1.5 1.5 0 0 1 22 13.1v2.4a1.5 1.5 0 0 1-1.5 1.5H19"/><path d="M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h15l-2.5 4.5L19 13H4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4Z"/>',
    paint: '<path d="M19 11h-2a2 2 0 0 0-2 2v1.5a2.5 2.5 0 0 1-5 0V4h9a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2Z"/><path d="M10 4H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h4"/>',
    store: '<path d="M3 9 5 4h14l2 5"/><path d="M4 9v11h16V9"/><path d="M3 9h18a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0"/><path d="M10 20v-5h4v5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    medal: '<path d="M7.2 2 10 8"/><path d="M16.8 2 14 8"/><circle cx="12" cy="15" r="6"/>',
    gauge: '<path d="M3.5 18a9 9 0 1 1 17 0"/><path d="m12 14 4.5-5"/><circle cx="12" cy="14" r="1.6"/>',
    drift: '<path d="M3 20c4-1 7-4 8-8"/><path d="M11 12c1-4 4-7 9-8"/><path d="M2 15h3M2 11h2"/>',
    crown: '<path d="M4 17 2.5 7l5.5 4L12 4l4 7 5.5-4L20 17Z"/><path d="M4 20h16"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};

export function icon(name, cls = '') {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

/** A short message at the bottom (kind: info | good | bad). */
export function toast(text, kind = 'info', life = 3200) {
    const host = document.getElementById('dk-toasts');
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.textContent = text;
    host.appendChild(el);
    if (kind === 'bad') audio.ui('error');
    setTimeout(() => el.classList.add('out'), life - 300);
    setTimeout(() => el.remove(), life);
}

/** A yes/no question. Resolves true/false. */
export function confirmBox(title, text, { yes = 'Ja', no = 'Abbrechen', danger = false } = {}) {
    return new Promise(resolve => {
        const layer = document.createElement('div');
        layer.className = 'modal';
        layer.innerHTML = html`<div class="panel modal-box" role="dialog" aria-modal="true">
            <h2 class="title">${title}</h2><p>${text}</p>
            <div class="row"><button class="btn ${danger ? 'btn--danger' : 'btn--go'}" data-yes>${yes}</button><button class="btn" data-no>${no}</button></div></div>`;
        document.body.appendChild(layer);
        const done = value => {
            layer.remove();
            resolve(value);
        };
        layer.querySelector('[data-yes]').addEventListener('click', () => done(true));
        layer.querySelector('[data-no]').addEventListener('click', () => done(false));
        layer.addEventListener('click', e => e.target === layer && done(false));
        layer.querySelector('[data-yes]').focus();
    });
}

/** A modal panel with free content; returns { el, close }. */
export function modal(markup, { wide = false, onClose } = {}) {
    const layer = document.createElement('div');
    layer.className = 'modal';
    layer.innerHTML = `<div class="panel modal-box ${wide ? 'modal-box--wide' : ''}" role="dialog" aria-modal="true">
        <button class="icon-btn modal-close" data-close aria-label="Schließen">${icon('close')}</button>${markup}</div>`;
    document.body.appendChild(layer);
    const close = () => {
        layer.remove();
        onClose?.();
    };
    layer.querySelector('[data-close]').addEventListener('click', close);
    layer.addEventListener('click', e => e.target === layer && close());
    return { el: layer.querySelector('.modal-box'), close };
}

/** Runs an action with the button busy; shows the error as a toast. */
export async function busy(button, action) {
    if (button?.disabled) return undefined;
    if (button) {
        button.disabled = true;
        button.classList.add('busy');
    }
    try {
        return await action();
    } catch (error) {
        toast(error.message ?? String(error), 'bad', 4200);
        return undefined;
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove('busy');
        }
    }
}

/** Click and hover sounds for every button of the menus. */
export function wireSounds(root = document) {
    root.addEventListener('click', e => {
        if (e.target.closest('button, .chip, [data-action]')) {
            audio.unlock();
            audio.ui('click');
        }
    });
    root.addEventListener('pointerover', e => {
        const t = e.target.closest('button:not(:disabled), [data-action]');
        if (t && t !== root.lastHover) {
            root.lastHover = t;
            audio.ui('hover');
        }
    });
}

/** A row of pips (tuning level). */
export function pips(level, max = 5) {
    return `<span class="pips">${Array.from({ length: max }, (_, k) => `<i class="${k < level ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** A stat bar: value of max, extra = what an upgrade would add. */
export function bar(label, value, max, extra = 0, text = '') {
    const a = Math.max(0, Math.min(100, (value / max) * 100));
    const b = Math.max(0, Math.min(100 - a, (extra / max) * 100));
    return `<div class="stat"><span>${esc(label)}</span><div class="stat-bar"><i style="width:${a}%"></i><i class="plus" style="width:${b}%"></i></div><b>${esc(text)}</b></div>`;
}

/** The medal as a small round badge. */
export function medal(kind) {
    const names = { gold: 'Gold', silver: 'Silber', bronze: 'Bronze', none: 'Keine' };
    return `<span class="medal medal--${esc(kind ?? 'none')}" title="${names[kind] ?? 'Keine'}"></span>`;
}
