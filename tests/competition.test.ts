import test from 'node:test';
import assert from 'node:assert/strict';
import {CompetitionProgress,isRaceMode} from '../src/competition.ts';
import {RaceSession} from '../src/race.ts';
const track={length:240,width:16,checkpoints:[0,40,80,120,160,200]};
test('the grid crossing does not award a lap and a missed checkpoint caps race ranking',()=>{
  const p=new CompetitionProgress(track);
  p.update({completed:0,nextCheckpoint:1},228,0);assert.equal(p.progress,-12);
  p.update({completed:0,nextCheckpoint:1},2,1);assert.equal(p.progress,2);
  p.update({completed:0,nextCheckpoint:1},180,4);assert.equal(p.progress,40);
  p.update({completed:1,nextCheckpoint:2},65,70);assert.equal(p.progress,305);
  p.update({completed:3,nextCheckpoint:1},1,190);assert.equal(p.progress,720);assert.equal(p.finished,true);assert.equal(p.finishTime,190);
  p.update({completed:4,nextCheckpoint:2},60,230);assert.equal(p.finishTime,190);
  p.reset();assert.equal(p.finished,false);assert.equal(p.finishTime,null);assert.equal(p.progress,-12);
});
test('opponent racing never writes or improves the time-trial personal best',()=>{
  const writes:string[]=[],storage={getItem:()=> '50',setItem:(key:string)=>{writes.push(key);}};
  const race=new RaceSession(track,storage);race.recordBests=false;race.start();race.update(4.5,0,0,1);
  for(let d=10;d<=240;d+=10)race.update(1,d%240,0,1);
  assert.equal(race.completed,1);assert.equal(race.result?.valid,true);assert.equal(race.result?.best,false);assert.equal(race.best,50);assert.deepEqual(writes,[]);
  race.state='finished';race.update(10,20,0,1);assert.equal(race.elapsed,0);race.pause();race.resume();assert.equal(race.state,'finished');
  assert.equal(isRaceMode('race'),true);assert.equal(isRaceMode('time-trial'),true);assert.equal(isRaceMode('online'),false);
});
