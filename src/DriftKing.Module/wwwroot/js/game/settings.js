// The player's own settings of this device (localStorage "driftking.settings"): sound, picture quality, camera, driving aids, gearbox.
// Read anywhere with settings.get(); the options screen changes them with settings.set({ ... }) and everyone listening hears it.

const KEY = 'driftking.settings';

const DEFAULTS = Object.freeze({
    /** Master volume 0..1. */
    volume: 0.8,
    /** Music volume 0..1 (the synthesized beat in the menus and runs). */
    music: 0.5,
    /**
     * Picture quality: 'low' | 'medium' | 'high' – pixel ratio, post-processing (HDR, MSAA, bloom), reflections, PBR materials and texture size,
     * real lights, shadows, smoke particles, detail (docs/RENDERING.md, "Pipeline and quality tiers").
     */
    quality: 'medium',
    /** The camera of a run: 'chase' (behind the car) | 'near' (close chase) | 'hood' (bonnet). */
    camera: 'chase',
    /** Counter-steer assist 0..1 (0 = none, 1 = strong help catching a slide). */
    assist: 0.5,
    /** Gearbox: 'auto' | 'manual' (Q/E or the gamepad shoulder buttons shift). */
    transmission: 'auto',
    /** Speed unit of the HUD: 'kmh' | 'mph'. */
    unit: 'kmh',
    /** Show the minimap in the HUD. */
    minimap: true,
});

const listeners = new Set();
let current = load();

function load() {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
    } catch {
        return { ...DEFAULTS };
    }
}

export const settings = {
    defaults: DEFAULTS,

    get() {
        return current;
    },

    set(changes) {
        current = { ...current, ...changes };
        try {
            localStorage.setItem(KEY, JSON.stringify(current));
        } catch {
            // private mode: the settings live until the page closes
        }
        for (const fn of listeners) fn(current);
        return current;
    },

    reset() {
        return this.set({ ...DEFAULTS });
    },

    /** Calls fn with the settings after every change; returns a function that unsubscribes. */
    onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};
