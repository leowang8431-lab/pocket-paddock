import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {CIRCUITS,circuitRecordKey,isCircuitId,type CircuitId} from '../src/circuits.ts';
import {RaceSession,BEST_STORAGE_KEY,WET_BEST_STORAGE_KEY} from '../src/race.ts';
import {roadPose} from '../src/road-pose.ts';
import {createSpaDrsZones,DrsController,withinZone,wrapDistance} from '../src/drs.ts';
import {FleetCar} from '../src/fleet-car.ts';
import {AiRivals} from '../src/ai-rivals.ts';
import {AiRace} from '../src/ai-race.ts';
import {getDriver} from '../src/team-catalog.ts';
import {localizedCorner} from '../src/i18n.ts';
import {SPA_PIT_LAYOUT} from '../src/spa-pit-layout.ts';

const spa=new Track('spa');
const heading=(s:{tangent:{x:number;z:number}})=>Math.atan2(s.tangent.x,s.tangent.z);
const close=(a:number,b:number,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('Spa corner labels retain their identity in both languages instead of falling back to the start straight',()=>{
  assert.equal(localizedCorner('Eau Rouge · 红水弯','en'),'Eau Rouge');
  assert.equal(localizedCorner('Raidillon · 拉迪永上坡','zh'),'Raidillon · 拉迪永上坡');
  assert.equal(localizedCorner('Bus Stop · 巴士站减速弯','en'),'Bus Stop');
  for(const corner of spa.corners)for(const language of ['en','zh'] as const)
    assert.notEqual(localizedCorner(corner.name,language),localizedCorner('起终点直道',language));
  assert.equal(localizedCorner('起终点直道','en'),'Start / finish straight');
});

test('four independent circuit/weather boards persist completed valid laps and preserve the existing Monza keys',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const small={length:240,width:16,checkpoints:[0,40,80,120,160,200]};
  const boards:readonly [CircuitId,'sunny'|'rainy',number][]=[['monza','sunny',2],['monza','rainy',3],['spa','sunny',4],['spa','rainy',5]];
  const sessions:RaceSession[]=[];
  for(const [id,weather,step]of boards){
    const race=new RaceSession({...small,id},storage,weather);assert.equal(race.best,null);
    race.start();race.update(4.5,0,0,1);
    for(let distance=10;distance<=small.length;distance+=10)race.update(step,distance%small.length,0,1);
    assert.deepEqual(race.result,{time:step*24,valid:true,best:true});assert.equal(race.completed,1);
    sessions.push(race);
  }
  assert.equal(values.size,4);
  assert.equal(circuitRecordKey('monza',false),BEST_STORAGE_KEY);
  assert.equal(circuitRecordKey('monza',true),WET_BEST_STORAGE_KEY);
  assert.equal(BEST_STORAGE_KEY,'pocket-paddock.monza.v3.best');assert.equal(WET_BEST_STORAGE_KEY,'pocket-paddock.monza.wet.v2.best');
  for(const [id,weather,step]of boards)assert.equal(new RaceSession({...small,id},storage,weather).best,step*24);
  for(let i=0;i<sessions.length;i++){
    const race=sessions[i],other=boards.find(([id,weather])=>id===race.track.id&&weather!==race.weather)!;
    race.setWeather(other[1]);assert.equal(race.best,other[2]*24);
  }
  assert.equal(new RaceSession(small,storage).best,48,'legacy track objects without an id retain the Monza dry board');
});

test('only the three implemented circuits are accepted and lengths retain their real-reference units',()=>{
  assert.equal(CIRCUITS.monza.realLength,5793);assert.equal(CIRCUITS.spa.realLength,7004);
  for(const value of ['spa','monza','monaco'])assert.equal(isCircuitId(value),true);
  for(const value of ['Spa','silverstone','../../models',null,undefined,1,{}])assert.equal(isCircuitId(value),false);
});

