// ui.js — thin DOM layer over the HUD. Knows nothing about Three.js; main.js
// feeds it state and wires its buttons to game actions.
import { TERRAIN } from './worldgen.js';
import { RESOURCES, resourceSummary } from './resources.js';
import { defenseMultiplier } from './combat.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.sel = $('selection');
    this.selTitle = $('sel-title');
    this.selBody = $('sel-body');
    this.selActions = $('sel-actions');
    this._toastTimer = null;
  }

  onEndTurn(fn) { $('endturn').addEventListener('click', fn); }

  refreshTopbar(game) {
    $('turn').textContent = game.turn;
    if (game.yearLabel) $('year').textContent = game.yearLabel();
    if (game.ageName) {
      const p = game.eraProgress ? game.eraProgress() : null;
      $('age').textContent = p ? `${game.ageName()} ${p.done}/${p.total}` : game.ageName();
    }
    if (game.civs && game.civs[0]) $('civname').textContent = game.civs[0].name;
    $('food').textContent = '+' + game.income.food;
    $('prod').textContent = '+' + game.income.prod;
    $('gold').textContent = Math.round(game.treasury.gold) + ' (+' + game.income.gold + ')';
    $('sci').textContent = Math.round(game.treasury.science) + ' (+' + game.income.science + ')';
    $('cult').textContent = Math.round(game.treasury.culture) + ' (+' + game.income.culture + ')';
  }

  showUnit(unit, actions) {
    this.sel.style.display = 'block';
    this.selTitle.textContent = `${unit.def.name}  ${unit.owner === 0 ? '(You)' : '(Enemy)'}`;
    this.selBody.innerHTML =
      `<div class="row"><span>HP</span><span>${unit.hp}/${unit.def.hp}</span></div>` +
      `<div class="row"><span>Movement</span><span>${unit.move}/${unit.def.move}</span></div>` +
      (unit.def.attack ? `<div class="row"><span>Attack</span><span>${unit.def.attack}</span></div>` : '') +
      (unit.def.range > 1 ? `<div class="row"><span>Range</span><span>${unit.def.range} (ranged)</span></div>` : '') +
      (unit.def.domain === 'sea' ? `<div class="row"><span>Type</span><span>⚓ Naval</span></div>` : '') +
      (unit.embarked ? `<div class="row"><span>Status</span><span>⚓ Embarked (vulnerable)</span></div>` : '') +
      `<div class="row"><span>Tile</span><span>${unit.q}, ${unit.r}</span></div>`;
    this._renderActions(actions);
  }

  showTile(tile, actions = []) {
    this.sel.style.display = 'block';
    const def = TERRAIN[tile.terrain];
    this.selTitle.textContent = def.name;
    const defMul = defenseMultiplier(tile.terrain);
    this.selBody.innerHTML =
      (tile.river ? `<div class="row"><span style="color:#6fc4f0">River</span><span>+1 food, +1 gold · slow to ford</span></div>` : '') +
      (tile.resource ? `<div class="row"><span style="color:#f0c95a">Resource</span><span>${RESOURCES[tile.resource].name} (${resourceSummary(tile.resource)})</span></div>` : '') +
      `<div class="row"><span class="food">Food</span><span>${tile.yields.food}</span></div>` +
      `<div class="row"><span class="prod">Production</span><span>${tile.yields.prod}</span></div>` +
      `<div class="row"><span class="gold">Gold</span><span>${tile.yields.gold}</span></div>` +
      (defMul > 1 ? `<div class="row"><span>Defense</span><span>+${Math.round((defMul - 1) * 100)}%</span></div>` : '') +
      `<div class="row"><span>Passable</span><span>${tile.passable ? 'yes' : 'no'}</span></div>`;
    this._renderActions(actions);
  }

  // model: { name, you, population, growth:{have,need}, yields,
  //          producing:{name,turns}|null, queue:[{name,turns}],
  //          research:{name,detail}, buildings:[names] }
  showCity(model, actions = []) {
    this.sel.style.display = 'block';
    this.selTitle.textContent = `${model.name}  ${model.you ? '(You)' : '(Enemy)'}`;

    const sec = (label) => `<div class="sec">${label}</div>`;
    const row = (l, v, cls = '') => `<div class="row"><span class="${cls}">${l}</span><span>${v}</span></div>`;
    let h = '';
    h += row('Population', model.population);
    h += row('Growth', `${model.growth.have}/${model.growth.need}`, 'food');
    if (model.defense) h += row('Defense', `${model.defense.hp}/${model.defense.max} HP`);
    if (model.religion) h += row('Faith', `<span style="color:${model.religion.color}">◆</span> ${model.religion.name}`);

    if (model.you) {
      const y = model.yields;
      h += row('Per turn', `<span class="food">${y.food}🌾</span> <span class="prod">${y.prod}⚒</span> <span class="gold">${y.gold}🪙</span> <span class="sci">${y.science}🔬</span>`);
      h += sec('Producing');
      h += model.producing
        ? row(`<span class="prod">${model.producing.name}</span>`, `${model.producing.turns}t`)
        : `<div class="row"><span style="opacity:.55">Idle — pick something to build</span></div>`;
      for (const q of model.queue) h += row(`<span style="opacity:.7">• ${q.name}</span>`, `${q.turns}t`);
      if (model.wonders && model.wonders.length) { h += sec('Wonders'); h += `<div class="row"><span style="color:#f4cf5a">${model.wonders.join(', ')}</span></div>`; }
      if (model.districts && model.districts.length) { h += sec('Districts'); h += `<div class="row"><span>${model.districts.join(', ')}</span></div>`; }
      if (model.buildings.length) { h += sec('Buildings'); h += `<div class="row"><span>${model.buildings.join(', ')}</span></div>`; }
    }
    this.selBody.innerHTML = h;
    this._renderActions(actions);
  }

  _renderActions(actions = []) {
    this.selActions.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'act';
      b.textContent = a.label;
      b.disabled = a.enabled === false;
      b.addEventListener('click', a.onClick);
      this.selActions.appendChild(b);
    }
  }

  hideSelection() { this.sel.style.display = 'none'; }

  toast(msg, color = '#fff') {
    const t = $('toast');
    t.textContent = msg;
    t.style.color = color;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }

  hideLoading() { const l = $('loading'); if (l) l.style.display = 'none'; }
}
