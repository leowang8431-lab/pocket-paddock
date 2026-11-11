import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Track} from '../src/track.ts';
import {AiRace,PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL,type AiRival,type AiPlayerObstacle} from '../src/ai-race.ts';
import type {WeatherMode} from '../src/conditions.ts';
import {TRACK_SPEED_SCALE} from '../src/speed-scale.ts';

const track=new Track('monaco'),dt=1/60;
const bytes=await fs.readFile(new URL('../public/models/car.glb',import.meta.url));
const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');asset.scene.scale.setScalar(1.4);
const body=new THREE.Box3().setFromObject(asset.scene,true).expandByScalar(.04);
type Point={x:number;z:number};
const rectangle=(r:Pick<AiRival,'x'|'z'|'heading'>)=>{const sx=Math.cos(r.heading),sz=-Math.sin(r.heading),fx=Math.sin(r.heading),fz=Math.cos(r.heading);return[[body.min.x,body.min.z],[body.max.x,body.min.z],[body.max.x,body.max.z],[body.min.x,body.max.z]].map(([x,z])=>({x:r.x+sx*x+fx*z,z:r.z+sz*x+fz*z}));};
const projection=(p:Point,ax:number,az:number,bx:number,bz:number)=>{const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.z-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-ax-dx*t,p.z-az-dz*t);};
const turn=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function segmentGap(a:Point,b:Point,c:Point,d:Point){if(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0)return 0;return Math.min(projection(a,c.x,c.z,d.x,d.z),projection(b,c.x,c.z,d.x,d.z),projection(c,a.x,a.z,b.x,b.z),projection(d,a.x,a.z,b.x,b.z));}
function separate(a:Point[],b:Point[]){for(const poly of [a,b])for(let i=0;i<4;i++){const p=poly[i],q=poly[(i+1)%4],ax=q.z-p.z,az=p.x-q.x,aa=a.map(p=>p.x*ax+p.z*az),bb=b.map(p=>p.x*ax+p.z*az);if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<1e-6)return true;}return false;}
interface Run {race:AiRace;firstLapTimes:number[];minimumCenterMargin:number;minimumBodyMargin:number;narrowFrames:number;parallelFrames:number;}
const cache=new Map<WeatherMode,Run>();
function simulate(weather:WeatherMode):Run {
 const existing=cache.get(weather);if(existing)return existing;
 const race=new AiRace(track,5,3,false),result:Run={race,firstLapTimes:[],minimumCenterMargin:Infinity,minimumBodyMargin:Infinity,narrowFrames:0,parallelFrames:0};
 const radius=Math.max(...[[body.min.x,body.min.z],[body.max.x,body.min.z],[body.max.x,body.max.z],[body.min.x,body.max.z]].map(([x,z])=>Math.hypot(x,z)));assert.ok(radius<2.90,'The planner must reserve the full provided GLB footprint');
 for(let frame=0;frame<800/dt;frame++){
  const before=race.rivals.map(r=>({distance:r.distance,lateral:r.lateral,x:r.x,z:r.z}));race.update(dt,weather);
  const polygons=race.rivals.map(rectangle);
  for(let i=0;i<race.rivals.length;i++){
   const r=race.rivals[i],old=before[i],sample=track.sampleAt(r.distance),poly=polygons[i],near=track.roadProjectionAt(r.x,r.z),margin=track.widthAt(near.distance)/2-near.gap;
   if(r.completedLaps===1&&result.firstLapTimes[i]===undefined)result.firstLapTimes[i]=race.time;
   assert.ok(r.distance>=old.distance&&r.distance-old.distance<=46*TRACK_SPEED_SCALE*dt+1e-8,'Unwrapped progress jumped');assert.ok(Math.abs(r.lateral-old.lateral)<=.95*dt+1e-8,'An AI car snapped sideways into a narrow lane');
   assert.ok(Math.hypot(r.x-old.x,r.z-old.z)<=48*TRACK_SPEED_SCALE*dt+.04,'The visible car teleported while its progress stayed elsewhere');
   assert.ok(Math.hypot(r.x-sample.point.x-sample.right.x*r.lateral,r.z-sample.point.z-sample.right.z*r.lateral)<1e-8,'Visible placement diverges from unwrapped race progress');
   result.minimumCenterMargin=Math.min(result.minimumCenterMargin,margin);assert.ok(margin>radius+.05,`Full GLB radius reaches an edge at ${r.distance}`);
   const steering=track.steeringAngleForSpeed!(r.speed);assert.ok(Math.abs(r.frontWheelAngle)<=steering+1e-8,'Monaco wheels exceed the actual steering rack');
   if(track.widthAt(r.distance)<9){result.narrowFrames++;assert.ok(Math.abs(r.lateral)<.35,'A car reaches the narrow street before merging');}
   const walls=new Set([...poly,{x:r.x,z:r.z}].flatMap(p=>track.barrierSegmentsAt(p.x,p.z)));
   for(const p of poly){const n=track.roadProjectionAt(p.x,p.z),gap=track.widthAt(n.distance)/2-n.gap;result.minimumBodyMargin=Math.min(result.minimumBodyMargin,gap);assert.ok(gap>.035,`An actual GLB corner leaves the road at ${r.distance}`);}
   for(const wall of walls){let gap=Infinity;const a={x:wall.ax,z:wall.az},b={x:wall.bx,z:wall.bz};for(let j=0;j<4;j++)gap=Math.min(gap,segmentGap(poly[j],poly[(j+1)%4],a,b));assert.ok(gap>wall.radius+.035,`An AI GLB overlaps a rendered concrete wall at ${r.distance}`);}
   for(let j=i+1;j<race.rivals.length;j++)if(!r.finished&&!race.rivals[j].finished){assert.ok(separate(poly,polygons[j]),`AI merge overlap ${JSON.stringify({weather,time:race.time,a:r,b:race.rivals[j]})}`);if(r.speed>5&&race.rivals[j].speed>5&&track.widthAt(r.distance)>12&&Math.abs(r.distance-race.rivals[j].distance)<8&&Math.abs(r.lateral-race.rivals[j].lateral)>3.2)result.parallelFrames++;}
  }
  if(race.rivals.every(r=>r.finished))break;
 }
 assert.ok(race.rivals.every(r=>r.finished&&r.completedLaps===3&&r.distance===track.length*3&&r.speed===0),'A queued AI failed to complete all three laps');
 cache.set(weather,result);return result;
}

