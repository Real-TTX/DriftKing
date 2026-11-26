# Car models – from Sketchfab into the game

DriftKing's cars can use real 3D models (downloaded under CC BY, credited in the game). This folder turns a downloaded model into
`src/DriftKing.Module/wwwroot/models/cars/<key>.glb` plus its entries in `wwwroot/data/car-models.json` (what the runtime reads) and
`wwwroot/data/car-credits.json` (settings → Credits). The runtime (`js/game/car/model-glb.js`, docs/RENDERING.md §13) does the rest:
paint, rims, neon, lamps, steering and spinning wheels, LOD. Low quality never loads a model.

| file | what |
|---|---|
| `cars.json` | one entry per car key: the car, its real length, the source and credits, the mapping of the model's parts |
| `download.mjs` | downloads a model through the Sketchfab API (needs your API token) and unpacks it |
| `inspect.mjs` | prints the model's node tree, materials, triangles and bounds – to write the mapping |
| `prepare.mjs` | builds the game's GLB, registers it, `--remove <key>` takes it out again |

Once: `cd tools && npm install`.

## One car, step by step

**1. Pick the model.** On sketchfab.com: downloadable, licence **CC BY** (or CC BY-SA / CC0; never NC or ND), a real car (no film or
anime replica, no famous livery). Best: separate wheels, ≤ 500 k triangles, a clean body material. The uid is the 32 hex characters at
the end of the model URL.

**2. Download** (the token: Sketchfab → Settings → Password & API → API token; it is never printed):

```sh
SKETCHFAB_TOKEN_FILE=C:/path/to/sketchfab-token.txt node tools/cars/download.mjs <uid>
# or: SKETCHFAB_TOKEN=<token> node tools/cars/download.mjs <uid> [outdir]
```

This calls `GET https://api.sketchfab.com/v3/models/<uid>/download` with `Authorization: Token <token>`, takes the `gltf.url` zip, unpacks
it into `tmp/cars/<uid>/` (git-ignored) and writes `source.json` there. It prints a cars.json snippet with title, author, licence and links.

**3. Inspect**:

```sh
node tools/cars/inspect.mjs tmp/cars/<uid>              # --materials: only the materials, --all: every node
```

Note: the node paths of the four wheels (or the one merged wheel mesh), the brake calipers/discs, the paint material(s), glass, the head
and tail lamp lenses, chrome, tyres, rims; parts to drop (a ground plate, a driver, the engine bay if hidden); the long axis and which
end is the front (the `guess` line).

**4. Write the entry** in `cars.json` (keys are contracts: `s14a`, `kaze`, … – never invent or rename one):

```jsonc
"s14a": {
  "car": "Nissan 200SX S14a",                  // shown in the credits
  "length": 4.52,                              // real length in metres: the model is scaled to it
  "wheelbase": 2.525,                          // a check: prepare warns when the measured one is > 5 % off
  "title": "…", "author": "…", "authorUrl": "…", "licence": "CC BY 4.0", "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
  "source": { "uid": "<uid>", "url": "https://sketchfab.com/3d-models/…" },
  "input": "tmp/cars/<uid>",                   // the folder (scene.gltf) or a .glb
  "forward": "-z",                             // the model's front axis (+x -x +z -z); "up": "+z" and "rotate": [x, y, z] (degrees) if needed
  "exclude": { "node": "Plane|Driver|Engine" },// parts to drop (rules: below)
  "wheels": {
    "match": "/wheel_(fl|fr|rl|rr)/",          // node path regex of everything that spins (tyre, rim, nuts…)
    "brakes": "/(caliper|brake)",              // steers but does not spin (calipers; discs may spin or not)
    "split": false                             // true: the four wheels are one mesh – cut it by quadrant
  },
  "roles": {                                   // first match wins; a string = material name regex
    "paint": "Body|Paint",
    "glass": "Glass|Window",
    "lens": "HeadlightGlass",                  // clear lamp covers
    "light_head": "Headlight_Emit|Projector",
    "light_drl": "DRL",
    "light_tail": "Taillight",
    "light_brake": { "node": "third_brake" },
    "light_reverse": "Reverse",
    "chrome": "Chrome",
    "rim": { "node": "/rim" },
    "rubber": "Tire|Tyre",
    "trim": "BlackGloss|Trim",
    "plastic": "Plastic|Black_Matte",
    "metal": "Metal",
    "caliper": "Caliper",
    "exhaust": { "node": "Exhaust" }           // not a material role: gives the exhaust mounts
  },
  "triangles": 80000,                          // near budget (whole car), default 80000
  "farTriangles": 9000,                        // far model, default 9000
  "textureSize": 1024, "smallTextureSize": 512,// base colour/emissive, other maps
  "keepTextures": [],                          // replaced roles whose texture should stay (e.g. "rubber" for tyre lettering)
  "paintable": true,                           // false: keep the model's paint (a car without paint choice)
  "lamps": { "head": 6, "drl": 4 },            // emissive strength overrides
  "mounts": { "exhaust": [[-0.45, 0.28, -2.28]] },  // override lamp/exhaust points (car frame, metres)
  "profile": { "cowl": 0.95, "aFront": 0.62 }  // hood camera: bonnet height, windscreen base
}
```

