import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createCircuitPropLayouts} from '../src/monza-surroundings.ts';
import {addMonzaLandmarks,createBackgroundLandmarkLayouts,distanceToLandmark,landmarkFootprint,landmarkTreeExclusion} from '../src/monza-landmarks.ts';
import {batchStaticScenery} from '../src/render-batches.ts';

const track=new Track();
test('four referenced Monza buildings retain their complete clearance from the road, pit joins and existing facilities',()=>{
  const layouts=createBackgroundLandmarkLayouts(track),stands=createStandLayouts(track),props=createCircuitPropLayouts(track);
  assert.deepEqual(layouts.map(l=>l.id),['monza-house','ultimate-hospitality','costa-alta','serraglio-gate']);
  assert.deepEqual(createBackgroundLandmarkLayouts(track),layouts,'placement remains deterministic');
  for(const layout of layouts){
    assert.ok(layout.reference.startsWith('https://www.monzanet.it/')||layout.reference==='https://reggiadimonza.it/architetture/');
    assert.ok(layout.artistic.length>60);
    const nearest=track.nearest(layout.x,layout.z);
    assert.ok(Math.hypot(layout.x-nearest.point.x,layout.z-nearest.point.z)<120,`${layout.id} is too distant for the driving camera`);
    const toward=new THREE.Vector2(nearest.point.x-layout.x,nearest.point.z-layout.z).normalize();
    assert.ok(-Math.sin(layout.yaw)*toward.x-Math.cos(layout.yaw)*toward.y>.99,`${layout.id} presents its back instead of its facade to drivers`);
    for(const p of landmarkFootprint(layout,18)){
      const s=track.nearest(p.x,p.z);
      assert.ok(Math.hypot(p.x-s.point.x,p.z-s.point.z)>26,`${layout.id} crosses the catch-fence area`);
      assert.equal(track.isPitLane(p.x,p.z),false);
      assert.ok(stands.every(stand=>distanceToStand(p.x,p.z,stand)>3));
      assert.ok(props.every(prop=>Math.hypot(layout.x-prop.x,layout.z-prop.z)>Math.hypot(layout.width,layout.depth)/2+Math.hypot(prop.width,prop.depth)/2));
    }
  }
});

test('building geometry fits its audited footprint and merges into a small number of opaque scenery batches',()=>{
  const root=new THREE.Group(),layouts=addMonzaLandmarks(root,track);let triangles=0;
  for(const layout of layouts){
    const group=root.getObjectByName(`background-landmark-${layout.id}`)!;
    group.updateMatrixWorld(true);
    const inverse=group.matrixWorld.clone().invert();
    group.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      assert.ok(o.material instanceof THREE.MeshStandardMaterial&&!o.material.transparent&&!o.material.map);
      triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
      const vertices=o.geometry.attributes.position,p=new THREE.Vector3();
      for(let i=0;i<vertices.count;i++){
        p.fromBufferAttribute(vertices,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);
        assert.ok(Math.abs(p.x)<=layout.width/2+.001&&Math.abs(p.z)<=layout.depth/2+.001,`${layout.id} geometry escapes its tested base`);
        assert.ok(p.y>=-.01&&p.y<=layout.height,`${layout.id} has an unbounded tower`);
      }
    });
  }
  assert.ok(triangles<7000,`background additions cost ${triangles} triangles`);
  assert.ok(root.getObjectByName('serraglio-pointed-arch'),'the gate has an actual opening, not a painted rectangular block');
  batchStaticScenery(root);let draws=0;root.traverse(o=>{if(o instanceof THREE.Mesh)draws++;});
  assert.ok(draws<=8,`background architecture expands to ${draws} draw calls`);
});

test('trees keep clear of building crowns and a narrow road-to-facade sightline',()=>{
  for(const layout of createBackgroundLandmarkLayouts(track)){
    const n=track.nearest(layout.x,layout.z).point;
    assert.equal(distanceToLandmark(layout.x,layout.z,layout),0);
    assert.equal(landmarkTreeExclusion(layout.x,layout.z,layout,track),true);
    assert.equal(landmarkTreeExclusion((layout.x+n.x)/2,(layout.z+n.z)/2,layout,track),true);
    assert.equal(landmarkTreeExclusion(layout.x+180,layout.z+180,layout,track),false,'woodland beyond the sightline remains available');
  }
});


test('background roofs actually rise by a quarter without expanding any horizontal building footprint',()=>{
  const root=new THREE.Group(),layouts=addMonzaLandmarks(root,track);root.updateMatrixWorld(true);
  const oldRoofTop:Record<string,number>={'monza-house':7.4,'ultimate-hospitality':6.65,'costa-alta':13.5,'serraglio-gate':12.875};
  const point=new THREE.Vector3();
  for(const layout of layouts){
    const group=root.getObjectByName(`background-landmark-${layout.id}`)!,bounds=new THREE.Box3().setFromObject(group);
    const expected=oldRoofTop[layout.id]*1.25+.10;
    assert.ok(Math.abs(bounds.max.y-expected)<.001,`${layout.id} world roof ${bounds.max.y} differs from the raised roof ${expected}`);
    assert.ok(bounds.max.y<=layout.height+.10);
    const c=Math.cos(layout.yaw),s=Math.sin(layout.yaw);
    group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const positions=o.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        point.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld);
        const dx=point.x-layout.x,dz=point.z-layout.z,lx=c*dx-s*dz,lz=s*dx+c*dz;
        assert.ok(Math.abs(lx)<=layout.width/2+.001&&Math.abs(lz)<=layout.depth/2+.001,'height boost cannot expand the audited ground footprint');
      }
    });
  }
});
