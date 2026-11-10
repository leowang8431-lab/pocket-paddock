import test from 'node:test';
import assert from 'node:assert/strict';
import {RaceIntervals} from '../src/race-intervals.ts';

test('adjacent positions use each predecessor’s measured passage time',()=>{
  const intervals=new RaceIntervals();
  intervals.record('P1',0,1);intervals.record('P1',20,3);
  intervals.record('P2',0,2);intervals.record('P2',12,3.5);
  assert.ok(Math.abs(intervals.gap('P1',12,3.5)!-1.3)<1e-9);
  assert.equal(intervals.gap('P2',8,3.5),.5);
  assert.equal(intervals.gap('P1',8,3.5),1.7);
  assert.equal(intervals.gap('P1',-1,3.5),undefined);
  intervals.reset();assert.equal(intervals.gap('P1',8,4),undefined);
});

test('a stationary rival does not spread pit waiting time over moving samples',()=>{
  const intervals=new RaceIntervals();
  intervals.record('P1',0,0);intervals.record('P1',10,1);
  intervals.record('P1',10,4);intervals.record('P1',20,5);
  assert.equal(intervals.gap('P1',5,6),5.5);
  assert.equal(intervals.gap('P1',10,6),5);
  assert.equal(intervals.gap('P1',15,6),1.5);
});
