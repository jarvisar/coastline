import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, roadHeight } from '../src/world/route.js';
import { volcanicColumns, volcanicHeight, volcanicPosition, volcanicDrivingRoute, riftProfile, shelfSteps } from '../src/world/volcanic-route.js';
import { terrainSampler } from '../src/world/coastal-assets.js';
import { VolcanicChunk, VolcanicWorld } from '../src/world/volcanic.js';
import { volcanicClock } from '../src/world/volcanic-materials.js';
import { VolcanicAtmosphere } from '../src/world/volcanic-atmosphere.js';
import { DrivingController } from '../src/vehicle.js';
import { residentWindow } from '../src/world/resident.js';

test('volcanic road stays continuous and lava stays below its cliffs across long drives', () => {
  for (let s = -40000; s <= 40000; s += 13) {
    const columns = volcanicColumns(s);
    for (let i = 1; i < columns.length; i++) assert.ok(columns[i] > columns[i - 1]);
    for (const u of [-7, 0, 7]) {
      assert.equal(volcanicHeight(s, u), roadHeight(s));
      assert.equal(volcanicDrivingRoute.water(s, u), false);
    }
    for (const side of [-1, 1]) {
      const { near, far, level } = riftProfile(s, side), u = side * (near + far) / 2;
      assert.ok(volcanicHeight(s, u) < level);
      assert.ok(volcanicDrivingRoute.water(s, u));
      assert.ok(near > 18 && level < roadHeight(s) - 4);
      assert.ok(roadHeight(s) - level <= 8, 'raised lava sits close to the road shelf');
      if (side > 0) assert.ok(far - near > 12 && far - near <= 21, 'right lava stays a narrow creek between its banks');
      assert.ok(Math.abs(volcanicHeight(s + .001, side * 15) - volcanicHeight(s - .001, side * 15)) < .01);
    }
  }
});

test('free driving reaches the ash shoulder and stops before either lava rift', () => {
  for (const s of [-1025, 24, 1025, 10000]) for (const side of [-1, 1]) {
    const car = new DrivingController(volcanicDrivingRoute, { s, distance: 0 });
    car.toggleFreeDriving(); car.heading = car.route.frame(car.s).angle + side * Math.PI / 2;
    for (let i = 0; i < 1200; i++) {
      car.update(1 / 60, { forward: true });
      assert.equal(car.route.water(car.s, car.u), false);
      assert.ok(Number.isFinite(car.car.position.y));
    }
    assert.ok(side * car.u > 10);
    assert.ok(Math.abs(car.u) < riftProfile(car.s, side).near + 1);
    car.disposeModel();
  }
});

test('right-hand lava tributaries split the terraces while leaving the road and shoulder solid', () => {
  for (let index = -80; index <= 80; index++) {
    const s = index * CHUNK_LENGTH + 24, { near, level } = riftProfile(s, 1);
    assert.ok(volcanicHeight(s, near - 1) < level, `tributary joins the rift at ${s}`);
    assert.equal(volcanicDrivingRoute.water(s, near - 1), true);
    for (const u of [0, 7, 17, 24]) {
      assert.equal(volcanicDrivingRoute.water(s, u), false);
      assert.ok(volcanicHeight(s, u) > level);
    }
    const bank = riftProfile(s + 24, 1);
    assert.ok(volcanicHeight(s + 24, bank.near - 1) > bank.level, `solid terrace between tributaries at ${s}`);
  }
});

test('uplifted shelves retain steep faces and broad crowns, with some upper tiers merging away', () => {
  let distinct = 0, merged = 0;
  for (let index = -40; index <= 40; index++) {
    const s = index * CHUNK_LENGTH + 60, { toe, upper } = shelfSteps(s, 1);
    assert.ok(volcanicHeight(s, toe + 2.6) - volcanicHeight(s, toe) > 4, 'lower cliff rises within three metres even where its crown sags');
    const width = upper - .4 - toe - 3.2;
    assert.ok(width > 4 && Math.abs(volcanicHeight(s, upper - .4) - volcanicHeight(s, toe + 3.2)) / width < .2, 'a gently folded shelf lies between the scarps');
    const rise = volcanicHeight(s, upper + 2.6) - volcanicHeight(s, upper);
    if (rise > 9) distinct++;
    if (rise < 2) merged++;
  }
  assert.ok(distinct > 10, 'separate raised plateaus remain common');
  assert.ok(merged > 4, 'tiers occasionally join into one shelf');
});

