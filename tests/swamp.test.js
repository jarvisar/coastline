import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, roadX, smoothstep, positionAt } from '../src/world/route.js';
import { SWAMP_STEP, SWAMP_COLUMN_COUNT, WATER_LEVEL, BAYOU_SPACING, swampColumns, swampVertex, swampGround, swampHeight, swampRoadHeight,
  swampBridgeAt, onBridge, bankEdge, swampDrivingRoute } from '../src/world/swamp-route.js';
import { swampDiscoveries } from '../src/world/swamp-discoveries.js';
import { SwampWorld, SwampChunk } from '../src/world/swamp.js';
import { campLantern } from '../src/world/swamp-camps.js';
import { swampDiscoveryLight } from '../src/world/swamp-discovery-scenery.js';
import { waterClock } from '../src/world/water.js';
import { DrivingController } from '../src/vehicle.js';

test('swamp columns stay ordered and the causeway rises from the water on both sides', () => {
  let open = 0, sampled = 0;
  for (let s = -12000; s < 12000; s += 11) {
    const columns = swampColumns(s);
    assert.equal(columns.length, SWAMP_COLUMN_COUNT);
    for (let col = 1; col < columns.length; col++) assert.ok(columns[col] > columns[col - 1], `folded swamp terrain at ${s}`);
    const road = swampRoadHeight(s);
    assert.ok(road > WATER_LEVEL + 2 && road < WATER_LEVEL + 4.2, `road height ${road} at ${s}`);
    for (const u of [-6.4, 0, 6.4]) assert.equal(swampHeight(s, u), road);
    if (onBridge(s, 8)) continue;
    for (const u of [-7, 7]) assert.equal(swampHeight(s, u), road);
    for (const side of [-1, 1]) {
      const bank = bankEdge(s, side);
      assert.ok(swampGround(s, side * 9) > WATER_LEVEL + 1, `verge under water at ${s}`);
      assert.ok(swampGround(s, side * bank) > WATER_LEVEL - .2, `riprap under water at ${s}`);
      // A hammock may touch the toe now and then, but open water lines most of it.
      sampled++; if (swampGround(s, side * (bank + 3)) < WATER_LEVEL) open++;
    }
    for (const u of [-300, -40, -14, 14, 40, 300]) assert.ok(Math.abs(swampGround(s + .001, u) - swampGround(s - .001, u)) < .05);
  }
  assert.ok(open / sampled > .9, `${open}/${sampled} open water beside the causeway`);
  for (let chunk = -20; chunk < 40; chunk++) {
    const rows = CHUNK_LENGTH / SWAMP_STEP;
    for (let col = 0; col < SWAMP_COLUMN_COUNT; col++) assert.deepEqual(swampVertex(chunk * rows, col), swampVertex((chunk - 1) * rows + rows, col));
  }
});

test('bayou bridges span open water at world-space intervals', () => {
  const seen = new Set();
  for (let s = -20000; s < 20000; s += 4) {
    const bridge = swampBridgeAt(s);
    seen.add(bridge.index);
    assert.ok(Math.abs(bridge.center - (640 + bridge.index * BAYOU_SPACING)) <= 80);
    if (Math.abs(s - bridge.center) < bridge.half - 7) {
      for (const u of [-12, -4, 0, 4, 12]) assert.ok(swampGround(s, u) < WATER_LEVEL - 1.5, `no channel under the bridge at ${s}, ${u}`);
      assert.equal(swampHeight(s, 0), swampRoadHeight(s));
      assert.ok(swampDrivingRoute.water(s, 9, swampHeight(s, 9)), 'water past the parapets');
      assert.deepEqual(swampDrivingRoute.bounds(s), [-4.4, 4.4]);
    }
  }
  assert.ok(seen.size > 30);
});

