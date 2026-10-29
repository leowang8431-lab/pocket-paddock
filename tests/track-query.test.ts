import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track,type TrackSample} from '../src/track.ts';

const track=new Track();
// Independent reference: the previous implementation checked all 1600 samples.
function linearNearest(x:number,z:number):TrackSample {
  let distance=Infinity,result=track.samples[0];
  for(const sample of track.samples){
    const candidate=(sample.point.x-x)**2+(sample.point.z-z)**2;
    if(candidate<distance){distance=candidate;result=sample;}
  }
  return result;
}
const pitCurve=new THREE.CatmullRomCurve3([
  [-85,181],[-63,151],[-63,90],[-63,0],[-63,-78],[-85,-108],
].map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
const pit=pitCurve.getPoints(180);
function linearPit(x:number,z:number):boolean {
  if(x< -92||x> -54||z< -116||z>188)return false;
  for(let i=0;i<pit.length-1;i++){
    const a=pit[i],b=pit[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
    if((x-a.x-dx*t)**2+(z-a.z-dz*t)**2<=36.5)return true;
  }
  return false;
}
function referenceSurface(x:number,z:number){
  if(linearPit(x,z))return 'asphalt';
  const sample=linearNearest(x,z),d=Math.hypot(sample.point.x-x,sample.point.z-z),t=sample.distance/track.length;
  if(d<=8.8)return 'asphalt';
  const gravel=(t>.14&&t<.22)||(t>.35&&t<.53)||(t>.64&&t<.71)||(t>.85&&t<.94);
  return d>11&&d<23&&gravel?'gravel':'grass';
}

test('spatial nearest equals a full scan on the complete circuit and both runoffs',()=>{
  for(let i=0;i<track.samples.length;i++){
    const s=track.samples[i];
    assert.equal(track.nearest(s.point.x,s.point.z),s);
    if(i%4===0)for(const offset of [-35,-12,-8.8,8.8,12,35]){
      const x=s.point.x+s.right.x*offset,z=s.point.z+s.right.z*offset;
      assert.equal(track.nearest(x,z),linearNearest(x,z),`sample ${i}, offset ${offset}`);
    }
  }
});

test('spatial lookup remains exact for grid boundaries, adjacent sections and remote positions',()=>{
  let seed=0x40671;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<5000;i++){
    const x=-600+random()*1600,z=-800+random()*1600;
    assert.equal(track.nearest(x,z),linearNearest(x,z));
  }
  for(const [x,z] of [[-92,-116],[-54,188],[-85,174],[-50,188],[0,0],[1e6,-1e6],[1e308,1e308],[NaN,0],[0,Infinity]]){
    assert.equal(track.nearest(x,z),linearNearest(x,z));
  }
});

test('equal distances keep the original sample order and prior queries cannot bias the result',()=>{
  for(let i=0;i<track.samples.length;i+=3){
    const a=track.samples[i].point,b=track.samples[(i+1)%track.samples.length].point;
    const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    track.nearest(231,-289);
    const expected=linearNearest(x,z);
    assert.equal(track.nearest(x,z),expected);
    assert.equal(track.nearest(x,z),expected,'exact-coordinate cache keeps the same sample');
    track.nearest(-85,100);
    assert.equal(track.nearest(x,z),expected);
  }
});

test('indexed pit segments preserve the complete curved lane and all edge classifications',()=>{
  const offsets=[-6.05,-Math.sqrt(36.5),-6,0,6,Math.sqrt(36.5),6.05];
  for(let i=0;i<=360;i++){
    const p=pitCurve.getPoint(i/360),t=pitCurve.getTangent(i/360),length=Math.hypot(t.x,t.z);
    for(const offset of offsets){
      const x=p.x+t.z/length*offset,z=p.z-t.x/length*offset;
      assert.equal(track.isPitLane(x,z),linearPit(x,z),`pit sample ${i}, offset ${offset}`);
    }
  }
  // Query-cell boundaries and the original broad rejection bounds.
  for(let x=-96;x<=-48;x+=.5)for(let z=-120;z<=192;z+=3){
    assert.equal(track.isPitLane(x,z),linearPit(x,z));
  }
});

test('road, grass and gravel decisions are unchanged after spatial indexing',()=>{
  for(let i=0;i<track.samples.length;i+=7){
    const s=track.samples[i];
    for(const offset of [-24,-15,-11,-8.8,0,8.8,11,15,24]){
      const x=s.point.x+s.right.x*offset,z=s.point.z+s.right.z*offset;
      assert.equal(track.surfaceAt(x,z),referenceSurface(x,z));
    }
  }
});

test('static grid slots and checker squares stay within a small drawing budget',()=>{
  const batching=track.group.userData.batching;
  assert.ok(batching.sourceMeshes>40);
  assert.ok(batching.batches<=16,`track uses ${batching.batches} static batches`);
});
