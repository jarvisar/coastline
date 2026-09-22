import * as THREE from 'three';
import { positionAt, roadFrame, randomAt } from './route.js';
import { JungleDiscoveryParts } from './jungle-discovery-assets.js';
import { registerChunkResources } from './chunk-resources.js';
import { solidModel } from './colliders.js';

// A weathered limestone ruin: broad lower chamber, recessed upper sanctuary,
// stepped cornices and a broken parapet. The entrance faces the road.
function templeGeometry() {
  const parts = new JungleDiscoveryParts();
  const limestone = '#969784', trim = '#b0ad95', shadowStone = '#7e8675';
  // Single-segment bevels catch the light like the other low-poly landmarks.
  function stone(x, y, z, size, color = limestone, rotation = [0, 0, 0]) {
    const [w, h, d] = size, bevel = Math.min(.12, h * .18, d * .18);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + bevel, -h / 2 + bevel);
    shape.lineTo(w / 2 - bevel, -h / 2 + bevel);
    shape.lineTo(w / 2 - bevel, h / 2 - bevel);
    shape.lineTo(-w / 2 + bevel, h / 2 - bevel);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {depth: d - bevel * 2, steps: 1,
      bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 1});
    g.translate(0, 0, -d / 2 + bevel);
    parts.add(g, [x, y, z], color, rotation);
  }
  stone(0, .5, 0, [13, 1, 11], shadowStone);
  // Broad masonry courses, with staggered joints instead of a cube grid.
  for (const [halfX, halfZ, bottom, rows] of [[5, 4, 1, 4], [4, 3, 5.75, 3]]) {
    for (let row = 0; row < rows; row++) {
      const y = bottom + row + .5, upper = bottom > 2;
      for (const side of [-1, 1]) {
        const opening = upper ? .65 : 1.5;
        const hasDoor = (upper || side === 1) && row < rows - 1;
        if (hasDoor) {
          const width = halfX + .5 - opening;
          for (const sign of [-1, 1]) stone(sign * (opening + width / 2), y, side * halfZ, [width, 1, 1]);
        } else stone(0, y, side * halfZ, [halfX * 2 + 1, 1, 1]);
        const split = (row % 2 ? -.65 : .8);
        for (const [a, b] of [[-halfZ + .5, split], [split, halfZ - .5]]) {
          stone(side * halfX, y, (a + b) / 2, [1, 1, b - a], row % 3 === 1 ? '#90927f' : limestone);
        }
      }
    }
  }
  // Tapered corner piers and thin dressed cornices preserve the old outline.
  for (const x of [-5.45, 5.45]) for (const z of [-4.35, 4.35]) {
    stone(x, 1.28, z, [1.3, .56, 1.3], shadowStone);
    const pier = new THREE.CylinderGeometry(.66, .85, 3.3, 4);
    parts.add(pier, [x, 3.05, z], limestone, [0, Math.PI / 4, 0]);
    stone(x, 4.65, z, [1.3, .3, 1.3], trim);
  }
  stone(0, 4.92, 0, [11.8, .34, 9.8], shadowStone);
  stone(0, 5.35, 0, [13, .55, 11], trim);
  stone(0, 5.69, 0, [12.5, .16, 10.5], '#818c6d');
  stone(0, 9, 0, [9, .5, 7], trim);
  stone(0, 9.65, 0, [7, .8, 5]);
  stone(0, 10.13, 0, [7.2, .22, 5.2], trim);
  for (const [x, z, height] of [[-3, -2, 1.15], [3, -2, .85], [-3, 2, .8], [3, 2, 1.05]]) {
    stone(x, 10.25 + height / 2, z, [.9, height, .9], shadowStone, [.025, 0, x * .012]);
  }
  stone(-.4, 10.48, -2, [3.6, .5, .85], limestone, [0, 0, -.035]);
  // Low, irregular moss cushions collect on a few damp ledges.
  for (const [x, y, z, width, depth] of [
    [-4.7, 5.8, -3.5, 1.05, .65], [-4.9, 5.8, -2.6, .65, .8],
    [4.6, 5.8, 3.8, .95, .6], [3.6, 5.8, 4.5, .8, .45],
    [-2.6, 10.28, -1.5, .8, .5], [-1.8, 10.28, -1.8, .7, .35],
  ]) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(width, .13, depth);
    parts.add(g, [x, y, z], '#697c50');
  }
  // A carved portal and sun medallion give the ruin a readable focal point.
  for (const side of [-1, 1]) {
    stone(side * 1.7, 2.55, 4.6, [.42, 3.1, .38], trim);
    stone(side * 1.7, 1.25, 4.65, [.65, .45, .55], shadowStone);
  }
  stone(0, 4.13, 4.66, [4.2, .56, .55], trim);
  parts.add(new THREE.CylinderGeometry(.48, .48, .18, 8), [0, 4.15, 5], '#7a8872', [Math.PI / 2, 0, 0]);
  parts.add(new THREE.CylinderGeometry(.23, .3, .23, 4), [0, 4.15, 5.1], '#bdb599', [Math.PI / 2, 0, Math.PI / 4]);
  // Recessed dark chambers keep openings readable in the isometric view.
  parts.box([0, 2.4, 1.8], [8, 2.8, .12], '#29352b');
  parts.box([0, 6.8, 0], [6, 2, .12], '#303c2d');
  for (let step = 0; step < 3; step++) {
    stone(0, .15 + step * .15, 7 - step, [5, .3 + step * .3, 1], trim);
  }
  // Winding stems and pointed leaves soften the masonry without pixel patches.
  for (let face = 0; face < 4; face++) for (const column of [-3.7, -2.5, 2.7, 3.8]) {
    const length = 2 + Math.floor(randomAt(face * 13 + Math.round(column * 10), 2833) * 6);
    for (let i = 0; i < length; i++) {
      const along = column + Math.sin(i * .85 + face) * .22, y = 4.8 - i * .48;
      const p = face < 2 ? [along, y, (face ? -1 : 1) * 4.53] : [(face === 2 ? -1 : 1) * 5.53, y, along * .7];
      const nextAlong = column + Math.sin((i + 1) * .85 + face) * .22;
      const next = face < 2 ? [nextAlong, y - .48, p[2]] : [p[0], y - .48, nextAlong * .7];
      parts.beam(new THREE.Vector3(...p), new THREE.Vector3(...next), .045, '#52603a');
      const leaf = [...p]; leaf[face < 2 ? 0 : 2] += i % 2 ? -.17 : .17;
      const g = new THREE.OctahedronGeometry(1);
      g.scale(...(face < 2 ? [.19, .32, .065] : [.065, .32, .19]));
      parts.add(g, leaf, i % 2 ? '#6c8049' : '#526d42', face < 2 ? [0, 0, i % 2 ? -.5 : .5] : [.5, 0, 0]);
    }
  }
  return parts.finish();
}

