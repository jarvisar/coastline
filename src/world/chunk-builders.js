import { loadScenery } from './scenery.js';
import { packChunk } from './chunk-transfer.js';
export { SEED } from './route.js';

export async function buildChunk(journey, index) {
  if (!Number.isSafeInteger(index)) throw new Error('Invalid chunk request');
  const { Chunk: Builder } = await loadScenery(journey);
  const chunk = new Builder(index);
  try { return packChunk(chunk); }
  finally { chunk.dispose(); }
}
