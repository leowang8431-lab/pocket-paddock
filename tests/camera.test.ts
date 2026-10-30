import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ChaseCamera,CAMERA_MODES,CAMERA_PROFILES,isCameraMode,isMenuView,type CameraMode} from '../src/camera.ts';

const near=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const position=new THREE.Vector3(20,.11,40);
function make(mode:CameraMode='standard',aspect=1.6){const camera=new THREE.PerspectiveCamera(50,aspect,.1,800),chase=new ChaseCamera(camera);chase.setMode(mode);return{camera,chase};}
/** The complete prepared player model's conservative envelope, including tyres. */
function projectedBounds(camera:THREE.PerspectiveCamera,anchor:THREE.Vector3){
  camera.updateMatrixWorld(true);const points:THREE.Vector3[]=[];
  for(const x of [-1.162,1.162])for(const y of [0,1.415])for(const z of [-2.366,2.366])points.push(new THREE.Vector3(x,y,z).add(anchor).project(camera));
  return{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
}

test('three driving distances cycle predictably and the default low camera does not depend on speed',()=>{
  const {chase}=make();assert.equal(chase.mode,'standard');assert.equal(chase.menuView,'front');
  assert.deepEqual([chase.cycleMode(),chase.cycleMode(),chase.cycleMode()],['far','close','standard']);
  assert.equal(isCameraMode('close'),true);assert.equal(isCameraMode('cockpit'),false);assert.equal(isMenuView('side'),true);assert.equal(isMenuView('orbit'),false);
  for(const mode of CAMERA_MODES){const {camera,chase}=make(mode);chase.update(position,0,0,1/60);const still=projectedBounds(camera,position);
    const p=position.clone();for(let i=0;i<480;i++){const speed=Math.min(44.5,i/6);p.z+=speed/60;chase.update(p,0,speed,1/60);}
    const fast=projectedBounds(camera,p);for(const key of ['minX','maxX','minY','maxY'] as const)near(fast[key],still[key]);
    near(chase.summary.distance,CAMERA_PROFILES[mode].distance);near(chase.summary.height,CAMERA_PROFILES[mode].height);near(camera.fov,CAMERA_PROFILES[mode].fov);
    assert.ok(chase.summary.height<3.4);assert.ok(fast.minY>-.85,'complete car stays above the bottom control bar');
  }
});

test('straight-line acceleration has no accumulated world-space camera lag at different frame rates',()=>{
  for(const rate of [30,60,120]){const {camera,chase}=make(),p=position.clone();chase.update(p,.37,0,1/rate);
    for(let i=0;i<rate*8;i++){const speed=Math.min(44.5,i/rate*15);p.x+=Math.sin(.37)*speed/rate;p.z+=Math.cos(.37)*speed/rate;chase.update(p,.37,speed,1/rate);}
    near(camera.position.x-p.x,-Math.sin(.37)*8);near(camera.position.z-p.z,-Math.cos(.37)*8);near(chase.summary.distance,8);near(chase.summary.height,2.8);
  }
});

test('turns and distance selection move smoothly while a stationary zero-step update freezes the camera',()=>{
  const {camera,chase}=make();chase.update(position,0,20,1/60);const initial=camera.position.clone();chase.update(position,Math.PI/2,20,1/60);
  assert.ok(camera.position.distanceTo(initial)>0&&camera.position.distanceTo(initial)<1.6,'even an abrupt quarter-turn input must not teleport the local camera orbit');near(chase.summary.distance,8);
  for(let i=0;i<150;i++)chase.update(position,Math.PI/2,30,1/60);
  const before=chase.summary,quaternion=camera.quaternion.clone();chase.update(position.clone().addScalar(10),0,0,0);
  assert.deepEqual(chase.summary,before);assert.ok(camera.quaternion.equals(quaternion));
  chase.setMode('close');chase.update(position,Math.PI/2,30,1/60);assert.ok(chase.summary.distance>6.6&&chase.summary.distance<8);
  for(let i=0;i<120;i++)chase.update(position,Math.PI/2,30,1/60);near(chase.summary.distance,6.6,1e-5);
  chase.setMode('far');chase.update(position,Math.PI/2,30,0);near(chase.summary.distance,10.3);near(camera.fov,49);
});

test('reset and portrait resize keep the complete chassis in frame without raising the camera',()=>{
  const {camera,chase}=make();chase.update(position,0,40,1/60);const reset=new THREE.Vector3(-100,.11,-150);
  chase.snap();chase.update(reset,Math.PI,0,0);near(camera.position.x,reset.x);near(camera.position.z,reset.z+8);near(camera.position.y,2.91);
  for(const aspect of [391/844,320/844,740/391])for(const mode of CAMERA_MODES){camera.aspect=aspect;camera.updateProjectionMatrix();chase.setMode(mode);chase.snap();chase.update(position,0,44.5,0);const bounds=projectedBounds(camera,position);
    assert.ok(bounds.minX>-.92&&bounds.maxX<.92,`${mode}: tyres leave portrait view`);assert.ok(bounds.minY>-.85&&bounds.maxY<.8);near(chase.summary.height,CAMERA_PROFILES[mode].height);
  }
});

test('the garage defaults to a complete front three-quarter view and supports side and rear on desktop and portrait',()=>{
  for(const aspect of [1.6,391/844,320/844]){
    const {camera,chase}=make('standard',aspect);
    for(const view of ['front','side','rear'] as const){chase.setMenuView(view);chase.update(position,0,0,0,true);const bounds=projectedBounds(camera,position);
      assert.ok(bounds.minX>-.97&&bounds.maxX<.97,`${view} car is clipped`);assert.ok(bounds.minY>-.8&&bounds.maxY<.8);
      if(aspect<1)assert.ok(bounds.minY>.1,'portrait showroom leaves the lower card area clear');
      if(view==='front')assert.ok(camera.position.z>position.z,'front wing faces the showroom camera');
      if(view==='side')assert.ok(camera.position.x>position.x+8,'side profile is distinct');
      if(view==='rear')assert.ok(camera.position.z<position.z,'rear view remains available');
    }
    assert.deepEqual([chase.cycleMenuView(),chase.cycleMenuView(),chase.cycleMenuView()],['front','side','rear']);
  }
});
