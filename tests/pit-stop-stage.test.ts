import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createPitStopStage,updatePitStopStageTeam} from '../src/pit-stop-stage.ts';
import {PitStopAnimation} from '../src/pit-stop-animation.ts';

const close=(a:number,b:number,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const stage=createPitStopStage();

test('the visible garage facade faces the car sidepod while every stage transform is baked',()=>{
  stage.updateWorldMatrix(true,true);
  const info=stage.userData.pitStage,fascia=stage.getObjectByName(info.garageDoor.fasciaObjectName) as THREE.Mesh;
  assert.ok(fascia instanceof THREE.Mesh);assert.ok(fascia.geometry instanceof THREE.PlaneGeometry);
  const box=new THREE.Box3().setFromObject(fascia,true);close(box.min.x,-5.954);close(box.max.x,-5.954);assert.ok(box.max.z-box.min.z>9);
  const normal=fascia.geometry.attributes.normal;
  for(let i=0;i<normal.count;i++){close(normal.getX(i),1);close(normal.getY(i),0);close(normal.getZ(i),0);}
  assert.deepEqual(stage.position.toArray(),[0,0,0]);assert.deepEqual(stage.quaternion.toArray(),[0,0,0,1]);
  for(const object of stage.children){assert.ok(object instanceof THREE.Mesh);assert.ok(object.matrix.equals(new THREE.Matrix4()),'A hidden parent rotation must not be needed to interpret actual vertices');}
  assert.deepEqual(info.garageDoor.facing,{x:1,y:0,z:0});assert.deepEqual(info.sidepodDirection,{x:-1,z:0});assert.deepEqual(info.carForward,{x:0,z:1});
  close(info.garageDoor.center.x,-6.2);close(info.garageDoor.center.z,0);
});

test('real parking paint remains lengthwise along the +Z car rather than turning with the garage',()=>{
  const info=stage.userData.pitStage,frame=stage.getObjectByName(info.parkingFrameObjectName)!,front=stage.getObjectByName(info.frontWheelMarkersObjectName)!;
  assert.ok(frame&&front);
  const bounds=new THREE.Box3().setFromObject(frame,true),frontBounds=new THREE.Box3().setFromObject(front,true),size=bounds.getSize(new THREE.Vector3());
  assert.ok(size.z>6&&size.x>3&&size.z>size.x*1.8);
  close((bounds.min.x+bounds.max.x)/2,0);assert.ok(bounds.max.y<.03&&bounds.min.y>0);
  assert.ok(frontBounds.min.x<-1.5&&frontBounds.max.x>1.5);close((frontBounds.min.z+frontBounds.max.z)/2,1.5);
  assert.deepEqual(info.parkingForward,{x:0,z:1});assert.equal(info.version,2);
});

test('side-facing fixtures leave the enlarged full crew envelope empty and preserve the scene budget',()=>{
  const info=stage.userData.pitStage,space=info.actionClearance;
  for(const f of info.fixtures){
    const separated=f.maxX<space.minX||f.minX>space.maxX||f.maxZ<space.minZ||f.minZ>space.maxZ;
    assert.ok(separated,`${f.id} enters the crew work envelope`);
  }
  let triangles=0,draws=0;
  stage.traverse(o=>{if(!(o instanceof THREE.Mesh))return;draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    for(const name of ['position','normal']){const a=o.geometry.attributes[name];for(let i=0;i<a.count;i++)assert.ok(Number.isFinite(a.getX(i)+a.getY(i)+a.getZ(i)));}
  });
  assert.equal(info.geometry.triangles,triangles);assert.equal(info.geometry.drawCalls,draws);assert.ok(triangles<40000&&draws<80);
  assert.ok(info.fixtures.find((f:{id:string})=>f.id==='left-tool-trolley').minZ>5.6,'Move the trolley away instead of shrinking workers');
  assert.ok(info.fixtures.find((f:{id:string})=>f.id==='right-air-compressor').maxZ<-5.4);
});

test('actual supplied wheels, complete crew, jacks and hoses clear every rotated fixture throughout the animation',async()=>{
  const bytes=await readFile(new URL('../public/models/car.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const group=new THREE.Group();group.position.y=.11;gltf.scene.scale.setScalar(1.4);group.add(gltf.scene);
  for(const id of ['front-left','front-right','rear-left','rear-right']){
    const pivot=group.getObjectByName(`wheel-${id}`)!;assert.ok(pivot);const spin=new THREE.Group();spin.name=`spin-${id}`;
    for(const child of [...pivot.children])spin.add(child);pivot.add(spin);
  }
  group.updateWorldMatrix(true,true);const rig=new PitStopAnimation({group,status:'ready'}),info=stage.userData.pitStage;
  const solid=info.fixtures.map((f:{id:string;minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number})=>({id:f.id,box:new THREE.Box3(new THREE.Vector3(f.minX,f.minY,f.minZ),new THREE.Vector3(f.maxX,f.maxY,f.maxZ))}));
  for(let tick=0;tick<=80;tick++){
    const time=tick/10;rig.setTime(time);
    for(const object of rig.group.children){
      if(!object.visible)continue;
      const bounds=new THREE.Box3().setFromObject(object,true);
      for(const fixture of solid)assert.equal(bounds.intersectsBox(fixture.box),false,`${time.toFixed(1)}: ${object.name} enters ${fixture.id}`);
    }
  }
  // Use the supplied chassis triangles as the independent contact reference:
  // the old rear jack sat below empty space beneath the tall rear wing.
  const body:THREE.Mesh[]=[];gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh&&object.name.startsWith('body-material'))body.push(object);});
  const point=new THREE.Vector3(),closest=new THREE.Vector3(),triangle=new THREE.Triangle();
  for(const time of [0,.6,.9,1.2,4,6.4,6.8,7.2]){
    rig.setTime(time);
    for(const front of [true,false]){
      const jack=rig.group.getObjectByName(`pit-${front?'front':'rear'}-jack`)!,pad=jack.getObjectByName('pit-jack-contact')!,box=new THREE.Box3().setFromObject(pad,true);
      point.set((box.min.x+box.max.x)/2,box.max.y,(box.min.z+box.max.z)/2);let distance=Infinity;
      for(const mesh of body){const positions=mesh.geometry.attributes.position,index=mesh.geometry.index;for(let i=0;i<(index?.count??positions.count);i+=3){
        triangle.a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);triangle.b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);triangle.c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        triangle.closestPointToPoint(point,closest);const gap=point.distanceTo(closest);if(Number.isFinite(gap))distance=Math.min(distance,gap);
      }}
      assert.ok(distance<.001,`${time}: ${jack.name} is ${distance} from the actual chassis`);
      assert.ok(jack.userData.contact.y<.6,'The saddle must lift the lower chassis rather than the rear wing');
    }
  }
  rig.setTime(7.26);assert.equal(rig.summary.lift,0);
  const bodyFloor=Math.min(...body.map(mesh=>new THREE.Box3().setFromObject(mesh,true).min.y));
  for(const front of [true,false]){const jack=rig.group.getObjectByName(`pit-${front?'front':'rear'}-jack`)!;close(jack.position.z,front?2.65:-2.65);assert.ok(new THREE.Box3().setFromObject(jack.getObjectByName('pit-jack-contact')!,true).max.y<bodyFloor-.02,'Lower the saddle below the complete car before rolling it past the wings');}
  rig.dispose();
});

test('team recolouring preserves all geometry and the real side-facing facade',()=>{
  const geometry=stage.children.filter(o=>o instanceof THREE.Mesh).map(o=>(o as THREE.Mesh).geometry.uuid);
  updatePitStopStageTeam(stage,'#2fbfae','Mercedes');assert.equal(stage.userData.pitStage.teamName,'Mercedes');
  assert.equal(stage.userData.pitStage.color,'#2fbfae');assert.deepEqual(stage.children.filter(o=>o instanceof THREE.Mesh).map(o=>(o as THREE.Mesh).geometry.uuid),geometry);
  const fascia=stage.getObjectByName('pit-stop-garage-door-fascia') as THREE.Mesh;close(fascia.geometry.attributes.normal.getX(0),1);
});
