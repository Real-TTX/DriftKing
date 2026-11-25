// DriftKing · render/device.js – the one WebGL renderer of the page for the modules that need the GPU outside a frame:
// the reflection maps (PMREM, render/environment.js) and the texture filtering (anisotropy, render/textures.js). The stage binds it.

/** @type {import('three').WebGLRenderer|null} */
let current = null;

/** Binds the renderer of the stage (null on dispose). */
export function setRenderer(renderer) {
    current = renderer;
}

/** The bound renderer, or null when no stage exists (tests, a page without a canvas). */
export function getRenderer() {
    return current;
}

/** The highest anisotropic filtering of the GPU (1 without a renderer). */
export function maxAnisotropy() {
    return current?.capabilities.getMaxAnisotropy() ?? 1;
}
