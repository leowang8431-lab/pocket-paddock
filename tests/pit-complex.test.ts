import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {addPitComplex,createPitComplexLayout,pitFootprint,pitSolidColliders,pitTreeExclusion} from '../src/pit-complex.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {batchStaticScenery} from '../src/render-batches.ts';
import {ARCHITECTURE_HEIGHT_SCALE} from '../src/architecture-scale.ts';
import {teams} from '../src/team-catalog.ts';
import {createCircuitPropLayouts} from '../src/monza-surroundings.ts';

const track=new Track();
test('the diagram uses two independent straight-end towers, a pit-corner Fans Club and a clear overhead clock',()=>{
  const layout=createPitComplexLayout(track),stands=createStandLayouts(track);
  assert.deepEqual(createPitComplexLayout(track),layout);
  assert.equal(layout.towers.length,2);assert.ok(layout.towers.every(t=>t.x<-100));
  assert.ok(layout.towers[0].z<layout.boxes.z-layout.boxes.depth/2);assert.ok(layout.towers[1].z>layout.boxes.z+layout.boxes.depth/2);
  assert.deepEqual(layout.clubs.map(c=>c.id),['race-club','fans-club','garden-lounge','monza-village']);
  assert.equal(layout.clockBeam.brand,'RIOLEX');assert.ok(layout.clockBeam.clearHeight>6);
  for(const p of [...layout.towers,...layout.clockBeam.posts,layout.clubs[2],layout.clubs[3]])for(const v of pitFootprint(p,12)){
    const near=track.nearest(v.x,v.z);assert.ok(Math.hypot(v.x-near.point.x,v.z-near.point.z)>track.width/2+1.5,`${p.id} enters racing asphalt`);
    assert.equal(track.isPitLane(v.x,v.z),false,`${p.id} blocks pit asphalt`);
    assert.ok(stands.every(s=>distanceToStand(v.x,v.z,s)>1),`${p.id} intersects grandstands`);
  }
  // AABB collision is deliberately more conservative than the curved facade.
  for(const bounds of pitSolidColliders(layout))for(let x=bounds.minX;x<=bounds.maxX;x+=.5)for(let z=bounds.minZ;z<=bounds.maxZ;z+=.5){
    assert.equal(track.isPitLane(x,z),false,'new solid collider blocks pit lane');
    const n=track.nearest(x,z);assert.ok(Math.hypot(x-n.point.x,z-n.point.z)>track.width/2+1.5);
  }
});

test('garage workstations and clock posts leave the complete low-height racing and pit surfaces clear',()=>{
  const parent=new THREE.Group(),built=addPitComplex(parent,track),p=new THREE.Vector3();parent.updateMatrixWorld(true);let vertices=0;
  built.group.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const pos=o.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);if(p.y>2.5)continue;
      vertices++;assert.equal(track.isPitLane(p.x,p.z),false,`${o.name||'pit part'} enters fast pit lane at ${p.x},${p.z}`);
      const n=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-n.point.x,p.z-n.point.z)>track.width/2+1.2,'low pit furniture reaches racing surface');
    }
  });
  assert.ok(vertices>5000);assert.ok(built.group.getObjectByName('tower-north'));assert.ok(built.group.getObjectByName('tower-south'));
  assert.ok(built.group.getObjectByName('monza-fans-club-curved-corner'));
  const labels=built.group.userData.labelTexts as string[];assert.equal(labels.filter(t=>t==='RIOLEX').length,2);
  assert.ok(labels.includes('GARDEN LOUNGE')&&labels.includes('FANS CLUB')&&labels.includes('MONZA VILLAGE'));
  assert.equal(labels.some(t=>t.includes('ROLEX')),false);
});

