// Verify camera controls: desktop left-drag pan + right-drag rotate, and
// mobile one-finger pan + two-finger twist rotate. Drives synthetic DOM events.
const CDP = process.env.CDP || 'http://127.0.0.1:9223', APP = process.env.APP || 'http://127.0.0.1:5173/';
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
await rpc(ws, id++, 'Page.navigate', { url: APP }); await new Promise(r => setTimeout(r, 4000));
await ev(`document.getElementById('menu-start').click()`); await new Promise(r => setTimeout(r, 2000));

const results = await ev(`(() => {
  const rig = window.__hex.camRig; const cv = document.querySelector('canvas');
  const round = v => Math.round(v * 1000) / 1000;
  const state = () => ({ tx: round(rig.target.x), tz: round(rig.target.z), yaw: round(rig.yaw), pitch: round(rig.pitch) });
  const md = (el, opt) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...opt }));
  const mm = (opt) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...opt }));
  const mu = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const pd = (opt) => cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', ...opt }));
  const pm = (opt) => cv.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', ...opt }));
  const pu = (opt) => cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', ...opt }));
  const out = {};

  // --- desktop left-drag PAN ---
  let a = state();
  md(cv, { button: 0, clientX: 400, clientY: 300 });
  for (let x = 410; x <= 520; x += 20) mm({ clientX: x, clientY: 300 });
  mu();
  let b = state();
  out.desktopPan = (a.tx !== b.tx || a.tz !== b.tz);

  // --- desktop right-drag ROTATE ---
  a = state();
  md(cv, { button: 2, clientX: 400, clientY: 300 });
  for (let x = 410; x <= 520; x += 20) mm({ clientX: x, clientY: 300 });
  mu();
  b = state();
  out.desktopRotate = (a.yaw !== b.yaw);

  // --- mobile one-finger PAN ---
  a = state();
  pd({ pointerId: 1, clientX: 300, clientY: 300 });
  for (let x = 315; x <= 420; x += 15) pm({ pointerId: 1, clientX: x, clientY: 300 });
  pu({ pointerId: 1, clientX: 420, clientY: 300 });
  b = state();
  out.mobilePan = (a.tx !== b.tx || a.tz !== b.tz);

  // --- mobile two-finger TWIST rotate ---
  a = state();
  pd({ pointerId: 2, clientX: 300, clientY: 300 });
  pd({ pointerId: 3, clientX: 400, clientY: 300 });   // two fingers, horizontal
  // rotate finger 3 around finger 2 (twist): move it to above finger 2
  pm({ pointerId: 3, clientX: 380, clientY: 250 });
  pm({ pointerId: 3, clientX: 340, clientY: 210 });
  pm({ pointerId: 3, clientX: 300, clientY: 200 });
  pu({ pointerId: 3, clientX: 300, clientY: 200 }); pu({ pointerId: 2, clientX: 300, clientY: 300 });
  b = state();
  out.mobileRotate = (a.yaw !== b.yaw);

  return JSON.stringify(out);
})()`);

console.log('camera controls:', results);
console.log('errors:', errors.length); for (const e of errors) console.log('  ' + e);
ws.close(); process.exit(0);
