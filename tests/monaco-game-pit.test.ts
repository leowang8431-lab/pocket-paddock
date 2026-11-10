import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createScenery} from '../src/scenery.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {PitLaneController,PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';
import {teams,type TeamId} from '../src/team-catalog.ts';
import {monacoPitIndex} from '../src/monaco-team-pits.ts';
import type {MonacoBarrierSegment} from '../src/monaco-drive-track.ts';
import {RaceSession} from '../src/race.ts';
import {stepPit} from './pit-driving-helper.ts';

const track=new Track('monaco'),scene=createScenery(track);track.barrierSegments.push(...scene.userData.facilityBarrierSegments);track.rebuildBarrierIndex();track.group.updateMatrixWorld(true);scene.updateMatrixWorld(true);
const dt=1/120,halfWidth=1.5,halfLength=2.75;
function enter(pit:PitLaneController,vehicle:VehiclePhysics,team:TeamId){
 const e=pit.entry,tx=Math.sin(e.heading),tz=Math.cos(e.heading);vehicle.reset(e.x-tx*.4,e.z-tz*.4,e.heading);vehicle.speed=30;assert.equal(pit.update(dt,vehicle,team,'hard'),false);
 vehicle.x=e.x+tx*.4;vehicle.z=e.z+tz*.4;const before={x:vehicle.x,z:vehicle.z};assert.equal(pit.update(dt,vehicle,team,'hard'),true);assert.deepEqual({x:vehicle.x,z:vehicle.z},before,'Gate capture teleported the car');
}
type Point={x:number;z:number};
function pointSegment(p:Point,a:Point,b:Point){const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function wallGap(vehicle:VehiclePhysics,wall:MonacoBarrierSegment){
 const c=Math.cos(vehicle.heading),s=Math.sin(vehicle.heading),local=(x:number,z:number)=>({x:c*(x-vehicle.x)-s*(z-vehicle.z),z:s*(x-vehicle.x)+c*(z-vehicle.z)}),a=local(wall.ax,wall.az),b=local(wall.bx,wall.bz),corners=[{x:-halfWidth,z:-halfLength},{x:halfWidth,z:-halfLength},{x:halfWidth,z:halfLength},{x:-halfWidth,z:halfLength}];
 const inside=(p:Point)=>Math.abs(p.x)<=halfWidth&&Math.abs(p.z)<=halfLength;if(inside(a)||inside(b))return-wall.radius;
 const orient=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
 for(let i=0;i<4;i++){const p=corners[i],q=corners[(i+1)%4];if(orient(a,b,p)*orient(a,b,q)<0&&orient(p,q,a)*orient(p,q,b)<0)return-wall.radius;}
 const toRect=(p:Point)=>Math.hypot(Math.max(0,Math.abs(p.x)-halfWidth),Math.max(0,Math.abs(p.z)-halfLength));return Math.min(toRect(a),toRect(b),...corners.map(p=>pointSegment(p,a,b)))-wall.radius;
}
function assertClear(vehicle:VehiclePhysics,ground:number,team:TeamId,frame:number,state:string){
 const c=Math.cos(vehicle.heading),s=Math.sin(vehicle.heading),walls=new Set<MonacoBarrierSegment>();for(const [x,z]of [[0,0],[-halfWidth,-halfLength],[halfWidth,-halfLength],[halfWidth,halfLength],[-halfWidth,halfLength]])for(const wall of track.barrierSegmentsAt(vehicle.x+c*x+s*z,vehicle.z-s*x+c*z))walls.add(wall);
 for(const wall of walls){if(wall.bottom>ground+2.5||wall.top<ground+.1)continue;const gap=wallGap(vehicle,wall);assert.ok(gap>=-1e-6,`${team} frame ${frame} ${state}: complete car overlaps a real wall ${JSON.stringify({x:vehicle.x,z:vehicle.z,heading:vehicle.heading,ground,gap,wall})}`);}
 const origin=new THREE.Vector3(vehicle.x,ground+.5,vehicle.z),hits=new THREE.Raycaster(origin,new THREE.Vector3(0,-1,0),0,1).intersectObject(track.group,true);assert.ok(hits.length,`${team} frame ${frame}: car leaves actual rendered pit floor ${JSON.stringify({x:vehicle.x,z:vehicle.z,heading:vehicle.heading,ground,state,near:track.nearest(vehicle.x,vehicle.z).distance})}`);assert.ok(Math.abs(hits[0].point.y-ground)<.08,`${team} frame ${frame}: ground ${ground} differs from rendered floor ${hits[0].point.y}`);
}

test('all eleven Monaco teams cross the real gate, stop at their assigned apron and drive out manually under 120 km/h',()=>{
 for(const team of teams){
  scene.userData.selectPitTeam(team.id);let draws=0;const pit=new PitLaneController(track,()=>{draws++;return .37;}),vehicle=new VehiclePhysics();enter(pit,vehicle,team.id);const bay=track.monacoDrive!.pitBoxes[monacoPitIndex(team.id)],stop=pit.summary.stop;
  assert.equal(draws,1);assert.ok(pit.summary.serviceDuration>=2&&pit.summary.serviceDuration<=4);assert.ok(Math.hypot(stop.x-bay.apronCenter.x,stop.y-bay.apronCenter.y,stop.z-bay.apronCenter.z)<1e-8);assert.ok(Math.abs(Math.atan2(Math.sin(stop.heading-Math.atan2(bay.tangent.x,bay.tangent.z)),Math.cos(stop.heading-Math.atan2(bay.tangent.x,bay.tangent.z))))<1e-9);
  let frames=0,serviceSteps=0,prior={x:vehicle.x,z:vehicle.z},priorGround=pit.summary.groundHeight;
  while(pit.summary.active&&frames++<24000){const wasService=pit.summary.state==='service';stepPit(pit,vehicle,track,team.id);const summary=pit.summary;assert.ok(vehicle.speed>=0&&vehicle.speed<=PIT_SPEED_LIMIT+1e-9);assert.ok(Math.hypot(vehicle.x-prior.x,vehicle.z-prior.z)<=PIT_SPEED_LIMIT*dt+.003,'The pit route teleported between frames');prior={x:vehicle.x,z:vehicle.z};
   assert.ok(Math.abs(summary.groundHeight-priorGround)<=.08,`${team.id} frame ${frames}: pit height jumps ${summary.groundHeight-priorGround} in one 1/120-second step`);priorGround=summary.groundHeight;
   if(summary.state==='service'){assert.equal(vehicle.speed,0);assert.equal(summary.currentCompound,'medium');assert.ok(Math.hypot(vehicle.x-stop.x,vehicle.z-stop.z)<1e-8);assert.equal(summary.groundHeight,stop.y);}
   if(wasService)serviceSteps++;if(frames%8===0)assertClear(vehicle,summary.groundHeight,team.id,frames,summary.state);
  }
  assert.ok(frames<24000,'Manual pit exit did not finish');assert.equal(draws,1);assert.ok(Math.abs(serviceSteps*dt-pit.summary.serviceDuration)<=dt+1e-8);assert.equal(pit.summary.completedStops,1);assert.equal(pit.summary.currentCompound,'hard');assert.ok(vehicle.speed>0);assert.ok(Math.hypot(vehicle.x-pit.exit.x,vehicle.z-pit.exit.z)<1.2);assert.ok(Math.abs(pit.summary.groundHeight-pit.exit.y)<.1);
 }
});

test('Monaco pause and reset preserve the one service draw and never award unfinished tyres',()=>{
 let draws=0;const pit=new PitLaneController(track,()=>{draws++;return .5;}),vehicle=new VehiclePhysics();enter(pit,vehicle,'cadillac');while(pit.summary.state!=='service')pit.update(dt,vehicle,'cadillac','hard');
 const before=pit.summary,position={x:vehicle.x,z:vehicle.z,heading:vehicle.heading};pit.update(0,vehicle,'audi','wet');assert.deepEqual(pit.summary,before);assert.deepEqual({x:vehicle.x,z:vehicle.z,heading:vehicle.heading},position);assert.equal(draws,1);assert.equal(pit.summary.currentCompound,'medium');
 pit.reset();assert.equal(pit.summary.active,false);assert.equal(pit.summary.completedStops,0);assert.equal(pit.summary.currentCompound,'medium');assert.equal(pit.summary.serviceDuration,0);
});

test('a forward Monaco pit finish counts after measured lap travel but a teleport into the pits cannot award a lap',()=>{
 const run=(qualified:boolean)=>{
  const pit=new PitLaneController(track,()=>.5),vehicle=new VehiclePhysics(),race=new RaceSession(track);race.start();race.update(4.5,0,0,1);
  // Race-only qualification fixture: public distance samples traverse every
  // preceding checkpoint; no private session state, clock or progress writes.
  // Complete physical driving laps are independently covered by monaco-drive.
  const capture=track.nearest(pit.entry.x,pit.entry.z).distance;if(qualified)for(let d=0;d<capture-.5;d+=.1)race.update(dt,d,0,1);
  enter(pit,vehicle,'audi');race.update(dt,pit.summary.raceDistance,30,1,true);let previous=pit.summary.raceDistance,serviceTime=0,frames=0;
  while(pit.summary.active&&frames++<24000){const servicing=pit.summary.state==='service',beforeElapsed=race.elapsed,beforeCompleted=race.completed;stepPit(pit,vehicle,track,'audi','hard');race.update(dt,pit.summary.raceDistance,30,pit.summary.forward,pit.summary.legalPit);
   const delta=((pit.summary.raceDistance-previous+track.length*1.5)%track.length)-track.length/2;assert.ok(Math.abs(delta)<1,'Pit certification skipped over ordered progress validation');if(servicing){serviceTime+=dt;assert.ok(Math.abs(delta)<1e-3);if(race.completed===beforeCompleted)assert.ok(race.elapsed>beforeElapsed,'The lap clock stopped during tyre service');}previous=pit.summary.raceDistance;
  }
  assert.ok(frames<24000);assert.ok(Math.abs(serviceTime-pit.summary.serviceDuration)<=dt+1e-8);assert.equal(pit.summary.completedStops,1);assert.equal(race.valid,true);assert.equal(race.totalPenalty,0);
  const count=race.completed;race.update(dt,track.nearest(vehicle.x,vehicle.z).distance,0,1);assert.equal(race.completed,count,'Returning manual control counted a second lap');return race;
 };
 const qualified=run(true);assert.equal(qualified.completed,1);assert.equal(qualified.result?.valid,true);assert.ok(qualified.result!.time>12);
 const shortcut=run(false);assert.equal(shortcut.completed,0,'Teleporting into the pit lane granted a free lap');
 const outside=new RaceSession(track);outside.start();outside.update(4.5,0,0,1);outside.update(1,20,30,1,false);assert.equal(outside.penaltyCount,1,'The pit exception leaked into normal off-track driving');
});
