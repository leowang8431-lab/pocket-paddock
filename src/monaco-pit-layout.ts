import * as THREE from 'three';
import {asphaltTexture} from './monza-details';

interface Station {point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3;distance:number;}
interface Host {samples:readonly Station[];corners:readonly {point:THREE.Vector3;distance:number}[];length:number;sampleAt(d:number):Station;widthAt(d:number):number;}
export interface MonacoPitBox {id:number;center:THREE.Vector3;front:THREE.Vector3;tangent:THREE.Vector3;width:number;depth:number;apronCenter:THREE.Vector3;apronWidth:number;}
export interface MonacoPitProfile {fastWidth:number;apronWidth:number;garageDepth:number;entryDistance:number;exitDistance:number;serviceStartZ:number;serviceEndZ:number;surfaceOffset:number;fastWidths:number[];apronWidths:number[];reference:string;}
export interface MonacoPitPlan {path:THREE.Vector3[];boxes:MonacoPitBox[];profile:MonacoPitProfile;mergeAt(x:number,z:number):boolean;}
const clamp=THREE.MathUtils.clamp;
const pointSegment=(x:number,z:number,a:THREE.Vector3,b:THREE.Vector3)=>{const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);};

/** A widened miniature service corridor inside the unchanged geographic race
 * loop. FIA's entry branch precedes La Rascasse; the exit bypasses T1. */
export function createMonacoPitPlan(host:Host):MonacoPitPlan {
 const fastWidth=6,apronWidth=3.5,garageDepth=3.3,entryDistance=host.corners[16].distance+6,exitDistance=host.corners[0].distance+20;
 const entry=host.sampleAt(entryDistance),exit=host.sampleAt(exitDistance);
 // These stations follow the free-space middle of the island instead of
 // reproducing the adjacent Piscine chicanes as extra pit-lane hairpins.
 const approach:readonly (readonly [number,number])[]=[[140,-76.98],[136,-79.68],[132,-83.19],[128,-86.10],[124,-88.61],[120,-91.13],[116,-92.86],[112,-94.33],[108,-95.74],[104,-96.90],[100,-97.25],[96,-97.57],[92,-96.0]];
 const anchors=[entry.point.clone(),entry.point.clone().addScaledVector(entry.tangent,4),new THREE.Vector3(-71,1.2,146),...approach.map(([z,x])=>new THREE.Vector3(x,1.2,z)),new THREE.Vector3(-95,1.2,90),new THREE.Vector3(-94.62,1.2,88)];
 for(let z=86;z>=54;z-=2)anchors.push(new THREE.Vector3(-100.1+(z-57)*.19,1.2,z));
 for(const [z,x]of [[52,-102.0],[50,-104.6],[48,-106.8],[44,-107.64],[40,-107.92],[36,-107.89],[32,-107.78],[28,-107.57],[24,-107.25],[20,-106.76],[16,-105.95],[12,-104.87],[8,-103.37],[4,-102.10],[0,-100.91]])anchors.push(new THREE.Vector3(x,1.2,z));
 anchors.push(new THREE.Vector3(-99.5,1.2,-7),exit.point.clone().addScaledVector(exit.tangent,-6),exit.point.clone());
 const curve=new THREE.CatmullRomCurve3(anchors,false,'centripetal');curve.arcLengthDivisions=4000;
 const path=curve.getSpacedPoints(230),profile:MonacoPitProfile={fastWidth,apronWidth,garageDepth,entryDistance,exitDistance,serviceStartZ:54,serviceEndZ:90,surfaceOffset:.018,fastWidths:path.map(()=>fastWidth),apronWidths:[],reference:'https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_race_directors_event_notes_-_circuit_map_pit_lane_map_ers_battery_containment_area_red_zones.pdf'};
 // The work apron is an adjacent west-side strip and tapers before/after the
 // eight garage fronts. It never forms a second plane under the fast lane.
 const smooth=(a:number,b:number,z:number)=>{const t=clamp((z-a)/(b-a),0,1);return t*t*(3-2*t);};
 // A quarter-unit island-side shift gives the larger garages genuine depth
 // without narrowing either carriageway or changing the racing centreline.
 for(const p of path)p.x+=.25*smooth(50,54,p.z)*(1-smooth(92,98,p.z));
 profile.apronWidths=path.map(p=>apronWidth*smooth(50,54,p.z)*(1-smooth(90,94,p.z)));
 const atZ=(z:number)=>{for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1];if((a.z-z)*(b.z-z)>0||a.z<b.z)continue;const t=(z-a.z)/(b.z-a.z),point=a.clone().lerp(b,t),tangent=b.clone().sub(a).setY(0).normalize(),right=new THREE.Vector3(tangent.z,0,-tangent.x);return{point,tangent,right};}throw Error('Garage station is outside the Monaco pit lane.');};
 const boxes:MonacoPitBox[]=[];
 const garageAxis=atZ(80);
 for(let i=0;i<8;i++){const s=atZ(85.1-i*4.0),front=garageAxis.right.clone().negate(),center=s.point.clone().addScaledVector(garageAxis.right,fastWidth/2+apronWidth+garageDepth/2),apronCenter=s.point.clone().addScaledVector(garageAxis.right,fastWidth/2+apronWidth/2);center.y+=profile.surfaceOffset;apronCenter.y+=profile.surfaceOffset;boxes.push({id:i+1,center,front,tangent:garageAxis.tangent.clone(),width:4.05,depth:garageDepth,apronCenter,apronWidth});}
 const mergeAt=(x:number,z:number)=>{for(let i=1;i<path.length;i++){if(i>31&&i<path.length-27)continue;if(pointSegment(x,z,path[i-1],path[i])<fastWidth/2+.32)return true;}return false;};
 return{path,boxes,profile,mergeAt};
}

