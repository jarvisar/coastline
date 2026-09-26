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
  const journey = page => page.evaluate(() => window.__coastline.journey);
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 }); watch(page);
  await page.addInitScript(() => localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high' })));
  await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' }); await ready(page);
  await page.getByRole('button', { name: /^Change route$/i }).click();
  assert.equal(await page.locator('.journey-card').count(), 8);
  await page.getByRole('button', { name: 'Salt Plains', exact: true }).click(); await ready(page);
  assert.equal(await page.locator('.location-title').textContent(), 'SALT PLAINS');
  assert.equal(await page.evaluate(() => document.body.dataset.journey), 'salt');
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#dae8ef');
  await page.click('#start');
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyM');
  assert.equal(await page.evaluate(() => window.__coastline.audio.journey), 'salt');
  for (const s of [24, 620, 1025, -1025, -5150, 10000]) {
    await page.evaluate(s => { const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap(); }, s);
    await page.waitForTimeout(350);
    const state = await page.evaluate(() => {
      const a = window.__coastline, chunks = [...a.world.chunks.values()], info = a.rendering.renderer.info, { behind, ahead } = a.graphics.settings.chunks;
      const named = name => chunks.filter(chunk => chunk.group.getObjectByName(name)).length;
      return { s: a.vehicle.s, chunks: chunks.length, resident: behind + ahead + 1, crust: named('salt-crust'), road: named('salt-causeway-road'), pools: named('salt-pools'),
        reflections: named('salt-boulder-reflections'), geometry: info.memory.geometries, calls: info.render.calls, triangles: info.render.triangles,
        sky: !!a.rendering.scene.getObjectByName('salt-sky-dome'), carZ: a.vehicle.car.position.z, finiteTraffic: a.traffic.vehicles.every(v => Number.isFinite(v.s)),
        oceans: !!a.rendering.scene.getObjectByName('animated-ocean') };
    });
    assert.equal(state.chunks, state.resident); assert.equal(state.crust, state.resident); assert.equal(state.road, state.resident);
    assert.ok(state.pools > 0 && state.reflections > 0, `no pools or reflections near ${state.s}`);
    assert.ok(state.sky && state.geometry < 300 && Math.abs(state.carZ) < 1030 && state.finiteTraffic && !state.oceans);
    records.push(state);
    if (s === -5150) await page.screenshot({ path: '.artifacts/salt-lagoon.png' });
  }
  // The hard crust is open to free driving well away from the causeway.
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = -5150; a.vehicle.reset(); a.vehicle.u = 60; a.vehicle.heading = a.vehicle.route.frame(-5150).angle; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
  const offRoad = await page.evaluate(() => ({ speed: window.__coastline.vehicle.speed, u: window.__coastline.vehicle.u }));
  await page.keyboard.up('KeyW');
  assert.ok(offRoad.speed > 8 && Math.abs(offRoad.u) > 30, `off-road on the salt: ${JSON.stringify(offRoad)}`);
  // Cycle both road-level cameras and all four overhead distances.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('KeyV'); await page.waitForTimeout(250);
    await page.screenshot({ path: `.artifacts/salt-view-${i}.png` });
  }
  const clock = () => page.evaluate(() => window.__coastline.rendering.scene.getObjectByName('salt-sky-dome').material.uniforms.saltTime.value);
  const moving = await clock(); await page.waitForTimeout(200); assert.ok(await clock() > moving);
  await page.keyboard.press('KeyP'); const stopped = await clock(); await page.waitForTimeout(250); assert.equal(await clock(), stopped);
  await page.keyboard.press('KeyP');
  await page.keyboard.press('Digit1'); await ready(page); assert.equal(await journey(page), 'coast');
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('salt-sky-dome')), false);
  await page.keyboard.press('Digit8'); await ready(page); assert.equal(await journey(page), 'salt');
  // Salt is last, so the next route wraps round to the coast.
  await page.keyboard.press('KeyN'); await ready(page); assert.equal(await journey(page), 'coast');
  await page.keyboard.press('Digit8'); await ready(page);
  await page.reload({ waitUntil: 'networkidle' }); await ready(page); assert.equal(await journey(page), 'salt');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); watch(mobile);
  await mobile.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' }); await ready(mobile);
  await mobile.getByRole('button', { name: /^Change route$/i }).tap();
  await mobile.getByRole('button', { name: 'Salt Plains', exact: true }).scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: '.artifacts/salt-chooser-mobile.png' });
  await mobile.getByRole('button', { name: 'Salt Plains', exact: true }).tap(); await ready(mobile);
  await mobile.click('#start'); await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: '.artifacts/salt-mobile.png' });

  await writeFile('.artifacts/salt-report.json', JSON.stringify({ records, eightRoutes: true, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(records));
} finally { await browser.close(); }
