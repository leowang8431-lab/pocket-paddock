import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';

const track=new Track('spa');

test('Spa paving and grass verges contain upward finite triangles without pinched inverted cells',()=>{
 for(const name of ['spa-road','spa-road-earth-bed','spa-pit-lane','spa-rolling-terrain']){
  const mesh=track.group.getObjectByName(name);assert.ok(mesh instanceof THREE.Mesh,name);
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let triangles=0;
  for(let i=0;i<(index?.count??p.count);i+=3){
   a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
   const normal=new THREE.Vector3().crossVectors(b.sub(a),c.sub(a));
   assert.ok(Number.isFinite(normal.x+normal.y+normal.z),name+' has non-finite geometry');
   assert.ok(normal.y>1e-7,name+' contains an inverted or collapsed top triangle');triangles++;
  }
  assert.ok(triangles>30,name+' is missing');
 }
});

test('pit shoulders blend continuously outside the driving strip rather than dropping off a heightAt classification edge',()=>{
 let checked=0,maxStep=0;
 for(let i=3;i<track.pitPath.length-3;i+=3){
  const p=track.pitPath[i],before=track.pitPath[i-1],after=track.pitPath[i+1];
  const n=new THREE.Vector3(after.z-before.z,0,before.x-after.x).normalize();
  for(const sign of [-1,1]){
   const a=p.clone().addScaledVector(n,sign*6),b=p.clone().addScaledVector(n,sign*6.2);
   if(track.roadProjectionAt(a.x,a.z).gap<19||track.roadProjectionAt(b.x,b.z).gap<19)continue;
   const step=Math.abs(track.terrainHeightAt(a.x,a.z)-track.terrainHeightAt(b.x,b.z));maxStep=Math.max(maxStep,step);checked++;
  }
 }
 assert.ok(checked>35,'Too few separated pit verge probes');
 assert.ok(maxStep<.12,`Pit verge drops ${maxStep} in only 0.2 game units`);
});

test('actual grass, gravel and kerb triangles do not protrude through the independent pit paving',()=>{
 track.group.updateMatrixWorld(true);
 const ground=track.group.children.filter(o=>o instanceof THREE.Mesh&&/^spa-(rolling-terrain|road-earth-bed|gravel-|red-yellow-kerb-|kerb-shoulder-)/.test(o.name));
 let checked=0;
 for(let i=3;i<track.pitPath.length-3;i+=5){
  const p=track.pitPath[i],a=track.pitPath[i-1],b=track.pitPath[i+1],normal=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();
  for(const offset of [-4,0,4]){
   const point=p.clone().addScaledVector(normal,offset);if(track.roadProjectionAt(point.x,point.z).gap<track.width/2+.5)continue;
   const hits=new THREE.Raycaster(new THREE.Vector3(point.x,100,point.z),new THREE.Vector3(0,-1,0),0,200).intersectObjects(ground);
   assert.ok(hits.every(hit=>hit.point.y<p.y+.025),`Ground furniture covers the pit ribbon at ${point.x},${point.z}`);checked++;
  }
 }
 assert.ok(checked>60);
});
