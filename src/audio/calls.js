import { bandpass, between, bubble, curve, lowpass, noise, normalize, random, seedFor, voice } from './dsp.js';

// One-shot sounds rendered into buffers: wildlife, thunder, impacts and the
// music mallet. Renders are seeded, so each variant is the same every visit.
export const CALL_RATE = 32000;

const swell = (length, attack = .15, hold = .6) => curve([[0, 0], [length * attack, 1], [length * hold, .8], [length, 0]]);
function phrase(rate, parts) {
  const length = Math.max(...parts.map(([offset, data]) => Math.round(offset * rate) + data.length));
  const out = new Float32Array(length);
  for (const [offset, data] of parts) { const start = Math.round(offset * rate); for (let i = 0; i < data.length; i++) out[start + i] += data[i]; }
  return out;
}
const glide = (length, ...points) => curve(points.map(([at, value]) => [at * length, value]));
const whistle = (rate, r, length, from, to, extra = {}) => voice(rate, r, { duration: length, harmonics: [1, .1, .03], pitch: glide(length, [0, from], [1, to]), level: swell(length, .15, .55), ...extra });

// Harmonic-rich sources for nasal and harsh calls.
const REED = [1, .8, .65, .5, .38, .28, .2, .13, .08];
const CROAK = [1, .95, .85, .7, .6, .5, .4, .3, .2, .12];

