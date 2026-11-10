import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {VehiclePhysics,type Controls} from '../src/physics.ts';
import {RaceSession} from '../src/race.ts';
import {createScenery} from '../src/scenery.ts';
import {WEATHER_PHYSICS,type WeatherMode} from '../src/conditions.ts';

const track=new Track('monaco'),scene=createScenery(track);track.barrierSegments.push(...scene.userData.facilityBarrierSegments);track.rebuildBarrierIndex();
/** Real production vehicle/rack/grip/wall collisions and sequential lap timer.
 * A single grid reset is followed only by four boolean keyboard commands.
 * No route projection, checkpoint, velocity, clock or position writes occur. */
function drive(weather:WeatherMode){
 const dt=1/120,car=new VehiclePhysics(),race=new RaceSession(track,undefined,weather),grid=track.sampleAt(-12),wet=WEATHER_PHYSICS[weather];car.weather=weather;car.tires.fit(weather==='rainy'?'wet':'medium',weather);car.reset(grid.point.x-grid.right.x*2.5,grid.point.z-grid.right.z*2.5,Math.atan2(grid.tangent.x,grid.tangent.z));race.start();
 let input:Controls={throttle:false,brake:false,left:false,right:false},maximumLateral=0,collisionFrames=0,brakingFrames=0;const checkpoints=new Set<number>();
 for(let frame=0;frame<120*500&&race.completed<1;frame++){
  if(frame%2===0&&race.state==='racing'){
   const near=track.nearest(car.x,car.z),lookahead=3+Math.abs(car.speed)*.16,look=track.sampleAt(near.distance+lookahead),desired=Math.atan2(look.point.x-car.x,look.point.z-car.z),error=Math.atan2(Math.sin(desired-car.heading),Math.cos(desired-car.heading));let target=38;
   for(let ahead=0;ahead<=70;ahead+=2){const a=track.sampleAt(near.distance+ahead-1),b=track.sampleAt(near.distance+ahead+1),curve=Math.acos(Math.max(-1,Math.min(1,a.tangent.dot(b.tangent))))/2,angle=Math.atan(curve*3.1),rack=angle>.0001?Math.max(2.8,(.56/angle-1)/.018)*.84:38,corner=Math.max(2.8,Math.min(38,rack,Math.sqrt(5.6*wet.grip/Math.max(.0001,curve))));target=Math.min(target,Math.sqrt(corner*corner+35*wet.braking*Math.max(0,ahead-6)));}
   const fullYaw=Math.abs(car.speed)/3.1*Math.tan(track.steeringAngleForSpeed!(car.speed)),required=(2*Math.abs(car.speed)*Math.sin(error)/lookahead)/Math.max(.01,fullYaw);input={throttle:car.speed<target,brake:car.speed>target+.5,left:required>car.steering+.018,right:required<car.steering-.018};if(input.brake)brakingFrames++;
  }
  if(race.state==='racing')car.update(dt,input,track);
  const near=track.nearest(car.x,car.z),lateral=Math.hypot(car.x-near.point.x,car.z-near.point.z),forward=Math.sin(car.heading)*near.tangent.x+Math.cos(car.heading)*near.tangent.z;maximumLateral=Math.max(maximumLateral,lateral);if(car.collision>.2)collisionFrames++;race.update(dt,near.distance,lateral,forward);checkpoints.add(race.nextCheckpoint);
 }
 return{race,maximumLateral,collisionFrames,brakingFrames,checkpoints};
}
for(const weather of ['sunny','rainy'] as const)test(`Monaco completes a valid ${weather} physical lap using digital steering and braking with all rendered facility walls active`,()=>{
 const result=drive(weather);assert.equal(result.race.completed,1,`Stuck at checkpoint ${result.race.nextCheckpoint}`);assert.equal(result.race.result?.valid,true);assert.ok(result.race.result.time>140&&result.race.result.time<250);assert.equal(result.collisionFrames,0);assert.ok(result.maximumLateral<2.8);assert.ok(result.brakingFrames>800);for(let n=1;n<=24;n++)assert.ok(result.checkpoints.has(n),`Skipped checkpoint ${n}`);
});
