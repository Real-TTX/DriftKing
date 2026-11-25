// DriftKing · maps/city-facade.js – the facades of the Neon-Viertel: one material per wall finish (tile cladding, cast concrete, brick; the
// shared texture sets of render/textures.js) with the windows drawn by the shader. Every wall quad carries its window grid in vertex attributes
// (bay width, storey height, seed, share of lit windows, the opening, mode, style, columns × rows), so one draw call shows thousands of different
// windows: aluminium frames and mullions, sills with rain streaks, glass that reflects the street (medium/high), and behind it a real room by
// interior mapping (medium/high: the view ray runs into a box – back wall, side walls, floor, ceiling with its lamp – so the rooms have depth
// when the camera moves), lit warm or cool, with curtains, blinds, furniture, offices with tube panels, a television flickering in a dark flat.
// Ground floors are shops: bright shelves, bars and restaurants, roller shutters. Low draws the same windows flat (Lambert, no parallax).
//   const facades = new Facades(ctx);  facades.wall('tiles', a, b, y0, y1, grid);  facades.roof('concrete', corners, y);  facades.build(root);

import * as THREE from 'three';

/** Window styles of the upper floors (the variant attribute). */
export const STYLE = Object.freeze({ APARTMENT: 0, OFFICE: 1, MIXED: 2, HOTEL: 3, OLD: 4 });
/** Ground-floor units (the variant attribute of mode SHOP). */
export const SHOP = Object.freeze({ OPEN: 0, SHUTTER: 1, RESTAURANT: 2, ENTRANCE: 3, BAR: 4 });
/** Quad modes: windows, a shop unit, a plain wall (roofs, blank party walls). */
export const MODE = Object.freeze({ WINDOWS: 0, SHOP: 1, PLAIN: 2 });

/** The wall finishes: texture recipe and how many recipe tiles per metre (the uv scale). */
const FINISHES = {
    tiles: { recipe: 'tiles', scale: 1.2 / 0.6 },
    concrete: { recipe: 'concrete', scale: 1 / 0.9 },
    brick: { recipe: 'brick', scale: 1 },
};

const VERTEX_PARS = /* glsl */ `
    attribute vec2 facadeUv;
    attribute vec4 facadeCell;
    attribute vec4 facadeWin;
    attribute vec4 facadeKind;
    varying vec2 vFcUv;
    varying vec4 vFcCell;
    varying vec4 vFcWin;
    varying vec4 vFcKind;`;

const VERTEX_MAIN = /* glsl */ `
    vFcUv = facadeUv;
    vFcCell = facadeCell;
    vFcWin = facadeWin;
    vFcKind = facadeKind;`;

