import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
layout.group.updateMatrixWorld(true);scenery.group.updateMatrixWorld(true);
type Point={x:number;z:number};
type Triangle={points:Point[];minX:number;maxX:number;minZ:number;maxZ:number};
const orient=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const area=(points:readonly Point[])=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.z-p.z*q.x;},0))/2;
function intersection(subject:readonly Point[],clip:readonly Point[]){
 let out=[...subject];const winding=Math.sign(orient(clip[0],clip[1],clip[2]));
 for(let edge=0;edge<clip.length&&out.length;edge++){
  const a=clip[edge],b=clip[(edge+1)%clip.length],input=out;out=[];let previous=input.at(-1)!,before=winding*orient(a,b,previous);
  for(const current of input){const after=winding*orient(a,b,current),was=before>=-1e-9,now=after>=-1e-9;if(was!==now){const t=before/(before-after);out.push({x:previous.x+(current.x-previous.x)*t,z:previous.z+(current.z-previous.z)*t});}if(now)out.push(current);previous=current;before=after;}
 }return area(out);
}
function vertices(object:THREE.Object3D){
 object.updateWorldMatrix(true,true);const result:THREE.Vector3[]=[];
 object.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const position=o.geometry.attributes.position;for(let i=0;i<position.count;i++){const p=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(o.matrixWorld);assert.ok(Number.isFinite(p.x+p.y+p.z));result.push(p);}});
 return result;
}
function triangles(object:THREE.Object3D){
 const result:Triangle[]=[];object.updateWorldMatrix(true,true);
 object.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const position=o.geometry.attributes.position,index=o.geometry.index;
  for(let i=0;i<(index?.count??position.count);i+=3){const points:Point[]=[];for(let j=0;j<3;j++){const p=new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld);points.push({x:p.x,z:p.z});}if(Math.abs(orient(points[0],points[1],points[2]))<1e-9)continue;
   result.push({points,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
  }
 });return result;
}
const pathDistance=(p:Point)=>{
 let result=Infinity;for(let i=1;i<layout.pitPath.length;i++){const a=layout.pitPath[i-1],b=layout.pitPath[i],dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz),0,1);result=Math.min(result,Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t));}return result;
};

test('all eight team pitwall cabins stand across the fast lane, on the right-hand land strip',()=>{
 assert.equal(scenery.pitwall.pods.length,8);assert.equal(new Set(scenery.pitwall.pods.map(p=>p.teamName)).size,8);
 assert.ok(scenery.pitwall.pods.some(p=>p.teamName==='FERRARI'),'Ferrari must have a right-side strategy cabin too');
 for(const [i,pod]of scenery.pitwall.pods.entries()){
  const bay=layout.pitBoxes[i],pit=bay.center.clone().addScaledVector(bay.front,layout.pitProfile.fastWidth/2+layout.pitProfile.apronWidth+bay.depth/2),center=pod.group.getWorldPosition(new THREE.Vector3());
  assert.ok(center.clone().sub(pit).dot(bay.front)>layout.pitProfile.fastWidth/2,'Strategy cabin is on the garage side rather than across the pit lane');
  const actual=vertices(pod.group);assert.ok(actual.length>100,'The team cabin has no real model');
  const inverse=pod.group.matrixWorld.clone().invert();let bottom=Infinity;
  for(const p of actual){bottom=Math.min(bottom,p.y);const local=p.clone().applyMatrix4(inverse);assert.ok(Math.abs(local.x)<=pod.width/2+.001&&Math.abs(local.z)<=pod.depth/2+.001,'Actual roof, staff or equipment extends beyond its declared safe cabin footprint');assert.ok(pathDistance(p)>layout.pitProfile.fastWidth/2+.3,'A cabin component intrudes into the pit fast lane');const near=layout.nearest(p.x,p.z);assert.ok(near.gap-layout.widthAt(near.distance)/2>1.05,'A cabin component reaches the main track fence');}
  assert.ok(Math.abs(bottom-.65)<.005,'Cabin foundation is floating above or sunk below the real land surface');
 }
});