test('fishing camps stand in water, clear of the road and the bridges', () => {
  const camps = swampDiscoveries(-400000, 400000).filter(site => site.kind === 'fishing-camp');
  for (const camp of camps) {
    assert.ok(Math.abs(camp.u) >= 29 && Math.abs(camp.u) <= 49);
    assert.ok(Math.abs(camp.s - swampBridgeAt(camp.s).center) >= 110);
    assert.ok(swampGround(camp.s, camp.u) < WATER_LEVEL, `camp ${camp.index} stands on dry ground`);
    const lantern = campLantern(camp);
    assert.ok(lantern.y > WATER_LEVEL + camp.floor && lantern.y < WATER_LEVEL + camp.floor + 4);
  }
  assert.ok(camps.length > 35 && camps.length < 65, `${camps.length} camps`);
});

test('swamp drive stays grounded on the causeway and its bridges', () => {
  const car = new DrivingController(swampDrivingRoute, { s: 400 });
  for (let i = 0; i < 9000; i++) {
    car.update(1 / 60, { forward: true, left: i >= 6000 && i < 7200, right: i >= 7200 });
    assert.ok(car.u >= -7.8 && car.u <= 7.8);
    assert.ok(Math.abs(car.car.position.y - swampHeight(car.s, car.u) - .13) < .0001);
  }
  assert.ok(car.distance > 2500);
  assert.ok(Math.floor((car.s - 400) / BAYOU_SPACING) >= 1, 'the drive crossed a bridge');
});

test('swamp chunks keep scenery off the road, clip the ground at the water and dispose cleanly', () => {
  const overhead = new Set(['guardrails', 'bridge-concrete']);
  for (const index of [-4, 0, 4, 13]) {
    const chunk = new SwampChunk(index), names = new Set(), position = new THREE.Vector3(), matrix = new THREE.Matrix4();
    const road = Array.from({ length: CHUNK_LENGTH + 21 }, (_, i) => { const s = chunk.start - 10 + i; return [roadX(s), -(s - chunk.start)]; });
    chunk.group.traverse(object => {
      names.add(object.name);
      if (!object.isInstancedMesh || overhead.has(object.name)) return;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
        const distance = Math.min(...road.map(([x, z]) => Math.hypot(position.x - x, position.z - z)));
        assert.ok(distance > 8, `${object.name} instance ${i} in chunk ${index} sits ${distance.toFixed(1)} m from the road`);
        assert.ok(Number.isFinite(position.y));
      }
    });
    for (const name of ['swamp-ground', 'swamp-water', 'swamp-road', 'center-lines', 'guardrails', 'cypress-trunks', 'cypress-crowns', 'dead-snags',
      'sawgrass', 'lily-pads', 'riprap', 'swamp-mist', 'fireflies', 'firefly-reflections', 'cypress-trunks-reflection', 'dead-snags-reflection'])
      assert.ok(names.has(name), `${name} missing from chunk ${index}`);
    // Reflections hang under the water and borrow their originals' instance buffers.
    const mirrors = []; chunk.group.traverse(object => { if (object.name.endsWith('-reflection')) mirrors.push(object); });
    for (const mirror of mirrors) {
      assert.ok(mirror.scale.y === -1 && mirror.position.y === WATER_LEVEL * 2 && !mirror.castShadow && !mirror.receiveShadow);
      assert.equal(mirror.userData.ambientOcclusion, false);
      if (mirror.isInstancedMesh) assert.ok(chunk.group.children.some(other => other !== mirror && other.instanceMatrix === mirror.instanceMatrix && other.instanceColor === mirror.instanceColor));
    }
    assert.equal(new Set(chunk.owned).size, chunk.owned.length, 'shared glow buffers must only be disposed once');
    const ground = chunk.terrain.geometry.attributes.position;
    for (let i = 0; i < ground.count; i++) assert.ok(ground.getY(i) >= WATER_LEVEL - .031, 'ground left under the water');
    const water = chunk.group.getObjectByName('swamp-water').geometry.attributes.position;
    for (let i = 0; i < water.count; i++) assert.equal(water.getY(i), WATER_LEVEL);
    let released = 0;
    for (const geometry of chunk.owned) geometry.addEventListener('dispose', () => released++);
    chunk.dispose(); assert.equal(released, chunk.owned.length);
  }
  const bridge = swampBridgeAt(640), chunk = new SwampChunk(Math.floor(bridge.center / CHUNK_LENGTH));
  assert.ok(chunk.group.getObjectByName('bridge-concrete'));
  assert.ok(chunk.features.colliders.length > 20, 'guardrail and parapets are solid');
  chunk.dispose();
});

