# CLAUDE.md

Guidance for working in this repository. Keep it in sync with the code.

## What DriftKing is

A 3D night street-drift game in the browser, in the spirit of Japanese drift culture (touge, parking decks, harbour, neon city) – **the names, maps,
cars and art are our own: never copy a film, a game, real car brands or characters**. Realistic night look on medium/high (PBR materials, reflections, bloom, real lights, detailed cars and maps – docs/RENDERING.md); low quality stays as cheap as the old low-poly look.
Modes free ride / score attack / race, four maps (`pass`, `deck`, `harbor`, `city`), a garage (eight cars, tuning, paint, neon, decals), competitions
with medals (admin-managed), bots, online rooms, a rich HUD (speed, rpm/gear, drift angle, pedal positions, steering, chain/multiplier, minimap).

DriftKing is a **plugin of MatGame** (`../MatGame`: portal, accounts/guests, device sign-in, `/Admin`, discovery for the apps; read `../MatGame/CLAUDE.md`).
It runs in four ways from one code base:
- **On a MatGame master** (Docker, port 2770, every game): the player app at `/driftking/`, API `/driftking/api`, hub `/driftking/hub`, admin `/Admin/DriftKing`.
  MatGame compiles DriftKing in when `../DriftKing` exists (`GameDriftKing` in MatGame.csproj, like NightShift).
- **Its own image** (`ghcr.io/real-ttx/driftking`, port **2771**): the MatGame host with only DriftKing (`Dockerfile`, `MATGAME_PORT=2771`, `MATGAME_GAMES=driftking`).
  MatGame's own local stack keeps its pgAdmin on 2790, so both local stacks run side by side.
- **In the Windows app** (MatGame.Shell) online against a master the player chooses (default `MatGameDefaultServer` in `Directory.Build.props`).
- **In the app offline**: `DriftKing.Local` plays the server's part (local guest, bots, `profile.json`).