const FRAGMENT_PARS = /* glsl */ `
    uniform float fcTime;
    varying vec2 vFcUv;
    varying vec4 vFcCell;   // bay width, storey height (m), seed, share of lit windows
    varying vec4 vFcWin;    // the opening inside a cell: x0, x1, y0, y1 (m)
    varying vec4 vFcKind;   // mode (0 windows, 1 shop, 2 plain), style / shop kind, columns, rows

    float fcHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    // an anti-aliased rectangle mask (aa = metres per pixel)
    float fcBox(vec2 p, vec2 a, vec2 b, float aa) {
        vec2 s = smoothstep(a - aa, a + aa, p) * (1.0 - smoothstep(b - aa, b + aa, p));
        return s.x * s.y;
    }

    // frames: the outer frame, mullions between the panes, a transom (offices) or the door head (shops)
    float fcFrameMask(vec2 q, vec2 size, float shop, float style, float aa) {
        float fw = shop > 0.5 ? 0.07 : 0.05;
        float edge = min(min(q.x, size.x - q.x), min(q.y, size.y - q.y));
        float frame = 1.0 - smoothstep(fw - aa, fw + aa, edge);
        float panes = shop > 0.5 ? floor(size.x / 1.5) + 1.0 : (size.x > 1.35 ? 2.0 : 1.0);
        if (panes > 1.5) {
            float pitch = size.x / panes;
            float m = abs(fract(q.x / pitch + 0.5) - 0.5) * pitch;
            frame = max(frame, 1.0 - smoothstep(0.03 - aa, 0.03 + aa, m));
        }
        float bar = shop > 0.5 ? 2.25 : (abs(style - 1.0) < 0.5 ? size.y * 0.78 : -10.0);
        if (bar > 0.0 && bar < size.y - 0.2) frame = max(frame, 1.0 - smoothstep(0.03 - aa, 0.03 + aa, abs(q.y - bar)));
        return frame;
    }

    // the colour of the light in a room: 0 flat, 1 office, 2 shop, 3 bar/restaurant
    vec3 fcLightColour(float type, float h) {
        if (type > 2.5) return h < 0.45 ? vec3(1.0, 0.55, 0.26) : h < 0.75 ? vec3(1.0, 0.32, 0.58) : vec3(0.62, 0.42, 1.0);
        if (type > 1.5) return h < 0.6 ? vec3(0.9, 0.96, 1.0) : vec3(1.0, 0.88, 0.72);
        if (type > 0.5) return h < 0.65 ? vec3(0.84, 0.92, 1.0) : vec3(1.0, 0.95, 0.86);
        return h < 0.5 ? vec3(1.0, 0.62, 0.32) : h < 0.82 ? vec3(1.0, 0.76, 0.52) : vec3(0.8, 0.9, 1.0);
    }

    vec3 fcCloth(float h) {
        return h < 0.35 ? vec3(1.0, 0.86, 0.66) : h < 0.55 ? vec3(0.95, 0.94, 0.9) : h < 0.68 ? vec3(0.95, 0.42, 0.25)
             : h < 0.8 ? vec3(0.5, 0.78, 0.5) : h < 0.9 ? vec3(0.45, 0.6, 0.95) : vec3(1.0, 0.55, 0.72);
    }

    #ifdef FC_PBR
    // interior mapping: the room behind the glass is a box (x across the window, y up from the window's bottom edge, z into the building);
    // the view ray from the glass point q hits its back wall, a side wall, the floor or the ceiling
    vec3 fcRoom(vec2 q, vec2 size, vec3 rd, float sill, float ceil, float depth, float type, float h, float h2) {
        vec3 r = rd;
        r.x = abs(r.x) < 1e-3 ? 1e-3 : r.x;
        r.y = abs(r.y) < 1e-3 ? 1e-3 : r.y;
        float wide = type > 1.5 ? 1.6 : 0.7;
        float tx = ((r.x > 0.0 ? size.x + wide : -wide) - q.x) / r.x;
        float ty = ((r.y > 0.0 ? ceil : -sill) - q.y) / r.y;
        float tz = depth / -r.z;
        float t = min(tz, min(tx, ty));
        vec3 p = vec3(q, 0.0) + r * t;
        float y = p.y + sill;
        float z = -p.z;
        float height = ceil + sill;
        vec3 lamp = vec3(size.x * 0.5, height - 0.25, depth * 0.45);
        vec3 d = vec3(p.x, y, z) - lamp;
        float fall = 1.5 / (1.0 + dot(d, d) * 0.16);
        bool back = t == tz;
        bool top = t == ty && r.y > 0.0;
        bool bottom = t == ty && r.y < 0.0;
        vec3 c = vec3(0.0);
        float gain = 1.0;
        if (type < 0.5) {
            // a flat: painted walls, a wooden floor, a pendant lamp, a cupboard and a picture on the back wall
            vec3 paint = h2 < 0.6 ? vec3(0.8, 0.76, 0.68) : h2 < 0.85 ? vec3(0.68, 0.72, 0.7) : vec3(0.78, 0.66, 0.6);
            if (top) c = vec3(0.85) + 7.0 * (1.0 - smoothstep(0.16, 0.22, length(vec2(p.x, z) - lamp.xz)));
            else if (bottom) c = vec3(0.36, 0.24, 0.15);
            else c = paint * (back ? 1.0 : 0.82);
            if (back) {
                float fx = (0.15 + 0.7 * fract(h * 7.31)) * size.x;
                float fw = 0.5 + fract(h * 3.17) * 1.2;
                float fh = 0.8 + fract(h * 5.71) * 1.1;
                c = mix(c, vec3(0.12, 0.08, 0.06), step(abs(p.x - fx), fw * 0.5) * step(y, fh));
                vec3 picture = vec3(0.35, 0.2, 0.18) + 0.45 * vec3(fract(h * 13.0), fract(h * 17.0), fract(h * 19.0));
                c = mix(c, picture, step(abs(p.x - size.x * fract(h2 * 9.1)), 0.3) * step(abs(y - 1.6), 0.25) * step(0.4, h2));
            }
            gain = fall;
        } else if (type < 1.5) {
            // an office: rows of tube panels, partitions, cool walls, even light
            if (top) {
                float row = 1.0 - smoothstep(0.1, 0.16, abs(fract(z / 2.4) - 0.5));
                float col = 1.0 - smoothstep(0.3, 0.36, abs(fract(p.x / 1.8) - 0.5) * 1.8);
                c = vec3(0.7) + vec3(6.0) * row * col;
            } else if (bottom) {
                c = vec3(0.22, 0.24, 0.27);
            } else {
                c = vec3(0.74, 0.76, 0.78) * (back ? 1.0 : 0.85);
                c = mix(c, vec3(0.3, 0.33, 0.37), step(y, 1.15));
                c = mix(c, vec3(0.08), step(abs(y - 0.74), 0.03));
            }
            gain = 0.75 + 0.35 * fall;
        } else if (type < 2.5) {
            // a shop: shelves full of goods along the walls, tube rows, a pale tiled floor
            if (top) {
                c = vec3(0.8) + vec3(5.0) * (1.0 - smoothstep(0.06, 0.1, abs(fract(z / 1.6) - 0.5)));
            } else if (bottom) {
                vec2 tile = abs(fract(vec2(p.x, z) / 0.6) - 0.5);
                c = vec3(0.72) * (0.85 + 0.15 * step(0.46, max(tile.x, tile.y)));
            } else {
                float along = back ? p.x : z;
                vec2 cell = floor(vec2(along / 0.28, y / 0.42));
                float g = fcHash(cell + h * 31.0);
                vec3 goods = 0.3 + 0.55 * vec3(fract(g * 7.0), fract(g * 13.0), fract(g * 29.0));
                goods *= step(0.12, fract(along / 0.28)) * 0.75 + 0.25;
                goods *= 0.55 + 0.45 * smoothstep(0.1, 0.4, fract(y / 0.42));
                c = y < 2.1 ? mix(goods, vec3(0.8), step(fract(y / 0.42), 0.12)) : vec3(0.88);
            }
        } else {
            // a bar or a restaurant: dark wood, a counter, bottles on a lit shelf, small spots in the ceiling
            if (top) {
                vec2 spot = abs(fract(vec2(p.x, z) / 1.4) - 0.5);
                c = vec3(0.12) + vec3(8.0) * (1.0 - smoothstep(0.04, 0.07, length(spot)));
            } else if (bottom) {
                c = vec3(0.12, 0.08, 0.06);
            } else {
                c = vec3(0.24, 0.14, 0.08);
                float bottles = step(1.3, y) * step(y, 2.0) * step(0.5, fract(p.x / 0.11)) * (back ? 1.0 : 0.0);
                c = mix(c, vec3(0.9, 0.6, 0.3) * (0.4 + fract(h * 23.0 + floor(p.x / 0.11) * 0.37)), bottles);
                c = mix(c, vec3(0.34, 0.2, 0.11), step(y, 1.05));
            }
            gain = fall * 0.8;
        }
        return c * gain;
    }
    #else
    // low: the room as a flat glow, brighter under the ceiling
    vec3 fcRoomFlat(vec2 q, vec2 size, float type) {
        float v = clamp(q.y / size.y, 0.0, 1.0);
        if (type > 2.5) return vec3(0.42, 0.28, 0.2) * (0.6 + 0.6 * v);
        if (type > 1.5) {
            // shelves with goods up to 2 m, the bright ceiling above
            float g = fcHash(floor(vec2(q.x / 0.22, q.y / 0.42)));
            vec3 goods = 0.3 + 0.6 * vec3(fract(g * 7.0), fract(g * 13.0), fract(g * 29.0));
            return q.y > 2.05 ? vec3(0.95) : mix(goods, vec3(0.8), step(fract(q.y / 0.42), 0.14)) * 0.8;
        }
        if (type > 0.5) return vec3(0.75, 0.77, 0.8) * (0.7 + 0.35 * v);
        return vec3(0.78, 0.72, 0.62) * (0.5 + 0.7 * v);
    }
    #endif

    // what hangs behind the glass of a flat or an office: curtains drawn aside or closed, blinds lowered to some height
    vec3 fcCover(vec3 inside, vec2 q, vec2 size, vec3 lamp, float style, float h, float h2, float h3) {
        vec2 share = style < 0.5 ? vec2(0.55, 0.2) : style < 1.5 ? vec2(0.0, 0.55) : style < 2.5 ? vec2(0.3, 0.35) : style < 3.5 ? vec2(0.8, 0.1) : vec2(0.5, 0.15);
        vec3 cloth = fcCloth(h2);
        // soft irregular folds, the fabric glowing brighter towards its middle
        float folds = 0.8 + 0.12 * sin(q.x * 19.0 + h * 11.0) + 0.08 * sin(q.x * 43.0 + h2 * 5.0);
        float glow = 0.75 + 0.25 * smoothstep(0.0, 0.5, q.y / size.y) * smoothstep(1.0, 0.6, q.y / size.y);
        if (h3 < share.x) {
            if (h3 < share.x * 0.35) return lamp * cloth * 0.42 * folds * glow;
            float centre = size.x * (0.2 + 0.6 * h);
            float gap = size.x * (0.06 + 0.3 * h2);
            float m = smoothstep(gap - 0.04, gap + 0.04, abs(q.x - centre));
            return mix(inside, lamp * cloth * 0.34 * folds * glow, m);
        }
        if (h3 < share.x + share.y) {
            float drop = size.y * (0.15 + 0.85 * fract(h2 * 3.7));
            float m = step(size.y - drop, q.y);
            vec3 blind = lamp * mix(vec3(0.15), vec3(0.6), smoothstep(0.5, 0.85, fract(q.y * 11.0))) * vec3(1.0, 0.97, 0.9);
            return mix(inside, blind, m);
        }
        return inside;
    }`;

