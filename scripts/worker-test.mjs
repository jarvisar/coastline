import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173'); url.searchParams.set('seed', '4817');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 660 }, deviceScaleFactor: 1 });
  const errors = [], records = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.evaluate(() => window.__coastline.action('pause'));
  const ready = () => page.waitForFunction(() => {
    const worker = window.__coastline.chunkWorker;
    return worker.worker && worker.ready && !worker.active && worker.queue.length === 0;
  });
  for (const id of ['coast', 'desert', 'snow']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id); await ready();
    assert.equal(await page.evaluate(() => window.__coastline.chunkWorker.stats.fallback), 0, 'initial worlds must build in the worker');
    const measurements = await page.evaluate(async id => {
      const a = window.__coastline, source = a.world.chunkSource;
      const { unpackChunk } = await import('/src/world/chunk-transfer.js');
      const modules = { coast: () => import('/src/world/environment.js'), desert: () => import('/src/world/desert.js'), snow: () => import('/src/world/snow.js') };
      const { CoastalChunk, DesertChunk, SnowChunk } = await modules[id]();
      const Builder = CoastalChunk ?? DesertChunk ?? SnowChunk;
      const times = [];
      for (const [index, data] of source.cache) {
        const t0 = performance.now(), restored = unpackChunk(data), t1 = performance.now();
        const built = new Builder(index), t2 = performance.now();
        times.push({ index, assembleMs: t1 - t0, synchronousMs: t2 - t1 });
        // Compare rendered pixels, including shader clocks and shadows.
        const originalS = a.vehicle.s, s = index * 128 + 24;
        a.vehicle.s = s; a.vehicle.reset(); a.vehicle.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
        restored.group.position.z = built.group.position.z = a.world.origin - restored.start;
        restored.birds?.update(2.2); built.birds?.update(2.2);
        a.world.animate(2.2, a.vehicle);
        const { renderer, scene, camera } = a.rendering;
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 660;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const read = chunk => {
          scene.add(chunk.group); renderer.render(scene, camera); context.drawImage(renderer.domElement, 0, 0);
          scene.remove(chunk.group); return context.getImageData(0, 0, 960, 660).data;
        };
        const before = read(built), after = read(restored);
        let changed = 0; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
        times.at(-1).changedChannels = changed;
        restored.dispose(); built.dispose();
        a.vehicle.s = originalS; a.vehicle.reset(); a.vehicle.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
      }
      return times;
    }, id);
    for (const sample of measurements) assert.equal(sample.changedChannels, 0, `${id}: transferred chunks must render identically`);
    const advances = [];
    // Cross origin boundaries and reverse far enough to replace every chunk.
    for (const direction of [...Array(10).fill(1), ...Array(20).fill(-1), ...Array(10).fill(1)]) {
      await ready();
      const record = await page.evaluate(direction => {
        const a = window.__coastline, center = a.world.center + direction;
        a.vehicle.s = center * 128 + 24; a.vehicle.reset();
        const t = performance.now(); a.world.update(a.vehicle.s); const updateMs = performance.now() - t;
        a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin); a.world.animate(2.2, a.vehicle);
        const { behind, ahead } = a.graphics.settings.chunks;
        return { updateMs, count: a.world.chunks.size, resident: behind + ahead + 1, cache: a.world.chunkSource.cache.size,
          pending: a.world.chunkSource.pending.size, fallback: a.chunkWorker.stats.fallback,
          sourceCount: a.chunkWorker.sources.size, origin: a.world.origin,
          local: [...a.world.chunks.values()].every(chunk => chunk.group.position.z === a.world.origin - chunk.start) };
      }, direction);
      // The resident window depends on the quality setting, so check it matches exactly.
      assert.equal(record.count, record.resident); assert.equal(record.sourceCount, 1); assert.equal(record.fallback, 0);
      assert.ok(record.local); assert.ok(record.cache + record.pending <= 2);
      advances.push(record.updateMs);
    }
    records.push({ journey: id, measurements, maxStreamUpdateMs: Math.max(...advances), crossings: advances.length });
  }
  // Disposal while jobs are outstanding must not attach old scenery later.
  await ready();
  await page.evaluate(async () => {
    const a = window.__coastline;
    const cancelled = a.chunkWorker.source('desert');
    const preparing = cancelled.prepare(a.vehicle.s);
    cancelled.dispose(); await preparing;
    await a.changeJourney('coast');
  }); await ready();
  assert.equal(await page.evaluate(() => window.__coastline.chunkWorker.sources.size), 1);
  const normalStats = await page.evaluate(() => ({ ...window.__coastline.chunkWorker.stats }));
  assert.ok(normalStats.discarded >= 1, 'late worker results must be discarded after cancellation');

  const fallback = await browser.newPage();
  fallback.on('pageerror', error => errors.push(error.message));
  await fallback.addInitScript(() => { window.Worker = class { constructor() { throw new Error('Workers unavailable'); } }; });
  await fallback.goto(url.href);
  await fallback.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await fallback.evaluate(async () => { await window.__coastline.action('pause'); await window.__coastline.changeJourney('desert'); });
  assert.ok(await fallback.evaluate(() => {
    const { behind, ahead } = window.__coastline.graphics.settings.chunks;
    return window.__coastline.world.chunks.size === behind + ahead + 1;
  }), 'the synchronous fallback fills the same window');
  assert.equal(await fallback.evaluate(() => window.__coastline.chunkWorker.worker), null);
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/worker', { recursive: true });
  const report = { passed: true, normalStats, records, unsupportedWorkerFallback: true };
  await writeFile('.artifacts/worker/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
