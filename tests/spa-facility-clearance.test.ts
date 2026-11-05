import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createSpaScenery} from '../src/spa-scenery.ts';
import {SPA_PIT_LAYOUT,isSpaPitApron} from '../src/spa-pit-layout.ts';
import {addPitComplex,type PitFootprint} from '../src/pit-complex.ts';
import {MONZA_PIT_LAYOUT} from '../src/monza-pit-layout.ts';
import {teams} from '../src/team-catalog.ts';

// Build the shared venue first: a Spa-only placement repair must not move it.
const monza=new Track('monza'),monzaPit=addPitComplex(new THREE.Group(),monza);
monzaPit.group.updateWorldMatrix(true,true);
const monzaWall=monzaPit.group.getObjectByName('pit-wall-original-height')!;
const monzaWallBefore=new THREE.Box3().setFromObject(monzaWall);
const spa=new Track('spa'),scenery=createSpaScenery(spa);
scenery.updateWorldMatrix(true,true);spa.group.updateWorldMatrix(true,true);

type Triangle={a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3;box:THREE.Box3;owner:string};
function worldTriangles(mesh:THREE.Mesh,matrix=mesh.matrixWorld):Triangle[]{
 const position=mesh.geometry.attributes.position,index=mesh.geometry.index,result:Triangle[]=[];
 for(let i=0;i<(index?.count??position.count);i+=3){
  const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(matrix));
  const [a,b,c]=p;if(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq()<1e-16)continue;
  result.push({a,b,c,box:new THREE.Box3().setFromPoints(p),owner:`${mesh.name||'batched-mesh'}#${i/3}`});
 }return result;
}
function childOf(object:THREE.Object3D,parent:THREE.Object3D){for(let current:THREE.Object3D|null=object;current;current=current.parent)if(current===parent)return true;return false;}
const wall=scenery.getObjectByName('pit-wall-original-height');
assert.ok(wall,'Keep the actual pit wall inspectable after scenery batching.');
const wallBounds=new THREE.Box3().setFromObject(wall);
const layout=scenery.userData.pitComplex;

function facilityBounds(p:PitFootprint){
 const c=Math.cos(p.yaw),s=Math.sin(p.yaw),corners=[[-p.width/2,-p.depth/2],[p.width/2,-p.depth/2],[p.width/2,p.depth/2],[-p.width/2,p.depth/2]].map(([x,z])=>new THREE.Vector3(p.x+c*x+s*z,p.minY,p.z-s*x+c*z));
 const box=new THREE.Box3().setFromPoints(corners);box.max.y=p.minY+p.height;return box;
}
const facilityRegions:THREE.Box3[]=[layout.boxes,...layout.strategyPods,...layout.clockBeam.posts].map((p:PitFootprint)=>facilityBounds(p).expandByScalar(2));
for(const stand of scenery.userData.stands){
 const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw),points=[[-stand.width/2-4,-7],[stand.width/2+4,-7],[stand.width/2+4,stand.depth+7],[-stand.width/2-4,stand.depth+7]].map(([x,z])=>new THREE.Vector3(stand.x+c*x+s*z,stand.baseY-20,stand.z-s*x+c*z));
 const box=new THREE.Box3().setFromPoints(points);box.max.y=stand.baseY+stand.platform+stand.rows*stand.rise+15;facilityRegions.push(box);
}
function nearFacility(box:THREE.Box3){return facilityRegions.some(region=>region.intersectsBox(box));}
const wallTriangles:Triangle[]=[];
wall.traverse(object=>{if(object instanceof THREE.Mesh)wallTriangles.push(...worldTriangles(object));});
assert.ok(wallTriangles.length>=20,'Audit the wall solid, not only an authored footprint.');

