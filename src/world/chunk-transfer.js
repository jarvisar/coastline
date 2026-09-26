import * as THREE from 'three';
import { chunkResource, chunkResourceKey } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { CoastalBirds } from './birds.js';

const sphereData = sphere => sphere && [...sphere.center.toArray(), sphere.radius];
const boxData = box => box && [...box.min.toArray(), ...box.max.toArray()];
const readSphere = data => data && new THREE.Sphere(new THREE.Vector3().fromArray(data), data[3]);
const readBox = data => data && new THREE.Box3(new THREE.Vector3().fromArray(data), new THREE.Vector3().fromArray(data, 3));

// Transfer only chunk-owned buffers. Shared resources go by name so the main
// thread reuses its own copies, keeping custom shaders and GPU sharing intact.
export function packChunk(chunk) {
  const buffers = new Set(), owned = new Set(chunk.owned), geometries = [], geometryIndices = new Map();
  function attribute(value) {
    if (!value) return null;
    buffers.add(value.array.buffer);
    return { array: value.array, itemSize: value.itemSize, normalized: value.normalized, usage: value.usage, gpuType: value.gpuType };
  }
  function geometry(value) {
    if (!owned.has(value)) return chunkResourceKey(value);
    if (!geometryIndices.has(value)) {
      geometryIndices.set(value, geometries.length);
      geometries.push({ attributes: Object.fromEntries(Object.entries(value.attributes).map(([key, data]) => [key, attribute(data)])),
        index: attribute(value.index), sphere: sphereData(value.boundingSphere), box: boxData(value.boundingBox),
        groups: value.groups, drawRange: value.drawRange });
    }
    return geometryIndices.get(value);
  }
  function object(value) {
    const data = { name: value.name, position: value.position.toArray(), quaternion: value.quaternion.toArray(), scale: value.scale.toArray(),
      visible: value.visible, castShadow: value.castShadow, receiveShadow: value.receiveShadow,
      frustumCulled: value.frustumCulled, renderOrder: value.renderOrder, children: value.children.map(object) };
    if (value.isMesh) {
      data.geometry = geometry(value.geometry); data.material = chunkResourceKey(value.material);
      if (value.isInstancedMesh) {
        data.count = value.count; data.matrix = attribute(value.instanceMatrix); data.color = attribute(value.instanceColor);
        data.sphere = sphereData(value.boundingSphere); data.box = boxData(value.boundingBox);
      }
    }
    if (value.userData.ambientOcclusion === false) data.ambientOcclusion = false;
    if (value === chunk.terrain) data.terrain = true;
    if (value === chunk.birds?.mesh) data.birds = { phase: chunk.birds.phase, flightHeight: chunk.birds.flightHeight };
    return data;
  }
  const group = object(chunk.group);
  return { data: { start: chunk.start, index: chunk.index, features: chunk.features, group, geometries }, transfers: [...buffers] };
}

export function unpackChunk(data) {
  const chunk = { start: data.start, index: data.index, features: data.features, sourceData: data, owned: [], dispose() {
    this.group.removeFromParent();
    for (const geometry of this.owned) geometry.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  } };
  function attribute(value, instanced = false) {
    if (!value) return null;
    const Attribute = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute;
    const result = new Attribute(value.array, value.itemSize, value.normalized);
    result.setUsage(value.usage); result.gpuType = value.gpuType;
    return result;
  }
  try {
    for (const source of data.geometries) {
      const geometry = new THREE.BufferGeometry(); chunk.owned.push(geometry);
      for (const [key, value] of Object.entries(source.attributes)) geometry.setAttribute(key, attribute(value));
      geometry.setIndex(attribute(source.index)); geometry.boundingSphere = readSphere(source.sphere); geometry.boundingBox = readBox(source.box);
      geometry.groups = source.groups; geometry.drawRange = source.drawRange;
    }
    function object(source) {
      let result;
      if (source.material) {
        const geometry = typeof source.geometry === 'string' ? chunkResource(source.geometry) : chunk.owned[source.geometry];
        const material = chunkResource(source.material);
        // Construct with count 0 so Three.js skips filling an identity buffer the
        // worker's matrices would replace.
        result = source.count === undefined ? new THREE.Mesh(geometry, material) : new THREE.InstancedMesh(geometry, material, 0);
        if (result.isInstancedMesh) {
          result.count = source.count;
          result.instanceMatrix = attribute(source.matrix, true); result.instanceColor = attribute(source.color, true);
          result.boundingSphere = readSphere(source.sphere); result.boundingBox = readBox(source.box);
        }
      } else result = new THREE.Group();
      result.name = source.name; result.position.fromArray(source.position); result.quaternion.fromArray(source.quaternion); result.scale.fromArray(source.scale);
      result.visible = source.visible; result.castShadow = source.castShadow; result.receiveShadow = source.receiveShadow;
      result.frustumCulled = source.frustumCulled; result.renderOrder = source.renderOrder;
      if (source.ambientOcclusion === false) result.userData.ambientOcclusion = false;
      if (source.terrain) chunk.terrain = result;
      if (source.birds) chunk.birds = Object.assign(Object.create(CoastalBirds.prototype), source.birds, { start: chunk.start, mesh: result });
      for (const child of source.children) result.add(object(child));
      return result;
    }
    chunk.group = object(data.group);
    finalizeChunkTransforms(chunk.group);
    return chunk;
  } catch (error) {
    for (const geometry of chunk.owned) geometry.dispose();
    throw error;
  }
}
