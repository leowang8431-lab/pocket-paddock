import * as THREE from 'three';
import type {Track} from './track';
import {createHistoricRibbonGeometry,historicRibbonNormal,sampledHistoricRibbonPoint} from './historic-ribbon-geometry';
import {createHistoricSouthPlan} from './monza-historic-south-plan';

export const MONZA_HISTORIC_OVAL_REFERENCES=[
  'https://www.monzanet.it/autodromo-di-monza-storia/',
  'https://www.monzanet.it/tracciato-pista-monza/',
] as const;
export type HistoricOvalSection='north-banking'|'east-straight'|'south-banking';
export interface HistoricOvalSample {
  x:number;z:number;distance:number;baseHeight:number;bank:number;
  tangent:{x:number;z:number};right:{x:number;z:number};section:HistoricOvalSection;
}
export interface HistoricOvalSupport {sample:number;minRoadClearance:number;footprint:{x:number;z:number}[]}
export interface HistoricOvalLayout {
  id:'monza-historic-oval';width:number;outerSlope:number;bankRise:number;length:number;
  samples:HistoricOvalSample[];supports:HistoricOvalSupport[];
  sections:{id:HistoricOvalSection;first:number;last:number}[];
  references:readonly string[];artistic:string;minimumBridgeUnderside:number;
  bridgeProfile:typeof MONZA_HISTORIC_BRIDGE_PROFILE;
  bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
}
type OvalTrack=Pick<Track,'id'|'nearest'|'isPitLane'|'widthAt'|'sampleAt'>;
const layouts=new WeakMap<object,HistoricOvalLayout>();
const smooth=(value:number)=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
const roundControls=(points:number[][])=>{
  const result=[points[0]];
  for(let i=0;i<points.length-1;i++)for(const t of [.25,.75])result.push([THREE.MathUtils.lerp(points[i][0],points[i+1][0],t),THREE.MathUtils.lerp(points[i][1],points[i+1][1],t)]);
  result.push(points[points.length-1]);return result;
};
// One corner-cutting pass rounds the small facility-avoidance offsets into a
// broad old bend. Its full road/rail/rib footprint still clears the 21 stands
// and Serraglio gate; additional passes would close that gate's safety gap.
const NORTH=roundControls([[-30,-150],[-10,-179],[30,-188],[70,-183],[91,-202],[121,-194],[147.4507,-152.1209],[165,-90],[185,-65]]);
const WIDTH=10,FOOTPRINT_HALF_WIDTH=5.8,SLAB=.55;

/** Arc-length coordinates keep the bridge grade independent of nearby GP bends.
 * These are miniature scenery dimensions; the modern driving road is untouched. */
export const MONZA_HISTORIC_BRIDGE_PROFILE={
  riseStart:102,deckStart:184,deckEnd:267,descentEnd:349,
  transitionLength:12,groundHeight:.14,deckHeight:9.25,
  description:'Level deck with no crossfall; equal-length approaches have a constant-grade middle and short, tangent-continuous vertical transitions.',
} as const;

// Integral of a trapezoidal grade: the long middle has a constant slope,
// with a quadratic height transition to zero grade at both ends (C1).
function roundedLinearRamp(distance:number,start:number,end:number):number {
  const length=end-start,t=THREE.MathUtils.clamp((distance-start)/length,0,1),e=MONZA_HISTORIC_BRIDGE_PROFILE.transitionLength/length;
  if(t<e)return t*t/(2*e*(1-e));
  if(t>1-e)return 1-(1-t)*(1-t)/(2*e*(1-e));
  return (t-e/2)/(1-e);
}
export function historicBridgeProfileAt(distance:number):{height:number;northBankMultiplier:number} {
  const p=MONZA_HISTORIC_BRIDGE_PROFILE,up=roundedLinearRamp(distance,p.riseStart,p.deckStart),down=roundedLinearRamp(distance,p.deckEnd,p.descentEnd);
  return {height:p.groundHeight+(p.deckHeight-p.groundHeight)*up*(1-down),northBankMultiplier:1-up};
}

