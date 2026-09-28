import test from 'node:test';
import assert from 'node:assert/strict';
import { Graphics, QUALITY_LEVELS, detectAmbientOcclusion, detectFrameLock, detectLevel, levelIndex, lockedRate, probeRenderer, questHeadset, renderScale, strongGpu } from '../src/graphics.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}
const stored = storage => JSON.parse(storage.map.get('coastline.graphics'));

// Fake device clock. `rates` is a fixed refresh cap, an array of the fps
// reached at each quality level, or a function of the current settings, so
// stepping down can actually gain frames.
class Device {
  constructor(graphics, rates = 60) { this.graphics = graphics; this.rates = rates; this.time = 0; this.changes = 0; this.drawn = 0; this.levels = []; this.steps = []; }
  get hz() {
    if (typeof this.rates === 'function') return this.rates(this.graphics.settings);
    return typeof this.rates === 'number' ? this.rates : this.rates[levelIndex(this.graphics.levelId)];
  }
  // Like the game loop: Lock 60fps may leave a refresh out, which Auto still sees.
  run(seconds, { hz, active = true } = {}) {
    for (let remaining = seconds * 1000; remaining > 0;) {
      const step = 1000 / (hz ?? this.hz);
      this.time += step; remaining -= step;
      const drawn = !this.graphics.skip(this.time);
      if (drawn) this.drawn++;
      if (this.graphics.sample(this.time, active, drawn)) {
        this.changes++; this.levels.push(this.graphics.levelId);
        this.steps.push(`${this.graphics.levelId}${this.graphics.settings.ambientOcclusion ? '+ao' : '-ao'}`);
      }
    }
    return this;
  }
}
const graphicsAt = (level, options = {}) => new Graphics({ storage: memoryStorage(), detect: () => level, detectAO: () => false, detectLock: () => false, ...options });
// Hardware that detection trusts with AO.
const strongAt = (level, options = {}) => graphicsAt(level, { detectAO: () => true, ...options });
// AO costs a device `cost` of its frame rate at every level.
const withAO = (rates, cost) => settings => (typeof rates === 'number' ? rates : rates[levelIndex(settings.id)]) * (settings.ambientOcclusion ? 1 - cost : 1);

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
  assert.deepEqual(stored(storage), { mode: 'high', level: 'high', density: null, ambientOcclusion: null, ambientOcclusionDropped: false, frameLock: null });

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
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'basic', density: null, ambientOcclusion: null, ambientOcclusionDropped: false, frameLock: null });
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

test('legacy saves keep their AO: true stays on, false stays off, and no choice gets the device default', () => {
  const load = (saved, detect = strongAt) => detect(0, { storage: memoryStorage({ 'coastline.graphics': JSON.stringify(saved) }) });
  for (const ambientOcclusion of [null, undefined, 'true']) {
    assert.equal(load({ mode: 'high', level: 'high', ambientOcclusion, softShading: true }).ambientOcclusion, true, `${ambientOcclusion} is no choice`);
    assert.equal(load({ mode: 'high', level: 'high', ambientOcclusion, softShading: true }, graphicsAt).ambientOcclusion, false);
  }
  // Older saves wrote false without being asked. It can't be told apart from a real choice, so it holds.
  assert.equal(load({ mode: 'auto', level: 'high', ambientOcclusion: false }).ambientOcclusion, false);
  assert.equal(load({ ambientOcclusion: true }, graphicsAt).ambientOcclusion, true, 'explicit opt-in is preserved');
  // The old controller's own drop still counts, until the player chooses.
  const dropped = load({ mode: 'auto', level: 'high', ambientOcclusion: null, softShading: false });
  assert.equal(dropped.ambientOcclusion, false);
  dropped.save();
  assert.equal(stored(dropped.storage).ambientOcclusionDropped, true, 'and migrates to the new key');
});

