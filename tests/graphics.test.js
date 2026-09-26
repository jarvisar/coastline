import test from 'node:test';
import assert from 'node:assert/strict';
import { Graphics, QUALITY_LEVELS, detectLevel, levelIndex, renderScale } from '../src/graphics.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}
const stored = storage => JSON.parse(storage.map.get('coastline.graphics'));

// Fake device clock. `rates` is a fixed refresh cap or an array of the fps
// reached at each quality level, so stepping down can actually gain frames.
class Device {
  constructor(graphics, rates = 60) { this.graphics = graphics; this.rates = rates; this.time = 0; this.changes = 0; this.levels = []; this.steps = []; }
  get hz() { return typeof this.rates === 'number' ? this.rates : this.rates[levelIndex(this.graphics.levelId)]; }
  run(seconds, { hz, active = true } = {}) {
    for (let remaining = seconds * 1000; remaining > 0;) {
      const step = 1000 / (hz ?? this.hz);
      this.time += step; remaining -= step;
      if (this.graphics.sample(this.time, active)) {
        this.changes++; this.levels.push(this.graphics.levelId);
        this.steps.push(`${this.graphics.levelId}${this.graphics.settings.ambientOcclusion ? '+ao' : '-ao'}`);
      }
    }
    return this;
  }
}
const graphicsAt = (level, options = {}) => new Graphics({ storage: memoryStorage(), detect: () => level, ...options });

test('quality levels get cheaper in every dimension, from high down to basic', () => {
  const AO_COST = { low: 0, high: 1 };
  assert.deepEqual(QUALITY_LEVELS.map(level => level.id), ['high', 'balanced', 'smooth', 'basic']);
  for (let i = 1; i < QUALITY_LEVELS.length; i++) {
    const previous = QUALITY_LEVELS[i - 1], level = QUALITY_LEVELS[i];
    assert.ok(level.density < previous.density, `${level.id} density`);
    assert.ok(level.shadowMap <= previous.shadowMap, `${level.id} shadow map`);
    assert.ok(level.chunks.behind <= previous.chunks.behind, `${level.id} chunks behind`);
    assert.ok(level.chunks.ahead <= previous.chunks.ahead, `${level.id} chunks ahead`);
    assert.ok(Number(level.antialias) <= Number(previous.antialias), `${level.id} antialiasing`);
    assert.ok(AO_COST[level.aoQuality] <= AO_COST[previous.aoQuality], `${level.id} AO budget`);
  }
  assert.deepEqual({ ...QUALITY_LEVELS[0], id: undefined, label: undefined, summary: undefined },
    { id: undefined, label: undefined, summary: undefined, density: 1, shadowMap: 2048, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' });
});

test('every level removes pixels, on a 1x panel as much as on a dense one', () => {
  // Density scales the pixel ratio. A cap on it would do nothing on a 1x panel.
  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
    const scales = QUALITY_LEVELS.map(level => renderScale(level.density, devicePixelRatio));
    for (let i = 1; i < scales.length; i++) {
      assert.ok(scales[i] < scales[i - 1], `${devicePixelRatio}x: ${QUALITY_LEVELS[i].id} must draw fewer pixels than ${QUALITY_LEVELS[i - 1].id}`);
    }
    assert.equal(scales[0], devicePixelRatio, `${devicePixelRatio}x: full quality reaches native resolution`);
  }
  assert.equal(renderScale(1, 1), 1, 'full quality on a 1x panel is still 1x');
  assert.equal(renderScale(1, 3), 3, 'a 3x phone panel can render at native resolution');
  assert.equal(renderScale(2, 3), 3, 'density never exceeds native resolution');
  assert.equal(renderScale(.1, 2), 1, 'the minimum density is 50%');
});

test('detection tiers pointer devices on what they are, and touch devices cautiously', () => {
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 7800 XT', cores: 12, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) UHD Graphics 620', cores: 8, memory: 8, pixels: 2e6 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 8.3e6 }), levelIndex('balanced'), 'a 4K panel is four 1080p frames');
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) HD Graphics 4000', cores: 2, memory: 4, pixels: 1e6 }), levelIndex('basic'));
  // Software renderers.
  assert.equal(detectLevel({ mobile: false, gpu: 'ANGLE (Google, SwiftShader Device)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: false, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  // Mesa can be a discrete card, and Apple GPUs report no memory.
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), Mesa 23.0.4', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'Apple M3 Pro', cores: 12, memory: 0, pixels: 2e6 }), 0);
  // No hardware info at all starts at the top.
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 0, memory: 0, pixels: 0 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 2, memory: 1, pixels: 0 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 8, memory: 8 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: true, cores: 6, memory: 0 }), levelIndex('balanced'), 'Safari reports no deviceMemory');
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 1 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 2, memory: 0 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 0, memory: 0 }), levelIndex('basic'));
  // Tablets that report a desktop UA still count as touch.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  // Touchscreen laptops have a fine primary pointer and are tiered as laptops.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: false, gpu: 'Intel(R) Iris(R) Xe Graphics', cores: 4, memory: 4, pixels: 2e6 }), levelIndex('basic'));
});

