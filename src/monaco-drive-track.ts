import * as THREE from 'three';
import {createMonacoLayout,type MonacoLayout} from './monaco-layout';

/** The review map uses one unit per 3.2 metres. Gameplay restores metre-sized
 * street geometry around the existing, unchanged vehicle and pit-service rig. */
export const MONACO_GAME_SCALE=3.2;
export interface MonacoBarrierSegment {ax:number;az:number;bx:number;bz:number;radius:number;bottom:number;top:number;}
export interface MonacoDriveSample {point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3;distance:number;index:number;t:number;}
interface FloorTriangle {a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3;minX:number;maxX:number;minZ:number;maxZ:number;}
export const monacoSteeringAngleForSpeed=(speed:number)=>.56/(1+Math.abs(speed)*.018);

export class MonacoDrivingTrack {
 readonly layout:MonacoLayout=createMonacoLayout();
 readonly scale=MONACO_GAME_SCALE;
 readonly group=this.layout.group;
 readonly length=this.layout.length*this.scale;
 readonly width=6.4*this.scale;
 readonly samples:MonacoDriveSample[]=this.layout.samples.map(s=>({point:s.point.clone().multiplyScalar(this.scale),tangent:s.tangent.clone().setY(0).normalize(),right:s.right.clone(),distance:s.distance*this.scale,index:s.index,t:s.index/this.layout.samples.length}));
 readonly pitPath=this.layout.pitPath.map(p=>p.clone().add(new THREE.Vector3(0,this.layout.pitProfile.surfaceOffset,0)).multiplyScalar(this.scale));
 readonly pitBoxes=this.layout.pitBoxes.map(b=>({...b,center:b.center.clone().multiplyScalar(this.scale),front:b.front.clone(),tangent:b.tangent.clone(),width:b.width*this.scale,depth:b.depth*this.scale,apronCenter:b.apronCenter.clone().multiplyScalar(this.scale),apronWidth:b.apronWidth*this.scale}));
 readonly pitProfile={...this.layout.pitProfile,fastWidth:this.layout.pitProfile.fastWidth*this.scale,apronWidth:this.layout.pitProfile.apronWidth*this.scale,garageDepth:this.layout.pitProfile.garageDepth*this.scale,entryDistance:this.layout.pitProfile.entryDistance*this.scale,exitDistance:this.layout.pitProfile.exitDistance*this.scale,serviceStartZ:this.layout.pitProfile.serviceStartZ*this.scale,serviceEndZ:this.layout.pitProfile.serviceEndZ*this.scale,surfaceOffset:this.layout.pitProfile.surfaceOffset*this.scale};
 readonly corners=this.layout.corners.map(c=>({name:`${c.name} · ${c.zh}`,distance:c.distance*this.scale}));
 readonly barriers:MonacoBarrierSegment[]=[];
 private readonly barrierCells=new Map<string,MonacoBarrierSegment[]>();
 private readonly cellSize=16;
 private readonly roadPosition=(this.layout.group.getObjectByName('monaco-asphalt-ribbon') as THREE.Mesh).geometry.attributes.position;
 private readonly floorCells=new Map<string,FloorTriangle[]>();
 private pitApronWidths=this.layout.pitProfile.apronWidths.map(w=>w*this.scale);
 constructor(){
  this.preparePlayablePitRamp();
  this.group.scale.setScalar(this.scale);this.group.updateMatrixWorld(true);
  this.group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.name==='monaco-asphalt-ribbon'||o.name==='monaco-separate-pit-lane'){for(const material of Array.isArray(o.material)?o.material:[o.material])material.userData.weatherSurface='road';}});
  const walls=this.group.getObjectByName('monaco-race-barriers')!;
  // Recover each actual rendered BoxGeometry from the static material batch.
  // Its four XZ corners retain the original wall rotation and every pit gap.
  walls.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const p=o.geometry.attributes.position;
   for(let i=0;i<p.count;i+=36){const unique=new Map<string,THREE.Vector3>();let bottom=Infinity,top=-Infinity;
    for(let j=i;j<Math.min(i+36,p.count);j++){const v=new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld);bottom=Math.min(bottom,v.y);top=Math.max(top,v.y);unique.set(`${v.x.toFixed(4)},${v.z.toFixed(4)}`,v);}
    const corners=[...unique.values()];if(corners.length!==4)throw Error('Monaco wall batch no longer contains independent boxes');
    const cx=corners.reduce((s,v)=>s+v.x,0)/4,cz=corners.reduce((s,v)=>s+v.z,0)/4;corners.sort((a,b)=>Math.atan2(a.z-cz,a.x-cx)-Math.atan2(b.z-cz,b.x-cx));
    const edges=corners.map((a,j)=>{const b=corners[(j+1)%4];return{dx:b.x-a.x,dz:b.z-a.z,length:Math.hypot(b.x-a.x,b.z-a.z)};}).sort((a,b)=>b.length-a.length),axis=edges[0],radius=edges.at(-1)!.length/2;
    const wall={ax:cx-axis.dx/2,az:cz-axis.dz/2,bx:cx+axis.dx/2,bz:cz+axis.dz/2,radius,bottom,top};this.barriers.push(wall);
    for(let x=Math.floor((Math.min(wall.ax,wall.bx)-2)/this.cellSize);x<=Math.floor((Math.max(wall.ax,wall.bx)+2)/this.cellSize);x++)for(let z=Math.floor((Math.min(wall.az,wall.bz)-2)/this.cellSize);z<=Math.floor((Math.max(wall.az,wall.bz)+2)/this.cellSize);z++){const key=`${x},${z}`,cell=this.barrierCells.get(key);if(cell)cell.push(wall);else this.barrierCells.set(key,[wall]);}
   }
  });
  this.group.userData.monacoDriving={scale:this.scale,realLength:3337,geometry:'Uniformly scaled approved Monaco map',roadWidths:'Shared with rendered asphalt',barrierCollision:'Actual rendered wall boxes, with original pit openings',steering:'Monaco-specific low-speed rack; vehicle dimensions unchanged'};
 }
 sampleAt(distance:number):MonacoDriveSample{const s=this.layout.sampleAt(distance/this.scale);return{point:s.point.multiplyScalar(this.scale),tangent:s.tangent.setY(0).normalize(),right:s.right,distance:s.distance*this.scale,index:s.index,t:s.distance/this.layout.length};}
 widthAt(distance:number){return this.layout.widthAt(distance/this.scale)*this.scale;}
 private roadProjection(x:number,z:number){let near=0,best=Infinity;for(let i=0;i<this.samples.length;i++){const p=this.samples[i].point,d=(p.x-x)**2+(p.z-z)**2;if(d<best){best=d;near=i;}}
  let result={index:near,height:this.samples[near].point.y,gap:Math.sqrt(best),distance:this.samples[near].distance,x:this.samples[near].point.x,z:this.samples[near].point.z};best=Infinity;
  for(let offset=-2;offset<=1;offset++){const a=this.samples[(near+offset+this.samples.length)%this.samples.length],b=this.samples[(near+offset+1+this.samples.length)%this.samples.length],dx=b.point.x-a.point.x,dz=b.point.z-a.point.z,t=THREE.MathUtils.clamp(((x-a.point.x)*dx+(z-a.point.z)*dz)/(dx*dx+dz*dz),0,1),px=a.point.x+t*dx,pz=a.point.z+t*dz,d=(x-px)**2+(z-pz)**2;if(d<best){best=d;result={index:near,height:THREE.MathUtils.lerp(a.point.y,b.point.y,t),gap:Math.sqrt(d),distance:(a.distance+t*this.length/this.samples.length)%this.length,x:px,z:pz};}}
  return result;
 }
 /** Runtime-only ramp: the review model's horizontal footprint is retained,
  * while its cut boundary meets the actual uphill main-road triangles. */
 private preparePlayablePitRamp(){
  const original=this.pitPath.map(p=>p.clone()),originalWidths=this.pitApronWidths.slice(),heightCache=new Map<string,number>(),serviceY=this.layout.pitProfile.surfaceOffset*this.scale+1.2*this.scale;
  const smooth=(value:number)=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*t*(10+t*(-15+6*t));};
  const rampHeight=(x:number,z:number,base:number)=>{const key=`${x.toFixed(5)},${z.toFixed(5)},${base.toFixed(5)}`,cached=heightCache.get(key);if(cached!==undefined)return cached;const road=this.roadProjection(x,z),actual=this.roadHeightAt(x,z,road.index,NaN);let y=base;
   if(Number.isFinite(actual))y=actual;
   else if(z<40){const floor=Math.max(serviceY,base),edge=Math.max(0,road.gap-this.widthAt(road.distance)/2),blend=smooth(1-edge/16)*smooth((40-z)/24);y=THREE.MathUtils.lerp(floor,road.height,blend);}
   heightCache.set(key,y);return y;
  };
  const names=['monaco-separate-pit-lane','monaco-pit-colour-divider','monaco-pit-working-apron'];
  for(const name of names){const mesh=this.group.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry>,source=mesh.geometry,pos=source.attributes.position,uv=source.attributes.uv,index=source.index,vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
   type Vertex={p:THREE.Vector3;u:number;v:number};
   const read=(at:number):Vertex=>({p:new THREE.Vector3().fromBufferAttribute(pos,at),u:uv?.getX(at)??0,v:uv?.getY(at)??0});
   const midpoint=(a:Vertex,b:Vertex):Vertex=>({p:a.p.clone().lerp(b.p,.5),u:(a.u+b.u)/2,v:(a.v+b.v)/2});
   const emit=(a:Vertex,b:Vertex,c:Vertex,level:number)=>{if(level>0){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);emit(a,ab,ca,level-1);emit(ab,b,bc,level-1);emit(ca,bc,c,level-1);emit(ab,bc,ca,level-1);return;}const first=vertices.length/3;for(const v of [a,b,c]){const x=v.p.x*this.scale,z=v.p.z*this.scale,y=rampHeight(x,z,v.p.y*this.scale)/this.scale;vertices.push(v.p.x,y,v.p.z);uvs.push(v.u,v.v);}indices.push(first,first+1,first+2);};
   const count=index?.count??pos.count;for(let i=0;i<count;i+=3){const a=read(index?.getX(i)??i),b=read(index?.getX(i+1)??i+1),c=read(index?.getX(i+2)??i+2),exit=Math.min(a.p.z,b.p.z,c.p.z)*this.scale<40;emit(a,b,c,exit?4:0);}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();mesh.geometry=geometry;source.dispose();
   const p=geometry.attributes.position;for(let i=0;i<indices.length;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,indices[i]).multiplyScalar(this.scale),b=new THREE.Vector3().fromBufferAttribute(p,indices[i+1]).multiplyScalar(this.scale),c=new THREE.Vector3().fromBufferAttribute(p,indices[i+2]).multiplyScalar(this.scale),triangle={a,b,c,minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minZ:Math.min(a.z,b.z,c.z),maxZ:Math.max(a.z,b.z,c.z)};for(let x=Math.floor(triangle.minX/this.cellSize);x<=Math.floor(triangle.maxX/this.cellSize);x++)for(let z=Math.floor(triangle.minZ/this.cellSize);z<=Math.floor(triangle.maxZ/this.cellSize);z++){const key=`${x},${z}`,cell=this.floorCells.get(key);if(cell)cell.push(triangle);else this.floorCells.set(key,[triangle]);}}
  }
  this.pitPath.length=0;this.pitApronWidths=[];
  for(let i=0;i<original.length-1;i++){const a=original[i],b=original[i+1],steps=Math.min(a.z,b.z)<40?Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.4)):1;for(let j=0;j<steps;j++){const t=j/steps,p=a.clone().lerp(b,t),road=this.roadProjection(p.x,p.z),main=this.roadHeightAt(p.x,p.z,road.index,NaN);p.y=Number.isFinite(main)?main:this.pitSurfaceHeightAt(p.x,p.z,rampHeight(p.x,p.z,p.y));this.pitPath.push(p);this.pitApronWidths.push(THREE.MathUtils.lerp(originalWidths[i],originalWidths[i+1],t));}}
  const last=original.at(-1)!,road=this.roadProjection(last.x,last.z);last.y=this.roadHeightAt(last.x,last.z,road.index,last.y);this.pitPath.push(last);this.pitApronWidths.push(originalWidths.at(-1)!);
 }
 pitSurfaceHeightAt(x:number,z:number,fallback:number){for(const t of this.floorCells.get(`${Math.floor(x/this.cellSize)},${Math.floor(z/this.cellSize)}`)??[]){if(x<t.minX-1e-5||x>t.maxX+1e-5||z<t.minZ-1e-5||z>t.maxZ+1e-5)continue;const {a,b,c}=t,den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z),u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den,w=1-u-v;if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return u*a.y+v*b.y+w*c.y;}return fallback;}
 roadHeightAt(x:number,z:number,index:number,fallback:number){
  const pos=this.roadPosition,count=this.samples.length;
  for(let offset=-2;offset<=2;offset++){const at=((index+offset+count)%count)*2;
   for(const ids of [[at,at+2,at+1],[at+1,at+2,at+3]]){const [a,b,c]=ids,ax=pos.getX(a)*this.scale,az=pos.getZ(a)*this.scale,bx=pos.getX(b)*this.scale,bz=pos.getZ(b)*this.scale,cx=pos.getX(c)*this.scale,cz=pos.getZ(c)*this.scale,den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return(u*pos.getY(a)+v*pos.getY(b)+w*pos.getY(c))*this.scale;}
  }return fallback;
 }
 barriersAt(x:number,z:number){return this.barrierCells.get(`${Math.floor(x/this.cellSize)},${Math.floor(z/this.cellSize)}`)??[];}
 rebuildBarrierIndex(){this.barrierCells.clear();for(const wall of this.barriers)for(let x=Math.floor((Math.min(wall.ax,wall.bx)-2)/this.cellSize);x<=Math.floor((Math.max(wall.ax,wall.bx)+2)/this.cellSize);x++)for(let z=Math.floor((Math.min(wall.az,wall.bz)-2)/this.cellSize);z<=Math.floor((Math.max(wall.az,wall.bz)+2)/this.cellSize);z++){const key=`${x},${z}`,cell=this.barrierCells.get(key);if(cell)cell.push(wall);else this.barrierCells.set(key,[wall]);}}
 pitProjection(x:number,z:number){
  let best=Infinity,chosen={height:0,gap:Infinity,signed:0,apron:0,valid:false};
  for(let i=1;i<this.pitPath.length;i++){const a=this.pitPath[i-1],b=this.pitPath[i],dx=b.x-a.x,dz=b.z-a.z,lengthSquared=dx*dx+dz*dz,raw=((x-a.x)*dx+(z-a.z)*dz)/lengthSquared,t=THREE.MathUtils.clamp(raw,0,1),px=a.x+t*dx,pz=a.z+t*dz,gap=(x-px)**2+(z-pz)**2;
   if(gap<best){best=gap;const length=Math.sqrt(lengthSquared);chosen={height:THREE.MathUtils.lerp(a.y,b.y,t),gap:Math.sqrt(gap),signed:((x-px)*dz-(z-pz)*dx)/length,apron:THREE.MathUtils.lerp(this.pitApronWidths[i-1],this.pitApronWidths[i],t),valid:!((i===1&&raw<0)||(i===this.pitPath.length-1&&raw>1))};}
  }return chosen;
 }
 isPitLane(x:number,z:number,road:{gap:number;distance:number}){if(road.gap<=this.widthAt(road.distance)/2+.05)return false;const p=this.pitProjection(x,z),half=this.pitProfile.fastWidth/2;return p.valid&&p.signed>=-half-.02&&p.signed<=half+p.apron+.02&&p.gap<=half+p.apron+.02;}
}
