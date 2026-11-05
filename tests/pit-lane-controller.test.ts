import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {PitLaneController,PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';
import {RaceSession} from '../src/race.ts';
import {teams,type TeamId} from '../src/team-catalog.ts';
import {createPitComplexLayout,pitSolidColliders} from '../src/pit-complex.ts';
import {SPA_PIT_LAYOUT} from '../src/spa-pit-layout.ts';
import {MONZA_PIT_LAYOUT} from '../src/monza-pit-layout.ts';
import {stepPit} from './pit-driving-helper.ts';

const tracks={monza:new Track('monza'),spa:new Track('spa')};
const layout=createPitComplexLayout(tracks.monza),spaTemplate=createPitComplexLayout(tracks.monza,'spa-template');
const pitBounds={monza:pitSolidColliders(layout),spa:[spaTemplate.boxes,...spaTemplate.strategyPods,...spaTemplate.clockBeam.posts].map(b=>({minX:b.x-b.width/2,maxX:b.x+b.width/2,minZ:200-b.z-b.depth/2,maxZ:200-b.z+b.depth/2}))};
function enter(pit:PitLaneController,vehicle:VehiclePhysics,team:TeamId=teams[0].id){
  const e=pit.entry,tx=Math.sin(e.heading),tz=Math.cos(e.heading);
  vehicle.reset(e.x-tx*.4,e.z-tz*.4,e.heading);vehicle.speed=30;
  assert.equal(pit.update(1/120,vehicle,team,'soft'),false);
  vehicle.x=e.x+tx*.4;vehicle.z=e.z+tz*.4;const before={x:vehicle.x,z:vehicle.z};
  assert.equal(pit.update(1/120,vehicle,team,'soft'),true);assert.deepEqual({x:vehicle.x,z:vehicle.z},before,'Capture must not snap to the route centre');
  assert.ok(vehicle.speed<=PIT_SPEED_LIMIT);
}
function finish(pit:PitLaneController,vehicle:VehiclePhysics,track:Track,team:TeamId=teams[0].id){
  let steps=0;const positions:{x:number;z:number;heading:number;state:string;distance:number}[]=[];
  while(pit.summary.active&&steps++<20000){stepPit(pit,vehicle,track,team);assert.ok(vehicle.speed>=0&&vehicle.speed<=PIT_SPEED_LIMIT+1e-10);positions.push({x:vehicle.x,z:vehicle.z,heading:vehicle.heading,state:pit.summary.state,distance:pit.summary.raceDistance});}
  assert.ok(steps<20000,'Pit visit did not release control');return positions;
}
test('both real pit lanes serve every matching garage then accept actual manual driving under the 120 km/h governor',()=>{
  for(const [id,track]of Object.entries(tracks))for(let i=0;i<teams.length;i++){
    const team=teams[i].id,pit=new PitLaneController(track,()=>.5),vehicle=new VehiclePhysics();enter(pit,vehicle,team);
    const selected=pit.summary;assert.equal(selected.team,team);assert.equal(selected.compound,'soft');assert.equal(selected.serviceDuration,3);
    assert.equal(selected.stop.x,id==='monza'?MONZA_PIT_LAYOUT.stopX:SPA_PIT_LAYOUT.stopX);assert.ok(Math.abs(selected.stop.z-(id==='monza'?-43+i*13.2:243-i*13.2))<1e-8);
    const positions=finish(pit,vehicle,track,team),service=positions.find(p=>p.state==='service')!;assert.ok(service);assert.ok(Math.hypot(service.x-selected.stop.x,service.z-selected.stop.z)<1e-7);
    assert.equal(pit.summary.completedStops,1);assert.equal(pit.summary.currentCompound,'soft');assert.equal(pit.summary.active,false);assert.ok(vehicle.speed>0);
    assert.ok(Math.hypot(vehicle.x-pit.exit.x,vehicle.z-pit.exit.z)<1.2);assert.ok(Math.abs(pit.summary.groundHeight-pit.exit.y)<.1);
    for(let k=1;k<positions.length;k++)assert.ok(Math.hypot(positions[k].x-positions[k-1].x,positions[k].z-positions[k-1].z)<=PIT_SPEED_LIMIT/120+1e-7,'Autopilot teleported along the pit path');
    for(let k=0;k<positions.length;k+=8){const p=positions[k],halfX=Math.abs(Math.cos(p.heading))*1.5+Math.abs(Math.sin(p.heading))*2.75,halfZ=Math.abs(Math.sin(p.heading))*1.5+Math.abs(Math.cos(p.heading))*2.75;
      for(const b of [...track.colliders,...pitBounds[id as keyof typeof pitBounds]])assert.ok(p.x+halfX<b.minX||p.x-halfX>b.maxX||p.z+halfZ<b.minZ||p.z-halfZ>b.maxZ,`${id} ${team} car overlaps a solid pit structure: ${JSON.stringify({frame:k,pose:p,halfX,halfZ,structure:b})}`);
    }
  }
});
test('the service draw happens once per entry, stays frozen while paused and updates tyres only after the complete 2–4 second stop',()=>{
  for(const draw of [0,.37,1,NaN,-2,3]){
    let calls=0;const pit=new PitLaneController(tracks.monza,()=>{calls++;return draw;}),vehicle=new VehiclePhysics();enter(pit,vehicle);assert.equal(calls,1);
    const duration=pit.summary.serviceDuration;assert.ok(duration>=2&&duration<=4);
    while(pit.summary.state!=='service')pit.update(1/120,vehicle,teams[0].id,'wet');
    const stopped=pit.summary;pit.update(0,vehicle,teams[0].id,'wet');assert.deepEqual(pit.summary,stopped);assert.equal(pit.summary.currentCompound,'medium');
    pit.update(duration-.01,vehicle,teams[0].id,'hard');assert.equal(pit.summary.state,'service');assert.equal(pit.summary.currentCompound,'medium');assert.equal(calls,1);
    pit.update(.01,vehicle,teams[0].id,'hard');assert.equal(pit.summary.state,'exit');assert.equal(pit.summary.currentCompound,'soft');assert.equal(pit.summary.completedStops,1);assert.equal(calls,1);
    finish(pit,vehicle,tracks.monza);enter(pit,vehicle);assert.equal(calls,2);
    pit.cancel();assert.equal(pit.summary.active,false);assert.equal(pit.summary.currentCompound,'soft');assert.equal(pit.summary.completedStops,1);
    pit.reset('hard');assert.equal(pit.summary.currentCompound,'hard');assert.equal(pit.summary.completedStops,0);
  }
});
test('normal main-track driving, wrong-way pit travel and teleporting across the entrance do not activate assistance',()=>{
  for(const track of Object.values(tracks)){
    const pit=new PitLaneController(track),vehicle=new VehiclePhysics();
    for(const side of [-1,0,1])for(let i=0;i<track.samples.length;i++){
      const s=track.samples[i];
        vehicle.x=s.point.x+s.right.x*side*(track.width/2+.75);vehicle.z=s.point.z+s.right.z*side*(track.width/2+.75);vehicle.heading=Math.atan2(s.tangent.x,s.tangent.z);vehicle.speed=40;
        assert.equal(pit.update(1/120,vehicle,teams[0].id,'soft'),false);
    }
    pit.cancel();const e=pit.entry,tx=Math.sin(e.heading),tz=Math.cos(e.heading);
    vehicle.reset(e.x+tx*.5,e.z+tz*.5,e.heading+Math.PI);vehicle.speed=10;pit.update(1/120,vehicle,teams[0].id,'soft');vehicle.x-=tx;vehicle.z-=tz;assert.equal(pit.update(1/120,vehicle,teams[0].id,'soft'),false);
    pit.cancel();vehicle.reset(e.x-tx*100,e.z-tz*100,e.heading);vehicle.speed=30;pit.update(1/120,vehicle,teams[0].id,'soft');vehicle.x=e.x+tx;vehicle.z=e.z+tz;assert.equal(pit.update(1/120,vehicle,teams[0].id,'soft'),false);
  }
});
test('legal pit travel keeps clocks running and crosses only ordered checkpoints, including the finish line',()=>{
  for(const track of Object.values(tracks)){
    const pit=new PitLaneController(track,()=>.5),vehicle=new VehiclePhysics(),race=new RaceSession(track);
    race.start();race.update(4.5,0,0,1);const capture=track.nearest(pit.entry.x,pit.entry.z).distance;
    // Drive the preceding lap in small real session increments, without writing
    // checkpoint state; the final section is the actual certified pit route.
    for(let d=0;d<capture-.5;d+=.1)race.update(1/120,d,0,1);
    enter(pit,vehicle);race.update(1/120,pit.summary.raceDistance,25,1,true);
    let oldDistance=pit.summary.raceDistance,serviceElapsed=0,visitedService=false;
    for(let i=0;pit.summary.active&&i<20000;i++){
      const wasService=pit.summary.state==='service',oldTime=race.elapsed,oldCompleted=race.completed;
      stepPit(pit,vehicle,track,teams[0].id,'soft');race.update(1/120,pit.summary.raceDistance,25,pit.summary.forward,pit.summary.legalPit);
      const delta=((pit.summary.raceDistance-oldDistance+track.length*1.5)%track.length)-track.length/2;assert.ok(Math.abs(delta)<1,'Certified pit distance jumped over checkpoint validation');
      if(wasService){visitedService=true;serviceElapsed+=1/120;if(pit.summary.state==='service')assert.ok(Math.abs(delta)<1e-8);if(race.completed===oldCompleted)assert.ok(race.elapsed>oldTime);}
      oldDistance=pit.summary.raceDistance;
    }
    assert.ok(visitedService&&serviceElapsed>=3-1/120);assert.equal(race.completed,1);assert.equal(race.valid,true);assert.equal(race.last!==null,true);
    const exit=track.nearest(vehicle.x,vehicle.z);race.update(1/120,exit.distance,0,1);assert.equal(race.completed,1,'Pit exit counted a second lap');
    const unsafe=new RaceSession(track);unsafe.start();unsafe.update(4.5,0,0,1);unsafe.update(1,10,25,1);assert.equal(unsafe.valid,false,'Ordinary off-track travel must retain track-limit rules');
  }
});

test('completed service immediately returns all controls; waiting or reversing cannot manufacture exit progress',()=>{
  const track=tracks.monza,pit=new PitLaneController(track,()=>0),vehicle=new VehiclePhysics();enter(pit,vehicle);
  while(pit.summary.state!=='service')pit.update(1/120,vehicle,teams[0].id,'soft');
  assert.equal(pit.update(pit.summary.serviceDuration,vehicle,teams[0].id,'soft'),false);
  assert.equal(pit.summary.state,'exit');assert.equal(pit.summary.controlled,false);assert.equal(pit.summary.active,true);assert.equal(pit.summary.currentCompound,'soft');
  pit.afterPhysics(1/120,vehicle);const parked={x:vehicle.x,z:vehicle.z,distance:pit.summary.raceDistance,route:pit.summary.routeDistance};
  for(let i=0;i<1200;i++){assert.equal(pit.update(1/120,vehicle,teams[0].id,'soft'),false);pit.afterPhysics(1/120,vehicle);}
  assert.deepEqual({x:vehicle.x,z:vehicle.z,distance:pit.summary.raceDistance,route:pit.summary.routeDistance},parked);assert.equal(pit.summary.state,'exit');
  const before=pit.summary;assert.equal(pit.update(0,vehicle,teams[0].id,'hard'),false);pit.afterPhysics(0,vehicle);assert.deepEqual(pit.summary,before);
  for(let i=0;i<24;i++)stepPit(pit,vehicle,track,teams[0].id,'soft',1/120,{throttle:true,brake:false,left:true,right:false,throttleAmount:.8,brakeAmount:0,steerAmount:.6});
  assert.ok(vehicle.throttlePressure>.5);assert.ok(vehicle.steering>.2);assert.ok(Math.hypot(vehicle.x-parked.x,vehicle.z-parked.z)>.03);assert.equal(pit.summary.controlled,false);assert.equal(pit.summary.limited,true);
  const forward=pit.summary.raceDistance;vehicle.speed=-3;vehicle.vx=-Math.sin(vehicle.heading)*3;vehicle.vz=-Math.cos(vehicle.heading)*3;
  stepPit(pit,vehicle,track,teams[0].id,'soft',1/120,{throttle:false,brake:true,left:false,right:false,throttleAmount:0,brakeAmount:.7,steerAmount:0});
  const delta=((pit.summary.raceDistance-forward+track.length*1.5)%track.length)-track.length/2;assert.ok(delta<=0);assert.ok(pit.summary.forward<=0);
  vehicle.x+=10;pit.afterPhysics(1/120,vehicle);assert.equal(pit.summary.legalPit,false,'A teleport retained a legal pit checkpoint exemption');assert.equal(pit.summary.controlled,false);
});

test('the post-physics 120 km/h governor caps both velocity and speed without changing analog driver inputs, and clears outside',()=>{
  for(const track of [tracks.monza,tracks.spa,new Track('monaco')]){
    const pit=new PitLaneController(track),vehicle=new VehiclePhysics(),nodes=track.pitPath;
    const index=nodes.findIndex((p,i)=>i>nodes.length*.4&&i<nodes.length*.8&&track.isPitLane(p.x,p.z)),point=nodes[index],next=nodes[index+1];assert.ok(point);
    vehicle.reset(point.x,point.z,Math.atan2(next.x-point.x,next.z-point.z));vehicle.speed=42;vehicle.vx=Math.sin(vehicle.heading)*42;vehicle.vz=Math.cos(vehicle.heading)*42;
    vehicle.throttlePressure=.87;vehicle.brakePressure=.28;vehicle.steering=.44;vehicle.frontWheelAngle=.18;vehicle.drsActive=true;pit.afterPhysics(1/120,vehicle);
    assert.equal(pit.summary.active,false);assert.equal(pit.summary.controlled,false);assert.equal(pit.summary.limited,true);assert.ok(Math.abs(vehicle.speed)<=20+1e-10);assert.ok(Math.hypot(vehicle.vx,vehicle.vz)<=20+1e-10);
    assert.equal(vehicle.throttlePressure,.87);assert.equal(vehicle.brakePressure,.28);assert.equal(vehicle.steering,.44);assert.equal(vehicle.frontWheelAngle,.18);assert.equal(vehicle.drsActive,false);
    const road=track.sampleAt(track.length*.4).point;vehicle.x=road.x;vehicle.z=road.z;vehicle.speed=23;vehicle.vx=23;vehicle.vz=0;pit.afterPhysics(1/120,vehicle);assert.equal(pit.summary.limited,false);assert.equal(vehicle.speed,23);
  }
});
