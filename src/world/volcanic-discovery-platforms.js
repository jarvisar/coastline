import { positionAt, roadFrame, randomAt, smoothstep, lerp } from './route.js';

export function volcanicDiscoveryAngle(site) {
  return -roadFrame(site.s).angle + (site.side < 0 && site.kind !== 'abandoned-mine' ? Math.PI : 0)
    + (site.turn ?? 0) + (site.roadSpanning ? 0 : (randomAt(site.index,81207)-.5)*.3);
}

// World x/z back to road s/u by fixed-point iteration.
function coordinates(x, z) {
  let s = -z, u = x - roadFrame(s).x;
  for (let i = 0; i < 10; i++) {
    const p = positionAt(s,u,0);
    s += p.z-z; u += x-p.x;
  }
  return {s,u};
}

export function volcanicPlatformLayout(site, naturalHeight) {
  if (site.kind === 'basalt-arch') return null;
  const origin = positionAt(site.s,site.u,0), angle = volcanicDiscoveryAngle(site);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const ground = (x,z) => {
    const p = coordinates(origin.x+x*cos+z*sin,origin.z+z*cos-x*sin);
    return naturalHeight(p.s,p.u);
  };
  // Pads extend past the model outline so the bank doesn't look like a pedestal.
  const footprints = site.kind === 'geothermal-station' ? [[0,0,10,14]]
    : site.kind === 'research-camp' ? [[0,0,11,14]] : [[-2,0,13,15]];
  const pads = footprints.map(([x,z,halfX,halfZ]) => {
    const samples = [-.65,0,.65].flatMap(dx => [-.65,0,.65].map(dz => ground(x+dx*halfX,z+dz*halfZ))).sort((a,b)=>a-b);
    // Median sample balances cut and fill. Mines use the ground at the scarp face.
    const height = site.kind === 'abandoned-mine' ? ground(-3,0) : samples[4];
    return {x,z,halfX,halfZ,height};
  });
  return {x:origin.x,z:origin.z,cos,sin,pads};
}

export function volcanicPlatformHeight(s,u,natural,sites,protection=1) {
  for (const site of sites) {
    if (!site.platform || Math.abs(s-site.s)>38 || Math.abs(u-site.u)>30) continue;
    const p=positionAt(s,u,0),f=site.platform,dx=p.x-f.x,dz=p.z-f.z;
    const x=dx*f.cos-dz*f.sin,z=dx*f.sin+dz*f.cos;
    for(const pad of f.pads) {
      const qx=Math.abs(x-pad.x)-pad.halfX,qz=Math.abs(z-pad.z)-pad.halfZ;
      const distance=Math.hypot(Math.max(0,qx),Math.max(0,qz));
      // Steeper cut uphill, gentler fill below. Width varies so the edge isn't a clean rectangle.
      const width=(natural>pad.height?4:6)+Math.sin(x*.43+site.index)*.8+Math.sin(z*.31)*.7;
      const weight=(1-smoothstep(0,width,distance))*protection;
      natural=lerp(natural,pad.height,weight);
    }
  }
  return natural;
}
