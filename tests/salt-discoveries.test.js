import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, positionAt } from '../src/world/route.js';
import { saltDiscoveries, saltDiscoveryClears, saltModelOffset, SALT_DISCOVERY_MILES, SALT_DISCOVERY_SPACING,
  SALT_TRAIN_BOUNDS, SALT_LODGE_BOUNDS } from '../src/world/salt-discoveries.js';
import { CAUSEWAY_TOE, SHOULDER, SALT_LEVEL, WATER_LEVEL, inPool, saltRoadHeight } from '../src/world/salt-route.js';
import { SaltChunk } from '../src/world/salt.js';
import { saltDiscoveryAssets, SALT_LODGE_PAINT } from '../src/world/salt-discovery-assets.js';
import { discoveryMaterial, mirrorInstanceMaterial } from '../src/world/salt-materials.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

const sites = saltDiscoveries(-200000, 200000);
const nearest = test => sites.filter(test).sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0];
const shapeSamples = shape => {
  const points = [], halfS = shape.halfS ?? shape.radius, halfU = shape.halfU ?? shape.radius;
  for (let ds = -halfS; ds <= halfS; ds += 2) for (let du = -halfU; du <= halfU; du += 2) {
    if (shape.radius === undefined || Math.hypot(ds, du) <= shape.radius) points.push([shape.s + ds, shape.u + du]);
  }
  return points;
};
// Model coordinates of a point in a chunk's frame.
function modelPoint(chunk, site, x, z) {
  const root = positionAt(site.s, site.u, 0), dx = x - root.x, dz = z - (root.z + chunk.start);
  const cos = Math.cos(site.yaw), sin = Math.sin(site.yaw);
  return { x: (dx * cos - dz * sin) * site.flip[0], z: (dx * sin + dz * cos) * site.flip[1] };
}

test('salt landmarks are sparse, varied, stable and found on both roadsides', () => {
  assert.equal(SALT_DISCOVERY_SPACING > 3072, true);
  assert.ok(sites.length > 75 && sites.length < 125, 'roughly one special encounter per 2.5 miles');
  assert.deepEqual(saltDiscoveries(-200000, 0).concat(saltDiscoveries(0, 200000)), sites);
  for (const kind of Object.keys(SALT_DISCOVERY_MILES)) for (const side of [-1, 1]) assert.ok(sites.some(s => s.kind === kind && s.side === side), `${kind} on side ${side}`);
  const islands = sites.filter(s => s.kind === 'cactus-island');
  assert.ok(islands.some(s => s.lagoon) && islands.some(s => !s.lagoon), 'most islands have a lagoon, not all');
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i].s - sites[i - 1].s > 900, 'leave breathing room between landmarks');
  for (const site of [...sites].reverse()) {
    const start = Math.floor(site.s / CHUNK_LENGTH) * CHUNK_LENGTH;
    assert.deepEqual(saltDiscoveries(start, start + CHUNK_LENGTH), sites.filter(s => s.s >= start && s.s < start + CHUNK_LENGTH));
    const [main] = site.clear, reach = main.halfU ?? main.radius;
    assert.ok(Math.abs(main.u) - reach >= CAUSEWAY_TOE + 3, `${site.kind} stays off the causeway`);
    assert.equal(saltDiscoveryClears(site.s, site.u, [site]), false);
    assert.equal(saltDiscoveryClears(site.s + 60, site.u, [site]), true);
  }
});

test('buildings and trains stand on dry crust, and lagoon islands rise beside water', () => {
  let checked = 0;
  for (const site of sites.slice(0, 60)) {
    if (site.kind === 'cactus-island') {
      for (const box of site.dry) for (const [s, u] of shapeSamples(box)) assert.equal(inPool(s, u), false, 'the trail starts on dry salt');
      if (!site.lagoon) continue;
      // Water between the island and the camera, where its reflection falls.
      // World offsets stand in for route ones here, close enough this near.
      const wet = [0, 4, 8].some(extra => {
        const p = saltModelOffset(site, 0, site.radius + extra);
        return inPool(site.s - p.z, site.u + p.x);
      });
      assert.ok(wet, `lagoon beside island ${site.index}`);
      continue;
    }
    for (const shape of site.clear) for (const [s, u] of shapeSamples(shape)) {
      if (Math.abs(u) < CAUSEWAY_TOE) continue;
      assert.equal(inPool(s, u), false, `${site.kind} ${site.index} floods at ${s}, ${u}`);
      checked++;
    }
  }
  assert.ok(checked > 2000);
});

