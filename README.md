# Hex Empire

A Civilization-like **3D hex-based 4X** strategy game, built with [Three.js](https://threejs.org/).
Explore a procedurally generated continent, found cities, research a tech tree,
build an economy, and fight an AI civ for the map.

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
| `Tab` / Skip | Jump to the next unit that still has moves |
| `Space` | End turn · `Esc` deselect / close drawer |

When a unit uses up its movement (or attacks), selection automatically advances
to your next unit with moves left and the camera pans to it — so you can play a
whole turn without hunting for idle units.

Found a city, then click it to pick what to **build** (units, or buildings once
their tech is researched). Open the **🔬 Research** drawer to choose technology:
click any tech — even a distant one like Flight — and the whole prerequisite path
is queued automatically. Each turn your cities work the tiles inside their
borders, grow, pour production into their queue, and bank science toward your
research. Expand with new Settlers and out-develop the **Crimson** AI civ on the
far side of the continent.

## What's implemented

**Pass 1 — the playable core**

- **3D hex map** — procedurally generated terrain (ocean, coast, plains,
  grassland, forest, desert, tundra, snow, hills, mountains) as elevation-shaded
  hex prisms. Deterministic per random seed each load.
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
- **Buildings** — Granary (+food), Workshop (+prod), Market (+gold),
  Library (+science) multiply their city's yields.
- **City territory** — each city claims the hexes within radius 2 (nearest city
  wins contested tiles) and works the best of them by population. Owner-colored
  borders are drawn on the map.
- **AI economy** — the Crimson AI researches, queues production, and sends
  settlers out to found new cities instead of starting with a fixed roster.

**Pass 3 — characters & depth** *(in progress)*

- **Tile resources** — Wheat, Fish, Horses, Iron, Gold and Stone spawn on
  matching terrain (deterministic per seed), boost that tile's yields, and show
  as floating gems once you've explored them.
- **Ranged combat** — a new **Archer** strikes from 2 tiles away and takes no
  counterattack; melee units must close to an adjacent hex. Selected units paint
  their attackable enemies red.
- **Combat animations** — melee units lunge, archers loose an arrow, the
  defender flashes with a spark burst and a floating "−N" damage number, and the
  slain fade and sink rather than popping out.
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
| `src/buildings.js` | Building catalogue & yield multipliers — *pure* |
| `src/territory.js` | City tile ownership (claims, contested-tile resolution) — *pure* |
| `src/economy.js` | Per-city yield calculation (worked tiles + buildings) — *pure* |
| `src/resources.js` | Tile resource catalogue & yield bonuses — *pure* |
| `src/combat.js` | Terrain defense bonuses & attack resolution (incl. ranged) — *pure* |
| `src/effects.js` | Short-lived combat visuals (lunge, hit-flash, projectile, death fade) |
| `src/world.js` | Renders tile data into hex-prism meshes; fog, highlight & border overlays |
| `src/units.js` | Unit & City classes — their 3D meshes and movement animation |
| `src/game.js` | Rules: turns, fog, founding, combat, the 4X economy, AI |
| `src/camera.js` | RTS camera rig |
| `src/ui.js` | HUD / selection panel (plain DOM) |
| `src/researchui.js` | Pop-out tech-tree drawer (era columns, connectors, path queuing) |
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