// after color_fragment: the window or shop of this fragment – albedo, and the values the later chunks use
const FRAGMENT_ALBEDO = /* glsl */ `
    float fcGlass = 0.0;
    float fcFrame = 0.0;
    float fcSill = 0.0;
    float fcShutter = 0.0;
    float fcRibSlope = 0.0;
    vec3 fcEmissive = vec3(0.0);
    if (vFcKind.x < 1.5) {
        float fcAa = max(fwidth(vFcUv.x), fwidth(vFcUv.y)) * 0.75 + 1e-4;
        float fcShop = step(0.5, vFcKind.x);
        float fcStyle = vFcKind.y;
        vec2 fcCellSize = vFcCell.xy;
        vec2 fcGrid = vFcUv / fcCellSize;
        vec2 fcId = floor(fcGrid);
        vec2 fcP = (fcGrid - fcId) * fcCellSize;
        vec2 fcW0 = vFcWin.xz;
        vec2 fcW1 = vFcWin.yw;
        float fcIn = step(0.0, fcId.x) * step(fcId.x, vFcKind.z - 0.5) * step(0.0, fcId.y) * step(fcId.y, vFcKind.w - 0.5);
        float fcSeed = vFcCell.z;
        float fcH = fcHash(fcId + fcSeed * 1.618);
        float fcH2 = fcHash(fcId.yx * 1.37 + fcSeed * 0.731 + 17.0);
        float fcH3 = fcHash(fcId * 1.91 + fcSeed * 0.377 + 41.0);
        float fcH4 = fcHash(fcId * 2.71 + fcSeed * 0.113 + 5.0);
        float fcOpen = fcBox(fcP, fcW0, fcW1, fcAa) * fcIn;
        if (fcShop < 0.5 && fcIn > 0.5) {
            // the sill under the window and the dirt the rain has washed down from it
            fcSill = fcBox(fcP, vec2(fcW0.x - 0.06, fcW0.y - 0.08), vec2(fcW1.x + 0.06, fcW0.y), fcAa) * step(0.3, fcW0.y);
            float below = fcW0.y - 0.08 - fcP.y;
            float streak = step(fcW0.x, fcP.x) * step(fcP.x, fcW1.x) * step(0.0, below) * max(0.0, 1.0 - below / 1.4) * (0.55 + 0.45 * sin(fcP.x * 23.0 + fcSeed));
            diffuseColor.rgb *= 1.0 - 0.3 * streak;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.49, 0.47), fcSill);
        }
        if (fcOpen > 0.001) {
            // the kind of room: flats, offices, shops, bars (mixed-use buildings have a bit of everything)
            float fcType = 0.0;
            if (fcShop > 0.5) fcType = fcStyle < 0.5 ? 2.0 : fcStyle < 2.5 ? 3.0 : fcStyle < 3.5 ? 1.0 : 3.0;
            else if (abs(fcStyle - 1.0) < 0.5) fcType = 1.0;
            else if (abs(fcStyle - 2.0) < 0.5) fcType = fcH2 < 0.5 ? 0.0 : fcH2 < 0.8 ? 3.0 : 1.0;
            float fcLit = fcShop > 0.5 ? 1.0 : step(fcH, vFcCell.w);
            if (fcShop < 0.5 && fcType > 0.5 && fcType < 1.5) fcLit = step(fcHash(vec2(fcId.y, fcSeed)), vFcCell.w * 1.3) * step(fcH, 0.93);
            vec3 fcLamp = fcLightColour(fcType, fcH4) * (fcShop > 0.5 ? (fcType > 1.5 && fcType < 2.5 ? 1.55 : 1.3) : 0.6 + 0.5 * fcH3);
            vec2 fcSize = fcW1 - fcW0;
            #ifdef FC_PBR
                // the glass sits in a recess: at an angle the view ray meets the reveal first
                vec3 fcNv = normalize(vNormal);
                vec3 fcUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
                vec3 fcTv = normalize(cross(fcUpV, fcNv));
                vec3 fcView = normalize(-vViewPosition);
                vec3 fcRd = vec3(dot(fcView, fcTv), dot(fcView, fcUpV), min(dot(fcView, fcNv), -0.04));
                float fcFar = smoothstep(0.025, 0.08, fcAa);
                float fcRecess = (fcShop > 0.5 ? 0.1 : 0.16) * (1.0 - fcFar);
                vec2 fcGp = fcP + clamp(fcRd.xy * (fcRecess / -fcRd.z), -0.6, 0.6);
                float fcOnGlass = mix(fcBox(fcGp, fcW0, fcW1, fcAa), 1.0, fcFar);
                vec2 fcQ = fcGp - fcW0;
                float fcDepth = fcShop > 0.5 ? 5.5 : 3.4 + fcH * 1.8;
                float fcCeil = fcCellSize.y - fcW0.y - (fcShop > 0.5 ? 0.7 : 0.35);
                vec3 fcInside = fcRoom(fcQ, fcSize, fcRd, fcW0.y, fcCeil, fcDepth, fcType, fcH, fcH2) * fcLamp;
            #else
                float fcOnGlass = 1.0;
                vec2 fcQ = fcP - fcW0;
                vec3 fcInside = fcRoomFlat(fcQ, fcSize, fcType) * fcLamp;
            #endif
            float fcFrameM = fcFrameMask(fcQ, fcSize, fcShop, fcStyle, fcAa);
            if (fcShop < 0.5) fcInside = fcCover(fcInside, fcQ, fcSize, fcLamp, fcStyle, fcH, fcH2, fcH3);
            else if (abs(fcStyle - 2.0) < 0.5) {
                // a restaurant's split curtain over the door, lit from behind
                float noren = step(fcSize.y - 0.62, fcQ.y) * step(0.025, abs(fract(fcQ.x / 0.42) - 0.5) * 0.42);
                fcInside = mix(fcInside, (fcH4 < 0.5 ? vec3(0.08, 0.1, 0.35) : vec3(0.5, 0.06, 0.05)) * (1.2 + 2.0 * step(abs(fcQ.y - fcSize.y + 0.3), 0.08)), noren);
            }
            vec3 fcGlow = fcInside * fcLit;
            // a television in a dark flat
            float fcScreen = (1.0 - fcLit) * step(0.95, fcH3) * (1.0 - fcShop);
            fcGlow += fcScreen * vec3(0.22, 0.34, 0.85) * (0.3 + 0.18 * sin(fcTime * 7.0 + fcH * 40.0) * sin(fcTime * 2.3 + fcH2 * 17.0));
            vec3 fcFrameColour = fract(fcSeed * 0.37) < 0.55 ? vec3(0.46, 0.48, 0.5) : vec3(0.06, 0.06, 0.07);
            vec3 fcWin = mix(diffuseColor.rgb * 0.4, mix(vec3(0.012, 0.014, 0.018), fcFrameColour, fcFrameM), fcOnGlass);
            float fcIsShutter = fcShop * (1.0 - step(0.5, abs(fcStyle - 1.0)));
            if (fcIsShutter > 0.5) {
                // a roller shutter: ribbed galvanised slats, a heavier bottom rail, grime from the street
                float y = fcP.y - fcW0.y;
                float rib = sin(y * 83.8);
                fcRibSlope = cos(y * 83.8);
                fcWin = vec3(0.42, 0.44, 0.46) * (0.86 + 0.14 * rib) * mix(0.62, 1.0, smoothstep(0.0, 1.4, y)) * (y < 0.14 ? 0.55 : 1.0);
                fcGlow = vec3(0.0);
                fcFrameM = 0.0;
                fcOnGlass = 1.0;
                fcShutter = fcOpen;
            }
            diffuseColor.rgb = mix(diffuseColor.rgb, fcWin, fcOpen);
            fcGlass = fcOpen * fcOnGlass * (1.0 - fcFrameM) * (1.0 - fcIsShutter);
            fcFrame = fcOpen * fcOnGlass * fcFrameM;
            fcEmissive = fcGlow * fcGlass;
        }
    }`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
    roughnessFactor = mix(roughnessFactor, 0.05, fcGlass);
    roughnessFactor = mix(roughnessFactor, 0.38, max(fcFrame, fcShutter));
    roughnessFactor = mix(roughnessFactor, 0.62, fcSill);`;

const FRAGMENT_METALNESS = /* glsl */ `
    metalnessFactor = mix(metalnessFactor, 0.0, max(fcGlass, fcSill));
    metalnessFactor = mix(metalnessFactor, 0.8, fcFrame);
    metalnessFactor = mix(metalnessFactor, 0.55, fcShutter);`;

const FRAGMENT_NORMAL = /* glsl */ `
    normal = normalize(mix(normal, nonPerturbedNormal, clamp(fcGlass + fcFrame + fcShutter + fcSill, 0.0, 1.0)));
    #ifdef USE_NORMALMAP_TANGENTSPACE
        if (fcShutter > 0.0) normal = normalize(mix(normal, normalize(tbn * vec3(0.0, fcRibSlope * 0.4, 1.0)), fcShutter));
        if (fcSill > 0.0) normal = normalize(mix(normal, normalize(tbn * vec3(0.0, 0.7, 0.7)), fcSill * 0.6));
    #endif`;

