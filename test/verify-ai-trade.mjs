// Headless verification for AI-initiated trade. Boots the real app via CDP,
// starts a game, founds the player capital, then drives three flows:
//   1. AI -> player offer: rig resources so an AI can profitably sell the player
//      a type it lacks, run _aiOfferToPlayer, confirm an offer queues + the
//      Diplomacy tab renders an Accept/Decline row + the menu handle glows.
//   2. Accept: acceptOffer() turns the offer into a standing deal.
//   3. AI <-> AI auto-trade: rig two AIs and confirm _aiTryTrade executes a deal.
// Reports console errors throughout.
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

// Found the player capital and give it a spare iron tile; strip iron from civ 1
// so the AI can profitably SELL iron to the player.
const setup = await evalv(`(() => {
  const g = window.__hex.game;
  // Everyone starts with a settler and no city — found a capital for each civ.
  for (let owner = 0; owner < g.civs.length; owner++) {
    if (g.cities.some(c => c.owner === owner)) continue;
    const s = g.units.find(u => u.owner === owner && u.type === 'settler');
    if (s) g.foundCity(s);
  }
  let cap = g.cities.find(c => c.owner === 0);
  if (!cap) return 'no capital';
  // Player must LACK iron (so AI selling iron has value). Strip iron from player tiles.
  for (const k of cap.tiles) { const t = g.tiles.get(k); if (t && t.resource === 'iron') t.resource = null; }
  // Civ 1 owns two iron tiles (a duplicate it can rent out for free).
  const c1 = g.cities.find(c => c.owner === 1);
  if (!c1) return 'no civ1 city';
  let n = 0; for (const k of c1.tiles) { const t = g.tiles.get(k); if (t && !t.resource && n < 2) { t.resource = 'iron'; n++; } }
  g.civs[0].treasury.gold = 200; // player can afford the per-turn lease
  if (g.atWar(0,1)) g.makePeace(0,1);
  return 'ok playerIron=' + g.resourceAccess(0).has('iron') + ' civ1spareIron=' + g._resAvailable(1,'iron');
})()`);

// Force an AI->player offer (bypass the turn cadence by calling directly).
const offered = await evalv(`(() => {
  const g = window.__hex.game;
  g.dealOffers = [];
  // call across owners, satisfying the per-owner (turn+owner)%6===0 cadence guard
  for (let owner = 1; owner < g.civs.length; owner++) {
    if (g.atWar(owner,0) || !g.isCivAlive(owner)) continue;
    g.turn = (6 - (owner % 6)) % 6;        // make (g.turn+owner)%6===0
    g._aiOfferToPlayer(owner);
  }
  const o = g.dealOffers[0];
  return JSON.stringify({ count: g.dealOffers.length, from: o && o.from, give: o && o.give.res, take: o && o.take.res, takeGpt: o && o.take.goldPerTurn, giveGpt: o && o.give.goldPerTurn });
})()`);

// Re-render diplomacy and check the offer row + the glowing handle.
const ui = await evalv(`(() => {
  window.__hex.ui.renderDiplomacy && window.__hex.ui.renderDiplomacy();
  document.querySelector('.side-tab[data-tab=diplomacy]').click();
  const row = document.querySelector('#diplo-body .deal-offer');
  const accept = document.querySelector('#diplo-body [data-accept]');
  const decline = document.querySelector('#diplo-body [data-decline]');
  const handle = document.getElementById('menu-handle') || document.querySelector('.menu-handle');
  const glow = handle ? handle.classList.contains('glow') : null;
  return JSON.stringify({ rowText: row ? row.textContent.replace(/\\s+/g,' ').trim().slice(0,80) : null, hasAccept: !!accept, hasDecline: !!decline, handleGlow: glow });
})()`);

// Accept the offer -> a standing deal should result.
const accepted = await evalv(`(() => {
  const g = window.__hex.game;
  const before = g.deals.length;
  const o = g.dealOffers[0];
  if (!o) return 'no offer to accept';
  const r = g.acceptOffer(o.id);
  return JSON.stringify({ ok: r && r.ok, dealsBefore: before, dealsAfter: g.deals.length, offersLeft: g.dealOffers.length, dealRes: g.deals[g.deals.length-1] && g.deals[g.deals.length-1].take.res });
})()`);

// AI <-> AI auto-trade: rig civ 2 to lack iron, civ 1 to have a spare, set turn
// so the cadence fires for owner 2, then call _aiTryTrade(2).
const aiai = await evalv(`(() => {
  const g = window.__hex.game;
  if (g.civs.length < 3) return 'need 3+ civs';
  const c2 = g.cities.find(c => c.owner === 2);
  if (!c2) return 'no civ2 city';
  for (const k of c2.tiles) { const t = g.tiles.get(k); if (t && t.resource === 'iron') t.resource = null; }
  // Top civ 1 up so it keeps a spare iron even after the player's earlier lease.
  const c1 = g.cities.find(c => c.owner === 1);
  let want = 3; for (const k of c1.tiles) { const t = g.tiles.get(k); if (t && t.resource === 'iron') want--; }
  for (const k of c1.tiles) { if (want <= 0) break; const t = g.tiles.get(k); if (t && !t.resource) { t.resource = 'iron'; want--; } }
  g.civs[2].treasury.gold = 200;
  if (g.atWar(1,2)) g.makePeace(1,2);
  g.turn = (4 - 2 % 4) % 4 === 0 ? g.turn : g.turn; // ensure (turn+2)%4===0
  while ((g.turn + 2) % 4 !== 0) g.turn++;
  const before = g.deals.length;
  g._aiTryTrade(2);
  const d = g.deals[g.deals.length-1];
  return JSON.stringify({ dealsBefore: before, dealsAfter: g.deals.length, lastDealParties: d && [d.a, d.b], lastDealRes: d && d.take.res });
})()`);

console.log('booted:', booted);
console.log('setup:', setup);
console.log('AI offered:', offered);
console.log('UI render:', ui);
console.log('accept result:', accepted);
console.log('AI<->AI auto-trade:', aiai);
console.log('errors captured:', errors.length);
for (const e of errors) console.log('  ' + e);
ws.close();
process.exit(errors.length ? 1 : 0);
