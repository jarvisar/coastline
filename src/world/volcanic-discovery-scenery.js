import * as THREE from 'three';
import { CHUNK_LENGTH, roadHeight } from './route.js';
import { terrainSampler } from './coastal-assets.js';
import { solidModel, solidSpan } from './colliders.js';
import { lavaMaterial } from './volcanic-materials.js';
import { volcanicDiscoveryAngle } from './volcanic-discovery-platforms.js';
import { FlowSurface } from './volcanic-flow.js';
import { VolcanicParts, volcanicCampEquipment, volcanicDiscoveryAssets as assets, volcanicDiscoveryMaterial as material,
  volcanicDiscoveryLight, volcanicFoundationMaterial, volcanicAntennaMaterial, volcanicBeaconMaterial } from './volcanic-discovery-assets.js';

export function buildVolcanicDiscoveries(chunk, sites) {
  chunk.features.discoveries = [];
  const ground = terrainSampler(chunk.terrain);
  for (const site of sites) {
    if (site.s < chunk.start || site.s >= chunk.start + CHUNK_LENGTH) continue;
    const { s, u, side, kind } = site;
    // Mine openings face the basin and camera even on the left shelf.
    const angle = volcanicDiscoveryAngle(site);
    const root = chunk.at(s, u), cos = Math.cos(angle), sin = Math.sin(angle);
    const point = (x, y, z) => [root.x + x * cos + z * sin, y, root.z + z * cos - x * sin];
    const floor = (x, z) => { const p = point(x, 0, z); return ground(p[0], p[2]) ?? root.y; };
    let base = floor(0, 0);
    function add(name, geometry, paint = material, position = point(0, base, 0), solid = false, scale = [1,1,1]) {
      const mesh = new THREE.InstancedMesh(geometry, paint, 1); mesh.name = name;
      const transform = new THREE.Object3D(); transform.position.set(...position); transform.rotation.y = angle; transform.scale.set(...scale); transform.updateMatrix();
      mesh.setMatrixAt(0, transform.matrix); mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = paint === material || paint === volcanicFoundationMaterial;
      mesh.receiveShadow = mesh.castShadow;
      if (paint === volcanicDiscoveryLight || paint === volcanicBeaconMaterial || paint === lavaMaterial) mesh.userData.ambientOcclusion = false;
      mesh.computeBoundingSphere(); chunk.group.add(mesh);
      if (solid) solidModel(chunk, geometry, position, angle);
      return mesh;
    }
    function owned(name, parts, paint = material, solid = false) {
      const g = parts.finish(); chunk.owned.push(g); return add(name, g, paint, point(0, base, 0), solid);
    }
    // Level pad with a skirt down to the terrain. Sample the skirt densely so it
    // can't bridge a dip.
    function embankment(name, outline, top, flare = 2) {
      const parts = new VolcanicParts(), vertices = [];
      const cx = outline.reduce((sum,p) => sum+p[0],0)/outline.length;
      const cz = outline.reduce((sum,p) => sum+p[1],0)/outline.length;
      const shape = new THREE.Shape(outline.map(([x,z]) => new THREE.Vector2(x,z)));
      const cap = new THREE.ShapeGeometry(shape), positions = cap.attributes.position;
      for (let i=0;i<positions.count;i++) positions.setXYZ(i,positions.getX(i),top-base,positions.getY(i));
      // Mapping the shape's Y to Z reverses its winding on the ground plane.
      if (cap.index) {
        for (let i=0;i<cap.index.count;i+=3) {
          const b=cap.index.getX(i+1); cap.index.setX(i+1,cap.index.getX(i+2)); cap.index.setX(i+2,b);
        }
      }
      cap.computeVertexNormals(); parts.add(cap,[0,0,0],'#514a48');
      const ring=[];
      for(let i=0;i<outline.length;i++) {
        const a=outline[i],b=outline[(i+1)%outline.length],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
        for(let j=0;j<steps;j++) {
          const x=a[0]+(b[0]-a[0])*j/steps,z=a[1]+(b[1]-a[1])*j/steps;
          const length=Math.hypot(x-cx,z-cz),ox=x+(x-cx)/length*flare,oz=z+(z-cz)/length*flare;
          ring.push([[x,top-base,z],[ox,floor(ox,oz)-base-.12,oz]]);
        }
      }
      for(let i=0;i<ring.length;i++) {
        const [a,b]=ring[i],[c,d]=ring[(i+1)%ring.length];
        const face=[a,b,c,c,b,d];
        // Outline winding is allowed in either direction.
        if ((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0) face.reverse();
        vertices.push(...face.flat());
      }
      const skirt=new THREE.BufferGeometry();skirt.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));skirt.computeVertexNormals();
      parts.add(skirt,[0,0,0],'#4e4746');owned(name,parts);
    }
    function footing(halfX, halfZ) {
      const heights = [];
      for(let x=-halfX;x<=halfX;x+=1)for(let z=-halfZ;z<=halfZ;z+=1)heights.push(floor(x,z));
      base = Math.max(...heights) + .08;
      embankment('volcanic-discovery-embankment',[[-halfX,-halfZ],[halfX,-halfZ],[halfX,halfZ],[-halfX,halfZ]],base-.2);
      add('volcanic-discovery-foundation', assets.box, volcanicFoundationMaterial, point(0,base-.1,0), false, [halfX * 2,.2,halfZ * 2]);
    }
    function molten(parts, name) {
      const g = parts.finish(), positions = g.attributes.position, count = positions.count;
      g.setAttribute('heat', new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) =>
        .6 + .15 * Math.sin(positions.getX(i) * .65 + positions.getZ(i) * .41)), 1));
      g.setAttribute('flow', new THREE.Float32BufferAttribute(new Float32Array(count).fill(-1), 1));
      g.setAttribute('flowCoordinates', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      chunk.owned.push(g); add(name, g, lavaMaterial);
    }
    if (kind === 'geothermal-station') {
      footing(6.5, 10.2);
      add('volcanic-geothermal-station', assets.station, material, point(0, base, 0), true);
      add('volcanic-geothermal-lights', assets.stationLights, volcanicDiscoveryLight);
      for (const [x, z, height] of [[3,-2.5,10],[3,4,8.4]]) {
        const p = point(x, base + height, z);
        chunk.features.vents.push({ s, x: p[0], y: p[1], z: p[2], radius: .8, size: .37, steam: true, discovery: kind });
      }
    } else if (kind === 'abandoned-mine') {
      base = Math.max(floor(-1,-3),floor(-1,3),floor(-3,0)) + .03;
      embankment('volcanic-mine-spoil-bank',[[-13,-8],[-10,-11],[7,-12],[10,-6],[10,8],[5,12],[-8,12],[-13,5]],base);
      add('volcanic-abandoned-mine', assets.mine, material, point(0, base, 0), true);
      add('volcanic-mine-glow', assets.mineGlow, volcanicDiscoveryLight);
    } else if (kind === 'research-camp') {
      // Tires, stabilizers and steps sit directly on the shared level yard.
      for (const [geometry,x,z] of [[assets.trailerA,-1.5,-5.5],[assets.trailerB,3,5]]) {
        const height=floor(x,z)-.015;
        add(geometry===assets.trailerA?'volcanic-research-trailer-a':'volcanic-research-trailer-b',geometry,material,point(0,height,0),true);
      }
      base = floor(5.5,-.5)+.05;
      const equipment=volcanicCampEquipment((x,z)=>floor(x,z)-base);
      chunk.owned.push(equipment);add('volcanic-research-camp',equipment,material,point(0,base,0),true);
      const antenna = add('volcanic-research-antenna', assets.antenna, volcanicAntennaMaterial, point(5.5, base + 10, -.5));
      antenna.boundingSphere.radius = Math.max(antenna.boundingSphere.radius, 2.5);
      add('volcanic-research-beacon', assets.beacon, volcanicBeaconMaterial, point(5.5, base + 10.6, -.5));
      const fissure = new VolcanicParts(), rim = new VolcanicParts(), strip=[];
      // One continuous, finely sampled strip that follows the terrain.
      for(let i=0;i<=72;i++) {
        const z=-10+i*.25,x=10+Math.sin((z+10)/2.7*1.8)*.8,width=.14+.06*Math.sin(i*.4);
        strip.push([x-width,floor(x-width,z)-base+.055,z],[x+width,floor(x+width,z)-base+.055,z]);
      }
      const faces=[],surface=new FlowSurface(2,-Infinity),terrain=chunk.terrain.geometry.attributes.position;
      // Clip against the real facets. A triangle spanning a crease can otherwise sink in.
      for(let i=0;i<terrain.count;i+=3) {
        const tri=[];
        for(let j=0;j<3;j++) {
          const dx=terrain.getX(i+j)-root.x,dz=terrain.getZ(i+j)-root.z;
          const x=dx*cos-dz*sin,z=dx*sin+dz*cos;
          tri.push({s:x,u:z,x,y:terrain.getY(i+j)-base,z});
        }
        if(tri.every(p=>p.x<8)||tri.every(p=>p.x>12)||tri.every(p=>p.z<-11)||tri.every(p=>p.z>9))continue;
        surface.add(...tri);
      }
      for(let i=0;i<strip.length-2;i+=2) {
        const outline=[strip[i],strip[i+2],strip[i+3],strip[i+1]].map(([x,,z])=>({s:x,u:z}));
        for(const polygon of surface.project(outline,.055))for(let j=1;j<polygon.length-1;j++) {
          for(const p of [polygon[0],polygon[j],polygon[j+1]])faces.push(p.x,p.y,p.z);
        }
      }
      const crack=new THREE.BufferGeometry();crack.setAttribute('position',new THREE.Float32BufferAttribute(faces,3));crack.computeVertexNormals();
      fissure.add(crack,[0,0,0],'#c54b10');
      for (let i = 0; i < 7; i++) {
        const x = 10 + Math.sin(i * 1.8) * .8, z = -10 + i * 2.7;
        const y = floor(x,z) - base + .13;
        rim.rock([x + .8, y - .1, z], [.7, .45, 1.2], '#443c3f', [0, i, .2]);
      }
      owned('volcanic-research-fissure-rim', rim); molten(fissure, 'volcanic-research-fissure');
    } else if (kind === 'basalt-arch') {
      base = site.roadSpanning ? roadHeight(s) : Math.max(floor(-17,0), floor(17,0)) + .2;
      add('volcanic-basalt-arch', assets.arch);
      // Only the two feet are solid so the channel below stays open.
      for (const x of [-17,17]) {
        const a = point(x,base,-3.5), b = point(x,base,3.5);
        solidSpan(chunk, {x:a[0],z:a[2]}, {x:b[0],z:b[2]}, 4.5);
      }
      const debris = new VolcanicParts();
      const blocks = site.roadSpanning ? [[-20,6,3.6],[19,7,2.5],[22,-5,3],[-20,-5,2]]
        : [[-7,6,3.6],[5,7,2.5],[9,-5,3],[-10,-5,2],[-5,10,1.4]];
      for (const [x,z,size] of blocks) {
        debris.rock([x, floor(x,z) - base + size * .3, z], [size, size * .75, size * 1.3], '#51474a', [.2, x * .3, -.4]);
      }
      owned('volcanic-arch-fallen-blocks', debris);
    }
    chunk.features.discoveries.push({...site,ground:base});
  }
}
