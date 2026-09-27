import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, roadFrame, positionAt } from '../src/world/route.js';
import { swampDiscoveries, swampDiscoveryNear, swampPad, swampDriveway, routeOf, SWAMP_DISCOVERY_MILES, SWAMP_DISCOVERY_SPACING, CHAPEL_SETBACK }
  from '../src/world/swamp-discoveries.js';
import { WATER_LEVEL, swampGround, swampHeight, swampRoadHeight, swampBridgeAt } from '../src/world/swamp-route.js';
import { swampLandmarkGeometry, SWAMP_LANDMARKS } from '../src/world/swamp-discovery-assets.js';
import { landmarkMatrix, swampDiscoveryLight, chapelDrive } from '../src/world/swamp-discovery-scenery.js';
import { SwampChunk } from '../src/world/swamp.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

const KINDS = ['fishing-camp', 'hollow-cypress', 'chapel', 'riverboat'];
const MESHES = { 'fishing-camp': ['fishing-camp', 'camp-windows', 'fishing-camp-reflection', 'camp-windows-reflection'],
  'hollow-cypress': ['hollow-cypress', 'hollow-cypress-glow', 'hollow-cypress-reflection', 'hollow-cypress-glow-reflection'],
  chapel: ['chapel', 'chapel-glow'], riverboat: ['riverboat', 'riverboat-glow', 'riverboat-wheel', 'riverboat-reflection', 'riverboat-glow-reflection', 'riverboat-wheel-reflection'] };

test('swamp discoveries share one schedule and remain stable across reversed queries and cache eviction', () => {
  assert.deepEqual(Object.keys(SWAMP_DISCOVERY_MILES), KINDS);
  assert.ok(Math.abs(1 / Object.values(SWAMP_DISCOVERY_MILES).reduce((sum, miles) => sum + 1 / miles, 0) - 2.5) < .01);
  const sites = swampDiscoveries(-1000000, 1000000), reversed = [];
  for (let end = 1000000; end > -1000000; end -= 2107) reversed.push(...swampDiscoveries(Math.max(-1000000, end - 2107), end));
  assert.deepEqual(reversed.sort((a, b) => a.s - b.s), sites);
  for (const kind of KINDS) assert.ok(sites.filter(site => site.kind === kind).length > 80, `${kind} is scheduled`);
  for (const [i, site] of sites.entries()) {
    if (i) assert.ok(site.s - sites[i - 1].s > SWAMP_DISCOVERY_SPACING * .3);
    assert.equal(swampDiscoveryNear(site.s, site.u)?.index, site.index);
    assert.equal(swampDiscoveryNear(site.s + site.half + site.radius + 20, site.u), null);
    assert.deepEqual(swampDiscoveries(site.s, site.s + 1), [site]);
    assert.deepEqual(swampDiscoveries(site.s - 1, site.s), []);
  }
});

test('landmarks keep clear of bridges; the tree and boat stand in open water, tall ones well back on the camera side', () => {
  const sites = swampDiscoveries(-300000, 300000);
  for (const site of sites) {
    assert.ok(Math.abs(site.s - swampBridgeAt(site.s).center) >= 120 + site.half, `${site.kind} ${site.index} meets a bridge`);
    if (site.kind === 'chapel' || site.kind === 'fishing-camp') continue;
    assert.ok(swampGround(site.s, site.u) < WATER_LEVEL - 1, `${site.kind} ${site.index} stands on land`);
    // Near-side trees are kept below the camera's sightline to the road; the landmarks follow the same rule.
    const height = swampLandmarkGeometry[site.kind].body.boundingBox.max.y * SWAMP_LANDMARKS[site.kind].scale;
    if (site.side < 0) assert.ok(height < -site.u * .72 - 3, `${site.kind} ${site.index} blocks the road`);
  }
  const trees = sites.filter(site => site.kind === 'hollow-cypress');
  assert.ok(trees.filter(site => site.side > 0).length > trees.length * .6, 'most hollow cypresses face the camera across the road');
});

