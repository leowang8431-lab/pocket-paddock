import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {addMonzaForest,createTreeGeometry,TREE_KINDS,type TreeLocation} from '../src/monza-forest.ts';
import {addTracksideSafety,createTracksideSafetyLayout,distanceToSafetyFootprint,safetyFootprint,tracksideTreeExclusion,tyreStackPositions} from '../src/trackside-safety.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createPitComplexLayout} from '../src/pit-complex.ts';
import {createBackgroundLandmarkLayouts,distanceToLandmark} from '../src/monza-landmarks.ts';
import {batchStaticScenery} from '../src/render-batches.ts';

const track=new Track(),originalColliders=track.colliders.map(c=>({...c})),layout=createTracksideSafetyLayout(track);
const triangles=(g:THREE.BufferGeometry)=>(g.index?.count??g.attributes.position.count)/3;

test('park trees have four distinct non-spherical silhouettes with cheaper distant geometry',()=>{
  const sizes:THREE.Vector3[]=[];
  for(const kind of TREE_KINDS){
    const near=createTreeGeometry(kind),far=createTreeGeometry(kind,true),size=near.boundingBox!.getSize(new THREE.Vector3());sizes.push(size);
    assert.ok(triangles(far)<triangles(near)*.72,`${kind} needs a meaningful distant reduction`);
    assert.ok(near.boundingBox!.min.y>=-.001);assert.ok(size.x<9&&size.z<9&&size.y<14);
    assert.equal(near.attributes.color.count,near.attributes.position.count);assert.equal(near.userData.kind,kind);
  }
  assert.ok(sizes[1].x/sizes[1].y>sizes[2].x/sizes[2].y*2,'flat crown and columnar crown must be visibly different');
  assert.ok(sizes[2].y>sizes[0].y+3,'columnar silhouette must not just be a recoloured oak');
  assert.ok(sizes[3].y>sizes[1].y+1.5,'layered crown has its own height');
});

test('620 tree positions and scales are preserved while visible forest cells use at most two instanced draws',()=>{
  const root=new THREE.Group(),trees:TreeLocation[]=Array.from({length:620},(_,i)=>({x:-210+(i%31)*17.3,z:-401+Math.floor(i/31)*34.4,s:.7+i%8*.1,color:new THREE.Color(0x5d7b48)})),before=trees.map(t=>({...t,color:t.color.clone()}));
  addMonzaForest(root,trees);root.updateMatrixWorld(true);assert.equal(root.userData.forest.instances,620);assert.equal(Object.values(root.userData.forest.counts).reduce((a:any,b:any)=>a+b,0),620);assert.deepEqual(trees,before);
  assert.ok(TREE_KINDS.every(kind=>root.userData.forest.counts[kind]>0));
  let activeInstances=0;
  for(const cell of root.children){assert.ok(cell instanceof THREE.LOD);const lod=cell as THREE.LOD;
    assert.equal(lod.levels.length,3);assert.equal(lod.levels[1].distance,105);assert.equal(lod.levels[2].distance,340);
    for(const level of lod.levels.slice(0,2)){assert.ok(level.object.children.length<=2);assert.ok(level.object.children.every(m=>m instanceof THREE.InstancedMesh));}
    activeInstances+=lod.levels[0].object.children.reduce((sum,m)=>sum+(m as THREE.InstancedMesh).count,0);
  }
  assert.equal(activeInstances,620);
});

test('four complete service footprints stay outside every road, stand, pit stair and background building',()=>{
  assert.deepEqual(createTracksideSafetyLayout(track),layout);assert.equal(layout.vehicles.length,4);
  assert.equal(layout.vehicles.filter(v=>v.kind==='recovery-crane').length,2);assert.equal(layout.vehicles.filter(v=>v.kind==='medical-van').length,2);
  const stands=createStandLayouts(track),pit=createPitComplexLayout(track),landmarks=createBackgroundLandmarkLayouts(track);
  for(const vehicle of layout.vehicles){const n=track.nearest(vehicle.x,vehicle.z);assert.ok(Math.hypot(vehicle.x-n.point.x,vehicle.z-n.point.z)>=35);assert.equal(tracksideTreeExclusion(vehicle.x,vehicle.z,layout),true);
    for(const p of safetyFootprint(vehicle,20)){const near=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-near.point.x,p.z-near.point.z)>26);assert.equal(track.isPitLane(p.x,p.z),false);
      assert.ok(stands.every(s=>distanceToStand(p.x,p.z,s)>3));assert.ok(pit.footprints.every(b=>distanceToSafetyFootprint(p.x,p.z,b)>2));assert.ok(landmarks.every(b=>distanceToLandmark(p.x,p.z,b)>3));}
  }
});

test('crane boom, cable and van detailing remain inside audited footprints and survive shared static batching',()=>{
  const root=new THREE.Group(),p=new THREE.Vector3();addTracksideSafety(root,track,layout);root.updateMatrixWorld(true);let vertices=0;
  for(const vehicle of layout.vehicles){const group=root.getObjectByName(vehicle.id)!;let meshes=0;
    group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;meshes++;const positions=o.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i).applyMatrix4(o.matrix);vertices++;assert.ok(Math.abs(p.x)<=vehicle.width/2+.001,`${vehicle.id} width overflow`);assert.ok(Math.abs(p.z)<=vehicle.depth/2+.001,`${vehicle.id} boom/depth overflow`);assert.ok(p.y>=-.001&&p.y<=vehicle.height+.001);p.applyMatrix4(group.matrixWorld);const near=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-near.point.x,p.z-near.point.z)>26);}
    });assert.ok(meshes>40,'service models must have wheels, windows, seams and functional equipment');
  }
  assert.ok(vertices>5000);const tyres=root.getObjectByName('runoff-tyre-buffers');batchStaticScenery(root);assert.equal(root.getObjectByName('runoff-tyre-buffers'),tyres);assert.equal(root.userData.tracksideSafety,layout);
});

test('four gravel runoff tyre buffers fit in front of the guardrail in one draw below 40000 triangles',()=>{
  assert.equal(layout.tyreBarriers.length,4);assert.deepEqual(layout.tyreBarriers.map(b=>b.corner.split(' · ')[0]),['Rettifilo','Roggia','Ascari','Alboreto']);
  let tyreCount=0;
  for(const barrier of layout.tyreBarriers){assert.equal(barrier.layers,3);assert.ok(barrier.offsets.length<=2);const points=tyreStackPositions(track,barrier);assert.equal(points.length,barrier.tyres);tyreCount+=points.length;
    for(const p of points){const inner=track.sampleAt(p.distance);assert.equal(track.surfaceAt(inner.point.x+inner.right.x*18.5*barrier.side,inner.point.z+inner.right.z*18.5*barrier.side),'gravel');
      for(let a=0;a<16;a++){const x=p.x+Math.cos(a*Math.PI/8)*.44,z=p.z+Math.sin(a*Math.PI/8)*.44,n=track.nearest(x,z),distance=Math.hypot(x-n.point.x,z-n.point.z);assert.ok(distance>21.7&&distance<23.81);assert.equal(track.isPitLane(x,z),false);}
    }
  }
  const root=new THREE.Group();addTracksideSafety(root,track,layout);const tyres=root.getObjectByName('runoff-tyre-buffers') as THREE.InstancedMesh;
  assert.ok(tyres instanceof THREE.InstancedMesh);assert.equal(tyres.count,tyreCount);assert.ok(triangles(tyres.geometry)*tyres.count<40000);
  assert.deepEqual(track.colliders,originalColliders,'decorative additions must not change collision or timing rules');
});