test('AO detection trusts strong named cards only, at the level detection would start at High', () => {
  const desktop = gpu => detectAmbientOcclusion({ mobile: false, gpu, cores: 16, memory: 8, pixels: 2e6 });
  for (const gpu of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 SUPER (0x00002702) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'NVIDIA GeForce RTX 3050 Laptop GPU', 'NVIDIA RTX A4000', 'NVIDIA GeForce GTX 1660 Ti', 'NVIDIA GeForce GTX 980, or similar',
    'NVIDIA TITAN Xp', 'AMD Radeon RX 7800 XT', 'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), Mesa 23.0.4',
    'AMD Radeon Pro W6800', 'AMD Radeon VII', 'Intel(R) Arc(TM) A770 Graphics',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', 'Apple M2 Max',
  ]) assert.equal(desktop(gpu), true, gpu);
  for (const gpu of [
    '', 'Apple GPU', 'Apple M2', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'WebKit WebGL', 'Mozilla',
    'NVIDIA GeForce GT 1030', 'NVIDIA GeForce GTX 750 Ti', 'NVIDIA GeForce GTX 1630', 'NVIDIA GeForce MX450', 'NVIDIA Quadro P2000',
    'AMD Radeon RX Vega 11 Graphics', 'AMD Radeon(TM) Vega 8 Graphics', 'AMD Radeon(TM) Graphics', 'AMD Radeon 780M Graphics',
    'AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7, DRM 3.49)', 'Intel(R) Iris(R) Xe Graphics', 'Intel(R) Arc(TM) Graphics',
    'Intel(R) Arc(TM) 140V GPU (16GB)', 'Qualcomm(R) Adreno(TM) X1-85 GPU', 'ANGLE (Google, SwiftShader Device)', 'llvmpipe (LLVM 15.0.7, 256 bits)',
  ]) assert.equal(desktop(gpu), false, gpu);
  const rtx = 'NVIDIA GeForce RTX 4070';
  assert.equal(detectAmbientOcclusion({ mobile: false, gpu: rtx, cores: 16, memory: 8, pixels: 8.3e6 }), false, 'a 4K panel starts below High');
  assert.equal(detectAmbientOcclusion({ mobile: false, gpu: rtx, cores: 4, memory: 8, pixels: 2e6 }), false, 'four cores');
  assert.equal(detectAmbientOcclusion({ mobile: false, gpu: rtx, cores: 16, memory: 4, pixels: 2e6 }), false, '4 GB');
  assert.equal(detectAmbientOcclusion({ mobile: false, gpu: rtx, cores: 16, memory: 0, pixels: 2e6 }), true, 'Firefox and Safari report no memory');
  assert.equal(detectAmbientOcclusion({ mobile: true, gpu: rtx, cores: 16, memory: 8, pixels: 2e6 }), false, 'phones');
  assert.equal(detectAmbientOcclusion({ navigator: { userAgentData: { mobile: false } }, coarsePointer: true, gpu: 'Apple M4 Pro', cores: 10, memory: 0, pixels: 2e6 }), false, 'tablets that report a desktop UA');
  // A named discrete card no longer counts as integrated for the level either.
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) Arc(TM) B580 Graphics', cores: 12, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX Vega 11 Graphics', cores: 8, memory: 8, pixels: 2e6 }), levelIndex('balanced'));
  assert.equal(strongGpu('Intel(R) Arc(TM) A380 Graphics'), true);
});

