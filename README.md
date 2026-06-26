# Hex Empire

A Civilization-like **3D hex-based 4X** strategy game, built with [Three.js](https://threejs.org/).
Explore a procedurally generated continent, found cities, research a tech tree,
build an economy, and fight rival AI civilizations for the map.

### ▶ [Play it in your browser](https://jmoore6364.github.io/hex-empire/)

No install needed — works on desktop and touch (drag to pan, pinch to zoom).

![status](https://img.shields.io/badge/status-pass%203%20complete-brightgreen)
[![deploy](https://github.com/jmoore6364/hex-empire/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/jmoore6364/hex-empire/actions/workflows/deploy-pages.yml)

## Run it locally

```bash
npm install      # installs Three.js (the app vendors its own copy; this is for the tests)
npm start        # serves at http://localhost:5173
```

Then open the printed URL in a modern browser. If port 5173 is busy the server
automatically tries the next one and prints the actual address.

```bash
npm test         # pure-logic self-tests + headless game-rule tests (combat, trade, civics, AI, save/load)
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
| **☰ Menu** handle (right edge) | Opens the side drawer — tabs for **🔬 Research**, **📜 Civics**, **🕊 Diplomacy**, **📊 Standings** and **⚙️ Settings** |
| 🔬 Research tab | The tech tree; click any tech to queue the path to it |
| 📜 Civics tab | The civics tree; pick a government and slot policy cards |
| 🕊 Diplomacy tab | Declare war on or make peace with rival civs |
| 📊 Standings tab | Every civ ranked by score (cities, tech, wonders, age) |
| ⚙️ Settings tab | Sound, music, save / load, and the controls reference |
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

- **Title screen** — a start menu with a **civilization picker** (twelve civs, each
  with its own colour, a unique **trait** (e.g. Seafarers −30% settler cost,
  Warmongers +3 combat, Cultivators +15% food, Merchants +25% gold, Scholars
  +25% science, Industrious +15% production, plus Builders, Traders, Crusaders,
  Smiths, Stonemasons and Farmers) **and a unique unit only that civ can build**
  (Azure Longship, Crimson Berserker, Verdant Ranger, Amber Mercenary, Violet
  Arbalest, Onyx Bombard, Jade Pikeman, Rose Hussar, Indigo Templar, Ember
  Phalanx, Bronze Ballista, Lime Slinger) and a procedural **heraldic crest** (an SVG
  shield with a trait symbol — waves, crossed swords, leaf, coin, star, cog) shown
  on its card, in the HUD and in the diplomacy panel, plus **settings**: map size
  (Small/Medium/Large/**Huge** — Huge is ~4× the Large map, ~11k tiles), number
  of AI opponents (1–11, from twelve distinct civilizations), **difficulty**
  (Easy/Normal/Hard — scales AI income & combat), an optional **turn limit**
  (Off/150/250 → score victory), and sound on/off. Your chosen civ sets your
  colour and bonus; the AIs take distinct civs. **Continue** resumes the
  autosave. Traits fold straight into the modifier system, so they apply to
  yields, combat and unit costs everywhere.

**Ages & timeline**

- **Year & age** — the HUD tracks a **calendar year** (from 4000 BC, advancing
  each turn — faster as history accelerates) and the empire's **age** (Ancient →
  Classical → Medieval → Renaissance → Industrial → Modern → Information), derived
  from your most advanced tech, with an **era-progress indicator** (techs
  researched in the current age, e.g. `Classical 2/6`). Reaching a new era's first tech triggers a **big "A New
  Age Dawns" banner** with a fanfare and a **one-time era bonus** (gold, science &
  culture, scaling with the age). Each AI civ ages and earns the bonus too. Year
  & ages are saved with the game.

**Pass 1 — the playable core**

- **3D hex map** — a large procedurally generated **archipelago**: a main
  continent ringed by ocean, scattered islands, and enclosed inland lakes, across
  every terrain type (plains, grassland, forest, desert, tundra, snow, hills,
  mountains). Per-tile colour variation, ACES tone mapping, a gradient sky and
  soft sun shadows give it depth, dressed with **instanced low-poly forests,
  snow-capped mountain ranges, and gently shimmering water**. Tiles are a single
  InstancedMesh and the props are instanced too, so even ~2000 tiles stay cheap;
  forests and peaks hide under fog until explored.
  Deterministic per random seed each load; all civs start on the main landmass,
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
- **Tech tree** — a deep technology tree of **40+ techs across seven eras**
  (Ancient · Classical · Medieval · Renaissance · Industrial · Modern ·
  Information) in its own pop-out drawer with connector lines, à la Civ. Each era
  unlocks new military units (Spearman → Knight → Cannon → Rifleman → Infantry →
  Modern Armor; Destroyer & Battleship at sea), yield/defense buildings
  (Harbor, Castle, Observatory, Stock Exchange, Laboratory, Power Plant, Research
  Lab…) and World Wonders (the Oracle, Big Ben, the Apollo Program, the
  Internet). Banked science is spent down a **research queue**: click any tech
  and the full prerequisite path is lined up; a toast and the drawer prompt you
  to pick the next when one completes.
- **Civics, governments & policies** — a second **Culture** yield feeds a
  parallel **civics tree** of **24 civics across seven eras** (its own 📜 drawer,
  same path-queue UI). Civics unlock culture buildings (Monument, Amphitheater),
  **10 governments** — Chiefdom, Autocracy, Oligarchy, Monarchy, Theocracy,
  Republic, Merchant Republic, Democracy, Communism, Fascism — each with an
  inherent bonus and its own mix of **military / economic / wildcard** policy
  slots, and **22 policy cards** you slot into them for empire-wide bonuses
  (+production, +gold, +science, combat strength, cheaper settlers/military,
  faster growth). A wildcard slot accepts any card; effects stack across your
  government and active policies, so the government you choose shapes which
  policies you can run.
- **Great People** — every civ accrues Great-Person points (from cities &
  population). When you have enough, **you choose** which to recruit from a panel —
  a **Scientist** (research burst), **Merchant** (gold), **Engineer** (production
  across your cities), **Artist** (culture) or **General** (+2 combat for 12
  turns); the bonus scales with your age. The Standings tab shows points-to-next
  and a per-civ ✨ count. (The AI recruits automatically.)
- **Trade routes** — build a **Trader** in a city, then pick *any* reachable
  city — yours *or* a foreign civ you're at peace with — to link to (no longer
  just an adjacent one). The Trader becomes a **persistent caravan** that shuttles
  between the two cities, adding **gold to the origin city** every turn (foreign
  and more distant routes pay more, and foreign routes bring **science**). Routes
  are drawn as **golden lines**; a route ends if its caravan is destroyed, a city
  falls, or the two go to war. Select a caravan to **end its route** and free the
  Trader up for a new one. Caravans travel exposed, so **raiding an enemy caravan
  plunders a one-time gold haul** scaled by the route's value — and your own
  caravans can be plundered in turn.
- **Religion** — once a city has a place of worship (Monument), **found a
  religion** and pick a **belief** for an empire-wide bonus (+gold / science /
  food / production, or +combat). Your cities convert at once, then the faith
  **spreads** city to city across the map, and **foreign followers pay you a
  tithe** in gold. The AI founds religions too.
- **World Wonders** — landmark builds (Pyramids, Hanging Gardens, Great Library,
  Colossus, Great Wall, Terracotta Army, and later the Oracle, Big Ben, the
  Apollo Program and the Internet), each **one per game**: the first civ to
  finish one claims it and gets a permanent **empire-wide bonus** (production,
  food, science, gold, combat or cheaper military); everyone else loses it and
  gets a production refund. Completing one fires a global **"A Wonder of the
  World"** banner, and a **golden spire** rises over the city. The AI races for
  them too.
- **Districts** — Civ-style districts you **place on a chosen owned tile**, each
  grouping a category of buildings: the **Campus** (Library, University), the
  **Commercial Hub** (Market, Bank), the **Industrial Zone** (Workshop, Factory)
  and the **Theater Square** (Monument, Amphitheater). A building can only be
  built once its district exists in that city, and each district adds a small flat
  yield; pick the **Build → 🏛 District**, then click one of the highlighted
  tiles to site it. The AI builds districts too. Districts earn **adjacency
  bonuses** from their surroundings — the Campus gains science next to mountains,
  the Commercial Hub gold beside rivers, the Industrial Zone production next to
  hills/resources, and the Theater Square culture when clustered with other
  districts — so where you place them matters.
- **Buildings** — a deep set of yield multipliers gated by tech: food
  (Granary, Aqueduct, Sewer, Harbor), production (Workshop, Factory, Stable,
  Power Plant), gold (Market, Bank, Stock Exchange), and science (Library,
  University, Observatory, Laboratory, Research Lab) all multiply their city's
  yields — and they **stack**, so a built-up capital snowballs. City Walls and the
  Castle fortify a garrison. Each is gated by its tech (and, where it belongs to
  one, by its district).
- **City territory & expanding borders** — a city starts with the **six tiles
  around it** and then claims **one new tile at a time** as it banks culture,
  automatically steering toward the best unclaimed frontier tile — **resources and
  rivers first** — so borders grow organically into rich land (capped a few tiles
  out). It works the best of its tiles by population. Territory is drawn with a
  **crisp owner-coloured border outline** (inset so neighbouring civs' borders sit
  side by side) over a faint colour wash, so who owns what is clear at a glance.
- **Floating HP bars** — a billboarded health bar appears over any **damaged**
  unit or city (green → yellow → red by health), and hides again at full HP, so
  the board stays clean until a fight is on.
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
- **Barbarians** — a neutral hostile faction (always at war with everyone) raids
  out of **barbarian camps** scattered in the wilds, away from every civ's start.
  Camps spawn raiders that hunt the nearest city or unit and get **tougher as the
  game goes on**; clear a camp by moving a military unit onto it for a **+50 gold**
  reward. The AI fights barbarians too. (They're handled as a special owner
  outside the civ list, so they don't count toward victory.)
- **Diplomacy** — every civ pair is at **war** or **peace**. You can only attack
  someone you're at war with, so pick your fights from the **🕊 Diplomacy** panel
  (declare war / make peace). The AIs are opportunistic: they declare war on
  weaker neighbours, gang up, and sue for peace when they're outmatched.

**Pass 3 — characters & depth**

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
- **Tech unlocks real power** — research opens up a long military progression,
  each unit with its **own distinct low-poly mesh**: Spearman, Horseman, Swordsman,
  Catapult, Knight, Crossbowman, Cannon, Musketman, Rifleman, Artillery, Infantry,
  Tank, Modern Armor, the Airplane, Bomber and the Jet Fighter — plus a naval line
  (Galley → Frigate → Destroyer → Battleship) — alongside the economy/defense
  buildings above. Units only appear in a city's build menu once their tech is in,
  and the AI automatically adopts the strongest unit it can build.
- **Rigged character models** — the classic soldier types (Warrior, Scout,
  Swordsman, Musketman and the civ-unique infantry) are a **little squad of three
  small rigged characters** with **idle/walk animation** (a CC0 RobotExpressive,
  by Tomás Laulhé / Don McCurdy) clustered on an owner-coloured base, loaded via
  Three's GLTFLoader. It's a progressive enhancement: if the model can't load,
  units fall back to their procedural meshes. The other unit types (cavalry,
  siege, armour, aircraft, ships, spearmen, riflemen…) each have their own
  hand-built procedural mesh. Drop your own rigged `.glb` (from Meshy / Tripo /
  Mixamo / Quaternius…) into `vendor/models/` and register it in `src/models.js`.
- **City defense** — a unit garrisoned on its city takes reduced damage, and
  City Walls (Masonry) make it tougher still.
- **Ships & seafaring** — research **Sailing** to *embark* land units across the
  water (they ride a little boat and are vulnerable at sea) and to build naval
  units in coastal cities: the **Galley**, then the **Frigate**, **Destroyer** and
  **Battleship** as your tech advances. Sail a Settler over to colonize the outer
  islands, or send a fleet to raid the coast.
- **Healing & attrition** — a unit that holds position recovers HP (the most
  inside a friendly city, some on owned land, none while embarked at sea), so
  fights are wars of attrition rather than one-shots.
- **City capture & victory** — cities have defense HP (boosted by population and
  City Walls) that regenerates between assaults. Wear a city down and march a
  melee unit in to capture it. Win by **domination** (eliminate the AI), by
  reaching **Flight**, or — if a turn limit is set — by leading on **score**
  (cities, population, knowledge and territory) when the clock runs out; a
  game-over screen offers a fresh game. The AI besieges your cities too.
- **Terrain defense** — defenders on hills, forest and mountains take less
  damage, so where you fight matters.

## Architecture

Pure game logic is kept free of Three.js so it can be unit-tested in Node. The
rules in `src/game.js` import Three (for meshes) but are still driven headlessly
in Node via a stubbed scene/view (`test/harness.mjs`), since Three builds meshes
fine without a GL context — only the renderer needs WebGL:

| File | Responsibility |
|---|---|
| `src/hex.js` | Hex grid math (axial/cube coords, neighbors, distance, layout) — *pure* |
| `src/worldgen.js` | Seeded Perlin terrain generation, terrain catalogue — *pure* |
| `src/pathfinding.js` | A\* and movement-range flood fill — *pure* |
| `src/tech.js` | Tech tree catalogue & research prerequisites — *pure* |
| `src/districts.js` | District types & their building groupings — *pure* |
| `src/wonders.js` | World Wonders catalogue & unlock rules — *pure* |
| `src/greatpeople.js` | Great People roster & point thresholds — *pure* |
| `src/religions.js` | Religion beliefs & names — *pure* |
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
| `test/game.test.mjs` | Game-rule tests: real `Game` driven in Node with a stubbed renderer |
| `test/harness.mjs` | Shared test helpers (builds a `Game` with stub scene/view) |
| `test/smoke.mjs` | Optional headless e2e (drives the app in Edge/Chromium via CDP) |

## Deploying

The game is a static, no-build ES-module site hosted on **GitHub Pages**. Every
push to `main` triggers `.github/workflows/deploy-pages.yml`, which runs the
test suite (a `test` job installs deps and runs `npm test`; `deploy` only runs if
it passes) and then publishes the repo root. Three.js is vendored as a single
file (`vendor/three.module.js`) and referenced with a relative path, so the site
works under the project's `/hex-empire/` base path with no CDN dependency.

## Roadmap

- **Pass 2 — 4X loop:** ✅ city build queues, tech tree, unit production, buildings,
  city territory, AI economy.
- **Pass 3 — characters & depth:** ✅ tile resources, ranged combat, terrain
  defense, rigged GLTF character models, distinct unit art per type, persistent
  trade caravans, and a deep tech & civics tree are all in.
- **Pass 4+ —** smarter strategic AI, religious units / active faith spread,
  more UI polish, and further balance.
