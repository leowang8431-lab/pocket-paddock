import test from 'node:test';
import assert from 'node:assert/strict';
import {CompetitionProgress,isRaceMode} from '../src/competition.ts';
import {RaceSession} from '../src/race.ts';
const track={length:240,width:16,checkpoints:[0,40,80,120,160,200]};
test('grid and running rank use actual position and completed laps',()=>{
  const p=new CompetitionProgress(track);
  p.update({completed:0,totalPenalty:0},228,0);assert.equal(p.progress,-12);
  p.update({completed:0,totalPenalty:0},2,1);assert.equal(p.progress,2);
  p.update({completed:0,totalPenalty:0},180,4);assert.equal(p.progress,180);
  p.update({completed:1,totalPenalty:3},65,70);assert.equal(p.progress,305);
  p.update({completed:3,totalPenalty:6},1,190);assert.equal(p.progress,720);assert.equal(p.finished,true);assert.equal(p.finishTime,196);
  p.update({completed:4,totalPenalty:9},60,230);assert.equal(p.finishTime,196);
  p.reset();assert.equal(p.finished,false);assert.equal(p.finishTime,null);assert.equal(p.progress,-12);
});
test('a backwards crossing after a spin drops progress and the finish crossing is timed within the step',()=>{
  const p=new CompetitionProgress(track);
  p.update({completed:1,totalPenalty:0},2,1);assert.equal(p.progress,242);
  p.update({completed:1,totalPenalty:0},239,1.1);assert.equal(p.progress,239);
  p.update({completed:1,totalPenalty:0},238,1.2);assert.equal(p.progress,238);
  p.update({completed:1,totalPenalty:0},1,1.3);assert.equal(p.progress,241);
  p.update({completed:2,totalPenalty:0},239,45);
  p.update({completed:3,totalPenalty:0},3,45.02);
  assert.ok(Math.abs(p.finishTime!-45.005)<1e-9);
});
test('opponent racing never writes or improves the time-trial personal best',()=>{
  const writes:string[]=[],storage={getItem:()=> '50',setItem:(key:string)=>{writes.push(key);}};
  const race=new RaceSession(track,storage);race.recordBests=false;race.start();race.update(4.5,0,0,1);
  for(let d=10;d<=240;d+=10)race.update(1,d%240,0,1);
  assert.equal(race.completed,1);assert.equal(race.result?.valid,true);assert.equal(race.result?.best,false);assert.equal(race.best,50);assert.deepEqual(writes,[]);
  race.state='finished';race.update(10,20,0,1);assert.equal(race.elapsed,0);race.pause();race.resume();assert.equal(race.state,'finished');
  assert.equal(isRaceMode('race'),true);assert.equal(isRaceMode('time-trial'),true);assert.equal(isRaceMode('online'),false);
});
