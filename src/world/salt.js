import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { splitBatch, computeInstanceBounds } from './instance-batches.js';
import { LevelChunk, LevelWorld } from './level.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep, lerp, roadFrame, positionAt } from './route.js';
import { SALT_LEVEL, WATER_LEVEL, CAUSEWAY_TOE, CELL_REACH, SALT_EDGES, CELL, CELL_ROWS, cellSeed, saltCell, keyFlooded,
  saltRoadHeight, saltHeight, saltNoise, lagoonAmount, saltRegion, inPool, poolNear, saltClusters, saltPileFields,
  SALT_HILLS, saltHills, hillParts, clearOfHills } from './salt-route.js';
import { crustMaterial, roadMaterial, rockMaterial, plantMaterial, pileMaterial, birdMaterial, postMaterial, poolMaterial,
  mirrorInstanceMaterial, mirrorMeshMaterial, WATER_MIRROR } from './salt-materials.js';
import { saltBoulders, saltPebble, saltApron, saltTola, saltPile, saltHillShapes, flamingoStanding, flamingoFeeding, flamingoFlying, flightMaterial,
  postGeometry } from './salt-assets.js';
import { saltDiscoveries, saltDiscoveryClears } from './salt-discoveries.js';
import { buildSaltDiscoveries } from './salt-discovery-scenery.js';
import { SaltSky } from './salt-sky.js';
import { animateWater } from './water.js';
import { solidPost, solidRocks } from './colliders.js';

registerChunkResources('salt', { crustMaterial, roadMaterial, rockMaterial, plantMaterial, pileMaterial, birdMaterial, postMaterial, poolMaterial,
  mirrorInstanceMaterial, mirrorMeshMaterial, flightMaterial, saltBoulders, saltPebble, saltApron, saltTola, saltPile,
  flamingoStanding, flamingoFeeding, flamingoFlying, postGeometry });

const color = hex => new THREE.Color(hex);
const CRUST = color('#fff4e5'), DIRTY = color('#e6d4bd'), COOL = color('#e4e9ee'), DUST = color('#dfcbb0');
const CREST = color('#fffdf4'), WET_RIM = color('#d6ebe7'), SUNKEN = color('#c9e2de');
// Clay playa: warm sandy crust split by darker mud cracks. Rose stretches blush
// the salt a little. Damp salt round a pool is greyer.
const CLAY = color('#e4c9a2'), CLAY_DEEP = color('#d4b089'), CLAY_CRACK = color('#bf9b74'), ROSE_SALT = color('#fbe9e2');
const DAMP = color('#cfd3cd'), DAMP_CLAY = color('#c3a27f'), DAMP_ROSE = color('#ebcfc8');
const GRAVEL = [color('#e2d5bb'), color('#d9caac'), color('#d2c2a3'), color('#e3dac8'), color('#ede7db')];
const ROAD = { shoulder: color('#dccfb4'), asphalt: color('#4d5259'), edge: color('#f3f1ea'), centre: color('#e0b13e') };
const ROCK_TINTS = ['#d2bfa4', '#c3b29d', '#ded0b9', '#b8afa4', '#cfbba0', '#d8c9b3'].map(color);
const RUST = color('#b4846c');
// Hill colour shifts, so repeated shapes don't match exactly.
const HILL_TINTS = [[1, 1, 1], [1.04, 1, .95], [.96, .97, 1], [.93, .92, .93], [1.03, .98, .96]];
const TOLA_TINTS = ['#cda866', '#bc9654', '#d7b877', '#a98d55', '#c4a870'].map(color);
const PILE_TINTS = ['#ffffff', '#f7f5f0', '#fbf8f2'].map(color);
const BIRD_TINTS = ['#ffffff', '#fff0f2', '#f6e3e6', '#ffe9ea'].map(color);
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];
const matrix = new THREE.Object3D(), mirrored = new THREE.Matrix4();
const isBoundary = label => label === 'toe' || label === 'far';