Rules (`exclude`, `wheels.match`, `wheels.brakes`, role values): a string, or `{ "material": re, "node": re, "mesh": re }` (all given ones
must match, case-insensitive), or a list of those (any). For `exclude` and the wheels a plain string is a **node path** regex; for roles a
plain string is a **material name** regex. Node paths are the `inspect.mjs` paths (`Sketchfab_model/…/wheel_FL_12/Object_7`).

Roles: `paint`, `glass`, `lens`, `chrome`, `metal`, `rubber`, `rim`, `trim`, `plastic`, `caliper` are replaced by DriftKing's materials
(one material per role – fewer draw calls); the lamp roles keep the model's texture and glow; every unmapped material stays as the model
has it (`x_<name>`: badges, grille, interior). Map as much as you can to the replaced roles – that is what makes the car look like the
rest of the game (docs/RENDERING.md §5) and keeps the draw calls down (aim: ≤ 20 body materials).

**5. Prepare**:

```sh
node tools/cars/prepare.mjs s14a                # input from cars.json "input", or: prepare.mjs s14a tmp/cars/<uid>
```

It reports the scale, the wheelbase and track it measured, the triangles before/after, draw calls, file size, warnings (orientation,
wheels, budget). The car faces +z, y is up, the wheels stand on y = 0, z = 0 is midway between the axles. Budget: **≤ 3 MB**, ≈ 60–90 k
triangles, textures ≤ 1024².

**6. Check** in the browser (`node scripts/serve.mjs`, then):

- `dev/cars.html?view=close&car=s14a&quality=high` – the headlights face the camera at `angle=0`; `&steer=0.4` turns the front wheels
  about their centres; `&brake=1&angle=180` lights the brake lamps; `&paint=%231d4fa8&rims=%23ffb020&neon=%2329e7ff` the garage choices;
  `&far=1` the far model; `&quality=low` the procedural stand-in (no download).
- `dev/garage.html?car=s14a`, `dev/drive.html?map=city&car=s14a&botcars=s14a&autopilot=1`.
- Screenshots: `node tools/shot.mjs "<url>" tmp/s14a.png` – look at them.

If something is off: wrong front → `forward`; lying on its side → `up`/`rotate`; a wheel not spinning → `wheels.match`; spinning brake
calipers → `wheels.brakes`; a part in the wrong colour → its role; floating or sunk → a ground plate or a driver left in (`exclude`).

**7. Commit** `models/cars/<key>.glb`, `data/car-models.json`, `data/car-credits.json` and the `cars.json` entry – never the download
(`tmp/` is git-ignored).

Remove a car again: `node tools/cars/prepare.mjs --remove <key>`.
