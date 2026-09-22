import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { bridgeAt, pondAt, pondRadius, roadHeight, groundHeight, positionAt, terrainCell, terrainColumns, randomAt, smoothstep, TERRAIN_STEP, CHUNK_LENGTH } from './route.js';
import { createPondMaterial } from './water.js';

const bridgeMaterial = new THREE.MeshStandardMaterial({ color: '#d8c9ab', emissive: '#766b54', emissiveIntensity: .08, roughness: 1, flatShading: true, side: THREE.DoubleSide });
const lakeMaterial = createPondMaterial();
const bankMaterial = new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: 1, transparent: true, depthWrite: false});
registerChunkResources('landmarks', { bridgeMaterial, lakeMaterial, bankMaterial });

function geometry(vertices, colors, colorSize = 3) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) result.setAttribute('color', new THREE.Float32BufferAttribute(colors, colorSize));
  result.computeVertexNormals(); result.computeBoundingSphere(); return result;
}

// An open-spandrel arch after the Big Sur original: twin ribs leap the inlet
// from footings on the gorge walls, slender paired columns carry the deck
// above them, and tall two-legged pylons mark the springings. The approaches
// stand on column bents, and solid abutments meet the ground at either end.
const ARCH_HALF_SPAN = 30, RIB_U = 4.1, RIB_HALF = .7;
const SPANDRELS = [5, 10, 15, 20, 25], APPROACHES = [35.5, 40.5];

