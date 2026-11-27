// Sound, synthesised live with WebAudio: no audio files, no network. An engine hum that
// follows the throttle, a wind rush that follows the speed, and short chimes for rings,
// crates, fuel, landings and crashes. Starts on the first gesture, mutes with M.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;
  let started = false;

  /** Build the graph on the first user gesture; browsers forbid audio before one. */
  function start() {
    if (started) return;
    started = true;
    try {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);

      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      windSource = context.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      windFilter = context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      windGain = context.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSource.start();
    } catch {
      context = null;
    }
  }

  /** One short note: a sine that fades out, for chimes and blips. */
  function note(frequency, when, duration, volume) {
    if (!context) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, context.currentTime + when);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(context.currentTime + when);
    osc.stop(context.currentTime + when + duration + 0.05);
  }

  /** A burst of filtered noise, for the crash thud and the touchdown bump. */
  function thud(volume, lowpass) {
    if (!context) return;
    const length = Math.floor(context.sampleRate * 0.4);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  /** Every frame while flying: engine pitch follows throttle, wind follows speed. */
  function update(throttle, speedKnots, flying) {
    if (!context) return;
    const now = context.currentTime;
    engineOsc.frequency.setTargetAtTime(46 + throttle * 74, now, 0.08);
    engineFilter.frequency.setTargetAtTime(280 + throttle * 900, now, 0.08);
    engineGain.gain.setTargetAtTime(flying ? 0.05 + throttle * 0.075 : 0, now, 0.1);
    windFilter.frequency.setTargetAtTime(320 + speedKnots * 3.2, now, 0.1);
    windGain.gain.setTargetAtTime(flying ? Math.min(0.12, speedKnots * 0.00045) : 0, now, 0.12);
  }

  function ring() {
    note(880, 0, 0.35, 0.22);
    note(1318, 0.09, 0.4, 0.18);
  }

  function crate() {
    note(660, 0, 0.18, 0.2);
    note(990, 0.07, 0.22, 0.16);
  }

  function fuel() {
    note(520, 0, 0.16, 0.18);
    note(780, 0.06, 0.2, 0.15);
  }

  function landing() {
    thud(0.5, 300);
    note(523, 0.05, 0.3, 0.2);
    note(659, 0.16, 0.3, 0.2);
    note(784, 0.27, 0.5, 0.22);
  }

  function crash() {
    thud(0.9, 160);
    note(110, 0, 0.7, 0.3);
    note(82, 0.1, 0.9, 0.25);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return { start, update, ring, crate, fuel, landing, crash, toggleMute };
}
