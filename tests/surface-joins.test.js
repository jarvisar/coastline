import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { joinCoplanarFaces, roofShell } from '../src/world/surface-joins.js';
import { loadScenery } from '../src/world/scenery.js';
import { coplanarOverlaps } from './surface-audit.js';

test('overlapping surface patches meet without holes, depth layers, or lost attributes', () => {
  const g = new THREE.BufferGeometry();
  // Two overlapping squares with differently colored surfaces and a scalar
  // shader attribute. The second square owns the shared two-square-meter area.
  const vertices = [], colors = [], glow = [];
  for (const [x, tint] of [[0, 0], [1, 1]]) {
    for (const [dx, y] of [[0, 0], [2, 0], [2, 2], [0, 0], [2, 2], [0, 2]]) {
      vertices.push(x + dx, y, 0); colors.push(tint, 1 - tint, 0); glow.push(x + dx + y);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('discoveryGlow', new THREE.Float32BufferAttribute(glow, 1));
  assert.ok(coplanarOverlaps(g).length);
  joinCoplanarFaces(g); g.computeVertexNormals();
  assert.deepEqual(coplanarOverlaps(g), []);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  let area = 0;
  const p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  assert.ok(Math.abs(area - 6) < 1e-6, `union area is ${area}`);
  for (let x = .07; x < 3; x += .19) for (let y = .09; y < 2; y += .23) {
    const hits = new THREE.Raycaster(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1)).intersectObject(mesh);
    assert.equal(hits.length, 1, `surface coverage at ${x}, ${y}`);
    const i = hits[0].face.a;
    assert.equal(g.attributes.color.getX(i), x > 1 ? 1 : 0, 'later trim owns the overlap');
  }
  for (let i = 0; i < p.count; i++) {
    assert.equal(p.getZ(i), 0);
    assert.ok(Math.abs(g.attributes.discoveryGlow.getX(i) - p.getX(i) - p.getY(i)) < 1e-6);
    assert.equal(g.attributes.normal.getZ(i), 1);
  }
  g.dispose(); mesh.material.dispose();
});

test('separated, crossing, and opposite-facing surfaces keep their geometry', () => {
  for (const vertices of [
    [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, .002, 2, 0, .002, 0, 2, .002],
    [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, -.1, 2, 0, .1, 0, 2, 0],
    [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0],
  ]) {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const before = g.attributes.position.array.slice();
    joinCoplanarFaces(g);
    assert.deepEqual(g.attributes.position.array, before);
    g.dispose();
  }
});

test('gable and gambrel shells close every ridge, pitch break, and end', () => {
  for (const profile of [[[-3, 3], [0, 5], [3, 3]], [[-4, 3], [-2, 6], [0, 7], [2, 6], [4, 3]]]) {
    const g = roofShell(profile, 8), edges = new Map(), p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
      const key = [i + j, i + (j + 1) % 3].map(k => [p.getX(k), p.getY(k), p.getZ(k)].map(v => v.toFixed(5)).join(',')).sort().join('/');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    assert.ok([...edges.values()].every(count => count === 2), 'every edge has exactly two incident faces');
    assert.deepEqual(coplanarOverlaps(g), []);
    g.dispose();
  }
});

test('consecutive quay railing spans join without overlapping end posts', async () => {
  const { cityAssets } = await import('../src/world/city-assets.js');
  const neighbor = cityAssets.railing.clone().translate(0, 0, 4);
  const joined = mergeGeometries([cityAssets.railing, neighbor]);
  assert.deepEqual(coplanarOverlaps(joined), []);
  joined.dispose(); neighbor.dispose();
});

test('all seven routes and every discovery kind have no competing opaque faces', async () => {
  const seen = new WeakSet();
  let kindsChecked = 0, geometriesChecked = 0;
  for (const journey of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'volcanic']) {
    const { Chunk } = await loadScenery(journey), prefix = journey === 'coast' ? 'coastal' : journey;
    const module = await import(`../src/world/${prefix}-discoveries.js`);
    const sites = module[`${prefix}Discoveries`](-60000, 60000);
    const kinds = [...new Set(sites.map(site => site.kind))];
    kindsChecked += kinds.length;
    const indices = new Set([-1, 0, 1, 3, ...kinds.map(kind =>
      Math.floor(sites.filter(site => site.kind === kind).sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0].s / 128))]);
    for (const index of indices) {
      const chunk = new Chunk(index);
      try {
        chunk.group.traverse(mesh => {
          // Foam, smoke and other transparent shader effects intentionally
          // blend layers, and animated birds move their wings after upload.
          if (!mesh.isMesh || mesh.material.transparent || !mesh.material.depthWrite ||
              mesh.geometry.attributes.birdWing || seen.has(mesh.geometry)) return;
          seen.add(mesh.geometry); geometriesChecked++;
          assert.deepEqual(coplanarOverlaps(mesh.geometry), [], `${journey}, chunk ${index}, ${mesh.name}`);
        });
      } finally { chunk.dispose(); }
    }
  }
  assert.equal(kindsChecked, 24);
  assert.ok(geometriesChecked > 250);
});
