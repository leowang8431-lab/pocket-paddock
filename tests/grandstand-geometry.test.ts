import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createStandLayouts,standLocalBounds} from '../src/stand-layout.ts';
import {grandstand} from '../src/scenery.ts';

const track=new Track(),layouts=createStandLayouts(track),root=new THREE.Group();
// Labels only need a locally painted canvas in the browser. The geometry audit
// does not fake WebGL or claim rendered appearance; no renderer is used here.
const oldDocument=globalThis.document;
try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})}});
  for(const layout of layouts)grandstand(root,layout);
}finally{
  if(oldDocument)Object.defineProperty(globalThis,'document',{configurable:true,value:oldDocument});else Reflect.deleteProperty(globalThis,'document');
}
root.updateMatrixWorld(true);

test('twenty-one taller stands retain two crowd draws per LOD and clear aisles',()=>{
  let total=0;
  for(const layout of layouts){
    assert.equal(layout.rows,layout.id==='centrale'?12:10);
    const group=root.getObjectByName(`grandstand-${layout.id}`)!;
    const crowd=group.getObjectByName('spectator-lod') as THREE.LOD;
    assert.equal(crowd.levels.length,3);assert.equal(crowd.levels[2].object.children.length,0);
    const count=crowd.userData.spectators;total+=count;
    assert.equal(group.userData.spectators,count);assert.ok(count>=218);
    for(const level of crowd.levels.slice(0,2)){
      assert.equal(level.object.children.length,2,'more rows must not multiply crowd draw calls');
      for(const child of level.object.children){
        assert.ok(child instanceof THREE.InstancedMesh);assert.equal(child.count,count);
        assert.equal(child.castShadow,false,'crowds do not add real-time shadow passes');
        if(layout.id==='centrale'){
          const transform=new THREE.Matrix4(),position=new THREE.Vector3();
          for(let i=0;i<child.count;i++){
            child.getMatrixAt(i,transform);position.setFromMatrixPosition(transform);
            assert.ok([-layout.width*.32,0,layout.width*.32].every(x=>Math.abs(position.x-x)>=1),'a spectator blocks the stairs');
          }
        }
      }
    }
  }
  // The original seven taller stands had 2,547 seated spectators. The 14
  // additional park stands preserve gaps and total 6,184 occupied places.
  assert.equal(layouts.length,21);assert.equal(total,6184);
});

test('every generated stand, seat, head, truss and railing fits its full audited footprint',()=>{
  let vertices=0;
  for(const layout of layouts){
    const group=root.getObjectByName(`grandstand-${layout.id}`)!,inverse=group.matrixWorld.clone().invert(),bounds=standLocalBounds(layout);
    const point=new THREE.Vector3(),matrix=new THREE.Matrix4(),instance=new THREE.Matrix4();
    const check=(p:THREE.Vector3,name:string)=>{
      assert.ok(p.x>=bounds.minX-.001&&p.x<=bounds.maxX+.001&&p.z>=bounds.minZ-.001&&p.z<=bounds.maxZ+.001,`${layout.id}/${name} escapes footprint at ${p.toArray()}`);
      vertices++;
    };
    group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const local=inverse.clone().multiply(object.matrixWorld);
      if(object instanceof THREE.InstancedMesh){
        object.geometry.computeBoundingBox();const b=object.geometry.boundingBox!;
        for(let i=0;i<object.count;i++){
          object.getMatrixAt(i,instance);matrix.copy(local).multiply(instance);
          for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])check(point.set(x,y,z).applyMatrix4(matrix),object.name);
        }
      }else{
        const positions=object.geometry.attributes.position;
        for(let i=0;i<positions.count;i++)check(point.fromBufferAttribute(positions,i).applyMatrix4(local),object.name);
      }
    });
  }
  assert.ok(vertices>70000,'audit must inspect the actual generated geometry, not just authoring dimensions');
});

test('covered stand canopies stay above every seated head after adding upper rows',()=>{
  for(const layout of layouts.filter(l=>l.covered)){
    const group=root.getObjectByName(`grandstand-${layout.id}`)!,inverse=group.matrixWorld.clone().invert();
    const roof=group.getObjectByName('grandstand-canopy') as THREE.Mesh;
    const roofBox=new THREE.Box3().setFromBufferAttribute(roof.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(inverse.clone().multiply(roof.matrixWorld));
    const crowd=group.getObjectByName('spectator-lod') as THREE.LOD;
    let maximumHead=-Infinity;
    for(const object of crowd.levels[0].object.children as THREE.InstancedMesh[]){
      object.geometry.computeBoundingBox();const box=object.geometry.boundingBox!,m=new THREE.Matrix4(),p=new THREE.Vector3();
      for(let i=0;i<object.count;i++){
        object.getMatrixAt(i,m);m.premultiply(object.matrixWorld).premultiply(inverse);
        maximumHead=Math.max(maximumHead,p.set(0,box.max.y,0).applyMatrix4(m).y);
      }
    }
    assert.ok(roofBox.min.y>maximumHead+2,`${layout.id}: upper crowd head ${maximumHead} reaches canopy ${roofBox.min.y}`);
  }
});
