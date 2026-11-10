import test from 'node:test';
import assert from 'node:assert/strict';
import {TireSet,type TireCompound,type TireStepInput} from '../src/tire-physics.ts';

const straight:TireStepInput = {
  dt:1/120,speed:35,lateralSpeed:0,yawRate:0,steerAngle:0,
  longitudinalDemand:0,lateralDemand:0,longitudinalGrip:36,lateralGrip:21,
  weather:'sunny',surface:'asphalt',
};

function run(tires:TireSet,input:Partial<TireStepInput>,ticks=120) {
  const state = {...straight,...input};
  let result = tires.step({...state,dt:0});
  for (let i=0;i<ticks;i++) result = tires.step(state);
  return result;
}

test('rear drive unloads the front axle and braking reverses the weight transfer',()=>{
  const tires = new TireSet();
  run(tires,{longitudinalDemand:10});
  const [frontLeft,frontRight,rearLeft,rearRight] = tires.summary.wheels;
  assert.equal(frontLeft.forceX,0);
  assert.equal(frontRight.forceX,0);
  assert.ok(rearLeft.forceX>4.9 && rearRight.forceX>4.9);
  const frontDriveLoad = frontLeft.load + frontRight.load;
  const coasting = new TireSet();
  run(coasting,{});
  const frontCoastLoad = coasting.summary.wheels[0].load + coasting.summary.wheels[1].load;
  assert.ok(frontDriveLoad<frontCoastLoad);
  run(tires,{longitudinalDemand:-28});
  assert.ok(frontLeft.load + frontRight.load>frontCoastLoad);
  assert.ok(frontLeft.forceX<rearLeft.forceX && rearLeft.forceX<0);
  assert.ok(frontLeft.slipRatio<0);
});

test('steering, sideslip and yaw determine contact slip and loaded outside tires',()=>{
  const tires = new TireSet();
  const corner = run(tires,{steerAngle:.12,yawRate:.52,lateralSpeed:-.9,lateralDemand:18});
  const [frontLeft,frontRight,rearLeft,rearRight] = tires.summary.wheels;
  assert.ok(corner.lateralAcceleration>0);
  assert.ok(frontLeft.slipAngle>rearLeft.slipAngle && rearLeft.slipAngle>0);
  assert.ok(frontLeft.load>frontRight.load && rearLeft.load>rearRight.load);
  assert.ok(frontLeft.forceY>frontRight.forceY);
  const lateralSlide = run(tires,{lateralSpeed:8});
  assert.ok(lateralSlide.lateralAcceleration<0);
  assert.equal(lateralSlide.sliding,true);
});

test('the same tire capacity must support both hard braking and cornering',()=>{
  const turn = {steerAngle:.115,lateralDemand:17,lateralSpeed:-.9,yawRate:.5};
  const coast = run(new TireSet(),turn);
  const brake = run(new TireSet(),{...turn,longitudinalDemand:-31});
  assert.ok(brake.longitudinalAcceleration<-28);
  assert.ok(brake.lateralLimit<coast.lateralLimit*.6);
  assert.ok(brake.lateralAcceleration<coast.lateralAcceleration);
  assert.ok(brake.gripUsage>coast.gripUsage);
});

test('soft rubber gives the best fresh dry grip and loses the most tread in a stint',()=>{
  function stint(compound:TireCompound) {
    const tires = new TireSet();
    tires.fit(compound);
    const freshGrip = tires.gripMultiplier;
    const freshSpeed = tires.speedMultiplier;
    for (let sector=0;sector<7;sector++) {
      run(tires,{speed:38,longitudinalDemand:4},550);
      run(tires,{speed:25,steerAngle:.1,lateralSpeed:-1,yawRate:.5,longitudinalDemand:-15,lateralDemand:14},170);
    }
    const {wear,remaining} = tires.summary;
    assert.ok(tires.speedMultiplier<freshSpeed);
    assert.ok(tires.gripMultiplier<freshGrip);
    assert.equal(remaining,1-wear);
    return {wear,freshGrip,freshSpeed};
  }
  const soft = stint('soft'), medium = stint('medium'), hard = stint('hard');
  assert.ok(soft.freshGrip>medium.freshGrip && medium.freshGrip>hard.freshGrip);
  assert.ok(soft.freshSpeed>medium.freshSpeed && medium.freshSpeed>hard.freshSpeed);
  // 1.47 km of straight/cornering motion at the game's distance scale.
  assert.ok(soft.wear>.24 && soft.wear<.34);
  assert.ok(medium.wear>.15 && medium.wear<.22);
  assert.ok(hard.wear>.09 && hard.wear<.15);
});

test('wet tires suit rain and wear faster on dry asphalt',()=>{
  const rain = {weather:'rainy',lateralGrip:14,longitudinalGrip:26} as const;
  const slick = new TireSet();
  slick.fit('medium','rainy');
  const drySlick = new TireSet();
  const wet = new TireSet();
  wet.fit('wet','rainy');
  assert.ok(run(wet,rain).lateralLimit>run(slick,rain).lateralLimit*1.2);
  const dryWet = new TireSet();
  dryWet.fit('wet');
  assert.ok(run(dryWet,{}).lateralLimit<run(drySlick,{}).lateralLimit);
  run(wet,rain,2000);
  run(dryWet,{},2000);
  assert.ok(dryWet.summary.wear>wet.summary.wear*1.7);
});

test('temperature falls while stopped, and fitting a new set clears wear and force history',()=>{
  const tires = new TireSet();
  run(tires,{longitudinalDemand:13,lateralSpeed:-3,yawRate:.8,steerAngle:.14},1200);
  const {wear,temperature} = tires.summary;
  assert.ok(wear>0);
  run(tires,{speed:0},1200);
  assert.equal(tires.summary.wear,wear);
  assert.ok(tires.summary.temperature<temperature);
  const pausedTemperature = tires.summary.temperature;
  run(tires,{dt:0},1200);
  assert.equal(tires.summary.temperature,pausedTemperature);
  tires.fit('hard');
  assert.equal(tires.summary.compound,'hard');
  assert.equal(tires.summary.remaining,1);
  assert.ok(tires.summary.wheels.every(wheel=>wheel.slipRatio===0 && wheel.slipAngle===0 && wheel.forceX===0 && wheel.forceY===0));
  assert.ok(tires.step({...straight,speed:NaN,steerAngle:Infinity}).lateralLimit>0);
});
