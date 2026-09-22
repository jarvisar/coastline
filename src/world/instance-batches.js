import { Box3, Matrix4, Sphere, Vector3 } from 'three';

// One instanced batch per chunk gets a bounding sphere as wide as the chunk,
// which the frustum test can almost never reject: scenery reaches hundreds of
// metres to either side of the road, so a batch keeps drawing long after its
// plants or rocks have left the screen. Halve a wide batch along its longer
// axis until the parts are small enough to cull; leave compact batches alone,
// since splitting those would only add draw calls.
//
// Every route's scenery items carry the same `p: [x, y, z]` placement, so the
// split works on the positions alone. The instances, geometry and materials are
// unchanged, and so is the picture.
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

// Three.js incrementally unions instance spheres in placement order. That can
// leave a loose, off-center bound on long roadside batches. Try a centered
// enclosing sphere as well, and keep it only if it is smaller. Both candidates
// contain every transformed geometry sphere, including its motion allowance.
// Run at construction time, before callers add any batch-level animation margin.
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
