// Headless verification for the religion-visibility UI: map faith gems, the
// city-panel Faith line, and the Diplomacy "Faiths" overview.
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

const setup = await ev(`(() => {
  const g = window.__hex.game;
  const s = g.units.find(u => u.owner === 0 && u.type === 'settler'); if (s) g.foundCity(s);
  const cap = g.cities.find(c => c.owner === 0); if (!cap) return 'no capital';
  cap.buildings.add('monument');
  g.foundReligion(0, 'tithe', 'Solarism'); // capital converts immediately -> a gem
  // a rival city on a different faith, to fill out the Faiths overview
  let spot = null; for (const [k, tt] of g.tiles) { const [q, r] = k.split(',').map(Number);
    const d = Math.max(Math.abs(q - cap.q), Math.abs(r - cap.r), Math.abs((-q - r) - (-cap.q - cap.r)));
    if (tt.passable && d >= 3 && d <= 6 && !g.unitAt(q, r) && !g.cityAt(q, r)) { spot = { q, r }; break; } }
  if (spot) { const rs = g.spawnUnit('settler', 1, spot.q, spot.r); g.foundCity(rs); const rc = g.cities.find(c => c.owner === 1); rc.buildings.add('monument'); g.foundReligion(1, 'crusade', 'Ironcreed'); }
  window.__cap = cap;
  return JSON.stringify({ stats: g.religionStats().map(f => ({ name: f.name, cities: f.cities, founder: f.founder })) });
})()`);

await new Promise(r => setTimeout(r, 900)); // let the gem animate a couple frames
await shot('religion-map');

// City panel Faith line: select the capital, read + screenshot the panel.
await ev(`window.__hex.selectCity(window.__cap)`);
await new Promise(r => setTimeout(r, 400));
const panelFaith = await ev(`(() => {
  const rows = [...document.querySelectorAll('#sel-body .row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
  return JSON.stringify({ faithRow: rows.find(t => /Faith/.test(t)) || null });
})()`);
await shot('religion-city-panel');

// Open the Diplomacy tab and screenshot the Faiths overview.
await ev(`document.querySelector('.side-tab[data-tab=diplomacy]').click(); window.__hex.ui.renderDiplomacy && window.__hex.ui.renderDiplomacy();`);
await new Promise(r => setTimeout(r, 400));
const faithsSection = await ev(`(() => {
  const body = document.getElementById('diplo-body');
  const rows = [...body.querySelectorAll('.faith-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
  const hasSec = [...body.querySelectorAll('.sec')].some(s => /Faiths/.test(s.textContent));
  return JSON.stringify({ hasSec, rows });
})()`);
await shot('religion-diplomacy');

console.log('setup:', setup);
console.log('capital faith:', panelFaith);
console.log('faiths section:', faithsSection);
console.log('errors captured:', errors.length);
for (const e of errors) console.log('  ' + e);
ws.close(); process.exit(errors.length ? 1 : 0);
