import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { volcanicDiscoveries, VOLCANIC_DISCOVERY_MILES, volcanicDiscoveryClears } from '../src/world/volcanic-discoveries.js';
import { volcanicPosition, volcanicTerrainHeight, volcanicNaturalTerrainHeight, riftProfile, creekSection } from '../src/world/volcanic-route.js';
import { VolcanicChunk } from '../src/world/volcanic.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';
import { volcanicClock } from '../src/world/volcanic-materials.js';
import { terrainSampler } from '../src/world/coastal-assets.js';

const sites = volcanicDiscoveries(-300000,300000);
test('volcanic discoveries are deterministic, varied, organic, and available on both sides',()=>{
  assert.deepEqual(volcanicDiscoveries(-300000,0).concat(volcanicDiscoveries(0,300000)),sites);
  assert.ok(sites.length>110&&sites.length<180,'about one encounter per 2.5 miles');
  for(const kind of Object.keys(VOLCANIC_DISCOVERY_MILES)) for(const side of [-1,1]) {
    assert.ok(sites.some(s=>s.kind===kind&&s.side===side),`${kind} on side ${side}`);
  }
  for(let i=1;i<sites.length;i++)assert.ok(sites[i].s-sites[i-1].s>900,'landmarks have breathing room');
  assert.ok(new Set(sites.map(s=>Math.round(((s.s%128)+128)%128))).size>15,'anchors are not all on a rigid grid');
  for(const site of [...sites].reverse()) {
    const start=Math.floor(site.s/128)*128;
    assert.deepEqual(volcanicDiscoveries(start,start+128),sites.filter(s=>s.s>=start&&s.s<start+128));
    assert.equal(volcanicDiscoveryClears(site.s,site.u,[site]),false);
    assert.ok(site.s-start>30&&site.s-start<98,'the full discovery footprint fits in its terrain chunk');
  }
  const arches=sites.filter(s=>s.kind==='basalt-arch');
  assert.ok(arches.some(s=>s.roadSpanning));assert.ok(arches.some(s=>!s.roadSpanning));
});

test('all volcano discovery variants survive worker transfer with shared animation materials',()=>{
  for(const kind of Object.keys(VOLCANIC_DISCOVERY_MILES))for(const side of [-1,1]) {
    const site=sites.find(s=>s.kind===kind&&s.side===side&&!s.roadSpanning),original=new VolcanicChunk(Math.floor(site.s/128));
    const expected=structuredClone(original.features),{data,transfers}=packChunk(original);
    const restored=unpackChunk(structuredClone(data,{transfer:transfers}));
    try {
      assert.deepEqual(restored.features,expected);
      assert.equal(restored.features.discoveries.filter(s=>s.index===site.index).length,1);
      for(const mesh of restored.group.children)if(mesh.isMesh) {
        assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite),mesh.name);
        if(mesh.isInstancedMesh)assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
      }
      if(kind==='research-camp') {
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};
        restored.group.getObjectByName('volcanic-research-antenna').material.onBeforeCompile(shader);
        assert.equal(shader.uniforms.volcanicTime,volcanicClock);
        assert.match(shader.vertexShader,/transformed.xz = spin/);
      }
      if(kind==='geothermal-station') {
        assert.equal(restored.features.vents.filter(v=>v.steam).length,2);
        assert.ok(restored.group.getObjectByName('volcanic-smoke').geometry.attributes.smokeKind.array.some(v=>v===1));
      }

    }finally{original.dispose();restored.dispose();}
  }
});

test('road-spanning basalt arches leave the highway clear for driving',()=>{
  const arches=sites.filter(s=>s.roadSpanning).slice(0,8);
  assert.ok(arches.length>=4);
  for(const site of arches) {
    const chunk=new VolcanicChunk(Math.floor(site.s/128));
    try {
      assert.ok(chunk.group.getObjectByName('volcanic-basalt-arch'));
      for(let ds=-12;ds<=12;ds+=3)for(const u of [-5,0,5]) {
        const p=volcanicPosition(site.s+ds,u);
        for(const c of chunk.features.colliders) {
          const dx=p.x-c.x,dz=p.z-c.z;
          if(c.halfWidth!==undefined) {
            const cos=Math.cos(c.heading),sin=Math.sin(c.heading);
            const x=dx*cos+dz*sin,z=dz*cos-dx*sin;
            assert.ok(Math.abs(x)>c.halfWidth+.8||Math.abs(z)>c.halfLength+.8,'supports and debris stay off the roadway');
          }else assert.ok(Math.hypot(dx,dz)>c.reach+.8);
        }
      }
      const mesh=chunk.group.getObjectByName('volcanic-basalt-arch'),matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
      const p=new THREE.Vector3();
      for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
        p.fromBufferAttribute(mesh.geometry.attributes.position,i);
        if(Math.abs(p.x)<7)assert.ok(p.y>7,'the road has ample overhead clearance');
      }
    }finally{chunk.dispose();}
  }
});

