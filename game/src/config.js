// Skyrunner: Archipelago Courier — every tuning number and colour in one place.
// The world is measured in feet: x is east, z is north along the flight path, y is altitude.
// The renderer projects it onto a fixed 1280x720 logical field and scales to the window,
// so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Knots to feet per second. */
export const KNOTS_TO_FPS = 1.68781;

/** The chase camera: how far behind and above the plane it sits, and its focal length. */
export const CAMERA = {
  behind: 26,
  above: 9,
  focal: 640,
  horizon: 0.44,
  drawDistance: 15000,
};

/** The Kestrel K-2 courier plane and how it flies. */
export const PLANE = {
  /** Knots at idle and at full throttle. */
  minSpeed: 38,
  maxSpeed: 238,
  /** Knots below which the wing stops flying and the plane sinks. */
  stallSpeed: 58,
  /** How fast the throttle spools toward its target, per second. */
  throttleRate: 0.45,
  /** How fast speed chases its target, per second. */
  speedRate: 0.55,
  /** Degrees of pitch the stick commands at full deflection. */
  maxPitch: 24,
  /** How fast pitch chases the stick, per second. */
  pitchRate: 1.6,
  /** Degrees of bank the stick commands at full deflection. */
  maxBank: 48,
  /** How fast bank chases the stick, per second. */
  bankRate: 2.6,
  /** Turn feel: multiplies the coordinated-turn rate. */
  turnGain: 1.7,
  /** Sink rate, ft/s, added per knot under the stall speed. */
  stallSink: 1.1,
  /** Hull damage per second inside a storm cloud. */
  stormDamage: 7,
};

/** Fuel: percent, drains with throttle; a full tank lasts about four minutes at cruise. */
export const FUEL = {
  start: 100,
  idleDrain: 0.1,
  fullDrain: 0.42,
  canBonus: 22,
};

/** The home runway: a flat strip the terrain flattens around, threshold at z = 0. */
export const RUNWAY = {
  halfWidth: 30,
  length: 2200,
  surfaceY: 3,
  /** Landing window: speed and sink rate a touchdown must stay inside. */
  maxLandingSpeed: 158,
  maxSink: 16,
  /** |x| inside this band at touchdown counts as a centreline landing. */
  centreline: 12,
};

/** Scoring: what each part of a sortie is worth. */
export const SCORE = {
  ring: 100,
  crate: 50,
  fuelCan: 10,
  landing: 200,
  perfectLanding: 150,
  fuelBonusPerPoint: 2,
  hullBonusPerPoint: 1,
  timeBonusPerSecond: 2,
};

/** Missions are defined in missions.js; these are the shared limits. */
export const MISSION = { max: 3 };

/** Where the best campaign score is kept between visits (this browser only). */
export const BEST_KEY = 'skyrunner-archipelago.best';

export const PALETTE = {
  backdrop: '#0b1526',
  skyTop: '#2f6fb4',
  skyMid: '#7db4dd',
  skyLow: '#cfe8f2',
  sun: '#fff3c4',
  sunCore: '#fffbe8',
  seaDeep: '#0e4d6e',
  seaShallow: '#1d7a9e',
  sand: '#d9c07a',
  grass: '#5da24a',
  forest: '#3d7a35',
  rock: '#8a7f72',
  peak: '#6e6258',
  runway: '#33373d',
  runwayLine: '#f2f2e8',
  ringNext: '#ffc233',
  ringDone: '#58d68d',
  ringGlow: 'rgba(255, 194, 51, 0.55)',
  crate: '#e8823a',
  crateGlow: 'rgba(232, 130, 58, 0.5)',
  cloud: 'rgba(255, 255, 255, 0.92)',
  storm: 'rgba(52, 58, 74, 0.92)',
  stormEdge: 'rgba(120, 128, 150, 0.7)',
  planeCream: '#f4ead2',
  planeTeal: '#1f7a6d',
  planeOrange: '#e8823a',
  planeGlass: '#9fd8ef',
  panel: 'rgba(10, 18, 32, 0.82)',
  panelEdge: '#3d5a76',
  text: '#eef4f8',
  muted: '#9fb4c4',
  gold: '#ffc233',
  green: '#58d68d',
  red: '#ff5a4e',
  amber: '#ffb02e',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
