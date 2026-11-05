import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PitStopAnimation} from '../src/pit-stop-animation.ts';

function fixture(){
 const group=new THREE.Group(),model=new THREE.Group();group.position.y=.11;model.scale.setScalar(1.4);group.add(model);
 const body=new THREE.Mesh(new THREE.BoxGeometry(.65,.28,2.6),new THREE.MeshStandardMaterial({color:0xcc302f}));body.position.y=.3;body.name='provided-body';model.add(body);
 for(const [axle,z]of [['front',.868],['rear',-.868]] as const)for(const side of [-1,1]){
  const radius=axle==='front'?.335:.36,width=axle==='front'?.305:.355,pivot=new THREE.Group();pivot.name=`wheel-${axle}-${side<0?'left':'right'}`;pivot.position.set(side*(axle==='front'?.59:.60),radius,z);
  const spin=new THREE.Group();spin.name=`spin-${axle}-${side<0?'left':'right'}`;
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,width,24),new THREE.MeshStandardMaterial({color:0x1d2425}));tire.name='provided-tyre';tire.rotation.z=Math.PI/2;tire.geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(tire.geometry.attributes.position.count*3).fill(.5),3));spin.add(tire);
  // Match the supplied metal batch's axial extent (.118..2043), not a box
  // projecting beyond the complete real wheel and its replacement lane.
  const detailGeometry=new THREE.BoxGeometry(.086,.34,.34).toNonIndexed(),detailColors=new Float32Array(detailGeometry.attributes.position.count*3),half=detailGeometry.attributes.position.count/2;
  for(let i=0;i<detailGeometry.attributes.position.count;i++)detailColors.set(i<half?[.92,.81,.01]:[.60,.65,.68],i*3);
  detailGeometry.setAttribute('color',new THREE.Float32BufferAttribute(detailColors,3));
  const detail=new THREE.Mesh(detailGeometry,new THREE.MeshStandardMaterial({vertexColors:true}));detail.name='wheel-detail-batch';detail.position.x=side*.1614;detail.userData.paletteSections=[{offset:0,count:half,material:'paint2'},{offset:half,count:half,material:'rim'}];spin.add(detail);
  pivot.add(spin);model.add(pivot);
 }
 group.updateMatrixWorld(true);return{group,status:'ready' as const};
}
const objects=(root:THREE.Object3D,role:string)=>{const out:THREE.Object3D[]=[];root.traverse(o=>{if(o.userData.role===role)out.push(o);});return out;};
const matrices=(root:THREE.Object3D)=>{root.updateMatrixWorld(true);const out:number[][]=[];root.traverse(o=>out.push(o.matrixWorld.toArray()));return out;};
const close=(a:number,b:number,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function surfaceTriangles(mesh:THREE.Mesh){
 mesh.updateWorldMatrix(true,false);const positions=mesh.geometry.attributes.position,index=mesh.geometry.index,result:THREE.Triangle[]=[];
 const count=index?.count??positions.count;for(let i=0;i<count;i+=3){const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));result.push(new THREE.Triangle(points[0],points[1],points[2]));}return result;
}
function closestSurface(source:THREE.Object3D,body:THREE.Mesh){
 const triangles=surfaceTriangles(body),p=new THREE.Vector3(),q=new THREE.Vector3();let best=Infinity;source.updateWorldMatrix(true,true);
 source.traverseVisible(o=>{if(!(o instanceof THREE.Mesh))return;const a=o.geometry.attributes.position,step=Math.max(1,Math.floor(a.count/128));for(let i=0;i<a.count;i+=step){p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);for(const triangle of triangles){triangle.closestPointToPoint(p,q);best=Math.min(best,p.distanceToSquared(q));}}});return Math.sqrt(best);
}
function assertOutsideTorso(source:THREE.Object3D,body:THREE.Mesh,message:string){
 body.updateWorldMatrix(true,false);source.updateWorldMatrix(true,true);const inverse=body.matrixWorld.clone().invert(),p=new THREE.Vector3();
 source.traverseVisible(o=>{if(!(o instanceof THREE.Mesh))return;const matrix=inverse.clone().multiply(o.matrixWorld),a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(matrix);assert.ok(p.lengthSq()>=.999,message);}});
}

