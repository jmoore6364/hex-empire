// Render a contact sheet of all 12 ruler full-body figures (every trait
// archetype) on one page and screenshot it, to eyeball the new bodies.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT_DIR || '.';
import { writeFileSync } from 'node:fs';
async function rpc(ws, id, method, params = {}) { return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', f); res(m); } }; ws.addEventListener('message', f); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => rej(new Error('to ' + method)), 9000); }); }
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1; const ev = async e => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await rpc(ws, id++, 'Runtime.enable'); await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false });
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 3500));
const built = await ev(`(async () => {
  const { portraitFullSVG } = await import('/src/portraits.js');
  const { CIVILIZATIONS } = await import('/src/civilizations.js');
  document.body.innerHTML = '<div id="sheet" style="background:#10151d;display:flex;flex-wrap:wrap;gap:6px;padding:12px;font:11px sans-serif;color:#cfe0f0"></div>';
  const s = document.getElementById('sheet');
  for (const c of CIVILIZATIONS) {
    const d = document.createElement('div');
    d.style.cssText = 'width:120px;text-align:center;background:#19222e;border-radius:8px;padding:6px';
    d.innerHTML = portraitFullSVG(c.id, c.color, 170) + '<div>' + c.ruler + '</div>';
    s.appendChild(d);
  }
  return CIVILIZATIONS.length;
})()`);
await new Promise(r => setTimeout(r, 300));
const r = await rpc(ws, id++, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 820, height: 560, scale: 1 } });
writeFileSync(`${OUT}/fullbody-sheet.png`, Buffer.from(r.result.data, 'base64'));
console.log('built figures:', built, '-> saved fullbody-sheet.png');
ws.close(); process.exit(0);
