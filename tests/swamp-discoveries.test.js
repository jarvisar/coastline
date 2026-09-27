import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { swampDiscoveries, swampDiscoveryNear, SWAMP_DISCOVERY_MILES, SWAMP_DISCOVERY_SPACING } from '../src/world/swamp-discoveries.js';
import { SwampChunk } from '../src/world/swamp.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

test('swamp camps use the discovery schedule and remain stable across reversed queries and cache eviction', () => {
  assert.equal(SWAMP_DISCOVERY_MILES['fishing-camp'], 2.5);
  const sites = swampDiscoveries(-1000000, 1000000), reversed = [];
  for (let end = 1000000; end > -1000000; end -= 2107) reversed.push(...swampDiscoveries(Math.max(-1000000, end - 2107), end));
  assert.deepEqual(reversed.sort((a, b) => a.s - b.s), sites);
  for (const [i, site] of sites.entries()) {
    assert.equal(site.kind, 'fishing-camp');
    if (i) assert.ok(site.s - sites[i - 1].s > SWAMP_DISCOVERY_SPACING * .3);
    assert.equal(swampDiscoveryNear(site.s, site.u)?.index, site.index);
    assert.equal(swampDiscoveryNear(site.s + 50, site.u), null);
    assert.deepEqual(swampDiscoveries(site.s, site.s + 1), [site]);
    assert.deepEqual(swampDiscoveries(site.s - 1, site.s), []);
  }
});

test('each camp has one owning chunk, including its dock, windows, reflection and discovery metadata after transfer', () => {
  for (const site of swampDiscoveries(-12000, 12000)) {
    const index = Math.floor(site.s / CHUNK_LENGTH);
    for (const neighbor of [-1, 0, 1]) {
      const chunk = new SwampChunk(index + neighbor), packed = packChunk(chunk), restored = unpackChunk(packed.data);
      const owned = restored.features.discoveries.filter(camp => camp.index === site.index);
      assert.equal(owned.length, neighbor === 0 ? 1 : 0);
      if (neighbor === 0) {
        assert.deepEqual(owned, [site]);
        assert.ok(restored.group.getObjectByName('fishing-camp'));
        assert.ok(restored.group.getObjectByName('camp-windows'));
        assert.ok(restored.group.getObjectByName('swamp-reflections').geometry.attributes.position.count > 0);
      } else assert.equal(restored.group.getObjectByName('fishing-camp'), undefined);
      chunk.dispose(); restored.dispose();
    }
  }
});
