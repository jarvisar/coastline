// Quality levels, starting-level detection and the adaptive frame-rate controller.
// AO is a separate opt-in setting that presets and Auto never toggle.
// Levels must not change shader light counts, which forces a recompile mid-drive.

// `density` scales the device pixel ratio so it saves pixels on 1x panels too.
// The far chunk each way is always off-screen, so cheaper levels drop it.
// High keeps it as headroom for reversing.
export const QUALITY_LEVELS = [
  { id: 'high', label: 'High', summary: 'Native resolution · sharp shadows', density: 1, shadowMap: 2048, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' },
  { id: 'balanced', label: 'Balanced', summary: '85% resolution · medium shadows', density: .85, shadowMap: 1536, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'high' },
  { id: 'smooth', label: 'Smooth', summary: '70% resolution · softer shadows', density: .7, shadowMap: 1024, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'low' },
  { id: 'basic', label: 'Basic', summary: '50% resolution · simple shadows · shortest view', density: .5, shadowMap: 512, chunks: { behind: 1, ahead: 3 }, antialias: false, aoQuality: 'low' },
];
const WORST = QUALITY_LEVELS.length - 1;
export const levelIndex = id => QUALITY_LEVELS.findIndex(level => level.id === id);

const MIN_DENSITY = .5;
export function renderScale(density, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  return devicePixelRatio * Math.max(MIN_DENSITY, Math.min(1, density));
}

// Windows long enough to average out a stutter. Settle times skip the period
// after a change while buffers, shaders and streaming warm up.
const WINDOW_MS = 1500, SETTLE_MS = 2000, FIRST_SETTLE_MS = 4000;
// Tolerates 59.94 Hz displays and the odd dropped frame.
const SLOW = .92, FAST = .97;
const SLOW_WINDOWS = 2, FAST_WINDOWS = 4;
// A step down that gains under 4% means something else sets the pace (capped
// display, busy CPU, throttled browser). Two such steps before giving up.
const WORTHWHILE = 1.04, GIVE_UP_AFTER = 2;

const STORAGE_KEY = 'coastline.graphics';

function readStored(storage) {
  try { return JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') ?? {}; }
  catch { return {}; }
}
function writeStored(storage, value) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode, quota, or no storage */ }
}
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
// Apple GPUs are left out because they aren't slow. Mesa is left out because it
// also drives discrete cards on Linux.
const INTEGRATED_RENDERER = /intel|\buhd\b|\biris\b|hd graphics|vega \d|radeon\(tm\) graphics/i;

// Cores and memory can't tell integrated from discrete GPUs, so ask for the name.
export function probeRenderer(createCanvas = () => globalThis.document?.createElement('canvas')) {
  try {
    const canvas = createCanvas();
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return '';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // Browsers cap live contexts, so release the probe's straight away.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : '';
  } catch { return ''; }
}

function displayPixels() {
  const screen = globalThis.screen;
  if (!screen?.width) return 0;
  const ratio = globalThis.devicePixelRatio || 1;
  return screen.width * screen.height * ratio * ratio;
}

// Deliberately cautious. Auto raises the level within seconds on a fast device,
// which beats starting high and stuttering.
export function detectLevel(hints = {}) {
  const nav = hints.navigator ?? globalThis.navigator ?? {};
  // Catches tablets that report as desktops. Touchscreen laptops keep a fine pointer.
  const coarsePointer = hints.coarsePointer ?? Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  const mobile = hints.mobile ?? (nav.userAgentData?.mobile === true || coarsePointer);
  const cores = hints.cores ?? nav.hardwareConcurrency ?? 0;
  // Safari has no deviceMemory, so 0 means unknown.
  const memory = hints.memory ?? nav.deviceMemory ?? 0;
  if (mobile) {
    if (cores >= 6 && (memory === 0 || memory >= 4)) return 1;
    if (cores >= 4 && memory !== 0 && memory < 2) return WORST;
    if (cores >= 4) return 2;
    return WORST;
  }
  const gpu = hints.gpu ?? probeRenderer();
  if (SOFTWARE_RENDERER.test(gpu)) return WORST;
  // One step down per weak-hardware signal.
  let steps = 0;
  if (INTEGRATED_RENDERER.test(gpu)) steps++;
  if (cores !== 0 && cores <= 4) steps++;
  if (memory !== 0 && memory <= 4) steps++;
  if ((hints.pixels ?? displayPixels()) >= 4e6) steps++;
  return Math.min(steps, WORST);
}

export class Graphics {
  constructor({ storage = defaultStorage(), ambientOcclusion = null, detect = detectLevel } = {}) {
    const stored = readStored(storage);
    this.storage = storage;
    this.listeners = new Set();
    this.detected = detect();
    const storedLevel = levelIndex(stored.level);
    this.level = storedLevel === -1 ? this.detected : storedLevel;
    this.mode = QUALITY_LEVELS.some(level => level.id === stored.mode) ? stored.mode : 'auto';
    if (this.mode !== 'auto') this.level = levelIndex(this.mode);
    // AO is on only for an explicit saved true. Older saved values don't opt in.
    // `?ao=0` overrides the saved choice for this visit.
    this.ambientOcclusion = ambientOcclusion ?? (stored.ambientOcclusion === true);
    this.densityOverride = Number.isFinite(stored.density) && stored.density >= MIN_DENSITY && stored.density <= 1 ? stored.density : null;
    // Auto never climbs back past a level it downgraded to, so it can't flicker.
    this.ceiling = 0;
    this.target = 60;
    this.refreshRate = 60;
    this.cascade = null;
    this.suspend(FIRST_SETTLE_MS);
  }

