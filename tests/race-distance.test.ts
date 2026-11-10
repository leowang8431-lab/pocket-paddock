import test from 'node:test';
import assert from 'node:assert/strict';
import {AiRace} from '../src/ai-race.ts';
import {CIRCUITS} from '../src/circuits.ts';
import {Track} from '../src/track.ts';
import {PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';

const dt=1/60;
for(const [circuit,laps] of [['monza',8],['spa',5],['monaco',5]] as const){
  test(`${circuit} rivals finish after exactly ${laps} laps`,()=>{
    const track=new Track(circuit),race=new AiRace(track,5,CIRCUITS[circuit].raceLaps);
    assert.equal(race.totalLaps,laps);
    const finish=track.length*laps;
    const serviceStarted=new Map<string,number>();
    let completedServices=0;
    while(race.time<laps*300&&!race.rivals.every(rival=>rival.finished)){
      race.update(dt);
      for(const rival of race.rivals){
        assert.ok(rival.distance<=finish);
        if(rival.finished)assert.equal(rival.distance,finish);
        if(rival.pitState==='service'){
          assert.equal(rival.speed,0);
          if(!serviceStarted.has(rival.id))serviceStarted.set(rival.id,race.time);
        }else if(serviceStarted.has(rival.id)){
          assert.equal(rival.pitState,'exit');
          const duration=race.time-serviceStarted.get(rival.id)!;
          assert.ok(duration>=2-dt&&duration<=4+dt);
          assert.equal(rival.tyreWear,0);
          serviceStarted.delete(rival.id);completedServices++;
        }
        if(rival.pitState==='approach'||rival.pitState==='exit')assert.ok(rival.speed<=PIT_SPEED_LIMIT+1e-8);
      }
    }
    assert.ok(race.rivals.filter(rival=>rival.pitStops>0).length>=3);
    assert.equal(completedServices,race.rivals.reduce((total,rival)=>total+rival.pitStops,0));
    for(const rival of race.rivals){
      assert.equal(rival.finished,true);
      assert.equal(rival.completedLaps,laps);
      assert.equal(rival.speed,0);
      assert.ok(rival.finishTime!==null&&rival.finishTime>0&&Number.isFinite(rival.finishTime));
    }
  });
}