test('the complete source wheel hierarchy is reused for eight visible old/new tyres, with no body replacement',()=>{
 const car=fixture(),body=car.group.getObjectByName('provided-body')!,oldGeometry=(body as THREE.Mesh).geometry;
 const source=car.group.getObjectByName('provided-tyre') as THREE.Mesh,rig=new PitStopAnimation(car);
 assert.equal(objects(rig.group,'old-wheel').length,4);assert.equal(objects(rig.group,'new-wheel').length,4);
 let sourceClones=0;rig.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry===source.geometry)sourceClones++;});assert.equal(sourceClones,2);
 const material=source.material as THREE.MeshStandardMaterial;material.color.setHex(0x29b5a4);
 rig.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry===source.geometry)assert.equal(o.material,material);});
 assert.equal(car.group.getObjectByName('provided-body'),body);assert.equal((body as THREE.Mesh).geometry,oldGeometry);
 for(const role of ['old-wheel','new-wheel'])assert.ok(objects(rig.group,role).every(o=>o.visible));
 rig.dispose();
});

test('absolute seeking preserves the car pose and replaces all four wheels at their original real-scale hubs',()=>{
 const car=fixture();car.group.position.set(4,.11,-2);car.group.rotation.y=.41;const rig=new PitStopAnimation(car);
 rig.setTime(0);const start=rig.summary;assert.equal(start.wheels.filter(w=>w.oldAttached).length,4);assert.equal(start.wheels.filter(w=>w.newAttached).length,0);
 rig.setTime(4);close(car.group.position.y,.315);assert.equal(rig.summary.wheels.filter(w=>w.oldAttached||w.newAttached).length,0);assert.equal(objects(rig.group,'brake-hub').filter(o=>o.visible).length,4);
 rig.setTime(8);const finish=rig.summary;assert.equal(finish.wheels.filter(w=>w.newAttached).length,4);assert.equal(finish.wheels.filter(w=>w.oldAttached).length,0);close(car.group.position.y,.11);
 for(let i=0;i<4;i++){const a=start.wheels[i].oldPosition,b=finish.wheels[i].newPosition;close(a.x,b.x);close(a.y,b.y);close(a.z,b.z);assert.ok(Math.abs(finish.wheels[i].oldPosition.x)>2.7);}
 close(car.group.position.x,4);close(car.group.position.z,-2);close(car.group.rotation.y,.41);
 rig.dispose();
});

test('repeated pause frames, reverse seeks and resets do not accumulate geometry or pose drift',()=>{
 const car=fixture(),rig=new PitStopAnimation(car);rig.setTime(3.84);const before=matrices(rig.group);const ids:string[]=[];rig.group.traverse(o=>{if(o instanceof THREE.Mesh)ids.push(o.geometry.uuid);});
 const hoseBuffers=()=>{const buffers:number[][]=[];rig.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='pit-air-hose')buffers.push(Array.from(o.geometry.attributes.position.array));});return buffers;};const beforeHoses=hoseBuffers();assert.equal(beforeHoses.length,4);
 for(let i=0;i<30;i++)rig.setTime(3.84);assert.deepEqual(matrices(rig.group),before);
 for(const time of [8,0,7.2,2.4,.5,5.7,NaN,-99,99,3.84])rig.setTime(time);assert.deepEqual(matrices(rig.group),before);
 assert.deepEqual(hoseBuffers(),beforeHoses);
 const after:string[]=[];rig.group.traverse(o=>{if(o instanceof THREE.Mesh)after.push(o.geometry.uuid);});assert.deepEqual(after,ids);
 rig.dispose();
});

