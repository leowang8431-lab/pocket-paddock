import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createHistoricOvalLayout,historicOvalSurfacePoint} from '../src/monza-historic-oval.ts';
import {createHistoricConnectionLayout,historicConnectionSurfacePoint,historicConnectionContains,distanceToHistoricConnection,addMonzaHistoricConnection} from '../src/monza-historic-connection.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createBackgroundLandmarkLayouts,distanceToLandmark} from '../src/monza-landmarks.ts';
import {createPitComplexLayout} from '../src/pit-complex.ts';
import {createTracksideSafetyLayout,safetyFootprint,distanceToSafetyFootprint} from '../src/trackside-safety.ts';

const track=new Track('monza'),layout=createHistoricConnectionLayout(track)!,old=createHistoricOvalLayout(track);
const close=(a:number,b:number,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('the closed north turnout keeps the old road width through its broad shallow-angle GP mouth',()=>{
  const first=layout.samples[0],last=layout.samples.at(-1)!,modern=track.sampleAt(layout.modernDistance);
  close(first.x,modern.point.x);close(first.z,modern.point.z);close(first.baseHeight,.045);close(first.bank,0);
  close(first.tangent.x*modern.tangent.x+first.tangent.z*modern.tangent.z,Math.cos(Math.PI/6));
  assert.ok(first.tangent.x*modern.right.x+first.tangent.z*modern.right.z<0,'the branch must leave towards the old bank');
  for(const sample of layout.samples){
    close(sample.width,old.width);
    const left=historicConnectionSurfacePoint(sample,0),right=historicConnectionSurfacePoint(sample,1);
    close(Math.hypot(left.x-right.x,left.z-right.z),old.width);
    if(sample.distance/layout.length<.44){close(sample.baseHeight,.045);close(sample.bank,0);}
  }
  close(last.tangent.x,old.samples[0].tangent.x);close(last.tangent.z,old.samples[0].tangent.z);
  for(const u of [0,.1,.25,.5,.75,1])assert.ok(historicConnectionSurfacePoint(last,u).distanceTo(historicOvalSurfacePoint(old.samples[0],u))<1e-8,'an unmatched transverse seam remains at the old bank');
  assert.equal(layout.closedToRacing,true);assert.equal(layout.mergeIntoMainRoad,true);assert.ok(layout.gateSample>layout.samples.length/2&&layout.gateSample<layout.samples.length-1);
});

test('the full-width old-road entry bends and banks gradually instead of making an immediate right-angle turn',()=>{
  assert.ok(layout.length>60&&layout.length<75);
  for(let i=1;i<layout.samples.length;i++){
    const a=layout.samples[i-1],b=layout.samples[i],step=b.distance-a.distance,angle=Math.acos(THREE.MathUtils.clamp(a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z,-1,1));
    assert.ok(angle<3.5*Math.PI/180,'sudden heading change in the approach');assert.ok(angle/step<.075,'the approach bend radius is too small');
    assert.ok(step>.7&&step<.85);assert.equal(b.width,10);assert.ok(b.bank>=a.bank&&b.baseHeight>=a.baseHeight);
    for(const u of [0,.5,1])assert.ok(Math.abs(historicConnectionSurfacePoint(b,u).y-historicConnectionSurfacePoint(a,u).y)/step<.19,'banking rises too steeply along the road');
  }
  assert.equal(layout.samples.at(-1)!.width,10);assert.equal(layout.samples.at(-1)!.bank,1);
});

test('the entire north connection clears the pit exit, existing buildings, stands and recovery cranes',()=>{
  const stands=createStandLayouts(track),landmarks=createBackgroundLandmarkLayouts(track),pit=createPitComplexLayout(track),vehicles=createTracksideSafetyLayout(track).vehicles;
  const root=new THREE.Group();addMonzaHistoricConnection(root,track,layout);root.updateMatrixWorld(true);
  const p=new THREE.Vector3();let actualVertices=0;
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const position=object.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++){
      p.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld);actualVertices++;
      const road=track.roadProjectionAt(p.x,p.z),edge=8.15*track.widthAt(road.distance)/track.width;
      assert.equal(track.isPitLane(p.x,p.z),false,'connection obstructs the real pit exit');
      assert.ok(road.gap-edge>=-.0001,'actual rendered connection overlaps the playable asphalt');
      assert.ok(stands.every(s=>distanceToStand(p.x,p.z,s)>3));assert.ok(landmarks.every(l=>distanceToLandmark(p.x,p.z,l)>3));
      assert.ok(pit.footprints.every(b=>distanceToSafetyFootprint(p.x,p.z,b)>2));
    }
  });
  assert.ok(actualVertices>1000);
  for(const v of vehicles)for(const p of safetyFootprint(v))assert.ok(distanceToHistoricConnection(p.x,p.z,layout)>2);
  for(const sample of layout.samples){assert.equal(historicConnectionContains(sample.x,sample.z,layout),true);assert.equal(historicConnectionContains(sample.x,sample.z,null),false);}
});

