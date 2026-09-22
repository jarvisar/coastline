import * as THREE from 'three';

// What the car cannot drive through. A chunk records the footprint of each
// solid thing as it stands it up, in the global coordinates the car and the
// traffic already collide in, so the list crosses from the chunk worker as
// plain data and the driving step never has to read a mesh. Positions come in
// as the chunk places them: x, and z measured from the chunk's own start.

// A rectangle turned by the object's own yaw, in the shape trafficContact reads.
export function solidBox(chunk, x, z, yaw, halfWidth, halfLength) {
  ((chunk.features ??= {}).colliders ??= []).push({ x, z: z - chunk.start, reach: Math.hypot(halfWidth, halfLength), heading: -yaw, halfWidth, halfLength });
}
// A wall or a block laid out between two points, this wide either side of the line.
export function solidSpan(chunk, a, b, halfWidth) {
  solidBox(chunk, (a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z), halfWidth, Math.hypot(b.x - a.x, b.z - a.z) / 2);
}
// A trunk, a silo, a tank: anything near enough round.
export function solidPost(chunk, x, z, radius) {
  ((chunk.features ??= {}).colliders ??= []).push({ x, z: z - chunk.start, reach: radius });
}

// Run after scenery clearances, before chunk transforms are finalized. Rocks
// use their whole outline: unlike a tree, their lowest vertices can be a point.
// Only substantial stones (3 m across, 1.5 m deep and 1 m tall) obstruct the car.
export function solidRocks(chunk, geometries) {
  const matrix = new THREE.Matrix4(), local = new THREE.Matrix4(), unturn = new THREE.Matrix4();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const point = new THREE.Vector3(), bounds = new THREE.Box3(), size = new THREE.Vector3();
  for (const mesh of chunk.group.children) {
    if (!mesh.isInstancedMesh || !geometries.includes(mesh.geometry)) continue;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      geometry.boundingBox.getSize(size).multiply(scale);
      if (Math.max(size.x, size.z) < 3 || Math.min(size.x, size.z) < 1.5 || size.y < 1) continue;
      const yaw = euler.setFromQuaternion(rotation).y;
      // Undo just the yaw, keeping the placed rock's tilt and uneven scale.
      local.copy(matrix).setPosition(0, 0, 0).premultiply(unturn.makeRotationY(-yaw));
      bounds.makeEmpty();
      const vertices = geometry.attributes.position;
      for (let j = 0; j < vertices.count; j++) bounds.expandByPoint(point.fromBufferAttribute(vertices, j).applyMatrix4(local));
      bounds.getCenter(point); bounds.getSize(size);
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      solidBox(chunk, position.x + point.x * cos + point.z * sin, position.z + point.z * cos - point.x * sin,
        yaw, size.x / 2, size.z / 2);
    }
  }
}

// The outline of a model's lowest quarter is what a car can reach: the walls
// and the trunk, not the eaves, a crown, or a turbine's nacelle overhead.
const footprints = new WeakMap();
function footprint(geometry) {
  if (!footprints.has(geometry)) {
    const position = geometry.attributes.position;
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < position.count; i++) { low = Math.min(low, position.getY(i)); high = Math.max(high, position.getY(i)); }
    const reach = low + (high - low) / 4;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > reach) continue;
      const x = position.getX(i), z = position.getZ(i);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    footprints.set(geometry, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, halfWidth: (x1 - x0) / 2, halfLength: (z1 - z0) / 2 });
  }
  return footprints.get(geometry);
}
// Whatever is placed with this geometry, position, yaw and uniform scale.
export function solidModel(chunk, geometry, p, yaw = 0, scale = 1, round = false) {
  const f = footprint(geometry), cos = Math.cos(yaw), sin = Math.sin(yaw);
  const x = p[0] + (f.x * cos + f.z * sin) * scale, z = p[2] + (f.z * cos - f.x * sin) * scale;
  if (round) solidPost(chunk, x, z, Math.max(f.halfWidth, f.halfLength) * scale);
  else solidBox(chunk, x, z, yaw, f.halfWidth * scale, f.halfLength * scale);
}
