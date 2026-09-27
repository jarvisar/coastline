import * as THREE from 'three';
import { Parts } from './swamp-assets.js';
import { positionAt, randomAt } from './route.js';
import { WATER_LEVEL } from './swamp-route.js';

const hex = value => new THREE.Color(value);
const WALLS = ['#6f8274', '#8b7058', '#6c7482', '#94604b', '#a39a84'].map(hex);
const ROOFS = ['#94603f', '#8d979c', '#6f4b3b', '#7d8a86'].map(hex);
const WOOD = hex('#6e5b48'), PLANK = hex('#8a7862'), DARK = hex('#2b2723'), TRIM = hex('#d8d0bb');
const LIGHT = ['#ffcf7a', '#ffc46a', '#ffd990'].map(hex);

const Y = new THREE.Vector3(0, 1, 0);

// Local frame: +x points away from the road, y is height above the water.
function frame(camp) {
  const origin = positionAt(camp.s, camp.u, WATER_LEVEL), inner = positionAt(camp.s, camp.u - camp.side);
  const out = new THREE.Vector3(origin.x - inner.x, 0, origin.z - inner.z).normalize().applyAxisAngle(Y, camp.yaw);
  // Built a little over life size so the camps read from the overhead views.
  return new THREE.Matrix4().makeBasis(out, Y, new THREE.Vector3().crossVectors(out, Y)).scale(new THREE.Vector3(1.25, 1.25, 1.25)).setPosition(origin.x, origin.y, origin.z);
}

export function campLantern(camp) {
  return new THREE.Vector3(-3.5, camp.floor + 2.05, 2.55).applyMatrix4(frame(camp));
}

