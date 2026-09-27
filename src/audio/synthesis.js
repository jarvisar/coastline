import { AMBIENCE, ENGINES } from './profiles.js';
import { createEngineBank } from './engine.js';
import { createTextureBuffer } from './textures.js';
import { AudioAssets } from './assets.js';

// 12 s of looping stereo pink noise shared by all the noise layers.
export function createNoiseBuffer(ctx, seed = 0x71ca9) {
  const length = Math.ceil(ctx.sampleRate * 12), overlap = Math.ceil(ctx.sampleRate * .15);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let state = seed >>> 0;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), tail = new Float32Array(overlap);
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
  }
  return buffer;
}

const BUSES = ['engine', 'road', 'ambience', 'traffic', 'music'];
// Dry one-shots every route shares, and how many variants of each.
const DRY = { thud: 2, crash: 2, clunk: 1 };

export function createSoundGraph(ctx) {
  const nodes = [], sources = [];
  const keep = node => { nodes.push(node); return node; };
  const gain = (value, destination) => {
    const node = keep(ctx.createGain()); node.gain.value = value;
    if (destination) node.connect(destination);
    return node;
  };
  const filter = (type, frequency, destination, q = .65) => {
    const node = keep(ctx.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q;
    node.connect(destination); return node;
  };
  const oscillator = (frequency, destination, type = 'sine') => {
    const node = keep(ctx.createOscillator()); node.frequency.value = frequency;
    node.type = type;
    node.connect(destination); node.start(); sources.push(node); return node;
  };
  const panner = destination => { const node = keep(ctx.createStereoPanner()); node.connect(destination); return node; };
  // Glue compression, then a limiter so a pile-up of loud events can't clip.
  const master = gain(0, ctx.destination);
  const limiter = keep(ctx.createDynamicsCompressor());
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .002; limiter.release.value = .12;
  limiter.connect(master);
  const compressor = keep(ctx.createDynamicsCompressor());
  compressor.threshold.value = -14; compressor.knee.value = 12; compressor.ratio.value = 3;
  compressor.attack.value = .006; compressor.release.value = .24; compressor.connect(limiter);
  const highpass = filter('highpass', 25, compressor, .7);
  // Each channel has a perspective filter for the cabin view. Reverb is
  // rendered into the one-shots, so there is no reverb node.
  const perspective = {}, buses = {};
  for (const name of [...BUSES, 'echo']) perspective[name] = filter('lowpass', 16000, highpass, .5);
  for (const name of BUSES) buses[name] = gain(0, perspective[name]);
  // Echo of the engine and road off nearby walls.
  const echoLevel = gain(0, perspective.echo);
  const echoTone = filter('lowpass', 1800, echoLevel, .5);
  const echo = keep(ctx.createDelay(1)); echo.delayTime.value = .12; echo.connect(echoTone);
  const echoFeedback = gain(0, echo); echoTone.connect(echoFeedback);
  buses.engine.connect(echo); buses.road.connect(echo);
  const pink = createNoiseBuffer(ctx);
  const contactNoise = createTextureBuffer(ctx, 'road'), windNoise = createTextureBuffer(ctx, 'wind'), rainNoise = createTextureBuffer(ctx, 'rain');
  const noiseLayer = (type, frequency, low, offset, rate = 1, destination = buses.road, q = .65, buffer = pink) => {
    const level = gain(0, destination);
    const shape = filter(type, frequency, level, q);
    const cut = filter('highpass', low, shape);
    const source = keep(ctx.createBufferSource()); source.buffer = buffer; source.loop = true; source.playbackRate.value = rate;
    source.connect(cut); source.start(0, offset); sources.push(source);
    return { level: level.gain, frequency: shape.frequency, q: shape.Q, rate: source.playbackRate };
  };
  const engineLevel = gain(0, buses.engine);
  const engineFilter = filter('lowpass', 420, engineLevel);
  const engineBank = createEngineBank(ctx, engineFilter);
  engineBank.setProfile(ENGINES.coast);
  // Cheap harmonic waves for traffic. The player's engine uses the engine bank.
  const waves = new Map(Object.values(ENGINES).map(profile => {
    const harmonics = new Float32Array([0, ...profile.harmonics]);
    return [profile, ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics)];
  }));
  const bodyLevel = gain(.018, buses.engine);
  const body = oscillator(820 / 60, bodyLevel);
  const combustion = noiseLayer('bandpass', 550, 150, 1.7, 1, buses.engine);
  const intake = noiseLayer('bandpass', 1400, 480, 4.4, 1, buses.engine);
  const reverseLevel = gain(0, buses.engine);
  const reverse = oscillator(260, reverseLevel, 'triangle');
  const road = noiseLayer('lowpass', 1100, 90, 3.1, 1, buses.road, .65, contactNoise);
  // Off-road texture. Retuned lower on bridge decks.
  const rough = noiseLayer('bandpass', 1000, 70, 5.6, .74, buses.road, .8, contactNoise);
  const roughPulse = gain(0, rough.level);
  const roughMod = oscillator(17, roughPulse);
  const wind = noiseLayer('lowpass', 1500, 100, 4.3, 1, buses.road, .65, windNoise);
  const skid = noiseLayer('bandpass', 1100, 650, 2.3, 1, buses.road, 3);
  const skidToneLevel = gain(0, buses.road);
  const skidTone = oscillator(1050, skidToneLevel);
  const bed = noiseLayer('lowpass', 440, 45, 0, .83, buses.ambience, .65, windNoise);
  const air = noiseLayer('bandpass', 2300, 600, 6.9, .91, buses.ambience, .65, rainNoise);
  const rain = noiseLayer('lowpass', 4700, 350, 1.2, 1, buses.ambience, .65, rainNoise);
  // Route loops: water (surf on the coast), panned to its side, and a chorus.
  const waterPan = panner(buses.ambience);
  const waterLevel = gain(0, waterPan);
  const waterTone = filter('lowpass', 8000, waterLevel, .5);
  const chorusLevel = gain(0, buses.ambience);
  const loops = { water: { destination: waterTone, source: null }, chorus: { destination: chorusLevel, source: null } };
  function setLoop(slot, buffer) {
    if (slot.source?.buffer === buffer) return;
    if (slot.source) { slot.source.stop(); slot.source.disconnect(); slot.source = null; }
    if (!buffer) return;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    source.connect(slot.destination); source.start(); slot.source = source;
  }

  const traffic = Array.from({ length: 4 }, (_, index) => {
    const pan = panner(buses.traffic);
    // Lowpass for distance.
    const distance = filter('lowpass', 16000, pan, .5);
    const level = gain(0, distance);
    const toneLevel = gain(.11, level);
    const tone = oscillator(75 + index * 9, toneLevel);
    tone.setPeriodicWave(waves.get(ENGINES.sedan));
    const wash = noiseLayer('bandpass', 900, 150, index * 2.6, 1, level);
    wash.level.value = .2;
    return { level: level.gain, pan: pan.pan, tone: tone.frequency, wash: wash.frequency, rate: wash.rate, air: distance.frequency };
  });

  // Fixed output chains for one-shots. Each play creates a buffer source that
  // stops itself. Busy emitters are skipped.
  const emitters = {};
  for (const [name, count] of [['ambience', 4], ['road', 3], ['music', 6]]) {
    emitters[name] = Array.from({ length: count }, () => {
      const pan = panner(buses[name]), level = gain(0, pan), tone = filter('lowpass', 16000, level, .5);
      return { tone: tone.frequency, input: tone, level: level.gain, pan: pan.pan, source: null, until: 0 };
    });
  }
  function play(name, buffer, { time = ctx.currentTime, level = .5, rate = 1, pan = 0, cutoff = 16000 } = {}) {
    const voice = buffer && emitters[name]?.find(voice => voice.until <= time);
    if (!voice) return false;
    const duration = buffer.duration / rate;
    voice.until = time + duration + .05;
    for (const [param, value] of [[voice.level, level], [voice.pan, pan], [voice.tone, cutoff]]) { param.cancelScheduledValues(time); param.setValueAtTime(value, time); }
    const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    source.connect(voice.input); source.start(time); source.stop(time + duration + .02);
    voice.source = source;
    return true;
  }

  // Two pad slots crossfade between chords. Oscillators are created per chord
  // and scheduled to stop.
  const padWave = ctx.createPeriodicWave(new Float32Array(17), Float32Array.from({ length: 17 }, (_, n) => n ? 1 / n ** 1.6 : 0));
  const bassWave = ctx.createPeriodicWave(new Float32Array(3), new Float32Array([0, .55, .08]), { disableNormalization: true });
  const pads = Array.from({ length: 2 }, () => {
    const level = gain(0, buses.music);
    return { level: level.gain, tone: filter('lowpass', 900, level, .6), oscillators: [] };
  });
  function playPad(slot, frequencies, bass, time, stopAt, cutoff) {
    slot.level.cancelScheduledValues(time); slot.level.setValueAtTime(0, time); slot.level.linearRampToValueAtTime(.0045, time + 2.8);
    slot.tone.frequency.cancelScheduledValues(time); slot.tone.frequency.setValueAtTime(cutoff * .7, time); slot.tone.frequency.linearRampToValueAtTime(cutoff, time + 3);
    slot.oscillators = [];
    const start = (frequency, wave, detune) => {
      const node = ctx.createOscillator(); node.setPeriodicWave(wave); node.frequency.value = frequency; node.detune.value = detune;
      node.connect(slot.tone); node.start(time); node.stop(stopAt); slot.oscillators.push(node);
    };
    frequencies.forEach((frequency, i) => { for (const detune of [-7, 6]) start(frequency, padWave, detune + (i - 1.5) * 1.5); });
    start(bass, bassWave, 0);
  }
  function releasePad(slot, time, seconds) {
    slot.level.cancelScheduledValues(time); slot.level.setTargetAtTime(0, time, seconds);
    for (const node of slot.oscillators) try { node.stop(time + seconds * 6); } catch { /* Already stopping. */ }
    slot.oscillators = [];
  }

  // Loops and calls for the current route, rendered in a worker. Impact sounds
  // are shared by all routes. Sounds that aren't ready yet are skipped.
  const assets = new AudioAssets(), calls = new Map();
  let journey = null, disposed = false, ready = Promise.resolve();
  const toBuffer = ({ rate, channels }) => {
    const buffer = ctx.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((data, i) => buffer.copyToChannel(data, i));
    return buffer;
  };
  function setScene(id) {
    if (id === journey) return ready;
    journey = id; assets.cancel();
    const profile = AMBIENCE[id], current = () => journey === id && !disposed;
    setLoop(loops.water, profile.water === 'surf' ? rainNoise : null); setLoop(loops.chorus, null);
    for (const key of calls.keys()) if (!DRY[key.split(':')[0]]) calls.delete(key);
    const jobs = [];
    for (const slot of ['water', 'chorus']) {
      const kind = profile[slot];
      if (kind && kind !== 'surf') jobs.push(assets.render({ type: 'loop', kind }).then(result => { if (current()) setLoop(loops[slot], toBuffer(result)); }));
    }
    // Each wildlife call has a dry variant for near and a wet one for far.
    const wet = { ...Object.fromEntries(profile.calls.map(([kind]) => [kind, [.2, .55]])), mallet: [.45], ...(profile.rain ? { thunder: [.35, .35] } : {}) };
    for (const [kind, amounts] of [...Object.entries(DRY).map(([kind, count]) => [kind, Array(count).fill(0)]), ...Object.entries(wet)]) {
      amounts.forEach((amount, variant) => {
        const key = `${kind}:${variant}`;
        if (!calls.has(key)) jobs.push(assets.render({ type: 'call', kind, seed: variant + 1, space: profile.space, wet: amount }).then(result => { if (current()) calls.set(key, toBuffer(result)); }));
      });
    }
    return ready = Promise.all(jobs);
  }
  // A rendered variant, or null while it's still on its way.
  const buffer = (kind, variant = 0) => calls.get(`${kind}:${variant}`) ?? null;

  function silenceEvents() {
    const now = ctx.currentTime;
    for (const pool of Object.values(emitters)) for (const voice of pool) {
      voice.level.cancelScheduledValues(now); voice.level.setTargetAtTime(0, now, .025);
      try { voice.source?.stop(now + .15); } catch { /* Already stopping. */ }
      voice.source = null; voice.until = now + .15;
    }
    for (const slot of pads) releasePad(slot, now, .05);
  }
  return {
    master: master.gain, engineBank, engineLevel: engineLevel.gain, engineFilter: engineFilter.frequency, compressor,
    buses: Object.fromEntries(Object.entries(buses).map(([name, node]) => [name, node.gain])),
    perspective: Object.fromEntries(Object.entries(perspective).map(([name, node]) => [name, node.frequency])),
    echo: { level: echoLevel.gain, time: echo.delayTime, feedback: echoFeedback.gain },
    body, bodyLevel: bodyLevel.gain, combustion, intake, reverse, reverseLevel: reverseLevel.gain,
    road, rough, roughPulse: roughPulse.gain, roughMod, wind, skid, skidTone, skidToneLevel: skidToneLevel.gain,
    bed, air, rain, water: { level: waterLevel.gain, pan: waterPan.pan, frequency: waterTone.frequency }, chorus: chorusLevel.gain,
    traffic, pads, playPad, releasePad, play, silenceEvents, setScene, buffer,
    get ready() { return ready; },
    get mallet() { return buffer('mallet'); },
    setEngine(profile) { engineBank.setProfile(profile); },
    // Both loop slots are swapped per route but always there.
    nodeCount: nodes.length + engineBank.nodeCount, sourceCount: sources.length + engineBank.sourceCount + 2,
    dispose() {
      if (disposed) return;
      disposed = true; assets.dispose();
      engineBank.dispose(); for (const slot of Object.values(loops)) setLoop(slot, null);
      silenceEvents();
      for (const source of sources) source.stop(); for (const node of nodes) node.disconnect();
    },
  };
}