test('each salt landmark survives worker transfer with shared models, paint, reflections and colliders', () => {
  for (const kind of Object.keys(SALT_DISCOVERY_MILES)) for (const side of [-1, 1]) {
    const site = nearest(s => s.kind === kind && s.side === side), original = new SaltChunk(Math.floor(site.s / CHUNK_LENGTH));
    const expected = structuredClone(original.features), { data, transfers } = packChunk(original);
    const restored = unpackChunk(structuredClone(data, { transfer: transfers }));
    try {
      assert.deepEqual(restored.features, expected);
      assert.equal(restored.features.discoveries.filter(s => s.index === site.index).length, 1);
      const name = { 'train-graveyard': 'salt-train-graveyard', 'salt-lodge': 'salt-lodge', 'cactus-island': 'salt-cactus-island' }[kind];
      const mesh = restored.group.getObjectByName(name);
      assert.equal(mesh.material, discoveryMaterial);
      const shared = kind === 'train-graveyard' ? [saltDiscoveryAssets.train] : kind === 'salt-lodge' ? saltDiscoveryAssets.lodge : saltDiscoveryAssets.islands[site.variant];
      assert.ok(shared.includes(mesh.geometry), 'models are shared, never copied per chunk');
      if (kind === 'salt-lodge') {
        const paint = restored.group.getObjectByName('salt-lodge-paint'), color = new THREE.Color();
        paint.getColorAt(0, color);
        const paintColor = new THREE.Color(SALT_LODGE_PAINT[site.accent]);
        assert.ok(Math.abs(color.r - paintColor.r) + Math.abs(color.g - paintColor.g) + Math.abs(color.b - paintColor.b) < 1e-5, 'each lodge keeps its paint colour');
        assert.ok(restored.group.getObjectByName('salt-lodge-drive'));
      }
      restored.group.traverse(object => {
        if (!object.name.endsWith('-reflection') || !object.name.startsWith('salt-') || object.material !== mirrorInstanceMaterial) return;
        const m = object.instanceMatrix.array;
        assert.ok(m[5] < 0 && m[13] <= WATER_LEVEL, 'reflections hang upside down under the water');
      });
      // Something solid stands on the landmark itself.
      const root = positionAt(site.s, site.u, 0);
      assert.ok(restored.features.colliders.some(c => Math.hypot(c.x - root.x, c.z - root.z) < (kind === 'train-graveyard' ? 24 : 16)));
      for (const object of restored.group.children) if (object.isInstancedMesh) assert.ok([...object.instanceMatrix.array].every(Number.isFinite), object.name);
    } finally { original.dispose(); restored.dispose(); }
  }
});

test('roadside scenery gives way to lodges and trains, and the lodge drive leaves from the shoulder', () => {
  for (const [kind, bounds] of [['train-graveyard', SALT_TRAIN_BOUNDS], ['salt-lodge', SALT_LODGE_BOUNDS]]) for (const side of [-1, 1]) {
    const site = nearest(s => s.kind === kind && s.side === side), chunks = [-1, 0, 1].map(k => new SaltChunk(Math.floor(site.s / CHUNK_LENGTH) + k));
    const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
    try {
      for (const chunk of chunks) for (const mesh of chunk.group.children) {
        if (!mesh.isInstancedMesh || !/^salt-(boulders|pebbles|piles|tola|delineators|flamingos)/.test(mesh.name) || mesh.name.includes('reflection')) continue;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); p.setFromMatrixPosition(matrix);
          const local = modelPoint(chunk, site, p.x, p.z);
          const inside = local.x > bounds[0] + 1 && local.x < bounds[1] - 1 && local.z > bounds[2] + 1 && local.z < bounds[3] - 1;
          assert.equal(inside, false, `${mesh.name} inside the ${kind} at ${local.x.toFixed(1)}, ${local.z.toFixed(1)}`);
        }
      }
      if (kind !== 'salt-lodge') continue;
      const chunk = chunks[1], drive = chunk.group.getObjectByName('salt-lodge-drive').geometry.attributes.position;
      // Lane edges sit either side of the centre line.
      const start = positionAt(site.drive.s + .85, site.drive.from, 0), expected = saltRoadHeight(site.drive.s + .85) + .045;
      let joined = false;
      for (let i = 0; i < drive.count; i++) {
        if (Math.hypot(drive.getX(i) - start.x, drive.getZ(i) - (start.z + chunk.start)) < .1) {
          assert.ok(Math.abs(drive.getY(i) - expected) < .01, 'the drive is flush with the shoulder');
          joined = true;
        }
        assert.ok(drive.getY(i) > SALT_LEVEL - .35);
      }
      assert.ok(joined && Math.abs(site.drive.from) === SHOULDER);
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});
