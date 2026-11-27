// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The campaign moves between title, play, paused, mission debrief, victory and
// game over. ?seed=N fixes the archipelago; ?shot=start|play|rings|end (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.

import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createTerrain, spawnState } from './terrain.js';
import { createAircraft, EVENT_CRASHED, EVENT_CRATE, EVENT_FUEL, EVENT_LANDED, EVENT_RING, EVENT_TIMEOUT } from './aircraft.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_MISSION, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';
import { MISSION_LIST, debriefLines, goalLine, victoryLines } from './missions.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;
/** Seconds the transient score banner stays on screen. */
const BANNER_SECONDS = 2.2;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();
const renderer = createRenderer(canvas);
const spawn = spawnState();
const terrain = createTerrain(seed, 1);
const aircraft = createAircraft(terrain, spawn);

/** Play-test hook: the live plane, mission and screen, for automated checks. */
window.__skyrunner = {
  get state() {
    return aircraft.state;
  },
  get mission() {
    return MISSION_LIST[0];
  },
  get terrain() {
    return terrain;
  },
};

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const mission = MISSION_LIST[0];
  const scene = stageShot(name, aircraft, terrain, mission, spawn);
  const frame = {
    aircraft: aircraft.state,
    terrain,
    mission,
    goalLine: goalLine(mission, aircraft),
    screen: scene.screen,
    debrief: scene.debrief,
    best: Math.max(readBest(), aircraft.state.score),
    banner: '',
    bannerAge: 99,
    time: 0,
    lastMission: false,
  };
  let painted = 0;
  function paint() {
    renderer.draw(frame);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let missionIndex = 0;
  let mission = MISSION_LIST[missionIndex];
  let terrainForMission = terrain;
  let debrief = [];
  let lastMission = false;
  let banner = '';
  let bannerStartedAt = -99;
  let time = 0;
  let accumulator = 0;
  let last = performance.now();
  let muted = false;

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function showBanner(text) {
    banner = text;
    bannerStartedAt = time;
  }

  function startCampaign() {
    missionIndex = 0;
    mission = MISSION_LIST[missionIndex];
    terrainForMission = createTerrain(seed, mission.number);
    aircraft.useTerrain(terrainForMission);
    aircraft.respawn(spawn);
    aircraft.startMission(mission.timeLimit);
    screen = SCREEN_PLAY;
    announce(`Flying ${mission.name}. ${mission.brief}`);
  }

  function nextMission() {
    missionIndex += 1;
    mission = MISSION_LIST[missionIndex];
    terrainForMission = createTerrain(seed, mission.number);
    aircraft.useTerrain(terrainForMission);
    aircraft.respawn(spawn);
    aircraft.service();
    aircraft.startMission(mission.timeLimit);
    screen = SCREEN_PLAY;
    announce(`Flying ${mission.name}. ${mission.brief}`);
  }

  function finishMission() {
    const bonus = aircraft.landingBonus();
    aircraft.state.score += bonus;
    debrief = debriefLines(mission, aircraft, bonus);
    lastMission = missionIndex === MISSION_LIST.length - 1;
    screen = SCREEN_MISSION;
    audio.landing();
    announce(`${mission.name} complete. Score ${aircraft.state.score}.`);
  }

  function finishCampaign() {
    debrief = victoryLines(aircraft);
    screen = SCREEN_VICTORY;
    if (aircraft.state.score > best) {
      best = aircraft.state.score;
      saveBest(best);
    }
    announce(`Campaign complete. Final score ${aircraft.state.score}.`);
  }

  function endGame(reason) {
    screen = SCREEN_OVER;
    if (aircraft.state.score > best) {
      best = aircraft.state.score;
      saveBest(best);
    }
    audio.crash();
    announce(`${reason} Score ${aircraft.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) {
      audio.start();
      startCampaign();
    } else if (actions & ACTION_CONFIRM && screen === SCREEN_MISSION) {
      audio.start();
      if (lastMission) finishCampaign();
      else nextMission();
    } else if (actions & ACTION_CONFIRM && (screen === SCREEN_OVER || screen === SCREEN_VICTORY)) {
      audio.start();
      startCampaign();
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    const events = aircraft.step(STEP, input.stick(), mission.wind);
    if (events & EVENT_RING) {
      showBanner(`RING +100`);
      audio.ring();
      announce(`Ring. Score ${aircraft.state.score}.`);
    }
    if (events & EVENT_CRATE) {
      showBanner('CRATE +50');
      audio.crate();
    }
    if (events & EVENT_FUEL) {
      showBanner('FUEL +22');
      audio.fuel();
    }
    if (events & EVENT_LANDED) {
      finishMission();
    } else if (events & EVENT_CRASHED) {
      endGame(aircraft.state.crashReason);
    } else if (events & EVENT_TIMEOUT) {
      aircraft.state.crashReason = 'Out of time — the sortie window closed.';
      endGame(aircraft.state.crashReason);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        time += STEP;
        step();
        accumulator -= STEP;
        if (screen !== SCREEN_PLAY) break;
      }
    } else {
      accumulator = 0;
      time += 1 / 60;
    }
    audio.update(aircraft.state.throttle, aircraft.state.speed, screen === SCREEN_PLAY);
    renderer.draw({
      aircraft: aircraft.state,
      terrain: terrainForMission,
      mission,
      goalLine: goalLine(mission, aircraft),
      screen,
      debrief,
      best,
      banner,
      bannerAge: time - bannerStartedAt,
      time,
      lastMission,
    });
  }

  // Leaving the tab pauses a running game rather than letting the fuel burn unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  aircraft.startMission(mission.timeLimit);
  announce('Skyrunner: Archipelago Courier. Press Enter or click to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