const geometry = templeGeometry();
const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, flatShading: true});
registerChunkResources('jungle-temple', {geometry, material});

export function buildJungleTemple(chunk, site) {
  const center = positionAt(site.s, site.u);
  const angle = -roadFrame(site.s).angle - site.side * Math.PI / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const point = (x, z) => ({x: center.x + x * cos + z * sin, z: center.z + chunk.start - x * sin + z * cos});
  const samples = [];
  for (let x = -6.5; x <= 6.5; x++) for (let z = -5.5; z <= 7.5; z++) {
    const p = point(x, z);
    samples.push(chunk.sampleGround(p.x, p.z));
  }
  const base = Math.max(...samples) + .08, bottom = Math.min(...samples) - .45;
  const parts = new JungleDiscoveryParts();
  // A buried stone plinth reaches below the lowest rendered ground sample.
  // It supports the entire footprint on slopes, including the entry steps.
  parts.box([0, (bottom - base) / 2, 0], [13, base - bottom, 11], '#68745b');
  parts.box([0, (bottom - base) / 2, 6.5], [5, base - bottom, 2], '#68745b');
  const footing = chunk.addMesh(parts.finish(), material, 'jungle-temple-foundation', true);
  const temple = new THREE.Mesh(geometry, material);
  temple.name = 'jungle-temple'; temple.castShadow = true; temple.receiveShadow = true;
  chunk.group.add(temple);
  for (const mesh of [temple, footing]) {
    mesh.position.set(center.x, base, center.z + chunk.start);
    mesh.rotation.y = angle;
  }
  solidModel(chunk, geometry, [center.x, base, center.z + chunk.start], angle);
  return {base, bottom, angle};
}
