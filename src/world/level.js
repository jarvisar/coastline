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
  g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
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

// Bounds of a chunk's meshes relative to the chunk group, which only ever moves
// with the render origin. Spheres already cover any movement: moving meshes pad
// theirs, or turn frustum culling off and are left out. Boxes don't, so one is
// only used for a mesh that can't move: a box from its static build, fixed
// instances and a shader that leaves positions alone. Shader hooks that only pass
// values to the fragment shader don't mention the vertex position or projection.
const box = new THREE.Box3(), sphere = new THREE.Sphere(), matrix = new THREE.Matrix4();
const view = new THREE.Frustum(), light = new THREE.Frustum();
const reshapes = material => material.isShaderMaterial || (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  && /transformed|gl_Position|mvPosition/.test(material.onBeforeCompile.toString()));
const still = (object, source) => Boolean(source.boundingBox) && !reshapes(object.material)
  && object.instanceMatrix?.usage !== THREE.DynamicDrawUsage;
function chunkBounds(group) {
  const bounds = [], offset = group.position;
  group.updateMatrixWorld(true);
  group.traverse(object => {
    if (!object.isMesh || !object.frustumCulled || !object.visible || Array.isArray(object.material)) return;
    const source = object.isInstancedMesh ? object : object.geometry;
    if (!source.boundingSphere) source.computeBoundingSphere();
    sphere.copy(source.boundingSphere).applyMatrix4(object.matrixWorld);
    if (!Number.isFinite(sphere.radius)) return;
    sphere.center.sub(offset);
    let fixed = null;
    if (still(object, source)) {
      fixed = box.copy(source.boundingBox).applyMatrix4(object.matrixWorld).clone();
      fixed.min.sub(offset); fixed.max.sub(offset);
    }
    bounds.push({ object, box: fixed, center: sphere.center.clone(), radius: sphere.radius, fogged: object.material.fog === true });
  });
  return bounds;
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
    // Chunk groups added since the renderer last compiled their shaders.
    this.arrivals = [];
    // Set by routes with a painted sky or a far backdrop, which fogged scenery
    // still hides, so it has to keep drawing. See cull().
    this.backdrop = false;
    this.culled = [];
  }
  // Hides chunk meshes that can't show, before each draw. Three.js culls with
  // bounding spheres, and a terrain strip hundreds of metres wide has one that
  // reaches far off-screen, so boxes catch more. Driving views also fog to the
  // background colour by `far` metres of view depth (0 in overhead views), so a
  // mesh wholly beyond that shows nothing either. A caster stays while it can
  // still shade the view. Each hidden mesh saves its draws, twice over in VR.
  cull(camera, shadowCamera, far) {
    for (const object of this.culled) object.visible = true;
    this.culled.length = 0;
    view.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    light.setFromProjectionMatrix(matrix.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse));
    const fog = far > 0 && !this.backdrop, e = camera.matrixWorldInverse.elements;
    for (const chunk of this.chunks.values()) {
      const offset = chunk.group.position;
      for (const bound of chunk.bounds ??= chunkBounds(chunk.group)) {
        sphere.center.addVectors(bound.center, offset); sphere.radius = bound.radius;
        if (bound.box) { box.min.addVectors(bound.box.min, offset); box.max.addVectors(bound.box.max, offset); }
        let hidden = bound.box ? !view.intersectsBox(box) : false;
        if (!hidden && fog && bound.fogged) {
          const { x, y, z } = sphere.center;
          hidden = -(e[2] * x + e[6] * y + e[10] * z + e[14]) - bound.radius > far;
        }
        if (hidden && bound.object.castShadow && (bound.box ? light.intersectsBox(box) : light.intersectsSphere(sphere))) hidden = false;
        if (hidden && bound.object.visible) { bound.object.visible = false; this.culled.push(bound.object); }
      }
    }
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
