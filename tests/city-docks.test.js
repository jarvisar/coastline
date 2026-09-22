import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityDocks, dockRailingSpans } from '../src/world/city-docks.js';
import { CityChunk } from '../src/world/city.js';
import { CHUNK_LENGTH, lerp } from '../src/world/route.js';
import { cityPosition, cityGroundHeight, crossStreetAt, quayOffset, STREET_HALF_WIDTH, RIVER_LEVEL, FAR_BANK_TOP, farBankHeight, pavementHeight } from '../src/world/city-route.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

test('docks independently choose seven/eight-block gaps and either bank, with stable chunk ownership', () => {
  const sites = cityDocks(-100000, 100000);
  assert.deepEqual([...cityDocks(-100000, 0), ...cityDocks(0, 100000)], sites);
  assert.deepEqual(cityDocks(10, 10), []);
  const gaps = sites.slice(1).map((site, i) => site.block - sites[i].block);
  assert.ok(gaps.every(gap => gap === 7 || gap === 8));
  for (const gap of [7, 8]) assert.ok(gaps.some((value, i) => value === gap && gaps[i + 1] === gap), 'gaps need not alternate');
  assert.deepEqual(new Set(sites.map(site => site.bank)), new Set(['near', 'far']));
  assert.equal(new Set(sites.map(site => `${site.variant}/${site.palette}`)).size, 9, 'shape and paint vary independently');
  for (const site of [...sites].reverse()) {
    const start = Math.floor(site.s / CHUNK_LENGTH) * CHUNK_LENGTH;
    assert.deepEqual(cityDocks(start, start + CHUNK_LENGTH), [site]);
    assert.ok(Math.abs(site.s - crossStreetAt(site.s).center) > STREET_HALF_WIDTH + 12, 'landing stays clear of bridges');
    const a = site.s - 8.3, b = site.s - 6.2;
    for (let s = Math.floor(a / 4) * 4; s < b; s += 4) {
      for (const [from, to] of dockRailingSpans(s, s + 4, site.bank)) assert.ok(to <= a || from >= b);
      assert.deepEqual(dockRailingSpans(s, s + 4, site.bank === 'near' ? 'far' : 'near'), [[s, s + 4]], 'opposite railing stays closed');
    }
  }
});

test('both banks have dry dock steps, floating boats, and one owner across positive and negative chunk seams', () => {
  const sites = cityDocks(-100000, 100000), down = new THREE.Vector3(0, -1, 0);
  for (const bank of ['near', 'far']) for (const sign of [-1, 1]) {
    const site = sites.find(site => site.bank === bank && Math.sign(site.s) === sign &&
      Math.floor((site.s - 9) / CHUNK_LENGTH) !== Math.floor((site.s + 9) / CHUNK_LENGTH));
    assert.ok(site, 'exercise both banks at both signs of chunk seam');
    const owner = Math.floor(site.s / CHUNK_LENGTH), chunks = [-1, 0, 1].map(offset => new CityChunk(owner + offset));
    try {
      for (const chunk of chunks) { chunk.group.position.z = -chunk.start; chunk.group.updateMatrixWorld(true); }
      assert.equal(chunks.flatMap(chunk => chunk.features.docks).filter(dock => dock.s === site.s).length, 1);
      const original = chunks[1], mesh = original.group.getObjectByName('city-moored-boats'), matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      assert.equal(matrix.elements[13], Math.fround(RIVER_LEVEL), 'boat origin is the waterline');
      const paving = chunks.map(chunk => chunk.group.getObjectByName('city-promenade'));
      const ground = chunks.map(chunk => chunk.terrain);
      const probe = (s, u) => {
        const p = cityPosition(s, u, 150), ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z), down);
        return { surface: ray.intersectObjects(paving)[0], ground: ray.intersectObjects(ground)[0] };
      };
      const far = bank === 'far', outward = far ? 1 : -1, deck = RIVER_LEVEL + .65;
      const landing = (far ? farBankHeight(site.s - 7.25) : pavementHeight(site.s - 7.25)) + .075;
      const shore = far ? site.u : quayOffset(site.s - 7.25);
      const bottomU = shore + outward * 5.7, landingU = far ? FAR_BANK_TOP - .7 : shore + .7;
      for (const t of [.07, .3, .55, .8, .96]) {
        const s = site.s - 7.25, u = lerp(bottomU, landingU, t), hit = probe(s, u);
        assert.ok(hit.surface && hit.surface.point.y >= lerp(deck, landing, t) - .12, 'steps rise continuously to the bank');
        assert.ok(hit.surface.point.y > (hit.ground?.point.y ?? cityGroundHeight(s, u)), 'bank terrain does not cover steps');
      }
      const hit = probe(site.s, site.u + outward * 3.5);
      assert.ok(hit.surface && Math.abs(hit.surface.point.y - deck) < .001, 'deck faces upward on either bank');
      assert.ok(hit.ground.point.y < RIVER_LEVEL, 'dock projects over water');
      const matrices = mesh.instanceMatrix.array.slice(), { data, transfers } = packChunk(original);
      const restored = unpackChunk(structuredClone(data, { transfer: transfers }));
      try {
        const after = restored.group.getObjectByName('city-moored-boats');
        assert.deepEqual(restored.features.docks, original.features.docks);
        assert.equal(after.geometry, mesh.geometry); assert.equal(after.material, mesh.material);
        assert.deepEqual(after.instanceMatrix.array, matrices);
      } finally { restored.dispose(); }
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});
