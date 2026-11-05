import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createHistoricOvalLayout,historicOvalSurfacePoint} from '../src/monza-historic-oval.ts';
import {historicConnectionContains,historicConnectionSurfacePoint} from '../src/monza-historic-connection.ts';
import {createHistoricSouthConnectionLayout,addMonzaHistoricSouthConnection} from '../src/monza-historic-south-connection.ts';
import {createHistoricSouthPlan} from '../src/monza-historic-south-plan.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createPitComplexLayout} from '../src/pit-complex.ts';
import {distanceToSafetyFootprint} from '../src/trackside-safety.ts';

const track=new Track(),layout=createHistoricSouthConnectionLayout(track)!,old=createHistoricOvalLayout(track).samples.at(-1)!;

test('the complete southern banking and merge follow one convex sweep without S waves or a return hook',()=>{
  const tail=createHistoricOvalLayout(track).samples.filter(sample=>sample.section==='south-banking'),plan=createHistoricSouthPlan(track);
  assert.ok(tail.length>100);
  assert.ok(old.x>-35&&old.z>250,'the old wave-shaped tail must be replaced before its former tight return');
  assert.ok(historicOvalSurfacePoint(old,.5).clone().setY(0).distanceTo(plan.sampleAtArc(plan.splitArc).point)<1e-8);
  for(let i=1;i<tail.length;i++){
    const a=tail[i-1],b=tail[i],angle=Math.acos(THREE.MathUtils.clamp(a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z,-1,1));
    assert.ok(angle/(b.distance-a.distance)<1/50,'a replacement kink remains on the old banking');
    assert.ok(a.tangent.x*b.tangent.z-a.tangent.z*b.tangent.x>=-1e-6,'the old south bend still alternates its turning direction');
  }
  let previous=plan.sampleAtArc(0);
  for(let i=1;i<=500;i++){
    const next=plan.sampleAtArc(plan.length*i/500);
    assert.ok(next.point.x<=previous.point.x+1e-7,'the global road doubles back east into a local hook');
    assert.ok(previous.tangent.x*next.tangent.z-previous.tangent.z*next.tangent.x>=-1e-6,'the single global curve changes its curvature sign');
    previous=next;
  }
});

test('southern old-road return exactly joins the complete bank and enters the GP with finite width',()=>{
  const first=layout.samples[0],last=layout.samples.at(-1)!,modern=track.sampleAt(layout.modernDistance);
  for(const u of [0,.1,.25,.5,.75,1])assert.ok(historicConnectionSurfacePoint(first,u).distanceTo(historicOvalSurfacePoint(old,u))<1e-8);
  const end=modern.point.clone();
  assert.ok(historicConnectionSurfacePoint(last,.5).distanceTo(end.clone().setY(.045))<1e-8);
  assert.deepEqual(first.tangent,old.tangent);assert.ok(Math.hypot(last.tangent.x-modern.tangent.x,last.tangent.z-modern.tangent.z)<1e-12);
  assert.equal(first.width,10);assert.equal(first.bank,1);assert.equal(last.width,10);assert.equal(last.bank,0);assert.equal(layout.mergeIntoMainRoad,true);
  assert.equal(layout.modernSide,1);assert.equal(layout.closedToRacing,true);assert.ok(layout.gateSample<layout.samples.length/2);
});

