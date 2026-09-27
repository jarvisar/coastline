import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/swamp-discoveries';
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
  await page.addInitScript(() => {
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'high', level: 'high', ambientOcclusion: true }));
    localStorage.setItem('coastline-traffic', 'false');
    localStorage.setItem('coastline-install-dismissed-v2', String(Date.now()));
  });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173'); url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), null, { timeout: 120000 });
  await page.evaluate(() => window.__coastline.changeJourney('swamp'));
  await page.waitForFunction(() => window.__coastline.journey === 'swamp' && !window.__coastline.changingJourney, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}' });
  // The nearest landmark of each kind on each roadside. Chapels are always across the road.
  const sites = await page.evaluate(async () => {
    const { swampDiscoveries } = await import('/src/world/swamp-discoveries.js');
    const all = swampDiscoveries(-200000, 200000), nearest = test => all.filter(test).sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0];
    return ['hollow-cypress', 'chapel', 'riverboat'].flatMap(kind => [1, -1].map(side => nearest(s => s.kind === kind && s.side === side))).filter(Boolean);
  });
  assert.equal(sites.length, 5);
  const label = site => `${site.kind}-${site.side < 0 ? 'left' : 'right'}`;
  const visit = (site, view = 'Medium view', back = 0) => page.evaluate(async ({ site, view, back }) => {
    const a = window.__coastline; if (!a.paused) await a.action('pause');
    const s = site.s - back;
    await a.world.chunkSource?.prepare?.(s);
    a.vehicle.s = s; a.vehicle.reset(); a.world.update(s); a.vehicle.render(1, a.world.origin);
    for (let i = 0; a.rendering.viewLabel !== view && i < 8; i++) a.rendering.toggleView();
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.world.animate(8.5, a.vehicle); a.rendering.render();
    const chunks = [...a.world.chunks.values()], mesh = name => chunks.map(c => c.group.getObjectByName(name)).find(Boolean);
    return { kind: site.kind, side: site.side, s: site.s, u: site.u, geometries: a.rendering.renderer.info.memory.geometries,
      features: chunks.flatMap(c => c.features?.discoveries || []).filter(other => other.index === site.index).length,
      body: !!mesh(site.kind), glow: !!mesh(`${site.kind}-glow`), wheel: !!mesh('riverboat-wheel'), drive: !!mesh('chapel-drive'),
      lights: a.world.lights.filter(light => light.intensity > 0).map(light => light.color.getHexString()) };
  }, { site, view, back });
  for (const site of sites) {
    const record = await visit(site);
    assert.equal(record.features, 1);
    assert.ok(record.body && record.glow, `${site.kind} meshes`);
    assert.equal(record.wheel, site.kind === 'riverboat'); assert.equal(record.drive, site.kind === 'chapel');
    assert.equal(record.lights.length, 1, 'one light follows the landmark');
    await page.screenshot({ path: `${directory}/${label(site)}-drive.png` });
    // Close views from the game camera's side and from behind.
    for (const [name, dx, dz] of [['detail', -80, 95], ['rear', 80, -95]]) {
      await page.evaluate(async ({ site, dx, dz }) => {
        const a = window.__coastline, { positionAt } = await import('/src/world/route.js');
        const p = site.origin ? { x: site.origin[0], y: site.origin[1], z: site.origin[2] } : positionAt(site.s, site.u, 0), z = p.z + a.world.origin, y = p.y + 6;
        const camera = a.rendering.camera, height = site.kind === 'hollow-cypress' ? 80 : 58, aspect = innerWidth / innerHeight;
        camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
        camera.position.set(p.x + dx, y + 70, z + dz); camera.lookAt(p.x, y, z); camera.updateProjectionMatrix(); a.rendering.render();
      }, { site, dx, dz });
      await page.screenshot({ path: `${directory}/${label(site)}-${name}.png` });
    }
    // Driving up to it at road level.
    await visit(site, 'Third-person view', site.kind === 'hollow-cypress' ? 75 : 55);
    await page.screenshot({ path: `${directory}/${label(site)}-road.png` });
    records.push(record);
  }
  // Shared models upload once. A second pass must not keep adding geometry.
  const first = Math.max(...records.map(r => r.geometries));
  for (const site of sites) assert.ok((await visit(site)).geometries <= first + 4, 'discoveries share their models');
  await page.evaluate(() => window.__coastline.changeJourney('coast'));
  await page.waitForFunction(() => window.__coastline.journey === 'coast' && !window.__coastline.changingJourney);
  assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('riverboat')), false);
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ passed: true, records, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, records }, null, 2));
} finally { await browser.close(); }
