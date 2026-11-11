import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {AiRace,createRaceGrid,PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL} from '../src/ai-race.ts';
import {getDriver} from '../src/team-catalog.ts';
import {RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH} from '../src/race-contact.ts';

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

test('a shuffled grid assigns each car one real slot and resolves same-row ranks by slot order',()=>{
  const race=new AiRace(track),grid=createRaceGrid(5,()=>0);
  assert.deepEqual(grid,createRaceGrid(5,()=>0));
  assert.notDeepEqual(grid,createRaceGrid(5,()=>.999999));
  const next=createRaceGrid(5,()=>0,grid.player);
  assert.notDeepEqual(next.player,grid.player);
  assert.ok(next.rivals.some(slot=>slot.distance===grid.player.distance&&slot.lateral===grid.player.lateral));
  const slots=[grid.player,...grid.rivals].sort((a,b)=>b.distance-a.distance||a.lateral-b.lateral);
  assert.deepEqual(slots,[-5,-12,-19].flatMap(distance=>[-2.5,2.5].map(lateral=>({distance,lateral}))));
  race.start(undefined,undefined,'sunny',grid);
  assert.deepEqual(race.rivals.map(({distance,lateral})=>({distance,lateral})),grid.rivals);
  assert.deepEqual(race.standings(grid.player.distance).slice(0,2).map(row=>row.id),['ai-5','player']);
  assert.equal(race.standings(NaN).find(row=>row.isPlayer)?.position,2);
});

test('an unobstructed Monza launch applies full throttle immediately',()=>{
  const race=new AiRace(track,1);run(race,.3);
  assert.equal(race.rivals[0].throttle,1);
  assert.ok(race.rivals[0].speed>4.5);
});

test('an AI car actually loses straight-line speed after running its tyres down to zero',()=>{
  const race=new AiRace(track,1,8,false),rival=race.rivals[0];
  let freshSpeed=0,exhaustedSpeed=0;
  while(race.time<900&&!rival.finished){
    race.update(dt);
    const station=rival.distance%track.length;
    if(station<95||station>150)continue;
    if(rival.tyreWear<.1)freshSpeed=Math.max(freshSpeed,rival.speed);
    if(rival.tyreWear===1)exhaustedSpeed=Math.max(exhaustedSpeed,rival.speed);
  }
  assert.equal(rival.finished,true);
  assert.ok(freshSpeed>35,'The car builds speed on the main straight with fresh tyres');
  assert.ok(exhaustedSpeed>0,'The same car still drives after its tyres are exhausted');
  assert.ok(exhaustedSpeed<freshSpeed*.6,`Worn tyres capped at ${exhaustedSpeed} against ${freshSpeed} on fresh tyres`);
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
  const race=new AiRace(track,5,3,false);let previous=race.rivals.map(r=>r.distance),braked=false;
  const bodyRadius=Math.hypot(RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH);
  for(let i=0;i<220/dt;i++){
    race.update(dt);
    for(let j=0;j<race.rivals.length;j++){
      const r=race.rivals[j];assert.ok(Number.isFinite(r.x+r.z+r.heading+r.speed));
      assert.ok(r.distance>=previous[j]);assert.ok(r.distance<=track.length*3);
      assert.ok(Math.abs(r.lateral)+bodyRadius<track.widthAt(r.distance)/2);assert.equal(track.surfaceAt(r.x,r.z),'asphalt');
      assert.ok(r.lap>=1&&r.lap<=3);assert.ok(r.completedLaps>=0&&r.completedLaps<=3);
      if(r.speed>0&&r.speed<15&&r.distance>100)braked=true;previous[j]=r.distance;
    }
  }
  assert.equal(braked,true);assert.ok(race.rivals.every(r=>r.finished&&r.completedLaps===3&&r.lap===3&&r.speed===0));
  assert.ok(race.rivals.every(r=>r.finishTime!>120&&r.finishTime!<153),'three dry laps stay within the calibrated pace range');
  assert.ok(Math.min(...race.rivals.map(r=>r.finishTime!))<135,'the fastest car gains time from the optimized line');
  const finishes=race.rivals.map(r=>r.finishTime),positions=race.rivals.map(r=>[r.distance,r.x,r.z]);run(race,10);
  assert.deepEqual(race.rivals.map(r=>r.finishTime),finishes);assert.deepEqual(race.rivals.map(r=>[r.distance,r.x,r.z]),positions);
  const table=race.standings(track.length*2.8);assert.equal(table[5].isPlayer,true);assert.ok(table.slice(0,5).every((r,i,all)=>i===0||r.finishTime!>=all[i-1].finishTime!));
});

