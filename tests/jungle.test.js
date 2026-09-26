import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, roadX, positionAt } from '../src/world/route.js';
import { JUNGLE_STEP, JUNGLE_COLUMN_COUNT, POOL_SPAN, jungleColumns, jungleRows, jungleVertex, jungleHeight, jungleRoadHeight as roadHeight, jungleDrivingRoute, jungleGuardrail, gorgeWall, riverLevel, riverBedLevel, riverLips, riverLipOffset, sideFalls, riverCenter, riverHalfWidth, jungleMountains, jungleCrags } from '../src/world/jungle-route.js';
import { JungleWorld, JungleChunk } from '../src/world/jungle.js';
import { waterClock } from '../src/world/water.js';
import { DrivingController } from '../src/vehicle.js';

test('side streams meet the full waterfall crest without gaps on curved roads',()=>{
  for(const fall of sideFalls(-5000,5000).slice(0,12)) {
    const chunk=new JungleChunk(Math.floor(fall.s/CHUNK_LENGTH));
    try {
      const surface=chunk.group.getObjectByName('jungle-river').geometry.attributes.position;
      const waterfall=chunk.group.getObjectByName('waterfalls').geometry.attributes;
      const seed=Math.fround(fall.s*.173),corners=[];
      for(let i=0;i<waterfall.position.count;i++) {
        if(waterfall.fallCoord.getW(i)!==seed || waterfall.fallCoord.getX(i)>=0 || Math.abs(waterfall.fallCoord.getY(i))!==1) continue;
        corners.push(new THREE.Vector3().fromBufferAttribute(waterfall.position,i));
      }
      assert.ok(corners.length>=2,'both crest corners are present');
      for(const corner of corners) {
        let nearest=Infinity;
        for(let i=0;i<surface.count;i++) nearest=Math.min(nearest,
          Math.hypot(surface.getX(i)-corner.x,surface.getY(i)-corner.y,surface.getZ(i)-corner.z));
        assert.ok(nearest<.0001,`stream misses waterfall edge by ${nearest} at ${fall.s}`);
      }
    } finally {chunk.dispose();}
  }
});

test('jungle columns stay ordered, the road stays flat and the river sits in its valley', () => {
  for (let s = -10000; s < 10000; s += 13) {
    const columns = jungleColumns(s);
    assert.equal(columns.length, JUNGLE_COLUMN_COUNT);
    for (let col = 1; col < columns.length; col++) assert.ok(columns[col] > columns[col - 1], `folded jungle terrain at ${s}`);
    for (const u of [-7, 0, 7]) assert.equal(jungleHeight(s, u), roadHeight(s));
    const rc = riverCenter(s), hw = riverHalfWidth(s), level = riverLevel(s);
    assert.ok(level < roadHeight(s) - 5 && level > roadHeight(s) - 26, `river level ${level} at ${s}`);
    assert.ok(jungleHeight(s, rc) < level - 1.5, `river bed above the water at ${s}`);
    // Water may reach a gorge wall's foot; the camera-side bank must stay dry.
    assert.ok(jungleHeight(s, rc + hw + 4) > level - .7 && jungleHeight(s, rc - hw - 4) > level + 1, `submerged bank at ${s}`);
    assert.ok(jungleHeight(s, 100) > roadHeight(s) + 5);
    // Camera-side terrain must stay below the line of sight to the road.
    for (const u of [-100, -160, -250, -400]) assert.ok(jungleHeight(s, u) - roadHeight(s) < -u * .55, `near hill blocks the road at ${s}, ${u}`);
    for (const u of [-300, -120, -30, -9, 9, 30, 120, 300]) assert.ok(Math.abs(jungleHeight(s + .001, u) - jungleHeight(s - .001, u)) < .05);
  }
  for (let chunk = -20; chunk < 40; chunk++) {
    const rows = CHUNK_LENGTH / JUNGLE_STEP;
    for (let col = 0; col < JUNGLE_COLUMN_COUNT; col++) assert.deepEqual(jungleVertex(chunk * rows, col), jungleVertex((chunk - 1) * rows + rows, col));
  }
});