test('actual northern mouth triangles meet the GP plane along a finite-width seam without covering asphalt',()=>{
  const root=new THREE.Group();addMonzaHistoricConnection(root,track,layout);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),p=new THREE.Vector3(),modern=track.sampleAt(layout.modernDistance);
  let probes=0,seamVertices=0,seamMin=Infinity,seamMax=-Infinity;
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||!object.name.startsWith('historic-north-connection-deck-'))return;
    const geometry=object.geometry,position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count;
    assert.ok(position.count>0);
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i);b.fromBufferAttribute(position,index?index.getX(i+1):i+1);c.fromBufferAttribute(position,index?index.getX(i+2):i+2);
      const top=b.clone().sub(a).cross(c.clone().sub(a)).y>1e-9;
      for(const weights of [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]){
        p.set(0,0,0).addScaledVector(a,weights[0]).addScaledVector(b,weights[1]).addScaledVector(c,weights[2]);
        const road=track.roadProjectionAt(p.x,p.z),gap=road.gap-8.15*track.widthAt(road.distance)/track.width;
        assert.ok(gap>=-.0001,`a northern deck triangle still covers racing asphalt: ${gap}`);probes++;
        if(top&&gap<.002){
          close(p.y,.045,.00002);seamVertices++;
          const along=(p.x-modern.point.x)*modern.tangent.x+(p.z-modern.point.z)*modern.tangent.z;
          seamMin=Math.min(seamMin,along);seamMax=Math.max(seamMax,along);
        }
      }
    }
  });
  assert.ok(probes>1000);assert.ok(seamVertices>10);assert.ok(seamMax-seamMin>12,'the GP mouth collapsed to a point instead of exposing a broad road seam');
});

test('the complete turnout is finite, thick at the bank seam and inexpensive to render',()=>{
  const root=new THREE.Group();addMonzaHistoricConnection(root,track,layout);let triangles=0,deckBottom=false;
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const p=o.geometry.getAttribute('position');triangles+=(o.geometry.index?.count??p.count)/3;
    for(let i=0;i<p.count;i++)assert.ok([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));
    if(o.name.startsWith('historic-north-connection-deck-'))for(let i=0;i<p.count;i++)if(p.getY(i)<0)deckBottom=true;
  });
  assert.ok(deckBottom);assert.ok(triangles<7000);assert.ok(root.getObjectByName('monza-historic-north-connection'));
});

test('the modern fence leaves a real opening at the turnout without shifting the GP road',()=>{
  assert.ok(track.group.userData.safetyFurniture.historicConnectionPortalPanels>=2);
  const fence=track.group.getObjectByName('catch-fence-mesh') as THREE.InstancedMesh,m=new THREE.Matrix4(),p=new THREE.Vector3();
  for(let i=0;i<fence.count;i++){
    fence.getMatrixAt(i,m);
    for(const along of [-2.11,-1,0,1,2.11]){
      p.set(along,0,0).applyMatrix4(m);
      assert.equal(historicConnectionContains(p.x,p.z,layout),false,'a complete fence panel still cuts across the connection');
    }
  }
  for(const sample of layout.samples){
    const near=track.nearest(sample.x,sample.z);
    assert.equal(near.point.y,0,'the GP driving surface remains level');
  }
});
