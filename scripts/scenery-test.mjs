import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await page.click('#start');
  const records = [];
  for (const s of [24, 148, 246, 950, 1044, 8192 + 148, 148]) {
    await page.evaluate(async s => {
      const a = window.__coastline;
      if (a.paused) await a.action('pause');
      a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, s);
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => {
      const a = window.__coastline;
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: a.world.chunks.size, resident: behind + ahead + 1, softShading: a.graphics.settings.ambientOcclusion, geometries: a.rendering.renderer.info.memory.geometries, textures: a.rendering.renderer.info.memory.textures, calls: a.rendering.renderer.info.render.calls, triangles: a.rendering.renderer.info.render.triangles, features: [...a.world.chunks.values()].map(c => c.features) };
    });
    records.push(state);
    assert.equal(state.chunks, state.resident); assert.ok(state.geometries <= 185);
    assert.equal(state.textures, state.softShading ? 9 : 3, 'three scenery textures, plus six reusable AO textures when it is on');
    await page.screenshot({ path: `.artifacts/scenery-${s}.png` });
  }
  assert.ok(records.at(-1).geometries <= records[1].geometries + 2, 'returning to the same bridge must not leak GPU resources');

  const animation = await page.evaluate(async () => {
    const a = window.__coastline;
    await a.action('pause');
    const read = time => {
      a.world.animate(time); a.rendering.renderer.render(a.rendering.scene, a.rendering.camera);
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 1000;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      // The crop is in CSS pixels and the buffer only matches at full quality,
      // so scale the frame to the canvas.
      context.drawImage(document.querySelector('#scene'), 0, 0, canvas.width, canvas.height);
      return context.getImageData(70, 640, 360, 240).data;
    };
    const before = read(0), after = read(2.2), still = read(2.2);
    let moving = 0, paused = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 3) moving++;
      if (after[i] !== still[i] || after[i + 1] !== still[i + 1] || after[i + 2] !== still[i + 2]) paused++;
    }
    // Shift the scene by a full phase period to test the shader's floating-origin correction.
    for (const chunk of a.world.chunks.values()) chunk.group.position.z += 4096;
    a.vehicle.car.position.z += 4096; a.rendering.camera.position.z += 4096;
    for (const object of a.rendering.scene.children) {
      if (object.isDirectionalLight) { object.position.z += 4096; object.target.position.z += 4096; }
    }
    a.world.origin += 4096;
    const rebased = read(2.2);
    let rebaseDifference = 0;
    for (let i = 0; i < still.length; i += 4) {
      rebaseDifference += Math.abs(still[i] - rebased[i]) + Math.abs(still[i + 1] - rebased[i + 1]) + Math.abs(still[i + 2] - rebased[i + 2]);
    }
    return { movingPixels: moving, pausedPixels: paused, rebaseMeanColorDifference: rebaseDifference / (still.length / 4 * 3) };
  });
  assert.ok(animation.movingPixels > 500, `waves must visibly move in the rendered ocean (${animation.movingPixels})`);
  assert.equal(animation.pausedPixels, 0, 'the same simulation time must render identical water');
  assert.ok(animation.rebaseMeanColorDifference < 1, 'wave phases must remain visually continuous after rebasing');
  assert.deepEqual(errors, []);
  const report = { passed: true, animation, records };
  await writeFile('.artifacts/scenery-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, animation, records: records.map(({ features, ...rest }) => rest) }, null, 2));
} finally { await browser.close(); }