test('river pools are terraced by rocky lips fixed in world space', () => {
  const lips = riverLips(-4000, 4000), boundaries = lips;
  assert.ok(lips.length > 75);
  for (let i = 1; i < boundaries.length; i++) {
    const spacing = boundaries[i].s - boundaries[i - 1].s;
    assert.ok(spacing >= 50 && spacing <= POOL_SPAN + 60, `pool spacing ${spacing}`);
    assert.ok(boundaries[i].s % 2 === 0);
  }
  assert.ok(lips.every(lip => lip.drop >= 1 && lip.direction === -1), 'every lip falls toward -s, down the screen');
  assert.ok(lips.filter(lip => lip.drop > 4).length > lips.length * .06, 'some lips are tall falls');
  for (const lip of lips) {
    assert.ok(Math.abs(riverLevel(lip.s) - lip.upper) < 1e-9, `the lip at ${lip.s} holds the upper pool`);
    assert.ok(Math.abs(riverLevel(lip.s + lip.direction * 2) - lip.lower) < 1e-9);
    for (const d of [-8, -4, -1, 0, 1, 4, 8]) assert.ok(riverBedLevel(lip.s + d) <= riverLevel(lip.s + d) + 1e-9);
    for (const d of [-3, -2, -1.5, -.5, .5, 1.5, 2, 3]) assert.ok(Math.abs(riverLevel(lip.s + d + .001) - riverLevel(lip.s + d - .001)) < .02);
    for (const f of [-1, -.55, 0, .55, 1]) {
      const edge = lip.s + riverLipOffset(lip.index, f);
      assert.ok(Math.abs(riverLevel(edge, f) - lip.upper) < 1e-8);
      assert.ok(Math.abs(riverLevel(edge - 2, f) - lip.lower) < 1e-8);
    }
  }
  for (let chunk = -30; chunk < 30; chunk++) {
    for (const local of riverLips(chunk * CHUNK_LENGTH, chunk * CHUNK_LENGTH + CHUNK_LENGTH)) assert.ok(lips.some(lip => lip.s === local.s && lip.index === local.index));
  }
});

test('the whole river descends continuously in world space and in the fixed camera', () => {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1200);
  camera.position.set(-220, 245, 260); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  for (const start of [-1000000, -20000, -12000, -1024, 0, 1024, 20000, 1000000]) for (let s = start; s < start + 1600; s += 1) {
    for (const f of [-.9, 0, .9]) {
      assert.ok(riverLevel(s, f) <= riverLevel(s + 1, f) + 1e-9, `water climbs downstream at ${s}, ${f}`);
      const project = t => {
        const p = positionAt(t, riverCenter(t) + f * riverHalfWidth(t), riverLevel(t, f));
        return new THREE.Vector3(p.x, p.y, p.z).project(camera).y;
      };
      assert.ok(project(s) < project(s + 1), `river turns up the screen at ${s}, ${f}`);
    }
    assert.ok(roadHeight(s + 1) > roadHeight(s), 'road follows the descending valley smoothly');
    assert.equal(jungleDrivingRoute.frame(s).y, roadHeight(s));
  }
  assert.ok(sideFalls(-12000, 12000).length > 10);
});

test('waterfall terrain uses shared fine rows and guardrails only protect nearby steep cliffs', () => {
  for (let index = -20; index < 20; index++) {
    const start = index * CHUNK_LENGTH, rows = jungleRows(start, start + CHUNK_LENGTH);
    assert.equal(rows[0], start); assert.equal(rows.at(-1), start + CHUNK_LENGTH);
    assert.ok(rows.every((s, i) => i === 0 || s > rows[i - 1]));
    for (const lip of riverLips(start, start + CHUNK_LENGTH)) assert.ok(rows.includes(lip.s));
  }
  let guarded = 0;
  for (let s = -12000; s < 12000; s += 4) if (jungleGuardrail(s)) {
    guarded++;
    const rim = riverCenter(s) + riverHalfWidth(s) + 7;
    assert.ok(rim > -25 && gorgeWall(s) > .65 && jungleHeight(s, rim) - riverLevel(s) > 6);
  }
  assert.ok(guarded > 10 && guarded < 600, `guardrails should be occasional (${guarded}/6000)`);
});

test('misty mountains and crags are deterministic and continuous', () => {
  for (const s of [-10000, -1024, 0, 256, 1024, 10000]) {
    const heights = Array.from({ length: 30 }, (_, i) => jungleMountains(s, 160 + i * 14));
    assert.ok(Math.max(...heights) > 55); assert.equal(jungleMountains(s, 150), 0);
    assert.deepEqual(heights, Array.from({ length: 30 }, (_, i) => jungleMountains(s, 160 + i * 14)));
  }
  let cragged = 0;
  for (let s = -3000; s < 3000; s += 7) {
    for (const u of [-140, -120, 40, 80, 120, 200, 320, 460]) {
      assert.ok(Math.abs(jungleMountains(s + .001, u) - jungleMountains(s - .001, u)) < .02);
      assert.ok(Math.abs(jungleCrags(s + .001, u) - jungleCrags(s - .001, u)) < .02);
      if (jungleCrags(s, u) > 4) cragged++;
    }
  }
  assert.ok(cragged > 60);
});

