import * as THREE from 'three';
import {SPA_PIT_LAYOUT} from './spa-pit-layout';
import {asphaltTexture} from './monza-details';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
type P={x:number;y:number;z:number;nx?:number;ny?:number;nz?:number};
type Cut={vertices:P[];minX:number;maxX:number;minZ:number;maxZ:number};
const signed=(p:readonly P[])=>p.reduce((sum,v,i)=>{const q=p[(i+1)%p.length];return sum+v.x*q.z-v.z*q.x;},0)/2;
const side=(a:P,b:P,p:P)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
function half(poly:readonly P[],a:P,b:P,inside:boolean){const out:P[]=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],sp=side(a,b,p),sq=side(a,b,q),ip=inside?sp>=-1e-9:sp<=1e-9,iq=inside?sq>=-1e-9:sq<=1e-9;if(ip)out.push(p);if(ip!==iq){const t=THREE.MathUtils.clamp(sp/(sp-sq),0,1);out.push({x:THREE.MathUtils.lerp(p.x,q.x,t),y:THREE.MathUtils.lerp(p.y,q.y,t),z:THREE.MathUtils.lerp(p.z,q.z,t),...(p.nx!==undefined&&q.nx!==undefined?{nx:THREE.MathUtils.lerp(p.nx,q.nx,t),ny:THREE.MathUtils.lerp(p.ny!,q.ny!,t),nz:THREE.MathUtils.lerp(p.nz!,q.nz!,t)}:{})});}}return out;}
function subtract(poly:P[],cut:readonly P[]){let remaining=poly;const outside:P[][]=[];for(let i=0;i<3&&remaining.length>=3;i++){const a=cut[i],b=cut[(i+1)%3],piece=half(remaining,a,b,false);if(piece.length>=3&&Math.abs(signed(piece))>1e-8)outside.push(piece);remaining=half(remaining,a,b,true);}return outside;}

/** The road owns the merge footprint; adjacent service surfaces are cut from
 * that footprint, never layered on top of it or on top of each other. */
export function buildSpaPitSurfaces(road:THREE.Mesh<THREE.BufferGeometry>,path:readonly THREE.Vector3[]){
 const root=new THREE.Group();root.name='spa-pit-road-system';
 const position=road.geometry.attributes.position,index=road.geometry.index!,cuts:Cut[]=[];
 for(let i=0;i<index.count;i+=3){const vertices:Array<P>=[];for(let j=0;j<3;j++){const at=index.getX(i+j);vertices.push({x:position.getX(at),y:position.getY(at),z:position.getZ(at)});}if(signed(vertices)<0)vertices.reverse();cuts.push({vertices,minX:Math.min(...vertices.map(v=>v.x)),maxX:Math.max(...vertices.map(v=>v.x)),minZ:Math.min(...vertices.map(v=>v.z)),maxZ:Math.max(...vertices.map(v=>v.z))});}
 function surface(name:string,quads:P[][],color:number){
  let vertices:number[]=[];
  for(const quad of quads)for(const ids of [[0,1,2],[1,3,2]]){
   let pieces=[ids.map(i=>quad[i])];const poly=pieces[0],minX=Math.min(...poly.map(v=>v.x)),maxX=Math.max(...poly.map(v=>v.x)),minZ=Math.min(...poly.map(v=>v.z)),maxZ=Math.max(...poly.map(v=>v.z));
   for(const cut of cuts){if(cut.minX>maxX||cut.maxX<minX||cut.minZ>maxZ||cut.maxZ<minZ)continue;pieces=pieces.flatMap(p=>subtract(p,cut.vertices));if(!pieces.length)break;}
   for(const piece of pieces){if(signed(piece)>0)piece.reverse();for(let i=1;i<piece.length-1;i++){const tri=[piece[0],piece[i],piece[i+1]];if(Math.abs(signed(tri))<1e-8)continue;for(const p of tri)vertices.push(p.x,p.y,p.z);}}
  }
  // Main-road-owned merge paving can separate the remaining pit polygons.
  // Both pieces are real carriageway; retaining just the largest component
  // would silently remove the La Source bypass and leave the car over a hole.
  const geometry=new THREE.BufferGeometry(),uv:number[]=[];for(let i=0;i<vertices.length;i+=3)uv.push(vertices[i]/5,vertices[i+2]/5);geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color,roughness:.91});material.name=name;material.userData.weatherSurface='road';if(name==='spa-pit-lane'){const texture=asphaltTexture();if(texture)material.map=texture;}
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;root.add(mesh);return mesh;
 }
 const quads:P[][]=[];
 for(let i=0;i<path.length-1;i++){const corners:P[]=[];for(const j of [i,i+1]){const p=path[j],a=path[Math.max(0,j-1)],b=path[Math.min(path.length-1,j+1)],right=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();for(const sign of [-1,1])corners.push({x:p.x+right.x*SPA_PIT_LAYOUT.fastHalfWidth*sign,y:p.y+.052,z:p.z+right.z*SPA_PIT_LAYOUT.fastHalfWidth*sign});}quads.push(corners);}
 surface('spa-pit-lane',quads,0x3c5056);
 const rect=(from:number,to:number)=>[[{x:from,y:.052,z:SPA_PIT_LAYOUT.serviceMinZ},{x:to,y:.052,z:SPA_PIT_LAYOUT.serviceMinZ},{x:from,y:.052,z:SPA_PIT_LAYOUT.serviceMaxZ},{x:to,y:.052,z:SPA_PIT_LAYOUT.serviceMaxZ}]];
 surface('spa-pit-colour-divider',rect(SPA_PIT_LAYOUT.apronMinX,SPA_PIT_LAYOUT.apronMinX+SPA_PIT_LAYOUT.dividerWidth),0x4e9794);
 surface('spa-pit-working-apron',rect(SPA_PIT_LAYOUT.apronMinX+SPA_PIT_LAYOUT.dividerWidth,SPA_PIT_LAYOUT.apronMaxX),0xb9b8ad);
 root.userData.surfacePolicy='Fast lane, 2u teal divider and grey apron have disjoint footprints; the main road owns entry/exit overlaps.';
 return root;
}

