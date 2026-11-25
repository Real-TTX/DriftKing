// DriftKing · car/showcase.js – cars that need no server: the drivers of the menu backdrop and the samples of the developer pages.
// Each is a full CarView (catalog.js specOf builds the spec the same way the server does).
import { NEONS, PAINTS, specOf } from '../catalog.js';

const BASE = {
    coupe: { power: 5, grip: 5, weight: 4, steering: 6, drive: 'RWD', name: 'Kaze Coupé' },
    hatch: { power: 3, grip: 6, weight: 2, steering: 5, drive: 'RWD', name: 'Mame Hatch' },
    sedan: { power: 6, grip: 5, weight: 6, steering: 5, drive: 'RWD', name: 'Ronin Sedan' },
    fastback: { power: 7, grip: 6, weight: 5, steering: 6, drive: 'RWD', name: 'Hayabusa FB' },
    wide: { power: 9, grip: 8, weight: 6, steering: 7, drive: 'AWD', name: 'Raijin GT' },
    muscle: { power: 8, grip: 4, weight: 8, steering: 4, drive: 'RWD', name: 'Tora V8' },
};
const DECALS = ['stripes', 'kanji', 'sakura', 'flames', 'split', 'none'];

/** The bodies of the showcase cars. */
export const SHOWCASE_BODIES = Object.keys(BASE);

/**
 * A CarView of the body; index picks paint, rims, neon, number and decal.
 * @param {string} body
 * @param {number} [index]
 * @param {{ engine?:number, turbo?:number, suspension?:number, tires?:number, steering?:number }} [levels]
 */
export function showcaseCar(body = 'coupe', index = 0, levels = { engine: 2, turbo: 2, suspension: 2, tires: 2, steering: 3 }) {
    const base = BASE[body] ?? BASE.coupe;
    return {
        id: index + 1,
        carId: index + 1,
        key: body,
        name: base.name,
        body,
        drive: base.drive,
        paint: PAINTS[(index * 5 + 2) % PAINTS.length],
        rims: ['#c9ccd6', '#16151f', '#ffb020', '#f4f2ff'][index % 4],
        neon: NEONS[(index % (NEONS.length - 1)) + 1],
        number: 7 + index * 11,
        decal: DECALS[index % DECALS.length],
        levels,
        spec: specOf(base, levels),
    };
}
