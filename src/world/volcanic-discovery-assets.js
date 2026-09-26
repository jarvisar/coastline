import { joinCoplanarFaces } from './surface-joins.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';
import { volcanicClock } from './volcanic-materials.js';

// Fixtures are baked into a few shared flat-shaded meshes. Local -X faces the road.
export class VolcanicParts {
  constructor() { this.parts = []; this.offsetY = 0; }
  add(source, position, color, rotation = [0, 0, 0]) {
    let g = source;
    if (g.index) { g = source.toNonIndexed(); source.dispose(); }
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(position[0], position[1] + this.offsetY, position[2]);
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8, rotation) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color, rotation); }
  beam(a, b, radius, color, sides = 6) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(radius, radius, direction.length(), sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color);
  }
  rock(p, size, color, rotation = [0, 0, 0]) {
    this.add(new THREE.DodecahedronGeometry(1, 0).scale(...size), p, color, rotation);
  }
  finish() {
    const g = joinCoplanarFaces(mergeGeometries(this.parts)); this.parts.forEach(part => part.dispose());
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}
const iron = '#656a68', edge = '#9b9c8c', dark = '#292c30', rust = '#88503a', ochre = '#b38c51', bone = '#c0b9a4';
const basalt = ['#48444a', '#565157', '#3d3c43', '#61575a'];

