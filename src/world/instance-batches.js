import { Box3, Matrix4, Sphere, Vector3 } from 'three';

// A chunk-wide batch has a bounding sphere the frustum test almost never
// rejects. Halve wide batches along the longer axis until they can be culled.
// Compact batches are left whole since splitting only adds draw calls.
// Works on each item's `p: [x, y, z]` alone.
const BATCH_SPAN = 260, BATCH_MINIMUM = 24;

export function splitBatch(items, depth = 0) {
  if (items.length <= BATCH_MINIMUM || depth === 3) return [items]; // At most eight parts.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.p[0]); maxX = Math.max(maxX, item.p[0]);
    minZ = Math.min(minZ, item.p[2]); maxZ = Math.max(maxZ, item.p[2]);
  }
  const alongX = maxX - minX >= maxZ - minZ;
  if ((alongX ? maxX - minX : maxZ - minZ) <= BATCH_SPAN) return [items];
  const axis = alongX ? 0 : 2, middle = alongX ? (minX + maxX) / 2 : (minZ + maxZ) / 2;
  const near = items.filter(item => item.p[axis] < middle);
  if (!near.length || near.length === items.length) return [items];
  return [...splitBatch(near, depth + 1), ...splitBatch(items.filter(item => item.p[axis] >= middle), depth + 1)];
}

const bounds = new Box3(), matrix = new Matrix4(), instance = new Sphere();
const center = new Vector3(), extent = new Vector3();

// Three.js unions instance spheres in order, which leaves a loose off-centre
// bound on long batches. Keep a centred enclosing sphere when it is smaller.
// Call before adding any animation margin to the batch.
export function computeInstanceBounds(mesh) {
  mesh.computeBoundingSphere();
  if (!mesh.count || !Number.isFinite(mesh.boundingSphere.radius)) return;
  const geometrySphere = mesh.geometry.boundingSphere;
  bounds.makeEmpty();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    instance.copy(geometrySphere).applyMatrix4(matrix);
    extent.copy(instance.center).addScalar(instance.radius); bounds.expandByPoint(extent);
    extent.copy(instance.center).addScalar(-instance.radius); bounds.expandByPoint(extent);
  }
  bounds.getCenter(center);
  let radius = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    instance.copy(geometrySphere).applyMatrix4(matrix);
    radius = Math.max(radius, center.distanceTo(instance.center) + instance.radius);
  }
  radius += 1e-5; // Leave room for floating-point roundoff at a frustum plane.
  if (radius < mesh.boundingSphere.radius) mesh.boundingSphere.set(center, radius);
}
