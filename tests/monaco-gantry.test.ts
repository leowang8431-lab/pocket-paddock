import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
layout.group.updateMatrixWorld(true);scenery.group.updateMatrixWorld(true);
const start=layout.group.getObjectByName('monaco-start-finish')!,gantry=start.getObjectByName('monaco-start-light-gantry')!;
assert.ok(gantry,'The relocated signal assembly must retain inspectable geometry');
const inverse=start.matrixWorld.clone().invert();
function triangles(root:THREE.Object3D){
 const result:THREE.Triangle[]=[];root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const p=o.geometry.attributes.position,index=o.geometry.index,m=inverse.clone().multiply(o.matrixWorld);
  for(let i=0;i<(index?.count??p.count);i+=3){const t=new THREE.Triangle();for(const [j,v]of [t.a,t.b,t.c].entries())v.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(m);result.push(t);}
 });return result;
}
const frames:THREE.Mesh[]=[];gantry.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial&&o.material.emissive.getHex()===0)frames.push(o);});
assert.ok(frames.length,'No physical signal frame');
const foot=new THREE.Box3(),column=new THREE.Box3(),beam=new THREE.Box3();
// Recover the actual axis-aligned structural solids from their baked surface
// triangles, after batching. This also catches an obsolete second support.
for(const frame of frames)for(const triangle of triangles(frame)){
 const b=new THREE.Box3().setFromPoints([triangle.a,triangle.b,triangle.c]),size=b.getSize(new THREE.Vector3());
 const target=size.y>4?column:size.x>layout.widthAt(0)&&b.min.y>4?beam:b.max.y<0?foot:null;
 if(target)target.union(b);
}
assert.ok(!foot.isEmpty()&&!column.isEmpty()&&!beam.isEmpty());
const solids=[foot,column,beam];
for(const frame of frames)for(const triangle of triangles(frame))for(const p of [triangle.a,triangle.b,triangle.c])assert.ok(solids.some(b=>b.clone().expandByScalar(.00001).containsPoint(p)),'An unclassified frame fragment remains outside the audited support and beam');

test('the complete single-support light frame clears actual garages, pitwall rooms, stands, barriers and catch fences in three dimensions',()=>{
 const obstacles=[scenery.buildings,scenery.group.getObjectByName('monaco-pits-and-grandstands')!,scenery.group.getObjectByName('monaco-palms-and-gardens')!,layout.group.getObjectByName('monaco-race-barriers')!,layout.group.getObjectByName('monaco-catch-fence-0')!,layout.group.getObjectByName('monaco-catch-fence-1')!];
 let checked=0;for(const root of obstacles)for(const triangle of triangles(root)){checked++;for(const solid of solids)assert.equal(solid.intersectsTriangle(triangle),false,`Actual gantry structure intersects ${root.name}`);}
 assert.ok(checked>100000,'The test must inspect complete actual architecture rather than placement metadata');
 const garages=triangles(scenery.group.getObjectByName('monaco-pit-garages')!),nearest=new THREE.Box3().setFromPoints(garages.flatMap(t=>[t.a,t.b,t.c])).max.x;
 assert.ok(beam.min.x-nearest>.5,'The free beam tip does not leave enough clearance beside the pit building');
});

test('the cantilever spans the original racing width while its only column and grounded footing remain off both driven routes',()=>{
 const half=layout.widthAt(0)/2;assert.ok(beam.min.x< -half-.2&&beam.max.x>half+.2);assert.ok(beam.min.y>4.5);
 assert.ok(column.min.x>half+.5&&column.getSize(new THREE.Vector3()).x<.6,'A second support or a support in the race lane remains');
 for(const solid of [column,foot])for(const x of [solid.min.x,solid.max.x])for(const z of [solid.min.z,solid.max.z]){
  const world=start.localToWorld(new THREE.Vector3(x,solid.min.y,z)),near=layout.nearest(world.x,world.z);assert.ok(near.gap>layout.widthAt(near.distance)/2+.5,'A complete support corner enters the racing asphalt');
  let gap=Infinity;for(let i=1;i<layout.pitPath.length;i++){const a=layout.pitPath[i-1],b=layout.pitPath[i],dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((world.x-a.x)*dx+(world.z-a.z)*dz)/(dx*dx+dz*dz),0,1);gap=Math.min(gap,Math.hypot(world.x-a.x-t*dx,world.z-a.z-t*dz));}assert.ok(gap>layout.pitProfile.fastWidth/2+.5,'A support corner enters the actual pit lane');
 }
 const base=foot.getCenter(new THREE.Vector3());base.y=foot.min.y;start.localToWorld(base);const ray=new THREE.Raycaster(base.clone().add(new THREE.Vector3(0,.2,0)),new THREE.Vector3(0,-1,0),0,1),ground=ray.intersectObject(scenery.group,true)[0];
 assert.ok(ground,'The support must have actual ground below it');assert.ok(Math.abs(base.y-ground.point.y)<.00001,'The actual footing floats above or penetrates its ground');assert.ok(foot.max.y>foot.min.y);
});

test('all five physical start lamps remain above the unchanged checkerboard line and grid',()=>{
 const lamps:THREE.Mesh[]=[];gantry.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial&&o.material.emissive.getHex()>0)lamps.push(o);});assert.equal(lamps.length,5);
 const positions=lamps.map(o=>o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse)).sort((a,b)=>a.x-b.x);
 assert.ok(positions.every(p=>p.y>6&&p.z<-.525&&Math.abs(p.x)<layout.widthAt(0)/2),'Signal bulbs must protrude towards the negative-Z starting grid');for(let i=1;i<positions.length;i++)assert.ok(positions[i].x-positions[i-1].x>.5,'Two signal lamps occupy the same place');
 const eye=start.localToWorld(new THREE.Vector3(0,.7,-12));for(const lamp of lamps){const target=lamp.getWorldPosition(new THREE.Vector3()),hits=new THREE.Raycaster(eye,target.sub(eye).normalize()).intersectObject(gantry,true);assert.equal(hits[0]?.object,lamp,'The light frame hides a red bulb from a waiting driver');}
 assert.ok(start.getWorldPosition(new THREE.Vector3()).distanceTo(layout.sampleAt(0).point)<1e-9,'Start line was moved to conceal the clipping');
 const checker=new THREE.Box3();let tiles=0;for(const child of start.children)if(child instanceof THREE.Mesh){const b=new THREE.Box3().setFromObject(child).applyMatrix4(inverse);if(b.max.y<.1){checker.union(b);tiles++;}}
 assert.equal(tiles,24);assert.ok(checker.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(0,.05,0))<.00001);assert.ok(checker.getSize(new THREE.Vector3()).x>5.9);
 assert.equal(layout.group.children.filter(o=>o.name==='monaco-start-grid-box').length,10);
});
