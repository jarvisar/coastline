// Stable names link worker-built meshes to the shared resources. Shader callbacks
// and clocks stay on the renderer's materials. Shared geometry is never
// transferred, which would detach it from later worker jobs.
const resources = new Map(), keys = new WeakMap();

export function registerChunkResources(prefix, values) {
  for (const [name, value] of Object.entries(values)) {
    const key = `${prefix}/${name}`;
    if (value?.isMaterial || value?.isBufferGeometry) {
      resources.set(key, value); keys.set(value, key);
    } else if (value && typeof value === 'object') registerChunkResources(key, value);
  }
}
export function chunkResourceKey(value) {
  const key = keys.get(value);
  if (!key) throw new Error('Unregistered shared chunk resource');
  return key;
}
export function chunkResource(key) {
  const value = resources.get(key);
  if (!value) throw new Error(`Unknown chunk resource: ${key}`);
  return value;
}
