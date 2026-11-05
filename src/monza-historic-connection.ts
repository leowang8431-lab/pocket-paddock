import * as THREE from 'three';
import type {Track} from './track';
import {createHistoricOvalLayout} from './monza-historic-oval';
import {clipHistoricRibbonGeometry,createHistoricRibbonGeometry,historicRibbonNormal,sampledHistoricRibbonPoint} from './historic-ribbon-geometry';

type ConnectionTrack=Pick<Track,'id'|'nearest'|'isPitLane'|'widthAt'|'sampleAt'>&Partial<Pick<Track,'roadProjectionAt'|'width'>>;
export interface HistoricConnectionSample {
  x:number;z:number;distance:number;width:number;baseHeight:number;bank:number;
  tangent:{x:number;z:number};right:{x:number;z:number};
}
export interface HistoricConnectionLayout {
  id:'monza-historic-north-connection'|'monza-historic-south-connection';samples:HistoricConnectionSample[];length:number;
  modernDistance:number;modernSide:-1|1;closedToRacing:true;gateSample:number;
  footprintMargin:number;artistic:string;
  /** Keep the full-width authored road, trimming only geometry hidden inside
   * the real GP asphalt to form a finite-width, opaque merge. */
  mergeIntoMainRoad?:boolean;
}
const cache=new WeakMap<object,HistoricConnectionLayout|null>();
const smooth=(t:number)=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};

/** A scenery-only turnout after the pit exit. The full-width road begins
 * inside the GP paving and is trimmed at the actual asphalt boundary.
 * Neither the playable GP centreline nor its physics surface is extended. */
export function createHistoricConnectionLayout(track:ConnectionTrack,oval=createHistoricOvalLayout(track)):HistoricConnectionLayout|null {
  if(cache.has(track))return cache.get(track)!;
  if(track.id!=='monza'||!oval.samples.length){cache.set(track,null);return null;}
  const modern=track.sampleAt(track.nearest(-85,-118).distance);
  const start=modern.point.clone(),old=oval.samples[0],end=new THREE.Vector3(old.x,0,old.z);
  // A shallow branch angle creates a broad road mouth instead of an extended
  // zero-width needle that runs tangentially along the GP edge.
  const approach=modern.tangent.clone().multiplyScalar(Math.cos(Math.PI/6)).addScaledVector(modern.right,-Math.sin(Math.PI/6)).normalize();
  const oldTangent=new THREE.Vector3(old.tangent.x,0,old.tangent.z);
  const curve=new THREE.CubicBezierCurve3(start,start.clone().addScaledVector(approach,26),end.clone().addScaledVector(oldTangent,-23),end);
  curve.arcLengthDivisions=1600;
  const count=Math.ceil(curve.getLength()/.8),samples:HistoricConnectionSample[]=[];let length=0;
  for(let i=0;i<=count;i++){
    const t=i/count,p=curve.getPointAt(t),direction=(i===0?approach.clone():i===count?oldTangent.clone():curve.getTangentAt(t)).setY(0).normalize(),right=new THREE.Vector3(direction.z,0,-direction.x),previous=samples.at(-1),banking=smooth((t-.45)/.55);
    if(previous)length+=Math.hypot(p.x-previous.x,p.z-previous.z);
    samples.push({x:p.x,z:p.z,distance:length,width:oval.width,baseHeight:THREE.MathUtils.lerp(.045,old.baseHeight,banking),bank:old.bank*banking,tangent:{x:direction.x,z:direction.z},right:{x:right.x,z:right.z}});
  }
  const layout:HistoricConnectionLayout={id:'monza-historic-north-connection',samples,length,modernDistance:modern.distance,modernSide:-1,closedToRacing:true,gateSample:Math.round(count*.74),footprintMargin:.65,mergeIntoMainRoad:true,
    artistic:'A closed, shortened maintenance connection with a constant ten-unit road width and shallow-angle GP mouth. The mouth remains level and is physically trimmed at the racing asphalt; the far end matches the old bank. Authored scenery rather than a surveyed or drivable historical junction.'};
  cache.set(track,layout);return layout;
}

export function historicConnectionSurfacePoint(sample:HistoricConnectionSample,u:number):THREE.Vector3 {
  return new THREE.Vector3(sample.x+sample.right.x*(u-.5)*sample.width,sample.baseHeight+4*sample.bank*u*u,sample.z+sample.right.z*(u-.5)*sample.width);
}

/** Distance to the full ribbon/rail strip, interpolating the varying turnout
 * width on every segment. The null case makes non-Monza callers a no-op. */
export function distanceToHistoricConnection(x:number,z:number,layout:HistoricConnectionLayout|null):number {
  if(!layout)return Infinity;
  let best=Infinity;
  for(let i=0;i<layout.samples.length-1;i++){
    const a=layout.samples[i],b=layout.samples[i+1],dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/l,0,1):0;
    const gap=Math.hypot(x-a.x-dx*t,z-a.z-dz*t),radius=THREE.MathUtils.lerp(a.width,b.width,t)/2+layout.footprintMargin;
    best=Math.min(best,gap-radius);
  }
  return Math.max(0,best);
}
export function historicConnectionContains(x:number,z:number,layout:HistoricConnectionLayout|null,margin=0):boolean {
  return distanceToHistoricConnection(x,z,layout)<=Math.max(0,margin);
}
export function historicConnectionTreeExclusion(x:number,z:number,layout:HistoricConnectionLayout|null,margin=7):boolean {
  return historicConnectionContains(x,z,layout,margin);
}