test('the swamp world glows around the nearest discoveries in their own colours and follows the car with its headlights', () => {
  const scene = new THREE.Scene(), world = new SwampWorld(scene), car = new DrivingController(swampDrivingRoute);
  let disposed = 0, points = 0;
  world.update(24);
  for (const chunk of world.chunks.values()) for (const g of chunk.owned) g.addEventListener('dispose', () => disposed++);
  // Lantern light is baked and painted on. A point light would cost every lit pixel.
  scene.traverse(object => { if (object.isPointLight) points++; });
  assert.equal(points, 0);
  const sites = swampDiscoveries(-20000, 20000);
  assert.equal(new Set(sites.map(site => site.kind)).size, 4, 'every kind is visited');
  assert.equal(world.headlights.parent, world.effects, 'the actual spotlight must be attached to the scene');
  for (const s of [24, ...sites.map(site => site.s), 5000, -900]) {
    car.s = s; car.reset(); world.update(s); world.animate(12, car);
    assert.equal(world.chunks.size, 9); assert.equal(waterClock.time.value, 12);
    for (const [index, chunk] of world.chunks) assert.equal(chunk.group.position.z, world.origin - index * CHUNK_LENGTH);
    world.pools.forEach((pool, i) => {
      const site = swampDiscoveries(s - 300, s + 300)[i], lamp = site && swampDiscoveryLight(site);
      const strength = site ? 1 - smoothstep(160, 260, Math.abs(site.s - s)) : 0;
      assert.equal(pool.visible, strength > 0);
      if (lamp) {
        const floor = site.kind === 'chapel' ? site.level : WATER_LEVEL, { light, height, range } = pool.material.uniforms, color = new THREE.Color(lamp.color);
        assert.deepEqual(pool.position.toArray(), [lamp.position.x, floor + .03, lamp.position.z + world.origin]);
        assert.ok(Math.abs(height.value - (lamp.position.y - floor)) < 1e-9 && range.value === lamp.distance && pool.scale.x === lamp.distance);
        if (strength > 0) assert.ok(Math.abs(light.value.r / light.value.g - color.r / color.g) < 1e-9, 'the glow takes the lantern colour');
      }
      assert.equal(world.glowGeometry.attributes.strength.getX(i), Math.fround(strength * (lamp?.halo ?? 0)));
    });
    const version = world.glowGeometry.attributes.position.version;
    world.update(s);
    assert.equal(world.glowGeometry.attributes.position.version, version, 'stationary halos need no repeated upload');
    assert.deepEqual(world.headlights.position.toArray(), car.car.position.toArray());
    // One basin under the car, not one per chunk.
    const road = positionAt(s, 0);
    assert.deepEqual(world.basin.position.toArray(), [road.x, -48, road.z + world.origin]);
  }
  // The racer has no lamps. Its beam goes dark but stays in the scene, so the light count holds.
  car.setCar('formula'); world.animate(13, car); assert.equal(world.headlights.visible, true); assert.equal(world.headlights.light.intensity, 0);
  car.setCar('auto'); world.animate(14, car); assert.equal(world.headlights.light.intensity, 260);
  world.dispose(); assert.equal(scene.children.length, 0); assert.ok(disposed >= 40);
});
