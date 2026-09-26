import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = '.artifacts/desert-river';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline, { timeout: 60000 });
  await page.evaluate(() => window.__coastline.changeJourney('desert'));
  await page.waitForFunction(() => window.__coastline.journey === 'desert' && !window.__coastline.changingJourney, { timeout: 60000 });
  await page.click('#start');
  for (const s of [290, 320, 1216, -576, 21000, 320]) {
    await page.evaluate(s => {
      const a = window.__coastline;
      a.vehicle.s = s; a.vehicle.reset(); a.world.update(s); a.vehicle.render(1, a.world.origin); a.rendering.snap();
    }, s);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const a = window.__coastline; let water = 0, bridges = 0;
      a.rendering.scene.traverse(o => { if (o.name === 'desert-creek-water') water++; if (o.name === 'desert-timber-bridge') bridges++; });
      return { s: a.vehicle.s, water, bridges, chunks: a.world.chunks.size, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1, origin: a.world.origin, carZ: a.vehicle.car.position.z,
        geometries: a.rendering.renderer.info.memory.geometries, calls: a.rendering.renderer.info.render.calls };
    });
    // One water sheet per resident chunk at any quality level.
    assert.equal(state.water, state.resident); assert.ok(state.bridges >= 1); assert.equal(state.chunks, state.resident);
    assert.ok(state.geometries < 150); assert.ok(Math.abs(state.carZ) < 1030);
    records.push(state);
    if (s === 290) await page.screenshot({ path: `${output}/desktop-crossing.png` });
  }
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = 291; a.vehicle.reset(); a.rendering.snap(); });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__coastline.vehicle.s > 310, { timeout: 30000 });
  await page.keyboard.up('KeyW'); await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  // Reset lands on a random stretch, so move back to the crossing before reversing.
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = 315; a.vehicle.reset(); a.rendering.snap(); });
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__coastline.vehicle.s < 302, { timeout: 30000 });
  await page.keyboard.up('ArrowDown'); await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = 315; a.vehicle.reset(); a.rendering.snap(); });
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${output}/bridge-detail.png` });
  await page.keyboard.press('KeyV'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${output}/third-person-crossing.png` });
  // Back to medium view for a stable frame in the shader check.
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__coastline.action('pause'));
  // Read the material from the scene. After a Vite hot reload a dynamic import
  // can return a different module instance from the one that built the world.
  const waterTime = () => page.evaluate(() => {
    const material = window.__coastline.rendering.scene.getObjectByName('desert-creek-water').material;
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    material.onBeforeCompile(shader);
    return shader.uniforms.desertWaterTime.value;
  });
  const clockBefore = await waterTime();
  await page.waitForTimeout(350);
  assert.equal(await waterTime(), clockBefore);
  const renderAt = async time => {
    return page.evaluate(time => {
      const a = window.__coastline;
      a.world.animate(time); a.rendering.renderer.render(a.rendering.scene, a.rendering.camera);
      return a.rendering.renderer.domElement.toDataURL();
    }, time);
  };
  assert.notEqual(await renderAt(0), await renderAt(80), 'the almost-still creek should retain a faint animated shimmer over a longer interval');
  await page.evaluate(() => window.__coastline.changeJourney('coast'));
  await page.waitForFunction(() => window.__coastline.journey === 'coast' && !window.__coastline.changingJourney);
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('desert-creek-water')), false);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=17019`, { waitUntil: 'networkidle' });
  await phone.waitForFunction(() => window.__coastline, { timeout: 60000 });
  await phone.evaluate(() => window.__coastline.changeJourney('desert'));
  await phone.waitForFunction(() => window.__coastline.journey === 'desert' && !window.__coastline.changingJourney, { timeout: 60000 });
  await phone.locator('#start').tap();
  await phone.evaluate(() => { const a = window.__coastline; a.vehicle.s = 292; a.vehicle.reset(); a.rendering.snap(); });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${output}/phone-crossing.png` });
  assert.ok(await phone.evaluate(() => {
    const { behind, ahead } = window.__coastline.graphics.settings.chunks;
    return window.__coastline.world.chunks.size === behind + ahead + 1;
  }), 'the phone streams the window its quality level asks for');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ records, errors, checks: ['forward and reverse driving', 'chunk and origin changes', 'water animation', 'pause', 'route cleanup', 'phone view with a second seed'] }, null, 2));
  console.log('Desert river browser checks passed:', records.length, 'streaming locations, desktop and phone views.');
} finally { await browser.close(); }
