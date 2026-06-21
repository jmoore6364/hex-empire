# Hex Empire

A Civilization-like **3D hex-based 4X** strategy game, built with [Three.js](https://threejs.org/).
This is **Pass 1: the playable core** — a procedurally generated 3D world you can
explore, found cities on, and fight a basic AI opponent over.

![status](https://img.shields.io/badge/status-pass%201%20playable-brightgreen)

## Run it

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
| `WASD` / arrow keys | Pan the camera |
| `Q` / `E` | Rotate |
| Mouse wheel | Zoom |
| Right-drag | Orbit / tilt |
| Left-click a unit | Select it (shows its movement range in white) |
| Left-click a tile | Move the selected unit there (hover shows the path) |
| Left-click adjacent enemy | Attack |
| **Found City** button | Settle your Settler on its current tile |
| `Space` | End turn · `Esc` deselect |

Your goal for now: scout the map, found your first city, and skirmish with the
**Crimson** AI civ that starts on the far side of the continent.

## What's implemented (Pass 1)

- **3D hex map** — procedurally generated terrain (ocean, coast, plains,
  grassland, forest, desert, tundra, snow, hills, mountains) as elevation-shaded
  hex prisms. Deterministic per random seed each load.
- **RTS camera** — pan / zoom / rotate / orbit.
- **Fog of war** — unexplored hexes are dark, explored-but-unseen are dimmed,
  enemies hidden until spotted.
- **Units** — Settler, Warrior, Scout as low-poly 3D models, with movement
  points, A\* pathfinding, animated movement, and a reachable-range overlay.
- **Cities** — found a city with a Settler; cities work surrounding tiles for
  food/production/gold/science and grow in population.
- **Turn system** — End Turn refreshes movement, runs the AI, and banks income.
- **Combat** — adjacent attacks with counterattacks; units can be destroyed.
- **AI opponent** — founds a city, then scouts and hunts your units.

## Architecture

Pure game logic is kept free of Three.js so it can be unit-tested in Node:

| File | Responsibility |
|---|---|
| `src/hex.js` | Hex grid math (axial/cube coords, neighbors, distance, layout) — *pure* |
| `src/worldgen.js` | Seeded Perlin terrain generation, terrain catalogue — *pure* |
| `src/pathfinding.js` | A\* and movement-range flood fill — *pure* |
| `src/world.js` | Renders tile data into hex-prism meshes; fog & highlight overlays |
| `src/units.js` | Unit & City classes — their 3D meshes and movement animation |
| `src/game.js` | Rules: turns, fog, founding, movement budgets, combat, AI |
| `src/camera.js` | RTS camera rig |
| `src/ui.js` | HUD / selection panel (plain DOM) |
| `src/main.js` | Bootstrap: scene, lights, input, render loop |
| `server.mjs` | Zero-dependency static server |
| `test/logic.test.mjs` | Self-tests for the pure modules |

## Roadmap

- **Pass 2 — 4X loop:** city build queues, a tech tree, unit production, resources.
- **Pass 3 — characters & depth:** swap placeholder units for proper GLTF
  character models, smarter AI, ranged combat, terrain features.
- **Pass 4+ —** diplomacy, multiple civs, victory conditions, UI polish, save/load.
