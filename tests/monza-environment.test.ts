import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createCircuitPropLayouts,propFootprint} from '../src/monza-surroundings.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';

const track=new Track();
test('three Armco rails and full catch-fence panels leave the drivable circuit and pit joins clear',()=>{
  const rails=track.group.getObjectByName('armco-three-rail') as THREE.InstancedMesh;
  const fence=track.group.getObjectByName('catch-fence-mesh') as THREE.InstancedMesh;
  const posts=track.group.getObjectByName('catch-fence-posts') as THREE.InstancedMesh;
  const top=track.group.getObjectByName('catch-fence-canted-top') as THREE.InstancedMesh;
  assert.ok(fence.count>500&&fence.count<800);
  assert.equal(rails.count,fence.count*3);assert.equal(posts.count,fence.count);assert.equal(top.count,fence.count);
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(let i=0;i<fence.count;i++){
    fence.getMatrixAt(i,matrix);
    // Probe the whole panel span, rather than checking only the pole centre.
    for(const x of [-2.11,-1.05,0,1.05,2.11]){
      point.set(x,0,0).applyMatrix4(matrix);
      const nearest=track.nearest(point.x,point.z);
      assert.ok(point.distanceTo(new THREE.Vector3(nearest.point.x,point.y,nearest.point.z))>19.5,`fence ${i} encroaches onto the road`);
      assert.equal(track.isPitLane(point.x,point.z),false,`fence ${i} blocks the pit lane`);
    }
  }
});

test('both asphalt surfaces expose independent wet-road material bindings',()=>{
  const materials=new Set<THREE.Material>();
  track.group.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
  const roads=[...materials].filter(material=>material.userData.weatherSurface==='road');
  assert.equal(roads.length,2);
  assert.deepEqual(roads.map(material=>material.name).sort(),['monza-asphalt','monza-pit-asphalt']);
  assert.notEqual(roads[0],roads[1]);
  assert.ok(roads.every(material=>material instanceof THREE.MeshStandardMaterial));
  const [main,pit]=roads as THREE.MeshStandardMaterial[];
  assert.equal(main.color.getHex(),pit.color.getHex(),'overlapping pit joins must not paint lighter polygons on the circuit');
  assert.equal(main.roughness,pit.roughness);
  assert.equal(main.metalness,pit.metalness);
  assert.equal(main.map,pit.map,'world-coordinate asphalt texture stays continuous across both joins');
});

test('service and spectator props retain their full clearance from the circuit, pit joins and stands',()=>{
  const props=createCircuitPropLayouts(track),stands=createStandLayouts(track);
  const kinds=new Set(props.map(prop=>prop.kind));
  for(const kind of ['camera-platform','lamp','marshal-equipment','transporter','food-truck','park-rest','safety-bay','video-screen','wayfinding'])assert.ok(kinds.has(kind as never),`missing recognisable venue prop: ${kind}`);
  assert.ok(props.length>=24);assert.ok(props.every(p=>!p.id.startsWith('pit-wall-desk-')),'legacy pit-wall desks must not overlap the complete team rooms');
  for(const prop of props){
    assert.ok(prop.reference.startsWith('https://www.monzanet.it/')||prop.reference.startsWith('https://www.fia.com/'));
    for(const p of propFootprint(prop,8)){
      const nearest=track.nearest(p.x,p.z);
      assert.ok(Math.hypot(p.x-nearest.point.x,p.z-nearest.point.z)>track.width/2+2,`${prop.id} enters the drivable track`);
      assert.equal(track.isPitLane(p.x,p.z),false,`${prop.id} obstructs a pit join`);
      assert.ok(stands.every(stand=>distanceToStand(p.x,p.z,stand)>1),`${prop.id} enters an existing audited grandstand footprint`);
    }
  }
});
