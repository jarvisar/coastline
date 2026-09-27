// Renders generated sounds in a worker, which is closed once it has no jobs.
// Without workers, sounds render on the page one per task.
export class AudioAssets {
  constructor(createWorker = () => new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker; this.worker = null; this.jobs = new Map(); this.nextId = 0; this.timer = null;
    this.failed = typeof Worker === 'undefined';
  }
  // Resolves with { rate, channels }. Cancelled jobs never resolve.
  render(job) {
    return new Promise(resolve => {
      const id = ++this.nextId;
      this.jobs.set(id, { job, resolve });
      if (this.failed) { this.fallback(); return; }
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = ({ data }) => this.receive(data);
          this.worker.onerror = event => { event.preventDefault?.(); this.fail(); };
        }
        this.worker.postMessage({ id, job });
      } catch { this.fail(); }
    });
  }
  receive({ id, result }) {
    const task = this.jobs.get(id);
    if (!task) return;
    this.jobs.delete(id); task.resolve(result);
    if (!this.jobs.size) this.stopWorker();
  }
  fail() { this.stopWorker(); this.failed = true; this.fallback(); }
  fallback() {
    if (this.timer || !this.jobs.size) return;
    this.timer = setTimeout(async () => {
      const { renderJob } = await import('./render-worker.js');
      this.timer = null;
      const next = this.jobs.entries().next().value;
      if (!next) return;
      this.jobs.delete(next[0]); next[1].resolve(renderJob(next[1].job));
      this.fallback();
    }, 0);
  }
  stopWorker() { this.worker?.terminate(); this.worker = null; }
  // Drops queued work, for example after a route change.
  cancel() { this.jobs.clear(); this.stopWorker(); }
  dispose() { this.cancel(); clearTimeout(this.timer); this.timer = null; }
}
