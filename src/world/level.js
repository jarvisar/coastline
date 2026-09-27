import * as THREE from 'three';
import { CHUNK_LENGTH } from './route.js';
import { updateResidentChunks, positionResidentChunks } from './resident.js';
import { splitBatch, computeInstanceBounds } from './instance-batches.js';

// Shared scaffolding for every route's scenery. A route's Chunk builds one
// CHUNK_LENGTH slice of road, in a worker or on the page. Its World keeps the
// chunks around the car built and owns anything that follows the car, such as
// skies, weather and pooled lights. world/scenery.js lists each route's pair.

// Matte scenery uses Lambert shading. It looks the same as physical shading on
// rough surfaces and costs much less per pixel. Roads keep physical shading for
// their faint sheen, as do water and metal.
export const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });
export const matte = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// Flat-shaded mesh from triangle soup, optionally with vertex colours.
export function geometryFrom(vertices, colors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
// Surfaces are height fields, so the winding is forced to face up. Points are
// route-space positions; `start` shifts them into the chunk. `coordinates`
// optionally collects each point's (u, s).
export function triangle(vertices, colors, a, b, c, color, start, coordinates) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    vertices.push(p.x, p.y, p.z + start);
    if (colors) colors.push(color.r, color.g, color.b);
    if (coordinates) coordinates.push(p.u, p.s);
  }
}

const dummy = new THREE.Object3D();
// Adds items as instanced meshes, split so wide batches can still be culled.
// Each item is { p, r?, q?, scale?, color? }. A quaternion `q` overrides `r`.
export function instances(group, geometry, mat, items, name, shadows = true, ambientOcclusion = true) {
  if (!items.length) return;
  for (const part of splitBatch(items)) {
    const mesh = new THREE.InstancedMesh(geometry, mat, part.length); mesh.name = name;
    for (let i = 0; i < part.length; i++) {
      const item = part[i]; dummy.position.set(...item.p); dummy.rotation.set(...(item.r ?? [0, 0, 0]));
      if (item.q) dummy.quaternion.copy(item.q);
      dummy.scale.set(...(item.scale ?? [1, 1, 1])); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
    }
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
    computeInstanceBounds(mesh); group.add(mesh);
  }
}

export class LevelChunk {
  // Geometry in `owned` is released with the chunk. Shared geometry must be
  // registered with registerChunkResources instead.
  constructor(index, name = '') {
    this.index = index; this.start = index * CHUNK_LENGTH;
    this.group = new THREE.Group(); this.group.name = name; this.owned = [];
  }
  addMesh(geometry, material, name, shadows = false) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(geometry); return mesh;
  }
  dispose() { disposeChunk(this); }
}

// Also releases chunks built in a worker, which arrive as plain objects.
export function disposeChunk(chunk) {
  chunk.group.removeFromParent();
  for (const geometry of chunk.owned) geometry.dispose();
  chunk.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
}

export class LevelWorld {
  constructor(scene, chunkSource, Chunk) {
    this.scene = scene; this.chunkSource = chunkSource; this.Chunk = Chunk;
    this.chunks = new Map(); this.origin = 0; this.center = null;
  }
  // Keeps the chunks around `s` built. The render origin moves in 1024 m steps.
  update(s) {
    this.s = s; this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, Math.floor(s / CHUNK_LENGTH), this.Chunk);
    positionResidentChunks(this);
  }
  // Called every drawn frame with the drive clock in seconds.
  animate() {}
  dispose() {
    this.chunkSource?.dispose();
    for (const chunk of this.chunks.values()) chunk.dispose();
    this.chunks.clear();
  }
}
