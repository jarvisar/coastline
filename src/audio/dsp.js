// Sample-level helpers for the offline renderers.
export function random(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
export const between = (random, low, high) => low + random() * (high - low);
export function seedFor(kind, seed = 1) {
  let hash = seed * 7919;
  for (const character of kind) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash;
}

// Piecewise-linear curve through [time, value] points, held past both ends.
export function curve(points) {
  return t => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) if (t < points[i][0]) {
      const [t0, v0] = points[i - 1], [t1, v1] = points[i];
      return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
    }
    return points.at(-1)[1];
  };
}

// RBJ band-pass with unit peak gain.
export function bandpass(rate, frequency, q) {
  const w = 2 * Math.PI * Math.min(frequency, rate * .45) / rate, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b0 = alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
export function lowpass(rate, frequency) {
  const k = 1 - Math.exp(-2 * Math.PI * frequency / rate);
  let y = 0;
  return x => (y += (x - y) * k);
}

// One cycle of a harmonic series, read with linear interpolation.
const TABLE = 2048;
export function wavetable(harmonics) {
  const table = new Float32Array(TABLE + 1);
  for (let i = 0; i < TABLE; i++) for (let h = 0; h < harmonics.length; h++) table[i] += harmonics[h] * Math.sin(2 * Math.PI * (h + 1) * i / TABLE);
  table[TABLE] = table[0];
  return phase => { const position = (phase - Math.floor(phase)) * TABLE, index = position | 0; return table[index] + (table[index + 1] - table[index]) * (position - index); };
}

// Scales to a peak and removes any DC offset.
export function normalize(data, peak = .9) {
  let mean = 0, max = 0;
  for (const value of data) mean += value;
  mean /= data.length || 1;
  for (let i = 0; i < data.length; i++) { data[i] -= mean; max = Math.max(max, Math.abs(data[i])); }
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
  return data;
}

// Adds a mono sound into a looping buffer, wrapping at the end, so loops built
// from events have no seam.
export function mixInto(target, source, start, gain = 1) {
  const length = target.length;
  let index = ((Math.round(start) % length) + length) % length;
  for (let i = 0; i < source.length; i++) { target[index] += source[i] * gain; if (++index === length) index = 0; }
}

// A pitched, filtered voice for animal calls. `pitch` and `level` are curves
// over time, `harmonics` sets the source, `formants` filter it, `rough` adds
// amplitude noise and `trill` is amplitude modulation.
export function voice(rate, random, {
  duration, pitch, level, harmonics = [1], formants = null, breath = 0, breathBand = [2500, .7], rough = 0,
  vibrato = [0, 0], trill = [0, 0], drift = .004,
}) {
  const length = Math.ceil(duration * rate), out = new Float32Array(length);
  const table = wavetable(harmonics), flutter = lowpass(rate, 280), wander = lowpass(rate, 6);
  // Unit deviation for each smoothed noise, so `drift` and `rough` are plain fractions.
  const unit = frequency => 1 / (Math.sqrt((1 - Math.exp(-2 * Math.PI * frequency / rate)) / 2) * .577);
  const flutterScale = unit(280), wanderScale = unit(6);
  const filters = formants?.map(([frequency, q, gain]) => [bandpass(rate, frequency, q), gain]);
  const air = bandpass(rate, ...breathBand);
  // Curves run at a 2 kHz control rate; the gain is interpolated between steps.
  const control = 16, gainAt = t => level(t) * (trill[1] ? 1 - trill[1] * (.5 + .5 * Math.cos(2 * Math.PI * trill[0] * t)) : 1);
  let phase = random(), step = 0, gain = gainAt(0), next = gain;
  for (let i = 0; i < length; i++) {
    if (i % control === 0) {
      const t = i / rate;
      step = pitch(t) * (1 + vibrato[1] * Math.sin(2 * Math.PI * vibrato[0] * t)) / rate;
      gain = next; next = gainAt((i + control) / rate);
    }
    const noise = random() * 2 - 1;
    phase += step * (1 + drift * wander(noise) * wanderScale);
    const rasp = rough ? Math.min(1, Math.abs(flutter(noise)) * flutterScale * .5) : 0;
    let sample = table(phase) * (1 - rough * rasp) + (breath ? breath * air(noise) : 0);
    if (filters) { let sum = 0; for (const [filter, weight] of filters) sum += filter(sample) * weight; sample = sum; }
    out[i] = sample * (gain + (next - gain) * (i % control) / control);
  }
  return out;
}

// Minnaert bubble: a decaying sine with rising pitch.
const sine = wavetable([1]);
export function bubble(rate, frequency, decay, rise = .1) {
  const length = Math.ceil(decay * 4.6 * rate), out = new Float32Array(length), fade = Math.exp(-1 / (decay * rate));
  const step = frequency / rate, growth = rise / (decay * rate), attack = rate * .0008;
  let phase = 0, envelope = 1;
  for (let i = 0; i < length; i++) {
    phase += step * (1 + growth * i);
    out[i] = sine(phase) * envelope * Math.min(1, i / attack);
    envelope *= fade;
  }
  return out;
}

// Filtered noise with an envelope.
export function noise(rate, random, { duration, level, low = 0, high = 0, band = null }) {
  const length = Math.ceil(duration * rate), out = new Float32Array(length);
  const shape = band ? bandpass(rate, band[0], band[1]) : null, lowCut = low ? lowpass(rate, low) : null, highCut = high ? lowpass(rate, high) : null;
  for (let i = 0; i < length; i++) {
    let sample = random() * 2 - 1;
    if (highCut) sample = highCut(sample);
    if (lowCut) sample -= lowCut(sample);
    if (shape) sample = shape(sample);
    out[i] = sample * level(i / rate);
  }
  return out;
}