Stack: .NET 10, Razor class library, SignalR, EF Core + PostgreSQL 17 (MatGame's database, schema `driftking`), three.js r187 (vendored, no build step).

## Build / run / test

- The repositories live side by side: `../MatGame` is required (project references to `../MatGame/src/MatGame.Sdk`, `MatGame.Local`, `MatGame.Shell`).
- `dotnet build DriftKing.slnx` (0 warnings expected), `dotnet test DriftKing.slnx` (rules, room, offline game; no database).
- `./scripts/redeploy.ps1 [-Clean]` builds and starts the own stack: http://localhost:2771/driftking/ (pgAdmin 2778, Postgres 2780). `-MatGame` = MatGame's stack (2770).
- Previews without a server: `node scripts/serve.mjs` → `/driftking/dev/drive.html?map=pass&body=coupe&mode=score&bots=3&autopilot=1`, `dev/garage.html`, `dev/maps.html`.
- Browser checks: Playwright with the installed Edge (`cd tools && npm install` once), `node tools/shot.mjs <url> <png>`; screenshots go to `tmp/` (git-ignored) – look at them.
- Migrations: `dotnet tool restore`, `dotnet ef migrations add <Name> --project src/DriftKing.Module --output-dir Data/Migrations` (design-time factory: the own
  local Postgres 2780, `DRIFTKING_DESIGN_DB` overrides it). The plugin migrates its schema at start and seeds missing content (`SeedLogic`).
- Map lengths: `node scripts/maps-length.mjs` writes `lengthM` into `wwwroot/data/maps.json` (the server embeds the file for the plausibility checks).
- JS check: `node --check --input-type=module < file.js` for every module under `wwwroot/js`.
- The MatGame JS SDK in `wwwroot/js/matgame` is a **copy**: change `../MatGame/sdk/js`, then `node ../MatGame/tools/sdk-copy.js src/DriftKing.Module/wwwroot/js/matgame`.
- Logo: `node scripts/logo.js` (all SVG levels: mark, favicon, maskable, mono, logo, logo-dark, hero), `./scripts/icons.ps1` (PNG icons, cover, `driftking.ico`).
- Windows app: `dotnet run --project src/DriftKing.App`; publish `dotnet publish src/DriftKing.App -c Release -r win-x64` (one self-installing `DriftKing.exe`).

## Rules (from the owner's guidelines — keep them)

- **Git:** branches `main` (release) and `dev` (nightly). Commits only under the owner's name; **no Co-Authored-By or other contributor lines**, no generated-by lines in PRs.
- **Versions:** release `<major>.<minor>.<build>-<date>`, nightly `nightly-<build>-<date>`, local `local-<date>` (`Directory.Build.props`, CI sets Channel/BuildNumber/BuildDate).
  `DriftKingModule.Protocol` rises only with a change of the API or hub old apps cannot follow.
- **Docker:** `Dockerfile` (own image, ASP.NET Core base, port 2771), compose files for release/dev/local, no `${VARIABLES}`, no `.env`, always a stack (`name:`), volumes `web-data`, `db-data`.
- **CI** (`.github/workflows/build.yml`): build + tests + script checks, the own image for every branch (tags by channel), the Windows app (release-channel/nightly-channel), and a dispatch to MatGame (secret `MATGAME_DISPATCH_TOKEN`).
- **C#:** Microsoft conventions, readable names, flat code. **Business layer = static classes** (`Business/`), every method takes an `Actor` and **checks the permission itself** (`Guard`). **No database queries in pages or models.**
- **Accounts are MatGame's** (`Web/Players.cs`: account → `Actor`; the player row `Player.Id` = account id is made at the first request with start money and the starter car). Guests play and progress, but are not in the leaderboards.
- **Database:** schema `driftking`, PascalCase singular tables, `Id bigint`, audit columns (`AppDbContext.SaveChangesAsync`), soft delete (`UpdateState`) for players, cars, garage cars, competitions; tokens in links (`Run.Token`).
- **Admin pages** (`Pages/Admin/DriftKing/...`): MatUi through MatGame's admin shell and the SDK's admin kit; lists = toolbar, table, pager, actions below left; edit pages with `md-buttons` (Save, Back, space, Delete); areas are tabs; fields only when they make sense (`show-if`). Every page includes `<partial name="_Assets" />`.
- **The player app** (`wwwroot/index.html`, `js/game`, `css/*.css`) is game UI in the night-neon look (Anton + Inter), not MatUi. It talks to the server only through `js/game/api.js` (the SDK). Base path `/driftking/` everywhere (relative URLs only, no CDN).
- **Offline rule:** `DriftKing.Local` answers every API call and hub method with the same shapes (docs/PROTOCOL.md); a new endpoint needs its offline answer and a test in `LocalGameTests`.

## Map

```
src/DriftKing.Core      Data/Entities.cs (POCOs), Business/ Common (Actor, Guard, exceptions, ListRequest), Rules (Tuning + CarSpec, Progression, Economy, Looks,
                        MapCatalog (embedded maps.json), Plausibility, Medals), PlayerRules (GarageRules, RunRules: outcomes, prizes, competition medals),
                        SeedContent (cars, maps, competitions, bot names), Views (JSON shapes), Game/ DriftRoom (the room in memory), RoomSetup, Dtos
src/DriftKing.Module    DriftKingModule (IGameModule), Data/AppDbContext + Migrations, Business/ PlayerLogic, GarageLogic, ContentLogic (cars, maps), CompetitionLogic,
                        RunLogic, SettingLogic + SeedLogic, Game/ DriftHub (+ HubErrors), RoomRegistry + GameTicker, Web/ Api, PlayerApp, Players, AppInfo, AdminAssets,
                        Pages/Admin/DriftKing (Übersicht, Fahrer, Läufe, Autos, Strecken, Wettbewerbe, Einstellungen)
src/DriftKing.Module/wwwroot
  data/maps.json        the four courses (control points, width, lengthM, defaultLaps) – shared with the server
  js/game               main (entry), api (SDK glue), net (a run ↔ the room), nav, menu (shell, home, sign-in, profile, settings, pause, results),
                        menu-play (solo, competitions, online rooms), menu-garage, ui, settings, catalog (fixed words + specOf mirror),
                        render/ stage (renderer, frame loop, tone mapping per quality), post (HDR chain: MSAA, bloom, finish pass), device (the renderer
                        for GPU work outside a frame), environment (PMREM reflection maps night/dusk/garage), textures (procedural PBR texture recipes),
                        materials (the material factory per quality), lights (LightRig: fixed pool of real lights, presets), kit (merging, glows, pools,
                        UVs in metres, shared/disposal), world/ (env: sky, fog, fill light; world: build + ctx; course, road, props, maps/*),
                        car/ (models, physics, bot), run/ (run, drift scoring, camera), fx/, hud, input, audio, scenes/ (menu backdrop, garage turntable)
  lib/three             three.js r187 (three.module.js + three.core.js) and addons/ (postprocessing, shaders, environments, utils, geometries, objects)
  dev/                  previews (drive, garage, maps, materials: the look development board)
src/DriftKing.Local     DriftKingLocal (ILocalGame: API + hub + clock), LocalProfile
src/DriftKing.App       the Windows app (MatGame.Shell + wwwroot embedded + DriftKingLocal)
tests/DriftKing.Tests   RulesTests, RoomTests, LocalGameTests
docs/PROTOCOL.md        API, hub, who decides what, offline
docs/RENDERING.md       the rendering contract: quality tiers, post, reflections, textures, materials, lights, sky, budgets, realism reference
```

## Game rules in code

- The browser simulates its own car (and the host's browser the bots); the room decides who may send what, the start, the end and the order (docs/PROTOCOL.md).
- `CarSpec` (`Tuning.SpecOf`) is the only source of the car numbers; `js/game/catalog.js specOf` mirrors it (a test holds both to the same numbers).
- Scoring (js/game/run/drift.js): drifting at ≥ 12° and ≥ 30 km/h, rate = km/h × (0.5 + angle/45) × chain multiplier (≤ 5), ×1.25 near a wall, ×1.5 tandem,
  capped at 7 500 points/s; the server cuts above `MaxPointsPerSecond` × seconds (setting, default 8 000).
- Map keys (`pass`, `deck`, `harbor`, `city`) and body keys (`coupe`, `hatch`, `sedan`, `fastback`, `wide`, `muscle`) are contracts (DB, catalog.js, the 3D code): never rename one.
- Scale: 1 unit = 1 metre.
