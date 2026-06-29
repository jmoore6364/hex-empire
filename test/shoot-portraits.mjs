// Capture screenshots of the start-menu civ cards (ruler portraits) and the
// diplomacy panel, to eyeball the procedural portraits. Saves PNGs to OUT_DIR.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT_DIR || '.';
import { writeFileSync } from 'node:fs';
async function rpc(ws, id, method, params = {}) { return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', f); res(m); } }; ws.addEventListener('message', f); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('to ' + method)), 9000); }); }
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1; const ev = async e => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name); };
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4000));
console.log('menu visible:', await ev(`getComputedStyle(document.getElementById('menu')).display`));
await shot('menu-portraits');
// Start a game, found capital, open diplomacy.
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2500));
await ev(`(()=>{const g=window.__hex.game;for(let o=0;o<g.civs.length;o++){if(g.cities.some(c=>c.owner===o))continue;const s=g.units.find(u=>u.owner===o&&u.type==='settler');if(s)g.foundCity(s);}window.__hex.ui.renderDiplomacy&&window.__hex.ui.renderDiplomacy();document.querySelector('.side-tab[data-tab=diplomacy]').click();return 'ok';})()`);
await new Promise(r => setTimeout(r, 600));
await shot('diplomacy-portraits');
ws.close(); process.exit(0);
