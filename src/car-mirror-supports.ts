import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

interface Triangle {a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3;component:number}
interface PaintComponent {id:number;bounds:THREE.Box3;mesh:string;vertices:Set<number>}
interface PaintSurface {triangles:Triangle[];components:PaintComponent[]}
export interface MirrorSupportAnchor {
  side:'left'|'right';bodySurface:number[];mirrorSurface:number[];
  bodyEnd:number[];mirrorEnd:number[];radius:number;
  shellMesh:string;shellVertices:number[];supportVertices:{start:number;count:number};
}
export interface MirrorSupportsSummary {count:number;addedTriangles:number;carbonMesh:string;originalVertices:number;anchors:MirrorSupportAnchor[]}

/** Read the supplied paint surface without changing its buffers or transforms.
 * A welded connectivity pass separates the small mirror shells from the body. */
function paintSurface(model:THREE.Group):PaintSurface {
  const triangles:Triangle[]=[],components:PaintSurface['components']=[];
  const inverse=new THREE.Matrix4().copy(model.matrixWorld).invert();let nextId=0;
  model.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material)||object.material.name!=='paint')return;
    const positions=object.geometry.getAttribute('position'),index=object.geometry.index;
    if(!positions)return;
    const matrix=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld),vertices:THREE.Vector3[]=[],ids:number[]=[],parents:number[]=[],welded=new Map<string,number>();
    for(let i=0;i<positions.count;i++){
      const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix),key=point.toArray().map(value=>Math.round(value*1e6)).join(',');
      vertices.push(point);
      if(!welded.has(key)){welded.set(key,parents.length);parents.push(parents.length);}
      ids.push(welded.get(key)!);
    }
    const find=(id:number):number=>{while(parents[id]!==id){parents[id]=parents[parents[id]];id=parents[id];}return id;};
    const count=index?.count??positions.count,vertex=(offset:number)=>index?index.getX(offset):offset;
    for(let i=0;i<count;i+=3){const root=find(ids[vertex(i)]);parents[find(ids[vertex(i+1)])]=root;parents[find(ids[vertex(i+2)])]=root;}
    const boxes=new Map<number,PaintComponent>();
    for(let i=0;i<count;i+=3){
      const ai=vertex(i),bi=vertex(i+1),ci=vertex(i+2),root=find(ids[ai]);
      if(!boxes.has(root))boxes.set(root,{id:nextId++,bounds:new THREE.Box3(),mesh:object.name,vertices:new Set()});
      const component=boxes.get(root)!,a=vertices[ai],b=vertices[bi],c=vertices[ci];
      component.vertices.add(ai).add(bi).add(ci);
      component.bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c);triangles.push({a,b,c,component:component.id});
    }
    components.push(...boxes.values());
  });
  return{triangles,components};
}

/** Extend the stationary mirror mounts into the actual body surface. Shells,
 * their placement and every original triangle remain intact. The new stalks
 * share the existing carbon mesh/material, so player and AI need no new draw.
 * Call after prepareFinish() and createDrsWing(), which needs its indexed
 * source geometry before this additive merge expands the carbon vertices. */
