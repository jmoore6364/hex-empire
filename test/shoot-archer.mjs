// Spawn a player (blue) and enemy (red) Archer near the capital, focus the
// camera on them and capture a tight shot to check the Blender model + tinting.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT_DIR || '.';
import { writeFileSync } from 'node:fs';
async function rpc(ws, id, method, params = {}) { return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', f); res(m); } }; ws.addEventListener('message', f); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('to ' + method)), 9000); }); }
const errors = [];
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1;
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXC: ' + (d.exception?.description || d.text)); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('err: ' + m.params.args.map(a => a.value || a.description || a.type).join(' ')); });
const ev = async e => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 700, height: 620, deviceScaleFactor: 2, mobile: false });
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4500));
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2500));
const info = await ev(`(() => {
  const g = window.__hex.game;
  const s = g.units.find(u => u.owner === 0 && u.type === 'settler'); if (s) g.foundCity(s);
  const cap = g.cities.find(c => c.owner === 0);
  // two adjacent land tiles for a blue + red archer
  const ns = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].map(([dq,dr]) => ({ q: cap.q+dq, r: cap.r+dr }))
    .filter(n => { const tt = g.tiles.get(n.q+','+n.r); return tt && tt.passable && !g.unitAt(n.q,n.r) && !g.cityAt(n.q,n.r); });
  const a0 = g.spawnUnit('archer', 0, ns[0].q, ns[0].r);
  const a1 = ns[1] ? g.spawnUnit('archer', 1, ns[1].q, ns[1].r) : null;
  const top = window.__hex.view.topOf(cap.q, cap.r); window.__hex.camRig.focus(top.x, top.z, top.y);
  // did the model actually load (vs procedural fallback)? and did the walk clip wire up?
  const usesModel = !!a0.mixer;
  // nudge it a step so the walk animation switches on (still won't show motion,
  // but confirms it animates without error)
  const dest = ns[2] || ns[0];
  return JSON.stringify({ usesModel, meshChildren: a0.mesh.children.length, walkActions: a0.walkActions ? a0.walkActions.length : 0, idleActions: a0.idleActions ? a0.idleActions.length : 0 });
})()`);
// DIAGNOSTIC: idle sway — a STATIONARY archer's model root should bob/lean over time
await ev(`(() => { const g = window.__hex.game; const a = g.units.find(u => u.owner === 0 && u.type === 'archer'); window.__diagNode = a.mesh.children[0]; return true; })()`);
const y0 = await ev(`(() => { const n = window.__diagNode; return JSON.stringify([+n.position.y.toFixed(4), +n.rotation.z.toFixed(4)]); })()`);
await new Promise(r => setTimeout(r, 350));
const y1 = await ev(`(() => { const n = window.__diagNode; return JSON.stringify([+n.position.y.toFixed(4), +n.rotation.z.toFixed(4)]); })()`);
console.log('idle sway (root posY, rotZ) t0:', y0);
console.log('idle sway (root posY, rotZ) t1:', y1);
await new Promise(r => setTimeout(r, 500));
const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png', clip: { x: 170, y: 150, width: 360, height: 320, scale: 2 } });
writeFileSync(`${OUT}/archer-ingame.png`, Buffer.from(r.result.data, 'base64'));
console.log('info:', info);
console.log('errors:', errors.length); for (const e of errors) console.log('  ' + e);
console.log('saved archer-ingame.png');
ws.close(); process.exit(0);
