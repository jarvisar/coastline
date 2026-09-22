import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, roadHeight } from '../src/world/route.js';
import { volcanicColumns, volcanicHeight, volcanicPosition, volcanicDrivingRoute, riftProfile, shelfFlow, creekSection, crossingInfluence } from '../src/world/volcanic-route.js';
import { terrainSampler } from '../src/world/coastal-assets.js';
import { VolcanicChunk, VolcanicWorld } from '../src/world/volcanic.js';
import { volcanicClock } from '../src/world/volcanic-materials.js';
import { VolcanicAtmosphere } from '../src/world/volcanic-atmosphere.js';
import { DrivingController } from '../src/vehicle.js';
import { residentWindow } from '../src/world/resident.js';

test('volcanic road stays continuous with a left basin and a surface creek on the right', () => {
  for (let s = -40000; s <= 40000; s += 13) {
    const columns = volcanicColumns(s);
    for (let i = 1; i < columns.length; i++) assert.ok(columns[i] > columns[i - 1]);
    for (const u of [-7, 0, 7]) {
      assert.equal(volcanicHeight(s, u), roadHeight(s));
      assert.equal(volcanicDrivingRoute.water(s, u), false);
    }
    for (const side of [-1, 1]) {
      const { near, far, level } = riftProfile(s, side), creek = creekSection(s), u = side < 0 ? -(near + far) / 2 : creek.u;
      assert.ok(volcanicHeight(s, u) < level);
      assert.ok(volcanicDrivingRoute.water(s, u));
      assert.ok(near > 18);
      if (side < 0) assert.equal(roadHeight(s) - level, 8);
      else {
        assert.ok(creek.width >= 1.7 && creek.width < 9, 'narrow flows open into occasional pools');
        const ground = volcanicHeight(s, u), banks = Math.min(volcanicHeight(s, u - 6), volcanicHeight(s, u + 6));
        assert.ok(banks - ground < .8, 'the creek does not excavate a trench through the hillside');
        assert.ok(level - ground < .4, 'lava follows the local hillside elevation');
      }
      assert.ok(Math.abs(volcanicHeight(s + .001, side * 15) - volcanicHeight(s - .001, side * 15)) < .01);
    }
  }
});

test('free driving reaches the ash shoulder and stops before either lava rift', () => {
  for (const s of [-1025, 24, 1025, 10000]) for (const side of [-1, 1]) {
    const car = new DrivingController(volcanicDrivingRoute, { s, distance: 0 });
    car.toggleFreeDriving(); car.heading = car.route.frame(car.s).angle + side * Math.PI / 2;
    for (let i = 0; i < 1200; i++) {
      car.update(1 / 60, { forward: true });
      assert.equal(car.route.water(car.s, car.u), false);
      assert.ok(Number.isFinite(car.car.position.y));
    }
    assert.ok(side * car.u > 10);
    const creek = creekSection(car.s), shore = side < 0 ? riftProfile(car.s, side).near + 1 : creek.u - creek.width / 2;
    assert.ok(Math.abs(car.u) < shore, 'the car stops on dry ground before the visible lava');
    car.disposeModel();
  }
});

test('right-hand spillways follow the shelves and leave the road and shoulder solid', () => {
  for (let index = -80; index <= 80; index++) {
    const s = index * CHUNK_LENGTH + 24;
    for (const branch of [false, true]) {
      const probe = shelfFlow(index, branch, 40), u = probe.end + 3, flow = shelfFlow(index, branch, u);
      assert.equal(volcanicDrivingRoute.water(flow.s, u), true, `flow is impassable at ${flow.s}`);
    }
    for (const u of [0, 7, 12, 17]) {
      assert.equal(volcanicDrivingRoute.water(s, u), false);
      assert.ok(Math.abs(volcanicHeight(s, u) - roadHeight(s)) < 1);
    }
    assert.equal(volcanicDrivingRoute.water(s + 24, 22), false, 'dry apron between spillways');
  }
});

