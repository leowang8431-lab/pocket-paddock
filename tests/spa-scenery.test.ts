import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createSpaScenery,addSpaGrandstand,spaStandBounds,spaStandFootprint,distanceToSpaStand,type SpaStandLayout} from '../src/spa-scenery.ts';
import {pitFootprint,type PitComplexLayout} from '../src/pit-complex.ts';
import {teams} from '../src/team-catalog.ts';

const track=new Track('spa'),scene=createSpaScenery(track),stands=scene.userData.stands as SpaStandLayout[],pit=scene.userData.pitComplex as PitComplexLayout;
const toWorld=(s:SpaStandLayout,x:number,z:number)=>({x:s.x+Math.cos(s.yaw)*x+Math.sin(s.yaw)*z,z:s.z-Math.sin(s.yaw)*x+Math.cos(s.yaw)*z});
const polygons=stands.map(s=>{const b=spaStandBounds(s);return[[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ]].map(([x,z])=>toWorld(s,x,z));});

test('Spa has 21 independent stands with a referenced 4600-position Raidillon landmark on the photographed side',()=>{
  assert.equal(stands.length,21);assert.equal(new Set(stands.map(s=>s.id)).size,21);
  const main=stands[0],sample=track.sampleAt(main.target.distance);
  assert.equal(main.feature,true);assert.equal(main.capacity,4600);assert.equal(main.rows,40);assert.equal(main.columns,115);
  assert.ok((main.x-sample.point.x)*sample.right.x+(main.z-sample.point.z)*sample.right.z<0,'landmark must be on the driving-view right');
  assert.match(main.reference,/spa-francorchamps.be/);assert.equal(scene.userData.grandstands.spectators,9766);
  assert.match(scene.userData.grandstands.artistic,/authored/);
  for(const s of stands){
    const dx=s.target.x-s.x,dz=s.target.z-s.z;
    assert.ok((-Math.sin(s.yaw)*dx-Math.cos(s.yaw)*dz)/Math.hypot(dx,dz)>.999999,`${s.id} faces away`);
    for(const row of [0,s.rows-1])for(const x of [-s.width/2+.8,0,s.width/2-.8]){
      const p=toWorld(s,x,row*s.pitch),dx=s.target.x-p.x,dz=s.target.z-p.z;
      assert.ok((-Math.sin(s.yaw)*dx-Math.cos(s.yaw)*dz)/Math.hypot(dx,dz)>.5,`${s.id} end seats face away`);
    }
  }
});

test('complete stand roofs and foundations clear the whole elevated road, pit lane, buildings and each other',()=>{
  for(let i=0;i<stands.length;i++){
    const s=stands[i];let min=Infinity;
    for(let k=0;k<6000;k++){const p=track.sampleAt(k/6000*track.length).point;min=Math.min(min,distanceToSpaStand(p.x,p.z,s));}
    assert.ok(min>28.6,`${s.id} overlaps road/runoff (${min})`);
    for(const p of spaStandFootprint(s,12)){
      assert.equal(track.isPitLane(p.x,p.z),false,`${s.id} enters pit lane`);
      assert.ok(s.baseY>=track.terrainMeshHeightAt(p.x,p.z)-.02,`${s.id} base enters hillside`);
      for(const f of pit.footprints){const dx=p.x-f.x,dz=p.z-f.z,c=Math.cos(f.yaw),v=Math.sin(f.yaw);
        assert.ok(Math.hypot(Math.max(0,Math.abs(c*dx-v*dz)-f.width/2),Math.max(0,Math.abs(v*dx+c*dz)-f.depth/2))>4.8,`${s.id} hits ${f.id}`);}
    }
    for(let j=0;j<i;j++){
      let separated=false;
      for(const angle of [s.yaw,s.yaw+Math.PI/2,stands[j].yaw,stands[j].yaw+Math.PI/2]){
        const axis={x:Math.cos(angle),z:-Math.sin(angle)},a=polygons[i].map(p=>p.x*axis.x+p.z*axis.z),b=polygons[j].map(p=>p.x*axis.x+p.z*axis.z);
        if(Math.max(...a)+4.9<Math.min(...b)||Math.max(...b)+4.9<Math.min(...a))separated=true;
      }
      assert.ok(separated,`${s.id} overlaps ${stands[j].id}`);
    }
  }
});