test('a device that holds the refresh rate keeps its level, and a single hitch changes nothing', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 60).run(40);
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(.3, { hz: 12 }).run(40);
  assert.equal(display.changes, 0, 'one slow moment is not a slow device');
  assert.equal(graphics.levelId, 'high');
});

test('a slow device steps down one level at a time and never climbs back', () => {
  const graphics = graphicsAt(levelIndex('high'));
  // Only the cheapest level reaches 60.
  const phone = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.deepEqual(phone.steps, ['balanced-ao', 'smooth-ao', 'basic-ao']);
  assert.equal(graphics.levelId, 'basic');
  phone.rates = 60;
  phone.run(200);
  assert.equal(graphics.levelId, 'basic');
});

test('a cautious start climbs while the device keeps up, one level at a time', () => {
  const graphics = graphicsAt(levelIndex('basic'));
  const display = new Device(graphics, 60).run(60);
  assert.deepEqual(display.levels, ['smooth', 'balanced', 'high']);
  assert.equal(graphics.levelId, 'high');
  assert.equal(display.changes, 3, 'it stops at the top');
});

for (const refresh of [90, 120, 144]) {
  test(`Auto preserves ${refresh} Hz delivery instead of accepting any rate above 60`, () => {
    const graphics = graphicsAt(levelIndex('smooth'));
    const display = new Device(graphics, [60, refresh * .75, refresh, refresh]).run(120);
    assert.ok(Math.abs(graphics.target - refresh) < 1);
    assert.equal(graphics.levelId, 'smooth');
    assert.deepEqual(display.levels, ['balanced', 'smooth']);
    graphics.setMode('high'); graphics.setMode('auto');
    assert.ok(Math.abs(graphics.target - refresh) < 1, 'mode changes retain the measured refresh rate');
  });
}

test('Auto detects high refresh through uneven frames and ignores isolated short intervals', () => {
  const steady = graphicsAt(levelIndex('high'));
  let time = 0; steady.sample(time, true);
  for (let i = 0; i < 500; i++) steady.sample(time += (i % 30 === 0 ? 2 : 1000 / 60), true);
  assert.equal(steady.target, 60);
  const phone = graphicsAt(levelIndex('high'));
  const levels = [];
  phone.onChange(() => levels.push(phone.levelId));
  time = 0; phone.sample(time, true);
  for (let i = 0; i < 1500; i++) phone.sample(time += (i % 2 ? 1000 / 120 : 1000 / 60), true);
  assert.ok(Math.abs(phone.refreshRate - 120) < 1, 'dropped frames do not disguise a 120 Hz display as 80 Hz');
  assert.equal(levels[0], 'balanced', 'uneven high-refresh delivery triggers a downgrade');
});

