import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { QUALITY_LEVELS, renderScale } from '../src/graphics.js';

// Quality levels, settings panel and adaptive controller at three display densities.
// Frame times are fed in so the headless software GPU's speed can't decide the result.
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], results = [];
  const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
  for (const deviceScaleFactor of [1, 2, 3]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    await page.evaluate(() => window.__coastline.action('pause'));

    const result = await page.evaluate(() => {
      const { rendering, graphics } = window.__coastline, { renderer, camera } = rendering;
      const projection = camera.projectionMatrix.toArray();
      const observer = new MutationObserver(() => {});
      observer.observe(renderer.domElement, { attributes: true, attributeFilter: ['width', 'height'] });
      const reads = () => observer.takeRecords().length;

      // Read back from the renderer, since the stored preference alone proves nothing.
      const levels = [];
      for (const id of ['high', 'balanced', 'smooth', 'basic']) {
        graphics.setMode(id);
        levels.push({ id, ratio: renderer.getPixelRatio(), width: renderer.domElement.width, height: renderer.domElement.height,
          shadow: rendering.scene.children.find(child => child.isDirectionalLight).shadow.mapSize.x,
          shadowRadius: rendering.scene.children.find(child => child.isDirectionalLight).shadow.radius,
          ambientOcclusion: rendering.ambientOcclusion.enabled, aoQuality: rendering.ambientOcclusion.quality });
      }
      graphics.toggleAmbientOcclusion();
      const enabledLevels = [];
      for (const id of ['high', 'balanced', 'smooth', 'basic', 'auto']) {
        graphics.setMode(id);
        enabledLevels.push({ enabled: rendering.ambientOcclusion.enabled, quality: rendering.ambientOcclusion.quality });
      }
      graphics.toggleAmbientOcclusion();
      reads();

      // `rates` is a fixed refresh rate or a per-level rate, so stepping down
      // buys frames the way the controller expects.
      const order = ['high', 'balanced', 'smooth', 'basic'];
      const drive = (rates, start, seconds) => {
        graphics.sample(start, false);
        let time = start;
        for (const end = start + seconds * 1000; time < end;) {
          time += 1000 / (typeof rates === 'number' ? rates : rates[order.indexOf(graphics.levelId)]);
          graphics.sample(time, true);
        }
        return time;
      };
      graphics.setMode('high'); graphics.setMode('auto');
      reads();
      let clock = drive(60, 0, 20);
      const steady = { level: graphics.levelId, writes: reads() };
      clock = drive([24, 61, 61, 61], clock + 1000, 25);
      const slowed = { level: graphics.levelId, ratio: renderer.getPixelRatio(), softShading: graphics.settings.ambientOcclusion, writes: reads() };
      clock = drive(60, clock + 1000, 40);
      const recovered = { level: graphics.levelId, writes: reads() };

      graphics.setMode('high'); reads();
      clock = drive(12, clock + 1000, 30);
      const pinned = { level: graphics.levelId, writes: reads() };
      graphics.setMode('smooth'); graphics.setMode('auto');
      clock = drive([60, 90, 120, 120], clock + 1000, 120);
      const highRefresh = { level: graphics.levelId, target: graphics.target, ratio: renderer.getPixelRatio() };
      observer.disconnect();
      graphics.setMode('auto');
      renderer.render(rendering.scene, rendering.camera);
      return { levels, enabledLevels, steady, slowed, recovered, pinned, highRefresh,
        unchangedProjection: JSON.stringify(projection) === JSON.stringify(camera.projectionMatrix.toArray()) };
    });

    const density = id => result.levels.find(level => level.id === id);
    const expected = id => renderScale(QUALITY_LEVELS.find(level => level.id === id).density, deviceScaleFactor);
    // Levels scale the device ratio so each one drops pixels at every density.
    for (const id of ['high', 'balanced', 'smooth', 'basic']) assert.equal(density(id).ratio, expected(id), `${id} density`);
    for (let i = 1; i < result.levels.length; i++) {
      assert.ok(result.levels[i].ratio < result.levels[i - 1].ratio, `${result.levels[i].id} must draw fewer pixels than ${result.levels[i - 1].id}`);
    }
    assert.equal(density('basic').width, Math.floor(390 * expected('basic')));
    assert.equal(density('basic').height, Math.floor(844 * expected('basic')));
    assert.deepEqual(result.levels.map(level => level.shadow), [2048, 1536, 1024, 512]);
    assert.deepEqual(result.levels.map(level => level.shadowRadius), [2, 2, 2, 0], 'Basic uses the cheaper hardware shadow filter');
    assert.deepEqual(result.levels.map(level => level.ambientOcclusion), [false, false, false, false]);
    assert.deepEqual(result.levels.map(level => level.aoQuality), ['high', 'high', 'low', 'low'], 'the AO budget follows the level');
    assert.ok(result.enabledLevels.every(level => level.enabled), 'no preset, nor Auto, switches the AO opt-in off');
    assert.ok(result.unchangedProjection, 'density never touches the camera projection');

    assert.equal(result.steady.level, 'high', 'a display-rate device keeps its level');
    assert.equal(result.steady.writes, 0, 'no resize without a decision');
    assert.equal(result.slowed.softShading, false, 'soft shading stays off');
    assert.equal(result.slowed.level, 'balanced', 'one step down per decision');
    assert.equal(result.slowed.ratio, expected('balanced'));
    // One resize writes width and height, so two attribute records.
    assert.equal(result.slowed.writes, 2, 'one canvas resize per adjustment');
    assert.equal(result.recovered.level, 'balanced', 'a settled level does not climb back');
    assert.equal(result.recovered.writes, 0);
    assert.equal(result.pinned.level, 'high', 'a chosen level ignores frame times');
    assert.equal(result.highRefresh.level, 'smooth', 'Auto preserves smooth delivery on a faster display');
    assert.ok(Math.abs(result.highRefresh.target - 120) < 1);
    assert.equal(result.highRefresh.ratio, expected('smooth'));

    // Panel matches the renderer across a rotation and a reload.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.querySelector('#scene').style.width === '844px');
    await page.evaluate(() => window.__coastline.graphics.setMode('smooth'));
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), expected('smooth'));
    assert.match(await page.locator('#graphics-status').textContent(), /^Smooth · \d+ × \d+ · soft shading off$/);
    await page.reload();
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    assert.equal(await page.evaluate(() => window.__coastline.graphics.mode), 'smooth', 'the choice is remembered');
    assert.equal(await page.locator('[data-quality="smooth"]').getAttribute('aria-checked'), 'true');

    // The slider sets the real drawing buffer, including above 2x.
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.locator('#graphics-toggle').click();
    const slider = page.locator('#pixel-density');
    assert.equal(await slider.inputValue(), '70');
    await slider.fill('83');
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), deviceScaleFactor * .83);
    await slider.press('ArrowRight');
    assert.equal(await slider.inputValue(), '84', 'keyboard arrows adjust density without driving');
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    await page.evaluate(() => window.__coastline.action('menuNext'));
    assert.equal(await slider.inputValue(), '85', 'controller right adjusts density');
    await slider.press('End');
    assert.equal(await slider.inputValue(), '100');
    assert.equal(await page.locator('#pixel-density-value').textContent(), '100% · Native');
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), deviceScaleFactor);
    await slider.fill('83');
    await page.reload();
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    assert.equal(await slider.inputValue(), '83', 'custom density survives reload');
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.locator('#graphics-toggle').click();
    await page.locator('[data-quality="balanced"]').click();
    assert.equal(await slider.inputValue(), '85', 'a preset restores its density');
    await page.evaluate(() => window.__coastline.action('pause'));

    // The main loop must keep supplying active and inactive samples.
    await page.evaluate(() => {
      const rendering = window.__coastline.rendering, original = rendering.recordFrame;
      window.__samples = [];
      rendering.recordFrame = (time, active) => { window.__samples.push(active); return original(time, active); };
    });
    await page.waitForFunction(() => window.__samples.includes(true));
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.waitForFunction(() => window.__samples.includes(false));

    results.push({ deviceScaleFactor, ...result });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/graphics', { recursive: true });
  await writeFile('.artifacts/graphics/report.json', JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
