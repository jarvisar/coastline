import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { waterfrontSiteForBlock } from '../src/world/city-waterfront.js';
import { cityDocks } from '../src/world/city-docks.js';
import { cityParkingAt, cityParkingWidth } from '../src/world/city-parking.js';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { blockBoundary, quayOffset, cityPosition, pavementHeight, STREET_HALF_WIDTH } from '../src/world/city-route.js';
import { CityChunk } from '../src/world/city.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

const sites = Array.from({ length: 180 }, (_, i) => waterfrontSiteForBlock(i - 90)).filter(Boolean);

test('waterfront rooms retain a continuous riverwalk and keep parking, bridges and dock approaches open', () => {
  assert.deepEqual(new Set(sites.map(site => site.kind)), new Set(['terrace', 'pergola']));
  for (const site of [...sites].reverse()) {
    assert.deepEqual(waterfrontSiteForBlock(site.block), site, 'layout is independent of generation order');
    assert.ok(site.s - site.half > blockBoundary(site.block) + STREET_HALF_WIDTH + 4);
    assert.ok(site.s + site.half < blockBoundary(site.block + 1) - STREET_HALF_WIDTH - 4);
    for (let s = site.s - site.half; s <= site.s + site.half; s += .5) {
      assert.ok(site.u0 - quayOffset(s) >= 4, 'leave the stone walk clear of the entire room');
      assert.ok(site.u1 < -(cityParkingAt(s) ? cityParkingWidth(s) + 3 : 11), 'keep the roadside walk and parking clear');
    }
    assert.ok(!cityDocks(site.s - site.half - 12, site.s + site.half + 12).some(dock => dock.bank === 'near'), 'keep access to moorings open');
  }
});

test('waterfront places have one owner across chunk seams, solid posts, and transferable scenery', () => {
  for (const sign of [-1, 1]) {
    const site = sites.find(site => site.kind === 'pergola' && Math.sign(site.s) === sign &&
      Math.floor((site.s - site.half) / CHUNK_LENGTH) !== Math.floor((site.s + site.half) / CHUNK_LENGTH));
    assert.ok(site, 'exercise pergolas spanning both signs of chunk seam');
    const owner = Math.floor(site.s / CHUNK_LENGTH), chunks = [-1, 0, 1].map(offset => new CityChunk(owner + offset));
    try {
      assert.equal(chunks.flatMap(chunk => chunk.features.waterfront).filter(place => place.block === site.block).length, 1);
      const chunk = chunks[1];
      const post = cityPosition(site.s - site.half * .53, site.u0 + .75, 0);
      assert.ok(chunk.features.colliders.some(c => Math.hypot(c.x - post.x, c.z - post.z) < .05 && c.reach < .3), 'pergola posts are solid');
      for (const c of chunks) { c.group.position.z = -c.start; c.group.updateMatrixWorld(true); }
      const paving = chunks.map(c => c.group.getObjectByName('city-promenade'));
      for (let s = site.s - site.half; s <= site.s + site.half; s += 1.3) {
        const p = cityPosition(s, quayOffset(s) + 2.6, 100);
        const hit = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, -1, 0)).intersectObjects(paving)[0];
        assert.ok(hit && Math.abs(hit.point.y - pavementHeight(s) - .038) < .035, 'riverwalk paving stays at ground level through the seam');
      }
      const { data, transfers } = packChunk(chunk), restored = unpackChunk(structuredClone(data, { transfer: transfers }));
      try {
        assert.deepEqual(restored.features.waterfront, chunk.features.waterfront);
        assert.deepEqual(restored.features.colliders, chunk.features.colliders);
        assert.equal(restored.group.getObjectByName('city-promenade').geometry.attributes.position.count,
          chunk.group.getObjectByName('city-promenade').geometry.attributes.position.count);
      } finally { restored.dispose(); }
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});
