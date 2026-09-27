import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { splitBatch, computeInstanceBounds } from './instance-batches.js';
import { LevelChunk, LevelWorld } from './level.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep, lerp, positionAt } from './route.js';
import { SWAMP_STEP, SWAMP_COLUMN_COUNT, WATER_LEVEL, swampVertex, swampGround, swampRoadHeight as roadHeight, swampBridgeAt, onBridge,
  bayouAmount, bankEdge, swampNoise, islandField, ISLAND_THRESHOLD } from './swamp-route.js';
import { swampDiscoveries, swampDiscoveryNear as nearCamp, swampPad, swampDriveway } from './swamp-discoveries.js';
import { material, bakeLantern, lanternLit, createWaterMaterial, createReflectionMaterial, createMistMaterial, createFireflyMaterial } from './swamp-materials.js';
import { SwampSky } from './swamp-sky.js';
import { cypressTrees, oakTrees, snagTrees, palmettoGeometry, reedTufts, lilyClusters, swampRocks, swampLogs, egretGeometry, heronGeometry,
  gatorGeometry, baskingGatorGeometry, Parts } from './swamp-assets.js';
import { buildSwampCamp } from './swamp-camps.js';
import { swampLandmarkGeometry, wheelMaterial, SWAMP_LANDMARKS } from './swamp-discovery-assets.js';
import { landmarkMatrix, swampDiscoveryLight, chapelDrive } from './swamp-discovery-scenery.js';
import { animateWater } from './water.js';
import { terrainSampler } from './coastal-assets.js';
import { solidSpan } from './colliders.js';
import { CarHeadlights } from './headlights.js';