test('the creek and its supporting shelf share a gentle grade without cliff crossings', () => {
  for (let s = -40000; s < 40000; s += 7) {
    const creek = creekSection(s), next = creekSection(s + 1), height = volcanicHeight(s, creek.u);
    assert.ok(Math.abs(volcanicHeight(s + 1, next.u) - height) < .2, `abrupt drop along creek at ${s}`);
    for (const offset of [-1, 1]) {
      const bank = volcanicHeight(s, creek.u + offset * (creek.width / 2 + 2));
      if (crossingInfluence(s, creek.u + offset * (creek.width / 2 + 2)) > .01) {
        assert.ok(bank <= height + .08 && height - bank < 2, 'a bridge tributary drains gently from the creek shelf');
      } else assert.ok(Math.abs(bank - height) < .08, 'unbroken creek banks share the same shelf');
    }
  }
});

test('right-hand molten surfaces stay attached to terrain facets', () => {
  for (const index of [-9, 0, 5, 10, 65]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const { position, flow } = chunk.group.getObjectByName('volcanic-lava').geometry.attributes;
      assert.equal(flow.count, position.count);
      let sampled = 0;
      for (let i = 0; i < position.count; i += 3) {
        if (flow.getX(i) <= 0) continue;
        const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
        const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
        const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3, bed = ground(x, z);
        assert.notEqual(bed, null, 'flow stays over the owned terrain');
        assert.ok(Math.abs(y - bed - .075) < .02, `flow floats or clips into rock at chunk ${index}: ${y - bed}`);
        sampled++;
      }
      assert.ok(sampled > 300, 'surface flows are present');
    } finally { chunk.dispose(); }
  }
});

test('rendered tributaries and receiving pools do not stack faces at their junctions', () => {
  for (const index of [-2, 0, 5]) {
    const chunk = new VolcanicChunk(index);
    try {
      const { flow, flowCoordinates } = chunk.group.getObjectByName('volcanic-lava').geometry.attributes;
      const faces = [], bins = new Map(), key = (s, u) => `${s},${u}`;
      const cross = (a, b, p) => (b.s - a.s) * (p.u - a.u) - (b.u - a.u) * (p.s - a.s);
      for (let i = 0; i < flow.count; i += 3) {
        if (flow.getX(i) <= 0) continue;
        const points = [0, 1, 2].map(n => ({ s: flowCoordinates.getX(i + n), u: flowCoordinates.getY(i + n) }));
        const area = cross(...points);
        if (Math.abs(area) < .002) continue;
        const face = { points, area, centre: { s: points.reduce((n, p) => n + p.s, 0) / 3, u: points.reduce((n, p) => n + p.u, 0) / 3 } };
        faces.push(face);
        for (let s = Math.floor(Math.min(...points.map(p => p.s)) / 4); s <= Math.floor(Math.max(...points.map(p => p.s)) / 4); s++) {
          for (let u = Math.floor(Math.min(...points.map(p => p.u)) / 4); u <= Math.floor(Math.max(...points.map(p => p.u)) / 4); u++) {
            const at = key(s, u); if (!bins.has(at)) bins.set(at, []); bins.get(at).push(face);
          }
        }
      }
      assert.ok(faces.length > 300);
      for (const face of faces) {
        const p = face.centre;
        for (const other of bins.get(key(Math.floor(p.s / 4), Math.floor(p.u / 4)))) {
          if (face === other) continue;
          const [a, b, c] = other.points;
          const inside = cross(a, b, p) / other.area > .002 && cross(b, c, p) / other.area > .002 && cross(c, a, p) / other.area > .002;
          assert.equal(inside, false, `overlapping molten faces in chunk ${index} near ${p.s}, ${p.u}`);
        }
      }
    } finally { chunk.dispose(); }
  }
});

