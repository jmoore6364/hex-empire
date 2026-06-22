// researchui.js — a reusable pop-out tree drawer used for both the Technology
// tree (spent with science) and the Civics tree (spent with culture). It lays
// the catalogue out in era columns with connector lines; clicking a node queues
// the whole prerequisite path to it. Pure DOM.
//
// Config: { ids:{drawer,tree,current,btn,close}, catalogue, canPick, pathTo,
//           state(game)->{researched,queue}, bank(game)->n, income(game)->n,
//           glyph, accent, chooseLabel, onPick(id), afterRender(game) }
const COL_W = 150, COL_GAP = 48, NODE_H = 56, NODE_GAP = 14, PAD = 8;
const SVGNS = 'http://www.w3.org/2000/svg';

export class TreePanel {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.el = document.getElementById(cfg.ids.drawer);
    this.tree = document.getElementById(cfg.ids.tree);
    this.currentEl = document.getElementById(cfg.ids.current);
    this.btn = document.getElementById(cfg.ids.btn);
    document.getElementById(cfg.ids.close).addEventListener('click', () => this.close());
    this.btn.addEventListener('click', () => this.toggle());
    this._layout();
  }

  get isOpen() { return this.el.classList.contains('open'); }
  open() { this.el.classList.add('open'); this.render(); }
  close() { this.el.classList.remove('open'); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  syncButton() {
    const { catalogue, glyph } = this.cfg;
    const r = this.cfg.state(this.game);
    if (r.queue.length) {
      const t = catalogue[r.queue[0]];
      this.btn.textContent = `${glyph} ${t.name} ${this.cfg.bank(this.game)}/${t.cost}`;
    } else {
      this.btn.textContent = `${glyph} ${this.cfg.chooseLabel}`;
    }
  }

  _layout() {
    const { catalogue } = this.cfg;
    const byEra = {};
    for (const [id, t] of Object.entries(catalogue)) (byEra[t.era] ||= []).push(id);
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
    const { catalogue, canPick, accent, chooseLabel } = this.cfg;
    const r = this.cfg.state(this.game);
    const researched = r.researched, queue = r.queue;
    const queueIdx = Object.fromEntries(queue.map((id, i) => [id, i]));

    if (queue.length) {
      const t = catalogue[queue[0]];
      const have = this.cfg.bank(this.game);
      const pct = Math.max(0, Math.min(100, Math.round((have / t.cost) * 100)));
      const inc = this.cfg.income(this.game);
      const turns = inc > 0 ? Math.max(1, Math.ceil((t.cost - have) / inc)) : '∞';
      this.currentEl.innerHTML =
        `Working on <b style="color:${accent}">${t.name}</b> — ${have}/${t.cost} · ~${turns}t` +
        (queue.length > 1 ? ` <span style="opacity:.6">(+${queue.length - 1} queued)</span>` : '') +
        `<div class="bar"><i style="width:${pct}%"></i></div>`;
    } else {
      this.currentEl.innerHTML = `<span style="opacity:.7">${chooseLabel} — click any node to chart a path to it.</span>`;
    }

    this.tree.innerHTML = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', this.width);
    svg.setAttribute('height', this.height);
    this.tree.appendChild(svg);

    for (const [id, t] of Object.entries(catalogue)) {
      const to = this.pos[id];
      for (const req of t.requires) {
        const from = this.pos[req];
        if (!from) continue;
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

    for (const [id, t] of Object.entries(catalogue)) {
      const p = this.pos[id];
      let state;
      if (researched.has(id)) state = 'researched';
      else if (queue[0] === id) state = 'inprogress';
      else if (queueIdx[id] !== undefined) state = 'queued';
      else if (canPick(id, researched)) state = 'available';
      else state = 'locked';

      const node = document.createElement('div');
      node.className = 'tnode ' + state;
      node.style.left = p.x + 'px';
      node.style.top = p.y + 'px';
      node.style.width = COL_W + 'px';
      node.style.height = NODE_H + 'px';
      node.innerHTML =
        `<span class="cost">${t.cost}${this.cfg.glyph}</span>` +
        (state === 'queued' ? `<span class="qn">${queueIdx[id] + 1}</span>` : '') +
        `<b>${t.name}</b><small>${t.unlocks}</small>`;
      if (state !== 'researched') node.addEventListener('click', () => this.cfg.onPick(id));
      this.tree.appendChild(node);
    }

    this.syncButton();
    if (this.cfg.afterRender) this.cfg.afterRender(this.game);
  }
}
