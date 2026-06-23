// main.js — entry point. Builds the scene, generates the world, spawns the
// starting units, and drives input + the render loop.
import * as THREE from 'three';
import { generateWorld, findStartTile, connectedLand } from './worldgen.js';
import { neighbors, key, distance } from './hex.js';
import { WorldView } from './world.js';
import { Game } from './game.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { TECHS, availableTechs, canResearch } from './tech.js';
import { CIVICS, canResearch as canCivic, GOVERNMENTS, POLICIES, availableGovernments, availablePolicies } from './civics.js';
import { BUILDINGS } from './buildings.js';
import { DISTRICTS } from './districts.js';
import { WONDERS } from './wonders.js';
import { OWNER_COLOR } from './units.js';
import { Effects } from './effects.js';
import { HealthBars } from './health.js';
import { TreePanel } from './researchui.js';
import { Sound } from './audio.js';
import { loadUnitModels } from './models.js';
import { CIVILIZATIONS } from './civilizations.js';
import { emblemSVG } from './emblems.js';

const FOG_REF = 30; // fog/shadow frustum sized for the largest map; world radius is chosen in the menu

// Present the start menu and resolve with the player's choices. Resolves with
// { load: true } when they pick Continue (resume the autosave).
function chooseStartOptions() {
  return new Promise((resolve) => {
    const menu = document.getElementById('menu');
    const cards = document.getElementById('civ-cards');
    const cont = document.getElementById('menu-continue');
    cont.style.display = localStorage.getItem('hexempire-save') ? '' : 'none';

    let chosen = CIVILIZATIONS[0];
    cards.innerHTML = '';
    CIVILIZATIONS.forEach((c, idx) => {
      const card = document.createElement('button');
      card.className = 'civ-card' + (idx === 0 ? ' sel' : '');
      card.innerHTML = `${emblemSVG(c.id, c.color, 40)}<b>${c.name}</b><span class="tr">${c.trait.name}</span><span class="trd">${c.trait.desc}</span><span class="trd">⚔ ${c.unique}</span>`;
      card.addEventListener('click', () => { chosen = c; cards.querySelectorAll('.civ-card').forEach(x => x.classList.remove('sel')); card.classList.add('sel'); });
      cards.appendChild(card);
    });

    menu.style.display = 'flex';
    document.getElementById('menu-start').onclick = () => {
      menu.style.display = 'none';
      resolve({
        load: false, civ: chosen,
        radius: +document.getElementById('opt-map').value,
        numAI: +document.getElementById('opt-ai').value,
        difficulty: document.getElementById('opt-diff').value,
        turnLimit: +document.getElementById('opt-turns').value || null,
        sound: document.getElementById('opt-sound').checked,
      });
    };
    cont.onclick = () => { menu.style.display = 'none'; resolve({ load: true }); };
  });
}

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
renderer.toneMapping = THREE.ACESFilmicToneMapping; // richer contrast & colour
renderer.toneMappingExposure = 1.08;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// A soft vertical gradient sky reads much nicer than a flat fill.
function gradientSky() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b1626'); g.addColorStop(0.55, '#1a2c44'); g.addColorStop(1, '#2c4a6b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = gradientSky();
// Atmospheric fade scales with the map; tinted to the horizon so it blends in.
scene.fog = new THREE.Fog(0x1a2c44, FOG_REF * 2.8, FOG_REF * 8.5);

const camera = new THREE.PerspectiveCamera(55, vpW() / vpH(), 0.1, 300);

