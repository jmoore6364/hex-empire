// portraits.js — procedural ruler portraits, drawn as inline SVG (no image
// assets), in the same spirit as emblems.js. Each civ gets a stylized
// head-and-shoulders bust: skin/hair tones derived deterministically from the
// civ id, framed in the civ colour, wearing trait-themed headwear.

const h2 = (c) => Math.max(0, Math.min(255, c | 0)).toString(16).padStart(2, '0');
const hex = (r, g, b) => `#${h2(r)}${h2(g)}${h2(b)}`;

// A tiny deterministic string hash so each civ's face is stable across runs.
function hash(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

const SKINS = ['#f3cda6', '#e7b488', '#d59c6e', '#c0834f', '#a3653a', '#7f4c27'];
const HAIRS = ['#1d1410', '#3a2718', '#5d3a1d', '#7c4a22', '#9a6a2c', '#c39a48', '#d9d3c6', '#9a1f1f'];

// Rulers who wear a beard (the rest are clean-shaven), curated for variety.
const BEARDED = new Set(['azure', 'crimson', 'ember', 'bronze', 'onyx']);

// Helmet/cap dome covering the top of the head, reused by several headwears.
const dome = (fill, stroke) =>
  `<path d="M31,42 Q50,14 69,42 Z" fill="${fill}"/><path d="M31,42 L69,42" stroke="${stroke}" stroke-width="2.4"/>`;

// One laurel/leaf, rotated around its anchor.
const leaf = (x, y, deg) =>
  `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="2.1" fill="#54ab69" transform="rotate(${deg} ${x} ${y})"/>`;

// Per-civ headwear, drawn last (over the face). Keyed by civ id.
const HEADWEAR = {
  // Seafarers — horned helm.
  azure: dome('#8a97a8', '#5b6675') +
    `<path d="M31,40 Q20,32 22,21 Q31,27 34,39 Z" fill="#eef2f7" stroke="#5b6675" stroke-width="1.4"/>` +
    `<path d="M69,40 Q80,32 78,21 Q69,27 66,39 Z" fill="#eef2f7" stroke="#5b6675" stroke-width="1.4"/>`,
  // Warmongers — crested war helm.
  crimson: dome('#9a3636', '#6e2020') +
    `<path d="M46,42 Q50,10 54,42 Z" fill="#d44040"/>` +
    `<path d="M46,42 Q50,12 54,42" fill="none" stroke="#7e2424" stroke-width="1.1"/>`,
  // Cultivators — laurel wreath (hair shows through).
  verdant: `<g fill="none" stroke="#3f9152" stroke-width="2.6" stroke-linecap="round"><path d="M30,53 Q25,34 42,27"/><path d="M70,53 Q75,34 58,27"/></g>` +
    leaf(29, 49, -64) + leaf(28, 42, -44) + leaf(31, 35, -24) + leaf(37, 30, -6) +
    leaf(71, 49, 64) + leaf(72, 42, 44) + leaf(69, 35, 24) + leaf(63, 30, 6),
  // Merchants — jewelled turban.
  amber: `<path d="M30,42 Q30,24 50,24 Q70,24 70,42 Q60,30 50,30 Q40,30 30,42 Z" fill="#d2a73c"/>` +
    `<path d="M30,42 Q50,30 70,42" fill="none" stroke="#b3892a" stroke-width="2"/>` +
    `<ellipse cx="50" cy="25.5" rx="4" ry="3" fill="#fff0c0"/>`,
  // Scholars — mortarboard cap.
  violet: `<rect x="42" y="30" width="16" height="9" rx="1" fill="#352a48"/>` +
    `<polygon points="50,19 77,29 50,33 23,29" fill="#2a2138"/>` +
    `<circle cx="50" cy="25.5" r="1.6" fill="#e6c24a"/>` +
    `<path d="M50,25.5 Q64,28 64,30 L64,39" fill="none" stroke="#e6c24a" stroke-width="1.3"/>`,
  // Industrious — hard hat.
  onyx: `<path d="M32,40 Q50,22 68,40 Z" fill="#e3ab2c"/>` +
    `<rect x="27" y="38" width="46" height="4" rx="2" fill="#c08f1c"/>` +
    `<path d="M50,23 L50,40" stroke="#c08f1c" stroke-width="2"/>`,
  // Builders — flat cap.
  jade: `<path d="M31,40 Q50,24 69,40 Z" fill="#1f8f81"/>` +
    `<path d="M28,40 L72,40 L72,43 Q50,38 28,43 Z" fill="#15655b"/>`,
  // Traders — feathered cavalier hat.
  rose: `<path d="M28,43 Q50,28 72,43 L74,45 L26,45 Z" fill="#7e2c4c"/>` +
    `<path d="M36,43 Q50,24 64,43 Z" fill="#a03c66"/>` +
    `<path d="M62,30 Q82,15 79,30 Q72,30 64,38 Z" fill="#f0a8c4"/>`,
  // Crusaders — pale helm with a cross.
  indigo: `<path d="M31,41 Q50,21 69,41 Z" fill="#d7dcee"/>` +
    `<rect x="30" y="39" width="40" height="4" rx="1" fill="#9aa3c8"/>` +
    `<path d="M50,14 L50,26 M45,19 L55,19" stroke="#5560d8" stroke-width="2.6" stroke-linecap="round"/>`,
  // Smiths — leather skullcap with a band.
  ember: `<path d="M31,42 Q50,24 69,42 Z" fill="#7a4a28"/>` +
    `<rect x="29" y="40" width="42" height="4" rx="2" fill="#552f16"/>`,
  // Stonemasons — a hood that frames the face.
  bronze: `<path d="M25,55 Q23,22 50,22 Q77,22 75,55 Q62,33 50,33 Q38,33 25,55 Z" fill="#8a5e30"/>` +
    `<path d="M25,55 Q38,33 50,33 Q62,33 75,55" fill="none" stroke="#6b4622" stroke-width="2"/>`,
  // Farmers — wide straw hat.
  lime: `<ellipse cx="50" cy="40" rx="30" ry="6" fill="#d9c45f"/>` +
    `<path d="M35,40 Q50,20 65,40 Z" fill="#e8d77a"/>` +
    `<path d="M35,40 Q50,34 65,40" fill="none" stroke="#b8a24a" stroke-width="1.4"/>`,
};

const FALLBACK = dome('#8895a6', '#5b6675');

// Returns an inline SVG string for a civ's ruler portrait. `colorHex` is a
// 0xRRGGBB number (the civ colour). `size` is the rendered px width/height.
export function portraitSVG(id, colorHex, size = 40) {
  const r = (colorHex >> 16) & 255, g = (colorHex >> 8) & 255, b = colorHex & 255;
  const light = hex(r, g, b), mid = hex(r * 0.72, g * 0.72, b * 0.72), dark = hex(r * 0.42, g * 0.42, b * 0.42);
  const seed = hash(id || 'x');
  const skin = SKINS[seed % SKINS.length];
  const hair = HAIRS[(seed >> 3) % HAIRS.length];
  const bearded = BEARDED.has(id);
  const gid = `pg_${id || 'x'}`, cid = `pc_${id || 'x'}`;

  const beard = bearded
    ? `<path d="M35,52 Q37,73 50,77 Q63,73 65,52 Q58,63 50,63 Q42,63 35,52 Z" fill="${hair}"/>` +
      `<path d="M44,58 Q50,61 56,58" fill="none" stroke="${hair}" stroke-width="3" stroke-linecap="round"/>`
    : `<path d="M45,61 Q50,64 55,61" fill="none" stroke="#7d4b3a" stroke-width="1.6" stroke-linecap="round"/>`;

  return `<svg class="portrait" viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <clipPath id="${cid}"><circle cx="50" cy="50" r="47"/></clipPath>
    </defs>
    <g clip-path="url(#${cid})">
      <rect x="0" y="0" width="100" height="100" fill="url(#${gid})"/>
      <path d="M14,100 Q50,60 86,100 Z" fill="${dark}"/>
      <path d="M24,100 Q50,72 76,100 Z" fill="${mid}" opacity="0.55"/>
      <path d="M43,60 L57,60 L57,72 L43,72 Z" fill="${skin}"/>
      <ellipse cx="50" cy="49" rx="20" ry="21" fill="${hair}"/>
      <ellipse cx="50" cy="50" rx="17" ry="19" fill="${skin}"/>
      <circle cx="33" cy="51" r="3.2" fill="${skin}"/><circle cx="67" cy="51" r="3.2" fill="${skin}"/>
      <path d="M40,44 Q44,42 48,44" fill="none" stroke="${hair}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M52,44 Q56,42 60,44" fill="none" stroke="${hair}" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="43.5" cy="48" r="2" fill="#26323f"/><circle cx="56.5" cy="48" r="2" fill="#26323f"/>
      <path d="M50,49 L48,56 Q50,57 52,56" fill="none" stroke="#9c6a48" stroke-width="1.4" stroke-linecap="round"/>
      ${beard}
      ${HEADWEAR[id] || FALLBACK}
    </g>
    <circle cx="50" cy="50" r="46" fill="none" stroke="#0d1622" stroke-width="4"/>
  </svg>`;
}
