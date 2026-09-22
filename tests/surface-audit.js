import * as THREE from 'three';

// Independent geometric audit: project same-facing coplanar triangles and
// measure their intersection, excluding shared edges and Float32 slivers.
export function coplanarOverlaps(geometry) {
  const pos=geometry.attributes.position, index=geometry.index, buckets=new Map(), out=[];
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), n=new THREE.Vector3(), e=new THREE.Vector3();
  for(let i=0;i<(index?.count??pos.count);i+=3) {
    const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);
    a.fromBufferAttribute(pos,ids[0]); b.fromBufferAttribute(pos,ids[1]); c.fromBufferAttribute(pos,ids[2]);
    n.subVectors(b,a).cross(e.subVectors(c,a)); if(n.length()<1e-9)continue; n.normalize();
    const d=n.dot(a), key=[n.x,n.y,n.z].map(v=>Math.round(v*10000)).join(',')+','+Math.round(d*1000);
    const axis=[Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)].indexOf(Math.max(Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)));
    const axes=[0,1,2].filter(j=>j!==axis), points=[a,b,c].map(v=>axes.map(j=>v.getComponent(j)));
    const tri={i,points,center:a.clone().add(b).add(c).divideScalar(3).toArray(),n:n.toArray(),d};
    tri.min=axes.map((_,j)=>Math.min(...points.map(p=>p[j])));tri.max=axes.map((_,j)=>Math.max(...points.map(p=>p[j])));
    const group=buckets.get(key)??[];if(!buckets.has(key))buckets.set(key,group);
    for(const other of group) {
      if(tri.min.some((v,j)=>v>=other.max[j]-1e-7||tri.max[j]<=other.min[j]+1e-7))continue;
      if(Math.abs(other.d-d)>2e-5)continue;
      const normal=new THREE.Vector3(...other.n);
      if([a,b,c].some(p=>Math.abs(normal.dot(p)-other.d)>1e-5))continue;
      let poly=points;
      const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
      const sign=Math.sign(cross(...other.points));
      for(let k=0;k<3&&poly.length;k++) {
        const q=other.points[k],r=other.points[(k+1)%3],next=[];
        for(let j=0;j<poly.length;j++) {
          const u=poly[j],v=poly[(j+1)%poly.length],du=sign*cross(q,r,u),dv=sign*cross(q,r,v);
          if(du>=0)next.push(u);
          if((du>0&&dv<0)||(du<0&&dv>0)){const t=du/(du-dv);next.push(u.map((x,k)=>x+(v[k]-x)*t));}
        }poly=next;
      }
      const area=Math.abs(poly.reduce((s,p,j)=>{const q=poly[(j+1)%poly.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
      if(area>1e-4)out.push({a:other.i,b:i,area,center:tri.center,normal:tri.n});
    }group.push(tri);
  }return out;
}
