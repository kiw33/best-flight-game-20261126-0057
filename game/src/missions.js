// The campaign: three sorties over the archipelago, each with its own goal, weather and
// clock. A sortie is complete when the plane is back on the runway; the score carries
// across all three, and the campaign ends in victory or in a crash.

import { SCORE } from './config.js';

export const MISSION_LIST = [
  {
    number: 1,
    name: 'First Light',
    brief: 'Fly the dawn mail run: thread all 6 sky rings, then bring her home to the runway.',
    goal: 'rings',
    goalText: 'Rings 0/6 — then land on the runway',
    timeLimit: 300,
    wind: 0,
  },
  {
    number: 2,
    name: 'Cargo Run',
    brief: 'Eight crates are floating over the islands and the storms are building. Collect them all, then land.',
    goal: 'crates',
    goalText: 'Crates 0/8 — then land on the runway',
    timeLimit: 360,
    wind: 0.004,
  },
  {
    number: 3,
    name: 'Storm Gauntlet',
    brief: 'The last run: 8 rings through the storm line, gusting wind, a short clock. Land it clean.',
    goal: 'rings',
    goalText: 'Rings 0/8 — then land on the runway',
    timeLimit: 300,
    wind: 0.012,
  },
];

/** Total rings in a mission, for the HUD counter. */
export function missionRings(mission) {
  return mission === 1 ? 6 : 8;
}

/** Total crates in a mission, for the HUD counter. */
export function missionCrates(mission) {
  return mission === 2 ? 8 : 0;
}

/**
 * Is the sortie's flying goal done — every ring flown or every crate collected — so the
 * only thing left is the landing?
 */
export function goalComplete(mission, aircraft) {
  if (mission.goal === 'rings') return aircraft.state.rings >= missionRings(mission.number);
  return aircraft.state.crates >= missionCrates(mission.number);
}

/** The goal line the HUD shows, with live counts filled in. */
export function goalLine(mission, aircraft) {
  if (mission.goal === 'rings') {
    return `Rings ${aircraft.state.rings}/${missionRings(mission.number)} — then land on the runway`;
  }
  return `Crates ${aircraft.state.crates}/${missionCrates(mission.number)} — then land on the runway`;
}

/** The debrief lines for a finished sortie, with the landing bonus applied. */
export function debriefLines(mission, aircraft, bonus) {
  const lines = [
    `${mission.name} complete — the Kestrel is down safe.`,
    `Rings ${aircraft.state.rings} · Crates ${aircraft.state.crates} · Fuel ${Math.round(aircraft.state.fuel)}% · Hull ${Math.round(aircraft.state.hull)}%`,
    `Landing bonus +${bonus}${aircraft.state.perfectLanding ? ' — centreline, textbook!' : ''}`,
    `Score ${aircraft.state.score + bonus}`,
  ];
  return lines;
}

/** The campaign's victory lines once the third sortie is home. */
export function victoryLines(aircraft) {
  return [
    'All three sorties home. The archipelago mail flies again.',
    `Final score ${aircraft.state.score} · ${Math.round(aircraft.state.distance / 5280)} miles flown`,
    'Skyrunner — Archipelago Courier',
  ];
}

/** Score for a ring or crate, for the floating callouts. */
export function pointsFor(kind) {
  if (kind === 'ring') return SCORE.ring;
  if (kind === 'crate') return SCORE.crate;
  return SCORE.fuelCan;
}