test('the rendered creek stays gently graded while substantial basalt ledges flank it', () => {
  let ledges = 0;
  for (const index of [-9, 0, 5, 10, 65]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const formations = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      const { position, flow } = chunk.group.getObjectByName('volcanic-lava').geometry.attributes, points = [];
      for (let i = 0; i < position.count; i++) if (flow.getX(i) > 0) points.push(position.getX(i), position.getY(i), position.getZ(i));
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const lava = terrainSampler({ geometry }); geometry.dispose();
      let previous = null;
      for (let s = chunk.start + 8; s < chunk.start + CHUNK_LENGTH - 8; s += 2) {
        const creek = creekSection(s), p = volcanicPosition(s, creek.u), z = p.z + chunk.start;
        const y = lava(p.x, z);
        assert.notEqual(y, null, 'the main flow has no missing sections');
        assert.ok(Math.abs(y - ground(p.x, z) - .075) < .02);
        if (previous) assert.ok(Math.abs(y - previous.y) / Math.hypot(p.x - previous.x, z - previous.z) < .2, `rendered creek drops sharply at ${s}`);
        previous = { x: p.x, y, z };
        for (const offset of [-17, 18]) {
          const q = volcanicPosition(s, creek.u + offset), qz = q.z + chunk.start;
          if ((formations(q.x, qz) ?? -Infinity) - ground(q.x, qz) > 6) ledges++;
        }
      }
    } finally { chunk.dispose(); }
  }
  assert.ok(ledges > 30, 'large raised rock masses remain beside the surface creek');
});

test('lavafalls connect real ledge lips to grounded receiving pools', () => {
  let count = 0;
  for (const index of [-9, 0, 5, 10, 65]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const { flow } = chunk.group.getObjectByName('volcanic-lava').geometry.attributes;
      for (const fall of chunk.features.lavafalls) {
        count++;
        assert.ok(fall.width >= .7 && fall.width <= 1.8, 'a narrow fall leaves exposed basalt on either side');
        assert.ok(fall.drop > 2.8 && fall.drop < 30);
        assert.ok(Math.abs(fall.foot.y - ground(fall.foot.x, fall.foot.z) - .09) < .02, 'receiving pool is on the ground');
        assert.ok(fall.foot.u > creekSection(fall.foot.s).u - 1, 'the pool connects from the raised bank to the creek');
        assert.ok(fall.upper.y > fall.foot.y);
      }
      assert.equal([...flow.array].some(value => value < 0), chunk.features.lavafalls.length > 0, 'fall sheets use the animated lava batch');
    } finally { chunk.dispose(); }
  }
  assert.ok(count >= 3, 'lavafalls occur regularly along the raised ledges');
});

test('the left basin exposes broad lava flows around rooted cliff islands', () => {
  let open = 0, samples = 0, islands = 0;
  for (const index of [-4, 0, 4, 10]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const rock = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      for (let s = chunk.start + 8; s < chunk.start + CHUNK_LENGTH - 8; s += 8) {
        const { near, far, level } = riftProfile(s, -1);
        assert.ok(far - near >= 88, 'the basin is substantially wider than the right creek');
        for (let d = near + 10; d < far - 10; d += 5) {
          const p = volcanicPosition(s, -d), z = p.z + chunk.start;
          const y = Math.max(ground(p.x, z) ?? -Infinity, rock(p.x, z) ?? -Infinity);
          samples++;
          if (y < level) open++;
          if (y > level + 12) islands++;
        }
      }
    } finally { chunk.dispose(); }
  }
  assert.ok(open / samples > .5, 'connected molten areas dominate the basin floor');
  assert.ok(islands / samples > .04, 'large cliff islands still frame the flows');
});

test('cooling crust floats in slabs on the open basin and never rides onto land', () => {
  let crust = 0;
  for (const index of [-4, 0, 4, 10]) {
    const chunk = new VolcanicChunk(index);
    try {
      const ground = terrainSampler(chunk.group.getObjectByName('volcanic-basalt'));
      const rock = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      for (let s = chunk.start + 4; s < chunk.start + CHUNK_LENGTH - 4; s += 2) {
        const { near, far, level } = riftProfile(s, -1);
        for (let d = near + 10; d < far - 10; d += 2) {
          const p = volcanicPosition(s, -d), z = p.z + chunk.start, top = rock(p.x, z);
          if (top === null || top <= level || top > level + 1.2) continue;
          crust++;
          assert.ok(ground(p.x, z) < level, `crust rests on the bed, not the bank, at ${s}`);
        }
      }
    } finally { chunk.dispose(); }
  }
  assert.ok(crust > 200, 'cooling reaches skin over');
});