const hemi = new THREE.HemisphereLight(0xdcecff, 0x3a3024, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.55);
sun.position.set(20, 32, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
// Shadow frustum scales with the map so the whole board casts shadows.
const SHADOW = FOG_REF * 2.4;
sun.shadow.camera.left = -SHADOW; sun.shadow.camera.right = SHADOW;
sun.shadow.camera.top = SHADOW; sun.shadow.camera.bottom = -SHADOW;
sun.shadow.camera.far = 160;
scene.add(sun);

// --- start menu -> world & game ----------------------------------------------
// The old "Load" button reloads with this flag to jump straight back into a save.
const directLoad = !!sessionStorage.getItem('hexempire-load');
sessionStorage.removeItem('hexempire-load');

const startOpts = directLoad ? { load: true } : await chooseStartOptions();
document.getElementById('loading').style.display = 'flex'; // splash while we build

// Load rigged character models now (during the splash); falls back to procedural.
await Promise.race([loadUnitModels(), new Promise((r) => setTimeout(r, 6000))]);

let saveData = null;
if (startOpts.load) { try { saveData = JSON.parse(localStorage.getItem('hexempire-save') || 'null'); } catch (e) { saveData = null; } }

const MAP_RADIUS = saveData ? (saveData.radius || 24) : startOpts.radius;
const NUM_AI = saveData ? Math.max(1, (saveData.civs ? saveData.civs.length : 3) - 1) : startOpts.numAI;

// The player's chosen civ sits at slot 0; the AIs take distinct other civs.
let civConfigs = null;
if (!saveData) {
  const others = CIVILIZATIONS.filter(c => c.id !== startOpts.civ.id);
  civConfigs = [startOpts.civ];
  for (let i = 0; i < NUM_AI; i++) civConfigs.push(others[i % others.length]);
}

const seed = saveData ? saveData.seed : Math.floor(Math.random() * 1e9);
const world = generateWorld(MAP_RADIUS, seed);
const view = new WorldView(scene, world);
view.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });

const game = new Game(scene, view, saveData ? saveData.civs.length : 1 + NUM_AI, civConfigs,
  saveData ? {} : { difficulty: startOpts.difficulty, turnLimit: startOpts.turnLimit });
game.fx = new Effects(scene);   // combat animations
const healthBars = new HealthBars(scene);
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

let start;
if (saveData) {
  game.restore(saveData);
  start = game.cities.find(c => c.owner === 0) || game.units.find(u => u.owner === 0) || findStartTile(world);
} else {
  start = findStartTile(world);
  game.spawnUnit('settler', 0, start.q, start.r);
  const w1 = freeNeighbor(start.q, start.r);
  game.spawnUnit('warrior', 0, w1.q, w1.r);
  const s1 = freeNeighbor(w1.q, w1.r);
  game.spawnUnit('scout', 0, s1.q, s1.r);

  // Place each AI civ at the far reaches of the player's landmass (spread apart
  // by farthest-point sampling) so everyone can meet by land.
  const landTiles = [...connectedLand(world.tiles, start)]
    .map(k => world.tiles.get(k))
    .filter(t => t.terrain !== 'MOUNTAIN');
  const placed = [start];
  for (let owner = 1; owner <= NUM_AI; owner++) {
    let spot = start, best = -1;
    for (const t of landTiles) {
      const d = Math.min(...placed.map(p => distance(p, t)));
      if (d > best) { best = d; spot = t; }
    }
    placed.push(spot);
    game.spawnUnit('settler', owner, spot.q, spot.r);
    const aw = freeNeighbor(spot.q, spot.r);
    game.spawnUnit('warrior', owner, aw.q, aw.r);
  }

  // Barbarian camps out in the wilds, away from every civ's start.
  const campLand = [...world.tiles.values()].filter(t => t.passable && t.terrain !== 'MOUNTAIN' && !t.resource);
  const campCount = Math.max(3, Math.round(MAP_RADIUS / 6));
  for (const t of campLand.sort(() => Math.random() - 0.5)) {
    if (game.barbCamps.length >= campCount) break;
    if (placed.some(p => distance(p, t) < 6)) continue;
    if (game.barbCamps.some(c => distance(c, t) < 5)) continue;
    if (game.unitAt(t.q, t.r) || game.cityAt(t.q, t.r)) continue;
    game.addBarbCamp(t.q, t.r);
  }
}

