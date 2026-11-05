import * as THREE from 'three';

export type HistoricRibbonPoint=(sample:number,u:number)=>THREE.Vector3;
export interface HistoricRibbonOptions {
  surfacePoint:HistoricRibbonPoint;
  sampleCount:number;first:number;last:number;
  u0?:number;u1?:number;rows?:number;lift?:number;
  thickness?:number|((sample:number)=>number);
  normalAt?:(sample:number,u:number)=>THREE.Vector3;
}

/** Surface height on the actual tessellated deck, rather than its ideal
 * parabola. Decorative strips follow this so they never sink into a chord. */
export function sampledHistoricRibbonPoint(surfacePoint:HistoricRibbonPoint,sample:number,u:number,rows=6):THREE.Vector3 {
  const q=THREE.MathUtils.clamp(u,0,1)*rows,lo=Math.min(rows-1,Math.floor(q)),fraction=q-lo;
  return surfacePoint(sample,lo/rows).lerp(surfacePoint(sample,(lo+1)/rows),fraction);
}

/** Neighbours belong to the whole road, not an individual render chunk.
 * Adjacent pieces therefore produce identical normals at a shared seam. */
export function historicRibbonNormal(surfacePoint:HistoricRibbonPoint,sampleCount:number,sample:number,u:number):THREE.Vector3 {
  const before=Math.max(0,sample-1),after=Math.min(sampleCount-1,sample+1);
  const along=surfacePoint(after,u).sub(surfacePoint(before,u));
  const across=surfacePoint(sample,Math.min(1,u+.001)).sub(surfacePoint(sample,Math.max(0,u-.001)));
  const normal=along.cross(across);
  if(normal.lengthSq()<1e-16)return new THREE.Vector3(0,1,0);
  if(normal.y<0)normal.negate();
  return normal.normalize();
}

/** Top, underside and vertical walls have separate vertex sets. In particular,
 * caps cannot tilt the upper normals and paint dark rectangles across a road. */
