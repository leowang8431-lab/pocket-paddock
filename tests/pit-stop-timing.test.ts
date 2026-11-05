import test from 'node:test';
import assert from 'node:assert/strict';
import {PIT_STOP_PHASES} from '../src/pit-stop-animation.ts';
import {PIT_STOP_DURATION,PIT_STOP_RACE_PHASES,toPitPoseTime,toPitRaceTime} from '../src/pit-stop-timing.ts';

test('the real stop spans 2.6 seconds with every authoring phase boundary preserved',()=>{
  assert.equal(PIT_STOP_DURATION,2.6);assert.equal(PIT_STOP_RACE_PHASES[0].start,0);assert.equal(PIT_STOP_RACE_PHASES.at(-1)!.end,2.6);
  for(let i=0;i<PIT_STOP_RACE_PHASES.length;i++){
    const phase=PIT_STOP_RACE_PHASES[i],original=PIT_STOP_PHASES[i];assert.equal(phase.id,original.id);assert.equal(phase.name,original.name);
    assert.equal(toPitPoseTime(phase.start),original.start);assert.equal(toPitPoseTime(phase.end),original.end);assert.ok(phase.end>phase.start);
    if(i)assert.equal(phase.start,PIT_STOP_RACE_PHASES[i-1].end);
  }
  assert.ok(toPitRaceTime(7.8)>2.56&&toPitRaceTime(7.8)<2.58,'Release light must turn green near the end, after the front jack clears');
});

test('forward, reverse and out-of-range seeks stay monotonic and recover the same pose without cumulative timing drift',()=>{
  let last=-1;
  for(let i=0;i<=2600;i++){
    const real=i/1000,pose=toPitPoseTime(real);assert.ok(pose>=last);assert.ok(Math.abs(toPitRaceTime(pose)-real)<1e-12);last=pose;
  }
  for(const real of [2.6,.1,1.95,0,.82,1.62,2.6,0])assert.ok(Math.abs(toPitRaceTime(toPitPoseTime(real))-real)<1e-12);
  assert.equal(toPitPoseTime(-1),0);assert.equal(toPitPoseTime(Infinity),8);assert.equal(toPitPoseTime(NaN),0);
  assert.equal(toPitRaceTime(-Infinity),0);assert.equal(toPitRaceTime(20),2.6);assert.equal(toPitRaceTime(NaN),0);
});
