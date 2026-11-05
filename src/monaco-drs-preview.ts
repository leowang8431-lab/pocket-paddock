import * as THREE from 'three';
import {MONACO_METRES_PER_UNIT,type MonacoLayout} from './monaco-layout';
import {batchStaticChildren} from './render-batches';

export const MONACO_DRS_MAP='https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_race_directors_event_notes_-_circuit_map_pit_lane_map_ers_battery_containment_area_red_zones.pdf';
/** Visual map annotations for the game's retained 2025 DRS rules.
 * Only detection and activation offsets are sourced measurements. The green
 * guide ends at T1; actual closing will depend on braking in the driving mode. */
export function createMonacoDrsPreview(layout:MonacoLayout){
 const detection=layout.corners[15].distance+80/MONACO_METRES_PER_UNIT;
 const activation=layout.corners[18].distance+18/MONACO_METRES_PER_UNIT;
 const end=layout.corners[0].distance;
 const zone={season:2025,detection,activation,end,detectionOffsetMetres:80,activationOffsetMetres:18,source:MONACO_DRS_MAP,endDefinition:'Visual guide to Turn 1, not a measured FIA closing line; driving will close under braking.'};
 const group=new THREE.Group();group.name='monaco-drs-reference-2025';group.userData.drsReference=zone;
 const paint=new THREE.MeshBasicMaterial({color:0x3d9b7b}),detectPaint=new THREE.MeshBasicMaterial({color:0xe3ad54});
 const vertices:number[]=[],indices:number[]=[];
 const distanceToEnd=(end-activation+layout.length)%layout.length;
 for(let d=0;d<distanceToEnd;d+=3.8){
  const start=layout.sampleAt(activation+d),finish=layout.sampleAt(activation+Math.min(d+2.5,distanceToEnd));
  for(const side of [-1,1]){
   const i=vertices.length/3;
   for(const s of [start,finish])for(const inset of [.40,.63]){const p=s.point.clone().addScaledVector(s.right,side*(layout.widthAt(s.distance)/2-inset));vertices.push(p.x,p.y+.046,p.z);}
   if(side===1)indices.push(i,i+1,i+2,i+1,i+3,i+2);else indices.push(i,i+2,i+1,i+1,i+2,i+3);
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const guides=new THREE.Mesh(geometry,paint);guides.name='monaco-drs-straight-edge-guide';group.add(guides);
 function marker(distance:number,label:string,color:THREE.MeshBasicMaterial){
  const s=layout.sampleAt(distance),cross=new THREE.Mesh(new THREE.BoxGeometry(layout.widthAt(distance)-.1,.026,.15),color);cross.name=`monaco-drs-line-${label.toLowerCase()}`;cross.position.copy(s.point);cross.position.y+=.045;cross.rotation.y=Math.atan2(s.tangent.x,s.tangent.z);group.add(cross);
  const post=new THREE.Group();post.name=`monaco-drs-sign-${label.toLowerCase()}`;post.position.copy(s.point).addScaledVector(s.right,layout.widthAt(distance)/2+1.1);post.rotation.y=Math.atan2(-s.tangent.x,-s.tangent.z);group.add(post);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2.8,6),new THREE.MeshStandardMaterial({color:0x859589}));pole.position.y=1.4;post.add(pole);
  let texture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d');if(c){c.fillStyle=label==='DETECT'?'#a97932':'#226b52';c.fillRect(0,0,512,128);c.fillStyle='#fff9e9';c.font='700 65px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(`DRS ${label}`,256,68,480);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;}}
  const sign=new THREE.Mesh(new THREE.BoxGeometry(4.1,1.0,.12),new THREE.MeshStandardMaterial({color:label==='DETECT'?0xc6a466:0x3e856b}));sign.position.y=2.8;post.add(sign);
  if(texture){const face=new THREE.Mesh(new THREE.PlaneGeometry(4.1,1),new THREE.MeshBasicMaterial({map:texture}));face.position.set(0,2.8,.065);post.add(face);}
  batchStaticChildren(post);
 }
 marker(detection,'DETECT',detectPaint);marker(activation,'OPEN',paint);marker(end,'END',paint);
 group.userData.note='Green lane-edge dashes are a model-review overlay, not a reproduction of actual road paint. This standalone model does not enable DRS physics.';
 return {group,zone};
}
