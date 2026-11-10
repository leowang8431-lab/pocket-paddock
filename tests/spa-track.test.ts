import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {VehiclePhysics,type Controls,type PhysicsTrack} from '../src/physics.ts';
import {SPA_PIT_LAYOUT} from '../src/spa-pit-layout.ts';

const spa=new Track('spa');
const empty:Controls={throttle:false,brake:false,left:false,right:false};

test('Spa retains the complete referenced loop, real elevation variation and a continuous flat start',()=>{
 assert.equal(spa.id,'spa');assert.ok(Math.abs(spa.length-4202.4)<1e-6);
 assert.equal(spa.group.userData.spa.realLengthMetres,7004);assert.deepEqual(spa.widthZones,[]);assert.equal(spa.width,11);assert.equal(spa.barrierOffset,24);
 for(const name of ['La Source','Eau Rouge','Raidillon','Les Combes','Bruxelles','Pouhon','Stavelot','Blanchimont','Bus Stop'])assert.ok(spa.corners.some(c=>c.name.startsWith(name)),name);
 const start=spa.sampleAt(0);assert.ok(start.point.distanceTo(new THREE.Vector3(-85,0,100))<1e-9);assert.ok(start.tangent.z<-.999);
 const ys=spa.samples.map(s=>s.point.y);assert.ok(Math.min(...ys)<-26&&Math.max(...ys)>30);assert.ok(Math.max(...ys)-Math.min(...ys)>57);
 for(let d=0;d<spa.length;d+=3.1){
  const a=spa.sampleAt(d),b=spa.sampleAt(d+.1);assert.ok(a.point.distanceTo(b.point)<.102);assert.equal(a.tangent.y,0);assert.ok(Math.abs(a.tangent.length()-1)<1e-9);assert.ok(Number.isFinite(spa.gradeAt(d))&&Math.abs(spa.gradeAt(d))<.20);
 }
 assert.ok(spa.sampleAt(spa.length-.001).point.distanceTo(start.point)<.002);
});

test('Eau Rouge to Raidillon is a real drivable climb and the rendered asphalt follows every centre sample',()=>{
 const low=spa.corners.find(c=>c.name.startsWith('Eau Rouge'))!,top=spa.corners.find(c=>c.name.startsWith('Kemmel'))!;
 assert.ok(spa.sampleAt(top.distance).point.y-spa.sampleAt(low.distance).point.y>32);
 let rising=0;for(let d=low.distance;d<top.distance;d++)if(spa.gradeAt(d)>.04)rising++;assert.ok(rising>260);
 const road=spa.group.getObjectByName('spa-road') as THREE.Mesh;assert.ok(road);const positions=road.geometry.attributes.position;
 for(let i=0;i<spa.samples.length;i+=3){
  const s=spa.samples[i],left=new THREE.Vector3().fromBufferAttribute(positions,i*2),right=new THREE.Vector3().fromBufferAttribute(positions,i*2+1);
  assert.ok(Math.abs(left.y-s.point.y-.045)<.00002&&Math.abs(right.y-s.point.y-.045)<.00002);
  // GPU positions use Float32; absolute precision at the far end is ~0.1 mm.
  assert.ok(Math.abs((left.x+right.x)/2-s.point.x)<.00015&&Math.abs((left.z+right.z)/2-s.point.z)<.00015);
  assert.equal(spa.surfaceAt(s.point.x,s.point.z),'asphalt');
 }
});

test('surface height interpolates road and separate pit ramps continuously without moving the old Monza floor',()=>{
 const mono=new Track();assert.equal(mono.length,1426.4443446817202);assert.equal(mono.heightAt(100,400),0);assert.equal(mono.gradeAt(200),0);assert.equal(mono.gradeAlongHeadingAt(-63,80,1),0);
 for(let d=0;d<spa.length;d+=7.9){const s=spa.sampleAt(d);if(!spa.isPitLane(s.point.x,s.point.z)){assert.ok(Math.abs(spa.heightAt(s.point.x,s.point.z)-s.point.y)<.08);const n=spa.sampleAt(d+.02);assert.ok(Math.abs(spa.heightAt(n.point.x,n.point.z)-spa.heightAt(s.point.x,s.point.z))<.02);}}
 for(const z of [100,140,180,230]){assert.equal(spa.isPitLane(SPA_PIT_LAYOUT.fastCenterX,z),true);assert.ok(Math.abs(spa.heightAt(SPA_PIT_LAYOUT.fastCenterX,z)-SPA_PIT_LAYOUT.serviceY)<.001);}
 const road=new THREE.Box3().setFromObject(spa.group.getObjectByName('spa-road')!);assert.ok(road.max.y-road.min.y>57);
});