test('rain takes materially longer and no update during pause changes no opponent or clock state',()=>{
  const dry=new AiRace(track,5,3,false),wet=new AiRace(track,5,3,false);run(dry,220);run(wet,260,'rainy');
  for(let i=0;i<dry.rivals.length;i++)assert.ok(wet.rivals[i].finishTime!>dry.rivals[i].finishTime!*1.07);
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

test('rear contact transfers momentum to the opponent and separates both cars without another hit as they move apart',()=>{
  const race=new AiRace(track,1);run(race,5);
  const r=race.rivals[0],distance=r.distance,fx=Math.sin(r.heading),fz=Math.cos(r.heading),approach=2*RACE_CAR_HALF_LENGTH-.07;
  const initialSpeed=r.speed+12;
  const player={x:r.x-fx*approach,z:r.z-fz*approach,heading:r.heading,vx:fx*initialSpeed,vz:fz*initialSpeed,yawRate:0};
  const initial={...player},rivalSpeed=r.speed;
  assert.equal(race.contactPlayer(player,0),0);assert.deepEqual(player,initial);
  const impact=race.contactPlayer(player,dt);
  assert.ok(impact>11&&impact<13);
  assert.ok(Math.hypot(player.vx,player.vz)<initialSpeed&&r.speed>rivalSpeed);
  assert.ok(Math.hypot(player.x-initial.x,player.z-initial.z)>0&&r.distance>distance&&r.distance<distance+.1);
  const velocity=[player.vx,player.vz,r.vx,r.vz];
  assert.equal(race.contactPlayer(player,dt),0);
  assert.deepEqual([player.vx,player.vz,r.vx,r.vz],velocity);
});

test('a stopped rival rolls forward after being rear-ended even when its lane is blocked',()=>{
  const race=new AiRace(track,2);run(race,3);
  const [rival,blocker]=race.rivals,lateral=PLAYER_GRID_LATERAL;
  for(const [car,distance] of [[rival,80],[blocker,95]] as const){
    const {point,tangent,right}=track.sampleAt(distance);
    Object.assign(car,{distance,lateral,x:point.x+right.x*lateral,z:point.z+right.z*lateral,
      heading:Math.atan2(tangent.x,tangent.z),speed:0,vx:0,vz:0,yawRate:0});
  }
  const fx=Math.sin(rival.heading),fz=Math.cos(rival.heading),offset=2*RACE_CAR_HALF_LENGTH-.07;
  const player={x:rival.x-fx*offset,z:rival.z-fz*offset,heading:rival.heading,vx:fx*32,vz:fz*32,yawRate:0};
  assert.ok(race.contactPlayer(player,dt)>30);
  const pushedSpeed=rival.speed,hitPosition=rival.distance;
  assert.ok(pushedSpeed>17&&Math.hypot(player.vx,player.vz)>12);
  run(race,.12);
  assert.ok(rival.speed>pushedSpeed-2);
  assert.ok(rival.distance-hitPosition>1.8);
});

test('a side contact changes the rival lane and leaves a visible slide and rotation after the next physics tick',()=>{
  const race=new AiRace(track,1);run(race,3);const r=race.rivals[0],heading=r.heading,initialLateral=r.lateral;
  const fx=Math.sin(heading),fz=Math.cos(heading),rx=fz,rz=-fx;
  const player={x:r.x-rx*2.34+fx,z:r.z-rz*2.34+fz,heading,vx:r.vx+rx*14,vz:r.vz+rz*14,yawRate:0};
  assert.ok(race.contactPlayer(player,dt)>10);
  const lateral=r.lateral;
  assert.ok(lateral>initialLateral);
  assert.ok(Math.abs(r.yawRate)>.1);
  race.update(dt);
  assert.ok(r.lateral-lateral>.02,'steering did not cancel the lateral impulse');
  assert.ok(Math.abs(r.heading-heading)>.005,'rival heading follows the contact torque');
});

test('two rivals also exchange momentum when the trailing car runs out of braking distance',()=>{
  const race=new AiRace(track,2);run(race,3);
  const [trailing,leading]=race.rivals;
  for(const [rival,distance,speed] of [[trailing,80,32],[leading,84.65,10]] as const){
    const {point,tangent,right}=track.sampleAt(distance),lateral=PLAYER_GRID_LATERAL;
    Object.assign(rival,{distance,speed,lateral,x:point.x+right.x*lateral,z:point.z+right.z*lateral,
      heading:Math.atan2(tangent.x,tangent.z),vx:speed*tangent.x,vz:speed*tangent.z,yawRate:0});
  }
  race.update(dt);
  assert.ok(trailing.speed<24&&leading.speed>18);
  run(race,.1);
  assert.ok(Math.hypot(leading.x-trailing.x,leading.z-trailing.z)>2*RACE_CAR_HALF_LENGTH);
});

test('open-circuit opponents use the real player position to choose when to brake and pass',()=>{
  const clear=new AiRace(track),traffic=new AiRace(track),blocked=traffic.rivals[1];
  const sample=track.sampleAt(80);
  traffic.setPlayerObstacle({
    x:sample.point.x+sample.right.x*blocked.lateral,z:sample.point.z+sample.right.z*blocked.lateral,
    heading:Math.atan2(sample.tangent.x,sample.tangent.z),speed:0,finished:false,
  });
  run(clear,5);run(traffic,5);
  assert.ok(blocked.distance+12<clear.rivals[1].distance);
  assert.ok(blocked.speed+5<clear.rivals[1].speed);
  assert.notEqual(traffic.standings(80).find(r=>r.id===blocked.id)?.position,clear.standings(80).find(r=>r.id===blocked.id)?.position);
});

test('a rival passes in clear space but waits for a fast rear car in the other lane',()=>{
  function pose(distance:number,lateral:number,speed:number){
    const {point,right,tangent}=track.sampleAt(distance);
    return {distance,lateral,speed,finished:false,x:point.x+lateral*right.x,z:point.z+lateral*right.z,
      heading:Math.atan2(tangent.x,tangent.z),vx:speed*tangent.x,vz:speed*tangent.z};
  }
  function runPass(rearCar:boolean){
    const race=new AiRace(track,2);run(race,3);
    const [rival,other]=race.rivals;
    Object.assign(rival,pose(50,-2.5,28));
    Object.assign(other,rearCar?pose(22,2.5,40):pose(-70,2.5,0));
    let lateralAtOneSecond=0,playerDistance=78;
    for(let i=0;i<6/dt;i++){
      playerDistance+=18*dt;
      race.setPlayerObstacle(pose(playerDistance,-2.5,18));race.update(dt);
      if(i+1===1/dt)lateralAtOneSecond=rival.lateral;
    }
    return {lateralAtOneSecond,lateral:rival.lateral,gap:rival.distance-playerDistance};
  }
  const clear=runPass(false),occupied=runPass(true);
  assert.ok(clear.lateralAtOneSecond>-1.7&&clear.lateral>2.6&&clear.gap>10);
  assert.equal(occupied.lateralAtOneSecond,-2.5);
  assert.ok(occupied.lateral>0,'The car takes the lane once traffic clears');
  assert.ok(occupied.gap<clear.gap-10);
});