test('sixteen crew members use ellipsoid torsos, curved uniforms and team helmets without limbs',()=>{
 const rig=new PitStopAnimation(fixture()),crew=objects(rig.group,'pit-crew');assert.equal(crew.length,16);assert.equal(crew.filter(o=>o.userData.job==='jack').length,2);
 for(const person of crew){assert.equal(person.userData.legs,false);let torso=0,helmet=0;person.traverse(o=>{assert.doesNotMatch(o.name,/leg|foot|arm|hand|skin/i);if(o.name==='pit-person-torso')torso++;if(o.name==='pit-person-team-helmet')helmet++;});assert.equal(torso,1);assert.equal(helmet,1);}
 for(const [job,count]of Object.entries({gunner:4,remove:4,fit:4,jack:2,stabilize:2}))assert.equal(crew.filter(o=>o.userData.job===job).length,count);
 for(const side of ['left','right'])for(const job of ['remove','fit'])assert.equal(crew.filter(o=>o.userData.job===job&&String(o.userData.wheelId).endsWith(side)).length,2);
 for(const person of crew){
  assert.equal(person.userData.style,'ellipsoid-torso-and-team-helmet');const body=person.getObjectByName('pit-person-torso') as THREE.Mesh,chest=person.getObjectByName('pit-person-chest-stripe') as THREE.Mesh;
  assert.equal(body.geometry.type,'SphereGeometry');assert.equal(body.userData.shape,'ellipsoid');assert.ok(body.scale.y>body.scale.x);assert.ok(body.scale.z<body.scale.x);close(body.scale.x,.34);close(body.scale.z,.29);
  const p=body.geometry.attributes.position;for(let i=0;i<p.count;i++)close(Math.hypot(p.getX(i),p.getY(i),p.getZ(i)),1,1e-5);
  assert.equal(chest.geometry.type,'SphereGeometry');assert.equal(chest.userData.curved,true);assert.deepEqual(chest.scale,body.scale);
 }
 rig.setTeam(0x1caaa0);for(const person of crew){const body=person.getObjectByName('pit-person-torso') as THREE.Mesh;assert.equal((body.material as THREE.MeshStandardMaterial).color.getHex(),0x1caaa0);}
 rig.dispose();
});

test('new compound selection remains independent of the old tyres without adding visible badges',()=>{
 const car=fixture(),source=car.group.getObjectByName('provided-tyre') as THREE.Mesh,colour=(source.material as THREE.MeshStandardMaterial).color.getHex(),rig=new PitStopAnimation(car);
 rig.setCompound('wet');assert.equal(rig.summary.compound,'wet');
 for(const role of ['old-wheel','new-wheel'])for(const wheel of objects(rig.group,role)){
  wheel.traverse(o=>{assert.notEqual(o.name,'pit-tyre-compound-ring');assert.notEqual(o.name,'pit-tyre-compound-badge');});assert.equal(wheel.userData.compound,role==='old-wheel'?'soft':'wet');
 }
 assert.equal((source.material as THREE.MeshStandardMaterial).color.getHex(),colour);rig.dispose();
});

test('all four compound choices keep the complete old and new wheels free of square badges and added outlines',()=>{
 const rig=new PitStopAnimation(fixture());for(const tyre of [...objects(rig.group,'old-wheel'),...objects(rig.group,'new-wheel')])tyre.traverse(o=>{if(o instanceof THREE.Mesh)assert.notEqual(o.geometry.type,'TorusGeometry');});
 for(const compound of ['soft','medium','hard','wet'] as const){rig.setCompound(compound);for(const wheel of objects(rig.group,'new-wheel')){
  wheel.traverse(o=>{assert.notEqual(o.name,'pit-tyre-compound-badge');assert.notEqual(o.name,'pit-tyre-compound-ring');});assert.equal(wheel.userData.compound,compound);assert.equal(rig.summary.compoundMarker,'none');
 }}rig.dispose();
});