const terrainMaterial = material('#ffffff', { vertexColors: true });
const roadMaterial = material('#3b4046', { flatShading: false });
const shoulderMaterial = material('#8b8676', { flatShading: false });
const edgeMaterial = material('#dcdbd2', { flatShading: false });
const centerMaterial = material('#d8b03c', { flatShading: false });
const barkMaterial = material('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
const canopyMaterial = material('#ffffff', { vertexColors: true });
const frondMaterial = material('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
const stoneMaterial = material('#ffffff', { vertexColors: true });
const wildlifeMaterial = material('#ffffff', { vertexColors: true });
// Lit by the camp and landmark lanterns baked into their models.
const campMaterial = lanternLit(material('#ffffff', { vertexColors: true }));
const concreteMaterial = material('#a9a8a1');
const railMaterial = material('#ffffff');
// Unlit so windows and lanterns read as light from inside.
const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const waterMaterial = createWaterMaterial();
const reflectionMaterial = createReflectionMaterial(.055), litReflectionMaterial = createReflectionMaterial(.8);
const mistMaterial = createMistMaterial();
const fireflyMaterial = createFireflyMaterial();
const fireflyReflectionMaterial = createFireflyMaterial(.42);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const shrubGeometry = (() => { const parts = new Parts(), leaf = new THREE.Color('#f2f4ea'); parts.lobe([0, .5, 0], [1, .8, 1], 7, leaf); parts.lobe([.45, .35, .2], [.55, .5, .55], 8, leaf); return parts.build(); })();
const dummy = new THREE.Object3D();
registerChunkResources('swamp', { terrainMaterial, roadMaterial, shoulderMaterial, edgeMaterial, centerMaterial, barkMaterial, canopyMaterial, frondMaterial,
  stoneMaterial, wildlifeMaterial, campMaterial, concreteMaterial, railMaterial, glowMaterial, waterMaterial, reflectionMaterial, litReflectionMaterial, mistMaterial, fireflyMaterial, fireflyReflectionMaterial,
  boxGeometry, shrubGeometry, cypressTrees, oakTrees, snagTrees, palmettoGeometry, reedTufts, lilyClusters, swampRocks, swampLogs, egretGeometry,
  heronGeometry, gatorGeometry, baskingGatorGeometry, swampLandmarkGeometry, wheelMaterial });
// Fireflies each discovery gathers, and how far they wander from it.
const SWARMS = { 'fishing-camp': [14, 15], 'hollow-cypress': [34, 17], chapel: [16, 22], riverboat: [8, 22] };

// Lantern light lies on the water, under the mist. Fireflies draw over both.
const ORDER = { water: 1, pools: 2, mist: 3, fireflies: 4 };

function geometryFrom(vertices, colors, extra = {}) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  for (const [name, [values, size]] of Object.entries(extra)) g.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function batch(group, geometry, mat, items, name, shadows, ambientOcclusion) {
  const mesh = new THREE.InstancedMesh(geometry, mat, items.length); mesh.name = name;
  items.forEach((item, i) => {
    dummy.position.set(...item.p); dummy.rotation.set(...(item.r ?? [0, 0, 0]));
    if (item.q) dummy.quaternion.copy(item.q);
    dummy.scale.set(...item.scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  });
  mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
  if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  computeInstanceBounds(mesh); group.add(mesh); return mesh;
}

export class SwampChunk extends LevelChunk {
  constructor(index) {
    super(index, `swamp-chunk-${index}`);
    this.features = { discoveries: [] };
    this.discoveries = swampDiscoveries(this.start - 40, this.start + CHUNK_LENGTH + 40);
    this.bridge = swampBridgeAt(this.start + CHUNK_LENGTH / 2);
    this.buildTerrain(); this.buildRoad(); this.buildBridge(); this.buildScenery(); this.buildDiscoveries();
    this.buildMist();
    delete this.discoveries;
    finalizeChunkTransforms(this.group);
  }
  instances(geometry, mat, items, name, { shadows = true, ambientOcclusion = true, reflection = null } = {}) {
    if (!items.length) return;
    for (const part of splitBatch(items)) {
      const mesh = batch(this.group, geometry, mat, part, name, shadows, ambientOcclusion);
      if (reflection) this.reflect(mesh, reflection);
    }
  }
  // Mirrored under the water in the mesh's own transform. Instanced copies
  // share the original's matrices and colours, so a reflection costs a draw
  // but no extra buffers. Trees and landmarks reflect a cheap silhouette.
  reflect(source, geometry = source.geometry, mat = reflectionMaterial) {
    const mirror = source.isInstancedMesh ? new THREE.InstancedMesh(geometry, mat, 0) : new THREE.Mesh(geometry, mat);
    if (mirror.isInstancedMesh) {
      mirror.count = source.count; mirror.instanceMatrix = source.instanceMatrix; mirror.instanceColor = source.instanceColor;
      computeInstanceBounds(mirror); mirror.boundingSphere.radius += .5; // The waver.
    }
    mirror.name = `${source.name}-reflection`; mirror.position.y = WATER_LEVEL * 2; mirror.scale.y = -1;
    mirror.receiveShadow = false; mirror.userData.ambientOcclusion = false;
    this.group.add(mirror); return mirror;
  }
  // Faces under the water are clipped away since the water hides them. The
  // water is a flat sheet over the same grid, shaded by depth.
  buildTerrain() {
    const vertices = [], colors = [], water = [], waterColors = [], coords = [];
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3(), light = new THREE.Vector3(-120, 230, -60).normalize();
    const gravel = new THREE.Color('#8a826c'), verge = new THREE.Color('#5f7141'), tan = new THREE.Color('#8f8558'), riprap = new THREE.Color('#6a665d');
    const mud = new THREE.Color('#4a4336'), wet = new THREE.Color('#37332b'), moss = new THREE.Color('#3b4b2d'), grass = new THREE.Color('#485a32');
    const litter = new THREE.Color('#574f39'), deepForest = new THREE.Color('#2f3d28'), lawn = new THREE.Color('#5b6f3b'), clover = new THREE.Color('#687c44');
    const shallow = new THREE.Color('#4b6057'), deep = new THREE.Color('#354e64'), channel = new THREE.Color('#30475e');
    const rows = CHUNK_LENGTH / SWAMP_STEP, first = this.start / SWAMP_STEP;
    const grid = Array.from({ length: rows + 1 }, (_, i) => Array.from({ length: SWAMP_COLUMN_COUNT }, (_, col) => swampVertex(first + i, col)));
    const cut = WATER_LEVEL - .03;
    const emit = (tri, color) => {
      const above = tri.filter(p => p.y > cut), below = tri.filter(p => p.y <= cut);
      if (!above.length) return;
      const push = (a, b, c) => {
        if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
        for (const p of [a, b, c]) { vertices.push(p.x, p.y, p.z + this.start); colors.push(color.r, color.g, color.b); }
      };
      if (!below.length) { push(...tri); return; }
      const cross = (p, q) => { const t = (cut - p.y) / (q.y - p.y); return { x: lerp(p.x, q.x, t), y: cut, z: lerp(p.z, q.z, t) }; };
      if (above.length === 1) push(above[0], cross(above[0], below[0]), cross(above[0], below[1]));
      else {
        const p = cross(above[0], below[0]), q = cross(above[1], below[0]);
        push(above[0], above[1], q); push(above[0], q, p);
      }
    };
    for (let i = 0; i < rows; i++) for (let col = 0; col < SWAMP_COLUMN_COUNT - 1; col++) {
      const a = grid[i][col], b = grid[i + 1][col], c = grid[i][col + 1], d = grid[i + 1][col + 1];
      const tris = (first + i + col) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
      tris.forEach((tri, k) => {
        const s = (tri[0].s + tri[1].s + tri[2].s) / 3, u = (tri[0].u + tri[1].u + tri[2].u) / 3, y = (tri[0].y + tri[1].y + tri[2].y) / 3;
        if (Math.max(tri[0].y, tri[1].y, tri[2].y) <= WATER_LEVEL - .03) return;
        ab.set(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z); ac.set(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
        normal.crossVectors(ab, ac).normalize(); if (normal.y < 0) normal.negate();
        const facet = randomAt((first + i) * 2 + k, col + 3301), a2 = Math.abs(u), road = roadHeight(s), patch = swampNoise(s, u, 17, 3302);
        let color;
        if (a2 < 7) color = gravel.clone().multiplyScalar(.8);
        else if (a2 < 8.4) color = gravel.clone().lerp(verge, smoothstep(.55, .8, patch) * .5);
        else if (a2 < 10.2 && y > road - 1.4) color = verge.clone().lerp(tan, smoothstep(.45, .75, swampNoise(s, u, 9, 3303)) * .7);
        else if (a2 < 16 && y < road - 1) color = riprap.clone().lerp(mud, smoothstep(.5, .1, y));
        else if (y < .28) color = wet.clone().lerp(mud, smoothstep(0, .28, y));
        else {
          color = moss.clone().lerp(grass, swampNoise(s, u, 7, 3304));
          color.lerp(litter, smoothstep(.55, .8, patch) * .6);
          color.lerp(tan, smoothstep(.62, .85, swampNoise(s, u, 23, 3305)) * .55);
          if (a2 > 200) color.lerp(deepForest, smoothstep(200, 320, a2) * .7);
          // The chapel's mown lawn.
          const pad = swampPad(s, u);
          if (pad) color.lerp(lawn.clone().lerp(clover, swampNoise(s, u, 5, 3306)), smoothstep(.3, .8, pad.amount));
        }
        color.multiplyScalar((.92 + facet * .12) * (.9 + .16 * Math.max(0, normal.dot(light))));
        emit(tri, color);
      });
    }
    // Water over every cell with any wet corner.
    for (let i = 0; i < rows; i++) for (let col = 0; col < SWAMP_COLUMN_COUNT - 1; col++) {
      const cell = [grid[i][col], grid[i + 1][col], grid[i][col + 1], grid[i + 1][col + 1]];
      if (cell.every(p => p.y > WATER_LEVEL + .25)) continue;
      const point = p => {
        const depth = WATER_LEVEL - p.y, bayou = bayouAmount(p.s, p.u);
        const color = shallow.clone().lerp(deep, smoothstep(.1, 1.6, depth)).lerp(channel, bayou * .6);
        water.push(p.x, WATER_LEVEL, p.z + this.start); waterColors.push(color.r, color.g, color.b); coords.push(p.s, p.u, depth);
      };
      const [a, b, c, d] = cell;
      for (const tri of [[a, b, c], [b, d, c]]) {
        let [p, q, r] = tri;
        if ((q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) < 0) [q, r] = [r, q];
        point(p); point(q); point(r);
      }
    }
    this.terrain = this.addMesh(geometryFrom(vertices, colors), terrainMaterial, 'swamp-ground', true);
    this.sampleGround = terrainSampler(this.terrain);
    const waterGeometry = geometryFrom(water, waterColors, { swampCoord: [coords, 3] });
    const surface = this.addMesh(waterGeometry, waterMaterial, 'swamp-water'); surface.renderOrder = ORDER.water;
  }
  ribbon(ranges, lift, mat, name) {
    const vertices = [], at = (t, u) => positionAt(t, u, roadHeight(t) + lift);
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      for (const [p, q, r] of [[at(s, low), at(s + 2, low), at(s, high)], [at(s + 2, low), at(s + 2, high), at(s, high)]]) {
        let b = q, c = r;
        if ((b.z - p.z) * (c.x - p.x) - (b.x - p.x) * (c.z - p.z) < 0) [b, c] = [c, b];
        for (const v of [p, b, c]) vertices.push(v.x, v.y, v.z + this.start);
      }
    }
    return this.addMesh(geometryFrom(vertices), mat, name);
  }
  buildRoad() {
    this.ribbon([[-6.4, 6.4]], .04, shoulderMaterial, 'road-shoulders');
    this.ribbon([[-5.5, 5.5]], .07, roadMaterial, 'swamp-road');
    this.ribbon([[-5.1, -4.95], [4.95, 5.1]], .085, edgeMaterial, 'road-edges');
    this.ribbon([[-.24, -.12], [.12, .24]], .088, centerMaterial, 'center-lines');
    // Guardrail on the far side, delineators on the near side. The bridge has parapets instead.
    const rails = [], posts = [], markers = [], up = new THREE.Vector3(0, 1, 0);
    const point = (s, u, lift) => { const p = positionAt(s, u, roadHeight(s) + lift); return new THREE.Vector3(p.x, p.y, p.z + this.start); };
    const side = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();
    const beam = (a, b) => {
      const direction = b.clone().sub(a), length = direction.length();
      direction.normalize(); side.crossVectors(direction, up).normalize(); normal.crossVectors(side, direction);
      rails.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [.08, length + .05, .3], q: new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(side, direction, normal)), color: '#b7bcbd' });
      solidSpan(this, a, b, .12);
    };
    const railed = s => !onBridge(s, 2) && !swampDriveway(s);
    for (let s = Math.ceil(this.start / 4) * 4; s < this.start + CHUNK_LENGTH; s += 4) {
      if (!railed(s)) continue;
      posts.push({ p: point(s, 7.45, .02).toArray(), scale: [.14, .9, .14], color: '#8b8f8c' });
      if (railed(s + 4)) beam(point(s, 7.35, .5), point(s + 4, 7.35, .5));
    }
    for (let s = Math.ceil(this.start / 20) * 20; s < this.start + CHUNK_LENGTH; s += 20) {
      if (onBridge(s, 3)) continue;
      markers.push({ p: point(s, -7.3, .45).toArray(), scale: [.12, .95, .12], color: '#e9e7de' });
      markers.push({ p: point(s, -7.3, .82).toArray(), scale: [.13, .14, .13], color: '#f0a33a' });
    }
    this.instances(boxGeometry, railMaterial, [...rails, ...posts, ...markers], 'guardrails');
  }
  // Low concrete bridge over the bayou: deck, parapets, bents and abutments.
  buildBridge() {
    const bridge = this.bridge, inChunk = s => s >= this.start && s < this.start + CHUNK_LENGTH;
    if (bridge.end < this.start || bridge.start >= this.start + CHUNK_LENGTH) return;
    const parts = [], up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();
    const point = (s, u, y) => { const p = positionAt(s, u, y); return new THREE.Vector3(p.x, p.y, p.z + this.start); };
    // Box x runs across the road.
    const yaw = s => { const a = positionAt(s, 0), b = positionAt(s, 1); return Math.atan2(-(b.z - a.z), b.x - a.x); };
    const beam = (a, b, width, height, color) => {
      const direction = b.clone().sub(a), length = direction.length();
      direction.normalize(); side.crossVectors(direction, up).normalize(); normal.crossVectors(side, direction);
      parts.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [width, length + .04, height], q: new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(side, direction, normal)), color });
    };
    const from = Math.max(this.start, bridge.start), to = Math.min(this.start + CHUNK_LENGTH, bridge.end);
    for (let s = from; s < to; s += 2) {
      const e = Math.min(to, s + 2), middle = (s + e) / 2;
      parts.push({ p: point(middle, 0, roadHeight(middle) - .38).toArray(), scale: [13.4, .74, e - s + .06], r: [0, yaw(middle), 0], color: '#b3b1a9' });
      for (const u of [-6.35, 6.35]) {
        const a = point(s, u, roadHeight(s) + .42), b = point(e, u, roadHeight(e) + .42);
        beam(a, b, .38, .84, '#c4c2b9');
        solidSpan(this, a, b, .2);
      }
    }
    for (let s = bridge.start + 5; s < bridge.end - 3; s += 7) {
      if (!inChunk(s)) continue;
      const top = roadHeight(s) - .75, height = top + 2.6;
      parts.push({ p: point(s, 0, top - .35).toArray(), scale: [14, .7, .9], r: [0, yaw(s), 0], color: '#a2a098' });
      for (const u of [-4.6, 0, 4.6]) parts.push({ p: point(s, u, top - height / 2).toArray(), scale: [.75, height, .75], r: [0, yaw(s), 0], color: '#9d9b93' });
    }
    for (const s of [bridge.start + 3, bridge.end - 3]) {
      if (!inChunk(s)) continue;
      const top = roadHeight(s);
      parts.push({ p: point(s, 0, (top - 2.6) / 2).toArray(), scale: [15.5, top + 2.6, 1.4], r: [0, yaw(s), 0], color: '#a7a59d' });
    }
    this.instances(boxGeometry, concreteMaterial, parts, 'bridge-concrete');
  }
  buildScenery() {
    const random = seededRandom(this.index + 51377), pick = list => list[Math.floor(random() * list.length)];
    const cypress = cypressTrees.map(() => ({ trunks: [], crowns: [] })), oaks = oakTrees.map(() => ({ trunks: [], crowns: [] })), snags = snagTrees.map(() => []);
    const palmettos = [], reeds = reedTufts.map(() => []), lilies = lilyClusters.map(() => []), rocks = swampRocks.map(() => []), logs = swampLogs.map(() => []);
    const shrubs = [], farShrubs = [], egrets = [], herons = [], gators = [], baskers = [], fireflies = [];
    const spots = [];
    const ground = (s, u) => { const p = positionAt(s, u); return { x: p.x, y: this.sampleGround(p.x, p.z + this.start) ?? swampGround(s, u), z: p.z + this.start }; };
    const clear = (s, u, r) => !onBridge(s, 8 + r) || Math.abs(u) > 30 ? spots.every(spot => Math.hypot(spot.s - s, spot.u - u) > spot.r + r) && !nearCamp(s, u, r) : false;
    const inChunk = s => s >= this.start && s < this.start + CHUNK_LENGTH;
    // Near-side trees stay below the camera's sightline to the road.
    const headroom = (s, u) => u > 0 ? 60 : Math.max(0, -u * .72 - 3);
    const crownColors = ['#50674f', '#5d7555', '#465f4c', '#677d59', '#496a56', '#61704c'];
    const oakColors = ['#546849', '#60754f', '#4d6044', '#697952'];
    const tints = ['#ffffff', '#f2eee8', '#e6e2da', '#fbf6ee'];
    const fly = (s, u, y) => { if (inChunk(s)) { const p = positionAt(s, u, y); fireflies.push([p.x, p.y, p.z + this.start, random()]); } };
    const tree = (list, variants, s, u, height, colors, spread = .3) => {
      if (!inChunk(s) || !clear(s, u, height * spread)) return false;
      const g = ground(s, u), variant = Math.floor(random() * variants.length), angle = random() * Math.PI * 2;
      const item = { p: [g.x, Math.max(g.y, WATER_LEVEL) - .05, g.z], scale: [height, height, height], r: [0, angle, 0] };
      list[variant].trunks.push({ ...item, color: pick(tints) });
      list[variant].crowns.push({ ...item, color: pick(colors) });
      spots.push({ s, u, r: height * spread * .8 });
      return true;
    };
    const plant = (list, s, u, size, color, lift = 0, stretch = 1) => {
      if (!inChunk(s)) return;
      const g = ground(s, u);
      list.push({ p: [g.x, Math.max(g.y, WATER_LEVEL) + lift, g.z], scale: [size, size * stretch, size], r: [0, random() * Math.PI * 2, 0], color });
    };
    const side = () => random() < .5 ? -1 : 1;

    // Moss-hung oaks and tupelos on dry ground.
    for (let i = 0; i < 150; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (20 + random() ** 1.2 * 220), g = swampGround(s, u);
      if (g < .25 || random() < .35) continue;
      const height = Math.min(headroom(s, u), 9 + random() * 7);
      if (height < 7) continue;
      tree(oaks, oakTrees, s, u, height, oakColors, .45);
    }
    // Bald cypress: in the shallows and on the hammocks, thickest near the islands.
    for (let i = 0; i < 360; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (15.5 + random() ** 1.35 * 250), g = swampGround(s, u), field = islandField(s, u);
      if (g < -2 || bayouAmount(s, u) > .55) continue;
      if (random() > .18 + smoothstep(ISLAND_THRESHOLD - .16, ISLAND_THRESHOLD + .02, field) * .82) continue;
      const height = Math.min(headroom(s, u), (12 + random() ** 1.2 * 19) * (1 - smoothstep(180, 265, Math.abs(u)) * .18));
      if (height < 7) continue;
      if (tree(cypress, cypressTrees, s, u, height, crownColors, .3) && random() < .35) {
        for (let k = 0; k < 3; k++) fly(s + (random() - .5) * 10, u + (random() - .5) * 10, Math.max(g, 0) + .7 + random() * 2.5);
      }
    }
    // Dead snags standing in open water.
    for (let i = 0; i < 170; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (14.5 + random() ** 1.5 * 200), g = swampGround(s, u);
      if (!inChunk(s) || g > .2 || g < -2 || bayouAmount(s, u) > .7 || !clear(s, u, 1.5)) continue;
      const height = Math.min(headroom(s, u) + 2, 6 + random() ** 1.4 * 14), w = ground(s, u);
      snags[Math.floor(random() * snags.length)].push({ p: [w.x, WATER_LEVEL - .05, w.z], scale: [height, height, height], r: [0, random() * Math.PI * 2, 0], color: pick(tints) });
      spots.push({ s, u, r: 1.2 });
    }
    // Understory on the hammocks, and a denser low canopy far out.
    for (let i = 0; i < 360; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (16 + random() ** 1.1 * 240), g = swampGround(s, u);
      if (g < .15 || nearCamp(s, u, 1)) continue;
      if (random() < .55) plant(palmettos, s, u, 1.2 + random() * 1.3, pick(['#ffffff', '#e8efd8', '#f5f0dc']), -.05);
      else plant(shrubs, s, u, 1 + random() * 1.8, pick(['#51693f', '#5c7646', '#4a613c', '#657c47']), -.2);
    }
    for (let i = 0; i < 420; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (190 + random() * 250), g = swampGround(s, u);
      if (g < .05) continue;
      plant(farShrubs, s, u, 5 + random() * 6, pick(['#425b3b', '#4b6540', '#3c5337', '#546c44']), -.8, .8);
    }
    // Sawgrass and cattails along every shore, and at the causeway's waterline.
    for (let i = 0; i < 360; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (15 + random() ** 1.4 * 220), g = swampGround(s, u);
      if (g < -.85 || g > .55 || nearCamp(s, u, 1)) continue;
      // Uneven stands follow the banks, leaving the channel open.
      for (let k = 0; k < 5; k++) {
        const t = s + (random() - .5) * 6, v = u + (random() - .5) * 5, h = swampGround(t, v);
        if (h < -1 || h > .65 || Math.abs(v) < 14) continue;
        plant(reeds[random() < .3 ? 1 : 0], t, v, 2 + random() * 1.8, pick(['#ffffff', '#f1ead7', '#e3e6cf', '#d9ceb2']), -.05);
      }
    }
    // Nothing lines the bank where the chapel's lawn meets the causeway.
    const onPad = (s, u) => (swampPad(s, u)?.amount ?? 0) > .02;
    for (let s = this.start + 1; s < this.start + CHUNK_LENGTH; s += 1.5) for (const k of [-1, 1]) {
      if (onBridge(s, 4) || random() < .25) continue;
      const u = k * (bankEdge(s, k) + .3 + random() * 1.8);
      if (onPad(s, u)) continue;
      plant(reeds[random() < .25 ? 1 : 0], s + random(), u, 1.3 + random() * 1.2, pick(['#ffffff', '#ece3cb', '#dfe4c9']), -.05);
    }
    // Riprap at the causeway waterline.
    for (let s = this.start + .5; s < this.start + CHUNK_LENGTH; s += 1.35) for (const k of [-1, 1]) {
      if (onBridge(s, 1) || random() < .12) continue;
      const u = k * (bankEdge(s, k) - .9 + random() * 1.9), g = ground(s, u), size = .45 + random() ** 3 * 1.7;
      if (onPad(s, u)) continue;
      rocks[Math.floor(random() * rocks.length)].push({ p: [g.x, Math.max(g.y, WATER_LEVEL - .3) + size * .15, g.z], scale: [size * (.9 + random() * .5), size * (.6 + random() * .4), size * (.9 + random() * .4)],
        r: [(random() - .5) * .4, random() * Math.PI * 2, (random() - .5) * .4], color: pick(['#ffffff', '#e8e4dc', '#d8d6d0', '#f4efe6']) });
    }
    // Occasional mossy boulders break the soft silhouettes of the islands.
    for (let i = 0; i < 42; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (20 + random() * 180), g = swampGround(s, u);
      if (g < -.4 || g > .6 || !clear(s, u, 2)) continue;
      const size = 1.2 + random() * 2;
      plant(rocks[2], s, u, size, '#d3d8cf', -.25, .8);
    }
    // Lily pads gather in sheltered water near the islands, clear of hulls and walls.
    for (let i = 0; i < 100; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (14 + random() ** 1.3 * 200), g = swampGround(s, u);
      if (g > -.35 || g < -2.2 || bayouAmount(s, u) > .8 || islandField(s, u) < ISLAND_THRESHOLD - .26) continue;
      for (let k = 0, count = 2 + Math.floor(random() * 5); k < count; k++) {
        const t = s + (random() - .5) * 12, v = u + (random() - .5) * 12;
        if (Math.abs(v) < 13.5 || swampGround(t, v) > -.3 || !inChunk(t) || nearCamp(t, v, 1.5, 'core')) continue;
        const size = 1.4 + random() * 2.2, p = positionAt(t, v, WATER_LEVEL + .01);
        lilies[Math.floor(random() * lilies.length)].push({ p: [p.x, p.y, p.z + this.start], scale: [size, size, size], r: [0, random() * Math.PI * 2, 0], color: pick(['#ffffff', '#eef3e3', '#e3ead6']) });
      }
    }
    // Waders in the shallows and on the riprap.
    // Drawn larger than life so they read from the overhead views.
    for (let i = 0; i < 40 && egrets.length + herons.length < 6; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (16 + random() ** 1.6 * 150), g = swampGround(s, u);
      if (g < -.6 || g > .12 || !clear(s, u, 1.5)) continue;
      const heron = random() < .3, size = heron ? 2.3 + random() * .3 : 1.9 + random() * .3, p = positionAt(s, u, WATER_LEVEL - .25);
      (heron ? herons : egrets).push({ p: [p.x, p.y, p.z + this.start], scale: [size, size, size], r: [0, random() * Math.PI * 2, 0] });
    }
    // An alligator or two: most cruise the open water, some bask on a bank.
    for (let i = 0; i < 10 && gators.length + baskers.length < 1; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (16 + random() ** 1.3 * 110), g = swampGround(s, u);
      if (random() > .12 || !clear(s, u, 2)) continue;
      const length = 3.6 + random() * 1.6, yaw = random() * Math.PI * 2;
      if (g < -.9) { const p = positionAt(s, u, WATER_LEVEL - .012); gators.push({ p: [p.x, p.y, p.z + this.start], scale: [length, length, length], r: [0, yaw, 0] }); }
      else if (g > .08 && g < .45) { const p = ground(s, u); baskers.push({ p: [p.x, p.y - .04, p.z], scale: [length, length, length], r: [0, yaw, 0] }); }
      else continue;
      spots.push({ s, u, r: 2 });
    }
    for (let i = 0; i < 10 && logs[0].length + logs[1].length < 4; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (15 + random() * 150), g = swampGround(s, u);
      if (g > 0 || g < -1.4 || !clear(s, u, 3)) continue;
      const length = 5 + random() * 5, p = positionAt(s, u, WATER_LEVEL - .1);
      logs[random() < .4 ? 1 : 0].push({ p: [p.x, p.y, p.z + this.start], scale: [length, length, length], r: [0, random() * Math.PI * 2, (random() - .5) * .08] });
      spots.push({ s, u, r: length * .5 });
    }
    // Fireflies over the water and along the island edges.
    for (let i = 0; i < 42; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = side() * (12 + random() ** 1.4 * 210), g = swampGround(s, u);
      if (g < -1.8 && random() < .6) continue;
      fly(s, u, Math.max(g, WATER_LEVEL) + .5 + random() ** 1.5 * 3.2);
    }
    cypressTrees.forEach((model, i) => {
      this.instances(model.trunk, barkMaterial, cypress[i].trunks, 'cypress-trunks', { reflection: model.reflection });
      this.instances(model.crown, canopyMaterial, cypress[i].crowns, 'cypress-crowns');
    });
    oakTrees.forEach((model, i) => {
      this.instances(model.trunk, barkMaterial, oaks[i].trunks, 'oak-trunks', { reflection: model.reflection });
      this.instances(model.crown, canopyMaterial, oaks[i].crowns, 'oak-crowns');
    });
    snagTrees.forEach((model, i) => this.instances(model, barkMaterial, snags[i], 'dead-snags', { reflection: model }));
    this.instances(palmettoGeometry, frondMaterial, palmettos, 'palmettos', { shadows: false });
    this.instances(shrubGeometry, canopyMaterial, shrubs, 'hammock-shrubs');
    this.instances(shrubGeometry, canopyMaterial, farShrubs, 'far-canopy', { shadows: false, ambientOcclusion: false });
    reedTufts.forEach((model, i) => this.instances(model, frondMaterial, reeds[i], 'sawgrass', { shadows: false }));
    lilyClusters.forEach((model, i) => this.instances(model, frondMaterial, lilies[i], 'lily-pads', { shadows: false }));
    swampRocks.forEach((model, i) => this.instances(model, stoneMaterial, rocks[i], 'riprap'));
    swampLogs.forEach((model, i) => this.instances(model, barkMaterial, logs[i], 'fallen-logs', { reflection: model }));
    this.instances(egretGeometry, wildlifeMaterial, egrets, 'egrets');
    this.instances(heronGeometry, wildlifeMaterial, herons, 'herons');
    this.instances(gatorGeometry, wildlifeMaterial, gators, 'alligators', { shadows: false });
    this.instances(baskingGatorGeometry, wildlifeMaterial, baskers, 'basking-alligators');
    this.fireflies = fireflies;
  }
  buildDiscoveries() {
    for (const site of this.discoveries) {
      if (site.s < this.start || site.s >= this.start + CHUNK_LENGTH) continue;
      if (site.kind === 'fishing-camp') {
        const { body, glow } = buildSwampCamp(site, this.start), lamp = swampDiscoveryLight(site);
        bakeLantern(body, { ...lamp, position: lamp.position.clone().setZ(lamp.position.z + this.start) });
        const camp = this.addMesh(body, campMaterial, 'fishing-camp', true), windows = this.addMesh(glow, glowMaterial, 'camp-windows');
        windows.receiveShadow = false;
        this.reflect(camp); this.reflect(windows, glow, litReflectionMaterial);
      } else {
        // Shared models, one instance each, so every chunk reuses the same buffers.
        const matrix = landmarkMatrix(site).premultiply(new THREE.Matrix4().makeTranslation(0, 0, this.start)), model = swampLandmarkGeometry[site.kind];
        const body = this.landmark(model.body, campMaterial, matrix, site.kind, { shadows: true });
        const glow = this.landmark(model.glow, glowMaterial, matrix, `${site.kind}-glow`, { ambientOcclusion: false });
        // The chapel stands back on dry land, where its bank would hide any reflection.
        if (model.reflection) { this.reflect(body, model.reflection); this.reflect(glow, model.glow, litReflectionMaterial); }
        // The spinning wheel would cast a still shadow and ambient occlusion, so it skips both.
        if (model.wheel) this.reflect(this.landmark(model.wheel, wheelMaterial, matrix.clone().multiply(new THREE.Matrix4().makeTranslation(...SWAMP_LANDMARKS[site.kind].wheel)),
          'riverboat-wheel', { ambientOcclusion: false }));
        if (site.kind === 'chapel') this.addMesh(chapelDrive(site, this.start), campMaterial, 'chapel-drive');
      }
      this.features.discoveries.push(site);
      const random = seededRandom(site.index + 4611), [count, spread] = SWARMS[site.kind];
      for (let k = 0; k < count; k++) {
        const p = positionAt(site.s + (random() - .5) * spread * 2, site.u + (random() - .5) * spread * 2, 1 + random() * 3.5);
        this.fireflies.push([p.x, p.y, p.z + this.start, random()]);
      }
    }
  }
  landmark(geometry, mat, matrix, name, { shadows = false, ambientOcclusion = true } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, mat, 1); mesh.name = name; mesh.setMatrixAt(0, matrix);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
    computeInstanceBounds(mesh); this.group.add(mesh); return mesh;
  }
  // One drifting sheet of low mist, thin over the road so the car stays clear.
  // Each stacked sheet shaded every pixel again, so one denser sheet stands in for three.
  buildMist() {
    const vertices = [], coords = [];
    const rows = Array.from({ length: CHUNK_LENGTH / 16 + 1 }, (_, i) => this.start + i * 16);
    const columns = [-440, -370, -300, -240, -190, -150, -115, -85, -60, -40, -26, -16, -10, 0, 10, 16, 26, 40, 60, 85, 115, 150, 190, 240, 300, 370, 440, 500];
    for (const [height, strength, offset] of [[1.4, 1.5, 0]]) {
      for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < columns.length - 1; j++) {
        const at = (s, u) => {
          const p = positionAt(s, u, WATER_LEVEL + height), a = Math.abs(u), land = smoothstep(.2, 1.2, swampGround(s, u) - height * .2);
          const fade = lerp(.12, 1, smoothstep(9, 30, a)) * (1 - smoothstep(360, 480, a)) * (1 - land * .6);
          return { x: p.x, y: p.y, z: p.z + this.start, coord: [s + offset, u + offset * 1.7, strength * fade] };
        };
        const a = at(rows[i], columns[j]), b = at(rows[i + 1], columns[j]), c = at(rows[i], columns[j + 1]), d = at(rows[i + 1], columns[j + 1]);
        for (const v of [a, b, c, b, d, c]) { vertices.push(v.x, v.y, v.z); coords.push(...v.coord); }
      }
    }
    const g = geometryFrom(vertices, null, { mistCoord: [coords, 3] }); g.boundingSphere.radius += 4;
    const mist = this.addMesh(g, mistMaterial, 'swamp-mist'); mist.receiveShadow = false; mist.renderOrder = ORDER.mist;
    // Fireflies: one quad each, built last so the camps can add theirs.
    const centers = [], corners = [], positions = [];
    for (const [x, y, z, seed] of this.fireflies) for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      positions.push(x, y, z); centers.push(x, y, z, seed); corners.push(cx, cy);
    }
    if (!positions.length) return;
    const glow = new THREE.BufferGeometry();
    glow.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    glow.setAttribute('firefly', new THREE.Float32BufferAttribute(centers, 4));
    glow.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
    glow.computeBoundingSphere(); glow.boundingSphere.radius += 3;
    const swarm = this.addMesh(glow, fireflyMaterial, 'fireflies'); swarm.receiveShadow = false; swarm.renderOrder = ORDER.fireflies;
    const reflectedSwarm = new THREE.Mesh(glow, fireflyReflectionMaterial); reflectedSwarm.name = 'firefly-reflections';
    reflectedSwarm.scale.y = -1; reflectedSwarm.position.y = WATER_LEVEL * 2;
    reflectedSwarm.userData.ambientOcclusion = false; this.group.add(reflectedSwarm);
    delete this.fireflies;
  }
}