function window(p, x, y, z, width = 1.4) {
  p.box([x, y, z], [.12, 1.12, width + .16], edge);
  p.box([x - .08, y, z], [.05, .85, width], '#35454a');
  p.box([x - .12, y, z], [.025, .85, .06], bone);
}
function railing(p, a, b, color = iron) {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]), count = Math.ceil(length / 2.5);
  for (let i = 0; i <= count; i++) {
    const t = i / count, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    p.box([x, a[1] + .55, z], [.13, 1.1, .13], color);
  }
  for (const y of [.55, 1.08]) p.beam([a[0], a[1] + y, a[2]], [b[0], b[1] + y, b[2]], .065, color);
}
function station() {
  const p = new VolcanicParts();
  p.box([1, 2.4, 1], [8, 4.8, 12], '#646b68');
  p.box([1, 4.95, 1], [8.7, .36, 12.7], '#393e41');
  p.box([-3.09, 3.65, 1], [.15, .5, 12], ochre);
  for (const z of [-2.7, 1, 4.7]) window(p, -3.08, 2.5, z, 2);
  // The service side needs detail too, since it faces the camera on some bends.
  p.box([5.08, 3.65, 1], [.12, .5, 12], ochre);
  for (const z of [-2.7, 1, 4.7]) {
    p.box([5.09, 2.4, z], [.12, 1.6, 1.8], dark);
    for (let y=1.8;y<3.1;y+=.25) p.box([5.17,y,z],[.08,.08,1.65],iron);
  }
  p.box([-3.13, 1.28, -4.2], [.14, 2.56, 1.2], dark);
  p.box([-4.5, 3.45, -4.1], [3, .18, 2.5], iron);
  for (const z of [-5.2, -3]) p.box([-5.8, 1.7, z], [.14, 3.4, .14], iron);
  for (let i = 0; i < 3; i++) p.box([-5.8 + i * .7, .14 + i * .17, -4.1], [.8, .28 + i * .34, 2.1], '#817d6d');
  for (const z of [-8.5, 9]) {
    p.beam([-5, 1.5, z], [5.8, 1.5, z], .55, iron, 8);
    p.beam([5.8, 1.5, z], [5.8, 4, z], .55, iron, 8);
    p.beam([5.8, 4, z], [5.8, 4, z > 0 ? 5 : -3], .55, iron, 8);
    p.beam([5.8, 4, z > 0 ? 5 : -3], [4.7, 4, z > 0 ? 5 : -3], .55, iron, 8);
    for (const x of [-4, 0, 4]) {
      p.cylinder([x, 1.5, z], .72, .72, .18, edge, 8, [0, 0, Math.PI / 2]);
      p.box([x, .5, z], [.8, 1, 1.7], '#535052');
    }
    p.beam([-1.6, 1.8, z], [-1.6, 2.7, z], .1, rust);
    p.add(new THREE.TorusGeometry(.47, .08, 4, 8), [-1.6, 2.7, z], '#a45d3e', [Math.PI / 2, 0, 0]);
  }
  for (const [x, z, h] of [[3, -2.5, 10], [3, 4, 8.4]]) {
    p.cylinder([x, 5.7, z], 1.05, 1.35, 2, iron);
    p.cylinder([x, h / 2 + 2, z], .7, .85, h - 4, '#999c91');
    p.cylinder([x, h - .25, z], .94, .94, .35, dark);
    p.cylinder([x, h - .04, z], .66, .66, .07, '#1f2428');
    p.cylinder([x, h - 1.3, z], .78, .78, .55, ochre);
  }
  p.box([-.1, 5.6, 2], [2.3, 1, 2], dark);
  for (let z = 1.3; z < 3; z += .3) p.box([-.1, 6.12, z], [2, .05, .12], iron);
  railing(p, [-2.9, 5.15, -5], [-2.9, 5.15, 7], edge);
  return p.finish();
}
function stationLights() {
  const p = new VolcanicParts();
  for (const z of [-4.2, 1, 5.5]) p.box([-3.22, 3.48, z], [.14, .22, .5], '#ffc174');
  for (const z of [-3.5, 4.5]) p.box([5.22, 3.4, z], [.14, .22, .5], '#eaa65d');
  return p.finish();
}
function mine() {
  const p = new VolcanicParts();
  // The tunnel is extruded into the rock so the entrance is a real recess.
  const outline = [[-12, -2], [-11, 5], [-9, 10], [-5, 12], [0, 11.5], [4, 13], [9, 9], [12, 4], [12, -2],
    [3, -2], [3, 3.2], [1.9, 5], [-1.9, 5], [-3, 3.2], [-3, -2]];
  const shape = new THREE.Shape(outline.map(v => new THREE.Vector2(...v)));
  const rock = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false, curveSegments: 1 });
  const vertices = rock.attributes.position;
  for(let i=0;i<vertices.count;i++) {
    const x=vertices.getX(i),y=vertices.getY(i);
    const wear=Math.min(1,Math.max(0,(Math.abs(x)-3)/5,(y-5)/5));
    vertices.setZ(i,vertices.getZ(i)+wear*.8*Math.sin(x*.43+y*.62));
  }
  rock.computeVertexNormals();p.add(rock, [0, 0, 0], basalt[0], [0, Math.PI / 2, 0]);
  for (const [z, y, size] of [[-8, 4, 5], [8, 4, 5.5], [-4.6, 8.8, 3.1], [3.8, 10, 3]]) {
    p.rock([3.5, y, z], [4.5, size, size * .8], basalt[Math.abs(Math.round(z)) % 4], [.08, z * .06, .1]);
  }
  for (const [z,y,rx,ry,rz] of [[-9,2,3,4,3],[-6,6,3.5,5,4],[0,7,3.8,5,4.5],[6,5,3.5,5,4],[10,1,3,3,3]]) {
    p.rock([7,y,z],[rx,ry,rz],basalt[Math.abs(z)%4],[.13,z*.09,-.16]);
  }
  p.box([6.94, 2.35, 0], [.12, 5, 5.95], '#15171c');
  p.box([3.5, -.05, 0], [7, .12, 5.9], '#25242a');
  for (const x of [-.35, 2.5, 5.5]) {
    for (const z of [-2.65, 2.65]) p.box([x, 1.65, z], [.34, 3.3, .36], '#645045');
    p.beam([x, 3.3, -2.65], [x, 4.65, -1.65], .24, '#756052');
    p.beam([x, 4.65, -1.65], [x, 4.65, 1.65], .24, '#756052');
    p.beam([x, 4.65, 1.65], [x, 3.3, 2.65], .24, '#756052');
  }
  for (let x = -10; x < 7; x += 1.4) p.box([x, .1, 0], [.26, .16, 2.5], '#55453e', [0, x < -6 ? .09 : 0, 0]);
  for (const z of [-.82, .82]) {
    p.box([-1.9, .24, z], [16, .18, .13], rust);
    p.box([-10.6, .26, z - .15], [2, .15, .13], iron, [0, -.17, .04]);
  }
  function cart(x, z, surface) {
    // Tyres sit on the ballast or the rail head. Axles match the 1.64 m rail gauge.
    p.offsetY = surface - .18;
    p.box([x, .65, z], [2.6, .3, 1.85], dark);
    for(const dx of [-.85,.85])p.box([x+dx,.97,z],[.3,.4,1.65],iron);
    p.box([x, 1.25, z], [2.5, .24, 1.8], '#694232');
    for (const dz of [-.85, .85]) p.box([x, 1.8, z + dz], [2.6, 1.3, .15], rust);
    for (const dx of [-1.22, 1.22]) p.box([x + dx, 1.8, z], [.15, 1.3, 1.7], '#744733');
    for (const dx of [-.85, .85]) for (const dz of [-.82, .82]) p.cylinder([x + dx, .53, z + dz], .35, .35, .17, dark, 8, [Math.PI / 2, 0, 0]);
    p.offsetY = 0;
  }
  cart(-5, 0, .33); cart(-7, -5.4, 0);
  p.box([-4.2, 1.8, 8.5], [4.6, 3.6, 5], '#625c51');
  p.box([-4.2, 3.7, 8.5], [5.2, .22, 5.6], '#714d3d');
  for (let z = 6.5; z <= 10.5; z += .5) p.box([-6.53, 1.8, z], [.08, 3.5, .055], '#45413c');
  p.box([-6.59, 1.3, 8.6], [.08, 2.6, 1.5], '#24272b');
  for (const tilt of [-.42, .35]) p.box([-6.67, 1.5, 8.6], [.1, .24, 2.1], '#91816b', [tilt, 0, 0]);
  for (let i = 0; i < 9; i++) p.rock([-2 + Math.sin(i * 3) * 2, .3, (i % 2 ? -1 : 1) * (4 + i * .7)], [.6 + i * .06, .6, .8], basalt[i % 4], [i, i * .2, 0]);
  return p.finish();
}
function mineGlow() {
  const p = new VolcanicParts();
  p.box([6.83, .55, 0], [.04, .1, 1.2], '#b64717');
  p.box([6.82, .62, .6], [.04, .25, .1], '#d36320');
  p.box([4.8,.08,0],[2.3,.035,1.1],'#7e301b');
  return p.finish();
}
function camp(part, ground = () => 0) {
  const p = new VolcanicParts();
  const trailers = [[-1.5, -5.5, 6.8], [3, 5, 7.5]];
  for (const [x, z, length] of part === 'equipment' ? [] : [trailers[part]]) {
    p.box([x, 2.1, z], [4, 3, length], bone);
    p.box([x, 3.7, z], [4.25, .25, length + .2], '#727c79');
    p.box([x - 2.04, 1.3, z], [.06, .48, length], '#747c76');
    p.box([x, .65, z], [3.6, .26, length], dark);
    for (const dz of [-length / 2 + 1.2, length / 2 - 1.2]) {
      window(p, x - 2.07, 2.5, z + dz, 1.3);
      p.box([x+2.06,2.5,z+dz],[.12,1.12,1.46],edge);
      p.box([x+2.14,2.5,z+dz],[.05,.85,1.3],'#35454a');
      for (const dx of [-1.96, 1.96]) p.cylinder([x + dx, .47, z + dz], .47, .47, .27, dark, 8, [0, 0, Math.PI / 2]);
    }
    for(const dx of [-2,2])for(const dz of [-length/2+.6,length/2-.6]) {
      p.box([x+dx,.3,z+dz],[.12,.6,.12],iron);
      p.box([x+dx,.035,z+dz],[.42,.07,.42],'#797268');
    }
    p.box([x - 2.1, 1.9, z], [.1, 2.5, .95], '#8e9486');
    for (let i = 0; i < 2; i++) p.box([x - 3.3 + i * .5, .15 + i * .22, z], [.6, .3 + i * .44, 1.2], iron);
    p.box([x + .4, 3.99, z], [1.3, .4, 1.6], iron);
  }
  if (part !== 'equipment') return p.finish();
  p.offsetY = Math.max(ground(-5.8, 3.1), ground(-5.8, 5.7));
  p.box([-5.8, 1.65, 4.4], [3, .13, 3.4], '#344b58', [0, 0, -.22]);
  for (const z of [3, 3.7, 4.4, 5.1, 5.8]) p.box([-5.8, 1.73, z], [3, .025, .04], '#8a9d9d', [0, 0, -.22]);
  for (const z of [3.1, 5.7]) p.beam([-5.8, ground(-5.8,z) - p.offsetY - .05, z], [-5.8, 1.6, z], .09, iron);
  for (const [x, z] of [[-5, .2], [-5.8, -1.5], [6, -3]]) {
    p.offsetY = ground(x,z);
    p.box([x, .5, z], [1.2, 1, .9], '#8e8062');
    p.box([x, .65, z - .46], [.4, .14, .025], dark);
  }
  p.offsetY = ground(6.6,-8);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    const x = 6.6 + Math.cos(a), z = -8 + Math.sin(a);
    p.beam([x, ground(x,z) - p.offsetY, z], [6.6, 2.1, -8], .06, edge);
  }
  p.box([6.6, 2.3, -8], [.55, .5, .9], ochre);
  p.offsetY = ground(7,-3);
  p.cylinder([7, .3, -3], .55, .75, .6, iron);
  p.beam([7, .6, -3], [7, 2, -3], .06, edge);
  const mx = 5.5, mz = -.5;
  p.offsetY = ground(mx,mz);
  for (const dx of [-.48, .48]) p.beam([mx + dx, 0, mz], [mx + dx * .35, 10, mz], .065, edge);
  for (let y = 1; y < 9; y += 1.5) p.beam([mx - .48*(1-y*.065), y, mz], [mx + .48*(1-(y+1.3)*.065), y + 1.3, mz], .035, iron);
  for (const [dx, dz] of [[-3, -2], [2, -3], [2, 3]]) {
    const y = ground(mx + dx,mz + dz) - p.offsetY;
    p.beam([mx, 7, mz], [mx + dx, y + .1, mz + dz], .022, iron);
    p.box([mx + dx, y + .06, mz + dz], [.35, .24, .35], '#655e56');
  }
  return p.finish();
}
export const volcanicCampEquipment = ground => camp('equipment', ground);
function antenna() {
  const p = new VolcanicParts();
  p.beam([-1.8, 0, 0], [1.8, 0, 0], .065, edge);
  for (const x of [-1.4, -.7, 0, .7, 1.4]) p.beam([x, 0, -.8], [x, 0, .8], .04, edge);
  p.cylinder([0, -.18, 0], .18, .18, .5, dark);
  p.cylinder([0, .3, 0], .055, .055, .6, iron);
  return p.finish();
}
function beacon() {
  const p = new VolcanicParts(); p.cylinder([0, 0, 0], .14, .19, .3, '#ff9b4a'); return p.finish();
}
function arch() {
  const p = new VolcanicParts();
  // Broad facets and a broken upper rim so it reads as eroded basalt.
  const outline = [[-20,-8],[-20,2],[-17,7],[-13,12],[-8,15],[-2,17],[4,16.5],[5.5,14.3],[9,14.8],[14,10],[18,5],[20,-8],
    [12,-8],[12,3],[9,7.5],[4,10.6],[-2,11.4],[-7,9.5],[-11,6],[-13,2],[-13,-8]];
  const shape = new THREE.Shape(outline.map(v => new THREE.Vector2(...v)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 6.5, bevelEnabled: false, curveSegments: 1 });
  const vertices = g.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    vertices.setZ(i, z - 3.25 + .65 * Math.sin(x * .46 + y * .71));
  }
  g.computeVertexNormals(); p.add(g, [0,0,0], basalt[0]);
  for (const [x,y,z,wx,wy,wz] of [[-17,1,0,5,9,5], [16,0,1,5,8,5],[-11,11,1,3.8,4,4],[-4,14.5,1.5,4,2.8,3.8],[10,11,1,4,3.5,4]]) {
    p.rock([x,y,z],[wx,wy,wz],basalt[Math.abs(x)%4],[.1,x*.025,.14]);
  }
  for (const [x,y] of [[-14,7],[-6,13],[4,13],[14,5]]) p.rock([x,y,-2.6],[3.5,2.6,2.4],basalt[1],[.2,x*.05,-.13]);
  p.rock([6, 12.7, 2.3], [2.1, .8, 1.3], '#786158', [.12, .25, -.3]);
  return p.finish();
}

