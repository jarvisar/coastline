import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_LENGTH, roadHeight, randomAt, seededRandom, lerp, clamp } from './route.js';
import { VOLCANIC_STEP, SHELF_EDGE, PLATEAU_EDGE, riftProfile, shelfSteps, shelfFault, shelfFlow, creekSection, volcanicColumns, volcanicVertex, volcanicHeight, volcanicPosition } from './volcanic-route.js';
import { FlowSurface } from './volcanic-flow.js';
import { COLD, basaltMaterial, lavaMaterial, glowMaterial, smokeMaterial, volcanicClock } from './volcanic-materials.js';
import { terrainSampler } from './coastal-assets.js';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { updateResidentChunks } from './resident.js';
import { solidPost, solidSpan } from './colliders.js';
import { VolcanicAtmosphere } from './volcanic-atmosphere.js';

const palette = colors => colors.map(c => new THREE.Color(c));
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
const rockGeometry = weatheredRock();
const pebbleGeometry = new THREE.IcosahedronGeometry(1, 0);
const postGeometry = new THREE.BoxGeometry(.17, 1, .19);
const railGeometry = new THREE.BoxGeometry(1, 1, 1);
const treeGeometry = deadTree();
// One indexed unit sphere per puff: its positions double as smooth normals.
const puff = new THREE.IcosahedronGeometry(1, 1); puff.deleteAttribute('normal'); puff.deleteAttribute('uv');
const puffGeometry = mergeVertices(puff);
const matrix = new THREE.Object3D();
const stoneColors = palette(['#535053', '#5a5352', '#49494f', '#605855', '#48454c']);
const cliffColors = palette(['#413b40', '#4b4040', '#393840', '#534746']);
const ashColors = palette(['#47403f', '#504844', '#433d3e', '#544843']);
const lavaRamp = palette(['#b82403', '#ec4004', '#ff6908', '#ff9d17', '#ffcd48']);
const roadColors = { shoulder: new THREE.Color('#5b514a'), asphalt: new THREE.Color('#3e3d40'), edge: new THREE.Color('#c4bcb0'), centre: new THREE.Color('#b29855') };
const railColor = new THREE.Color('#7c7770'), railShade = new THREE.Color('#4e4947'), reflectorColor = new THREE.Color('#edc994');
const postColor = new THREE.Color('#938b79'), snagColor = new THREE.Color('#231c1d');
const warmStone = new THREE.Color('#95513b');
// Additive light: a hot line where rock meets lava, a softer spill beyond it.
// It is added to the encoded frame, where a little green already reads as tan.
const rimLight = new THREE.Color(.15, .018, .0005), spillLight = new THREE.Color(.095, .009, .0003), dark = new THREE.Color(0, 0, 0);
registerChunkResources('volcanic', { basaltMaterial, lavaMaterial, glowMaterial, smokeMaterial, rockMaterial, rockGeometry, pebbleGeometry });