game.income = game.computeIncome();
game.recomputeFog();
ui.refreshTopbar(game);
document.getElementById('civemblem').innerHTML = emblemSVG(game.civs[0].id, OWNER_COLOR[0], 20);
ui.hideLoading();

// Game-over overlay.
let gameOverShown = false;
function checkGameOver() {
  if (!game.gameOver || gameOverShown) return;
  gameOverShown = true;
  const t = document.getElementById('go-title');
  t.textContent = game.gameOver.win ? '🏆 Victory!' : '💀 Defeat';
  t.style.color = game.gameOver.win ? '#7fd17f' : '#e88';
  document.getElementById('go-reason').textContent = game.gameOver.reason;
  document.getElementById('gameover').style.display = 'flex';
  sound.play(game.gameOver.win ? 'victory' : 'defeat');
}
document.getElementById('go-new').addEventListener('click', () => location.reload());

// Sound + music live in the Settings tab (toggled with checkboxes).
const sound = new Sound();
if (!startOpts.load && startOpts.sound === false) sound.setEnabled(false); // honour the menu toggle
const soundChk = document.getElementById('set-sound');
const musicChk = document.getElementById('set-music');
const wantMusic = localStorage.getItem('hexempire-music') !== '0';
if (wantMusic && (startOpts.load || startOpts.sound !== false)) sound.startMusic();
function renderSettings() { soundChk.checked = sound.enabled; musicChk.checked = sound.musicOn; }
renderSettings();
soundChk.addEventListener('change', () => { sound.setEnabled(soundChk.checked); if (sound.enabled) sound.play('select'); });
musicChk.addEventListener('change', () => { if (musicChk.checked) sound.startMusic(); else sound.stopMusic(); });
document.getElementById('menu-return').addEventListener('click', () => location.reload());

// Research (science) and Civics (culture) tree drawers.
const researchPanel = new TreePanel(game, {
  ids: { drawer: 'research', tree: 'tech-tree', current: 'research-current' },
  catalogue: TECHS, canPick: canResearch,
  state: (g) => g.civs[0].research,
  bank: (g) => Math.floor(g.treasury.science),
  income: (g) => g.income.science,
  glyph: '🔬', accent: '#6fd0e8', chooseLabel: 'No research selected',
  onPick: (id) => { game.setResearchPath(0, id); researchPanel.render(); ui.refreshTopbar(game); },
});
const civicsPanel = new TreePanel(game, {
  ids: { drawer: 'civics', tree: 'civics-tree', current: 'civics-current' },
  catalogue: CIVICS, canPick: canCivic,
  state: (g) => g.civs[0].civics,
  bank: (g) => Math.floor(g.civs[0].treasury.culture),
  income: (g) => g.income.culture,
  glyph: '📜', accent: '#c792ea', chooseLabel: 'No civic selected',
  onPick: (id) => { game.setCivicPath(0, id); civicsPanel.render(); ui.refreshTopbar(game); },
  afterRender: renderGovPanel,
});
researchPanel.syncButton();
civicsPanel.syncButton();

