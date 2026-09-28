import { AMBIENCE } from './profiles.js';
import { Music } from './music.js';

// Calls that sometimes get an answer from further away.
const ANSWERS = new Set(['gull', 'raven', 'owl', 'piha', 'meadowlark', 'crow', 'bullfrog', 'barredowl']);

// Schedules gusts, surf, wildlife, thunder and music. Seeded, so runs repeat.
export class SoundDirector {
  constructor() { this.seed = 0x51ca9; this.music = new Music(); this.reset(); }
  random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  reset(now = 0) {
    this.nextCall = now + 2.5; this.answers = [];
    this.nextThunder = Infinity; this.thunderDelay = 0; this.lastLightning = -Infinity; this.nextRumble = now + 25;
    this.gust = .5; this.gustTarget = .5; this.nextGust = now; this.lastUpdate = now;
    // Starts mid-wave so the ocean is audible right away.
    this.waves = [{ at: now - 1.2, size: .8, rise: 1.5 }]; this.nextWave = now + 5; this.surf = { body: 0, foam: 0 };
    this.music.reset();
  }
  update(audio, state, now, scene = null) {
    const { graph: g, journey, mix } = audio, profile = AMBIENCE[journey];
    const dt = Math.min(.25, Math.max(0, now - this.lastUpdate)); this.lastUpdate = now;
    // A new gust target every 2 to 7 seconds.
    if (now >= this.nextGust) { this.gustTarget = this.random() ** 1.5; this.nextGust = now + 2 + this.random() * 5; }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dt / 1.8));
    if (profile.water === 'surf') this.updateSurf(now);
    if (now >= this.nextCall) {
      this.nextCall = now + profile.interval[0] + this.random() * (profile.interval[1] - profile.interval[0]);
      if (mix.ambience > 0) this.call(g, profile, now, state.motion);
    }
    this.answers = this.answers.filter(answer => {
      if (answer.time > now) return true;
      if (mix.ambience > 0) this.emit(g, answer.kind, answer.level, answer.distance, answer.pan, now, state.motion, 1);
      return false;
    });
    if (profile.rain) this.weather(g, scene, now, mix);
    this.music.update(g, journey, state.motion, now, mix.music);
  }
  // Waves at irregular intervals. Each rises, breaks, then washes out.
  updateSurf(now) {
    if (now >= this.nextWave) {
      const set = this.random() < .2;
      this.waves.push({ at: now, size: (set ? .85 : .5) + this.random() * .3, rise: 1.3 + this.random() * 1.2 });
      if (this.waves.length > 4) this.waves.shift();
      this.nextWave = now + 5.5 + this.random() * 6;
    }
    let body = 0, foam = 0;
    for (const { at, size, rise } of this.waves) {
      const t = now - at;
      body += size * (t < rise ? (t / rise) ** 2 : Math.exp(-(t - rise) / 1.8));
      foam += size * (t < rise ? 0 : Math.min(1, (t - rise) / .4) * Math.exp(-Math.max(0, t - rise - .4) / 2.8));
    }
    this.surf = { body: Math.min(1.4, body), foam: Math.min(1.4, foam) };
  }
  call(g, profile, now, motion) {
    let pick = this.random() * profile.calls.reduce((sum, [, weight]) => sum + weight, 0), entry = profile.calls[0];
    for (const candidate of profile.calls) { pick -= candidate[1]; if (pick <= 0) { entry = candidate; break; } }
    const [kind, , level, near, far] = entry, distance = near + (far - near) * this.random() ** 1.5, pan = this.random() * 1.7 - .85;
    if (!this.emit(g, kind, level, distance, pan, now, motion, distance > (near + far) / 2 ? 1 : 0) || !ANSWERS.has(kind) || this.random() > .35) return;
    this.answers.push({ time: now + 1.2 + this.random() * 2.5, kind, level, distance: Math.min(far * 1.4, distance * (1.3 + this.random())), pan: Math.max(-.9, Math.min(.9, -pan * .7 + this.random() * .4 - .2)) });
  }
  // Distance sets level and cutoff. Far calls use the wetter variant.
  emit(g, kind, level, distance, pan, time, motion, variant) {
    const buffer = g.buffer(kind, variant) ?? g.buffer(kind, 1 - variant);
    return Boolean(buffer) && g.play('ambience', buffer, {
      time, pan, rate: .94 + this.random() * .12,
      level: level * .55 * Math.min(1, 18 / distance) * (1 - motion * .35),
      cutoff: Math.min(16000, Math.max(1400, 16000 * (25 / distance) ** .55)),
    });
  }
  // Thunder follows lightning after a random delay. Longer delays are quieter.
  // Distant thunder also plays every 50 to 90 seconds.
  weather(g, scene, now, mix) {
    if (scene?.lightning > .05 && now - this.lastLightning > 6) {
      this.lastLightning = now; this.thunderDelay = .6 + this.random() * 2.4; this.nextThunder = now + this.thunderDelay;
    }
    if (now >= this.nextRumble && now - this.lastLightning > 15) { this.thunderDelay = 4 + this.random() * 3; this.nextThunder = now; this.nextRumble = now + 50 + this.random() * 40; }
    if (now < this.nextThunder) return;
    this.nextThunder = Infinity;
    const buffer = g.buffer('thunder', Math.floor(this.random() * 2)) ?? g.buffer('thunder', 0), near = Math.max(0, 1 - this.thunderDelay / 7);
    if (mix.ambience > 0 && buffer) g.play('ambience', buffer, { time: now, level: .12 + near * .3, rate: .88 + this.random() * .2, pan: this.random() * 1.2 - .6, cutoff: 1200 + near * 5000 });
  }
}
