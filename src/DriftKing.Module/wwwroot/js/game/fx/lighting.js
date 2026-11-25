// DriftKing · fx/lighting.js – light for the effects that scatter it (tyre smoke): an estimate of the light at a point, worked out on the CPU per
// particle, so the shader stays cheap on every tier. It adds the hemisphere fill (plus the moon and the reflection map's fill on medium/high,
// like the materials get them), the map's lamps and neon (the light rig's registered sources – all of them, also on low where the pool of real
// lights is empty) and the cars' own lamps (headlights, tail and brake lights, underglow: fx/carlights.js hands them in every frame).
// Smoke scatters forwards: a puff between the camera and a lamp glows (Henyey–Greenstein phase).
//   const lighting = new FxLighting(world);                  // world of buildWorld (or { env, lights, scene, quality })
//   lighting.prepare(camera.position, box);                  // once per frame, box = where the particles are
//   lighting.sample(x, y, z, out);                           // out.r/g/b: light towards the camera (× the albedo = the colour)

const G = 0.5;
const G2 = G * G;
const INV_PI = 1 / Math.PI;
/** Thin smoke scatters a lamp's light like a medium (phase / 4π, the phase normalised to 1 for isotropic), not like a white wall (1 / π). */
const INV_4PI = 1 / (4 * Math.PI);
/** How much more fill a cloud gets than a surface (bounce light from the ground, multiple scattering). */
const FILL = 2.2;

/** A light the effects see (linear colour × intensity in candela; a cone around dir, or all around when coneCos ≤ −1). */
export function lightRecord() {
    return { x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0, r: 0, g: 0, b: 0, reach: 10, decay: 2, coneCos: -2, penumbraCos: -1 };
}

/** The light around the effects of one world. */
export class FxLighting {
    /**
     * @param {{ env?: { hemi?: THREE.HemisphereLight, moon?: THREE.DirectionalLight, palette?: object }, lights?: import('../render/lights.js').LightRig,
     *           scene?: THREE.Scene, quality?: string }} world
     */
    constructor(world = {}) {
        this.rig = world.lights ?? null;
        const quality = world.quality ?? 'medium';
        this.ambient = { r: 0.03, g: 0.035, b: 0.07 };
        const hemi = world.env?.hemi;
        if (hemi) {
            // a puff is lit more from the sky than from the ground; three's Lambert divides by π
            const k = hemi.intensity * INV_PI;
            this.ambient.r = (hemi.color.r * 0.62 + hemi.groundColor.r * 0.38) * k;
            this.ambient.g = (hemi.color.g * 0.62 + hemi.groundColor.g * 0.38) * k;
            this.ambient.b = (hemi.color.b * 0.62 + hemi.groundColor.b * 0.38) * k;
        }
        const moon = world.env?.moon;
        if (quality !== 'low' && moon?.parent) {
            const k = moon.intensity * INV_PI * 0.5;
            this.ambient.r += moon.color.r * k;
            this.ambient.g += moon.color.g * k;
            this.ambient.b += moon.color.b * k;
        }
        // the reflection map lights the PBR materials of medium/high as well: a warm city glow of about this much
        if (quality !== 'low' && world.scene?.environment) {
            const k = world.scene.environmentIntensity ?? 1;
            this.ambient.r += 0.03 * k;
            this.ambient.g += 0.024 * k;
            this.ambient.b += 0.02 * k;
        }
        // a cloud also catches what the lit road and walls throw back and scatters it many times: about twice the fill, and less of the sky's
        // blue (smoke reads grey, not violet)
        const a = this.ambient;
        const grey = a.r * 0.3 + a.g * 0.59 + a.b * 0.11;
        a.r = (a.r + (grey - a.r) * 0.55) * FILL + 0.012;
        a.g = (a.g + (grey - a.g) * 0.55) * FILL + 0.012;
        a.b = (a.b + (grey - a.b) * 0.55) * FILL + 0.014;
        /** The cars' lamps of this frame (fx/carlights.js fills the list; records of lightRecord()). */
        this.carSources = [];
        this.records = [];
        this.spare = [];
        this.eye = { x: 0, y: 0, z: 0 };
    }

