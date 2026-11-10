import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {MONACO_GAME_SCALE} from '../src/monaco-drive-track.ts';
import {steeringAngleForSpeed} from '../src/handling.ts';
const track=new Track('monaco');track.group.updateMatrixWorld(true);

test('Monaco gameplay uses the approved nineteen-corner map and facilities at one uniform metre-sized scale',()=>{
 assert.equal(MONACO_GAME_SCALE,3.2);assert.equal(track.monacoScale,3.2);assert.ok(Math.abs(track.length-3337)<.1);assert.equal(track.corners.length,19);assert.equal(track.checkpoints.length,24);assert.equal(track.monacoDrive!.pitBoxes.length,8);assert.ok(Math.min(...track.monacoLayout!.roadWidths)*3.2>6.5);assert.ok(track.steeringAngleForSpeed!(0)>steeringAngleForSpeed(0));
 const road=track.group.getObjectByName('monaco-asphalt-ribbon') as THREE.Mesh;assert.ok(road);const pos=road.geometry.attributes.position;
 for(let i=0;i<track.samples.length;i+=11){const s=track.samples[i],a=new THREE.Vector3().fromBufferAttribute(pos,i*2).applyMatrix4(road.matrixWorld),b=new THREE.Vector3().fromBufferAttribute(pos,i*2+1).applyMatrix4(road.matrixWorld);assert.ok(a.clone().lerp(b,.5).distanceTo(s.point)<.0001);assert.ok(Math.abs(a.distanceTo(b)-track.widthAt(s.distance))<.0001);assert.equal(track.surfaceAt(s.point.x,s.point.z),'asphalt');}
 const monza=new Track(),spa=new Track('spa');assert.equal(monza.length,1426.4443446817202);assert.ok(Math.abs(spa.length-4202.4)<1e-6);assert.equal(monza.steeringAngleForSpeed,undefined);assert.equal(spa.steeringAngleForSpeed,undefined);
});

test('Monaco height and pitch follow the actual main and separate pit GPU surfaces, including the tunnel and garage apron',()=>{
 const road=track.group.getObjectByName('monaco-asphalt-ribbon')!,pit=track.group.getObjectByName('monaco-separate-pit-lane')!;let pitChecks=0;
 for(let d=0;d<track.length;d+=13){const s=track.sampleAt(d),hits=new THREE.Raycaster(s.point.clone().add(new THREE.Vector3(0,100,0)),new THREE.Vector3(0,-1,0),0,200).intersectObject(road);assert.ok(hits.length);assert.ok(Math.abs(hits[0].point.y-track.heightAt(s.point.x,s.point.z))<.04);assert.ok(Number.isFinite(track.gradeAlongHeadingAt(s.point.x,s.point.z,Math.atan2(s.tangent.x,s.tangent.z))));}
 for(let i=3;i<track.pitPath.length-3;i+=5){const p=track.pitPath[i];if(!track.isPitLane(p.x,p.z))continue;const hits=new THREE.Raycaster(new THREE.Vector3(p.x,p.y+100,p.z),new THREE.Vector3(0,-1,0),0,200).intersectObject(pit);if(!hits.length)continue;assert.ok(Math.abs(hits[0].point.y-track.heightAt(p.x,p.z))<.025);assert.ok(Math.abs(hits[0].point.y-p.y)<.025);pitChecks++;}
 assert.ok(pitChecks>25);assert.ok(track.samples.some(s=>s.point.y>40));
});

test('a Monaco wall separates the car and reflects the velocity directed into it',()=>{
 assert.ok(track.barrierSegments.length>1000);
 const wall=track.barrierSegments.find(w=>track.nearest((w.ax+w.bx)/2,(w.az+w.bz)/2).distance<15)!;assert.ok(wall);
 const cx=(wall.ax+wall.bx)/2,cz=(wall.az+wall.bz)/2,near=track.nearest(cx,cz);
 const inside=new THREE.Vector3(wall.bz-wall.az,0,wall.ax-wall.bx).normalize();
 if(inside.x*(near.point.x-cx)+inside.z*(near.point.z-cz)<0)inside.negate();
 const car=new VehiclePhysics();car.reset(cx+inside.x*.4,cz+inside.z*.4,Math.atan2(-inside.x,-inside.z));
 car.speed=15;car.vx=-inside.x*15;car.vz=-inside.z*15;
 const impact=car.update(1/120,{throttle:false,brake:false,left:false,right:false},track);
 assert.ok(impact>10);assert.equal(car.collision,1);
 assert.ok(car.vx*inside.x+car.vz*inside.z>0);
 assert.ok(Math.hypot(car.x-cx,car.z-cz)>=wall.radius+.94);
 assert.equal(track.surfaceAt(near.point.x,near.point.z),'asphalt');
});