export const volcanicDiscoveryAssets = {
  station: station(), stationLights: stationLights(), mine: mine(), mineGlow: mineGlow(),
  trailerA: camp(0), trailerB: camp(1), antenna: antenna(), beacon: beacon(), arch: arch(), box: new THREE.BoxGeometry(1,1,1),
};
export const volcanicDiscoveryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
export const volcanicDiscoveryLight = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
export const volcanicFoundationMaterial = new THREE.MeshStandardMaterial({ color: '#555254', roughness: 1, flatShading: true });
export const volcanicAntennaMaterial = volcanicDiscoveryMaterial.clone();
volcanicAntennaMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.vertexShader = 'uniform float volcanicTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
    float a = volcanicTime * .18; mat2 spin = mat2(cos(a), sin(a), -sin(a), cos(a));
    objectNormal.xz = spin * objectNormal.xz;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz = spin * transformed.xz;');
};
volcanicAntennaMaterial.customProgramCacheKey = () => 'volcanic-research-antenna-v1';
export const volcanicBeaconMaterial = volcanicDiscoveryLight.clone();
volcanicBeaconMaterial.onBeforeCompile = shader => {
  shader.uniforms.volcanicTime = volcanicClock;
  shader.fragmentShader = 'uniform float volcanicTime;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= .25 + .75 * pow(max(0.0, sin(volcanicTime * 2.2)), 8.0);');
};
volcanicBeaconMaterial.customProgramCacheKey = () => 'volcanic-research-beacon-v1';
registerChunkResources('volcanic-discoveries', { volcanicDiscoveryAssets, volcanicDiscoveryMaterial, volcanicDiscoveryLight,
  volcanicFoundationMaterial, volcanicAntennaMaterial, volcanicBeaconMaterial });
