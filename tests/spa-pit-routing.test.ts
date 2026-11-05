import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {SPA_PIT_LAYOUT} from '../src/spa-pit-layout.ts';

const spa=new Track('spa'),path=spa.pitPath;
const arc=[0];
for(let i=1;i<path.length;i++)arc.push(arc.at(-1)!+Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z));

test('the F1 pit route leaves between the Bus Stop turns and occupies the real driver-right side of the start straight',()=>{
 const profile=spa.spaPitProfile!,bus=spa.corners.find(c=>c.name.startsWith('Bus Stop'))!,source=spa.corners.find(c=>c.name.startsWith('La Source'))!;
 assert.ok(Math.abs(profile.entryRaceDistance-bus.distance)<2,'Pit entry still bypasses all of T18 from the earlier approach');
 const start=spa.sampleAt(profile.entryRaceDistance),first=path[1].clone().sub(path[0]).setY(0).normalize();
 assert.ok(first.dot(start.tangent)>.999,'The entrance forks with a heading kink');
 // Official pit timing coordinates lie east of the race straight. In this
 // authored frame, the straight points towards -Z and driver-right is +X.
 assert.ok(SPA_PIT_LAYOUT.fastCenterX>spa.sampleAt(0).point.x+15,'The complete pit complex is still mirrored onto the outside');
 assert.ok(profile.exitRaceDistance>source.distance+100,'Pit exit merges before rounding La Source');
 for(const p of path){
  const near=spa.nearest(p.x,p.z),left=(p.x-near.point.x)*near.right.x+(p.z-near.point.z)*near.right.z;
  assert.ok(left<.06,`The pit centreline crosses to the driver's left at ${p.x},${p.z}`);
 }
});

test('the full-width pit ribbon has positive inside radii, no near-duplicate points, and a continuous level garage frontage',()=>{
 let radius=Infinity,checks=0;
 for(let i=1;i<path.length-1;i++){
  const a=path[i-1],b=path[i],c=path[i+1],ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ca=Math.hypot(c.x-a.x,c.z-a.z);
  assert.ok(ab>.15&&bc>.15,'A nearly repeated ramp sample folds the carriageway edge');
  const twiceArea=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x));
  if(twiceArea>1e-8)radius=Math.min(radius,ab*bc*ca/(2*twiceArea));
  if(b.z>=SPA_PIT_LAYOUT.serviceMinZ&&b.z<=SPA_PIT_LAYOUT.serviceMaxZ&&Math.abs(b.x-SPA_PIT_LAYOUT.fastCenterX)<.01){
   assert.ok(Math.abs(b.y-SPA_PIT_LAYOUT.serviceY)<1e-8,'The garage frontage has become a ramp');
   assert.ok(b.x+SPA_PIT_LAYOUT.fastHalfWidth<SPA_PIT_LAYOUT.garageFrontX-4,'The full fast-lane width cuts into the garage frontage');checks++;
  }
 }
 assert.ok(radius>SPA_PIT_LAYOUT.fastHalfWidth+1.5,`Pit inner carriageway folds at a ${radius}u centreline radius`);
 assert.ok(checks>70,'The complete eleven-team service straight is no longer retained');
 assert.ok(arc.at(-1)!<540,'The entrance still makes the former long detour around the entire Bus Stop');
});