    /**
     * Once per frame, before the effects sample: the eye and the box the particles are in (the lamps that cannot reach it are skipped).
     * @param {{ x:number, y:number, z:number }} eye the camera position
     * @param {{ minX:number, minY:number, minZ:number, maxX:number, maxY:number, maxZ:number }} box
     */
    prepare(eye, box) {
        this.eye.x = eye.x;
        this.eye.y = eye.y;
        this.eye.z = eye.z;
        for (const record of this.records) if (!record.car) this.spare.push(record);
        this.records.length = 0;
        const sources = this.rig?.sources ?? [];
        for (const s of sources) {
            if (!s.enabled || s.intensity <= 0 || s.car) continue;
            const p = s.position;
            const ox = Math.max(box.minX - p.x, 0, p.x - box.maxX);
            const oy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
            const oz = Math.max(box.minZ - p.z, 0, p.z - box.maxZ);
            if (ox * ox + oy * oy + oz * oz > s.distance * s.distance) continue;
            const r = this.spare.pop() ?? lightRecord();
            r.x = p.x;
            r.y = p.y;
            r.z = p.z;
            let dx = s.target.x - p.x;
            let dy = s.target.y - p.y;
            let dz = s.target.z - p.z;
            const l = Math.hypot(dx, dy, dz) || 1;
            r.dx = dx / l;
            r.dy = dy / l;
            r.dz = dz / l;
            r.r = s.color.r * s.intensity;
            r.g = s.color.g * s.intensity;
            r.b = s.color.b * s.intensity;
            r.reach = s.distance;
            r.decay = s.decay;
            r.coneCos = Math.cos(s.angle);
            r.penumbraCos = Math.cos(s.angle * (1 - s.penumbra));
            this.records.push(r);
        }
        for (const r of this.carSources) this.records.push(r);
    }

    /** The light a puff at (x, y, z) sends towards the eye (linear rgb, before the albedo) into out. */
    sample(x, y, z, out) {
        let r = this.ambient.r;
        let g = this.ambient.g;
        let b = this.ambient.b;
        // towards the eye (for the phase)
        let ex = this.eye.x - x;
        let ey = this.eye.y - y;
        let ez = this.eye.z - z;
        const el = Math.hypot(ex, ey, ez) || 1;
        ex /= el;
        ey /= el;
        ez /= el;
        for (const s of this.records) {
            const lx = x - s.x;
            const ly = y - s.y;
            const lz = z - s.z;
            const d2 = lx * lx + ly * ly + lz * lz;
            if (d2 >= s.reach * s.reach) continue;
            const d = Math.sqrt(d2) || 1e-3;
            const ux = lx / d;
            const uy = ly / d;
            const uz = lz / d;
            let spot = 1;
            if (s.coneCos > -1) {
                const c = ux * s.dx + uy * s.dy + uz * s.dz;
                if (c <= s.coneCos) continue;
                spot = c >= s.penumbraCos ? 1 : smooth((c - s.coneCos) / (s.penumbraCos - s.coneCos));
            }
            // three's physically based fall-off: 1 / d^decay, cut smoothly at the reach (a puff is big: never nearer than 1 m to a lamp)
            const q = d2 / (s.reach * s.reach);
            const cut = 1 - q * q;
            const falloff = (cut * cut) / Math.max(s.decay === 2 ? d2 : Math.pow(d, s.decay), 1);
            const mu = ux * ex + uy * ey + uz * ez;
            const phase = Math.min(3.5, (1 - G2) / Math.pow(1 + G2 - 2 * G * mu, 1.5));
            const k = falloff * spot * phase * INV_4PI;
            r += s.r * k;
            g += s.g * k;
            b += s.b * k;
        }
        out.r = r;
        out.g = g;
        out.b = b;
        return out;
    }
}

function smooth(t) {
    return t * t * (3 - 2 * t);
}