test('heat haze rises from the basin in the existing glow batch', () => {
  for (const index of [-4, 0, 10]) {
    const chunk = new VolcanicChunk(index);
    try {
      assert.equal(chunk.group.children.filter(child => child.material === chunk.group.getObjectByName('volcanic-glow').material).length, 1, 'no extra draw call');
      const { position, haze } = chunk.group.getObjectByName('volcanic-glow').geometry.attributes;
      assert.equal(haze.count, position.count);
      let bands = 0;
      for (let i = 0; i < haze.count; i++) {
        if (haze.getX(i) < .5) continue;
        bands++;
        const level = riftProfile(chunk.start - position.getZ(i), -1).level;
        assert.ok(position.getY(i) > level - 2 && position.getY(i) < level + 68, 'bands stand on the lava and fade out above it');
      }
      assert.ok(bands > 0 && bands < haze.count, 'haze shares the batch with the shoreline glow');
    } finally { chunk.dispose(); }
  }
});

test('neighboring volcanic terrain and lava meshes share exact boundary vertices', () => {
  for (const index of [-9, 0, 65]) {
    const a = new VolcanicChunk(index), b = new VolcanicChunk(index + 1);
    try {
      // Terrain jitter is global, so compare shared positions even when the
      // seam bends away from the nominal chunk boundary.
      for (const name of ['volcanic-basalt', 'volcanic-lava', 'surface-creek']) {
        const points = chunk => {
          const attributes = chunk.group.getObjectByName(name === 'surface-creek' ? 'volcanic-lava' : name).geometry.attributes, p = attributes.position, result = new Set();
          for (let i = 0; i < p.count; i++) {
            if (name === 'surface-creek' && attributes.flow.getX(i) <= 0) continue;
            result.add([p.getX(i), p.getY(i), p.getZ(i) - chunk.start].map(v => v.toFixed(3)).join(','));
          }
          return result;
        };
        const pa = points(a), pb = points(b), common = [...pa].filter(p => pb.has(p));
        assert.ok(common.length >= (name === 'volcanic-basalt' ? volcanicColumns(0).length - 2 : name === 'surface-creek' ? 5 : 24), `${name}: ${common.length} seam vertices`);
      }
    } finally { a.dispose(); b.dispose(); }
  }
});

test('volcanic streaming rebases smoke anchors and releases scene resources', () => {
  const scene = new THREE.Scene(), world = new VolcanicWorld(scene), { behind, ahead } = residentWindow();
  for (const s of [24, 1025, -1025, 10000]) {
    world.update(s); world.animate(12.5);
    assert.equal(world.chunks.size, behind + ahead + 1);
    assert.equal(volcanicClock.value, 12.5);
    for (const chunk of world.chunks.values()) {
      assert.equal(chunk.group.position.z, world.origin - chunk.index * CHUNK_LENGTH);
      const smoke = chunk.group.getObjectByName('volcanic-smoke');
      assert.ok(smoke.geometry.boundingSphere.radius > 0);
      assert.equal(smoke.castShadow, false);
      assert.ok(chunk.features.vents.every(v => Math.abs(v.u) > 12));
    }
  }
  world.dispose(); assert.equal(scene.children.length, 0); assert.equal(world.chunks.size, 0);
});

test('crater, rock and buttress footprints leave the full road clear on bends', () => {
  for (let index = -20; index <= 20; index++) {
    const chunk = new VolcanicChunk(index);
    try {
      for (let s = chunk.start - 24; s < chunk.start + CHUNK_LENGTH + 24; s += 2) {
        const p = volcanicPosition(s, 0);
        for (const solid of chunk.features.colliders) {
          const dx = p.x - solid.x, dz = p.z - solid.z;
          let distance = Math.hypot(dx, dz) - solid.reach;
          if (solid.heading !== undefined) {
            // A turned rock's broad-phase circle can reach over the road even
            // when its actual rectangular footprint leaves the shoulder clear.
            const cos = Math.cos(solid.heading), sin = Math.sin(solid.heading);
            distance = Math.hypot(Math.max(0, Math.abs(dx * cos + dz * sin) - solid.halfWidth),
              Math.max(0, Math.abs(dx * sin - dz * cos) - solid.halfLength));
          }
          assert.ok(distance > 6.5, `blocked road at ${s}`);
        }
      }
    } finally { chunk.dispose(); }
  }
});

