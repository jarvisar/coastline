import test from 'node:test';
import assert from 'node:assert/strict';
import { CoastalChunk } from '../src/world/environment.js';
import { coastalGuardrail, coastalDrivingRoute, bridgeAt, overlookWidth, positionAt,
  GUARDRAIL_OFFSET, GUARDRAIL_STOP, GUARDRAIL_SEGMENT, CHUNK_LENGTH } from '../src/world/route.js';

// This batch holds only rail beams and posts.
function railParts(index) {
  const chunk = new CoastalChunk(index);
  const mesh = chunk.group.children.find(child => child.name === 'coastal-guardrails');
  const parts = [];
  if (mesh) for (let i = 0; i < mesh.count; i++) {
    const matrix = mesh.instanceMatrix.array, o = i * 16;
    // Elements 12-14 are the translation; column lengths give the box scale.
    parts.push({ x: matrix[o + 12], y: matrix[o + 13], z: matrix[o + 14],
      width: Math.hypot(matrix[o], matrix[o + 1], matrix[o + 2]),
      height: Math.hypot(matrix[o + 4], matrix[o + 5], matrix[o + 6]),
      length: Math.hypot(matrix[o + 8], matrix[o + 9], matrix[o + 10]) });
  }
  chunk.dispose();
  return { beams: parts.filter(p => p.length > 1), posts: parts.filter(p => p.length <= 1) };
}
const delineators = index => {
  const chunk = new CoastalChunk(index);
  // Delineator posts are the only batch using the fixed 1.25 m post geometry.
  const mesh = chunk.group.children.find(child => child.isInstancedMesh && child.geometry.parameters?.height === 1.25);
  const found = [];
  if (mesh) for (let i = 0; i < mesh.count; i++) {
    const m = mesh.instanceMatrix.array, o = i * 16;
    found.push({ x: m[o + 12], z: m[o + 14] });
  }
  chunk.dispose();
  return found;
};

test('the car is stopped by exactly the guardrails it can see', () => {
  let railed = 0;
  for (let s = -2400; s < 4400; s += .5) {
    const [oceanSide] = coastalDrivingRoute.bounds(s);
    if (!coastalGuardrail(s)) continue;
    railed++;
    assert.ok(oceanSide >= GUARDRAIL_OFFSET,
      `a rail stands at s=${s} but driving allows u=${oceanSide.toFixed(2)}, past it`);
    assert.ok(oceanSide <= GUARDRAIL_STOP + 1e-9, `s=${s} stops short of the rail at ${oceanSide.toFixed(2)}`);
  }
  assert.ok(railed > 2000, `expected a good stretch of railed road, measured ${railed} samples`);
});

test('open road keeps its soft roadside limit', () => {
  let open = 0;
  for (let s = -2400; s < 4400; s += .5) {
    if (coastalGuardrail(s) || Math.abs(s - bridgeAt(s).center) < 49) continue;
    open++;
    assert.ok(coastalDrivingRoute.bounds(s)[0] < GUARDRAIL_STOP,
      `s=${s} has no rail, so the shoulder must stay open`);
  }
  assert.ok(open > 2000);
});

test('a rail never stands on a viaduct deck or across an ocean overlook', () => {
  for (let s = -2400; s < 4400; s += 2) {
    if (!coastalGuardrail(s)) continue;
    assert.ok(Math.abs(s - bridgeAt(s).center) >= 49, `rail on the viaduct deck at s=${s}`);
    assert.ok(overlookWidth(s) <= 6.2, `rail across the overlook apron at s=${s}`);
  }
});

test('rails come in runs, never a single beam stranded in a meadow', () => {
  for (const seed of [0, 1, 2]) {
    let run = 0;
    for (let s = -2400 + seed; s < 4400; s += GUARDRAIL_SEGMENT) {
      if (coastalGuardrail(s)) { run++; continue; }
      assert.notEqual(run, 1, `a lone ${GUARDRAIL_SEGMENT} m beam ends at s=${s}`);
      run = 0;
    }
  }
});

test('the rule answers the same for every metre of a beam, so geometry and driving agree', () => {
  for (let s = -2000; s < 2000; s += GUARDRAIL_SEGMENT) {
    const first = coastalGuardrail(s + .01);
    for (const offset of [1, 2, 3, 3.99]) {
      assert.equal(coastalGuardrail(s + offset), first, `the beam covering s=${s} disagrees with itself`);
    }
  }
});

test('built rails match the rule, and every run is closed by a post', () => {
  for (const index of [-4, -2, 0, 1, 3, 5, 9]) {
    const { beams, posts } = railParts(index);
    const start = index * CHUNK_LENGTH;
    const expected = [];
    for (let s = start; s < start + CHUNK_LENGTH; s += GUARDRAIL_SEGMENT) if (coastalGuardrail(s + 2)) expected.push(s);
    assert.equal(beams.length, expected.length, `chunk ${index} built ${beams.length} beams for ${expected.length} railed segments`);
    // One post per beam, plus one closing each run.
    const runEnds = expected.filter(s => !coastalGuardrail(s + GUARDRAIL_SEGMENT + 2)).length;
    assert.equal(posts.length, expected.length + runEnds, `chunk ${index} must post both ends of every run`);
    for (const beam of beams) {
      assert.ok(beam.height > .2 && beam.height < .5, 'a beam keeps its rail profile');
      // Bends change the chord a little. Far outside that is a sliver or a stray beam.
      assert.ok(beam.length > GUARDRAIL_SEGMENT - .5 && beam.length < GUARDRAIL_SEGMENT + 1,
        `a beam ${beam.length.toFixed(2)} m long does not span one ${GUARDRAIL_SEGMENT} m segment`);
    }
  }
});

test('no delineator post doubles up beside a guardrail', () => {
  for (const index of [-4, -2, 0, 1, 3, 5, 9]) {
    const start = index * CHUNK_LENGTH;
    for (const post of delineators(index)) {
      // Match the post to its ocean-side route position.
      for (let s = start; s < start + CHUNK_LENGTH; s += 16) {
        const ocean = positionAt(s, -6.85);
        if (Math.hypot(ocean.x - post.x, ocean.z + start - post.z) > .3) continue;
        assert.ok(!coastalGuardrail(s), `a delineator stands beside the rail at s=${s}`);
      }
    }
  }
});
