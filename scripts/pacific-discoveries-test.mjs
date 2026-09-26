import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/pacific-discoveries';
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [], records = [];
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), {timeout: 120000});
  const sites = await page.evaluate(async () => {
    const {coastalDiscoveries} = await import('/src/world/coastal-discoveries.js');
    const sites = coastalDiscoveries(-60000, 60000);
    return ['lighthouse', 'dock', 'whale'].map(kind => sites.filter(site => site.kind === kind).sort((a,b) => Math.abs(a.s) - Math.abs(b.s))[0]);
  });
  assert.ok(sites.every(Boolean));
  await page.addStyleTag({content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}'});
  for (const site of [...sites, sites[0]]) {
    const record = await page.evaluate(async site => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      a.vehicle.s = site.s; a.vehicle.reset(); a.world.update(site.s); a.vehicle.render(1, a.world.origin);
      a.rendering.snap();
      while (a.rendering.viewLabel !== 'Medium view') a.rendering.toggleView();
      a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.world.animate(8.5); a.rendering.render();
      return {kind: site.kind, s: site.s, chunks: a.world.chunks.size, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1, geometries: a.rendering.renderer.info.memory.geometries,
        features: [...a.world.chunks.values()].flatMap(chunk => chunk.features.discoveries || [])};
    }, site);
    assert.equal(record.chunks, record.resident);
    assert.equal(record.features.filter(other => other.kind === site.kind && other.index === site.index).length, 1);
    await page.screenshot({path: `${directory}/${site.kind}-drive.png`});
    // Close-up of each model to catch placement, scale and material errors.
    await page.evaluate(async site => {
      const a = window.__coastline, {positionAt} = await import('/src/world/route.js');
      const p = positionAt(site.s, site.u, site.kind === 'lighthouse' ? undefined : 1);
      const target = {x:p.x, y:p.y + (site.kind === 'lighthouse' ? 5 : 0), z:p.z + a.world.origin};
      const camera = a.rendering.camera, height = site.kind === 'lighthouse' ? 65 : 38, aspect = innerWidth / innerHeight;
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
      camera.position.set(target.x - 80, target.y + 85, target.z + 100); camera.lookAt(target.x,target.y,target.z); camera.updateProjectionMatrix();
      a.rendering.render();
    }, site);
    await page.screenshot({path: `${directory}/${site.kind}-detail.png`});
    records.push(record);
  }
  assert.ok(records.at(-1).geometries <= records[0].geometries + 8, 'returning to a site must release streamed geometry');
  for (const index of [-1, 0, 1, 4]) {
    await page.evaluate(async index => {
      const a = window.__coastline, {pondAt} = await import('/src/world/route.js');
      const pond = pondAt(246 + index * 704);
      a.vehicle.s = pond.center; a.vehicle.reset(); a.world.update(pond.center); a.vehicle.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.world.animate(8.5); a.rendering.render();
    }, index);
    await page.screenshot({path: `${directory}/pond-${index}-drive.png`});
    await page.evaluate(async index => {
      const a = window.__coastline, {pondAt, positionAt} = await import('/src/world/route.js');
      const pond = pondAt(246 + index * 704), p = positionAt(pond.center, pond.u, pond.level);
      a.vehicle.s = pond.center; a.vehicle.reset(); a.world.update(pond.center); a.vehicle.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(8.5);
      const camera = a.rendering.camera, height = 105, aspect = innerWidth / innerHeight, z = p.z + a.world.origin;
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
      camera.position.set(p.x - 80, p.y + 125, z + 100); camera.lookAt(p.x, p.y, z); camera.updateProjectionMatrix(); a.rendering.render();
    }, index);
    await page.screenshot({path: `${directory}/pond-${index}.png`});
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({passed:true, records, errors}, null, 2));
  console.log(JSON.stringify({passed:true, records:records.map(({features,...rest})=>rest)}, null, 2));
} finally { await browser.close(); }
