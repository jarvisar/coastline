import { between, bandpass, bubble, lowpass, mixInto, random, seedFor } from './dsp.js';

// Insect, frog and water loops built from many short events. Events wrap
// around the end, so the loops have no seam.
export const LOOP_RATE = 24000;
const SECONDS = 6;

// A short tone pulse for cricket and frog calls.
function tone(rate, frequency, duration, { rise = 0, harmonic = .08, attack = .25 } = {}) {
  // The overtone is dropped if it would fold back below the Nyquist limit.
  const length = Math.ceil(duration * rate), out = new Float32Array(length), overtone = frequency * 2 * (1 + rise) < rate / 2 ? harmonic : 0;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const x = i / length;
    phase += frequency * (1 + rise * x) / rate;
    const envelope = x < attack ? Math.sin(x / attack * Math.PI / 2) ** 2 : Math.cos((x - attack) / (1 - attack) * Math.PI / 2) ** 2;
    out[i] = (Math.sin(2 * Math.PI * phase) + overtone * Math.sin(4 * Math.PI * phase)) * envelope;
  }
  return out;
}
// Random pan and distance for one caller.
function caller(r, near = .5) {
  const distance = between(r, near, 1), pan = between(r, -.9, .9);
  return { gain: .35 / distance ** 1.6, left: Math.cos((pan + 1) * Math.PI / 4), right: Math.sin((pan + 1) * Math.PI / 4) };
}
function place(channels, sound, at, who, gain = 1) {
  mixInto(channels[0], sound, at, who.gain * who.left * gain);
  mixInto(channels[1], sound, at, who.gain * who.right * gain);
}

const CHORUSES = {
  // Field crickets, three pulses per chirp.
  crickets(rate, r, channels, length) {
    for (let n = 0; n < 9; n++) {
      const who = caller(r), pitch = between(r, 4200, 5200), period = between(r, .42, .75), pulse = tone(rate, pitch, .016);
      for (let at = between(r, 0, period) * rate; at < length; at += (period + between(r, -.03, .03)) * rate)
        for (let p = 0; p < 3; p++) place(channels, pulse, at + p * .034 * rate, who);
    }
    // Distant tree crickets.
    for (let n = 0; n < 3; n++) {
      const who = caller(r, .85), pulse = tone(rate, between(r, 2900, 3300), .01), swell = between(r, 0, 6), step = rate / between(r, 48, 55);
      for (let at = 0; at < length; at += step) place(channels, pulse, at, who, .15 + .1 * Math.sin(at / rate * 2 * Math.PI / SECONDS + swell));
    }
  },
  // Cicadas, crickets and tree frogs.
  jungle(rate, r, channels, length) {
    for (let n = 0; n < 2; n++) {
      const who = caller(r, .7), tick = tone(rate, between(r, 5200, 6200), .004, { harmonic: .3 }), rate_ = between(r, 170, 210), phase = between(r, 0, 1);
      for (let at = 0; at < length; at += rate / rate_) {
        const swell = Math.sin(Math.PI * ((at / length + phase) % 1)) ** 3;
        place(channels, tick, at, who, swell * .9);
      }
    }
    for (let n = 0; n < 4; n++) {
      const who = caller(r), pulse = tone(rate, between(r, 3800, 4600), .014), period = between(r, .3, .55);
      for (let at = between(r, 0, period) * rate; at < length; at += (period + between(r, -.04, .04)) * rate)
        for (let p = 0; p < 4; p++) place(channels, pulse, at + p * .028 * rate, who, .7);
    }
    for (let n = 0; n < 5; n++) {
      const who = caller(r), tink = tone(rate, between(r, 2400, 3600), .05, { attack: .05, harmonic: .2 }), period = between(r, .8, 1.6);
      for (let at = between(r, 0, period) * rate; at < length; at += (period + between(r, -.2, .2)) * rate) place(channels, tink, at, who, .5);
    }
  },
  // Spring peepers and katydids.
  swamp(rate, r, channels, length) {
    for (let n = 0; n < 12; n++) {
      const who = caller(r), peep = tone(rate, between(r, 2700, 3100), .07, { rise: .12, attack: .4 }), period = between(r, .8, 1.3);
      for (let at = between(r, 0, period) * rate; at < length; at += (period + between(r, -.1, .1)) * rate) place(channels, peep, at, who, .8);
    }
    for (let n = 0; n < 4; n++) {
      const who = caller(r, .6), period = between(r, 1.2, 1.7), shape = bandpass(rate, between(r, 6000, 7500), 3), size = Math.ceil(.045 * rate);
      const rasp = Float32Array.from({ length: size }, (_, i) => shape(r() * 2 - 1) * Math.sin(i / size * Math.PI) * 2.5);
      for (let at = between(r, 0, period) * rate; at < length; at += (period + between(r, -.08, .08)) * rate)
        for (let p = 0; p < 3; p++) place(channels, rasp, at + p * .13 * rate, who, .3);
    }
  },
};

