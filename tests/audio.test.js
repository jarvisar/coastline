import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSoundModel, trafficSound } from '../src/audio/model.js';
import { ENGINES, engineFor, sanitizeMix, MIX_PRESETS } from '../src/audio/profiles.js';
import { createEngineBuffer, engineBandWeights } from '../src/audio/engine.js';
import { createTextureBuffer } from '../src/audio/textures.js';
import { SoundDirector } from '../src/audio/director.js';
import { createNoiseBuffer } from '../src/audio/synthesis.js';
import { DriveAudio } from '../src/audio.js';
import { DrivingController } from '../src/vehicle.js';
import { CALLS, renderCall } from '../src/audio/calls.js';
import { LOOPS, renderLoop } from '../src/audio/nature.js';
import { Surroundings, reverberate } from '../src/audio/space.js';
import { HARMONY, Music, chordNotes } from '../src/audio/music.js';
import { AudioAssets } from '../src/audio/assets.js';
import { JOURNEYS } from '../src/journeys.js';

function settle(model, telemetry, seconds = 2, hz = 60) {
  let result;
  for (let i = 0; i < seconds * hz; i++) result = model.update(telemetry, 1 / hz);
  return result;
}

test('engine responds to load separately from speed and quiets down when coasting', () => {
  const model = new DriveSoundModel();
  const loaded = settle(model, { speed: 12, throttle: 1 });
  const coast = settle(model, { speed: 12 });
  assert.ok(loaded.engineLevel > coast.engineLevel * 1.5);
  assert.ok(loaded.engineCutoff > coast.engineCutoff * 1.5);
  assert.equal(loaded.roadLevel, coast.roadLevel);
  const stopped = settle(model, { speed: 0 });
  assert.ok(stopped.rpm < 825);
  assert.equal(stopped.roadLevel + stopped.roughLevel + stopped.windLevel, 0);
});

test('sound gears shift without hunting and reverse has its own bounded range', () => {
  const model = new DriveSoundModel();
  const first = settle(model, { speed: 7.4, throttle: 1 });
  const second = settle(model, { speed: 7.6, throttle: 1 });
  assert.equal(first.gear, 1); assert.equal(second.gear, 2);
  assert.ok(second.rpm < first.rpm - 400);
  for (let i = 0; i < 300; i++) assert.equal(model.update({ speed: i % 2 ? 7.4 : 7.6 }, 1 / 60).gear, 2);
  assert.equal(settle(model, { speed: 4.8 }).gear, 1);
  const reverse = settle(model, { speed: -7, throttle: 1 });
  assert.equal(reverse.gear, -1); assert.ok(reverse.rpm > 1800 && reverse.rpm < 2800);
});

test('surface texture blends in only when moving off road', () => {
  const model = new DriveSoundModel();
  const road = model.update({ speed: 14 });
  const shoulder = model.update({ speed: 14, offRoad: .5 });
  const rough = model.update({ speed: 14, offRoad: 1 });
  assert.equal(road.roughLevel, 0);
  assert.ok(rough.roughLevel > shoulder.roughLevel && shoulder.roughLevel > 0);
  assert.ok(rough.roadLevel < shoulder.roadLevel && shoulder.roadLevel < road.roadLevel);
  assert.equal(model.update({ speed: 0, offRoad: 1 }).roughLevel, 0);
});

test('audio model handles invalid telemetry and variable frame delivery', () => {
  for (const telemetry of [{}, { speed: NaN, throttle: Infinity }, { speed: -1000, offRoad: -1 }]) {
    for (const value of Object.values(new DriveSoundModel().update(telemetry, NaN))) assert.ok(Number.isFinite(value));
  }
  const low = settle(new DriveSoundModel(), { speed: 12, throttle: .5 }, 3, 30);
  const high = settle(new DriveSoundModel(), { speed: 12, throttle: .5 }, 3, 144);
  assert.ok(Math.abs(low.rpm - high.rpm) < 1);
  assert.ok(Math.abs(low.load - high.load) < .001);
});

