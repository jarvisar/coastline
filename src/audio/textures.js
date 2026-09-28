// Loops are made as plain channel data so they can render in a worker
// (render-worker.js) and never stall a frame.
export function channelBuffer(ctx, rate, channels) {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, rate);
  channels.forEach((data, i) => buffer.getChannelData(i).set(data));
  return buffer;
}

// 12 s of looping stereo pink noise shared by all the noise layers.
export function noiseChannels(rate, seed = 0x71ca9) {
  const length = Math.ceil(rate * 12), overlap = Math.ceil(rate * .15), channels = [];
  let state = seed >>> 0;
  for (let channel = 0; channel < 2; channel++) {
    const data = new Float32Array(length), tail = new Float32Array(overlap);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length + overlap; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      const white = (state >>> 0) / 2147483648 - 1;
      b0 = .99765 * b0 + white * .099046;
      b1 = .963 * b1 + white * .2965164;
      b2 = .57 * b2 + white * 1.0526913;
      const sample = (b0 + b1 + b2 + white * .1848) * .18;
      if (i < length) data[i] = sample; else tail[i - length] = sample;
    }
    // Crossfade the overrun tail into the start so the loop is seamless.
    for (let i = 0; i < overlap; i++) {
      const phase = i / (overlap - 1) * Math.PI / 2;
      data[i] = tail[i] * Math.cos(phase) + data[i] * Math.sin(phase);
    }
    channels.push(data);
  }
  return channels;
}

// 8 second stereo loops, each kind seeded separately so they don't share a noise pattern.
// The last .12 s is crossfaded into the start for a seamless loop.
export function textureChannels(rate, kind) {
  const length = Math.round(rate * 8), overlap = Math.round(rate * .12), channels = [];
  let state = { road: 0x173acd, wind: 0x712abc, rain: 0x817de }[kind] ?? 0x173acd;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let channel = 0; channel < 2; channel++) {
    const data = new Float32Array(length), tail = new Float32Array(overlap);
    let low = 0, mid = 0, grain = 0, pressure = 0;
    const lowRate = 1 - Math.exp(-2 * Math.PI * 110 / rate), midRate = 1 - Math.exp(-2 * Math.PI * 2200 / rate);
    const grainDecay = Math.exp(-1 / (rate * (kind === 'rain' ? .0025 : .006)));
    for (let i = 0; i < length + overlap; i++) {
      const white = random() * 2 - 1;
      low += (white - low) * lowRate; mid += (white - mid) * midRate;
      pressure += (Math.abs(low) * 9 - pressure) * .0002;
      if (random() < (kind === 'rain' ? 1600 : 480) / rate) grain += random() ** 3;
      grain *= grainDecay;
      const raw = kind === 'wind' ? low * 2.2 + mid * .12 * (.4 + pressure)
        : kind === 'rain' ? (white - mid) * (.07 + grain * .28) + mid * .2
          : low * .65 + mid * (.16 + grain * .45) * (.65 + pressure);
      const sample = .8 * Math.tanh(raw / .8);
      if (i < length) data[i] = sample; else tail[i - length] = sample;
    }
    for (let i = 0; i < overlap; i++) {
      const phase = i / (overlap - 1) * Math.PI / 2;
      data[i] = tail[i] * Math.cos(phase) + data[i] * Math.sin(phase);
    }
    channels.push(data);
  }
  return channels;
}
export const createTextureBuffer = (ctx, kind) => channelBuffer(ctx, ctx.sampleRate, textureChannels(ctx.sampleRate, kind));
