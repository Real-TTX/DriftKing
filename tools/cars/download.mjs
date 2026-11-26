#!/usr/bin/env node
// DriftKing · tools/cars/download.mjs – downloads a Sketchfab model as glTF (the API's download, needs a Sketchfab API token) and unpacks it.
//
//   SKETCHFAB_TOKEN=<token> node tools/cars/download.mjs <uid> [outdir]
//   SKETCHFAB_TOKEN_FILE=C:\path\to\token.txt node tools/cars/download.mjs <uid> [outdir]
//
// outdir defaults to tmp/cars/<uid> (git-ignored). Next to the files it writes source.json (name, author, licence, links of the model – what
// cars.json needs for the credits) and prints them as a cars.json snippet. The token is read from the environment or the file and never
// printed; the download link the API hands out is signed for a short time and needs no token.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { REPO } from './lib.mjs';

const [uid, outArg] = process.argv.slice(2);
if (!uid || !/^[0-9a-f]{32}$/i.test(uid)) {
    console.error('usage: node tools/cars/download.mjs <uid (32 hex characters, the end of the model URL)> [outdir]\n' +
        '       token: SKETCHFAB_TOKEN or SKETCHFAB_TOKEN_FILE (https://sketchfab.com/settings/password → API token)');
    process.exit(1);
}
const out = resolve(outArg ?? join(REPO, 'tmp', 'cars', uid));
const token = readToken();
const API = 'https://api.sketchfab.com/v3';

// the model's page data: name, author, licence (public, no token needed)
const info = await getJson(`${API}/models/${uid}`, false);
const licence = info.license ?? {};
const slug = licence.slug ?? '';
const licenceName = { by: 'CC BY 4.0', 'by-sa': 'CC BY-SA 4.0', cc0: 'CC0 1.0' }[slug] ?? licence.label ?? slug;
const usable = ['by', 'by-sa', 'cc0'].includes(slug) || /^CC (Attribution|0)/i.test(licence.label ?? '') && !/NonCommercial|NoDerivs/i.test(licence.label ?? '');
const source = {
    uid,
    url: info.viewerUrl ?? `https://sketchfab.com/3d-models/${uid}`,
    title: info.name ?? '',
    author: info.user?.displayName ?? info.user?.username ?? '',
    authorUrl: info.user?.profileUrl ?? '',
    licence: licenceName,
    licenceUrl: licence.url ?? '',
    downloadable: info.isDownloadable ?? null,
    faces: info.faceCount ?? null,
    vertices: info.vertexCount ?? null,
};
console.log(`model     ${source.title} by ${source.author} (${source.faces ?? '?'} faces)`);
console.log(`licence   ${source.licence || 'unknown'}${usable ? '' : '  ← check it: CC BY / CC BY-SA / CC0 are fine with attribution; NC or ND are not for this game'}`);

// the download: a signed link to a zip with scene.gltf, scene.bin and the textures
const download = await getJson(`${API}/models/${uid}/download`, true);
const pick = download.gltf ?? download.glb;
if (!pick?.url) throw new Error('the API offered no glTF download for this model');
console.log(`download  ${((pick.size ?? 0) / 1048576).toFixed(1)} MB …`);
const response = await fetch(pick.url);
if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
const data = new Uint8Array(await response.arrayBuffer());
mkdirSync(out, { recursive: true });
if (download.gltf) {
    const files = unzipSync(data);
    for (const [name, bytes] of Object.entries(files)) {
        if (name.endsWith('/')) continue;
        const target = resolve(out, name);
        // no path may leave the folder (a zip entry like ../../x)
        if (!target.startsWith(out + sep)) throw new Error(`refusing zip entry outside the folder: ${name}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
    }
    console.log(`unpacked  ${Object.keys(files).length} files into ${out}`);
} else {
    writeFileSync(join(out, 'scene.glb'), data);
    console.log(`saved     ${join(out, 'scene.glb')}`);
}
writeFileSync(join(out, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log('\nfor cars.json:');
console.log(JSON.stringify({
    title: source.title, author: source.author, authorUrl: source.authorUrl, licence: source.licence, licenceUrl: source.licenceUrl,
    source: { uid, url: source.url }, input: `tmp/cars/${uid}`,
}, null, 2));
console.log(`\nnext: node tools/cars/inspect.mjs ${out}`);

/** The token from SKETCHFAB_TOKEN or the file SKETCHFAB_TOKEN_FILE names (never printed). */
function readToken() {
    if (process.env.SKETCHFAB_TOKEN?.trim()) return process.env.SKETCHFAB_TOKEN.trim();
    const file = process.env.SKETCHFAB_TOKEN_FILE;
    if (file) {
        try {
            const text = readFileSync(file, 'utf8').trim();
            if (text) return text;
        } catch {
            // reported below without the path's content
        }
        console.error('SKETCHFAB_TOKEN_FILE is set but the file cannot be read or is empty');
        process.exit(1);
    }
    console.error('no token: set SKETCHFAB_TOKEN or SKETCHFAB_TOKEN_FILE (Sketchfab → Settings → Password & API → API token)');
    process.exit(1);
}

async function getJson(url, auth) {
    const r = await fetch(url, { headers: auth ? { Authorization: `Token ${token}` } : {} });
    if (!r.ok) {
        let detail = '';
        try {
            const body = await r.json();
            detail = body.detail ?? body.error ?? '';
        } catch {
            // no JSON body
        }
        const hint = r.status === 401 ? ' (token wrong or expired)' : r.status === 403 ? ' (not downloadable for this account)' : r.status === 404 ? ' (uid wrong)' : '';
        throw new Error(`${url.replace(API, 'api')}: HTTP ${r.status}${hint}${detail ? ` – ${detail}` : ''}`);
    }
    return r.json();
}
