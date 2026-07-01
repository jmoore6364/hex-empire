// Stage a player archer firing a ranged volley at an enemy, and capture the
// arrows mid-flight (+ the draw-back lean). Saves several frames to catch them.
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
const shot = async (name) => { const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png', clip: { x: 300, y: 220, width: 200, height: 170, scale: 3 } }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 720, height: 640, deviceScaleFactor: 1, mobile: false });
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4000));
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2500));
const setup = await ev(`(() => {
  const g = window.__hex.game;
  const s = g.units.find(u => u.owner === 0 && u.type === 'settler'); if (s) g.foundCity(s);
  const cap = g.cities.find(c => c.owner === 0);
  const dirs = [[1,0],[1,-1],[0,1],[-1,1],[-1,0],[0,-1]];
  for (const [dq,dr] of dirs) {
    const a = { q: cap.q+dq, r: cap.r+dr }, b = { q: cap.q+2*dq, r: cap.r+2*dr };
    const ta = g.tiles.get(a.q+','+a.r), tb = g.tiles.get(b.q+','+b.r);
    if (ta && ta.passable && tb && tb.passable && !g.cityAt(a.q,a.r) && !g.cityAt(b.q,b.r) && !g.unitAt(a.q,a.r) && !g.unitAt(b.q,b.r)) {
      const ar = g.spawnUnit('archer', 0, a.q, a.r);
      const en = g.spawnUnit('warrior', 1, b.q, b.r);
      const mid = window.__hex.view.topOf(cap.q+dq, cap.r+dr); window.__hex.camRig.focus(mid.x, mid.z, mid.y);
      window.__ar = ar; window.__en = en;
      return 'ok dir=' + dq + ',' + dr;
    }
  }
  return 'no line found';
})()`);
await new Promise(r => setTimeout(r, 700));
// Fire! then grab frames while the arrows are in the air.
await ev(`(() => { const g = window.__hex.game; g.resolveCombat(window.__ar, window.__en, true); return true; })()`);
await new Promise(r => setTimeout(r, 40));  await shot('arrows-1');
await new Promise(r => setTimeout(r, 80));  await shot('arrows-2');
await new Promise(r => setTimeout(r, 80));  await shot('arrows-3');
await new Promise(r => setTimeout(r, 80));  await shot('arrows-4');
console.log('setup:', setup);
console.log('errors:', errors.length); for (const e of errors) console.log('  ' + e);
ws.close(); process.exit(0);