test('five full-size Monaco opponents complete three dry laps without any visible body leaving the road, touching a wall or crossing another car',()=>{const result=simulate('sunny');assert.ok(result.minimumBodyMargin>.1);});
test('the full Monaco race remains clear in rain and the opening lap takes longer',()=>{
 const dry=simulate('sunny'),wet=simulate('rainy');
 // Opening laps isolate the weather effect before the soft tires run out of tread.
 for(let i=0;i<5;i++)assert.ok(wet.firstLapTimes[i]>dry.firstLapTimes[i]*1.05);
});
test('Monaco opponents merge early into narrow streets while retaining parallel lanes on wider straights',()=>{const result=simulate('sunny');assert.ok(result.narrowFrames>500,`Narrow-road observations: ${result.narrowFrames}`);assert.ok(result.parallelFrames>60,`Parallel-lane observations: ${result.parallelFrames}`);});

function playerAt(distance:number,lateral:number,speed:number):AiPlayerObstacle{const s=track.sampleAt(distance);return{x:s.point.x+s.right.x*lateral,z:s.point.z+s.right.z*lateral,heading:Math.atan2(s.tangent.x,s.tangent.z),speed,finished:false};}
function assertPlayerClear(race:AiRace,player:AiPlayerObstacle){const box=rectangle(player),others=race.rivals.map(rectangle);for(let i=0;i<others.length;i++){assert.ok(separate(box,others[i]),`AI ${race.rivals[i].id} crossed the actual player's GLB at ${race.time}`);for(let j=i+1;j<others.length;j++)assert.ok(separate(others[i],others[j]),'Queueing behind the player caused AI cars to overlap');}}

test('the rear Monaco grid rows respect a stationary real player for ten seconds in dry and wet conditions',()=>{
 for(const weather of ['sunny','rainy'] as const){
  const race=new AiRace(track),player=playerAt(PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL,0);let queued=false;
  for(let frame=0;frame<10/dt;frame++){race.setPlayerObstacle(player);race.update(dt,weather);assertPlayerClear(race,player);if(race.time>2&&race.rivals.some(r=>r.distance<PLAYER_GRID_DISTANCE&&r.speed<.5))queued=true;}
  assert.ok(queued,'A rear car never waited for the unmoving player');assert.ok(race.rivals.some(r=>r.distance>30),'The player obstacle froze the entire race');
 }
});

