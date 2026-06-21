// main.js — entry point. Builds the scene, generates the world, spawns the
// starting units, and drives input + the render loop.
import * as THREE from 'three';
import { generateWorld, findStartTile } from './worldgen.js';
import { neighbors, key, distance } from './hex.js';
import { WorldView } from './world.js';
import { Game } from './game.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { TECHS, availableTechs } from './tech.js';
import { BUILDINGS } from './buildings.js';

const MAP_RADIUS = 12;

// --- renderer / scene --------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 35, 70);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x35302a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 1.1);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 120;
scene.add(sun);

// --- world & game ------------------------------------------------------------
const seed = Math.floor(Math.random() * 1e9);
const world = generateWorld(MAP_RADIUS, seed);
const view = new WorldView(scene, world);
view.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });

const game = new Game(scene, view);
const ui = new UI();

// Spawn helpers: find a passable, unoccupied tile near a given hex.
function freeNeighbor(q, r) {
  for (const n of neighbors(q, r)) {
    const t = world.tiles.get(key(n.q, n.r));
    if (t && t.passable && !game.unitAt(n.q, n.r)) return n;
  }
  return { q, r };
}

const start = findStartTile(world);
game.spawnUnit('settler', 0, start.q, start.r);
const w1 = freeNeighbor(start.q, start.r);
game.spawnUnit('warrior', 0, w1.q, w1.r);
const s1 = freeNeighbor(w1.q, w1.r);
game.spawnUnit('scout', 0, s1.q, s1.r);

// AI starts on the far side of the continent.
let aiStart = start, far = -1;
for (const t of world.tiles.values()) {
  if (!t.passable || t.terrain === 'MOUNTAIN') continue;
  const d = distance(start, t);
  if (d > far) { far = d; aiStart = t; }
}
game.spawnUnit('settler', 1, aiStart.q, aiStart.r);
const aw = freeNeighbor(aiStart.q, aiStart.r);
game.spawnUnit('warrior', 1, aw.q, aw.r);

game.income = game.computeIncome();
game.recomputeFog();
ui.refreshTopbar(game);
ui.hideLoading();

const camRig = new CameraRig(camera, renderer.domElement, MAP_RADIUS * 1.7);
{ const top = view.topOf(start.q, start.r); camRig.focus(top.x, top.z); }

// --- selection & input -------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let selected = null;
let selectedCity = null;
let reachMap = new Map();

function tileUnderPointer(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(view.group.children, false);
  return hits.length ? hits[0].object.userData.tile : null;
}

function selectUnit(u, focus = false) {
  selected = u;
  selectedCity = null;
  reachMap = game.reachableFor(u);
  view.selectTile(u.q, u.r);
  if (focus) { const top = view.topOf(u.q, u.r); if (top) camRig.focus(top.x, top.z); }
  refreshUnitPanel();
  drawOverlays(null);
}

function deselect() {
  selected = null;
  selectedCity = null;
  reachMap = new Map();
  view.deselect();
  view.clearHighlights();
  ui.hideSelection();
}

// An "active" unit is one of yours that still has movement and isn't animating.
function nextActiveUnit(after) {
  const units = game.units;
  if (!units.length) return null;
  const isActive = (u) => u.owner === 0 && u.move > 0 && !u.isMoving;
  const start = after ? units.indexOf(after) : -1;
  for (let i = 1; i <= units.length; i++) {
    const u = units[((start + i) % units.length + units.length) % units.length];
    if (isActive(u)) return u;
  }
  return null;
}

// Jump selection to the next unit with moves left (panning to it); if there are
// none, drop the selection and nudge the player to end the turn.
function cycleToNextActive(prev) {
  const next = nextActiveUnit(prev);
  if (next && next !== prev) { selectUnit(next, true); return; }
  deselect();
  if (game.units.some(u => u.owner === 0)) ui.toast('No units left to move — Space to end turn', '#9fd0ff');
}

function selectCity(c) {
  selected = null;
  reachMap = new Map();
  view.clearHighlights();
  selectedCity = c;
  view.selectTile(c.q, c.r);
  refreshCityPanel();
}

// Build the city-management model + its build/research buttons.
function refreshCityPanel() {
  const c = selectedCity;
  if (c.owner !== 0) { ui.showCity({ name: c.name, you: false, population: c.population, growth: { have: Math.floor(c.food), need: c.population * 10 } }); return; }

  const civ = game.civs[0];
  const researched = civ.research.researched;

  let producing = null;
  const queue = [];
  c.queue.forEach((it, i) => {
    const turns = game.turnsFor(c, it.cost, i === 0);
    if (i === 0) producing = { name: it.name, turns };
    else queue.push({ name: it.name, turns });
  });

  const research = civ.research.current
    ? { name: TECHS[civ.research.current].name, detail: `${Math.floor(civ.treasury.science)}/${TECHS[civ.research.current].cost}` }
    : { name: 'None', detail: `${Math.floor(civ.treasury.science)} banked` };

  const model = {
    name: c.name, you: true, population: c.population,
    growth: { have: Math.floor(c.food), need: c.population * 10 },
    yields: game.cityYields(c), producing, queue, research,
    buildings: [...c.buildings].map(id => BUILDINGS[id].name),
  };

  const actions = [];
  const queuedBuildings = new Set(c.queue.filter(i => i.kind === 'building').map(i => i.id));
  for (const item of game.buildOptions(0)) {
    if (item.kind === 'building' && (c.buildings.has(item.id) || queuedBuildings.has(item.id))) continue;
    const turns = game.turnsFor(c, item.cost, false);
    actions.push({ label: `⚒ ${item.name} (${turns}t)`, enabled: true, onClick: () => { game.enqueue(c, item); refreshCityPanel(); } });
  }
  for (const id of availableTechs(researched)) {
    if (id === civ.research.current) continue;
    actions.push({ label: `🔬 ${TECHS[id].name} (${TECHS[id].cost})`, enabled: true, onClick: () => { game.setResearch(0, id); refreshCityPanel(); ui.refreshTopbar(game); } });
  }
  actions.push({ label: 'Close', enabled: true, onClick: deselect });
  ui.showCity(model, actions);
}

