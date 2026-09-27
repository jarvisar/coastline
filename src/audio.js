import { DriveSoundModel, trafficSound } from './audio/model.js';
import { createSoundGraph } from './audio/synthesis.js';
import { AMBIENCE, MIX_CHANNELS, MIX_PRESETS, engineFor, sanitizeMix } from './audio/profiles.js';
import { SoundDirector } from './audio/director.js';
import { Surroundings } from './audio/space.js';

const STORAGE_KEY = 'coastline-audio-v1';
// Axle to axle, for the second thump over a bridge joint.
const WHEELBASE = 2.7;

// One lazy graph per visit. Sources and event voices are bounded, transitions
// use the audio clock, and a silent context suspends after fading.
export class DriveAudio {
  constructor() {
    this.enabled = false; this.context = null; this.graph = null; this.journey = 'coast'; this.car = 'auto';
    this.paused = false; this.hidden = false; this.disposed = false; this.arriving = false;
    this.model = new DriveSoundModel(); this.director = new SoundDirector(); this.surroundings = new Surroundings(); this.targets = new WeakMap();
    this.revision = 0; this.lastUpdate = -Infinity; this.lastAmbience = -Infinity; this.suspendTimer = null;
    this.mix = sanitizeMix(null);
    try { this.mix = sanitizeMix(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')); } catch { /* Storage is optional. */ }
    this.trafficSlots = Array(4).fill(null); this.impactSerial = 0; this.lastImpact = -Infinity; this.shiftSerial = 0;
  }
  get audible() { return this.enabled && !this.paused && !this.hidden && !this.disposed; }
  get preset() { return Object.keys(MIX_PRESETS).find(id => Object.keys(this.mix).every(key => this.mix[key] === MIX_PRESETS[id][key])) ?? 'custom'; }
  target(param, value, seconds = .12) {
    if (Number.isFinite(param.maxValue)) value = Math.min(param.maxValue, Math.max(param.minValue, value));
    if (!Number.isFinite(value) || Math.abs((this.targets.get(param) ?? Infinity) - value) < .0001) return;
    // Replace obsolete automation so hours of driving cannot grow its queue.
    param.cancelScheduledValues(this.context.currentTime);
    param.setTargetAtTime(value, this.context.currentTime, seconds); this.targets.set(param, value);
  }
  setMix(channel, value) {
    if (!MIX_CHANNELS.includes(channel) && channel !== 'night') return;
    this.mix = sanitizeMix({ ...this.mix, [channel]: value }); this.saveMix(); this.syncOutput();
  }
  setPreset(id) {
    if (!Object.hasOwn(MIX_PRESETS, id)) return;
    this.mix = { ...MIX_PRESETS[id] }; this.saveMix(); this.syncOutput();
  }
  saveMix() { try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.mix)); } catch { /* Keep the mix for this visit. */ } }
  setJourney(id) {
    this.journey = Object.hasOwn(AMBIENCE, id) ? id : 'coast';
    // Fade in after a route change.
    this.arriving = true; this.graph?.setScene(this.journey);
    this.setCar(this.car, true); this.reset();
  }
  setCar(id, force = false) {
    if (!force && this.car === id) return;
    this.car = id; this.profile = engineFor(id, this.journey);
    this.model.setProfile(this.profile); this.graph?.setEngine(this.profile); this.shiftSerial = 0;
    this.targets = new WeakMap();
  }
  reset() {
    this.model.reset(); this.surroundings.reset(); this.lastUpdate = -Infinity; this.lastAmbience = -Infinity; this.shiftSerial = 0;
    this.graph?.silenceEvents(); this.director.reset(this.context?.currentTime ?? 0);
    this.trafficSlots.fill(null);
    if (this.graph) for (const voice of this.graph.traffic) this.target(voice.level, 0, .04);
  }
  async toggle() {
    if (this.disposed) return false;
    const revision = ++this.revision;
    this.enabled = !this.enabled;
    try {
      if (this.enabled) { this.ensureContext(); await this.wake(); }
      this.syncOutput();
    } catch (error) {
      if (revision === this.revision) { this.enabled = false; this.syncOutput(); }
      throw error;
    }
    return this.enabled;
  }
  ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is unavailable');
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      try { this.graph = createSoundGraph(ctx); this.context = ctx; }
      catch (error) { void ctx.close().catch(() => {}); throw error; }
      this.graph.setScene(this.journey);
      this.setCar(this.car, true);
      this.update({}, 1 / 60, true);
    }
  }
  async wake() {
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (this.audible && this.context && this.context.state !== 'running') await this.context.resume();
  }
  unlock() {
    if (!this.audible || !this.context || this.context.state === 'running') return;
    void this.wake().then(() => this.syncOutput()).catch(() => {});
  }
  syncOutput() {
    if (!this.graph || this.disposed) return;
    this.target(this.graph.master, this.audible ? this.mix.master * .64 : 0, this.audible ? this.arriving ? .45 : .16 : .065);
    if (this.audible) this.arriving = false;
    for (const [channel, param] of Object.entries(this.graph.buses)) this.target(param, this.mix[channel], .12);
    this.target(this.graph.compressor.threshold, this.mix.night ? -28 : -14, .3);
    this.target(this.graph.compressor.ratio, this.mix.night ? 6 : 3, .3);
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    // Music restarts when sound comes back.
    if (!this.audible) { this.graph.silenceEvents(); this.director.music.reset(); }
    if (!this.audible && this.context.state === 'running') {
      this.suspendTimer = setTimeout(() => {
        if (!this.audible && !this.disposed) {
          const param = this.graph.master;
          param.cancelScheduledValues(this.context.currentTime);
          param.setValueAtTime(0, this.context.currentTime); this.targets.set(param, 0);
          void this.context.suspend().catch(() => {});
        }
      }, 750);
    }
  }
  setPaused(value) { this.paused = Boolean(value); this.syncOutput(); this.unlock(); }
  setHidden(value) { this.hidden = Boolean(value); this.syncOutput(); this.unlock(); }
  update(telemetry = {}, dt, force = false, scene = null) {
    if (!this.graph || this.disposed) return;
    if (scene?.player) this.setCar(scene.player.carId);
    const state = this.model.update(telemetry, this.paused || this.hidden ? 0 : dt); this.state = state;
    const now = this.context.currentTime;
    if (!this.audible) {
      this.shiftSerial = state.shiftSerial;
      if (Number.isFinite(telemetry.impactSerial)) this.impactSerial = telemetry.impactSerial;
    }
    if (!force && (!this.audible || this.context.state !== 'running' || now - this.lastUpdate < 1 / 30)) return;
    this.lastUpdate = now;
    const g = this.graph, profile = this.profile ?? engineFor(this.car, this.journey), route = AMBIENCE[this.journey];
    const set = (param, value, seconds) => this.target(param, value, seconds);
    const around = this.surroundings.update(scene?.player, scene?.heading ?? 0, now);
    g.engineBank.update(state.rpm, state.load, set);
    set(g.body.frequency, state.rpm / 60, .09);
    set(g.engineLevel, state.engineLevel * 2.8); set(g.engineFilter, state.engineCutoff * 1.5, .18);
    set(g.bodyLevel, (.004 + state.load * .008) * profile.body);
    set(g.combustion.level, (.004 + state.load * .01) * profile.rasp); set(g.combustion.frequency, 380 + state.load * 700);
    set(g.intake.level, state.load ** 2 * .022 * profile.intake);
    set(g.intake.frequency, 800 + state.rpm * .22);
    set(g.reverse.frequency, state.reverseFrequency); set(g.reverseLevel, state.reverseLevel);
    set(g.road.level, state.roadLevel * (this.journey === 'city' ? 1.6 : 1.4)); set(g.road.frequency, 480 + state.motion * (this.journey === 'city' ? 2600 : 1000), .25);
    set(g.road.rate, .65 + state.motion * .7, .3);
    // Bridge decks: lower texture pulsed every 4.5 m.
    const speed = Math.abs(scene?.player?.speed ?? state.motion * 28);
    const roughness = around.deck ? state.motion ** .8 * .2 : state.roughLevel * 1.8;
    set(g.rough.level, roughness); set(g.roughPulse, roughness * (around.deck ? .5 : .16));
    set(g.roughMod.frequency, around.deck ? Math.max(1, speed / 4.5) : 12 + state.motion * 31, .1);
    set(g.rough.rate, .55 + state.motion * .5, .25);
    set(g.rough.frequency, around.deck ? 140 : route.rough, .2); set(g.rough.q, around.deck ? 2.2 : .8, .2);
    set(g.wind.level, state.windLevel * (1 + .3 * (this.director.gust - .5)), .4); set(g.wind.frequency, 650 + state.motion * 1350, .4);
    set(g.skid.level, state.skidLevel); set(g.skid.frequency, state.skidFrequency);
    set(g.skidTone.frequency, state.skidFrequency * 1.13); set(g.skidToneLevel, state.skidLevel * .12);
    const cabin = scene?.interior && !profile.open;
    for (const name of ['engine', 'road', 'ambience', 'traffic', 'echo']) set(g.perspective[name], cabin ? name === 'engine' ? 2200 : 1600 : 16000, .35);
    if (this.audible) {
      this.director.update(this, state, now, scene);
      this.effects(telemetry, state, now, around, speed);
    }
    // Ambience updates at 10 Hz.
    if (force || now - this.lastAmbience > .1) { this.lastAmbience = now; this.ambience(state, around); }
    this.updateTraffic(scene);
  }
  ambience(state, around) {
    const g = this.graph, profile = AMBIENCE[this.journey], d = this.director, set = (param, value, seconds = .6) => this.target(param, value, seconds);
    const gust = d.gust, swing = 1 - profile.gust + profile.gust * 2 * gust, enclosure = Math.max(profile.enclosure ?? 0, around.enclosure);
    if (profile.water === 'surf') {
      // The ocean never goes silent. It gets louder and brighter near the shore.
      const near = .7 + .3 * around.water.level, { body, foam } = d.surf;
      set(g.bed.level, profile.bed * near * (.55 + body * .9), .3); set(g.bed.frequency, profile.low * (.75 + body * .5), .4);
      set(g.water.level, profile.waterLevel * near * foam, .25); set(g.water.frequency, 1800 + foam * near * 3500, .3);
    } else {
      set(g.bed.level, profile.bed * swing); set(g.bed.frequency, profile.low * (.85 + gust * .3));
      set(g.water.level, (profile.waterLevel ?? 0) * around.water.level, 1); set(g.water.frequency, 8000, 1);
    }
    set(g.water.pan, around.water.pan, .8);
    set(g.air.level, profile.air * swing); set(g.air.frequency, profile.high * (.85 + gust * .3));
    set(g.rain.level, profile.rain ? profile.rain * (.9 + gust * .2) : 0, 1);
    set(g.chorus, (profile.chorusLevel ?? 0) * (1 - state.motion * .3), 1);
    // Set the delay quickly so it doesn't glide in pitch.
    set(g.echo.level, enclosure * .3, .8); set(g.echo.time, profile.echo[0], .01); set(g.echo.feedback, profile.echo[1], 1);
  }
  effects(telemetry, state, now, around, speed) {
    const g = this.graph, random = () => this.director.random();
    if (state.shiftSerial !== this.shiftSerial) {
      this.shiftSerial = state.shiftSerial;
      if (state.load > .18) g.play('road', g.buffer('clunk'), { time: now, level: .12 * state.load, rate: .55, cutoff: 700 });
    }
    // A serial survives several fixed physics ticks in one frame.
    if (Number.isFinite(telemetry.impactSerial) && telemetry.impactSerial !== this.impactSerial) {
      this.impactSerial = telemetry.impactSerial;
      if (now - this.lastImpact > .3 && Number.isFinite(telemetry.impact) && telemetry.impact > .4) {
        this.lastImpact = now;
        const buffer = g.buffer(telemetry.impactKind === 'traffic' ? 'crash' : 'thud', Math.floor(random() * 2));
        g.play('road', buffer, { time: now, level: Math.min(1, .2 + telemetry.impact / 12), rate: .9 + random() * .2, pan: random() * .4 - .2 });
      }
    }
    // Front axle, then the rear axle.
    if (around.crossed !== null && speed > 2) {
      const level = Math.min(.8, .15 + speed / 40), clunk = g.buffer('clunk');
      g.play('road', clunk, { time: now, level, rate: .92 + random() * .16 });
      g.play('road', clunk, { time: now + WHEELBASE / speed, level: level * .8, rate: .92 + random() * .16 });
    }
  }
  updateTraffic(scene) {
    const player = scene?.player, fleet = scene?.traffic?.enabled ? scene.traffic.vehicles : [];
    const candidates = player ? fleet.map(car => ({ car, sound: trafficSound(player, car, scene.heading ?? player.heading) })).filter(entry => entry.sound.distance < 85).sort((a, b) => a.sound.distance - b.sound.distance).slice(0, 4) : [];
    // Keep a car in the same voice while it passes, even if ranking changes,
    // so recycling a slot can't teleport an audible source.
    for (let i = 0; i < this.trafficSlots.length; i++) if (!candidates.some(entry => entry.car === this.trafficSlots[i])) this.trafficSlots[i] = null;
    for (const { car } of candidates) if (!this.trafficSlots.includes(car)) this.trafficSlots[this.trafficSlots.indexOf(null)] = car;
    for (let i = 0; i < this.graph.traffic.length; i++) {
      const voice = this.graph.traffic[i], entry = candidates.find(entry => entry.car === this.trafficSlots[i]);
      this.target(voice.level, entry?.sound.level ?? 0, .09);
      if (!entry) continue;
      const { car, sound } = entry;
      this.target(voice.pan, sound.pan, .065); this.target(voice.tone, (55 + car.speed * 3 + car.index * 3) * sound.doppler, .07);
      this.target(voice.wash, 650 + car.speed * 35 + (this.journey === 'city' ? 900 : 0), .15);
      this.target(voice.rate, sound.doppler, .1);
      // Lowpass for distance.
      this.target(voice.air, Math.min(16000, 16000 * (12 / Math.max(12, sound.distance)) ** .5), .15);
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; ++this.revision;
    clearTimeout(this.suspendTimer); this.graph?.dispose();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.graph = null; this.context = null;
  }
}