test('entire cabin footprints and faces leave the actual race, pit asphalt, concrete wall and catch fence clear',()=>{
 const forbidden=['monaco-asphalt-ribbon','monaco-separate-pit-lane','monaco-race-barriers','monaco-catch-fence-0','monaco-catch-fence-1'].map(name=>{const object=layout.group.getObjectByName(name);assert.ok(object,`Missing real ${name} geometry`);return{name,triangles:triangles(object)};});
 for(const pod of scenery.pitwall.pods){
  const polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>{const p=pod.group.localToWorld(new THREE.Vector3(x*pod.width/2,0,z*pod.depth/2));return{x:p.x,z:p.z};}),minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x)),minZ=Math.min(...polygon.map(p=>p.z)),maxZ=Math.max(...polygon.map(p=>p.z));
  for(const source of forbidden)for(const t of source.triangles){if(t.maxX<minX||t.minX>maxX||t.maxZ<minZ||t.minZ>maxZ)continue;assert.ok(intersection(polygon,t.points)<1e-7,`${pod.teamName} roof/face footprint intersects actual ${source.name}`);}
 }
});

function hitColour(hit:THREE.Intersection){
 const mesh=hit.object as THREE.Mesh,material=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material) as THREE.MeshStandardMaterial,color=material.color.clone(),attribute=mesh.geometry.attributes.color;
 if(material.vertexColors&&attribute&&hit.face)color.multiply(new THREE.Color().fromBufferAttribute(attribute,hit.face.a));return color;
}
const colourDistance=(a:THREE.Color,b:THREE.Color)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
test('each right-side cabin renders four working-console faces and keyboards toward two real team engineers',()=>{
 for(const [index,pod]of scenery.pitwall.pods.entries()){
  const ray=(origin:THREE.Vector3,direction:THREE.Vector3,far:number)=>new THREE.Raycaster(pod.group.localToWorld(origin.clone()),direction.transformDirection(pod.group.matrixWorld),0,far).intersectObject(pod.group,true);
  for(const [i,x]of [-1.14,-.43,.43,1.14].entries()){
   const monitor=pod.group.getObjectByName(`monaco-pitwall-monitor-${index+1}-${i+1}`);assert.ok(monitor,'Missing inspectable screen placement');
   const screen=ray(new THREE.Vector3(x,1.245,-.10),new THREE.Vector3(0,0,-1),.11)[0];assert.ok(screen,'Monitor anchor exists but actual LCD geometry is missing');
   assert.ok(colourDistance(hitColour(screen),new THREE.Color(0x102d36))<.0002,'The console face is not a rendered dark LCD');
   const key=ray(new THREE.Vector3(x+.145,1.05,.065),new THREE.Vector3(0,-1,0),.10)[0];assert.ok(key,'Keyboard has no actual keys above the console');
   assert.ok(colourDistance(hitColour(key),new THREE.Color(0x9aafa0))<.0002,'The console has no visible keyboard keys');
   const screenFront=new THREE.Vector3(0,0,1).transformDirection(monitor.matrixWorld),operator=pod.group.localToWorld(new THREE.Vector3(Math.sign(x)*.78,1.43,.37)),monitorPoint=monitor.getWorldPosition(new THREE.Vector3());assert.ok(screenFront.dot(operator.sub(monitorPoint).normalize())>.65,'LCD faces away from its engineer');
  }
  for(const [i,x]of [-.78,.78].entries()){
   assert.ok(pod.group.getObjectByName(`monaco-pitwall-operator-${index+1}-${i+1}`),'Missing team engineer placement');
   for(const origin of [new THREE.Vector3(x,.91,.17),new THREE.Vector3(x+.10,1.57,.11)]){const body=ray(origin,new THREE.Vector3(0,0,1),.4)[0];assert.ok(body,'Engineer torso or helmet is missing from the merged model');assert.ok(colourDistance(hitColour(body),new THREE.Color(pod.teamColor))<.0002,'Engineer body or helmet does not use the assigned team colour');}
  }
 }
});