// Add actual Armco triangles and each transformed fence/post instance. The
// expanded facility regions only prune candidates; the decision uses real
// rendered triangle intersections below, including merged architecture cells.
spa.group.traverse(object=>{
 if(!(object instanceof THREE.Mesh))return;
 const fence=/spa-catch-fence/.test(object.name),rail=!Array.isArray(object.material)&&'color'in object.material&&(object.material as THREE.MeshStandardMaterial).color.getHex()===0x9da6a4;
 if(!fence&&!rail)return;
 if(object instanceof THREE.InstancedMesh){
  object.geometry.computeBoundingBox();const local=new THREE.Matrix4(),world=new THREE.Matrix4();
  for(let i=0;i<object.count;i++){object.getMatrixAt(i,local);world.multiplyMatrices(object.matrixWorld,local);const box=object.geometry.boundingBox!.clone().applyMatrix4(world);if(!nearFacility(box))continue;for(const tri of worldTriangles(object,world)){tri.owner=`${object.name}[${i}]`;if(nearFacility(tri.box))wallTriangles.push(tri);}}
 }else for(const triangle of worldTriangles(object))if(nearFacility(triangle.box))wallTriangles.push(triangle);
});
const buildingTriangles:Triangle[]=[];
scenery.traverse(object=>{
 if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||childOf(object,wall))return;
 object.geometry.computeBoundingBox();const box=object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);if(!nearFacility(box))return;
 for(const triangle of worldTriangles(object))if(nearFacility(triangle.box))buildingTriangles.push(triangle);
});
assert.ok(buildingTriangles.length>10000,'Audit the complete rendered garage, strategy-room and grandstand geometry.');
const cellSize=8,grid=new Map<string,Triangle[]>();
function keys(box:THREE.Box3){const result:string[]=[];for(let x=Math.floor(box.min.x/cellSize);x<=Math.floor(box.max.x/cellSize);x++)for(let y=Math.floor(box.min.y/cellSize);y<=Math.floor(box.max.y/cellSize);y++)for(let z=Math.floor(box.min.z/cellSize);z<=Math.floor(box.max.z/cellSize);z++)result.push(`${x},${y},${z}`);return result;}
for(const triangle of buildingTriangles)for(const key of keys(triangle.box)){if(!grid.has(key))grid.set(key,[]);grid.get(key)!.push(triangle);}
const ray=new THREE.Ray(),direction=new THREE.Vector3(),hit=new THREE.Vector3();
function triangleCrossing(a:Triangle,b:Triangle){
 for(const [source,target]of[[a,b],[b,a]])for(const [start,end]of[[source.a,source.b],[source.b,source.c],[source.c,source.a]]){
  const length=direction.subVectors(end,start).length();if(length<1e-8)continue;direction.divideScalar(length);ray.set(start,direction);
  if(ray.intersectTriangle(target.a,target.b,target.c,false,hit)){const distance=hit.distanceTo(start);if(distance>1e-5&&distance<length-1e-5)return hit.clone();}
 }
 // A wall exactly coincident with a room panel is also a collision. Project
 // coplanar triangles onto their dominant plane and test positive-area overlap.
 const normal=new THREE.Vector3().subVectors(a.b,a.a).cross(new THREE.Vector3().subVectors(a.c,a.a)).normalize();
 if([b.a,b.b,b.c].every(p=>Math.abs(normal.dot(p.clone().sub(a.a)))<1e-6)){
  const axis=Math.abs(normal.x)>Math.abs(normal.y)?(Math.abs(normal.x)>Math.abs(normal.z)?'x':'z'):(Math.abs(normal.y)>Math.abs(normal.z)?'y':'z');
  const project=(p:THREE.Vector3)=>axis==='x'?{x:p.y,y:p.z}:axis==='y'?{x:p.x,y:p.z}:{x:p.x,y:p.y};
  const clip=[b.a,b.b,b.c].map(project),cross=(p:{x:number;y:number},q:{x:number;y:number},r:{x:number;y:number})=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x),sign=Math.sign(cross(clip[0],clip[1],clip[2]));
  let polygon=[a.a,a.b,a.c].map(project);
  for(let i=0;i<3&&polygon.length;i++){
   const from=clip[i],to=clip[(i+1)%3],input=polygon;polygon=[];let prior=input.at(-1)!,before=cross(from,to,prior)*sign;
   for(const next of input){const after=cross(from,to,next)*sign;if((before>=0)!==(after>=0)){const t=before/(before-after);polygon.push({x:prior.x+(next.x-prior.x)*t,y:prior.y+(next.y-prior.y)*t});}if(after>=0)polygon.push(next);prior=next;before=after;}
  }
  const area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
  if(area>1e-7)return a.a.clone();
 }
 return undefined;
}