test('jungle drive stays grounded and within the verges', () => {
  const car = new DrivingController(jungleDrivingRoute);
  for (let i = 0; i < 10200; i++) {
    car.update(1 / 60, { forward: true, left: i >= 7200 && i < 8600, right: i >= 8600 });
    assert.ok(car.u >= -8.8 && car.u <= 8.8);
    assert.ok(Math.abs(car.car.position.y - jungleHeight(car.s, car.u) - .13) < .0001);
  }
  assert.ok(car.distance > 3000);
  car.reset(); for (let i = 0; i < 300; i++) car.update(1 / 60, { brake: true });
  assert.ok(car.speed < -2);
});

test('jungle chunks keep scenery off the road, build the river and dispose cleanly', () => {
  const overhead = new Set(['emergent-crowns', 'lianas', 'guardrails']);
  for (const index of [-3, 0, 7]) {
    const chunk = new JungleChunk(index), names = new Set(), position = new THREE.Vector3(), matrix = new THREE.Matrix4();
    const road = Array.from({ length: CHUNK_LENGTH + 21 }, (_, i) => { const s = chunk.start - 10 + i; return [roadX(s), -(s - chunk.start)]; });
    chunk.group.traverse(object => {
      names.add(object.name);
      if (!object.isInstancedMesh || overhead.has(object.name)) return;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
        const distance = Math.min(...road.map(([x, z]) => Math.hypot(position.x - x, position.z - z)));
        assert.ok(distance > 8.3, `${object.name} instance ${i} in chunk ${index} sits ${distance.toFixed(1)} m from the road centerline`);
        assert.ok(Number.isFinite(position.y));
      }
    });
    for (const name of ['jungle-floor', 'jungle-river', 'river-mist', 'valley-mist', 'jungle-road', 'jungle-canopy', 'emergent-crowns', 'lianas', 'palm-fronds', 'banana-plants', 'ferns', 'mossy-boulders']) assert.ok(names.has(name), `${name} missing from chunk ${index}`);
    assert.equal(names.has('cascade-foam'), chunk.lips.some(lip => lip.drop >= .6) || chunk.falls.length > 0);
    assert.ok(chunk.terrain.geometry.attributes.position.count > 3000);
    // Every interior edge must be shared, including where fine waterfall rows
    // meet coarse hills. Also caps foreground facet size.
    const terrain = chunk.terrain.geometry.attributes.position, edges = new Map(), boundary = new Set();
    const key = p => [p.x, p.y, p.z].map(Math.fround).join(',');
    const boundaryVertex = (s, col) => {
      const p = jungleVertex(s / JUNGLE_STEP, col); p.z += chunk.start; boundary.add(key(p));
    };
    for (let col = 0; col < JUNGLE_COLUMN_COUNT; col++) for (const s of [chunk.start, chunk.start + CHUNK_LENGTH]) boundaryVertex(s, col);
    for (let s = chunk.start; s <= chunk.start + CHUNK_LENGTH; s += JUNGLE_STEP) for (const col of [0, JUNGLE_COLUMN_COUNT - 1]) boundaryVertex(s, col);
    for (let i = 0; i < terrain.count; i += 3) {
      const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(terrain, i + j));
      for (let j = 0; j < 3; j++) {
        const a = points[j], b = points[(j + 1) % 3], pair = [key(a), key(b)].sort(), id = pair.join('|');
        const edge = edges.get(id) ?? { count: 0, pair }; edge.count++; edges.set(id, edge);
        const s = chunk.start - (a.z + b.z) / 2;
        if ((a.x + b.x) / 2 - roadX(s) < -140) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 24, 'stretched foreground facet');
      }
    }
    for (const edge of edges.values()) assert.ok(edge.count === 2 || edge.count === 1 && edge.pair.every(p => boundary.has(p)), 'open edge inside jungle terrain');
    chunk.dispose();
  }
  const scene = new THREE.Scene(), world = new JungleWorld(scene);
  let disposed = 0;
  world.update(24);
  for (const chunk of world.chunks.values()) for (const g of chunk.owned) g.addEventListener('dispose', () => disposed++);
  for (const s of [24, 148, 1025, 10000, -300, -1100]) {
    world.update(s); world.animate(12);
    assert.equal(world.chunks.size, 9); assert.equal(scene.children.length, 9); assert.equal(waterClock.time.value, 12);
    for (const [index, chunk] of world.chunks) assert.equal(chunk.group.position.z, world.origin - index * CHUNK_LENGTH);
  }
  world.dispose(); assert.equal(scene.children.length, 0); assert.ok(disposed >= 50);
});
