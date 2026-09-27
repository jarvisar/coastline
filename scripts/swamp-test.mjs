import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts/swamp', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
const watch = page => {
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
};
const ready = page => page.waitForFunction(() => window.__coastline && !window.__coastline.changingJourney && document.querySelector('#loading.loaded'));
const renderAt = (page, s, view = 'Medium view') => page.evaluate(async ({ s, view }) => {
  const a = window.__coastline;
  if (!a.paused) a.action('pause');
  await a.world.chunkSource.prepare(s); a.world.update(s);
  a.vehicle.s = s; a.vehicle.reset(); a.vehicle.render(1, a.world.origin);
  for (let i = 0; a.rendering.viewLabel !== view && i < 6; i++) a.rendering.toggleView();
  a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize();
  a.world.animate(8.5, a.vehicle); a.rendering.render();
  const chunks = [...a.world.chunks.values()], info = a.rendering.renderer.info;
  const names = ['swamp-ground', 'swamp-water', 'swamp-basin', 'swamp-road', 'swamp-reflections', 'swamp-mist', 'fireflies', 'firefly-reflections'];
  return { s, view: a.rendering.viewLabel, chunks: chunks.length, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1,
    layers: Object.fromEntries(names.map(name => [name, chunks.filter(chunk => chunk.group.getObjectByName(name)).length])),
    discoveries: chunks.flatMap(chunk => chunk.features.discoveries), sky: !!a.rendering.scene.getObjectByName('swamp-sky'),
    headlights: a.world.headlights.parent === a.world.effects && a.world.headlights.light.intensity > 0,
    activeLanterns: a.world.lights.filter(light => light.intensity > 0).length,
    render: { ...info.render }, memory: { ...info.memory } };
}, { s, view });

try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 }); watch(page);
  await page.addInitScript(() => {
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high', ambientOcclusion: true }));
    localStorage.setItem('coastline-traffic', 'false');
    localStorage.setItem('coastline-install-dismissed-v2', String(Date.now()));
  });
  await page.goto(`${url}/?seed=4817`); await ready(page);
  await page.getByRole('button', { name: /^Change route$/i }).click();
  assert.equal(await page.locator('.journey-card').count(), 9);
  await page.getByRole('button', { name: 'Cypress Swamp', exact: true }).click(); await ready(page);
  assert.equal(await page.locator('.location-title').textContent(), 'CYPRESS SWAMP');
  await page.click('#start');
  const { camp, reverseCamp, bridge } = await page.evaluate(async () => {
    const { swampDiscoveries } = await import('/src/world/swamp-discoveries.js');
    const { swampBridgeAt } = await import('/src/world/swamp-route.js');
    return { camp: swampDiscoveries(0, 6000)[0], reverseCamp: swampDiscoveries(-30000, 0).find(site => site.side < 0), bridge: swampBridgeAt(640) };
  });
  const hideUI = await page.addStyleTag({ content: 'body * { visibility: hidden !important; } #scene { visibility: visible !important; }' });
  for (const [label, s] of [['overview', 24], ['camp', camp.s], ['reverse-camp', reverseCamp.s], ['bridge', bridge.center], ['rebase', 4097], ['far', 20000], ['reverse', -12000]]) {
    const state = await renderAt(page, s, label.includes('camp') ? 'Close view' : 'Medium view');
    assert.equal(state.chunks, state.resident);
    for (const [name, count] of Object.entries(state.layers)) assert.equal(count, state.resident, `${name} at ${s}`);
    assert.ok(state.sky && state.headlights && state.memory.geometries < 200);
    if (label.includes('camp')) {
      assert.equal(state.discoveries.length, 1);
      assert.equal(state.discoveries[0].kind, 'fishing-camp'); assert.equal(state.activeLanterns, 1);
    }
    records.push(state);
    if (['overview', 'camp', 'bridge', 'reverse-camp'].includes(label)) await page.screenshot({ path: `.artifacts/swamp/${label}.png` });
  }
  for (const view of ['Scenic view', 'Medium view', 'Close view', 'Extra close view', 'Third-person view', 'First-person view']) {
    const state = await renderAt(page, 80, view); assert.equal(state.view, view);
    await page.screenshot({ path: `.artifacts/swamp/${view.toLowerCase().replaceAll(' ', '-')}.png` });
  }
  // No light, reflection or sky resources should survive leaving the route.
  await page.evaluate(() => window.__coastline.changeJourney('coast')); await ready(page);
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('swamp-night-effects')), false);
  await page.evaluate(() => window.__coastline.changeJourney('swamp')); await ready(page);
  await page.evaluate(() => { const a = window.__coastline; a.graphics.setMode('basic'); if (a.graphics.ambientOcclusion) a.rendering.toggleAO(); });
  const basic = await renderAt(page, 24); assert.equal(basic.chunks, 5); records.push(basic);
  await page.screenshot({ path: '.artifacts/swamp/basic.png' });
  // The same clock drives sky, water, mist and both firefly layers.
  await hideUI.evaluate(element => element.remove());
  await page.evaluate(() => { const a = window.__coastline; if (a.paused) a.action('pause'); });
  const clock = () => page.evaluate(() => window.__coastline.world.sky.material.uniforms.swampTime.value);
  // Captures set a fixed visual time. Let the first resumed frame restore the
  // simulation clock before measuring forward progress.
  const captured = await clock();
  await page.waitForFunction(time => window.__coastline.world.sky.material.uniforms.swampTime.value !== time, captured);
  const moving = await clock();
  await page.waitForFunction(time => window.__coastline.world.sky.material.uniforms.swampTime.value > time, moving);
  await page.keyboard.press('KeyP'); const stopped = await clock(); await page.waitForTimeout(250); assert.equal(await clock(), stopped);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); watch(mobile);
  await mobile.addInitScript(() => {
    localStorage.setItem('coastline-journey', 'swamp');
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'balanced', level: 'balanced', ambientOcclusion: false }));
    localStorage.setItem('coastline-install-dismissed-v2', String(Date.now()));
  });
  await mobile.goto(`${url}/?seed=4817`); await ready(mobile); await mobile.click('#start');
  await renderAt(mobile, camp.s, 'Close view');
  await mobile.addStyleTag({ content: 'body * { visibility: hidden !important; } #scene { visibility: visible !important; }' });
  await mobile.screenshot({ path: '.artifacts/swamp/mobile.png' });
  await writeFile('.artifacts/swamp/report.json', JSON.stringify({ records, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(`Swamp: ${records.length} streaming/quality checks, both discovery banks, all six cameras, pause, route disposal and mobile passed.`);
} finally { await browser.close(); }
