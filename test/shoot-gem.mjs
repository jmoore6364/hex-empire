// Zoom the camera onto a converted capital and capture a tight shot so the
// floating faith gem is clearly visible.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT_DIR || '.';
import { writeFileSync } from 'node:fs';
async function rpc(ws, id, method, params = {}) { return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', f); res(m); } }; ws.addEventListener('message', f); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('to ' + method)), 9000); }); }
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1; const ev = async e => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 700, height: 600, deviceScaleFactor: 2, mobile: false });
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4000));
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2500));
await ev(`(() => { const g = window.__hex.game; const s = g.units.find(u => u.owner === 0 && u.type === 'settler'); if (s) g.foundCity(s); const cap = g.cities.find(c => c.owner === 0); cap.buildings.add('monument'); g.foundReligion(0,'tithe','Solarism'); const top = window.__hex.view.topOf(cap.q, cap.r); window.__hex.camRig.focus(top.x, top.z, top.y); return true; })()`);
await new Promise(r => setTimeout(r, 1200));
const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png', clip: { x: 210, y: 150, width: 300, height: 260, scale: 2 } });
writeFileSync(`${OUT}/faith-gem-zoom.png`, Buffer.from(r.result.data, 'base64'));
console.log('saved faith-gem-zoom.png');
ws.close(); process.exit(0);
