import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PitServiceView} from '../src/pit-service-view.ts';

function fixture(){
  const scene=new THREE.Scene(),group=new THREE.Group(),model=new THREE.Group();group.add(model);scene.add(group);group.position.set(-57,3.11,22);group.rotation.y=Math.PI;model.scale.setScalar(1.4);
  const body=new THREE.Mesh(new THREE.BoxGeometry(.65,.28,2.6),new THREE.MeshStandardMaterial({color:0xcc302f}));body.name='provided-body';model.add(body);
  for(const [axle,z]of [['front',.868],['rear',-.868]] as const)for(const side of [-1,1]){
    const id=`${axle}-${side<0?'left':'right'}`,radius=axle==='front'?.335:.36,pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=`wheel-${id}`;spin.name=`spin-${id}`;pivot.position.set(side*.60,radius,z);pivot.add(spin);model.add(pivot);
    const tyre=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,axle==='front'?.305:.355,16),new THREE.MeshStandardMaterial({color:0x202429}));tyre.rotation.z=Math.PI/2;spin.add(tyre);
    const geometry=new THREE.BoxGeometry(.035,.24,.24).toNonIndexed(),colors=new Float32Array(geometry.attributes.position.count*3).fill(.83);geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const detail=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true}));detail.name='wheel-detail-batch';detail.position.x=side*.18;detail.userData.paletteSections=[{material:'paint2',offset:0,count:geometry.attributes.position.count}];spin.add(detail);
  }
  group.updateMatrixWorld(true);return{scene,car:{group,status:'ready' as const}};
}
const wheels=(group:THREE.Object3D)=>{const out:THREE.Object3D[]=[];group.traverse(o=>{if(/^wheel-(front|rear)-(left|right)$/.test(o.name))out.push(o);});return out;};
const markers=(group:THREE.Object3D)=>{const out:THREE.Mesh[]=[];group.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.role==='game-tyre-compound')out.push(o);});return out;};

test('a stop animates the complete car at its actual translated garage pose and platform height',()=>{
  const {scene,car}=fixture(),view=new PitServiceView(car,scene),position=car.group.position.clone(),rotation=car.group.quaternion.clone();
  view.setCurrentCompound('medium');assert.equal(markers(car.group).length,0);
  assert.equal(view.begin('ferrari','hard',3),true);assert.equal(view.summary.rig?.crewCount,16);assert.equal(markers(car.group).length,0);
  const oldBadges:THREE.Object3D[]=[];view.group!.traverse(o=>{if(o.name==='pit-tyre-compound-badge'&&o.parent?.userData.role==='old-wheel')oldBadges.push(o);});
  assert.equal(oldBadges.length,0);assert.equal(view.summary.rig?.oldCompound,'medium','The removed compound must remain the fitted compound without adding visible badges');
  view.setProgress(.4,3);assert.equal(car.group.position.x,position.x);assert.equal(car.group.position.z,position.z);assert.ok(car.group.position.y>3.25);assert.ok(car.group.quaternion.equals(rotation));
  assert.equal(view.group!.position.x,position.x);assert.equal(view.group!.position.z,position.z);assert.equal(view.group!.position.y,3);
  const bounds=new THREE.Box3().setFromObject(view.group!,true);assert.ok(bounds.min.y>=2.999,'Actual crew or tyre vertices fell through the service platform');
  view.setProgress(1,3);car.group.updateMatrixWorld(true);view.group!.updateMatrixWorld(true);
  for(const wheel of wheels(car.group)){
    const id=wheel.name.slice(6),replacement=view.group!.getObjectByName(`pit-new-wheel-${id}`)!;
    assert.ok(wheel.getWorldPosition(new THREE.Vector3()).distanceTo(replacement.getWorldPosition(new THREE.Vector3()))<1e-7,'The fresh tyre did not meet its original real hub');
  }
  view.finish();assert.equal(view.summary.active,false);assert.equal(view.summary.currentCompound,'hard');assert.equal(scene.children.length,1);assert.ok(Math.abs(car.group.position.y-3.11)<1e-8);
  assert.equal(markers(car.group).length,0);assert.equal(view.summary.markerCount,0);
  assert.ok(wheels(car.group).every(w=>w.visible));view.dispose();
});

test('cancelled and repeated services preserve source geometry, old compounds and driving position without accumulating props',()=>{
  const {scene,car}=fixture(),view=new PitServiceView(car,scene),source:THREE.BufferGeometry[]=[];car.group.traverse(o=>{if(o instanceof THREE.Mesh)source.push(o.geometry);});
  const colours=source.filter(g=>g.attributes.color).map(g=>({geometry:g,values:Array.from(g.attributes.color.array)}));let sourceDisposals=0;for(const geometry of source)geometry.addEventListener('dispose',()=>sourceDisposals++);
  view.setCurrentCompound('soft');view.begin('mclaren','wet',3);view.setProgress(.55,3);view.cancel();assert.equal(view.summary.currentCompound,'soft');assert.equal(markers(car.group).length,0);
  car.group.position.set(-113,.11,190);car.group.rotation.y=Math.PI;
  for(let i=0;i<8;i++){assert.equal(view.begin('redbull',i%2?'medium':'wet',0),true);view.setProgress(.5);view.setProgress(.5);view.finish();assert.equal(scene.children.length,1);assert.equal(markers(car.group).length,0);}
  assert.equal(car.group.position.x,-113);assert.equal(car.group.position.z,190);assert.equal(car.group.position.y,.11);assert.equal(sourceDisposals,0);
  for(const proof of colours)assert.deepEqual(Array.from(proof.geometry.attributes.color.array),proof.values,'A preview neutral colour buffer leaked into the real race car');
  view.dispose();view.dispose();assert.equal(markers(car.group).length,0);assert.equal(sourceDisposals,0);assert.ok(wheels(car.group).every(w=>w.visible));
});

test('a model fallback cannot create a partial or detached crew and does not prevent gameplay',()=>{
  const scene=new THREE.Scene(),car={group:new THREE.Group(),status:'fallback' as const},view=new PitServiceView(car,scene);car.group.position.set(12,.11,34);
  assert.equal(view.begin('ferrari','soft'),false);assert.equal(view.summary.active,false);assert.match(view.summary.error!,/not ready/);view.setProgress(.5);view.finish();view.cancel();assert.deepEqual(car.group.position.toArray(),[12,.11,34]);assert.equal(scene.children.length,0);view.dispose();
});
