import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createHistoricConnectionLayout} from '../src/monza-historic-connection.ts';
import {createHistoricSouthConnectionLayout} from '../src/monza-historic-south-connection.ts';

const track=new Track(),layouts=[createHistoricConnectionLayout(track)!,createHistoricSouthConnectionLayout(track)!];
const polygons=layouts.map(layout=>[
  ...layout.samples.map(sample=>({x:sample.x-sample.right.x*sample.width/2,z:sample.z-sample.right.z*sample.width/2})),
  ...[...layout.samples].reverse().map(sample=>({x:sample.x+sample.right.x*sample.width/2,z:sample.z+sample.right.z*sample.width/2})),
]);
const ground:THREE.Mesh[]=[];track.group.updateMatrixWorld(true);
track.group.traverse(object=>{
  if(object instanceof THREE.Mesh&&!Array.isArray(object.material)&&['monza-ground-runoff','monza-gravel-runoff'].includes(object.material.name))ground.push(object);
});

// Independent winding oracle uses the exact two boundary chains, without the
// clipping implementation or its broader decoration/vegetation footprint.
function interiorDepth(x:number,z:number,polygon:{x:number;z:number}[]):number {
  let winding=0,distance=Infinity;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b.x-a.x)*(z-a.z)-(b.z-a.z)*(x-a.x);
    if(a.z<=z&&b.z>z&&cross>0)winding++;
    if(a.z>z&&b.z<=z&&cross<0)winding--;
    const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
    distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
  }
  return winding?distance:-distance;
}

test('actual sand and green ground triangles leave both historical road footprints empty',()=>{
  assert.equal(ground.length,2,'the two sand strips still share one static draw');
  assert.equal(track.group.userData.historicTerrain.cutouts,2);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),p=new THREE.Vector3();let triangles=0;
  for(const mesh of ground){
    const position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index,count=index?.count??position.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i);b.fromBufferAttribute(position,index?index.getX(i+1):i+1);c.fromBufferAttribute(position,index?index.getX(i+2):i+2);
      for(const weights of [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]){
        p.set(0,0,0).addScaledVector(a,weights[0]).addScaledVector(b,weights[1]).addScaledVector(c,weights[2]);
        assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));
        assert.ok(polygons.every(polygon=>interiorDepth(p.x,p.z,polygon)<.00015),'an actual terrain triangle still protrudes into a historical road');
      }
      triangles++;
    }
  }
  assert.equal(triangles,track.group.userData.historicTerrain.retainedTriangles);
  assert.ok(triangles<25000,'local terrain cuts must not subdivide the complete circuit unnecessarily');
});

test('vertical probes see no sand below either road while the adjacent runoff remains filled',()=>{
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let roadProbes=0,outsideProbes=0;
  for(const [layoutIndex,layout]of layouts.entries())for(let i=1;i<layout.samples.length-1;i+=2){
    const sample=layout.samples[i];
    for(const u of [.1,.3,.5,.7,.9]){
      const offset=(u-.5)*sample.width,x=sample.x+sample.right.x*offset,z=sample.z+sample.right.z*offset;
      if(interiorDepth(x,z,polygons[layoutIndex])<.03)continue;
      ray.set(new THREE.Vector3(x,20,z),down);
      assert.equal(ray.intersectObjects(ground,false).length,0,'sand or green runoff still shares pixels with the opaque road deck');roadProbes++;
    }
    for(const side of [-1,1]){
      const offset=side*(sample.width/2+.4),x=sample.x+sample.right.x*offset,z=sample.z+sample.right.z*offset;
      if(polygons.some(polygon=>interiorDepth(x,z,polygon)>0)||track.roadProjectionAt(x,z).gap>23.3)continue;
      ray.set(new THREE.Vector3(x,20,z),down);
      assert.ok(ray.intersectObjects(ground,false).length>0,'terrain removal enlarged the cut beyond the actual road edge');outsideProbes++;
    }
  }
  assert.ok(roadProbes>300);assert.ok(outsideProbes>25);
});

test('cutting scenic ground preserves every main asphalt vertex, elevation and world UV',()=>{
  const meshes:THREE.Mesh[]=[];
  track.group.traverse(object=>{if(object instanceof THREE.Mesh&&!Array.isArray(object.material)&&object.material.name==='monza-asphalt')meshes.push(object);});
  assert.equal(meshes.length,1);const geometry=meshes[0].geometry,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  assert.equal(position.count,(track.samples.length+1)*2);assert.equal(geometry.index?.count,track.samples.length*6);
  for(let i=0;i<=track.samples.length;i++){
    const sample=track.samples[i%track.samples.length];
    for(const [side,sign]of [[0,-1],[1,1]]){
      const offset=sign*8.15*track.widthAt(sample.distance)/track.width,x=sample.point.x+sample.right.x*offset,z=sample.point.z+sample.right.z*offset,j=i*2+side;
      assert.ok(Math.abs(position.getX(j)-x)<.00004&&Math.abs(position.getZ(j)-z)<.00004);
      assert.ok(Math.abs(position.getY(j)-.045)<1e-8);assert.ok(Math.abs(uv.getX(j)-x/5)<.00001&&Math.abs(uv.getY(j)-z/5)<.00001);
    }
  }
});
