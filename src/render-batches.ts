import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Match attribute layouts before merging procedural geometry of mixed types. */
function normalizedGeometry(source:THREE.BufferGeometry,matrix:THREE.Matrix4){
  const geometry=source.index?source.toNonIndexed():source.clone();
  geometry.clearGroups();
  for(const name of Object.keys(geometry.attributes))if(!['position','normal','uv','color'].includes(name))geometry.deleteAttribute(name);
  if(!geometry.attributes.normal)geometry.computeVertexNormals();
  if(!geometry.attributes.uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Merge only direct static meshes. Animated wheel/helmet groups stay intact. */
export function batchStaticChildren(parent:THREE.Object3D){
  const batches=new Map<string,THREE.Mesh[]>();
  for(const child of parent.children){
    if(!(child instanceof THREE.Mesh)||child instanceof THREE.InstancedMesh||Array.isArray(child.material))continue;
    child.updateMatrix();
    const key=`${child.material.uuid}/${child.castShadow}/${child.receiveShadow}/${child.renderOrder}`;
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key)!.push(child);
  }
  for(const children of batches.values()){
    if(children.length<2){children[0].matrixAutoUpdate=false;continue;}
    const geometries=children.map(child=>normalizedGeometry(child.geometry,child.matrix));
    const geometry=mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    if(!geometry)continue;
    geometry.computeBoundingSphere();
    const source=children[0],mesh=new THREE.Mesh(geometry,source.material);
    mesh.name='static-material-batch';mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.renderOrder=source.renderOrder;
    mesh.matrixAutoUpdate=false;parent.add(mesh);
    for(const child of children){child.removeFromParent();child.geometry.dispose();}
  }
}

/** Opaque toy architecture shares one rough material, with its palette baked
 * into vertex colours. Spatial cells let the renderer cull whole offscreen bays. */
export function batchStaticScenery(root:THREE.Group,cellSize=72){
  root.updateWorldMatrix(true,true);
  const rootInverse=root.matrixWorld.clone().invert();
  const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.8});
  const batches=new Map<string,THREE.BufferGeometry[]>(),originals:THREE.Mesh[]=[];
  const center=new THREE.Vector3();
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||Array.isArray(object.material))return;
    if(!(object.material instanceof THREE.MeshStandardMaterial)||object.material.map||object.material.transparent||object.name.startsWith('start-light-'))return;
    object.geometry.computeBoundingBox();object.geometry.boundingBox!.getCenter(center).applyMatrix4(object.matrixWorld);
    const key=`${Math.floor(center.x/cellSize)},${Math.floor(center.z/cellSize)}`;
    const geometry=normalizedGeometry(object.geometry,rootInverse.clone().multiply(object.matrixWorld));
    const count=geometry.attributes.position.count,color=object.material.color,values=new Float32Array(count*3);
    for(let i=0;i<count;i++){values[i*3]=color.r;values[i*3+1]=color.g;values[i*3+2]=color.b;}
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(values,3));
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key)!.push(geometry);originals.push(object);
  });
  for(const [key,geometries] of batches){
    const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
    if(!geometry)continue;
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`architecture-cell-${key}`;
    mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);
  }
  for(const mesh of originals){mesh.removeFromParent();mesh.geometry.dispose();}
  root.userData.architectureBatches=batches.size;
}

/** Build a small multi-colour toy out of simple components in one draw call. */
export function coloredGeometry(parts:{geometry:THREE.BufferGeometry;color:THREE.ColorRepresentation}[]){
  const geometries=parts.map(part=>{
    const geometry=normalizedGeometry(part.geometry,new THREE.Matrix4());
    const color=new THREE.Color(part.color),count=geometry.attributes.position.count,values=new Float32Array(count*3);
    for(let i=0;i<count;i++){values[i*3]=color.r;values[i*3+1]=color.g;values[i*3+2]=color.b;}
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(values,3));
    return geometry;
  });
  const geometry=mergeGeometries(geometries,false)!;
  geometries.forEach(g=>g.dispose());parts.forEach(p=>p.geometry.dispose());
  geometry.computeBoundingSphere();return geometry;
}