function buildBridge(chunk, bridge) {
  const first = Math.max(chunk.start, bridge.start - 12);
  const last = Math.min(chunk.start + CHUNK_LENGTH, bridge.end + 12);
  if (first >= last) return;
  const vertices = [];
  function quad(a, b, c, d) {
    for (const p of [a, b, c, b, d, c]) vertices.push(p.x, p.y, p.z + chunk.start);
  }
  function point(s, u, y) { return positionAt(s, u, y); }
  const at = (value, s) => typeof value === 'function' ? value(s) : value;
  // A block between two stations along the road, bent to follow its curve.
  function block(s0, s1, u0, u1, bottom, top) {
    const c = (s, u, y) => point(s, u, at(y, s));
    for (const u of [u0, u1]) quad(c(s0, u, bottom), c(s1, u, bottom), c(s0, u, top), c(s1, u, top));
    for (const s of [s0, s1]) quad(c(s, u0, bottom), c(s, u1, bottom), c(s, u0, top), c(s, u1, top));
    for (const y of [bottom, top]) quad(c(s0, u0, y), c(s1, u0, y), c(s0, u1, y), c(s1, u1, y));
  }
  const inChunk = s => s >= chunk.start && s < chunk.start + CHUNK_LENGTH;
  const deckUnder = s => roadHeight(s) - 1;
  // The arch is a parabola through both springings, level at its crown, where
  // the ribs tuck under the deck slab. Ribs thicken toward their footings.
  const feet = new Map([-1, 1].map(side => [side, Math.max(.8, groundHeight(bridge.center + side * ARCH_HALF_SPAN, 0) + .5)]));
  const springing = side => feet.get(side);
  const crown = roadHeight(bridge.center) - 1.15;
  const archDepth = d => 1.05 + 1.25 * Math.pow(Math.min(1, Math.abs(d) / ARCH_HALF_SPAN), 1.6);
  const archTop = s => {
    const d = s - bridge.center, t = Math.min(1, Math.abs(d) / ARCH_HALF_SPAN), foot = springing(d < 0 ? -1 : 1) + archDepth(d);
    return crown - (crown - foot) * t * t;
  };
  const archBottom = s => archTop(s) - archDepth(s - bridge.center);
  for (let s = Math.max(first, bridge.center - ARCH_HALF_SPAN); s < Math.min(last, bridge.center + ARCH_HALF_SPAN); s++) {
    const end = Math.min(s + 1, last);
    for (const side of [-1, 1]) {
      const u0 = side * (RIB_U - RIB_HALF), u1 = side * (RIB_U + RIB_HALF);
      for (const u of [u0, u1]) quad(point(s, u, archBottom(s)), point(end, u, archBottom(end)), point(s, u, archTop(s)), point(end, u, archTop(end)));
      for (const y of [archTop, archBottom]) quad(point(s, u0, y(s)), point(end, u0, y(end)), point(s, u1, y(s)), point(end, u1, y(end)));
    }
  }
  for (const side of [-1, 1]) {
    for (const d of SPANDRELS) {
      const s = bridge.center + side * d;
      if (!inChunk(s) || deckUnder(s) - archTop(s) < .9) continue;
      // Paired columns stand on the ribs; a cap beam ties them under the slab
      // and a strut braces the ribs, so the pair reads as one frame.
      // Each member ends inside the one it meets, so no two faces share a plane.
      for (const u of [-RIB_U, RIB_U]) block(s - .4, s + .4, u - .45, u + .45, archTop(s) - .3, deckUnder(s) - .2);
      block(s - .45, s + .45, -RIB_U - .5, RIB_U + .5, deckUnder(s) - .6, deckUnder(s) + .1);
      block(s - .35, s + .35, -RIB_U, RIB_U, archTop(s) - .75, archTop(s) - .15);
    }
    const pylon = bridge.center + side * ARCH_HALF_SPAN;
    if (inChunk(pylon)) {
      const foot = springing(side);
      // Footing on the gorge wall, then two tall legs joined by a recessed web.
      block(pylon - 2.6, pylon + 2.6, -6.2, 6.2, Math.min(-2, groundHeight(pylon, 0) - 1.5), foot + .4);
      for (const u of [-1, 1]) block(pylon - 1.45, pylon + 1.45, u > 0 ? 3 : -5.45, u > 0 ? 5.45 : -3, foot, deckUnder(pylon) + .1);
      block(pylon - .8, pylon + .8, -3.3, 3.3, foot + .2, deckUnder(pylon) - .1);
      // Cornice bands at the top of the pylon and at the springing.
      for (const [low, high] of [[deckUnder(pylon) - 1.6, deckUnder(pylon) - .9], [foot + 2.2, foot + 2.8]]) {
        block(pylon - 1.65, pylon + 1.65, -5.65, 5.65, low, high);
      }
    }
    for (const d of APPROACHES) {
      const s = bridge.center + side * d;
      if (!inChunk(s)) continue;
      const ground = Math.min(groundHeight(s, -RIB_U), groundHeight(s, RIB_U)) - .5;
      if (deckUnder(s) - ground < 1.5) continue;
      for (const u of [-RIB_U, RIB_U]) block(s - .5, s + .5, u - .5, u + .5, ground, deckUnder(s) - .2);
      block(s - .55, s + .55, -RIB_U - .55, RIB_U + .55, deckUnder(s) - .7, deckUnder(s) + .1);
      if (deckUnder(s) - ground > 9) block(s - .35, s + .35, -RIB_U, RIB_U, (ground + deckUnder(s)) / 2 - .3, (ground + deckUnder(s)) / 2 + .3);
    }
  }
  // Only the abutments are solid down to the ground; elsewhere the edge beam
  // is a shallow fascia and the structure beneath stays open.
  function bottom(s, u) {
    const fascia = roadHeight(s) - 1.3;
    return Math.abs(s - bridge.center) > 43 ? Math.min(fascia, groundHeight(s, u) - .4) : fascia;
  }
  for (let s = first; s < last; s++) {
    const end = Math.min(s + 1, last);
    for (const side of [-1, 1]) {
      const outer = side * 6.13, inner = side * 5.38;
      const low = bottom(s, outer), lowEnd = bottom(end, outer);
      const high = roadHeight(s) - .13, highEnd = roadHeight(end) - .13;
      for (const u of [outer, inner]) quad(point(s, u, low), point(end, u, lowEnd), point(s, u, high), point(end, u, highEnd));
      quad(point(s, inner, low), point(end, inner, lowEnd), point(s, outer, low), point(end, outer, lowEnd));
      // Open balustrades preserve the tiny car's silhouette on the bridge.
      for (const u of [outer, outer - side * .24]) quad(point(s, u, high + 1.15), point(end, u, highEnd + 1.15), point(s, u, high + 1.4), point(end, u, highEnd + 1.4));
      quad(point(s, outer, high + 1.4), point(end, outer, highEnd + 1.4), point(s, outer - side * .24, high + 1.4), point(end, outer - side * .24, highEnd + 1.4));
      if (s % 3 === 0) {
        // Posts end at the rail's underside and follow that exact facet,
        // including its grade. Extending into it doubled the outer face.
        for (const u of [outer, outer - side * .24]) {
          const a = point(s, u, high), edge = point(end, u, highEnd), t = Math.min(.33 / (end - s), 1);
          const b = { x: a.x + (edge.x - a.x) * t, y: a.y + (edge.y - a.y) * t, z: a.z + (edge.z - a.z) * t };
          quad(a, b, { ...a, y: a.y + 1.15 }, { ...b, y: b.y + 1.15 });
        }
      }
    }
    // The deck has an underside, so the arches remain solid from the ocean side.
    quad(point(s, -6.13, roadHeight(s) - 1), point(end, -6.13, roadHeight(end) - 1), point(s, 6.13, roadHeight(s) - 1), point(end, 6.13, roadHeight(end) - 1));
  }
  const mesh = chunk.addMesh(geometry(vertices), bridgeMaterial, true);
  mesh.name = `coastal-bridge-${bridge.index}`;
  chunk.features.bridges.push(bridge.index);
}

