import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/volcanic-discoveries';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  // Keep unrelated edits in the shared workspace from reloading a capture.
  await page.routeWebSocket(/.*/, socket => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?seed=${process.env.TEST_WORLD_SEED || 4817}`);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), null, { timeout: 120000 });
  await page.evaluate(() => window.__coastline.changeJourney('volcanic'));
  await page.waitForFunction(() => window.__coastline.journey === 'volcanic' && !window.__coastline.changingJourney);
  await page.addStyleTag({ content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}' });
  const sites = await page.evaluate(async () => {
    const { volcanicDiscoveries, VOLCANIC_DISCOVERY_MILES } = await import('/src/world/volcanic-discoveries.js');
    const all = volcanicDiscoveries(-150000,150000);
    const nearest = filter => all.filter(filter).sort((a,b)=>Math.abs(a.s)-Math.abs(b.s))[0];
    return Object.keys(VOLCANIC_DISCOVERY_MILES).flatMap(kind => [-1,1].map(side=>nearest(s=>s.kind===kind&&s.side===side&&!s.roadSpanning)))
      .concat(nearest(s=>s.roadSpanning));
  });
  assert.ok(sites.every(Boolean));
  for (const site of [...sites, sites[0]]) {
    const record = await page.evaluate(async site => {
      const a = window.__coastline; if (!a.paused) await a.action('pause');
      a.vehicle.s = site.s; a.vehicle.reset(); a.world.update(site.s); a.vehicle.render(1,a.world.origin);
      a.traffic.reset(a.vehicle.route,site.s,'volcanic');a.traffic.render(1,a.world.origin);
      while (a.rendering.viewLabel !== 'Medium view') a.rendering.toggleView();
      a.rendering.snap(); a.rendering.update(a.vehicle.car,10,a.world.origin); a.rendering.resize(); a.world.animate(8.5); a.rendering.render();
      return { ...site, chunks:a.world.chunks.size, geometries:a.rendering.renderer.info.memory.geometries,
        features:[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries || []) };
    },site);
    assert.equal(record.features.filter(s=>s.index===site.index).length,1);
    const label=`${site.kind}-${site.roadSpanning?'road':site.side<0?'left':'right'}`;
    await page.screenshot({path:`${directory}/${label}-drive.png`});
    await page.evaluate(async site => {
      const a=window.__coastline,{volcanicPosition}=await import('/src/world/volcanic-route.js');
      const p=volcanicPosition(site.s,site.u),z=p.z+a.world.origin;
      const feature=[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries || []).find(s=>s.index===site.index);
      const y=feature.ground+(site.kind==='basalt-arch'?5:4);
      const camera=a.rendering.camera,height=site.kind==='basalt-arch'?54:38,aspect=innerWidth/innerHeight;
      camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;
      camera.position.set(p.x-80,y+65,z+95);camera.lookAt(p.x,y,z);camera.updateProjectionMatrix();a.rendering.render();
    },site);
    await page.screenshot({path:`${directory}/${label}-detail.png`});
    // Inspect rear faces as well as the normal ocean-side camera.
    await page.evaluate(async site=>{
      const a=window.__coastline,{volcanicPosition}=await import('/src/world/volcanic-route.js');
      const p=volcanicPosition(site.s,site.u),feature=[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries||[]).find(s=>s.index===site.index);
      const y=feature.ground+4,z=p.z+a.world.origin;
      a.rendering.camera.position.set(p.x+80,y+55,z-95);a.rendering.camera.lookAt(p.x,y,z);a.rendering.render();
    },site);
    await page.screenshot({path:`${directory}/${label}-rear.png`});
    if(site.kind!=='basalt-arch')for(const side of [-1,1]) {
      await page.evaluate(async ({site,side})=>{
        const a=window.__coastline,{volcanicPosition}=await import('/src/world/volcanic-route.js');
        const {volcanicDiscoveryAngle}=await import('/src/world/volcanic-discovery-platforms.js');
        const p=volcanicPosition(site.s,site.u),angle=volcanicDiscoveryAngle(site),cos=Math.cos(angle),sin=Math.sin(angle);
        const feature=[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries||[]).find(s=>s.index===site.index);
        const camera=a.rendering.camera,height=26,aspect=innerWidth/innerHeight,y=feature.ground+3,z=p.z+a.world.origin;
        camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;
        camera.position.set(p.x+side*45*cos+24*sin,y+7,z+24*cos-side*45*sin);
        camera.lookAt(p.x,y,z);camera.updateProjectionMatrix();a.rendering.render();
      },{site,side});
      await page.screenshot({path:`${directory}/${label}-low-${side<0?'front':'rear'}.png`});
    }
    if(site.kind==='research-camp') {
      const animation=await page.evaluate(()=>{
        const a=window.__coastline,mesh=a.rendering.scene.getObjectByName('volcanic-research-antenna');
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};mesh.material.onBeforeCompile(shader);
        const before=shader.uniforms.volcanicTime.value;a.world.animate(16.5);a.rendering.render();
        return {before,after:shader.uniforms.volcanicTime.value};
      });
      assert.deepEqual(animation,{before:8.5,after:16.5});
      await page.screenshot({path:`${directory}/${label}-turned.png`});
    }
    records.push(record);
  }
  assert.ok(records.at(-1).geometries<=records[0].geometries+8);
  const visibility=[];
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for(const site of sites) {
      const views=await page.evaluate(async site=>{
        const THREE=await import('/node_modules/three/build/three.module.js');
        const a=window.__coastline;a.vehicle.s=site.s;a.vehicle.reset();a.world.update(site.s);
        a.traffic.reset(a.vehicle.route,site.s,'volcanic');a.traffic.render(1,a.world.origin);
        a.rendering.scene.updateMatrixWorld(true);
        const names={'geothermal-station':'volcanic-geothermal-station','abandoned-mine':'volcanic-abandoned-mine',
          'research-camp':'volcanic-research-camp','basalt-arch':'volcanic-basalt-arch'};
        const mesh=a.rendering.scene.getObjectByName(names[site.kind]);
        const box=new THREE.Box3().setFromObject(mesh),corners=[];
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z));
        const result=[];
        for(const view of ['Scenic view','Medium view','Close view']) {
          while(a.rendering.viewLabel!==view)a.rendering.toggleView();
          let best={fraction:0,offset:0};
          // Judge a passing encounter, allowing scenery to come into view
          // naturally along the drive rather than pinning it beside the car.
          for(let offset=-140;offset<=140;offset+=20) {
            a.vehicle.s=site.s+offset;a.vehicle.reset();a.vehicle.render(1,a.world.origin);
            a.rendering.snap();a.rendering.update(a.vehicle.car,10,a.world.origin);a.rendering.resize();a.rendering.camera.updateMatrixWorld(true);
            const projected=corners.map(p=>p.clone().project(a.rendering.camera));
            const left=Math.min(...projected.map(p=>p.x)),right=Math.max(...projected.map(p=>p.x));
            const bottom=Math.min(...projected.map(p=>p.y)),top=Math.max(...projected.map(p=>p.y));
            const fraction=Math.max(0,Math.min(1,right)-Math.max(-1,left))*Math.max(0,Math.min(1,top)-Math.max(-1,bottom))/((right-left)*(top-bottom));
            if(fraction>best.fraction)best={fraction,offset};
          }
          result.push({view,...best});
          if(view==='Close view') {
            a.vehicle.s=site.s+best.offset;a.vehicle.reset();a.vehicle.render(1,a.world.origin);a.rendering.snap();a.rendering.update(a.vehicle.car,10,a.world.origin);a.rendering.resize();a.rendering.render();
          }
        }
        return result;
      },site);
      visibility.push({width:viewport.width,kind:site.kind,side:site.side,road:!!site.roadSpanning,views});
      if(viewport.width===390)await page.screenshot({path:`${directory}/${site.kind}-${site.roadSpanning?'road':site.side<0?'left':'right'}-phone-close.png`});
    }
  }
  await writeFile(`${directory}/visibility.json`,JSON.stringify(visibility,null,2));
  console.log('Framing below 50%:',JSON.stringify(visibility.filter(r=>r.views.some(v=>v.fraction<.5))));
  await page.evaluate(()=>window.__coastline.changeJourney('coast'));
  await page.waitForFunction(()=>window.__coastline.journey==='coast'&&!window.__coastline.changingJourney);
  assert.equal(await page.evaluate(()=>!!window.__coastline.rendering.scene.getObjectByName('volcanic-geothermal-station')),false);
  assert.deepEqual(errors,[]);
  await writeFile(`${directory}/report.json`,JSON.stringify({passed:true,records,visibility,errors},null,2));
  console.log(JSON.stringify({passed:true,records:records.map(({features,...r})=>r)},null,2));
} finally { await browser.close(); }
