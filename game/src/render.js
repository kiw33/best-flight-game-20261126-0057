// Drawing only: the world state and the current screen in, pixels out. A chase view: the
// camera sits behind and above the Kestrel, the archipelago is projected slice by slice
// onto the 1280x720 field, and the HUD paints altitude, speed, heading, fuel and hull as
// lit instruments. Nothing here steps the simulation.

import { CAMERA, FIELD, FONT, PALETTE, RUNWAY } from './config.js';
import { groundHeight, onRunway } from './terrain.js';
import { valueNoise } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_MISSION = 'mission';
export const SCREEN_VICTORY = 'victory';
export const SCREEN_OVER = 'over';

/** Terrain slices: depth steps grow with distance, so near ground stays crisp. */
const SLICE_FIRST = 8;
const SLICE_GROWTH = 1.13;
const SLICE_MAX = 15000;
/** Half-width of the ground sampled either side of the flight path, in feet. */
const GROUND_HALF = 900;
const GROUND_STEP = 60;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

const SEA_DEEP = hexToRgb(PALETTE.seaDeep);
const SEA_SHALLOW = hexToRgb(PALETTE.seaShallow);

/** Ground colour by height, with a little patchwork variation so fields read as fields. */
function groundColor(height, x, z, seed) {
  if (height <= 0) {
    const depth = clamp(-height / 70, 0, 1);
    return mixRgb(SEA_SHALLOW, SEA_DEEP, depth);
  }
  const patch = valueNoise(x, z, seed + 99, 700);
  const vary = patch > 0.62 ? 1 : 0;
  if (height < 4) return vary ? '#c9ad68' : PALETTE.sand;
  if (height < 45) return vary ? '#549a44' : PALETTE.grass;
  if (height < 78) return vary ? '#35702f' : PALETTE.forest;
  if (height < 120) return vary ? '#7d7268' : PALETTE.rock;
  return PALETTE.peak;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `bold ${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline ?? 'alphabetic';
    context.fillText(value, x, y);
  }

  function plainText(value, x, y, size, color, align, baseline) {
    if (!fonts.has(-size)) fonts.set(-size, `${size}px ${FONT}`);
    context.font = fonts.get(-size);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline ?? 'alphabetic';
    context.fillText(value, x, y);
  }

  /** Project a world point into field pixels; null when behind the camera. */
  function makeProjector(cam) {
    const sinH = Math.sin(cam.heading);
    const cosH = Math.cos(cam.heading);
    const horizonY = FIELD.height * CAMERA.horizon - cam.pitch * 1.6;
    return function project(px, py, pz) {
      const dx = px - cam.x;
      const dy = py - cam.y;
      const dz = pz - cam.z;
      const depth = dx * sinH + dz * cosH;
      if (depth < 6) return null;
      const lateral = dx * cosH - dz * sinH;
      const scale = CAMERA.focal / depth;
      return {
        x: FIELD.width / 2 + lateral * scale,
        y: horizonY - dy * scale,
        scale,
        depth,
      };
    };
  }

  function drawSky(heading, time) {
    const horizonY = FIELD.height * CAMERA.horizon;
    const gradient = context.createLinearGradient(0, 0, 0, horizonY + 40);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.55, PALETTE.skyMid);
    gradient.addColorStop(1, PALETTE.skyLow);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, horizonY + 40);
    // The sun hangs up-sun of the flight path; it drifts a little with the heading.
    const sunX = 1020 - ((heading % (Math.PI * 2)) * 60);
    const sunY = 92;
    const glow = context.createRadialGradient(sunX, sunY, 8, sunX, sunY, 120);
    glow.addColorStop(0, PALETTE.sunCore);
    glow.addColorStop(0.25, PALETTE.sun);
    glow.addColorStop(1, 'rgba(255, 243, 196, 0)');
    context.fillStyle = glow;
    context.fillRect(sunX - 120, sunY - 120, 240, 240);
    context.fillStyle = PALETTE.sunCore;
    context.beginPath();
    context.arc(sunX, sunY, 26, 0, Math.PI * 2);
    context.fill();
    // A few high clouds, drifting slowly across the sky.
    context.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let i = 0; i < 5; i += 1) {
      const cx = ((i * 263 + time * 6) % 1500) - 110;
      const cy = 60 + i * 26;
      context.beginPath();
      context.ellipse(cx, cy, 70 + i * 8, 14, 0, 0, Math.PI * 2);
      context.ellipse(cx + 44, cy + 6, 46, 11, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  /** The ground, slice by slice from far to near, each slice a row of coloured quads. */
  function drawTerrain(cam, project, seed) {
    const sinH = Math.sin(cam.heading);
    const cosH = Math.cos(cam.heading);
    let depth = SLICE_FIRST;
    let prev = null;
    while (depth < SLICE_MAX) {
      const step = Math.max(46, depth * (SLICE_GROWTH - 1));
      const centreX = cam.x + sinH * depth;
      const centreZ = cam.z + cosH * depth;
      const samples = [];
      for (let t = -GROUND_HALF; t <= GROUND_HALF; t += GROUND_STEP) {
        const wx = centreX + cosH * t;
        const wz = centreZ - sinH * t;
        const h = groundHeight(wx, wz, seed);
        const p = project(wx, Math.max(h, 0), wz);
        samples.push({ p, h, x: wx, z: wz });
      }
      if (prev) {
        for (let i = 0; i + 1 < samples.length; i += 1) {
          const a = prev[i];
          const b = prev[i + 1];
          const c = samples[i + 1];
          const d = samples[i];
          if (!a.p || !b.p || !c.p || !d.p) continue;
          const midH = (a.h + b.h + c.h + d.h) / 4;
          const midX = (a.x + b.x + c.x + d.x) / 4;
          const midZ = (a.z + b.z + c.z + d.z) / 4;
          context.fillStyle = groundColor(midH, midX, midZ, seed);
          context.beginPath();
          context.moveTo(a.p.x, a.p.y);
          context.lineTo(b.p.x, b.p.y);
          context.lineTo(c.p.x, c.p.y);
          context.lineTo(d.p.x, d.p.y);
          context.closePath();
          context.fill();
        }
      }
      prev = samples;
      depth += step;
    }
  }

  /** The home runway: asphalt strip, centreline dashes, threshold bars, edge lights. */
  function drawRunway(cam, project) {
    const step = 110;
    for (let z = 0; z < RUNWAY.length; z += step) {
      const z2 = Math.min(RUNWAY.length, z + step);
      const a = project(-RUNWAY.halfWidth, RUNWAY.surfaceY, z);
      const b = project(RUNWAY.halfWidth, RUNWAY.surfaceY, z);
      const c = project(RUNWAY.halfWidth, RUNWAY.surfaceY, z2);
      const d = project(-RUNWAY.halfWidth, RUNWAY.surfaceY, z2);
      if (!a || !b || !c || !d) continue;
      context.fillStyle = PALETTE.runway;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.lineTo(d.x, d.y);
      context.closePath();
      context.fill();
      // Centreline dash every other strip.
      if (Math.floor(z / step) % 2 === 0) {
        const m1 = project(-1.6, RUNWAY.surfaceY + 0.4, z + 12);
        const m2 = project(1.6, RUNWAY.surfaceY + 0.4, z + 12);
        const m3 = project(1.6, RUNWAY.surfaceY + 0.4, z + 70);
        const m4 = project(-1.6, RUNWAY.surfaceY + 0.4, z + 70);
        if (m1 && m2 && m3 && m4) {
          context.fillStyle = PALETTE.runwayLine;
          context.beginPath();
          context.moveTo(m1.x, m1.y);
          context.lineTo(m2.x, m2.y);
          context.lineTo(m3.x, m3.y);
          context.lineTo(m4.x, m4.y);
          context.closePath();
          context.fill();
        }
      }
      // Edge lights: small warm dots down both sides.
      for (const side of [-1, 1]) {
        const light = project(side * RUNWAY.halfWidth, RUNWAY.surfaceY + 2, z);
        if (light && light.depth < 4000) {
          context.fillStyle = '#ffd98a';
          context.beginPath();
          context.arc(light.x, light.y, Math.max(1.5, 90 / light.depth), 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    // Threshold bars at the runway's start.
    for (let i = -3; i <= 3; i += 1) {
      const a = project(i * 4 - 1.6, RUNWAY.surfaceY + 0.4, 8);
      const b = project(i * 4 + 1.6, RUNWAY.surfaceY + 0.4, 8);
      const c = project(i * 4 + 1.6, RUNWAY.surfaceY + 0.4, 44);
      const d = project(i * 4 - 1.6, RUNWAY.surfaceY + 0.4, 44);
      if (a && b && c && d) {
        context.fillStyle = PALETTE.runwayLine;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.lineTo(c.x, c.y);
        context.lineTo(d.x, d.y);
        context.closePath();
        context.fill();
      }
    }
  }

  /** One airfield building as a front face and a roof, projected from its footprint. */
  function drawBuilding(building, project) {
    const { x, z, width, depth, height, top, side } = building;
    const hw = width / 2;
    const front = [
      project(x - hw, 0, z + depth / 2),
      project(x + hw, 0, z + depth / 2),
      project(x + hw, height, z + depth / 2),
      project(x - hw, height, z + depth / 2),
    ];
    if (front.every(Boolean)) {
      context.fillStyle = side;
      context.beginPath();
      front.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
      context.closePath();
      context.fill();
    }
    const roof = [
      project(x - hw, height, z + depth / 2),
      project(x + hw, height, z + depth / 2),
      project(x + hw, height, z - depth / 2),
      project(x - hw, height, z - depth / 2),
    ];
    if (roof.every(Boolean)) {
      context.fillStyle = top;
      context.beginPath();
      roof.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
      context.closePath();
      context.fill();
    }
  }

  /** A glowing ring, face-on to the camera, with a light beam over the next one. */
  function drawRing(ring, project, isNext, time) {
    const centre = project(ring.x, ring.y, ring.z);
    if (!centre) return;
    const radius = ring.radius * centre.scale;
    if (radius < 3) return;
    const pulse = isNext ? 1 + Math.sin(time * 5) * 0.12 : 1;
    const colour = ring.passed ? PALETTE.ringDone : PALETTE.ringNext;
    if (isNext) {
      // A beam of light over the next ring, so the pilot can find it from miles out.
      const top = project(ring.x, ring.y + 340, ring.z);
      if (top) {
        const gradient = context.createLinearGradient(centre.x, centre.y, top.x, top.y);
        gradient.addColorStop(0, PALETTE.ringGlow);
        gradient.addColorStop(1, 'rgba(255, 194, 51, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(centre.x - radius * 0.28, centre.y);
        context.lineTo(centre.x + radius * 0.28, centre.y);
        context.lineTo(top.x + 4, top.y);
        context.lineTo(top.x - 4, top.y);
        context.closePath();
        context.fill();
      }
    }
    context.save();
    context.shadowColor = colour;
    context.shadowBlur = isNext ? 26 : 10;
    context.strokeStyle = colour;
    context.lineWidth = Math.max(3, radius * 0.09 * pulse);
    context.beginPath();
    context.arc(centre.x, centre.y, radius * pulse, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.lineWidth = Math.max(1.5, radius * 0.02);
    context.beginPath();
    context.arc(centre.x, centre.y, radius * 0.82 * pulse, 0, Math.PI * 2);
    context.stroke();
  }

  /** A floating crate or fuel can, bobbing gently, with a soft glow when it is near. */
  function drawPickup(pickup, project, time, isFuel) {
    const bob = Math.sin(time * 2 + pickup.bob) * 7;
    const centre = project(pickup.x, pickup.y + bob, pickup.z);
    if (!centre) return;
    const size = Math.max(6, 34 * centre.scale);
    if (size < 4) return;
    context.save();
    context.shadowColor = isFuel ? '#58d8c8' : PALETTE.crateGlow;
    context.shadowBlur = 18;
    context.fillStyle = isFuel ? '#2fae9e' : PALETTE.crate;
    context.fillRect(centre.x - size / 2, centre.y - size / 2, size, size);
    context.restore();
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.lineWidth = 2;
    context.strokeRect(centre.x - size / 2, centre.y - size / 2, size, size);
    context.beginPath();
    context.moveTo(centre.x - size / 2, centre.y);
    context.lineTo(centre.x + size / 2, centre.y);
    context.moveTo(centre.x, centre.y - size / 2);
    context.lineTo(centre.x, centre.y + size / 2);
    context.stroke();
    text(isFuel ? 'F' : '+', centre.x, centre.y + size * 0.32, Math.max(10, size * 0.55), '#ffffff', 'center', 'alphabetic');
  }

  /** A cloud as a cluster of soft ellipses; storm cells are dark and heavy. */
  function drawCloud(cloud, project) {
    const centre = project(cloud.x, cloud.y, cloud.z);
    if (!centre) return;
    const size = cloud.size * centre.scale;
    if (size < 5) return;
    context.fillStyle = cloud.storm ? PALETTE.storm : PALETTE.cloud;
    context.beginPath();
    context.ellipse(centre.x, centre.y, size, size * 0.34, 0, 0, Math.PI * 2);
    context.ellipse(centre.x - size * 0.55, centre.y + size * 0.08, size * 0.62, size * 0.26, 0, 0, Math.PI * 2);
    context.ellipse(centre.x + size * 0.55, centre.y + size * 0.06, size * 0.66, size * 0.28, 0, 0, Math.PI * 2);
    context.fill();
    if (cloud.storm) {
      context.strokeStyle = PALETTE.stormEdge;
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(centre.x, centre.y, size, size * 0.34, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }

  /** The Kestrel seen from behind and above: cream fuselage, teal wings, orange stripe.
   * On the title screen it sits parked below the panel, so the cover shows the aircraft. */
  function drawPlane(state, cyOverride, scale) {
    const cx = FIELD.width / 2;
    const cy = cyOverride ?? FIELD.height * 0.66 - state.pitch * 1.1;
    const bankRad = (state.bank * Math.PI) / 180;
    context.save();
    context.translate(cx, cy);
    context.rotate(bankRad * 0.85);
    context.scale(scale ?? 1, scale ?? 1);
    const propSpin = (state.throttle * 0.9 + 0.1) * (performance.now() / 90);
    // Propeller blur: a translucent disc at the nose.
    context.fillStyle = 'rgba(200, 220, 235, 0.35)';
    context.beginPath();
    context.ellipse(0, -118, 16 + state.throttle * 10, 30, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(40, 50, 60, 0.55)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, -118);
    context.lineTo(Math.cos(propSpin) * 26, -118 + Math.sin(propSpin) * 26);
    context.moveTo(0, -118);
    context.lineTo(-Math.cos(propSpin) * 26, -118 - Math.sin(propSpin) * 26);
    context.stroke();
    // Wings: one long trapezoid, teal on top, orange tips.
    context.fillStyle = PALETTE.planeTeal;
    context.beginPath();
    context.moveTo(-128, 6);
    context.lineTo(-26, -16);
    context.lineTo(26, -16);
    context.lineTo(128, 6);
    context.lineTo(118, 18);
    context.lineTo(-118, 18);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeOrange;
    context.beginPath();
    context.moveTo(-128, 6);
    context.lineTo(-104, 2);
    context.lineTo(-100, 16);
    context.lineTo(-118, 18);
    context.closePath();
    context.moveTo(128, 6);
    context.lineTo(104, 2);
    context.lineTo(100, 16);
    context.lineTo(118, 18);
    context.closePath();
    context.fill();
    // Fuselage: tapering from the tail at the bottom to the nose at the top.
    context.fillStyle = PALETTE.planeCream;
    context.beginPath();
    context.moveTo(-13, 84);
    context.quadraticCurveTo(-20, 10, -11, -96);
    context.quadraticCurveTo(0, -112, 11, -96);
    context.quadraticCurveTo(20, 10, 13, 84);
    context.quadraticCurveTo(0, 94, -13, 84);
    context.closePath();
    context.fill();
    // Orange cheatline down the fuselage.
    context.fillStyle = PALETTE.planeOrange;
    context.fillRect(-11, -58, 22, 7);
    context.fillRect(-12, 30, 24, 7);
    // Cockpit glass.
    context.fillStyle = PALETTE.planeGlass;
    context.beginPath();
    context.ellipse(0, -72, 8, 16, 0, 0, Math.PI * 2);
    context.fill();
    // Tail: horizontal stabiliser and a fin.
    context.fillStyle = PALETTE.planeTeal;
    context.beginPath();
    context.moveTo(-52, 74);
    context.lineTo(-12, 62);
    context.lineTo(12, 62);
    context.lineTo(52, 74);
    context.lineTo(46, 84);
    context.lineTo(-46, 84);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(-4, 88);
    context.lineTo(0, 52);
    context.lineTo(5, 88);
    context.closePath();
    context.fill();
    context.restore();
  }

  /** The plane's shadow on the ground below, fading as it climbs. */
  function drawShadow(state, project) {
    const ground = groundHeight(state.x, state.z, state.seed ?? 1);
    const point = project(state.x, ground + 1, state.z);
    if (!point) return;
    const fade = clamp(1 - (state.y - ground) / 500, 0.12, 0.85);
    const size = Math.max(8, 1500 / point.depth);
    context.fillStyle = `rgba(8, 14, 24, ${fade * 0.4})`;
    context.beginPath();
    context.ellipse(point.x, point.y, size, size * 0.3, 0, 0, Math.PI * 2);
    context.fill();
  }

  /** One lit instrument box: a label over a big number. */
  function instrument(x, y, label, value, unit) {
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, 132, 64);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1.5;
    context.strokeRect(x, y, 132, 64);
    plainText(label, x + 10, y + 18, 13, PALETTE.muted, 'left', 'alphabetic');
    text(`${value}`, x + 10, y + 52, 30, PALETTE.text, 'left', 'alphabetic');
    plainText(unit, x + 122, y + 50, 13, PALETTE.muted, 'right', 'alphabetic');
  }

  /** A horizontal bar gauge with a label and a percent. */
  function barGauge(x, y, width, label, fraction, colour, dangerAt) {
    plainText(label, x, y - 6, 13, PALETTE.muted, 'left', 'alphabetic');
    plainText(`${Math.round(fraction * 100)}%`, x + width, y - 6, 13, PALETTE.text, 'right', 'alphabetic');
    context.fillStyle = 'rgba(10, 18, 32, 0.85)';
    context.fillRect(x, y, width, 12);
    const colourNow = dangerAt !== undefined && fraction <= dangerAt ? PALETTE.red : colour;
    context.fillStyle = colourNow;
    context.fillRect(x, y, Math.max(0, width * clamp(fraction, 0, 1)), 12);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1;
    context.strokeRect(x, y, width, 12);
  }

  /** The compass strip across the top: ticks and letters, centred on the heading. */
  function drawCompass(headingDeg) {
    const cx = FIELD.width / 2;
    const y = 16;
    context.fillStyle = PALETTE.panel;
    context.fillRect(cx - 190, y, 380, 34);
    context.strokeStyle = PALETTE.panelEdge;
    context.strokeRect(cx - 190, y, 380, 34);
    const letters = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let offset = -60; offset <= 60; offset += 5) {
      const deg = ((Math.round(headingDeg) + offset) % 360 + 360) % 360;
      const px = cx + offset * 3;
      const major = deg % 45 === 0;
      context.strokeStyle = major ? PALETTE.text : PALETTE.muted;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(px, y + 26);
      context.lineTo(px, y + (major ? 12 : 19));
      context.stroke();
      if (major) {
        plainText(letters[deg] ?? String(deg), px, y + 10, 11, PALETTE.text, 'center', 'alphabetic');
      }
    }
    // Centre caret: the heading the nose is on.
    context.fillStyle = PALETTE.gold;
    context.beginPath();
    context.moveTo(cx - 7, y + 34);
    context.lineTo(cx + 7, y + 34);
    context.lineTo(cx, y + 42);
    context.closePath();
    context.fill();
  }

  /** The artificial horizon: a small dial with the sky and ground split by the bank. */
  function drawAttitude(state) {
    const cx = 310;
    const cy = FIELD.height - 92;
    const radius = 46;
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    context.translate(cx, cy);
    context.rotate((-state.bank * Math.PI) / 180);
    const pitchShift = clamp(state.pitch * 1.4, -radius, radius);
    context.fillStyle = '#7db4dd';
    context.fillRect(-radius, -radius + pitchShift, radius * 2, radius);
    context.fillStyle = '#5d4a33';
    context.fillRect(-radius, pitchShift, radius * 2, radius);
    context.fillStyle = '#ffffff';
    context.fillRect(-radius, pitchShift - 1, radius * 2, 2);
    context.restore();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
    // Fixed wings: the dial turns, the wings do not.
    context.strokeStyle = PALETTE.gold;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(cx - radius - 4, cy);
    context.lineTo(cx - 12, cy);
    context.moveTo(cx + 12, cy);
    context.lineTo(cx + radius + 4, cy);
    context.stroke();
    plainText('ATT', cx, cy + radius + 16, 11, PALETTE.muted, 'center', 'alphabetic');
  }

  /** An arrow at the screen's edge pointing at the next ring when it is out of frame. */
  function drawNextRingArrow(state, terrain, project) {
    const next = terrain.nextRing();
    if (!next) return;
    const point = project(next.x, next.y, next.z);
    const dx = next.x - state.x;
    const dz = next.z - state.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (point && point.x > 60 && point.x < FIELD.width - 60 && point.y > 80 && point.y < FIELD.height - 140) {
      plainText(`NEXT RING ${Math.round(dist)} ft`, point.x, point.y - 44, 14, PALETTE.gold, 'center', 'alphabetic');
      return;
    }
    // Off-screen: pin an arrow to the edge in the ring's bearing relative to the nose.
    const relBearing = Math.atan2(dx, dz) - state.heading;
    const ahead = Math.cos(relBearing) > 0;
    const side = Math.sin(relBearing);
    const ex = FIELD.width / 2 + side * (FIELD.width / 2 - 60);
    const ey = ahead ? 110 : FIELD.height - 130;
    const angle = ahead ? 0 : Math.PI;
    context.save();
    context.translate(clamp(ex, 40, FIELD.width - 40), ey);
    context.rotate(side >= 0 ? angle + 0.5 : angle - 0.5);
    context.fillStyle = PALETTE.gold;
    context.beginPath();
    context.moveTo(16, 0);
    context.lineTo(-10, -11);
    context.lineTo(-4, 0);
    context.lineTo(-10, 11);
    context.closePath();
    context.fill();
    context.restore();
    plainText(`RING ${Math.round(dist)} ft`, clamp(ex, 70, FIELD.width - 70), ey + 28, 13, PALETTE.gold, 'center', 'alphabetic');
  }

  function drawHud(frame) {
    const state = frame.aircraft;
    const headingDeg = ((state.heading * 180) / Math.PI % 360 + 360) % 360;
    instrument(20, 16, 'ALTITUDE', Math.round(state.y * 3.28), 'ft');
    instrument(164, 16, 'SPEED', Math.round(state.speed), 'kt');
    instrument(308, 16, 'HEADING', String(Math.round(headingDeg)).padStart(3, '0'), '°');
    drawCompass(headingDeg);
    // Top right: score, mission, goal and the clock.
    context.fillStyle = PALETTE.panel;
    context.fillRect(FIELD.width - 332, 16, 312, 64);
    context.strokeStyle = PALETTE.panelEdge;
    context.strokeRect(FIELD.width - 332, 16, 312, 64);
    text(`SCORE ${state.score}`, FIELD.width - 322, 44, 26, PALETTE.text, 'left', 'alphabetic');
    const timeText = `${Math.floor(state.timeLeft / 60)}:${String(Math.floor(state.timeLeft % 60)).padStart(2, '0')}`;
    text(timeText, FIELD.width - 30, 44, 26, state.timeLeft < 30 ? PALETTE.red : PALETTE.text, 'right', 'alphabetic');
    plainText(`${frame.mission.name} · ${frame.goalLine}`, FIELD.width - 322, 70, 13, PALETTE.muted, 'left', 'alphabetic');
    // Bottom left: fuel and throttle.
    barGauge(20, FIELD.height - 64, 220, 'FUEL', state.fuel / 100, PALETTE.green, 0.2);
    barGauge(20, FIELD.height - 34, 220, 'THROTTLE', state.throttle, PALETTE.gold);
    drawAttitude(state);
    // Bottom right: hull and distance flown.
    barGauge(FIELD.width - 240, FIELD.height - 64, 220, 'HULL', state.hull / 100, '#58b8d8', 0.3);
    plainText(`FLOWN ${Math.round(state.distance / 5280)} mi`, FIELD.width - 20, FIELD.height - 18, 13, PALETTE.muted, 'right', 'alphabetic');
    // Warnings, centre-top, flashing when they matter.
    const warnings = [];
    if (state.stalled) warnings.push(['STALL', PALETTE.red]);
    if (state.fuel < 20 && state.fuel > 0) warnings.push(['LOW FUEL', PALETTE.amber]);
    if (state.fuel <= 0) warnings.push(['ENGINE OUT — GLIDE', PALETTE.red]);
    if (state.inStorm) warnings.push(['IN STORM', PALETTE.amber]);
    const ground = groundHeight(state.x, state.z, frame.terrain.seed);
    if (state.y - ground < 90 && state.y - ground > 0 && !onRunway(state.x, state.z)) {
      warnings.push(['TERRAIN', PALETTE.red]);
    }
    if (warnings.length > 0 && Math.floor(frame.time * 2.4) % 2 === 0) {
      warnings.forEach(([label, colour], i) => {
        text(label, FIELD.width / 2, 96 + i * 30, 24, colour, 'center', 'alphabetic');
      });
    }
    // The transient banner: a scored ring, a crate, a landing.
    if (frame.banner && frame.bannerAge < 2.2) {
      const alpha = frame.bannerAge > 1.6 ? (2.2 - frame.bannerAge) / 0.6 : 1;
      context.globalAlpha = alpha;
      text(frame.banner, FIELD.width / 2, 150, 34, PALETTE.gold, 'center', 'alphabetic');
      context.globalAlpha = 1;
    }
    // The controls, small, at the bottom centre while flying.
    plainText('W/S throttle · ↑/↓ pitch · ←/→ bank · P pause · M sound', FIELD.width / 2, FIELD.height - 12, 12, PALETTE.muted, 'center', 'alphabetic');
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 32;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, width, height);
    context.strokeStyle = accent ?? PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    text(title, FIELD.width / 2, y + 64, 44, PALETTE.text, 'center', 'alphabetic');
    lines.forEach((line, i) => {
      plainText(line, FIELD.width / 2, y + 108 + i * 32, 19, PALETTE.muted, 'center', 'alphabetic');
    });
    text(prompt, FIELD.width / 2, y + height - 30, 22, PALETTE.gold, 'center', 'alphabetic');
  }

  /** Paint one frame: sky, world, plane, HUD, then the panel for the screen the game is on. */
  function draw(frame) {
    const state = frame.aircraft;
    const terrain = frame.terrain;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    const cam = {
      x: state.x - Math.sin(state.heading) * CAMERA.behind,
      y: state.y + CAMERA.above,
      z: state.z - Math.cos(state.heading) * CAMERA.behind,
      heading: state.heading,
      pitch: state.pitch,
    };
    const project = makeProjector(cam);

    drawSky(state.heading, frame.time);
    // The world tilts a little with the bank, the HUD never does.
    context.save();
    context.translate(FIELD.width / 2, FIELD.height * CAMERA.horizon);
    context.rotate((state.bank * Math.PI) / 180 * 0.12);
    context.translate(-FIELD.width / 2, -FIELD.height * CAMERA.horizon);
    drawTerrain(cam, project, terrain.seed);
    drawShadow({ ...state, seed: terrain.seed }, project);
    drawRunway(cam, project);
    for (const building of terrain.buildings) drawBuilding(building, project);
    // Rings, crates, fuel and clouds, far to near so near ones overlap far ones.
    const drawables = [];
    for (const ring of terrain.rings) {
      const p = project(ring.x, ring.y, ring.z);
      if (p) drawables.push({ depth: p.depth, fn: () => drawRing(ring, project, terrain.nextRing() === ring, frame.time) });
    }
    for (const crate of terrain.crates) {
      if (crate.taken) continue;
      const p = project(crate.x, crate.y, crate.z);
      if (p) drawables.push({ depth: p.depth, fn: () => drawPickup(crate, project, frame.time, false) });
    }
    for (const fuel of terrain.fuels) {
      if (fuel.taken) continue;
      const p = project(fuel.x, fuel.y, fuel.z);
      if (p) drawables.push({ depth: p.depth, fn: () => drawPickup(fuel, project, frame.time, true) });
    }
    for (const cloud of terrain.clouds) {
      const p = project(cloud.x, cloud.y, cloud.z);
      if (p) drawables.push({ depth: p.depth, fn: () => drawCloud(cloud, project) });
    }
    drawables.sort((a, b) => b.depth - a.depth);
    for (const item of drawables) item.fn();
    context.restore();

    if (frame.screen === SCREEN_TITLE) drawPlane(state, FIELD.height * 0.86, 0.8);
    else drawPlane(state);
    drawNextRingArrow(state, terrain, project);
    drawHud(frame);

    if (frame.screen === SCREEN_TITLE) {
      drawPanel(
        'SKYRUNNER',
        [
          'Archipelago Courier — fly the Kestrel K-2 over the islands.',
          `${frame.mission.name}: ${frame.mission.brief}`,
          'W/S throttle · ↑/↓ pitch · ←/→ bank · mouse steers too',
          `Best campaign score ${frame.best}`,
        ],
        'Press Enter or click to fly',
      );
    } else if (frame.screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The islands will wait for you.', `Score ${state.score}`], 'Press P to keep flying');
    } else if (frame.screen === SCREEN_MISSION) {
      drawPanel(`${frame.mission.name} complete`, frame.debrief, frame.lastMission ? 'Press Enter for the final debrief' : 'Press Enter for the next sortie', PALETTE.green);
    } else if (frame.screen === SCREEN_VICTORY) {
      drawPanel('Campaign complete', frame.debrief, 'Press Enter to fly it again', PALETTE.gold);
    } else if (frame.screen === SCREEN_OVER) {
      drawPanel(
        'Down',
        [state.crashReason || 'The sortie is over.', `Score ${state.score} · Best ${frame.best}`],
        'Press Enter to fly again',
        PALETTE.red,
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
