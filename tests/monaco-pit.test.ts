import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
type Point={x:number;z:number};
type Triangle={points:Point[];minX:number;maxX:number;minZ:number;maxZ:number};
const mesh=(name:string)=>{const object=layout.group.getObjectByName(name);assert.ok(object instanceof THREE.Mesh,`Missing actual surface ${name}`);return object as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;};
const orient=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const area=(poly:readonly Point[])=>Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p.x*q.z-q.x*p.z;},0))/2;
const colourDistance=(a:THREE.Color,b:THREE.Color)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
function triangles(object:THREE.Mesh<THREE.BufferGeometry>){
 object.updateWorldMatrix(true,true);const position=object.geometry.attributes.position,index=object.geometry.index,result:Triangle[]=[],p=new THREE.Vector3();
 for(let i=0;i<(index?.count??position.count);i+=3){const points:Point[]=[];for(let j=0;j<3;j++){p.fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld);assert.ok(Number.isFinite(p.x+p.y+p.z));points.push({x:p.x,z:p.z});}
  const signed=orient(points[0],points[1],points[2]);assert.ok(signed<1e-7,`${object.name} has a downward-facing pavement triangle`);if(Math.abs(signed)<1e-10)continue;
  result.push({points,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
 }assert.ok(result.length>2,`${object.name} contains no useful pavement`);return result;
}
function intersectionArea(subject:readonly Point[],clip:readonly Point[]){
 let out=[...subject];const winding=Math.sign(orient(clip[0],clip[1],clip[2]));
 for(let edge=0;edge<clip.length&&out.length;edge++){
  const a=clip[edge],b=clip[(edge+1)%clip.length],input=out;out=[];let previous=input[input.length-1],before=winding*orient(a,b,previous);
  for(const current of input){const after=winding*orient(a,b,current),was=before>=-1e-9,now=after>=-1e-9;if(was!==now){const t=before/(before-after);out.push({x:previous.x+(current.x-previous.x)*t,z:previous.z+(current.z-previous.z)*t});}if(now)out.push(current);previous=current;before=after;}
 }return out.length<3?0:area(out);
}
function maximumOverlap(first:readonly Triangle[],second:readonly Triangle[]){
 const grid=new Map<string,number[]>(),cell=8;for(let i=0;i<second.length;i++){const t=second[i];for(let x=Math.floor(t.minX/cell);x<=Math.floor(t.maxX/cell);x++)for(let z=Math.floor(t.minZ/cell);z<=Math.floor(t.maxZ/cell);z++){const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key)!.push(i);}}
 let maximum=0;for(const t of first){const candidates=new Set<number>();for(let x=Math.floor(t.minX/cell);x<=Math.floor(t.maxX/cell);x++)for(let z=Math.floor(t.minZ/cell);z<=Math.floor(t.maxZ/cell);z++)for(const i of grid.get(`${x},${z}`)??[])candidates.add(i);
  for(const i of candidates){const other=second[i];if(t.maxX<other.minX||t.minX>other.maxX||t.maxZ<other.minZ||t.minZ>other.maxZ)continue;maximum=Math.max(maximum,intersectionArea(t.points,other.points));}
 }return maximum;
}
function downward(object:THREE.Object3D,point:THREE.Vector3){object.updateWorldMatrix(true,true);return new THREE.Raycaster(point.clone().add(new THREE.Vector3(0,10,0)),new THREE.Vector3(0,-1,0),0,20).intersectObject(object,true);}
function pathDistance(point:Point){let best=Infinity,closest=layout.pitPath[0].clone();for(let i=1;i<layout.pitPath.length;i++){const a=layout.pitPath[i-1],b=layout.pitPath[i],delta=b.clone().sub(a).setY(0),t=THREE.MathUtils.clamp(((point.x-a.x)*delta.x+(point.z-a.z)*delta.z)/delta.lengthSq(),0,1),p=a.clone().lerp(b,t),d=Math.hypot(point.x-p.x,point.z-p.z);if(d<best){best=d;closest=p;}}return{gap:best,point:closest};}
function actualVertices(root:THREE.Object3D){root.updateWorldMatrix(true,true);const points:THREE.Vector3[]=[],seen=new Set<string>(),p=new THREE.Vector3();root.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const position=object.geometry.attributes.position;for(let i=0;i<position.count;i++){p.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld);const key=`${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;if(!seen.has(key)){seen.add(key);points.push(p.clone());}}});assert.ok(points.length>4,`${root.name} has no actual geometry`);return points;}

test('the wider pit route approaches the garages forwards and rejoins beyond Sainte Devote through real open gates',()=>{
 const profile=layout.pitProfile,path=layout.pitPath;
 assert.equal(path.length,231);assert.equal(profile.fastWidth,6);assert.ok(profile.apronWidth>=3.5&&profile.garageDepth>=3);
 assert.ok(profile.entryDistance>layout.corners[16].distance&&profile.entryDistance<layout.corners[18].distance);
 assert.ok(profile.exitDistance>layout.corners[0].distance&&profile.exitDistance<layout.corners[1].distance);
 for(const [i,distance]of [[0,profile.entryDistance],[path.length-1,profile.exitDistance]]){assert.ok(path[i].distanceTo(layout.sampleAt(distance).point)<.1);}
 const first=path[1].clone().sub(path[0]).normalize(),last=path.at(-1)!.clone().sub(path.at(-2)!).normalize();
 assert.ok(first.dot(layout.sampleAt(profile.entryDistance).tangent)>.65,'Pit entry suddenly doubles back across the racing direction');assert.ok(last.dot(layout.sampleAt(profile.exitDistance).tangent)>.65,'Pit exit meets the track against the racing direction');
 const service=path.filter(p=>p.z>Math.min(profile.serviceStartZ,profile.serviceEndZ)&&p.z<Math.max(profile.serviceStartZ,profile.serviceEndZ));assert.ok(service.length>20);
 for(let i=1;i<service.length;i++)assert.ok(service[i].z<service[i-1].z,'The garage fast lane contains an extra hairpin or reverse section');
 assert.ok(path[0].distanceTo(service[0])>25,'Garages start immediately after the entry kink without a settling section');
 layout.group.updateWorldMatrix(true,true);
 const shoulder=(i:number)=>{const direction=path[Math.min(path.length-1,i+1)].clone().sub(path[Math.max(0,i-1)]);return new THREE.Vector3(direction.z,0,-direction.x).normalize();};
 for(const from of [0,path.length-10])for(let i=from;i<from+8;i++)for(const height of [.65,1.5])for(const side of [-2.4,0,2.4]){
  const a=path[i].clone().addScaledVector(shoulder(i),side).add(new THREE.Vector3(0,height,0)),b=path[i+1].clone().addScaledVector(shoulder(i+1),side).add(new THREE.Vector3(0,height,0)),direction=b.clone().sub(a),length=direction.length();
  const hits=new THREE.Raycaster(a,direction.normalize(),.02,Math.max(.021,length-.02)).intersectObject(layout.group,true);assert.equal(hits.length,0,`A rendered wall, fence or retaining skirt blocks pit gate i=${i}, side=${side}, height=${height}`);
 }
});

test('actual fast-lane and working-apron triangles share boundaries without covering the racing asphalt',()=>{
 const road=mesh('monaco-asphalt-ribbon'),fast=mesh('monaco-separate-pit-lane'),apron=mesh('monaco-pit-working-apron'),divider=mesh('monaco-pit-colour-divider'),raceTriangles=triangles(road),fastTriangles=triangles(fast),apronTriangles=triangles(apron),dividerTriangles=triangles(divider);
 for(const [name,a,b]of [['fast/race',fastTriangles,raceTriangles],['apron/race',apronTriangles,raceTriangles],['fast/apron',fastTriangles,apronTriangles],['divider/race',dividerTriangles,raceTriangles],['divider/fast',dividerTriangles,fastTriangles],['divider/apron',dividerTriangles,apronTriangles]] as const){const overlap=maximumOverlap(a,b);assert.ok(overlap<1e-4,`${name} actual pavement overlap ${overlap} creates mixed-colour patches`);}
 assert.ok(colourDistance(fast.material.color,road.material.color)>.1,'Fast lane still uses an indistinguishable racing-asphalt material');assert.ok(colourDistance(apron.material.color,fast.material.color)>.1,'Working apron and fast lane must have distinct actual materials');
 assert.equal(fast.material.polygonOffset,false,'Colour separation must not rely on a depth offset over another road');
 let observed=0;for(let i=2;i<layout.pitPath.length-2;i+=3){const point=layout.pitPath[i];if(point.z<Math.min(49,layout.pitProfile.serviceStartZ)||point.z>Math.max(94,layout.pitProfile.serviceEndZ))continue;const direction=layout.pitPath[i+1].clone().sub(layout.pitPath[i-1]),right=new THREE.Vector3(direction.z,0,-direction.x).normalize();for(const side of [-1,0,1])assert.ok(downward(fast,point.clone().addScaledVector(right,side*(layout.pitProfile.fastWidth/2-.2))).length,`Actual fast lane at z=${point.z} is narrower than the declared six units`);observed++;}
 assert.ok(observed>8,'The actual wide service section was not inspected');
 for(const box of layout.pitBoxes){
  assert.ok(downward(apron,box.apronCenter).length,'A garage has no distinct paved working apron in front');
  assert.ok(downward(divider,box.apronCenter.clone().addScaledVector(box.front,box.apronWidth/2-.25)).length,'The half-unit separator is missing at a garage frontage');
  assert.ok(downward(apron,box.apronCenter.clone().addScaledVector(box.front,-box.apronWidth/2+.2)).length,'The combined apron and separator do not span the full 3.5-unit service band');
 }
});

test('all eight continuous garage fronts and parking boxes leave the real fast lane and racing surface clear',()=>{
 assert.equal(layout.pitBoxes.length,8);assert.equal(scenery.summary.pitBays,8);
 const apron=mesh('monaco-pit-working-apron'),garages=scenery.group.getObjectByName('monaco-pit-garages');assert.ok(garages);
 const structure=garages.getObjectByName('monaco-pit-continuous-building');assert.ok(structure);
 for(const box of layout.pitBoxes){
  const garage=garages.getObjectByName(`monaco-pit-box-${box.id}`),parking=garages.getObjectByName(`monaco-pit-parking-box-${box.id}`);assert.ok(garage&&parking);
  garage.updateWorldMatrix(true,true);const direction=new THREE.Vector3(0,0,1).transformDirection(garage.matrixWorld),origin=garage.getWorldPosition(new THREE.Vector3()),towards=parking.getWorldPosition(new THREE.Vector3()).sub(origin).setY(0).normalize();assert.ok(direction.dot(towards)>.9,'A garage door faces away from its real parking apron');
  for(const point of actualVertices(garage)){assert.ok(pathDistance(point).gap>layout.pitProfile.fastWidth/2+.2,'Actual garage geometry enters the fast lane');const n=layout.nearest(point.x,point.z);assert.ok(n.gap>layout.widthAt(n.distance)/2+.6,'Actual garage geometry enters the racing asphalt');}
  for(const point of actualVertices(parking))assert.ok(downward(apron,point).length,'A parking-frame edge falls outside the actual working apron');
 }
 // The shared roof and rear wall must also be checked, not only the bays.
 for(const point of actualVertices(structure)){const n=layout.nearest(point.x,point.z);assert.ok(n.gap>layout.widthAt(n.distance)/2+.3,'The continuous pit building crosses a racing surface');if(point.y<4.5)assert.ok(pathDistance(point).gap>layout.pitProfile.fastWidth/2-.05,'Shared low pit-building geometry blocks the fast lane');}
});

test('every garage has three actual walls, an open front and two physical telemetry screens and keyboards',()=>{
 scenery.group.updateMatrixWorld(true);
 for(const box of layout.pitBoxes){
  const garage=scenery.group.getObjectByName(`monaco-pit-box-${box.id}`)!;
  const ray=(origin:THREE.Vector3,direction:THREE.Vector3,far:number)=>new THREE.Raycaster(garage.localToWorld(origin.clone()),direction.transformDirection(garage.matrixWorld),0,far).intersectObject(garage,true);
  for(const side of [-1,1])assert.ok(ray(new THREE.Vector3(0,2.2,0),new THREE.Vector3(side,0,0),box.width/2+.1).length,`Garage ${box.id} has a missing side wall`);
  assert.ok(ray(new THREE.Vector3(0,2.2,0),new THREE.Vector3(0,0,-1),box.depth/2+.1).length,'Missing rear wall');
  assert.equal(ray(new THREE.Vector3(0,2.2,0),new THREE.Vector3(0,0,1),box.depth/2+.2).length,0,'The open garage entrance was blocked');
  for(const side of [-1,1]){
   const station=garage.getObjectByName(`monaco-pit-strategy-workstation-${box.id}`)!;
   const screenOrigin=station.localToWorld(new THREE.Vector3(side*.43,1.43,.12)),screenDirection=new THREE.Vector3(0,0,-1).transformDirection(station.matrixWorld);
   assert.ok(new THREE.Raycaster(screenOrigin,screenDirection,0,.24).intersectObject(garage,true).length,'A telemetry screen has no rendered face');
   assert.ok(new THREE.Raycaster(station.localToWorld(new THREE.Vector3(side*.43,1.1,.19)),new THREE.Vector3(0,-1,0),0,.15).intersectObject(garage,true).length,'A keyboard has no actual geometry');
  }
 }
});
