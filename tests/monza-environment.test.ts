import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {addCircuitSurroundings,createCircuitPropLayouts,propFootprint} from '../src/monza-surroundings.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createPitComplexLayout} from '../src/pit-complex.ts';
import {createTracksideSafetyLayout,distanceToSafetyFootprint} from '../src/trackside-safety.ts';
import {createHistoricOvalLayout,historicOvalTreeExclusion} from '../src/monza-historic-oval.ts';

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
  const props=createCircuitPropLayouts(track),stands=createStandLayouts(track),historic=createHistoricOvalLayout(track);
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
      assert.equal(historicOvalTreeExclusion(p.x,p.z,historic,2),false,`${prop.id} intersects the complete old banking footprint`);
    }
  }
});

test('five broadcast platforms leave the walkway open and aim their real lens axes onto the circuit',()=>{
  const root=new THREE.Group(),props=addCircuitSurroundings(root,track),cameras=props.filter(p=>p.kind==='camera-platform');
  const buildings=createPitComplexLayout(track).footprints,vehicles=createTracksideSafetyLayout(track).vehicles;
  assert.equal(cameras.length,5);assert.ok(new Set(cameras.map(p=>p.cameraDeckHeight)).size>=3);
  root.updateMatrixWorld(true);
  const direction=new THREE.Vector3(),position=new THREE.Vector3(),vertex=new THREE.Vector3();let vertices=0,triangles=0;
  for(const camera of cameras){
    const group=root.getObjectByName(`venue-${camera.id}`)!,rig=group.getObjectByName('broadcast-camera-rig')!,target=camera.cameraTarget!;
    assert.ok(rig.getObjectByName('broadcast-camera-lens'));assert.ok(rig.getObjectByName('broadcast-operator-torso'));
    assert.equal(rig.children.filter(p=>p.name==='broadcast-tripod-leg').length,3);
    rig.getWorldPosition(position);direction.set(0,0,-1).transformDirection(rig.matrixWorld);
    assert.ok(direction.dot(new THREE.Vector3(target.x-position.x,0,target.z-position.z).normalize())>.99999,'lens optical axis points away from the selected racing surface');
    const n=track.nearest(target.x,target.z);assert.ok(Math.hypot(target.x-n.point.x,target.z-n.point.z)<1,'the camera target must lie on the racing asphalt');
    for(const point of propFootprint(camera,8)){
      assert.ok(point.x>=-113.75-1e-8,'a camera platform blocks the 3.5-unit pedestrian path');
      assert.ok(point.x>-154&&point.x<20&&point.z>-120&&point.z<215,'camera left the existing tree-free straight facility strip');
      assert.ok(buildings.every(b=>distanceToSafetyFootprint(point.x,point.z,b)>2),'a platform intersects a tower or its access stairs');
      assert.ok(vehicles.every(v=>distanceToSafetyFootprint(point.x,point.z,v)>2),'a platform intersects a recovery vehicle');
      assert.ok(props.filter(p=>p!==camera).every(p=>distanceToSafetyFootprint(point.x,point.z,p)>1),'a camera platform collides with another fixture or lamp');
    }
    group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const p=object.geometry.getAttribute('position');triangles+=(object.geometry.index?.count??p.count)/3;
      for(let i=0;i<p.count;i++){
        vertex.fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld);vertices++;
        const local=group.worldToLocal(vertex.clone());
        assert.ok(Math.abs(local.x)<=camera.width/2+.001&&Math.abs(local.z)<=camera.depth/2+.001,'camera, operator or ladder escapes its safe footprint');
        const near=track.nearest(vertex.x,vertex.z);
        assert.ok(Math.hypot(vertex.x-near.point.x,vertex.z-near.point.z)>24.8,'actual broadcast geometry reaches the catch fence');
      }
    });
  }
  assert.ok(vertices>1000);assert.ok(triangles<15000,'broadcast details exceed their low-poly scenery budget');
});