test('the southern return turns without folded shoulders and gradually flattens into the GP road',()=>{
  assert.ok(layout.length>90&&layout.length<110,'the former short U-shaped return must be replaced by a broad part of the single sweep');
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();let nondegenerate=0,totalTurn=0;
  for(let i=1;i<layout.samples.length;i++){
    const before=layout.samples[i-1],after=layout.samples[i],step=after.distance-before.distance;
    const angle=Math.acos(THREE.MathUtils.clamp(before.tangent.x*after.tangent.x+before.tangent.z*after.tangent.z,-1,1));
    assert.ok(angle<.9*Math.PI/180,'visible direction change is too sharp');
    assert.ok(angle/step<1/50,'the connection must retain a genuinely broad radius, not a highly subdivided tight corner');
    assert.ok(angle/step*Math.max(before.width,after.width)/2<.11,'the inside of a full-width curve folds over itself');
    assert.ok(after.tangent.z<.001,'the new road must never double back south');totalTurn+=angle;
    assert.equal(after.width,10,'the merge must not be squeezed into a needle');
    assert.ok(after.bank<=before.bank&&after.baseHeight<=before.baseHeight);
    if(i>=(layout.samples.length-1)/2){assert.equal(after.bank,0,'crossfall must finish flattening before the wide GP merge');assert.equal(after.baseHeight,.045,'the entire merge must meet the GP paving height');}
    for(let j=0;j<6;j++){
      const corners=[historicConnectionSurfacePoint(before,j/6),historicConnectionSurfacePoint(before,(j+1)/6),historicConnectionSurfacePoint(after,j/6),historicConnectionSurfacePoint(after,(j+1)/6)];
      for(const indices of [[0,2,1],[1,2,3]]){
        a.copy(corners[indices[0]]);b.copy(corners[indices[1]]).sub(a);c.copy(corners[indices[2]]).sub(a);normal.crossVectors(b,c);
        assert.ok(normal.y>=-1e-9,'an actual deck triangle reverses its top face');if(normal.y>1e-7)nondegenerate++;
      }
    }
  }
  assert.ok(totalTurn<105*Math.PI/180,'heading must make one broad turn rather than a return hook');
  assert.ok(layout.samples.at(-1)!.x-Math.min(...layout.samples.map(s=>s.x))<3,'the merge must not swing far west and sharply return east');
  assert.ok(nondegenerate>1100);
  for(const index of [1,layout.samples.length-2]){
    const sample=layout.samples[index],endpoint=layout.samples[index===1?0:layout.samples.length-1];
    const step=Math.abs(sample.distance-endpoint.distance);
    assert.ok(Math.abs(sample.bank-endpoint.bank)/step<.0012,'crossfall has a hard step at a join');
    assert.ok(Math.abs(sample.baseHeight-endpoint.baseHeight)/step<.00012,'base elevation has a hard step at a join');
  }
});

test('all southern deck, rails and grounded supports clear the real tower, stairs, stands and racing asphalt',()=>{
  const root=new THREE.Group(),pit=createPitComplexLayout(track),stands=createStandLayouts(track);addMonzaHistoricSouthConnection(root,track,layout);root.updateMatrixWorld(true);
  const group=root.getObjectByName(layout.id)!;assert.ok(group.userData.supportCount>=2,'the elevated bank needs grounded support ribs');
  let triangles=0,vertices=0,minSupport=Infinity;const point=new THREE.Vector3();
  root.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const position=o.geometry.getAttribute('position');triangles+=(o.geometry.index?.count??position.count)/3;
    for(let i=0;i<position.count;i++){
      point.fromBufferAttribute(position,i).applyMatrix4(o.matrixWorld);assert.ok(point.toArray().every(Number.isFinite));vertices++;
      const near=track.nearest(point.x,point.z),gap=Math.hypot(point.x-near.point.x,point.z-near.point.z);
      assert.ok(gap>=8.145,'actual geometry overlaps the GP asphalt');assert.equal(track.isPitLane(point.x,point.z),false);
      assert.ok(pit.footprints.every(p=>distanceToSafetyFootprint(point.x,point.z,p)>2),'southern return enters a tower, stair or other pit building');
      assert.ok(stands.every(s=>distanceToStand(point.x,point.z,s)>3));
      if(o.name.includes('-support-')||o.name.includes('-foot-'))minSupport=Math.min(minSupport,gap);
    }
  });
  assert.ok(vertices>1000&&triangles<18000);assert.ok(minSupport>26.5,'grounded supports obstruct the GP fence corridor');
});

test('the southern merge has a complete gap in the modern catch fence',()=>{
  const fence=track.group.getObjectByName('catch-fence-mesh') as THREE.InstancedMesh,m=new THREE.Matrix4(),p=new THREE.Vector3();
  for(let i=0;i<fence.count;i++){
    fence.getMatrixAt(i,m);
    for(const along of [-2.11,-1,0,1,2.11]){
      p.set(along,0,0).applyMatrix4(m);
      assert.equal(historicConnectionContains(p.x,p.z,layout),false,'a modern net panel still cuts the southern connection');
    }
  }
});