type V={x:number;y:number;z:number;u:number;v:number};
type Triangle={p:V[];minX:number;maxX:number;minZ:number;maxZ:number};
const area=(poly:readonly V[])=>poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p.x*q.z-p.z*q.x;},0)/2;
const side=(a:V,b:V,p:V)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const interpolate=(a:V,b:V,t:number):V=>({x:THREE.MathUtils.lerp(a.x,b.x,t),y:THREE.MathUtils.lerp(a.y,b.y,t),z:THREE.MathUtils.lerp(a.z,b.z,t),u:THREE.MathUtils.lerp(a.u,b.u,t),v:THREE.MathUtils.lerp(a.v,b.v,t)});
function clipHalf(poly:readonly V[],a:V,b:V,keepInside:boolean){
 const out:V[]=[];
 for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],sp=side(a,b,p),sq=side(a,b,q),ip=keepInside?sp>=-1e-9:sp<=1e-9,iq=keepInside?sq>=-1e-9:sq<=1e-9;if(ip)out.push(p);if(ip!==iq)out.push(interpolate(p,q,sp/(sp-sq)));}
 return out;
}
function subtractTriangle(poly:V[],triangle:V[]){let remainder=poly;const out:V[][]=[];for(let i=0;i<3&&remainder.length>=3;i++){const a=triangle[i],b=triangle[(i+1)%3],piece=clipHalf(remainder,a,b,false);if(piece.length>=3&&Math.abs(area(piece))>1e-8)out.push(piece);remainder=clipHalf(remainder,a,b,true);}return out;}

/** Subtracting the race footprint can leave the outside half of an end cap
 * on the opposite side of the track. Keep only the actual connected service
 * carriageway and compact its attributes, so neither rendering nor GLB export
 * retains those isolated entry/exit scraps or their unused vertices. */
function connectedCarriageway(source:THREE.BufferGeometry){
 const position=source.attributes.position,uv=source.attributes.uv,index=source.index!,count=index.count/3,parent=Array.from({length:count},(_,i)=>i),welded=new Map<string,number>();
 const find=(i:number):number=>parent[i]===i?i:parent[i]=find(parent[i]);
 for(let triangle=0;triangle<count;triangle++)for(let corner=0;corner<3;corner++){
  const vertex=index.getX(triangle*3+corner),key=`${position.getX(vertex).toFixed(4)},${position.getZ(vertex).toFixed(4)}`,other=welded.get(key);
  if(other===undefined)welded.set(key,triangle);else parent[find(triangle)]=find(other);
 }
 const areas=new Map<number,number>();
 for(let triangle=0;triangle<count;triangle++){
  const a=index.getX(triangle*3),b=index.getX(triangle*3+1),c=index.getX(triangle*3+2),surface=Math.abs((position.getX(b)-position.getX(a))*(position.getZ(c)-position.getZ(a))-(position.getZ(b)-position.getZ(a))*(position.getX(c)-position.getX(a)))/2,component=find(triangle);
  areas.set(component,(areas.get(component)??0)+surface);
 }
 if(areas.size<2)return source;
 const largest=[...areas.entries()].sort((a,b)=>b[1]-a[1])[0][0],vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(let triangle=0;triangle<count;triangle++){if(find(triangle)!==largest)continue;for(let corner=0;corner<3;corner++){const vertex=index.getX(triangle*3+corner);indices.push(vertices.length/3);vertices.push(position.getX(vertex),position.getY(vertex),position.getZ(vertex));uvs.push(uv.getX(vertex),uv.getY(vertex));}}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.userData.removedDisconnectedCaps=areas.size-1;source.dispose();return geometry;
}

/** Adjacent pit surfaces are geometrically cut against race asphalt in plan.
 * This eliminates overlapping ground and z-fighting instead of hiding it with
 * polygonOffset or a large artificial vertical step. */