// Water is bubbles plus filtered noise.
const WATERS = {
  stream: { bubbles: 140, low: 500, high: 2200, decay: [.006, .02], rush: .12, rushBand: [900, .6] },
  river: { bubbles: 260, low: 350, high: 1500, decay: [.006, .025], rush: 1.1, rushBand: [700, .5] },
  lap: { laps: [.7, 1.8], bubbles: 0, low: 220, high: 700, decay: [.02, .05], rush: 0 },
  lava: { bubbles: 7, low: 45, high: 160, decay: [.07, .18], rush: .6, rushBand: [70, .7], crackle: 18 },
};

function waterLoop(rate, r, channels, length, water) {
  for (let ch = 0; ch < 2; ch++) {
    const data = channels[ch];
    for (let at = 0, count = water.bubbles * SECONDS; at < count; at++) {
      const frequency = between(r, water.low, water.high), decay = between(r, ...water.decay);
      mixInto(data, bubble(rate, frequency, decay, water === WATERS.lava ? .4 : .25), r() * length, between(r, .15, 1) * (water === WATERS.lava ? 1.4 : .5));
    }
    if (water.rush) {
      // Slow swell of about 25%.
      const shape = bandpass(rate, ...water.rushBand), smooth = lowpass(rate, 1.5), surge = .25 / (Math.sqrt((1 - Math.exp(-2 * Math.PI * 1.5 / rate)) / 2) * .29);
      for (let i = 0; i < length; i++) data[i] += shape(r() * 2 - 1) * water.rush * Math.max(.2, 1 + smooth(r() - .5) * surge);
    }
    // Each lap is low filtered noise plus a few bubbles.
    if (water.laps) {
      for (let at = between(r, 0, 1) * rate; at < length; at += between(r, ...water.laps) * rate) {
        const size = Math.round(between(r, .35, .8) * rate), cutoff = between(r, 180, 320), first = lowpass(rate, cutoff), second = lowpass(rate, cutoff), lap = new Float32Array(size);
        for (let i = 0; i < size; i++) lap[i] = second(first(r() * 2 - 1)) * Math.sin(i / size * Math.PI) ** 2 * 12;
        mixInto(data, lap, at, between(r, .4, .8));
        for (let c = 0; c < 3 + r() * 4; c++) mixInto(data, bubble(rate, between(r, water.low, water.high), between(r, ...water.decay), between(r, .1, .4)), at + between(r, .03, .5) * rate, between(r, .2, .6));
      }
    }
    if (water.crackle) {
      const snap = bandpass(rate, 3500, 1.5);
      for (let n = 0; n < water.crackle * SECONDS; n++) {
        const tick = Float32Array.from({ length: Math.ceil(.004 * rate) }, (_, i) => snap((r() * 2 - 1) * Math.exp(-i / (rate * .0008))) * 3);
        mixInto(data, tick, r() * length, between(r, .1, .6));
      }
    }
  }
}

export const LOOPS = [...Object.keys(CHORUSES), ...Object.keys(WATERS)];
// Returns two channels at a common RMS, ready for an AudioBuffer. Sparse
// loops come out quieter rather than clipped.
export function renderLoop(kind, seed = 1, rate = LOOP_RATE) {
  const length = Math.round(SECONDS * rate), channels = [new Float32Array(length), new Float32Array(length)], r = random(seedFor(kind, seed));
  if (CHORUSES[kind]) CHORUSES[kind](rate, r, channels, length);
  else waterLoop(rate, r, channels, length, WATERS[kind]);
  let energy = 0, peak = 0;
  for (const data of channels) for (const value of data) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const scale = Math.min(.16 / Math.max(1e-6, Math.sqrt(energy / length / 2)), .95 / Math.max(1e-6, peak));
  for (const data of channels) for (let i = 0; i < length; i++) data[i] *= scale;
  return channels;
}