test('clock hands survive scenery batching/freezing, advance with simulation time and freeze on pause',()=>{
  const parent=new THREE.Group(),built=addPitComplex(parent,track);batchStaticScenery(parent);
  parent.updateMatrixWorld(true);parent.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});
  const minute=built.group.getObjectByName('pit-clock-hand-minute')!,second=built.group.getObjectByName('pit-clock-hand-second')!;
  assert.ok(minute.children[0] instanceof THREE.Mesh);assert.ok(second.children[0] instanceof THREE.Mesh);
  const before=built.clockController.summary;assert.equal(before.timeOfDaySeconds,36600);
  built.clockController.update(15);assert.equal(built.clockController.summary.elapsed,15);assert.notEqual(built.clockController.summary.secondAngle,before.secondAngle);
  const matrix=second.children[0].matrixWorld.clone(),paused=built.clockController.summary;
  for(let i=0;i<10;i++)built.clockController.update(0);
  assert.deepEqual(built.clockController.summary,paused);assert.ok(matrix.equals(second.children[0].matrixWorld));
  built.clockController.update(1);assert.ok(!matrix.equals(second.children[0].matrixWorld));
  assert.equal(pitTreeExclusion(built.layout.towers[0].x,built.layout.towers[0].z,built.layout),true);
  let draws=0,triangles=0;parent.traverse(o=>{if(o instanceof THREE.Mesh){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
  assert.ok(draws<28,`pit complex alone adds ${draws} draws`);assert.ok(triangles<55000,`pit complex costs ${triangles} triangles`);
});


test('both tower stairs are complete rear access routes with open doors and safe landings',()=>{
  const root=new THREE.Group(),built=addPitComplex(root,track),stands=createStandLayouts(track);root.updateMatrixWorld(true);
  assert.equal(built.layout.stairs.length,2);
  const glass=built.group.getObjectByName('pit-complex-glazing-batch') as THREE.Mesh;
  for(const route of built.layout.stairs){
    const tower=built.group.getObjectByName(route.towerId)!,stair=tower.getObjectByName(`${route.towerId}-access-stair`)!;
    assert.equal(route.deckHeight,5.38*ARCHITECTURE_HEIGHT_SCALE);assert.ok(route.bridgeHeadroom>=2.4);assert.equal(route.path[0].y,0);assert.deepEqual(route.path.at(-1),route.entrance);
    assert.ok(route.path.every(p=>p.y>=0&&p.y<=route.deckHeight));
    for(const p of pitFootprint(route,12)){const near=track.nearest(p.x,p.z);assert.ok(Math.hypot(p.x-near.point.x,p.z-near.point.z)>26);assert.equal(track.isPitLane(p.x,p.z),false);assert.ok(stands.every(s=>distanceToStand(p.x,p.z,s)>1.5));}
    const point=new THREE.Vector3();let vertices=0;stair.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++){
      point.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);const n=track.nearest(point.x,point.z);assert.ok(Math.hypot(point.x-n.point.x,point.z-n.point.z)>26,'a stair mesh crosses the fence corridor');
      tower.worldToLocal(point);assert.ok(point.z>=3.84,'stairs must stay behind the tower');
      if(point.z<4.13)assert.ok(point.x>=-3.89&&point.x<=-2.31&&point.y>=5.09&&point.y<=6.5,'only the doorway threshold can touch the viewing floor');vertices++;
    }});assert.ok(vertices>1000);
    // The opening is a real hole in the rear glass, not a painted door or a stair through a wall.
    const origin=tower.localToWorld(new THREE.Vector3(-3.1,6.6,4.4)),direction=new THREE.Vector3(0,0,-1).transformDirection(tower.matrixWorld);
    const hits=new THREE.Raycaster(origin,direction,0,.8).intersectObject(glass);assert.equal(hits.length,0,'rear door is obstructed by glass');
  }
});

