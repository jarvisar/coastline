import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solidRocks } from '../src/world/colliders.js';
import { trafficContact } from '../src/traffic.js';
import { collideScenery } from '../src/collision.js';
import { DrivingController } from '../src/vehicle.js';
import { CoastalChunk } from '../src/world/environment.js';
import { DesertChunk } from '../src/world/desert.js';
import { SnowChunk } from '../src/world/snow.js';
import { JungleChunk } from '../src/world/jungle.js';
import { VolcanicChunk } from '../src/world/volcanic.js';
import { SaltChunk } from '../src/world/salt.js';
import { snowBridgeAt, snowDrivingRoute } from '../src/world/snow-route.js';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { chunkResource } from '../src/world/chunk-resources.js';
import { buildChunk } from '../src/world/chunk-builders.js';

test('rock footprints follow offset, tilted, unevenly scaled geometry and skip small stones', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2).translate(.3, 0, -.2);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 4);
  const pose = new THREE.Object3D();
  for (const [i, scale] of [[0, [2, 1.5, 1]], [1, [.4, .4, .4]], [2, [2, .2, 1]], [3, [.8, .8, .8]]]) {
    pose.position.set(10 + i * 20, 2, 40); pose.rotation.set(.2, .7, -.15); pose.scale.set(...scale); pose.updateMatrix();
    mesh.setMatrixAt(i, pose.matrix);
  }
  const chunk = { start: 128, group: new THREE.Group() }; chunk.group.add(mesh);
  solidRocks(chunk, [geometry]);
  assert.equal(chunk.features.colliders.length, 1, 'pebbles, low slabs and small rocks stay passable');
  const solid = chunk.features.colliders[0], matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
  mesh.getMatrixAt(0, matrix);
  const across = [], along = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    vertex.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(matrix);
    const dx = vertex.x - solid.x, dz = vertex.z - chunk.start - solid.z;
    across.push(dx * Math.cos(solid.heading) + dz * Math.sin(solid.heading));
    along.push(dx * Math.sin(solid.heading) - dz * Math.cos(solid.heading));
  }
  for (const [values, half] of [[across, solid.halfWidth], [along, solid.halfLength]]) {
    assert.ok(Math.abs(Math.max(...values) - half) < 1e-6);
    assert.ok(Math.abs(Math.min(...values) + half) < 1e-6);
  }
  mesh.dispose(); mesh.material.dispose(); geometry.dispose();
});

test('large rocks in each rocky journey are solid and their collision survives worker transfer', async () => {
  const scenes = [
    ['coast', CoastalChunk, ['rockGeometry', 'coastalCrags/0', 'coastalCrags/1', 'coastalCrags/2']],
    ['desert', DesertChunk, ['stoneGeometry', 'slabGeometry']],
    ['snow', SnowChunk, [0, 1, 2, 3].map(i => `alpineRockVariants/${i}/rock`)],
    ['jungle', JungleChunk, [0, 1, 2].map(i => `jungleBoulders/${i}`)],
    ['volcanic', VolcanicChunk, ['rockGeometry']],
    ['salt', SaltChunk, [0, 1, 2].map(i => `saltBoulders/${i}`)],
  ];
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion(), size = new THREE.Vector3();
  for (const [journey, Chunk, keys] of scenes) {
    const geometries = keys.map(key => chunkResource(`${journey}/${key}`));
    const chunk = new Chunk(3); let count = 0;
    for (const mesh of chunk.group.children) {
      if (!mesh.isInstancedMesh || !geometries.includes(mesh.geometry)) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); matrix.decompose(p, q, scale);
        mesh.geometry.boundingBox.getSize(size).multiply(scale);
        if (Math.max(size.x, size.z) < 3 || Math.min(size.x, size.z) < 1.5 || size.y < 1) continue;
        count++;
        const car = { x: p.x, z: p.z - chunk.start, heading: 0, halfWidth: .1, halfLength: .1 };
        assert.ok(chunk.features.colliders.some(solid => solid.heading !== undefined && trafficContact(car, solid)), `${journey}: rock ${i} is not solid`);
      }
    }
    assert.ok(count > 5, `${journey}: only checked ${count} boulders`);
    assert.deepEqual((await buildChunk(journey, 3)).data.features.colliders, chunk.features.colliders);
    chunk.dispose();
  }
});

test('snow guardrails and both trestle railings have continuous collision along the visible beams', () => {
  const bridge = snowBridgeAt(0), indices = new Set([3, Math.floor(bridge.start / CHUNK_LENGTH), Math.floor(bridge.end / CHUNK_LENGTH)]);
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion();
  let metal = 0, timber = 0;
  for (const index of indices) {
    const chunk = new SnowChunk(index);
    for (const mesh of chunk.group.children) {
      if (!['guardrails-and-lamps', 'trestle-snow'].includes(mesh.name)) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); matrix.decompose(p, q, scale);
        // Guardrail beams are .3 m wide; lamps, posts and arms differ.
        if (Math.abs(scale.x - .3) > 1e-5 || scale.y < 1) continue;
        if (mesh.name === 'trestle-snow') timber++; else metal++;
        for (const t of [-.49, 0, .49]) {
          p.set(0, t, 0).applyMatrix4(matrix);
          const probe = { x: p.x, z: p.z - chunk.start, heading: 0, halfWidth: .02, halfLength: .02 };
          assert.ok(chunk.features.colliders.some(solid => solid.heading !== undefined && solid.halfWidth < .2 && trafficContact(probe, solid)), `gap in ${mesh.name} at chunk ${index}, beam ${i}`);
        }
      }
    }
    chunk.dispose();
  }
  assert.ok(metal > 20 && timber > 4, `checked ${metal} guardrails and ${timber} bridge rails`);
});

test('a free-driving car stops at a snow guardrail and can reverse away', () => {
  const chunk = new SnowChunk(3), chunks = new Map([[3, chunk]]);
  const car = new DrivingController(snowDrivingRoute, { s: chunk.start + 10 });
  car.toggleFreeDriving(); car.u = -2; car.heading = snowDrivingRoute.frame(car.s).angle - Math.PI / 2; car.update(0, {});
  for (let i = 0; i < 360; i++) { car.update(1 / 60, { forward: true }); collideScenery(car, chunks, 1 / 60); }
  assert.ok(car.u > -7.2 && car.u < -3, `car crossed the guardrail at u=${car.u}`);
  assert.ok(Math.abs(car.speed) < 1 && car.audioTelemetry.impactSerial > 0);
  const stopped = car.u;
  for (let i = 0; i < 120; i++) { car.update(1 / 60, { brake: true }); collideScenery(car, chunks, 1 / 60); }
  assert.ok(car.u > stopped + 1, 'car can reverse away from the rail');
  car.disposeModel(); chunk.dispose();
});