export const CALLS = {
  // Herring gull.
  gull(rate, r) {
    const base = between(r, 760, 960);
    const kyow = (length, pitch) => voice(rate, r, { duration: length, harmonics: REED, formants: [[1500, 4, 1], [2900, 5, .7], [4300, 6, .3]], breath: .06, breathBand: [3000, .8], rough: .25,
      pitch: glide(length, [0, pitch * .8], [.15, pitch * 1.15], [.45, pitch], [1, pitch * .62]), level: swell(length, .06, .6) });
    const style = r();
    if (style < .4) return phrase(rate, [[0, kyow(.44, base)], [.56, kyow(.4, base * .96)]]);
    if (style < .75) return phrase(rate, [[0, kyow(.5, base * 1.05)], ...Array.from({ length: 5 }, (_, i) => [.62 + i * .17, kyow(.13, base * (1.02 - i * .045))])]);
    return kyow(.5, base);
  },
  // Red-tailed hawk.
  hawk(rate, r) {
    return voice(rate, r, { duration: 1.7, harmonics: [1, .55, .3, .15], breath: .4, breathBand: [2600, 1.2], rough: .6, vibrato: [11, .012],
      pitch: glide(1.7, [0, 2200], [.1, 2850], [.3, 2700], [.9, 1950], [1, 1750]), level: curve([[0, 0], [.12, 1], [1, .75], [1.7, 0]]) });
  },
  raven(rate, r) {
    const croak = pitch => voice(rate, r, { duration: .32, harmonics: CROAK, formants: [[950, 3, 1], [1900, 4, .6], [3100, 5, .25]], rough: .7, breath: .1,
      pitch: glide(.32, [0, pitch], [.25, pitch * 1.15], [1, pitch * .85]), level: swell(.32, .1, .5) });
    const base = between(r, 300, 360), count = 2 + Math.floor(r() * 2);
    return phrase(rate, Array.from({ length: count }, (_, i) => [i * between(r, .42, .55), croak(base * (1 - i * .03))]));
  },
  // Canyon wren.
  wren(rate, r) {
    const count = 10 + Math.floor(r() * 4), parts = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      const pitch = 4700 * (2300 / 4700) ** (i / (count - 1));
      parts.push([at, whistle(rate, r, .055, pitch * 1.06, pitch * .94)]);
      at += .1 + .05 * Math.abs(i / count - .35);
    }
    return phrase(rate, parts);
  },
  // Great horned owl.
  owl(rate, r) {
    const base = between(r, 285, 330);
    const hoo = (length, pitch) => voice(rate, r, { duration: length, harmonics: [1, .22, .06], breath: .2, breathBand: [650, .8],
      pitch: glide(length, [0, pitch * .94], [.2, pitch], [1, pitch * .9]), level: swell(length, .25, .7) });
    return phrase(rate, [[0, hoo(.32, base)], [.62, hoo(.14, base * 1.03)], [.8, hoo(.28, base * 1.03)], [1.35, hoo(.55, base)], [2.15, hoo(.34, base * .97)]]);
  },
  // Wolf.
  howl(rate, r) {
    const base = between(r, 340, 390);
    return voice(rate, r, { duration: 3.6, harmonics: [1, .35, .15, .06], breath: .06, breathBand: [900, .8], vibrato: [5.5, .012],
      pitch: glide(3.6, [0, base], [.14, base * 1.5], [.3, base * 1.6], [.72, base * 1.5], [.92, base * 1.17], [1, base * .92]), level: curve([[0, 0], [.4, .8], [1.2, 1], [2.8, .85], [3.6, 0]]) });
  },
  // Screaming piha.
  piha(rate, r) {
    const pitch = between(r, .95, 1.05);
    const pi = () => whistle(rate, r, .09, 1700 * pitch, 2300 * pitch);
    const yo = voice(rate, r, { duration: .55, harmonics: [1, .1, .03], pitch: glide(.55, [0, 1500 * pitch], [.22, 3100 * pitch], [.55, 2800 * pitch], [1, 1900 * pitch]), level: swell(.55, .1, .6) });
    return phrase(rate, [[0, pi()], [.22, pi()], [.5, yo]]);
  },
  trill(rate, r) {
    const top = between(r, 3300, 3900);
    return voice(rate, r, { duration: 1.3, harmonics: [1, .1], trill: [between(r, 15, 19), 1], pitch: glide(1.3, [0, top], [1, top * .6]), level: curve([[0, 0], [.1, 1], [1, .8], [1.3, 0]]) });
  },
  squawk(rate, r) {
    const call = pitch => voice(rate, r, { duration: .22, harmonics: CROAK, formants: [[2000, 3, 1], [3400, 4, .6]], rough: .8, breath: .15,
      pitch: glide(.22, [0, pitch], [.3, pitch * 1.35], [1, pitch * 1.05]), level: swell(.22, .1, .5) });
    const base = between(r, 900, 1150);
    return phrase(rate, [[0, call(base)], [.3, call(base * .93)]]);
  },
  // Western meadowlark.
  meadowlark(rate, r) {
    const pitch = between(r, .94, 1.06), sing = (length, from, to, extra) => whistle(rate, r, length, from * pitch, to * pitch, extra);
    return phrase(rate, [[0, sing(.28, 2700, 2500)], [.34, sing(.2, 2300, 2200)], [.6, sing(.09, 3400, 3000)], [.72, sing(.07, 2700, 2600)], [.82, sing(.24, 2200, 2600, { trill: [26, .8] })]]);
  },
  // Bobwhite.
  bobwhite(rate, r) {
    const pitch = between(r, .95, 1.05);
    const white = voice(rate, r, { duration: .34, harmonics: [1, .15, .05], pitch: glide(.34, [0, 1350 * pitch], [.6, 1600 * pitch], [1, 3000 * pitch]), level: curve([[0, 0], [.03, .8], [.25, 1], [.34, 0]]) });
    return phrase(rate, [[0, whistle(rate, r, .12, 1250 * pitch, 1450 * pitch)], [.26, white]]);
  },
  crow(rate, r) {
    const caw = pitch => voice(rate, r, { duration: .3, harmonics: CROAK, formants: [[1250, 3, 1], [2500, 4, .5]], rough: .65, breath: .1,
      pitch: glide(.3, [0, pitch], [.3, pitch * 1.1], [1, pitch * .85]), level: swell(.3, .1, .5) });
    const base = between(r, 520, 600);
    return phrase(rate, Array.from({ length: 3 }, (_, i) => [i * .42, caw(base * (1 + (r() - .5) * .06))]));
  },
  // Drips into a puddle.
  drip(rate, r) {
    const drop = () => bubble(rate, between(r, 1300, 3200), between(r, .012, .03), .3);
    return phrase(rate, [[0, drop()], [between(r, .25, .6), drop()], ...(r() < .5 ? [[between(r, .7, 1.1), drop()]] : [])]);
  },
  // Steam vent.
  steam(rate, r) {
    const hiss = noise(rate, r, { duration: 3.2, band: [between(r, 900, 1500), .7], level: curve([[0, 0], [.6, 1], [2, .8], [3.2, 0]]) });
    const whoosh = noise(rate, r, { duration: 3.2, low: 60, high: 300, level: curve([[0, 0], [.8, 3], [2.2, 2], [3.2, 0]]) });
    return phrase(rate, [[0, hiss], [0, whoosh]]);
  },
  // Low tremor.
  rumble(rate, r) {
    const at = [between(r, .3, 1), between(r, 1.6, 2.6), between(r, 3, 4)];
    return noise(rate, r, { duration: 5, high: 90, level: t => at.reduce((sum, peak, i) => sum + Math.exp(-(((t - peak) / (.5 + i * .2)) ** 2)) * (1 - i * .25), 0) });
  },
  // Falling rocks.
  clatter(rate, r) {
    const parts = [], count = 6 + Math.floor(r() * 5);
    let at = 0;
    for (let i = 0; i < count; i++) {
      const tone = bandpass(rate, between(r, 700, 2600), 6), decay = between(r, .015, .04);
      const knock = new Float32Array(Math.ceil(decay * 5 * rate));
      for (let j = 0; j < knock.length; j++) knock[j] = tone((r() * 2 - 1) * Math.exp(-j / rate / decay)) * (1 - i / count * .6);
      parts.push([at, knock]);
      at += i < count / 2 ? between(r, .05, .14) : between(r, .12, .3);
    }
    return phrase(rate, parts);
  },
  // Flamingo flock.
  flamingo(rate, r) {
    const honk = pitch => voice(rate, r, { duration: .17, harmonics: REED, formants: [[1050, 4, 1], [2300, 5, .6], [3500, 6, .2]], rough: .3, breath: .05,
      pitch: glide(.17, [0, pitch * .92], [.3, pitch], [1, pitch * .85]), level: swell(.17, .12, .6) });
    const birds = [between(r, 500, 560), between(r, 600, 660), between(r, 690, 760)], parts = [];
    for (let i = 0, count = 6 + Math.floor(r() * 4); i < count; i++) parts.push([between(r, 0, 1.6), honk(birds[Math.floor(r() * birds.length)])]);
    return phrase(rate, parts);
  },
  // Black-necked stilt.
  stilt(rate, r) {
    const pitch = between(r, 2000, 2300), count = 4 + Math.floor(r() * 3);
    return phrase(rate, Array.from({ length: count }, (_, i) => [i * .16, voice(rate, r, { duration: .07, harmonics: [1, .4, .15], pitch: glide(.07, [0, pitch], [.4, pitch * 1.14], [1, pitch * .95]), level: swell(.07, .15, .5) })]));
  },
  // Bullfrog.
  bullfrog(rate, r) {
    const base = between(r, 98, 118);
    const note = (length, pitch) => voice(rate, r, { duration: length, harmonics: [.7, 1, .8, .6, .45, .3, .2], formants: [[230, 2.5, 1], [470, 3, .9], [1100, 4, .2]], trill: [between(r, 45, 55), .75], rough: .2,
      pitch: glide(length, [0, pitch], [1, pitch * .93]), level: curve([[0, 0], [.05, 1], [length * .7, .9], [length, 0]]) });
    return phrase(rate, [[0, note(.42, base)], [.6, note(.38, base * 1.04)], [1.15, note(.46, base * .97)]]);
  },
  // Green frog.
  greenfrog(rate, r) {
    const gunk = () => voice(rate, r, { duration: .2, harmonics: [1, .7, .5, .35, .2], formants: [[520, 3, 1], [1300, 4, .4]], pitch: glide(.2, [0, between(r, 215, 245)], [1, 195]), level: curve([[0, 0], [.008, 1], [.2, 0]]) });
    return r() < .5 ? gunk() : phrase(rate, [[0, gunk()], [between(r, .35, .5), gunk()]]);
  },
  // Barred owl.
  barredowl(rate, r) {
    const base = between(r, 400, 450);
    const hoo = (length, pitch, drop) => voice(rate, r, { duration: length, harmonics: [1, .3, .1], breath: .12, breathBand: [800, .9], vibrato: [7, .01],
      pitch: glide(length, [0, pitch * .95], [.25, pitch], [.7, pitch], [1, pitch * drop]), level: swell(length, .2, .75) });
    return phrase(rate, [[0, hoo(.16, base, .96)], [.24, hoo(.16, base * 1.02, .95)], [.5, hoo(.18, base * 1.04, .95)], [.85, hoo(.52, base * 1.06, .72)]]);
  },
  heron(rate, r) {
    const pitch = between(r, 280, 320);
    return voice(rate, r, { duration: .5, harmonics: CROAK, formants: [[800, 3, 1], [1700, 4, .6]], rough: .85, breath: .15, pitch: glide(.5, [0, pitch], [.2, pitch * 1.1], [1, pitch * .8]), level: swell(.5, .08, .5) });
  },
  // Splash.
  splash(rate, r) {
    const spray = noise(rate, r, { duration: .5, band: [between(r, 1800, 2600), .8], level: curve([[0, 0], [.01, 1], [.12, .4], [.5, 0]]) });
    const droplets = Array.from({ length: 4 }, () => [between(r, .1, .6), bubble(rate, between(r, 900, 2400), between(r, .01, .02), .2)]);
    return phrase(rate, [[0, bubble(rate, between(r, 240, 380), .05, .3).map(value => value * 2)], [.005, spray], ...droplets]);
  },
  // A crack for close strikes, then several rolls.
  thunder(rate, r) {
    const close = r() < .45, duration = between(r, 6, 8), length = Math.ceil(duration * rate), out = new Float32Array(length);
    // The first roll leads and later ones shrink.
    const rolls = Array.from({ length: 4 + Math.floor(r() * 4) }, (_, i) => {
      const at = i ? between(r, .2, duration * .6) : 0;
      return { at: at + (close ? .08 : .3), size: (i ? between(r, .25, .8) : 1) * (1 - at / duration) ** 1.5, rise: between(r, .1, .5), fall: between(r, .6, 1.8) };
    });
    const cutoff = close ? 260 : 160, low = lowpass(rate, cutoff), smooth = lowpass(rate, cutoff), grit = bandpass(rate, 600, .8);
    let crackle = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate, white = r() * 2 - 1;
      let envelope = 0;
      for (const roll of rolls) if (t > roll.at) envelope += roll.size * Math.min(1, (t - roll.at) / roll.rise) * Math.exp(-Math.max(0, t - roll.at - roll.rise) / roll.fall);
      if (r() < 40 / rate) crackle = between(r, .5, 1);
      crackle *= .9992;
      const crack = close && t < .5 ? white * Math.exp(-t / .06) * 1.4 : 0;
      out[i] = smooth(low(white)) * 14 * envelope + grit(white) * crackle * envelope * (close ? .25 : .06) + crack;
    }
    return out;
  },
  // Hitting scenery.
  thud(rate, r) {
    const length = Math.ceil(.5 * rate), out = new Float32Array(length), knock = bandpass(rate, 180, 1), crunch = bandpass(rate, between(r, 1500, 2300), .8);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate, white = r() * 2 - 1;
      phase += (42 + 55 * Math.exp(-t / .05)) / rate;
      out[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t / .13) + knock(white) * Math.exp(-t / .06) * 2.2 + crunch(white * (r() < .2 ? 3 : .3)) * Math.exp(-t / .07) * .8;
    }
    return out;
  },
  // Hitting another car: the thump plus metal.
  crash(rate, r) {
    const body = CALLS.thud(rate, r), partials = [370, 910, 1520, 2240, 3130, 4270].map(frequency => ({ frequency: frequency * between(r, .9, 1.1), decay: between(r, .04, .16), gain: between(r, .2, .6) }));
    const crunch = bandpass(rate, 3000, .7);
    for (let i = 0; i < body.length; i++) {
      const t = i / rate;
      let ring = 0;
      for (const partial of partials) ring += Math.sin(2 * Math.PI * partial.frequency * t) * partial.gain * Math.exp(-t / partial.decay);
      body[i] += ring * .5 + crunch((r() * 2 - 1) * (r() < .15 ? 3 : .3)) * Math.exp(-t / .12) * .9;
    }
    return body;
  },
  // Bridge joint under one axle.
  clunk(rate, r) {
    const length = Math.ceil(.25 * rate), out = new Float32Array(length), tick = bandpass(rate, between(r, 1200, 1600), 3);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      phase += (55 + 30 * Math.exp(-t / .02)) / rate;
      out[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t / .055) + tick((r() * 2 - 1)) * Math.exp(-t / .012) * 1.5;
    }
    return out;
  },
  // FM mallet for the music, at middle C.
  mallet(rate) {
    const length = Math.ceil(3.2 * rate), out = new Float32Array(length), frequency = 261.63;
    for (let i = 0; i < length; i++) {
      const t = i / rate, index = 1.4 * Math.exp(-t / .3) + .12;
      out[i] = (Math.sin(2 * Math.PI * frequency * t + index * Math.sin(2 * Math.PI * frequency * t)) + .12 * Math.sin(2 * Math.PI * frequency * 7.1 * t) * Math.exp(-t / .04))
        * Math.exp(-t / 1.1) * Math.min(1, t / .004);
    }
    return out;
  },
};

// Low sounds render at a lower rate.
export const callRate = kind => kind === 'thunder' || kind === 'rumble' ? 16000 : CALL_RATE;
export function renderCall(kind, seed = 1, rate = callRate(kind)) {
  // Fade the last 20 ms so a ringing tail can't click when the buffer ends.
  const data = normalize(CALLS[kind](rate, random(seedFor(kind, seed)))), fade = Math.min(data.length, Math.round(rate * .02));
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  return data;
}
