import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Track} from '../src/track.ts';
import {createMonzaDrsZones,DrsController,MONZA_REAL_LENGTH,withinZone,type DrsContext} from '../src/drs.ts';
import {createDrsWing} from '../src/drs-wing.ts';
import {RaceSession,BEST_STORAGE_KEY,WET_BEST_STORAGE_KEY} from '../src/race.ts';
import {VehiclePhysics} from '../src/physics.ts';

const track=new Track(),zones=createMonzaDrsZones(track);
const context=(changes:Partial<DrsContext>={}):DrsContext=>({state:'racing',weather:'sunny',distance:20,speed:28,brake:0,onRoad:true,pitLane:false,forward:1,collision:0,...changes});
test('FIA 2025 offsets map to Monza straights and the main activation follows the finish line',()=>{
  const scale=track.length/MONZA_REAL_LENGTH;
  assert.equal(zones.length,2);assert.equal(zones[1].start,12*scale);
  assert.ok(zones[0].start>track.corners[4].distance&&zones[0].end<track.corners[6].distance);
  assert.ok(zones[1].detection>track.corners[7].distance&&zones[1].detection<track.length);
  assert.ok(zones[1].end<track.corners[0].distance);
  assert.ok(Math.abs(zones[0].detection-(track.corners[4].distance-95*scale))<1e-8);
  assert.ok(Math.abs(zones[0].start-(track.nearest(195,-207).distance+170*scale))<1e-8);
  assert.ok(zones.every(zone=>zone.sourceYear===2025));
});
test('circular zone checks include the activation and exclude its endpoint across complete laps',()=>{
  assert.equal(withinZone(zones[1].start,zones[1],track.length),true);assert.equal(withinZone(zones[1].end,zones[1],track.length),false);
  assert.equal(withinZone(track.length+20,zones[1],track.length),true);
  assert.equal(withinZone(0,{start:track.length-10,end:10},track.length),true);
});
test('DRS needs a manual request in each zone and braking or leaving closes it immediately',()=>{
  const drs=new DrsController(zones,track.length);assert.equal(drs.toggle(),false);
  assert.equal(drs.update(context()).state,'ready');assert.equal(drs.toggle(),true);assert.equal(drs.summary.active,true);
  assert.equal(drs.update(context({brake:.001})).state,'braking');assert.equal(drs.summary.active,false);
  assert.equal(drs.update(context()).active,false,'releasing the brake cannot reopen the wing automatically');
  drs.toggle();drs.update(context({distance:400}));assert.equal(drs.summary.active,false);
  const next=drs.update(context({distance:zones[0].start+20}));assert.equal(next.zone,1);assert.equal(next.active,false);assert.equal(next.available,true);
  drs.toggle();assert.equal(drs.summary.active,true);drs.toggle();assert.equal(drs.summary.active,false);
});
test('rain, pit lane, grass, slow travel, reversing, impacts and countdown prevent deployment',()=>{
  for(const [changes,state] of [[{weather:'rainy'},'wet'],[{pitLane:true},'offtrack'],[{onRoad:false},'offtrack'],[{speed:8},'slow'],[{forward:-1},'offtrack'],[{collision:.2},'offtrack'],[{state:'countdown'},'closed']] as const){
    const drs=new DrsController(zones,track.length);const s=drs.update(context(changes));assert.equal(s.state,state);assert.equal(drs.toggle(),false);assert.equal(s.active,false);
  }
});
test('the actual supplied rear flap animates independently without losing body triangles',async()=>{
  const bytes=await readFile(new URL('../public/models/car.glb',import.meta.url));
  const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const count=(root:THREE.Object3D)=>{let triangles=0;root.traverse(o=>{if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;});return triangles;};
  const before=count(asset.scene),hinge=createDrsWing(asset.scene);assert.ok(hinge.userData.triangles>8);assert.equal(count(asset.scene),before);
  asset.scene.updateMatrixWorld(true);const closed=new THREE.Box3().setFromObject(hinge,true);
  hinge.rotation.x=-.5;asset.scene.updateMatrixWorld(true);const open=new THREE.Box3().setFromObject(hinge,true);
  assert.ok(open.max.y>closed.max.y+.005);assert.ok(Math.abs(open.max.x-closed.max.x)<1e-6);
});
test('new handling records leave previous dry and wet bests untouched',()=>{
  const oldDry='pocket-paddock.monza.v2.best',oldWet='pocket-paddock.monza.wet.v1.best';
  const saved=new Map([[oldDry,'62.925'],[oldWet,'72.541']]),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
  assert.notEqual(BEST_STORAGE_KEY,oldDry);assert.notEqual(WET_BEST_STORAGE_KEY,oldWet);
  assert.equal(new RaceSession(track,storage).best,null);assert.equal(new RaceSession(track,storage,'rainy').best,null);
  assert.equal(saved.get(oldDry),'62.925');assert.equal(saved.get(oldWet),'72.541');
});
test('opposing pedals hold a parked car and braking at a crawl waits before reversing',()=>{
  const road={width:16,surfaceAt:()=> 'asphalt' as const,nearest:(x:number,z:number)=>({point:{x,z},tangent:{x:0,z:1},distance:z})};
  const parked=new VehiclePhysics();for(let i=0;i<120;i++)parked.update(1/120,{throttle:true,brake:true,left:false,right:false},road);assert.equal(parked.speed,0);
  const crawl=new VehiclePhysics();crawl.speed=.5;crawl.vz=.5;for(let i=0;i<12;i++)crawl.update(1/120,{throttle:false,brake:true,left:false,right:false},road);assert.equal(crawl.speed,0);
});