test('the renderer probe reads RENDERER first and only asks the debug extension when it is masked', () => {
  const browser = (renderer, unmasked) => {
    const calls = [];
    const gl = {
      RENDERER: 0x1F01,
      getParameter: name => name === 0x1F01 ? renderer : name === 0x9246 ? unmasked : null,
      getExtension: name => {
        calls.push(name);
        if (name === 'WEBGL_debug_renderer_info') return unmasked === undefined ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
        if (name === 'WEBGL_lose_context') return { loseContext: () => calls.push('lost') };
        return null;
      },
    };
    return { calls, canvas: () => ({ getContext: type => type === 'webgl2' ? gl : null }) };
  };
  const chrome = browser('WebKit WebGL', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(probeRenderer(chrome.canvas), 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)');
  const firefox = browser('NVIDIA GeForce GTX 980, or similar', 'NVIDIA GeForce GTX 980, or similar');
  assert.equal(probeRenderer(firefox.canvas), 'NVIDIA GeForce GTX 980, or similar');
  assert.ok(!firefox.calls.includes('WEBGL_debug_renderer_info'), 'Firefox warns when the extension is asked for');
  assert.equal(probeRenderer(browser('WebKit WebGL', 'Apple GPU').canvas), 'Apple GPU');
  assert.equal(probeRenderer(browser('WebKit WebGL').canvas), 'WebKit WebGL', 'no extension leaves the masked name, which is unknown');
  for (const probe of [chrome, firefox]) assert.equal(probe.calls.at(-1), 'lost', 'the probe context is released');
  assert.equal(probeRenderer(() => ({ getContext: () => null })), '');
  assert.equal(probeRenderer(() => { throw new Error('no canvas'); }), '');
});

test('strong hardware starts with AO, but only when the visit starts at High', () => {
  assert.equal(strongAt(levelIndex('high')).ambientOcclusion, true);
  assert.equal(graphicsAt(levelIndex('high')).ambientOcclusion, false, 'unknown hardware stays off');
  assert.equal(strongAt(levelIndex('balanced')).ambientOcclusion, false, 'detected below High');
  for (const saved of [{ mode: 'auto', level: 'smooth' }, { mode: 'basic', level: 'basic' }]) {
    const storage = memoryStorage({ 'coastline.graphics': JSON.stringify(saved) });
    assert.equal(strongAt(0, { storage }).ambientOcclusion, false, `a remembered ${saved.mode} ${saved.level} start`);
  }
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'high', level: 'high' }) });
  assert.equal(strongAt(levelIndex('balanced'), { storage }).ambientOcclusion, true, 'a pinned High start on strong hardware');
  // A default is not a choice, so nothing gets saved as one.
  const graphics = strongAt(0);
  for (const mode of ['high', 'balanced', 'smooth', 'basic', 'auto']) {
    graphics.setMode(mode);
    assert.equal(graphics.settings.ambientOcclusion, true, `presets leave default AO alone: ${mode}`);
  }
  assert.equal(stored(graphics.storage).ambientOcclusion, null);
});

test('a saved choice beats the device default both ways, and ?ao=0 beats both for one visit only', () => {
  for (const choice of [true, false]) {
    for (const make of [strongAt, graphicsAt]) {
      const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ ambientOcclusion: choice }) });
      assert.equal(make(0, { storage }).ambientOcclusion, choice);
    }
  }
  const storage = memoryStorage();
  const visit = strongAt(0, { storage, ambientOcclusion: false });
  assert.equal(visit.ambientOcclusion, false);
  visit.setMode('balanced');
  assert.equal(stored(storage).ambientOcclusion, null, '?ao=0 is not saved as a choice');
  assert.equal(strongAt(0, { storage: memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'high', level: 'high' }) }) }).ambientOcclusion, true, 'the next plain visit gets the default');
  // Switching it by hand is a choice, and is saved.
  assert.equal(visit.toggleAmbientOcclusion(), true);
  assert.equal(stored(storage).ambientOcclusion, true);
  assert.equal(visit.toggleAmbientOcclusion(), false);
  assert.equal(strongAt(0, { storage }).ambientOcclusion, false, 'an explicit off beats the default on the next visit');
});

