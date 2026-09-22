import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = '.artifacts/surface-review';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const records = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), { timeout: 120000 });
  await page.addStyleTag({ content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}' });
  for (const journey of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) {
    const sites = await page.evaluate(async journey => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      await a.changeJourney(journey);
      const prefix = journey === 'coast' ? 'coastal' : journey;
      const module = await import(`/src/world/${prefix}-discoveries.js`);
      const sites = module[`${prefix}Discoveries`](-60000, 60000);
      return [{ kind: 'scenery', s: 64, u: 0 }, ...[...new Set(sites.map(site => site.kind))].map(kind =>
        sites.filter(site => site.kind === kind).sort((x, y) => Math.abs(x.s) - Math.abs(y.s))[0])];
    }, journey);
    for (const site of sites) {
      const record = await page.evaluate(async ({ journey, site }) => {
        const a = window.__coastline;
        a.vehicle.s = site.s; a.vehicle.reset(); a.world.update(site.s); a.vehicle.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(8.5); a.rendering.render();
        const prefix = journey === 'coast' ? '' : journey;
        const route = await import(`/src/world/${prefix ? prefix + '-' : ''}route.js`);
        const point = route[prefix ? prefix + 'Position' : 'positionAt'];
        const u = site.kind === 'cable-car' ? (site.lower.u + site.upper.u) / 2 : site.u ?? 0;
        const p = point(site.s, u);
        const feature = [...a.world.chunks.values()].flatMap(chunk => chunk.features?.discoveries ?? []).find(f => f.kind === site.kind && f.index === site.index);
        if (site.kind !== 'scenery' && !feature) throw new Error(`Missing ${journey} ${site.kind}`);
        const y = site.kind === 'cable-car' ? route.snowRoadHeight(site.s) + 26 : journey === 'jungle'
          ? site.kind === 'temple' ? feature.base + 5 : typeof site.lower === 'number' ? site.lower + 5 : site.level !== undefined ? site.level + 5 : p.y + 5
          : p.y + 5;
        const height = site.kind === 'cable-car' ? 230 : site.kind === 'snowmen' || site.kind === 'cattle-skull' ? 16
          : site.kind === 'windpump' || site.kind === 'temple' ? 36 : site.kind === 'scenery' ? 115 : 70;
        return { journey, kind: site.kind, s: site.s, height, target: [p.x, y, p.z + a.world.origin],
          geometries: a.rendering.renderer.info.memory.geometries };
      }, { journey, site });
      await page.screenshot({ path: `${directory}/${journey}-${site.kind}-drive.png` });
      for (const side of [-1, 1]) {
        await page.evaluate(({ record, side }) => {
          const a = window.__coastline, [x, y, z] = record.target;
          const camera = a.rendering.camera, height = record.height, aspect = innerWidth / innerHeight;
          camera.left = -height * aspect / 2; camera.right = height * aspect / 2;
          camera.top = height / 2; camera.bottom = -height / 2;
          const distance = record.kind === 'cable-car' ? 250 : record.height < 40 ? 28 : 80;
          camera.position.set(x + side * distance, y + distance, z + distance); camera.lookAt(x, y, z); camera.updateProjectionMatrix();
          a.rendering.render();
        }, { record, side });
        await page.screenshot({ path: `${directory}/${journey}-${site.kind}-${side}.png` });
      }
      records.push(record);
      console.log(`${journey}: ${site.kind}`);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ records, errors }, null, 2));
} finally { await browser.close(); }