test('preview accent neutralisation owns its colour buffers, preserves every source byte and refreshes the remaining rim palette',()=>{
 const car=fixture(),sources:THREE.Mesh[]=[];car.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='wheel-detail-batch')sources.push(o);});const before=sources.map(o=>Array.from(o.geometry.attributes.color.array));
 const rig=new PitStopAnimation(car),details:THREE.Mesh[]=[];rig.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='wheel-detail-batch')details.push(o);});assert.equal(details.length,8);
 for(const detail of details){
  const source=sources.find(o=>o.geometry.uuid===detail.userData.sourceGeometryUuid)!;assert.ok(source);assert.notEqual(detail.geometry,source.geometry);assert.equal(detail.userData.previewWheelAccent,'neutral-metal');
  assert.deepEqual(detail.userData.neutralizedSections,['paint2']);const ranges=detail.geometry.userData.previewNeutralizedRanges;assert.equal(ranges.length,1);assert.equal(ranges[0].sourceMaterial,'paint2');
  const color=detail.geometry.attributes.color,original=source.geometry.attributes.color;
  for(let i=0;i<color.count;i++){if(i<ranges[0].count){assert.ok(Math.abs(color.getX(i)-color.getY(i))<.04);assert.ok(color.getZ(i)>.10);assert.ok(color.getX(i)<.5);}else{close(color.getX(i),original.getX(i));close(color.getY(i),original.getY(i));close(color.getZ(i),original.getZ(i));}}
 }
 for(let i=0;i<sources.length;i++)assert.deepEqual(Array.from(sources[i].geometry.attributes.color.array),before[i]);
 for(const source of sources){const c=source.geometry.attributes.color;for(let i=c.count/2;i<c.count;i++)c.setXYZ(i,.12,.45,.75);}
 rig.setTeam(0x2b8a7e);for(const detail of details){const c=detail.geometry.attributes.color;close(c.getX(c.count-1),.12,1e-6);close(c.getY(c.count-1),.45,1e-6);close(c.getZ(c.count-1),.75,1e-6);assert.ok(c.getZ(0)>.1);}
 let sourceDisposals=0;for(const source of sources)source.geometry.addEventListener('dispose',()=>sourceDisposals++);rig.dispose();assert.equal(sourceDisposals,0);
});

test('two sidepod stabilizers brace during lifting and withdraw beyond the complete car corridor before release',()=>{
 const rig=new PitStopAnimation(fixture()),workers=objects(rig.group,'pit-crew').filter(o=>o.userData.job==='stabilize');assert.equal(workers.length,2);assert.deepEqual(workers.map(o=>o.name).sort(),['pit-crew-stabilize-left','pit-crew-stabilize-right']);
 rig.setTime(4);for(const worker of workers){assert.equal(worker.userData.bracing,true);assert.equal(worker.userData.motion,'brace-during-lift');assert.equal(worker.userData.supportTarget,'sidepod');assert.ok(Math.abs(worker.position.x)>1&&Math.abs(worker.position.x)<1.2);const pad=worker.getObjectByName('pit-steady-support-pad')!;close(pad.position.y,.785);}
 rig.setTime(8);const swept=new THREE.Box3(new THREE.Vector3(-1.2,0,-2.5),new THREE.Vector3(1.2,2,20));for(const worker of workers){assert.equal(worker.userData.bracing,false);assert.equal(swept.intersectsBox(new THREE.Box3().setFromObject(worker)),false);}
 rig.dispose();
});

test('wheel travel keeps complete tyre envelopes clear of crew and other tyres, with separate crew bodies',()=>{
 const car=fixture(),rig=new PitStopAnimation(car),crew=objects(rig.group,'pit-crew'),wheels=[...objects(rig.group,'old-wheel'),...objects(rig.group,'new-wheel')];
 for(let time=0;time<=8;time+=.1){rig.setTime(time);const bodies=crew.map(c=>({c,box:new THREE.Box3().setFromObject(c)})),tyres=wheels.map(w=>({w,box:new THREE.Box3().setFromObject(w)}));
  for(const {w,box:bounds}of tyres)for(const {c,box}of bodies)assert.equal(bounds.intersectsBox(box),false,`${time.toFixed(1)} ${w.name} ${JSON.stringify(bounds)} intersects ${c.name} ${JSON.stringify(box)}`);
  for(let i=0;i<tyres.length;i++)for(let j=i+1;j<tyres.length;j++)assert.equal(tyres[i].box.intersectsBox(tyres[j].box),false,`${time.toFixed(1)} ${tyres[i].w.name} intersects ${tyres[j].w.name}`);
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)assert.equal(bodies[i].box.intersectsBox(bodies[j].box),false,`${time.toFixed(1)} ${bodies[i].c.name} intersects ${bodies[j].c.name}`);
 }
 rig.dispose();
});