test('Spa pit wall and track safety furniture do not cut the rendered garages, eleven strategy rooms, posts or 21 grandstands',()=>{
 assert.equal(layout.strategyPods.length,teams.length);assert.equal(scenery.userData.grandstands.count,21);
 for(const triangle of wallTriangles){
  const candidates=new Set<Triangle>();for(const key of keys(triangle.box))for(const building of grid.get(key)??[])candidates.add(building);
  for(const building of candidates){if(!triangle.box.intersectsBox(building.box))continue;const point=triangleCrossing(triangle,building);assert.equal(point,undefined,`${triangle.owner} cuts ${building.owner} at ${point?.toArray().join(',')}`);}
 }
 // Positive physical air gaps also catch coplanar/coincident box faces, for
 // which a segment-versus-triangle crossing alone would be insufficient.
 for(const p of [...layout.strategyPods,...layout.clockBeam.posts]){
  const box=facilityBounds(p),xGap=Math.max(box.min.x-wallBounds.max.x,wallBounds.min.x-box.max.x);
  assert.ok(xGap>.2,`Pit wall has only ${xGap} units of clearance from ${p.id}.`);
 }
});

test('Spa F1 pit lane and all real garage mouths are on the driver-right side and open onto their corresponding service apron',()=>{
 const start=spa.sampleAt(0),driverRight=start.right.clone().negate();
 assert.ok(new THREE.Vector3(SPA_PIT_LAYOUT.fastCenterX-start.point.x,0,0).dot(driverRight)>spa.width/2,'Pit fast lane is on the wrong side of the start/finish straight.');
 for(const team of teams){
  const garage=scenery.getObjectByName(`spa-garage-${team.id}`),parking=scenery.getObjectByName(`spa-parking-${team.id}`);assert.ok(garage&&parking);
  const center=garage.getWorldPosition(new THREE.Vector3()),stop=parking.getWorldPosition(new THREE.Vector3()),opening=new THREE.Vector3(-1,0,0).transformDirection(garage.matrixWorld),towards=stop.clone().sub(center).setY(0).normalize();
  assert.ok(opening.dot(towards)>.99,`${team.id} garage door faces away from the actual parking bay.`);
  assert.ok(center.clone().sub(start.point).dot(driverRight)>spa.width,`${team.id} garage is on the wrong side of the racing line.`);
  assert.ok(Math.abs(stop.x-SPA_PIT_LAYOUT.stopX)<1e-7);assert.ok(isSpaPitApron(stop.x,stop.z),`${team.id} parking bay is not on the rendered/drivable working apron.`);
  assert.ok(Math.abs(spa.heightAt(stop.x,stop.z)-SPA_PIT_LAYOUT.serviceY)<1e-6);
 }
});

test('Spa placement fixes leave the shared Monza pit wall, garage side, strategy coordinates and racing floor unchanged',()=>{
 monzaPit.group.updateWorldMatrix(true,true);const after=new THREE.Box3().setFromObject(monzaWall);
 assert.ok(after.min.distanceTo(monzaWallBefore.min)<1e-10&&after.max.distanceTo(monzaWallBefore.max)<1e-10);
 assert.ok(Math.abs((after.min.x+after.max.x)/2+73.8)<1e-6,'The shared Monza wall was moved by a Spa-only repair.');
 assert.equal(monzaPit.layout.boxes.x,-40+MONZA_PIT_LAYOUT.buildingOffsetX);
 assert.ok(monzaPit.layout.strategyPods.every(p=>p.x===MONZA_PIT_LAYOUT.strategyX));
 assert.equal(monza.length,1426.4443446817202);assert.equal(monza.heightAt(-63,100),0);assert.equal(monza.gradeAt(0),0);
});