/** Builds the facade material of a wall finish: Standard (medium/high) or Lambert (low) with the window shader. Owned by the world. */
function facadeMaterial(set, pbr, time) {
    const material = pbr
        ? new THREE.MeshStandardMaterial({
            map: set.map,
            normalMap: set.normalMap,
            roughnessMap: set.roughnessMap,
            metalnessMap: set.metalnessMap,
            aoMap: set.aoMap,
            vertexColors: true,
            roughness: 1,
            metalness: 1,
        })
        : new THREE.MeshLambertMaterial({ map: set.map, vertexColors: true });
    if (pbr) material.defines = { FC_PBR: '' };
    material.onBeforeCompile = shader => {
        shader.uniforms.fcTime = time;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
            .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
        let fragment = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
            .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_ALBEDO}`)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fcEmissive;');
        if (pbr) {
            fragment = fragment
                .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
                .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAGMENT_METALNESS}`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
        }
        shader.fragmentShader = fragment;
    };
    material.customProgramCacheKey = () => (pbr ? 'city-facade-pbr' : 'city-facade-low');
    return material;
}

/** Growing typed arrays of one facade mesh (one wall finish). */
class FacadeBuffer {
    constructor(scale) {
        this.scale = scale;
        this.position = [];
        this.normal = [];
        this.uv = [];
        this.facadeUv = [];
        this.cell = [];
        this.win = [];
        this.kind = [];
        this.color = [];
        this.index = [];
        this.count = 0;
    }

