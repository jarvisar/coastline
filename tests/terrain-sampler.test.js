import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { terrainSampler } from '../src/world/coastal-assets.js';

test('topmost sampling places scenery on overlapping shelves regardless of triangle order', () => {
  for (const heights of [[3, 12, 7], [12, 7, 3]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(heights.flatMap(y => [0, y, 0, 0, y, 10, 10, y, 0]), 3));
    try {
      const mesh = { geometry }, top = terrainSampler(mesh, true);
      assert.equal(top(2, 2), 12);
      assert.equal(top(20, 20), null);
      assert.equal(terrainSampler(mesh)(2, 2), heights[0], 'existing callers retain first-surface sampling');
    } finally { geometry.dispose(); }
  }
});