test('vehicle reports keyboard, reverse, analog, touch and reset effort', () => {
  const car = new DrivingController();
  car.update(1 / 60, { forward: .4 });
  assert.equal(car.audioTelemetry.throttle, .4);
  car.speed = 10; car.update(1 / 60, { brake: .7 });
  assert.equal(car.audioTelemetry.brake, .7); assert.equal(car.audioTelemetry.throttle, 0);
  car.speed = -3; car.update(1 / 60, { brake: .6 });
  assert.equal(car.audioTelemetry.throttle, .6); assert.equal(car.audioTelemetry.brake, 0);
  car.update(1 / 60, { forward: 1, handbrake: true });
  assert.equal(car.audioTelemetry.throttle, 0); assert.equal(car.audioTelemetry.brake, 1);
  car.reset();
  assert.equal(car.audioTelemetry.speed + car.audioTelemetry.throttle + car.audioTelemetry.brake, 0);
  car.update(1 / 60, { touchDrive: { amount: .5, heading: car.heading, along: 1, across: 0 } });
  assert.ok(car.audioTelemetry.throttle > .9);
  car.update(1 / 60, { touchDrive: { amount: 0 } });
  assert.ok(car.audioTelemetry.brake > 0);
});

test('stereo noise is deterministic, decorrelated and has a continuous loop join', () => {
  const context = {
    sampleRate: 8000,
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: i => data[i] };
    },
  };
  const a = createNoiseBuffer(context), b = createNoiseBuffer(context);
  const left = a.getChannelData(0), right = a.getChannelData(1);
  assert.deepEqual(left, b.getChannelData(0));
  let ll = 0, rr = 0, lr = 0, steps = 0;
  for (let i = 1; i < left.length; i++) {
    ll += left[i] ** 2; rr += right[i] ** 2; lr += left[i] * right[i];
    steps += (left[i] - left[i - 1]) ** 2;
  }
  assert.ok(Math.abs(lr / Math.sqrt(ll * rr)) < .15);
  assert.ok(Math.abs(left[0] - left.at(-1)) < 4 * Math.sqrt(steps / left.length));
});

