import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import { coastlinePwa } from '../scripts/pwa-plugin.mjs';

async function fixture(t, entry) {
  const root = await mkdtemp(path.join(tmpdir(), 'coastline-pwa-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'index.html'), `<script type="module" src="${entry}"></script>`);
  return {
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [coastlinePwa()],
    build: { outDir: 'dist' },
  };
}

test('PWA build writes a service worker with the emitted assets', async t => {
  const config = await fixture(t, '/main.js');
  await writeFile(path.join(config.root, 'main.js'), 'console.log("coastline");');
  const result = await build(config);
  const worker = await readFile(path.join(config.root, 'dist/sw.js'), 'utf8');
  assert.ok(!worker.includes('__BUILD_VERSION__'));
  assert.ok(!worker.includes('__PRECACHE_FILES__'));
  for (const output of result.output) assert.ok(worker.includes(output.fileName), output.fileName);
});

test('PWA plugin preserves the original error when the build fails before writing output', async t => {
  const config = await fixture(t, '/missing-entry.js');
  await assert.rejects(build(config), error => {
    assert.match(String(error), /missing-entry\.js/);
    assert.doesNotMatch(String(error), /scandir/);
    return true;
  });
});
