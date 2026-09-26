import { stableShadowDepth } from './shadow-depth.js';

// Chunk scenery is static; water and birds animate in shaders or instance
// buffers. The root keeps auto-updating so floating-origin shifts propagate.
export function finalizeChunkTransforms(group) {
  group.traverse(object => {
    stableShadowDepth(object);
    if (object === group) return;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
}
