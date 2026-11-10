import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {AiPitRoutes,type AiPitCar} from '../src/ai-pit-route.ts';
import {getPitServiceBay,PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';
import {Track} from '../src/track.ts';
import type {TeamId} from '../src/team-catalog.ts';

const dt=1/120;
function entryCar(track:Track,routes:AiPitRoutes,lateral:number):AiPitCar {
  const distance=track.length+routes.entryDistance,s=track.sampleAt(distance),speed=28;
  return {distance,lateral,speed,x:s.point.x+s.right.x*lateral,z:s.point.z+s.right.z*lateral,
    heading:Math.atan2(s.tangent.x,s.tangent.z),vx:s.tangent.x*speed,vz:s.tangent.z*speed,yawRate:0,frontWheelAngle:0};
}

for(const circuit of ['monza','spa','monaco'] as const)test(`${circuit} rivals drive through the correct bay and merge with continuous race progress`,()=>{
  const track=new Track(circuit),routes=new AiPitRoutes(track),line=track.sampleAt(0);
  const teams:readonly TeamId[]=['mclaren','cadillac'];
  track.group.updateMatrixWorld(true);
  const renderedPitRoad:THREE.Mesh[]=[];
  if(circuit==='monza')track.group.traverse(o=>{
    if(o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='monza-pit-asphalt')renderedPitRoad.push(o);
  });
  for(let i=0;i<teams.length;i++){
    const team=teams[i],car=entryCar(track,routes,i?2.8:-2.8),initial={...car};
    const bay=getPitServiceBay(track,team),seconds=2+i*2,visit=routes.begin(car,team,seconds);
    assert.deepEqual(car,initial);
    assert.equal(visit.bayId,bay.id);
    let stopTime=0,crossed=false;
    for(let frame=0;frame<75/dt&&visit.phase!=='done';frame++){
      const before={...car},phase=visit.phase,laneArc=visit.laneArc;
      visit.step(car,dt);
      const moved=Math.hypot(car.x-before.x,car.z-before.z);
      assert.ok(moved<=Math.max(before.speed,car.speed)*dt+.001,'The route never teleports the rival');
      assert.ok(car.distance>=before.distance-1e-9&&visit.laneArc>=laneArc-1e-9);
      if(visit.laneArc>=0)assert.ok(car.speed<=PIT_SPEED_LIMIT+1e-9);
      if(track.surfaceAt(car.x,car.z)!=='asphalt'){
        // The Monza kerb has GP ownership for player speed-limit detection,
        // even where the rendered pit entry continues below the kerb.
        assert.equal(circuit,'monza');
        const ray=new THREE.Raycaster(new THREE.Vector3(car.x,2,car.z),new THREE.Vector3(0,-1,0));
        assert.ok(ray.intersectObjects(renderedPitRoad,false).length>0);
      }
      if(phase==='service'){
        stopTime+=dt;
        assert.equal(moved,0);assert.equal(car.speed,0);assert.equal(car.distance,before.distance);
        assert.ok(Math.hypot(car.x-bay.x,car.z-bay.z)<1e-8);
      }
      if(before.distance<2*track.length&&car.distance>=2*track.length){
        const timingPlane=(car.x-line.point.x)*line.tangent.x+(car.z-line.point.z)*line.tangent.z;
        assert.ok(timingPlane>=-1e-7&&timingPlane<=moved+1e-7);
        crossed=true;
      }
    }
    assert.equal(visit.phase,'done');assert.equal(crossed,true);
    assert.ok(Math.abs(stopTime-seconds)<dt*.5);
    const exit=track.sampleAt(routes.exitDistance);
    assert.ok(Math.hypot(car.x-exit.point.x,car.z-exit.point.z)<1e-8);
    assert.ok(Math.abs(car.distance-(2*track.length+routes.exitDistance))<1e-8);
  }
});

test('Monaco shared physical garages use one bay key and a pit queue cap holds a rival on the route',()=>{
  const track=new Track('monaco'),routes=new AiPitRoutes(track),car=entryCar(track,routes,0),visit=routes.begin(car,'audi',3);
  assert.equal(visit.bayId,routes.bayId('cadillac'));
  assert.equal(visit.bayId,routes.bayId('haas'));
  assert.notEqual(visit.bayId,routes.bayId('ferrari'));
  for(let frame=0;frame<10/dt&&visit.phase==='entry';frame++)visit.step(car,dt);
  assert.equal(visit.phase,'approach');
  for(let frame=0;frame<2/dt;frame++)visit.step(car,dt,0);
  const position={x:car.x,z:car.z,distance:car.distance};
  assert.equal(car.speed,0);
  for(let frame=0;frame<1/dt;frame++)visit.step(car,dt,0);
  assert.deepEqual({x:car.x,z:car.z,distance:car.distance},position);
  visit.step(car,dt);
  assert.ok(car.distance>position.distance&&car.speed>0);
});

test('an approach speed request brakes for a queue before entering the limited lane',()=>{
  const track=new Track('monza'),routes=new AiPitRoutes(track),car=entryCar(track,routes,0);
  car.speed=8;
  const visit=routes.begin(car,'mclaren',3);
  visit.step(car,dt,2);
  assert.equal(visit.phase,'entry');
  assert.ok(car.speed<8);
});
