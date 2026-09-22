import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, lerp } from './route.js';
import { blockAt, blockBoundary, quayOffset, pavementHeight, farBankHeight, cityGroundHeight, cityStreetYaw, FAR_BANK, FAR_BANK_TOP, RIVER_LEVEL, RIVER_BED } from './city-route.js';
import { Parts } from './city-assets.js';
import { registerChunkResources } from './chunk-resources.js';

// Extend a seeded sequence in either direction. Each gap independently picks
// seven or eight blocks; cached prefixes and binary lookup keep chunk queries
// cheap and give the same result regardless of loading order.
const firstDockBlock = Math.floor(randomAt(0, 3970) * 8);
const dockBlocks = [[firstDockBlock], [firstDockBlock]];
function scheduledBlocks(from, to) {
  const result = [];
  for (const direction of [1, -1]) {
    const blocks = dockBlocks[direction === 1 ? 0 : 1];
    const low = Math.min(from * direction, to * direction), high = Math.max(from * direction, to * direction);
    while (blocks.at(-1) * direction <= high) {
      const gapIndex = direction === 1 ? blocks.length - 1 : -blocks.length;
      blocks.push(blocks.at(-1) + direction * (7 + Math.floor(randomAt(gapIndex, 3971) * 2)));
    }
    let a = direction === 1 ? 0 : 1, b = blocks.length;
    while (a < b) {
      const mid = Math.floor((a + b) / 2);
      if (blocks[mid] * direction < low) a = mid + 1; else b = mid;
    }
    for (let i = a; i < blocks.length && blocks[i] * direction <= high; i++) result.push(blocks[i]);
  }
  return result.sort((a, b) => a - b);
}

export function cityDocks(from, to) {
  if (to <= from) return [];
  const sites = [];
  for (const block of scheduledBlocks(blockAt(from), blockAt(to))) {
    const a = blockBoundary(block), b = blockBoundary(block + 1);
    const s = (a + b) / 2 + (randomAt(block, 3692) - .5) * Math.min(16, (b - a) * .15);
    const bank = randomAt(block, 3972) < .5 ? 'near' : 'far';
    if (s >= from && s < to) sites.push({ block, s, bank, u: bank === 'near' ? quayOffset(s) : FAR_BANK - .9,
      variant: Math.floor(randomAt(block, 3693) * 3), palette: Math.floor(randomAt(block, 3973) * 3),
      reverse: randomAt(block, 3694) < .5, timber: Math.floor(randomAt(block, 3695) * 3), cargo: randomAt(block, 3974) < .5 });
  }
  return sites;
}

const BOATS = [
  { paint: '#aa513c', roof: '#364d47', cabin: 8.1, center: -.35, height: 1.2 },
  { paint: '#537b8b', roof: '#d6d0b6', cabin: 5.7, center: 1, height: 1.35 },
  { paint: '#637a58', roof: '#3c514a', cabin: 3.5, center: 2.4, height: 1.55 },
];