/** Opaque concrete, low rails and a closed maintenance gate all enter the
 * existing spatial architecture batches. The main racing asphalt is untouched. */
export function addMonzaHistoricConnection(root:THREE.Group,track:ConnectionTrack,layout=createHistoricConnectionLayout(track)):HistoricConnectionLayout|null {
  if(!layout)return null;
  const group=new THREE.Group();group.name=layout.id;root.add(group);
  const south=layout.modernSide===1,prefix=layout.id.replace('monza-','');
  if(layout.mergeIntoMainRoad&&!track.roadProjectionAt)throw new Error('A geometric GP projection is required for a finite-width historical merge.');
  const clipSigned=layout.mergeIntoMainRoad?(point:THREE.Vector3)=>{
    const road=track.roadProjectionAt!(point.x,point.z);
    // A millimetre of lateral clearance avoids float32 seam vertices landing
    // on the racing polygon. Top elevations still meet at exactly .045.
    return road.gap-8.15*track.widthAt(road.distance)/(track.width??16)-.001;
  }:undefined;
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  const material=(color:number)=>{let m=materials.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.92});materials.set(color,m);}return m;};
  const mesh=(geometry:THREE.BufferGeometry,color:number,name:string)=>{const m=new THREE.Mesh(geometry,material(color));m.name=name;m.receiveShadow=true;group.add(m);return m;};
  const ribbon=(first:number,last:number,u0:number,u1:number,lift:number,color:number,name:string,solid=false)=>{
    const surface=(i:number,u:number)=>historicConnectionSurfacePoint(layout.samples[i],u);
    let geometry=createHistoricRibbonGeometry({first,last,u0,u1,rows:6,lift,sampleCount:layout.samples.length,
      surfacePoint:solid?surface:(i,u)=>sampledHistoricRibbonPoint(surface,i,u),
      normalAt:(i,u)=>historicRibbonNormal(surface,layout.samples.length,i,u),
      thickness:solid?(i)=>THREE.MathUtils.lerp(.18,.55,layout.samples[i].bank):0});
    if(clipSigned){const clipped=clipHistoricRibbonGeometry(geometry,clipSigned);if(clipped!==geometry)geometry.dispose();geometry=clipped;}
    if(!geometry.getAttribute('position').count){geometry.dispose();return;}
    mesh(geometry,color,name);
  };
  const beam=(a:THREE.Vector3,b:THREE.Vector3,width:number,height:number,color:number,name:string)=>{
    const delta=b.clone().sub(a),geometry=new THREE.BoxGeometry(width,height,delta.length());geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),delta.normalize()));geometry.translate(...a.clone().add(b).multiplyScalar(.5).toArray());mesh(geometry,color,name);
  };
  for(let i=0;i<layout.samples.length-1;i+=12){
    const last=Math.min(layout.samples.length-1,i+12);
    ribbon(i,last,0,1,0,0xb4b6a8,`${prefix}-deck-${i}`,true);
    for(const u of [.26,.68])ribbon(i,last,u-.025,u+.025,.008,0xa4a99c,`${prefix}-wear-${i}-${u}`);
  }
  // Keep the approach mouth open. Rails begin beyond the modern fence crossing,
  // then follow the bank and finish at the old ribbon with identical placement.
  const railFirst=south?0:Math.floor(layout.samples.length*.47);
  let railLast=south?Math.floor(layout.samples.length*.53):layout.samples.length-1;
  if(clipSigned&&south){
    // Both rails finish before the road mouth. Cropping individual rail boxes
    // at asphalt would leave floating cut ends over the racing surface.
    for(let i=railFirst;i<=railLast;i++)if([0,.5,.99].some(u=>clipSigned(historicConnectionSurfacePoint(layout.samples[i],u))<1)){
      railLast=Math.max(railFirst,i-1);break;
    }
  }
  for(let i=railFirst;i<railLast;i++){
    const a=layout.samples[i],b=layout.samples[i+1];
    for(const u of [0,.99])for(const height of [.44,.96]){
      const p=historicConnectionSurfacePoint(a,u),q=historicConnectionSurfacePoint(b,u);p.y+=height;q.y+=height;beam(p,q,.09,.10,0x7f897c,`${prefix}-rail-${i}-${u}-${height}`);
    }
    if(i%8===0)for(const u of [0,.99]){const p=historicConnectionSurfacePoint(a,u);beam(p,p.clone().add(new THREE.Vector3(0,1.13,0)),.1,.1,0x707e70,`${prefix}-post-${i}-${u}`);}
  }
  const gate=layout.samples[layout.gateSample];
  for(const height of [.63,1.18])for(let j=0;j<6;j++){
    const a=historicConnectionSurfacePoint(gate,j/6),b=historicConnectionSurfacePoint(gate,(j+1)/6);a.y+=height;b.y+=height;beam(a,b,.11,.10,0x697d6d,`${prefix}-closed-gate-${height}-${j}`);
  }
  for(const u of [0,.5,1]){const p=historicConnectionSurfacePoint(gate,u);beam(p,p.clone().add(new THREE.Vector3(0,1.4,0)),.14,.14,0x667967,`${prefix}-gate-post-${u}`);}
  group.userData.historicConnection=layout;
  root.userData[south?'historicSouthConnection':'historicConnection']=layout;
  root.userData.historicConnections=[...(root.userData.historicConnections??[]),layout];
  return layout;
}