    vertex(x, y, z, nx, ny, nz, u, v, fu, fv, g, tint) {
        this.position.push(x, y, z);
        this.normal.push(nx, ny, nz);
        this.uv.push(u * this.scale, v * this.scale);
        this.facadeUv.push(fu, fv);
        this.cell.push(g.bay, g.storey, g.seed, g.lit);
        this.win.push(g.x0, g.x1, g.y0, g.y1);
        this.kind.push(g.mode, g.style, g.cols, g.rows);
        this.color.push(tint.r, tint.g, tint.b);
        this.count++;
    }

    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('facadeUv', new THREE.Float32BufferAttribute(this.facadeUv, 2));
        g.setAttribute('facadeCell', new THREE.Float32BufferAttribute(this.cell, 4));
        g.setAttribute('facadeWin', new THREE.Float32BufferAttribute(this.win, 4));
        g.setAttribute('facadeKind', new THREE.Float32BufferAttribute(this.kind, 4));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
        g.computeBoundingSphere();
        return g;
    }
}

const PLAIN = Object.freeze({ bay: 1, storey: 1, seed: 0, lit: 0, x0: 0, x1: 0, y0: 0, y1: 0, mode: MODE.PLAIN, style: 0, cols: 0, rows: 0 });

/**
 * Collects the facades of the district and builds one mesh per wall finish.
 * A window grid g = { bay, storey, seed, lit, x0, x1, y0, y1, mode, style, cols, rows, u0, v0 }: the grid starts u0 metres from the left edge
 * of the wall and v0 metres above its foot (cells outside cols × rows are plain wall).
 */
