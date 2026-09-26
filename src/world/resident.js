// How many chunks stay built around the car, and how far ahead the worker runs.
//
// The far chunk each way (center - 3 and center + 5) is off-screen at every
// camera height but costs 8-11% of draw calls. The top two quality levels keep
// it as headroom for reversing. Cheaper levels drop it and the worker skips it.

const DEFAULT = { behind: 3, ahead: 5 };
let resident = DEFAULT, generation = 0;

export const residentWindow = () => resident;

export function setResidentWindow({ behind, ahead } = DEFAULT) {
  if (behind === resident.behind && ahead === resident.ahead) return;
  resident = { behind, ahead };
  // Worlds only recheck chunks when the car enters a new one. Bumping this forces a recheck.
  generation++;
}

// Take each chunk from the worker if it's ready, otherwise build it here.
export function updateResidentChunks(world, center, Chunk) {
  if (center === world.center && world.windowAt === generation) return;
  const { behind, ahead } = resident;
  for (let i = center - behind; i <= center + ahead; i++) {
    if (!world.chunks.has(i)) { const chunk = world.chunkSource?.take(i) ?? new Chunk(i); world.chunks.set(i, chunk); world.scene.add(chunk.group); }
  }
  for (const [i, chunk] of world.chunks) if (i < center - behind || i > center + ahead) { world.chunkSource?.retain(i, chunk); chunk.dispose(); world.chunks.delete(i); }
  world.center = center; world.windowAt = generation;
  world.chunkSource?.prefetch(center, world.chunks);
}

// Chunk contents have fixed local transforms. Only a new chunk or an origin
// shift needs its root matrix updated.
export function positionResidentChunks(world) {
  for (const chunk of world.chunks.values()) {
    const group = chunk.group, z = world.origin - chunk.start;
    if (group.matrixAutoUpdate || group.position.z !== z) {
      group.position.z = z;
      group.updateMatrix();
      group.matrixAutoUpdate = false;
    }
  }
}

// Resident chunks nearest first, ahead before behind, then one extra chunk
// each side to cover a boundary crossing.
export function prefetchOffsets(behind, ahead) {
  const offsets = [];
  for (let distance = 0; distance <= Math.max(behind, ahead); distance++) {
    if (distance <= ahead) offsets.push(distance);
    if (distance > 0 && distance <= behind) offsets.push(-distance);
  }
  offsets.push(ahead + 1, -behind - 1);
  return offsets;
}
