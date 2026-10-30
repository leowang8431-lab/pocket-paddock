import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Track} from '../src/track.ts';
import {createScenery} from '../src/scenery.ts';
import {createStandLayouts,standFootprint,distanceToStand} from '../src/stand-layout.ts';
import {createPitComplexLayout} from '../src/pit-complex.ts';
import {createBackgroundLandmarkLayouts} from '../src/monza-landmarks.ts';
import {createCircuitPropLayouts} from '../src/monza-surroundings.ts';
import {createTracksideSafetyLayout,distanceToSafetyFootprint} from '../src/trackside-safety.ts';

type Rect={x:number;z:number;yaw:number;width:number;depth:number};
function rectangle(p:Rect){const c=Math.cos(p.yaw),s=Math.sin(p.yaw);return[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:p.x+c*a*p.width/2+s*b*p.depth/2,z:p.z-s*a*p.width/2+c*b*p.depth/2}));}
function separated(a:ReturnType<typeof standFootprint>,b:ReturnType<typeof rectangle>,gap:number){
  for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz),nx=-dz/len,nz=dx/len;
    const aa=a.map(v=>v.x*nx+v.z*nz),bb=b.map(v=>v.x*nx+v.z*nz);
    if(Math.min(...bb)-Math.max(...aa)>=gap||Math.min(...aa)-Math.max(...bb)>=gap)return true;
  }
  return false;
}
const track=new Track(),stands=createStandLayouts(track),pit=createPitComplexLayout(track),landmarks=createBackgroundLandmarkLayouts(track),props=createCircuitPropLayouts(track),safety=createTracksideSafetyLayout(track);

test('fourteen park expansions keep every full roof clear of all eleven strategy rooms and fixed Monza facilities',()=>{
  assert.equal(pit.strategyPods.length,11);assert.equal(stands.length,21);
  const reserved=[...pit.footprints,...landmarks,...props,...safety.vehicles];assert.ok(reserved.length>=66);
  for(const stand of stands.slice(7))for(const facility of reserved){
    assert.ok(separated(standFootprint(stand),rectangle(facility),3.99),`${stand.id} intersects ${facility.id}`);
  }
});

test('all 620 actual forest centres keep their crowns clear of the expanded stands, buildings and service vehicles',()=>{
  // Canvas is used only to author local label/texture geometry. No WebGL draw or
  // rendered appearance is claimed by this numerical footprint check.
  const old=globalThis.document;
  const context=new Proxy({createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>Reflect.get(target,key)??(()=>{})});
  let scene:THREE.Group;
  try{
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context})}});
    scene=createScenery(track);
  }finally{if(old)Object.defineProperty(globalThis,'document',{configurable:true,value:old});else Reflect.deleteProperty(globalThis,'document');}
  const forest=scene!.userData.forest;
  assert.equal(forest.instances,620);assert.equal(forest.locations.length,620);assert.equal(forest.facilityClearance,7);
  assert.ok(forest.relocatedForStands>0);assert.ok(forest.relocatedForFacilities>=forest.relocatedForStands&&forest.relocatedForFacilities>=forest.relocatedForServices);
  assert.ok(forest.relocatedForFacilities<=forest.relocatedForStands+forest.relocatedForServices);
  assert.equal(scene!.userData.grandstands.count,21);assert.equal(scene!.userData.grandstands.spectators,6184);
  assert.equal(scene!.userData.grandstands.crowdDrawsPerVisibleStand,2);
  for(const tree of forest.locations){
    assert.ok(tree.x>=-213&&tree.x<=337&&tree.z>=-410&&tree.z<=325);
    assert.ok(stands.every(s=>distanceToStand(tree.x,tree.z,s)>=7),`tree ${tree.x},${tree.z} enters a stand crown corridor`);
    assert.ok(pit.footprints.every(p=>distanceToSafetyFootprint(tree.x,tree.z,p)>=7));
    assert.ok(safety.vehicles.every(p=>distanceToSafetyFootprint(tree.x,tree.z,p)>=7));
  }
});
