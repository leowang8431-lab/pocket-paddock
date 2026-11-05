import * as THREE from 'three';

export const SPA_PIT_LAYOUT=Object.freeze({fastCenterX:-63,fastHalfWidth:6,dividerWidth:2,apronMinX:-57,apronMaxX:-31,garageFrontX:-49,stopX:-51,serviceMinZ:84,serviceMaxZ:252,serviceY:0,exitOffset:22,exitMergeAfterLaSource:130});
export const SPA_PIT_REFERENCE='https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_quarantine_zone_and_red_zones.pdf';
interface Host {width:number;length:number;sampleAt(distance:number):{point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3};roadProjectionAt(x:number,z:number):{height:number;gap:number};}
export interface SpaPitProfile {entryRaceDistance:number;exitRaceDistance:number;entryFlatArc:number;exitFlatArc:number;length:number;surfacePolicy:string;reference:string;}
const smooth=(t:number)=>{const n=THREE.MathUtils.clamp(t,0,1);return n*n*n*(10+n*(-15+6*n));};

/** F1 pit route on the driver's right, departing between T18 and T19.
 * The F1 garages lie east of the real start straight; the previous route
 * mirrored them onto the outside of the circuit and bypassed all of T18.
 * Ramp heights use actual horizontal arc distance, never an index fraction. */
export function createSpaPitPath(track:Host,entryDistance:number,laSourceDistance:number){
 const entryStation=track.sampleAt(entryDistance),entry=entryStation.point,exitDistance=laSourceDistance+SPA_PIT_LAYOUT.exitMergeAfterLaSource;
 // Continue the first chicane turn while the race road bends left through
 // T19. A broad tangent-continuous ramp reaches the service slab without
 // crossing that race road or the garage end wall. Its minimum plan radius
 // is about 19u, leaving the complete 12u carriageway regular on both edges.
 const leadEnd=new THREE.Vector3(SPA_PIT_LAYOUT.fastCenterX,0,SPA_PIT_LAYOUT.serviceMaxZ),lead=new THREE.CubicBezierCurve3(entry.clone().setY(0),entry.clone().setY(0).addScaledVector(entryStation.tangent,55),new THREE.Vector3(SPA_PIT_LAYOUT.fastCenterX,0,SPA_PIT_LAYOUT.serviceMaxZ+30),leadEnd),points=lead.getSpacedPoints(Math.ceil(lead.getLength()/1.2));
 const arcs=[0];for(let i=1;i<points.length;i++)arcs.push(arcs.at(-1)!+points[i].distanceTo(points[i-1]));
 const entryFlatArc=arcs.at(-1)!,overlap=points.findIndex(p=>track.roadProjectionAt(p.x,p.z).gap>track.width/2+SPA_PIT_LAYOUT.fastHalfWidth+.5),join=Math.max(1,overlap),blendStart=arcs[join],startHeight=track.roadProjectionAt(points[join].x,points[join].z).height,previousHeight=track.roadProjectionAt(points[join-1].x,points[join-1].z).height,run=entryFlatArc-blendStart,secant=-startHeight/run,rawSlope=(startHeight-previousHeight)/(arcs[join]-arcs[join-1]),slope=secant>=0?THREE.MathUtils.clamp(rawSlope,0,3*secant):THREE.MathUtils.clamp(rawSlope,3*secant,0);
 for(let i=0;i<points.length;i++){const p=points[i];if(i<=join){p.y=track.roadProjectionAt(p.x,p.z).height;continue;}const t=THREE.MathUtils.clamp((arcs[i]-blendStart)/run,0,1);p.y=(2*t*t*t-3*t*t+1)*startHeight+(t*t*t-2*t*t+t)*run*slope;}
 for(let z=SPA_PIT_LAYOUT.serviceMaxZ-2;z>=72;z-=2)points.push(new THREE.Vector3(SPA_PIT_LAYOUT.fastCenterX,0,z));
 let exitFlatArc=entryFlatArc+SPA_PIT_LAYOUT.serviceMaxZ-72;const holdUntil=laSourceDistance+50,blendEnd=exitDistance,exitPoints:THREE.Vector3[]=[];
 for(let distance=30;distance<exitDistance;distance+=2){
  // The pit exit rounds the INSIDE of the tight La Source hairpin. Keeping
  // the straight's full 22u offset here would turn its inner radius negative.
  // Draw it in smoothly before T1, retain a positive centreline radius, then
  // merge only after the corner. Track owns any coplanar shared edge paving.
  const s=track.sampleAt(distance),innerOffset=THREE.MathUtils.lerp(SPA_PIT_LAYOUT.exitOffset,6.5,smooth((distance-30)/80)),offset=-innerOffset*(1-smooth((distance-holdUntil)/(blendEnd-holdUntil))),p=s.point.clone().addScaledVector(s.right,offset),height=track.roadProjectionAt(p.x,p.z).height;
  p.y=height*smooth((distance-30)/60);if(distance===30)exitFlatArc+=p.distanceTo(points.at(-1)!);exitPoints.push(p);
 }
 const end=track.sampleAt(exitDistance).point.clone();end.y=track.roadProjectionAt(end.x,end.z).height;exitPoints.push(end);
 // The race path has short authored curve stitches. Differentiating their
 // normals directly at a large inner offset magnifies those stitches into
 // cusps. Smooth the independently driven pit centreline before sampling its
 // actual road ribbon; road and physics both use these same final points.
 const exitCurve=new THREE.CatmullRomCurve3(exitPoints,false,'centripetal');exitCurve.arcLengthDivisions=6000;
 points.push(...exitCurve.getSpacedPoints(Math.ceil(exitCurve.getLength()/.6)));
 let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
 const profile:SpaPitProfile={entryRaceDistance:entryDistance,exitRaceDistance:exitDistance,entryFlatArc,exitFlatArc,length,surfacePolicy:'Driver-right F1 pit entry between T18/T19, level apron, arc-distance ramp, positive-radius inner La Source bypass and merge after T1; main road owns shared paving.',reference:SPA_PIT_REFERENCE};
 return{points,profile};
}

/** The shared slab continues under the garages as an interior floor; only
 * the exterior apron beyond their front wall is a drivable service surface. */
export function isSpaPitApron(x:number,z:number){return x>=SPA_PIT_LAYOUT.apronMinX&&x<SPA_PIT_LAYOUT.garageFrontX-.05&&z>=SPA_PIT_LAYOUT.serviceMinZ&&z<=SPA_PIT_LAYOUT.serviceMaxZ;}