test('pit-wall consoles have paired displays, headset engineers and one shared telemetry atlas',()=>{
  const root=new THREE.Group(),built=addPitComplex(root,track),details=built.group.userData.strategyDetails;
  assert.equal(built.layout.strategyPods.length,11);assert.equal(details.monitors,88);assert.equal(details.engineers,44);assert.equal(details.garageMonitors,36);assert.equal(details.keyboardPanels,56);assert.deepEqual(details.teams,teams.map(t=>t.id));
  assert.equal(details.screenData,'authored decorative telemetry');
  for(const pod of built.layout.strategyPods){const group=built.group.getObjectByName(pod.id)!;let monitors=0,headsets=0;group.traverse(o=>{if(o.name==='pit-wall-monitor')monitors++;if(o.name==='engineer-headset')headsets++;});assert.equal(monitors,8);assert.equal(headsets,4);}
  const screen=built.group.getObjectByName('pit-telemetry-screen-atlas') as THREE.Mesh;assert.ok(screen.material instanceof THREE.MeshBasicMaterial);
  assert.equal((screen.geometry.index?.count??screen.geometry.attributes.position.count)/3,(details.monitors+details.garageMonitors+details.keyboardPanels)*2,'all 180 monitor/keyboard panels share one draw');
  for(let i=0;i<screen.geometry.attributes.uv.count;i++){const uv=screen.geometry.attributes.uv;assert.ok(uv.getX(i)>0&&uv.getX(i)<1&&uv.getY(i)>0&&uv.getY(i)<1);}
});


test('taller architecture keeps real tower doors and clock clearance aligned while workers and pit-wall desks retain their scale',()=>{
  const parent=new THREE.Group(),built=addPitComplex(parent,track);parent.updateMatrixWorld(true);
  assert.equal(built.layout.heightScale,1.25);
  assert.equal(built.layout.boxes.height,20.125);
  assert.equal(built.layout.clockBeam.clearHeight,8.5);
  for(const t of built.layout.towers){
    const tower=built.group.getObjectByName(t.id)!,bounds=new THREE.Box3().setFromObject(tower);
    assert.ok(bounds.max.y>25&&bounds.max.y<=26,'viewing floors and roof must actually be taller in world space');
    const route=built.layout.stairs.find(s=>s.towerId===t.id)!;
    const threshold=tower.localToWorld(new THREE.Vector3(-3.1,5.38,3.97));
    assert.ok(threshold.distanceTo(new THREE.Vector3(route.entrance.x,route.entrance.y,route.entrance.z))<1e-9,'raised door and stair metadata disagree');
    assert.ok(route.bridgeHeadroom>=3,'the raised crossing bridge must retain headroom');
  }
  const clearance=new THREE.Raycaster(new THREE.Vector3(-63,0,124),new THREE.Vector3(0,1,0),0,20).intersectObject(built.group,true);
  assert.ok(clearance.length>0);assert.ok(Math.abs(clearance[0].point.y-built.layout.clockBeam.clearHeight)<1e-5,'the displayed clock bridge and actual underpass clearance disagree');
  const apron=new THREE.Box3().setFromObject(built.group.getObjectByName('pit-service-apron-equipment')!);
  assert.ok(apron.max.y>6.4&&apron.max.y<6.56,'mechanics and their tools must not be stretched with the buildings');
  for(const p of built.layout.strategyPods){
    const bounds=new THREE.Box3().setFromObject(built.group.getObjectByName(p.id)!);
    assert.ok(bounds.max.y>4.5&&bounds.max.y<4.7,'engineers, chairs, keyboards and screens retain their original height');
  }
  const wall=new THREE.Box3().setFromObject(built.group.getObjectByName('pit-wall-original-height')!);
  assert.ok(Math.abs(wall.max.y-1.6)<1e-5,'pit wall remains at the original driving scale');
});