// A plank shack on pilings with a porch, dock and jon boat. Returns geometries
// in chunk space: the timber and tin in one, lit windows and the lantern in another.
export function buildSwampCamp(camp, start) {
  const body = new Parts(), glow = new Parts(), r = i => randomAt(camp.index * 13 + i, 4501);
  const floor = camp.floor, wall = WALLS[Math.floor(r(1) * WALLS.length)], roof = ROOFS[Math.floor(r(2) * ROOFS.length)];
  const light = LIGHT[Math.floor(r(3) * LIGHT.length)];
  for (const x of [-3.4, -1.2, 1.2, 3.4]) for (const z of [-2.5, 0, 2.5]) body.box([x, (floor - 1.8) / 2, z], [.26, floor + 1.8, .26], WOOD);
  body.box([0, floor - .1, 0], [7.4, .22, 5.8], PLANK, { top: PLANK.clone().multiplyScalar(1.08) });
  // Uneven weathered boards, with seams that remain visible at road level.
  for (let z = -2.75, i = 0; z < 2.8; z += .32, i++) {
    body.box([-2.5, floor + .022, z], [2.1, .04, .3], PLANK.clone().multiplyScalar(.8 + r(50 + i) * .35));
  }
  // Cabin at the back, porch toward the road.
  const cx = .9, width = 4.6, depth = 4.4, height = 2.6;
  body.box([cx, floor + height / 2, 0], [width, height, depth], wall, { top: wall });
  body.roof([cx, floor + height, 0], width, depth, 1.35, .5, roof);
  for (let z = -depth / 2 - .4; z <= depth / 2 + .4; z += .55) for (const side of [-1, 1]) {
    body.limb([cx, floor + height + 1.37, z], [cx + side * (width / 2 + .5), floor + height - .17, z], .024, .024,
      roof.clone().multiplyScalar(1.15), 3);
  }
  body.box([cx - width / 2 - .02, floor + 1, -1], [.08, 2, .9], DARK);
  for (const [x, z, w, d] of [[cx - width / 2 - .04, 1.1, .08, .95], [cx + width / 2 + .04, -.8, .08, .95], [cx + .9, -depth / 2 - .04, .95, .08], [cx - .6, depth / 2 + .04, .95, .08]]) {
    glow.box([x, floor + 1.45, z], [w, .72, d], light);
    body.box([x, floor + 1.87, z], [Math.max(w, .1) + .1, .1, Math.max(d, .1) + .1], TRIM);
    body.box([x, floor + 1.45, z], [w < .1 ? .11 : .065, .75, d < .1 ? .11 : .065], WOOD);
  }
  body.limb([cx + 1.2, floor + height + .4, 1.2], [cx + 1.2, floor + height + 1.9, 1.2], .12, .12, DARK, 6);
  // Porch rail with a lantern on the corner post.
  for (const z of [-2.7, -.9, .9, 2.7]) body.box([-3.6, floor + .55, z], [.14, 1.1, .14], WOOD);
  body.box([-3.6, floor + 1.08, 0], [.1, .1, 5.5], PLANK);
  body.box([-3.6, floor + 1.4, 2.7], [.12, 1.4, .12], WOOD);
  body.box([-3.5, floor + 2.2, 2.55], [.3, .08, .3], DARK);
  glow.box([-3.5, floor + 2.02, 2.55], [.22, .3, .22], hex('#ffdc8a'));
  // Dock toward the road, with a boat tied alongside.
  const reach = 6 + r(4) * 5;
  body.box([-3.7 - reach / 2, floor - .35, -1.4], [reach, .16, 1.4], PLANK, { top: PLANK.clone().multiplyScalar(1.1) });
  for (let x = -3.85, i = 0; x > -3.7 - reach; x -= .36, i++) {
    body.box([x, floor - .25, -1.4], [.335, .055, 1.45], PLANK.clone().multiplyScalar(.8 + r(80 + i) * .4));
  }
  for (let x = -4.4; x > -3.7 - reach; x -= 2.2) for (const z of [-2.05, -.75]) body.box([x, (floor - .35 - 1.6) / 2, z], [.18, floor + 1.25, .18], WOOD);
  const hull = r(5) < .5 ? hex('#8f989b') : hex('#4d6a50'), bx = -4.4 - reach * .5, bz = .3;
  // Open skiff: pointed bow, raised gunwales, two seats and an outboard.
  const outline = [[-2.15, 0], [-1.2, -.65], [1.7, -.6], [1.7, .6], [-1.2, .65]];
  const inside = [bx, .08, bz];
  for (let i = 0; i < outline.length; i++) {
    const [x, z] = outline[i], [nx, nz] = outline[(i + 1) % outline.length];
    const a = [bx + x, .3, bz + z], b = [bx + nx, .3, bz + nz];
    const low = [bx + x * .87, -.08, bz + z * .7], next = [bx + nx * .87, -.08, bz + nz * .7];
    body.face(a, b, low, hull, inside); body.face(b, next, low, hull, inside);
    body.face(a, low, b, hull.clone().multiplyScalar(.55)); body.face(b, low, next, hull.clone().multiplyScalar(.55));
    body.face([bx, -.05, bz], low, next, DARK, [bx, -1, bz]);
    body.limb(a, b, .04, .04, hull.clone().multiplyScalar(1.2), 4);
  }
  for (const x of [-.65, .65]) body.box([bx + x, .26, bz], [.28, .08, 1.12], PLANK);
  body.limb([bx - .8, .31, bz - .55], [bx - 1.5, floor - .24, -.75], .015, .015, hex('#b8a785'), 3);
  body.box([bx + 1.85, .45, bz], [.35, .6, .3], DARK);
  // Barrels and a crab trap on the porch.
  body.limb([-2.4, floor, 1.9], [-2.4, floor + .9, 1.9], .32, .32, hex('#3d5566'), 7);
  body.limb([-1.7, floor, 2.2], [-1.7, floor + .9, 2.2], .32, .32, hex('#8a4a36'), 7);
  body.box([-2.6, floor + .25, -2.2], [.8, .5, .6], hex('#6f7a64'));
  const matrix = frame(camp).premultiply(new THREE.Matrix4().makeTranslation(0, 0, start));
  const bodyGeometry = body.build().applyMatrix4(matrix), glowGeometry = glow.build().applyMatrix4(matrix);
  bodyGeometry.computeBoundingSphere(); glowGeometry.computeBoundingSphere();
  return { body: bodyGeometry, glow: glowGeometry };
}
