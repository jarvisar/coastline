import { initializeWorkerSeed } from './generation.js';

// Import seeded scenery only after receiving the page's seed. Worker URLs have
// their own query string and must never choose an independent random world.
let buildChunk;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      initializeWorkerSeed(data.seed);
      const builders = await import('./chunk-builders.js');
      buildChunk = builders.buildChunk;
      self.postMessage({ type: 'ready', seed: builders.SEED });
      return;
    }
    const result = await buildChunk(data.journey, data.index);
    self.postMessage({ type: 'chunk', id: data.id, chunk: result.data }, result.transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