test('the safeguard drops default AO before any level when it costs frames, and remembers', () => {
  const storage = memoryStorage();
  const graphics = strongAt(0, { storage });
  const reasons = [];
  graphics.onChange((settings, reason) => reasons.push(reason));
  // AO costs 30%: 42 fps with it, 60 without.
  const device = new Device(graphics, withAO(60, .3)).run(60);
  assert.deepEqual(device.steps, ['high-ao'], 'AO goes and High stays');
  assert.deepEqual(reasons, ['auto'], 'it is announced like any Auto change');
  device.run(200);
  assert.equal(device.changes, 1, 'and it does not come back on its own');
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'high', density: null, ambientOcclusion: null, ambientOcclusionDropped: true, frameLock: null });
  const next = strongAt(0, { storage });
  assert.equal(next.ambientOcclusion, false, 'the next visit starts without it');
  assert.equal(next.toggleAmbientOcclusion(), true, 'the player can still turn it back on');
  assert.equal(strongAt(0, { storage }).ambientOcclusion, true);
});

test('dropping AO that bought something keeps going down the levels as before', () => {
  const graphics = strongAt(0);
  const device = new Device(graphics, withAO([40, 52, 61, 61], .2)).run(120);
  assert.deepEqual(device.steps, ['high-ao', 'balanced-ao', 'smooth-ao']);
});

test('a drop that buys nothing is undone, on Auto and on a pinned level', () => {
  // A 30 Hz cap. AO and a level both gain nothing, so both come back.
  const graphics = strongAt(0);
  const capped = new Device(graphics, 30).run(90);
  assert.deepEqual(capped.steps, ['high-ao', 'balanced-ao', 'high+ao']);
  assert.equal(graphics.aoDropped, false);
  capped.run(300);
  assert.equal(capped.changes, 3, 'and it stops probing once it knows the rate');
  // A pinned level has only AO to give up, so one useless step is enough.
  const pinned = strongAt(0);
  pinned.setMode('high');
  const cappedPinned = new Device(pinned, 30).run(90);
  assert.deepEqual(cappedPinned.steps, ['high-ao', 'high+ao']);
  cappedPinned.run(300);
  assert.equal(cappedPinned.changes, 2);
});

test('on a pinned level the safeguard may drop default AO but never touches the level', () => {
  for (const mode of ['high', 'balanced', 'basic']) {
    const graphics = strongAt(0);
    graphics.setMode(mode);
    const device = new Device(graphics, withAO(12, .4)).run(120);
    assert.deepEqual(device.steps, [`${mode}-ao`], mode);
    assert.equal(graphics.levelId, mode);
    device.run(200);
    assert.equal(device.changes, 1, `${mode} stays put however slow it is`);
  }
  // Measuring for AO must not let a fast device climb out of a pinned level.
  const basic = strongAt(0);
  basic.setMode('basic');
  assert.equal(new Device(basic, 60).run(200).changes, 0);
  assert.equal(basic.levelId, 'basic');
  assert.equal(basic.ambientOcclusion, true);
  // Without default AO a pinned level measures nothing at all.
  const plain = graphicsAt(0);
  plain.setMode('high');
  assert.equal(new Device(plain, 8).run(60).changes, 0);
  assert.equal(plain.sample(1e6, true), false);
});

test('the safeguard never overrides a choice, including one made mid-verdict', () => {
  // A player's AO on is kept however slow, and Auto steps levels as it always did.
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ ambientOcclusion: true }) });
  const chosen = strongAt(0, { storage });
  const device = new Device(chosen, withAO([22, 31, 43, 61], .2)).run(90);
  assert.deepEqual(device.steps, ['balanced+ao', 'smooth+ao', 'basic+ao']);
  // Turning it back on while a drop is being judged ends the verdict.
  const graphics = strongAt(0);
  const judged = new Device(graphics, 30).run(8);
  assert.deepEqual(judged.steps, ['high-ao']);
  graphics.toggleAmbientOcclusion();
  judged.run(300);
  assert.equal(graphics.ambientOcclusion, true);
  // The cap still sends Auto on its usual level probe, but with AO on throughout.
  assert.deepEqual(judged.steps, ['high-ao', 'balanced+ao', 'smooth+ao', 'high+ao'], 'no restore undoes the choice');
  // ?ao=0 is not default AO either, so there is nothing to drop.
  const visit = strongAt(0, { ambientOcclusion: false });
  new Device(visit, 30).run(90);
  assert.equal(visit.aoDropped, false);
});

