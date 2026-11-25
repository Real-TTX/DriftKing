// DriftKing · menu-garage.js – the garage: the own cars on the turntable (scenes/garage.js), tuning with the numbers before and after,
// the look (paint, rims, neon, design, number – live on the car, saved with one click) and the dealer.

import { api, session } from './api.js';
import { nav } from './nav.js';
import { PARTS, PAINTS, NEONS, DECALS, BODIES, DRIVES, MAX_LEVEL, specOf, formatMoney } from './catalog.js';
import { html, raw, $, $$, icon, toast, busy, pips, bar, confirmBox } from './ui.js';
import { frame, wireBack } from './menu.js';
import { audio } from './audio.js';

const RIMS = ['#c9ccd6', '#16151f', '#ffb020', '#ff2e88', '#29e7ff', '#f4f2ff'];

export async function garageScreen(el, params) {
    const back = params.back ?? 'home';
    let tab = params.tab ?? 'tuning';
    let [garage, catalog] = await Promise.all([api.get('/garage'), api.get('/catalog')]);
    let selectedId = garage.selectedId;
    let viewId = selectedId;
    let look = null;
    const scene = await nav.scene('garage');

    el.innerHTML = frame('Garage', '', back);
    el.querySelector('.screen').classList.add('screen--garage');
    wireBack(el);
    const body = $('.screen-body', el);

    const current = () => garage.cars.find(c => c.car.id === viewId) ?? garage.cars[0];
    const dealer = carId => catalog.cars.find(c => c.id === carId);
    const showCar = car => scene?.show(car);

    const render = () => {
        const entry = current();
        const car = entry.car;
        if (!look || look.id !== car.id) look = { id: car.id, paint: car.paint, rims: car.rims, neon: car.neon, decal: car.decal, number: car.number };
        showCar(tab === 'look' ? { ...car, ...look } : car);
        $('.screen-sub', el).textContent = `${garage.cars.length} ${garage.cars.length === 1 ? 'Auto' : 'Autos'} · ${formatMoney(garage.money)}`;
        body.innerHTML = html`
            <aside class="panel garage-list">
                <span class="kicker">Deine Autos</span>
                <ul>${garage.cars.map(g => raw(html`<li><button class="garage-car ${g.car.id === viewId ? 'active' : ''}" data-view="${g.car.id}">
                    <span class="swatch" style="background:${g.car.paint}"></span><span><b>${g.car.name}</b><small>${BODIES[g.car.body] ?? g.car.body} · ${DRIVES[g.car.drive] ?? g.car.drive}</small></span>
                    ${g.car.id === selectedId ? raw(`<em class="tag tag--ok">${icon('check')}</em>`) : ''}</button></li>`))}</ul>
                <button class="btn btn--go" data-select ${car.id === selectedId ? 'disabled' : ''}>${car.id === selectedId ? 'Fährst du' : 'Damit fahren'}</button>
            </aside>
            <div class="garage-stage" aria-hidden="true"></div>
            <div class="panel garage-panel">
                <div class="tabs" role="tablist">
                    <button class="tab ${tab === 'tuning' ? 'active' : ''}" data-tab="tuning">${raw(icon('wrench'))} Tuning</button>
                    <button class="tab ${tab === 'look' ? 'active' : ''}" data-tab="look">${raw(icon('paint'))} Lack</button>
                    <button class="tab ${tab === 'dealer' ? 'active' : ''}" data-tab="dealer">${raw(icon('store'))} Händler</button>
                </div>
                <div class="tab-body">${raw(tab === 'tuning' ? tuning(entry) : tab === 'look' ? lookPane(car) : dealerPane())}</div>
            </div>`;
        wire(entry);
    };

    const tuning = entry => {
        const car = entry.car;
        const base = dealer(car.carId);
        const s = car.spec;
        const after = part => (base ? specOf(base, { ...car.levels, [part]: Math.min(MAX_LEVEL, car.levels[part] + 1) }) : s);
        return html`<h2 class="garage-name">${car.name}</h2><p class="hint">${entry.description}</p>
            <div class="specs">
                ${raw(bar('Leistung', s.powerKw, 400, 0, `${s.powerKw} kW`))}
                ${raw(bar('Spitze', s.topSpeedKmh, 330, 0, `${s.topSpeedKmh} km/h`))}
                ${raw(bar('Grip', s.gripFront - 0.8, 0.75, 0, s.gripFront.toFixed(2)))}
                ${raw(bar('Einschlag', s.steerLockDeg, 70, 0, `${Math.round(s.steerLockDeg)}°`))}
                ${raw(bar('Gewicht', s.massKg - 900, 800, 0, `${s.massKg} kg`))}
            </div>
            <ul class="parts">${entry.parts.map(p => {
                const next = after(p.key);
                const gain = p.key === 'engine' || p.key === 'turbo' ? `+${next.powerKw - s.powerKw} kW` : p.key === 'tires' ? `+${(next.gripFront - s.gripFront).toFixed(3)} Grip`
                    : p.key === 'steering' ? `+${Math.round(next.steerLockDeg - s.steerLockDeg)}°` : `+${Math.round((next.stability - s.stability) * 100)} % Ruhe`;
                return raw(html`<li><span><b>${p.name}</b><small>${PARTS[p.key]?.text ?? ''}</small></span>${raw(pips(p.level, MAX_LEVEL))}
                    ${p.nextPrice == null ? raw('<em class="tag tag--ok">Max</em>') : raw(html`<button class="btn btn--small ${garage.money >= p.nextPrice ? 'btn--go' : ''}" data-upgrade="${p.key}" ${garage.money >= p.nextPrice ? '' : 'disabled'} title="${gain}">
                        ${formatMoney(p.nextPrice)} <small>${gain}</small></button>`)}</li>`);
            })}</ul>`;
    };

    const swatches = (name, colors, value) => raw(html`<div class="swatches" data-swatches="${name}">${colors.map(c => raw(html`<button type="button" class="swatch-btn ${String(c) === String(value) ? 'active' : ''}"
        data-value="${c ?? 'none'}" style="${c ? `background:${c}` : ''}" aria-label="${c ?? 'ohne'}">${c ? '' : raw(icon('close'))}</button>`))}
        ${name === 'paint' || name === 'rims' ? raw(html`<label class="swatch-btn swatch-custom" title="Eigene Farbe"><input type="color" value="${value ?? '#ffffff'}" data-custom="${name}" />+</label>`) : ''}</div>`);

    const lookPane = car => html`<h2 class="garage-name">${car.name}</h2>
        <div class="form">
            <span class="kicker">Lack</span>${swatches('paint', PAINTS, look.paint)}
            <span class="kicker">Felgen</span>${swatches('rims', RIMS, look.rims)}
            <span class="kicker">Neon unterm Auto</span>${swatches('neon', NEONS, look.neon)}
            <span class="kicker">Design</span>
            <div class="chips">${Object.entries(DECALS).map(([k, v]) => raw(html`<button type="button" class="chip ${k === look.decal ? 'active' : ''}" data-decal="${k}">${v}</button>`))}</div>
            <label class="number-field">Startnummer<input type="number" min="1" max="99" value="${look.number}" data-number /></label>
            <div class="row row--end"><button class="btn btn--ghost" data-reset>Zurücksetzen</button><button class="btn btn--go" data-save>Lack speichern</button></div>
        </div>`;

    const dealerPane = () => html`<ul class="dealer">${catalog.cars.map(c => raw(html`<li class="${c.locked ? 'locked' : ''}">
        <span class="swatch" style="background:${c.paint}"></span>
        <span><b>${c.name}</b><small>${BODIES[c.body] ?? c.body} · ${DRIVES[c.drive] ?? c.drive} · ${c.spec.powerKw} kW · ${Math.round(c.spec.steerLockDeg)}°</small></span>
        ${c.owned ? raw('<em class="tag tag--ok">In der Garage</em>') : c.locked ? raw(`<span class="lock">${icon('lock')} Level ${c.unlockLevel}</span>`)
            : raw(html`<button class="btn btn--small ${garage.money >= c.price ? 'btn--go' : ''}" data-buy="${c.id}" data-name="${c.name}" data-price="${c.price}" ${garage.money >= c.price ? '' : 'disabled'}>${c.price ? formatMoney(c.price) : 'gratis'}</button>`)}
        <button class="icon-btn" data-preview="${c.id}" aria-label="${c.name} ansehen">${raw(icon('car'))}</button></li>`))}</ul>`;

    const wire = entry => {
        $$('[data-view]', body).forEach(b => b.addEventListener('click', () => {
            viewId = Number(b.dataset.view);
            look = null;
            render();
        }));
        $$('[data-tab]', body).forEach(b => b.addEventListener('click', () => {
            tab = b.dataset.tab;
            render();
        }));
        $('[data-select]', body)?.addEventListener('click', e => busy(e.currentTarget, async () => {
            garage = await api.put('/garage/select', { id: entry.car.id });
            selectedId = garage.selectedId;
            toast(`${entry.car.name} steht bereit.`, 'good');
            render();
        }));
        $$('[data-upgrade]', body).forEach(b => b.addEventListener('click', () => busy(b, async () => {
            garage = await api.post(`/garage/${entry.car.id}/upgrade`, { part: b.dataset.upgrade });
            audio.ui('buy');
            await refreshMoney();
            render();
        })));
        // the look: live on the car, saved on demand
        $$('[data-swatches]', body).forEach(group => $$('[data-value]', group).forEach(b => b.addEventListener('click', () => {
            const value = b.dataset.value === 'none' ? null : b.dataset.value;
            look = { ...look, [group.dataset.swatches]: value };
            render();
        })));
        $$('[data-custom]', body).forEach(input => input.addEventListener('change', () => {
            look = { ...look, [input.dataset.custom]: input.value };
            render();
        }));
        $$('[data-decal]', body).forEach(b => b.addEventListener('click', () => {
            look = { ...look, decal: b.dataset.decal };
            render();
        }));
        $('[data-number]', body)?.addEventListener('change', e => {
            look = { ...look, number: Math.max(1, Math.min(99, Number(e.target.value) || 1)) };
            render();
        });
        $('[data-reset]', body)?.addEventListener('click', () => {
            look = null;
            render();
        });
        $('[data-save]', body)?.addEventListener('click', e => busy(e.currentTarget, async () => {
            garage = await api.put(`/garage/${entry.car.id}/look`, { paint: look.paint, rims: look.rims, neon: look.neon ?? 'none', decal: look.decal, number: look.number });
            toast('Frisch lackiert.', 'good');
            look = null;
            render();
        }));
        // the dealer
        $$('[data-preview]', body).forEach(b => b.addEventListener('click', () => {
            const c = catalog.cars.find(x => x.id === Number(b.dataset.preview));
            if (c) showCar(dealerPreview(c));
        }));
        $$('[data-buy]', body).forEach(b => b.addEventListener('click', async () => {
            if (!(await confirmBox(`${b.dataset.name} kaufen?`, `Für ${formatMoney(Number(b.dataset.price))}. Es kommt gleich in deine Garage.`, { yes: 'Kaufen' }))) return;
            busy(b, async () => {
                garage = await api.post('/garage/buy', { carId: Number(b.dataset.buy) });
                catalog = await api.get('/catalog');
                selectedId = garage.selectedId;
                viewId = selectedId;
                look = null;
                tab = 'tuning';
                audio.ui('buy');
                toast(`${b.dataset.name} gehört dir!`, 'good');
                await refreshMoney();
                render();
            });
        }));
    };

    render();
    return null;
}

/** A car of the dealer as the turntable shows it (factory paint, no parts). */
function dealerPreview(c) {
    return {
        id: 0, carId: c.id, key: c.key, name: c.name, body: c.body, drive: c.drive, paint: c.paint, rims: '#c9ccd6', neon: null, decal: 'none', number: 0,
        levels: { engine: 0, turbo: 0, suspension: 0, tires: 0, steering: 0 }, spec: c.spec,
    };
}

async function refreshMoney() {
    const s = await api.get('/session').catch(() => null);
    if (s?.player) {
        session.player = s.player;
        api.changed();
    }
}