test('hidden frames cannot teach Auto an artificial refresh rate', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 240).run(20, { active: false });
  display.run(20, { hz: 60 });
  assert.equal(graphics.target, 60);
  assert.equal(display.changes, 0);
});

test('a climb that turns out to be too much settles one level below it, for good', () => {
  const graphics = graphicsAt(levelIndex('smooth'));
  const device = new Device(graphics, [25, 41, 61, 61]).run(200);
  assert.equal(graphics.levelId, 'smooth');
  assert.deepEqual(device.steps, ['balanced-ao', 'smooth-ao'], 'one probe up, then the level back');
  device.run(400);
  assert.equal(graphics.levelId, 'smooth', 'no flicker between two levels');
  assert.equal(device.changes, 2);
});

test('a new route may reclaim one level, but not the whole ladder at once', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const heavy = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  // One level comes back per route change, even when the route could run them all.
  const light = new Device(graphics, 61);
  light.time = heavy.time;
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'smooth');
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'balanced');
  light.run(400);
  assert.equal(graphics.levelId, 'balanced', 'no further climb without another route change');
});

test('a capped display gets its quality back instead of being stripped for nothing', () => {
  // A 30 Hz cap. Two cheaper levels gain nothing, so the original is restored.
  const graphics = graphicsAt(levelIndex('balanced'));
  const display = new Device(graphics, 30).run(90);
  assert.equal(graphics.levelId, 'balanced');
  assert.equal(graphics.settings.ambientOcclusion, false, 'quality recovery leaves AO off');
  assert.deepEqual(display.steps, ['smooth-ao', 'basic-ao', 'balanced-ao']);
  assert.ok(graphics.target <= 31 && graphics.target >= 29, `target follows the display: ${graphics.target}`);
  display.run(300);
  assert.equal(display.changes, 3, 'and it stops probing once it knows the rate');
});

test('a genuine improvement from stepping down is kept', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const device = new Device(graphics, [30, 58, 60, 60]).run(200);
  assert.equal(graphics.levelId, 'balanced');
  assert.deepEqual(device.steps, ['balanced-ao']);
});

test('paused, hidden and route-change frames are excluded and restart the grace period', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 20).run(30, { active: false });
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(3, { hz: 20 });
  assert.equal(display.changes, 0, 'measuring restarts from the grace period');
});

test('a chosen level is pinned, adapts to nothing, and is remembered', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  graphics.setMode('high');
  assert.equal(graphics.auto, false);
  assert.equal(graphics.levelId, 'high');
  new Device(graphics, 8).run(120);
  assert.equal(graphics.levelId, 'high', 'a pinned level stays pinned');
  assert.deepEqual(stored(storage), { mode: 'high', level: 'high', density: null, ambientOcclusion: false });

  const next = new Graphics({ storage, detect: () => levelIndex('basic') });
  assert.equal(next.mode, 'high');
  assert.equal(next.levelId, 'high');
  next.setMode('auto');
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'high', 'returning to auto continues from where it is');
});

test('auto remembers the level it settled on so the next visit starts there', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('high') });
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'basic', density: null, ambientOcclusion: false });
  const next = new Graphics({ storage, detect: () => levelIndex('high') });
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'basic');
  assert.equal(next.settings.ambientOcclusion, false, 'and it is still off on the next visit');
});

test('AO defaults off and its explicit choice survives presets and reloads', () => {
  const storage = memoryStorage();
  const graphics = graphicsAt(0, { storage });
  for (const enabled of [false, true, false]) {
    if (graphics.ambientOcclusion !== enabled) graphics.toggleAmbientOcclusion();
    for (const mode of ['high', 'balanced', 'smooth', 'basic', 'auto']) {
      graphics.setMode(mode);
      assert.equal(graphics.settings.ambientOcclusion, enabled, mode);
      assert.equal(graphicsAt(0, { storage }).ambientOcclusion, enabled, 'saved independent choice');
    }
  }
});