test('Lock 60fps starts on without a strong card of its own, and never applies on Quest', () => {
  assert.equal(detectFrameLock({ mobile: true, gpu: 'Adreno (TM) 750' }), true, 'phones and tablets');
  assert.equal(detectFrameLock({ mobile: false, gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }), true, 'processor graphics');
  assert.equal(detectFrameLock({ mobile: false, gpu: '' }), true, 'cards the browser won\'t name');
  assert.equal(detectFrameLock({ mobile: false, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' }), false, 'a strong card of its own');
  assert.equal(questHeadset({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0.0.0 Chrome/132.0.0.0 VR Safari/537.36' }), true);
  assert.equal(questHeadset({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' }), false);

  const storage = memoryStorage();
  const phone = new Graphics({ storage, detect: () => 1, detectLock: () => true, quest: false });
  assert.equal(phone.settings.frameLock, true);
  assert.equal(phone.toggleFrameLock(), false, 'turning it off is a choice');
  assert.equal(stored(storage).frameLock, false);
  assert.equal(new Graphics({ storage, detect: () => 1, detectLock: () => true, quest: false }).frameLock, false, 'the choice wins on the next visit');

  const headset = new Graphics({ storage: memoryStorage(), detect: () => 1, detectLock: () => true, quest: true });
  assert.equal(headset.lockAvailable, false);
  assert.equal(headset.frameLock, false, 'Quest sets its own rate');
  assert.equal(headset.toggleFrameLock(), false);
  assert.equal(headset.skip(0) || headset.skip(4), false, 'and no refresh is left out');
});

test('Lock 60fps keeps drawn frames evenly spaced near 60', () => {
  for (const [refresh, rate] of [[60, 60], [75, 75], [90, 45], [120, 60], [144, 72], [165, 55], [240, 60]]) {
    assert.ok(Math.abs(lockedRate(refresh) - rate) < 1e-9, `${refresh} Hz locks to ${rate}`);
    const graphics = graphicsAt(0, { detectLock: () => true }), drawn = [];
    for (let i = 0; i < refresh * 2; i++) if (!graphics.skip(i * 1000 / refresh)) drawn.push(i);
    const gaps = new Set(drawn.slice(1).map((frame, i) => frame - drawn[i]));
    assert.deepEqual([...gaps], [refresh / rate], `${refresh} Hz draws every ${refresh / rate} refreshes`);
  }
  const unlocked = graphicsAt(0);
  for (let i = 0; i < 240; i++) assert.equal(unlocked.skip(i * 1000 / 144), false, 'unlocked, every refresh is drawn');
});

test('Auto aims for the locked rate, so a 120 Hz phone keeps its quality at 60', () => {
  const graphics = graphicsAt(levelIndex('high'), { detectLock: () => true });
  const phone = new Device(graphics, 120).run(60);
  assert.equal(phone.changes, 0, 'drawing 60 on a 120 Hz screen is not falling behind');
  assert.ok(Math.abs(graphics.refreshRate - 120) < 1 && Math.abs(graphics.target - 60) < 1);
  assert.ok(Math.abs(phone.drawn / 60 - 60) < 1, 'about 60 frames a second are drawn');
  graphics.toggleFrameLock();
  assert.ok(Math.abs(graphics.target - 120) < 1, 'unlocked, it aims for the screen again');
  const slow = graphicsAt(levelIndex('high'), { detectLock: () => true });
  const heavy = new Device(slow, [50, 61, 61, 61]).run(60);
  assert.ok(heavy.changes > 0 && slow.levelId !== 'high', 'a device that can\'t hold 60 still steps down');
});
