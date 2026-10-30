import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {VehiclePhysics,type Controls} from '../src/physics.ts';
import {RaceSession} from '../src/race.ts';
import {fullSteerYawForSpeed} from '../src/handling.ts';
import {WEATHER_PHYSICS,type WeatherMode} from '../src/conditions.ts';
import {PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL} from '../src/ai-race.ts';

const track=new Track('spa'),dt=1/120;

/** Production vehicle, tyre forces, throttle/brake build-up and ordered lap
 * validation. Only the four digital keyboard controls change after grid setup;
 * there are no position, speed, progress, checkpoint or clock corrections. */
function drive(weather:WeatherMode,laps:number){
 const car=new VehiclePhysics(),race=new RaceSession(track,undefined,weather),grid=track.sampleAt(PLAYER_GRID_DISTANCE);
 car.weather=weather;car.reset(grid.point.x+grid.right.x*PLAYER_GRID_LATERAL,grid.point.z+grid.right.z*PLAYER_GRID_LATERAL,Math.atan2(grid.tangent.x,grid.tangent.z));race.start();
 let input:Controls={throttle:false,brake:false,left:false,right:false},maximumLateral=0,brakingFrames=0,collisionFrames=0;
 const results:{valid:boolean;time:number}[]=[],wet=WEATHER_PHYSICS[weather],crossed=new Set<number>();
 for(let frame=0;frame<120*700&&race.completed<laps;frame++){
  if(frame%2===0&&race.state==='racing'){
   const near=track.nearest(car.x,car.z),lookahead=7+Math.abs(car.speed)*.24,look=track.sampleAt(near.distance+lookahead),desired=Math.atan2(look.point.x-car.x,look.point.z-car.z),error=Math.atan2(Math.sin(desired-car.heading),Math.cos(desired-car.heading));
   let targetSpeed=40;
   for(let ahead=0;ahead<=65;ahead+=4){
    const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+4),curve=Math.acos(Math.max(-1,Math.min(1,a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z)))/4;
    const cornerSpeed=Math.max(8,Math.min(40,Math.sqrt(8.3*wet.grip/Math.max(.0001,curve))));
    targetSpeed=Math.min(targetSpeed,Math.sqrt(cornerSpeed*cornerSpeed+42*wet.braking*Math.max(0,ahead-8)));
   }
   const required=(2*Math.abs(car.speed)*Math.sin(error)/lookahead)/Math.max(.01,fullSteerYawForSpeed(Math.abs(car.speed)));
   input={throttle:car.speed<targetSpeed,brake:car.speed>targetSpeed+.8,left:required>car.steering+.025,right:required<car.steering-.025};
   if(input.brake)brakingFrames++;
  }
  if(race.state==='racing')car.update(dt,input,track);
  const near=track.nearest(car.x,car.z),lateral=Math.hypot(car.x-near.point.x,car.z-near.point.z),forward=Math.sin(car.heading)*near.tangent.x+Math.cos(car.heading)*near.tangent.z,before=race.completed;
  maximumLateral=Math.max(maximumLateral,lateral);if(car.collision>.2)collisionFrames++;
  race.update(dt,near.distance,lateral,forward);crossed.add(race.nextCheckpoint);
  if(race.completed>before)results.push({valid:race.result!.valid,time:race.result!.time});
 }
 return{race,results,maximumLateral,brakingFrames,collisionFrames,crossed};
}

test('Spa completes three valid physical laps with keyboard-only braking and steering, including checkpoint 23 after Bus Stop',()=>{
 const result=drive('sunny',3);
 assert.equal(result.race.completed,3,`stuck at checkpoint ${result.race.nextCheckpoint}`);
 assert.equal(result.results.length,3);assert.ok(result.results.every(r=>r.valid&&r.time>120&&r.time<220));
 for(let checkpoint=1;checkpoint<=24;checkpoint++)assert.ok(result.crossed.has(checkpoint));
 assert.ok(result.maximumLateral<3.5,`maximum lateral offset ${result.maximumLateral}`);
 assert.ok(result.brakingFrames>200);assert.equal(result.collisionFrames,0);
});

test('Spa also completes a valid physical wet lap with earlier braking and the unchanged wet tyre model',()=>{
 const result=drive('rainy',1);
 assert.equal(result.race.completed,1,`stuck at checkpoint ${result.race.nextCheckpoint}`);
 assert.equal(result.results[0].valid,true);assert.ok(result.maximumLateral<3.5);assert.equal(result.collisionFrames,0);
});