export function createHistoricRibbonGeometry(options:HistoricRibbonOptions):THREE.BufferGeometry {
  const {surfacePoint,sampleCount,first,last}=options,u0=options.u0??0,u1=options.u1??1,rows=options.rows??6,lift=options.lift??0;
  const thickness=options.thickness??0,solid=typeof thickness==='function'||thickness>0;
  const positions:number[]=[],indices:number[]=[],row=rows+1,layerSize=(last-first+1)*row;
  for(let layer=0;layer<(solid?2:1);layer++)for(let i=first;i<=last;i++)for(let j=0;j<=rows;j++){
    const p=surfacePoint(i,THREE.MathUtils.lerp(u0,u1,j/rows)),depth=typeof thickness==='function'?thickness(i):thickness;
    positions.push(p.x,p.y+lift-layer*depth,p.z);
  }
  for(let i=0;i<last-first;i++)for(let j=0;j<rows;j++){
    const a=i*row+j,b=a+1,c=a+row,d=c+1;indices.push(a,c,b,b,c,d);
    if(solid)indices.push(a+layerSize,b+layerSize,c+layerSize,b+layerSize,d+layerSize,c+layerSize);
  }
  const wall=(a:number,b:number,c:number,d:number,reverse=false)=>{
    const base=positions.length/3;
    for(const index of [a,b,c,d])positions.push(positions[index*3],positions[index*3+1],positions[index*3+2]);
    if(reverse)indices.push(base,base+1,base+2,base+1,base+3,base+2);
    else indices.push(base,base+2,base+1,base+1,base+2,base+3);
  };
  if(solid){
    for(let i=0;i<last-first;i++)for(const j of [0,rows]){
      const a=i*row+j,b=a+row;wall(a,b,a+layerSize,b+layerSize,j===rows);
    }
    for(const i of [0,last-first])for(let j=0;j<rows;j++){
      const a=i*row+j,b=a+1;wall(a,b,a+layerSize,b+layerSize,i===0);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const normals=geometry.getAttribute('normal'),normalAt=options.normalAt??((i:number,u:number)=>historicRibbonNormal(surfacePoint,sampleCount,i,u));
  for(let i=first;i<=last;i++)for(let j=0;j<=rows;j++){
    const normal=normalAt(i,THREE.MathUtils.lerp(u0,u1,j/rows));normals.setXYZ((i-first)*row+j,normal.x,normal.y,normal.z);
  }
  return geometry;
}

/** Trim opaque ribbon triangles against a vertical road boundary. All vertex
 * attributes follow the same edge interpolation; normals are then normalized.
 * This keeps a real mesh seam in standard glTF instead of hiding overlap with
 * an alpha shader or a raised polygon. A fully retained mesh is returned as-is. */
export function clipHistoricRibbonGeometry(source:THREE.BufferGeometry,clipSigned:(point:THREE.Vector3)=>number):THREE.BufferGeometry {
  const names=Object.keys(source.attributes),position=source.getAttribute('position');
  if(!position?.count)return source;
  type Vertex={point:THREE.Vector3;values:Record<string,number[]>;distance:number};
  const vertices:Vertex[]=[];
  for(let i=0;i<position.count;i++){
    const point=new THREE.Vector3().fromBufferAttribute(position,i),values:Record<string,number[]>={};
    for(const name of names){const attribute=source.getAttribute(name);values[name]=Array.from({length:attribute.itemSize},(_,j)=>attribute.getComponent(i,j));}
    vertices.push({point,values,distance:clipSigned(point)});
  }
  let changed=vertices.some(vertex=>vertex.distance<0);
  const arrays=Object.fromEntries(names.map(name=>[name,[] as number[]]));
  const mix=(a:Vertex,b:Vertex,t:number):Vertex=>{
    const point=a.point.clone().lerp(b.point,t),values:Record<string,number[]>={};
    for(const name of names)values[name]=a.values[name].map((value,j)=>THREE.MathUtils.lerp(value,b.values[name][j],t));
    values.position=point.toArray();
    if(values.normal){const normal=new THREE.Vector3().fromArray(values.normal);if(normal.lengthSq()>1e-16)normal.normalize();values.normal=normal.toArray();}
    return {point,values,distance:clipSigned(point)};
  };
  const intersection=(a:Vertex,b:Vertex):Vertex=>{
    // The actual GP boundary is a curved, width-aware projection. Solve along
    // the edge instead of pretending its signed distance is globally linear.
    let lo=0,hi=1;
    for(let i=0;i<38;i++){
      const middle=(lo+hi)/2,p=a.point.clone().lerp(b.point,middle),distance=clipSigned(p);
      if((distance>=0)===(a.distance>=0))lo=middle;else hi=middle;
    }
    return mix(a,b,(lo+hi)/2);
  };
  const emit=(a:Vertex,b:Vertex,c:Vertex)=>{
    const normal=b.point.clone().sub(a.point).cross(c.point.clone().sub(a.point));
    if(normal.lengthSq()<1e-16)return;
    for(const vertex of [a,b,c])for(const name of names)arrays[name].push(...vertex.values[name]);
  };
  const probes=(triangle:Vertex[])=>{
    const [a,b,c]=triangle;
    return [mix(a,b,.5),mix(b,c,.5),mix(c,a,.5),mix(mix(a,b,.5),c,1/3)];
  };
  const clipTriangle=(triangle:Vertex[],depth=0)=>{
    const polygon:Vertex[]=[];
    for(let j=0;j<3;j++){
      const a=triangle[j],b=triangle[(j+1)%3],insideA=a.distance>=0,insideB=b.distance>=0;
      if(insideA)polygon.push(a);
      if(insideA!==insideB)polygon.push(intersection(a,b));
    }
    const result=Array.from({length:Math.max(0,polygon.length-2)},(_,j)=>[polygon[0],polygon[j+1],polygon[j+2]]);
    // A chord between two curved-boundary intersections can bow back into the
    // road. Subdivide only affected faces until their actual interiors clear.
    const hiddenOutside=!result.length&&probes(triangle).some(vertex=>vertex.distance>1e-5);
    const crossesBoundary=result.some(face=>probes(face).some(vertex=>vertex.distance<-.00002));
    if((hiddenOutside||crossesBoundary)&&depth<8){
      changed=true;const [a,b,c]=triangle,ab=mix(a,b,.5),bc=mix(b,c,.5),ca=mix(c,a,.5);
      for(const face of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])clipTriangle(face,depth+1);
      return;
    }
    for(const face of result)emit(face[0],face[1],face[2]);
  };
  const indices=source.index,count=indices?.count??position.count;
  for(let i=0;i<count;i+=3){
    clipTriangle([0,1,2].map(j=>vertices[indices?indices.getX(i+j):i+j]));
  }
  if(!changed)return source;
  const clipped=new THREE.BufferGeometry();
  for(const name of names)clipped.setAttribute(name,new THREE.Float32BufferAttribute(arrays[name],source.getAttribute(name).itemSize));
  clipped.userData={...source.userData,trimmedAtMainRoad:true};
  return clipped;
}
