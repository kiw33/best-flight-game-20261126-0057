// Seeded randomness for the archipelago: one small generator and a smooth 2D value-noise
// field, so the same seed always builds the same islands, rings and clouds. Nothing here
// reads Math.random after construction; the world is a pure function of its seed.

/** mulberry32: a tiny deterministic generator with a long, even period. */
export function createRandom(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable integer hash of two grid coordinates, in [0, 1). */
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Smooth 2D value noise: bilinear interpolation of hashed lattice values, so the terrain
 * rolls instead of stepping. `cell` is the size of one lattice square in feet.
 */
export function valueNoise(x, z, seed, cell) {
  const gx = x / cell;
  const gz = z / cell;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = smooth(gx - ix);
  const fz = smooth(gz - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** A number in [min, max) from a generator. */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** Pick one entry of an array from a generator. */
export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}