// --- diplomacy panel ---------------------------------------------------------
const diploPane = document.getElementById('diplomacy');
const ownerHex = (o) => '#' + OWNER_COLOR[o].toString(16).padStart(6, '0');
function renderDiplomacy() {
  let h = '';
  for (let o = 1; o < game.civs.length; o++) {
    if (!game.isCivAlive(o)) continue;
    const war = game.atWar(0, o);
    h += `<div class="row"><span>${emblemSVG(game.civs[o].id, OWNER_COLOR[o], 18)}<span style="color:${ownerHex(o)}">${game.civs[o].name}</span></span>` +
      `<span>${war ? '⚔ War' : '🕊 Peace'}<button class="act" data-civ="${o}">${war ? 'Make Peace' : 'Declare War'}</button></span></div>`;
  }
  document.getElementById('diplo-body').innerHTML = h || '<div class="row"><span>No rivals remain.</span></div>';
  document.querySelectorAll('#diplo-body [data-civ]').forEach(b => b.addEventListener('click', () => {
    const o = +b.dataset.civ;
    if (game.atWar(0, o)) { game.makePeace(0, o); ui.toast(`Peace with ${game.civs[o].name}`, '#7fd17f'); }
    else { game.declareWar(0, o); ui.toast(`War declared on ${game.civs[o].name}!`, '#ffb14a'); sound.play('attack'); }
    renderDiplomacy();
    if (selected) drawOverlays(null); // attackable targets changed
  }));
}
// --- standings panel ---------------------------------------------------------
const standPane = document.getElementById('standings');
function renderStandings() {
  const rows = game.standings().filter(r => r.alive);
  let h = '<div class="strow sthead"><span>#</span><span>Civ</span><span>Score</span><span>Age</span><span>Cities</span><span>⭐</span></div>';
  rows.forEach((r, i) => {
    h += `<div class="strow${r.owner === 0 ? ' me' : ''}"><span>${i + 1}</span>` +
      `<span class="nm">${emblemSVG(r.id, OWNER_COLOR[r.owner], 16)}${r.name}</span>` +
      `<span>${r.score}</span><span>${r.age}</span><span>${r.cities}</span><span>${r.wonders}</span></div>`;
  });
  document.getElementById('standings-body').innerHTML = h;
}

// --- one side drawer, opened by the edge menu handle (no main-screen buttons) -
const sidebar = document.getElementById('sidebar');
const sideTabs = [...document.querySelectorAll('.side-tab')];
const settingsPane = document.getElementById('settings');
const menuHandle = document.getElementById('menu-handle');
let activeTab = 'research';
function renderTab(tab) {
  if (tab === 'research') researchPanel.render();
  else if (tab === 'civics') civicsPanel.render();
  else if (tab === 'diplomacy') renderDiplomacy();
  else if (tab === 'standings') renderStandings();
  else if (tab === 'settings') renderSettings();
}
function setTab(tab) {
  activeTab = tab;
  researchPanel[tab === 'research' ? 'open' : 'close']();
  civicsPanel[tab === 'civics' ? 'open' : 'close']();
  diploPane.classList.toggle('open', tab === 'diplomacy');
  standPane.classList.toggle('open', tab === 'standings');
  settingsPane.classList.toggle('open', tab === 'settings');
  sideTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderTab(tab);
}
const sidebarOpen = () => sidebar.classList.contains('open');
function openSidebar(tab) { sidebar.classList.add('open'); menuHandle.style.display = 'none'; setTab(tab || activeTab); }
function closeSidebar() { sidebar.classList.remove('open'); menuHandle.style.display = ''; }
// Nudge the handle when there's no research queued.
function syncMenuHandle() {
  const needs = !game.civs[0].research.queue.length && game.cities.some(c => c.owner === 0);
  menuHandle.classList.toggle('attention', needs && !sidebarOpen());
}

sideTabs.forEach(b => b.addEventListener('click', () => openSidebar(b.dataset.tab)));
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
menuHandle.addEventListener('click', () => openSidebar());
syncMenuHandle();

