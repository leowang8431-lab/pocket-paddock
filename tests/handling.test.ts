import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, type Controls, type PhysicsTrack } from '../src/physics.ts';
import { Track } from '../src/track.ts';
import { RaceSession } from '../src/race.ts';
import {fullSteerYawForSpeed,lateralGripForSpeed,steeringAngleForSpeed,WHEELBASE} from '../src/handling.ts';

const idle:Controls={throttle:false,brake:false,left:false,right:false};
// No edges or obstacles: isolate the tire model from collision responses.
const openAsphalt:PhysicsTrack={width:16,surfaceAt:()=> 'asphalt',nearest:(x,z)=>({point:{x,z},tangent:{x:0,z:1},distance:z})};
const dt=1/120;
function tick(vehicle:VehiclePhysics,seconds:number,input:Controls){for(let i=0;i<Math.round(seconds/dt);i++)vehicle.update(dt,input,openAsphalt);}
function rolling(speed:number){const v=new VehiclePhysics();v.speed=speed;v.vz=speed;return v;}

test('maximum-speed steering cannot demand unlimited lateral tire force',()=>{
  const vehicle=rolling(40);let maximumLateralAcceleration=0;
  let previousVelocityHeading=0;
  for(let i=0;i<240;i++){
    vehicle.update(dt,{...idle,throttle:true,left:true},openAsphalt);
    const velocityHeading=Math.atan2(vehicle.vx,vehicle.vz);
    const angle=Math.atan2(Math.sin(velocityHeading-previousVelocityHeading),Math.cos(velocityHeading-previousVelocityHeading));
    maximumLateralAcceleration=Math.max(maximumLateralAcceleration,Math.abs(angle)/dt*Math.abs(vehicle.speed));
    assert.ok(Math.abs(angle)/dt*Math.abs(vehicle.speed)<=lateralGripForSpeed(vehicle.speed)+.01);
    assert.ok(Math.abs(vehicle.yawRate)*Math.abs(vehicle.speed)<=lateralGripForSpeed(vehicle.speed)+.01);
    previousVelocityHeading=velocityHeading;
  }
  assert.ok(maximumLateralAcceleration>19&&maximumLateralAcceleration<24,
    'bounded high-speed aero grip is greater than the former fixed 14.5 budget');
  const radius=vehicle.speed/Math.abs(vehicle.yawRate);
  assert.ok(radius>65&&radius<85,'240 km/h turns more readily but still needs a broad radius');
  assert.equal(vehicle.sliding,true);
  assert.equal(vehicle.gripUsage,1.5);
});

test('braking before turn-in allows a substantially tighter turn',()=>{
  const fast=rolling(40),braked=rolling(40);
  tick(braked,.9,{...idle,brake:true});
  assert.ok(braked.speed<14);
  for(let i=0;i<120;i++){
    // Compare turning capacity at the two entry speeds without coasting drift.
    fast.speed=40;braked.speed=13;
    fast.update(dt,{...idle,left:true},openAsphalt);
    braked.update(dt,{...idle,left:true},openAsphalt);
  }
  const fastRadius=Math.abs(fast.speed/fast.yawRate),slowRadius=Math.abs(braked.speed/braked.yawRate);
  assert.ok(fastRadius>65&&fastRadius<85);
  assert.ok(slowRadius<16);
  assert.ok(fastRadius>slowRadius*4);
});

test('hard braking spends tire capacity that would otherwise be available to steer',()=>{
  const coasting=rolling(30),braking=rolling(30);coasting.steering=braking.steering=1;
  // Full pressure is reached progressively; compare fully applied brakes,
  // rather than the intentionally gentle first fraction of the pedal ramp.
  tick(braking,.25,{...idle,brake:true});braking.speed=30;braking.vz=30;
  tick(coasting,.1,{...idle,left:true});
  tick(braking,.1,{...idle,left:true,brake:true});
  assert.ok(braking.speed<coasting.speed);
  assert.ok(Math.abs(braking.yawRate)<Math.abs(coasting.yawRate)*.8,
    'braking cannot keep full lateral grip at the same time');
});

test('releasing excessive steering recovers traction without an unbounded spin',()=>{
  const vehicle=rolling(35);
  tick(vehicle,1,{...idle,throttle:true,left:true});
  assert.equal(vehicle.sliding,true);
  tick(vehicle,1,idle);
  assert.equal(vehicle.sliding,false);
  assert.ok(vehicle.gripUsage<.1);
  assert.ok(Math.abs(vehicle.lateralSpeed)<.15);
  assert.ok(Number.isFinite(vehicle.heading));
});

