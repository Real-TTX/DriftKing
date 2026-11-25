#!/usr/bin/env node
// Plays DriftKing in the browser like a new guest: sign-in, every menu screen, the garage (upgrade, paint), a short solo run (driven by the
// developer autopilot), pause, quit and the results. Screenshots go to tmp/play-*.png; errors of the page are listed at the end.
//   node tools/play.mjs http://localhost:2771 [width] [height]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:2771';
const width = Number(process.argv[3] ?? 1366);
const height = Number(process.argv[4] ?? 768);
const tag = width < 600 ? '-sm' : '';
mkdirSync('tmp', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const shot = async name => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tmp/play${tag}-${name}.png` });
    console.log('shot', name);
};

await page.goto(`${base}/driftking/`);
await page.evaluate(() => localStorage.setItem('driftking.autopilot', '1'));
await page.waitForSelector('#dk-menu:not([hidden])', { timeout: 60000 });
await shot('auth');
if (await page.$('[data-pane=guest]')) {
    await page.fill('[data-pane=guest] input[name=name]', 'Testfahrer');
    await page.click('[data-pane=guest] button[type=submit]');
}
await page.waitForSelector('.screen--home', { timeout: 30000 });
await shot('home');

for (const screen of ['solo', 'competitions', 'online', 'profile', 'settings']) {
    await page.click('.top-logo');
    await page.waitForSelector('.screen--home');
    if (screen === 'settings') await page.click('.top [data-go=settings]');
    else await page.click(`.home-btn[data-go=${screen}]`);
    await page.waitForSelector('.screen-body', { timeout: 15000 });
    await shot(screen);
}

// the garage: upgrade the engine, paint the car, look at the dealer
await page.click('.top-logo');
await page.click('.home-btn[data-go=garage]');
await page.waitForSelector('.garage-panel', { timeout: 20000 });
await shot('garage');
const upgrade = await page.$('[data-upgrade=engine]');
if (upgrade) {
    await upgrade.click();
    await page.waitForTimeout(800);
}
await page.click('[data-tab=look]');
await page.click('[data-swatches=paint] [data-value="#ff2e88"]');
await page.click('[data-swatches=neon] [data-value="#29e7ff"]');
await page.click('[data-decal=kanji]');
await shot('garage-look');
await page.click('[data-save]');
await page.waitForTimeout(800);
await page.click('[data-tab=dealer]');
await shot('garage-dealer');

// a solo run (DK_MAP, DK_MODE, DK_SECONDS of driving; default: deck, score attack, two bots, 9 s)
const runMap = process.env.DK_MAP ?? 'deck';
const runMode = process.env.DK_MODE ?? 'score';
const runSeconds = Number(process.env.DK_SECONDS ?? 9);
await page.click('.top-logo');
await page.click('.home-btn[data-go=solo]');
await page.click(`[data-map=${runMap}]`);
await page.click(`[data-mode=${runMode}]`);
if (runMode === 'score') await page.click('[data-duration="60"]');
await page.click('[data-bots="2"]');
await page.click('[data-start]');
await page.waitForSelector('#dk-hud:not([hidden])', { timeout: 30000 });
await page.waitForTimeout(2500);
await shot('run-countdown');
await page.waitForTimeout(runSeconds * 1000);
await shot('run-driving');
await page.keyboard.press('Escape');
await page.waitForSelector('.pause-box', { timeout: 5000 }).catch(() => {});
await shot('run-pause');
await page.click('[data-quit]').catch(() => {});
await page.waitForSelector('.results-box', { timeout: 40000 }).catch(() => {});
await shot('run-results');

await browser.close();
for (const e of errors) console.log(e);