function buildPond(chunk, pond) {
  if (pond.center + pond.rs * 1.5 < chunk.start || pond.center - pond.rs * 1.5 > chunk.start + CHUNK_LENGTH) return;
  const vertices = [], colors = [], bankVertices = [], bankColors = [];
  const shallow = new THREE.Color('#6eaaa2'), deep = new THREE.Color('#397d88');
  const dampEarth = new THREE.Color('#697b4b');
  const marginWidth = p => .28 + .2 * Math.sin(p.s / 11 + p.u / 7);
  const clip = (polygon, distance) => {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b);
      if (da >= 0) result.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db), p = {};
        for (const axis of ['x', 'y', 'z', 's', 'u']) p[axis] = a[axis] + (b[axis] - a[axis]) * t;
        result.push(p);
      }
    }
    return result;
  };
  // Slice the actual terrain faces at the waterline. An independent square
  // water grid left exposed teeth and detached patches beyond the coarse bank.
  // Using the terrain's global rows also matches its jittered streaming seams.
  const firstRow = chunk.start / TERRAIN_STEP;
  for (let row = firstRow; row < firstRow + CHUNK_LENGTH / TERRAIN_STEP; row++) {
    for (let col = 15; col < terrainColumns(row * TERRAIN_STEP).length - 1; col++) {
      for (const triangle of terrainCell(row, col)) {
        if (!triangle.some(p => p.y < pond.level && pondRadius(p.s, p.u, pond) < 1.12)) continue;
        // A narrow damp margin lies on the same terrain planes. Its width
        // varies along the shore; it is not a separate raised oval rim.
        const bank = clip(clip(triangle, p => p.y - pond.level),
          p => pond.level + marginWidth(p) - p.y);
        for (let i = 1; i < bank.length - 1; i++) for (const p of [bank[0], bank[i + 1], bank[i]]) {
          // Show the underlying meadow through the damp margin and fade all
          // the way out at its dry edge, rather than drawing a colored outline.
          const alpha = .24 * (1 - smoothstep(0, marginWidth(p), p.y - pond.level));
          bankVertices.push(p.x, p.y + .025, p.z + chunk.start);
          bankColors.push(dampEarth.r, dampEarth.g, dampEarth.b, alpha);
        }
        const polygon = clip(triangle, p => pond.level - p.y);
        if (polygon.length < 3) continue;
        // Broad, quiet color facets follow the same faces as the hillside.
        // Avoid a smooth cyan halo that makes the pond look airbrushed in.
        const depth = polygon.reduce((sum, p) => sum + pond.level - p.y, 0) / polygon.length;
        const color = shallow.clone().lerp(deep, .28 + Math.min(1, depth / 2.8) * .65);
        color.multiplyScalar(.985 + randomAt(row, col + 2201) * .03);
        for (let i = 1; i < polygon.length - 1; i++) {
          // Terrain cells wind downward; the water is viewed from above.
          for (const p of [polygon[0], polygon[i + 1], polygon[i]]) {
            vertices.push(p.x, pond.level, p.z + chunk.start); colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
  }
  if (!vertices.length) return;
  const mesh = chunk.addMesh(geometry(vertices, colors), lakeMaterial);
  mesh.name = `inland-pond-${pond.index}`;
  mesh.geometry.boundingSphere.radius += .3;
  if (bankVertices.length) {
    const bank = chunk.addMesh(geometry(bankVertices, bankColors, 4), bankMaterial);
    bank.name = `pond-damp-bank-${pond.index}`;
    bank.userData.ambientOcclusion = false;
  }
  chunk.features.ponds.push(pond.index);
}

export function buildLandmarks(chunk) {
  chunk.features = { bridges: [], ponds: [] };
  const bridge = bridgeAt(chunk.start + CHUNK_LENGTH / 2);
  buildBridge(chunk, bridge);
  buildPond(chunk, pondAt(chunk.start + CHUNK_LENGTH / 2));
}
