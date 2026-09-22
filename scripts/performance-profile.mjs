import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Fixed seed, pose, time and quality make work counts and canvas captures
// comparable. CPU timings are diagnostic; SwiftShader is not a phone GPU.
const label = process.env.PROFILE_LABEL ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const quality = process.env.PROFILE_QUALITY ?? 'balanced';
assert.ok(['high', 'balanced', 'smooth', 'basic'].includes(quality));
const mobile = process.env.PROFILE_MOBILE === '1';
const directory = `.artifacts/performance/${label}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const errors = [], records = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(quality => localStorage.setItem('coastline.graphics', JSON.stringify({ mode: quality })), quality);
  const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173');
  url.searchParams.set('seed', '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.click('#start');
  await page.evaluate(() => window.__coastline.action('pause'));
  for (const id of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    const record = await page.evaluate(async () => {
      const a = window.__coastline, { scene, renderer } = a.rendering;
      a.vehicle.s = 384; a.vehicle.reset();
      await a.world.chunkSource.prepare(a.vehicle.s);
      a.world.update(a.vehicle.s);
      a.vehicle.render(1, a.world.origin);
      a.traffic.reset(a.vehicle.route, a.vehicle.s, a.journey); a.traffic.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin);
      a.world.animate(12, a.vehicle);
      a.rendering.render();
      const matrices = [];
      let staticNodes = 0, worldMultiplies = 0;
      for (const chunk of a.world.chunks.values()) chunk.group.traverse(object => {
        staticNodes++;
        const original = object.matrixWorld.multiplyMatrices;
        object.matrixWorld.multiplyMatrices = function (...args) { worldMultiplies++; return original.apply(this, args); };
        matrices.push([object.matrixWorld, original]);
      });
      const start = performance.now();
      for (let i = 0; i < 100; i++) { a.world.update(a.vehicle.s); scene.updateMatrixWorld(); }
      const transformMs = performance.now() - start;
      for (const [matrix, original] of matrices) matrix.multiplyMatrices = original;
      a.rendering.render();
      const buffer = document.createElement('canvas');
      buffer.width = renderer.domElement.width; buffer.height = renderer.domElement.height;
      buffer.getContext('2d').drawImage(renderer.domElement, 0, 0);
      const capture = buffer.toDataURL();
      return { journey: a.journey, staticNodes, worldMultiplies, transformMs,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, capture };
    });
    await writeFile(`${directory}/${id}.png`, Buffer.from(record.capture.split(',')[1], 'base64'));
    delete record.capture;
    records.push(record);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ quality, mobile, records }, null, 2));
  console.log(JSON.stringify({ quality, mobile, records }, null, 2));
} finally { await browser.close(); }