export class Facades {
    constructor(ctx) {
        this.ctx = ctx;
        this.pbr = ctx.quality !== 'low';
        /** The time uniform of the facade shaders (flickering televisions). */
        this.time = { value: 0 };
        this.buffers = {};
        for (const [name, f] of Object.entries(FINISHES)) this.buffers[name] = new FacadeBuffer(f.scale);
        this.tint = new THREE.Color();
    }

    /**
     * A vertical wall from a to b ({ x, z }, a on the left seen from outside) between heights y0 and y1, in a finish, tinted (sRGB hex).
     * textureOffset shifts the wall texture (vary it per building).
     */
    wall(finish, a, b, y0, y1, tintHex, grid = PLAIN, textureOffset = 0) {
        const buffer = this.buffers[finish];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.01 || y1 <= y0) return;
        const tx = (b.x - a.x) / length;
        const tz = (b.z - a.z) / length;
        const nx = -tz;
        const nz = tx;
        const tint = this.tint.set(tintHex);
        const g = { ...PLAIN, ...grid };
        const u0 = g.u0 ?? 0;
        const v0 = g.v0 ?? y0;
        const base = buffer.count;
        const corners = [[a, 0, y0], [b, length, y0], [b, length, y1], [a, 0, y1]];
        for (const [p, along, y] of corners) {
            buffer.vertex(p.x, y, p.z, nx, 0, nz, along + textureOffset, y, along - u0, y - v0, g, tint);
        }
        buffer.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** A flat convex polygon ({ x, z } corners in order) at height y, facing up (or down: the underside of a deck). */
    roof(finish, corners, y, tintHex, { down = false } = {}) {
        const buffer = this.buffers[finish];
        const tint = this.tint.set(tintHex);
        const base = buffer.count;
        const [a, b, c] = corners;
        const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
        const ordered = up !== down ? corners : [...corners].reverse();
        for (const p of ordered) buffer.vertex(p.x, y, p.z, 0, down ? -1 : 1, 0, p.x, -p.z, 0, 0, PLAIN, tint);
        for (let k = 1; k < ordered.length - 1; k++) buffer.index.push(base, base + k, base + k + 1);
    }

