import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt } from './route.js';
import { SALT_LEVEL, SHOULDER, CAUSEWAY_TOE, saltHeight, poolNear } from './salt-route.js';
import { SALT_LODGE_FORECOURT, saltModelOffset } from './salt-discoveries.js';
import { crustMaterial, discoveryMaterial, mirrorInstanceMaterial, WATER_MIRROR } from './salt-materials.js';
import { saltDiscoveryAssets as assets, SALT_TRAIN_SOLIDS, SALT_LODGE_SOLIDS, SALT_LODGE_PAINT, SALT_ISLAND_DETAILS } from './salt-discovery-assets.js';
import { computeInstanceBounds } from './instance-batches.js';
import { solidBox, solidPost } from './colliders.js';

const transform = new THREE.Object3D();
const TOLA = ['#cda866', '#bc9654', '#d7b877', '#c4a870'].map(hex => new THREE.Color(hex));
const DRIVE = { gravel: new THREE.Color('#d6c8ad'), gravelRut: new THREE.Color('#c2b192'), salt: new THREE.Color('#e7dcc9'), rut: new THREE.Color('#d0c1a5') };
// Across the drive: verge, rut, crown, rut, verge.
const LANES = [[-2.1, -1.35, false], [-1.35, -.85, true], [-.85, .85, false], [.85, 1.35, true], [1.35, 2.1, false]];

function face(target, a, b, c, tint) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) { target.positions.push(p.x, p.y, p.z); target.colors.push(tint.r, tint.g, tint.b); }
}
// Faces of a drive's side wall, wound to face whichever side the camera is on.
function wall(target, a, b, depth, tint) {
  const c = { ...a, y: a.y - depth }, d = { ...b, y: b.y - depth };
  for (const [p, q, r] of [[a, b, c], [b, d, c], [a, c, b], [b, c, d]]) for (const v of [p, q, r]) {
    target.positions.push(v.x, v.y, v.z); target.colors.push(tint.r, tint.g, tint.b);
  }
}

