# Hex Empire

A Civilization-like **3D hex-based 4X** strategy game, built with [Three.js](https://threejs.org/).
Explore a procedurally generated continent, found cities, research a tech tree,
build an economy, and fight rival AI civilizations for the map.

### ▶ [Play it in your browser](https://jmoore6364.github.io/hex-empire/)

No install needed — works on desktop and touch (drag to pan, pinch to zoom).

![status](https://img.shields.io/badge/status-pass%203%20in%20progress-brightgreen)
[![deploy](https://github.com/jmoore6364/hex-empire/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/jmoore6364/hex-empire/actions/workflows/deploy-pages.yml)

## Run it locally

```bash
npm install      # installs three (already done if node_modules exists)
npm start        # serves at http://localhost:5173
```

Then open the printed URL in a modern browser. If port 5173 is busy the server
automatically tries the next one and prints the actual address.

```bash
npm test         # runs the pure-logic self-tests (hex math, worldgen, pathfinding)
```

## How to play

| Input | Action |
|---|---|
| `WASD` / arrow keys / one-finger drag | Pan the camera |
| `Q` / `E` | Rotate |
| Mouse wheel / trackpad / two-finger pinch | Zoom |
| Right-drag | Orbit / tilt |
| Left-click a unit | Select it (shows its movement range in white) |
| Left-click a tile | Move the selected unit there (hover shows the path) |
| Left-click adjacent enemy | Attack |
| **Found City** button | Settle your Settler on its current tile |
| Left-click your city | Open it: queue units/buildings |
| **🔬 Research** button | Open the tech tree; click any tech to queue the path to it |
| **📜 Civics** button | Open the civics tree; pick a government and slot policy cards |
| **🕊 Diplomacy** button | Declare war on or make peace with rival civs |
| `Tab` / Skip | Jump to the next unit that still has moves |
| `Space` | End turn · `Esc` deselect / close drawer |
| **💾 Save / 📂 Load** | Save the game to your browser and resume it later (it also autosaves each turn) |
| **🔊** | Toggle sound effects |

When a unit uses up its movement (or attacks), selection automatically advances
to your next unit with moves left and the camera pans to it — so you can play a
whole turn without hunting for idle units.

**Win** by wiping out every rival civilization (capture all their cities) or by
being the first to research **Flight**; **lose** if you're eliminated or a rival
gets Flight first. To take a city, batter it with attacks until its defense hits 0, then move
a melee unit in to capture it — City Walls and a garrison make that much harder.

Found a city, then click it to pick what to **build** (units, or buildings once
their tech is researched). Open the **🔬 Research** drawer to choose technology:
click any tech — even a distant one like Flight — and the whole prerequisite path
is queued automatically. Each turn your cities work the tiles inside their
borders, grow, pour production into their queue, and bank science toward your
research. Expand with new Settlers and out-develop the **rival AI
civilizations** spread across the map — who also war with each other.

## What's implemented

**Start menu & setup**

- **Title screen** — a start menu with a **civilization picker** (six civs, each
  with its own colour and a unique **trait** — Seafarers −30% settler cost,
  Warmongers +3 combat, Cultivators +15% food, Merchants +25% gold, Scholars
  +25% science, Industrious +15% production), plus **settings**: map size
  (Small/Medium/Large), number of AI opponents (1–4), and sound on/off. Your
  chosen civ sets your colour and bonus; the AIs take distinct civs. **Continue**
  resumes the autosave. Traits fold straight into the modifier system, so they
  apply to yields, combat and unit costs everywhere.

**Pass 1 — the playable core**

- **3D hex map** — a large procedurally generated **archipelago**: a main
  continent ringed by ocean, scattered islands, and enclosed inland lakes, across
  every terrain type (plains, grassland, forest, desert, tundra, snow, hills,
  mountains). Per-tile colour variation, ACES tone mapping, a gradient sky and
  soft sun shadows give it depth, dressed with **instanced low-poly forests,
  snow-capped mountain ranges, and gently shimmering water**. Tiles are a single
  InstancedMesh and the props are instanced too, so even ~2000 tiles stay cheap;
  forests and peaks hide under fog until explored.
  Deterministic per random seed each load; both civs start on the main landmass,
  and the outer islands are reachable once you research Sailing.
- **RTS camera** — pan / zoom / rotate / orbit.
- **Fog of war** — unexplored hexes are dark, explored-but-unseen are dimmed,
  enemies hidden until spotted.
- **Units** — Settler, Warrior, Scout as low-poly 3D models, with movement
  points, A\* pathfinding, animated movement, and a reachable-range overlay.
- **Turn system & combat** — End Turn refreshes movement and runs the AI;
  adjacent attacks with counterattacks.

**Pass 2 — the 4X loop**

- **City production queues** — click a city to queue units (and, once unlocked,
  buildings). Production accumulates each turn from the city's prod yield; the
  build menu shows per-item turn estimates and completed units appear by the city.
- **Tech tree** — a multi-era technology tree (Ancient → Modern, ending at
  Flight) in its own pop-out drawer with connector lines, à la Civ. Banked
  science is spent down a **research queue**: click any tech and the full
  prerequisite path is lined up; a toast and the drawer prompt you to pick the
  next when one completes. Early techs unlock the buildings below.
- **Civics, governments & policies** — a second **Culture** yield feeds a
  parallel **civics tree** (its own 📜 drawer, same path-queue UI). Civics unlock
  culture buildings (Monument, Amphitheater), **governments** (Chiefdom →
  Autocracy → Republic → Democracy, each with an inherent bonus and a set of
  policy slots), and **policy cards** you slot into them for empire-wide bonuses
  — +production, +gold, combat strength, cheaper settlers/military, faster
  growth. Effects stack across your government and active policies.
- **Buildings** — Granary/Aqueduct (+food), Workshop/Factory (+prod),
  Market/Bank (+gold), Library/University (+science) multiply their city's
  yields; City Walls fortify a garrison. Each is gated by its tech.
- **City territory & expanding borders** — each city claims the hexes around it
  (nearest city wins contested tiles) and works the best of them by population. A
  city's claim **grows over time** as it banks culture — its border radius
  expands from 2 out to 4, popping new tiles like Civ. Territory is drawn with a
  **crisp owner-coloured border outline** (inset so neighbouring civs' borders sit
  side by side) over a faint colour wash, so who owns what is clear at a glance.
- **Sound effects** — selection, movement, combat, founding, building, research
  and victory/defeat are all **synthesized with the Web Audio API** (no audio
  files — it works offline and adds nothing to the download). Muteable; the
  preference is remembered.
- **Save / load** — save your game to the browser (localStorage) and resume it
  any time; it also autosaves every turn, so a refresh + Load picks up where you
  left off. The map regenerates identically from its seed, so a save is tiny.
- **Multiple AI civilizations** — several rival civs (Crimson, Verdant, …) start
  spread across the map, each expanding, researching, and warring — against you
  *and each other*. Each one researches, queues production, sends settlers out to
  expand, **rushes defenders or City Walls when threatened**, sieges enemy cities,
  and **pulls wounded units back to heal**.
- **Diplomacy** — every civ pair is at **war** or **peace**. You can only attack
  someone you're at war with, so pick your fights from the **🕊 Diplomacy** panel
  (declare war / make peace). The AIs are opportunistic: they declare war on
  weaker neighbours, gang up, and sue for peace when they're outmatched.

**Pass 3 — characters & depth** *(in progress)*

- **Tile resources** — Wheat, Fish, Horses, Iron, Gold and Stone spawn on
  matching terrain (deterministic per seed), boost that tile's yields, and show
  as floating gems once you've explored them.
- **Rivers** — blue river courses run downhill from the highlands to the sea;
  a river tile gains **+1 food and +1 gold** (fresh water & trade) but costs an
  extra point to ford. Great city sites hug a river.
- **Ranged combat** — a new **Archer** strikes from 2 tiles away and takes no
  counterattack; melee units must close to an adjacent hex. Selected units paint
  their attackable enemies red.
- **Combat animations** — melee units lunge, archers loose an arrow, the
  defender flashes with a spark burst and a floating "−N" damage number, and the
  slain fade and sink rather than popping out.
- **Tech unlocks real power** — research opens up a progression of units, each
  with its own low-poly model: Horseman, Swordsman, Catapult, Crossbowman,
  Musketman, Artillery, Tank and the Airplane, alongside the economy/defense
  buildings above. Units only appear in a city's build menu once their tech is in.
- **Rigged character models** — soldier-type units are a **little squad of three
  small rigged characters** with **idle/walk animation** (a CC0 RobotExpressive,
  by Tomás Laulhé / Don McCurdy) clustered on an owner-coloured base, loaded via
  Three's GLTFLoader. It's a
  progressive enhancement: if the model can't load, units fall back to their
  procedural meshes. Drop your own rigged `.glb` (from Meshy / Tripo / Mixamo /
  Quaternius…) into `vendor/models/` and register it in `src/models.js`.
- **City defense** — a unit garrisoned on its city takes reduced damage, and
  City Walls (Masonry) make it tougher still.
- **Ships & seafaring** — research **Sailing** to *embark* land units across the
  water (they ride a little boat and are vulnerable at sea) and to build naval
  units in coastal cities: the **Galley**, and later the **Frigate**. Sail a
  Settler over to colonize the outer islands, or send a fleet to raid the coast.
- **Healing & attrition** — a unit that holds position recovers HP (the most
  inside a friendly city, some on owned land, none while embarked at sea), so
  fights are wars of attrition rather than one-shots.
- **City capture & victory** — cities have defense HP (boosted by population and
  City Walls) that regenerates between assaults. Wear a city down and march a
  melee unit in to capture it. Win by **domination** (eliminate the AI) or by
  reaching **Flight**; a game-over screen offers a fresh game. The AI besieges
  your cities too.
- **Terrain defense** — defenders on hills, forest and mountains take less
  damage, so where you fight matters.

## Architecture

Pure game logic is kept free of Three.js so it can be unit-tested in Node:

| File | Responsibility |
|---|---|
| `src/hex.js` | Hex grid math (axial/cube coords, neighbors, distance, layout) — *pure* |
| `src/worldgen.js` | Seeded Perlin terrain generation, terrain catalogue — *pure* |
| `src/pathfinding.js` | A\* and movement-range flood fill — *pure* |
| `src/tech.js` | Tech tree catalogue & research prerequisites — *pure* |
| `src/civics.js` | Civics tree, governments & policy cards — *pure* |
| `src/buildings.js` | Building catalogue & yield multipliers — *pure* |
| `src/territory.js` | City tile ownership (claims, contested-tile resolution) — *pure* |
| `src/economy.js` | Per-city yield calculation (worked tiles + buildings) — *pure* |
| `src/resources.js` | Tile resource catalogue & yield bonuses — *pure* |
| `src/combat.js` | Terrain defense bonuses & attack resolution (incl. ranged) — *pure* |
| `src/effects.js` | Short-lived combat visuals (lunge, hit-flash, projectile, death fade) |
| `src/world.js` | Renders tile data into hex-prism meshes; fog, highlight & border overlays |
| `src/units.js` | Unit & City classes — their 3D meshes and movement animation |
| `src/models.js` | Optional rigged GLTF character loader (idle/walk), with procedural fallback |
| `src/game.js` | Rules: turns, fog, founding, combat, the 4X economy, AI |
| `src/camera.js` | RTS camera rig |
| `src/ui.js` | HUD / selection panel (plain DOM) |
| `src/researchui.js` | Pop-out tech-tree drawer (era columns, connectors, path queuing) |
| `src/audio.js` | Synthesized Web Audio sound effects |
| `src/main.js` | Bootstrap: scene, lights, input, render loop |
| `server.mjs` | Zero-dependency static server |
| `test/logic.test.mjs` | Self-tests for the pure modules |
| `test/smoke.mjs` | Optional headless e2e (drives the app in Edge/Chromium via CDP) |

## Deploying

The game is a static, no-build ES-module site hosted on **GitHub Pages**. Every
push to `main` triggers `.github/workflows/deploy-pages.yml`, which runs the
logic tests and then publishes the repo root. Three.js is vendored as a single
file (`vendor/three.module.js`) and referenced with a relative path, so the site
works under the project's `/hex-empire/` base path with no CDN dependency.

## Roadmap

- **Pass 2 — 4X loop:** ✅ city build queues, tech tree, unit production, buildings,
  city territory, AI economy.
- **Pass 3 — characters & depth:** ⏳ tile resources, ranged combat and terrain
  defense are in; still to come — rigged GLTF character models, distinct unit
  art per type, and smarter strategic AI.
- **Pass 4+ —** diplomacy, multiple civs, victory conditions, UI polish, save/load.
