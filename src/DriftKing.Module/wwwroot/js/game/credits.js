// DriftKing · credits.js – the credits of the 3D car models (data/car-credits.json, written by tools/cars/prepare.mjs): model, author, licence
// and source of every car that uses a downloaded model – the attribution their licences (CC BY) ask for. Opened from the settings.

import { html, raw, modal } from './ui.js';

let cache = null;

/** The credits list (loaded once). */
export function loadCredits() {
    cache ??= fetch(new URL('../../data/car-credits.json', import.meta.url), { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : { models: [] }))
        .catch(() => ({ models: [] }))
        .then(data => data.models ?? []);
    return cache;
}

/** Shows the credits in a dialog. */
export async function showCredits() {
    const models = await loadCredits();
    const link = (url, text) => (url ? raw(html`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`) : text);
    const rows = models.map(m => raw(html`<tr>
        <td><b>${m.car}</b></td>
        <td>${link(m.source, m.title)}</td>
        <td>${link(m.authorUrl, m.author || '–')}</td>
        <td>${link(m.licenceUrl, m.licence || '–')}</td>
    </tr>`));
    modal(html`<h2 class="title">Credits</h2>
        <p class="hint">Die 3D-Modelle der Autos stammen von diesen Künstlerinnen und Künstlern. Für DriftKing wurden sie verkleinert,
            neu ausgerichtet und mit eigenen Materialien versehen (Lack, Glas, Lichter).</p>
        ${models.length
            ? raw(html`<table class="table"><thead><tr><th>Auto</th><th>Modell</th><th>Von</th><th>Lizenz</th></tr></thead><tbody>${rows}</tbody></table>`)
            : raw('<p class="hint">Noch keine fremden Modelle – alle Autos sind selbst gebaut.</p>')}
        <p class="hint">Engine: three.js (MIT). Schriften: Anton, Inter (SIL OFL).</p>`, { wide: true });
}
