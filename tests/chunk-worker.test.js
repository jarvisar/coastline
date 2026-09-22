import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { SEED } from '../src/world/route.js';
import { CoastalChunk } from '../src/world/environment.js';
import { DesertChunk } from '../src/world/desert.js';
import { SnowChunk } from '../src/world/snow.js';
import { JungleChunk } from '../src/world/jungle.js';
import { PlainsChunk } from '../src/world/plains.js';
import { CityChunk } from '../src/world/city.js';
import { VolcanicChunk } from '../src/world/volcanic.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';
import { ChunkWorker } from '../src/world/chunk-source.js';

function snapshot(chunk) {
  const hash = createHash('sha256');
  const attribute = value => { if (value) hash.update(new Uint8Array(value.array.buffer, value.array.byteOffset, value.array.byteLength)); };
  chunk.group.traverse(object => {
    hash.update(JSON.stringify([object.name, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(),
      object.castShadow, object.receiveShadow, object.frustumCulled, object.visible, object.renderOrder, object.count,
      object.geometry?.boundingSphere, object.boundingSphere, object.boundingBox]));
    if (object.geometry) {
      attribute(object.geometry.index);
      for (const [name, data] of Object.entries(object.geometry.attributes)) { hash.update(name); attribute(data); }
    }
    attribute(object.instanceMatrix); attribute(object.instanceColor);
  });
  return hash.digest('hex');
}
const builders = { coast: CoastalChunk, desert: DesertChunk, snow: SnowChunk, jungle: JungleChunk, plains: PlainsChunk, city: CityChunk, volcanic: VolcanicChunk };

