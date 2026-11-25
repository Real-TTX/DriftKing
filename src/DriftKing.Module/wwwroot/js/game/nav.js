// DriftKing · nav.js – what the menu modules share without importing each other: the way to another screen, the 3D background,
// the start of a run and the last choices of the player (to play the same again).

export const nav = {
    /** Shows a screen: nav.show('home' | 'solo' | 'competitions' | 'online' | 'garage' | 'profile' | 'settings' | 'auth', params). Set by menu.js. */
    show: async (_name, _params) => {},

    /** The 3D behind the menus: 'backdrop' (a map with drifting bots), 'garage' (the turntable) or null. Returns the scene object. Set by menu.js. */
    scene: async _kind => null,

    /** Starts the run of a room that counts down (RoomView). Set by main.js. */
    run: async _room => {},

    /** The options of the last solo run (for "Nochmal"). */
    lastSolo: null,

    /** The room the player sits in online (RoomView) or null. */
    room: null,
};