/** These are authored miniature positions, not a survey or a second driveable
 * track. The shared west straight is intentionally not duplicated through the
 * modern garages. Every height is scenery-only and never enters Track. */
export function createHistoricOvalLayout(track:OvalTrack):HistoricOvalLayout {
  const cached=layouts.get(track);if(cached)return cached;
  const samples:HistoricOvalSample[]=[],sections:HistoricOvalLayout['sections']=[];
  let distance=0;
  if(track.id==='monza'){
    // The north spline ends on the vertical east straight. The southern
    // sweep starts there with the same tangent and is shared with its merge.
    const controls=[...NORTH,[185,-5],[185,65],[185,140]],south=createHistoricSouthPlan(track);
    const curve=new THREE.CatmullRomCurve3(controls.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');curve.arcLengthDivisions=3600;
    const arcLengths=curve.getLengths(curve.arcLengthDivisions),atControl=(index:number)=>{
      const offset=index/(controls.length-1)*curve.arcLengthDivisions,lo=Math.floor(offset),fraction=offset-lo;
      return THREE.MathUtils.lerp(arcLengths[lo],arcLengths[Math.min(lo+1,arcLengths.length-1)],fraction);
    };
    const northEnd=atControl(NORTH.length-1),southStart=curve.getLength(),totalLength=southStart+south.splitArc,count=Math.ceil(totalLength/2.4);
    for(let i=0;i<=count;i++){
      const at=totalLength*i/count,point=at<=southStart?curve.getPointAt(at/southStart):south.sampleAtArc(at-southStart).point;
      const tangent=at<=southStart?curve.getTangentAt(at/southStart).normalize():south.sampleAtArc(at-southStart).tangent,right=new THREE.Vector3(tangent.z,0,-tangent.x);
      const previous=samples.at(-1);if(previous)distance+=Math.hypot(point.x-previous.x,point.z-previous.z);
      const id:HistoricOvalSection=distance<=northEnd?'north-banking':distance<southStart?'east-straight':'south-banking';
      const profile=historicBridgeProfileAt(distance);
      // The north bank flattens during the climb, stays flat over Serraglio,
      // and never returns during descent. Every transverse deck point is level.
      // The southern historic bank retains its original cross-section.
      const bank=id==='north-banking'?smooth((northEnd-distance)/28)*profile.northBankMultiplier:id==='south-banking'?smooth((distance-southStart)/28):0;
      const baseHeight=profile.height;
      samples.push({x:point.x,z:point.z,distance,baseHeight,bank,tangent:{x:tangent.x,z:tangent.z},right:{x:right.x,z:right.z},section:id});
      if(sections.at(-1)?.id!==id)sections.push({id,first:i?i-1:0,last:i});else sections[sections.length-1].last=i;
    }
  }
  const supports:HistoricOvalSupport[]=[];let nextSupport=4;
  for(let i=1;i<samples.length-1;i++){
    const sample=samples[i];if((sample.bank<.3&&sample.baseHeight<.9)||sample.distance<nextSupport)continue;
    nextSupport=sample.distance+9.5;
    const footprint:{x:number;z:number}[]=[];let minRoadClearance=Infinity;
    // This checks the entire rib/footing strip, not only the column centres.
    // Omit every ground rib over GP asphalt, runoff or its catch fence; the
    // continuous high deck and edge stringers span that intentionally open bay.
    for(const offset of [-5.45,-2.5,0,2.5,5.45])for(const along of [-.42,.42]){
      const x=sample.x+sample.right.x*offset+sample.tangent.x*along,z=sample.z+sample.right.z*offset+sample.tangent.z*along,road=track.nearest(x,z);
      footprint.push({x,z});minRoadClearance=Math.min(minRoadClearance,Math.hypot(x-road.point.x,z-road.point.z));
      if(track.isPitLane(x,z))minRoadClearance=0;
    }
    if(minRoadClearance>26.8)supports.push({sample:i,minRoadClearance,footprint});
  }
  const footprint=samples.flatMap(sample=>[-FOOTPRINT_HALF_WIDTH,FOOTPRINT_HALF_WIDTH].map(offset=>({x:sample.x+sample.right.x*offset,z:sample.z+sample.right.z*offset})));
  const layout:HistoricOvalLayout={id:'monza-historic-oval',width:WIDTH,outerSlope:.8,bankRise:4,length:distance,samples,supports,sections,references:MONZA_HISTORIC_OVAL_REFERENCES,
    minimumBridgeUnderside:8.6,bridgeProfile:MONZA_HISTORIC_BRIDGE_PROFILE,bounds:footprint.length?{minX:Math.min(...footprint.map(p=>p.x)),maxX:Math.max(...footprint.map(p=>p.x)),minZ:Math.min(...footprint.map(p=>p.z)),maxZ:Math.max(...footprint.map(p=>p.z))}:{minX:0,maxX:0,minZ:0,maxZ:0},
    artistic:'Scenery-only, shortened north/south banking and the inner east straight. The official 1955 oval had a 4,250 m length, 320 m bend radius and progressive 80% banking. The game uses a 10-unit ribbon, a parabolic cross-section reaching an outer slope of 0.8 and a 4-unit rise; its compressed plan avoids the 21 retained artistic grandstands. The north GP underpass has a level, unbanked deck from arc length 184 to 267, with 82-unit approaches and 12-unit tangent-continuous transitions around constant-grade middles. This bridge profile is an artistic readability adjustment, not a surveyed historical profile. The shared west leg is represented by closed maintenance ends instead of a fictional road through the modern pit buildings.'};
  layouts.set(track,layout);return layout;
}
export const createMonzaHistoricOvalLayout=createHistoricOvalLayout;

/** Horizontal distance from the old road, guardrail and supporting rib strip.
 * Vehicles/trees can query this without importing a scenery or safety builder. */
export function distanceToHistoricOval(x:number,z:number,layout:HistoricOvalLayout):number {
  let best=Infinity;
  for(let i=0;i<layout.samples.length-1;i++){
    const a=layout.samples[i],b=layout.samples[i+1],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz,t=length?THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/length,0,1):0;
    best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
  }
  return Math.max(0,best-FOOTPRINT_HALF_WIDTH);
}
export function historicOvalTreeExclusion(x:number,z:number,layout:HistoricOvalLayout,margin=7):boolean {
  if(!layout.samples.length)return false;
  const b=layout.bounds;if(x<b.minX-margin||x>b.maxX+margin||z<b.minZ-margin||z>b.maxZ+margin)return false;
  return distanceToHistoricOval(x,z,layout)<=Math.max(0,margin);
}
export function historicOvalFootprint(layout:HistoricOvalLayout):{x:number;z:number}[] {
  return layout.samples.flatMap(sample=>[-FOOTPRINT_HALF_WIDTH,FOOTPRINT_HALF_WIDTH].map(offset=>({x:sample.x+sample.right.x*offset,z:sample.z+sample.right.z*offset})));
}
/** u=0 is the low inner lip, u=1 is the raised outside. dy/dx at the
 * outside is exactly 0.8 for the complete bank, with a level inner tangent. */