test('every roster team, including Ferrari, has one fully furnished strategy room opposite its garage',()=>{
  const root=new THREE.Group(),built=addPitComplex(root,track),rooms=built.layout.strategyPods;root.updateMatrixWorld(true);
  assert.deepEqual(rooms.map(p=>p.teamId),teams.map(t=>t.id));assert.equal(new Set(rooms.map(p=>p.teamId)).size,11);
  const legacyProps=createCircuitPropLayouts(track);assert.equal(legacyProps.some(p=>p.id.startsWith('pit-wall-desk-')),false);
  const point=new THREE.Vector3();
  for(let i=0;i<rooms.length;i++){
    const room=rooms[i],team=teams[i],group=built.group.getObjectByName(room.id)!;
    assert.equal(group.userData.teamId,team.id);assert.equal(room.teamName,team.name);assert.ok(Math.abs(room.z-(-43+i*13.2))<1e-10);
    for(const name of ['strategy-room-roof','strategy-room-floor','strategy-room-rear-wall','strategy-room-team-fascia'])assert.ok(group.getObjectByName(name),`${team.id} is missing ${name}`);
    assert.equal(group.children.filter(o=>o.name==='strategy-room-side-wall').length,2);
    assert.equal(group.children.filter(o=>o.name==='strategy-room-keyboard').length,4);
    assert.ok(built.group.userData.labelTexts.includes(`${team.name.toUpperCase()} • PIT WALL`),`${team.id} room lacks its own sign`);
    const fascia=group.getObjectByName('strategy-room-team-fascia') as THREE.Mesh;assert.ok(fascia.material instanceof THREE.MeshStandardMaterial);assert.equal(fascia.material.color.getHexString(),new THREE.Color(team.color).getHexString());
    if(i>0)assert.ok(room.z-room.depth/2>(rooms[i-1].z+rooms[i-1].depth/2)+3,'neighbouring rooms require a visible gap');
    for(const p of pitFootprint(room,12)){
      const n=track.nearest(p.x,p.z);assert.equal(track.isPitLane(p.x,p.z),false,`${team.id} room blocks the fast lane`);
      assert.ok(Math.hypot(p.x-n.point.x,p.z-n.point.z)>track.widthAt(n.distance)/2+1.2);
      assert.ok(createStandLayouts(track).every(s=>distanceToStand(p.x,p.z,s)>1));
      assert.ok(built.layout.props.every(pit=>Math.abs(p.x-pit.x)>pit.width/2||Math.abs(p.z-pit.z)>pit.depth/2),'strategy room overlaps a garage apron');
    }
    group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const pos=o.geometry.attributes.position;
      for(let v=0;v<pos.count;v++){
        point.fromBufferAttribute(pos,v).applyMatrix4(o.matrixWorld);
        assert.ok(Math.abs(point.x-room.x)<=room.width/2+.001&&Math.abs(point.z-room.z)<=room.depth/2+.001,`${team.id} geometry escapes its audited room`);
      }
    });
  }
});

test('pit personnel are grounded torsos and team-colour helmets without any human legs or bare faces',()=>{
  const root=new THREE.Group(),built=addPitComplex(root,track);root.updateMatrixWorld(true);
  const people:THREE.Group[]=[];built.group.traverse(o=>{if(o.userData.style==='torso-and-team-helmet')people.push(o as THREE.Group);});
  assert.equal(people.filter(p=>p.userData.role==='engineer').length,44);assert.equal(people.filter(p=>p.userData.role==='mechanic').length,24);
  const allowed=new Set(['pit-person-torso','pit-person-team-helmet','pit-person-dark-visor','engineer-headset','engineer-earpiece','engineer-microphone']);
  for(const person of people){
    assert.equal(person.userData.legs,false);
    for(const part of person.children)assert.ok(allowed.has(part.name),`unexpected extra human body part ${part.name}`);
    const body=person.getObjectByName('pit-person-torso') as THREE.Mesh,helmet=person.getObjectByName('pit-person-team-helmet') as THREE.Mesh,visor=person.getObjectByName('pit-person-dark-visor') as THREE.Mesh;
    for(const mesh of [body,helmet,visor])assert.ok(mesh?.material instanceof THREE.MeshStandardMaterial);
    const team=teams.find(t=>t.id===person.userData.teamId);
    if(team){assert.equal((helmet.material as THREE.MeshStandardMaterial).color.getHexString(),new THREE.Color(team.color).getHexString());assert.equal((body.material as THREE.MeshStandardMaterial).color.getHexString(),new THREE.Color(team.color).getHexString());}
    assert.equal((visor.material as THREE.MeshStandardMaterial).color.getHex(),0x172b30);
    const bounds=new THREE.Box3().setFromObject(body),seated=person.userData.role==='engineer';
    assert.ok(Math.abs(bounds.min.y-(seated?1.975:.16))<1e-5,'torso must rest at the seat or apron height');
    assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y-(seated?.95:1.20))<1e-5,'crew cannot inherit the taller architecture scale');
  }
});
