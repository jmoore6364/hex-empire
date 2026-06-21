// hex.js — pointy-top axial hex-grid math. Pure logic, NO rendering deps,
// so it can be unit-tested in plain Node. See test/logic.test.mjs.

export const HEX_SIZE = 1; // circumradius: distance from hex center to a vertex.

// Axial neighbor directions for a pointy-top grid, in clockwise order.
export const DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function key(q, r) { return `${q},${r}`; }
export function parseKey(k) { const [q, r] = k.split(',').map(Number); return { q, r }; }

export function neighbors(q, r) {
  return DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

// Hex distance via cube coordinates.
export function distance(a, b) {
  return (Math.abs(a.q - b.q)
    + Math.abs(a.q + a.r - b.q - b.r)
    + Math.abs(a.r - b.r)) / 2;
}

// Axial (q,r) -> world (x,z) on the ground plane. Pointy-top layout.
export function hexToWorld(q, r, size = HEX_SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    z: size * (3 / 2) * r,
  };
}

// World (x,z) -> nearest axial hex. Inverse of hexToWorld + cube rounding.
export function worldToHex(x, z, size = HEX_SIZE) {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * z) / size;
  const r = (2 / 3 * z) / size;
  return axialRound(q, r);
}

// Round fractional axial coords to the nearest valid hex (via cube rounding).
export function axialRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// Every hex within `radius` of the origin, forming a big hexagonal map.
export function hexMap(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) out.push({ q, r });
  }
  return out;
}

// All hexes within `range` steps of (q,r), inclusive of the center.
export function hexesInRange(q, r, range) {
  const out = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      out.push({ q: q + dq, r: r + dr });
    }
  }
  return out;
}