test('unsupported audio fails cleanly and leaves sound disabled', async () => {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    const audio = new DriveAudio();
    await assert.rejects(audio.toggle(), /unavailable/);
    assert.equal(audio.enabled, false); assert.equal(audio.context, null);
    await audio.dispose(); await audio.dispose();
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('engine personalities cover the garage and Formula retains its full rev range', () => {
  assert.equal(engineFor('auto', 'snow'), ENGINES.snow);
  assert.equal(engineFor('pickup', 'snow'), ENGINES.pickup);
  assert.equal(engineFor('unknown'), ENGINES.coast);
  const model = new DriveSoundModel(); model.setProfile(ENGINES.formula);
  const fast = settle(model, { speed: 50, throttle: 1 }, 5);
  assert.equal(fast.gear, 6); assert.ok(fast.rpm > 10000 && fast.rpm <= 12500);
  assert.ok(settle(model, { speed: 0 }).rpm < 1810);
});

test('tire scrub and reverse whine follow motion and road contact', () => {
  const model = new DriveSoundModel();
  assert.equal(model.update({ speed: 0, steer: 1, brake: 1, handbrake: 1 }).skidLevel, 0);
  assert.equal(model.update({ speed: 20 }).skidLevel, 0);
  const tarmac = model.update({ speed: 20, steer: 1, handbrake: 1 });
  const gravel = model.update({ speed: 20, steer: 1, handbrake: 1, offRoad: 1 });
  assert.ok(tarmac.skidLevel > gravel.skidLevel * 4);
  assert.ok(model.update({ speed: -5 }).reverseLevel > 0);
  assert.equal(model.update({ speed: 5 }).reverseLevel, 0);
});

test('passing traffic pans with the listener, fades with distance, and changes pitch at the pass', () => {
  const player = { groundedPosition: { x: 0, z: 0 }, heading: 0, speed: 15 };
  const car = { position: { x: -5, z: -20 }, heading: Math.PI, speed: 20 };
  const approaching = trafficSound(player, car);
  assert.ok(approaching.pan < 0 && approaching.doppler > 1 && approaching.level > 0);
  assert.ok(trafficSound(player, car, Math.PI).pan > 0);
  car.position.z = 20;
  assert.ok(trafficSound(player, car).doppler < 1);
  car.position.z = 100;
  assert.equal(trafficSound(player, car).level, 0);
});

test('mix storage rejects invalid values and clamps valid numeric volumes', () => {
  assert.deepEqual(sanitizeMix(null), MIX_PRESETS.balanced);
  const mix = sanitizeMix({ master: Infinity, engine: -4, road: 8, music: '1', night: 'false' });
  assert.equal(mix.master, MIX_PRESETS.balanced.master);
  assert.equal(mix.engine, 0); assert.equal(mix.road, 1); assert.equal(mix.music, 0); assert.equal(mix.night, false);
});

const bufferContext = { sampleRate: 12000, createBuffer(channels, length) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { getChannelData: i => data[i] };
} };
function signalStats(data) {
  let energy = 0, steps = 0, peak = 0, mean = 0;
  for (let i = 1; i < data.length; i++) { energy += data[i] ** 2; steps += (data[i] - data[i - 1]) ** 2; peak = Math.max(peak, Math.abs(data[i])); mean += data[i]; }
  return { rms: Math.sqrt(energy / data.length), step: Math.sqrt(steps / data.length), peak, mean: mean / data.length };
}
test('combustion takes are deterministic, centered, matched in level, and distinct under load', () => {
  for (const profile of [ENGINES.coast, ENGINES.pickup, ENGINES.formula]) {
    const coast = createEngineBuffer(bufferContext, profile, profile.idle, false).getChannelData(0);
    const load = createEngineBuffer(bufferContext, profile, profile.idle, true).getChannelData(0);
    assert.deepEqual(coast, createEngineBuffer(bufferContext, profile, profile.idle, false).getChannelData(0));
    assert.notDeepEqual(coast, load);
    for (const data of [coast, load]) {
      const stats = signalStats(data);
      assert.ok(stats.rms > .19 && stats.rms < .21);
      assert.ok(Math.abs(stats.mean) < .01);
      assert.ok(stats.peak < 1);
      assert.ok(Math.abs(data[0] - data.at(-1)) < stats.step * 5, 'no seam impulse');
    }
  }
});

test('RPM band crossfades preserve energy and stay continuous across band boundaries', () => {
  const refs = [820, 2200, 3800];
  let previous = engineBandWeights(400, refs);
  for (let rpm = 401; rpm < 7000; rpm++) {
    const weights = engineBandWeights(rpm, refs);
    assert.ok(Math.abs(weights.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-10);
    assert.ok(weights.every((value, i) => Math.abs(value - previous[i]) < .004));
    previous = weights;
  }
});

test('contact, wind and rain textures have different spectra and smooth stereo loops', () => {
  const brightness = [];
  for (const kind of ['road', 'wind', 'rain']) {
    const buffer = createTextureBuffer(bufferContext, kind);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1), stats = signalStats(left);
    assert.notDeepEqual(left, right);
    assert.ok(stats.peak < 1 && stats.rms > .01);
    assert.ok(Math.abs(left[0] - left.at(-1)) < stats.step * 5);
    brightness.push(stats.step / stats.rms);
  }
  assert.ok(brightness[1] < brightness[0] && brightness[0] < brightness[2]);
});

// A graph stand-in that records what the director and music ask for.
function recordingGraph() {
  const graph = { played: [], pads: [{ id: 0 }, { id: 1 }], padLog: [] };
  graph.buffer = (kind, variant = 0) => ({ kind, variant, duration: 1 });
  graph.play = (bus, buffer, options) => { if (!buffer) return false; graph.played.push({ bus, kind: buffer.kind, variant: buffer.variant, ...options }); return true; };
  graph.playPad = (slot, frequencies, bass, time) => graph.padLog.push({ type: 'play', slot: slot.id, time, notes: frequencies.length });
  graph.releasePad = (slot, time) => graph.padLog.push({ type: 'release', slot: slot.id, time });
  Object.defineProperty(graph, 'mallet', { get: () => graph.buffer('mallet') });
  return graph;
}

test('every call renders the same each time, stays in range and ends in silence', () => {
  for (const kind of Object.keys(CALLS)) {
    const data = renderCall(kind, 1), stats = signalStats(data);
    assert.deepEqual(data, renderCall(kind, 1), `${kind}: deterministic`);
    if (kind !== 'mallet') assert.notDeepEqual(data, renderCall(kind, 2), `${kind}: variants differ`);
    assert.ok(data.every(Number.isFinite), `${kind}: finite`);
    assert.ok(stats.peak <= .91 && stats.rms > .01, `${kind}: level`);
    assert.ok(Math.abs(stats.mean) < .01, `${kind}: centered`);
    assert.ok(Math.abs(data.at(-1)) < 1e-3, `${kind}: fades out`);
  }
});

test('nature loops join without a seam and stay within level', () => {
  for (const kind of LOOPS) {
    const [left, right] = renderLoop(kind), stats = signalStats(left);
    assert.deepEqual(left, renderLoop(kind)[0], `${kind}: deterministic`);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), `${kind}: finite`);
    assert.ok(stats.peak <= .951 && stats.rms > .02, `${kind}: level`);
    assert.ok(Math.abs(left[0] - left.at(-1)) < stats.step * 5, `${kind}: seamless`);
    assert.notDeepEqual(left, right, `${kind}: stereo`);
  }
});

