import { CoastalChunk } from './environment.js';
import { DesertChunk } from './desert.js';
import { SnowChunk } from './snow.js';
import { JungleChunk } from './jungle.js';
import { PlainsChunk } from './plains.js';
import { CityChunk } from './city.js';
import { VolcanicChunk } from './volcanic.js';
import { packChunk } from './chunk-transfer.js';
export { SEED } from './route.js';

const builders = { coast: CoastalChunk, desert: DesertChunk, snow: SnowChunk, jungle: JungleChunk, plains: PlainsChunk, city: CityChunk, volcanic: VolcanicChunk };
export function buildChunk(journey, index) {
  const Builder = builders[journey];
  if (!Builder || !Number.isSafeInteger(index)) throw new Error('Invalid chunk request');
  const chunk = new Builder(index);
  try { return packChunk(chunk); }
  finally { chunk.dispose(); }
}
