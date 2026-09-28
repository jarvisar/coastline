import { channelBuffer } from './textures.js';

// Synthesised engine loop. Each firing drives a pressure pulse into a damped
// exhaust resonance. Cylinder imbalance and cycle variation avoid a periodic buzz.
// Three RPM bands each have a coast and a load take. Plain channel data, so the
// takes can render in a worker.
export function engineChannel(rate, profile, rpm, loaded, seed = 0xeca17) {
  const cycles = Math.max(8, Math.round(rpm / 120 * 2));
  const length = Math.round(cycles * 120 / rpm * rate), overlap = Math.round(rate * .045);
  const data = new Float32Array(length), tail = new Float32Array(overlap);
  let randomState = seed >>> 0;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
  const cylinders = profile.cylinders;
  const imbalance = cylinders === 8 ? [1, .68, .93, .8, .7, 1, .76, .92] : cylinders === 6 ? [1, .91, .96, .89, .98, .93] : [1, .84, .95, .89];
  const bodyHz = (loaded ? 105 : 145) / Math.sqrt(profile.body);
  const resonance = 2 * Math.cos(2 * Math.PI * bodyHz / rate) * Math.exp(-1 / (rate * .008));
  const resonanceDecay = Math.exp(-2 / (rate * .008));
  const fastDecay = Math.exp(-1 / (rate * .00032));
  const slowDecay = Math.exp(-1 / (rate * (loaded ? .0032 : .0018)));
  const airDecay = Math.exp(-2 * Math.PI * (loaded ? 1600 : 850) / rate);
  const dcRate = 1 - Math.exp(-2 * Math.PI * 28 / rate);
  let phase = 0, firing = -1, fast = 0, slow = 0, r1 = 0, r2 = 0, air = 0, dc = 0, previousPulse = 0;
  let cycleGain = 1;
  const step = cycles * cylinders / length;
  // Warm up filters before storing the loop, so its first sample is settled.
  const warmup = Math.round(rate * .2);
  phase = -warmup * step;
  for (let i = -warmup; i < length + overlap; i++) {
    phase += step;
    const next = Math.floor(phase);
    if (next !== firing) {
      firing = next;
      if (firing % cylinders === 0) cycleGain = .94 + random() * .12;
      const strength = imbalance[(firing % cylinders + cylinders) % cylinders] * cycleGain * (.95 + random() * .1);
      fast += strength; slow += strength;
    }
    fast *= fastDecay; slow *= slowDecay;
    const pulse = slow - fast;
    // Noise is scaled by the pulse so the breath follows each firing.
    const resonated = (pulse - previousPulse) + resonance * r1 - resonanceDecay * r2;
    previousPulse = pulse; r2 = r1; r1 = resonated;
    air = airDecay * air + (1 - airDecay) * (random() * 2 - 1);
    const raw = pulse * .55 + resonated * .12 + air * (.12 + pulse * .8) * profile.rasp;
    dc += (raw - dc) * dcRate;
    const sample = Math.tanh((raw - dc) * (loaded ? 1.8 : 1.25));
    if (i >= 0 && i < length) data[i] = sample;
    else if (i >= length) tail[i - length] = sample;
  }
  // Equal-power join hides the loop seam. RMS normalising keeps band
  // crossfades from getting louder mid-RPM.
  for (let i = 0; i < overlap; i++) {
    const angle = i / (overlap - 1) * Math.PI / 2;
    data[i] = tail[i] * Math.cos(angle) + data[i] * Math.sin(angle);
  }
  let energy = 0;
  for (const sample of data) energy += sample * sample;
  const normalize = .2 / Math.max(.001, Math.sqrt(energy / length));
  for (let i = 0; i < length; i++) data[i] *= normalize;
  // Phase-align the firing fundamental across takes so crossfades don't cancel.
  const omega = 2 * Math.PI * cycles * cylinders / length;
  let real = 0, imaginary = 0;
  for (let i = 0; i < length; i++) { real += data[i] * Math.cos(omega * i); imaginary += data[i] * Math.sin(omega * i); }
  const shift = Math.atan2(imaginary, real) / omega;
  const aligned = data.slice();
  for (let i = 0; i < length; i++) {
    const position = (i + shift + length) % length, a = Math.floor(position), fraction = position - a;
    data[i] = aligned[a] * (1 - fraction) + aligned[(a + 1) % length] * fraction;
  }
  return data;
}
export const createEngineBuffer = (ctx, profile, rpm, loaded, seed) => channelBuffer(ctx, ctx.sampleRate, [engineChannel(ctx.sampleRate, profile, rpm, loaded, seed)]);