test('the left basin exposes broad lava flows around rooted cliff islands', () => {
  let open = 0, samples = 0, islands = 0;
  for (const index of [-4, 0, 4, 10]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const rock = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      for (let s = chunk.start + 8; s < chunk.start + CHUNK_LENGTH - 8; s += 8) {
        const { near, far, level } = riftProfile(s, -1);
        assert.ok(far - near >= 88, 'the basin is substantially wider than the right creek');
        for (let d = near + 10; d < far - 10; d += 5) {
          const p = volcanicPosition(s, -d), z = p.z + chunk.start;
          const y = Math.max(ground(p.x, z) ?? -Infinity, rock(p.x, z) ?? -Infinity);
          samples++;
          if (y < level) open++;
          if (y > level + 12) islands++;
        }
      }
    } finally { chunk.dispose(); }
  }
  assert.ok(open / samples > .5, 'connected molten areas dominate the basin floor');
  assert.ok(islands / samples > .04, 'large cliff islands still frame the flows');
});

test('neighboring volcanic terrain and lava meshes share exact boundary vertices', () => {
  for (const index of [-9, 0, 65]) {
    const a = new VolcanicChunk(index), b = new VolcanicChunk(index + 1);
    try {
      // Terrain jitter is global, so compare shared positions even when the
      // seam bends away from the nominal chunk boundary.
      for (const name of ['volcanic-basalt', 'volcanic-lava']) {
        const points = chunk => {
          const p = chunk.group.getObjectByName(name).geometry.attributes.position, result = new Set();
          for (let i = 0; i < p.count; i++) result.add([p.getX(i), p.getY(i), p.getZ(i) - chunk.start].map(v => v.toFixed(3)).join(','));
          return result;
        };
        const pa = points(a), pb = points(b), common = [...pa].filter(p => pb.has(p));
        assert.ok(common.length >= (name === 'volcanic-basalt' ? volcanicColumns(0).length - 2 : 24), `${name}: ${common.length} seam vertices`);
      }
    } finally { a.dispose(); b.dispose(); }
  }
});

test('volcanic streaming rebases smoke anchors and releases scene resources', () => {
  const scene = new THREE.Scene(), world = new VolcanicWorld(scene), { behind, ahead } = residentWindow();
  for (const s of [24, 1025, -1025, 10000]) {
    world.update(s); world.animate(12.5);
    assert.equal(world.chunks.size, behind + ahead + 1);
    assert.equal(volcanicClock.value, 12.5);
    for (const chunk of world.chunks.values()) {
      assert.equal(chunk.group.position.z, world.origin - chunk.index * CHUNK_LENGTH);
      const smoke = chunk.group.getObjectByName('volcanic-smoke');
      assert.ok(smoke.geometry.boundingSphere.radius > 0);
      assert.equal(smoke.castShadow, false);
      assert.ok(chunk.features.vents.every(v => Math.abs(v.u) > 12));
    }
  }
  world.dispose(); assert.equal(scene.children.length, 0); assert.equal(world.chunks.size, 0);
});

test('crater, rock and buttress footprints leave the full road clear on bends', () => {
  for (let index = -20; index <= 20; index++) {
    const chunk = new VolcanicChunk(index);
    try {
      for (let s = chunk.start - 24; s < chunk.start + CHUNK_LENGTH + 24; s += 2) {
        const p = volcanicPosition(s, 0);
        for (const solid of chunk.features.colliders) assert.ok(Math.hypot(p.x - solid.x, p.z - solid.z) - solid.reach > 6.5, `blocked road at ${s}`);
      }
    } finally { chunk.dispose(); }
  }
});

test('ash, embers and lava lights have a fixed budget, pause together and survive origin shifts', () => {
  const scene = new THREE.Scene(), atmosphere = new VolcanicAtmosphere(scene), chunk = new VolcanicChunk(8), chunks = new Map([[8, chunk]]);
  try {
    assert.equal(atmosphere.geometry.attributes.position.count, 164);
    assert.equal(atmosphere.lights.length, 4);
    assert.ok(atmosphere.lights.every(light => !light.castShadow));
    const state = () => ({ positions: [...atmosphere.geometry.attributes.position.array], alpha: [...atmosphere.geometry.attributes.fleckAlpha.array],
      lights: atmosphere.lights.map(light => ({ position: light.position.toArray(), intensity: light.intensity })) });
    atmosphere.update(10, 1025, 1024, chunks); const first = state();
    assert.ok(first.positions.every(Number.isFinite));
    assert.ok(first.alpha.slice(140).some(alpha => alpha > 0), 'nearby vents release embers');
    atmosphere.update(10, 1025, 1024, chunks); assert.deepEqual(state(), first, 'a paused clock freezes all motion and illumination');
    const pointZ = atmosphere.points.position.z;
    atmosphere.update(10, 1025, 2048, chunks);
    assert.deepEqual(state().positions, first.positions);
    assert.equal(atmosphere.points.position.z - pointZ, 1024);
    atmosphere.lights.forEach((light, i) => assert.ok(Math.abs(light.position.z - first.lights[i].position[2] - 1024) < 1e-8));
    atmosphere.update(11, 1025, 2048, chunks); assert.notDeepEqual(state().positions, first.positions);
  } finally { chunk.dispose(); atmosphere.dispose(); }
  assert.equal(scene.children.length, 0);
});
