import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roadHeight, CHUNK_LENGTH } from '../src/world/route.js';
import { volcanicCrossing, crossingChannel, volcanicTerrainHeight, volcanicDrivingRoute, volcanicPosition } from '../src/world/volcanic-route.js';
import { VolcanicChunk } from '../src/world/volcanic.js';
import { terrainSampler } from '../src/world/coastal-assets.js';
import { DrivingController } from '../src/vehicle.js';
import { collideScenery } from '../src/collision.js';

function surfaceLava(chunk) {
  const { position, flow } = chunk.group.getObjectByName('volcanic-lava').geometry.attributes, points = [];
  for (let i = 0; i < position.count; i++) if (flow.getX(i) > 0) points.push(position.getX(i), position.getY(i), position.getZ(i));
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const sample = terrainSampler({ geometry }); geometry.dispose(); return sample;
}

test('crossing layouts keep the road over the river and belong to one chunk', () => {
  for (let i = -12; i <= 12; i++) {
    const bridge = volcanicCrossing(i * 512 + 64), owner = Math.floor(bridge.centre / CHUNK_LENGTH) * CHUNK_LENGTH;
    assert.ok(bridge.start - 7 > owner && bridge.end + 7 < owner + CHUNK_LENGTH);
    assert.ok(roadHeight(bridge.centre) - volcanicTerrainHeight(bridge.centre, 0) > 5);
    for (const u of [-5, 0, 5]) {
      assert.equal(volcanicDrivingRoute.height(bridge.centre, u), roadHeight(bridge.centre));
      assert.equal(volcanicDrivingRoute.water(bridge.centre, u), false);
    }
    for (const u of [-15, 15, 30]) {
      const p = crossingChannel(bridge, u);
      assert.equal(volcanicDrivingRoute.water(p.s, p.u), true, 'both exposed reaches stay impassable');
    }
    const source = crossingChannel(bridge, 40).source, mouth = crossingChannel(bridge, -40).mouth;
    let previous = Infinity;
    for (let u = source - 4; u > mouth; u -= 1) {
      const p = crossingChannel(bridge, u);
      assert.ok(p.level <= previous + .08, `river climbs upstream of bridge ${i} at u=${u}`);
      previous = p.level;
    }
  }
});

test('rendered bridge decks meet both approaches and leave an open lava course underneath', () => {
  for (const index of [-4, 0, 4, 40]) {
    const chunk = new VolcanicChunk(index);
    try {
      assert.equal(chunk.features.bridges.length, 1);
      const bridge = chunk.features.bridges[0], terrain = terrainSampler(chunk.terrain, true);
      const deck = terrainSampler(chunk.group.getObjectByName('volcanic-bridge-abutments'), true);
      const lava = surfaceLava(chunk), rock = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      for (let s = bridge.start - 3; s < bridge.end + 3; s += .8) for (const u of [-4.4, 2.4, 4.4]) {
        const p = volcanicPosition(s, u), z = p.z + chunk.start;
        const top = Math.max(terrain(p.x, z) ?? -Infinity, deck(p.x, z) ?? -Infinity);
        assert.ok(Math.abs(top - roadHeight(s) - .06) < .06, `deck step or hole at ${s}, ${u}: ${top}`);
      }
      for (const u of [-5, 0, 5]) {
        const channel = crossingChannel(bridge, u), p = volcanicPosition(channel.s, u), z = p.z + chunk.start;
        const molten = lava(p.x, z);
        assert.notEqual(molten, null);
        assert.ok(roadHeight(channel.s) - 2.04 - molten > 3, 'clear air remains below the lowest steel flange');
      }
      for (let u = crossingChannel(bridge, -40).mouth + 6; u < crossingChannel(bridge, 40).source - 4; u += 1.3) {
        const channel = crossingChannel(bridge, u), p = volcanicPosition(channel.s, u), z = p.z + chunk.start;
        const molten = lava(p.x, z), obstruction = rock(p.x, z);
        assert.notEqual(molten, null, `missing lava at bridge ${index}, u=${u}`);
        assert.ok(obstruction === null || obstruction < molten + .65, `formation dams bridge ${index}, u=${u}`);
      }
    } finally { chunk.dispose(); }
  }
});

test('cars cross industrial bridges in both directions without invisible collisions', () => {
  const chunk = new VolcanicChunk(0), bridge = chunk.features.bridges[0], chunks = new Map([[0, chunk]]);
  try {
    for (const reverse of [false, true]) {
      const car = new DrivingController(volcanicDrivingRoute, { s: reverse ? bridge.end + 5 : bridge.start - 5 });
      try {
        for (let frame = 0; frame < 1200; frame++) {
          car.update(1 / 60, reverse ? { brake: true } : { forward: true }); collideScenery(car, chunks, 1 / 60);
          assert.equal(volcanicDrivingRoute.water(car.s, car.u), false);
          if (reverse ? car.s < bridge.start - 5 : car.s > bridge.end + 5) break;
        }
        assert.ok(reverse ? car.s < bridge.start - 5 : car.s > bridge.end + 5, 'car completes the crossing');
        assert.equal(car.audioTelemetry.impactSerial, 0, 'the carriageway contains no scenery obstacles');
      } finally { car.disposeModel(); }
    }
  } finally { chunk.dispose(); }
});
