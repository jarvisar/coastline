// Routes load on demand so unused ones stay off the startup path. The page and
// worker both use these, after the world seed is set.
const loaders = {
  coast: () => import('./environment.js').then(module => ({ World: module.CoastalWorld, Chunk: module.CoastalChunk })),
  desert: () => import('./desert.js').then(module => ({ World: module.DesertWorld, Chunk: module.DesertChunk })),
  snow: () => import('./snow.js').then(module => ({ World: module.SnowWorld, Chunk: module.SnowChunk })),
  jungle: () => import('./jungle.js').then(module => ({ World: module.JungleWorld, Chunk: module.JungleChunk })),
  plains: () => import('./plains.js').then(module => ({ World: module.PlainsWorld, Chunk: module.PlainsChunk })),
  city: () => import('./city.js').then(module => ({ World: module.CityWorld, Chunk: module.CityChunk })),
  volcanic: () => import('./volcanic.js').then(module => ({ World: module.VolcanicWorld, Chunk: module.VolcanicChunk })),
  salt: () => import('./salt.js').then(module => ({ World: module.SaltWorld, Chunk: module.SaltChunk })),
};
const pending = new Map();

export function loadScenery(journey) {
  if (!Object.hasOwn(loaders, journey)) return Promise.reject(new Error('Invalid journey'));
  if (!pending.has(journey)) {
    const promise = loaders[journey]().catch(error => {
      pending.delete(journey); // Allow a retry after a failed download.
      throw error;
    });
    pending.set(journey, promise);
  }
  return pending.get(journey);
}
