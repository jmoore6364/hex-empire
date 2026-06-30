// Headless verification for the Missionary unit. Boots the real app, founds the
// player capital, founds a religion, spawns a missionary next to a rival city,
// drives the Spread Faith action through the UI, and screenshots the result.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT_DIR || '.';
import { writeFileSync } from 'node:fs';
async function rpc(ws, id, method, params = {}) { return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', f); res(m); } }; ws.addEventListener('message', f); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('to ' + method)), 9000); }); }
const errors = [];
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1;
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXCEPTION: ' + (d.exception?.description || d.text)); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value || a.description || a.type).join(' ')); });
const ev = async e => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4000));
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2500));

const booted = await ev(`!!(window.__hex && window.__hex.game)`);

const setup = await ev(`(() => {
  const g = window.__hex.game;
  // found the player capital + give it a place of worship, then a religion
  const s = g.units.find(u => u.owner === 0 && u.type === 'settler'); if (s) g.foundCity(s);
  const cap = g.cities.find(c => c.owner === 0); if (!cap) return 'no capital';
  cap.buildings.add('monument');
  g.foundReligion(0, 'tithe', 'Solarism');
  // a rival city to convert: found one for civ 1 a few tiles away
  let spot = null; for (const [k, t] of g.tiles) { const [q, r] = k.split(',').map(Number);
    const d = Math.max(Math.abs(q - cap.q), Math.abs(r - cap.r), Math.abs((-q - r) - (-cap.q - cap.r)));
    if (t.passable && d >= 3 && d <= 6 && !g.unitAt(q, r) && !g.cityAt(q, r)) { spot = { q, r }; break; } }
  if (!spot) return 'no rival spot';
  const rs = g.spawnUnit('settler', 1, spot.q, spot.r); g.foundCity(rs);
  const rival = g.cities.find(c => c.owner === 1);
  const adj = g.neighbors ? null : null;
  // place a missionary adjacent to the rival
  const ns = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].map(([dq,dr]) => ({ q: rival.q+dq, r: rival.r+dr }))
    .find(n => { const tt = g.tiles.get(n.q+','+n.r); return tt && tt.passable && !g.unitAt(n.q,n.r) && !g.cityAt(n.q,n.r); });
  if (!ns) return 'no adj tile';
  const m = g.spawnUnit('missionary', 0, ns.q, ns.r);
  window.__miss = m.id; window.__rival = rival;
  return JSON.stringify({ inBuild: g.buildOptions(0, cap).some(o => o.id === 'missionary'), charges: m.spreads, rivalFaith: rival.religion, targets: g.spreadTargets(m).length });
})()`);

// Select the missionary so the unit panel renders, then screenshot.
await ev(`(() => { const g = window.__hex.game; const m = g.units.find(u => u.id === window.__miss); window.__hex.selectUnit(m); return true; })()`);
await new Promise(r => setTimeout(r, 400));
const panel = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Spread Faith/.test(x.textContent)); return b ? b.textContent.trim() : 'no button'; })()`);
await shot('missionary-panel');

// Click the Spread Faith button and confirm the conversion.
const converted = await ev(`(() => {
  const g = window.__hex.game; const before = window.__rival.religion;
  const b = [...document.querySelectorAll('button')].find(x => /Spread Faith/.test(x.textContent));
  if (b) b.click();
  return JSON.stringify({ clicked: !!b, before, after: window.__rival.religion, missionaryGone: !g.units.some(u => u.id === window.__miss) });
})()`);

console.log('booted:', booted);
console.log('setup:', setup);
console.log('panel button:', panel);
console.log('convert result:', converted);
console.log('errors captured:', errors.length);
for (const e of errors) console.log('  ' + e);
ws.close(); process.exit(errors.length ? 1 : 0);
