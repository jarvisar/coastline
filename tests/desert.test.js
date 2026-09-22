import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { desertHeight, desertVertex, desertRelief, DESERT_COLUMNS, DESERT_STEP, desertColumns, canyonProfile, canyonRise, desertDrivingRoute, mesasForChunk } from '../src/world/desert-route.js';
import { roadHeight, coastalDrivingRoute } from '../src/world/route.js';
import { DesertWorld } from '../src/world/desert.js';
import { CoastalWorld } from '../src/world/environment.js';
import { DrivingController } from '../src/vehicle.js';

test('desert terrain and road connect across positive and negative chunk boundaries', () => {
  for (let chunk = -20; chunk < 50; chunk++) {
    const s = chunk * 128;
    const rows = 128 / DESERT_STEP;
    for (let column = 0; column < DESERT_COLUMNS.length; column++) assert.deepEqual(desertVertex(chunk * rows, column), desertVertex((chunk - 1) * rows + rows, column));
    for (const u of [-200, -17, -7, 0, 7, 17, 200]) assert.ok(Math.abs(desertHeight(s - .001, u) - desertHeight(s + .001, u)) < .01);
    assert.equal(desertHeight(s, 0), roadHeight(s));
  }
});

test('desert formations are deterministic and keep clear of the driving corridor', () => {
  for (let chunk = -30; chunk < 80; chunk++) {
    const mesas = mesasForChunk(chunk);
    assert.deepEqual(mesas, mesasForChunk(chunk));
    for (const mesa of mesas) assert.ok(Math.abs(mesa.u) - mesa.ru * 1.4 > 17, `mesa enters the driving corridor in chunk ${chunk}`);
  }
});

test('continuous canyon walls surround a clear road through long and reverse journeys', () => {
  for (let s = -12000; s <= 12000; s += 19) {
    const columns = desertColumns(s);
    assert.equal(columns.length, DESERT_COLUMNS.length);
    for (let i = 1; i < columns.length; i++) assert.ok(columns[i] > columns[i - 1], `terrain folds at ${s}`);
    for (const side of [-1, 1]) {
      const { foot, height } = canyonProfile(s, side);
      assert.ok(foot - 7 > 32, `wall enters valley floor at ${s}`);
      assert.ok(height > 18);
      assert.equal(canyonRise(s, side * 17), 0);
      assert.ok(desertHeight(s, side * (foot + 41)) - roadHeight(s) > 14, `missing canyon rim at ${s}`);
      const rim = side * (foot + 28);
      assert.ok(Math.abs(desertHeight(s - .001, rim) - desertHeight(s + .001, rim)) < .02);
    }
    for (const u of [-7, 0, 7]) assert.equal(desertHeight(s, u), roadHeight(s));
  }
});

test('desert driving stays grounded and switching routes restores the given place', () => {
  const car = new DrivingController(desertDrivingRoute);
  for (let i = 0; i < 7200; i++) {
    car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.u) < 4.9);
    assert.ok(Math.abs(car.car.position.y - desertHeight(car.s, car.u) - .13) < .0001);
  }
  assert.ok(car.distance > 3000);
  const saved = { s: car.s, distance: car.distance };
  car.setRoute(coastalDrivingRoute, { s: 148, distance: 130 });
  assert.equal(car.speed, 0); assert.equal(car.s, 148);
  car.setRoute(desertDrivingRoute, saved);
  assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
  for (let i = 0; i < 180; i++) car.update(1 / 60, { brake: true });
  assert.ok(car.speed < 0);
});

test('left canyon alternates cliffs with gentle fans and keeps foreground relief continuous', () => {
  let fans = 0, cliffs = 0;
  for (let s = -2400; s <= 2400; s += 17) {
    const { foot, height, cliffStrength } = canyonProfile(s, -1);
    const rise = canyonRise(s, -(foot + 10)) - canyonRise(s, -(foot + 4));
    if (cliffStrength < .02) { assert.ok(rise < height * .16, `fan still has a ledge at ${s}`); fans++; }
    if (cliffStrength > .98) { assert.ok(rise > height * .4, `cliff lost its scarp at ${s}`); cliffs++; }
  }
  assert.ok(fans > 30 && cliffs > 30, 'both open slopes and rocky enclosures should appear during a drive');
  for (let cell = -20; cell <= 20; cell++) {
    const s = cell * 160;
    for (const u of [-330, -240, -180, -135, -80]) {
      assert.ok(Math.abs(desertRelief(s - .001, u) - desertRelief(s + .001, u)) < .01, `broken foreground at ${s}, ${u}`);
    }
    const heights = Array.from({ length: 20 }, (_, i) => desertRelief(s + 80, -85 - i * 9));
    assert.ok(Math.max(...heights) - Math.min(...heights) > 8, `empty foreground at ${s}`);
  }
});

test('desert scenery samples the rendered ground on shelves, slopes and chunk boundaries', () => {
  const scene = new THREE.Scene(), world = new DesertWorld(scene);
  world.update(24); scene.updateMatrixWorld(true);
  const ground = [...world.chunks.values()].map(chunk => chunk.group.getObjectByName('desert-floor'));
  const ray = new THREE.Raycaster();
  for (const s of [-255, -128.2, .1, 127.9, 256, 511]) {
    const chunk = world.chunks.get(Math.floor(s / 128));
    for (const u of [-250, -178, -135, -90, -64, -25, 19, 76, 142]) {
      const p = chunk.groundPosition(s, u);
      ray.set(new THREE.Vector3(p.x, p.y + 100, p.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(ground, false)[0];
      assert.ok(hit && Math.abs(hit.point.y - p.y) < .002, `floating scenery at ${s}, ${u}`);
    }
  }
  world.dispose();
});

test('desert streaming and repeated world changes release scene objects and owned geometry', () => {
  const scene = new THREE.Scene(); let disposed = 0;
  for (const World of [DesertWorld, CoastalWorld, DesertWorld, CoastalWorld]) {
    const world = new World(scene); world.update(24);
    for (const chunk of world.chunks.values()) for (const source of chunk.owned) source.addEventListener('dispose', () => disposed++);
    for (const s of [250, 1025, 9000, -300]) {
      // The coast's sky is resident alongside its streamed chunks.
      world.update(s); assert.equal(world.chunks.size, 9); assert.equal(scene.children.filter(child => child !== world.sky?.group).length, 9);
      assert.ok(Math.abs(-s + world.origin) <= 1024);
    }
    world.dispose(); assert.equal(scene.children.length, 0);
  }
  assert.ok(disposed > 200);
});