export function historicOvalSurfacePoint(sample:HistoricOvalSample,u:number):THREE.Vector3 {
  const offset=(u-.5)*WIDTH;
  return new THREE.Vector3(sample.x+sample.right.x*offset,sample.baseHeight+4*sample.bank*u*u,sample.z+sample.right.z*offset);
}

/** Build short opaque pieces so the existing spatial architecture batching
 * can cull them with the nearby park cells. No downloaded meshes or textures. */
export function addMonzaHistoricOval(root:THREE.Group,track:OvalTrack,layout=createHistoricOvalLayout(track)):HistoricOvalLayout {
  if(track.id!=='monza')return layout;
  const group=new THREE.Group();group.name='monza-historic-oval';root.add(group);
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  const material=(color:number)=>{let result=materials.get(color);if(!result){result=new THREE.MeshStandardMaterial({color,roughness:.91});materials.set(color,result);}return result;};
  let meshes=0,triangles=0;
  const mesh=(geometry:THREE.BufferGeometry,color:number,name:string)=>{
    const object=new THREE.Mesh(geometry,material(color));object.name=name;object.receiveShadow=true;object.castShadow=false;group.add(object);meshes++;triangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;return object;
  };
  const quad=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3,color:number,name:string)=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([...a.toArray(),...b.toArray(),...c.toArray(),...d.toArray()],3));geometry.setIndex([0,2,1,1,2,3]);geometry.computeVertexNormals();return mesh(geometry,color,name);
  };
  const beam=(a:THREE.Vector3,b:THREE.Vector3,width:number,height:number,color:number,name:string)=>{
    const delta=b.clone().sub(a),geometry=new THREE.BoxGeometry(width,height,delta.length());geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),delta.normalize()));geometry.translate(...a.clone().add(b).multiplyScalar(.5).toArray());return mesh(geometry,color,name);
  };
  const ribbon=(first:number,last:number,u0:number,u1:number,lift:number,thickness:number,color:number,name:string)=>{
    const surfacePoint=(i:number,u:number)=>historicOvalSurfacePoint(layout.samples[i],u);
    const geometry=createHistoricRibbonGeometry({
      surfacePoint:thickness?surfacePoint:(i,u)=>sampledHistoricRibbonPoint(surfacePoint,i,u),
      sampleCount:layout.samples.length,first,last,u0,u1,rows:u1-u0<.15?1:6,lift,thickness,
      normalAt:(i,u)=>historicRibbonNormal(surfacePoint,layout.samples.length,i,u),
    });
    return mesh(geometry,color,name);
  };
  // Deck slabs, quiet concrete joints and thin, broad wear tracks. Unlike
  // random cracks, these remain legible without adding lots of thin line draws.
  for(const section of layout.sections)for(let start=section.first;start<section.last;start+=10){
    const end=Math.min(section.last,start+10),straight=section.id==='east-straight';
    ribbon(start,end,0,1,0,straight?.17:SLAB,straight?0x747b72:0xb4b6a8,`historic-${section.id}-deck-${start}`);
    if(!straight){
      for(const u of [.26,.68])ribbon(start,end,u-.028,u+.028,.008,0,0xa4a99c,`historic-concrete-wear-${start}-${u}`);
      for(const u of [.34,.67])ribbon(start,end,u-.0025,u+.0025,.014,0,0x929a8b,`historic-longitudinal-joint-${start}-${u}`);
      for(const u of [.06,.95])ribbon(start,end,u-.012,u+.012,-.4,.25,0x979f8d,`historic-continuous-under-deck-stringer-${start}-${u}`);
      if(start%30===0)ribbon(start,Math.min(end,start+3),.42,.57,.011,0,0xa9af9e,`historic-maintained-concrete-patch-${start}`);
    }else{
      ribbon(start,end,.035,.044,.008,0,0xb7b7a1,`historic-east-edge-paint-${start}`);
      ribbon(start,end,.953,.962,.008,0,0xb7b7a1,`historic-east-edge-paint-${start}-outer`);
    }
  }
  let nextJoint=5,nextPost=0,nextGrass=12;
  for(let i=0;i<layout.samples.length-1;i++){
    const sample=layout.samples[i],next=layout.samples[i+1];
    if(sample.section!=='east-straight'&&sample.distance>=nextJoint){
      nextJoint=sample.distance+11.7;
      for(let j=0;j<6;j++){
        const a=historicOvalSurfacePoint(sample,j/6),b=historicOvalSurfacePoint(sample,(j+1)/6),c=a.clone().add(new THREE.Vector3(sample.tangent.x*.065,0,sample.tangent.z*.065)),d=b.clone().add(new THREE.Vector3(sample.tangent.x*.065,0,sample.tangent.z*.065));
        for(const p of [a,b,c,d])p.y+=.018;quad(a,b,c,d,0x8f9787,`historic-expansion-joint-${i}-${j}`);
      }
    }
    // Low, maintained old steel barrier. Outer posts follow the actual bank
    // surface instead of floating at a constant elevation around the bend.
    for(const u of [.99])for(const height of [.44,.96]){
      const a=historicOvalSurfacePoint(sample,u),b=historicOvalSurfacePoint(next,u);a.y+=height;b.y+=height;beam(a,b,.09,.10,0x7f897c,`historic-outer-rail-${i}-${height}`);
    }
    if(sample.distance>=nextPost){
      nextPost=sample.distance+7.2;
      const p=historicOvalSurfacePoint(sample,.99);beam(p,p.clone().add(new THREE.Vector3(0,1.13,0)),.1,.1,0x707e70,`historic-outer-post-${i}`);
    }
    if(sample.distance>=nextGrass&&sample.baseHeight<.55){
      nextGrass=sample.distance+29;
      const p=historicOvalSurfacePoint(sample,.012);
      for(let j=0;j<3;j++){
        const a=p.clone().add(new THREE.Vector3(-.15+j*.12,.018,-.10+j*.08)),b=a.clone().add(new THREE.Vector3(.18,0,.02)),c=a.clone().add(new THREE.Vector3(.07,.24+j*.035,.05));
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([...a.toArray(),...b.toArray(),...c.toArray(),...b.toArray(),...a.toArray(),...c.toArray()],3));geometry.computeVertexNormals();mesh(geometry,0x7a8b53,`historic-inner-grass-${i}-${j}`);
      }
    }
  }
  for(const support of layout.supports){
    const sample=layout.samples[support.sample],shape=new THREE.Shape();
    const thickness=sample.section==='east-straight'?.17:SLAB;
    const deckY=(u:number)=>Math.max(.10,sample.baseHeight+4*sample.bank*u*u-thickness+.015);
    shape.moveTo(-5.05,.06);shape.lineTo(5.05,.06);
    for(let j=6;j>=0;j--)shape.lineTo((j/6-.5)*10,deckY(j/6));shape.closePath();
    if(sample.baseHeight>1.5){
      const hole=new THREE.Path(),left=-4.35,right=4.35,bottom=.15,apex=Math.max(.3,sample.baseHeight-.82);
      hole.moveTo(left,bottom);hole.lineTo(left,.28);hole.quadraticCurveTo(0,apex*1.75,right,.28);hole.lineTo(right,bottom);hole.closePath();shape.holes.push(hole);
    }else if(sample.bank>.62){
      const hole=new THREE.Path();hole.moveTo(1.15,.15);hole.lineTo(1.15,.26);hole.quadraticCurveTo(2.8,2.3*sample.bank,4.45,.26);hole.lineTo(4.45,.15);hole.closePath();shape.holes.push(hole);
    }
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.38,bevelEnabled:false,curveSegments:7,steps:1});geometry.translate(0,0,-.19);
    const right=new THREE.Vector3(sample.right.x,0,sample.right.z),tangent=new THREE.Vector3(sample.tangent.x,0,sample.tangent.z),matrix=new THREE.Matrix4().makeBasis(right,new THREE.Vector3(0,1,0),tangent);geometry.applyMatrix4(matrix);geometry.translate(sample.x,0,sample.z);
    mesh(geometry,0xa0a694,`historic-open-arch-rib-${support.sample}`);
    for(const offset of [-4.8,4.8]){
      const p=new THREE.Vector3(sample.x+sample.right.x*offset,.10,sample.z+sample.right.z*offset),geometry=new THREE.BoxGeometry(.78,.20,.80).applyMatrix4(matrix).translate(p.x,p.y,p.z);mesh(geometry,0x8f9987,`historic-rib-foot-${support.sample}-${offset}`);
    }
  }
  // Both maintenance closures live on their connecting branches, leaving the
  // old banking seams continuous instead of ending behind a floating gate.
  group.userData.historicOval={...layout,meshes,triangles,closedToRacing:true,sharedWestLegNotDuplicated:true};
  root.userData.historicOval=group.userData.historicOval;return layout;
}
