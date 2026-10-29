import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchStaticChildren,batchStaticScenery} from '../src/render-batches.ts';

function bounds(object:THREE.Object3D){object.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(object,true);}
function sameBounds(a:THREE.Box3,b:THREE.Box3){assert.ok(a.min.distanceTo(b.min)<1e-4);assert.ok(a.max.distanceTo(b.max)<1e-4);}

test('batching static car parts preserves transformed shape, animated groups and live livery material',()=>{
  const car=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:0xff6644});
  car.position.set(7,0,-3);car.rotation.y=.4;
  for(const x of [-1,1]){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.7,.3,2),material);mesh.position.set(x,.5,.2);mesh.rotation.y=x*.15;car.add(mesh);}
  const wheel=new THREE.Group();wheel.position.set(1.4,.5,1);wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.4,12),material));car.add(wheel);
  const before=bounds(car);batchStaticChildren(car);sameBounds(before,bounds(car));
  assert.equal(wheel.parent,car);assert.equal(car.children.filter(o=>o instanceof THREE.Mesh).length,1);
  const body=car.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh;
  assert.equal(body.material,material);material.color.set(0x22aa88);assert.equal((body.material as THREE.MeshStandardMaterial).color.getHex(),0x22aa88);
  wheel.rotation.x=1;assert.equal(wheel.rotation.x,1);assert.equal(wheel.children.length,1);
});

test('spatial scenery batches preserve world bounds, palette and mutable start lamps',()=>{
  const root=new THREE.Group();root.position.set(12,0,-8);root.rotation.y=.3;
  const group=new THREE.Group();group.position.set(2,0,5);group.rotation.y=.8;root.add(group);
  const colors=[0xee7755,0x225544];
  for(let i=0;i<2;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,3,4),new THREE.MeshStandardMaterial({color:colors[i]}));mesh.position.x=i*100;group.add(mesh);}
  const lampMaterial=new THREE.MeshStandardMaterial({color:0x441111});
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.3,8,6),lampMaterial);lamp.name='start-light-0';root.add(lamp);
  const before=bounds(root);batchStaticScenery(root,72);sameBounds(before,bounds(root));
  assert.equal(lamp.parent,root);lampMaterial.color.set(0xff0000);assert.equal(lampMaterial.color.getHex(),0xff0000);
  const batches=root.children.filter(o=>o.name.startsWith('architecture-cell-')) as THREE.Mesh[];
  assert.equal(batches.length,2);assert.ok(batches.every(m=>m.geometry.attributes.color!==undefined&&!m.castShadow));
  const actual=batches.map(m=>new THREE.Color().fromBufferAttribute(m.geometry.getAttribute('color'),0).getHex()).sort();
  assert.deepEqual(actual,[...colors].sort());
});