test('Monaco traffic follows a slow then braking player in a narrow third-lap approach using wrapped physical position',()=>{
 const narrow=track.samples.reduce((a,b)=>track.widthAt(a.distance)<track.widthAt(b.distance)?a:b),race=new AiRace(track);
 let distance=track.length*2+narrow.distance-28;
 // Declared traffic fixture: only the initial queue is placed before a real
 // street. Every subsequent progress, lane and visible pose is normal AI code.
 for(let i=0;i<race.rivals.length;i++){const r=race.rivals[i],s=track.sampleAt(distance-(i+1)*12);Object.assign(r,{distance:distance-(i+1)*12,speed:3,lateral:0,x:s.point.x,z:s.point.z,heading:Math.atan2(s.tangent.x,s.tangent.z),lap:3,completedLaps:2});}
 const plans=(race as unknown as {plans:{targetLane:number;homeLane:number;reaction:number}[]}).plans;for(const plan of plans){plan.targetLane=0;plan.homeLane=0;plan.reaction=0;}
 let stoppedFollower=false;
 for(let frame=0;frame<30/dt;frame++){
  const time=frame*dt,speed=time<8?4:time<16?8:time<18?8-(time-16)*4:0;distance+=speed*dt;
  const player=playerAt(distance,0,speed),before=race.rivals.map(r=>r.distance);race.setPlayerObstacle(player);race.update(dt,'rainy');assertPlayerClear(race,player);
  race.rivals.forEach((r,i)=>{assert.ok(r.distance>=before[i]&&r.distance-before[i]<=40*TRACK_SPEED_SCALE*dt+1e-8);assert.ok(Math.abs(r.frontWheelAngle)<=track.steeringAngleForSpeed!(r.speed)+1e-8);});
  if(time>22&&race.rivals[0].speed<.8)stoppedFollower=true;
 }
 assert.ok(stoppedFollower,'The following car did not brake for the stopped player');
});

test('an opponent passes a slower player on the wide Monaco straight and merges before Sainte Dévote',()=>{
 const race=new AiRace(track,1);
 for(let frame=0;frame<3/dt;frame++)race.update(dt);
 const rival=race.rivals[0],start=playerAt(-140,PLAYER_GRID_LATERAL,28);
 Object.assign(rival,start,{distance:-140,lateral:PLAYER_GRID_LATERAL,
  vx:28*Math.sin(start.heading),vz:28*Math.cos(start.heading),yawRate:0});
 let playerDistance=-112,maxLane=rival.lateral;
 for(let frame=0;frame<9/dt;frame++){
  playerDistance+=18*dt;
  const player=playerAt(playerDistance,PLAYER_GRID_LATERAL,18);
  race.setPlayerObstacle(player);race.update(dt);
  maxLane=Math.max(maxLane,rival.lateral);
  assertPlayerClear(race,player);
 }
 assert.ok(rival.distance>playerDistance+25&&maxLane>2.6,'The opponent uses the available lane to pass');
 assert.ok(rival.lateral<maxLane-1,'The opponent returns toward the centre before the road narrows');
});

test('a high-speed side impact sends the rival toward the rendered wall, which stops the slide without skipping race progress',()=>{
 const narrow=track.samples.reduce((a,b)=>track.widthAt(a.distance)<track.widthAt(b.distance)?a:b);
 const race=new AiRace(track,1),rival=race.rivals[0],fixture=playerAt(narrow.distance,1.3,12);
 const fx=Math.sin(fixture.heading),fz=Math.cos(fixture.heading),rx=fz,rz=-fx;
 Object.assign(rival,fixture,{distance:narrow.distance,lateral:1.3,vx:12*fx,vz:12*fz,yawRate:0});
 const player={x:rival.x-rx*2.36+.7*fx,z:rival.z-rz*2.36+.7*fz,heading:rival.heading,vx:rival.vx+43*rx,vz:rival.vz+43*rz,yawRate:0};
 assert.ok(race.contactPlayer(player,dt)>40);
 let maxLateral=rival.lateral;
 for(let frame=0;frame<1.5/dt;frame++){
  const before=rival.distance;
  race.update(dt);
  const poly=rectangle(rival),walls=new Set([...poly,rival].flatMap(p=>track.barrierSegmentsAt(p.x,p.z)));
  for(const wall of walls){
   const a={x:wall.ax,z:wall.az},b={x:wall.bx,z:wall.bz};
   for(let i=0;i<4;i++)assert.ok(segmentGap(poly[i],poly[(i+1)%4],a,b)>wall.radius,'The slid car clips a concrete wall');
  }
  maxLateral=Math.max(maxLateral,rival.lateral);
  assert.ok(rival.distance>=before&&rival.distance-before<40*TRACK_SPEED_SCALE*dt);
 }
 assert.ok(maxLateral>2.4&&rival.lateral<maxLateral-.15,'The rival moves sideways and recovers from the boundary');
});
