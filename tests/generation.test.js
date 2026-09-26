import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolveWorldSeed, freshSceneStart } from '../src/world/generation.js';
import { SEED, journeyStart, roadX, roadDerivative } from '../src/world/route.js';
import { JOURNEYS } from '../src/journeys.js';
import { DrivingController } from '../src/vehicle.js';

test('world seeds use fresh entropy by default and accept reproducible unsigned URL seeds', () => {
  let next = 80;
  const entropy = () => next++;
  assert.equal(resolveWorldSeed('', entropy), 80);
  assert.equal(resolveWorldSeed('', entropy), 81);
  for (const seed of [0, 1, 4817, 0xffffffff]) assert.equal(resolveWorldSeed(`?seed=${seed}`, entropy), seed);
  assert.equal(next, 82);
  for (const value of ['', '-1', '1.5', 'abc', '4294967296', 'Infinity', ' 12']) {
    const before = next;
    assert.equal(resolveWorldSeed(`?seed=${encodeURIComponent(value)}`, entropy), before);
    assert.equal(next, before + 1);
  }
  const fresh = resolveWorldSeed();
  assert.ok(Number.isInteger(fresh) && fresh >= 0 && fresh <= 0xffffffff);
});

test('scene resets choose a fresh area beyond the loaded chunks and clear mileage', () => {
  for (const currentS of [-100000, -20000, -1, 0, 1, 20000, 100000]) {
    for (const random of [0, .00001, .25, .49999, .5, .50001, .75, .99999]) {
      const state = freshSceneStart(currentS, () => random);
      assert.equal(state.distance, 0);
      assert.ok(Number.isInteger(state.s) && state.s >= -20000 && state.s < 20000);
      assert.ok(Math.abs(state.s - currentS) >= 2048);
    }
  }
});

test('seeded road tangents match the actual bends, including distant and negative positions', () => {
  for (let s = -20000; s <= 20000; s += 71) {
    const tangent = (roadX(s + .001) - roadX(s - .001)) / .002;
    assert.ok(Math.abs(tangent - roadDerivative(s)) < 1e-8, `seed ${SEED}, position ${s}`);
  }
});

test('all journeys spawn grounded with zero mileage and restore their own progress', () => {
  for (const data of Object.values(JOURNEYS)) {
    const state = journeyStart(Number(data.routeNumber));
    assert.deepEqual(state, journeyStart(Number(data.routeNumber)));
    assert.ok(state.s >= -20000 && state.s < 20000);
    const car = new DrivingController(data.route, state);
    assert.equal(car.s, state.s); assert.equal(car.distance, 0); assert.equal(car.speed, 0);
    const bounds = data.route.bounds(car.s);
    assert.ok(car.u >= bounds[0] && car.u <= bounds[1]);
    assert.ok(Math.abs(car.car.position.y - data.route.height(car.s, car.u) - .13) < 1e-8);
    for (let i = 0; i < 600; i++) car.update(1 / 60, { forward: true });
    const saved = { s: car.s, distance: car.distance };
    assert.ok(saved.distance > 100);
    car.setRoute(JOURNEYS.coast.route, journeyStart(1));
    car.setRoute(data.route, saved);
    assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
    car.reset(); assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance);
  }
});

// A worker gets a fresh module graph, like a real page load, without touching a live world.
function sampleWorld(seed) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      globalThis.location = { search: '?seed=' + workerData.seed };
      (async () => {
        const route = await import(workerData.routeUrl);
        const desert = await import(workerData.desertUrl);
        const snow = await import(workerData.snowUrl);
        const samples = [], starts = [1, 2, 3].map(route.journeyStart);
        for (const s of [-20000, -1024, 0, 128, 1024, 20000, ...starts.map(start => start.s)]) {
          samples.push({ road: route.roadFrame(s), coast: route.terrainVertex(s / 8, 18),
            desert: desert.mesasForChunk(Math.floor(s / 128)), snow: snow.summitForCell(Math.floor(s / 280)) });
          for (const driving of [route.coastalDrivingRoute, desert.desertDrivingRoute, snow.snowDrivingRoute]) {
            if (Math.abs(driving.height(s - .001, 0) - driving.height(s + .001, 0)) > .001) throw new Error('Road discontinuity');
          }
          for (const side of [-1, 1]) {
            const rim = side * (desert.canyonProfile(s, side).foot + 41);
            if (desert.desertHeight(s, rim) - route.roadHeight(s) <= 14) throw new Error('Missing canyon rim');
          }
        }
        parentPort.postMessage({ seed: route.SEED, starts, samples });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: [], workerData: { seed,
      routeUrl: new URL('../src/world/route.js', import.meta.url).href,
      desertUrl: new URL('../src/world/desert-route.js', import.meta.url).href,
      snowUrl: new URL('../src/world/snow-route.js', import.meta.url).href } });
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`World worker exited with ${code}`)); });
  });
}

test('reloading a seed reproduces roads, starts and all scenery; different seeds generate different worlds', async () => {
  const seeds = [0, 1, 4817, 8675309, 0xffffffff];
  let previous;
  for (const seed of seeds) {
    const world = await sampleWorld(seed);
    assert.equal(world.seed, seed);
    assert.deepEqual(world, await sampleWorld(seed));
    assert.equal(new Set(world.starts.map(start => start.s)).size, 3);
    if (previous) {
      assert.notDeepEqual(world.starts, previous.starts);
      for (const key of ['road', 'coast', 'desert', 'snow']) assert.notDeepEqual(world.samples[0][key], previous.samples[0][key]);
    }
    previous = world;
  }
});
