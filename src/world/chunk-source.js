import { CHUNK_LENGTH, SEED } from './route.js';
import { unpackChunk } from './chunk-transfer.js';
import { residentWindow, prefetchOffsets } from './resident.js';

// Spare cores build the first view's chunks in parallel. Each worker holds its
// own copy of the route's shared scenery, so low-memory devices get fewer.
export function workerCount({ hardwareConcurrency, deviceMemory } = globalThis.navigator ?? {}) {
  const cores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 2;
  const memory = Number.isFinite(deviceMemory) ? deviceMemory : 4;
  return Math.max(1, Math.min(3, cores - 1, memory < 2 ? 1 : memory < 4 ? 2 : 3));
}

// One job per worker at a time so reversals and route switches can cancel
// queued work. Only the two chunks just outside the resident window are prefetched.
export class ChunkWorker {
  constructor(createWorker = () => new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' }), count = workerCount()) {
    this.sources = new Set(); this.queue = []; this.lanes = []; this.nextId = 0;
    this.stats = { generated: 0, consumed: 0, fallback: 0, discarded: 0 };
    for (let i = 0; i < count; i++) {
      let worker;
      try {
        worker = createWorker();
        const lane = { worker, ready: false, active: null, timeout: null };
        worker.onmessage = ({ data }) => this.receive(lane, data);
        worker.onerror = event => { event.preventDefault?.(); this.drop(lane); };
        worker.onmessageerror = () => this.drop(lane);
        worker.postMessage({ type: 'init', seed: SEED });
        this.lanes.push(lane); this.watchdog(lane);
      } catch { worker?.terminate?.(); break; } // Build with the workers that did start.
    }
  }
  // Null once every worker has stopped and chunks are built on the page.
  get worker() { return this.lanes[0]?.worker ?? null; }
  get ready() { return this.lanes.some(lane => lane.ready); }
  get active() { return this.lanes.find(lane => lane.active)?.active ?? null; }
  // A silent worker is dropped and its job handed to another.
  watchdog(lane) { clearTimeout(lane.timeout); lane.timeout = setTimeout(() => this.drop(lane, true), 20000); }
  source(journey) { const source = new ChunkSource(this, journey); this.sources.add(source); return source; }
  receive(lane, data) {
    if (!this.lanes.includes(lane)) return;
    clearTimeout(lane.timeout);
    // A different seed builds a different world, so trust no worker.
    if (data.type === 'ready' && data.seed !== SEED) { this.disable(); return; }
    if (data.type === 'ready') lane.ready = true;
    else if (data.type === 'chunk' && lane.active?.id === data.id) {
      const task = lane.active; lane.active = null; this.stats.generated++;
      if (task.source.pending.get(task.index) === task) {
        task.source.cache.set(task.index, data.chunk); task.source.pending.delete(task.index);
      } else this.stats.discarded++;
      task.resolve();
    } else { this.drop(lane); return; }
    this.pump();
  }
  // The page builds everything, with stalls, only once no workers are left.
  // A failed job isn't retried; the page builds that chunk when needed.
  drop(lane, retry = false) {
    if (!this.lanes.includes(lane)) return;
    clearTimeout(lane.timeout); lane.worker.terminate();
    this.lanes = this.lanes.filter(other => other !== lane);
    const task = lane.active; lane.active = null;
    if (!this.lanes.length) { this.disable(); return; }
    if (task && retry && task.source.pending.get(task.index) === task) this.queue.unshift(task);
    else if (task) this.cancel(task);
    this.pump();
  }
  pump() {
    for (const lane of this.lanes) {
      if (!lane.ready || lane.active) continue;
      const task = this.queue.shift();
      if (!task) return;
      lane.active = task; this.watchdog(lane);
      try { lane.worker.postMessage({ type: 'build', id: task.id, journey: task.source.journey, index: task.index }); }
      catch { this.drop(lane); return; }
    }
  }
  cancel(task) {
    if (task.source.pending.get(task.index) === task) task.source.pending.delete(task.index);
    const index = this.queue.indexOf(task); if (index !== -1) this.queue.splice(index, 1);
    task.resolve();
  }
  disable() {
    for (const lane of this.lanes) { clearTimeout(lane.timeout); lane.worker.terminate(); }
    this.lanes = [];
    for (const source of this.sources) for (const task of source.pending.values()) this.cancel(task);
    this.queue.length = 0;
  }
  dispose() { this.disable(); for (const source of this.sources) source.dispose(); }
}

class ChunkSource {
  constructor(owner, journey) { this.owner = owner; this.journey = journey; this.cache = new Map(); this.pending = new Map(); this.disposed = false; }
  async prepare(s) {
    const center = Math.floor(s / CHUNK_LENGTH), { behind, ahead } = residentWindow();
    this.prefetch(center, new Map());
    // Wait for the whole initial view. Edge prefetches may finish later since
    // normal driving has a chunk of lead time.
    await Promise.all([...this.pending.values()].filter(task => task.index >= center - behind && task.index <= center + ahead).map(task => task.done));
  }
  // Follows the resident window, so lower quality levels also prefetch less.
  prefetch(center, resident) {
    if (this.disposed) return;
    const { behind, ahead } = residentWindow(), first = center - behind - 1, last = center + ahead + 1;
    for (const index of this.cache.keys()) if (index < first || index > last || resident.has(index)) this.cache.delete(index);
    for (const task of this.pending.values()) if (task.index < first || task.index > last || resident.has(task.index) || this.cache.has(task.index)) this.owner.cancel(task);
    if (!this.owner.worker) return;
    for (const offset of prefetchOffsets(behind, ahead)) {
      const index = center + offset;
      if (resident.has(index) || this.cache.has(index) || this.pending.has(index)) continue;
      const task = { source: this, index, id: ++this.owner.nextId };
      task.done = new Promise(resolve => { task.resolve = resolve; });
      this.pending.set(index, task); this.owner.queue.push(task);
    }
    this.owner.pump();
  }
  take(index) {
    const data = this.cache.get(index); this.cache.delete(index);
    const task = this.pending.get(index); if (task) this.owner.cancel(task);
    if (data) {
      try { const chunk = unpackChunk(data); this.owner.stats.consumed++; return chunk; }
      catch { this.owner.disable(); }
    }
    this.owner.stats.fallback++;
    return null; // Caller falls back to the synchronous builder.
  }
  retain(index, chunk) {
    // The evicted chunk is next when reversing. Keep its CPU buffers in the
    // cache; its GPU resources are still released.
    if (!this.disposed && chunk.sourceData) this.cache.set(index, chunk.sourceData);
  }
  dispose() {
    this.disposed = true;
    for (const task of this.pending.values()) this.owner.cancel(task);
    this.cache.clear(); this.owner.sources.delete(this);
  }
}