test('road presentation grounds and pitches the car on the actual climb, descent and reversed headings',()=>{
  for(const distance of [560,620,700,850,1650,1900,2180,3100,3700]){
    const s=spa.sampleAt(distance),h=heading(s),forward=roadPose(spa,s.point.x,s.point.z,h),reverse=roadPose(spa,s.point.x,s.point.z,h+Math.PI);
    close(forward.height,spa.heightAt(s.point.x,s.point.z)+.11);
    close(forward.pitch,-Math.atan(spa.gradeAlongHeadingAt(s.point.x,s.point.z,h)));
    close(reverse.height,forward.height);close(reverse.pitch,-forward.pitch);
    const near=spa.nearest(s.point.x,s.point.z),across=heading(near)+Math.PI/2,transverse=roadPose(spa,s.point.x,s.point.z,across),dx=Math.sin(across)*1.55,dz=Math.cos(across)*1.55,actualCrossGrade=(spa.heightAt(s.point.x+dx,s.point.z+dz)-spa.heightAt(s.point.x-dx,s.point.z-dz))/3.1;close(transverse.pitch,-Math.atan(actualCrossGrade));assert.ok(Math.abs(transverse.pitch)<.003,'A transverse wheelbase must remain almost level on the actual curved roadway');
  }
  const flat=new Track();
  assert.deepEqual(roadPose(flat,100,400,1),{height:.11,pitch:0});
  assert.deepEqual(roadPose(undefined,100,400,1),{height:.11,pitch:0});
});

test('the car follows the separate pit ramp pitch instead of borrowing the adjacent main straight slope',()=>{
  const mesh=spa.group.getObjectByName('spa-pit-lane') as THREE.Mesh,road=spa.group.getObjectByName('spa-road') as THREE.Mesh;assert.ok(mesh&&road);spa.group.updateMatrixWorld(true);
  let rampChecks=0;
  for(let i=2;i<spa.pitPath.length-2;i++){
    const p=spa.pitPath[i],x=p.x,z=p.z;
    if(!spa.isPitLane(x,z))continue;
    const before=spa.pitPath[i-1],after=spa.pitPath[i+1];
    const h=Math.atan2(after.x-before.x,after.z-before.z),slope=spa.gradeAlongHeadingAt(x,z,h);
    if(Math.abs(slope)<.045)continue;
    const pose=roadPose(spa,x,z,h);close(pose.height,spa.heightAt(x,z)+.11);
    const ray=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0),0,200),hits=ray.intersectObjects([mesh,road]);
    // A double-precision path sample can land exactly on a clipped Float32
    // triangle seam. A 0.1mm game-space nudge distinguishes rounding at that
    // seam from a genuinely missing section of road.
    if(!hits.length){ray.ray.origin.x+=.0001;hits.push(...ray.intersectObjects([mesh,road]));}
    assert.ok(hits.length,'The actual ramp centre has no rendered road underneath');assert.ok(Math.abs(hits[0].point.y-spa.heightAt(x,z)-.052)<.025,'Visible ramp and grounded car use different heights');
    close(pose.pitch,-Math.atan(slope),1e-6);rampChecks++;
  }
  assert.ok(rampChecks>=4,'both authored ramps expose real nonzero elevation and pitch');
  close(roadPose(spa,SPA_PIT_LAYOUT.fastCenterX,170,0).pitch,0);
});

