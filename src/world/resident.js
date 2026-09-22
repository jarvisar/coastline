// How much of the route stays built around the car, and how far past it the
// chunk worker keeps running.
//
// The far chunk in each direction is off-screen at every camera height: hiding
// chunk `center - 3` and chunk `center + 5` was measured pixel-for-pixel
// identical on all four routes, in the widest view, while saving eight to
// eleven per cent of the frame's draw calls. The top two quality levels keep
// them anyway, as headroom for reversing; the cheaper levels spend that
// headroom on frames, and the worker stops building scenery that would be
// dropped before it was ever shown.

const DEFAULT = { behind: 3, ahead: 5 };
let resident = DEFAULT, generation = 0;

export const residentWindow = () => resident;

export function setResidentWindow({ behind, ahead } = DEFAULT) {
  if (behind === resident.behind && ahead === resident.ahead) return;
  resident = { behind, ahead };
  // A world only reconsiders its chunks when the car crosses into a new one.
  // Bumping this makes the next update reconsider them whatever the car did.
  generation++;
}

// Bring a world's resident chunks in line with the car, taking each one from
// the worker when it is ready and building it here when it is not.
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

// Chunk contents have fixed local transforms. Only a newly attached chunk or
// a floating-origin shift invalidates its root; animated instance buffers and
// shader clocks remain independent of these object transforms.
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

// Resident chunks first, nearest the car outward and forward before back, then
// the one chunk of lead on each side that covers a boundary crossing.
export function prefetchOffsets(behind, ahead) {
  const offsets = [];
  for (let distance = 0; distance <= Math.max(behind, ahead); distance++) {
    if (distance <= ahead) offsets.push(distance);
    if (distance > 0 && distance <= behind) offsets.push(-distance);
  }
  offsets.push(ahead + 1, -behind - 1);
  return offsets;
}
