import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {roadPose} from '../src/road-pose.ts';

const spa=new Track('spa');
const radiansToDegrees=180/Math.PI;
const heading=(a:{x:number;z:number},b:{x:number;z:number})=>Math.atan2(b.x-a.x,b.z-a.z);

test('the actual Spa car pose changes smoothly every tenth of a unit without flattening the documented climb',()=>{
 let previous=0,maximumJump=0,at=0,minimum=Infinity,maximum=-Infinity,maximumGrade=0;
 for(let d=0;d<=spa.length;d+=.1){
  const s=spa.sampleAt(d),h=Math.atan2(s.tangent.x,s.tangent.z),pose=roadPose(spa,s.point.x,s.point.z,h);
  assert.ok(Number.isFinite(pose.height+pose.pitch));minimum=Math.min(minimum,s.point.y);maximum=Math.max(maximum,s.point.y);maximumGrade=Math.max(maximumGrade,Math.abs(spa.gradeAt(d)));
  if(d>0){const jump=Math.abs(pose.pitch-previous)*radiansToDegrees;if(jump>maximumJump){maximumJump=jump;at=d;}}previous=pose.pitch;
 }
 assert.ok(maximumJump<.25,`Actual roadPose pitch jumps ${maximumJump.toFixed(4)} degrees in 0.1u at distance ${at.toFixed(2)}`);
 assert.ok(maximum-minimum>57,'Smoothing must retain Spa height variation');assert.ok(maximumGrade>.10&&maximumGrade<.20,'The climb must remain substantial and drivable');
 const low=spa.corners.find(c=>c.name.startsWith('Eau Rouge'))!,high=spa.corners.find(c=>c.name.startsWith('Kemmel'))!;
 assert.ok(spa.sampleAt(high.distance).point.y-spa.sampleAt(low.distance).point.y>32,'Eau Rouge/Raidillon was flattened to hide the discontinuity');
});

test('rendered road, sample heights and longitudinal grade describe the same smooth surface',()=>{
 const road=spa.group.getObjectByName('spa-road');assert.ok(road instanceof THREE.Mesh);road.updateWorldMatrix(true,true);
 const positions=road.geometry.attributes.position;
 for(let i=0;i<spa.samples.length;i+=7){
  const s=spa.samples[i],left=new THREE.Vector3().fromBufferAttribute(positions,i*2),right=new THREE.Vector3().fromBufferAttribute(positions,i*2+1);
  assert.ok(Math.abs((left.y+right.y)/2-s.point.y-.045)<.00003,'GPU roadway height differs from its source profile');
 }
 for(let d=.2;d<spa.length;d+=4.3){
  const s=spa.sampleAt(d),before=spa.sampleAt(d-.05).point,after=spa.sampleAt(d+.05).point,numerical=(after.y-before.y)/Math.hypot(after.x-before.x,after.z-before.z);
  assert.ok(Math.abs(spa.gradeAt(d)-numerical)<.002,`Grade and height derivative disagree at ${d}`);
  const h=heading(before,after),pose=roadPose(spa,s.point.x,s.point.z,h);
  assert.ok(Math.abs(pose.height-s.point.y-.11)<.035,`Ground pose leaves the actual roadway profile at ${d}`);
  assert.ok(Math.abs(pose.pitch+Math.atan(numerical))<.005,`Car pitch does not follow the actual surface derivative at ${d}`);
 }
 const start=spa.sampleAt(0),finish=spa.sampleAt(spa.length-.001);assert.ok(start.point.distanceTo(finish.point)<.002);assert.ok(Math.abs(spa.gradeAt(0)-spa.gradeAt(spa.length-.001))<.0002,'Start/finish grade has a lap-seam kink');
 const monza=new Track('monza');assert.equal(monza.length,1426.4443446817202);assert.equal(monza.gradeAt(0),0);assert.deepEqual(roadPose(monza,-85,100,Math.PI),{height:.11,pitch:0});
});

test('the real pit ramps and ground pose have continuous height and pitch along horizontal arc length',()=>{
 const path=spa.pitPath,arc=[0];for(let i=1;i<path.length;i++)arc.push(arc.at(-1)!+Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z));
 const at=(distance:number)=>{let lo=0,hi=arc.length-1;while(lo+1<hi){const middle=(lo+hi)>>1;if(arc[middle]<=distance)lo=middle;else hi=middle;}const t=THREE.MathUtils.clamp((distance-arc[lo])/(arc[hi]-arc[lo]),0,1),a=path[lo],b=path[hi];return{x:THREE.MathUtils.lerp(a.x,b.x,t),y:THREE.MathUtils.lerp(a.y,b.y,t),z:THREE.MathUtils.lerp(a.z,b.z,t),heading:heading(a,b)};};
 let previousPitch=0,previousHeight=0,maximumPitchJump=0,maximumHeightJump=0,rampSamples=0;
 for(let d=.1;d<arc.at(-1)!-.1;d+=.1){const p=at(d),pose=roadPose(spa,p.x,p.z,p.heading);if(d>.15){maximumPitchJump=Math.max(maximumPitchJump,Math.abs(pose.pitch-previousPitch)*radiansToDegrees);maximumHeightJump=Math.max(maximumHeightJump,Math.abs(pose.height-previousHeight));}previousPitch=pose.pitch;previousHeight=pose.height;if(Math.abs(pose.pitch)>.01)rampSamples++;
  assert.ok(Math.abs(pose.height-p.y-.11)<.035,'Pit ground height differs from its actual ramp centreline');
 }
 assert.ok(maximumPitchJump<.25,`Pit ramp pitch jumps ${maximumPitchJump.toFixed(4)} degrees per 0.1u`);assert.ok(maximumHeightJump<.04,`Pit ramp ground height jumps ${maximumHeightJump}`);assert.ok(rampSamples>20,'The ramps have been flattened rather than smoothed');
 for(const [index,neighbor]of [[0,1],[path.length-1,path.length-2]]){const p=path[index],adjacent=path[neighbor],direction=index===0?new THREE.Vector3(adjacent.x-p.x,0,adjacent.z-p.z):new THREE.Vector3(p.x-adjacent.x,0,p.z-adjacent.z),near=spa.nearest(p.x,p.z),onRoad=spa.sampleAt(near.distance);assert.ok(Math.abs(p.y-onRoad.point.y)<.08,'Pit end cap has a vertical step at the racing surface');const slope=(index===0?adjacent.y-p.y:p.y-adjacent.y)/direction.length(),main=spa.gradeAt(near.distance)*(onRoad.tangent.x*direction.x+onRoad.tangent.z*direction.z)/direction.length();assert.ok(Math.abs(slope-main)<.012,'Pit ramp does not meet the track grade continuously');}
});