// Graded drive from the causeway shoulder down the embankment, with tyre ruts
// out across the crust to a packed forecourt in front of the porch.
function buildDrive(chunk, site, place) {
  const target = { positions: [], colors: [] }, { s, from, to } = site.drive, side = site.side;
  // Flush with the shoulder, then just clear of the gravel and the crust ridges.
  const height = (t, u) => {
    const cross = Math.abs(u);
    const lift = cross < SHOULDER + .5 ? .045 + (cross - SHOULDER) / .5 * .075 : .12;
    return Math.max(saltHeight(t, u) + lift, SALT_LEVEL + .1);
  };
  const cross = [];
  for (let u = Math.abs(from); u < CAUSEWAY_TOE + .5; u += .5) cross.push(u);
  for (let u = CAUSEWAY_TOE + .5; u < Math.abs(to); u += 2) cross.push(u);
  cross.push(Math.abs(to));
  const point = (ds, u) => chunk.at(s + ds, side * u, height(s + ds, side * u));
  for (let k = 0; k < cross.length - 1; k++) {
    const a = cross[k], b = cross[k + 1], onBank = b <= CAUSEWAY_TOE + .5;
    for (const [low, high, rut] of LANES) {
      const tint = onBank ? (rut ? DRIVE.gravelRut : DRIVE.gravel) : rut ? DRIVE.rut : DRIVE.salt;
      face(target, point(low, a), point(high, a), point(low, b), tint);
      face(target, point(high, a), point(high, b), point(low, b), tint);
    }
    for (const edge of [LANES[0][0], LANES.at(-1)[1]]) wall(target, point(edge, a), point(edge, b), .3, onBank ? DRIVE.gravel : DRIVE.salt);
  }
  // Forecourt: a rounded patch of packed salt, a little darker where the truck turns.
  const [minX, maxX, minZ, maxZ] = SALT_LODGE_FORECOURT, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const rim = Array.from({ length: 20 }, (_, i) => {
    const angle = i / 20 * Math.PI * 2, x = Math.sin(angle), z = Math.cos(angle);
    // Squircle outline so the corners round off.
    const scale = 1 / Math.pow(Math.abs(x) ** 4 + Math.abs(z) ** 4, .25) * (.94 + randomAt(i, site.index * 7 + 9181) * .06);
    const p = place(cx + x * scale * (maxX - minX) / 2, cz + z * scale * (maxZ - minZ) / 2);
    return { x: p.x, y: SALT_LEVEL + .1, z: p.z };
  });
  const middle = place(cx, cz), centre = { x: middle.x, y: SALT_LEVEL + .1, z: middle.z };
  rim.forEach((p, i) => {
    const tint = DRIVE.salt.clone().lerp(DRIVE.rut, .2 + randomAt(i, site.index * 7 + 9182) * .3);
    face(target, centre, p, rim[(i + 1) % rim.length], tint);
    wall(target, p, rim[(i + 1) % rim.length], .2, DRIVE.salt);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(target.colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  chunk.addMesh(g, crustMaterial, 'salt-lodge-drive');
}

export function buildSaltDiscoveries(chunk, sites) {
  chunk.features.discoveries = [];
  for (const site of sites) {
    if (site.s < chunk.start || site.s >= chunk.start + CHUNK_LENGTH) continue;
    const root = chunk.at(site.s, site.u, SALT_LEVEL), mirror = site.flip[0] * site.flip[1];
    const place = (x, z) => { const offset = saltModelOffset(site, x, z); return { x: root.x + offset.x, z: root.z + offset.z }; };
    // One instance, and its reflection when a pool is close enough to show it.
    const model = (name, geometry, reflect, paint = null) => {
      transform.position.set(root.x, root.y, root.z); transform.rotation.set(0, site.yaw, 0); transform.scale.set(1, 1, 1); transform.updateMatrix();
      const copies = [[name, transform.matrix.clone(), discoveryMaterial]];
      if (reflect) copies.push([`${name}-reflection`, new THREE.Matrix4().multiplyMatrices(WATER_MIRROR, transform.matrix), mirrorInstanceMaterial]);
      for (const [label, matrix, material] of copies) {
        const mesh = new THREE.InstancedMesh(geometry, material, 1), real = material === discoveryMaterial;
        mesh.name = label; mesh.setMatrixAt(0, matrix);
        if (paint) mesh.setColorAt(0, paint);
        mesh.castShadow = real; mesh.receiveShadow = real;
        if (!real) mesh.userData.ambientOcclusion = false;
        computeInstanceBounds(mesh); chunk.group.add(mesh);
      }
    };
    const solids = list => {
      for (const solid of list) {
        const p = place(solid.x, solid.z);
        if (solid.radius) solidPost(chunk, p.x, p.z, solid.radius);
        else solidBox(chunk, p.x, p.z, site.yaw + (solid.yaw ?? 0) * mirror, solid.halfWidth, solid.halfLength);
      }
    };
    if (site.kind === 'train-graveyard') {
      model('salt-train-graveyard', assets.train, poolNear(site.s, site.u, 32));
      solids(SALT_TRAIN_SOLIDS);
    } else if (site.kind === 'salt-lodge') {
      const version = site.flip[1] < 0 ? 1 : 0, reflect = poolNear(site.s, site.u, 24);
      model('salt-lodge', assets.lodge[version], reflect);
      model('salt-lodge-paint', assets.lodgePaint[version], reflect, new THREE.Color(SALT_LODGE_PAINT[site.accent]));
      solids(SALT_LODGE_SOLIDS);
      buildDrive(chunk, site, place);
    } else {
      const version = site.flip[0] < 0 ? 1 : 0, details = SALT_ISLAND_DETAILS[site.variant];
      model('salt-cactus-island', assets.islands[site.variant][version], site.lagoon || poolNear(site.s, site.u, site.radius * 1.3 + 12));
      solidPost(chunk, root.x, root.z, details.solid);
      // Tola tufts join the roadside shrub batch.
      details.shrubs.forEach(([x, y, z, size], n) => {
        const p = place(x, z);
        chunk.items.tola.push({ p: [p.x, root.y + y - .05, p.z], r: [0, randomAt(n, site.index + 9191) * 6.3, 0],
          scale: [size, size * (.85 + randomAt(n, site.index + 9192) * .3), size], color: TOLA[n % TOLA.length] });
      });
    }
    chunk.features.discoveries.push({ ...site, ground: SALT_LEVEL });
  }
}
