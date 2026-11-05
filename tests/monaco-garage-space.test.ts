import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
scenery.group.updateMatrixWorld(true);
function trianglesInGarage(garage:THREE.Object3D){
 const result:THREE.Triangle[]=[],inverse=garage.matrixWorld.clone().invert();
 garage.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const positions=object.geometry.attributes.position,index=object.geometry.index,matrix=inverse.clone().multiply(object.matrixWorld),count=index?.count??positions.count;
  for(let i=0;i<count;i+=3){const point=(j:number)=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+j):i+j).applyMatrix4(matrix);result.push(new THREE.Triangle(point(0),point(1),point(2)));}
 });return result;
}

test('all eight garages gain over thirty percent of actual floor area without narrowing the six-unit lane or working apron',()=>{
 assert.equal(layout.pitBoxes.length,8);assert.equal(layout.pitProfile.fastWidth,6);assert.equal(layout.pitProfile.apronWidth,3.5);
 for(const box of layout.pitBoxes){
  const garage=scenery.group.getObjectByName(`monaco-pit-box-${box.id}`)!;assert.ok(garage);
  const top=trianglesInGarage(garage).filter(t=>[t.a,t.b,t.c].every(p=>Math.abs(p.y-.09)<.00001)&&t.getNormal(new THREE.Vector3()).y>.99),area=top.reduce((sum,t)=>sum+t.getArea(),0);
  const previousPhysicalFloor=3.4*(3-.08);
  assert.ok(area>previousPhysicalFloor*1.30,`Garage ${box.id} has only ${area} units of rendered floor`);
  assert.ok(Math.abs(area-4.05*(3.3-.08))<.0001,'The enlarged floor has missing or duplicate panels');
 }
});

test('each enlarged garage has an uninterrupted two-point-four by two-point-eight car volume with tools and people outside it',()=>{
 const carVolume=new THREE.Box3(new THREE.Vector3(-1.2,.15,-1.4),new THREE.Vector3(1.2,1.85,1.4));
 for(const box of layout.pitBoxes){
  const garage=scenery.group.getObjectByName(`monaco-pit-box-${box.id}`)!;
  for(const triangle of trianglesInGarage(garage))assert.equal(carVolume.intersectsTriangle(triangle),false,`Garage ${box.id} equipment or wall blocks the real car volume: ${JSON.stringify([triangle.a.toArray(),triangle.b.toArray(),triangle.c.toArray()])}`);
  for(let x=-1.15;x<1.2;x+=.23)for(let z=-1.35;z<1.4;z+=.27){
   const origin=garage.localToWorld(new THREE.Vector3(x,.14,z)),hit=new THREE.Raycaster(origin,new THREE.Vector3(0,-1,0),0,.08).intersectObject(garage,true)[0];assert.ok(hit,'The cleared car volume has no continuous garage floor');
  }
 }
});

test('the complete geometry of neighbouring garages never overlaps after the first bay enters the service straight',()=>{
 const reference=scenery.group.getObjectByName('monaco-pit-box-1')!,referenceInverse=reference.matrixWorld.clone().invert(),bounds:THREE.Box3[]=[];
 for(const box of layout.pitBoxes){
  const garage=scenery.group.getObjectByName(`monaco-pit-box-${box.id}`)!,bound=new THREE.Box3();
  garage.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const positions=object.geometry.attributes.position,matrix=referenceInverse.clone().multiply(object.matrixWorld);for(let i=0;i<positions.count;i++)bound.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix));});bounds.push(bound);
 }
 for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++)assert.equal(bounds[i].intersectsBox(bounds[j]),false,`Actual garage ${i+1} and ${j+1} walls, staff or consoles overlap`);
});

test('both maintenance LCDs in every garage are directly visible from that garage entrance through the complete building',()=>{
 for(const box of layout.pitBoxes){
  const garage=scenery.group.getObjectByName(`monaco-pit-box-${box.id}`)!,station=garage.getObjectByName(`monaco-pit-strategy-workstation-${box.id}`)!;
  const entrance=garage.localToWorld(new THREE.Vector3(-.6,1.65,3.2));
  for(const side of [-1,1]){
   const target=station.localToWorld(new THREE.Vector3(side*.43,1.40,-.066)),direction=target.clone().sub(entrance),length=direction.length(),hit=new THREE.Raycaster(entrance,direction.normalize(),0,length+.12).intersectObject(scenery.group,true)[0];
   assert.ok(hit,`Garage ${box.id} has no visible LCD from its entrance`);
   const mesh=hit.object as THREE.Mesh,material=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material) as THREE.MeshStandardMaterial,color=material.color.clone(),attribute=mesh.geometry.attributes.color;
   if(material.vertexColors&&attribute&&hit.face)color.multiply(new THREE.Color().fromBufferAttribute(attribute,hit.face.a));
   assert.ok(Math.hypot(color.r-new THREE.Color(0x123a45).r,color.g-new THREE.Color(0x123a45).g,color.b-new THREE.Color(0x123a45).b)<.0001,`Garage ${box.id} entrance sees a wall or another bay instead of its own LCD`);
  }
 }
});