test('the chapel sits square to the road on a level lawn, and its drive opens the guardrail onto the shoulder', () => {
  const chapels = swampDiscoveries(-300000, 300000).filter(site => site.kind === 'chapel');
  assert.ok(chapels.length > 25);
  for (const site of chapels) {
    assert.equal(site.side, 1, 'always across the road from the camera');
    const frame = roadFrame(site.s), matrix = landmarkMatrix(site), origin = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(Math.abs(site.level - (swampRoadHeight(site.s) - .35)) < 1e-9);
    assert.ok(Math.abs(Math.hypot(origin.x - frame.x, origin.z - frame.z) - CHAPEL_SETBACK) < 1e-6);
    // The drive starts on the shoulder at road level wherever the road bends,
    // and stays within the gap in the guardrail.
    const drive = chapelDrive(site, 0).attributes.position, near = [];
    for (let i = 0; i < drive.count; i++) {
      const { s, u } = routeOf(drive.getX(i), drive.getZ(i), site.s, 10);
      assert.ok(u > 6 && u < CHAPEL_SETBACK - 13, `drive vertex at ${u.toFixed(2)} m`);
      if (u < 8) assert.ok(swampDriveway(s, .1), 'drive crosses the guardrail line outside its gap');
      if (u < 6.2) near.push(drive.getY(i) - swampRoadHeight(s));
    }
    // Skirts hang below; the surface itself meets the shoulder.
    assert.ok(near.length && near.filter(dy => dy > -.3).every(dy => Math.abs(dy - .045) < .02), 'the drive starts level with the road');
    assert.ok(!swampDriveway(site.drive[0] - 20) && !swampDriveway(site.drive[1] + 20));
    // Level fill under the lot, the chapel and the churchyard; the road itself is untouched.
    for (const [x, z] of [[-10, 0], [-2, 15], [12, 0], [18, 14], [-15, -16], [22, 20]]) {
      const p = new THREE.Vector3(x, 0, z).applyMatrix4(matrix), { s, u } = routeOf(p.x, p.z, site.s, CHAPEL_SETBACK);
      assert.equal(swampPad(s, u)?.amount, 1, `no pad at ${x}, ${z}`);
      assert.ok(Math.abs(swampGround(s, u) - site.level) < 1e-9);
    }
    for (const s of [site.s - 20, site.s, site.s + 20]) assert.equal(swampHeight(s, 0), swampRoadHeight(s));
  }
});

test('each discovery has one owning chunk with its meshes, reflections and metadata after transfer', () => {
  const seen = new Set();
  for (const site of swampDiscoveries(-40000, 40000)) {
    if (seen.has(site.kind) && seen.size < KINDS.length) continue;
    seen.add(site.kind);
    const index = Math.floor(site.s / CHUNK_LENGTH);
    for (const neighbor of [-1, 0, 1]) {
      const chunk = new SwampChunk(index + neighbor), packed = packChunk(chunk), restored = unpackChunk(packed.data);
      const owned = restored.features.discoveries.filter(other => other.index === site.index);
      assert.equal(owned.length, neighbor === 0 ? 1 : 0);
      for (const name of MESHES[site.kind]) assert.equal(!!restored.group.getObjectByName(name), neighbor === 0, `${name} in chunk ${index + neighbor}`);
      if (neighbor === 0) {
        assert.deepEqual(owned, [site]);
        // Landmarks share one model; the chunk only owns its instance.
        if (site.kind !== 'fishing-camp') assert.equal(restored.group.getObjectByName(site.kind).geometry, swampLandmarkGeometry[site.kind].body);
        // The chapel stands back on dry land and has no reflection.
        const body = restored.group.getObjectByName(site.kind), mirror = restored.group.getObjectByName(`${site.kind}-reflection`);
        assert.equal(!!mirror, site.kind !== 'chapel');
        if (mirror && site.kind !== 'fishing-camp') {
          assert.equal(mirror.geometry, swampLandmarkGeometry[site.kind].reflection);
          assert.equal(mirror.instanceMatrix, body.instanceMatrix, 'reflections reuse the landmark matrix buffer after transfer');
        }
        if (mirror) assert.ok(mirror.scale.y === -1 && mirror.position.y === WATER_LEVEL * 2);
      }
      chunk.dispose(); restored.dispose();
    }
  }
  assert.equal(seen.size, KINDS.length);
});

test('the guardrail opens for the chapel drive and nothing else', () => {
  const site = swampDiscoveries(-40000, 40000).find(other => other.kind === 'chapel'), middle = (site.drive[0] + site.drive[1]) / 2;
  const chunk = new SwampChunk(Math.floor(middle / CHUNK_LENGTH)), rails = chunk.group.getObjectByName('guardrails'), matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  const gate = positionAt(middle, 7.45, 0), gap = [];
  for (let i = 0; i < rails.count; i++) {
    rails.getMatrixAt(i, matrix); p.setFromMatrixPosition(matrix);
    gap.push(Math.hypot(p.x - gate.x, p.z - (gate.z + chunk.start)));
  }
  assert.ok(Math.min(...gap) > 4, 'no rail or post across the drive');
  assert.ok(chunk.features.colliders.every(c => Math.hypot(c.x - gate.x, c.z - gate.z) > 3), 'no solid rail across the drive');
  chunk.dispose();
});

test('every discovery lends a light in its own colour, placed on the model', () => {
  for (const site of swampDiscoveries(-60000, 60000)) {
    const light = swampDiscoveryLight(site);
    assert.ok(light.intensity > 0 && light.distance > 0 && /^#[0-9a-f]{6}$/.test(light.color));
    const ground = site.kind === 'chapel' ? site.level : WATER_LEVEL;
    assert.ok(light.position.y > ground && light.position.y < ground + 12, `${site.kind} light at ${light.position.y}`);
  }
});