function cabinBoat(variant, palette) {
  const p = new Parts(), cream = '#ddd4b6', rubber = '#343e3c', glass = '#405f64';
  const { cabin, center, height } = BOATS[variant], { paint, roof } = BOATS[palette];
  // A narrow chine under the waterline and a clipped bow keep the hull
  // faceted, while giving it a proper boat silhouette rather than a slab.
  const outline = [[-1.65, -6.2], [-1.4, -6.5], [1.4, -6.5], [1.65, -6.2], [1.65, 4.8], [.85, 6.5], [-.85, 6.5], [-1.65, 4.8]];
  const hull = [], triangle = (a, b, c) => hull.push(...a, ...b, ...c);
  for (let i = 0; i < outline.length; i++) {
    const [x, z] = outline[i], [nx, nz] = outline[(i + 1) % outline.length];
    const a = [x, .44, z], b = [nx, .44, nz], c = [nx * .8, -.3, nz * .96], d = [x * .8, -.3, z * .96];
    triangle(a, b, c); triangle(a, c, d); triangle([0, .44, 0], b, a);
    p.beam([x, .57, z], [nx, .57, nz], .09, cream, 4);
    p.beam([x, .25, z], [nx, .25, nz], .065, paint, 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(hull, 3)); geometry.computeVertexNormals();
  p.add(geometry, [0, 0, 0], cream);
  p.box([0, .47, -.5], [2.95, .06, 10.8], '#aa936c');
  const top = .5 + height;
  p.box([0, .5 + height / 2, center], [2.35, height, cabin], paint);
  p.box([0, .6, center], [2.4, .12, cabin + .05], cream);
  // Two broad roof facets catch the light without adding a rounded surface.
  for (const side of [-1, 1]) p.box([side * .69, top + .1, center], [1.4, .15, cabin + .4], roof, [0, 0, -side * .065]);
  const windows = variant === 0 ? 4 : variant === 1 ? 3 : 2;
  for (const x of [-1.18, 1.18]) for (let k = 0; k < windows; k++) {
    const z = center - cabin / 2 + (k + .5) * cabin / windows;
    p.box([x, top - .4, z], [.045, .62, 1.25], cream);
    p.box([x + Math.sign(x) * .026, top - .38, z], [.018, .45, 1.06], glass);
  }
  p.box([0, top - .4, center + cabin / 2 + .02], [1.95, .66, .05], cream);
  for (const x of [-.47, .47]) p.box([x, top - .38, center + cabin / 2 + .052], [.82, .48, .018], glass);
  p.box([0, .94, center - cabin / 2 - .02], [.72, .9, .04], '#706b54');
  p.box([0, 1.13, center - cabin / 2 - .048], [.5, .4, .02], glass);
  p.box([0, .74, 5.1], [1.8, .48, .38], cream);
  for (const x of [-1.73, 1.73]) for (const z of [-3.9, 3.5]) {
    p.cylinder([x, .28, z], .17, .13, .65, rubber, 6);
    p.beam([x, .62, z], [x * .86, .67, z + .15], .025, cream, 4);
  }
  for (const z of [-5.75, 5.7]) {
    p.box([0, .6, z], [.12, .22, .13], rubber);
    p.box([0, .7, z], [.56, .09, .12], rubber);
  }
  p.add(new THREE.TorusGeometry(.34, .085, 4, 10), [.55, top + .25, center - .6], '#c5794b', [Math.PI / 2, 0, 0]);
  p.cylinder([-.55, top + .27, center + .75], .12, .13, .24, '#96967f', 6);
  p.cylinder([-.55, top + .42, center + .75], .2, .2, .07, cream, 6);
  if (variant === 1) {
    // Shorter cabin, open stern seating and a small roof hatch.
    p.box([0, .82, -4.7], [2.35, .65, .62], paint);
    p.box([0, 1.16, -4.7], [2.4, .12, .68], cream);
    p.box([0, top + .21, center + 1.7], [1.05, .12, .75], glass);
  } else if (variant === 2) {
    // A little working launch with a covered load behind its wheelhouse.
    p.box([0, .8, -2.1], [2.15, .6, 3.3], '#a49168');
    p.box([0, 1.14, -2.1], [2.25, .18, 3.4], '#8c967b');
    for (const z of [-3.1, -1.1]) p.box([0, 1.245, z], [2.25, .035, .075], cream);
  }
  return p.finish();
}

const boatGeometries = BOATS.flatMap((_, variant) => BOATS.map((_, palette) => cabinBoat(variant, palette)));
const boatMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .92 });
registerChunkResources('city-docks', { boatGeometries, boatMaterial });
const TIMBERS = ['#a28b60', '#99886b', '#ad9874'];
const piling = new THREE.Color('#746d51'), iron = new THREE.Color('#4b5551');

