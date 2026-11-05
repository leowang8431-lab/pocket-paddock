import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFixedPitReleaseSignal} from '../src/pit-stop-release-signal.ts';

const meshes=(root:THREE.Object3D)=>{const result:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)result.push(o);});return result;};
const close=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const matrices=(root:THREE.Object3D)=>{root.updateWorldMatrix(true,true);const values:number[][]=[];root.traverse(o=>values.push(o.matrixWorld.toArray()));return values;};

test('the release lamp has a real ground-mounted side post and a high cantilever ahead of the car',()=>{
  const signal=createFixedPitReleaseSignal(),root=signal.group;
  assert.equal(root.name,'pit-release-signal');assert.equal(root.userData.mount,'fixed-gantry');assert.deepEqual(root.position.toArray(),[0,0,4.6]);
  const post=root.getObjectByName('pit-release-sidepost'),base=root.getObjectByName('pit-release-post-base'),boom=root.getObjectByName('pit-release-overhead-boom'),panel=root.getObjectByName('pit-release-panel');
  assert.ok(post instanceof THREE.Mesh&&base instanceof THREE.Mesh&&boom instanceof THREE.Mesh&&panel instanceof THREE.Mesh);
  const postBounds=new THREE.Box3().setFromObject(post,true),baseBounds=new THREE.Box3().setFromObject(base,true),boomBounds=new THREE.Box3().setFromObject(boom,true),panelBounds=new THREE.Box3().setFromObject(panel,true);
  assert.ok(postBounds.min.x>2.6&&postBounds.max.x<2.8);assert.ok(baseBounds.min.y<.001&&postBounds.max.y>2.75);
  assert.ok(boomBounds.min.x<0&&boomBounds.max.x>2.7);assert.ok(boomBounds.min.y>2.7);assert.ok(panelBounds.min.y>2.2);
  assert.ok(new THREE.Box3().setFromObject(root,true).min.z>4.3,'The fixed light is ahead of the 4.73-unit car footprint');
  signal.dispose();
});

test('each real mesh leaves the entire forward driving and worker corridor open below two units',()=>{
  const signal=createFixedPitReleaseSignal(),corridor=new THREE.Box3(new THREE.Vector3(-1.2,0,2),new THREE.Vector3(1.2,2,20));
  for(const mesh of meshes(signal.group)){
    assert.equal(new THREE.Box3().setFromObject(mesh,true).intersectsBox(corridor),false,`${mesh.name} blocks the driving corridor`);
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
    for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)));
  }
  const list=meshes(signal.group),triangles=list.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
  assert.ok(triangles<5000&&list.length<20);signal.dispose();
});

test('both faces show the same red or green state and every frame transform remains fixed',()=>{
  const signal=createFixedPitReleaseSignal(),root=signal.group,red=meshes(root).filter(m=>m.name==='pit-release-red-lamp'),green=meshes(root).filter(m=>m.name==='pit-release-green-lamp');
  assert.equal(red.length,2);assert.equal(green.length,2);
  const before=matrices(root),geometry=meshes(root).map(m=>m.geometry.uuid);
  for(const mesh of [...red,...green]){
    close(mesh.getWorldPosition(new THREE.Vector3()).y,2.42);assert.ok(mesh.userData.face==='forward'||mesh.userData.face==='rearward');
  }
  const materialColor=(mesh:THREE.Mesh)=>(mesh.material as THREE.MeshBasicMaterial|THREE.MeshPhysicalMaterial).color.getHex();
  for(const ready of [false,true,false,true,true,false,true,false]){
    signal.setReady(ready);assert.equal(root.userData.ready,ready);assert.equal(root.userData.color,ready?'green':'red');assert.equal(signal.summary.ready,ready);
    assert.ok(red.every(m=>materialColor(m)===(ready?0x213639:0xff584b)));assert.ok(green.every(m=>materialColor(m)===(ready?0x70ec97:0x213639)));
    assert.deepEqual(matrices(root),before);assert.deepEqual(meshes(root).map(m=>m.geometry.uuid),geometry);
  }
  signal.dispose();
});

test('disposing the component frees only its own frame and lamp resources exactly once',()=>{
  const signal=createFixedPitReleaseSignal(),scene=new THREE.Group(),foreignGeometry=new THREE.BoxGeometry(),foreignMaterial=new THREE.MeshStandardMaterial(),foreign=new THREE.Mesh(foreignGeometry,foreignMaterial);
  scene.add(foreign,signal.group);let foreignDisposed=0;foreignGeometry.addEventListener('dispose',()=>foreignDisposed++);foreignMaterial.addEventListener('dispose',()=>foreignDisposed++);
  const geometries=new Set(meshes(signal.group).map(m=>m.geometry)),materials=new Set<THREE.Material>();
  for(const ready of [false,true]){signal.setReady(ready);for(const mesh of meshes(signal.group))for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat);}
  const counts=new Map<string,number>();for(const resource of [...geometries,...materials])resource.addEventListener('dispose',()=>counts.set(resource.uuid,(counts.get(resource.uuid)??0)+1));
  signal.dispose();signal.dispose();signal.setReady(false);
  assert.equal(signal.group.parent,null);assert.equal(signal.group.children.length,0);assert.equal(signal.summary.disposed,true);
  assert.equal(counts.size,geometries.size+materials.size);for(const count of counts.values())assert.equal(count,1);
  assert.equal(foreignDisposed,0);assert.equal(scene.children.length,1);assert.equal(scene.children[0],foreign);
  foreignGeometry.dispose();foreignMaterial.dispose();
});
