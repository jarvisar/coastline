import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 660 }, deviceScaleFactor: 1 });
  const errors = [], records = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173'); url.searchParams.set('seed', '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  const eagerScenery = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => new URL(entry.name).pathname)
    .filter(path => /\/src\/world\/(desert|snow|jungle|plains|city|volcanic)\.js$/.test(path)));
  assert.deepEqual(eagerScenery, [], 'unselected scenery must stay off the startup path');
  const renderFrame = () => page.evaluate(() => window.__coastline.rendering.renderer.info.render.frame);
  const settle = () => page.evaluate(async () => {
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
  });
  await page.click('#start');
  await page.keyboard.press('KeyP');
  await page.evaluate(() => {
    const { renderer, scene } = window.__coastline.rendering;
    const compile = renderer.compile.bind(renderer), render = renderer.render.bind(renderer);
    const lighting = () => {
      const lights = [];
      scene.traverseVisible(object => { if (object.isLight) lights.push(object.uuid); });
      return JSON.stringify([lights.sort(), scene.fog?.color.getHex(), renderer.toneMappingExposure]);
    };
    window.__compileChecks = [];
    let compiledLighting;
    renderer.compile = (...args) => { compiledLighting = lighting(); return compile(...args); };
    renderer.render = (...args) => {
      if (compiledLighting) {
        window.__compileChecks.push(compiledLighting === lighting());
        compiledLighting = null;
      }
      return render(...args);
    };
  });
  for (const id of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    await settle();
    assert.ok(await page.evaluate(() => window.__compileChecks.every(Boolean)),
      `${id}: shader warmup must use the same lights and environment as the revealed route`);
    const frozenFrame = await renderFrame();
    await settle();
    assert.equal(await renderFrame(), frozenFrame, `${id}: paused scene must not redraw`);
    const idleWork = await page.evaluate(async () => {
      let hudMutations = 0;
      const hud = new MutationObserver(records => { hudMutations += records.length; }), canvas = new MutationObserver(() => {});
      hud.observe(document.getElementById('distance'), { childList: true, subtree: true, characterData: true });
      for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
      hudMutations += hud.takeRecords().length;
      hud.disconnect();
      canvas.observe(document.querySelector('#scene'), { attributes: true, attributeFilter: ['width', 'height'] });
      window.dispatchEvent(new Event('resize'));
      const canvasResizes = canvas.takeRecords().length; canvas.disconnect();
      return { hudMutations, canvasResizes };
    });
    assert.equal(idleWork.hudMutations, 0, `${id}: unchanged HUD text must not be replaced`);
    assert.equal(idleWork.canvasResizes, 0, `${id}: unchanged viewport must not resize canvas buffers`);
    await settle();
    const beforeResize = page.viewportSize();
    await page.setViewportSize({ width: beforeResize.width === 960 ? 980 : 960, height: 660 });
    await page.waitForFunction(frame => window.__coastline.rendering.renderer.info.render.frame > frame, frozenFrame);
    await settle();
    const resizedFrame = await renderFrame(); await settle();
    assert.equal(await renderFrame(), resizedFrame, `${id}: resize must return to idle rendering`);
    await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
    await page.waitForFunction(frame => window.__coastline.rendering.renderer.info.render.frame > frame, resizedFrame);
    await settle();
    const resetFrame = await renderFrame(); await settle();
    assert.equal(await renderFrame(), resetFrame, `${id}: reset must return to idle rendering`);

    const record = await page.evaluate(() => {
      const a = window.__coastline, { renderer, scene, camera } = a.rendering;
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const read = () => {
        renderer.render(scene, camera); context.drawImage(renderer.domElement, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const materials = new Set();
      scene.traverse(object => { if (object.material?.forceSinglePass && object.material.transparent) materials.add(object.material); });
      const optimized = read(), calls = renderer.info.render.calls;
      for (const material of materials) material.forceSinglePass = false;
      const previous = read(), previousCalls = renderer.info.render.calls;
      for (const material of materials) material.forceSinglePass = true;
      read();
      let changedChannels = 0, maxDifference = 0;
      for (let i = 0; i < previous.length; i++) {
        const difference = Math.abs(previous[i] - optimized[i]);
        if (difference) changedChannels++;
        maxDifference = Math.max(maxDifference, difference);
      }
      return { journey: a.journey, calls, previousCalls, changedChannels, maxDifference };
    });
    // Coincident double-sided fragments can resolve either way, so a few channels
    // may differ by one step. A visible change would be much larger.
    assert.ok(record.maxDifference <= 1,
      `${id}: flat effects must retain their appearance (${record.changedChannels} channels differ, by up to ${record.maxDifference})`);
    assert.ok(record.calls <= record.previousCalls);
    records.push(record);
    const pausedFrame = await renderFrame();
    await page.keyboard.press('KeyP');
    await page.waitForFunction(frame => window.__coastline.rendering.renderer.info.render.frame > frame + 2, pausedFrame);
    await page.keyboard.press('KeyP');
  }
  await page.evaluate(async () => {
    const { renderer } = window.__coastline.rendering;
    const extension = renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Context-loss emulation is unavailable');
    await new Promise(resolve => {
      renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true });
      extension.loseContext();
    });
    // Let the loss event finish before asking Chrome to restore the context.
    await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Context restoration timed out')), 10000);
      renderer.domElement.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve(); }, { once: true });
      extension.restoreContext();
    });
  });
  // Three.js creates a fresh render counter when the context is restored.
  await page.waitForFunction(() => window.__coastline.rendering.renderer.info.render.frame > 0);
  await settle();
  const restoredFrame = await renderFrame(); await settle();
  assert.equal(await renderFrame(), restoredFrame, 'restored paused canvas must return to idle rendering');
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => window.__compileChecks.length >= 6 && window.__compileChecks.every(Boolean)),
    'all route shader warmups must run with their final environment');
  await mkdir('.artifacts/performance', { recursive: true });
  await writeFile('.artifacts/performance/browser-report.json', JSON.stringify({ passed: true, records }, null, 2));
  console.log(JSON.stringify({ passed: true, records }, null, 2));
} finally { await browser.close(); }