// Government picker + policy-card slots, rendered into the Civics drawer.
function renderGovPanel(g) {
  const el = document.getElementById('civics-gov');
  const civ = g.civs[0];
  const researched = civ.civics.researched;
  const slots = GOVERNMENTS[civ.government].slots;
  let h = `<div class="label">Government</div><div class="gov-row">`;
  for (const id of availableGovernments(researched)) {
    h += `<button class="gov${civ.government === id ? ' active' : ''}" data-gov="${id}" title="${GOVERNMENTS[id].desc}">${GOVERNMENTS[id].name}</button>`;
  }
  h += `</div>`;
  const slotStr = `⚔${slots.mil} 💰${slots.eco}${slots.wild ? ` ✷${slots.wild}` : ''}`;
  h += `<div class="label">Policies — slots ${slotStr}</div><div class="gov-row">`;
  const unlocked = availablePolicies(researched);
  if (!unlocked.length) h += `<span style="opacity:.6">Research civics to unlock policy cards.</span>`;
  for (const id of unlocked) {
    const p = POLICIES[id];
    const icon = p.slot === 'mil' ? '⚔' : '💰';
    h += `<button class="pol${civ.policies.includes(id) ? ' active' : ''}" data-pol="${id}" title="${p.desc}">${icon} ${p.name}</button>`;
  }
  h += `</div>`;
  el.innerHTML = h;
  el.querySelectorAll('[data-gov]').forEach(b => b.addEventListener('click', () => {
    g.setGovernment(0, b.dataset.gov); renderGovPanel(g); ui.refreshTopbar(g); civicsPanel.syncButton();
  }));
  el.querySelectorAll('[data-pol]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.pol;
    const had = civ.policies.includes(id);
    g.setPolicies(0, had ? civ.policies.filter(x => x !== id) : [...civ.policies, id]);
    if (!had && !civ.policies.includes(id)) ui.toast('No free policy slot', '#e88');
    renderGovPanel(g); ui.refreshTopbar(g);
  }));
}

// --- save / load -------------------------------------------------------------
const SAVE_KEY = 'hexempire-save';
function saveGame(announce) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize()));
    if (announce) ui.toast('Game saved', '#9fd0ff');
  } catch (e) { if (announce) ui.toast('Save failed', '#e88'); }
}
document.getElementById('save-btn').addEventListener('click', () => saveGame(true));
document.getElementById('load-btn').addEventListener('click', () => {
  if (!localStorage.getItem(SAVE_KEY)) { ui.toast('No saved game', '#e88'); return; }
  sessionStorage.setItem('hexempire-load', '1');
  location.reload();
});
if (saveData) ui.toast(`Resumed — turn ${game.turn}`, '#9fd0ff');

const camRig = new CameraRig(camera, renderer.domElement, MAP_RADIUS * 2.1);
{ const top = view.topOf(start.q, start.r); camRig.focus(top.x, top.z, top.y); }

