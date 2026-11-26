// The fixed words of the game in the browser: bodies, drives, the seeded cars, parts, maps, modes – and specOf, the mirror of the server's Tuning.SpecOf
// (DriftKing.Core/Business/Rules.cs). The server always sends the spec of a car with it (CarView.spec); specOf is only for the previews
// (dev pages, the garage's "after the upgrade" numbers). Change both together.

/** The 3D bodies (js/game/car/models.js builds them; DB Car.Body is one of these keys – never rename one). */
export const BODIES = Object.freeze({
    coupe: 'Coupé',
    hatch: 'Kompakt',
    sedan: 'Limousine',
    fastback: 'Fastback',
    wide: 'Widebody GT',
    muscle: 'Muscle',
});

export const DRIVES = Object.freeze({
    RWD: 'Heckantrieb',
    AWD: 'Allrad',
});

/**
 * The seeded cars (DriftKing.Core/Business/SeedContent.cs Cars, held to it by a test). The key of a car is also the key of its 3D model
 * (CarView.key / DealerCarView.key); the game itself takes the cars from the server (an administrator may add or change some) – this list is
 * for the previews (dev pages) and as the known model keys. Never rename a key.
 */
export const CARS = Object.freeze({
    kaze: { name: 'Nissan Silvia S13', body: 'coupe', drive: 'RWD', power: 3, grip: 4, weight: 4, steering: 6 },
    hotaru: { name: 'Toyota Sprinter Trueno AE86', body: 'hatch', drive: 'RWD', power: 3, grip: 5, weight: 2, steering: 6 },
    ronin: { name: 'Toyota Chaser JZX100', body: 'sedan', drive: 'RWD', power: 5, grip: 5, weight: 6, steering: 6 },
    kitsune: { name: 'Mazda RX-7 FD3S', body: 'fastback', drive: 'RWD', power: 6, grip: 6, weight: 5, steering: 7 },
    yurei: { name: 'Nissan Silvia S15 Spec-R', body: 'coupe', drive: 'RWD', power: 7, grip: 7, weight: 4, steering: 8 },
    raijin: { name: 'Nissan Skyline GT-R R34', body: 'wide', drive: 'AWD', power: 8, grip: 8, weight: 7, steering: 5 },
    oni: { name: 'Ford Mustang GT', body: 'muscle', drive: 'RWD', power: 9, grip: 5, weight: 8, steering: 6 },
    tora: { name: 'Toyota Supra A80 Widebody', body: 'wide', drive: 'RWD', power: 10, grip: 7, weight: 6, steering: 9 },
    s14a: { name: 'Nissan 200SX S14a', body: 'coupe', drive: 'RWD', power: 5, grip: 6, weight: 4, steering: 7 },
    g81: { name: 'BMW M3 Competition Touring G81', body: 'sedan', drive: 'AWD', power: 9, grip: 9, weight: 9, steering: 5 },
    e46: { name: 'BMW M3 E46', body: 'coupe', drive: 'RWD', power: 7, grip: 6, weight: 7, steering: 7 },
    z33: { name: 'Nissan 350Z', body: 'fastback', drive: 'RWD', power: 6, grip: 7, weight: 6, steering: 7 },
    gr86: { name: 'Toyota GR86', body: 'coupe', drive: 'RWD', power: 4, grip: 6, weight: 4, steering: 6 },
    f21: { name: 'BMW M140i F21', body: 'hatch', drive: 'RWD', power: 7, grip: 6, weight: 6, steering: 8 },
});

/** The tuning parts, levels 0..MAX_LEVEL. */
export const PARTS = Object.freeze({
    engine: { name: 'Motor', text: 'mehr Leistung und Spitze' },
    turbo: { name: 'Turbo', text: 'viel mehr Leistung, etwas Spitze' },
    suspension: { name: 'Fahrwerk', text: 'ruhiger beim Umsetzen, weniger Wanken' },
    tires: { name: 'Reifen', text: 'mehr Grip vorn und hinten' },
    steering: { name: 'Lenkwinkel-Kit', text: 'mehr Einschlag für große Winkel' },
});

export const MAX_LEVEL = 5;

/** The maps (js/game/world builds them; DB Map.Key is one of these keys – never rename one). */
export const MAPS = Object.freeze({
    pass: { name: 'Tenjō-Pass', kind: 'Bergpass' },
    deck: { name: 'Parkdeck 7', kind: 'Parkhaus' },
    harbor: { name: 'Kaikō-Docks', kind: 'Hafen' },
    city: { name: 'Neon-Viertel', kind: 'Stadt' },
});

export const MODES = Object.freeze({
    freeride: { name: 'Freies Fahren', text: 'Ohne Uhr, ohne Druck – Linien üben, Punkte sammeln.' },
    score: { name: 'Drift-Wertung', text: 'Auf Zeit: die meisten Drift-Punkte gewinnen.' },
    race: { name: 'Rennen', text: 'Runden auf Zeit: wer zuerst ankommt, gewinnt.' },
});

export const PAINTS = Object.freeze([
    '#f4f2ff', '#16151f', '#ff2e88', '#29e7ff', '#ffb020', '#3ef08a', '#8b5cf6', '#ff4040', '#2f6bff', '#c9ccd6', '#ffe14a', '#ff7a1a',
]);

/** Neon underglow; null = none. */
export const NEONS = Object.freeze([null, '#ff2e88', '#29e7ff', '#8b5cf6', '#3ef08a', '#ffb020', '#ff4040', '#ffffff']);

export const DECALS = Object.freeze({
    none: 'Ohne',
    stripes: 'Rennstreifen',
    split: 'Zweifarbig',
    kanji: 'Schriftzeichen',
    sakura: 'Kirschblüten',
    flames: 'Flammen',
});

/**
 * The driving numbers of a car (base values 1..10, the levels of the parts 0..5) – the same formula as Tuning.SpecOf on the server.
 * @param {{ power:number, grip:number, weight:number, steering:number, drive:'RWD'|'AWD' }} car
 * @param {{ engine?:number, turbo?:number, suspension?:number, tires?:number, steering?:number }} [levels]
 */
export function specOf(car, levels = {}) {
    const engine = levels.engine ?? 0;
    const turbo = levels.turbo ?? 0;
    const suspension = levels.suspension ?? 0;
    const tires = levels.tires ?? 0;
    const steering = levels.steering ?? 0;
    const gripFront = round(0.95 + car.grip * 0.03 + tires * 0.025);
    return {
        massKg: 1000 + car.weight * 60,
        powerKw: 90 + car.power * 22 + engine * 12 + turbo * 16,
        topSpeedKmh: 170 + car.power * 9 + engine * 4 + turbo * 5,
        gripFront,
        gripRear: round(gripFront * (car.drive === 'AWD' ? 1 : 0.94)),
        steerLockDeg: Math.min(70, 32 + car.steering * 2.5 + steering * 4),
        handbrakeGrip: 0.45,
        stability: round(0.5 + suspension * 0.1),
        drive: car.drive,
        gears: 6,
    };
}

function round(v) {
    return Math.round(v * 1000) / 1000;
}

/** Points to a readable number: 12 345. */
export function formatPoints(points) {
    return Math.round(points).toLocaleString('de-DE');
}

/** Milliseconds to 1:23.456. */
export function formatTime(ms) {
    if (ms == null || !Number.isFinite(ms)) return '–';
    const total = Math.max(0, Math.round(ms));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Money: 12.500 ¥. */
export function formatMoney(yen) {
    return `${Math.round(yen).toLocaleString('de-DE')} ¥`;
}
