import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/salt-discoveries';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  // Block the Vite HMR socket so file edits don't reload the page mid-capture.
  await page.routeWebSocket(/.*/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173'); url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), null, { timeout: 120000 });
  await page.evaluate(() => window.__coastline.changeJourney('salt'));
  await page.waitForFunction(() => window.__coastline.journey === 'salt' && !window.__coastline.changingJourney);
  await page.addStyleTag({ content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}' });
  // The nearest of each kind on each roadside, plus a dry and a lagoon island.
  const sites = await page.evaluate(async () => {
    const { saltDiscoveries, SALT_DISCOVERY_MILES } = await import('/src/world/salt-discoveries.js');
    const all = saltDiscoveries(-150000, 150000), nearest = test => all.filter(test).sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0];
    return Object.keys(SALT_DISCOVERY_MILES).flatMap(kind => [-1, 1].map(side => nearest(s => s.kind === kind && s.side === side)))
      .concat([nearest(s => s.kind === 'cactus-island' && !s.lagoon)]);
  });
  assert.ok(sites.every(Boolean));
  const label = site => `${site.kind}-${site.side < 0 ? 'left' : 'right'}${site.kind === 'cactus-island' && !site.lagoon ? '-dry' : ''}`;
  const visit = site => page.evaluate(async site => {
    const a = window.__coastline; if (!a.paused) await a.action('pause');
    a.vehicle.s = site.s; a.vehicle.reset(); a.world.update(site.s); a.vehicle.render(1, a.world.origin);
    a.traffic.reset(a.vehicle.route, site.s, 'salt'); a.traffic.render(1, a.world.origin);
    while (a.rendering.viewLabel !== 'Medium view') a.rendering.toggleView();
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.world.animate(8.5); a.rendering.render();
    return { kind: site.kind, side: site.side, s: site.s, u: site.u, chunks: a.world.chunks.size, geometries: a.rendering.renderer.info.memory.geometries,
      features: [...a.world.chunks.values()].flatMap(c => c.features?.discoveries || []).filter(s => s.index === site.index).length };
  }, site);
  for (const site of sites) {
    const record = await visit(site);
    assert.equal(record.features, 1);
    await page.screenshot({ path: `${directory}/${label(site)}-drive.png` });
    // Close views from the game camera's side and from behind.
    for (const [name, dx, dz] of [['detail', -80, 95], ['rear', 80, -95]]) {
      await page.evaluate(async ({ site, dx, dz }) => {
        const a = window.__coastline, { positionAt } = await import('/src/world/route.js'), { SALT_LEVEL } = await import('/src/world/salt-route.js');
        const p = positionAt(site.s, site.u, SALT_LEVEL), z = p.z + a.world.origin, y = SALT_LEVEL + 3;
        const camera = a.rendering.camera, height = site.kind === 'train-graveyard' ? 52 : site.kind === 'cactus-island' ? 50 : 34, aspect = innerWidth / innerHeight;
        camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
        camera.position.set(p.x + dx, y + 70, z + dz); camera.lookAt(p.x, y, z); camera.updateProjectionMatrix(); a.rendering.render();
      }, { site, dx, dz });
      await page.screenshot({ path: `${directory}/${label(site)}-${name}.png` });
    }
    // Driving up to it at road level.
    await page.evaluate(async site => {
      const a = window.__coastline;
      while (a.rendering.viewLabel !== 'Third-person view') a.rendering.toggleView();
      a.vehicle.s = site.s - (site.kind === 'cactus-island' ? 70 : 45); a.vehicle.reset(); a.world.update(a.vehicle.s); a.vehicle.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.rendering.render();
    }, site);
    await page.screenshot({ path: `${directory}/${label(site)}-road.png` });
    records.push(record);
  }
  // Shared models upload once. A second pass must not keep adding geometry.
  const first = Math.max(...records.map(r => r.geometries));
  for (const site of sites) assert.ok((await visit(site)).geometries <= first + 4, 'discoveries share their models');
  await page.evaluate(() => window.__coastline.changeJourney('coast'));
  await page.waitForFunction(() => window.__coastline.journey === 'coast' && !window.__coastline.changingJourney);
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('salt-lodge')), false);
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ passed: true, records, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, records }, null, 2));
} finally { await browser.close(); }
