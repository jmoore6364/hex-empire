// researchui.js — the pop-out research drawer: a Civ-style tech tree laid out in
// era columns with connector lines. Clicking a tech queues the whole path to it.
// Pure DOM; reads game state and calls back when a tech is picked.
import { TECHS, canResearch } from './tech.js';

const COL_W = 150, COL_GAP = 48, NODE_H = 56, NODE_GAP = 14, PAD = 8;
const SVGNS = 'http://www.w3.org/2000/svg';

export class ResearchPanel {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('research');
    this.tree = document.getElementById('tech-tree');
    this.currentEl = document.getElementById('research-current');
    this._pick = () => {};
    document.getElementById('research-close').addEventListener('click', () => this.close());
    document.getElementById('research-btn').addEventListener('click', () => this.toggle());
    this._layout();
  }

  onPick(fn) { this._pick = fn; }
  get isOpen() { return this.el.classList.contains('open'); }
  open() { this.el.classList.add('open'); this.render(); }
  close() { this.el.classList.remove('open'); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // Keep the top-bar research button in sync (shown whether the drawer is open).
  syncButton() {
    const btn = document.getElementById('research-btn');
    const r = this.game.civs[0].research;
    if (r.queue.length) {
      const t = TECHS[r.queue[0]];
      btn.textContent = `🔬 ${t.name} ${Math.floor(this.game.treasury.science)}/${t.cost}`;
    } else {
      btn.textContent = '🔬 Choose research';
    }
  }

  // Deterministic column/row layout: column = era, row = order within era.
  _layout() {
    const byEra = {};
    for (const [id, t] of Object.entries(TECHS)) (byEra[t.era] ||= []).push(id);
    this.pos = {};
    let maxRows = 0, maxEra = 0;
    for (const era of Object.keys(byEra)) {
      byEra[era].forEach((id, row) => { this.pos[id] = { x: PAD + era * (COL_W + COL_GAP), y: PAD + row * (NODE_H + NODE_GAP) }; });
      maxRows = Math.max(maxRows, byEra[era].length);
      maxEra = Math.max(maxEra, +era);
    }
    this.width = PAD * 2 + maxEra * (COL_W + COL_GAP) + COL_W;
    this.height = PAD * 2 + maxRows * (NODE_H + NODE_GAP);
    this.tree.style.width = this.width + 'px';
    this.tree.style.height = this.height + 'px';
  }

  render() {
    const r = this.game.civs[0].research;
    const researched = r.researched, queue = r.queue;
    const queueIdx = Object.fromEntries(queue.map((id, i) => [id, i]));

    // Header: current research + progress bar + turn estimate.
    if (queue.length) {
      const t = TECHS[queue[0]];
      const have = Math.floor(this.game.treasury.science);
      const pct = Math.max(0, Math.min(100, Math.round((have / t.cost) * 100)));
      const inc = this.game.income.science;
      const turns = inc > 0 ? Math.max(1, Math.ceil((t.cost - have) / inc)) : '∞';
      this.currentEl.innerHTML =
        `Researching <b style="color:#6fd0e8">${t.name}</b> — ${have}/${t.cost} 🔬 · ~${turns}t` +
        (queue.length > 1 ? ` <span style="opacity:.6">(+${queue.length - 1} queued)</span>` : '') +
        `<div class="bar"><i style="width:${pct}%"></i></div>`;
    } else {
      this.currentEl.innerHTML = `<span style="opacity:.7">No research selected — pick any technology below to chart a path to it.</span>`;
    }

    this.tree.innerHTML = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', this.width);
    svg.setAttribute('height', this.height);
    this.tree.appendChild(svg);

    // Connector lines (prerequisite -> tech).
    for (const [id, t] of Object.entries(TECHS)) {
      const to = this.pos[id];
      for (const req of t.requires) {
        const from = this.pos[req];
        const x1 = from.x + COL_W, y1 = from.y + NODE_H / 2, x2 = to.x, y2 = to.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        const onPath = queueIdx[id] !== undefined && (researched.has(req) || queueIdx[req] !== undefined);
        path.setAttribute('stroke', researched.has(id) ? '#3f7d4f' : onPath ? '#e0a85a' : '#33415e');
        path.setAttribute('stroke-width', researched.has(id) || onPath ? '2.5' : '1.5');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
      }
    }

    // Tech nodes.
    for (const [id, t] of Object.entries(TECHS)) {
      const p = this.pos[id];
      let state;
      if (researched.has(id)) state = 'researched';
      else if (queue[0] === id) state = 'inprogress';
      else if (queueIdx[id] !== undefined) state = 'queued';
      else if (canResearch(id, researched)) state = 'available';
      else state = 'locked';

      const node = document.createElement('div');
      node.className = 'tnode ' + state;
      node.style.left = p.x + 'px';
      node.style.top = p.y + 'px';
      node.style.width = COL_W + 'px';
      node.style.height = NODE_H + 'px';
      node.innerHTML =
        `<span class="cost">${t.cost}🔬</span>` +
        (state === 'queued' ? `<span class="qn">${queueIdx[id] + 1}</span>` : '') +
        `<b>${t.name}</b><small>${t.unlocks}</small>`;
      if (state !== 'researched') node.addEventListener('click', () => this._pick(id));
      this.tree.appendChild(node);
    }

    this.syncButton();
  }
}
