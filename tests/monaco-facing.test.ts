import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout';
import {createMonacoScenery} from '../src/monaco-scenery';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
scenery.group.updateMatrixWorld(true);
function verticesOfColor(root:THREE.Object3D,color:number){
 const expected=new THREE.Color(color),result:THREE.Vector3[]=[];
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const positions=object.geometry.attributes.position,colors=object.geometry.attributes.color;
  if(!colors)return;
  for(let i=0;i<positions.count;i++)if(Math.abs(colors.getX(i)-expected.r)+Math.abs(colors.getY(i)-expected.g)+Math.abs(colors.getZ(i)-expected.b)<1e-5)result.push(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld));
 });return result;
}
const mean=(points:THREE.Vector3[])=>points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);

for(const id of ['E','P','T'])test(`grandstand ${id} real low seats and spectator faces point towards the adjacent racing surface`,()=>{
 const stand=scenery.group.getObjectByName(`monaco-grandstand-${id}`)!;assert.ok(stand);
 const origin=stand.getWorldPosition(new THREE.Vector3()),nearest=layout.nearest(origin.x,origin.z),towardsRoad=nearest.point.clone().sub(origin).setY(0).normalize();
 const seatVertices=verticesOfColor(stand,0x7caaa4),headVertices=verticesOfColor(stand,0xe2d2b4),eyeVertices=verticesOfColor(stand,0x3f5956);
 assert.ok(seatVertices.length>100&&headVertices.length>100&&eyeVertices.length>100,'The batched stand lost its actual seats or facing details');
 const lowY=Math.min(...seatVertices.map(p=>p.y)),highY=Math.max(...seatVertices.map(p=>p.y));
 const lowest=seatVertices.filter(p=>p.y<lowY+.17),highest=seatVertices.filter(p=>p.y>highY-.17);
 const downhill=mean(lowest).sub(mean(highest)).setY(0).normalize();
 assert.ok(downhill.dot(towardsRoad)>.999,`Stand ${id} has its high rear rows closest to the track or aims along the road`);
 const heads=mean(headVertices),faces=mean(eyeVertices),actualFacing=faces.clone().sub(heads).setY(0);
 assert.ok(actualFacing.length()>.25&&actualFacing.length()<.31,'The eye band must sit on the actual front of the spectator heads');
 assert.ok(actualFacing.normalize().dot(towardsRoad)>.999,`Stand ${id} spectator faces look away from the racing surface`);
 assert.ok(Math.abs(faces.y-heads.y)<.06,'Faces were placed above or below the actual heads');
});
