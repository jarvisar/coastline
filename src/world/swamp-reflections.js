import * as THREE from 'three';
import { WATER_LEVEL } from './swamp-route.js';
import { cypressTrees, oakTrees } from './swamp-assets.js';
import { swampLandmarkGeometry } from './swamp-discovery-assets.js';

// Small silhouette models give every tree and landmark a reflection without
// rendering its moss, roots and branches a second time. One merged draw per
// resident chunk. Lit windows and lamps reflect nearly at full strength. The
// chapel stands back on dry land, where its bank would hide any reflection.
const silhouettes = new Map([...cypressTrees, ...oakTrees].map(tree => [tree.trunk, tree.reflection])
  .concat(['hollow-cypress', 'riverboat'].map(kind => [swampLandmarkGeometry[kind].body, swampLandmarkGeometry[kind].reflection])));
const luminous = new Set(['camp-windows', 'hollow-cypress-glow', 'riverboat-glow']);
const reflectedNames = new Set(['cypress-trunks', 'oak-trunks', 'dead-snags', 'fishing-camp', 'fallen-logs', 'hollow-cypress', 'riverboat', 'riverboat-wheel', ...luminous]);

export function swampReflectionGeometry(group) {
  const positions = [], colors = [], matrix = new THREE.Matrix4(), point = new THREE.Vector3(), tint = new THREE.Color();
  const append = (geometry, transform, color, luminous) => {
    const p = geometry.attributes.position, c = geometry.attributes.color;
    // Mirroring reverses winding. Reversing each triangle here keeps the
    // material single-sided and works for both plain and instanced objects.
    for (let triangle = 0; triangle < p.count; triangle += 3) for (const k of [0, 2, 1]) {
      const i = triangle + k;
      point.fromBufferAttribute(p, i).applyMatrix4(transform);
      positions.push(point.x, WATER_LEVEL * 2 - point.y, point.z);
      const strength = luminous ? .8 : .055;
      colors.push(c.getX(i) * color.r * strength, c.getY(i) * color.g * strength, c.getZ(i) * color.b * strength);
    }
  };
  group.traverse(mesh => {
    if (!reflectedNames.has(mesh.name)) return;
    const geometry = silhouettes.get(mesh.geometry) ?? mesh.geometry;
    if (mesh.isInstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        tint.set('#ffffff'); if (mesh.instanceColor) mesh.getColorAt(i, tint);
        append(geometry, matrix, tint, luminous.has(mesh.name));
      }
    } else append(geometry, mesh.matrix, tint.set('#ffffff'), luminous.has(mesh.name));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += .5;
  return geometry;
}
