import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {AiRace,PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL} from '../src/ai-race.ts';
import {getDriver} from '../src/team-catalog.ts';

const track=new Track(),dt=1/120;
function run(race:AiRace,seconds:number,weather:'sunny'|'rainy'='sunny'){
  for(let i=0;i<Math.round(seconds/dt);i++)race.update(dt,weather);
}

test('five opponents form a separated grid with the selected player third and no duplicate player driver',()=>{
  const race=new AiRace(track);race.start('mercedes','kimi_antonelli_12');
  assert.equal(race.rivals.length,5);assert.equal(race.time,0);
  assert.deepEqual(race.rivals.map(r=>r.distance),[-5,-5,-12,-19,-19]);
  assert.ok(race.rivals.every(r=>r.speed===0&&!r.finished&&r.lap===1&&r.completedLaps===0));
  const rows=race.standings(PLAYER_GRID_DISTANCE);
  assert.equal(rows.find(r=>r.isPlayer)?.position,3);assert.equal(rows.find(r=>r.isPlayer)?.driver,'kimi_antonelli_12');
  assert.ok(race.rivals.every(r=>getDriver(r.driver).teamId===r.team&&r.driver!=='kimi_antonelli_12'));
  const sample=track.sampleAt(PLAYER_GRID_DISTANCE),x=sample.point.x+sample.right.x*PLAYER_GRID_LATERAL,z=sample.point.z+sample.right.z*PLAYER_GRID_LATERAL;
  for(let i=0;i<race.rivals.length;i++){
    const r=race.rivals[i];assert.ok(Math.hypot(x-r.x,z-r.z)>4.5);
    for(const other of race.rivals.slice(i+1))assert.ok(Math.hypot(r.x-other.x,r.z-other.z)>4.5);
  }
});

test('AI brakes in advance of Rettifilo and wet conditions lower its planned speed',()=>{
  const race=new AiRace(track),rival=race.rivals[0],corner=track.corners[0].distance;
  rival.distance=corner-90;const straight=race.targetSpeed(rival);
  rival.distance=corner-18;const approaching=race.targetSpeed(rival),wet=race.targetSpeed(rival,'rainy');
  assert.ok(approaching<straight-8,`${approaching} should be much lower than ${straight}`);
  assert.ok(wet<approaching-1);
  race.start();let braking=false,lastSpeed=0,lastDistance=race.rivals[0].distance;
  for(let i=0;i<25/dt;i++){
    race.update(dt);const car=race.rivals[0];
    if(car.distance>corner-55&&car.distance<corner-8&&car.speed<lastSpeed-.001)braking=true;
    assert.ok(car.distance>=lastDistance);lastSpeed=car.speed;lastDistance=car.distance;
  }
  assert.equal(braking,true,'a visible opponent actually decelerates before turn-in');
});

test('complete AI races stay on asphalt, progress through three laps and stop exactly once at the finish',()=>{
  const race=new AiRace(track);let previous=race.rivals.map(r=>r.distance),braked=false;
  for(let i=0;i<220/dt;i++){
    race.update(dt);
    for(let j=0;j<race.rivals.length;j++){
      const r=race.rivals[j];assert.ok(Number.isFinite(r.x+r.z+r.heading+r.speed));
      assert.ok(r.distance>=previous[j]);assert.ok(r.distance<=track.length*3);
      assert.ok(Math.abs(r.lateral)<=2.801);assert.equal(track.surfaceAt(r.x,r.z),'asphalt');
      assert.ok(r.lap>=1&&r.lap<=3);assert.ok(r.completedLaps>=0&&r.completedLaps<=3);
      if(r.speed>0&&r.speed<15&&r.distance>100)braked=true;previous[j]=r.distance;
    }
  }
  assert.equal(braked,true);assert.ok(race.rivals.every(r=>r.finished&&r.completedLaps===3&&r.lap===3&&r.speed===0));
  assert.ok(race.rivals.every(r=>r.finishTime!>175&&r.finishTime!<210),'medium AI gives a clean human lap a competitive pace');
  const finishes=race.rivals.map(r=>r.finishTime),positions=race.rivals.map(r=>[r.distance,r.x,r.z]);run(race,10);
  assert.deepEqual(race.rivals.map(r=>r.finishTime),finishes);assert.deepEqual(race.rivals.map(r=>[r.distance,r.x,r.z]),positions);
  const table=race.standings(track.length*2.8);assert.equal(table[5].isPlayer,true);assert.ok(table.slice(0,5).every((r,i,all)=>i===0||r.finishTime!>=all[i-1].finishTime!));
});

test('rain takes materially longer and no update during pause changes no opponent or clock state',()=>{
  const dry=new AiRace(track),wet=new AiRace(track);run(dry,220);run(wet,260,'rainy');
  for(let i=0;i<dry.rivals.length;i++)assert.ok(wet.rivals[i].finishTime!>dry.rivals[i].finishTime!*1.10);
  const paused=new AiRace(track);run(paused,8);const snapshot=JSON.stringify({time:paused.time,rivals:paused.rivals});
  paused.update(0);paused.update(-1);paused.update(NaN);assert.equal(JSON.stringify({time:paused.time,rivals:paused.rivals}),snapshot);
  paused.start();assert.equal(paused.time,0);assert.ok(paused.rivals.every(r=>r.speed===0&&r.finishTime===null));
});

test('standings use distance before finishing and exact finish times afterwards, including a player win',()=>{
  const race=new AiRace(track);run(race,10);
  const leader=Math.max(...race.rivals.map(r=>r.distance));const rows=race.standings(leader+1);
  assert.equal(rows[0].id,'player');assert.deepEqual(rows.map(r=>r.position),[1,2,3,4,5,6]);
  run(race,210);const first=Math.min(...race.rivals.map(r=>r.finishTime!));
  const win=race.standings(track.length*3,true,first-1);assert.equal(win[0].id,'player');
  const last=race.standings(track.length*3,true,Math.max(...race.rivals.map(r=>r.finishTime!))+1);assert.equal(last[5].id,'player');
});

test('rival contact separates and slows the player without teleporting progress or repeatedly compounding the impact',()=>{
  const race=new AiRace(track);run(race,5);const r=race.rivals[0],distance=r.distance;
  const x=r.x-Math.sin(r.heading)*3.5,z=r.z-Math.cos(r.heading)*3.5;
  const hit=race.contact(x,z,r.heading,40,dt);assert.equal(hit.hit,true);assert.ok(hit.speed<40&&hit.speed>20);
  assert.ok(Math.hypot(hit.x-x,hit.z-z)>0&&Math.hypot(hit.x-x,hit.z-z)<.23);assert.equal(r.distance,distance);
  const sustained=race.contact(hit.x,hit.z,r.heading,hit.speed,dt);assert.equal(sustained.speed,hit.speed);
  assert.deepEqual(race.contact(x,z,r.heading,40,0),{x,z,speed:40,hit:false});
  const clear=race.contact(x+100,z+100,r.heading,40,dt);assert.equal(clear.hit,false);assert.equal(clear.speed,40);
});