function refreshUnitPanel() {
  const actions = [];
  if (selected.owner === 0 && selected.def.canFound) {
    actions.push({
      label: 'Found City', enabled: selected.move > 0 && !game.cityAt(selected.q, selected.r),
      onClick: () => {
        const res = game.foundCity(selected);
        if (res.ok) { ui.toast(`${res.city.name} founded!`, '#7fd17f'); game.income = game.computeIncome(); ui.refreshTopbar(game); selectCity(res.city); }
        else ui.toast(res.msg, '#e88');
      },
    });
  }
  actions.push({ label: 'Skip', enabled: true, onClick: () => cycleToNextActive(selected) });
  ui.showUnit(selected, actions);
}

function drawOverlays(hoverTile) {
  view.clearHighlights();
  if (!selected || selected.owner !== 0) return;
  view.showReachable(reachMap);
  view.showTargets(game.attackTargetsFor(selected));
  if (hoverTile) {
    const k = key(hoverTile.q, hoverTile.r);
    if (reachMap.has(k)) {
      const path = game.pathFor(selected, hoverTile.q, hoverTile.r);
      if (path) view.showPath(path);
    }
  }
}

// Distinguish a click from a camera right-drag / sloppy pointer.
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || down.b !== 0) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 6) return; // it was a drag
  handleClick(e);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!selected) return;
  drawOverlays(tileUnderPointer(e));
});

function handleClick(ev) {
  const tile = tileUnderPointer(ev);
  if (!tile) return;
  const { q, r } = tile;

  const unitHere = game.unitAt(q, r);
  if (unitHere && unitHere.owner === 0 && unitHere !== selected && !unitHere.isMoving) {
    selectUnit(unitHere);
    return;
  }

  // Click your own city (when not directing a unit's move) to manage it.
  const ownCity = game.cityAt(q, r);
  if (ownCity && ownCity.owner === 0 && (!selected || selected.isMoving)) {
    selectCity(ownCity);
    return;
  }

  if (selected && selected.owner === 0 && !selected.isMoving) {
    const movedUnit = selected;
    const res = game.tryMoveUnit(selected, q, r);
    if (res.ok) {
      if (res.combat) ui.toast(res.msg, '#ffb14a');
      ui.refreshTopbar(game);
      // Keep directing this unit while it still has moves; otherwise advance.
      if (game.units.includes(movedUnit) && movedUnit.move > 0) {
        reachMap = game.reachableFor(movedUnit);
        view.selectTile(movedUnit.q, movedUnit.r);
        refreshUnitPanel();
        drawOverlays(null);
      } else {
        cycleToNextActive(movedUnit);
      }
      return;
    } else if (res.msg) {
      ui.toast(res.msg, '#e88');
    }
  }

  // Nothing actionable: show info about whatever is here.
  const city = game.cityAt(q, r);
  if (city && game.explored.has(key(q, r))) {
    if (city.owner === 0) selectCity(city);
    else ui.showCity({ name: city.name, you: false, population: city.population, growth: { have: Math.floor(city.food), need: city.population * 10 } });
  } else ui.showTile(tile);
}

// --- turns -------------------------------------------------------------------
function endTurn() {
  if (game.units.some(u => u.isMoving)) return; // let animations settle
  game.endTurn();
  ui.refreshTopbar(game);
  const ev = game.events;
  ui.toast(ev.length ? ev[ev.length - 1] : `Turn ${game.turn}`, ev.length ? '#7fd17f' : '#9fd0ff');
  // Keep a city panel open if you were managing one; otherwise start the turn on
  // your first ready unit.
  if (selectedCity && game.cities.includes(selectedCity)) {
    refreshCityPanel();
  } else {
    cycleToNextActive(null);
  }
}
ui.onEndTurn(endTurn);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); endTurn(); }
  if (e.code === 'Escape') deselect();
  if (e.code === 'Tab') { e.preventDefault(); cycleToNextActive(selected); } // cycle to next active unit
});

// --- render loop -------------------------------------------------------------
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  camRig.update(dt);
  for (const u of game.units) u.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Select the starting settler so the player has something to do immediately.
selectUnit(game.units[0]);

// Debug / test handle: lets the headless smoke test (and the browser console)
// inspect live game and camera state.
window.__hex = { game, view, ui, camRig };
