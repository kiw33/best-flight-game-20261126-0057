// The archipelago itself: a heightfield of sea and islands, the home runway flattened into
// it, and the mission's rings, crates, fuel cans, clouds and airfield buildings. Every
// placement is a function of the seed and the mission number, so a seed replays identically.

import { RUNWAY } from './config.js';
import { createRandom, range, valueNoise } from './random.js';

export const KIND_RING = 'ring';
export const KIND_CRATE = 'crate';
export const KIND_FUEL = 'fuel';
export const KIND_CLOUD = 'cloud';
export const KIND_STORM = 'storm';

/** Feet of sea the world stretches either side of the flight path. */
const WORLD_HALF = 22000;
/** How far ahead of the plane objects are laid out. */
const WORLD_AHEAD = 26000;

/**
 * Raw land height in feet at (x, z): layered value noise, sea level at 0, peaks near 420.
 * The home island rises around the runway; the far islands are taller and wilder.
 */
function rawHeight(x, z, seed) {
  const rolling = valueNoise(x, z, seed, 2600);
  const detail = valueNoise(x + 900, z - 400, seed + 7, 900);
  const ridges = valueNoise(x - 500, z + 700, seed + 13, 5200);
  let height = (rolling - 0.42) * 520 + (detail - 0.5) * 160 + (ridges - 0.5) * 300;
  // The home island: a broad, gentle rise centred on the runway threshold.
  const homeDx = x / 5200;
  const homeDz = (z - 1100) / 5200;
  const home = Math.max(0, 1 - (homeDx * homeDx + homeDz * homeDz));
  height = height * (1 - home * 0.55) + home * 95;
  return height;
}

/**
 * Ground height with the runway corridor flattened: inside the strip the ground is the
 * runway surface, and it blends back to the raw terrain over a wide shoulder, so the
 * strip reads as a built runway, not a cliff. The runway also sits in a broad, flat
 * valley for the first stretch north, so a takeoff or a landing never meets a hillside.
 */
export function groundHeight(x, z, seed) {
  let raw = rawHeight(x, z, seed);
  if (z > -600 && z < 4200) {
    const across = Math.abs(x) / 1400;
    if (across < 1) {
      const blend = across * across * (3 - 2 * across);
      const floor = 8;
      raw = floor + Math.max(0, raw - floor) * blend;
    }
  }
  if (z < -400 || z > RUNWAY.length + 400) return raw;
  const across = Math.abs(x) / (RUNWAY.halfWidth + 110);
  if (across >= 1) return raw;
  const blend = across * across * (3 - 2 * across);
  return RUNWAY.surfaceY + (raw - RUNWAY.surfaceY) * blend;
}

/** True when (x, z) is on the runway strip itself. */
export function onRunway(x, z) {
  return Math.abs(x) <= RUNWAY.halfWidth && z >= 0 && z <= RUNWAY.length;
}

/** True when (x, z) is over open sea: ground at or below the waterline. */
export function overWater(x, z, seed) {
  return groundHeight(x, z, seed) <= 0.5;
}

/** A ring's centre, radius and whether the plane has flown through it yet. */
function makeRing(x, y, z, radius) {
  return { kind: KIND_RING, x, y, z, radius, passed: false, lit: false };
}

function makeCrate(x, y, z) {
  return { kind: KIND_CRATE, x, y, z, taken: false, bob: 0 };
}

function makeFuel(x, y, z) {
  return { kind: KIND_FUEL, x, y, z, taken: false, bob: 0 };
}

function makeCloud(x, y, z, size, storm) {
  return { kind: storm ? KIND_STORM : KIND_CLOUD, x, y, z, size, storm };
}

/**
 * Lay out one mission's world. Rings follow a gentle S-curve ahead of the runway so the
 * pilot is always turning a little; crates and fuel sit near the path; clouds drift above
 * the sea, and the later missions grow storm cells the pilot must thread around.
 */
export function createTerrain(seed, mission) {
  const random = createRandom(seed * 31 + mission * 101);
  const rings = [];
  const crates = [];
  const fuels = [];
  const clouds = [];

  const ringCount = mission === 1 ? 6 : 8;
  let rx = 0;
  let rz = 2400;
  let ry = 170;
  for (let i = 0; i < ringCount; i += 1) {
    rx += range(random, -950, 950);
    rx = Math.max(-2600, Math.min(2600, rx));
    ry = range(random, 130, 260);
    rings.push(makeRing(rx, ry, rz, 34));
    rz += range(random, 2400, 3000);
  }

  if (mission === 2) {
    // Cargo run: crates strung along the ring path, two rings as guideposts.
    for (let i = 0; i < 8; i += 1) {
      const t = (i + 0.5) / 8;
      const near = rings[Math.min(rings.length - 1, Math.floor(t * rings.length))];
      crates.push(makeCrate(
        near.x + range(random, -260, 260),
        near.y + range(random, -50, 70),
        near.z - 900 + i * 300 + range(random, -120, 120),
      ));
    }
    fuels.push(makeFuel(300, 150, 5200), makeFuel(-420, 190, 11200));
  } else if (mission === 3) {
    fuels.push(makeFuel(180, 160, 6400));
  } else {
    fuels.push(makeFuel(-260, 150, 4800));
  }

  const cloudCount = mission === 1 ? 16 : mission === 2 ? 22 : 26;
  for (let i = 0; i < cloudCount; i += 1) {
    const storm = mission > 1 && random() < (mission === 2 ? 0.3 : 0.45);
    clouds.push(makeCloud(
      range(random, -WORLD_HALF, WORLD_HALF),
      range(random, 260, 520),
      range(random, -2000, WORLD_AHEAD),
      range(random, 260, 620),
      storm,
    ));
  }

  // A few storm cells parked near the ring path in the later missions, as real hazards.
  if (mission > 1) {
    for (let i = 0; i < rings.length; i += 2) {
      clouds.push(makeCloud(
        rings[i].x + range(random, -700, 700),
        rings[i].y + range(random, 40, 160),
        rings[i].z + range(random, -500, 500),
        range(random, 300, 480),
        true,
      ));
    }
  }

  // Airfield buildings beside the runway, set well back from the strip so they read as
  // buildings, not walls: a hangar, a control tower and a windsock mast.
  const buildings = [
    { x: 260, z: 420, width: 150, depth: 110, height: 64, top: '#c65a3a', side: '#8f3f2a' },
    { x: -280, z: 260, width: 60, depth: 60, height: 110, top: '#e8e2d2', side: '#b9b2a0' },
    { x: 300, z: 980, width: 90, depth: 70, height: 42, top: '#3f6d8e', side: '#2c4f68' },
  ];

  return {
    seed,
    mission,
    rings,
    crates,
    fuels,
    clouds,
    buildings,
    /** The next ring the pilot has to fly through, or null when the course is done. */
    nextRing() {
      for (let i = 0; i < rings.length; i += 1) {
        if (!rings[i].passed) return rings[i];
      }
      return null;
    },
    /** Crates and fuel cans still floating. */
    remainingPickups() {
      let count = 0;
      for (const crate of crates) if (!crate.taken) count += 1;
      for (const fuel of fuels) if (!fuel.taken) count += 1;
      return count;
    },
  };
}

/** The plane's spawn: parked on the runway threshold, facing north, throttle idle. */
export function spawnState() {
  return { x: 0, y: RUNWAY.surfaceY + 4, z: 60, heading: 0, pitch: 0, bank: 0 };
}
