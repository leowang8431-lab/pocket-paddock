import * as THREE from 'three';
import {coloredGeometry} from './render-batches';

export const MONZA_FOREST_REFERENCE='https://reggiadimonza.it/natura/';
export type TreeKind='oak'|'lime'|'columnar'|'tulip';
export const TREE_KINDS:readonly TreeKind[]=['oak','lime','columnar','tulip'];
export interface TreeLocation {x:number;z:number;s:number;color:THREE.Color}
const mod=(n:number,d:number)=>((n%d)+d)%d;

/** Uneven rings give each crown branches and a botanical silhouette instead
 * of repeating the same three spheres. Columnar is a silhouette variant, not
 * a claim about the surveyed species at that exact location. */
function crown(profile:number[][],sides:number,seed:number,x=0,z=0){
  const geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),sides);
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const px=positions.getX(i),pz=positions.getZ(i),y=positions.getY(i),a=Math.atan2(pz,px);
    const ripple=1+.045*Math.sin(a*3+seed)+.026*Math.sin(a*5+y*.83+seed*2);
    positions.setXYZ(i,px*ripple+x,y+Math.sin(a*4+seed)*.10,pz*ripple+z);
  }
  geometry.computeVertexNormals();return geometry;
}
function branch(a:number[],b:number[],radius:number){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
  return new THREE.CylinderGeometry(radius*.58,radius,delta.length(),6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize())).translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
}
export function createTreeGeometry(kind:TreeKind,far=false){
  const sides=far?6:10,parts:{geometry:THREE.BufferGeometry;color:number}[]=[];
  const trunkHeight=kind==='columnar'?7.2:5.8;
  parts.push({geometry:new THREE.CylinderGeometry(.21,.44,trunkHeight,far?5:7).translate(0,trunkHeight/2,0),color:0x74624e});
  if(!far){
    parts.push({geometry:branch([0,3.4,0],[-1.35,6.1,.25],.19),color:0x796650},
      {geometry:branch([0,4.2,0],[1.5,6.5,-.5],.17),color:0x796650});
  }
  if(kind==='oak'){
    parts.push({geometry:crown([[0,4.7],[1.9,5.2],[3.3,6.4],[3.3,7.5],[2.7,8.9],[1.2,10.0],[0,10.3]],sides,1),color:0x4b7141});
    if(!far)parts.push({geometry:crown([[0,5.5],[1.8,5.9],[2.2,7.2],[1.6,8.4],[0,9.2]],8,3,-1.85,.4),color:0x567b43},
      {geometry:crown([[0,5.8],[1.5,6.3],[2.1,7.5],[1.6,8.5],[0,9.0]],8,5,1.75,-.4),color:0x6c8a49});
  }else if(kind==='lime'){
    parts.push({geometry:crown([[0,4.9],[2.4,5.4],[4,6.6],[4.12,7.6],[3.2,8.6],[1.4,9.35],[0,9.45]],sides,4),color:0x6a8949});
    if(!far)parts.push({geometry:branch([0,4.2,0],[-2.7,6.4,.3],.16),color:0x74634d},
      {geometry:branch([0,4.5,0],[2.7,6.7,.3],.16),color:0x74634d});
  }else if(kind==='columnar'){
    parts.push({geometry:crown([[0,4.5],[.8,5.2],[1.25,6.9],[1.55,9.0],[1.28,11.1],[.65,12.7],[0,13.7]],sides,7),color:0x527747});
  }else{
    parts.push({geometry:crown([[0,4.6],[1.7,5.1],[3.4,6.5],[3.25,7.4],[1.8,8.1],[0,8.3]],sides,8),color:0x567f46},
      {geometry:crown([[0,7.1],[1.7,7.5],[2.65,8.6],[2.25,10],[.9,11.2],[0,11.5]],far?6:8,11,.2,-.15),color:0x7a9851});
  }
  const geometry=coloredGeometry(parts);geometry.computeBoundingBox();geometry.userData.kind=kind;geometry.userData.lod=far?'far':'near';return geometry;
}

/** At most two tree kinds per cell and two draws at the active LOD. Four
 * species silhouettes do not multiply every visible forest cell by four. */
export function addMonzaForest(root:THREE.Group,locations:readonly TreeLocation[]){
  const shapes=new Map<TreeKind,THREE.BufferGeometry[]>();
  for(const kind of TREE_KINDS)shapes.set(kind,[createTreeGeometry(kind),createTreeGeometry(kind,true)]);
  const material=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),size=92;
  const cells=new Map<string,TreeLocation[]>(),counts:Record<TreeKind,number>={oak:0,lime:0,columnar:0,tulip:0};
  for(const location of locations){const key=`${Math.floor(location.x/size)},${Math.floor(location.z/size)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(location);}
  const object=new THREE.Object3D(),color=new THREE.Color();
  for(const [key,trees]of cells){
    const [cx,cz]=key.split(',').map(Number),pair=[TREE_KINDS[mod(cx*3+cz,4)],TREE_KINDS[mod(cx*3+cz+1+mod(cx+cz,3),4)]];
    const groups=new Map<TreeKind,TreeLocation[]>();
    for(const p of trees){const kind=pair[mod(Math.floor(p.x*11+p.z*7),2)];if(!groups.has(kind))groups.set(kind,[]);groups.get(kind)!.push(p);counts[kind]++;}
    const lod=new THREE.LOD();lod.name=`forest-cell-${key}`;lod.position.set((cx+.5)*size,0,(cz+.5)*size);lod.userData.treeKinds=[...groups.keys()];
    for(let level=0;level<2;level++){
      const group=new THREE.Group();
      for(const [kind,instances]of groups){
        const mesh=new THREE.InstancedMesh(shapes.get(kind)![level],material,instances.length);mesh.name=`monza-${kind}-${level?'far':'near'}`;
        instances.forEach((p,i)=>{object.position.set(p.x-lod.position.x,0,p.z-lod.position.z);object.scale.setScalar(p.s);object.rotation.set(0,(p.x*13.7+p.z*3.8)%(Math.PI*2),0);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);color.setRGB(.86+p.color.r*.2,.88+p.color.g*.25,.86+p.color.b*.18);mesh.setColorAt(i,color);});
        mesh.computeBoundingSphere();mesh.castShadow=false;group.add(mesh);
      }
      lod.addLevel(group,level===0?0:105,.12);
    }
    lod.addLevel(new THREE.Group(),340,.1);root.add(lod);
  }
  root.userData.treeCells=cells.size;root.userData.treeInstances=locations.length;
  root.userData.forest={reference:MONZA_FOREST_REFERENCE,kinds:TREE_KINDS.slice(),counts,instances:locations.length,cells:cells.size,maxDrawsPerCell:2,artistic:'Four authored broadleaf silhouettes, inspired by the park flora; individual trees and columnar variants are not surveyed botanical positions.'};
}