export function buildCityDocks(chunk) {
  const sites = cityDocks(chunk.start, chunk.start + CHUNK_LENGTH);
  chunk.features.docks = sites;
  if (!sites.length) return;
  const transform = new THREE.Object3D(), batches = new Map();
  const deck = RIVER_LEVEL + .65, target = chunk.scenery.details;
  const beam = (a, b, width, color) => {
    const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z), direction = to.clone().sub(from);
    chunk.scenery.boxes.push({ p: from.add(to).multiplyScalar(.5).toArray(), scale: [width, direction.length(), width], color,
      q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()) });
  };
  for (const site of sites) {
    const { s } = site, far = site.bank === 'far', outward = far ? 1 : -1;
    const shore = t => far ? FAR_BANK - .9 : quayOffset(t);
    const offset = (t, du) => shore(t) - outward * du;
    const box = (s0, s1, du0, du1, y0, y1, color) => {
      const mid = (s0 + s1) / 2, a = offset(mid, du0), b = offset(mid, du1);
      chunk.prism(target, s0, s1, Math.min(a, b), Math.max(a, b), y0, y1, color);
    };
    const timber = new THREE.Color(TIMBERS[site.timber]);
    // Continuous edges follow the quay. Broad, subtly varied boards meet
    // edge to edge, avoiding noisy subpixel gaps at the driving camera scale.
    const strip = (a, b, outer, inner, y, color) => chunk.quad(target,
      [[a, outer], [b, outer], [b, inner], [a, inner]].map(([t, du]) => chunk.at(t, offset(t, du), y)), color, [0, 1, 0]);
    for (let ds = -9; ds < 9; ds += 1) {
      for (const du of [-6.5, -.9]) chunk.quad(target,
        [[s + ds, deck - .32], [s + ds + 1, deck - .32], [s + ds + 1, deck], [s + ds, deck]]
          .map(([t, y]) => chunk.at(t, offset(t, du), y)), timber.clone().multiplyScalar(.8), [du < -2 ? outward : -outward, 0, 0]);
    }
    for (let board = 0; board < 28; board++) {
      const a = s - 9 + board * 18 / 28;
      strip(a, a + 18 / 28, -6.5, -.9, deck, timber.clone().multiplyScalar(.92 + randomAt(site.block * 31 + board, 3696) * .12));
    }
    for (const ds of [-9, 9]) {
      box(s + ds - .09, s + ds + .09, -6.5, -.9, deck - .32, deck + .025, timber);
    }
    for (const ds of [-8.3, 8.3]) for (const du of [-5.8, -1.6]) {
      box(s + ds - .19, s + ds + .19, du - .19, du + .19, RIVER_BED, deck + .55, piling);
      box(s + ds - .23, s + ds + .23, du - .23, du + .23, deck + .51, deck + .61, iron);
    }
    // The far bank slopes into the river: extend its stairs over that slope
    // to dry land, instead of mirroring the near bank's much steeper wall.
    const stairS = s - 7.25, landing = (far ? farBankHeight(stairS) : pavementHeight(stairS)) + .075;
    const count = Math.ceil((landing - deck) / .24), bottomU = offset(stairS, -5.7);
    const landingU = far ? FAR_BANK_TOP - .7 : shore(stairS) + .7;
    for (let step = 0; step < count; step++) {
      const a = lerp(bottomU, landingU, step / count), b = lerp(bottomU, landingU, (step + 1) / count);
      chunk.prism(target, s - 8.1, s - 6.4, Math.min(a, b), Math.max(a, b), deck - .15,
        deck + (landing - deck) * (step + 1) / count, timber);
    }
    if (far) chunk.quad(target, [[s - 8.1, -134], [s - 6.4, -134], [s - 6.4, landingU], [s - 8.1, landingU]]
      .map(([t, u]) => chunk.at(t, u, cityGroundHeight(t, u) + .075)), new THREE.Color('#93979b'), [0, 1, 0]);
    if (site.cargo) {
      const cargoS = s + 6.5;
      box(cargoS - .6, cargoS + .6, -2.55, -1.45, deck, deck + .85, new THREE.Color('#958268'));
      for (const ds of [-.4, .4]) box(cargoS + ds - .035, cargoS + ds + .035, -2.57, -1.43, deck + .85, deck + .91, piling);
    }
    // One light handrail follows the stair slope, leaving the landing open.
    const railFrom = chunk.at(s - 8.16, bottomU - outward * .1, deck + .85), railTo = chunk.at(s - 8.16, landingU + outward * .15, landing + .85);
    beam(railFrom, railTo, .075, '#67716a');
    for (const point of [railFrom, railTo]) beam({ ...point, y: point.y - .85 }, point, .075, '#67716a');
    // The boat stays rigid while the dock follows the embankment.
    const boatU = offset(s + .5, -9.2), p = chunk.at(s + .5, boatU, RIVER_LEVEL);
    const direction = site.reverse ? -1 : 1;
    transform.position.set(p.x, p.y, p.z); transform.rotation.set(0, cityStreetYaw(s + .5, boatU) + (site.reverse ? Math.PI : 0), 0);
    transform.updateMatrix();
    const model = site.variant * BOATS.length + site.palette;
    if (!batches.has(model)) batches.set(model, []);
    batches.get(model).push(transform.matrix.clone());
    for (const ds of [-5.4, 5.4]) {
      const cleat = chunk.at(s - ds, offset(s - ds, -6.1), deck + .19);
      const end = new THREE.Vector3(-outward * direction * 1.42, .63, direction * ds).applyMatrix4(transform.matrix);
      const middle = { x: (cleat.x + end.x) / 2, y: Math.min(cleat.y, end.y) - .12, z: (cleat.z + end.z) / 2 };
      beam(cleat, middle, .045, '#c0af86'); beam(middle, end, .045, '#c0af86');
      box(s - ds - .12, s - ds + .12, -6.23, -5.97, deck, deck + .2, iron);
      box(s - ds - .37, s - ds + .37, -6.19, -6.01, deck + .15, deck + .25, iron);
    }
  }
  for (const [variant, matrices] of batches) {
    const boats = new THREE.InstancedMesh(boatGeometries[variant], boatMaterial, matrices.length);
    boats.name = 'city-moored-boats'; boats.castShadow = true; boats.receiveShadow = true;
    matrices.forEach((matrix, index) => boats.setMatrixAt(index, matrix));
    boats.computeBoundingSphere(); chunk.group.add(boats);
  }
}

// Called for neighboring chunks too, so a stair opening never closes at a seam.
export function dockRailingSpans(from, to, bank = 'near') {
  let spans = [[from, to]];
  for (const site of cityDocks(from - 12, to + 12)) {
    if (site.bank !== bank) continue;
    const a = site.s - 8.3, b = site.s - 6.2;
    spans = spans.flatMap(([start, end]) => [[start, Math.min(end, a)], [Math.max(start, b), end]])
      .filter(([start, end]) => end > start);
  }
  return spans;
}