// --- selection & input -------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let selected = null;
let selectedCity = null;
let reachMap = new Map();
let placing = null; // { city, item } while choosing a tile for a district

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
  sound.play('select');
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
  if (c.owner !== 0) { ui.showCity({ name: c.name, you: false, population: c.population, growth: { have: Math.floor(c.food), need: c.population * 10 }, defense: { hp: Math.round(c.hp), max: game.cityMaxHp(c) } }); return; }

  let producing = null;
  const queue = [];
  c.queue.forEach((it, i) => {
    const turns = game.turnsFor(c, game.itemCost(0, it), i === 0);
    if (i === 0) producing = { name: it.name, turns };
    else queue.push({ name: it.name, turns });
  });

  const model = {
    name: c.name, you: true, population: c.population,
    growth: { have: Math.floor(c.food), need: c.population * 10 },
    defense: { hp: Math.round(c.hp), max: game.cityMaxHp(c) },
    yields: game.cityYields(c), producing, queue,
    buildings: [...c.buildings].map(id => BUILDINGS[id].name),
  };

  const yglyph = { food: '🌾', prod: '⚒', gold: '🪙', science: '🔬', culture: '🎭' };
  model.districts = [...c.districts].map(([tk, id]) => {
    const adj = game.districtAdjacency(c, tk, id);
    const parts = Object.entries(adj).filter(([, v]) => v > 0).map(([k, v]) => `+${v}${yglyph[k]}`);
    return `${DISTRICTS[id].glyph} ${DISTRICTS[id].name}${parts.length ? ' ' + parts.join(' ') : ''}`;
  });
  model.wonders = [...c.wonders].map(id => `${WONDERS[id].glyph} ${WONDERS[id].name}`);

  const actions = [];
  const coastal = game.isCoastal(c);
  const queuedBuildings = new Set(c.queue.filter(i => i.kind === 'building').map(i => i.id));
  const queuedDistricts = new Set(c.queue.filter(i => i.kind === 'district').map(i => i.id));
  const queuedWonders = new Set(c.queue.filter(i => i.kind === 'wonder').map(i => i.id));
  for (const item of game.buildOptions(0, c)) {
    if (item.kind === 'building' && (c.buildings.has(item.id) || queuedBuildings.has(item.id))) continue;
    if (item.kind === 'district' && queuedDistricts.has(item.id)) continue;
    if (item.kind === 'wonder' && queuedWonders.has(item.id)) continue;
    if (item.domain === 'sea' && !coastal) continue; // ships need a coastal city
    const turns = game.turnsFor(c, game.itemCost(0, item), false);
    if (item.kind === 'wonder') {
      actions.push({ label: `${item.glyph} ${item.name} (${turns}t)`, enabled: true, onClick: () => { game.enqueue(c, item); refreshCityPanel(); } });
    } else if (item.kind === 'district') {
      const sites = game.districtSites(c).length;
      actions.push({ label: `🏛 ${item.name} (${turns}t)`, enabled: sites > 0, onClick: () => beginPlaceDistrict(c, item) });
    } else {
      actions.push({ label: `${item.kind === 'building' ? '🏗' : '⚒'} ${item.name} (${turns}t)`, enabled: true, onClick: () => { game.enqueue(c, item); refreshCityPanel(); } });
    }
  }
  actions.push({ label: 'Close', enabled: true, onClick: deselect });
  ui.showCity(model, actions);
}

// Enter district-placement mode: highlight the city's valid sites; the next tile
// click (in handleClick) drops the district there.
function beginPlaceDistrict(city, item) {
  placing = { city, item };
  const sites = game.districtSites(city);
  view.clearHighlights();
  view.showReachable(new Map(sites.map(k => [k, true])));
  ui.toast(`Pick a tile for the ${item.name} (Esc to cancel)`, '#9fd0ff');
}