test('terrain triangles never cover the asphalt through Eau Rouge and Raidillon',()=>{
 const terrain=spa.group.getObjectByName('spa-rolling-terrain') as THREE.Mesh;assert.ok(terrain);spa.group.updateMatrixWorld(true);
 for(let d=400;d<=950;d+=7){
  const s=spa.sampleAt(d),ray=new THREE.Raycaster(new THREE.Vector3(s.point.x,100,s.point.z),new THREE.Vector3(0,-1,0),0,200),hits=ray.intersectObject(terrain);
  assert.ok(hits.every(h=>h.point.y<s.point.y-.02),`terrain covers road at distance ${d}`);
 }
 spa.group.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const pos=object.geometry.attributes.position;for(let i=0;i<pos.count;i++)assert.ok(Number.isFinite(pos.getX(i)+pos.getY(i)+pos.getZ(i)),object.name);});
});

test('scenery ground height meets the real rolling-terrain mesh rather than floating above its triangles',()=>{
 const terrain=spa.group.getObjectByName('spa-rolling-terrain')!;spa.group.updateMatrixWorld(true);let checked=0;
 for(let i=0;i<spa.samples.length;i+=80)for(const offset of [-48,48]){
  const s=spa.samples[i],x=s.point.x+s.right.x*offset,z=s.point.z+s.right.z*offset;
  const hits=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0),0,200).intersectObject(terrain);
  if(!hits.length)continue;assert.ok(Math.abs(hits[0].point.y-spa.terrainMeshHeightAt(x,z))<.0001);checked++;
 }
 assert.ok(checked>=25);
 // The pit approach bypasses Bus Stop instead of rising across its chicane.
 const bus=spa.corners.find(c=>c.name.startsWith('Bus Stop'))!;
 for(let d=bus.distance-10;d<=bus.distance+10;d++){
  const s=spa.sampleAt(d);assert.equal(spa.isPitLane(s.point.x,s.point.z),false);
 }
});

test('grade gravity slows climbing and aids descending while the barrier still stays at its rendered 24-unit offset',()=>{
 const straight=(grade:number):PhysicsTrack=>({width:11,barrierOffset:24,gradeAlongHeadingAt:()=>grade,nearest:(_x,z)=>({point:{x:0,z},tangent:{x:0,z:1},distance:z}),surfaceAt:()=> 'asphalt'});
 const drive=(grade:number)=>{const v=new VehiclePhysics();v.reset(0,0,0);v.speed=20;v.vz=20;for(let i=0;i<240;i++)v.update(1/120,{...empty,throttle:true},straight(grade));return v;};
 const up=drive(.13),flat=drive(0),down=drive(-.13);assert.ok(up.speed<flat.speed-.3);assert.ok(down.speed>flat.speed+.3);
 const v=new VehiclePhysics();v.reset(25,0,Math.PI/2);v.speed=v.vx=15;
 assert.ok(v.update(1/120,empty,{...straight(0),surfaceAt:()=> 'grass'})>10);
 assert.ok(v.vx<0&&Math.abs(v.x-23.7)<1e-9);
 const corner=spa.corners.find(c=>c.name.startsWith('Raidillon'))!,s=spa.sampleAt(corner.distance);v.reset(s.point.x,s.point.z,Math.atan2(s.tangent.x,s.tangent.z));assert.equal(v.speed,0);assert.equal(v.collision,0);assert.ok(Number.isFinite(spa.heightAt(v.x,v.z)));
});
