import { callRate, renderCall } from './calls.js';
import { LOOP_RATE, renderLoop } from './nature.js';
import { reverberate } from './space.js';
import { noiseChannels, textureChannels } from './textures.js';
import { engineTakes } from './engine.js';

// Renders a sound as plain channel data. Calls include the route's reverb
// unless `wet` is zero. An engine job returns its six takes as separate channels.
export function renderJob(job) {
  if (job.type === 'noise') return { rate: job.rate, channels: noiseChannels(job.rate) };
  if (job.type === 'texture') return { rate: job.rate, channels: textureChannels(job.rate, job.kind) };
  if (job.type === 'engine') return { rate: job.rate, channels: engineTakes(job.rate, job.profile) };
  if (job.type === 'loop') return { rate: LOOP_RATE, channels: renderLoop(job.kind, job.seed) };
  const rate = callRate(job.kind), dry = renderCall(job.kind, job.seed);
  return { rate, channels: job.wet ? reverberate(dry, rate, job.space, job.wet) : [dry] };
}

// Only when loaded as a worker.
if (typeof WorkerGlobalScope !== 'undefined') self.onmessage = ({ data: { id, job } }) => {
  const result = renderJob(job);
  self.postMessage({ id, result }, result.channels.map(data => data.buffer));
};