test('disposing restores original wheels and releases only preview-owned resources',()=>{
 const car=fixture(),source=car.group.getObjectByName('provided-tyre') as THREE.Mesh;let sourceDisposed=0;source.geometry.addEventListener('dispose',()=>sourceDisposed++);(source.material as THREE.Material).addEventListener('dispose',()=>sourceDisposed++);
 const rig=new PitStopAnimation(car);rig.setTime(4);rig.dispose();rig.dispose();assert.equal(sourceDisposed,0);assert.equal(rig.group.children.length,0);close(car.group.position.y,.11);
 car.group.traverse(o=>{if(/^wheel-/.test(o.name))assert.equal(o.visible,true);});
});

test('the front jack and its operator clear the driving corridor before the two-sided release lamp turns green',()=>{
 const rig=new PitStopAnimation(fixture()),front=rig.group.getObjectByName('pit-front-jack')!,signal=rig.group.getObjectByName('pit-release-signal')!,crew=objects(rig.group,'pit-crew'),operator=crew.find(c=>c.userData.job==='jack'&&c.position.z>0)!;
 assert.ok(front&&signal&&operator);assert.equal(signal.userData.color,'red');
 const lane=new THREE.Box3(new THREE.Vector3(-1.2,0,2),new THREE.Vector3(1.2,2,20));
 for(let time=0;time<=8;time+=.05){rig.setTime(time);const box=new THREE.Box3().setFromObject(front);for(const person of crew)if(person!==operator)assert.equal(box.intersectsBox(new THREE.Box3().setFromObject(person)),false,`${time} front jack touches ${person.name}`);}
 for(const time of [0,1,6.5,7.3,7.79]){rig.setTime(time);assert.equal(rig.summary.releaseReady,false);assert.equal(signal.userData.color,'red');}
 for(const time of [7.8,8]){rig.setTime(time);assert.equal(rig.summary.releaseReady,true);assert.equal(signal.userData.color,'green');assert.equal(rig.summary.lift,0);assert.equal(rig.summary.wheels.filter(w=>w.newAttached).length,4);assert.equal(lane.intersectsBox(new THREE.Box3().setFromObject(front)),false);assert.equal(lane.intersectsBox(new THREE.Box3().setFromObject(operator)),false);}
 const green:THREE.Mesh[]=[];signal.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='pit-release-green-lamp')green.push(o);});assert.equal(green.length,2);for(const bulb of green)assert.equal((bulb.material as THREE.MeshBasicMaterial).color.getHex(),0x70ec97);
 rig.dispose();
});

test('the release gantry stays fixed in world space while both jacks and all workers animate',()=>{
 const car=fixture();car.group.position.set(3,.11,-4);car.group.rotation.y=.42;const rig=new PitStopAnimation(car),signal=rig.group.getObjectByName('pit-release-signal')!;
 assert.equal(signal.parent,rig.group);assert.equal(signal.userData.mount,'fixed-gantry');rig.setTime(0);const original=matrices(signal);
 for(const time of [1.2,2.8,4,6.4,7.3,8,0,8]){rig.setTime(time);assert.deepEqual(matrices(signal),original);}
 rig.dispose();
});

