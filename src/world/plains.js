import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { splitBatch, computeInstanceBounds } from './instance-batches.js';
import { updateResidentChunks, positionResidentChunks } from './resident.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep, lerp, positionAt, roadFrame } from './route.js';
import { PLAINS_STEP, PLAINS_COLUMNS, PLAINS_COLUMN_COUNT, ROAD_RESERVE, plainsVertex, plainsRowStep, plainsPosition, plainsRoadHeight, plainsGroundHeight,
  plainsCreekAt, creekCenterS, creekDistance, CREEK_WATER_HALF_WIDTH, BRIDGE_HALF_LENGTH, fieldAt, fieldRowAt, fieldBoundary, fieldBands,
  rowBoundaryKind, bandBoundaryKind, roadsideFence, farmGate, farmTrackClears, fieldCorner, pondsNear, pondDistance, pondEdge, headlandDistance, plainsNoise } from './plains-route.js';
import { createWaterMaterial, createPondMaterial, animateWater } from './water.js';
import { terrainSampler } from './coastal-assets.js';
import { plainsTrees, baleGeometry, squareBaleGeometry, cowGeometry, rushGeometry, stalkGeometry, wheatGeometry, crowGeometry, crowMaterial } from './plains-assets.js';
import { plainsDiscoveries, plainsDiscoveryClears } from './plains-discoveries.js';
import { plainsDiscoveryAssets, plainsDiscoveryMaterial } from './plains-discovery-assets.js';
import { buildPlainsDiscoveries } from './plains-discovery-scenery.js';
import { PLAINS_RAIL_REACH } from './plains-railway.js';
import { solidModel, solidPost, solidSpan } from './colliders.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });
const terrainMaterial = material('#ffffff', { vertexColors: true });
// Furrows and headlands are drawn in the fragment shader from the per-vertex
// `furrow` attribute (see facetShade). Rows fade to flat colour where they would alias.
const headlandTint = new THREE.Color('#c4ac7d');
terrainMaterial.onBeforeCompile = shader => {
  shader.vertexShader = 'attribute vec3 furrow;\nvarying vec3 vFurrow;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurrow = furrow;');
  shader.fragmentShader = 'varying vec3 vFurrow;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float furrowEdge = min(fwidth(vFurrow.x) * 1.4, 0.5);
    float furrowRidge = smoothstep(0.5 - furrowEdge, 0.5 + furrowEdge, abs(fract(vFurrow.x) - 0.5) * 2.0);
    diffuseColor.rgb *= 1.0 + vFurrow.y * (furrowRidge - 0.5) * 2.0;
    float headland = 1.0 - smoothstep(1.7, 3.4, vFurrow.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${headlandTint.r.toFixed(4)}, ${headlandTint.g.toFixed(4)}, ${headlandTint.b.toFixed(4)}), headland * 0.8);
  `);
};
terrainMaterial.customProgramCacheKey = () => 'plains-fields-v1';
const roadMaterial = material('#6b6a64', { roughness: .95, flatShading: false });
const shoulderMaterial = material('#c9b88f', { flatShading: false });
const edgeMaterial = material('#f0e9d4', { flatShading: false });
const centerMaterial = material('#e6c04a', { flatShading: false });
const dirtMaterial = material('#ffffff', { vertexColors: true, flatShading: false, side: THREE.DoubleSide });
// Flat shaded so the light shows the bank's relief.
const bankMaterial = material('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
const waterMaterial = createWaterMaterial(true);
const pondMaterial = createPondMaterial();
const leavesMaterial = material('#ffffff', { vertexColors: true });
const barkMaterial = material('#6a563f');
const shrubMaterial = material('#ffffff');
const strawMaterial = material('#ffffff', { vertexColors: true });
const timberMaterial = material('#74603f');
const poleMaterial = material('#6e5c45');
const wireMaterial = material('#3f3c36', { flatShading: false });
// Lighter than the wire colour so fences don't read as dark specks from the car.
const railMaterial = material('#7f6946', { flatShading: false });
const metalMaterial = material('#8e948f', { metalness: .15 });
const concreteMaterial = material('#bcb7a8');
// Signs, rails and field stones carry their own instance colours.
const paintedMaterial = material('#ffffff');
const hideMaterial = material('#ffffff', { vertexColors: true });
const rushMaterial = material('#ffffff', { side: THREE.DoubleSide });
// Shading is in vertex colours, multiplied by the instance tint.
// Blades are modelled on both sides, so single sided is enough.
const fringeMaterial = material('#ffffff', { vertexColors: true });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const poleGeometry = new THREE.CylinderGeometry(.85, 1, 1, 6);
const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
registerChunkResources('plains', { terrainMaterial, roadMaterial, shoulderMaterial, edgeMaterial, centerMaterial, dirtMaterial, bankMaterial, waterMaterial, pondMaterial, leavesMaterial,
  barkMaterial, shrubMaterial, strawMaterial, timberMaterial, poleMaterial, wireMaterial, railMaterial, metalMaterial, concreteMaterial, paintedMaterial, hideMaterial, rushMaterial, boxGeometry, poleGeometry, shrubGeometry, plainsTrees, baleGeometry, squareBaleGeometry, cowGeometry, rushGeometry, stalkGeometry, wheatGeometry, fringeMaterial, crowGeometry, crowMaterial });

function geometry(vertices, colors, furrows) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (furrows) g.setAttribute('furrow', new THREE.Float32BufferAttribute(furrows, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function triangle(vertices, colors, a, b, c, color, start, furrows, furrowAt) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    vertices.push(p.x, p.y, p.z + start);
    // Per-point colour keeps a strip's gradient intact through the winding swap.
    if (colors) { const tint = p.color ?? color; colors.push(tint.r, tint.g, tint.b); }
    if (furrows) furrows.push(...furrowAt(p));
  }
}
// Pond cell refinement into ~3.2 m facets. Edge points are always computed the
// same way so two cells sharing an edge share the point.
const cellSteps = (from, to = null) => Math.max(1, Math.round((to === null ? PLAINS_COLUMNS[from + 1] - PLAINS_COLUMNS[from] : (to - from) * PLAINS_STEP) / 3.2));
const edgePoint = (p, q, w) => Object.fromEntries(['x', 'y', 'z', 's', 'u'].map(key => [key, p[key] * (1 - w) + q[key] * w]));
function instances(group, geo, mat, items, name, shadows = true, occlusion = true) {
  if (!items.length) return;
  for (const part of splitBatch(items)) {
    const mesh = new THREE.InstancedMesh(geo, mat, part.length); mesh.name = name;
    if (!occlusion) mesh.userData.ambientOcclusion = false;
    for (let i = 0; i < part.length; i++) {
      const item = part[i]; dummy.position.set(...item.p); dummy.rotation.set(...(item.r ?? [0, 0, 0]));
      if (item.q) dummy.quaternion.copy(item.q);
      dummy.scale.set(...item.scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
    }
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    computeInstanceBounds(mesh); group.add(mesh);
  }
}

// Each field uses one tint throughout so the patchwork reads as distinct fields.
const CROP_PALETTES = {
  wheat: ['#e5b53d', '#eebf46', '#dcaa36'], stubble: ['#dcc272', '#e3c97a', '#d3b866'], ploughed: ['#a8734d', '#b07b53', '#9f6a45'],
  pasture: ['#86b03e', '#8fb844', '#7da739'], hay: ['#cfc25a', '#d6c860', '#c5b852'],
};
// [metres between furrows, trough darkening]. Pasture has no rows.
const FURROWS = { wheat: [2.2, .048], stubble: [3, .055], ploughed: [1.7, .11], pasture: [4, 0], hay: [4.5, .043] };
const NO_FURROW = () => [0, 0, 99];
const gravel = new THREE.Color('#c1b088'), verge = new THREE.Color('#9aad4f'), ditch = new THREE.Color('#7a9a43'), lush = new THREE.Color('#7aa34d'), mud = new THREE.Color('#8a7c58');
// Matches the horizon haze.
const haze = new THREE.Color('#dcb771'), pastureLight = new THREE.Color('#a3b84c');
const dirtBase = new THREE.Color('#c0a778'), dirtRut = new THREE.Color('#a3885e'), dirtCrown = new THREE.Color('#cdb98d'), dirtEdge = new THREE.Color('#c6b082');
// Same as the shoulder so a track mouth has no visible join.
const dirtApron = new THREE.Color('#c9b88f');
const yardCore = new THREE.Color('#967650'), yardBase = new THREE.Color('#ad8a60'), yardDust = new THREE.Color('#c1a679');
// Don't go darker: deeper greens turn black on the shaded side, worst on phones.
const CONIFER_GREENS = ['#4c7c3e', '#427037', '#558544'], CYPRESS_GREENS = ['#457a3c', '#4c8042', '#3f7137'];
// Crop colour before haze, furrows and wet ground. Shared by terrain shading
// and by yards fading into the surrounding field.
function cropColor(s, u) {
  const field = fieldAt(s, u) ?? fieldAt(s, Math.sign(u) * (ROAD_RESERVE + 1)), palette = CROP_PALETTES[field.kind];
  const color = new THREE.Color(palette[Math.floor(randomAt(field.seed, field.salt + 5) * palette.length)]);
  const growth = plainsNoise(s + 23, u, 64, 2807);
  if (field.kind === 'pasture') color.lerp(pastureLight, smoothstep(-.6, .7, growth) * .42);
  else color.multiplyScalar(1 + growth * .045);
  return { field, color };
}
const GRASS_TINTS = { pasture: ['#8fae48', '#9db84f'], verge: ['#9bab4c', '#8da144'] };
const WHEAT_TINTS = ['#d9a93a', '#e3b545', '#d2a235'];

export class PlainsChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.group.name = `plains-chunk-${index}`; this.owned = [];
    this.features = { discoveries: [] };
    // Rail approaches and turbine rows continue through neighboring chunks.
    this.discoveries = plainsDiscoveries(this.start - PLAINS_RAIL_REACH - 12, this.start + CHUNK_LENGTH + PLAINS_RAIL_REACH + 12);
    this.scenery = { posts: [], wires: [], rails: [], railwayRails: [], railwaySleepers: [], poles: [], shrubs: [], bales: [], squareBales: [], boxes: [], painted: [], cows: [], rushes: [], grass: [], wheat: [], dirtTints: [], shores: [], shoreTints: [], farLumps: [], concrete: [], sheds: [], tanks: [], bark: new Map(), leaves: new Map(), dirt: [] };
    this.buildTerrain(); this.buildRoad(); this.buildCreek(); this.buildScenery();
    buildPlainsDiscoveries(this, this.discoveries);
    this.finishScenery();
    finalizeChunkTransforms(this.group);
  }
  addMesh(g, mat, name, shadows = false) {
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(g); return mesh;
  }
  // Samples the rendered facets so scenery matches them at seams. Falls back to
  // the analytic height outside this chunk, e.g. a wire's far pole.
  ground(s, u) {
    const p = positionAt(s, u, 0);
    return { x: p.x, y: this.sampleGround(p.x, p.z + this.start) ?? plainsGroundHeight(s, u), z: p.z + this.start };
  }
  buildTerrain() {
    const vertices = [], colors = [], furrows = [], cache = new Map();
    const vertex = (row, col) => {
      const key = `${row},${col}`;
      if (!cache.has(key)) cache.set(key, plainsVertex(row, col));
      return cache.get(key);
    };
    // Field facets are as wide as a pond, so cells near one are refined to follow
    // the basin. Decided from the cell's own corners so neighbours agree.
    const ponds = pondsNear(this.start + CHUNK_LENGTH / 2);
    const underPond = (row, col) => {
      if (!ponds.length || col < 1 || col >= PLAINS_COLUMN_COUNT - 1) return null;
      const corners = [vertex(row, col), vertex(row + plainsRowStep(row), col), vertex(row, col + 1), vertex(row + plainsRowStep(row), col + 1)];
      const lowS = Math.min(...corners.map(p => p.s)), highS = Math.max(...corners.map(p => p.s));
      const lowU = Math.min(...corners.map(p => p.u)), highU = Math.max(...corners.map(p => p.u));
      for (const pond of ponds) {
        const reach = pond.radius * Math.sqrt(pond.stretch) * 1.17 * 1.5;
        const ds = Math.max(lowS - pond.s, pond.s - highS, 0), du = Math.max(lowU - pond.u, pond.u - highU, 0);
        if (Math.hypot(ds, du) < reach) return pond;
      }
      return null;
    };
    for (let row = this.start / PLAINS_STEP; row < (this.start + CHUNK_LENGTH) / PLAINS_STEP; row += plainsRowStep(row)) {
      const next = row + plainsRowStep(row);
      for (let col = 0; col < PLAINS_COLUMN_COUNT - 1; col++) {
        const a = vertex(row, col), b = vertex(next, col), c = vertex(row, col + 1), d = vertex(next, col + 1);
        if (underPond(row, col)) { this.refineCell(a, b, c, d, row, col, next, underPond, vertices, colors, furrows); continue; }
        // Beside a refined cell, take its edge points into this outline so every
        // vertex is shared. T-junctions on the straight edge still sparkle.
        const previous = plainsRowStep(row - 1) === 1 ? row - 1 : row - .5;
        const split = { low: !!underPond(previous, col), high: !!underPond(next, col), left: !!underPond(row, col - 1), right: !!underPond(row, col + 1) };
        if (split.low || split.high || split.left || split.right) { this.stitchCell(a, b, c, d, row, col, next, split, vertices, colors, furrows); continue; }
        // Diagonals are hashed in the fields. The reserve isn't jittered, so it uses
        // one diagonal throughout to avoid herringbone and keep the verge smooth.
        const reserve = Math.abs(PLAINS_COLUMNS[col] + PLAINS_COLUMNS[col + 1]) / 2 < ROAD_RESERVE;
        const tris = reserve || randomAt(Math.round(row * 2), col + 2805) > .5 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
        tris.forEach((tri, i) => {
          const shade = this.facetShade(tri, row, col, i);
          triangle(vertices, colors, ...tri, shade.color, this.start, furrows, shade.furrow);
        });
      }
    }
    this.terrain = this.addMesh(geometry(vertices, colors, furrows), terrainMaterial, 'plains-fields', true);
    this.sampleGround = terrainSampler(this.terrain);
  }
  // Coarse cell beside a refined one, fanned from its middle.
  stitchCell(a, b, c, d, row, col, next, split, vertices, colors, furrows) {
    const along = cellSteps(row, next), across = cellSteps(col), outline = [];
    const edge = (p, q, n, cut) => { for (let k = 0; k < n; k++) outline.push(cut ? edgePoint(p, q, k / n) : k ? null : p); };
    edge(a, c, across, split.low); edge(c, d, along, split.right); edge(d, b, across, split.high); edge(b, a, along, split.left);
    const ring = outline.filter(Boolean);
    const middle = Object.fromEntries(['x', 'y', 'z', 's', 'u'].map(key => [key, (a[key] + b[key] + c[key] + d[key]) / 4]));
    const shade = this.facetShade([a, b, d], row, col, 0);
    for (let k = 0; k < ring.length; k++) triangle(vertices, colors, ring[k], ring[(k + 1) % ring.length], middle, shade.color, this.start, furrows, shade.furrow);
  }
  // Interior points take the true ground height. Points on an edge shared with
  // an unrefined cell stay on its straight edge so there is no crack.
  refineCell(a, b, c, d, row, col, next, underPond, vertices, colors, furrows) {
    const along = cellSteps(row, next), across = cellSteps(col);
    const previous = plainsRowStep(row - 1) === 1 ? row - 1 : row - .5;
    const straight = { low: !underPond(previous, col), high: !underPond(next, col), left: !underPond(row, col - 1), right: !underPond(row, col + 1) };
    const grid = [];
    for (let i = 0; i <= along; i++) {
      grid.push([]);
      for (let j = 0; j <= across; j++) {
        const t = i / along, w = j / across;
        // Same corners and arithmetic as the neighbour, so shared edge points match exactly.
        const p = i === 0 ? edgePoint(a, c, w) : i === along ? edgePoint(b, d, w) : j === 0 ? edgePoint(a, b, t) : j === across ? edgePoint(c, d, t)
          : Object.fromEntries(['x', 'y', 'z', 's', 'u'].map(key => [key, (a[key] * (1 - t) + b[key] * t) * (1 - w) + (c[key] * (1 - t) + d[key] * t) * w]));
        const corner = (i === 0 || i === along) && (j === 0 || j === across);
        const onEdge = (i === 0 && straight.low) || (i === along && straight.high) || (j === 0 && straight.left) || (j === across && straight.right);
        if (!corner && !onEdge) p.y = plainsGroundHeight(p.s, p.u);
        grid[i].push(p);
      }
    }
    // One colour per cell, sampled like the coarse facet. Shading each small facet
    // makes a sawtooth along field boundaries.
    const shade = this.facetShade([a, b, d], row, col, 0);
    for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i][j + 1], d = grid[i + 1][j + 1], k = i * across + j;
      const tris = randomAt(Math.round(row * 2) * 8 + k, col + 2806) > .5 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
      for (const tri of tris) triangle(vertices, colors, ...tri, shade.color, this.start, furrows, shade.furrow);
    }
  }
  // Returns the facet colour and a per-vertex furrow function giving
  // [cross-row coordinate in furrow widths, row depth, distance to fenced boundary].
  facetShade(tri, row, col, i) {
    const s = tri.reduce((sum, p) => sum + p.s, 0) / 3, u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
    const facet = randomAt(Math.round(row * 2) * 2 + i, col + 2801);
    const d = creekDistance(s, u);
    // Reserve cells are shaded as a whole. Per-triangle centroids zigzag the ditch gradient.
    const cellCross = Math.abs(PLAINS_COLUMNS[col] + PLAINS_COLUMNS[col + 1]) / 2;
    const inReserve = cellCross < ROAD_RESERVE;
    const cross = inReserve ? cellCross : Math.abs(u);
    let color, furrow = NO_FURROW;
    if (cross < 7.2) color = gravel.clone();
    else if (cross < 8.6) color = gravel.clone().lerp(verge, .5);
    else if (inReserve) {
      // Verge and ditch. Variation runs along the road so the strip doesn't pattern.
      color = verge.clone().lerp(ditch, 1 - smoothstep(0, 2.4, Math.abs(cross - 10.8)));
      color.multiplyScalar(.98 + .04 * (.5 + .5 * Math.sin(s / 23 + col)));
    }
    else {
      const crop = cropColor(s, u), field = crop.field;
      color = crop.color;
      color.lerp(haze, smoothstep(280, 430, cross) * .7);
      // Rows start at the field edge and fade near water and into the haze.
      const [period, depth] = FURROWS[field.kind];
      const dry = smoothstep(6.5, 11, d) * (1 - smoothstep(280, 430, cross));
      // Faded per vertex near ponds; per-facet depth steps in a sawtooth.
      const damp = cross > 16 && cross < 180 ? p => smoothstep(1.25, 1.7, pondDistance(p.s, p.u).d) : () => 1;
      const along = field.rows !== 'across';
      const bow = (randomAt(field.seed, field.salt + 23) - .5) * 3.2;
      const strength = .8 + randomAt(field.seed, field.salt + 24) * .3;
      furrow = p => {
        const run = along ? (p.s - field.start) / (field.end - field.start) : (Math.abs(p.u) - field.from) / (field.to - field.from);
        const across = along ? Math.abs(p.u) - field.from : p.s - field.start;
        return [(across + bow * Math.sin(run * Math.PI)) / period, depth * strength * dry * damp(p), headlandDistance(p.s, p.u, field)];
      };
    }
    // Wet meadow near water, mud under it.
    if (d < 9.5) color.lerp(lush, (1 - smoothstep(6, 9.5, d)) * .85);
    if (d < 5.4) color.lerp(mud, 1 - smoothstep(4.6, 5.4, d));
    return { color: color.multiplyScalar(inReserve ? 1 : .985 + facet * .03), furrow };
  }
  ribbon(ranges, lift, mat, name, skip = null) {
    const vertices = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      if (skip?.(s)) continue;
      const at = (t, u) => plainsPosition(t, u, plainsRoadHeight(t) + lift);
      const a = at(s, low), b = at(s + 2, low), c = at(s, high), d = at(s + 2, high);
      triangle(vertices, null, a, b, c, null, this.start); triangle(vertices, null, b, d, c, null, this.start);
    }
    this.addMesh(geometry(vertices), mat, name);
  }
  buildRoad() {
    this.ribbon([[-6.9, 6.9]], .045, shoulderMaterial, 'gravel-shoulders');
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial, 'plains-road');
    this.ribbon([[-5.05, -4.89], [4.89, 5.05]], .09, edgeMaterial, 'road-edges');
    // 4 m dashes, 4 m gaps, phased from the chunk seam so the pattern continues across chunks.
    this.ribbon([[-.15, .15]], .093, centerMaterial, 'center-lines', s => Math.floor(s / 2) % 4 >= 2);
  }
  // Dirt track from the shoulder out across the field, flared at the road.
  // A plain track tapers out. With `into` it widens at the far end and returns
  // the two end corners so a yard can open onto them.
  track(s, side, toCross, fromCross = 5.8, into = false) {
    if (toCross <= fromCross + 4) return null;
    const salt = Math.round(s * 4) + (side > 0 ? 3301 : 3302), step = 2.5;
    // Wander is eased between waypoints so the track curves instead of kinking.
    const drift = cross => {
      const t = cross / 13, cell = Math.floor(t), f = t - cell;
      const wander = lerp(randomAt(cell, salt) - .5, randomAt(cell + 1, salt) - .5, f * f * (3 - 2 * f));
      return wander * 2.8 * smoothstep(fromCross + 4, fromCross + 30, cross);
    };
    const half = cross => (1.5 + .3 * Math.sin(cross / 8 + salt))
      * (1 + 1.2 * (1 - smoothstep(fromCross, fromCross + 8, cross)))
      * (into ? 1 + .3 * smoothstep(toCross - 8, toCross, cross) : 1 - .35 * smoothstep(toCross - 9, toCross, cross));
    // Edge, rut, crown, crown, rut, edge. Ruts fade out at the mouth and into a yard.
    const across = [-1, -.6, -.28, .28, .6, 1], tints = [dirtEdge, dirtRut, dirtCrown, dirtCrown, dirtRut, dirtEdge];
    const tintAt = (tint, cross) => tint.clone().lerp(dirtApron, 1 - smoothstep(fromCross + 1, fromCross + 7, cross))
      .lerp(yardDust, into ? smoothstep(toCross - 7, toCross, cross) : 0);
    for (let cross = fromCross; cross < toCross - .01; cross += step) {
      const next = Math.min(cross + step, toCross);
      const w0 = half(cross), w1 = half(next), c0 = drift(cross), c1 = drift(next);
      for (let i = 0; i < across.length - 1; i++) {
        this.dirtQuad([[s + c0 + across[i] * w0, side * cross], [s + c0 + across[i + 1] * w0, side * cross],
          [s + c1 + across[i] * w1, side * next], [s + c1 + across[i + 1] * w1, side * next]],
          [tintAt(tints[i], cross), tintAt(tints[i + 1], cross), tintAt(tints[i], next), tintAt(tints[i + 1], next)]);
      }
    }
    const end = half(toCross), middle = s + drift(toCross);
    return [[middle - end, side * toCross], [middle + end, side * toCross]];
  }
  // Farmyard earth: a rounded oblong with a wandering radius. The outer ring
  // takes the surrounding crop colour so there is no hard edge.
  dirtPatch(s, u, halfS, halfU, mouth = null, salt = Math.abs(Math.round(s * 2)) + 2861) {
    const steps = 26, rings = [.26, .6, .82, .93, 1];
    // Wraps at `lobes` so the outline closes.
    const wander = (k, lobes, phase) => {
      const t = k / steps * lobes, cell = Math.floor(t), f = t - cell;
      return lerp(randomAt(cell % lobes, salt + phase), randomAt((cell + 1) % lobes, salt + phase), f * f * (3 - 2 * f));
    };
    const rim = [];
    for (let k = 0; k < steps; k++) {
      const angle = k / steps * Math.PI * 2, c = Math.cos(angle), n = Math.sin(angle);
      // Superellipse: an oblong with rounded corners.
      const box = Math.pow(Math.abs(c) ** 3.4 + Math.abs(n) ** 3.4, -1 / 3.4);
      // Long lobes plus a shorter wander so no stretch of edge runs straight.
      const r = box * (.79 + .16 * wander(k, 6, 0) + .07 * wander(k, 13, 91));
      rim.push([c * r * halfS, n * r * halfU]);
    }
    // Move the two rim steps bracketing the drive onto its end corners so the
    // yard opens straight into it with no strip of crop between.
    const opening = new Set();
    if (mouth) {
      const bearing = ([ms, mu]) => Math.atan2((mu - u) / halfU, (ms - s) / halfS);
      const centre = bearing([(mouth[0][0] + mouth[1][0]) / 2, (mouth[0][1] + mouth[1][1]) / 2]);
      const turn = point => { const d = bearing(point) - centre; return Math.atan2(Math.sin(d), Math.cos(d)); };
      const corners = [...mouth].sort((a, b) => turn(a) - turn(b));
      const first = Math.floor(centre / (Math.PI * 2) * steps);
      for (const [step, corner] of corners.entries()) {
        const k = ((first + step) % steps + steps) % steps;
        // Exactly on the drive's end. Short of it leaves crop in the gateway;
        // past it overlaps the drive at the same height and z-fights.
        rim[k] = [corner[0] - s, corner[1] - u]; opening.add(k);
      }
    }
    const worn = (k, t) => yardCore.clone().lerp(yardBase, smoothstep(0, .5, t)).lerp(yardDust, smoothstep(.76, 1, t))
      .multiplyScalar(.97 + .06 * randomAt(k, salt + Math.round(t * 20)));
    const { dirt, dirtTints } = this.scenery;
    const face = (a, b, c) => triangle(dirt, dirtTints, a, b, c, dirtBase, this.start);
    const at = (k, t) => {
      const ds = rim[k][0] * t, du = rim[k][1] * t;
      // Outer ring is mostly crop colour. At the mouth it matches the drive's
      // end dust so the seam can't be seen.
      const rimColor = () => opening.has(k) ? yardDust.clone() : cropColor(s + ds, u + du).color.lerp(yardDust, .4);
      return this.dirtPoint(s + ds, u + du, t < 1 ? worn(k, t) : rimColor());
    };
    let inner = rim.map((_, k) => at(k, rings[0]));
    const middle = this.dirtPoint(s, u, worn(0, 0));
    for (let k = 0; k < steps; k++) face(middle, inner[k], inner[(k + 1) % steps]);
    for (let i = 1; i < rings.length; i++) {
      const outer = rim.map((_, k) => at(k, rings[i]));
      for (let k = 0; k < steps; k++) {
        const j = (k + 1) % steps;
        face(inner[k], inner[j], outer[k]); face(inner[j], outer[j], outer[k]);
      }
      inner = outer;
    }
  }
  dirtPoint(s, u, color) {
    const p = this.ground(s, u);
    return { x: p.x, y: p.y + .07, z: p.z - this.start, color };
  }
  dirtQuad(corners, shades = null) {
    const [a, b, c, d] = corners.map(([s, u], i) => this.dirtPoint(s, u, shades ? shades[i] : dirtBase));
    const { dirt, dirtTints } = this.scenery;
    triangle(dirt, dirtTints, a, b, c, dirtBase, this.start); triangle(dirt, dirtTints, b, d, c, dirtBase, this.start);
  }
  buildCreek() {
    const creek = plainsCreekAt(this.start + CHUNK_LENGTH / 2);
    if (Math.abs(creek.center - this.start - CHUNK_LENGTH / 2) > CHUNK_LENGTH / 2 + 150) return;
    // Close to the pond colours; a grey-green creek read as a ditch.
    const vertices = [], colors = [], shallow = new THREE.Color('#6a9cb0'), deep = new THREE.Color('#487a94');
    // Each quad belongs to the chunk its middle falls in, so neighbours don't overlap.
    for (let u = -400; u < 568; u += 4) {
      const s0 = creekCenterS(creek, u), s1 = creekCenterS(creek, u + 4), middle = (s0 + s1) / 2;
      if (middle < this.start || middle >= this.start + CHUNK_LENGTH) continue;
      const w = CREEK_WATER_HALF_WIDTH;
      const at = (s, v) => plainsPosition(s, v, creek.level);
      const a = at(s0 - w, u), b = at(s0 + w, u), c = at(s1 - w, u + 4), d = at(s1 + w, u + 4);
      const color = shallow.clone().lerp(deep, .35 + .35 * Math.sin(u / 23 + creek.index)).multiplyScalar(.95 + randomAt(Math.round(u), creek.index + 2811) * .1);
      triangle(vertices, colors, a, b, c, color, this.start); triangle(vertices, colors, b, d, c, color, this.start);
    }
    if (vertices.length) {
      const water = this.addMesh(geometry(vertices, colors), waterMaterial, 'creek-water');
      water.geometry.boundingSphere.radius += .5;
    }
    // Deck follows the road's 2 m samples. Flat boxes cut through on slopes.
    const { concrete } = this.scenery, inChunk = s => s >= this.start && s < this.start + CHUNK_LENGTH;
    const road = plainsRoadHeight, across = s => -roadFrame(s).angle;
    const point = (s, u, y) => { const p = plainsPosition(s, u, y); return [p.x, p.y, p.z + this.start]; };
    const deck = [];
    const deckPoint = (s, u, lift) => plainsPosition(s, u, road(s) + lift);
    const face = (a, b, c, d) => {
      for (const p of [a, b, c, b, d, c]) deck.push(p.x, p.y, p.z + this.start);
    };
    for (let s = Math.max(this.start, creek.start); s < Math.min(this.start + CHUNK_LENGTH, creek.end); s += 2) {
      const end = Math.min(s + 2, creek.end, this.start + CHUNK_LENGTH);
      const a = deckPoint(s, -7.3, -.15), b = deckPoint(end, -7.3, -.15);
      const c = deckPoint(s, 7.3, -.15), d = deckPoint(end, 7.3, -.15);
      const e = deckPoint(s, -7.3, -1.05), f = deckPoint(end, -7.3, -1.05);
      const g = deckPoint(s, 7.3, -1.05), h = deckPoint(end, 7.3, -1.05);
      face(a, c, b, d); face(e, f, g, h);
      face(a, b, e, f); face(c, g, d, h);
      if (s === creek.start) face(a, e, c, g);
      if (end === creek.end) face(b, d, f, h);
    }
    if (deck.length) this.addMesh(geometry(deck), concreteMaterial, 'creek-bridge-deck', true);
    for (let k = 0; k < 4; k++) {
      const s = creek.center - BRIDGE_HALF_LENGTH + 3.5 + k * 7;
      if (!inChunk(s)) continue;
      for (const side of [-1, 1]) {
        concrete.push({ p: point(s, side * 6.55, road(s) + .55), scale: [.36, 1.02, 7.05], r: [0, across(s), 0], color: '#cbc6b7' });
      }
    }
    for (const s of [creek.start, creek.end]) {
      if (!inChunk(s)) continue;
      const low = Math.min(...[-7.5, 0, 7.5].map(u => plainsGroundHeight(s, u))) - .5;
      concrete.push({ p: point(s, 0, (road(s) - .1 + low) / 2), scale: [15.4, road(s) - .1 - low, 2.2], r: [0, across(s), 0] });
      for (const side of [-1, 1]) concrete.push({ p: point(s, side * 6.55, road(s) + .7), scale: [.55, 1.32, .55], r: [0, across(s), 0], color: '#cbc6b7' });
    }
    for (const k of [-1, 1]) {
      const s = creek.center + k * 5.5;
      if (!inChunk(s)) continue;
      const floor = plainsGroundHeight(s, 0) - .6;
      concrete.push({ p: point(s, 0, (road(s) - .9 + floor) / 2), scale: [12.6, road(s) - .9 - floor, 1.3], r: [0, across(s), 0] });
    }
  }
  buildScenery() {
    const random = seededRandom(this.index + 27113), { posts, wires, poles, shrubs, bales, squareBales, boxes } = this.scenery;
    const hedgeGreens = ['#46722f', '#4f7a35', '#3d672b', '#557f3a'], strawTints = ['#d9b566', '#d1ab5c', '#dfbc6d'];
    const cypressGreens = CYPRESS_GREENS;
    const oakGreens = ['#587f3a', '#4d7434', '#65883f', '#43682e'], poplarGreens = ['#5f8a3b', '#6a9542', '#547d34'], willowGreens = ['#7f9c4a', '#8aa552', '#73923f'];
    // Boundary belts get the widest spread so they don't read as one flat mass.
    const lineGreens = ['#5d8a39', '#6b9942', '#4f7c32', '#76a54a', '#598136', '#6fa03f'];
    const coniferGreens = CONIFER_GREENS;
    const clear = (s, u, r = 1) => this.clearAt(s, u, r);
    const stone = ['#a9a496', '#9b9789', '#b5b0a3', '#8f8b80'];
    const inChunk = s => s >= this.start && s < this.start + CHUNK_LENGTH;
    // Edge rows are jittered, so a point on the seam may have no facet under it.
    const inside = s => s >= this.start + 2 && s < this.start + CHUNK_LENGTH - 2;
    const beam = (list, a, b, width, color) => this.beam(list, a, b, width, color);
    const fence = points => this.fence(points);
    const hedge = points => {
      for (const point of points) {
        if (point.own === false || !clear(point.s, point.u, 1)) continue;
        const p = this.ground(point.s + (random() - .5) * .5, point.u + (random() - .5) * .5), size = 1.5 + random() * .8;
        shrubs.push({ p: [p.x, p.y + size * .28, p.z], scale: [size, size * .82, size * 1.05], r: [0, random() * 6.28, 0], color: hedgeGreens[Math.floor(random() * hedgeGreens.length)] });
      }
    };
    const treeLine = (points, near) => {
      let sinceTree = 99;
      for (const point of points) {
        if (point.own === false || !clear(point.s, point.u, 1)) continue;
        const jitter = (random() - .5) * 3.2;
        const s = point.s + jitter, u = point.u + (random() - .5) * 3.6;
        sinceTree += 1;
        const opening = plainsNoise(s, u, 28, 2881) < -.38;
        if (!opening && sinceTree >= 2 && random() < .78 && inside(s) && clear(s, u, 2.5)) {
          sinceTree = 0;
          const tall = near ? 5.8 : 7;
          const height = tall + random() * (near ? 4.5 : 6);
          this.mixedTree(s, u, height, random, { conifer: .14, cypress: .1, oak: .12 });
          continue;
        }
        if (random() > .5) continue;
        const p = this.ground(s, u), size = 1.4 + random() * .9;
        shrubs.push({ p: [p.x, p.y + size * .26, p.z], scale: [size, size * .8, size * 1.05], r: [0, random() * 6.28, 0], color: hedgeGreens[Math.floor(random() * hedgeGreens.length)] });
      }
    };
    // Posts sit on a lattice offset from the jittered seam rows, plus one point past
    // the end to carry the wire over. Anchors (corners, gate posts) replace any
    // lattice post too close to them.
    const along = (u, s0, s1, step, skip, end = Infinity, anchors = []) => {
      const stops = [];
      for (let s = Math.ceil((s0 - 2) / step) * step + 2; s <= s1 + step && s < end; s += step) {
        if (!skip || Math.abs(s - skip) > 3.6) stops.push({ s });
      }
      for (const anchor of anchors) if (anchor.s >= s0 - .01 && anchor.s <= s1 + .01) stops.push(anchor);
      stops.sort((a, b) => a.s - b.s);
      const points = [];
      for (const stop of stops) {
        const last = points.at(-1);
        if (last && stop.s - last.s < step * .5) {
          if (!stop.anchor) continue;
          points.pop();
        }
        points.push({ ...stop, u, own: stop.s <= s1 });
      }
      return points;
    };
    // Lands exactly on the reserve edge, each band boundary and the far end so
    // cross fences meet the along-road lines at their corners.
    const acrossPoints = (s, side, from, to, step, anchors = []) => {
      const stops = [from, ...anchors.filter(u => u > from + step * .5 && u < to - step * .5), to];
      const points = [];
      for (let i = 0; i < stops.length - 1; i++) {
        const span = stops[i + 1] - stops[i], count = Math.max(1, Math.round(span / step));
        for (let k = 0; k < count; k++) points.push({ s, u: side * (stops[i] + span * k / count) });
      }
      points.push({ s, u: side * stops.at(-1) });
      return points;
    };
    const bushLine = (points, axis) => {
      for (const point of points) {
        if (point.own === false || random() > .28 || !clear(point.s, point.u, .6)) continue;
        const d = (random() < .5 ? -1 : 1) * (.9 + random() * .6);
        const p = this.ground(point.s + (axis === 's' ? d : (random() - .5) * 1.4), point.u + (axis === 'u' ? d : (random() - .5) * 1.4)), size = .8 + random() * .8;
        shrubs.push({ p: [p.x, p.y + size * .26, p.z], scale: [size, size * .72, size * 1.05], r: [0, random() * 6.28, 0], color: hedgeGreens[Math.floor(random() * hedgeGreens.length)] });
      }
    };
    // Tufts either side of a boundary: grass up to the line, wheat back past the
    // headland. Near the road only.
    const fringe = (points, axis) => {
      for (const point of points) {
        if (Math.abs(point.u) > 170) continue;
        for (const k of [-1, 1]) {
          if (random() > .55) continue;
          const probeS = point.s + (axis === 's' ? k * 3.5 : 0), probeU = point.u + (axis === 'u' ? k * 3.5 : 0);
          const kind = Math.abs(probeU) < ROAD_RESERVE ? 'verge' : fieldAt(probeS, probeU)?.kind;
          if (kind !== 'pasture' && kind !== 'wheat' && kind !== 'verge') continue;
          const d = k * (kind === 'wheat' ? 2.6 + random() * 2.4 : 1.1 + random() * 2.2), jitter = (random() - .5) * 2.2;
          this.tuft(point.s + (axis === 's' ? d : jitter), point.u + (axis === 'u' ? d : jitter), kind, random);
        }
      }
    };
    for (let row = fieldRowAt(this.start) - 1; fieldBoundary(row) < this.start + CHUNK_LENGTH; row++) {
      const rowStart = fieldBoundary(row), rowEnd = fieldBoundary(row + 1);
      // Run on to the cross lines at both ends of the row so they meet at a corner.
      const s0 = Math.max(rowStart + 2.2, this.start), s1 = Math.min(rowEnd + 2.2, this.start + CHUNK_LENGTH - .01);
      for (const side of [-1, 1]) {
        const bands = fieldBands(row, side), gate = farmGate(row, side);
        // A cross fence owns the corner post; otherwise this line places it.
        const corners = [[rowStart + 2.2, rowBoundaryKind(row, side)], [rowEnd + 2.2, rowBoundaryKind(row + 1, side)]]
          .map(([s, kind]) => ({ s, anchor: true, post: kind === 'fence' ? false : undefined }));
        // The gate brings its own posts; fence rails stop at them.
        const gateSide = gate ? [{ s: gate.s - 2.4, anchor: true, post: false, stop: true }, { s: gate.s + 2.4, anchor: true, post: false }] : [];
        if (s0 < s1) {
          if (roadsideFence(row, side)) fence(along(side * ROAD_RESERVE, s0, s1, 4, gate?.s, rowEnd + 2.3, [...corners, ...gateSide]));
          fringe(along(side * ROAD_RESERVE + side * 1.4, s0, s1, 2.6), 'u');
          for (let band = 1; band <= 3; band++) {
            const kind = bandBoundaryKind(row, side, band);
            fringe(along(side * bands[band], s0, s1, 2.6), 'u');
            if (kind === 'fence') {
              fence(along(side * bands[band], s0, s1, 4, null, rowEnd + 2.3, corners));
              bushLine(along(side * bands[band], s0, s1, 4), 'u');
              if (randomAt(row * 4 + band, side > 0 ? 2793 : 2794) < .5) treeLine(along(side * (bands[band] + 2.4), s0, s1, 8), side < 0);
            } else if (kind === 'hedge') hedge(along(side * bands[band], s0, s1, 1.7));
            else if (kind === 'treeline') treeLine(along(side * bands[band], s0, s1, 4.5), side < 0);
          }
        }
        if (gate && inChunk(gate.s)) {
          // Only worn gates get a track; every gate gets a mailbox.
          // Check the shed's ground before drawing a drive to it. A drive that
          // opens onto nothing looks worse than a plain track.
          const shedU = side * gate.reach;
          let trackClear = true;
          for (let cross = 10; cross <= gate.reach; cross += 2) {
            if (!this.clearAt(gate.s, side * cross, 3, true)) { trackClear = false; break; }
          }
          const standing = gate.worn && trackClear && gate.shed && inside(gate.s) && this.clearAt(gate.s, shedU, 10, true)
            && this.levelGround(gate.s, shedU, 5, 2.4);
          if (standing) this.outbuilding(gate.s, shedU, random, this.track(gate.s, side, gate.reach - 8.5, 5.8, true));
          else if (gate.worn && trackClear) this.track(gate.s, side, gate.reach);
          // Mailbox goes on whichever side of the gate is in this chunk.
          const boxS = inChunk(gate.s - 4.5) ? gate.s - 4.5 : gate.s + 4.5;
          const p = this.ground(boxS, side * 7.4), angle = -roadFrame(gate.s).angle;
          posts.push({ p: [p.x, p.y + .5, p.z], scale: [.09, 1.05, .09], r: [0, angle, 0] });
          boxes.push({ p: [p.x, p.y + 1.15, p.z], scale: [.3, .3, .52], r: [0, angle, 0], color: '#9aa09a' });
        }
        for (let band = 0; band < 4; band++) {
          const field = fieldAt(rowStart + 1, side * (bands[band] + .5)), from = bands[band], to = bands[band + 1];
          if (field.kind === 'hay' || field.kind === 'wheat' || field.kind === 'stubble') {
            // Bales line up along the swath: round on hay and wheat, stacked squares on stubble.
            const square = field.kind === 'stubble', skip = field.kind === 'hay' ? .3 : square ? .45 : .66;
            for (let s = rowStart + 12; s < rowEnd - 8; s += 23) for (let cross = from + 9; cross < to - 8; cross += 17) {
              const lane = randomAt(Math.round(cross), field.seed + 2826) - .5;
              const t = s + (randomAt(Math.round(s), Math.round(cross) + 2821) - .5) * 3, v = side * (cross + lane * 5);
              if (!inChunk(t) || randomAt(Math.round(s), Math.round(cross) + 2823) < skip || !clear(t, v, 1.4)) continue;
              const p = this.ground(t, v), yaw = -roadFrame(t).angle + (randomAt(Math.round(s), Math.round(cross) + 2824) - .5) * .5;
              const color = strawTints[Math.floor(randomAt(Math.round(s), Math.round(cross) + 2825) * 3)];
              for (let k = 0; k < 2; k++) this.tuft(t + (random() - .5) * 4.5, v + (random() - .5) * 4.5, field.kind, random);
              solidModel(this, square ? squareBaleGeometry : baleGeometry, [p.x, p.y, p.z], yaw, square ? 1 : 1.2);
              if (!square) { bales.push({ p: [p.x, p.y + .85, p.z], scale: [1.2, 1.2, 1.2], r: [0, yaw, 0], color }); continue; }
              const stack = 1 + Math.floor(randomAt(Math.round(s), Math.round(cross) + 2827) * 2.6);
              for (let k = 0; k < stack; k++) squareBales.push({ p: [p.x, p.y + .4 + k * .8, p.z], scale: [1, 1, 1], r: [0, yaw + (k % 2) * .12, 0], color });
            }
          }
          if ((field.kind === 'pasture' || field.kind === 'hay') && randomAt(field.seed, field.salt + 7) < .55) {
            const t = rowStart + 14 + randomAt(field.seed, field.salt + 8) * (rowEnd - rowStart - 28);
            const v = side * (from + 12 + randomAt(field.seed, field.salt + 9) * Math.max(4, to - from - 24));
            if (inChunk(t) && clear(t, v, 4)) this.tree('oak', t, v, 9 + randomAt(field.seed, field.salt + 10) * 5, oakGreens[((field.seed % oakGreens.length) + oakGreens.length) % oakGreens.length], random() * 6.28);
          }
          if (field.kind === 'pasture' && randomAt(field.seed, field.salt + 17) < .7) {
            const herdS = rowStart + 16 + randomAt(field.seed, field.salt + 18) * Math.max(4, rowEnd - rowStart - 32);
            const herdU = side * (from + 12 + randomAt(field.seed, field.salt + 19) * Math.max(4, to - from - 24)), heading = randomAt(field.seed, field.salt + 20) * 6.28;
            for (let i = 0, count = 4 + Math.floor(randomAt(field.seed, field.salt + 21) * 5); i < count; i++) {
              const t = herdS + (random() - .5) * 20, v = herdU + (random() - .5) * 14;
              if (inChunk(t) && clear(t, v, 1.2)) this.cow(t, v, heading + (random() - .5) * 1.1, random);
            }
          }
          if (field.kind === 'pasture' && randomAt(field.seed, field.salt + 11) < .5) for (let i = 0; i < 4; i++) {
            const t = rowStart + 6 + randomAt(field.seed * 4 + i, field.salt + 12) * (rowEnd - rowStart - 12);
            const v = side * (from + 5 + randomAt(field.seed * 4 + i, field.salt + 13) * Math.max(2, to - from - 10));
            if (!inChunk(t) || !clear(t, v, 1.5)) continue;
            const p = this.ground(t, v), size = 1.2 + random() * 1.1;
            shrubs.push({ p: [p.x, p.y + size * .3, p.z], scale: [size, size * .7, size], r: [0, random() * 6.28, 0], color: hedgeGreens[i % hedgeGreens.length] });
          }
        }
      }
      for (const side of [-1, 1]) {
        const bands = fieldBands(row, side);
        for (let band = 0; band < 3; band++) {
          if (fieldCorner(row, side, band)) {
            const t = rowStart + 5 + randomAt(row * 4 + band, 2841) * 4, v = side * (bands[band + 1] - 4 - randomAt(row * 4 + band, 2842) * 3);
            if (inChunk(t) && clear(t, v, 3)) for (let i = 0; i < 7; i++) {
              const p = this.ground(t + (random() - .5) * 3.2, v + (random() - .5) * 3.2), size = .45 + random() * .7;
              this.scenery.painted.push({ p: [p.x, p.y + size * .3, p.z], scale: [size, size * .7, size * .85], r: [random() * .5, random() * 6.28, random() * .5], color: stone[i % stone.length] });
            }
          }
          if (randomAt(row * 4 + band, side > 0 ? 2843 : 2844) < .31) {
            const t = rowEnd - 9 - randomAt(row * 4 + band, 2845) * 4, v = side * (bands[band + 1] - 7 - randomAt(row * 4 + band, 2846) * 3);
            if (!inChunk(t) || !clear(t, v, 5)) continue;
            for (let i = 0, count = 2 + Math.floor(random() * 3); i < count; i++) {
              const dt = t + (random() - .5) * 7, dv = v + (random() - .5) * 6;
              if (inside(dt) && clear(dt, dv, 2.5)) this.mixedTree(dt, dv, 7.5 + random() * 3.5, random, { conifer: .1, cypress: .22, oak: .2 });
            }
            for (let i = 0; i < 3; i++) {
              const p = this.ground(t + (random() - .5) * 9, v + (random() - .5) * 8), size = 1.1 + random() * .9;
              shrubs.push({ p: [p.x, p.y + size * .28, p.z], scale: [size, size * .75, size], r: [0, random() * 6.28, 0], color: hedgeGreens[i % hedgeGreens.length] });
            }
          }
        }
        if (randomAt(row, side > 0 ? 2851 : 2852) < .085) {
          const t = rowStart + 24 + randomAt(row, side > 0 ? 2853 : 2854) * (rowEnd - rowStart - 48);
          const v = side * (bands[1] + 12 + randomAt(row, side > 0 ? 2855 : 2856) * Math.min(44, bands[2] - bands[1] - 24));
          if (inChunk(t) && clear(t, v, 10)) this.outbuilding(t, v, random);
        }
        const field = fieldAt(rowStart + 1, side * (bands[1] + .5));
        if (field.kind === 'pasture' && randomAt(field.seed, field.salt + 14) < .45) {
          const t = rowStart + 20 + randomAt(field.seed, field.salt + 15) * (rowEnd - rowStart - 40);
          const v = side * (bands[1] + 14 + randomAt(field.seed, field.salt + 16) * Math.max(4, bands[2] - bands[1] - 28));
          for (let i = 0; i < 3; i++) {
            const dt = t + (random() - .5) * 12, dv = v + (random() - .5) * 10;
            if (inChunk(dt) && clear(dt, dv, 3.5)) this.tree('oak', dt, dv, 8 + random() * 5, oakGreens[(((field.seed + i) % oakGreens.length) + oakGreens.length) % oakGreens.length], random() * 6.28);
          }
        }
      }
      if (!inChunk(rowStart)) continue;
      const line = rowStart + 2.2;
      for (const side of [-1, 1]) {
        const kind = rowBoundaryKind(row, side), far = Math.min(fieldBands(row, side)[4], 330);
        const crossings = fieldBands(row, side).slice(1, 4);
        fringe(acrossPoints(line, side, ROAD_RESERVE, Math.min(far, 170), 2.6), 's');
        if (kind === 'fence') {
          fence(acrossPoints(line, side, ROAD_RESERVE, far, 6, crossings));
          bushLine(acrossPoints(line, side, ROAD_RESERVE, far, 6), 's');
          if (randomAt(row, side > 0 ? 2795 : 2796) < .35) treeLine(acrossPoints(line + 2.6, side, 16, far, 8), side < 0);
        } else if (kind === 'hedge') hedge(acrossPoints(line, side, ROAD_RESERVE, far, 1.7));
        else if (kind === 'treeline') treeLine(acrossPoints(line, side, 16, far, 4.5), side < 0);
        else if (kind === 'shelterbelt') for (let cross = 18; cross < Math.min(far, 260); cross += 6.5) {
          if (random() < .1) continue;
          const t = line + (random() - .5) * 2.2, v = side * (cross + (random() - .5) * 2.8);
          if (!clear(t, v, 2)) continue;
          this.tree('poplar', t, v, 9 + random() * 7, poplarGreens[Math.floor(random() * poplarGreens.length)], random() * 6.28);
        }
      }
    }
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 3) for (const side of [-1, 1]) {
      if (random() > .5) continue;
      this.tuft(s + random() * 3, side * (8.9 + random() * 3.4), 'verge', random);
    }
    for (let cell = Math.floor(this.start / 32) - 1; cell * 32 < this.start + CHUNK_LENGTH; cell++) {
      for (const side of [-1, 1]) {
        const density = randomAt(cell, side > 0 ? 2841 : 2842);
        if (density > .72) continue;
        for (let i = 0, count = 2 + Math.floor(random() * 4); i < count; i++) {
          const t = cell * 32 + random() * 32, v = side * (15 + random() * 7);
          if (!inChunk(t) || !clear(t, v, 3)) continue;
          const height = (side < 0 ? 6.5 : 8) + random() * 3.5;
          this.mixedTree(t, v, height, random, { conifer: .1, cypress: .14, oak: .26 });
        }
        if (density < .4) for (let i = 0; i < 2; i++) {
          const t = cell * 32 + random() * 32, v = side * (14.5 + random() * 4);
          if (!inChunk(t) || !clear(t, v, 1)) continue;
          const p = this.ground(t, v), size = 1 + random() * .9;
          shrubs.push({ p: [p.x, p.y + size * .28, p.z], scale: [size, size * .7, size], r: [0, random() * 6.28, 0], color: hedgeGreens[Math.floor(random() * hedgeGreens.length)] });
        }
      }
    }
    for (const pond of pondsNear(this.start + CHUNK_LENGTH / 2)) if (inChunk(pond.s)) this.pond(pond, random, shrubs, stone);
    const sign = (s, side, kind) => {
      if (!inChunk(s) || creekDistance(s, side * 8.4) < 12) return;
      const p = this.ground(s, side * 8.4), angle = -roadFrame(s).angle;
      posts.push({ p: [p.x, p.y + 1.15, p.z], scale: [.12, 2.3, .12], r: [0, angle, 0] });
      if (kind === 'diamond') this.scenery.painted.push({ p: [p.x, p.y + 2.6, p.z], scale: [.92, .92, .07], r: [0, angle, Math.PI / 4], color: '#e9b52e' });
      else this.scenery.painted.push({ p: [p.x, p.y + 2.55, p.z], scale: [.78, .98, .07], r: [0, angle, 0], color: '#f2efe6' });
    };
    const creekHere = plainsCreekAt(this.start + CHUNK_LENGTH / 2);
    sign(creekHere.start - 70, 1, 'diamond'); sign(creekHere.end + 70, -1, 'diamond');
    for (let s = Math.ceil((this.start - 200) / 448) * 448 + 200; s < this.start + CHUNK_LENGTH; s += 448) sign(s, 1, 'speed');
    for (let row = fieldRowAt(this.start) - 1; fieldBoundary(row) < this.start + CHUNK_LENGTH; row++) for (const side of [-1, 1]) {
      const gate = farmGate(row, side);
      if (!gate || !inChunk(gate.s)) continue;
      // Paler timber, heavier posts and a brace so the gate stands out from the fence.
      const angle = -roadFrame(gate.s).angle, u = side * ROAD_RESERVE, timber = '#b39c73';
      for (const end of [-1, 1]) {
        const p = this.ground(gate.s + end * 2.4, u);
        posts.push({ p: [p.x, p.y + .82, p.z], scale: [.32, 1.72, .32], r: [0, angle, 0] });
      }
      const a = this.ground(gate.s - 2.4, u), b = this.ground(gate.s + 2.4, u);
      for (const height of [.42, .72, 1.02, 1.32]) {
        this.beam(this.scenery.rails, { ...a, y: a.y + height }, { ...b, y: b.y + height }, .085, timber);
      }
      for (const t of [1 / 3, 2 / 3]) {
        const stile = this.ground(gate.s - 2.4 + t * 4.8, u);
        this.beam(this.scenery.rails, { ...stile, y: stile.y + .42 }, { ...stile, y: stile.y + 1.32 }, .075, timber);
      }
      this.beam(this.scenery.rails, { ...a, y: a.y + .42 }, { ...b, y: b.y + 1.32 }, .08, timber);
    }
    if (Math.abs(creekHere.center - this.start - CHUNK_LENGTH / 2) < CHUNK_LENGTH / 2 + 150) {
      const rushRandom = seededRandom(creekHere.index + 61911);
      for (let u = -396; u <= 544; u += 3) for (const bank of [-1, 1]) {
        const keep = rushRandom() > .45, d = 5.6 + rushRandom() * 1.6, size = .7 + rushRandom() * .6, yaw = rushRandom() * 6.28;
        const t = creekCenterS(creekHere, u) + bank * d;
        if (!keep || !inChunk(t) || Math.abs(u) < 8.5) continue;
        const p = this.ground(t, u);
        this.scenery.rushes.push({ p: [p.x, p.y - .05, p.z], scale: [size, size, size], r: [0, yaw, 0], color: Math.floor(u) % 2 ? '#7f9a3c' : '#93a548' });
      }
    }
    // Distant woods. Each crown is only 20 triangles.
    for (const [cross, salt] of [[316, 2871], [391, 2881], [468, 2891]]) {
      for (let cell = Math.floor(this.start / 104) - 1; cell * 104 < this.start + CHUNK_LENGTH + 60; cell++) {
        if (randomAt(cell, salt) < .4) continue;
        const centerS = cell * 104 + randomAt(cell, salt + 1) * 50;
        const centerU = cross + (randomAt(cell, salt + 2) - .5) * 40;
        const count = 10 + Math.floor(randomAt(cell, salt + 3) * 6);
        for (let i = 0; i < count; i++) {
          const id = cell * 16 + i, angle = randomAt(id, salt + 4) * Math.PI * 2;
          const radius = Math.sqrt(randomAt(id, salt + 5));
          const s = centerS + Math.cos(angle) * radius * 35, u = centerU + Math.sin(angle) * radius * 13;
          if (!inside(s) || !clear(s, u, 2)) continue;
          const p = this.ground(s, u), size = 4.5 + randomAt(id, salt + 6) * 3.8;
          this.scenery.farLumps.push({ p: [p.x, p.y + size * .3, p.z], scale: [size, size * (.8 + randomAt(id, salt + 7) * .5), size * .85], r: [0, angle, 0], color: i % 3 ? '#587a38' : '#4f7033' });
        }
      }
    }
    if (((this.index % 3) + 3) % 3 === 1) {
      const flockRandom = seededRandom(this.index + 70301), count = 5 + Math.floor(flockRandom() * 4);
      const s = this.start + 30 + flockRandom() * 68, u = (flockRandom() > .5 ? 1 : -1) * (36 + flockRandom() * 90);
      const height = Math.max(plainsGroundHeight(s, u), plainsRoadHeight(s)) + 15 + flockRandom() * 6;
      const flock = new THREE.InstancedMesh(crowGeometry, crowMaterial, count); flock.name = 'plains-crows';
      for (let i = 0; i < count; i++) {
        const p = plainsPosition(s + (flockRandom() - .5) * 9, u + (flockRandom() - .5) * 9, height + flockRandom() * 2.5);
        dummy.position.set(p.x, p.y, p.z + this.start); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(.9 + flockRandom() * .3); dummy.updateMatrix(); flock.setMatrixAt(i, dummy.matrix);
      }
      flock.castShadow = false; flock.computeBoundingSphere(); flock.boundingSphere.radius += 16;
      this.group.add(flock);
    }
    // Poles skip the creek and wire to the next standing pole.
    const POLE_U = ROAD_RESERVE + 1.8, standing = s => creekDistance(s, POLE_U) > 9;
    for (let s = Math.ceil((this.start - 8) / 32) * 32 + 8; s < this.start + CHUNK_LENGTH; s += 32) {
      if (!standing(s) || !plainsDiscoveryClears(s, POLE_U, this.discoveries, 1)) continue;
      const p = this.ground(s, POLE_U), angle = -roadFrame(s).angle;
      poles.push({ p: [p.x, p.y + 4.7, p.z], scale: [.21, 9.6, .21] });
      solidPost(this, p.x, p.z, .15);
      posts.push({ p: [p.x, p.y + 8.95, p.z], scale: [2.3, .15, .15], r: [0, angle, 0] });
      for (const offset of [-.95, .95]) {
        const a = this.ground(s, POLE_U + offset);
        this.scenery.painted.push({ p: [a.x, p.y + 9.14, a.z], scale: [.14, .24, .14], r: [0, angle, 0], color: '#d9ddd6' });
      }
      let next = s + 32;
      while (!standing(next) && next - s < 100) next += 32;
      if (next - s > 100) continue;
      const q = this.ground(next, POLE_U);
      for (const [offset, height] of [[-.95, 9.24], [.95, 9.24], [0, 9.62]]) {
        const a = this.ground(s, POLE_U + offset), b = this.ground(next, POLE_U + offset);
        const middle = { x: (a.x + b.x) / 2, y: (p.y + q.y) / 2 + height - .45, z: (a.z + b.z) / 2 };
        // Thinner wires break into dots on phone screens.
        beam(wires, { x: a.x, y: p.y + height, z: a.z }, middle, .075); beam(wires, middle, { x: b.x, y: q.y + height, z: b.z }, .075);
      }
    }
    const creek = plainsCreekAt(this.start + CHUNK_LENGTH / 2);
    if (Math.abs(creek.center - this.start - CHUNK_LENGTH / 2) < CHUNK_LENGTH / 2 + 150) {
      const treeRandom = seededRandom(creek.index + 51203);
      for (let u = -392; u <= 540; u += 10) for (const bank of [-1, 1]) {
        const keep = treeRandom() > .58, d = 8.5 + treeRandom() * 7, height = 6 + treeRandom() * 4.5, yaw = treeRandom() * 6.28, willow = treeRandom() > .35;
        const v = u + (treeRandom() - .5) * 5, t = creekCenterS(creek, v) + bank * d;
        if (!keep || !inChunk(t) || Math.abs(v) < 16 || !plainsDiscoveryClears(t, v, this.discoveries, 3)) continue;
        this.tree(willow ? 'willow' : 'oak', t, v, willow ? height : height * 1.2, (willow ? willowGreens : oakGreens)[Math.abs(Math.floor(u / 8)) % 3], yaw);
      }
    }
  }
  // Keeps scenery off the road reserve, creek, ponds and discoveries.
  // `onTrack` lets a track's own shed stand in its corridor; `onPond` does the
  // same for a pond's bank trees.
  clearAt(s, u, r = 1, onTrack = false, onPond = false) {
    return Math.abs(u) > r + 6.6 && creekDistance(s, u) > r + 5.5 && plainsDiscoveryClears(s, u, this.discoveries, r)
      && (onTrack || farmTrackClears(s, u, r))
      && (onPond || pondsNear(s).every(pond => Math.hypot(s - pond.s, u - pond.u) > pondEdge(pond, Math.atan2(u - pond.u, s - pond.s)) * 1.4 + r));
  }
  // Returns the { low, high } a footing must span, or null if too uneven.
  levelGround(s, u, spread, limit) {
    const heights = [-spread, 0, spread].flatMap(ds => [-spread, 0, spread].map(du => this.ground(s + ds, u + du).y));
    const low = Math.min(...heights), high = Math.max(...heights);
    return high - low > limit ? null : { low, high };
  }
  beam(list, a, b, width, color) {
    const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z), direction = to.clone().sub(from);
    list.push({ p: from.clone().add(to).multiplyScalar(.5).toArray(), scale: [width, direction.length(), width], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), color });
  }
  // A skipped post (gate, creek, yard) also breaks the rails.
  fence(points, keepClear = true) {
    const { posts, rails } = this.scenery;
    let previous = null;
    for (const point of points) {
      if (keepClear && !this.clearAt(point.s, point.u, .3)) { previous = null; continue; }
      const p = this.ground(point.s, point.u);
      // Points past the chunk end are the next chunk's posts; only the rails are ours.
      // Corner and gate posts are placed only by the line that owns them.
      if (point.own !== false && point.post !== false) posts.push({ p: [p.x, p.y + .62, p.z], scale: [.26, 1.32, .26], r: [0, -roadFrame(point.s).angle, 0] });
      // Two rails. A single thin wire left the posts reading as specks.
      if (previous) for (const height of [.62, 1.04]) {
        this.beam(rails, { ...previous, y: previous.y + height }, { ...p, y: p.y + height }, .13);
      }
      // Collider per span, so a gap stays drivable.
      if (previous) solidSpan(this, previous, p, .15);
      // Rails stop at a gate post.
      previous = point.stop ? null : p;
    }
  }
  // Stock pond on its own facets. The ground is cut away beneath so nothing shows
  // through the water, and the bank runs out until it meets the field facets.
  pond(pond, random, shrubs, stone) {
    const steps = 30, { level } = pond, { shores, shoreTints } = this.scenery;
    const inside = s => s >= this.start + 2 && s < this.start + CHUNK_LENGTH - 2;
    // Jittered so the water and bank facets don't fan out evenly.
    const angles = Array.from({ length: steps }, (_, i) => (i + (randomAt(i, pond.index + 2877) - .5) * .5) / steps * Math.PI * 2);
    const turn = a => Math.atan2(Math.sin(a), Math.cos(a));
    const toDrink = a => Math.abs(turn(a - pond.drink));
    // Bank point at share d of the pond's reach, on the higher of the analytic
    // ground and the facets. At d <= 1 it sits at water level, shared with the water.
    const bank = (a, d) => {
      const r = pondEdge(pond, a) * d, s = pond.s + Math.cos(a) * r, u = pond.u + Math.sin(a) * r, p = this.ground(s, u);
      return { x: p.x, y: d <= 1 ? level : Math.max(p.y, plainsGroundHeight(s, u)) + .06, z: p.z - this.start, s, u };
    };
    const place = (p, lift = 0) => [p.x, p.y + lift, p.z + this.start];
    // Bands: mud, earth, grass, then crop colour. Worn earth on the drinking side.
    const earth = new THREE.Color('#997d58'), wetMud = mud.clone().multiplyScalar(.7), meadow = lush.clone().lerp(mud, .15);
    const rings = [1, 1.05, 1.16, 1.24, 1.31, 1.38].map((d, k) => angles.map((a, i) => {
      const wobble = k < 2 ? 1 : 1 + .03 * Math.sin(a * 2.3 + pond.index + k) + .02 * Math.sin(a * 4.1 - pond.index * 1.7 + k * 2);
      return bank(a, d * wobble);
    }));
    const worn = angles.map((a, i) => toDrink(a) < .3 + randomAt(i, pond.index + 2878) * .3);
    const tint = (band, i) => {
      const drink = worn[i];
      const base = band === 0 ? wetMud : band === 1 ? earth : band === 2 ? (drink ? earth : meadow.clone().lerp(earth, .35))
        : band === 3 ? (drink ? earth.clone().lerp(meadow, .5) : meadow.clone().lerp(cropColor(rings[4][i].s, rings[4][i].u).color, .55))
        : cropColor(rings[5][i].s, rings[5][i].u).color;
      return base.clone().multiplyScalar(.95 + randomAt(i * 8 + band, pond.index + 2879) * .1);
    };
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < steps; i++) {
      const j = (i + 1) % steps, inner = rings[k], outer = rings[k + 1];
      triangle(shores, shoreTints, inner[i], inner[j], outer[i], tint(k, i), this.start);
      triangle(shores, shoreTints, inner[j], outer[j], outer[i], tint(k, j), this.start);
    }
    // Flat surface in three colour bands. Same-colour facets on one plane don't show.
    const vertices = [], colors = [], shallow = new THREE.Color('#7aa9ab'), deep = new THREE.Color('#4a86a0');
    const surface = angles.map((a, i) => [.74, .42].map((d, k) => {
      const r = pondEdge(pond, a) * d * (1 + (randomAt(i * 2 + k, pond.index + 2881) - .5) * .16);
      const p = plainsPosition(pond.s + Math.cos(a) * r, pond.u + Math.sin(a) * r, level);
      return { x: p.x, y: p.y, z: p.z };
    }));
    const middle = plainsPosition(pond.s, pond.u, level);
    const water = band => shallow.clone().lerp(deep, [.3, .62, .82][band]);
    for (let i = 0; i < steps; i++) {
      const j = (i + 1) % steps;
      triangle(vertices, colors, rings[0][i], rings[0][j], surface[i][0], water(0), this.start);
      triangle(vertices, colors, rings[0][j], surface[j][0], surface[i][0], water(0), this.start);
      triangle(vertices, colors, surface[i][0], surface[j][0], surface[i][1], water(1), this.start);
      triangle(vertices, colors, surface[j][0], surface[j][1], surface[i][1], water(1), this.start);
      triangle(vertices, colors, surface[i][1], surface[j][1], middle, water(2), this.start);
    }
    this.addMesh(geometry(vertices, colors), pondMaterial, 'stock-pond');
    // Two reed beds away from the drinking side, plus a few odd clumps.
    const reeds = ['#8aa040', '#9aa84a', '#a39c45'];
    const beds = [pond.drink + Math.PI + (random() - .5) * 1.4, pond.drink + (random() < .5 ? 1 : -1) * (1.5 + random() * .6)];
    const rush = (a, d) => {
      const r = pondEdge(pond, a) * d, s = pond.s + Math.cos(a) * r, u = pond.u + Math.sin(a) * r;
      const p = d < 1 ? plainsPosition(s, u, level - .04) : bank(a, d), size = 1.1 + random() * .8;
      this.scenery.rushes.push({ p: place(p, d < 1 ? 0 : -.06), scale: [size, size, size], r: [0, random() * 6.28, 0], color: reeds[Math.floor(random() * reeds.length)] });
    };
    for (const bed of beds) for (let i = 0, n = 8 + Math.floor(random() * 6); i < n; i++) rush(bed + (random() - .5) * .85, .93 + random() * .14);
    for (let i = 0; i < 4; i++) { const a = random() * Math.PI * 2; if (toDrink(a) > .8) rush(a, .98 + random() * .07); }
    for (let i = 0; i < 3; i++) {
      const a = pond.drink + (random() - .5) * .8, d = i ? 1.06 + random() * .14 : .97;
      const p = bank(a, d), [x, y, z] = place(p, d < 1 ? -.14 : 0);
      this.cowAt({ x, y, z }, a + Math.PI + (random() - .5) * .7, random);
    }
    const trees = [['willow', 7.5 + random() * 2.5, '#7f9c4a'], ['oak', 8 + random() * 3, '#587f3a'], ['hedge', 6 + random() * 2, '#5d8a39']];
    for (let i = 0, n = 2 + Math.floor(random() * 2); i < n; i++) {
      const a = pond.drink + Math.PI + (random() - .5) * 2.6, r = pondEdge(pond, a) * (1.42 + random() * .2);
      const t = pond.s + Math.cos(a) * r, v = pond.u + Math.sin(a) * r, [kind, height, color] = trees[i];
      if (inside(t) && this.clearAt(t, v, 2, false, true)) this.tree(kind, t, v, height, color, random() * 6.28);
    }
    for (let i = 0; i < 2; i++) {
      const a = random() * Math.PI * 2, p = bank(a, 1.08 + random() * .14), size = .7 + random() * .7;
      this.scenery.painted.push({ p: place(p, size * .18), scale: [size * .8, size * .45, size * .65], r: [0, random() * 6.28, .15], color: stone[i % stone.length] });
    }
    if (random() < .5) {
      const a = pond.drink + Math.PI / 2 * (random() < .5 ? 1 : -1) + (random() - .5), d = 1.14 + random() * .1, span = .12 + random() * .05;
      const [x0, y0, z0] = place(bank(a - span, d), .2), [x1, y1, z1] = place(bank(a + span, d + (random() - .5) * .06), .2);
      this.beam(this.scenery.painted, { x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, .42, '#7b6749');
    }
    for (const bed of beds) for (let i = 0; i < 2; i++) {
      const a = bed + (random() - .5) * .9, p = bank(a, 1.24 + random() * .1), size = .8 + random() * .7;
      shrubs.push({ p: place(p, size * .25), scale: [size, size * .6, size], r: [0, random() * 6.28, 0], color: '#7d9a3e' });
    }
  }
  tuft(s, u, kind, random) {
    const where = kind ?? (Math.abs(u) < ROAD_RESERVE ? 'verge' : fieldAt(s, u)?.kind);
    if (where !== 'pasture' && where !== 'verge' && where !== 'wheat') return;
    if (!this.clearAt(s, u, .2)) return;
    const wheat = where === 'wheat', tints = wheat ? WHEAT_TINTS : GRASS_TINTS[where];
    const p = this.ground(s, u), size = wheat ? .85 + random() * .45 : .8 + random() * .6;
    (wheat ? this.scenery.wheat : this.scenery.grass).push({ p: [p.x, p.y - .03, p.z], scale: [size, size, size], r: [0, random() * 6.28, 0], color: tints[Math.floor(random() * tints.length)] });
  }
  cow(s, u, heading, random) { this.cowAt(this.ground(s, u), heading, random); }
  cowAt(p, heading, random) {
    const coats = ['#f0ece2', '#e8e2d4', '#9b7551', '#8a6340', '#f2eee6', '#7d5a3c'];
    solidModel(this, cowGeometry, [p.x, p.y, p.z], heading);
    this.scenery.cows.push({ p: [p.x, p.y, p.z], scale: [1, 1, 1], r: [0, heading, 0], color: coats[Math.floor(random() * coats.length)] });
  }
  // Mostly round crowns, with conifer, cypress and oak at the given shares.
  mixedTree(s, u, height, random, shares) {
    const r = random(), pick = list => list[Math.floor(random() * list.length)];
    if (r < shares.conifer) this.tree('conifer', s, u, height * 1.15, pick(CONIFER_GREENS), random() * 6.28);
    else if (r < shares.conifer + shares.cypress) this.tree('cypress', s, u, height * 1.35, pick(CYPRESS_GREENS), random() * 6.28);
    else if (r < shares.conifer + shares.cypress + shares.oak) this.tree('oak', s, u, height * 1.1, pick(['#587f3a', '#4d7434', '#65883f', '#43682e']), random() * 6.28);
    else this.tree('hedge', s, u, height, pick(['#5d8a39', '#6b9942', '#4f7c32', '#76a54a', '#598136', '#6fa03f']), random() * 6.28);
  }
  outbuilding(s, u, random, mouth = null) {
    const level = this.levelGround(s, u, 5, 2.4);
    if (!level) return;
    const { low, high } = level;
    const yaw = -roadFrame(s).angle + (random() - .5) * .6, p = this.ground(s, u);
    this.dirtPatch(s, u, 8.4, 7.2, mouth);
    this.scenery.painted.push({ p: [p.x, (low - .3 + high + .05) / 2, p.z], scale: [7.2, high - low + .35, 9.6], r: [0, yaw, 0], color: '#b1a892' });
    this.scenery.sheds.push({ p: [p.x, high + .05, p.z], scale: [1.2, 1.2, 1.2], r: [0, yaw, 0] });
    solidModel(this, plainsDiscoveryAssets.shed, [p.x, p.y, p.z], yaw, 1.2);
    // Kept dull; a pale tank read as a haystack from the road.
    const tank = this.ground(s + 6.2, u + (u > 0 ? 2.5 : -2.5));
    this.scenery.tanks.push({ p: [tank.x, tank.y + 1, tank.z], scale: [1.7, 2.1, 1.7], r: [0, random() * 6.28, 0], color: '#6c746f' });
    solidPost(this, tank.x, tank.z, 1.7);
    for (const [ds, du, kind, height, color] of [[-8.5, 5, 'oak', 9, '#587f3a'], [7, -7, 'hedge', 7.5, '#4d7434'], [-6, -8, 'cypress', 11, CYPRESS_GREENS[0]]]) {
      if (this.clearAt(s + ds, u + du, 2)) this.tree(kind, s + ds, u + du, height + random() * 2, color, random() * 6.28);
    }
  }
  tree(kind, s, u, height, color, yaw) {
    const variants = plainsTrees[kind], variant = variants[Math.abs(Math.round(s * 7 + u)) % variants.length];
    const p = this.ground(s, u), { bark, leaves } = this.scenery;
    if (!bark.has(variant)) { bark.set(variant, []); leaves.set(variant, []); }
    bark.get(variant).push({ p: [p.x, p.y - .12, p.z], scale: [height, height, height], r: [0, yaw, 0] });
    leaves.get(variant).push({ p: [p.x, p.y - .12, p.z], scale: [height, height, height], r: [0, yaw, 0], color });
    solidModel(this, variant.bark, [p.x, p.y, p.z], yaw, height, true);
  }
  finishScenery() {
    const { posts, wires, rails, poles, shrubs, bales, squareBales, boxes, painted, cows, rushes, grass, wheat, farLumps, concrete, sheds, tanks, bark, leaves, dirt, dirtTints, shores, shoreTints } = this.scenery;
    if (dirt.length) this.addMesh(geometry(dirt, dirtTints), dirtMaterial, 'farm-tracks');
    if (shores.length) this.addMesh(geometry(shores, shoreTints), bankMaterial, 'pond-banks');
    instances(this.group, squareBaleGeometry, strawMaterial, squareBales, 'square-bales');
    instances(this.group, plainsDiscoveryAssets.shed, plainsDiscoveryMaterial, sheds, 'field-sheds');
    instances(this.group, poleGeometry, metalMaterial, tanks, 'water-tanks');
    // Drop duplicate posts where two lines meet; coincident posts z-fight.
    const standing = new Set();
    const singles = posts.filter(post => {
      const key = post.p.map(value => Math.round(value * 8)).join() + '/' + Math.round(post.scale[1] * 100);
      if (standing.has(key)) return false;
      standing.add(key); return true;
    });
    instances(this.group, boxGeometry, timberMaterial, singles, 'fence-posts');
    instances(this.group, boxGeometry, railMaterial, rails, 'fence-rails', false);
    instances(this.group, boxGeometry, wireMaterial, wires, 'overhead-wires', false);
    instances(this.group, poleGeometry, poleMaterial, poles, 'utility-poles');
    instances(this.group, shrubGeometry, shrubMaterial, shrubs, 'hedgerows');
    instances(this.group, baleGeometry, strawMaterial, bales, 'hay-bales');
    instances(this.group, boxGeometry, metalMaterial, boxes, 'mailboxes');
    instances(this.group, boxGeometry, concreteMaterial, concrete, 'creek-bridge');
    instances(this.group, boxGeometry, paintedMaterial, painted, 'signs-and-stones');
    instances(this.group, boxGeometry, paintedMaterial, this.scenery.railwayRails, 'plains-railway-rails');
    instances(this.group, boxGeometry, paintedMaterial, this.scenery.railwaySleepers, 'plains-railway-sleepers');
    instances(this.group, cowGeometry, hideMaterial, cows, 'cattle');
    instances(this.group, rushGeometry, rushMaterial, rushes, 'rushes', false);
    // Fringe skips shadows and the occlusion prepass to stay cheap.
    instances(this.group, stalkGeometry, fringeMaterial, grass, 'grass-fringe', false, false);
    instances(this.group, wheatGeometry, fringeMaterial, wheat, 'wheat-fringe', false, false);
    // Far windbreaks are horizon silhouettes: no shadow pass, no soft shading.
    for (const part of splitBatch(farLumps)) {
      if (!part.length) continue;
      const mesh = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, part.length); mesh.name = 'far-windbreaks';
      part.forEach((item, i) => { dummy.position.set(...item.p); dummy.rotation.set(...item.r); dummy.scale.set(...item.scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, new THREE.Color(item.color)); });
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.ambientOcclusion = false; computeInstanceBounds(mesh); this.group.add(mesh);
    }
    for (const [variant, items] of bark) {
      instances(this.group, variant.bark, barkMaterial, items, 'plains-trunks');
      instances(this.group, variant.leaves, leavesMaterial, leaves.get(variant), 'plains-crowns');
    }
    this.scenery = null;
  }
  dispose() {
    this.group.removeFromParent(); for (const g of this.owned) g.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class PlainsWorld {
  constructor(scene, chunkSource = null) { this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null; }
  update(s) {
    const center = Math.floor(s / CHUNK_LENGTH); this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, center, PlainsChunk);
    positionResidentChunks(this);
  }
  // One clock drives the creek ripples, windmills and turbines.
  animate(time) { animateWater(time, this.origin); }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); }
}