// Keep the broad polygon faces, with a little shared shading across their
// edges: worn basalt rather than the hard creases of cut stone.
function softenNormals(g, amount = .08) {
  const p = g.attributes.position, normals = g.attributes.normal, shared = new Map(), keys = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1000)},${Math.round(p.getY(i) * 1000)},${Math.round(p.getZ(i) * 1000)}`;
    keys.push(key);
    if (!shared.has(key)) shared.set(key, new THREE.Vector3());
    shared.get(key).add(new THREE.Vector3().fromBufferAttribute(normals, i));
  }
  for (const normal of shared.values()) normal.normalize();
  const normal = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    normal.fromBufferAttribute(normals, i);
    normal.lerp(shared.get(keys[i]), typeof amount === 'function' ? amount(normal) : amount).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return g;
}
function weatheredRock() {
  const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const wear = 1 + .11 * Math.sin(x * 5 + z * 3) + .055 * Math.cos(y * 7 - z * 4);
    p.setXYZ(i, x * wear, y * wear, z * wear);
  }
  g.computeVertexNormals();
  return softenNormals(g, .08);
}

// A burnt snag: a leaning trunk and three bare limbs.
function deadTree() {
  const limb = (length, radius, y, yaw, tilt) => new THREE.CylinderGeometry(radius * .4, radius, length, 4, 1).translate(0, length / 2, 0)
    .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, tilt)).setPosition(0, y, 0));
  return mergeGeometries([limb(3.5, .2, 0, 0, .07), limb(1.7, .1, 1.5, .4, .9), limb(1.4, .085, 2.1, 2.6, .8), limb(1.1, .07, 2.7, 4.5, .65)]);
}

function surface() { return { positions: [], colors: [], heat: [] }; }
// `heat` is a number, a function of the vertex, or null for meshes without it.
function triangle(target, a, b, c, color, heat = COLD, upward = true) {
  if (upward && (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    target.positions.push(p.x, p.y, p.z);
    const tint = color.isColor ? color : color(p); target.colors.push(tint.r, tint.g, tint.b);
    if (heat !== null) target.heat.push(typeof heat === 'function' ? heat(p) : heat);
    if (target.flow) target.flow.push(p.flow ?? 0);
    if (target.smooth) target.smooth.push(p.normal?.x ?? 0, p.normal?.y ?? 0, p.normal?.z ?? 0);
  }
}
// A face of a solid mass, wound to look away from `centre` whichever way its ring runs.
function facing(target, a, b, c, centre, color, heat) {
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (nx * ((a.x + b.x + c.x) / 3 - centre.x) + nz * ((a.z + b.z + c.z) / 3 - centre.z) < 0) [b, c] = [c, b];
  triangle(target, a, b, c, color, heat, false);
}
const vertexHeat = p => p.heat, vertexLight = p => p.light;
// A few posts or snags cost less as faces of a chunk's static mesh than as a
// draw call of their own, twice over once they cast shadows.
function bake(target, model, transform, color) {
  const position = model.attributes.position, index = model.index, corner = new THREE.Vector3(), face = [];
  for (let i = 0; i < index.count; i++) {
    corner.fromBufferAttribute(position, index.getX(i)).applyMatrix4(transform); face.push({ x: corner.x, y: corner.y, z: corner.z });
    if (face.length === 3) triangle(target, ...face.splice(0), color, COLD, false);
  }
}
function geometry(data, weathered = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  if (data.heat.length) g.setAttribute('heat', new THREE.Float32BufferAttribute(data.heat, 1));
  if (data.flow) g.setAttribute('flow', new THREE.Float32BufferAttribute(data.flow, 1));
  g.computeVertexNormals();
  if (data.smooth) {
    const normals = g.attributes.normal, normal = new THREE.Vector3(), smooth = new THREE.Vector3();
    for (let i = 0; i < normals.count; i++) {
      smooth.fromArray(data.smooth, i * 3);
      if (smooth.lengthSq() < .5) continue;
      normal.fromBufferAttribute(normals, i);
      // Continuous shading on the ground, retaining broad faces on cliff walls.
      normal.lerp(smooth, .08 + .4 * clamp((normal.y - .25) / .45, 0, 1)).normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
  }
  if (weathered) softenNormals(g, normal => .08 + .65 * clamp((normal.y - .55) / .35, 0, 1));
  g.computeBoundingSphere(); return g;
}
function instances(group, name, geometry, material, items, shadow = true) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = name;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; matrix.position.set(...item.p); matrix.rotation.set(...(item.r ?? [0, 0, 0])); matrix.scale.set(...item.scale); matrix.updateMatrix();
    mesh.setMatrixAt(i, matrix.matrix); if (item.color) mesh.setColorAt(i, item.color);
  }
  mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh);
}
const pick = (colors, random) => colors[Math.floor(random * colors.length) % colors.length];
const railRun = s => ((s % 256) + 256) % 256;
const besideRail = s => railRun(s) >= 48 && railRun(s) < 104;
function lavaColor(t) {
  const f = clamp(t, 0, .9999) * (lavaRamp.length - 1), i = Math.floor(f);
  return lavaRamp[i].clone().lerp(lavaRamp[i + 1], f - i);
}

// The lava field is a cracked crust. Seeds on a jittered grid, in metres along
// the road and out from it, own the ground nearest them; pulling every cell
// back from its neighbours leaves the web of molten channels between blocks.
// Cells are global, so a block belongs to whichever chunk holds its seed.
const CELL = 40, POOL = .16, LOW = .36, MID = .76;
function riftSeed(i, j, side) {
  const salt = (side < 0 ? 7600 : 7700) + j * 13;
  return { s: (i + .5 + (randomAt(i, salt) - .5) * .86) * CELL, d: (j + .5 + (randomAt(i, salt + 1) - .5) * .86) * CELL,
    kind: randomAt(i, salt + 2), key: Math.floor(randomAt(i, salt + 3) * 1e6) };
}
// Keep the part of a convex outline at least `inset` behind the line through (mx, my) with normal (nx, ny).
function clip(outline, mx, my, nx, ny, inset = 0) {
  const kept = [], depth = p => (p[0] - mx) * nx + (p[1] - my) * ny + inset;
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length], da = depth(a), db = depth(b);
    if (da <= 0) kept.push(a);
    if ((da <= 0) !== (db <= 0)) kept.push([a[0] + (b[0] - a[0]) * da / (da - db), a[1] + (b[1] - a[1]) * da / (da - db)]);
  }
  return kept;
}
function riftCell(i, j, side) {
  const seed = riftSeed(i, j, side), reach = CELL * 1.6;
  const { near, far } = riftProfile(seed.s, side), interior = side < 0 && seed.d > near + 18 && seed.d < far - 18;
  // The left basin is mostly connected molten watercourses. Leave broad
  // passages around its interior islands, while bank fragments stay rooted.
  const inset = interior ? lerp(5, 8, seed.key % 97 / 97)
    : seed.kind < LOW ? lerp(3, 4.5, seed.key % 97 / 97) : lerp(1.6, 2.8, seed.key % 97 / 97);
  let outline = [[seed.s - reach, seed.d - reach], [seed.s + reach, seed.d - reach], [seed.s + reach, seed.d + reach], [seed.s - reach, seed.d + reach]];
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
    if (!di && !dj) continue;
    const other = riftSeed(i + di, j + dj, side), nx = other.s - seed.s, ny = other.d - seed.d, length = Math.hypot(nx, ny);
    outline = clip(outline, (seed.s + other.s) / 2, (seed.d + other.d) / 2, nx / length, ny / length, inset);
    if (outline.length < 3) return null;
  }
  return { seed, outline };
}
// Trim an outline to the molten band with straight cuts, which keep it convex.
// The cuts stand off the widest shelf and narrowest bank along the block, so a
// channel always runs between the block and either cliff.
function riftLimits(outline, side, margin) {
  const along = outline.map(p => p[0]), from = Math.min(...along), to = Math.max(...along);
  let low = 0, high = Infinity;
  for (let s = from - 2; s <= to + 6; s += 4) { const { near, far } = riftProfile(s, side); low = Math.max(low, near); high = Math.min(high, far); }
  return [low + 6 + margin, high - 6 - margin];
}
function fitToRift(outline, side, margin) {
  if (side < 0) {
    // Let boundary cells overlap the banks. These are pieces of the same
    // broken shelf, with submerged roots, rather than rafts isolated by a moat.
    let near = Infinity, far = 0;
    const along = outline.map(p => p[0]);
    for (let s = Math.min(...along); s <= Math.max(...along) + 4; s += 4) {
      const profile = riftProfile(s, side); near = Math.min(near, profile.near); far = Math.max(far, profile.far);
    }
    outline = clip(outline, 0, Math.max(19, near - 9), 0, -1);
    return outline.length < 3 ? outline : clip(outline, 0, far + 14, 0, 1);
  }
  const [low, high] = riftLimits(outline, side, margin);
  outline = clip(outline, 0, low, 0, -1);
  return outline.length < 3 ? outline : clip(outline, 0, high, 0, 1);
}
function outlineArea(outline) {
  let area = 0;
  for (let k = 0; k < outline.length; k++) { const a = outline[k], b = outline[(k + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area) / 2;
}
// How far the middle of an outline stands from its nearest edge.
function outlineReach(outline) {
  const count = outline.length, cs = outline.reduce((sum, p) => sum + p[0], 0) / count, cd = outline.reduce((sum, p) => sum + p[1], 0) / count;
  let reach = Infinity;
  for (let k = 0; k < count; k++) {
    const a = outline[k], b = outline[(k + 1) % count], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > .01) reach = Math.min(reach, Math.abs((b[0] - a[0]) * (a[1] - cd) - (a[0] - cs) * (b[1] - a[1])) / length);
  }
  return { cs, cd, reach };
}
// Split long edges so a broad face breaks into several facets.
function facet(outline, span, random) {
  const points = [];
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]), count = Math.max(1, Math.round(length / span));
    if (length < 1.4) continue;
    for (let m = 0; m < count; m++) {
      const t = m ? (m + (random() - .5) * .5) / count : 0;
      points.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    }
  }
  return points;
}

export class VolcanicChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.owned = []; this.features = { vents: [], colliders: [] };
    this.group = new THREE.Group(); this.group.name = `volcanic-chunk-${index}`;
    // Rock, molten rock and spilled light each merge into one mesh per chunk.
    this.rock = surface(); this.lava = { ...surface(), flow: [] }; this.glow = surface(); this.rocks = []; this.pebbles = []; this.tops = [];
    this.flowSurface = new FlowSurface(VOLCANIC_STEP);
    this.buildTerrain(); this.buildLava(); this.buildCreek(); this.buildRift(); this.buildOutcrops();
    this.sampleFormations();
    this.buildCones();
    this.sampleFormations();
    this.buildFissures(); this.buildCrust(); this.buildRocks(); this.buildTalus(); this.buildCreekBanks(); this.buildTrees();
    this.addMesh(this.rock, basaltMaterial, 'volcanic-formations', true);
    this.addMesh(this.lava, lavaMaterial, 'volcanic-lava');
    this.addMesh(this.glow, glowMaterial, 'volcanic-glow');
    instances(this.group, 'volcanic-boulders', rockGeometry, rockMaterial, this.rocks);
    instances(this.group, 'volcanic-pebbles', pebbleGeometry, rockMaterial, this.pebbles, false);
    this.buildSmoke();
    for (const key of ['rock', 'lava', 'glow', 'rocks', 'pebbles', 'tops', 'ground', 'flowSurface']) delete this[key];
    finalizeChunkTransforms(this.group);
  }
  sampleFormations() {
    // Dressing follows the finished rock, including caps and buttresses.
    // Sampling only the original ground buries debris and cracks inside them.
    const rockSurface = new THREE.BufferGeometry();
    rockSurface.setAttribute('position', new THREE.Float32BufferAttribute(this.rock.positions, 3));
    const formations = terrainSampler({ geometry: rockSurface }, true), terrain = terrainSampler(this.terrain);
    this.ground = (x, z) => {
      const a = terrain(x, z), b = formations(x, z);
      return a === null ? b : b === null ? a : Math.max(a, b);
    };
    rockSurface.dispose();
  }
  at(s, u, y = volcanicHeight(s, u)) {
    const p = volcanicPosition(s, u, y); return { ...p, s, u, z: p.z + this.start };
  }
  // A point on the drawn terrain, which differs from the analytic surface between its coarse vertices.
  onGround(s, u, lift = 0) {
    const p = this.at(s, u), y = this.ground(p.x, p.z);
    if (y === null) return null;
    p.y = y + lift; return p;
  }
  // Distance from a point to the road's centre line, which a lateral offset overstates inside a bend.
  clearance(x, z, s) {
    let nearest = Infinity;
    for (let t = s - 36; t <= s + 36; t += 3) { const p = volcanicPosition(t, 0, 0); nearest = Math.min(nearest, Math.hypot(p.x - x, p.z + this.start - z)); }
    return nearest;
  }
  addMesh(data, material, name, shadow = false) {
    const g = data.isBufferGeometry ? data : geometry(data, material === basaltMaterial && name !== 'volcanic-basalt'), mesh = new THREE.Mesh(g, material), light = material === lavaMaterial || material === glowMaterial || material === smokeMaterial;
    mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = !light;
    if (light) mesh.userData.ambientOcclusion = false;
    this.owned.push(g); this.group.add(mesh); return mesh;
  }
  buildTerrain() {
    const data = { ...surface(), smooth: [] }, rows = CHUNK_LENGTH / VOLCANIC_STEP, first = this.start / VOLCANIC_STEP;
    const vertices = Array.from({ length: rows + 1 }, (_, r) => volcanicColumns((first + r) * VOLCANIC_STEP).map((_, c) => {
      const p = volcanicVertex(first + r, c); p.z += this.start;
      // Global height samples keep soft ground shading consistent across chunks.
      const ahead = volcanicPosition(p.s + .5, p.u), behind = volcanicPosition(p.s - .5, p.u);
      const right = volcanicPosition(p.s, p.u + .5), left = volcanicPosition(p.s, p.u - .5);
      p.normal = new THREE.Vector3(right.x - left.x, right.y - left.y, right.z - left.z)
        .cross(new THREE.Vector3(ahead.x - behind.x, ahead.y - behind.y, ahead.z - behind.z)).normalize();
      return p;
    }));
    const heat = p => {
      if (p.u > 0) {
        const { u, width } = creekSection(p.s), distance = Math.max(0, Math.abs(p.u - u) - width / 2);
        return Math.min(7 + distance * 5, 8 + (1 - shelfFault(p.s, p.u)) * COLD);
      }
      return p.band < SHELF_EDGE || p.band > PLATEAU_EDGE ? COLD
        : Math.max(0, p.y - riftProfile(p.s, -1).level) * (1 + .22 * Math.sin(p.s / 6 + p.u / 7));
    };
    const face = (a, b, c, tint) => { triangle(data, a, b, c, tint, heat); this.flowSurface.add(a, b, c); };
    for (let r = 0; r < rows; r++) for (let c = 0; c < vertices[r].length - 1; c++) {
      const a = vertices[r][c], b = vertices[r][c + 1], d = vertices[r + 1][c], e = vertices[r + 1][c + 1];
      // Colour belongs to the land, not each triangle: broad, quiet basalt
      // tones replace the contrasting patchwork across otherwise flat ground.
      const tint = p => {
        const patch = .5 + .5 * Math.sin(p.s / 67 + p.u / 53) * Math.sin(p.s / 103 - p.u / 79);
        const height = clamp((p.y - roadHeight(p.s)) / 18, 0, 1);
        return ashColors[0].clone().lerp(stoneColors[0], .18 + height * .55).multiplyScalar(.96 + patch * .08);
      };
      if (randomAt(first + r, c + 7340) < .5) { face(a, b, d, tint); face(b, e, d, tint); }
      else { face(a, b, e, tint); face(a, e, d, tint); }
    }
    // The road shares the ground's flat-shaded material, so it rides in the same mesh.
    this.buildRoad(data);
    this.terrain = this.addMesh(data, basaltMaterial, 'volcanic-basalt', true);
    this.ground = terrainSampler(this.terrain);
    // Where each drawn cliff meets the lava, from the same vertices, so the hot
    // line hugs the facets and neighbouring chunks agree along their seam.
    const centre = (vertices[0].length - 1) / 2;
    for (const side of [-1]) for (const [top, step] of [[SHELF_EDGE, 1], [PLATEAU_EDGE, -1]]) {
      let previous;
      for (let r = 0; r <= rows; r++) {
        let contact;
        for (let k = 0; k < 3 && !contact; k++) {
          const a = vertices[r][centre + side * (top + step * k + 1)], b = vertices[r][centre + side * (top + step * (k + 1) + 1)];
          const above = a.y - riftProfile(a.s, side).level, below = b.y - riftProfile(b.s, side).level;
          if (above > 0 && below <= 0) { const t = above / (above - below); contact = { s: lerp(a.s, b.s, t), d: Math.abs(lerp(a.u, b.u, t)) }; }
        }
        if (!contact) { previous = null; continue; }
        const strip = [-.5, .45, 2.6].map(out => this.at(contact.s, side * (contact.d + step * out), riftProfile(contact.s, side).level + .07));
        strip.forEach((p, k) => { p.light = [rimLight, spillLight, dark][k]; });
        if (previous) for (let k = 0; k < 2; k++) {
          triangle(this.glow, previous[k], previous[k + 1], strip[k], vertexLight, null); triangle(this.glow, previous[k + 1], strip[k + 1], strip[k], vertexLight, null);
        }
        previous = strip;
      }
    }
  }
  buildLava() {
    const rows = 36, step = CHUNK_LENGTH / rows, first = this.index * rows;
    for (const side of [-1]) {
      const columns = side < 0 ? 26 : 14;
      const vertex = (row, col) => {
        const inner = col > 0 && col < columns, s = row * step + (inner ? (randomAt(row, col + 7510 + side) - .5) * step * .7 : 0);
        // On the right this surface continues under the terraces, appearing
        // through the carved tributaries as they join the main fault.
        const { near, far, level } = riftProfile(s, side), from = side < 0 ? near + 3.4 : 25, to = far - 3.4;
        return this.at(s, side * (lerp(from, to, col / columns) + (inner ? (randomAt(row, col + 7530 + side) - .5) * (to - from) / columns * .7 : 0)), level);
      };
      for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
        const a = vertex(first + r, c), b = vertex(first + r, c + 1), d = vertex(first + r + 1, c), e = vertex(first + r + 1, c + 1);
        // Broad hotter and cooler reaches under the facet-to-facet mosaic.
        const tone = .5 + .5 * Math.sin(a.s / 23 + a.u / 31) * Math.sin(a.s / 41 - a.u / 17 + 1.3);
        const s = (a.s + b.s + d.s + e.s) / 4, u = Math.abs((a.u + b.u + d.u + e.u) / 4), { near, far } = riftProfile(s, side);
        const edge = side > 0 && u < near ? shelfFault(s, u) : clamp(Math.min(u - near - 3, far - 3 - u) / 14, 0, 1);
        const shade = k => lavaColor(.04 + edge * (.43 + tone * .28) + randomAt(first + r, c * 2 + k + 7550 + side) * .17), phase = k => randomAt(first + r, c * 2 + k + 7570 + side);
        if (randomAt(first + r, c + 7590 + side) < .5) { triangle(this.lava, a, b, d, shade(0), phase(0)); triangle(this.lava, b, e, d, shade(1), phase(1)); }
        else { triangle(this.lava, a, b, e, shade(0), phase(0)); triangle(this.lava, a, e, d, shade(1), phase(1)); }
      }
    }
  }
  // Lava, cooling selvage and reflected light share the terrain's exact
  // facets. Rock islands added later emerge naturally through this surface.
  surfaceFlow(path, salt) {
    const offsets = [-1.35, -1, -.77, -.28, .3, .79, 1, 1.35];
    const bands = path.map((p, i) => {
      const before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)];
      const ds = after.s - before.s, du = after.u - before.u, length = Math.hypot(ds, du) || 1;
      return offsets.map(t => ({ s: p.s - du / length * p.width * .5 * t, u: p.u + ds / length * p.width * .5 * t }));
    });
    for (let i = 1; i < path.length; i++) for (let band = 0; band < offsets.length - 1; band++) {
      const outline = [bands[i - 1][band], bands[i - 1][band + 1], bands[i][band + 1], bands[i][band]];
      const glow = band === 0 || band === 6, edge = band === 1 || band === 5;
      const phase = randomAt(Math.floor(path[i].s * 7 + path[i].u * 13), salt + band);
      const color = lavaColor(edge ? .19 + phase * .13 : band === 3 ? .84 + phase * .13 : .52 + phase * .19);
      for (const polygon of this.flowSurface.project(outline, glow ? .085 : .075)) {
        for (const p of polygon) {
          p.flow = edge ? .25 : 1;
          if (glow) {
            const a = bands[i - 1][band === 0 ? 1 : 6], b = bands[i][band === 0 ? 1 : 6];
            const ds = b.s - a.s, du = b.u - a.u, length = Math.hypot(ds, du) || 1;
            const distance = Math.abs(ds * (p.u - a.u) - du * (p.s - a.s)) / length;
            p.light = spillLight.clone().multiplyScalar(.8 * clamp(1 - distance / (path[i].width * .175), 0, 1));
          }
        }
        for (let k = 1; k < polygon.length - 1; k++) triangle(glow ? this.glow : this.lava, polygon[0], polygon[k], polygon[k + 1], glow ? vertexLight : color, glow ? null : phase);
      }
    }
  }
  buildCreek() {
    const path = [];
    // Extend beyond jittered terrain seams, then clip to the owned faces.
    for (let s = this.start - 8; s <= this.start + CHUNK_LENGTH + 8; s += 4) path.push({ s, ...creekSection(s) });
    this.surfaceFlow(path, 78101);
    for (let cell = this.index - 1; cell <= this.index + 1; cell++) for (const branch of [false, true]) {
      const probe = shelfFlow(cell, branch, 40), source = creekSection(probe.s).u, points = [];
      for (let u = probe.end - 1; u <= source + 1; u += 1.25) points.push({ u, ...shelfFlow(cell, branch, u) });
      this.surfaceFlow(points, branch ? 78103 : 78102);
    }
  }
  buildRoad(data) {
    const strip = (left, right, lift, color) => {
      for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
        const a = this.at(s, left, roadHeight(s) + lift), b = this.at(s, right, roadHeight(s) + lift);
        const c = this.at(s + 2, left, roadHeight(s + 2) + lift), d = this.at(s + 2, right, roadHeight(s + 2) + lift);
        triangle(data, a, b, c, color); triangle(data, b, d, c, color);
      }
    };
    strip(-6.3, 6.3, .03, roadColors.shoulder);
    strip(-5.5, 5.5, .06, roadColors.asphalt);
    for (const side of [-1, 1]) {
      strip(side * 5.13 - .085, side * 5.13 + .085, .078, roadColors.edge);
      strip(side * .14 - .045, side * .14 + .045, .078, roadColors.centre);
    }
    for (let s = Math.ceil(this.start / 20) * 20; s < this.start + CHUNK_LENGTH; s += 20) for (const side of [-1, 1]) {
      if (side < 0 && besideRail(s)) continue;
      const p = this.at(s, side * 7.8);
      matrix.position.set(p.x, p.y + .5, p.z); matrix.rotation.set(0, 0, 0); matrix.scale.set(1, 1, 1); matrix.updateMatrix();
      bake(data, postGeometry, matrix.matrix, postColor); solidPost(this, p.x, p.z, .13);
      matrix.position.y += .31; matrix.scale.set(1.12, .14, 1.12); matrix.updateMatrix();
      bake(data, postGeometry, matrix.matrix, reflectorColor);
    }
    // Short weathered W-beam rails mark exposed bends. World-aligned runs
    // remain continuous across chunk seams, with a generous gravel shoulder.
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      if (!besideRail(s)) continue;
      const a = this.at(s, -9.2, roadHeight(s) + .85), b = this.at(s + 4, -9.2, roadHeight(s + 4) + .85);
      const length = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z);
      for (const [height, width, tint] of [[-.13, .11, railShade], [0, .2, railColor], [.13, .11, railColor]]) {
        matrix.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + height, (a.z + b.z) / 2);
        matrix.rotation.set(-Math.atan2(b.y - a.y, length), yaw, 0); matrix.scale.set(width, .13, length + .03); matrix.updateMatrix();
        bake(data, railGeometry, matrix.matrix, tint);
      }
      matrix.position.set(a.x, a.y - .37, a.z); matrix.rotation.set(0, yaw, 0); matrix.scale.set(1, 1, 1); matrix.updateMatrix();
      bake(data, postGeometry, matrix.matrix, railShade);
      if (!besideRail(s + 4)) {
        matrix.position.set(b.x, b.y - .37, b.z); matrix.updateMatrix();
        bake(data, postGeometry, matrix.matrix, railShade);
      }
      solidSpan(this, a, b, .16);
    }
  }
  // A faceted block of basalt standing on `outline`, which lists its corners in
  // metres along the road and out from it. `molten` blocks stand in lava: their
  // feet glow and a hot line rings them where rock meets the surface.
  block(outline, side, base, height, random, molten = true) {
    const count = outline.length, { cs, cd, reach } = outlineReach(outline);
    // A narrow chamfer: a wide one turns a slim block's top into a hipped roof.
    const flare = .8 + random() * 1.8, bevel = Math.min(reach * .18, 1 + random() * 1.6), drop = Math.min(height * .22, 1.4 + random() * 2.1);
    const tiltS = (random() - .5) * .09, tiltD = (random() - .5) * .09, centre = this.at(cs, side * cd, base + height + (random() - .5) * .7);
    const glow = y => molten ? Math.max(0, y - base) * (1 + .2 * Math.sin(cs / 7 + cd / 5)) : COLD;
    // Move a corner `out` metres from the block's middle, or a fraction of the way in to it.
    const ring = (out, y, pull = 0, lit = true) => outline.map((p, k) => {
      const ds = p[0] - cs, dd = p[1] - cd, length = Math.hypot(ds, dd) || 1, shift = typeof out === 'function' ? out(k) : out, level = typeof y === 'function' ? y(k, ds, dd) : y;
      const v = this.at(cs + (ds + ds / length * shift) * (1 - pull), side * (cd + (dd + dd / length * shift) * (1 - pull)), level);
      v.heat = lit ? glow(level) : COLD; v.out = shift; return v;
    });
    const stone = pick(stoneColors, random());
    const waistOut = outline.map(() => flare * .2 + (random() - .5) * 3.2), waistY = outline.map(() => base + height * (.3 + random() * .4));
    const top = (k, ds, dd) => base + height + ds * tiltS + dd * tiltD;
    const footOut = outline.map(() => flare * (.55 + random() * .9));
    const rings = [ring(k => footOut[k], base - 1.5), ring(k => waistOut[k], k => waistY[k]), ring(k => -.15 + (random() - .5) * 1.1, (k, ds, dd) => top(k, ds, dd) - drop * (.7 + random() * .6)),
      ring(-bevel, (k, ds, dd) => top(k, ds, dd) + (random() - .5) * 1.1, 0, false), ring(-bevel, (k, ds, dd) => top(k, ds, dd) + (random() - .5) * 1.5, .5, false)];
    for (let level = 0; level < rings.length - 1; level++) for (let k = 0; k < count; k++) {
      const next = (k + 1) % count, a = rings[level][k], b = rings[level][next], c = rings[level + 1][k], d = rings[level + 1][next];
      // Faces vary down the walls; the top is one slab of stone, told apart by its facets alone.
      const color = level < 2 ? pick(cliffColors, random()) : stone.clone().multiplyScalar(.97 + random() * .06), shade = color.clone().multiplyScalar(.97 + random() * .06);
      const face = level < 2 ? (p, q, r, tint) => facing(this.rock, p, q, r, centre, tint, vertexHeat) : (p, q, r, tint) => triangle(this.rock, p, q, r, tint, vertexHeat);
      if (random() < .5) { face(a, b, c, color); face(b, d, c, shade); } else { face(a, b, d, color); face(a, d, c, shade); }
    }
    centre.heat = COLD;
    const cap = rings.at(-1);
    for (let k = 0; k < count; k++) triangle(this.rock, centre, cap[k], cap[(k + 1) % count], stone.clone().multiplyScalar(.96 + random() * .08), vertexHeat);
    if (molten) {
      // Where the flared foot breaks the surface, between the two lowest rings.
      const lines = [-.4, .45, 2.4].map((out, band) => rings[0].map((foot, k) => {
        const waist = rings[1][k], t = (base - foot.y) / (waist.y - foot.y), ds = outline[k][0] - cs, dd = outline[k][1] - cd, length = Math.hypot(ds, dd) || 1, shift = lerp(foot.out, waist.out, t) + out;
        const v = this.at(outline[k][0] + ds / length * shift, side * (outline[k][1] + dd / length * shift), base + .07); v.light = [rimLight, spillLight, dark][band]; return v;
      }));
      for (let band = 0; band < 2; band++) for (let k = 0; k < count; k++) {
        const next = (k + 1) % count;
        triangle(this.glow, lines[band][k], lines[band][next], lines[band + 1][k], vertexLight, null); triangle(this.glow, lines[band][next], lines[band + 1][next], lines[band + 1][k], vertexLight, null);
      }
      // Now and then a molten split climbs one fractured corner of a tall block.
      if (height > 9 && random() < .4) {
        const k = Math.floor(random() * count), path = [.05, .5, 1].map(t => ({ x: lerp(rings[0][k].x, rings[1][k].x, t), y: lerp(base + .2, rings[1][k].y, t), z: lerp(rings[0][k].z, rings[1][k].z, t) }));
        path.push({ x: lerp(rings[1][k].x, rings[2][k].x, .55), y: lerp(rings[1][k].y, rings[2][k].y, .55), z: lerp(rings[1][k].z, rings[2][k].z, .55) });
        this.vein(path.map((p, j) => ({ ...p, x: p.x + (p.x - centre.x) * .012 + (j % 2 - .5) * .5, z: p.z + (p.z - centre.z) * .012 })), .42, .05, random);
      }
    }
    return { s: cs, u: side * cd, x: centre.x, z: centre.z, y: base + height, reach: reach - bevel };
  }
  // A glowing crack along `path`: a bright core on the lava mesh and a wide,
  // soft spill of additive light on whatever it crosses.
  vein(path, width, taper, random, light = .95) {
    let previous;
    for (let j = 0; j < path.length; j++) {
      const p = path[j], before = path[Math.max(0, j - 1)], after = path[Math.min(path.length - 1, j + 1)];
      const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1, nx = -dz / length, nz = dx / length;
      const half = lerp(width, taper, j / (path.length - 1)) / 2, fade = 1 - .55 * j / (path.length - 1);
      const across = [-light - half, -half, -half * .3, half * .3, half, light + half].map((offset, k) => {
        const x = p.x + nx * offset, z = p.z + nz * offset;
        return { x, y: p.s === undefined ? p.y : (this.ground(x, z) ?? p.y - .1) + .12, z,
          light: k > 0 && k < 5 ? spillLight.clone().multiplyScalar(1.3 * fade) : dark };
      });
      if (previous) {
        const phase = random();
        for (let k = 1; k < 4; k++) {
          const color = lavaColor(k === 2 ? .88 : .37 + random() * .2);
          triangle(this.lava, previous[k], previous[k + 1], across[k], color, phase); triangle(this.lava, previous[k + 1], across[k + 1], across[k], color, phase);
        }
        for (const k of [0, 4]) { triangle(this.glow, previous[k], previous[k + 1], across[k], vertexLight, null); triangle(this.glow, previous[k + 1], across[k + 1], across[k], vertexLight, null); }
      }
      previous = across;
    }
  }
  buildRift() {
    for (const side of [-1]) for (let i = Math.floor(this.start / CELL) - 1; i <= Math.floor((this.start + CHUNK_LENGTH) / CELL) + 1; i++) {
      const probe = riftProfile((i + .5) * CELL, side);
      for (let j = Math.max(0, Math.floor(probe.near / CELL) - 1); j <= Math.floor(probe.far / CELL) + 1; j++) {
        const seed = riftSeed(i, j, side);
        if (seed.s < this.start || seed.s >= this.start + CHUNK_LENGTH) continue;
        const { near, far, level, rise } = riftProfile(seed.s, side), across = (seed.d - near) / (far - near), random = seededRandom(seed.key + 7800);
        if (seed.kind < (side < 0 ? .34 : POOL)) {
          // Open lava, with a few worn stumps standing in it.
          if (across < .12 || across > .88) continue;
          for (let n = 0, count = 1 + Math.floor(random() * 3); n < count; n++) {
            const radius = 1.8 + random() ** 2 * 4.2, angle = random() * Math.PI * 2, offset = random() * CELL * .3, sides = 6 + Math.floor(random() * 3), spin = random() * Math.PI * 2;
            const stump = Array.from({ length: sides }, (_, k) => {
              const turn = spin + k / sides * Math.PI * 2, r = radius * (.82 + random() * .36);
              return [seed.s + Math.cos(angle) * offset + Math.cos(turn) * r, seed.d + Math.sin(angle) * offset + Math.sin(turn) * r];
            });
            const [low, high] = riftLimits(stump, side, 2);
            if (stump.every(p => p[1] > low && p[1] < high)) this.block(stump, side, level, radius * (.55 + random() * .6), random);
          }
          continue;
        }
        if (side < 0 && (seed.d < near - 12 || seed.d > far + 12)) continue;
        const cell = riftCell(i, j, side);
        let outline = cell && fitToRift(cell.outline, side, .8 + random() * 1.8);
        if (!outline || outline.length < 3 || outlineArea(outline) < 40 || outlineReach(outline).reach < 3.4) continue;
        outline = facet(outline, 9, random);
        if (outline.length < 4) continue;
        // Tilted low remnants, mid-height shelves and tall cliff islands form
        // one hierarchy; the outer pieces meet the elevated bank behind them.
        const ceiling = side < 0 ? 17 + 25 * clamp(across, 0, 1) : roadHeight(seed.s) - level + rise * .7;
        const lift = lerp(.85, 1.3, clamp(across, 0, 1));
        const height = Math.min(ceiling, outlineReach(outline).reach * 3.6, lift * (seed.kind < LOW ? 5 + random() * 5 : seed.kind < MID ? 12 + random() * 10 : 26 + random() * 12));
        let top = this.block(outline, side, level, height, random);
        // Some broad blocks carry a second, smaller tier, set off-centre.
        if (top.reach > 6 && random() < .3) {
          const shrink = .38 + random() * .2, angle = random() * Math.PI * 2, offset = top.reach * .3;
          const tier = cell.outline.map(p => [top.s + Math.cos(angle) * offset + (p[0] - seed.s) * shrink, side * top.u + Math.sin(angle) * offset + (p[1] - seed.d) * shrink]);
          if (tier.every(p => Math.hypot(p[0] - top.s, p[1] - side * top.u) < top.reach * .95)) top = this.block(facet(tier, 8, random), side, top.y - .8, 2 + random() * 4.5, random, false);
        }
        if (top.reach > 3.5) this.tops.push(top);
      }
    }
    // Fallen ribs repeatedly split the right creek into two thin molten
    // threads. The islands merge into alternating banks, leaving short pools.
    const random = seededRandom(this.index + 77850);
    for (let n = 0; n < 3; n++) {
      const s = this.start + 15 + n * 42 + random() * 7, section = creekSection(s);
      const d = section.u + (random() - .5) * section.width * .65, width = .55 + random() * .7, length = 1.4 + random() * 2.3;
      const outline = Array.from({ length: 6 }, (_, k) => {
        const angle = k * Math.PI / 3, r = .8 + random() * .3;
        return [s + Math.cos(angle) * length * r, d + Math.sin(angle) * width * r];
      });
      const p = this.onGround(s, d);
      if (p) this.block(outline, 1, p.y - .15, .65 + random() * 1.3, random);
    }
  }
  // A fluted spatter cone with a molten crater, a plume, and a skirt of fallen rock.
  cone(s, u, radius, height, base, random, solid = false) {
    const c = this.at(s, u, base), flutes = 7 + Math.floor(random() * 4), count = flutes * 2, spin = random() * Math.PI * 2;
    const ridge = Array.from({ length: count }, (_, k) => (k % 2 ? .76 + random() * .1 : 1) * (.93 + random() * .14));
    const lip = Array.from({ length: count }, () => 1 + (random() - .5) * .23);
    const twist = Array.from({ length: count }, () => (random() - .5) * .09);
    // Radius, height and how deeply the flutes cut, from the buried foot up to the crater floor.
    const rings = [[1.2, -.16, 1], [.86, .3, .85], [.62, .66, .6], [.47, 1, .3], [.32, .72, 0]].map(([scale, y, cut], level) => ridge.map((r, k) => {
      const angle = spin + k / count * Math.PI * 2 + twist[k] * Math.sin(level * 1.2), reach = radius * scale * lerp(1, r, cut);
      const x = c.x + Math.cos(angle) * reach, z = c.z + Math.sin(angle) * reach;
      const ground = level === 0 ? this.ground(x, z) : null;
      return { x, y: Math.min(base + height * y * (level === 3 ? lip[k] : 1), ground === null ? Infinity : ground - .6), z, heat: [COLD, COLD, 18, 4, 0][level] };
    }));
    for (let level = 0; level < 3; level++) for (let k = 0; k < count; k++) {
      const next = (k + 1) % count, a = rings[level][k], b = rings[level][next], d = rings[level + 1][k], e = rings[level + 1][next];
      const color = pick(k % 2 ? cliffColors : stoneColors, random()), shade = color.clone().multiplyScalar(.92 + random() * .12);
      if (k % 2) { facing(this.rock, a, b, d, c, color, vertexHeat); facing(this.rock, b, e, d, c, shade, vertexHeat); }
      else { facing(this.rock, a, b, e, c, color, vertexHeat); facing(this.rock, a, e, d, c, shade, vertexHeat); }
    }
    // The crater's throat, lit from below, and the lava standing in it.
    const floor = { x: c.x, y: base + height * .72, z: c.z }, throat = rings[3].map(p => ({ ...p, heat: 2.2 }));
    for (let k = 0; k < count; k++) {
      const next = (k + 1) % count;
      triangle(this.rock, throat[k], throat[next], rings[4][k], cliffColors[0], vertexHeat); triangle(this.rock, throat[next], rings[4][next], rings[4][k], cliffColors[2], vertexHeat);
      triangle(this.lava, floor, rings[4][k], rings[4][next], lavaColor(.6 + random() * .4), random());
    }
    const halo = { x: c.x, y: base + height * 1.03, z: c.z, light: rimLight.clone().multiplyScalar(1.4) };
    for (let k = 0; k < count; k += 2) {
      const edge = j => ({ x: lerp(c.x, rings[2][j % count].x, .95), y: halo.y, z: lerp(c.z, rings[2][j % count].z, .95), light: dark });
      triangle(this.glow, halo, edge(k), edge(k + 2), vertexLight, null);
    }
    // Lava spilling down one flute of the larger cones, folded into the flute so it lies on both flanks.
    if (radius > 3.4 && random() < .7) {
      const k = 1 + 2 * Math.floor(random() * flutes), widths = [.1, .14, .2, .26];
      let previous;
      for (let level = 3; level >= 0; level--) {
        const middle = rings[level][k], sides = [rings[level][k - 1], rings[level][(k + 1) % count]], w = widths[level];
        const point = (to, t, light) => ({ x: lerp(middle.x, to.x, t) * 1.025 - c.x * .025, y: lerp(middle.y, to.y, t) + .09, z: lerp(middle.z, to.z, t) * 1.025 - c.z * .025, light });
        const across = [point(sides[0], w * 3.2, dark), point(sides[0], w, spillLight), point(middle, 0, spillLight), point(sides[1], w, spillLight), point(sides[1], w * 3.2, dark)];
        if (previous) for (let j = 0; j < 4; j++) {
          const molten = j === 1 || j === 2, target = molten ? this.lava : this.glow, color = molten ? lavaColor(.6 + random() * .4) : vertexLight, heat = molten ? random() : null;
          facing(target, previous[j], previous[j + 1], across[j], c, color, heat); facing(target, previous[j + 1], across[j + 1], across[j], c, color, heat);
        }
        previous = across;
      }
    }
    this.features.vents.push({ s, u, x: c.x, y: base + height * .95, z: c.z, radius, size: Math.max(.85, radius / 5) });
    for (let n = 0, fallen = 4 + Math.floor(random() * 6); n < fallen; n++) {
      const angle = random() * Math.PI * 2, out = radius * (.92 + random() * .45), size = Math.max(.3, radius * (.06 + random() ** 2 * .2));
      const x = c.x + Math.cos(angle) * out, z = c.z + Math.sin(angle) * out;
      this.boulder(x, this.ground(x, z) ?? base, z, size, random, s, solid);
    }
    return c;
  }
  boulder(x, y, z, size, random, s, solid = false) {
    if (solid && size > .65 && this.clearance(x, z, s) - size * .85 < 7.2) return false;
    const centre = this.at(s, 0), side = Math.sign(x - centre.x) || 1, d = Math.hypot(x - centre.x, z - centre.z);
    if (side < 0 && railRun(s) > 44 && railRun(s) < 108 && Math.abs(d - 9.2) < size * 1.15 + .4) return false;
    const { near, far, level } = riftProfile(s, side), distance = d < near ? near - d : d > far ? d - far : 0;
    const heat = clamp(1 - (y - level) / 14, 0, 1) * clamp(1 - distance / 10, 0, 1);
    (size < 1 ? this.pebbles : this.rocks).push({ p: [x, y + size * .45, z], r: [random() * .5, random() * 6.28, random() * .3],
      scale: [size, size * (.7 + random() * .55), size * (.8 + random() * .25)], color: pick(stoneColors, random()).clone().lerp(warmStone, heat * .5) });
    if (solid && size > .65) solidPost(this, x, z, size * .85);
    return true;
  }
  buildCones() {
    const random = seededRandom(this.index + 77400);
    for (const side of [-1, 1]) {
      // A squat spatter cone steams beside the road where the shelf has room for one.
      {
        // Vents sit at fault tips or at the edge of an uplift, with their
        // connecting tension cracks added after all landforms are sampled.
        const s = this.start + (side > 0 ? 34 + random() * 7 : 40 + random() * 48), { near } = riftProfile(s, side), radius = 3 + random() * 2.4, room = near - 4.5 - radius;
        const d = side > 0 ? Math.min(room, shelfSteps(s, side).toe + 5 + radius) : Math.max(14 + radius, near - radius - 6);
        const p = this.onGround(s, side * d), wanted = random() < .6;
        if (wanted && room > 13.5 + radius && p && p.y > roadHeight(s) - 2 && this.clearance(p.x, p.z, s) - radius * 1.4 > 8.5) {
          this.cone(s, side * d, radius, radius * (.65 + random() * .25), p.y - .3, random, true);
          solidPost(this, p.x, p.z, radius * .82);
        }
      }
      // An occasional broad crater interrupts the plateaus. Most activity
      // comes from low vents and cracks, keeping the road the main landmark.
      if (side > 0 && (this.index % 3 === 0 || randomAt(this.index, 77410) < .18)) {
        const s = this.start + 42 + random() * 38, { near } = riftProfile(s, side);
        const radius = 9 + random() * 3, d = Math.max(radius + 20, near - radius * .65 - 5), p = this.onGround(s, d);
        if (p && this.clearance(p.x, p.z, s) - radius * 1.5 > 9) {
          this.cone(s, d, radius, radius * (.8 + random() * .2), p.y - 1, random, true);
          solidPost(this, p.x, p.z, radius * 1.05);
        }
      }
      const s = this.start + 24 + random() * 80, { far } = riftProfile(s, side);
      const radius = 3.8 + random() * 3.2, d = far + radius + 3 + random() * 7, p = this.onGround(s, side * d);
      if (p && random() < .72) this.cone(s, side * d, radius, radius * (.65 + random() * .25), p.y - radius * .12, random);
    }
    // And the odd one on a broad block out in the lava.
    for (const top of this.tops) if (top.reach > 7 && random() < .05) {
      const radius = Math.min(top.reach * .6, 3.4 + random() * 3);
      this.cone(top.s, top.u, radius, radius * (.6 + random() * .25), top.y - .4, random); top.reach = 0;
    }
  }
  // A blunt, asymmetric summit with broken shoulders, rather than another
  // flat tabletop. Its buried skirt joins the surrounding mountain slope.
  crag(s, u, radius, height, random) {
    const base = this.onGround(s, u), count = 7, spin = random() * Math.PI * 2;
    if (!base) return;
    const lean = (random() - .5) * radius * .55;
    const rings = [[1.2, -.25], [.8, .28], [.35, .76]].map(([scale, rise], band) => Array.from({ length: count }, (_, k) => {
      const angle = spin + k / count * Math.PI * 2, reach = radius * scale * (.82 + random() * .3);
      const p = this.at(s + Math.cos(angle) * reach * 1.2 + lean * band / 2, u + Math.sin(angle) * reach,
        base.y + height * (rise + (band ? (random() - .5) * .2 : 0)));
      if (!band) p.y = Math.min(p.y, (this.ground(p.x, p.z) ?? p.y) - .8);
      return p;
    }));
    for (let band = 0; band < 2; band++) for (let k = 0; k < count; k++) {
      const next = (k + 1) % count, a = rings[band][k], b = rings[band][next], c = rings[band + 1][k], d = rings[band + 1][next];
      const color = pick(k % 3 ? stoneColors : cliffColors, random());
      facing(this.rock, a, b, c, base, color, COLD);
      facing(this.rock, b, d, c, base, color.clone().multiplyScalar(.93 + random() * .12), COLD);
    }
    const peak = this.at(s + lean, u + radius * .12, base.y + height);
    for (let k = 0; k < count; k++) triangle(this.rock, rings[2][k], rings[2][(k + 1) % count], peak, pick(stoneColors, random()));
  }
  // Angular masses breaking through the far banks.
  buildOutcrops() {
    const random = seededRandom(this.index + 78100);
    // Broad bedrock shoulders overlap the two benches. Unequal footprints
    // interrupt the contour lines with headlands, recessed walls and shelves.
    for (let n = 0; n < 2; n++) {
      const s = this.start + 61 + n * 43 + random() * 8, { near } = riftProfile(s, 1), { toe, upper } = shelfSteps(s, 1);
      const d = n ? toe + 3 : upper + 2, along = n ? 12 + random() * 7 : 19 + random() * 9;
      const across = n ? 5 + random() * 3 : Math.min(13, (near - toe) * .4), spin = random() * .4;
      const outline = Array.from({ length: 7 }, (_, k) => {
        const angle = spin + k * Math.PI * 2 / 7, r = .85 + random() * .2;
        return [s + Math.cos(angle) * along * r, d + Math.sin(angle) * across * r];
      });
      if (outline.some(([at, u]) => { const p = this.at(at, u); return this.clearance(p.x, p.z, at) < 12 || shelfFault(at, u) > .05; })) continue;
      const base = Math.min(...outline.map(([at, u]) => volcanicHeight(at, u))) - 3;
      const height = Math.max(...outline.map(([at, u]) => volcanicHeight(at, u))) - base + (n ? 3 : 5) + random() * 4;
      const top = this.block(facet(outline, 11, random), 1, base, height, random, false);
      this.tops.push(top);
      // The near wall is also a physical obstacle; short spans follow its
      // outline instead of a bounding circle that can extend onto a bend.
      for (let k = 0; k < outline.length; k++) {
        const a = this.at(outline[k][0], outline[k][1]), b = this.at(...outline[(k + 1) % outline.length]);
        solidSpan(this, a, b, .6);
      }
    }
    for (const side of [-1, 1]) for (let n = 0; n < 4; n++) {
      const s = this.start + 10 + n * 28 + random() * 22, { far } = riftProfile(s, side), radius = 5 + random() * 9, d = far + 8 + radius + random() ** 1.5 * 130;
      const p = this.onGround(s, side * d);
      if (!p || this.features.vents.some(v => Math.hypot(v.x - p.x, v.z - p.z) < v.radius * 1.5 + radius * 1.4)) continue;
      if (side > 0 && n === 1) { this.crag(s, d, radius * 1.1, 8 + radius * 1.1, random); continue; }
      const sides = 6 + Math.floor(random() * 3), spin = random() * Math.PI * 2, stretch = 1 + random() * .5;
      const outline = Array.from({ length: sides }, (_, k) => {
        const turn = spin + k / sides * Math.PI * 2, r = radius * (.8 + random() * .4);
        return [s + Math.cos(turn) * r * stretch, d + Math.sin(turn) * r];
      });
      const base = Math.min(p.y - 4, ...outline.map(([at, u]) => volcanicHeight(at, side * u) - 2));
      const top = this.block(facet(outline, 10, random), side, base, p.y - base + radius * (.35 + random() * .65), random, false);
      if (top.reach > 3.5) this.tops.push(top);
    }
  }
  buildFissures() {
    const random = seededRandom(this.index + 78600);
    // A crack leaves the lava, climbs the cliff and wanders off across the ground, thinning as it goes.
    const crack = (s, d, side, direction, length, width) => {
      const path = [];
      for (let out = 5.2, drift = 0; out > -.4; out -= .7) path.push([s + (drift += (random() - .5) * 1.5), d - direction * out]);
      let heading = direction > 0 ? 0 : Math.PI; heading += (random() - .5) * 1.2;
      let [ps, pd] = path.at(-1);
      for (let run = 0; run < length; run += 2.8) {
        // Sharp, uneven turns: a fracture, not a stream.
        heading += (random() - .5) * (random() < .3 ? 2 : .65); heading = lerp(heading, direction > 0 ? 0 : Math.PI, .2);
        ps += Math.sin(heading) * 2.8; pd += Math.cos(heading) * 2.8;
        if (pd < 10.5 || ps < this.start + 1 || ps > this.start + CHUNK_LENGTH - 1) break;
        path.push([ps, pd]);
      }
      const points = path.map(([ps, pd]) => this.onGround(ps, side * pd, .1)).filter(Boolean);
      if (points.length > 3) this.vein(points, width, .14, random);
      return path;
    };
    for (const side of [-1, 1]) {
      for (let n = 0; n < 2; n++) {
        // Across the shelf toward the road, stopping short of the shoulder.
        const s = this.start + 16 + n * 60 + random() * 36, { near } = riftProfile(s, side);
        if (random() < .65) crack(s, near, side, -1, 5 + random() * Math.max(0, near - 22), .5 + random() * .25);
      }
      for (let n = 0; n < 2; n++) {
        // Up the far bank and out over it, forking once.
        const s = this.start + 18 + n * 58 + random() * 34, { far } = riftProfile(s, side);
        const path = crack(s, far, side, 1, 26 + random() * 50, .6 + random() * .3), fork = path[Math.floor(path.length * (.45 + random() * .3))];
        if (fork && path.length > 14) {
          const branch = [fork]; let heading = (random() < .5 ? -1 : 1) * (.7 + random() * .6);
          for (let run = 0, length = 12 + random() * 22; run < length; run += 1.9) {
            heading += (random() - .5) * (random() < .3 ? 2.6 : 1.1); const [ps, pd] = branch.at(-1), next = [ps + Math.sin(heading) * 1.9, pd + Math.cos(heading) * 1.9];
            if (next[0] < this.start + 1 || next[0] > this.start + CHUNK_LENGTH - 1) break;
            branch.push(next);
          }
          const points = branch.map(([ps, pd]) => this.onGround(ps, side * pd, .1)).filter(Boolean);
          if (points.length > 3) this.vein(points, .4, .1, random, 1.4);
        }
      }
    }
    // Fine, branching tension cracks across the intact shelf. Their roots
    // favour the scarps and vents; they never reach the paved road.
    const fracture = (s, u, length, heading, width) => {
      const path = [];
      for (let run = 0; run < length; run += 2.2) {
        if (s < this.start + 2 || s > this.start + CHUNK_LENGTH - 2 || Math.abs(u) < 12) break;
        const p = this.onGround(s, u, .13);
        if (!p || p.y < riftProfile(s, Math.sign(u)).level + 1) break;
        path.push(p);
        heading += (random() - .5) * .95;
        s += Math.cos(heading) * 2.2; u += Math.sin(heading) * 2.2;
      }
      if (path.length > 3) this.vein(path, width, .025, random, .65);
      return path;
    };
    for (const side of [-1, 1]) for (let n = 0; n < 2; n++) {
      const s = this.start + 22 + n * 54 + random() * 17, { near } = riftProfile(s, side);
      const u = side * (near - 4 - random() * 9), heading = random() * 6.28;
      const path = fracture(s, u, 12 + random() * 14, heading, .23 + random() * .17);
      const fork = path[Math.floor(path.length * .4)];
      if (fork) fracture(fork.s, fork.u, 5 + random() * 8, heading + side * 1.2, .15);
    }
    for (const top of this.tops) if (top.reach > 5 && random() < .48) {
      const angle = random() * 6.28;
      fracture(top.s, top.u, top.reach * 1.4, angle, .2 + random() * .2);
      fracture(top.s, top.u, top.reach * .8, angle + 2.2, .14);
    }
    // Each smoking formation joins the fault system. Sample the finished
    // shelves so a vein spills down their faces and terminates in the lava.
    for (const vent of this.features.vents) {
      const side = Math.sign(vent.u), d = Math.abs(vent.u), { near, far, level } = riftProfile(vent.s, side);
      const target = Math.abs(d - near) < Math.abs(d - far) ? near + 5 : far - 5;
      const from = d + Math.sign(target - d) * vent.radius * .8, length = Math.abs(target - from), path = [];
      for (let j = 0, steps = Math.max(4, Math.ceil(length / 1.6)); j <= steps; j++) {
        const t = j / steps, p = this.onGround(vent.s + Math.sin(t * Math.PI * 3) * 1.3, side * lerp(from, target, t), .13);
        if (p) { p.y = Math.max(p.y, level + .07); path.push(p); }
      }
      if (path.length > 3) this.vein(path.reverse(), .42, .12, random, .85);
      fracture(vent.s + vent.radius * .7, vent.u, 8 + vent.radius, side * .7, .16);
    }
  }
  // Small rafts of cooling crust interrupt the molten mosaic without turning
  // it into another noise texture. They are static, half-submerged plates.
  buildCrust() {
    const random = seededRandom(this.index + 78900);
    for (const side of [-1, 1]) for (let n = 0; n < 26; n++) {
      const s = this.start + 4 + random() * (CHUNK_LENGTH - 8), { near, far, level } = riftProfile(s, side);
      const d = lerp(near + 6, far - 6, random()), centre = this.at(s, side * d, level + .045);
      if ((this.ground(centre.x, centre.z) ?? Infinity) > level) continue;
      const radius = .35 + random() ** 2 * 2.3, spin = random() * 6.28;
      const ring = Array.from({ length: 5 }, (_, k) => {
        const angle = spin + k * Math.PI * 2 / 5, r = radius * (.6 + random() * .5);
        return { x: centre.x + Math.cos(angle) * r, y: level + .045, z: centre.z + Math.sin(angle) * r * .65 };
      });
      const color = pick(cliffColors, random()).clone().multiplyScalar(.65);
      for (let k = 0; k < ring.length; k++) triangle(this.rock, centre, ring[k], ring[(k + 1) % ring.length], color, 11 + random() * 3);
    }
  }
  buildRocks() {
    const random = seededRandom(this.index + 79200);
    const clear = p => p.y > riftProfile(p.s, Math.sign(p.u)).level + 2 && !this.features.vents.some(v => Math.hypot(v.x - p.x, v.z - p.z) < v.radius * 1.25);
    // Boulders gather in families: one large stone with its rubble around it.
    const family = (s, u, size, solid, rubble = 5) => {
      const p = this.onGround(s, u);
      if (!p || !clear(p) || !this.boulder(p.x, p.y, p.z, size, random, s, solid)) return;
      for (let n = 0, count = 2 + Math.floor(random() * rubble); n < count; n++) {
        const angle = random() * Math.PI * 2, out = size * (.95 + random() * 1.5), q = this.onGround(s + Math.cos(angle) * out, u + Math.sin(angle) * out);
        if (q && Math.abs(q.u) > 9 && clear(q)) this.boulder(q.x, q.y, q.z, Math.max(.3, size * (.14 + random() ** 1.6 * .4)), random, q.s, solid);
      }
    };
    for (const side of [-1, 1]) {
      for (let n = 0; n < 17; n++) {
        const s = this.start + 2 + random() * (CHUNK_LENGTH - 4), { near } = riftProfile(s, side);
        family(s, side * lerp(11, near - 3.5, random() ** .8), 1 + random() ** 1.7 * 3.5, true, 7);
      }
      for (let n = 0; n < 14; n++) {
        const s = this.start + 2 + random() * (CHUNK_LENGTH - 4), p = this.onGround(s, side * lerp(9.5, riftProfile(s, side).near - 2, random()));
        if (p && clear(p)) this.boulder(p.x, p.y, p.z, .28 + random() ** 2 * .4, random, s);
      }
      for (let n = 0; n < 16; n++) {
        const s = this.start + 3 + random() * (CHUNK_LENGTH - 6), { far } = riftProfile(s, side);
        family(s, side * (far + 5 + random() ** 1.7 * 120), 1.4 + random() ** 2 * 4.4, false, 5);
      }
    }
    // A stone or two left standing on the broader blocks.
    for (const top of this.tops) for (let n = 0, count = Math.floor(random() * 2.4); top.reach > 3.5 && n < count; n++) {
      const angle = random() * Math.PI * 2, out = random() * top.reach * .6, size = Math.min(top.reach * .4, .9 + random() * 2.2);
      const p = this.onGround(top.s + Math.cos(angle) * out, top.u + Math.sin(angle) * out, -.1);
      if (p) this.boulder(p.x, p.y, p.z, size, random, top.s);
    }
  }
  // Fallen columns collect in irregular aprons at the foot of each scarp.
  // Leave breathing room between clusters; gravel should explain the landform.
  buildTalus() {
    const random = seededRandom(this.index + 79500);
    for (let n = 0; n < 22; n++) {
      const s = this.start + 5 + random() * (CHUNK_LENGTH - 10), { near } = riftProfile(s, 1);
      const u = shelfSteps(s, 1).toe - 1 + (random() - .5) * 5;
      if (shelfFault(s, u + 7) > .05) continue;
      const p = this.onGround(s, u);
      if (!p || this.features.vents.some(v => Math.hypot(v.x - p.x, v.z - p.z) < v.radius * 1.4)) continue;
      const size = .8 + random() ** 1.6 * 3.8;
      this.boulder(p.x, p.y - .15, p.z, size, random, s, true);
      for (let m = 0; m < 5; m++) {
        const q = this.onGround(s + (random() - .5) * size * 3.5, u - random() * size * 1.7);
        if (q && Math.abs(q.y - p.y) < 4) this.boulder(q.x, q.y, q.z, .28 + random() ** 2 * .95, random, q.s, true);
      }
    }
    // Half-submerged fragments at the far bank make a convincing transition
    // from liquid to solid, with warm faces nearest the molten surface.
    for (const side of [-1, 1]) for (let n = 0; n < 17; n++) {
      const s = this.start + 5 + random() * (CHUNK_LENGTH - 10), { far, level } = riftProfile(s, side);
      const p = this.onGround(s, side * (far - 4.5 - random() * 1.8));
      if (!p || p.y > level + 6) continue;
      this.boulder(p.x, Math.max(p.y, level - .5), p.z, .7 + random() ** 1.6 * 2.7, random, s);
    }
  }
  buildCreekBanks() {
    const random = seededRandom(this.index + 79700);
    for (let n = 0; n < 9; n++) {
      const s = this.start + 7 + random() * (CHUNK_LENGTH - 14), section = creekSection(s);
      const side = random() < .6 ? -1 : 1, size = .65 + random() ** 1.7 * 2.2;
      const u = section.u + side * (section.width * .5 + size * .65 + .4), p = this.onGround(s, u);
      if (!p) continue;
      this.boulder(p.x, p.y - .15, p.z, size, random, s);
      for (let j = 0; j < 3; j++) {
        const q = this.onGround(s + (random() - .5) * size * 4, u + side * random() * size * 1.7);
        if (q && Math.abs(q.y - p.y) < 3) this.boulder(q.x, q.y, q.z, .25 + random() * .6, random, q.s);
      }
    }
  }
  buildTrees() {
    const random = seededRandom(this.index + 79900);
    const count = random() < .35 ? 1 : 0;
    for (let n = 0; n < count; n++) {
      const side = random() < .5 ? -1 : 1, s = this.start + 4 + random() * (CHUNK_LENGTH - 8), { near, far } = riftProfile(s, side);
      const shelf = random() < .6, p = this.onGround(s, side * (shelf ? lerp(12, near - 4, random()) : far + 6 + random() * 70)), size = .8 + random() * .7;
      if (!p || this.features.vents.some(v => Math.hypot(v.x - p.x, v.z - p.z) < v.radius * 1.5) || (shelf && this.clearance(p.x, p.z, s) < 8)) continue;
      matrix.position.set(p.x, p.y - .15, p.z); matrix.rotation.set((random() - .5) * .16, random() * 6.28, (random() - .5) * .16);
      matrix.scale.set(size, size * (.85 + random() * .4), size); matrix.updateMatrix();
      bake(this.rock, treeGeometry, matrix.matrix, snagColor);
      if (shelf) solidPost(this, p.x, p.z, .22 * size);
    }
  }
  buildSmoke() {
    const positions = [], anchors = [], cycles = [], indices = [], source = puffGeometry.attributes.position, faces = puffGeometry.index, puffs = 14;
    for (const vent of this.features.vents) for (let n = 0; n < puffs; n++) {
      const first = positions.length / 3;
      for (let i = 0; i < source.count; i++) {
        positions.push(source.getX(i), source.getY(i), source.getZ(i));
        anchors.push(vent.x, vent.y, vent.z); cycles.push(n / puffs + randomAt(Math.floor(vent.s), 79910), vent.size);
      }
      for (let i = 0; i < faces.count; i++) indices.push(first + faces.getX(i));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('smokeAnchor', new THREE.Float32BufferAttribute(anchors, 3));
    g.setAttribute('smokeCycle', new THREE.Float32BufferAttribute(cycles, 2));
    g.setIndex(new THREE.Uint16BufferAttribute(indices, 1));
    // Include the complete shader motion in the CPU bounds for culling and AO.
    g.boundingBox = new THREE.Box3();
    for (const v of this.features.vents) {
      g.boundingBox.expandByPoint(new THREE.Vector3(v.x - v.size * 12, v.y - v.size * 2, v.z - v.size * 13));
      g.boundingBox.expandByPoint(new THREE.Vector3(v.x + v.size * 17, v.y + v.size * 27, v.z + v.size * 13));
    }
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.addMesh(g, smokeMaterial, 'volcanic-smoke');
  }
  dispose() {
    this.group.removeFromParent(); for (const g of this.owned) g.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class VolcanicWorld {
  constructor(scene, chunkSource = null) {
    this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null;
    this.atmosphere = new VolcanicAtmosphere(scene);
  }
  update(s) {
    this.s = s; this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, Math.floor(s / CHUNK_LENGTH), VolcanicChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
  }
  animate(time) {
    volcanicClock.value = time;
    this.atmosphere.update(time, this.s, this.origin, this.chunks);
  }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.atmosphere.dispose(); }
}