test('camp equipment and continuous fissures follow the rendered terrain on both shelves',()=>{
  for(const side of [-1,1])for(const site of sites.filter(s=>s.kind==='research-camp'&&s.side===side).slice(0,6)) {
    const chunk=new VolcanicChunk(Math.floor(site.s/128));
    try {
      const ground=terrainSampler(chunk.terrain),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
      const crack=chunk.group.getObjectByName('volcanic-research-fissure');
      crack.getMatrixAt(0,matrix);
      for(let i=0;i<crack.geometry.attributes.position.count;i++) {
        point.fromBufferAttribute(crack.geometry.attributes.position,i).applyMatrix4(matrix);
        assert.ok(Math.abs(point.y-ground(point.x,point.z)-.055)<.003,`fissure stays on the ground at ${site.s}`);
      }
      for(let i=0;i<crack.geometry.attributes.position.count;i+=3) {
        point.set(0,0,0);
        for(let j=0;j<3;j++)point.add(new THREE.Vector3().fromBufferAttribute(crack.geometry.attributes.position,i+j));
        point.multiplyScalar(1/3).applyMatrix4(matrix);
        assert.ok(Math.abs(point.y-ground(point.x,point.z)-.055)<.003,'fissure faces follow terrain creases between their vertices');
      }
      const equipment=chunk.group.getObjectByName('volcanic-research-camp');
      equipment.getMatrixAt(0,matrix);
      const vertices=equipment.geometry.attributes.position;
      // Each of the three cases is checked against the ground under it.
      for(const [x,z] of [[-5,.2],[-5.8,-1.5],[6,-3]]) {
        let bottom=Infinity;
        for(let i=0;i<vertices.count;i++) {
          if(Math.abs(Math.abs(vertices.getX(i)-x)-.6)<.001 && Math.abs(Math.abs(vertices.getZ(i)-z)-.45)<.001)bottom=Math.min(bottom,vertices.getY(i));
        }
        assert.ok(Number.isFinite(bottom));
        point.set(x,bottom,z).applyMatrix4(matrix);
        assert.ok(Math.abs(point.y-ground(point.x,point.z))<.003,`case at ${x},${z} is grounded at ${site.s}`);
      }
    }finally{chunk.dispose();}
  }
});

test('mine tracks have continuous ballast and station foundations blend into the hillside',()=>{
  for(const kind of ['abandoned-mine','geothermal-station'])for(const side of [-1,1]) {
    for(const site of sites.filter(s=>s.kind===kind&&s.side===side).slice(0,4)) {
      const chunk=new VolcanicChunk(Math.floor(site.s/128));
      try {
        const bank=chunk.group.getObjectByName(kind==='abandoned-mine'?'volcanic-mine-spoil-bank':'volcanic-discovery-embankment');
        const surface=terrainSampler(bank,true);
        if(kind==='abandoned-mine') {
          for(let x=-11.5;x<=0;x+=.5)for(const z of [-.82,.82])assert.ok(Math.abs(surface(x,z))<.001,'ballast supports the entire approach track');
        } else {
          const foundation=chunk.group.getObjectByName('volcanic-discovery-foundation'),matrix=new THREE.Matrix4();
          foundation.getMatrixAt(0,matrix);
          assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(matrix).y-.2)<.001,'concrete is a thin slab');
        }
        const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),ground=terrainSampler(chunk.terrain);
        bank.getMatrixAt(0,matrix);
        const p=bank.geometry.attributes.position;
        let buried=0;
        for(let i=0;i<p.count;i++) {
          point.fromBufferAttribute(p,i).applyMatrix4(matrix);
          if(Math.abs(point.y-ground(point.x,point.z)+.12)<.003)buried++;
        }
        assert.ok(buried>40,'the embankment skirt meets the rendered terrain');
      }finally{chunk.dispose();}
    }
  }
});