/** Paving owns its footprint, including the inside of La Source. Clip grass,
 * gravel and decorative kerbs away in plan instead of stacking them above a
 * differently sloped pit ramp or hiding the fight with a depth offset. */
export function trimSpaPitGround(root:THREE.Group,pit:THREE.Group){
 const cell=18,cuts:Cut[]=[],grid=new Map<string,number[]>();
 pit.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const p=object.geometry.attributes.position,index=object.geometry.index;
  for(let i=0;i<(index?.count??p.count);i+=3){
   const vertices:P[]=[];for(let j=0;j<3;j++){const at=index?index.getX(i+j):i+j;vertices.push({x:p.getX(at),y:p.getY(at),z:p.getZ(at)});}if(signed(vertices)<0)vertices.reverse();
   const cut={vertices,minX:Math.min(...vertices.map(p=>p.x)),maxX:Math.max(...vertices.map(p=>p.x)),minZ:Math.min(...vertices.map(p=>p.z)),maxZ:Math.max(...vertices.map(p=>p.z))},id=cuts.length;cuts.push(cut);
   for(let x=Math.floor(cut.minX/cell);x<=Math.floor(cut.maxX/cell);x++)for(let z=Math.floor(cut.minZ/cell);z<=Math.floor(cut.maxZ/cell);z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key)!.push(id);}
  }
 });
 for(const object of root.children){
  if(!(object instanceof THREE.Mesh)||!/^spa-(rolling-terrain|road-earth-bed|gravel-|red-yellow-kerb-|kerb-shoulder-)/.test(object.name))continue;
  const original=object.geometry,p=original.attributes.position,n=original.attributes.normal,index=original.index,positions:number[]=[],normals:number[]=[],uv:number[]=[];
  for(let i=0;i<(index?.count??p.count);i+=3){
   const triangle:P[]=[];for(let j=0;j<3;j++){const at=index?index.getX(i+j):i+j;triangle.push({x:p.getX(at),y:p.getY(at),z:p.getZ(at),nx:n.getX(at),ny:n.getY(at),nz:n.getZ(at)});}
   const minX=Math.min(...triangle.map(p=>p.x)),maxX=Math.max(...triangle.map(p=>p.x)),minZ=Math.min(...triangle.map(p=>p.z)),maxZ=Math.max(...triangle.map(p=>p.z)),candidates=new Set<number>();
   for(let x=Math.floor(minX/cell);x<=Math.floor(maxX/cell);x++)for(let z=Math.floor(minZ/cell);z<=Math.floor(maxZ/cell);z++)for(const id of grid.get(x+','+z)??[])candidates.add(id);
   let pieces=[triangle];for(const id of candidates){const cut=cuts[id];if(cut.minX>maxX||cut.maxX<minX||cut.minZ>maxZ||cut.maxZ<minZ)continue;pieces=pieces.flatMap(poly=>subtract(poly,cut.vertices));if(!pieces.length)break;}
   for(const piece of pieces)for(let j=1;j<piece.length-1;j++){const t=[piece[0],piece[j],piece[j+1]];if(Math.abs(signed(t))<1e-8)continue;for(const v of t){positions.push(v.x,v.y,v.z);normals.push(v.nx!,v.ny!,v.nz!);uv.push(v.x/5,v.z/5);}}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const welded=mergeVertices(geometry,1e-5),wp=welded.attributes.position,wi=welded.index!,valid:number[]=[];
  for(let i=0;i<wi.count;i+=3){const a=wi.getX(i),b=wi.getX(i+1),c=wi.getX(i+2),area=(wp.getZ(b)-wp.getZ(a))*(wp.getX(c)-wp.getX(a))-(wp.getX(b)-wp.getX(a))*(wp.getZ(c)-wp.getZ(a));if(area>1e-7)valid.push(a,b,c);}
  welded.setIndex(valid);object.geometry=welded;object.geometry.computeBoundingSphere();geometry.dispose();original.dispose();
 }
}
