import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {addMonzaHistoricConnection,createHistoricConnectionLayout,historicConnectionSurfacePoint} from '../src/monza-historic-connection.ts';
import {historicRibbonNormal,sampledHistoricRibbonPoint} from '../src/historic-ribbon-geometry.ts';

const track=new Track(),layout=createHistoricConnectionLayout(track)!,root=new THREE.Group();addMonzaHistoricConnection(root,track,layout);root.updateMatrixWorld(true);
const surface=(i:number,u:number)=>historicConnectionSurfacePoint(layout.samples[i],u);
const deck=(i:number)=>root.getObjectByName(`historic-north-connection-deck-${i}`) as THREE.Mesh<THREE.BufferGeometry>;

test('old-road slabs retain their exact top vertices while separate cap normals cannot shade their upper face',()=>{
  let completeSlabs=0,bankVertices=0;
  for(let start=0;start<layout.samples.length-1;start+=12){
    const mesh=deck(start);if(!mesh||mesh.geometry.userData.trimmedAtMainRoad)continue;
    completeSlabs++;
    const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal'),last=Math.min(layout.samples.length-1,start+12);
    for(let i=start;i<=last;i++)for(let j=0;j<=6;j++){
      const index=(i-start)*7+j,p=new THREE.Vector3().fromBufferAttribute(positions,index),normal=new THREE.Vector3().fromBufferAttribute(normals,index);
      assert.ok(p.distanceTo(surface(i,j/6))<.00002,'normal repair must not raise or recolour the physical road');
      assert.ok(normal.distanceTo(historicRibbonNormal(surface,layout.samples.length,i,j/6))<1e-6,'a vertical wall or cap contaminated a top normal');
      assert.ok(normal.y>.2);
      if(layout.samples[i].bank>.1)bankVertices++;
    }
  }
  assert.ok(completeSlabs>=3&&bankVertices>100,'normal checks must exercise several retained physical slabs and the bank');
});

test('neighbouring render slabs have the same upper normals across their entire shared cross-section',()=>{
  let bankSeams=0;
  for(let seam=12;seam<layout.samples.length-1;seam+=12){
    const left=deck(seam-12),right=deck(seam);if(!left||!right||left.geometry.userData.trimmedAtMainRoad||right.geometry.userData.trimmedAtMainRoad)continue;
    const before=left.geometry.getAttribute('normal'),after=right.geometry.getAttribute('normal');
    for(let j=0;j<=6;j++)for(const component of [0,1,2])assert.equal(before.array[(12*7+j)*3+component],after.array[j*3+component]);
    if(layout.samples[seam].bank>.1)bankSeams++;
  }
  assert.ok(bankSeams>=2,'seam checks must retain multiple non-flat bank joins after GP clipping');
});

test('wear bands follow actual deck chords instead of intersecting the ideal parabolic surface',()=>{
  const decks:THREE.Mesh[]=[],wear:THREE.Mesh<THREE.BufferGeometry>[]=[];
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.name.includes('-deck-'))decks.push(o);if(o.name.includes('-wear-'))wear.push(o);});
  const ray=new THREE.Raycaster(),direction=new THREE.Vector3(0,-1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),p=new THREE.Vector3(),normal=new THREE.Vector3();let probes=0,min=Infinity,max=0;
  for(const mesh of wear){
    const geometry=mesh.geometry,index=geometry.index,position=geometry.getAttribute('position'),count=index?.count??position.count;
    for(let k=0;k<count;k+=3){
      a.fromBufferAttribute(position,index?index.getX(k):k);b.fromBufferAttribute(position,index?index.getX(k+1):k+1);c.fromBufferAttribute(position,index?index.getX(k+2):k+2);
      normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-12)continue;
      p.copy(a).add(b).add(c).multiplyScalar(1/3);ray.set(p.clone().add(new THREE.Vector3(0,1,0)),direction);
      const hit=ray.intersectObjects(decks,false)[0];assert.ok(hit,'a painted band projects outside its concrete deck');
      const clearance=p.y-hit.point.y;min=Math.min(min,clearance);max=Math.max(max,clearance);probes++;
      assert.ok(clearance>.003&&clearance<.015,`paint band intersects the actual deck or floats above it: ${clearance}`);
    }
  }
  assert.ok(probes>1000);assert.ok(min>.003&&max<.015);
  const sample=layout.samples.findIndex(s=>s.bank>.8),analytic=surface(sample,.26),actual=sampledHistoricRibbonPoint(surface,sample,.26);
  assert.ok(actual.y-analytic.y>.02,'fixture must exercise a chord high enough to bury the old .008-lift strip');
});
