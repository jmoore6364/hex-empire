// Headless verification for the diplomatic trade-deal window. Boots the real
// app via CDP, starts a game, forces the player to own a spare resource, opens
// the deal window against civ 1, and proposes a resource-for-gold/turn lease.
// Reports console errors and whether a standing deal results.
const CDP = process.env.CDP || 'http://127.0.0.1:9223';
const APP = process.env.APP || 'http://127.0.0.1:5173/';

async function rpc(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error('rpc timeout ' + method)), 9000);
  });
}
const errors = [];
const newTab = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(newTab.webSocketDebuggerUrl);
await new Promise(res => ws.addEventListener('open', res, { once: true }));
let id = 1;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXCEPTION: ' + (d.exception?.description || d.text)); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value || a.description || a.type).join(' '));
});
const evalv = async (expression) => (await rpc(ws, id++, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await rpc(ws, id++, 'Runtime.enable');
await rpc(ws, id++, 'Page.enable');
await rpc(ws, id++, 'Page.navigate', { url: APP });
await new Promise(r => setTimeout(r, 4000));

await evalv(`document.getElementById('menu-start').click()`);
await new Promise(r => setTimeout(r, 2500));

const booted = await evalv(`!!(window.__hex && window.__hex.game)`);

// Force the player capital to control a spare 'iron' tile, then open a deal.
const setup = await evalv(`(() => {
  const g = window.__hex.game;
  let cap = g.cities.find(c => c.owner === 0);
  if (!cap) { // the player opens with a settler — found the capital first
    const s = g.units.find(u => u.owner === 0 && u.type === 'settler');
    if (s) g.foundCity(s);
    cap = g.cities.find(c => c.owner === 0);
  }
  if (!cap) return 'no capital';
  const tk = [...cap.tiles].find(k => { const t = g.tiles.get(k); return t && !t.resource; });
  g.tiles.get(tk).resource = 'iron';
  // Make sure civ 1 genuinely lacks iron so the lease has value to it.
  for (const c of g.cities) if (c.owner === 1 && c.tiles) for (const k of c.tiles) { const t = g.tiles.get(k); if (t && t.resource === 'iron') t.resource = null; }
  g.civs[1].treasury.gold = 200;            // partner can afford a lease
  if (g.atWar(0,1)) g.makePeace(0,1);
  return 'ok spare=' + g._resAvailable(0,'iron') + ' aiHasIron=' + g.resourceAccess(1).has('iron');
})()`);

// Open the diplomacy tab and click this civ's Trade button.
const opened = await evalv(`(() => {
  document.querySelector('.side-tab[data-tab=diplomacy]').click();
  const btn = document.querySelector('#diplo-body [data-deal-civ="1"]');
  if (!btn) return 'no trade button';
  btn.click();
  return document.getElementById('deal').classList.contains('open') ? 'open' : 'not open';
})()`);

// Fill: give iron, take 6 gold/turn, 30-turn term, then check the verdict + propose.
const result = await evalv(`(() => {
  const pill = document.querySelector('#deal-you .deal-res input[data-res=iron]');
  if (!pill) return 'no iron pill';
  pill.click();
  document.getElementById('them-gpt').value = 3;
  document.getElementById('them-gpt').dispatchEvent(new Event('input'));
  document.getElementById('deal-term').value = '30';
  document.getElementById('deal-term').dispatchEvent(new Event('change'));
  const verdict = document.getElementById('deal-verdict').textContent;
  const disabled = document.getElementById('deal-propose').disabled;
  document.getElementById('deal-propose').click();
  const g = window.__hex.game;
  return JSON.stringify({ verdict, disabled, deals: g.deals.length, dealRes: g.deals[0] && g.deals[0].give.res[0], stillOpen: document.getElementById('deal').classList.contains('open') });
})()`);

console.log('booted:', booted);
console.log('setup:', setup);
console.log('window opened:', opened);
console.log('propose result:', result);
console.log('errors captured:', errors.length);
for (const e of errors) console.log('  ' + e);
ws.close();
process.exit(errors.length ? 1 : 0);
