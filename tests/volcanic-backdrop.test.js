import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roadHeight } from '../src/world/route.js';
import { volcanicPosition } from '../src/world/volcanic-route.js';
import { VolcanicAtmosphere } from '../src/world/volcanic-atmosphere.js';
import { CRATER } from '../src/world/volcanic-backdrop.js';

// Mirrors the overhead camera in rendering.js at its widest: scenic height,
// portrait allowance and the given aspect.
function overheadFrustum(s, origin, aspect) {
  const car = volcanicPosition(s, 0, roadHeight(s)), target = new THREE.Vector3(car.x - 24, car.y, car.z + origin - 46);
  const height = 235 * 1.12, camera = new THREE.OrthographicCamera(-height * aspect / 2, height * aspect / 2, height / 2, -height / 2, 1, 1200);
  camera.position.copy(target).add(new THREE.Vector3(-220, 245, 260)); camera.lookAt(target);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

test('the distant eruption stands beyond the fog, out of the overhead views', () => {
  const scene = new THREE.Scene(), atmosphere = new VolcanicAtmosphere(scene);
  try {
    const mountain = scene.getObjectByName('volcanic-distant-volcano'), column = scene.getObjectByName('volcanic-eruption-column');
    for (const mesh of [mountain, column]) {
      assert.equal(mesh.material.fog, false, 'haze is painted in, not left to the fog that would erase it');
      assert.equal(mesh.userData.ambientOcclusion, false);
      assert.equal(mesh.castShadow, false);
    }
    const reach = mountain.geometry.boundingSphere;
    assert.ok(reach.center.length() - reach.radius > 450, 'the foot never reaches the playable ground');
    assert.ok(CRATER.length() + 60 < 1200, 'the crater and the near flank stay inside the far plane');
    for (const s of [-1100, 24, 620, 1025, 10000]) {
      const origin = Math.floor(s / 1024) * 1024;
      atmosphere.update(12, s, origin);
      scene.updateMatrixWorld(true);
      for (const aspect of [.46, 1, 16 / 9, 2.4]) {
        const frustum = overheadFrustum(s, origin, aspect);
        // Check every mountain face and the plume's whole bounding volume.
        const p = mountain.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
          const face = new THREE.Box3().setFromBufferAttribute({ count: 3, getX: k => p.getX(i + k), getY: k => p.getY(i + k), getZ: k => p.getZ(i + k) }).applyMatrix4(mountain.matrixWorld);
          assert.equal(frustum.intersectsBox(face), false, `the mountain shows in the overhead view at ${s}`);
        }
        assert.equal(frustum.intersectsSphere(column.geometry.boundingSphere.clone().applyMatrix4(column.matrixWorld)), false, `the plume shows in the overhead view at ${s}`);
      }
    }
  } finally { atmosphere.dispose(); }
});

test('the eruption travels with the sky and releases its resources', () => {
  const scene = new THREE.Scene(), atmosphere = new VolcanicAtmosphere(scene);
  const backdrop = scene.getObjectByName('volcanic-backdrop'), meshes = ['volcanic-distant-volcano', 'volcanic-eruption-column'].map(name => scene.getObjectByName(name));
  let released = 0;
  for (const mesh of meshes) for (const resource of [mesh.geometry, mesh.material]) resource.addEventListener('dispose', () => released++);
  atmosphere.update(10, 1025, 1024);
  assert.deepEqual(backdrop.position.toArray(), atmosphere.sky.position.toArray());
  const before = backdrop.position.z;
  atmosphere.update(10, 1025, 2048);
  assert.equal(backdrop.position.z - before, 1024, 'origin shifts move the backdrop with the world');
  atmosphere.dispose();
  assert.equal(released, 4);
  assert.equal(scene.children.length, 0);
});
