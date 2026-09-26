import { joinCoplanarFaces } from './surface-joins.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';
import { desertWaterClock } from './desert-river.js';

// Bakes small details into shared flat-shaded meshes.
class Parts {
  constructor() { this.parts = []; }
  add(source, position, color, rotation = [0, 0, 0]) {
    let g = source;
    if (g.index) { g = source.toNonIndexed(); source.dispose(); }
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8, rotation) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color, rotation); }
  beam(a, b, width, color) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(width, width, direction.length(), 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color);
  }
  finish() {
    const g = joinCoplanarFaces(mergeGeometries(this.parts)); this.parts.forEach(part => part.dispose());
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}
const plaster = '#d9bb86', timber = '#765b40', iron = '#696d62', rust = '#975d42';

function fuelStop() {
  const p = new Parts();
  p.box([2, 1.9, 0], [6, 3.8, 10], plaster);
  p.box([2, 3.84, 0], [6.5, .26, 10.5], '#aa7750');
  p.box([2, 4.06, -5], [6.5, .38, .28], plaster);
  p.box([2, 4.06, 5], [6.5, .38, .28], plaster);
  p.box([5.12, 4.06, 0], [.26, .38, 10], plaster);
  p.box([-2.4, 3.38, 0], [3.3, .18, 10.5], '#98794e', [0, 0, -.045]);
  p.box([-4.03, 3.36, 0], [.16, .48, 10.5], '#738276');
  for (const z of [-4.5, 4.5]) p.box([-3.85, 1.62, z], [.17, 3.24, .17], timber);
  for (const z of [-3, 2.7]) {
    p.box([-1.035, 2.12, z], [.1, 1.55, 2.15], '#a48d65');
    p.box([-1.095, 2.12, z], [.06, 1.24, 1.84], '#526660');
    p.box([-1.15, 2.12, z], [.035, 1.24, .065], '#b7aa81');
  }
  p.box([-1.08, 1.22, -.2], [.13, 2.44, 1.15], '#687365');
  p.box([-1.16, 1.63, -.2], [.035, .85, .84], '#3e514e');
  p.box([-4.55, .12, 0], [1.65, .24, 7.3], '#bba780');
  for (const z of [-2.1, 2.1]) {
    p.box([-4.55, .92, z], [.75, 1.6, .8], '#a46a4c');
    p.box([-4.55, 1.99, z], [.89, .67, .94], '#d1c4a0');
    p.box([-5.01, 2.04, z], [.025, .24, .65], '#3e4b46');
    p.box([-5.03, 2.04, z], [.027, .025, .4], '#c7b992');
    p.cylinder([-4.55, 2.51, z], .26, .26, .38, '#dbcfaa');
    const g = new THREE.TorusGeometry(.43, .035, 4, 10, Math.PI * 1.55);
    p.add(g, [-4.55, 1.14, z + .51], '#494c41', [0, 0, .3]);
    p.box([-4.92, 1.65, z + .52], [.13, .33, .09], '#4c5148', [0, 0, -.25]);
  }
  p.box([2.8, 4.2, -2.6], [1.2, .55, 1.1], '#8b8771');
  p.box([-2.1, .66, 4], [.66, .14, 1.8], timber);
  for (const z of [3.3, 4.7]) p.box([-2.1, .29, z], [.12, .58, .12], timber);
  return p.finish();
}

function windTower() {
  const p = new Parts();
  const corners = [[-1,-1], [1,-1], [1,1], [-1,1]];
  for (let i = 0; i < 4; i++) {
    const [x,z] = corners[i], [nx,nz] = corners[(i + 1) % 4];
    p.beam([x * 1.5, 0, z * 1.5], [x * .43, 10.7, z * .43], .075, iron);
    p.box([x * 1.5, .07, z * 1.5], [.65, .3, .65], '#b79a72');
    for (let y = 0; y < 9; y += 3) {
      const a = 1.5 - y * .1, b = 1.5 - (y + 3) * .1;
      p.beam([x*a,y,z*a], [nx*b,y+3,nz*b], .035, iron);
      p.beam([nx*a,y,nz*a], [x*b,y+3,z*b], .035, iron);
      p.beam([x*b,y+3,z*b], [nx*b,y+3,nz*b], .045, iron);
    }
  }
  p.box([0, 9.7, 0], [1.7, .15, 1.7], '#8a785d');
  p.beam([0, .2, 0], [0, 11, 0], .035, rust);
  p.beam([0, 11.15, -.45], [0, 11.15, 3.5], .065, iron);
  p.box([0, 11.42, 3.17], [.075, 1.17, 1.65], '#ac9e7b');
  return p.finish();
}
function windRotor() {
  const p = new Parts();
  // Rotor lies in local XY. The material spins it around its centre.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const x = Math.cos(angle), y = Math.sin(angle);
    p.beam([0, 0, 0], [x * 2.5, y * 2.5, 0], .027, iron);
    p.box([x * 1.87, y * 1.87, 0], [.55, 1.42, .065], i % 3 ? '#b5b19a' : '#948f75', [0, .13, angle - Math.PI / 2]);
  }
  p.cylinder([0, 0, .02], .26, .26, .25, rust, 8, [Math.PI / 2, 0, 0]);
  return p.finish();
}
function trough() {
  const p = new Parts();
  p.box([0, .16, 0], [2.1, .32, 4.6], '#a5a28a');
  for (const x of [-1, 1]) p.box([x, .57, 0], [.16, .94, 4.6], '#9e9f8c');
  for (const z of [-2.22, 2.22]) p.box([0, .57, z], [2, .94, .16], '#9e9f8c');
  p.box([0, .75, 0], [1.83, .03, 4.3], '#74837a');
  p.beam([1.12, .1, -1.4], [1.12, 1.3, -1.4], .055, rust);
  p.beam([1.12, 1.3, -1.4], [.55, 1.3, -1.4], .055, rust);
  return p.finish();
}

