import { callRate, renderCall } from './calls.js';
import { LOOP_RATE, renderLoop } from './nature.js';
import { reverberate } from './space.js';

// Renders a sound as plain channel data. Calls include the route's reverb
// unless `wet` is zero.
export function renderJob(job) {
  if (job.type === 'loop') return { rate: LOOP_RATE, channels: renderLoop(job.kind, job.seed) };
  const rate = callRate(job.kind), dry = renderCall(job.kind, job.seed);
  return { rate, channels: job.wet ? reverberate(dry, rate, job.space, job.wet) : [dry] };
}

// Only when loaded as a worker.
if (typeof WorkerGlobalScope !== 'undefined') self.onmessage = ({ data: { id, job } }) => {
  const result = renderJob(job);
  self.postMessage({ id, result }, result.channels.map(data => data.buffer));
};
