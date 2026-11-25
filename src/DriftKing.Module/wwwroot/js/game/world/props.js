// DriftKing · world/props.js – the set pieces the maps share, one import for all of them: buildings with lit windows and rooftop gear, the
// distant skyline (props-buildings.js), neon signs on dark boxes (props-signs.js), street lamps with emissive lenses, glows, pools and real
// lights (props-lamps.js), cedars/conifers (props-trees.js), parked cars (props-cars.js). Realistic dimensions and the material factory of
// the quality (options.materials = ctx.materials); instanced or merged per material everywhere, cheaper shapes on low.

export { NEON_COLOURS, Signs, signAtlases } from './props-signs.js';
export { buildingGeometry, buildingMesh, buildSkyline, windowTexture } from './props-buildings.js';
export { buildLamps } from './props-lamps.js';
export { buildTrees } from './props-trees.js';
export { buildParkedCars } from './props-cars.js';
