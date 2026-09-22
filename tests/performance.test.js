import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { computeInstanceBounds } from '../src/world/instance-batches.js';
import { finalizeChunkTransforms } from '../src/world/chunk-transforms.js';
import { positionResidentChunks } from '../src/world/resident.js';
import { loadScenery } from '../src/world/scenery.js';
import { buildChunk } from '../src/world/chunk-builders.js';

test('tighter instance bounds enclose rotated, scaled and mirrored geometry spheres', () => {
  const geometry = new THREE.BoxGeometry(2, 8, 3), material = new THREE.MeshBasicMaterial();
  const transform = new THREE.Object3D(), sphere = new THREE.Sphere(), matrix = new THREE.Matrix4();
  geometry.computeBoundingSphere();
  for (const count of [0, 1, 2, 25, 200]) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      transform.position.set(Math.sin(i * 17) * 130, Math.cos(i) * 45, i * 7);
      transform.rotation.set(i * .4, i * .7, i * .3);
      transform.scale.set((i % 2 ? -1 : 1) * (1 + i % 5), .5 + i % 3, 2);
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.computeBoundingSphere();
    const previousRadius = mesh.boundingSphere.radius;
    computeInstanceBounds(mesh);
    assert.ok(mesh.boundingSphere.radius <= previousRadius, 'bounds must never grow');
    for (let i = 0; i < count; i++) {
      mesh.getMatrixAt(i, matrix); sphere.copy(geometry.boundingSphere).applyMatrix4(matrix);
      assert.ok(mesh.boundingSphere.center.distanceTo(sphere.center) + sphere.radius <= mesh.boundingSphere.radius + 1e-8,
        `instance ${i} escaped the bound`);
    }
    mesh.dispose();
  }
  geometry.dispose(); material.dispose();
});

test('static chunks keep the same world pose across streaming and origin shifts without repeated matrix work', () => {
  const scene = new THREE.Scene(); scene.matrixAutoUpdate = false;
  const group = new THREE.Group(), nested = new THREE.Group(), mesh = new THREE.Object3D();
  nested.position.set(3, 7, -2); nested.rotation.y = .7; nested.scale.set(2, 1, .6);
  mesh.position.set(9, -2, 8); mesh.rotation.z = .2;
  group.add(nested); nested.add(mesh); finalizeChunkTransforms(group);
  const reference = group.clone();
  reference.traverse(object => { object.matrixAutoUpdate = true; });
  const world = { origin: 0, chunks: new Map([[8, { start: 1024, group }]]) };
  scene.add(group);
  let multiplications = 0;
  group.traverse(object => {
    const original = object.matrixWorld.multiplyMatrices;
    object.matrixWorld.multiplyMatrices = function (...args) { multiplications++; return original.apply(this, args); };
  });
  for (const origin of [0, 1024, -1024, 32768, 0]) {
    world.origin = origin; positionResidentChunks(world); scene.updateMatrixWorld();
    reference.position.z = origin - 1024; reference.updateMatrixWorld();
    assert.deepEqual(mesh.matrixWorld.elements, reference.children[0].children[0].matrixWorld.elements);
    const before = multiplications;
    for (let frame = 0; frame < 3; frame++) { positionResidentChunks(world); scene.updateMatrixWorld(); }
    assert.equal(multiplications, before, 'unchanged chunks should reuse their world matrices');
  }
  // A new chunk must be positioned even if the origin has not changed.
  const next = new THREE.Group(); next.add(new THREE.Object3D()); finalizeChunkTransforms(next);
  world.chunks.set(9, { start: 1152, group: next }); scene.add(next);
  positionResidentChunks(world); scene.updateMatrixWorld();
  assert.equal(next.children[0].matrixWorld.elements[14], -1152);
  // Ordinary dynamic scene objects still update every frame.
  const car = new THREE.Object3D(); scene.add(car); car.position.x = 42; scene.updateMatrixWorld();
  assert.equal(car.matrixWorld.elements[12], 42);
});

test('route metadata and worker startup do not construct unselected scenery', () => {
  execFileSync(process.execPath, ['--import', './tests/world-seed.js', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { JOURNEYS } = await import('./src/journeys.js');
    const { chunkResource } = await import('./src/world/chunk-resources.js');
    await import('./src/world/chunk-builders.js');
    const resources = ['coast/terrainMaterial', 'desert/stoneGeometry', 'snow/alpineRockVariants/0/rock',
      'jungle/jungleBoulders/0', 'plains/barkMaterial', 'city/terrainMaterial', 'volcanic/rockGeometry'];
    for (const key of resources) assert.throws(() => chunkResource(key), /Unknown chunk resource/);
    const { loadScenery } = await import('./src/world/scenery.js');
    const [a, b] = await Promise.all([loadScenery('coast'), loadScenery('coast')]);
    assert.equal(a, b);
    assert.ok(chunkResource(resources[0]).isMaterial);
    assert.equal(typeof a.World, 'function'); assert.equal(typeof a.Chunk, 'function');
    for (const key of resources.slice(1)) assert.throws(() => chunkResource(key), /Unknown chunk resource/);
    assert.equal(Object.keys(JOURNEYS).length, 7);
  `], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
});

test('invalid route and chunk requests fail before generation', async () => {
  for (const journey of ['missing', 'constructor', '__proto__']) {
    await assert.rejects(loadScenery(journey), /Invalid journey/);
    await assert.rejects(buildChunk(journey, 0), /Invalid journey/);
  }
  for (const index of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(buildChunk('coast', index), /Invalid chunk request/);
  }
});
