// main.js — entry point. Builds the scene, generates the world, spawns the
// starting units, and drives input + the render loop.
import * as THREE from 'three';
import { generateWorld, findStartTile, connectedLand } from './worldgen.js';
import { neighbors, key, distance } from './hex.js';
import { WorldView } from './world.js';
import { Game } from './game.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { availableTechs } from './tech.js';
import { BUILDINGS } from './buildings.js';
import { Effects } from './effects.js';
import { ResearchPanel } from './researchui.js';

const MAP_RADIUS = 26;

// The actual *visible* viewport. On mobile, window.innerWidth/Height can report
// the (larger) layout viewport when the page is zoomed, which would push the
// rendered scene off into a corner; documentElement.clientWidth/Height tracks
// what's really on screen.
const vpW = () => document.documentElement.clientWidth || window.innerWidth;
const vpH = () => document.documentElement.clientHeight || window.innerHeight;

// --- renderer / scene --------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(vpW(), vpH());
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
// Atmospheric fade scales with the map so the board stays visible when zoomed out.
scene.fog = new THREE.Fog(0x0a0e14, MAP_RADIUS * 2.5, MAP_RADIUS * 8);

const camera = new THREE.PerspectiveCamera(55, vpW() / vpH(), 0.1, 300);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x35302a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 1.1);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Shadow frustum scales with the map so the whole board casts shadows.
const SHADOW = MAP_RADIUS * 2.4;
sun.shadow.camera.left = -SHADOW; sun.shadow.camera.right = SHADOW;
sun.shadow.camera.top = SHADOW; sun.shadow.camera.bottom = -SHADOW;
sun.shadow.camera.far = 160;
scene.add(sun);

// --- world & game ------------------------------------------------------------
const seed = Math.floor(Math.random() * 1e9);
const world = generateWorld(MAP_RADIUS, seed);
const view = new WorldView(scene, world);
view.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });

const game = new Game(scene, view);
game.fx = new Effects(scene);   // combat animations
const ui = new UI();
let researchNudged = false;     // so the "pick a tech" nudge only auto-opens once

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

// AI starts on the far side of the *player's landmass* so the two can meet by
// land (no naval movement yet — other islands are for exploring).
const landmass = connectedLand(world.tiles, start);
let aiStart = start, far = -1;
for (const k of landmass) {
  const t = world.tiles.get(k);
  if (t.terrain === 'MOUNTAIN') continue;
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

// Research drawer (its own pop-out panel, not in the city menu).
const researchPanel = new ResearchPanel(game);
researchPanel.onPick((id) => { game.setResearchPath(0, id); researchPanel.render(); ui.refreshTopbar(game); });
researchPanel.syncButton();

const camRig = new CameraRig(camera, renderer.domElement, MAP_RADIUS * 2.1);
{ const top = view.topOf(start.q, start.r); camRig.focus(top.x, top.z, top.y); }

// --- selection & input -------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let selected = null;
let selectedCity = null;
let reachMap = new Map();

// Deferred "advance to next unit": set when a unit finishes acting, then carried
// out by the render loop once movement and combat animations have settled, so
// the camera doesn't jump mid-animation.
let advancePending = false;
let advancePrev = null;
function advanceWhenIdle(prev) { advancePending = true; advancePrev = prev; }
function sceneIsBusy() { return game.units.some(u => u.isMoving) || game.fx.active.length > 0; }

function tileUnderPointer(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(view.tileMesh, false);
  return hits.length ? view.tileForInstance(hits[0].instanceId) : null;
}

function selectUnit(u, focus = false) {
  advancePending = false;
  selected = u;
  selectedCity = null;
  reachMap = game.reachableFor(u);
  view.selectTile(u.q, u.r);
  if (focus) { const top = view.topOf(u.q, u.r); if (top) camRig.focus(top.x, top.z, top.y); }
  refreshUnitPanel();
  drawOverlays(null);
}

function deselect() {
  advancePending = false;
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
  advancePending = false;
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

  let producing = null;
  const queue = [];
  c.queue.forEach((it, i) => {
    const turns = game.turnsFor(c, it.cost, i === 0);
    if (i === 0) producing = { name: it.name, turns };
    else queue.push({ name: it.name, turns });
  });

  const model = {
    name: c.name, you: true, population: c.population,
    growth: { have: Math.floor(c.food), need: c.population * 10 },
    yields: game.cityYields(c), producing, queue,
    buildings: [...c.buildings].map(id => BUILDINGS[id].name),
  };

  const actions = [];
  const coastal = game.isCoastal(c);
  const queuedBuildings = new Set(c.queue.filter(i => i.kind === 'building').map(i => i.id));
  for (const item of game.buildOptions(0)) {
    if (item.kind === 'building' && (c.buildings.has(item.id) || queuedBuildings.has(item.id))) continue;
    if (item.domain === 'sea' && !coastal) continue; // ships need a coastal city
    const turns = game.turnsFor(c, item.cost, false);
    actions.push({ label: `⚒ ${item.name} (${turns}t)`, enabled: true, onClick: () => { game.enqueue(c, item); refreshCityPanel(); } });
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
    selectUnit(unitHere, true); // center the camera on the tapped unit
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
      // Keep directing this unit while it still has moves; otherwise advance to
      // the next unit once its move/fight animation has finished playing.
      if (game.units.includes(movedUnit) && movedUnit.move > 0) {
        reachMap = game.reachableFor(movedUnit);
        view.selectTile(movedUnit.q, movedUnit.r);
        refreshUnitPanel();
        drawOverlays(null);
      } else {
        if (game.units.includes(movedUnit)) view.selectTile(movedUnit.q, movedUnit.r);
        view.clearHighlights();   // drop stale range markers while it animates
        advanceWhenIdle(movedUnit);
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
    advanceWhenIdle(null); // wait out the AI's move/fight animations first
  }

  // Research: keep the drawer/button current, and prompt for a new tech when the
  // queue runs dry (just finished one, or you've never picked one).
  researchPanel.syncButton();
  if (researchPanel.isOpen) researchPanel.render();
  const r0 = game.civs[0].research;
  const canPick = game.cities.some(c => c.owner === 0) && availableTechs(r0.researched).length > 0;
  if (!r0.queue.length && canPick) {
    if (ev.some(m => m.startsWith('Researched'))) researchPanel.open();
    else if (!researchNudged) { researchPanel.open(); researchNudged = true; }
  }
}
ui.onEndTurn(endTurn);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); endTurn(); }
  if (e.code === 'Escape') { if (researchPanel.isOpen) researchPanel.close(); else deselect(); }
  if (e.code === 'Tab') { e.preventDefault(); cycleToNextActive(selected); } // cycle to next active unit
});

// --- render loop -------------------------------------------------------------
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  camRig.update(dt);
  for (const u of game.units) u.update(dt);
  game.fx.update(dt);
  // Carry out a deferred unit-advance once everything has stopped animating.
  if (advancePending && !sceneIsBusy()) {
    const prev = advancePrev;
    advancePending = false; advancePrev = null;
    cycleToNextActive(prev);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function onResize() {
  const w = vpW(), h = vpH();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
// visualViewport fires on mobile zoom/keyboard changes that don't trigger resize.
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

// Select the starting settler so the player has something to do immediately.
selectUnit(game.units[0]);

// Debug / test handle: lets the headless smoke test (and the browser console)
// inspect live game and camera state.
window.__hex = { game, view, ui, camRig };
