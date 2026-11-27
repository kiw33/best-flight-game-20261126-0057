// The screenshot scenes behind ?shot=start|play|rings|end. Each one plays the real rules
// forward from a fresh world, steered by a simple autopilot (bank toward the next ring,
// pitch toward its altitude, throttle to hold cruise, then a glide slope onto the runway),
// so the frame is what a real sortie looks like and the same seed always gives the same
// frame. The end scene flies a whole first sortie and lands it.

import { RUNWAY, STEP } from './config.js';
import { EVENT_CRASHED, EVENT_LANDED } from './aircraft.js';
import { goalComplete } from './missions.js';
import { SCREEN_MISSION, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const PLAY_SECONDS = 20;
const RINGS_SECONDS = 11;
const END_LIMIT_SECONDS = 420;

/** Cruise throttle the autopilot holds while it is still flying the course. */
const CRUISE_THROTTLE = 0.55;
/** Knots the autopilot aims for on final approach. */
const FINAL_SPEED = 105;

/** Wrap an angle to [-PI, PI]. */
function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * The autopilot's stick for one step: steer at the next ring (or the runway once the
 * course is done), hold cruise speed, and on final fly a shallow glide slope down to
 * the threshold with the throttle back.
 */
export function autopilotStick(aircraft, terrain, mission) {
  const state = aircraft.state;
  const next = terrain.nextRing();
  const courseDone = goalComplete(mission, aircraft);
  let targetX = 0;
  let targetY = 160;
  let targetZ = 0;
  let onFinal = false;

  if (!courseDone && next) {
    // Aim past the ring, not at it: a point 600 ft beyond it on the approach line,
    // so the plane flies a stable line through the ring instead of chasing it in a
    // tightening circle as it gets close.
    const dxr = next.x - state.x;
    const dzr = next.z - state.z;
    const dist = Math.max(1, Math.sqrt(dxr * dxr + dzr * dzr));
    targetX = next.x + (dxr / dist) * 600;
    targetY = next.y;
    targetZ = next.z + (dzr / dist) * 600;
  } else {
    // Home: first join the extended centreline — a point on it, ahead of the plane —
    // at a safe altitude, and only once the wings are over the strip, descend.
    targetX = 0;
    targetZ = state.z - 1500;
    if (Math.abs(state.x) < 120 && state.z < 5000) {
      onFinal = true;
      // A glide slope that meets the runway at z = 800 and settles a foot below the
      // touchdown line, so the wheels actually meet the strip instead of floating on it.
      targetY = RUNWAY.surfaceY + 1 + Math.max(0, state.z - 800) * 0.08;
      // Aim past the threshold, down the whole strip, so the target never ends up
      // behind the plane while it is still over the runway.
      targetZ = -400;
    } else {
      targetY = 650;
    }
  }

  const dx = targetX - state.x;
  const dz = targetZ - state.z;
  const wantedHeading = Math.atan2(dx, dz);
  const headingError = wrapAngle(wantedHeading - state.heading);
  let bank = Math.max(-1, Math.min(1, headingError * 3));
  const altitudeError = targetY - state.y;
  // On final the pitch gain is tighter, so the plane tracks the glide slope instead
  // of floating above it all the way down the strip.
  const pitchDivisor = onFinal ? 25 : 60;
  let pitch = Math.max(-1, Math.min(1, altitudeError / pitchDivisor));
  // Close in, ease off the bank: a gentle wing holds the line better than a hard one.
  const distanceToTarget = Math.sqrt(dx * dx + dz * dz);
  if (distanceToTarget < 1500) bank = Math.max(-0.6, Math.min(0.6, bank));
  // Gentle while slow and low: no hard bank or steep climb before the wing is flying.
  if (state.speed < 100) {
    pitch = Math.max(-0.3, Math.min(0.45, pitch));
    bank = Math.max(-0.35, Math.min(0.35, bank));
  }

  // Throttle: cruise on course, ease back on final so the speed bleeds to landing speed.
  let throttleTarget = CRUISE_THROTTLE;
  if (onFinal) {
    throttleTarget = state.speed > FINAL_SPEED + 12 ? 0.12 : state.speed < FINAL_SPEED - 8 ? 0.45 : 0.28;
  } else if (state.speed > 175) {
    throttleTarget = 0.45;
  }
  const throttleDelta = (throttleTarget - state.throttleTarget) * 2;
  return { throttle: Math.max(-1, Math.min(1, throttleDelta)), pitch, bank };
}

/** Run the world forward for `seconds`, steered by the autopilot. Returns the events seen. */
function flyFor(aircraft, terrain, mission, seconds) {
  let events = 0;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const stick = autopilotStick(aircraft, terrain, mission);
    events |= aircraft.step(STEP, stick, mission.wind);
    if (aircraft.state.crashed || aircraft.state.landed) break;
  }
  return events;
}

/**
 * Set the world to the named scene (start, play, rings or end; any other name is start)
 * and return the screen to draw over it and the debrief lines for that screen.
 */
export function stageShot(name, aircraft, terrain, mission, spawn) {
  aircraft.respawn(spawn);
  aircraft.startMission(mission.timeLimit);
  if (name !== 'play' && name !== 'rings' && name !== 'end') {
    // Title: the world as it is at the threshold — the plane stays parked, the runway
    // and the rings ahead of it, so the panel sits over the airfield, not a taxi roll.
    return { screen: SCREEN_TITLE, debrief: [] };
  }
  if (name === 'play') {
    flyFor(aircraft, terrain, mission, PLAY_SECONDS);
    return { screen: aircraft.state.crashed ? SCREEN_OVER : SCREEN_PLAY, debrief: [] };
  }
  if (name === 'rings') {
    flyFor(aircraft, terrain, mission, RINGS_SECONDS);
    return { screen: aircraft.state.crashed ? SCREEN_OVER : SCREEN_PLAY, debrief: [] };
  }
  // End: fly the whole first sortie until it lands or comes down.
  const events = flyFor(aircraft, terrain, mission, END_LIMIT_SECONDS);
  if (events & EVENT_LANDED || aircraft.state.landed) {
    const bonus = aircraft.landingBonus();
    aircraft.state.score += bonus;
    return {
      screen: SCREEN_MISSION,
      debrief: [
        `${mission.name} complete — the Kestrel is down safe.`,
        `Rings ${aircraft.state.rings} · Fuel ${Math.round(aircraft.state.fuel)}% · Hull ${Math.round(aircraft.state.hull)}%`,
        `Landing bonus +${bonus}${aircraft.state.perfectLanding ? ' — centreline, textbook!' : ''}`,
        `Score ${aircraft.state.score}`,
      ],
    };
  }
  void EVENT_CRASHED;
  return { screen: SCREEN_OVER, debrief: [] };
}