function cattleSkull() {
  const p = new Parts(), bone = '#e2d1a5';
  const outline = [[-.4,-.91],[-.61,-.65],[-.69,-.28],[-.51,.1],[-.31,.36],[-.24,1.02],[-.17,1.18],[0,1.08],
    [.17,1.18],[.24,1.02],[.31,.36],[.51,.1],[.69,-.28],[.61,-.65],[.4,-.91]];
  const shape = new THREE.Shape(outline.map(([x,z]) => new THREE.Vector2(x,z)));
  // Real holes with inset floors so the eye and nose cavities look hollow.
  for (const side of [-1,1]) {
    const eye = [[.25,-.49],[.44,-.57],[.56,-.35],[.46,-.11],[.27,-.14]];
    const nose = [[.055,.49],[.17,.71],[.15,1.01],[.055,.93]];
    for (const contour of [eye,nose]) {
      const points = contour.map(([x,z]) => new THREE.Vector2(x*side,z));
      shape.holes.push(new THREE.Path(points));
      const floor = new THREE.ShapeGeometry(new THREE.Shape(points));
      floor.rotateX(Math.PI/2);
      const indices=floor.index;
      for (let i=0;i<indices.count;i+=3) {
        const b=indices.getX(i+1);indices.setX(i+1,indices.getX(i+2));indices.setX(i+2,b);
      }
      p.add(floor,[0,contour===eye?.14:.025,0],'#847559');
    }
  }
  const shell = new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false,steps:1,curveSegments:1});
  const positions = shell.attributes.position;
  for (let i=0;i<positions.count;i++) {
    const x=positions.getX(i),z=positions.getY(i),depth=positions.getZ(i);
    const height=.24+.35*Math.max(0,Math.min(1,(1.1-z)/1.8))-.1*Math.abs(x);
    positions.setXYZ(i,x,height-depth,z);
  }
  // The shape's extrusion axis maps to -Y, preserving outward winding.
  shell.computeVertexNormals(); p.add(shell,[0,0,0],bone);
  for (const side of [-1,1]) {
    const centers = [[side*.48,.44,-.69],[side*1.02,.43,-.83],[side*1.52,.54,-1.06],
      [side*1.88,.79,-1.4],[side*2.04,.97,-1.73]].map(v => new THREE.Vector3(...v));
    const radii = [.21,.18,.135,.08,.008];
    const rings = centers.map((center,i) => {
      const tangent = centers[Math.min(i+1,centers.length-1)].clone().sub(centers[Math.max(0,i-1)]).normalize();
      const normal = new THREE.Vector3(0,1,0).addScaledVector(tangent,-tangent.y).normalize();
      const binormal = tangent.clone().cross(normal);
      return Array.from({length:6},(_,j) => center.clone().addScaledVector(normal,Math.cos(j*Math.PI/3)*radii[i])
        .addScaledVector(binormal,Math.sin(j*Math.PI/3)*radii[i]));
    });
    for (let row=0;row<rings.length-1;row++) {
      const vertices=[];
      for (let i=0;i<6;i++) {
        const j=(i+1)%6,a=rings[row][i],b=rings[row][j],c=rings[row+1][i],d=rings[row+1][j];
        for (const v of [a,b,c,b,d,c]) vertices.push(v.x,v.y,v.z);
      }
      const horn=new THREE.BufferGeometry();horn.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));horn.computeVertexNormals();
      p.add(horn,[0,0,0],row<2?'#bfae89':'#9c8968');
    }
  }
  return p.finish();
}

export const desertDiscoveryAssets = {fuelStop: fuelStop(), windTower: windTower(), windRotor: windRotor(), trough: trough(), skull: cattleSkull(), box: new THREE.BoxGeometry(1,1,1)};
export const desertDiscoveryMaterial = new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: 1});
export const desertFoundationMaterial = new THREE.MeshStandardMaterial({color: '#b49c76', roughness: 1, flatShading: true});
export const desertApronMaterial = new THREE.MeshStandardMaterial({color: '#797669', roughness: 1, side: THREE.DoubleSide});
export const desertRotorMaterial = desertDiscoveryMaterial.clone();
desertRotorMaterial.onBeforeCompile = shader => {
  shader.uniforms.desertTime = desertWaterClock;
  shader.vertexShader = 'uniform float desertTime;\n' + shader.vertexShader;
  const spin = `float angle = desertTime * 0.48; float c = cos(angle), s = sin(angle); mat2 spin = mat2(c, s, -s, c);`;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${spin}\nobjectNormal.xy = spin * objectNormal.xy;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xy = spin * transformed.xy;');
};
desertRotorMaterial.customProgramCacheKey = () => 'desert-windpump-v1';
registerChunkResources('desert-discoveries', {desertDiscoveryAssets, desertDiscoveryMaterial, desertFoundationMaterial, desertApronMaterial, desertRotorMaterial});