function refreshUnitPanel() {
  const actions = [];
  if (selected.owner === 0 && selected.def.canFound) {
    actions.push({
      label: 'Found City', enabled: selected.move > 0 && !game.cityAt(selected.q, selected.r),
      onClick: () => {
        const res = game.foundCity(selected);
        if (res.ok) { sound.play('city'); ui.toast(`${res.city.name} founded!`, '#7fd17f'); game.income = game.computeIncome(); ui.refreshTopbar(game); selectCity(res.city); }
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

  // Placing a district: the click chooses its tile.
  if (placing) {
    const k = key(q, r);
    const { city, item } = placing;
    if (game.districtSites(city).includes(k)) {
      game.enqueue(city, { ...item, tile: k });
      placing = null;
      view.clearHighlights();
      ui.toast(`${item.name} sited — now building`, '#7fd17f');
      sound.play('build');
      selectCity(city); // refresh the panel
    } else {
      ui.toast('Pick a highlighted tile', '#e88');
    }
    return;
  }

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
      sound.play(res.combat ? 'attack' : 'move');
      ui.refreshTopbar(game);
      checkGameOver();
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
    else ui.showCity({ name: city.name, you: false, population: city.population, growth: { have: Math.floor(city.food), need: city.population * 10 }, defense: { hp: Math.round(city.hp), max: game.cityMaxHp(city) } });
  } else ui.showTile(tile);
}

// --- turns -------------------------------------------------------------------
// A big centred banner (used for new ages and completed wonders).
function showBanner(sub, title, extra) {
  const el = document.getElementById('era-banner');
  document.getElementById('era-sub').textContent = sub;
  document.getElementById('era-title').textContent = title;
  document.getElementById('era-bonus').textContent = extra || '';
  el.classList.remove('show');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('show');
  sound.play('victory');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.remove('show'), 4000);
}
function showEraBanner(name, bonus) {
  showBanner('A NEW AGE DAWNS', `The ${name} Era`,
    bonus ? `Era bonus: +${bonus.gold} gold · +${bonus.science} science · +${bonus.culture} culture` : '');
}
function showWonderBanner(w) {
  showBanner('A WONDER OF THE WORLD', `${w.glyph} ${w.name}`,
    w.you ? `Completed in ${w.city}` : `Completed by ${game.civs[w.owner].name}`);
}

function endTurn() {
  if (game.units.some(u => u.isMoving)) return; // let animations settle
  game.endTurn();
  ui.refreshTopbar(game);
  if (game.wonderBuilt) showWonderBanner(game.wonderBuilt);
  else if (game.ageAdvanced) showEraBanner(game.ageAdvanced, game.ageBonus);
  const ev = game.events;
  const warEv = ev.find(m => /declared war on you/.test(m));
  ui.toast(warEv || (ev.length ? ev[ev.length - 1] : `Turn ${game.turn}`), warEv ? '#e88' : ev.length ? '#7fd17f' : '#9fd0ff');
  sound.play(warEv ? 'attack' : ev.some(m => m.startsWith('Researched')) ? 'research' : ev.some(m => /trained|built/.test(m)) ? 'build' : 'turn');
  checkGameOver();
  // Keep a city panel open if you were managing one; otherwise start the turn on
  // your first ready unit.
  if (selectedCity && game.cities.includes(selectedCity)) {
    refreshCityPanel();
  } else {
    advanceWhenIdle(null); // wait out the AI's move/fight animations first
  }

  // Research / civics: keep the drawers/buttons current; prompt for a new tech
  // when the research queue runs dry.
  if (sidebarOpen()) renderTab(activeTab);
  syncMenuHandle();
  const r0 = game.civs[0].research;
  const canPick = game.cities.some(c => c.owner === 0) && availableTechs(r0.researched).length > 0;
  if (!r0.queue.length && canPick) {
    if (ev.some(m => m.startsWith('Researched'))) openSidebar('research');
    else if (!researchNudged) { openSidebar('research'); researchNudged = true; }
  }

  saveGame(false); // autosave each turn so a refresh + Load resumes here
}
ui.onEndTurn(endTurn);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); endTurn(); }
  if (e.code === 'Escape') { if (placing) { placing = null; view.clearHighlights(); ui.toast('Cancelled', '#9fd0ff'); } else if (sidebarOpen()) closeSidebar(); else deselect(); }
  if (e.code === 'Tab') { e.preventDefault(); cycleToNextActive(selected); } // cycle to next active unit
});

// --- render loop -------------------------------------------------------------
let last = performance.now();
const hpEntities = []; // reused each frame for the health-bar pass
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  camRig.update(dt);
  view.animateWater(now / 1000);
  for (const u of game.units) u.update(dt);
  game.fx.update(dt);
  // Floating HP bars (damaged units & cities only).
  hpEntities.length = 0;
  for (const u of game.units) hpEntities.push({ mesh: u.mesh, hp: u.hp, maxHp: u.def.hp, barY: 1.05 });
  for (const c of game.cities) hpEntities.push({ mesh: c.mesh, hp: c.hp, maxHp: game.cityMaxHp(c), barY: 1.5 });
  healthBars.update(hpEntities, camera);
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

// Select a player unit so there's something to do immediately, and surface the
// game-over screen if a finished game was loaded.
{ const u = game.units.find(x => x.owner === 0); if (u) selectUnit(u, true); else deselect(); }
checkGameOver();

// Debug / test handle: lets the headless smoke test (and the browser console)
// inspect live game and camera state.
window.__hex = { game, view, ui, camRig, saveGame, healthBars, camera };
