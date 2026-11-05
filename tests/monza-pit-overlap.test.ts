import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {PitLaneController,PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';
import {teams} from '../src/team-catalog.ts';
import {stepPit} from './pit-driving-helper.ts';

const track=new Track('monza'),dt=1/120,team=teams[0].id;
function setFast(vehicle:VehiclePhysics,speed=42){vehicle.speed=speed;vehicle.vx=Math.sin(vehicle.heading)*speed;vehicle.vz=Math.cos(vehicle.heading)*speed;}
function releasedVisit(){
  const pit=new PitLaneController(track,()=>.5),vehicle=new VehiclePhysics(),e=pit.entry,tx=Math.sin(e.heading),tz=Math.cos(e.heading);
  vehicle.reset(e.x-tx*.4,e.z-tz*.4,e.heading);setFast(vehicle,30);assert.equal(pit.update(dt,vehicle,team,'soft'),false);
  vehicle.x=e.x+tx*.4;vehicle.z=e.z+tz*.4;assert.equal(pit.update(dt,vehicle,team,'soft'),true);
  for(let i=0;pit.summary.state!=='service'&&i<10000;i++)pit.update(dt,vehicle,team,'soft');
  assert.equal(pit.summary.state,'service');assert.equal(pit.summary.serviceDuration,3);
  assert.equal(pit.update(3,vehicle,team,'soft'),false);assert.equal(pit.summary.state,'exit');
  return {pit,vehicle};
}

test('the entire GP asphalt and both kerbs remain unlimited across Monza pit entry and exit overlaps',()=>{
  const pit=new PitLaneController(track),vehicle=new VehiclePhysics();let entrance=0,exit=0;
  for(const sample of track.samples){
    const atEntry=sample.point.x< -64&&sample.point.z>=135&&sample.point.z<=190;
    const atExit=sample.point.x< -64&&sample.point.z>=-118&&sample.point.z<=-80;
    if(!atEntry&&!atExit)continue;
    if(atEntry)entrance++;if(atExit)exit++;
    for(const side of [-1,1])for(const unscaledOffset of [0,4,8,8.8,9.3,9.65]){
      const offset=side*unscaledOffset*track.widthAt(sample.distance)/track.width;
      const x=sample.point.x+sample.right.x*offset,z=sample.point.z+sample.right.z*offset;
      assert.equal(track.isPitLane(x,z),false,`GP road classified as pit: ${JSON.stringify({x,z,offset,atEntry,atExit})}`);
      pit.cancel();vehicle.reset(x,z,Math.atan2(sample.tangent.x,sample.tangent.z));setFast(vehicle);vehicle.drsActive=true;
      assert.equal(pit.update(dt,vehicle,team,'soft'),false);assert.equal(vehicle.speed,42,'pre-physics pass clamped main road');
      pit.afterPhysics(dt,vehicle);assert.equal(vehicle.speed,42,'post-physics pass clamped main road');
      assert.equal(pit.summary.limited,false);assert.equal(pit.summary.active,false);assert.equal(vehicle.drsActive,true);
    }
  }
  assert.ok(entrance>40&&exit>30,'both complete overlapping joins must be swept');
});

test('the genuinely separate pit branch and paved garage apron keep both 120 km/h governor passes',()=>{
  const pit=new PitLaneController(track),vehicle=new VehiclePhysics();
  const points=track.pitPath.filter(p=>track.isPitLane(p.x,p.z)).map(p=>({x:p.x,y:p.y,z:p.z}));assert.ok(points.length>100);
  for(const x of [-57.5,-55,-52,-50])for(const z of [-50,-20,20,60,100])points.push({x,y:0,z});
  for(const p of points){
    assert.equal(track.isPitLane(p.x,p.z),true);
    pit.cancel();vehicle.reset(p.x,p.z,Math.PI);setFast(vehicle);
    assert.equal(pit.update(dt,vehicle,team,'soft'),false);
    assert.ok(Math.abs(vehicle.speed-PIT_SPEED_LIMIT)<1e-10,'the first governor pass missed a separate pit road');
    setFast(vehicle);pit.afterPhysics(dt,vehicle);
    assert.equal(pit.summary.limited,true);assert.ok(Math.abs(vehicle.speed-PIT_SPEED_LIMIT)<1e-10);
    assert.ok(Math.abs(Math.hypot(vehicle.vx,vehicle.vz)-PIT_SPEED_LIMIT)<1e-10);
  }
});

test('manual exit loses the governor on its first GP-kerb frame while preserving legal sequential pit progress',()=>{
  const {pit,vehicle}=releasedVisit();let merged=false,prior=pit.summary.raceDistance;
  for(let i=0;pit.summary.active&&i<15000;i++){
    stepPit(pit,vehicle,track,team,'soft');
    const advance=((pit.summary.raceDistance-prior+track.length*1.5)%track.length)-track.length/2;
    assert.ok(Math.abs(advance)<1,'exit progress must remain sequential');prior=pit.summary.raceDistance;
    if(!track.isPitLane(vehicle.x,vehicle.z)&&pit.summary.state==='exit'){
      assert.equal(pit.summary.limited,false,'the very first merged frame retained the pit cap');
      assert.equal(pit.summary.legalPit,true,'the final connected route must retain ordered checkpoint validation');
      assert.equal(pit.summary.controlled,false);
      setFast(vehicle,35);assert.equal(pit.update(dt,vehicle,team,'soft'),false);
      assert.equal(vehicle.speed,35,'exit state alone must not cap a car already on GP asphalt');
      pit.afterPhysics(dt,vehicle);assert.equal(vehicle.speed,35);assert.equal(pit.summary.limited,false);
      // Resume the same real manual test driver to the end of the route.
      setFast(vehicle,9);merged=true;
    }
  }
  assert.ok(merged,'the real driven exit must pass through the shared road join');
  assert.equal(pit.summary.active,false);assert.equal(pit.summary.completedStops,1);assert.equal(pit.summary.currentCompound,'soft');
});
