import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Deterministic CPU work and GPU upload counts, independent of headless FPS.
// Use PROFILE_LABEL to compare passes; these timings are not phone frame times.
const label = process.env.PROFILE_LABEL ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const directory = `.artifacts/performance/${label}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const errors = [], records = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'balanced' })));
  const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173');
  url.searchParams.set('seed', '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.click('#start');
  await page.evaluate(() => window.__coastline.action('pause'));
  for (const id of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    const record = await page.evaluate(async () => {
      const a = window.__coastline, { renderer, scene } = a.rendering;
      a.vehicle.s = 384; a.vehicle.reset();
      await a.world.chunkSource.prepare(a.vehicle.s);
      a.world.update(a.vehicle.s);
      a.traffic.reset(a.vehicle.route, a.vehicle.s, a.journey);
      const samples = {};
      const measure = (name, action) => {
        const start = performance.now(); action();
        (samples[name] ??= []).push(performance.now() - start);
      };
      // Stay inside the prepared view: streaming is measured by worker-test.
      for (let i = 0; i < 360; i++) {
        measure('physics', () => { a.vehicle.update(1 / 120, {}); a.traffic.update(1 / 120, a.vehicle); });
        measure('world', () => a.world.update(a.vehicle.s));
        measure('poses', () => { a.vehicle.render(.5, a.world.origin); a.traffic.render(.5, a.world.origin); });
        measure('camera', () => a.rendering.update(a.vehicle.car, 1 / 120, a.world.origin));
        measure('animation', () => a.world.animate(12 + i / 120, a.vehicle));
        measure('matrices', () => scene.updateMatrixWorld());
      }
      a.world.animate(12, a.vehicle); a.rendering.render();
      const gl = renderer.getContext(), originalUpload = gl.bufferSubData;
      let uploadCalls = 0, uploadBytes = 0;
      gl.bufferSubData = function (target, offset, data, sourceOffset = 0, length = 0) {
        uploadCalls++; uploadBytes += (length || data.length - sourceOffset) * data.BYTES_PER_ELEMENT;
        return originalUpload.apply(this, arguments);
      };
      try { a.world.animate(12.01, a.vehicle); a.rendering.render(); }
      finally { gl.bufferSubData = originalUpload; }
      const timing = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
        const sorted = values.slice(60).sort((a, b) => a - b);
        return [name, { totalMs: sorted.reduce((a, b) => a + b, 0), p95Ms: sorted[Math.floor(sorted.length * .95)] }];
      }));
      a.world.animate(12, a.vehicle); a.rendering.render();
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
      canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
      return { journey: a.journey, timing, uploadCalls, uploadBytes,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, capture: canvas.toDataURL() };
    });
    await writeFile(`${directory}/drive-${id}.png`, Buffer.from(record.capture.split(',')[1], 'base64'));
    delete record.capture; records.push(record);
    console.log(JSON.stringify(record));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/driving.json`, JSON.stringify({ records }, null, 2));
} finally { await browser.close(); }
