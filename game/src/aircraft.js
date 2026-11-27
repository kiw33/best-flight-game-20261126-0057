// The Kestrel K-2 itself: throttle, pitch and bank into speed, heading and altitude, with
// fuel, hull, stall and landing rules. One fixed step at a time; nothing here draws.

import { FUEL, KNOTS_TO_FPS, PLANE, RUNWAY, SCORE } from './config.js';
import { groundHeight, onRunway, overWater } from './terrain.js';

export const EVENT_NONE = 0;
export const EVENT_RING = 1 << 0;
export const EVENT_CRATE = 1 << 1;
export const EVENT_FUEL = 1 << 2;
export const EVENT_STORM = 1 << 3;
export const EVENT_LANDED = 1 << 4;
export const EVENT_CRASHED = 1 << 5;
export const EVENT_TIMEOUT = 1 << 6;

/** How close the plane's centre must come to a ring's centre to count as flown through. */
const RING_CATCH = 0.82;
/** Pickup radius for crates and fuel cans, in feet. */
const PICKUP_RADIUS = 90;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function approach(value, target, rate, dt) {
  if (value < target) return Math.min(target, value + rate * dt);
  return Math.max(target, value - rate * dt);
}

export function createAircraft(terrain, spawn) {
  /** The terrain the plane is flying over; swapped when a new sortie starts. */
  let currentTerrain = terrain;
  const state = {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    heading: spawn.heading,
    pitch: 0,
    bank: 0,
    throttle: 0,
    throttleTarget: 0,
    speed: 0,
    verticalSpeed: 0,
    fuel: FUEL.start,
    hull: 100,
    score: 0,
    rings: 0,
    crates: 0,
    landed: false,
    crashed: false,
    crashReason: '',
    inStorm: false,
    stalled: false,
    timeLeft: 0,
    missionDone: false,
    perfectLanding: false,
    distance: 0,
  };

  /** Distance from the plane to a point, in feet. */
  function distanceTo(object) {
    const dx = state.x - object.x;
    const dy = state.y - object.y;
    const dz = state.z - object.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Point the plane at a new sortie's terrain (rings, clouds, crates all move). */
  function useTerrain(next) {
    currentTerrain = next;
  }

  /** Set the mission clock and clear the per-sortie counters. */
  function startMission(seconds) {
    state.timeLeft = seconds;
    state.rings = 0;
    state.crates = 0;
    state.landed = false;
    state.crashed = false;
    state.crashReason = '';
    state.missionDone = false;
    state.perfectLanding = false;
  }

  /** Refuel and repair between sorties; the score carries over. */
  function service() {
    state.fuel = FUEL.start;
    state.hull = 100;
    state.throttle = 0;
    state.throttleTarget = 0;
    state.speed = 0;
    state.pitch = 0;
    state.bank = 0;
  }

  /** Put the plane back on the threshold for the next sortie. */
  function respawn(spawnPoint) {
    state.x = spawnPoint.x;
    state.y = spawnPoint.y;
    state.z = spawnPoint.z;
    state.heading = spawnPoint.heading;
    service();
  }

  function crash(reason) {
    if (state.crashed) return;
    state.crashed = true;
    state.crashReason = reason;
  }

  function land(perfect) {
    state.landed = true;
    state.missionDone = true;
    state.perfectLanding = perfect;
    state.speed = 0;
    state.throttle = 0;
    state.throttleTarget = 0;
  }

  /**
   * One fixed step. `stick` is { throttle, pitch, bank } each in [-1, 1] (throttle is a
   * delta applied to the target), `wind` is the mission's gust in radians of heading noise.
   * Returns the events that happened this step.
   */
  function step(dt, stick, wind) {
    if (state.crashed || state.landed) return EVENT_NONE;
    let events = EVENT_NONE;

    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      return EVENT_TIMEOUT;
    }

    // Throttle spools toward its target; the target moves with the stick.
    state.throttleTarget = clamp(state.throttleTarget + stick.throttle * dt * 0.9, 0, 1);
    state.throttle = approach(state.throttle, state.throttleTarget, PLANE.throttleRate, dt);

    // Speed chases the throttle's target speed, helped downhill and hurt uphill.
    const targetSpeed = PLANE.minSpeed + state.throttle * (PLANE.maxSpeed - PLANE.minSpeed);
    const climbPenalty = Math.sin((state.pitch * Math.PI) / 180) * 55;
    state.speed = approach(state.speed, Math.max(0, targetSpeed - climbPenalty), PLANE.speedRate * 60, dt);
    const speedFps = state.speed * KNOTS_TO_FPS;

    // Pitch and bank chase the stick; a stalled wing will not hold the nose up.
    const targetPitch = stick.pitch * PLANE.maxPitch;
    state.pitch = approach(state.pitch, targetPitch, PLANE.pitchRate * PLANE.maxPitch, dt);
    const targetBank = stick.bank * PLANE.maxBank;
    state.bank = approach(state.bank, targetBank, PLANE.bankRate * PLANE.maxBank, dt);

    // Coordinated turn: bank rolls the lift vector and swings the heading.
    const bankRad = (state.bank * Math.PI) / 180;
    const turnRate = (32.2 * Math.tan(bankRad) / Math.max(speedFps, 40)) * PLANE.turnGain;
    state.heading += turnRate * dt + wind * dt;

    // Climb and sink: pitch lifts, a stalled wing barely lifts and sinks instead.
    const pitchRad = (state.pitch * Math.PI) / 180;
    state.stalled = state.speed < PLANE.stallSpeed && state.y > RUNWAY.surfaceY + 30;
    let climb = speedFps * Math.sin(pitchRad);
    if (state.stalled) climb *= 0.3;
    if (state.stalled) climb -= (PLANE.stallSpeed - state.speed) * PLANE.stallSink;
    state.verticalSpeed = climb;
    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    state.x += forwardX * speedFps * Math.cos(pitchRad) * dt;
    state.z += forwardZ * speedFps * Math.cos(pitchRad) * dt;
    state.y += climb * dt;
    state.distance += speedFps * dt;

    // Fuel burns with the throttle; an empty tank means gliding home or ditching.
    state.fuel -= (FUEL.idleDrain + state.throttle * FUEL.fullDrain) * dt;
    if (state.fuel <= 0) {
      state.fuel = 0;
      state.throttleTarget = 0;
      state.throttle = 0;
    }

    // Storm cells: hull damage and a shaking stick while inside one.
    state.inStorm = false;
    for (const cloud of currentTerrain.clouds) {
      if (!cloud.storm) continue;
      if (distanceTo(cloud) < cloud.size * 0.9) {
        state.inStorm = true;
        state.hull -= PLANE.stormDamage * dt;
        state.bank += (Math.sin(state.distance * 0.05) * 6 - state.bank * 0.02) * dt;
        if (state.hull <= 0) {
          state.hull = 0;
          crash('The storm tore the Kestrel apart.');
          return events | EVENT_CRASHED;
        }
        events |= EVENT_STORM;
        break;
      }
    }

    // Rings: flown through when the plane passes close to the centre while moving forward.
    for (const ring of currentTerrain.rings) {
      if (ring.passed) continue;
      const dz = state.z - ring.z;
      if (dz > 60 || dz < -140) continue;
      if (distanceTo(ring) < ring.radius * RING_CATCH + 40) {
        ring.passed = true;
        ring.lit = true;
        state.rings += 1;
        state.score += SCORE.ring;
        events |= EVENT_RING;
      }
    }

    // Crates and fuel cans: drift close and they are yours.
    for (const crate of currentTerrain.crates) {
      if (crate.taken) continue;
      if (distanceTo(crate) < PICKUP_RADIUS) {
        crate.taken = true;
        state.crates += 1;
        state.score += SCORE.crate;
        events |= EVENT_CRATE;
      }
    }
    for (const fuel of currentTerrain.fuels) {
      if (fuel.taken) continue;
      if (distanceTo(fuel) < PICKUP_RADIUS) {
        fuel.taken = true;
        state.fuel = Math.min(100, state.fuel + FUEL.canBonus);
        state.score += SCORE.fuelCan;
        events |= EVENT_FUEL;
      }
    }

    // The ground: a runway touchdown inside the window is a landing; anywhere else, a crash.
    const ground = groundHeight(state.x, state.z, currentTerrain.seed);
    if (state.y <= ground + 2) {
      if (onRunway(state.x, state.z) && state.speed <= RUNWAY.maxLandingSpeed && state.verticalSpeed > -RUNWAY.maxSink) {
        const perfect = Math.abs(state.x) <= RUNWAY.centreline && state.speed <= 120 && state.verticalSpeed > -6;
        state.y = RUNWAY.surfaceY + 2;
        land(perfect);
        return events | EVENT_LANDED;
      }
      if (overWater(state.x, state.z, currentTerrain.seed)) {
        state.y = 1;
        crash('Ditched in the sea — the Kestrel is gone.');
      } else if (state.speed > RUNWAY.maxLandingSpeed && onRunway(state.x, state.z)) {
        crash('Came in too hot — the runway ran out under the wheels.');
      } else {
        crash('Flew into the terrain.');
      }
      return events | EVENT_CRASHED;
    }

    return events;
  }

  /** Landing bonus for the debrief: fuel, hull and time left, plus the perfect bonus. */
  function landingBonus() {
    let bonus = SCORE.landing;
    bonus += Math.round(state.fuel) * SCORE.fuelBonusPerPoint;
    bonus += Math.round(state.hull) * SCORE.hullBonusPerPoint;
    bonus += Math.round(state.timeLeft) * SCORE.timeBonusPerSecond;
    if (state.perfectLanding) bonus += SCORE.perfectLanding;
    return bonus;
  }

  return { state, step, startMission, service, respawn, landingBonus, useTerrain };
}
