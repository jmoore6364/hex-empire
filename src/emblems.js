// emblems.js — procedural heraldic crests for each civilization, drawn as inline
// SVG (no image assets). A shield filled with the civ's colour (light→dark
// gradient) carries a simple symbol that nods to the civ's trait.

// Per-civ symbol markup, drawn over the shield (viewBox 0 0 100 120).
const SYMBOLS = {
  // Seafarers — three waves.
  azure: `<g fill="none" stroke="#eef4ff" stroke-width="6" stroke-linecap="round">
    <path d="M28,46 q11,-9 22,0 t22,0"/><path d="M28,60 q11,-9 22,0 t22,0"/><path d="M28,74 q11,-9 22,0 t22,0"/></g>`,
  // Warmongers — crossed swords.
  crimson: `<g stroke="#eef4ff" stroke-width="7" stroke-linecap="round"><line x1="33" y1="40" x2="67" y2="84"/><line x1="67" y1="40" x2="33" y2="84"/></g>
    <g stroke="#eef4ff" stroke-width="5" stroke-linecap="round"><line x1="28" y1="78" x2="40" y2="78"/><line x1="60" y1="78" x2="72" y2="78"/></g>`,
  // Cultivators — a leaf.
  verdant: `<path d="M50,34 C70,46 70,74 50,88 C30,74 30,46 50,34 Z" fill="#eef4ff"/>
    <path d="M50,40 L50,84" stroke="#2f7d3a" stroke-width="4" stroke-linecap="round"/>`,
  // Merchants — a coin.
  amber: `<circle cx="50" cy="60" r="22" fill="#eef4ff"/><path d="M50,46 L62,60 L50,74 L38,60 Z" fill="#b8780b"/>`,
  // Scholars — a star.
  violet: `<path d="M50,34 L57,54 L78,54 L61,66 L68,86 L50,73 L32,86 L39,66 L22,54 L43,54 Z" fill="#eef4ff"/>`,
  // Industrious — a cog.
  onyx: `<circle cx="50" cy="60" r="19" fill="#eef4ff"/><circle cx="50" cy="60" r="8" fill="#5a6a7c"/>
    <g fill="#eef4ff"><rect x="46" y="33" width="8" height="11"/><rect x="46" y="76" width="8" height="11"/><rect x="23" y="56" width="11" height="8"/><rect x="66" y="56" width="11" height="8"/></g>`,
};

const h2 = (c) => Math.max(0, Math.min(255, c | 0)).toString(16).padStart(2, '0');

// Returns an inline SVG string for a civ's crest. `colorHex` is a 0xRRGGBB number.
export function emblemSVG(id, colorHex, size = 40) {
  const r = (colorHex >> 16) & 255, g = (colorHex >> 8) & 255, b = colorHex & 255;
  const light = `#${h2(r)}${h2(g)}${h2(b)}`;
  const dark = `#${h2(r * 0.5)}${h2(g * 0.5)}${h2(b * 0.5)}`;
  const gid = `eg_${id || 'x'}`;
  return `<svg class="emblem" viewBox="0 0 100 120" width="${size}" height="${Math.round(size * 1.2)}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    <path d="M14,14 L86,14 L86,60 Q86,98 50,112 Q14,98 14,60 Z" fill="url(#${gid})" stroke="#0d1622" stroke-width="5" stroke-linejoin="round"/>
    ${SYMBOLS[id] || ''}
  </svg>`;
}