test('actual stand mesh vertices and exterior access stay within the audited footprint with a continuous seating bowl',()=>{
  for(const s of [stands[0],stands[1]]){
    const root=new THREE.Group(),group=addSpaGrandstand(root,track,s),bounds=spaStandBounds(s);root.updateMatrixWorld(true);
    const inverse=group.matrixWorld.clone().invert(),p=new THREE.Vector3();
    assert.ok(group.getObjectByName('continuous-raked-seating-bowl'));
    group.traverse(o=>{if(!(o instanceof THREE.Mesh)||o instanceof THREE.InstancedMesh)return;
      const matrix=inverse.clone().multiply(o.matrixWorld),positions=o.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i).applyMatrix4(matrix);
        assert.ok(p.x>=bounds.minX-.015&&p.x<=bounds.maxX+.015&&p.z>=bounds.minZ-.015&&p.z<=bounds.maxZ+.015,`${s.id}: ${o.name} geometry escapes collision footprint (${p.x},${p.z})`);}
    });
    if(s.feature){assert.equal(group.userData.terraceAccess.length,2);
      for(const entry of group.userData.terraceAccess){assert.ok(Math.abs(entry.groundY-track.terrainMeshHeightAt(entry.x,entry.z))<1e-7);assert.ok(entry.landingY>entry.groundY);}}
    for(const pier of group.userData.footings)assert.ok(pier.bottom<=track.terrainMeshHeightAt(pier.x,pier.z)+1e-7,'support stops above actual terrain mesh');
    let lods=0;group.traverse(o=>{if(o instanceof THREE.LOD){lods++;assert.equal(o.levels[0].object.children.length,2);assert.equal(o.levels[1].object.children.length,2);}});assert.equal(lods,1);
  }
});

test('Spa keeps all eleven complete strategy rooms and torso/helmet staff without copying Monza-specific towers',()=>{
  assert.equal(pit.strategyPods.length,teams.length);assert.deepEqual(pit.strategyPods.map(p=>p.teamId),teams.map(t=>t.id));
  assert.deepEqual(pit.towers,[]);assert.deepEqual(pit.stairs,[]);assert.deepEqual(pit.clubs,[]);
  assert.ok(pit.boxes.x< -120);assert.ok(Math.abs(pit.boxes.height-18.34375)<1e-8);
  const paddock=scene.getObjectByName('spa-gp-pit-building')!;assert.ok(paddock);
  assert.equal(paddock.userData.strategyDetails.pods,11);assert.equal(paddock.userData.strategyDetails.engineers,44);assert.equal(paddock.userData.strategyDetails.mechanics,24);
  for(const support of paddock.userData.foundations){const f=pit.footprints.find(f=>f.id===support.id)!;
    assert.ok(support.bottom<Math.min(...pitFootprint(f,8).map(p=>track.terrainMeshHeightAt(p.x,p.z))));}
  let people=0;paddock.traverse(o=>{if(o.userData.style==='torso-and-team-helmet'){people++;assert.equal(o.userData.legs,false);}});assert.equal(people,68);
  for(const f of [pit.boxes,...pit.strategyPods,...pit.clockBeam.posts])for(const p of pitFootprint(f,12)){
    const near=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-near.point.x,p.z-near.point.z)>track.width/2+3,`${f.id} enters GP road`);
    assert.equal(track.isPitLane(p.x,p.z),false,`${f.id} enters driven pit lane`);
  }
  const clock=scene.userData.pitClockController,before=clock.summary;clock.update(10);assert.equal(clock.summary.elapsed,before.elapsed+10);const pause=clock.summary;clock.update(0);assert.deepEqual(clock.summary,pause);
  assert.equal(scene.userData.pitColliders.length,35);assert.equal(scene.userData.tracksideSafety.vehicles.length,0);
});

test('all 1800 mixed-forest instances meet terrain and clear track fences, stands and facilities',()=>{
  let count=0,kinds=new Set<string>();const matrix=new THREE.Matrix4(),p=new THREE.Vector3();
  scene.updateMatrixWorld(true);scene.traverse(o=>{
    if(!(o instanceof THREE.InstancedMesh)||!/^spa-(fir|broadleaf)-near$/.test(o.name))return;kinds.add(o.name);
    for(let i=0;i<o.count;i++){
      o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);p.setFromMatrixPosition(matrix);count++;
      assert.ok(Math.abs(p.y-track.terrainMeshHeightAt(p.x,p.z))<.004,`floating tree at ${p.x}/${p.z}`);
      const near=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-near.point.x,p.z-near.point.z)>38.99);
      assert.ok(stands.every(s=>distanceToSpaStand(p.x,p.z,s)>7.99));assert.equal(track.isPitLane(p.x,p.z),false);
    }
  });
  assert.equal(count,1800);assert.equal(kinds.size,2);assert.equal(scene.userData.forest.maxDrawsPerCell,2);
  scene.traverse(o=>{if(o instanceof THREE.Mesh)assert.equal(o.castShadow,false);});
});