test('baked reverb keeps the dry sound and adds a tail of the asked-for energy', () => {
  const rate = 8000, dry = new Float32Array(800).map((_, i) => Math.sin(i * .3) * Math.exp(-i / 200));
  const space = { decay: 1.2, damping: 3000, echoes: [[.1, .2]] }, [left, right] = reverberate(dry, rate, space, .4);
  assert.equal(left.length, dry.length + 1.2 * rate);
  assert.notDeepEqual(left, right, 'the tail differs per ear');
  let dryEnergy = 0, tailEnergy = 0;
  for (let i = 0; i < left.length; i++) { const d = i < dry.length ? dry[i] : 0; dryEnergy += d * d; tailEnergy += (left[i] - d) ** 2; }
  assert.ok(Math.abs(Math.sqrt(tailEnergy / dryEnergy) - .4) < .02);
  assert.ok(left.every(Number.isFinite) && Math.abs(left.at(-1)) < 1e-6);
  assert.deepEqual(reverberate(dry, rate, space, .4)[0], left);
});

test('surroundings find which side water is on, feel canyon walls and catch bridge joints', () => {
  const frame = () => ({ angle: 0, scale: 1 });
  const lake = { frame, height: (s, u) => u > 20 ? -5 : 0, water: (s, u, h) => h < -1 };
  const around = new Surroundings();
  around.update({ route: lake, s: 0, u: 0 }, 0, 0);
  assert.ok(around.water.level > .3 && around.water.pan > .3, 'water to the right pans right');
  around.nextSample = -Infinity; around.update({ route: lake, s: 0, u: 0 }, Math.PI, 1);
  assert.ok(around.water.pan < -.3, 'turning around swaps the side');
  assert.equal(around.enclosure, 0);
  const canyon = { frame, height: (s, u) => Math.abs(u) > 10 ? 40 : 0 };
  around.nextSample = -Infinity; around.update({ route: canyon, s: 0, u: 0 }, 0, 2);
  assert.equal(around.water.level, 0); assert.equal(around.water.pan, 0);
  assert.ok(around.enclosure > .9);
  const road = { frame, height: () => 0, bridge: () => ({ start: 100, end: 172 }) };
  const deck = new Surroundings();
  deck.update({ route: road, s: 98, u: 2 }, 0, 0);
  assert.equal(deck.crossed, null); assert.equal(deck.deck, false);
  deck.update({ route: road, s: 101, u: 2 }, 0, .05);
  assert.equal(deck.crossed, 100); assert.equal(deck.deck, true);
  deck.update({ route: road, s: 500, u: 2 }, 0, .1);
  assert.equal(deck.crossed, null, 'a reset jump is not a crossing');
  assert.doesNotThrow(() => new Surroundings().update(null, 0, 0).update({ route: {}, s: NaN, u: 0 }, 0, 0));
});

test('music stays in its mode, crossfades chords and never replays a backlog', () => {
  for (const harmony of Object.values(HARMONY)) for (let index = 0; index < harmony.progression.length; index++) {
    const { bass, pad } = chordNotes(harmony, index), scale = new Set(MODES_FOR_TEST[harmony.mode]);
    for (const note of [bass, ...pad]) assert.ok(scale.has(((note - harmony.root) % 12 + 12) % 12), `${harmony.mode}: ${note} is in the mode`);
    assert.ok(pad.every(note => note > bass));
  }
  const graph = recordingGraph(), music = new Music();
  music.update(graph, 'coast', 0, 10, 0);
  assert.equal(graph.padLog.length + graph.played.length, 0, 'silent while off');
  music.update(graph, 'coast', .5, 10, .5);
  assert.deepEqual(graph.padLog.map(entry => entry.type), ['release', 'play']);
  const first = graph.padLog[1].slot;
  for (let t = 10; t < 17; t += 1 / 30) music.update(graph, 'coast', .5, t, .5);
  assert.equal(graph.padLog.at(-1).type, 'play'); assert.notEqual(graph.padLog.at(-1).slot, first, 'the next chord uses the other slot');
  assert.ok(graph.played.length > 0 && graph.played.every(note => note.kind === 'mallet' && note.rate > .4 && note.rate < 4));
  const before = graph.padLog.length + graph.played.length;
  music.update(graph, 'coast', .5, 10000, .5);
  assert.ok(graph.padLog.length + graph.played.length - before <= 3, 'no catch-up after a long gap');
  music.update(graph, 'coast', .5, 10001, 0);
  assert.equal(graph.padLog.slice(-2).filter(entry => entry.type === 'release').length, 2, 'turning music off releases both slots');
});
const MODES_FOR_TEST = { ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };

