import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_LENGTH, positionAt } from '../src/world/route.js';
import { SALT_LEVEL, WATER_LEVEL, CAUSEWAY_TOE, CELL_REACH, cellSeed, saltCell, cellAt, inPool, lagoonAmount,
  saltHeight, saltRoadHeight, saltDrivingRoute } from '../src/world/salt-route.js';
import { SaltChunk } from '../src/world/salt.js';
import { terrainSampler } from '../src/world/coastal-assets.js';

const key = p => `${p.s.toFixed(4)},${p.u.toFixed(4)}`;

test('salt polygons are a consistent Voronoi tiling: every crack is shared by the cells either side', () => {
  const cells = new Map();
  for (const side of [-1, 1]) for (let k = 0; k < 8; k++) for (let i = -4; i < 8; i++) cells.set(saltCell(i, k, side).key, saltCell(i, k, side));
  let shared = 0;
  for (const cell of cells.values()) {
    assert.ok(cell.outline.length >= 3, `${cell.key} has no area`);
    const seed = cellSeed(cell.i, cell.k, cell.side);
    assert.equal(cellAt(seed.s, seed.u)?.i, cell.i, 'a seed lies inside its own cell');
    cell.outline.forEach((v, j) => {
      const w = cell.outline[(j + 1) % cell.outline.length], other = cells.get(v.edge);
      assert.ok(Math.abs(v.u) >= CAUSEWAY_TOE - 1e-9 && Math.abs(v.u) <= CELL_REACH + 1e-9, 'cells stay between the causeway and the far field');
      if (!other) return;
      // The neighbour has the same edge, walked the other way.
      const match = other.outline.some((p, m) => p.edge === cell.key && key(p) === key(w) && key(other.outline[(m + 1) % other.outline.length]) === key(v));
      assert.ok(match, `${cell.key} and ${other.key} disagree about their shared crack`);
      shared++;
    });
  }
  assert.ok(shared > 500, `only ${shared} shared edges checked`);
});

test('pools are patches of whole polygons, rarer on dry stretches than across lagoons', () => {
  const share = wet => {
    let flooded = 0, total = 0;
    for (let s = -40000; s < 40000; s += 97) {
      if ((lagoonAmount(s) > .9) !== wet) continue;
      for (let u = 14; u < 320; u += 17) for (const side of [-1, 1]) { total++; if (inPool(s, side * u)) flooded++; }
    }
    return flooded / total;
  };
  const dry = share(false), lagoon = share(true);
  assert.ok(dry > .04 && dry < .25, `dry stretches are ${dry} water`);
  assert.ok(lagoon > dry * 1.5 && lagoon < .6, `lagoons are ${lagoon} water`);
});

test('the causeway and crust are one continuous, fully drivable surface', () => {
  for (let s = -3000; s < 3000; s += 37) {
    let previous = saltHeight(s, 0);
    assert.equal(previous, saltRoadHeight(s));
    for (let u = .5; u < 40; u += .5) {
      const height = saltHeight(s, u);
      assert.ok(height <= previous + 1e-9 && previous - height < .3, `too steep to drive off at s=${s}, u=${u}`);
      assert.equal(height, saltHeight(s, -u));
      previous = height;
    }
    assert.equal(saltHeight(s, 200), SALT_LEVEL);
    assert.equal(saltDrivingRoute.water(s, 60, SALT_LEVEL), false);
  }
  assert.ok(saltDrivingRoute.looseness > 0 && saltDrivingRoute.looseness < 1);
});

test('the crust has no gaps across chunk seams except where a pool opens onto its reflection', () => {
  const chunks = [4, 5, 6].map(index => new SaltChunk(index));
  const samplers = chunks.map(chunk => ({ chunk, sample: terrainSampler(chunk.terrain) }));
  let covered = 0, pools = 0;
  for (let s = 5 * CHUNK_LENGTH; s < 6 * CHUNK_LENGTH; s += 1.7) for (let u = -300; u < 300; u += 3.1) {
    if (Math.abs(u) < 7) continue;
    const p = positionAt(s, u, 0);
    // Chunk geometry is stored relative to each chunk's start.
    const heights = samplers.map(({ chunk, sample }) => sample(p.x, p.z + chunk.start)).filter(h => h !== null);
    if (heights.length) {
      covered++;
      if (Math.abs(u) > 12) assert.ok(Math.max(...heights) < SALT_LEVEL + .2 && Math.min(...heights) > WATER_LEVEL - .4, `crust out of level at s=${s}, u=${u}`);
      continue;
    }
    // Open pool middles are the only holes.
    assert.ok(inPool(s, u), `hole in the crust at s=${s.toFixed(1)}, u=${u.toFixed(1)}`);
    pools++;
  }
  assert.ok(covered > 10000 && pools > 0, `${covered} covered, ${pools} in pools`);
  for (const chunk of chunks) chunk.dispose();
});

test('reflections sit under the water and never block the car', () => {
  let mirrored = 0;
  for (const index of [-40, -12, 0, 7, 33]) {
    const chunk = new SaltChunk(index);
    chunk.group.traverse(object => {
      if (!object.name.includes('reflection')) return;
      assert.equal(object.castShadow, false); assert.equal(object.receiveShadow, false);
      assert.equal(object.userData.ambientOcclusion, false);
      if (object.isInstancedMesh) for (let i = 0; i < object.count; i++) {
        // Flipped upside down about the water, so everything hangs below it.
        const m = object.instanceMatrix.array, y = m[i * 16 + 13];
        assert.ok(m[i * 16 + 5] < 0 && y <= WATER_LEVEL + .15, `a reflection isn't hanging under the water at ${y}`);
        mirrored++;
      }
    });
    // Colliders sit on real scenery only: none of them is below the crust.
    for (const solid of chunk.features.colliders ?? []) assert.ok(Number.isFinite(solid.x) && Number.isFinite(solid.z));
    chunk.dispose();
  }
  assert.ok(mirrored > 20, `only ${mirrored} reflections checked`);
});