test('ash, embers and lava lights have a fixed budget, pause together and survive origin shifts', () => {
  const scene = new THREE.Scene(), atmosphere = new VolcanicAtmosphere(scene), chunk = new VolcanicChunk(8), chunks = new Map([[8, chunk]]);
  let released = 0;
  for (const resource of [atmosphere.geometry, atmosphere.material, atmosphere.skyGeometry, atmosphere.skyMaterial]) resource.addEventListener('dispose', () => released++);
  try {
    assert.equal(atmosphere.geometry.attributes.position.count, 164);
    assert.equal(atmosphere.lights.length, 4);
    assert.ok(atmosphere.lights.every(light => !light.castShadow));
    const state = () => ({ positions: [...atmosphere.geometry.attributes.position.array], alpha: [...atmosphere.geometry.attributes.fleckAlpha.array],
      lights: atmosphere.lights.map(light => ({ position: light.position.toArray(), intensity: light.intensity })) });
    atmosphere.update(10, 1025, 1024, chunks); const first = state();
    assert.ok(first.positions.every(Number.isFinite));
    assert.ok(first.alpha.slice(140).some(alpha => alpha > 0), 'nearby vents release embers');
    atmosphere.update(10, 1025, 1024, chunks); assert.deepEqual(state(), first, 'a paused clock freezes all motion and illumination');
    const pointZ = atmosphere.points.position.z;
    const skyZ = atmosphere.sky.position.z;
    atmosphere.update(10, 1025, 2048, chunks);
    assert.deepEqual(state().positions, first.positions);
    assert.equal(atmosphere.points.position.z - pointZ, 1024);
    assert.equal(atmosphere.sky.position.z - skyZ, 1024, 'the ash sky follows origin shifts');
    atmosphere.lights.forEach((light, i) => assert.ok(Math.abs(light.position.z - first.lights[i].position[2] - 1024) < 1e-8));
    atmosphere.update(11, 1025, 2048, chunks); assert.notDeepEqual(state().positions, first.positions);
  } finally { chunk.dispose(); atmosphere.dispose(); }
  assert.equal(scene.children.length, 0);
  assert.equal(released, 4, 'route changes release the sky as well as the particles');
});

test('large volcanic landmarks and column fields leave the rendered creek open', () => {
  for (const index of [-8, -4, 0, 4, 8]) {
    const chunk = new VolcanicChunk(index);
    try {
      const summit = chunk.features.vents.find(v => v.landmark);
      assert.ok(summit, `a summit anchors stretch ${index}`);
      const ground = terrainSampler(chunk.terrain), rock = terrainSampler(chunk.group.getObjectByName('volcanic-formations'), true);
      for (let s = chunk.start + 2; s < chunk.start + CHUNK_LENGTH - 2; s += 2) {
        const creek = creekSection(s);
        for (const across of [-.45, 0, .45]) {
          const p = volcanicPosition(s, creek.u + creek.width * across), z = p.z + chunk.start;
          const floor = ground(p.x, z), formation = rock(p.x, z);
          assert.ok(formation === null || formation < floor + 2.5, `landmark blocks the lava creek at ${s}`);
        }
      }
      for (const column of chunk.features.columns) {
        assert.ok(column.s - column.radius > chunk.start && column.s + column.radius < chunk.start + CHUNK_LENGTH, 'column belongs entirely to its chunk');
        assert.ok(chunk.features.colliders.some(c => Math.hypot(c.x - column.x, c.z - column.z + chunk.start) < .01), 'visible columns have physical footprints');
      }
    } finally { chunk.dispose(); }
  }
});
