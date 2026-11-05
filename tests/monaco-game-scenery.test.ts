import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createScenery} from '../src/scenery.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';
import {MONACO_GAME_SCALE,type MonacoBarrierSegment} from '../src/monaco-drive-track.ts';
import {teams} from '../src/team-catalog.ts';
import {MONACO_PIT_TEAMS} from '../src/monaco-team-pits.ts';

const track=new Track('monaco'),scene=createScenery(track),reference=createMonacoScenery(track.monacoLayout!);reference.group.scale.setScalar(MONACO_GAME_SCALE);reference.group.updateMatrixWorld(true);scene.updateMatrixWorld(true);
function inspect(root:THREE.Object3D){
 let meshes=0,triangles=0;const colors=new Set<number>(),key=(r:number,g:number,b:number)=>Math.round(r*1e4)*10001**2+Math.round(g*1e4)*10001+Math.round(b*1e4);
 root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;const c=o.geometry.attributes.color;if(c){for(let i=0;i<c.count;i++)colors.add(key(c.getX(i),c.getY(i),c.getZ(i)));}else for(const m of Array.isArray(o.material)?o.material:[o.material])if('color'in m){const color=(m as THREE.MeshStandardMaterial).color;colors.add(key(color.r,color.g,color.b));}});
 return{meshes,triangles,colors};
}
const ownColorArrays=(root:THREE.Object3D)=>{const values:Float32Array[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry.attributes.color)values.push(new Float32Array(o.geometry.attributes.color.array));});return values;};

test('the game keeps every approved Monaco landmark and actual coloured triangle while spatial batching reduces scenery draws',()=>{
 const actual=inspect(scene),approved=inspect(reference.group),bounds=new THREE.Box3().setFromObject(scene,true),expected=new THREE.Box3().setFromObject(reference.group,true);
 assert.equal(actual.triangles,approved.triangles,'Runtime batching lost accepted geometry');assert.deepEqual(actual.colors,approved.colors,'Runtime batching erased or changed the approved vertex palette');
 assert.ok(actual.meshes<approved.meshes&&actual.meshes<=140,'The driving scene should batch city and vegetation instead of preserving every review draw');
 for(const axis of ['x','y','z']as const){assert.ok(Math.abs(bounds.min[axis]-expected.min[axis])<.001);assert.ok(Math.abs(bounds.max[axis]-expected.max[axis])<.001);}
 assert.equal(scene.userData.stands.length,9);assert.equal(scene.userData.monacoGame.yachts,36);assert.equal(scene.userData.forest.instances,110);assert.equal(scene.userData.monacoPitBoxes.length,8);assert.equal(scene.userData.pitComplex.strategyPods.length,8);assert.ok(scene.getObjectByName('la-rascasse-restaurant'));
 const lights:THREE.Object3D[]=[];track.group.traverse(o=>{if(/^start-light-[0-4]$/.test(o.name))lights.push(o);});assert.equal(lights.length,5,'The actual Monaco lamps must join the real countdown controller');
});

test('facility collision walls use oriented world segments and leave the actual garage fronts and parking centres open',()=>{
 const segments=scene.userData.facilityBarrierSegments as MonacoBarrierSegment[];assert.ok(segments.length>100);assert.deepEqual(scene.userData.pitColliders,[],'Rotated facilities must not create invisible axis-aligned blocks in the narrow street');
 for(const s of segments)assert.ok(Object.values(s).every(Number.isFinite)&&s.top>s.bottom&&s.radius>0);
 const distance=(x:number,z:number,s:MonacoBarrierSegment)=>{const dx=s.bx-s.ax,dz=s.bz-s.az,t=THREE.MathUtils.clamp(((x-s.ax)*dx+(z-s.az)*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-s.ax-t*dx,z-s.az-t*dz)-s.radius;};
 for(const b of scene.userData.monacoPitBoxes){
  const mouth=b.center.clone().addScaledVector(b.front,b.depth/2),inside=b.center.clone(),height=b.center.y+.55;
  assert.ok(segments.filter(s=>s.bottom<height&&s.top>height).every(s=>distance(mouth.x,mouth.z,s)>.95),'A collision segment closes a visually open garage mouth');
  assert.ok(segments.filter(s=>s.bottom<height&&s.top>height).every(s=>distance(inside.x,inside.z,s)>.95),'The central car space became a solid collision box');
  const origin=mouth.clone().addScaledVector(b.front,2);origin.y=height;const ray=new THREE.Raycaster(origin,b.front.clone().negate(),0,b.depth/2+1.5);assert.equal(ray.intersectObject(scene,true).length,0,'Actual workshop geometry obstructs the central entrance');
 }
});

test('all eleven player teams receive a correctly coloured physical bay and switching restores the eighth bay without resource growth',()=>{
 const bay=scene.getObjectByName('monaco-pit-box-8')!,pod=scene.getObjectByName('monaco-pitwall-pod-8')!,atlas=scene.getObjectByName('monaco-building-label-pit-frontages')!,label=pod.getObjectByName('monaco-pitwall-team-name')!;
 const original=[...ownColorArrays(bay),...ownColorArrays(pod)],before=inspect(scene).meshes;
 for(const team of teams){
  scene.userData.selectPitTeam(team.id);const expected=MONACO_PIT_TEAMS.includes(team.id)?'haas':team.id;assert.equal(scene.userData.monacoPitAssignments[7],expected);assert.equal(atlas.userData.activeEighthTeam,expected);assert.equal(label.userData.activeEighthTeam,expected);assert.equal(scene.userData.pitComplex.strategyPods[7].teamId,expected);
  if(expected!=='haas'){const color=new THREE.Color(team.color);for(const root of [bay,pod]){const arrays=ownColorArrays(root);assert.ok(arrays.some(a=>{for(let i=0;i<a.length;i+=3)if(Math.abs(a[i]-color.r)<1e-5&&Math.abs(a[i+1]-color.g)<1e-5&&Math.abs(a[i+2]-color.b)<1e-5)return true;return false;}),'The reserved bay/pod retained the previous team colour');}}
 }
 scene.userData.selectPitTeam('ferrari');assert.deepEqual([...ownColorArrays(bay),...ownColorArrays(pod)],original,'Repeated selection accumulated tint or destroyed the permanent Haas palette');assert.equal(inspect(scene).meshes,before);
});
