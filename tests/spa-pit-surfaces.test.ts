import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createSpaScenery} from '../src/spa-scenery.ts';
import {SPA_PIT_LAYOUT} from '../src/spa-pit-layout.ts';
import {PitLaneController} from '../src/pit-lane-controller.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {teams} from '../src/team-catalog.ts';

const track=new Track('spa'),scene=createSpaScenery(track);
type P={x:number;z:number};type Tri={p:P[];minX:number;maxX:number;minZ:number;maxZ:number};
const cross=(a:P,b:P,c:P)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const polygonArea=(p:readonly P[])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.z-b.x*a.z;},0))/2;
function mesh(name:string){const m=track.group.getObjectByName(name);assert.ok(m instanceof THREE.Mesh,`Missing ${name}`);return m as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;}
function triangles(m:THREE.Mesh<THREE.BufferGeometry>){m.updateWorldMatrix(true,true);const pos=m.geometry.attributes.position,index=m.geometry.index,result:Tri[]=[],v=new THREE.Vector3();for(let i=0;i<(index?.count??pos.count);i+=3){const p:P[]=[];for(let j=0;j<3;j++){v.fromBufferAttribute(pos,index?index.getX(i+j):i+j).applyMatrix4(m.matrixWorld);assert.ok(Number.isFinite(v.x+v.y+v.z));p.push({x:v.x,z:v.z});}if(polygonArea(p)<1e-9)continue;result.push({p,minX:Math.min(...p.map(p=>p.x)),maxX:Math.max(...p.map(p=>p.x)),minZ:Math.min(...p.map(p=>p.z)),maxZ:Math.max(...p.map(p=>p.z))});}assert.ok(result.length);return result;}
function overlap(a:readonly P[],b:readonly P[]){let p=[...a];const sign=Math.sign(cross(b[0],b[1],b[2]));for(let i=0;i<b.length&&p.length;i++){const v=b[i],w=b[(i+1)%b.length],input=p;p=[];let prior=input.at(-1)!,before=cross(v,w,prior)*sign;for(const next of input){const after=cross(v,w,next)*sign;if((before>=-1e-9)!==(after>=-1e-9)){const t=before/(before-after);p.push({x:prior.x+(next.x-prior.x)*t,z:prior.z+(next.z-prior.z)*t});}if(after>=-1e-9)p.push(next);prior=next;before=after;}}return p.length>=3?polygonArea(p):0;}
function maximumOverlap(a:readonly Tri[],b:readonly Tri[]){const grid=new Map<string,number[]>(),size=16;for(let i=0;i<b.length;i++){const t=b[i];for(let x=Math.floor(t.minX/size);x<=Math.floor(t.maxX/size);x++)for(let z=Math.floor(t.minZ/size);z<=Math.floor(t.maxZ/size);z++){const k=`${x},${z}`;if(!grid.has(k))grid.set(k,[]);grid.get(k)!.push(i);}}let maximum=0;for(const t of a){const ids=new Set<number>();for(let x=Math.floor(t.minX/size);x<=Math.floor(t.maxX/size);x++)for(let z=Math.floor(t.minZ/size);z<=Math.floor(t.maxZ/size);z++)for(const i of grid.get(`${x},${z}`)??[])ids.add(i);for(const i of ids){const q=b[i];if(t.maxX<q.minX||q.maxX<t.minX||t.maxZ<q.minZ||q.maxZ<t.minZ)continue;maximum=Math.max(maximum,overlap(t.p,q.p));}}return maximum;}
function down(root:THREE.Object3D,x:number,z:number){root.updateWorldMatrix(true,true);return new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0),0,200).intersectObject(root,true);}
function vertices(root:THREE.Object3D){root.updateWorldMatrix(true,true);const result:THREE.Vector3[]=[],seen=new Set<string>(),v=new THREE.Vector3();root.traverse(o=>{if(!(o instanceof THREE.Mesh)||o instanceof THREE.InstancedMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);const key=`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;if(!seen.has(key)){seen.add(key);result.push(v.clone());}}});assert.ok(result.length>4,`${root.name} has no real inspectable geometry`);return result;}

test('Spa race asphalt, fast lane, teal divider and grey apron are actual disjoint paving regions with full service widths',()=>{
 const surfaces=['spa-road','spa-pit-lane','spa-pit-colour-divider','spa-pit-working-apron'].map(name=>({mesh:mesh(name),triangles:triangles(mesh(name))}));
 for(let i=0;i<surfaces.length;i++)for(let j=i+1;j<surfaces.length;j++){const a=surfaces[i],b=surfaces[j],area=maximumOverlap(a.triangles,b.triangles);assert.ok(area<.0002,`${a.mesh.name}/${b.mesh.name} actual floor overlap ${area} causes colour mixing`);}
 const fast=surfaces[1].mesh,divider=surfaces[2].mesh,apron=surfaces[3].mesh;assert.equal(new Set(surfaces.map(s=>s.mesh.material.color.getHex())).size,4);for(const {mesh:m}of surfaces)assert.equal(m.material.polygonOffset,false);
 for(let z=SPA_PIT_LAYOUT.serviceMinZ+.5;z<SPA_PIT_LAYOUT.serviceMaxZ;z+=2.7){for(const x of [SPA_PIT_LAYOUT.fastCenterX-SPA_PIT_LAYOUT.fastHalfWidth+.15,SPA_PIT_LAYOUT.fastCenterX,SPA_PIT_LAYOUT.fastCenterX+SPA_PIT_LAYOUT.fastHalfWidth-.15])assert.ok(down(fast,x,z).length,'Spa fast lane loses its declared twelve-unit width');assert.ok(down(divider,SPA_PIT_LAYOUT.apronMinX+SPA_PIT_LAYOUT.dividerWidth/2,z).length);for(const x of [SPA_PIT_LAYOUT.apronMinX+SPA_PIT_LAYOUT.dividerWidth+.2,SPA_PIT_LAYOUT.apronMaxX-.2])assert.ok(down(apron,x,z).length,'Working apron width is missing at the garage frontage');}
 const profile=track.spaPitProfile;assert.ok(profile);const source=track.corners.find(c=>c.name.startsWith('La Source'))!;assert.ok(profile.exitRaceDistance>source.distance+100,'Pit exit still cuts into the main straight before La Source');
});

test('all eleven real Spa garage openings, parking rectangles and low service equipment stay outside the driven fast lane',()=>{
 const apron=mesh('spa-pit-working-apron'),building=scene.getObjectByName('spa-gp-pit-building');assert.ok(building);scene.updateMatrixWorld(true);
 for(const team of teams){const garage=scene.getObjectByName(`spa-garage-${team.id}`),parking=scene.getObjectByName(`spa-parking-${team.id}`);assert.ok(garage&&parking);garage.updateWorldMatrix(true,true);const center=garage.getWorldPosition(new THREE.Vector3()),towards=parking.getWorldPosition(new THREE.Vector3()).sub(center).setY(0).normalize(),door=new THREE.Vector3(-1,0,0).transformDirection(garage.matrixWorld);assert.ok(door.dot(towards)>.99,'Workshop doors face away from their actual parking bay');for(const p of vertices(garage))assert.ok(p.x>SPA_PIT_LAYOUT.fastCenterX+SPA_PIT_LAYOUT.fastHalfWidth+.2,'Garage geometry enters the fast lane');for(const p of vertices(parking))assert.ok(down(apron,p.x,p.z).length,`${parking.name} paint falls outside the actual grey working apron`);}
 const equipment=building.getObjectByName('pit-service-apron-equipment');assert.ok(equipment);for(const p of vertices(equipment))if(p.y<3.5&&p.z>=SPA_PIT_LAYOUT.serviceMinZ&&p.z<=SPA_PIT_LAYOUT.serviceMaxZ)assert.ok(p.x>SPA_PIT_LAYOUT.fastCenterX+SPA_PIT_LAYOUT.fastHalfWidth+.05,'Low workshop staff or equipment protrudes into the fast lane');
 assert.equal(building.userData.strategyDetails.pods,11);assert.equal(building.userData.strategyDetails.engineers,44);assert.equal(building.userData.strategyDetails.mechanics,24);
});

test('the controller uses the same grey-apron stopping position as all eleven visible Spa parking bays',()=>{
 const apron=mesh('spa-pit-working-apron');for(let i=0;i<teams.length;i++){
  const team=teams[i],pit=new PitLaneController(track,()=>.5),car=new VehiclePhysics(),entry=pit.entry,dx=Math.sin(entry.heading),dz=Math.cos(entry.heading);
  car.reset(entry.x-dx*.4,entry.z-dz*.4,entry.heading);car.speed=30;assert.equal(pit.update(1/120,car,team.id,'soft'),false);car.x=entry.x+dx*.4;car.z=entry.z+dz*.4;assert.equal(pit.update(1/120,car,team.id,'soft'),true);
  const stop=pit.summary.stop,parking=scene.getObjectByName(`spa-parking-${team.id}`)!;assert.equal(stop.x,SPA_PIT_LAYOUT.stopX);assert.ok(Math.abs(stop.z-parking.getWorldPosition(new THREE.Vector3()).z)<1e-7);for(const side of [-1.5,0,1.5]){const hits=down(apron,stop.x+side,stop.z);assert.ok(hits.length,'Stopped car does not fit on the grey working apron');assert.ok(Math.abs(hits[0].point.y-SPA_PIT_LAYOUT.serviceY-.052)<.0001,'The actual paved apron is not on the shared service slab');}assert.equal(stop.y,SPA_PIT_LAYOUT.serviceY);
 }
});