  get auto() { return this.mode === 'auto'; }
  get levelId() { return QUALITY_LEVELS[this.level].id; }
  get settings() {
    return { ...QUALITY_LEVELS[this.level], density: this.densityOverride ?? QUALITY_LEVELS[this.level].density, ambientOcclusion: this.ambientOcclusion };
  }
  // Fixed at context creation, so only the starting level's value takes effect.
  get antialias() { return QUALITY_LEVELS[this.level].antialias; }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // `reason` is 'auto' when the controller changed the level itself.
  announce(reason) { for (const listener of this.listeners) listener(this.settings, reason, this); }

  save() {
    writeStored(this.storage, { mode: this.mode, level: this.levelId, density: this.densityOverride, ambientOcclusion: this.ambientOcclusion });
  }

  setMode(mode) {
    const index = levelIndex(mode);
    if (mode !== 'auto' && index === -1) return false;
    this.mode = mode === 'auto' ? 'auto' : mode;
    // Clears adaptive history and the density override. AO is left alone.
    this.ceiling = 0; this.cascade = null; this.target = this.refreshRate;
    this.densityOverride = null;
    if (index !== -1) this.level = index;
    this.suspend();
    this.save();
    this.announce('mode');
    return true;
  }

  setDensity(density) {
    if (!Number.isFinite(density)) return false;
    // Survives later Auto level changes.
    this.densityOverride = Math.max(MIN_DENSITY, Math.min(1, density));
    this.suspend();
    this.save();
    this.announce('density');
    return true;
  }

  toggleAmbientOcclusion() {
    const enabled = !this.ambientOcclusion;
    this.ambientOcclusion = enabled;
    this.suspend();
    this.save();
    this.announce('ambient-occlusion');
    return enabled;
  }

  // Undo a run of step-downs that didn't help.
  restore({ level }) {
    const next = Math.max(0, Math.min(WORST, level));
    const changed = next !== this.level;
    this.level = next;
    this.ceiling = next;
    if (!changed) return false;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }

  // On a new route, lift the ceiling one step only so route hopping doesn't
  // walk the whole ladder. The measured target is kept.
  relax() {
    if (this.ceiling > 0) this.ceiling--;
    this.cascade = null;
    this.suspend();
  }

  suspend(settle = SETTLE_MS) {
    this.settle = settle; this.startedAt = null; this.windowStart = null;
    this.frames = 0; this.slow = 0; this.fast = 0;
    this.refreshPrevious = null; this.refreshStart = null; this.refreshIntervals = [];
  }

  // Detect high refresh displays from frame intervals. The 20th percentile sees
  // through dropped frames. Needing 30 samples ignores stray short intervals.
  observeRefresh(timestamp) {
    const previous = this.refreshPrevious;
    this.refreshPrevious = timestamp;
    this.refreshStart ??= timestamp;
    if (previous !== null && timestamp > previous) this.refreshIntervals.push(timestamp - previous);
    if (timestamp - this.refreshStart < WINDOW_MS) return;
    if (this.refreshIntervals.length >= 30) {
      this.refreshIntervals.sort((a, b) => a - b);
      const interval = this.refreshIntervals[Math.floor(this.refreshIntervals.length * .2)];
      const rate = Math.min(240, 1000 / interval);
      if (rate > this.refreshRate * 1.1) {
        this.refreshRate = rate;
        this.target = rate;
        this.fast = 0; this.slow = 0; this.cascade = null;
      }
    }
    this.refreshStart = timestamp; this.refreshIntervals.length = 0;
  }

  // `active` is false while paused, hidden or changing route.
  sample(timestamp, active) {
    if (!this.auto) return false;
    if (!active) {
      this.startedAt = null; this.windowStart = null; this.frames = 0;
      this.refreshPrevious = null; this.refreshStart = null; this.refreshIntervals.length = 0;
      return false;
    }
    this.observeRefresh(timestamp);
    this.startedAt ??= timestamp;
    if (timestamp - this.startedAt < this.settle) return false;
    if (this.windowStart === null) { this.windowStart = timestamp; this.frames = 0; return false; }
    this.frames++;
    const elapsed = timestamp - this.windowStart;
    if (elapsed < WINDOW_MS) return false;
    const fps = this.frames * 1000 / elapsed;
    this.windowStart = timestamp; this.frames = 0;
    this.fps = fps;
    return this.judge(fps);
  }

  judge(fps) {
    if (fps < this.target * SLOW) {
      this.fast = 0;
      if (++this.slow < SLOW_WINDOWS) return false;
      this.slow = 0;
      if (this.cascade) {
        if (fps >= this.cascade.fps * WORTHWHILE) {
          // Rebase on this step's rate so an early big gain can't excuse later useless steps.
          this.cascade = { level: this.level, fps, failures: 0 };
        } else if (++this.cascade.failures >= GIVE_UP_AFTER) {
          // Two useless steps. Restore the last useful level and target the rate we get.
          const cascade = this.cascade;
          this.cascade = null;
          this.target = Math.max(24, fps);
          return this.restore(cascade);
        }
      }
      if (this.level < WORST) {
        this.cascade ??= { level: this.level, fps, failures: 0 };
        return this.change(this.level + 1);
      }
      this.cascade = null;
      this.target = Math.max(24, fps);
      return false;
    }
    this.slow = 0;
    if (fps < this.target * FAST) { this.fast = 0; this.cascade = null; return false; }
    this.cascade = null;
    if (++this.fast < FAST_WINDOWS || this.level <= this.ceiling) return false;
    this.fast = 0;
    return this.change(this.level - 1);
  }

  change(level) {
    const next = Math.max(0, Math.min(WORST, level));
    if (next === this.level) return false;
    if (next > this.level) this.ceiling = next;
    this.level = next;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }
}
