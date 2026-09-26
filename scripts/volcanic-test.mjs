import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], records = [];
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); }); };
  const ready = page => page.waitForFunction(() => window.__coastline && !window.__coastline.changingJourney && document.querySelector('#loading').classList.contains('loaded'));
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 }); watch(page);
  await page.addInitScript(() => localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high' })));
  await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' }); await ready(page);
  await page.getByRole('button', { name: /^Change route$/i }).click();
  assert.equal(await page.locator('.journey-card').count(), 8);
  await page.getByRole('button', { name: 'Volcanic Rift', exact: true }).click(); await ready(page);
  assert.equal(await page.locator('.location-title').textContent(), 'VOLCANIC RIFT');
  assert.equal(await page.evaluate(() => document.body.dataset.journey), 'volcanic');
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#302728');
  await page.click('#start');
  await page.evaluate(() => window.__coastline.graphics.setMode('high'));
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyR'); await ready(page);
  await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__coastline.vehicle.speed < -2); await page.keyboard.up('ArrowDown');
  await page.keyboard.press('KeyM');
  assert.equal(await page.evaluate(() => window.__coastline.audio.journey), 'volcanic');
  assert.equal(await page.evaluate(() => window.__coastline.audio.enabled), true);
  for (const s of [24, 620, 1025, -1025, 10000]) {
    await page.evaluate(s => { const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap(); }, s);
    await page.waitForTimeout(350);
    const state = await page.evaluate(() => {
      const a = window.__coastline, chunks = [...a.world.chunks.values()], info = a.rendering.renderer.info;
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: chunks.length, resident: behind + ahead + 1, lava: chunks.filter(c => c.group.getObjectByName('volcanic-lava')).length,
        smoke: chunks.filter(c => c.group.getObjectByName('volcanic-smoke')).length, geometry: info.memory.geometries, calls: info.render.calls, triangles: info.render.triangles,
        origin: a.world.origin, carZ: a.vehicle.car.position.z, finiteTraffic: a.traffic.vehicles.every(v => Number.isFinite(v.s)), oceans: !!a.rendering.scene.getObjectByName('animated-ocean') };
    });
    assert.equal(state.chunks, state.resident); assert.equal(state.lava, state.resident); assert.equal(state.smoke, state.resident);
    assert.ok(state.geometry < 300); assert.ok(Math.abs(state.carZ) < 1030); assert.equal(state.finiteTraffic, true); assert.equal(state.oceans, false);
    records.push(state);
    if (s < 1000 && s > 0) await page.screenshot({ path: `.artifacts/volcanic-${s}.png` });
  }
  // Cycle both road-level cameras and all four overhead distances.
  for (let i = 0; i < 6; i++) { await page.keyboard.press('KeyV'); await page.waitForTimeout(200); }
  const clock = () => page.evaluate(() => {
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    window.__coastline.rendering.scene.getObjectByName('volcanic-smoke').material.onBeforeCompile(shader);
    return shader.uniforms.volcanicTime.value;
  });
  const moving = await clock(); await page.waitForTimeout(200); assert.ok(await clock() > moving);
  await page.keyboard.press('KeyP'); const stopped = await clock(); await page.waitForTimeout(250); assert.equal(await clock(), stopped);
  const saved = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance }));
  await page.keyboard.press('Digit1'); await ready(page); assert.equal(await page.evaluate(() => window.__coastline.journey), 'coast');
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('volcanic-smoke')), false);
  await page.keyboard.press('Digit7'); await ready(page); assert.equal(await page.evaluate(() => window.__coastline.journey), 'volcanic');
  assert.deepEqual(await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance })), saved);
  await page.keyboard.press('KeyN'); await ready(page); assert.equal(await page.evaluate(() => window.__coastline.journey), 'salt');
  await page.keyboard.press('Digit7'); await ready(page);
  await page.reload({ waitUntil: 'networkidle' }); await ready(page); assert.equal(await page.evaluate(() => window.__coastline.journey), 'volcanic');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); watch(mobile);
  await mobile.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' }); await ready(mobile);
  await mobile.getByRole('button', { name: /^Change route$/i }).tap();
  await mobile.getByRole('button', { name: 'Volcanic Rift', exact: true }).scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/volcanic-chooser-mobile.png' });
  await mobile.getByRole('button', { name: 'Volcanic Rift', exact: true }).tap(); await ready(mobile);
  await mobile.click('#start'); await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: '.artifacts/volcanic-mobile.png' });
  const stick = await mobile.getByRole('group', { name: 'Virtual joystick', exact: true }).boundingBox(), touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 36 }] });
  await mobile.waitForFunction(() => window.__coastline.vehicle.speed > 4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const report = { passed: true, sevenRoutes: true, keyboardShortcut: true, nextRouteWraps: true, progressRestored: true, selectionPersists: true,
    drivingAndReverse: true, audio: true, smokeAndLavaAnimate: true, pauseFreezesAnimation: true, mobileTouchDriving: true, records };
  await writeFile('.artifacts/volcanic-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