test('transferred chunks retain geometry, transforms, shaders, bounds and animation', async () => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { initializeWorkerSeed } = await import(workerData.generation);
      initializeWorkerSeed(workerData.seed);
      const { buildChunk } = await import(workerData.builders);
      for (const journey of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) for (const index of [-9, 0, 1, 65, 0]) {
        const result = await buildChunk(journey, index);
        parentPort.postMessage({ journey, index, data: result.data }, result.transfers);
      }
    })().catch(error => { throw error; });
  `, { eval: true, execArgv: [], workerData: { seed: SEED,
    generation: new URL('../src/world/generation.js', import.meta.url).href,
    builders: new URL('../src/world/chunk-builders.js', import.meta.url).href } });
  let checked = 0;
  await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', ({ journey, index, data }) => {
      try {
        const expected = new builders[journey](index), actual = unpackChunk(data);
        assert.equal(snapshot(actual), snapshot(expected), `${journey} chunk ${index}`);
        assert.deepEqual(actual.features, expected.features);
        assert.equal(actual.owned.length, expected.owned.length);
        const before = [], after = [];
        expected.group.traverse(object => { if (object.isMesh) before.push(object); });
        actual.group.traverse(object => { if (object.isMesh) after.push(object); });
        before.forEach((object, i) => {
          assert.equal(after[i].material, object.material, 'shared shader callbacks must survive transfer');
          if (!expected.owned.includes(object.geometry)) assert.equal(after[i].geometry, object.geometry);
        });
        // Both construction paths must preserve automatic transforms through rebases.
        const automatic = expected.group.clone(true), reference = [];
        automatic.traverse(object => { object.matrixAutoUpdate = true; if (object.isMesh) reference.push(object); });
        for (const origin of [0, 1024, -1024, 32768]) {
          for (const group of [expected.group, actual.group, automatic]) {
            group.position.z = origin - expected.start;
            group.updateMatrixWorld(true);
          }
          before.forEach((object, i) => {
            assert.deepEqual(object.matrixWorld.elements, reference[i].matrixWorld.elements, 'built chunk keeps its world pose');
            assert.deepEqual(after[i].matrixWorld.elements, reference[i].matrixWorld.elements, 'transferred chunk keeps its world pose');
          });
        }
        if (actual.birds) {
          for (const time of [0, 12, 87]) {
            expected.birds.update(time); actual.birds.update(time);
            assert.equal(snapshot(actual), snapshot(expected));
          }
        }
        let released = 0;
        for (const geometry of actual.owned) geometry.addEventListener('dispose', () => released++);
        actual.dispose(); assert.equal(released, actual.owned.length);
        expected.dispose(); checked++;
      } catch (error) { void worker.terminate(); reject(error); }
    });
    worker.on('exit', code => { if (code) reject(new Error(`Worker exited with ${code}`)); else resolve(); });
  });
  assert.equal(checked, 35);
});

test('transfer lists detach only owned buffers and keep shared scenery reusable', () => {
  const original = new CoastalChunk(0), expected = snapshot(original);
  const shared = [];
  original.group.traverse(object => { if (object.geometry && !original.owned.includes(object.geometry)) shared.push(object.geometry); });
  const { data, transfers } = packChunk(original);
  const transferred = structuredClone(data, { transfer: transfers });
  assert.ok(transfers.every(buffer => buffer.byteLength === 0));
  assert.ok(shared.every(geometry => geometry.attributes.position.array.byteLength > 0));
  const restored = unpackChunk(transferred);
  assert.equal(snapshot(restored), expected);
  restored.dispose(); original.dispose();
});

class FakeWorker {
  constructor() { this.messages = []; }
  postMessage(message) { this.messages.push(message); }
  send(data) { this.onmessage({ data }); }
  terminate() { this.terminated = true; }
}

test('prefetch queues stay bounded and discard late results after reversing or disposal', async () => {
  const transport = new FakeWorker(), worker = new ChunkWorker(() => transport);
  try {
    transport.send({ type: 'ready', seed: SEED });
    const source = worker.source('coast');
    const resident = center => new Map(Array.from({ length: 9 }, (_, i) => [center - 3 + i, {}]));
    source.prefetch(0, resident(0));
    assert.equal(source.pending.size, 2); assert.equal(worker.queue.length, 1);
    const oldRequest = worker.active;
    source.prefetch(100, resident(100));
    assert.equal(source.pending.size, 2); assert.equal(worker.queue.length, 2);
    transport.send({ type: 'chunk', id: oldRequest.id, chunk: {} });
    assert.equal(source.cache.size, 0); assert.equal(worker.stats.discarded, 1);
    const next = worker.active;
    source.dispose();
    transport.send({ type: 'chunk', id: next.id, chunk: {} });
    assert.equal(source.cache.size, 0); assert.equal(worker.queue.length, 0); assert.equal(worker.sources.size, 0);
    const pending = worker.source('snow'), preparation = pending.prepare(24);
    assert.ok(pending.pending.size <= 11);
    transport.onerror({ preventDefault() {} }); await preparation;
    assert.equal(worker.worker, null); assert.equal(pending.pending.size, 0); assert.equal(pending.take(0), null);
  } finally { worker.dispose(); }
});

test('missing workers immediately retain the synchronous fallback', async () => {
  const worker = new ChunkWorker(() => { throw new Error('Worker unavailable'); });
  const source = worker.source('desert'); await source.prepare(-1044);
  assert.equal(source.take(-9), null); assert.equal(worker.queue.length, 0);
  worker.dispose();
});

test('evicted chunks serve reverse travel without a second worker build', () => {
  const transport = new FakeWorker(), worker = new ChunkWorker(() => transport);
  const chunk = new CoastalChunk(-4);
  try {
    transport.send({ type: 'ready', seed: SEED });
    const source = worker.source('coast'), data = packChunk(chunk).data;
    source.retain(-4, { sourceData: data });
    source.prefetch(0, new Map(Array.from({ length: 9 }, (_, i) => [i - 3, {}])));
    assert.equal(worker.active.index, 6); assert.equal(worker.queue.length, 0);
    const restored = source.take(-4);
    assert.equal(snapshot(restored), snapshot(chunk));
    assert.equal(restored.sourceData, data);
    assert.equal(worker.stats.fallback, 0);
    restored.dispose();
  } finally { chunk.dispose(); worker.dispose(); }
});

test('a worker with a mismatched seed cannot supply scenery', async () => {
  const transport = new FakeWorker(), worker = new ChunkWorker(() => transport);
  const source = worker.source('coast'), prepared = source.prepare(24);
  transport.send({ type: 'ready', seed: (SEED + 1) >>> 0 }); await prepared;
  assert.equal(worker.worker, null); assert.equal(source.pending.size, 0);
  assert.equal(source.take(0), null); worker.dispose();
});
