import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], records = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  const initial = await page.evaluate(() => { const a = window.__coastline; return { rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(), color: a.rendering.scene.background.getHex(), exposure: a.rendering.renderer.toneMappingExposure, fog: a.rendering.scene.fog.near, lamps: a.vehicle.nightLights[0].material.emissiveIntensity }; });
  await page.getByRole('button', { name: /^Change route$/i }).click();
  assert.equal(await page.locator('.journey-card').count(), 8);
  await page.getByRole('button', { name: 'Rainy Downtown', exact: true }).click();
  await page.waitForFunction(() => window.__coastline.journey === 'city' && !window.__coastline.changingJourney);
  assert.equal(await page.locator('.location-title').textContent(), 'RAINY DOWNTOWN');
  assert.equal(await page.evaluate(() => document.body.dataset.journey), 'city');
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#b3bcc4');
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.car.getObjectByName('city-bike').visible), true);
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.car.getObjectByName('surfboard').visible), false);
  // The storm runs the lamps part way up.
  assert.ok(await page.evaluate(lamps => window.__coastline.vehicle.nightLights[0].material.emissiveIntensity > lamps + .5, initial.lamps));
  assert.equal(await page.evaluate(() => window.__coastline.traffic.vehicles.length), 9);
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.artifacts/city-welcome.png' });
  await page.click('#start');
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__coastline.vehicle.speed < -2); await page.keyboard.up('ArrowDown');
  // Steering into the kerb stops at it.
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); await page.waitForTimeout(2500); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
  assert.ok(await page.evaluate(() => Math.abs(window.__coastline.vehicle.u) <= 5.9001));
  for (const s of [24, 180, 498, 1025, 10000, -300]) {
    await page.evaluate(s => { const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap(); }, s);
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const a = window.__coastline, info = a.rendering.renderer.info, names = {};
      a.rendering.scene.traverse(object => { if (object.name) names[object.name] = (names[object.name] ?? 0) + 1; });
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: a.world.chunks.size, resident: behind + ahead + 1, geometry: info.memory.geometries, triangles: info.render.triangles, calls: info.render.calls, origin: a.world.origin, carZ: a.vehicle.car.position.z,
        rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(),
        blocks: names['city-blocks'] ?? 0, rivers: names['city-river'] ?? 0, skylines: names['city-skyline'] ?? 0, promenades: names['city-promenade'] ?? 0, sideRoads: names['city-side-roads'] ?? 0, bridges: [...a.world.chunks.values()].flatMap(chunk => chunk.features.bridges).length, puddles: names.puddles ?? 0, lamps: names['street-lamps'] ?? 0, rain: names['falling-rain'] ?? 0, effects: names['city-storm-effects'] ?? 0, oceans: names['animated-ocean'] ?? 0,
        dropSizes: new Set(a.world.dropGeometry.attributes.dropSize.array).size };
    });
    assert.equal(result.chunks, result.resident); assert.equal(result.blocks, result.resident); assert.equal(result.rivers, result.resident); assert.equal(result.skylines, result.resident);
    assert.equal(result.promenades, result.resident); assert.equal(result.sideRoads, result.resident); assert.equal(result.puddles, 0);
    assert.ok(result.lamps >= result.resident); assert.equal(result.rain, 1); assert.equal(result.effects, 1); assert.equal(result.oceans, 0);
    assert.ok(result.geometry < 240); assert.ok(Math.abs(result.carZ) < 1030); assert.ok(result.dropSizes > 100);
    assert.deepEqual(result.scale, initial.scale); assert.equal(result.top, initial.top);
    result.rotation.forEach((v, i) => assert.ok(Math.abs(v - initial.rotation[i]) < 1e-10));
    records.push(result);
    if (s >= 0 && s < 1000) await page.screenshot({ path: `.artifacts/city-${s}.png` });
  }
  // Rain animates while driving and freezes when paused.
  const rainState = () => page.evaluate(() => Array.from(window.__coastline.world.dropGeometry.attributes.position.array.slice(0, 12)));
  const moving = await rainState(); await page.waitForTimeout(500); assert.notDeepEqual(await rainState(), moving);
  await page.keyboard.press('KeyP'); const stopped = await rainState(); await page.waitForTimeout(500); assert.deepEqual(await rainState(), stopped);
  const saved = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance }));
  for (const id of ['coast', 'city', 'snow', 'city', 'plains', 'coast']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, id);
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    assert.ok(await page.evaluate(() => window.__coastline.rendering.renderer.info.memory.geometries < 240));
    if (id === 'city') assert.deepEqual(await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance })), saved);
    else {
      assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('city-storm-effects')), false);
      assert.equal(await page.evaluate(() => [...window.__coastline.world.chunks.values()].some(chunk => chunk.group.getObjectByName('city-river'))), false);
    }
    if (id === 'coast') {
      assert.equal(await page.evaluate(() => window.__coastline.rendering.scene.background.getHex()), initial.color);
      assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.toneMappingExposure), initial.exposure);
      assert.equal(await page.evaluate(() => window.__coastline.rendering.scene.fog.near), initial.fog);
      assert.equal(await page.evaluate(() => window.__coastline.vehicle.nightLights[0].material.emissiveIntensity), initial.lamps);
      assert.equal(await page.evaluate(() => window.__coastline.traffic.vehicles.length), 6);
    }
  }
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url, { waitUntil: 'networkidle' }); await mobile.waitForFunction(() => window.__coastline);
  await mobile.getByRole('button', { name: /^Change route$/i }).tap();
  await mobile.screenshot({ path: '.artifacts/seven-journeys-mobile.png' });
  await mobile.getByRole('button', { name: 'Rainy Downtown', exact: true }).tap();
  await mobile.waitForFunction(() => window.__coastline.journey === 'city' && !window.__coastline.changingJourney);
  await mobile.click('#start'); await mobile.waitForTimeout(2000);
  await mobile.screenshot({ path: '.artifacts/city-mobile.png' });
  const stick = await mobile.getByRole('group', { name: 'Virtual joystick', exact: true }).boundingBox();
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 36 }] });
  await mobile.waitForFunction(() => window.__coastline.vehicle.speed > 4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const report = { passed: true, sevenRoutes: true, unchangedCamera: true, cityDrivingAndReverse: true, kerbsStop: true, rainAnimates: true, pausedRainFreezes: true, savedProgress: true, daylightRestored: true, mobileTouchDriving: true, records };
  await writeFile('.artifacts/city-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