test('director spaces wildlife out, dims distant calls, answers some and thunders after lightning', () => {
  const graph = recordingGraph(), director = new SoundDirector(), audio = { graph, journey: 'swamp', mix: { ambience: .8, music: 0 } };
  for (let t = 0; t < 120; t += 1 / 30) director.update(audio, { motion: 0 }, t, null);
  const calls = graph.played.filter(entry => entry.bus === 'ambience');
  assert.ok(calls.length >= 120 / 6 && calls.length <= 120 / 2.5 * 1.4, `${calls.length} calls in two minutes`);
  assert.ok(calls.every(call => call.level > 0 && call.level <= .55 * .55 && call.cutoff >= 1400 && call.cutoff <= 16000 && Math.abs(call.pan) <= .9));
  assert.ok(calls.some(call => call.variant === 1) && calls.some(call => call.variant === 0), 'near and far takes');
  const quiet = recordingGraph();
  director.reset(0); audio.graph = quiet; audio.mix.ambience = 0;
  for (let t = 0; t < 30; t += 1 / 30) director.update(audio, { motion: 0 }, t, null);
  assert.equal(quiet.played.length, 0);
  const storm = recordingGraph(), city = { graph: storm, journey: 'city', mix: { ambience: .8, music: 0 } };
  director.reset(0);
  for (let t = 0; t < 14; t += 1 / 30) director.update(city, { motion: 0 }, t, { lightning: t > 10 && t < 10.2 ? .8 : 0 });
  const thunder = storm.played.filter(entry => entry.kind === 'thunder');
  assert.equal(thunder.length, 1); assert.ok(thunder[0].time >= 10.6 && thunder[0].time <= 13.1);
  const coast = { graph: recordingGraph(), journey: 'coast', mix: { ambience: .8, music: 0 } };
  let peak = 0;
  director.reset(0);
  for (let t = 0; t < 90; t += 1 / 30) { director.update(coast, { motion: 0 }, t, null); peak = Math.max(peak, director.surf.body, director.surf.foam); assert.ok(director.gust >= 0 && director.gust <= 1); }
  assert.ok(peak > .4 && peak <= 1.4, 'waves come in and stay bounded');
});

test('generated sounds render on the page when workers are unavailable', async () => {
  const assets = new AudioAssets();
  const result = await assets.render({ type: 'loop', kind: 'lap' });
  assert.equal(result.channels.length, 2); assert.ok(result.rate > 0);
  const failing = new AudioAssets(() => { throw new Error('blocked'); });
  failing.failed = false;
  const call = await failing.render({ type: 'call', kind: 'drip', seed: 1, space: { decay: .5 }, wet: .3 });
  assert.equal(call.channels.length, 2); assert.equal(failing.failed, true);
  assets.dispose(); failing.dispose();
});

test('routes with road bridges report deck spans for the joint thumps', () => {
  for (const id of ['coast', 'desert', 'snow', 'plains', 'volcanic', 'swamp']) {
    const route = JOURNEYS[id].route;
    for (const s of [0, 1000, 5000]) {
      const bridge = route.bridge(s);
      assert.ok(bridge.end - bridge.start > 20 && bridge.end - bridge.start < 120, `${id}: deck length`);
    }
  }
});

test('impacts say whether the car hit traffic or scenery', () => {
  const car = new DrivingController(); car.speed = 12;
  const serial = car.audioTelemetry.impactSerial;
  car.resolveTrafficCollision(0, 0, 3, 0);
  assert.equal(car.audioTelemetry.impactKind, 'traffic'); assert.equal(car.audioTelemetry.impactSerial, serial + 1);
  car.speed = 12; car.heading = 0;
  car.resolveSceneryCollision(0, 1, .1, 1 / 60);
  assert.equal(car.audioTelemetry.impactKind, 'scenery'); assert.equal(car.audioTelemetry.impactSerial, serial + 2);
});