test('wheel guns and tyre handlers hold their actual geometry near the chest without penetrating the torso',()=>{
 const rig=new PitStopAnimation(fixture()),distances:number[]=[];
 for(const id of ['front-left','front-right','rear-left','rear-right']){
  for(const time of [1.25,1.55,1.80,5.6,5.9,6.2]){rig.setTime(time);const gun=rig.group.getObjectByName(`pit-wheel-gun-${id}`)!,grip=gun.getObjectByName('pit-gun-grip')!,body=rig.group.getObjectByName(`pit-crew-gunner-${id}`)!.getObjectByName('pit-person-torso') as THREE.Mesh;
   const distance=closestSurface(grip,body);distances.push(distance);assert.ok(distance>=.015&&distance<.18,`${time} ${id} gun grip gap ${distance}`);assertOutsideTorso(gun,body,`${time} ${id} gun penetrates torso`);
  }
  for(const [job,role,times]of [['remove','old',[2.4,2.8,3.3]],['fit','new',[3.6,4.15,4.85]]] as const)for(const time of times){rig.setTime(time);const wheel=rig.group.getObjectByName(`pit-${role}-wheel-${id}`)!,body=rig.group.getObjectByName(`pit-crew-${job}-${id}`)!.getObjectByName('pit-person-torso') as THREE.Mesh;
   const distance=closestSurface(wheel,body);distances.push(distance);assert.ok(distance>=.015&&distance<.18,`${time} ${id} ${job} tyre gap ${distance}`);assertOutsideTorso(wheel,body,`${time} ${id} tyre penetrates torso`);
  }
 }
 assert.ok(distances.length>=48);rig.dispose();
});

test('jack grips and stabilizer pads stay outside and close to the operators chest surfaces',()=>{
 const rig=new PitStopAnimation(fixture());
 for(const time of [0,1.2,4,6.4,7.5,8]){rig.setTime(time);
  for(const front of [true,false]){const jack=rig.group.getObjectByName(`pit-${front?'front':'rear'}-jack`)!,grip=jack.getObjectByName('pit-jack-grip')!,person=objects(rig.group,'pit-crew').find(o=>o.userData.job==='jack'&&(front?o.position.z>0:o.position.z<0))!,body=person.getObjectByName('pit-person-torso') as THREE.Mesh;
   const d=closestSurface(grip,body);assert.ok(d>=.015&&d<.18,`${time} ${front} jack gap ${d}`);assertOutsideTorso(grip,body,`${time} jack grip penetrates torso`);
  }
  for(const worker of objects(rig.group,'pit-crew').filter(o=>o.userData.job==='stabilize')){const pad=worker.getObjectByName('pit-steady-support-pad')!,body=worker.getObjectByName('pit-person-torso') as THREE.Mesh,d=closestSurface(pad,body);assert.ok(d>=.015&&d<.16,`${time} support pad gap ${d}`);assertOutsideTorso(pad,body,`${time} support pad penetrates torso`);}
 }
 rig.dispose();
});

test('all hose vertices stay outside every fuller torso throughout withdrawal and wheel handoffs',()=>{
 const rig=new PitStopAnimation(fixture()),hoses:THREE.Mesh[]=[];rig.group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='pit-air-hose')hoses.push(o);});const crew=objects(rig.group,'pit-crew');assert.equal(hoses.length,4);
 for(let tick=0;tick<=80;tick++){rig.setTime(tick/10);for(const hose of hoses)for(const person of crew)assertOutsideTorso(hose,person.getObjectByName('pit-person-torso') as THREE.Mesh,`${tick/10} ${hose.name} crosses ${person.name}`);}
 rig.dispose();
});

test('missing or not-ready models are rejected before hiding any supplied wheel',()=>{
 const car=fixture(),last=car.group.getObjectByName('wheel-rear-right')!;last.removeFromParent();assert.throws(()=>new PitStopAnimation(car),/missing supplied wheel/);assert.equal(car.group.getObjectByName('wheel-front-left')!.visible,true);
 assert.throws(()=>new PitStopAnimation({...car,status:'loading'} as unknown as typeof car),/Load the supplied/);
});