const bands = profile => [profile.idle, profile.idle + (profile.redline - profile.idle) * .43, profile.redline * .9];
// The bank's six takes: coast then load for each band.
export const engineTakes = (rate, profile) => bands(profile).flatMap((rpm, band) =>
  [false, true].map(loaded => engineChannel(rate, profile, rpm, loaded, 0xeca17 + band * 137 + Number(loaded) * 971)));

export function engineBandWeights(rpm, references) {
  const weights = references.map(() => 0);
  if (rpm <= references[0]) { weights[0] = 1; return weights; }
  for (let i = 0; i < references.length - 1; i++) if (rpm < references[i + 1]) {
    const blend = Math.log(rpm / references[i]) / Math.log(references[i + 1] / references[i]);
    weights[i] = Math.cos(blend * Math.PI / 2); weights[i + 1] = Math.sin(blend * Math.PI / 2); return weights;
  }
  weights[weights.length - 1] = 1;
  return weights;
}

export function createEngineBank(ctx, destination) {
  const cache = new Map();
  const voices = Array.from({ length: 6 }, () => { const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(destination); return { gain, source: null }; });
  let current = null, references = [], firstUpdate = true;
  return {
    nodeCount: 12, sourceCount: 6,
    // `takes` are buffers rendered elsewhere. Without them they're made here.
    setProfile(profile, takes = null) {
      if (profile === current) return;
      current = profile;
      firstUpdate = true;
      references = bands(profile);
      if (!takes && !cache.has(profile)) {
        if (cache.size >= 3) cache.delete(cache.keys().next().value);
        cache.set(profile, engineTakes(ctx.sampleRate, profile).map(data => channelBuffer(ctx, ctx.sampleRate, [data])));
      }
      const buffers = takes ?? cache.get(profile);
      const startTime = ctx.currentTime + .005;
      for (let i = 0; i < voices.length; i++) {
        const voice = voices[i];
        voice.source?.stop(); voice.source?.disconnect();
        voice.gain.gain.cancelScheduledValues(ctx.currentTime); voice.gain.gain.setValueAtTime(0, ctx.currentTime);
        const source = ctx.createBufferSource(); source.buffer = buffers[i]; source.loop = true;
        source.connect(voice.gain); source.start(startTime); voice.source = source;
      }
    },
    update(rpm, load, target) {
      if (!current) return;
      const weights = engineBandWeights(rpm, references);
      const coast = Math.cos(load * Math.PI / 2), power = Math.sin(load * Math.PI / 2);
      for (let i = 0; i < voices.length; i++) {
        const band = Math.floor(i / 2), voice = voices[i];
        // Jump straight to the right rate on the first update. Ramping from 1
        // offsets the layers' phase for good and they cancel when blended.
        if (firstUpdate) voice.source.playbackRate.setValueAtTime(rpm / references[band], ctx.currentTime);
        target(voice.source.playbackRate, rpm / references[band], .065);
        target(voice.gain.gain, weights[band] * (i % 2 ? power : coast), .075);
      }
      firstUpdate = false;
    },
    dispose() { for (const voice of voices) { voice.source?.stop(); voice.source?.disconnect(); voice.gain.disconnect(); } cache.clear(); },
  };
}