// Same binary steering controller in both runs. Only braking/throttle differ.
function controlsFor(vehicle:VehiclePhysics,track:Track,fullThrottle:boolean):Controls{
  const near=track.nearest(vehicle.x,vehicle.z),lookahead=7+Math.abs(vehicle.speed)*.24;
  const target=track.sampleAt(near.distance+lookahead);
  const desired=Math.atan2(target.point.x-vehicle.x,target.point.z-vehicle.z);
  const error=Math.atan2(Math.sin(desired-vehicle.heading),Math.cos(desired-vehicle.heading));
  let targetSpeed=40;
  for(let ahead=0;ahead<=65;ahead+=4){
    const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+4);
    const curvature=Math.acos(Math.max(-1,Math.min(1,a.tangent.dot(b.tangent))))/4;
    const localSpeed=Math.max(8,Math.min(40,Math.sqrt(8.3/Math.max(.0001,curvature))));
    targetSpeed=Math.min(targetSpeed,Math.sqrt(localSpeed*localSpeed+42*Math.max(0,ahead-8)));
  }
  const geometricYaw=fullSteerYawForSpeed(Math.abs(vehicle.speed));
  const required=2*Math.abs(vehicle.speed)*Math.sin(error)/lookahead/Math.max(.01,geometricYaw);
  return{throttle:fullThrottle||vehicle.speed<targetSpeed,brake:!fullThrottle&&vehicle.speed>targetSpeed+.8,left:required>vehicle.steering+.025,right:required<vehicle.steering-.025};
}

test('real Monza lap rewards early braking and punishes holding full throttle',()=>{
  const track=new Track();
  const run=(fullThrottle:boolean)=>{
    const vehicle=new VehiclePhysics(),race=new RaceSession(track);const start=track.sampleAt(0);
    vehicle.reset(start.point.x,start.point.z,Math.atan2(start.tangent.x,start.tangent.z));race.start();race.update(4.5,0,0,1);
    let maximumLateral=0,brakingSteps=0;
    for(let i=0;i<120*85;i++){
      const controls=controlsFor(vehicle,track,fullThrottle);if(controls.brake)brakingSteps++;
      vehicle.update(dt,controls,track);
      const sample=track.nearest(vehicle.x,vehicle.z),lateral=Math.hypot(vehicle.x-sample.point.x,vehicle.z-sample.point.z);
      race.update(dt,sample.distance,lateral,Math.sin(vehicle.heading)*sample.tangent.x+Math.cos(vehicle.heading)*sample.tangent.z);
      maximumLateral=Math.max(maximumLateral,lateral);
      if(race.completed>0||fullThrottle&&race.totalPenalty>0)break;
    }
    return{race,maximumLateral,brakingSteps};
  };
  const skilled=run(false),flatOut=run(true);
  assert.equal(skilled.race.completed,1);assert.equal(skilled.race.result?.valid,true);
  assert.ok(skilled.maximumLateral<4);assert.ok(skilled.brakingSteps>120);
  assert.ok(flatOut.maximumLateral>11);assert.ok(flatOut.race.totalPenalty>0);
  assert.equal(flatOut.brakingSteps,0);assert.equal(flatOut.race.best,null);
});

test('slow steering circles are broader while high-speed grip remains finite and continuous',()=>{
  const radii:number[]=[];
  for(const speed of [2,6,13,25,40]){
    const car=rolling(speed);
    for(let i=0;i<360;i++){car.speed=speed;car.update(dt,{...idle,left:true},openAsphalt);}
    radii.push(Math.abs(car.speed/car.yawRate));
  }
  assert.ok(radii[0]>11.8&&radii[0]<13,'walking-speed steering cannot pivot in a tiny circle');
  assert.ok(radii[1]>12&&radii[1]<14.5);
  assert.ok(radii[2]>14&&radii[2]<16.5);
  assert.ok(radii[4]>65&&radii[4]<85);
  for(let i=1;i<radii.length;i++)assert.ok(radii[i]>radii[i-1],'radius increases smoothly with speed');
  for(let speed=0;speed<=45;speed+=.1){
    assert.ok(Math.abs(steeringAngleForSpeed(speed+.001)-steeringAngleForSpeed(speed))<.00001);
    assert.ok(lateralGripForSpeed(speed)<26);
    assert.ok(lateralGripForSpeed(speed,'rainy')<lateralGripForSpeed(speed));
  }
});

test('partial steering and partial brake inputs preserve analog precision',()=>{
  const full=rolling(6),half=rolling(6);
  for(let i=0;i<240;i++){
    full.speed=half.speed=6;
    full.update(dt,{...idle,steerAmount:1},openAsphalt);
    half.update(dt,{...idle,steerAmount:.5},openAsphalt);
  }
  assert.ok(Math.abs(half.steering-.5)<.0001);
  assert.ok(Math.abs(half.yawRate/full.yawRate-.5)<.001);
  assert.ok(Math.abs(half.frontWheelAngle-.5*steeringAngleForSpeed(half.speed))<.0001);
  const hard=rolling(25),gentle=rolling(25);
  tick(hard,.4,{...idle,brakeAmount:1});tick(gentle,.4,{...idle,brakeAmount:.25});
  assert.ok(hard.speed<gentle.speed-6);assert.equal(gentle.brakePressure,.25);
  const bad=rolling(8);bad.update(dt,{...idle,left:true,steerAmount:NaN,brakeAmount:NaN,throttleAmount:NaN},openAsphalt);
  assert.ok(Number.isFinite(bad.speed+bad.heading+bad.steering));assert.ok(bad.steering>0);
});
