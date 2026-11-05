import * as THREE from 'three';
import {DecalGeometry} from 'three/addons/geometries/DecalGeometry.js';

/** Clip the wordmark to the supplied painted triangles. A floating rectangle
 * cannot follow the sidepod as it tapers towards either axle. Coordinates and
 * the small outward offset stay in the unscaled supplied model's local space. */
export function createSidepodWordmark(model:THREE.Object3D,side:number,uv:readonly number[]):THREE.BufferGeometry{
  const width=.66,height=.18,centerY=.38,offset=.003;
  model.updateWorldMatrix(true,true);
  const inverse=model.matrixWorld.clone().invert(),positions:number[]=[],normals:number[]=[],uvs:number[]=[],sources:string[]=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  const center=new THREE.Vector3(),hit=new THREE.Vector3(),ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(-side,0,0));
  model.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||object.name!=='body-materialpaint')return;
    // The projection helper expects world coordinates. Give it a temporary
    // view of the exact source in model space without reparenting/repainting it.
    const source=new THREE.Mesh(object.geometry,object.material);source.matrixAutoUpdate=false;
    source.matrix.copy(inverse).multiply(object.matrixWorld);source.updateMatrixWorld(true);
    const surface:THREE.Triangle[]=[],original=object.geometry.attributes.position,index=object.geometry.index;
    for(let i=0;i<(index?.count??original.count);i+=3)surface.push(new THREE.Triangle(...[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(original,index?index.getX(i+j):i+j).applyMatrix4(source.matrixWorld)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
    const clipped=new DecalGeometry(source,new THREE.Vector3(side*.46,centerY,0),new THREE.Euler(0,side*Math.PI/2,0),new THREE.Vector3(width,height,.38));
    const position=clipped.attributes.position,texcoord=clipped.attributes.uv;
    for(let i=0;i<position.count;i+=3){
      a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);
      normal.crossVectors(b.clone().sub(a),c.clone().sub(a));
      if(normal.lengthSq()<1e-16)continue;
      normal.normalize();
      // Discard inward-facing or horizontal source surfaces inside the
      // projection volume; the label belongs to the outer painted sidewall.
      if(normal.x*side<.35||(a.x+b.x+c.x)*side/3<.27)continue;
      // The supplied body also contains painted chassis faces behind the
      // sidepod. Keep only the outer skin, avoiding a second hidden wordmark.
      center.copy(a).add(b).add(c).multiplyScalar(1/3);ray.origin.set(side*2,center.y,center.z);let outer=-Infinity;
      for(const triangle of surface)if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit))outer=Math.max(outer,hit.x*side);
      if(outer-center.x*side>.001)continue;
      for(const [j,point]of [a,b,c].entries()){
        // One shared outward translation keeps adjacent clipped edges joined;
        // separate face-normal offsets open visible cracks through the letters.
        point.x+=side*offset;positions.push(point.x,point.y,point.z);normals.push(normal.x,normal.y,normal.z);
        uvs.push(uv[0]+THREE.MathUtils.clamp(texcoord.getX(i+j),0,1)*(uv[2]-uv[0]),uv[1]+THREE.MathUtils.clamp(texcoord.getY(i+j),0,1)*(uv[3]-uv[1]));
      }
    }
    sources.push(object.name);clipped.dispose();
  });
  if(!positions.length)throw new Error('The supplied car has no painted sidepod surface for its team wordmark.');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(Array.from({length:positions.length/3},(_,index)=>index));
  geometry.userData={role:'sidepod-team-wordmark',side,center:{y:centerY,z:0},width,height,offset,sources,triangles:positions.length/9,projection:'source-triangle-clipping'};
  return geometry;
}
