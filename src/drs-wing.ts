import * as THREE from 'three';

/** Split only the supplied carbon trailing flap, keeping the base plane,
 * supports, endplates, geometry normals and palette materials intact. */
export function createDrsWing(model:THREE.Group):THREE.Group {
  const hinge=new THREE.Group();hinge.name='drs-rear-wing-hinge';hinge.position.set(0,.932,-1.637);
  let triangles=0;
  for(const object of [...model.children]){
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material)||object.material.name!=='carbon')continue;
    const source=object.geometry,index=source.index,positions=source.getAttribute('position');if(!index)continue;
    const moving:number[]=[],fixed:number[]=[];
    for(let i=0;i<index.count;i+=3){
      const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
      const flap=ids.every(id=>positions.getY(id)>.88&&positions.getZ(id)<-1.49&&Math.abs(positions.getX(id))<.48);
      (flap?moving:fixed).push(...ids);
    }
    if(!moving.length)continue;
    const geometry=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes) as [string,THREE.BufferAttribute|THREE.InterleavedBufferAttribute][]){
      const values=new Float32Array(moving.length*attribute.itemSize);
      for(let i=0;i<moving.length;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(moving[i],c);
      geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
    }
    geometry.translate(-hinge.position.x,-hinge.position.y,-hinge.position.z);geometry.computeBoundingSphere();
    source.setIndex(fixed);const mesh=new THREE.Mesh(geometry,object.material);mesh.name='drs-moving-carbon-flap';hinge.add(mesh);triangles+=moving.length/3;
  }
  hinge.userData.triangles=triangles;model.add(hinge);return hinge;
}