export function attachMirrorSupports(model:THREE.Group):MirrorSupportsSummary {
  const existing=model.userData.mirrorSupports as MirrorSupportsSummary|undefined;
  if(existing)return existing;
  const summary:MirrorSupportsSummary={count:0,addedTriangles:0,carbonMesh:'body-materialcarbon',originalVertices:0,anchors:[]};
  const carbon=model.getObjectByName('body-materialcarbon');
  if(!(carbon instanceof THREE.Mesh)||Array.isArray(carbon.material)||carbon.material.name!=='carbon')return summary;
  model.updateWorldMatrix(true,true);
  const surface=paintSurface(model),parts:THREE.BufferGeometry[]=[],ray=new THREE.Ray(),hit=new THREE.Vector3();
  const rootToCarbon=new THREE.Matrix4().copy(carbon.matrixWorld).invert().multiply(model.matrixWorld);
  for(const side of [-1,1] as const){
    // The retained source uses +Z forward. This window identifies only the
    // little paint shells alongside the cockpit, never wings or sidepods.
    const shells=surface.components.filter(component=>{
      const center=component.bounds.getCenter(new THREE.Vector3()),size=component.bounds.getSize(new THREE.Vector3());
      return Math.sign(center.x)===side&&Math.abs(center.x)>.25&&Math.abs(center.x)<.55&&center.y>.55&&center.y<.8&&center.z>.15&&center.z<.6&&size.x>.05&&size.x<.18&&size.y>.04&&size.y<.16&&size.z>.02&&size.z<.15;
    }).sort((a,b)=>a.bounds.getSize(new THREE.Vector3()).length()-b.bounds.getSize(new THREE.Vector3()).length());
    const shell=shells[0];if(!shell)continue;
    const center=shell.bounds.getCenter(new THREE.Vector3()),size=shell.bounds.getSize(new THREE.Vector3());
    // Enter the underside slightly inboard, where it overlaps the retained
    // carbon mirror backing. Derive the precise contact from shell triangles.
    ray.set(new THREE.Vector3(center.x-side*size.x*.27,shell.bounds.min.y-.08,center.z-.005),new THREE.Vector3(0,1,0));
    let mirrorSurface:THREE.Vector3|undefined;
    for(const triangle of surface.triangles){
      if(triangle.component!==shell.id||!ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit))continue;
      if(!mirrorSurface||hit.y<mirrorSurface.y)mirrorSurface=hit.clone();
    }
    if(!mirrorSurface)continue;
    // Ray down at the inboard foot to the real upper body surface. Excluding
    // both mirror components prevents mounting to a mirror; the fixed cockpit
    // Z and positive height range exclude the front wing and the undertray.
    const footX=side*(Math.abs(center.x)-size.x*.74),footZ=center.z-.015;
    ray.set(new THREE.Vector3(footX,shell.bounds.min.y-.012,footZ),new THREE.Vector3(0,-1,0));
    let bodySurface:THREE.Vector3|undefined;
    for(const triangle of surface.triangles){
      if(surface.components.some(component=>component.id===triangle.component&&shells.includes(component)))continue;
      if(!ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)||hit.y<.25||hit.y>shell.bounds.min.y-.018)continue;
      if(!bodySurface||hit.y>bodySurface.y)bodySurface=hit.clone();
    }
    if(!bodySurface)continue;
    const direction=mirrorSurface.clone().sub(bodySurface).normalize(),bodyEnd=bodySurface.clone().addScaledVector(direction,-.012),mirrorEnd=mirrorSurface.clone().addScaledVector(direction,.012),radius=.012;
    const cylinder=new THREE.CylinderGeometry(radius,radius,bodyEnd.distanceTo(mirrorEnd),8,1,false),geometry=cylinder.toNonIndexed();cylinder.dispose();
    const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
    geometry.applyQuaternion(quaternion);geometry.translate(...bodyEnd.clone().add(mirrorEnd).multiplyScalar(.5).toArray());geometry.applyMatrix4(rootToCarbon);
    // Use the same triplanar-style local UV projection as prepareFinish's
    // carbon normal-map finish; never regenerate the original carbon UVs.
    const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),ax=Math.abs(normals.getX(i)),ay=Math.abs(normals.getY(i)),az=Math.abs(normals.getZ(i));
      const [u,v]=ay>=ax&&ay>=az?[x,z]:ax>=az?[z,y]:[x,y];uv.setXY(i,u*7,v*7);
    }
    parts.push(geometry);summary.anchors.push({side:side<0?'left':'right',bodySurface:bodySurface.toArray(),mirrorSurface:mirrorSurface.toArray(),bodyEnd:bodyEnd.toArray(),mirrorEnd:mirrorEnd.toArray(),radius,shellMesh:shell.mesh,shellVertices:[...shell.vertices].sort((a,b)=>a-b),supportVertices:{start:0,count:geometry.getAttribute('position').count}});
  }
  if(parts.length){
    const original=carbon.geometry,base=original.index?original.toNonIndexed():original.clone();
    // Current shared GLB has position/normal/uv only. Refuse an unexpected
    // format safely rather than replacing or dropping its custom attributes.
    if(Object.keys(base.attributes).some(name=>!['position','normal','uv'].includes(name))){base.dispose();parts.forEach(part=>part.dispose());return{...summary,anchors:[]};}
    const merged=mergeGeometries([base,...parts],false);
    const originalVertices=base.getAttribute('position').count;
    base.dispose();
    if(merged){
      summary.count=parts.length;summary.addedTriangles=parts.reduce((sum,part)=>sum+part.getAttribute('position').count/3,0);
      summary.originalVertices=originalVertices;
      let offset=summary.originalVertices;for(const anchor of summary.anchors){anchor.supportVertices.start=offset;offset+=anchor.supportVertices.count;}
      merged.computeBoundingBox();merged.computeBoundingSphere();carbon.geometry=merged;original.dispose();model.userData.mirrorSupports=summary;
    }
    parts.forEach(part=>part.dispose());
  }
  return summary;
}
