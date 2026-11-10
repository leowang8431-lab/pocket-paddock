import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {AiRace,createRaceGrid} from '../src/ai-race.ts';
import {RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH} from '../src/race-contact.ts';
import {startGridSlot} from '../src/start-grid.ts';
import {Track} from '../src/track.ts';

const down=new THREE.Vector3(0,-1,0);

for(const circuit of ['monza','spa','monaco'] as const)test(`${circuit} paints centred, forward-facing slots around the actual shuffled start grid`,()=>{
  const track=new Track(circuit),race=new AiRace(track),grid=createRaceGrid(race.count,()=>.4);
  race.start(undefined,undefined,'sunny',grid);
  track.group.updateMatrixWorld(true);
  const markers:THREE.Object3D[]=[],paint:THREE.Mesh[]=[],asphalt:THREE.Mesh[]=[];
  track.group.traverse(object=>{
    if(object.name===`${circuit}-start-grid-box`)markers.push(object);
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
    if(object.material.name==='start-grid-paint')paint.push(object);
    if(object.material.name==='monza-asphalt'||object.name==='spa-road'||object.name==='monaco-asphalt-ribbon')asphalt.push(object);
  });
  assert.equal(markers.length,10);
  assert.ok(paint.length>0&&asphalt.length>0);
  const raycast=(x:number,z:number,y:number,meshes:THREE.Mesh[])=>new THREE.Raycaster(new THREE.Vector3(x,y+2,z),down).intersectObjects(meshes,false)[0];
  for(const mesh of paint){
    const vertices=mesh.geometry.getAttribute('position'),vertex=new THREE.Vector3();
    for(let i=0;i<vertices.count;i++){
      vertex.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
      const road=raycast(vertex.x,vertex.z,vertex.y,asphalt);
      assert.ok(road&&vertex.y-road.point.y>.004&&vertex.y-road.point.y<.1,'Paint follows the rendered asphalt');
    }
  }
  const centers=markers.map((marker,i)=>{
    const slot=startGridSlot(i),sample=track.sampleAt(slot.distance),expected=sample.point.clone().addScaledVector(sample.right,slot.lateral);
    const center=marker.getWorldPosition(new THREE.Vector3());
    assert.ok(center.distanceTo(expected)<1e-8);
    const forward=marker.localToWorld(new THREE.Vector3(0,0,1)).sub(center).normalize();
    assert.ok(forward.dot(sample.tangent)>1-1e-8);
    // Check both side lines and the forward stop line against rendered road,
    // with an open rear and an unobstructed car-sized centre.
    const probes=[
      center.clone().addScaledVector(sample.right,RACE_CAR_HALF_WIDTH+.32),
      center.clone().addScaledVector(sample.right,-RACE_CAR_HALF_WIDTH-.32),
      center.clone().addScaledVector(forward,RACE_CAR_HALF_LENGTH+.36),
    ];
    for(const p of probes){
      const stripe=raycast(p.x,p.z,p.y,paint),road=raycast(p.x,p.z,p.y,asphalt);
      assert.ok(stripe&&road,'Paint is visible directly over the asphalt');
      assert.ok(stripe.point.y-road.point.y>.004&&stripe.point.y-road.point.y<.1);
    }
    const rear=center.clone().addScaledVector(forward,-RACE_CAR_HALF_LENGTH-.36);
    assert.equal(raycast(rear.x,rear.z,rear.y,paint),undefined,'The U opens toward the arriving car');
    assert.equal(raycast(center.x,center.z,center.y,paint),undefined);
    return center;
  });
  const playerSample=track.sampleAt(grid.player.distance);
  const player=playerSample.point.clone().addScaledVector(playerSample.right,grid.player.lateral);
  assert.ok(centers.some(center=>center.distanceTo(player)<1e-8));
  for(const rival of race.rivals){
    assert.ok(centers.some(center=>Math.hypot(center.x-rival.x,center.z-rival.z)<1e-8));
  }
});
