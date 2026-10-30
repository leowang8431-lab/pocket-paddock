import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/race.ts';

const track=new Track();
test('only Roggia and Lesmo 2 are 5% narrower, with the original centreline and checkpoints',()=>{
  assert.deepEqual(track.widthZones.map(z=>z.id),['roggia','lesmo-2']);
  assert.equal(track.length,1426.4443446817202);
  assert.equal(track.checkpoints.length,24);
  for(let i=0;i<24;i++)assert.equal(track.checkpoints[i],i*track.length/24);
  for(const zone of track.widthZones){
    for(const d of [zone.center-zone.before,zone.center,zone.center+zone.after])assert.equal(track.widthAt(d),15.2);
    for(const d of [zone.center-zone.before-zone.transition,zone.center+zone.after+zone.transition])assert.equal(track.widthAt(d),16);
    assert.equal(track.widthAt(zone.center+track.length*3),15.2);
    assert.equal(track.widthAt(zone.center-track.length*2),15.2);
  }
  for(const i of [0,1,3,5,6,7])assert.equal(track.widthAt(track.corners[i].distance),16);
  for(let d=0;d<track.length;d+=.1){
    const w=track.widthAt(d);assert.ok(w>=15.2&&w<=16);
    assert.ok(Math.abs(track.widthAt(d+.1)-w)<.0061,'a width transition has a discontinuity');
  }
});

test('the actual asphalt mesh is symmetric and 95% wide, with edge paint and kerbs moving together',()=>{
  const road=track.group.children.find(o=>o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='monza-asphalt') as THREE.Mesh;
  assert.ok(road);const position=road.geometry.attributes.position;
  assert.equal(position.count,(track.samples.length+1)*2);
  for(let i=0;i<track.samples.length;i++){
    const s=track.samples[i],a=new THREE.Vector3().fromBufferAttribute(position,i*2),b=new THREE.Vector3().fromBufferAttribute(position,i*2+1);
    assert.ok(Math.hypot((a.x+b.x)/2-s.point.x,(a.z+b.z)/2-s.point.z)<.00004,'road centre moved');
    assert.ok(Math.abs(Math.hypot(a.x-b.x,a.z-b.z)-16.3*track.widthAt(s.distance)/16)<.00008,'rendered width disagrees with driving width');
  }
  for(const z of track.widthZones)for(const offset of [7.82,8,8.15,8.25,9.65,10.8]){
    assert.ok(Math.abs(track.roadOffsetAt(z.center,offset)-offset*.95)<1e-12);
    assert.equal(track.roadOffsetAt(z.center,-offset),-track.roadOffsetAt(z.center,offset));
  }
});

test('both narrowed shoulders lose asphalt grip and use the same tighter lap limits',()=>{
  for(const zone of track.widthZones){
    const sample=track.samples[Math.round(zone.center/track.length*track.samples.length)];
    for(const side of [-1,1]){
      const point=sample.point.clone().addScaledVector(sample.right,side*8.6);
      assert.notEqual(track.surfaceAt(point.x,point.z),'asphalt');
    }
    const race=new RaceSession(track);race.start();race.update(4.5,zone.center,0,1);
    race.update(.36,zone.center,9.4,1);assert.equal(race.valid,false);assert.equal(race.invalidReason,'track-limits');
  }
  const race=new RaceSession(track);race.start();race.update(4.5,0,0,1);race.update(.36,0,9.4,1);assert.equal(race.valid,true);
  // Checkpoints cannot be collected beside a narrowed road using the old width.
  const local={length:240,width:16,widthAt:()=>15.2,checkpoints:[0,40,80,120,160,200]};
  const narrow=new RaceSession(local);narrow.start();narrow.update(4.5,30,0,1);narrow.update(.1,42,9.7,1);assert.equal(narrow.nextCheckpoint,1);
  const wide=new RaceSession({...local,widthAt:()=>16});wide.start();wide.update(4.5,30,0,1);wide.update(.1,42,9.7,1);assert.equal(wide.nextCheckpoint,2);
});