// A lantern's light on the water or lawn around it: an additive glow with the
// falloff and angle a point light at that height would give, over surfaces
// about as dark as the water. Only the discoveries' own models are lit, baked.
const POOL_ALBEDO = .1, poolGeometry = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
function lanternPool() {
  const pool = new THREE.Mesh(poolGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { light: { value: new THREE.Color() }, height: { value: 1 }, range: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec2 vOffset;
      void main() {
        vOffset = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 light; uniform float height; uniform float range; varying vec2 vOffset;
      void main() {
        float r = length(vOffset) * range, d2 = r * r + height * height, d = sqrt(d2);
        float falloff = pow(clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0), 2.0) / d2;
        gl_FragColor = vec4(light * falloff * height / d, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  pool.name = 'lantern-pool'; pool.renderOrder = ORDER.pools; pool.visible = false; pool.userData.ambientOcclusion = false;
  return pool;
}

export class SwampWorld extends LevelWorld {
  constructor(scene, chunkSource = null) {
    super(scene, chunkSource, SwampChunk);
    this.effects = new THREE.Group(); this.effects.name = 'swamp-night-effects'; scene.add(this.effects);
    this.sky = new SwampSky(this.effects);
    // Deep water seen through the translucent surface. One sheet follows the
    // car rather than one per chunk, so the overlaps never draw twice. It lies
    // below both water and land: copying the clipped surface instead would
    // expose holes beside islands when viewed at an oblique angle.
    this.basin = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#142735', toneMapped: false }));
    this.basin.name = 'swamp-basin'; this.basin.userData.ambientOcclusion = false; this.effects.add(this.basin);
    // Glows follow the two nearest discoveries. Real point lights would cost
    // every lit pixel all the way between discoveries.
    this.pools = Array.from({ length: 2 }, () => { const pool = lanternPool(); this.effects.add(pool); return pool; });
    this.glowGeometry = new THREE.BufferGeometry();
    this.glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.glowGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.glowGeometry.setAttribute('strength', new THREE.Float32BufferAttribute(new Float32Array(2), 1));
    this.glowMaterial = new THREE.PointsMaterial({ vertexColors: true, size: 30, transparent: true, opacity: .42,
      depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.glowMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float strength; varying float vGlow;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = strength;');
      shader.fragmentShader = 'varying float vGlow;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float radius = length(gl_PointCoord - vec2(0.5));
        diffuseColor.a *= exp(-radius * radius * 20.0) * (1.0 - smoothstep(0.32, 0.5, radius)) * vGlow;
      `);
    };
    this.halos = new THREE.Points(this.glowGeometry, this.glowMaterial); this.halos.name = 'lantern-halos';
    this.halos.frustumCulled = false; this.halos.renderOrder = ORDER.fireflies; this.effects.add(this.halos);
    this.headlights = new CarHeadlights();
    this.effects.add(this.headlights);
    this.headlights.light.target.position.set(0, -.4, -17);
    this.headlights.light.intensity = 260; this.headlights.light.distance = 34; this.headlights.light.angle = .42;
  }
  update(s) {
    super.update(s);
    const center = positionAt(s, 0); this.basin.position.set(center.x, -48, center.z + this.origin);
    const sites = swampDiscoveries(s - 300, s + 300), key = sites.map(site => site.index).join(',');
    if (key !== this.siteKey || this.origin !== this.lightOrigin) {
      const tint = new THREE.Color();
      this.lamps = this.pools.map((pool, i) => {
        const site = sites[i], lamp = site ? swampDiscoveryLight(site) : null, p = lamp?.position ?? { x: 0, y: -1000, z: 0 };
        if (lamp) {
          // The chapel's lamps light its lawn. The others stand over water.
          const floor = site.kind === 'chapel' ? site.level : WATER_LEVEL, { uniforms } = pool.material;
          pool.position.set(p.x, floor + .03, p.z + this.origin); pool.scale.setScalar(lamp.distance);
          uniforms.height.value = p.y - floor; uniforms.range.value = lamp.distance;
        }
        this.glowGeometry.attributes.position.setXYZ(i, p.x, p.y, p.z + this.origin);
        tint.set(lamp?.color ?? '#000000').lerp(new THREE.Color('#ffffff'), .12);
        this.glowGeometry.attributes.color.setXYZ(i, tint.r, tint.g, tint.b);
        return lamp && { site, ...lamp, glow: new THREE.Color(lamp.color).multiplyScalar(lamp.intensity * POOL_ALBEDO / Math.PI) };
      });
      this.siteKey = key; this.lightOrigin = this.origin;
      this.glowGeometry.attributes.position.needsUpdate = true; this.glowGeometry.attributes.color.needsUpdate = true;
    }
    this.pools.forEach((pool, i) => {
      const lamp = this.lamps[i], strength = lamp ? 1 - smoothstep(160, 260, Math.abs(lamp.site.s - s)) : 0;
      pool.visible = strength > 0;
      if (lamp) pool.material.uniforms.light.value.copy(lamp.glow).multiplyScalar(strength);
      this.glowGeometry.attributes.strength.setX(i, strength * (lamp?.halo ?? 0));
    });
    this.glowGeometry.attributes.strength.needsUpdate = true;
  }
  animate(time, vehicle) {
    animateWater(time, this.origin);
    if (vehicle) this.headlights.follow(vehicle);
  }
  dispose() {
    super.dispose(); this.effects.removeFromParent();
    this.headlights.dispose(); this.sky.dispose(); this.glowGeometry.dispose(); this.glowMaterial.dispose();
    this.basin.geometry.dispose(); this.basin.material.dispose();
    for (const pool of this.pools) pool.material.dispose();
  }
}
