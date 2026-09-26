import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = new URL(process.env.TEST_URL ?? 'http://127.0.0.1:5173');
url.searchParams.delete('seed');
await mkdir('.artifacts/generation', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], fresh = [], pinned = {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const ready = () => page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  const select = async id => {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, id);
  };
  const snapshot = () => page.evaluate(async () => {
    const a = window.__coastline, { roadFrame } = await import('/src/world/route.js');
    const terrain = [...a.world.chunks.entries()].sort(([left], [right]) => left - right).map(([index, chunk]) => {
      const mesh = chunk.terrain ?? chunk.group.getObjectByName(a.journey === 'snow' ? 'snowy-mountain' : 'desert-floor');
      let hash = 2166136261;
      for (const value of mesh.geometry.attributes.position.array) hash = Math.imul(hash ^ Math.round(value * 10000), 16777619);
      return [index, hash >>> 0];
    });
    return { seed: a.seed, journey: a.journey, s: a.vehicle.s, distance: a.vehicle.distance, speed: a.vehicle.speed,
      u: a.vehicle.u, y: a.vehicle.car.position.y, ground: a.vehicle.route.height(a.vehicle.s, a.vehicle.u) + .13,
      carZ: a.vehicle.car.position.z, origin: a.world.origin, road: roadFrame(0), terrain,
      resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1 };
  });
  function checkSpawn(state) {
    assert.equal(state.distance, 0); assert.equal(state.speed, 0); assert.equal(state.u, 2.4);
    assert.ok(Math.abs(state.y - state.ground) < .0001);
    // One terrain mesh per resident chunk at the current quality level.
    assert.ok(Math.abs(state.carZ) < 1030); assert.equal(state.terrain.length, state.resident);
  }
  for (let i = 0; i < 3; i++) {
    if (i === 0) await page.goto(url.href, { waitUntil: 'networkidle' });
    else await page.reload({ waitUntil: 'networkidle' });
    await ready();
    const state = await snapshot(); checkSpawn(state); fresh.push(state);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `.artifacts/generation/fresh-${i + 1}.png` });
  }
  assert.equal(new Set(fresh.map(state => state.seed)).size, 3);
  assert.equal(new Set(fresh.map(state => state.s)).size, 3);
  assert.notDeepEqual(fresh[0].road, fresh[1].road);
  assert.notDeepEqual(fresh[0].terrain, fresh[1].terrain);
  console.log('Fresh reloads produce different seeds, road bends, terrain and starting positions.');

  url.searchParams.set('seed', '4817');
  for (let visit = 0; visit < 2; visit++) {
    if (visit === 0) await page.goto(url.href, { waitUntil: 'networkidle' });
    else await page.reload({ waitUntil: 'networkidle' });
    await ready();
    for (const id of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city']) {
      await select(id);
      const state = await snapshot(); checkSpawn(state); assert.equal(state.seed, 4817);
      if (visit === 0) {
        pinned[id] = state;
        await page.waitForTimeout(700);
        await page.screenshot({ path: `.artifacts/generation/seeded-${id}.png` });
      } else assert.deepEqual(state, pinned[id]);
    }
  }
  console.log('An explicit seed reproduces all four routes, including their actual terrain meshes.');

  // Stream far enough to evict every starting chunk, then return.
  await page.evaluate(() => window.__coastline.action('pause'));
  const placeCar = s => page.evaluate(s => {
    const a = window.__coastline;
    a.vehicle.s = s; a.vehicle.reset(); a.world.update(s); a.vehicle.render(1, a.world.origin);
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin); a.world.animate(0, a.vehicle);
    a.rendering.renderer.render(a.rendering.scene, a.rendering.camera);
  }, s);
  for (const id of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city']) {
    await select(id);
    for (const s of [pinned[id].s + 4096, -pinned[id].s - 4096, pinned[id].s]) {
      await placeCar(s);
      const state = await snapshot(); checkSpawn(state);
    }
    assert.deepEqual(await snapshot(), pinned[id]);
    await page.evaluate(() => {
      const a = window.__coastline;
      for (let i = 0; i < 1200; i++) a.vehicle.update(1 / 60, { forward: true });
      a.vehicle.reset(); a.world.update(a.vehicle.s); a.vehicle.render(1, a.world.origin);
    });
    const saved = await snapshot(); assert.ok(saved.distance > 300);
    await select(id === 'coast' ? 'desert' : 'coast');
    await select(id);
    assert.deepEqual(await snapshot(), saved);
    const cleanup = await page.evaluate(async () => {
      const a = window.__coastline, oldWorld = a.world;
      const groups = [...oldWorld.chunks.values()].map(chunk => chunk.group);
      const camera = a.rendering.camera, view = a.rendering.viewLabel;
      const paused = a.paused, sound = a.audio.enabled;
      await Promise.all([a.action('reset'), a.action('reset')]);
      return { replaced: a.world !== oldWorld, disposed: oldWorld.chunks.size === 0 && oldWorld.chunkSource.disposed,
        detached: groups.every(group => !group.parent), sources: a.chunkWorker.sources.size,
        cameraKept: camera === a.rendering.camera && view === a.rendering.viewLabel,
        settingsKept: paused === a.paused && sound === a.audio.enabled,
        trafficReset: a.traffic.lastPlayerS === a.vehicle.s && a.traffic.vehicles.every(car => Math.abs(car.s - a.vehicle.s) >= 18) };
    });
    assert.deepEqual(cleanup, { replaced: true, disposed: true, detached: true, sources: 1,
      cameraKept: true, settingsKept: true, trafficReset: true });
    const reset = await snapshot(); checkSpawn(reset);
    assert.equal(reset.journey, id); assert.equal(reset.seed, saved.seed);
    assert.ok(Math.abs(reset.s - saved.s) >= 2048);
    assert.notDeepEqual(reset.terrain, saved.terrain);
    await select(id === 'coast' ? 'desert' : 'coast');
    await select(id);
    assert.deepEqual(await snapshot(), reset);
    // Keep later routes at their original start until their own check runs.
    await placeCar(pinned[id].s);
    await page.evaluate(() => { window.__coastline.vehicle.distance = 0; });
  }
  assert.deepEqual(errors, []);
  const report = { passed: true, fresh, pinned, revisitedChunksMatch: true, savedProgressRestored: true, sceneReset: true, errors };
  await writeFile('.artifacts/generation/report.json', JSON.stringify(report, null, 2));
  console.log('Streaming, origin shifts, full scene resets, resource cleanup and saved journey progress all pass.');
} finally { await browser.close(); }