test('custom density is remembered, survives Auto adjustments, and resets with presets', () => {
  const storage = memoryStorage();
  const graphics = graphicsAt(0, { storage });
  graphics.setDensity(.83);
  assert.equal(graphics.settings.density, .83);
  assert.equal(graphics.mode, 'auto');
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  assert.equal(graphics.settings.density, .83);
  const next = graphicsAt(0, { storage });
  assert.equal(next.settings.density, .83);
  next.toggleAmbientOcclusion();
  assert.equal(next.settings.density, .83, 'AO does not reset density');
  for (const level of QUALITY_LEVELS) {
    next.setDensity(.83);
    next.setMode(level.id);
    assert.equal(next.settings.density, level.density);
    assert.equal(stored(storage).density, null);
  }
  next.setDensity(1);
  next.setMode('auto');
  assert.equal(next.settings.density, .5, 'Auto restores the current level default');
});

test('density validates saved values and clamps user choices to the slider limits', () => {
  for (const density of [null, '0.8', -1, .49, 1.01]) {
    const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ density }) });
    assert.equal(graphicsAt(1, { storage }).settings.density, .85);
  }
  const graphics = graphicsAt(0);
  graphics.setDensity(5);
  assert.equal(graphics.settings.density, 1);
  graphics.setDensity(0);
  assert.equal(graphics.settings.density, .5);
  assert.equal(graphics.setDensity(NaN), false);
  assert.equal(graphics.setDensity(Infinity), false);
  assert.equal(graphics.settings.density, .5);
});

test('?ao=0 starts every level without soft shading, and can still be switched back', () => {
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'auto', level: 'high', ambientOcclusion: true }) });
  const graphics = new Graphics({ storage, detect: () => 0, ambientOcclusion: false });
  assert.equal(graphics.settings.ambientOcclusion, false, 'the URL beats a remembered choice');
  assert.equal(graphics.toggleAmbientOcclusion(), true);
  assert.equal(graphics.settings.ambientOcclusion, true);
});

test('changes reach listeners, and unusable storage never breaks the game', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const graphics = new Graphics({ storage: broken, detect: () => levelIndex('smooth') });
  const seen = [];
  const stop = graphics.onChange(settings => seen.push(settings.density));
  graphics.setMode('high');
  assert.deepEqual(seen, [1]);
  stop();
  graphics.setMode('basic');
  assert.deepEqual(seen, [1], 'listeners can be removed');
  assert.equal(graphics.levelId, 'basic');
});

test('a stored level that no longer exists falls back to detection', () => {
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'ludicrous', level: 'ludicrous' }) });
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  assert.equal(graphics.levelId, 'smooth');
  assert.equal(graphics.setMode('ludicrous'), false);
  assert.equal(graphics.levelId, 'smooth');
});

test('Auto adjustments and route changes never change the AO choice', () => {
  for (const enabled of [false, true]) {
    const graphics = graphicsAt(0, { ambientOcclusion: enabled });
    const device = new Device(graphics, [22, 31, 43, 61]).run(60);
    assert.equal(graphics.levelId, 'basic');
    assert.equal(graphics.ambientOcclusion, enabled);
    graphics.relax();
    device.rates = 61; device.run(90);
    assert.equal(graphics.levelId, 'smooth');
    assert.equal(graphics.ambientOcclusion, enabled);
    graphics.setMode('high'); graphics.setMode('auto');
    new Device(graphics, 30).run(90);
    assert.equal(graphics.levelId, 'high', 'a capped display restores quality');
    assert.equal(graphics.ambientOcclusion, enabled);
  }
});

test('legacy preset and adaptive AO defaults do not count as explicit opt-in', () => {
  for (const ambientOcclusion of [null, undefined, false, 'true']) {
    const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({
      mode: 'high', level: 'high', ambientOcclusion, softShading: true,
    }) });
    assert.equal(graphicsAt(0, { storage }).ambientOcclusion, false);
  }
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ ambientOcclusion: true }) });
  assert.equal(graphicsAt(0, { storage }).ambientOcclusion, true, 'explicit opt-in is preserved');
});