test('Spa DRS uses the FIA 2025 distances and occupies Kemmel and the pit straight, excluding their braking zones',()=>{
  const zones=createSpaDrsZones(spa),scale=spa.length/7004;
  const corner=(name:string)=>spa.corners.find(c=>c.name.startsWith(name))!.distance;
  assert.equal(zones.length,2);assert.ok(zones.every(z=>z.sourceYear===2025));
  close(wrapDistance(corner('Eau Rouge')-zones[0].detection,spa.length)/scale,240);
  close(wrapDistance(zones[0].start-corner('Raidillon'),spa.length)/scale,305);
  close(wrapDistance(corner('Bus Stop')-zones[1].detection,spa.length)/scale,160);
  // T19's exit is an explicitly authored centreline anchor, 55 real-scaled metres after the T18/T19 label.
  close(wrapDistance(zones[1].start-(corner('Bus Stop')+55*scale),spa.length)/scale,30);
  assert.equal(withinZone(corner('Kemmel'),zones[0],spa.length),true);
  assert.equal(withinZone(corner('Les Combes'),zones[0],spa.length),false);
  assert.equal(withinZone(0,zones[1],spa.length),true);
  for(const name of ['La Source','Eau Rouge','Raidillon','Bus Stop'])assert.equal(zones.some(z=>withinZone(corner(name),z,spa.length)),false,name);
  for(const zone of zones){
    assert.equal(withinZone(zone.start,zone,spa.length),true);assert.equal(withinZone(zone.end,zone,spa.length),false);
    const length=wrapDistance(zone.end-zone.start,spa.length);assert.ok(length>250&&length<500);
    for(let d=zone.start+5;d<zone.start+length-5;d+=9){
      const a=spa.sampleAt(d-3),b=spa.sampleAt(d+3),curve=Math.acos(THREE.MathUtils.clamp(a.tangent.dot(b.tangent),-1,1))/6;
      assert.ok(curve<.03,`${zone.name} crosses a tight corner at ${d}`);
    }
  }
  const controller=new DrsController(zones,spa.length,7004);
  const summary=controller.update({state:'racing',weather:'sunny',distance:zones[0].start-60,speed:25,brake:0,onRoad:true,pitLane:false,forward:1,collision:0});
  assert.equal(summary.distanceToZone,100,'HUD converts game distance into Spa metres');
});

/** CPU-only canvas stub checks actual mesh transforms; browser QA checks rendering. */
function canvas(){
  const result={width:0,height:0,getContext:(_type:string)=>context};
  const context=new Proxy<Record<string,unknown>>({}, {get:(target,key)=>key in target?target[key as string]:(()=>{}),set:(target,key,value)=>{target[key as string]=value;return true;}});
  return result;
}
test('every supplied AI model part shares the player ground transform on the climb and pause freezes the matrices',async()=>{
  const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas()}});
  globalThis.fetch=async input=>{const name=String(input).split('/').at(-1)!;return new Response(await fs.readFile(new URL(`../public/models/${name}`,import.meta.url)));};
  try{
    const player=new FleetCar(),models=new AiRivals(5);models.setGround(spa);await Promise.all([player.load(),models.load()]);
    assert.equal(player.status,'ready');assert.equal(models.status,'ready');
    const race=new AiRace(spa),rival=race.rivals[0];player.select(rival.team,getDriver(rival.driver));
    for(const distance of [600,760,2000]){
      const s=spa.sampleAt(distance);Object.assign(rival,{distance,x:s.point.x,z:s.point.z,heading:heading(s),frontWheelAngle:0});
      models.update([rival],0);player.setRenderPose(models.summary.drivers[0].pose!);
      const pose=roadPose(spa,rival.x,rival.z,rival.heading);player.group.position.set(rival.x,pose.height,rival.z);player.group.rotation.set(pose.pitch,rival.heading,0,'YXZ');player.group.updateMatrixWorld(true);
      const sources:THREE.Mesh[]=[];player.group.traverse(o=>{if(o instanceof THREE.Mesh)sources.push(o);});
      let checked=0;
      models.group.traverse(o=>{
        if(!(o instanceof THREE.Mesh)||(!(o instanceof THREE.InstancedMesh)&&!o.visible))return;
        const source=sources[Number(o.userData.sourceIndex)];assert.ok(source);
        const actual=o instanceof THREE.InstancedMesh?new THREE.Matrix4().fromArray(o.instanceMatrix.array,0):o.matrix;
        actual.elements.forEach((v,i)=>close(v,source.matrixWorld.elements[i],.00015));checked++;
      });
      assert.equal(checked,35);assert.equal(models.summary.trianglesPerCar,27677);
      const before=models.group.children.map(o=>o instanceof THREE.InstancedMesh?Array.from(o.instanceMatrix.array):o.matrix.elements.slice());
      models.update([rival],0);assert.deepEqual(models.group.children.map(o=>o instanceof THREE.InstancedMesh?Array.from(o.instanceMatrix.array):o.matrix.elements.slice()),before);
    }
  }finally{
    globalThis.fetch=originalFetch;
    if(originalDocument===undefined)delete(globalThis as {document?:Document}).document;
    else Object.defineProperty(globalThis,'document',{configurable:true,value:originalDocument});
  }
});