test('discovery platforms cut and fill the terrain, agree with driving, and preserve lava banks and chunk seams',()=>{
  let cuts=0,fills=0;
  for(const kind of ['geothermal-station','research-camp','abandoned-mine'])for(const side of [-1,1]) {
    const site=sites.find(s=>s.kind===kind&&s.side===side),index=Math.floor(site.s/128);
    const chunk=new VolcanicChunk(index),ground=terrainSampler(chunk.terrain);
    try {
      for(let ds=-6;ds<=6;ds+=2)for(let du=-5;du<=5;du+=2) {
        const s=site.s+ds,u=site.u+du,p=volcanicPosition(s,u),natural=volcanicNaturalTerrainHeight(s,u);
        cuts+=p.y<natural-.15?1:0;fills+=p.y>natural+.15?1:0;
        assert.ok(Math.abs(ground(p.x,p.z+chunk.start)-p.y)<.3,`visible platform matches driving at ${s},${u}`);
      }
      for(let ds=-40;ds<=40;ds+=2) {
        const s=site.s+ds,rift=riftProfile(s,-1),creek=creekSection(s);
        for(const u of [-rift.near,-rift.near-4,-7,0,7,creek.u])assert.equal(volcanicTerrainHeight(s,u),volcanicNaturalTerrainHeight(s,u),'road and lava contacts retain their original heights');
      }
      for(const s of [chunk.start,chunk.start+128])for(let u=-80;u<=80;u+=2)assert.equal(volcanicTerrainHeight(s,u),volcanicNaturalTerrainHeight(s,u),'no platform step at the streaming boundary');
    }finally{chunk.dispose();}
  }
  assert.ok(cuts>15&&fills>15,'platforms excavate the high ground and fill the low ground');
});

function modelBottom(geometry,x,z,halfX,halfZ) {
  const p=geometry.attributes.position;
  let bottom=Infinity;
  for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<=halfX && Math.abs(p.getZ(i)-z)<=halfZ)bottom=Math.min(bottom,p.getY(i));
  assert.ok(Number.isFinite(bottom),'the tested support exists in the drawn model');
  return bottom;
}

test('parked trailer tires, stabilizers and stairs bear directly on the terrain',()=>{
  for(const side of [-1,1])for(const site of sites.filter(s=>s.kind==='research-camp'&&s.side===side).filter((_,i)=>i%3===0)) {
    const chunk=new VolcanicChunk(Math.floor(site.s/128)),ground=terrainSampler(chunk.terrain);
    try {
      assert.equal(chunk.group.getObjectByName('volcanic-research-trailer-footing'),undefined,'trailers share the terrain yard');
      for(const [name,x,z,length] of [['a',-1.5,-5.5,6.8],['b',3,5,7.5]]) {
        const mesh=chunk.group.getObjectByName(`volcanic-research-trailer-${name}`),matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
        const supports=[[-3.3,0,.31,.61],...[-1.96,1.96].flatMap(dx=>[-length/2+1.2,length/2-1.2].map(dz=>[dx,dz,.14,.48])),
          ...[-2,2].flatMap(dx=>[-length/2+.6,length/2-.6].map(dz=>[dx,dz,.22,.22]))];
        for(const [dx,dz,hx,hz] of supports) {
          const bottom=modelBottom(mesh.geometry,x+dx,z+dz,hx,hz),p=new THREE.Vector3(x+dx,bottom,z+dz).applyMatrix4(matrix);
          const gap=p.y-ground(p.x,p.z);
          assert.ok(gap<.035&&gap>-.08,`${name} support at ${site.s}: ${gap} m from terrain`);
        }
      }
    }finally{chunk.dispose();}
  }
});

test('mine cart wheels meet the ballast or rail heads and the hut has no air gap',()=>{
  for(const side of [-1,1])for(const site of sites.filter(s=>s.kind==='abandoned-mine'&&s.side===side).slice(0,4)) {
    const chunk=new VolcanicChunk(Math.floor(site.s/128));
    try {
      const mesh=chunk.group.getObjectByName('volcanic-abandoned-mine'),bank=chunk.group.getObjectByName('volcanic-mine-spoil-bank');
      const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);chunk.group.updateMatrixWorld(true);
      const surface=terrainSampler(bank,true);
      for(const x of [-7.85,-6.15])for(const z of [-6.22,-4.58]) {
        const bottom=modelBottom(mesh.geometry,x,z,.36,.086);
        assert.ok(Math.abs(bottom-surface(x,z))<.002,'derelict cart wheels touch ballast');
      }
      for(const x of [-5.85,-4.15])for(const z of [-.82,.82]) {
        const bottom=modelBottom(mesh.geometry,x,z,.36,.086);
        // Start just inside the tyre so the ray skips its underside and hits the rail head.
        const p=new THREE.Vector3(x,bottom+.001,z).applyMatrix4(matrix);
        const ray=new THREE.Raycaster(p,new THREE.Vector3(0,-1,0),0,.02),hits=ray.intersectObject(mesh,false);
        assert.ok(hits.some(hit=>hit.face.normal.y>.9&&Math.abs(hit.distance-.001)<.002),'cart wheels line up with both visible rails');
      }
      for(const x of [-6.5,-1.9])for(const z of [6,11])assert.ok(Math.abs(surface(x,z))<.002,'hut walls meet the ballast');
    }finally{chunk.dispose();}
  }
});
