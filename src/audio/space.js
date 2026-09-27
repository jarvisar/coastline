// Renders a route's reverb into a one-shot so playback needs no reverb node.
// Damped combs and allpasses make the tail, and `echoes` add discrete
// reflections. Returns stereo: the dry sound plus `wet` of the reverb.
const COMBS = [.0297, .0371, .0411, .0437, .0253, .0331], ALLPASSES = [.0051, .0017];
export function reverberate(dry, rate, { decay = 1.5, damping = 4000, echoes = [], predelay = .012 } = {}, wet = .3) {
  const length = dry.length + Math.ceil(Math.min(decay, 2) * rate), fade = Math.round(rate * .05);
  const damp = Math.exp(-2 * Math.PI * damping / rate);
  return [0, 1].map(channel => {
    const out = new Float32Array(length), spread = channel * .0011, start = Math.round(predelay * rate);
    const combs = COMBS.map(seconds => {
      const size = Math.round((seconds + spread) * rate);
      // Each comb loses 60 dB over `decay`, its highs faster.
      return { buffer: new Float32Array(size), index: 0, feedback: 10 ** (-3 * (seconds + spread) / decay), low: 0 };
    });
    const allpasses = ALLPASSES.map(seconds => ({ buffer: new Float32Array(Math.round((seconds + spread * .3) * rate)), index: 0 }));
    const taps = echoes.map(([delay, gain]) => [Math.round((delay + predelay + spread * 3) * rate), gain * .7]);
    for (let i = 0; i < length; i++) {
      const input = i >= start && i - start < dry.length ? dry[i - start] : 0;
      let sum = 0;
      for (const comb of combs) {
        const value = comb.buffer[comb.index];
        comb.low = value * (1 - damp) + comb.low * damp;
        comb.buffer[comb.index] = input + comb.low * comb.feedback;
        if (++comb.index === comb.buffer.length) comb.index = 0;
        sum += value;
      }
      for (const pass of allpasses) {
        const value = pass.buffer[pass.index];
        pass.buffer[pass.index] = sum + value * .5;
        sum = value - sum * .5;
        if (++pass.index === pass.buffer.length) pass.index = 0;
      }
      for (const [at, gain] of taps) if (i >= at && i - at < dry.length) sum += dry[i - at] * gain;
      out[i] = sum;
    }
    // `wet` is the tail's energy against the dry sound's, whatever the decay.
    let dryEnergy = 0, wetEnergy = 0;
    for (const value of dry) dryEnergy += value * value;
    for (const value of out) wetEnergy += value * value;
    const scale = wet * Math.sqrt(dryEnergy / Math.max(1e-9, wetEnergy));
    for (let i = 0; i < length; i++) out[i] = out[i] * scale + (i < dry.length ? dry[i] : 0);
    for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
    return out;
  });
}

// Samples the route around the car twice a second: distance and direction to
// water or lava, how enclosed the road is, and whether the car is on a bridge.
const RINGS = [6, 16, 32, 60], BEARINGS = 8;
export class Surroundings {
  constructor() { this.reset(); }
  reset() { this.water = { level: 0, pan: 0 }; this.enclosure = 0; this.deck = false; this.crossed = null; this.nextSample = -Infinity; this.s = null; }
  update(player, listenerHeading, now) {
    const route = player?.route;
    if (!route?.height || !Number.isFinite(player.s) || !Number.isFinite(player.u)) return this;
    this.updateDeck(route, player);
    if (now < this.nextSample) return this;
    this.nextSample = now + .5;
    const { s, u } = player, frame = route.frame(s), scale = frame.scale ?? 1, here = route.height(s, u);
    // Nearest water per bearing, and a nearness-weighted direction for panning.
    let nearest = Infinity, x = 0, z = 0, total = 0;
    if (route.water) for (let b = 0; b < BEARINGS; b++) {
      const angle = b / BEARINGS * 2 * Math.PI, along = Math.cos(angle), across = Math.sin(angle);
      for (const ring of RINGS) {
        const ss = s + along * ring / scale, uu = u + across * ring, h = route.height(ss, uu);
        if (!route.water(ss, uu, h)) continue;
        // Height counts, so water far below a cliff is treated as distant.
        const distance = Math.hypot(ring, Math.max(0, here - h) * .7), weight = 1 / (1 + distance / 12) ** 2;
        nearest = Math.min(nearest, distance); total += weight;
        // Route offsets to world space: +s runs along the frame's heading, +u to its right.
        x += (across * Math.cos(frame.angle) + along * Math.sin(frame.angle)) * weight;
        z += (across * Math.sin(frame.angle) - along * Math.cos(frame.angle)) * weight;
        break;
      }
    }
    // Pan is limited, and water on all sides pans to the center.
    const spread = Math.hypot(x, z), side = total ? (x * Math.cos(listenerHeading) + z * Math.sin(listenerHeading)) / Math.max(1e-6, spread) * Math.min(1, spread / total * 1.2) : 0;
    this.water = { level: Number.isFinite(nearest) ? Math.max(0, 1 - nearest / 90) ** 1.5 : 0, pan: Math.max(-.6, Math.min(.6, side * .6)) };
    // Enclosure is how steeply the ground rises on each side.
    let walls = 0;
    for (const direction of [-1, 1]) {
      let wall = 0;
      for (const distance of [12, 30, 55]) wall = Math.max(wall, Math.min(1, Math.max(0, route.height(s, u + direction * distance) - here - 3) / (distance * .5)));
      walls += wall / 2;
    }
    this.enclosure = walls;
    return this;
  }
  // Checked every update so joint thumps land on time.
  updateDeck(route, player) {
    const bridge = route.bridge?.(player.s), previous = this.s;
    this.s = player.s; this.crossed = null;
    this.deck = Boolean(bridge && player.s > bridge.start && player.s < bridge.end && Math.abs(player.u) < 7.5);
    // Ignore jumps from resets and route changes.
    if (!bridge || previous === null || Math.abs(player.u) > 7.5 || Math.abs(player.s - previous) > 6) return;
    for (const joint of [bridge.start, bridge.end]) if ((previous - joint) * (player.s - joint) < 0) this.crossed = joint;
  }
}
