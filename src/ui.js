// ui.js — thin DOM layer over the HUD. Knows nothing about Three.js; main.js
// feeds it state and wires its buttons to game actions.
import { TERRAIN } from './worldgen.js';

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
    $('food').textContent = '+' + game.income.food;
    $('prod').textContent = '+' + game.income.prod;
    $('gold').textContent = Math.round(game.treasury.gold) + ' (+' + game.income.gold + ')';
    $('sci').textContent = Math.round(game.treasury.science) + ' (+' + game.income.science + ')';
  }

  showUnit(unit, actions) {
    this.sel.style.display = 'block';
    this.selTitle.textContent = `${unit.def.name}  ${unit.owner === 0 ? '(You)' : '(Enemy)'}`;
    this.selBody.innerHTML =
      `<div class="row"><span>HP</span><span>${unit.hp}/${unit.def.hp}</span></div>` +
      `<div class="row"><span>Movement</span><span>${unit.move}/${unit.def.move}</span></div>` +
      (unit.def.attack ? `<div class="row"><span>Attack</span><span>${unit.def.attack}</span></div>` : '') +
      `<div class="row"><span>Tile</span><span>${unit.q}, ${unit.r}</span></div>`;
    this._renderActions(actions);
  }

  showTile(tile, actions = []) {
    this.sel.style.display = 'block';
    const def = TERRAIN[tile.terrain];
    this.selTitle.textContent = def.name;
    this.selBody.innerHTML =
      `<div class="row"><span class="food">Food</span><span>${tile.yields.food}</span></div>` +
      `<div class="row"><span class="prod">Production</span><span>${tile.yields.prod}</span></div>` +
      `<div class="row"><span class="gold">Gold</span><span>${tile.yields.gold}</span></div>` +
      `<div class="row"><span>Passable</span><span>${tile.passable ? 'yes' : 'no'}</span></div>`;
    this._renderActions(actions);
  }

  showCity(city, actions = []) {
    this.sel.style.display = 'block';
    this.selTitle.textContent = `${city.name}  ${city.owner === 0 ? '(You)' : '(Enemy)'}`;
    this.selBody.innerHTML =
      `<div class="row"><span>Population</span><span>${city.population}</span></div>` +
      `<div class="row"><span class="food">Growth</span><span>${Math.round(city.food)}/${city.population * 10}</span></div>`;
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
