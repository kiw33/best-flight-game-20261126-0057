// Input only: the keyboard, the mouse and the tap. Keys are read every frame as a stick
// (throttle delta, pitch, bank) plus edge-triggered actions (confirm, pause, mute).

export const ACTION_CONFIRM = 1 << 0;
export const ACTION_PAUSE = 1 << 1;
export const ACTION_MUTE = 1 << 2;

const KEY_THROTTLE_UP = new Set(['KeyW']);
const KEY_THROTTLE_DOWN = new Set(['KeyS']);
const KEY_BANK_LEFT = new Set(['KeyA', 'ArrowLeft']);
const KEY_BANK_RIGHT = new Set(['KeyD', 'ArrowRight']);
const KEY_PITCH_UP = new Set(['ArrowUp', 'KeyI']);
const KEY_PITCH_DOWN = new Set(['ArrowDown', 'KeyK']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  /** Mouse steering: -1 at the left edge, +1 at the right edge, 0 when the mouse is idle. */
  let mouseBank = 0;
  let mouseActive = false;
  let lastMouseMove = 0;

  function onKeyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    if (event.code === 'Enter' || event.code === 'Space') actions |= ACTION_CONFIRM;
    else if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACTION_PAUSE;
    else if (event.code === 'KeyM') actions |= ACTION_MUTE;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    mouseBank = Math.max(-1, Math.min(1, (x - 0.5) * 2.4));
    mouseActive = true;
    lastMouseMove = performance.now();
  }

  function onMouseDown(event) {
    event.preventDefault();
    actions |= ACTION_CONFIRM;
  }

  function onBlur() {
    held.clear();
    mouseActive = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('blur', onBlur);

  /** The stick this frame: throttle is a delta, pitch and bank are -1..1 deflections. */
  function stick() {
    let throttle = 0;
    for (const code of KEY_THROTTLE_UP) if (held.has(code)) throttle += 1;
    for (const code of KEY_THROTTLE_DOWN) if (held.has(code)) throttle -= 1;

    let bank = 0;
    for (const code of KEY_BANK_LEFT) if (held.has(code)) bank -= 1;
    for (const code of KEY_BANK_RIGHT) if (held.has(code)) bank += 1;
    if (bank === 0 && mouseActive && performance.now() - lastMouseMove < 1200) bank = mouseBank;

    let pitch = 0;
    for (const code of KEY_PITCH_UP) if (held.has(code)) pitch += 1;
    for (const code of KEY_PITCH_DOWN) if (held.has(code)) pitch -= 1;

    return { throttle, pitch, bank };
  }

  /** The actions pressed since the last read; reading clears them. */
  function takeActions() {
    const taken = actions;
    actions = 0;
    return taken;
  }

  return { stick, takeActions };
}
