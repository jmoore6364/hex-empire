// Headless smoke test: load the app in Edge/Chromium via CDP, drive a few
// interactions, and report any console errors or uncaught exceptions.
//
// Prereqs (both must already be running):
//   1. the dev server:  npm start
//   2. a Chromium with remote debugging:
//      msedge --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/p about:blank
// Then:  node test/smoke.mjs   (override endpoints with CDP=… APP=… env vars)
const CDP = process.env.CDP || 'http://127.0.0.1:9223';
const APP = process.env.APP || 'http://127.0.0.1:5173/';

async function rpc(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error('rpc timeout ' + method)), 8000);
  });
}

const errors = [];
const logs = [];

// Open a fresh blank tab; we navigate explicitly after enabling domains so no
// early exception is missed.
const newTab = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(newTab.webSocketDebuggerUrl);
await new Promise(res => ws.addEventListener('open', res, { once: true }));

let id = 1;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error: ' + m.params.args.map(a => a.value || a.description || a.type).join(' '));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    // network 404s etc.
    logs.push('log.error: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  }
});

await rpc(ws, id++, 'Runtime.enable');
await rpc(ws, id++, 'Log.enable');
await rpc(ws, id++, 'Page.enable');

// Navigate now that listeners are armed.
await rpc(ws, id++, 'Page.navigate', { url: APP });

// Give the module time to boot and generate the world.
await new Promise(r => setTimeout(r, 4000));

// Did the app finish booting (loading overlay hidden)?
const loadingHidden = await rpc(ws, id++, 'Runtime.evaluate', {
  expression: `document.getElementById('loading').style.display === 'none'`,
  returnByValue: true,
});

// Probe game state through the module by reading the DOM the UI renders.
const probe = await rpc(ws, id++, 'Runtime.evaluate', {
  expression: `JSON.stringify({
    turn: document.getElementById('turn').textContent,
    tiles: document.querySelectorAll('canvas').length,
    selTitle: document.getElementById('sel-title').textContent,
  })`,
  returnByValue: true,
});

// Click "End Turn" a few times to exercise the economy + AI path.
for (let i = 0; i < 4; i++) {
  await rpc(ws, id++, 'Runtime.evaluate', { expression: `document.getElementById('endturn').click()` });
  await new Promise(r => setTimeout(r, 700));
}
const afterTurns = await rpc(ws, id++, 'Runtime.evaluate', {
  expression: `document.getElementById('turn').textContent`, returnByValue: true,
});

console.log('booted (loading hidden):', loadingHidden.result?.result?.value);
console.log('initial probe:', probe.result?.result?.value);
console.log('turn after 4x end-turn:', afterTurns.result?.result?.value);
console.log('errors captured:', errors.length);
for (const e of errors) console.log('  ' + e);
for (const l of logs) console.log('  ' + l);

ws.close();
process.exit(errors.length ? 1 : 0);
