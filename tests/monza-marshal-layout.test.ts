import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {createMonzaMarshalLayouts,distanceToMarshalPost,marshalPostFootprint} from '../src/monza-marshal-layout.ts';
import {createHistoricOvalLayout,distanceToHistoricOval} from '../src/monza-historic-oval.ts';
import {createStandLayouts,distanceToStand} from '../src/stand-layout.ts';
import {createBackgroundLandmarkLayouts,distanceToLandmark} from '../src/monza-landmarks.ts';
import {createCircuitPropLayouts} from '../src/monza-surroundings.ts';

const track=new Track();

test('complete marshal roofs and wide corner boards clear old banking, modern fences and retained buildings',()=>{
  const posts=createMonzaMarshalLayouts(track),historic=createHistoricOvalLayout(track),stands=createStandLayouts(track),landmarks=createBackgroundLandmarkLayouts(track);
  assert.equal(posts.length,track.corners.length);
  assert.deepEqual(createMonzaMarshalLayouts(track),posts,'placement must remain deterministic');
  for(const post of posts){
    // Independent, finer roof and name-board sampling catches an unsafe span
    // even when its centre or the original four corners appear to be clear.
    const points:{x:number;z:number}[]=[],c=Math.cos(post.yaw),s=Math.sin(post.yaw);
    for(let i=0;i<=25;i++)for(let j=0;j<=25;j++)points.push({x:post.x+(i/25-.5)*5.5,z:post.z+(j/25-.5)*5.5});
    for(let i=0;i<=100;i++)for(const z of [-.05,.05]){const x=(i/100-.5)*12;points.push({x:post.x+c*x+s*z,z:post.z-s*x+c*z});}
    for(const p of points){
      const nearest=track.nearest(p.x,p.z);
      assert.ok(Math.hypot(p.x-nearest.point.x,p.z-nearest.point.z)>26,`${post.id} extends into the modern catch fence`);
      assert.equal(track.isPitLane(p.x,p.z),false);
      assert.ok(distanceToHistoricOval(p.x,p.z,historic)>=3,`${post.id} touches the old banking`);
      assert.ok(stands.every(stand=>distanceToStand(p.x,p.z,stand)>=2),`${post.id} touches a stand`);
      assert.ok(landmarks.every(landmark=>distanceToLandmark(p.x,p.z,landmark)>=2),`${post.id} touches a background building`);
      assert.ok(p.x>=post.bounds.minX-1e-10&&p.x<=post.bounds.maxX+1e-10&&p.z>=post.bounds.minZ-1e-10&&p.z<=post.bounds.maxZ+1e-10,'metadata must bound the actual roof and board');
    }
  }
  const south=posts.find(post=>post.cornerIndex===7)!;
  assert.ok(south.reasons.includes('historic-road'),'the user-reported south hut needs an explicit old-road correction');
  assert.ok(south.moved&&Math.hypot(south.shift.x,south.shift.z)<=32.001,'move to a nearby free park position');
});

test('post moves retain corner names and facing while separately audited marshal equipment stays fixed',()=>{
  const posts=createMonzaMarshalLayouts(track),equipment=createCircuitPropLayouts(track).filter(p=>p.kind==='marshal-equipment');
  for(const post of posts){
    const corner=track.corners[post.cornerIndex],sample=track.sampleAt(corner.distance);
    assert.equal(post.name,corner.name);
    assert.equal(post.yaw,Math.atan2(-sample.right.x,-sample.right.z));
    assert.equal(post.original.x,sample.point.x+sample.right.x*29);
    assert.equal(post.original.z,sample.point.z+sample.right.z*29);
    assert.equal(post.moved,post.reasons.length>0,'an already safe post must retain its original anchor');
    assert.equal(distanceToMarshalPost(post.x,post.z,post),0);
    const prop=equipment.find(p=>p.id===post.equipment?.id)!;
    assert.deepEqual(post.equipment,{id:prop.id,x:prop.x,z:prop.z,yaw:prop.yaw},'equipment must retain its shared prop-manifest placement');
  }
});

test('reserved connection footprint can relocate a post without coupling the layout to a scenery builder',()=>{
  const original=createMonzaMarshalLayouts(track),reserved=original[5];
  const excluded=(x:number,z:number)=>Math.hypot(x-reserved.x,z-reserved.z)<8;
  const adjusted=createMonzaMarshalLayouts(track,{excluded});
  assert.ok(Math.hypot(adjusted[5].x-reserved.x,adjusted[5].z-reserved.z)>1);
  for(const post of adjusted)assert.ok(marshalPostFootprint(post).every(p=>!excluded(p.x,p.z)));
  for(const post of adjusted.filter(p=>p.cornerIndex!==5))assert.deepEqual(post,original[post.cornerIndex],'unrelated marker anchors must stay fixed');
});