    /** A plain box (no windows) in a local frame (city-kit.js Frame): size w × h × d, centred at lx/lz, standing on y0. */
    block(finish, frame, w, h, d, lx, y0, lz, tintHex, { bottom = false, top = true } = {}) {
        const fl = frame.p(lx - w / 2, 0, lz + d / 2);
        const fr = frame.p(lx + w / 2, 0, lz + d / 2);
        const br = frame.p(lx + w / 2, 0, lz - d / 2);
        const bl = frame.p(lx - w / 2, 0, lz - d / 2);
        const offset = (lx + lz) * 0.37;
        this.wall(finish, fl, fr, y0, y0 + h, tintHex, PLAIN, offset);
        this.wall(finish, fr, br, y0, y0 + h, tintHex, PLAIN, offset + w);
        this.wall(finish, br, bl, y0, y0 + h, tintHex, PLAIN, offset + w + d);
        this.wall(finish, bl, fl, y0, y0 + h, tintHex, PLAIN, offset + 2 * w + d);
        if (top) this.roof(finish, [fl, fr, br, bl], y0 + h, tintHex);
        if (bottom) this.roof(finish, [fl, fr, br, bl], y0, tintHex, { down: true });
    }

    /** The meshes (one per finish that has quads) added to root; returns them. */
    build(root) {
        const meshes = [];
        for (const [name, f] of Object.entries(FINISHES)) {
            const buffer = this.buffers[name];
            if (buffer.count === 0) continue;
            const set = this.ctx.textures[f.recipe]();
            const mesh = new THREE.Mesh(buffer.geometry(), facadeMaterial(set, this.pbr, this.time));
            mesh.name = `facades-${name}`;
            root.add(mesh);
            meshes.push(mesh);
        }
        this.buffers = {};
        return meshes;
    }
}
