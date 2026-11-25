#!/usr/bin/env node
// Checks a FRESH DriftKing server (the first account that registers becomes the administrator): registers through MatGame's sign-in page,
// reads the game API, opens every admin page of DriftKing, saves a car and a competition, and takes screenshots into tmp/.
//   node tools/admin.mjs http://localhost:2771
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:2771';
mkdirSync('tmp', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('response', r => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

await page.goto(`${base}/Account/Login?tab=register`);
const form = page.locator('form[data-form=register]');
await form.locator('input[name=displayName]').fill('Chefin');
await form.locator('input[name=loginName]').fill('chefin');
await form.locator('input[name=password]').fill('Drift-King-2026!');
await form.locator('button[type=submit]').click();
await page.waitForTimeout(1500);

// the game API as the browser sees it
for (const path of ['/session', '/home', '/catalog', '/garage', '/competitions', '/profile', '/bests', '/leaderboard', '/history']) {
    const result = await page.evaluate(async p => {
        const r = await fetch(`/driftking/api${p}`, { credentials: 'include' });
        const text = await r.text();
        return { status: r.status, size: text.length, head: text.slice(0, 140) };
    }, path);
    console.log(`api ${path}`, result.status, result.size, result.head);
}

const pages = [
    ['admin-index', '/Admin/DriftKing'],
    ['admin-players', '/Admin/DriftKing/Players'],
    ['admin-runs', '/Admin/DriftKing/Runs'],
    ['admin-cars', '/Admin/DriftKing/Cars'],
    ['admin-car-edit', '/Admin/DriftKing/Cars/Edit?id=4'],
    ['admin-maps', '/Admin/DriftKing/Maps'],
    ['admin-map-edit', '/Admin/DriftKing/Maps/Edit?id=1'],
    ['admin-competitions', '/Admin/DriftKing/Competitions'],
    ['admin-competition-edit', '/Admin/DriftKing/Competitions/Edit?id=3'],
    ['admin-competition-new', '/Admin/DriftKing/Competitions/Edit'],
    ['admin-system', '/Admin/DriftKing/System'],
];
for (const [name, path] of pages) {
    const response = await page.goto(base + path);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tmp/${name}.png` });
    console.log(name, response.status(), await page.title());
}

await page.goto(`${base}/Admin/DriftKing/Players`);
const link = await page.$('table a[href*="Players/Edit"]');
if (link) {
    await link.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tmp/admin-player-edit.png' });
    console.log('player edit', page.url());
}

for (const path of ['/Admin/DriftKing/Cars/Edit?id=4', '/Admin/DriftKing/Competitions/Edit?id=3', '/Admin/DriftKing/System']) {
    await page.goto(base + path);
    await page.click('form.mat-form button[type=submit]:not([formaction])');
    await page.waitForTimeout(800);
    console.log('saved', path, await page.evaluate(() => document.body.innerText.includes('Gespeichert')));
}

await browser.close();
for (const e of errors) console.log(e);