export function buildMonacoPitSurfaces(host:Host,plan:MonacoPitPlan){
 const group=new THREE.Group();group.name='monaco-pit-road-system';
 const race:Triangle[]=[];
 for(let i=0;i<host.samples.length;i++){const a=host.samples[i],b=host.samples[(i+1)%host.samples.length],points:V[]=[];for(const s of [a,b])for(const sign of [-1,1]){const p=s.point.clone().addScaledVector(s.right,host.widthAt(s.distance)/2*sign);points.push({x:p.x,y:p.y,z:p.z,u:0,v:0});}for(const ids of [[0,2,1],[1,2,3]]){const p=ids.map(j=>points[j]);if(area(p)<0)p.reverse();race.push({p,minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minZ:Math.min(...p.map(v=>v.z)),maxZ:Math.max(...p.map(v=>v.z))});}}
 const station=(i:number)=>{const p=plan.path[i],a=plan.path[Math.max(0,i-1)],b=plan.path[Math.min(plan.path.length-1,i+1)],right=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();return{p,right};};
 function ribbon(name:string,from:(i:number)=>number,to:(i:number)=>number,color:number){
  const vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let i=0;i<plan.path.length-1;i++){
   const quad:V[]=[];for(const j of [i,i+1]){const {p,right}=station(j);for(const offset of [from(j),to(j)]){const point=p.clone().addScaledVector(right,offset);quad.push({x:point.x,y:point.y+plan.profile.surfaceOffset,z:point.z,u:offset/6,v:j/8});}}
   for(const ids of [[0,1,2],[1,3,2]]){
    let fragments=[ids.map(j=>quad[j])];const q=fragments[0],minX=Math.min(...q.map(v=>v.x)),maxX=Math.max(...q.map(v=>v.x)),minZ=Math.min(...q.map(v=>v.z)),maxZ=Math.max(...q.map(v=>v.z));
    for(const triangle of race){if(maxX<triangle.minX||minX>triangle.maxX||maxZ<triangle.minZ||minZ>triangle.maxZ)continue;fragments=fragments.flatMap(poly=>subtractTriangle(poly,triangle.p));if(!fragments.length)break;}
    for(const poly of fragments){if(area(poly)>0)poly.reverse();for(let k=1;k<poly.length-1;k++){if(Math.abs(area([poly[0],poly[k],poly[k+1]]))<1e-8)continue;const base=vertices.length/3;for(const v of [poly[0],poly[k],poly[k+1]]){vertices.push(v.x,v.y,v.z);uvs.push(v.u,v.v);}indices.push(base,base+1,base+2);}}
   }
  }
  let geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();if(name==='monaco-separate-pit-lane')geometry=connectedCarriageway(geometry);
  const material=new THREE.MeshStandardMaterial({color,roughness:.91});if(name==='monaco-separate-pit-lane'){const texture=asphaltTexture();if(texture)material.map=texture;}
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;group.add(mesh);return mesh;
 }
 ribbon('monaco-separate-pit-lane',()=>-plan.profile.fastWidth/2,()=>plan.profile.fastWidth/2,0x3c5056);
 ribbon('monaco-pit-colour-divider',()=>plan.profile.fastWidth/2,i=>plan.profile.fastWidth/2+Math.min(.5,plan.profile.apronWidths[i]),0x4e9794);
 ribbon('monaco-pit-working-apron',i=>plan.profile.fastWidth/2+Math.min(.5,plan.profile.apronWidths[i]),i=>plan.profile.fastWidth/2+plan.profile.apronWidths[i],0xcbbd9d);
 // Paint sits a few millimetres above its own carriageway; no copied floor.
 const paintMaterial=new THREE.MeshBasicMaterial({color:0xf2e7bf}),lineParts:number[]=[];
 for(let i=1;i<plan.path.length-2;i++){const a=station(i),b=station(i+1);if(a.p.z<48||a.p.z>90)continue;const start=lineParts.length/3;for(const s of [a,b])for(const o of [plan.profile.fastWidth/2-.035,plan.profile.fastWidth/2+.035]){const p=s.p.clone().addScaledVector(s.right,o);lineParts.push(p.x,p.y+plan.profile.surfaceOffset+.018,p.z);}void start;}
 if(lineParts.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lineParts,3));const indices:number[]=[];for(let i=0;i<lineParts.length/3;i+=4)indices.push(i,i+2,i+1,i+1,i+2,i+3);geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,paintMaterial);mesh.name='monaco-pit-fast-apron-separator';group.add(mesh);}
 group.userData={fastWidth:plan.profile.fastWidth,apronWidth:plan.profile.apronWidth,surfacePolicy:'Disjoint adjacent ribbons, race footprint subtracted in XZ. No overlapping floor planes or polygonOffset.'};
 return group;
}
