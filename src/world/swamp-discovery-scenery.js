import * as THREE from 'three';
import { positionAt, lerp, smoothstep } from './route.js';
import { WATER_LEVEL, swampRoadHeight } from './swamp-route.js';
import { CHAPEL_DRIVE, CHAPEL_LOT_EDGE, chapelDriveEnd } from './swamp-discoveries.js';
import { campLantern } from './swamp-camps.js';
import { SWAMP_LANDMARKS } from './swamp-discovery-assets.js';

const Y = new THREE.Vector3(0, 1, 0);

// Model space to route space for the hollow cypress, chapel and riverboat.
// The chapel carries its own origin on its lawn, square to the road.
export function landmarkMatrix(site) {
  const p = site.origin ? { x: site.origin[0], y: site.origin[1], z: site.origin[2] } : positionAt(site.s, site.u, WATER_LEVEL), scale = SWAMP_LANDMARKS[site.kind].scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(Y, site.yaw), new THREE.Vector3(scale, scale, scale));
}

// The light a discovery lends the scene: a camp's lantern, foxfire in the
// hollow, the chapel's lot lamps or the riverboat's forward deck.
export function swampDiscoveryLight(site) {
  if (site.kind === 'fishing-camp') return { position: campLantern(site), color: '#ffbf6e', intensity: 90, distance: 26, halo: 1 };
  const { position, ...light } = SWAMP_LANDMARKS[site.kind].light;
  return { ...light, position: new THREE.Vector3(...position).applyMatrix4(landmarkMatrix(site)) };
}

const ASPHALT = new THREE.Color('#3b4045'), SKIRT = new THREE.Color('#5d5f59'), CENTER = new THREE.Color('#d8b03c'), STOP = new THREE.Color('#dcdad0');

// The chapel's drive, in chunk space. The road can bend enough over the lot
// that a straight model would miss the shoulder, so the road end follows the
// real shoulder and the far end meets the lot square. It falls from the road
// to the lawn across the verge, with skirts to hide the fill beneath.
export function chapelDrive(site, start) {
  const matrix = landmarkMatrix(site), [d0, d1] = CHAPEL_DRIVE, positions = [], colors = [];
  const across = Array.from({ length: 7 }, (_, i) => lerp(d0, d1, i / 6)), along = [0, .07, .14, .22, .32, .45, .62, .8, 1];
  const ends = across.map(z => {
    const lot = new THREE.Vector3(CHAPEL_LOT_EDGE, .05, z).applyMatrix4(matrix), s = chapelDriveEnd(site, z);
    const road = positionAt(s, 6.1, swampRoadHeight(s) + .045);
    return { road: new THREE.Vector3(road.x, road.y, road.z), lot };
  });
  const point = (i, t, lift = 0) => {
    const { road, lot } = ends[i], p = road.clone().lerp(lot, t);
    p.y = lerp(road.y, lot.y, smoothstep(.05, .45, t)) + lift;
    return p;
  };
  const push = (p, color) => { positions.push(p.x, p.y, p.z + start); colors.push(color.r, color.g, color.b); };
  // Wound to face up.
  const face = (a, b, c, color) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    push(a, color); push(b, color); push(c, color);
  };
  const quad = (a, b, c, d, color) => { face(a, b, c, color); face(a, c, d, color); };
  for (let k = 0; k < along.length - 1; k++) {
    const [t0, t1] = [along[k], along[k + 1]];
    for (let i = 0; i < across.length - 1; i++) quad(point(i, t0), point(i + 1, t0), point(i + 1, t1), point(i, t1), ASPHALT);
    // Skirts down the sides, seen from either side.
    for (const i of [0, across.length - 1]) {
      const a = point(i, t0), b = point(i, t1), c = point(i, t0, -.6), d = point(i, t1, -.6);
      for (const [p, q, r] of [[a, b, c], [b, d, c], [a, c, b], [b, c, d]]) { push(p, SKIRT); push(q, SKIRT); push(r, SKIRT); }
    }
    // Centre line, then a stop bar across the lane leaving the lot.
    if (t0 >= .07) {
      const a = point(3, t0, .012), b = point(3, t1, .012), side = point(4, t0).sub(point(3, t0)).setLength(.07);
      quad(a.clone().sub(side), a.clone().add(side), b.clone().add(side), b.clone().sub(side), CENTER);
    }
  }
  const bar = t => [point(0, t, .012).lerp(point(1, t), .3), point(3, t, .012).lerp(point(2, t), .3)];
  const [a, b] = bar(.14), [c, d] = bar(.175);
  quad(a, b, d, c, STOP);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