function surface() { return { positions: [], colors: [] }; }
// Upward winding in plan, so every face of the level ground points up.
function triangle(target, a, b, c, ca, cb = ca, cc = ca) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) { [b, c] = [c, b]; [cb, cc] = [cc, cb]; }
  for (const [p, tint] of [[a, ca], [b, cb], [c, cc]]) { target.positions.push(p.x, p.y, p.z); target.colors.push(tint.r, tint.g, tint.b); }
}
function geometry(data, extra = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  if (extra) for (const [name, values, size] of extra) g.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
function instances(group, source, material, items, name, { shadow = true, occlusion = true, mirror = false } = {}) {
  if (!items.length) return;
  for (const part of splitBatch(items)) {
    const mesh = new THREE.InstancedMesh(source, material, part.length); mesh.name = name;
    part.forEach((item, i) => {
      if (item.matrix) mesh.setMatrixAt(i, item.matrix);
      else {
        matrix.position.set(...item.p); matrix.rotation.set(...(item.r ?? [0, 0, 0])); matrix.scale.set(...item.scale);
        matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
      }
      if (item.color) mesh.setColorAt(i, item.color);
    });
    mesh.castShadow = shadow && !mirror; mesh.receiveShadow = !mirror;
    if (!occlusion || mirror) mesh.userData.ambientOcclusion = false;
    computeInstanceBounds(mesh); group.add(mesh);
  }
}
// The same instance flipped about the water plane.
function mirrorOf(item) {
  matrix.position.set(...item.p); matrix.rotation.set(...(item.r ?? [0, 0, 0])); matrix.scale.set(...item.scale); matrix.updateMatrix();
  mirrored.multiplyMatrices(WATER_MIRROR, matrix.matrix);
  return { matrix: mirrored.clone(), color: item.color, p: [item.p[0], WATER_LEVEL * 2 - item.p[1], item.p[2]] };
}

// Clay comes in patchy, leaving islands of white salt through a playa stretch.
function crustMix(s, u) {
  const { clay, rose } = saltRegion(s);
  return { clay: clay * (.25 + .75 * smoothstep(-.3, .2, saltNoise(s, u, 64, 8867))), rose };
}
// Crust colour at a point: cleaner and cooler in places, grubbier in others,
// and dusted beige next to the causeway.
function crustTone(s, u, r = .5, mix = crustMix(s, u)) {
  const tone = CRUST.clone().lerp(DIRTY, smoothstep(-.45, .7, saltNoise(s, u, 170, 8863)) * .65);
  tone.lerp(COOL, smoothstep(-.15, .65, saltNoise(s + 90, u, 95, 8864)) * .48);
  if (mix.rose) tone.lerp(ROSE_SALT, mix.rose * .45);
  if (mix.clay) tone.lerp(CLAY.clone().lerp(CLAY_DEEP, smoothstep(-.3, .6, saltNoise(s - 40, u, 110, 8868))), mix.clay);
  tone.lerp(DUST, (1 - smoothstep(12, 30, Math.abs(u))) * .5);
  return tone.multiplyScalar(.94 + r * .1);
}
const dampTone = mix => DAMP.clone().lerp(DAMP_ROSE, mix.rose).lerp(DAMP_CLAY, mix.clay);
// 0..1 where the polygon rims stand tall and broad, in stretches of white salt.
const honeycomb = (s, u) => smoothstep(.05, .45, saltNoise(s, u, 260, 8879)) * (1 - saltRegion(s).clay);
// Ridge height and brightness fade out toward the far field.
const reachFade = u => 1 - smoothstep(320, 412, Math.abs(u));

export class SaltChunk extends LevelChunk {
  constructor(index) {
    super(index, `salt-chunk-${index}`);
    this.features = {}; this.cells = [];
    this.crust = surface(); this.water = { positions: [], depths: [], rose: [] }; this.hillFaces = surface(); this.mirror = surface();
    this.items = { rocks: saltBoulders.map(() => []), rockMirrors: saltBoulders.map(() => []), pebbles: [], aprons: [], tola: [],
      piles: [], pileMirrors: [], standing: [], standingMirrors: [], feeding: [], feedingMirrors: [], posts: [], bands: [] };
    this.buildCrust(); this.buildFarField(); this.buildCauseway();
    this.terrain = this.addMesh(geometry(this.crust), crustMaterial, 'salt-crust');
    if (this.water.positions.length) {
      const film = this.addMesh(geometry(this.water, [['poolDepth', this.water.depths, 1], ['poolRose', this.water.rose, 1]]), poolMaterial, 'salt-pools');
      film.receiveShadow = false;
    }
    this.buildRoad();
    // Landmarks reach up to 40 m either side of their anchor, hills up to 110 m.
    this.discoveries = saltDiscoveries(this.start - 40, this.start + CHUNK_LENGTH + 40);
    this.hills = saltHills(this.start - 130, this.start + CHUNK_LENGTH + 130);
    this.buildHills(); this.buildRipRap(); this.buildClusters(); this.buildScatter(); this.buildShrubs(); this.buildPiles(); this.buildFlamingos(); this.buildPosts();
    buildSaltDiscoveries(this, this.discoveries);
    this.finishScenery();
    delete this.crust; delete this.water; delete this.items; delete this.cells; delete this.discoveries; delete this.hills;
    finalizeChunkTransforms(this.group);
  }
  clear(s, u, radius) { return saltDiscoveryClears(s, u, this.discoveries, radius) && clearOfHills(this.hills, s, u, radius); }
  // Chunk-local position.
  at(s, u, y = saltHeight(s, u)) { const p = positionAt(s, u, y); return { x: p.x, y: p.y, z: p.z + this.start }; }
  // Salt polygons are Voronoi cells, owned by the chunk holding their seed.
  // Each is a shallow fan ringed by a bevelled rim that rises to a shared crest
  // on the crack line. A flooded cell leaves its middle open onto the mirror
  // below and gets a film of water over the whole polygon.
  buildCrust() {
    const first = Math.floor(this.start / CELL) - 2, last = Math.ceil((this.start + CHUNK_LENGTH) / CELL) + 1;
    for (const side of [-1, 1]) for (let k = 0; k <= CELL_ROWS; k++) for (let i = first; i <= last; i++) {
      const seed = cellSeed(i, k, side);
      if (seed.s < this.start || seed.s >= this.start + CHUNK_LENGTH || Math.abs(seed.u) > CELL_REACH + CELL) continue;
      const cell = saltCell(i, k, side);
      if (cell.outline.length < 3) continue;
      this.cell(cell); this.cells.push(cell);
    }
  }
  cell(cell) {
    const { outline, flooded } = cell, n = outline.length, labels = outline.map(v => v.edge);
    let area = 0;
    for (let j = 0; j < n; j++) { const a = outline[j], b = outline[(j + 1) % n]; area += a.s * b.u - b.s * a.u; }
    const turn = area > 0 ? 1 : -1, r = randomAt(cell.i, cell.k * 7 + (cell.side > 0 ? 8865 : 8866));
    const mix = crustMix(cell.s, cell.u), tone = crustTone(cell.s, cell.u, r, mix), fade = reachFade(cell.u);
    // Dry polygons darken toward any pool they border.
    const wet = labels.map(label => !flooded && keyFlooded(label)), damp = dampTone(mix);
    const submerged = j => flooded && keyFlooded(labels[(j + n - 1) % n]) && keyFlooded(labels[j]);
    const crest = outline.map((v, j) => {
      if (isBoundary(labels[(j + n - 1) % n]) || isBoundary(labels[j])) return 0;
      if (submerged(j)) return WATER_LEVEL - SALT_LEVEL - .1;
      return (.025 + .04 * (.5 + .5 * saltNoise(v.s, v.u, 37, 8862)) + .08 * honeycomb(v.s, v.u)) * reachFade(v.u);
    });
    // Each rim is a flat white band along the crack, then a bevel down to the
    // polygon floor. Pool shores keep the band dry and slope into the water.
    const band = labels.map(label => {
      if (isBoundary(label)) return 0;
      if (!flooded) return .045 + .09 * (.5 + .5 * saltNoise(cell.s, cell.u, 23, 8868)) + .12 * honeycomb(cell.s, cell.u);
      return keyFlooded(label) ? 0 : .14;
    });
    const inset = labels.map((label, j) => band[j] + (isBoundary(label) ? (flooded ? .75 : 0) : !flooded ? .3 : keyFlooded(label) ? .14 : 1.05));
    const dirs = outline.map((v, j) => {
      const w = outline[(j + 1) % n], ds = w.s - v.s, du = w.u - v.u, length = Math.hypot(ds, du) || 1;
      return { s: ds / length, u: du / length, ns: -du / length * turn, nu: ds / length * turn };
    });
    // Mitred inset, with any inner edge that flips over collapsed to a point.
    let inner = outline.map((v, j) => {
      const p = (j + n - 1) % n, a = dirs[p], b = dirs[j], da = inset[p], db = inset[j], det = a.ns * b.nu - a.nu * b.ns;
      let xs = b.ns * db, xu = b.nu * db;
      if (Math.abs(det) > 1e-4) { xs = (da * b.nu - db * a.nu) / det; xu = (a.ns * db - b.ns * da) / det; }
      const length = Math.hypot(xs, xu), limit = 3 * Math.max(da, db, .01);
      if (length > limit) { xs *= limit / length; xu *= limit / length; }
      return { s: v.s + xs, u: v.u + xu };
    });
    for (let pass = 0; pass < 3; pass++) for (let j = 0; j < n; j++) {
      const a = inner[j], b = inner[(j + 1) % n], d = dirs[j];
      if (Math.hypot(b.s - a.s, b.u - a.u) > 1e-6 && (b.s - a.s) * d.s + (b.u - a.u) * d.u < .02) {
        const middle = { s: (a.s + b.s) / 2, u: (a.u + b.u) / 2 };
        inner[j] = { ...middle }; inner[(j + 1) % n] = { ...middle };
      }
    }
    // Slivers against the causeway can't hold a mitred rim. Shrink those instead.
    const inside = inner.every(p => outline.every((v, j) => (p.s - v.s) * dirs[j].ns + (p.u - v.u) * dirs[j].nu > -1e-6));
    if (!inside) {
      const cs = outline.reduce((sum, v) => sum + v.s, 0) / n, cu = outline.reduce((sum, v) => sum + v.u, 0) / n;
      inner = outline.map(v => { const t = Math.min(.45, Math.max(...inset) / (Math.hypot(v.s - cs, v.u - cu) || 1)); return { s: lerp(v.s, cs, t), u: lerp(v.u, cu, t) }; });
    }
    const onBoundary = j => (isBoundary(labels[(j + n - 1) % n]) && !inset[(j + n - 1) % n]) || (isBoundary(labels[j]) && !inset[j]);
    const rim = outline.map((v, j) => this.at(v.s, v.u, SALT_LEVEL + crest[j]));
    const shoulder = outline.map((v, j) => {
      const p = (j + n - 1) % n, share = [p, j].filter(e => inset[e] > 0).map(e => band[e] / inset[e]);
      const t = share.length ? share.reduce((sum, value) => sum + value, 0) / share.length : 0;
      return this.at(lerp(v.s, inner[j].s, t), lerp(v.u, inner[j].u, t), SALT_LEVEL + crest[j]);
    });
    const floor = inner.map((v, j) => this.at(v.s, v.u, flooded ? WATER_LEVEL - .22
      : SALT_LEVEL + (onBoundary(j) ? 0 : .006 + .012 * (.5 + .5 * saltNoise(v.s, v.u, 7, 8869)))));
    // On clay the cracks are darker than the plates, not brighter.
    const crestTone = tone.clone().lerp(CREST, (.25 + .75 * fade) * (1 - mix.clay)).lerp(CLAY_CRACK, mix.clay * .8);
    // Shores and the floor along a pool's edge are damp.
    const shoreTone = crestTone.clone().lerp(damp, .55), wetAt = j => wet[(j + n - 1) % n] || wet[j];
    const rimColor = j => !flooded ? (wetAt(j) ? shoreTone : crest[j] > .01 ? crestTone : tone)
      : submerged(j) ? WET_RIM : crest[j] > .01 ? shoreTone : tone;
    const baseFloor = flooded ? SUNKEN : tone.clone().multiplyScalar(.965), dampFloor = baseFloor.clone().lerp(damp, .7);
    const floorColor = j => !flooded && wetAt(j) ? dampFloor : baseFloor;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      // Flooded neighbours make one open pool, with no internal white dividers.
      if (flooded && keyFlooded(labels[j])) continue;
      if (!inset[j] && Math.hypot(inner[j].s - outline[j].s, inner[j].u - outline[j].u) < 1e-4) continue;
      if (band[j] > 0) {
        triangle(this.crust, rim[j], rim[k], shoulder[j], rimColor(j), rimColor(k), rimColor(j));
        triangle(this.crust, rim[k], shoulder[k], shoulder[j], rimColor(k), rimColor(k), rimColor(j));
      }
      const from = band[j] > 0 ? shoulder : rim;
      triangle(this.crust, from[j], from[k], floor[j], rimColor(j), rimColor(k), floorColor(j));
      if (Math.hypot(inner[j].s - inner[k].s, inner[j].u - inner[k].u) > 1e-4) triangle(this.crust, from[k], floor[k], floor[j], rimColor(k), floorColor(k), floorColor(j));
    }
    if (!flooded) {
      // A shallow dish or dome, so the fan's facets catch the sun a little differently.
      const cs = inner.reduce((sum, v) => sum + v.s, 0) / n, cu = inner.reduce((sum, v) => sum + v.u, 0) / n;
      const centre = this.at(cs, cu, SALT_LEVEL + .005 + (r - .45) * .065), soaked = wet.some(Boolean);
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        if (Math.hypot(inner[j].s - inner[k].s, inner[j].u - inner[k].u) < 1e-4) continue;
        // Broad mineral facets, with a little more colour at the centre than
        // the perimeter. The quiet variation keeps the crust from reading as tiles.
        const facet = tone.clone().multiplyScalar(.89 + randomAt(j, cell.i * 31 + cell.k) * .16);
        if (soaked) facet.lerp(damp, .22);
        triangle(this.crust, centre, floor[j], floor[k], facet, facet.clone().lerp(floorColor(j), .42), facet.clone().lerp(floorColor(k), .42));
      }
      return;
    }
    // A narrow shallow shelf hugs the shore. Edge midpoints keep the interiors
    // of connected pools deep even when both end vertices touch dry salt.
    const cs = outline.reduce((sum, v) => sum + v.s, 0) / n, cu = outline.reduce((sum, v) => sum + v.u, 0) / n;
    const centre = this.at(cs, cu, WATER_LEVEL), shore = [];
    for (let j = 0; j < n; j++) {
      const a = outline[j], b = outline[(j + 1) % n];
      shore.push({ ...a, depth: submerged(j) ? 1 : 0 }, { s: (a.s + b.s) / 2, u: (a.u + b.u) / 2, depth: keyFlooded(labels[j]) ? 1 : 0 });
    }
    const outer = shore.map(v => this.at(v.s, v.u, WATER_LEVEL));
    const shelf = shore.map(v => {
      const t = Math.min(.35, 1.1 / (Math.hypot(v.s - cs, v.u - cu) || 1));
      return this.at(lerp(v.s, cs, t), lerp(v.u, cu, t), WATER_LEVEL);
    });
    const waterFace = (a, b, c, da, db, dc) => {
      if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) { [b, c] = [c, b]; [db, dc] = [dc, db]; }
      for (const p of [a, b, c]) this.water.positions.push(p.x, p.y, p.z);
      this.water.depths.push(da, db, dc); this.water.rose.push(mix.rose, mix.rose, mix.rose);
    };
    for (let j = 0; j < shore.length; j++) {
      const k = (j + 1) % shore.length;
      waterFace(centre, shelf[j], shelf[k], 1, 1, 1);
      waterFace(shelf[j], outer[j], outer[k], 1, shore[j].depth, shore[k].depth);
      waterFace(shelf[j], outer[k], shelf[k], 1, shore[k].depth, 1);
    }
  }
  // Plain crust past the polygons, tucked just under their outer edge.
  buildFarField() {
    const columns = { [-1]: [CELL_REACH - .8, -SALT_EDGES.near], [1]: [CELL_REACH - .8, 446, 478, 514, 555, SALT_EDGES.far] };
    const first = this.start / 8;
    for (const side of [-1, 1]) {
      const cross = columns[side];
      const point = (row, c) => {
        const inner = c > 0 && c < cross.length - 1;
        const s = row * 8 + (inner ? (randomAt(row, c + (side > 0 ? 8891 : 8892)) - .5) * 4 : 0);
        const u = side * (cross[c] + (inner ? (randomAt(row, c + (side > 0 ? 8893 : 8894)) - .5) * 8 : 0));
        return { ...this.at(s, u, SALT_LEVEL - .06), s, u };
      };
      for (let row = first; row < first + CHUNK_LENGTH / 8; row++) for (let c = 0; c < cross.length - 1; c++) {
        const a = point(row, c), b = point(row + 1, c), d = point(row, c + 1), e = point(row + 1, c + 1);
        const faces = (row + c) % 2 ? [[a, b, d], [b, e, d]] : [[a, b, e], [a, e, d]];
        faces.forEach((face, f) => {
          const s = (face[0].s + face[1].s + face[2].s) / 3, u = (face[0].u + face[1].u + face[2].u) / 3;
          triangle(this.crust, ...face, crustTone(s, u, randomAt(row * 2 + f, c + (side > 0 ? 8895 : 8896))));
        });
      }
    }
  }
  // Gravel embankment from the shoulder down to the crust, rougher on its
  // rip-rap face and continuing under the first polygons so no seam shows.
  buildCauseway() {
    const cross = [6.6, 7.4, 8.3, 9.3, CAUSEWAY_TOE, CAUSEWAY_TOE + 1.3];
    this.bank = surface();
    for (const side of [-1, 1]) {
      const point = (s, c) => {
        const row = Math.round(s / 4), rough = c > 0 && c < 4;
        const u = side * (cross[c] + (rough ? (randomAt(row, c + (side > 0 ? 8901 : 8902)) - .5) * .4 : 0));
        const y = c === cross.length - 1 ? SALT_LEVEL - .32 : saltHeight(s, u) + (rough ? (randomAt(row, c + (side > 0 ? 8903 : 8904)) - .5) * .12 : 0);
        return this.at(s, u, y);
      };
      for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) for (let c = 0; c < cross.length - 1; c++) {
        const a = point(s, c), b = point(s + 4, c), d = point(s, c + 1), e = point(s + 4, c + 1);
        const faces = (Math.round(s / 4) + c) % 2 ? [[a, b, d], [b, e, d]] : [[a, b, e], [a, e, d]];
        faces.forEach((face, f) => {
          const tint = GRAVEL[Math.min(c, GRAVEL.length - 1)].clone().multiplyScalar(.95 + randomAt(Math.round(s / 2) + f, c + (side > 0 ? 8905 : 8906)) * .1);
          triangle(this.crust, ...face, tint); triangle(this.bank, ...face, tint);
        });
      }
    }
  }
  buildRoad() {
    const road = surface();
    const band = (low, high, lift, tint) => {
      for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
        const at = (t, u) => this.at(t, u, saltRoadHeight(t) + lift);
        const a = at(s, low), b = at(s + 2, low), c = at(s, high), d = at(s + 2, high);
        triangle(road, a, b, c, tint); triangle(road, b, d, c, tint);
      }
    };
    band(-6.9, 6.9, .045, ROAD.shoulder); band(-5.5, 5.5, .075, ROAD.asphalt);
    band(-5.05, -4.89, .09, ROAD.edge); band(4.89, 5.05, .09, ROAD.edge);
    band(-.21, -.07, .093, ROAD.centre); band(.07, .21, .093, ROAD.centre);
    this.addMesh(geometry(road), roadMaterial, 'salt-causeway-road');
  }
  // Rocky hills, merged into one mesh per chunk, with talus at their feet. The
  // ones near a pool add their reflection to the chunk's mirrored mesh.
  buildHills() {
    const place = new THREE.Matrix4(), turn = new THREE.Quaternion(), point = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const hill of this.hills) {
      if (hill.s < this.start || hill.s >= this.start + CHUNK_LENGTH) continue;
      const shape = SALT_HILLS[hill.variant], source = saltHillShapes[hill.variant][hill.index & 1], root = this.at(hill.s, hill.u, SALT_LEVEL + .03);
      place.compose(point.set(root.x, root.y, root.z), turn.setFromAxisAngle(up, hill.yaw), new THREE.Vector3(hill.radius, hill.height / shape.height, hill.radius));
      const tint = HILL_TINTS[Math.floor(randomAt(hill.index, 8961) * HILL_TINTS.length)], reflect = poolNear(hill.s, hill.u, hill.reach + hill.height * 2);
      const crust = crustTone(hill.s, hill.u, .8), drift = [crust.r, crust.g, crust.b];
      for (let i = 0; i < source.positions.length; i += 3) {
        point.fromArray(source.positions, i).applyMatrix4(place);
        const shift = source.foot[i / 3] ? drift : tint;
        const r = source.colors[i] * shift[0], g = source.colors[i + 1] * shift[1], b = source.colors[i + 2] * shift[2];
        this.hillFaces.positions.push(point.x, point.y, point.z); this.hillFaces.colors.push(r, g, b);
        if (reflect) { this.mirror.positions.push(point.x, point.y, point.z); this.mirror.colors.push(r, g, b); }
      }
      for (const part of hillParts(hill)) solidPost(this, part.x, part.z + this.start, part.r * .8);
      // Fallen blocks round the foot, in the hill's own rock.
      const random = seededRandom(hill.index * 7 + 89171);
      for (const part of hillParts(hill)) for (let n = 0, count = 1 + Math.floor(random() * 3); n < count; n++) {
        const angle = random() * Math.PI * 2, reach = part.r * (1.2 + random() * .35), s = -(part.z + Math.sin(angle) * reach);
        this.rock(s, part.x + Math.cos(angle) * reach - positionAt(s, 0, 0).x, .7 + random() * 1.6, random, { tints: source.rock });
      }
    }
  }
  // Rock and its reflection when a pool is close enough to show one. Rocks on
  // dry crust get a collar of heaped salt.
  rock(s, u, size, random, { slope = false, tall = 1, tints = ROCK_TINTS } = {}) {
    const variant = Math.floor(random() * saltBoulders.length), height = size * (.78 + random() * .3) * tall;
    if (!this.clear(s, u, size * 1.2 + .5)) return;
    const p = this.at(s, u, slope ? saltHeight(s, u) : SALT_LEVEL);
    const tint = pick(tints, random()).clone(), clay = saltRegion(s).clay;
    if (clay && tints === ROCK_TINTS) tint.lerp(RUST, clay * .35);
    const item = { p: [p.x, p.y + height * .4, p.z], r: [(random() - .5) * .16, random() * Math.PI * 2, (random() - .5) * .16],
      scale: [size, height, size * (.75 + random() * .4)], color: tint };
    if (size < .45) { this.items.pebbles.push({ ...item, scale: [size, size * .7, size * .9] }); return; }
    this.items.rocks[variant].push(item);
    if (poolNear(s, u, size + height * 1.8 + 4)) this.items.rockMirrors[variant].push(mirrorOf(item));
    if (!slope && size > .8 && !inPool(s, u)) {
      // White salt heaps, or drifted clay on the playa.
      const mix = crustMix(s, u), tone = mix.clay ? color('#ffffff').lerp(crustTone(s, u, .7, mix), mix.clay) : undefined;
      this.items.aprons.push({ p: [p.x, SALT_LEVEL - .015, p.z], r: [0, random() * Math.PI * 2, 0], scale: [size * 1.3, .55 + size * .22, size * 1.3], color: tone });
    }
  }
  // Loose rip-rap along both embankments.
  buildRipRap() {
    const random = seededRandom(this.index + 89111);
    for (const side of [-1, 1]) for (let s = this.start + random() * 6; s < this.start + CHUNK_LENGTH; s += 7 + random() * 12) {
      const u = side * (8.6 + random() ** .8 * 3.4), size = random() < .15 ? 1.1 + random() * .7 : .25 + random() * .6;
      this.rock(s, u, size, random, { slope: Math.abs(u) < CAUSEWAY_TOE });
    }
  }
  buildClusters() {
    for (const cluster of saltClusters(this.start, this.start + CHUNK_LENGTH)) {
      // Whole groups give way to a landmark rather than leaving a few stragglers.
      if (!this.clear(cluster.s, cluster.u, cluster.hero * 2.5)) continue;
      const random = seededRandom(cluster.index * 13 + 89121);
      this.rock(cluster.s, cluster.u, cluster.hero, random, { tall: 1.2 });
      for (let n = 0; n < cluster.pieces; n++) {
        const angle = cluster.heading + n * 2.2 + random() * .9, reach = cluster.hero * (.65 + random() * .9) + random() * 3;
        const s = cluster.s + Math.cos(angle) * reach, u = cluster.u + Math.sin(angle) * reach;
        if (Math.abs(u) < CAUSEWAY_TOE + 1) continue;
        this.rock(s, u, cluster.hero * (.22 + random() * .4), random);
      }
      for (let n = 0, count = 3 + Math.floor(random() * (cluster.pieces * 2 + 4)); n < count; n++) {
        const angle = random() * Math.PI * 2, reach = cluster.hero * (.8 + random() * 1.8);
        const s = cluster.s + Math.cos(angle) * reach, u = cluster.u + Math.sin(angle) * reach;
        if (Math.abs(u) > CAUSEWAY_TOE + 1) this.rock(s, u, .12 + random() * .32, random);
      }
      for (let n = 0, count = 2 + Math.floor(random() * 4); n < count; n++) {
        const angle = random() * Math.PI * 2, reach = cluster.hero * (.9 + random() * 1.3);
        this.tola(cluster.s + Math.cos(angle) * reach, cluster.u + Math.sin(angle) * reach, .8 + random() * .6, random);
      }
    }
  }
  buildScatter() {
    const random = seededRandom(this.index + 89131);
    for (let n = 0; n < 12; n++) {
      const s = this.start + random() * CHUNK_LENGTH, side = random() < .5 ? -1 : 1, u = side * (14 + random() ** 1.3 * 290);
      this.rock(s, u, random() < .3 ? .15 + random() * .25 : .5 + random() * 1.4, random);
    }
  }
  tola(s, u, size, random) {
    if (Math.abs(u) < CAUSEWAY_TOE + .4 || inPool(s, u) || !this.clear(s, u, size + .3)) return;
    const p = this.at(s, u, SALT_LEVEL);
    this.items.tola.push({ p: [p.x, p.y - .03, p.z], r: [0, random() * Math.PI * 2, 0], scale: [size, size * (.8 + random() * .4), size], color: pick(TOLA_TINTS, random()) });
  }
  // Dry tufts along the foot of the causeway, thinning out onto the crust. On
  // the clay playa they spread out into open steppe.
  buildShrubs() {
    const random = seededRandom(this.index + 89141), clay = saltRegion(this.start + CHUNK_LENGTH / 2).clay;
    for (const side of [-1, 1]) for (let s = this.start + random() * 4; s < this.start + CHUNK_LENGTH; s += 2.5 + random() * 7) {
      const u = side * (CAUSEWAY_TOE + .6 + random() ** 1.6 * 9);
      if (random() < .62 - clay * .15) continue;
      this.tola(s, u, .55 + random() * .65, random);
      if (random() < .4) this.tola(s + (random() - .5) * 2, u + side * (.6 + random()), .35 + random() * .35, random);
    }
    for (let n = 0, count = Math.round(clay * 20); n < count; n++) {
      const s = this.start + random() * CHUNK_LENGTH, side = random() < .5 ? -1 : 1, u = side * (CAUSEWAY_TOE + 8 + random() ** 1.4 * 110);
      if (crustMix(s, u).clay > .5) this.tola(s, u, .6 + random() * .7, random);
    }
  }
  // Raked salt cones in a few loose clumps of different sizes, with strays
  // between them, biggest toward the middle of each clump. Each field stays
  // within the box that landmarks and hills keep clear of. The ones in brine
  // are doubled by reflections.
  buildPiles() {
    for (const field of saltPileFields(this.start, this.start + CHUNK_LENGTH)) {
      const random = seededRandom(field.index * 17 + 89151), halfS = field.columns * field.spacing / 2, halfU = field.rows * field.spacing / 2;
      const clumps = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({ x: (random() - .5) * 1.1, z: (random() - .5) * 1.1, reach: .28 + random() * .3 }));
      const placed = [], target = Math.round(field.rows * field.columns * .75), turn = field.skew * .6;
      for (let attempt = 0; attempt < target * 14 && placed.length < target; attempt++) {
        // Mostly drawn round a clump, falling off from its middle.
        const clump = clumps[Math.floor(random() * clumps.length)], stray = random() < .12;
        const spread = stray ? 1 : clump.reach * (random() + random() + random() - 1.5) / 1.5, angle = random() * Math.PI * 2;
        const x = stray ? random() * 2 - 1 : clump.x + Math.cos(angle) * spread, z = stray ? random() * 2 - 1 : clump.z + Math.sin(angle) * spread;
        if (Math.abs(x) > 1 || Math.abs(z) > 1) continue;
        const middle = stray ? 0 : 1 - Math.abs(spread) / clump.reach, radius = (.6 + .4 * middle) * (.85 + random() * .3);
        // A slight turn keeps the heap from lining up with the road.
        const s = field.s + x * halfS + z * halfU * turn, u = field.u + field.side * (z * halfU - x * halfS * turn * .3);
        if (placed.some(other => Math.hypot(other.s - s, other.u - u) < (other.radius + radius) * 1.1 + .25)) continue;
        if (!this.clear(s, u, 1.5)) continue;
        placed.push({ s, u, radius });
        const wet = inPool(s, u), height = radius * (1.05 + random() * .45), p = this.at(s, u, wet ? WATER_LEVEL - .08 : SALT_LEVEL - .03);
        const item = { p: [p.x, p.y, p.z], r: [0, random() * Math.PI * 2, 0], scale: [radius, height, radius], color: pick(PILE_TINTS, random()) };
        this.items.piles.push(item);
        if (poolNear(s, u, 3)) this.items.pileMirrors.push(mirrorOf(item));
        solidPost(this, p.x, p.z, radius * .8);
      }
    }
  }
  // Small groups wading in the wider pools, most in the lagoon stretches.
  buildFlamingos() {
    const random = seededRandom(this.index + 89161), middle = this.start + CHUNK_LENGTH / 2;
    const lagoon = Math.min(1, lagoonAmount(middle) + saltRegion(middle).rose * .6);
    const pools = this.cells.filter(cell => cell.flooded && Math.abs(cell.u) > 24 && Math.abs(cell.u) < 240);
    const groups = pools.length ? (random() < .2 + lagoon * .7 ? 1 : 0) + (random() < lagoon * .45 ? 1 : 0) : 0;
    for (let g = 0; g < groups; g++) {
      const home = pools[Math.floor(random() * pools.length)], heading = random() * Math.PI * 2;
      for (let n = 0, count = 3 + Math.floor(random() * 7); n < count; n++) {
        const s = home.s + (random() - .5) * 9, u = home.u + (random() - .5) * 7;
        if (!inPool(s, u) || !this.clear(s, u, 1)) continue;
        const p = this.at(s, u, WATER_LEVEL - .1), feeding = random() < .4, size = .92 + random() * .16;
        const item = { p: [p.x, p.y, p.z], r: [0, heading + (random() - .5) * 1.4, 0], scale: [size, size, size], color: pick(BIRD_TINTS, random()) };
        (feeding ? this.items.feeding : this.items.standing).push(item);
        (feeding ? this.items.feedingMirrors : this.items.standingMirrors).push(mirrorOf(item));
      }
    }
    // A skein circling over the wider lagoons.
    if (lagoon > .35 && ((this.index % 2) + 2) % 2 === 0) {
      const count = 7 + Math.floor(random() * 5), side = random() < .5 ? -1 : 1, u = side * (50 + random() * 90);
      const p = this.at(this.start + CHUNK_LENGTH / 2, u, WATER_LEVEL + 26 + random() * 8), items = [];
      for (let n = 0; n < count; n++) items.push({ p: [p.x, p.y, p.z], scale: [1.1, 1.1, 1.1] });
      const flock = new THREE.InstancedMesh(flamingoFlying, flightMaterial, count); flock.name = 'salt-flamingo-skein';
      items.forEach((item, i) => { matrix.position.set(...item.p); matrix.rotation.set(0, 0, 0); matrix.scale.set(...item.scale); matrix.updateMatrix(); flock.setMatrixAt(i, matrix.matrix); });
      flock.castShadow = false; flock.userData.ambientOcclusion = false;
      flock.computeBoundingSphere(); flock.boundingSphere.radius += 80;
      this.group.add(flock);
    }
  }
  // Delineators along both edges of the causeway.
  buildPosts() {
    // Staggered so the two sides alternate.
    for (let s = Math.ceil(this.start / 24) * 24; s < this.start + CHUNK_LENGTH; s += 24) for (const side of [-1, 1]) {
      const at = s + (side > 0 ? 12 : 0);
      if (at >= this.start + CHUNK_LENGTH || !this.clear(at, side * 7.35, .5)) continue;
      const u = side * 7.35, p = this.at(at, u), yaw = -roadFrame(at).angle;
      this.items.posts.push({ p: [p.x, p.y + .5, p.z], r: [0, yaw, 0], scale: [.11, 1, .11], color: color('#f4f2ec') });
      this.items.bands.push({ p: [p.x, p.y + .86, p.z], r: [0, yaw, 0], scale: [.118, .16, .118], color: color('#2d2c2c') });
    }
  }
  finishScenery() {
    const { rocks, rockMirrors, pebbles, aprons, tola, piles, pileMirrors, standing, standingMirrors, feeding, feedingMirrors, posts, bands } = this.items;
    saltBoulders.forEach((shape, i) => instances(this.group, shape, rockMaterial, rocks[i], 'salt-boulders'));
    instances(this.group, saltPebble, rockMaterial, pebbles, 'salt-pebbles', { shadow: false });
    instances(this.group, saltApron, crustMaterial, aprons, 'salt-boulder-aprons', { shadow: false });
    instances(this.group, saltTola, plantMaterial, tola, 'salt-tola', { occlusion: false });
    instances(this.group, saltPile, pileMaterial, piles, 'salt-piles');
    instances(this.group, flamingoStanding, birdMaterial, standing, 'salt-flamingos');
    instances(this.group, flamingoFeeding, birdMaterial, feeding, 'salt-flamingos-feeding');
    instances(this.group, postGeometry, postMaterial, posts, 'salt-delineators');
    instances(this.group, postGeometry, postMaterial, bands, 'salt-delineator-bands', { shadow: false });
    // Only real rocks block the car, so collect them before adding reflections.
    solidRocks(this, saltBoulders);
    saltBoulders.forEach((shape, i) => instances(this.group, shape, mirrorInstanceMaterial, rockMirrors[i], 'salt-boulder-reflections', { mirror: true }));
    instances(this.group, saltPile, mirrorInstanceMaterial, pileMirrors, 'salt-pile-reflections', { mirror: true });
    instances(this.group, flamingoStanding, mirrorInstanceMaterial, standingMirrors, 'salt-flamingo-reflections', { mirror: true });
    instances(this.group, flamingoFeeding, mirrorInstanceMaterial, feedingMirrors, 'salt-flamingo-reflections', { mirror: true });
    if (this.hillFaces.positions.length) this.addMesh(geometry(this.hillFaces), rockMaterial, 'salt-hills', true);
    // The causeway doubles in any lagoon that reaches its foot.
    if (this.cells.some(cell => cell.flooded && cell.k === 0)) {
      this.mirror.positions = this.mirror.positions.concat(this.bank.positions); this.mirror.colors = this.mirror.colors.concat(this.bank.colors);
    }
    if (this.mirror.positions.length) {
      const mirror = new THREE.Mesh(geometry(this.mirror), mirrorMeshMaterial); mirror.name = 'salt-landform-reflections';
      mirror.position.y = WATER_LEVEL * 2; mirror.scale.y = -1; mirror.userData.ambientOcclusion = false; mirror.receiveShadow = false;
      this.group.add(mirror); this.owned.push(mirror.geometry);
    }
    delete this.bank; delete this.hillFaces; delete this.mirror;
  }
}

export class SaltWorld extends LevelWorld {
  constructor(scene, chunkSource = null) {
    super(scene, chunkSource, SaltChunk);
    this.sky = new SaltSky(scene); this.backdrop = true;
  }
  update(s) {
    super.update(s);
    const anchor = positionAt(s, 0, 0);
    this.sky.follow(anchor.x, anchor.z + this.origin);
  }
  // One clock drives the pools, clouds, cloud shadows and flamingo flight.
  animate(time) { animateWater(time, this.origin); }
  dispose() { super.dispose(); this.sky.dispose(); }
}
