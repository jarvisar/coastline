// Keep asset construction off the startup path for routes that are not in use.
// Both the page and worker use these loaders, after initializing the world seed.
const loaders = {
  coast: () => import('./environment.js').then(module => ({ World: module.CoastalWorld, Chunk: module.CoastalChunk })),
  desert: () => import('./desert.js').then(module => ({ World: module.DesertWorld, Chunk: module.DesertChunk })),
  snow: () => import('./snow.js').then(module => ({ World: module.SnowWorld, Chunk: module.SnowChunk })),
  jungle: () => import('./jungle.js').then(module => ({ World: module.JungleWorld, Chunk: module.JungleChunk })),
  plains: () => import('./plains.js').then(module => ({ World: module.PlainsWorld, Chunk: module.PlainsChunk })),
  city: () => import('./city.js').then(module => ({ World: module.CityWorld, Chunk: module.CityChunk })),
  volcanic: () => import('./volcanic.js').then(module => ({ World: module.VolcanicWorld, Chunk: module.VolcanicChunk })),
};
const pending = new Map();

export function loadScenery(journey) {
  if (!Object.hasOwn(loaders, journey)) return Promise.reject(new Error('Invalid journey'));
  if (!pending.has(journey)) {
    const promise = loaders[journey]().catch(error => {
      pending.delete(journey); // A failed download must not prevent a retry.
      throw error;
    });
    pending.set(journey, promise);
  }
  return pending.get(journey);
}
