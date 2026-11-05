import * as THREE from 'three';
import type {Track} from './track';
import type {DrsZone} from './drs';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** In Track's authored XZ frame the positive cross-track vector is the
 * driver's left. Keep the Rettifilo opening board on that grass verge. */
export function createDrsSignLayouts(track:Track,zones:readonly DrsZone[]){
  return zones.flatMap(zone=>[[zone.start,zone.id-1],[zone.detection,2],[zone.end,3]].map(([distance,atlasRow])=>{
    const leftOfRettifilo=track.id==='monza'&&zone.id===2&&(atlasRow===1||atlasRow===2);
    const sample=track.sampleAt(distance),offset=leftOfRettifilo?track.widthAt(distance)/2+(atlasRow===1?9.2:6):track.id==='monaco'?track.widthAt(distance)/2+3.4:-11.7;
    return {zone:zone.id,distance,atlasRow,offset,sample,position:sample.point.clone().addScaledVector(sample.right,offset).setY(sample.point.y+2.1)};
  }));
}

/** A single sign atlas and one merged paint draw mark real-zone-inspired lines. */
export function createDrsMarkers(track:Track,zones:readonly DrsZone[]):THREE.Group{
  const root=new THREE.Group();root.name='monza-drs-markers';
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d')!;
  const labels=['DRS 1','DRS 2','DRS · DETECT','DRS · END'];
  labels.forEach((label,i)=>{ctx.fillStyle=i<2?'#2c8965':'#eef2e5';ctx.fillRect(0,i*64,512,64);ctx.fillStyle=i<2?'#ffffff':'#33473d';ctx.font='bold 42px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,256,i*64+34);});
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
  const signParts:THREE.BufferGeometry[]=[],paintParts:THREE.BufferGeometry[]=[],postParts:THREE.BufferGeometry[]=[];
  const place=(geometry:THREE.BufferGeometry,position:THREE.Vector3,rotation:THREE.Euler)=>geometry.applyMatrix4(new THREE.Matrix4().compose(position,new THREE.Quaternion().setFromEuler(rotation),new THREE.Vector3(1,1,1)));
  for(const {sample:s,position,atlasRow} of createDrsSignLayouts(track,zones)){
      const sign=new THREE.PlaneGeometry(3.2,.9),uv=sign.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setY(i,1-(atlasRow+(1-uv.getY(i)))/4);
      signParts.push(place(sign,position,new THREE.Euler(0,Math.atan2(-s.tangent.x,-s.tangent.z),0)));
      postParts.push(place(new THREE.BoxGeometry(.09,1.9,.09),position.clone().setY(s.point.y+.95),new THREE.Euler()));
  }
  for(const zone of zones){
    const sample=track.sampleAt(zone.start),yaw=Math.atan2(sample.tangent.x,sample.tangent.z);
    paintParts.push(place(new THREE.BoxGeometry(track.widthAt(sample.distance),.018,.22),sample.point.clone().add(new THREE.Vector3(0,.071,0)),new THREE.Euler(0,yaw,0)));
    // Short edge dashes, keeping the racing line and finish grid readable.
    const span=(zone.end-zone.start+track.length)%track.length;
    for(let d=0;d<span;d+=10){const s=track.sampleAt(zone.start+d);for(const side of [-1,1])paintParts.push(place(new THREE.BoxGeometry(.14,.018,4),s.point.clone().addScaledVector(s.right,side*(track.widthAt(s.distance)/2-.45)).add(new THREE.Vector3(0,.07,0)),new THREE.Euler(0,Math.atan2(s.tangent.x,s.tangent.z),0)));}
  }
  const add=(parts:THREE.BufferGeometry[],material:THREE.Material,name:string)=>{const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(geometry){const mesh=new THREE.Mesh(geometry,material);mesh.name=name;root.add(mesh);}};
  add(signParts,new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}),'drs-signs');
  add(paintParts,new THREE.MeshStandardMaterial({color:0x48b385,roughness:.8}),'drs-painted-lines');
  add(postParts,new THREE.MeshStandardMaterial({color:0xc9cfcc,roughness:.65}),'drs-sign-posts');
  root.userData.zones=zones;
  root.userData.signLayouts=createDrsSignLayouts(track,zones).map(({zone,distance,atlasRow,offset,position})=>({zone,distance,atlasRow,offset,position:position.toArray()}));
  return root;
}
