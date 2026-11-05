import {MONZA_GARAGE_COLLIDER,MONZA_PIT_LAYOUT,isMonzaPitApron} from './monza-pit-layout';
import * as THREE from 'three';
import { mergeGeometries,mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStandLayouts, standCollider } from './stand-layout';
import {asphaltTexture,catchFenceMaterial} from './monza-details';
import {createWidthZones,roadWidthAt,type WidthZone} from './track-width';
import {createSpaDefinition,buildSpaTrack,isSpaGravel} from './spa-track';
import {SpaElevationProfile} from './spa-elevation';
import {createSpaPitPath,isSpaPitApron,SPA_PIT_LAYOUT,type SpaPitProfile} from './spa-pit-layout';
import {MonacoDrivingTrack,MONACO_GAME_SCALE,monacoSteeringAngleForSpeed,type MonacoBarrierSegment} from './monaco-drive-track';
import type {MonacoLayout} from './monaco-layout';
import {createHistoricConnectionLayout,historicConnectionContains,type HistoricConnectionLayout} from './monza-historic-connection';
import {createHistoricSouthConnectionLayout} from './monza-historic-south-connection';
import {clipHistoricRibbonGeometry} from './historic-ribbon-geometry';
export type CircuitId='monza'|'spa'|'monaco';

/** Scaled, widened Monza GP layout. Metres here are game units, not survey data. */
export interface TrackSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  distance: number;
  index: number;
  t: number;
}

interface SampleNode {
  minX:number; maxX:number; minZ:number; maxZ:number;
  indices?:number[];
  left?:SampleNode; right?:SampleNode;
}
interface PitSegment {
  x:number; y:number; z:number; dx:number; dy:number; dz:number; lengthSquared:number;
}

/** Immutable two-dimensional tree. Its box bound makes the lookup exact even
 * near adjacent track sections, after a reset, or far outside the circuit. */
function sampleTree(samples:readonly TrackSample[],indices:number[]):SampleNode {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const index of indices){const p=samples[index].point;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const node:SampleNode={minX,maxX,minZ,maxZ};
  if(indices.length<=8){node.indices=indices;return node;}
  const axis=maxX-minX>=maxZ-minZ?'x':'z';
  indices.sort((a,b)=>samples[a].point[axis]-samples[b].point[axis]||a-b);
  const middle=indices.length>>1;
  node.left=sampleTree(samples,indices.slice(0,middle));
  node.right=sampleTree(samples,indices.slice(middle));
  return node;
}
function squaredBoxDistance(x:number,z:number,node:SampleNode):number {
  const dx=Math.max(node.minX-x,0,x-node.maxX),dz=Math.max(node.minZ-z,0,z-node.maxZ);
  return dx*dx+dz*dz;
}

/** Signed distance to the actual finite-width connection polygons. Ground is
 * removed under their opaque decks instead of competing with them in depth.
 * This deliberately excludes the wider furniture/tree clearance margins. */
type GroundClipper={signed:(point:THREE.Vector3)=>number;intersects:(minX:number,maxX:number,minZ:number,maxZ:number)=>boolean};
function historicGroundClipper(layouts:(HistoricConnectionLayout|null)[]):GroundClipper {
  const polygons=layouts.filter((layout):layout is HistoricConnectionLayout=>!!layout).map(layout=>{
    const edge=(side:number)=>layout.samples.map(sample=>({x:sample.x+sample.right.x*sample.width/2*side,z:sample.z+sample.right.z*sample.width/2*side}));
    const points=[...edge(-1),...edge(1).reverse()];
    return {points,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
  });
  const signed=(point:THREE.Vector3)=>{
    let best=Infinity;
    for(const polygon of polygons){
      const {points}=polygon;
      if(point.x<polygon.minX||point.x>polygon.maxX||point.z<polygon.minZ||point.z>polygon.maxZ){best=Math.min(best,1);continue;}
      let inside=false,distanceSquared=Infinity;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const a=points[j],b=points[i],dx=b.x-a.x,dz=b.z-a.z,lengthSquared=dx*dx+dz*dz;
        const t=lengthSquared?THREE.MathUtils.clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/lengthSquared,0,1):0;
        distanceSquared=Math.min(distanceSquared,(point.x-a.x-dx*t)**2+(point.z-a.z-dz*t)**2);
        if((a.z>point.z)!==(b.z>point.z)&&point.x<(b.x-a.x)*(point.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
      }
      best=Math.min(best,(inside?-1:1)*Math.sqrt(distanceSquared));
    }
    return best;
  };
  return {signed,intersects:(minX,maxX,minZ,maxZ)=>polygons.some(p=>maxX>=p.minX&&minX<=p.maxX&&maxZ>=p.minZ&&minZ<=p.maxZ)};
}

export class Track {
  readonly group = new THREE.Group();
  readonly width:number;
  readonly barrierOffset=24;
  readonly widthZones:readonly WidthZone[];
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly checkpoints: number[];
  readonly corners: { name: string; distance: number }[];
  /** Solid ground-level structures, shared with the vehicle collision solver. */
  readonly colliders: {minX:number;maxX:number;minZ:number;maxZ:number}[];
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly elevationProfile?:SpaElevationProfile;
  readonly spaPitProfile?:SpaPitProfile;
  private readonly pitCurve: THREE.CatmullRomCurve3;
  private readonly pitSamples:THREE.Vector3[];
  private readonly pitBounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  private readonly nearestTree:SampleNode;
  private lastX=NaN; private lastZ=NaN; private lastNearest?:TrackSample;
  private readonly pitCells=new Map<number,Map<number,PitSegment[]>>();
  private readonly pitCellSize=12;
  private terrainGrid?:{minX:number;maxX:number;minZ:number;maxZ:number;nx:number;nz:number};
  readonly monacoDrive?:MonacoDrivingTrack;
  readonly monacoLayout?:MonacoLayout;
  readonly monacoScale=MONACO_GAME_SCALE;
  readonly steeringAngleForSpeed?:((speed:number)=>number);
  private readonly emptyBarrierSegments:MonacoBarrierSegment[]=[];

  constructor(readonly id:CircuitId='monza') {
    if(id==='monaco'){
      const m=new MonacoDrivingTrack();this.monacoDrive=m;this.monacoLayout=m.layout;this.width=m.width;this.length=m.length;this.widthZones=[];this.samples.push(...m.samples);this.nearestTree=sampleTree(this.samples,this.samples.map(s=>s.index));this.curve=new THREE.CatmullRomCurve3(this.samples.map(s=>s.point),true,'centripetal');this.pitSamples=m.pitPath;this.pitCurve=new THREE.CatmullRomCurve3(this.pitSamples,false,'centripetal');const radius=m.pitProfile.fastWidth/2+m.pitProfile.apronWidth;this.pitBounds={minX:Math.min(...this.pitSamples.map(p=>p.x))-radius,maxX:Math.max(...this.pitSamples.map(p=>p.x))+radius,minZ:Math.min(...this.pitSamples.map(p=>p.z))-radius,maxZ:Math.max(...this.pitSamples.map(p=>p.z))+radius};this.indexPitSegments();this.checkpoints=Array.from({length:24},(_,i)=>i*this.length/24);this.corners=m.corners;this.colliders=[];this.steeringAngleForSpeed=monacoSteeringAngleForSpeed;this.group.add(m.group);this.group.userData.monaco=m.group.userData.monacoDriving;return;
    }
    this.width=id==='spa'?11:16;
    // Start on the pit straight. Clockwise: Rettifilo R/L, Biassono R,
    // Roggia L/R, Lesmo R/R, Serraglio, Ascari L/R/L, Alboreto R.
    const spa=id==='spa'?createSpaDefinition():undefined;
    const points = spa?.points??[
      [-85,100],[-85,45],[-85,-30],[-85,-100],[-85,-118],
      [-80,-141],[-62,-161],[-54,-184],[-50,-204],
      [-39,-218],[-12,-247],[25,-273],[67,-296],[109,-317],
      [132,-331],[149,-348],[169,-348],[187,-334],[199,-327],
      [222,-310],[231,-289],[231,-260],[230,-237],
      [217,-218],[195,-207],[170,-186],[145,-148],[120,-102],
      [99,-61],[83,-36],[88,-8],[73,20],[52,42],[41,68],
      [24,100],[-1,153],[-18,189],[-37,214],[-60,222],
      [-80,213],[-88,192],[-85,165],
    ].map(([x,z]) => new THREE.Vector3(x,0,z));
    this.curve = new THREE.CatmullRomCurve3(points,true,'centripetal',0.35);
    this.curve.arcLengthDivisions = id==='spa'?300000:6000;
    this.length = this.curve.getLength();
    if(id==='spa')this.elevationProfile=new SpaElevationProfile(this.length,d=>this.curve.getPointAt(d/this.length).y);
    for (let i=0; i<1600; i++) {
      const t=i/1600;
      const tangent=this.curve.getTangentAt(t).setY(0).normalize();
      const point=this.curve.getPointAt(t);if(this.elevationProfile)point.y=this.elevationProfile.at(t*this.length).height;
      this.samples.push({point,tangent,
        right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:t*this.length,index:i,t});
    }
    this.nearestTree=sampleTree(this.samples,this.samples.map(s=>s.index));
    if(id==='spa'){
      const entry=this.nearest(spa!.corners.at(-1)!.x,spa!.corners.at(-1)!.z).distance,laSource=this.nearest(spa!.corners[0].x,spa!.corners[0].z).distance,pit=createSpaPitPath(this,entry,laSource);
      this.pitSamples=pit.points;this.spaPitProfile=pit.profile;this.pitCurve=new THREE.CatmullRomCurve3(pit.points,false,'centripetal');
    }else{this.pitCurve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(-85,0,181),new THREE.Vector3(-63,0,151),new THREE.Vector3(-63,0,90),
      new THREE.Vector3(-63,0,0),new THREE.Vector3(-63,0,-78),new THREE.Vector3(-85,0,-108),
    ],false,'centripetal');this.pitSamples=this.pitCurve.getPoints(180);}
    const radius=Math.sqrt(36.5);this.pitBounds={minX:Math.min(...this.pitSamples.map(p=>p.x))-radius,maxX:Math.max(...this.pitSamples.map(p=>p.x))+radius,minZ:Math.min(...this.pitSamples.map(p=>p.z))-radius,maxZ:Math.max(...this.pitSamples.map(p=>p.z))+radius};
    this.indexPitSegments();
    this.checkpoints=Array.from({length:24},(_,i)=>i*this.length/24);
    this.corners = (spa?.corners??[
      {name:'Rettifilo · 第一减速弯',x:-66,z:-153},
      {name:'Biassono · 大弯',x:26,z:-273},
      {name:'Roggia · 第二减速弯',x:153,z:-347},
      {name:'Lesmo 1 · 莱斯莫一号',x:229,z:-290},
      {name:'Lesmo 2 · 莱斯莫二号',x:218,z:-219},
      {name:'Serraglio · 森林直道',x:143,z:-145},
      {name:'Ascari · 阿斯卡里',x:81,z:0},
      {name:'Alboreto · 抛物线弯',x:-59,z:221},
    ]).map(c=>({name:c.name,distance:this.nearest(c.x,c.z).distance}));
    this.widthZones=id==='spa'?[]:createWidthZones(this.corners);
    this.group.userData.widthZones=this.widthZones;
    this.colliders=id==='spa'?[]:[{minX:-74.3,maxX:-73.3,minZ:-75,maxZ:143},{...MONZA_GARAGE_COLLIDER}];
    if(id==='monza'){this.colliders.push(...createStandLayouts(this).map(standCollider));this.build();}
    else buildSpaTrack(this,this.pitSamples);
    this.batchStaticGeometry();
  }

  sampleAt(distance:number): TrackSample {
    if(this.monacoDrive)return this.monacoDrive.sampleAt(distance);
    const d=((distance%this.length)+this.length)%this.length;
    const t=d/this.length;
    const point=this.curve.getPointAt(t);
    if(this.elevationProfile)point.y=this.elevationProfile.at(d).height;
    const tangent=this.curve.getTangentAt(t).setY(0).normalize();
    return {point,tangent,right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:d,t,index:Math.floor(t*this.samples.length)%this.samples.length};
  }

  /** Read-only geometry shared by the pit autopilot and the rendered road. */
  get pitPath():readonly Readonly<THREE.Vector3>[]{return this.pitSamples;}
  get barrierSegments():MonacoBarrierSegment[]{return this.monacoDrive?.barriers??this.emptyBarrierSegments;}
  barrierSegmentsAt(x:number,z:number){return this.monacoDrive?.barriersAt(x,z)??[];}
  rebuildBarrierIndex(){this.monacoDrive?.rebuildBarrierIndex();}

  /** Longitudinal slope (rise / horizontal run), with an exact flat Monza fast path. */
  gradeAt(distance:number):number {
    if(this.id==='monza')return 0;
    if(this.monacoDrive){const a=this.sampleAt(distance-.3).point,b=this.sampleAt(distance+.3).point;return(b.y-a.y)/Math.max(1e-8,Math.hypot(b.x-a.x,b.z-a.z));}
    const d=((distance%this.length)+this.length)%this.length,t=this.curve.getTangentAt(d/this.length);
    return (this.elevationProfile?.at(d).derivative??t.y)/Math.max(1e-8,Math.hypot(t.x,t.z));
  }

  /** Continuous longitudinal projection onto the actual rendered sample
   * chords, rather than selecting one nearest station for the whole car. */
  roadProjectionAt(x:number,z:number){
    const near=this.nearest(x,z);let best=Infinity,height=near.point.y,distance=near.distance,tx=near.tangent.x,tz=near.tangent.z;
    for(let k=-2;k<=1;k++){
      const a=this.samples[(near.index+k+this.samples.length)%this.samples.length],b=this.samples[(near.index+k+1+this.samples.length)%this.samples.length],dx=b.point.x-a.point.x,dz=b.point.z-a.point.z,length=Math.hypot(dx,dz),t=THREE.MathUtils.clamp(((x-a.point.x)*dx+(z-a.point.z)*dz)/(length*length),0,1),gap=(x-a.point.x-dx*t)**2+(z-a.point.z-dz*t)**2;
      if(gap<best){best=gap;height=THREE.MathUtils.lerp(a.point.y,b.point.y,t);distance=(a.distance+t*this.length/this.samples.length)%this.length;tx=dx/length;tz=dz/length;}
    }return{height,gap:Math.sqrt(best),distance,tangent:{x:tx,z:tz}};
  }

  /** Continuous surface height uses the exact same sampled chords as the road.
   * Pit-lane ramps use their own continuous 3D chords, not the nearest race lane. */
  heightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
    const road=this.roadProjectionAt(x,z);
    if(this.monacoDrive){const main=this.monacoDrive.roadHeightAt(x,z,this.nearest(x,z).index,NaN);if(Number.isFinite(main))return main;return this.monacoDrive.isPitLane(x,z,road)?this.monacoDrive.pitSurfaceHeightAt(x,z,this.monacoDrive.pitProjection(x,z).height):road.height;}
    if(road.gap<=this.widthAt(road.distance)/2+.15)return road.height;
    if(isSpaPitApron(x,z))return 0;
    if(this.isPitLane(x,z)){
      let best=Infinity,height=0;
      for(const s of this.pitCells.get(Math.floor(x/this.pitCellSize))?.get(Math.floor(z/this.pitCellSize))??[]){
        const t=THREE.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared,0,1),dx=x-s.x-s.dx*t,dz=z-s.z-s.dz*t,d=dx*dx+dz*dz;
        if(d<best){best=d;height=s.y+s.dy*t;}
      }return height;
    }
    return road.height;
  }

  /** Signed slope along the car's own forward axis, including pit ramps. */
  gradeAlongHeadingAt(x:number,z:number,heading:number):number {
    if(this.id==='monza')return 0;
    const halfWheelbase=1.55,dx=Math.sin(heading)*halfWheelbase,dz=Math.cos(heading)*halfWheelbase;
    return (this.heightAt(x+dx,z+dz)-this.heightAt(x-dx,z-dz))/(halfWheelbase*2);
  }

  /** A broad blended Ardennes ground field, pinned to the roadway at its edges. */
  terrainHeightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
    if(this.monacoDrive)return this.monacoDrive.layout.heightAt(x/this.monacoScale,z/this.monacoScale)*this.monacoScale;
    // Ground is a continuous field. Reusing heightAt() here made a binary
    // pit-lane membership boundary turn into a several-unit vertical cliff.
    const near=this.nearest(x,z),distance=Math.hypot(x-near.point.x,z-near.point.z),surface=this.roadProjectionAt(x,z).height;
    if(distance<=28)return this.spaPitGroundAt(x,z,surface,distance);
    const closest:{distance:number;height:number}[]=[];
    for(let i=0;i<this.samples.length;i+=16){const p=this.samples[i].point,d=(p.x-x)**2+(p.z-z)**2;closest.push({distance:d,height:p.y});}
    closest.sort((a,b)=>a.distance-b.distance);let sum=0,weights=0;
    for(const p of closest.slice(0,6)){const weight=1/(p.distance+1600);sum+=p.height*weight;weights+=weight;}
    const t=THREE.MathUtils.clamp((distance-28)/70,0,1),blend=t*t*(3-2*t);
    return this.spaPitGroundAt(x,z,THREE.MathUtils.lerp(surface,sum/weights,blend),distance);
  }

  private spaPitGroundAt(x:number,z:number,base:number,roadGap:number):number {
    const shoulder=24;
    if(x<this.pitBounds.minX-shoulder||x>this.pitBounds.maxX+shoulder||z<this.pitBounds.minZ-shoulder||z>this.pitBounds.maxZ+shoulder)return base;
    const eased=(value:number)=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
    let best=shoulder*shoulder,height=0,heightSum=0,heightWeight=0;
    const gx=Math.floor(x/this.pitCellSize),gz=Math.floor(z/this.pitCellSize),seen=new Set<PitSegment>();
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(const s of this.pitCells.get(gx+dx)?.get(gz+dz)??[]){
      if(seen.has(s))continue;seen.add(s);
      const t=THREE.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared,0,1),distance=(x-s.x-s.dx*t)**2+(z-s.z-s.dz*t)**2;
      if(distance<best){best=distance;height=s.y+s.dy*t;}
      if(distance<shoulder*shoulder){const w=(1-distance/(shoulder*shoulder))**2*Math.sqrt(s.lengthSquared);heightSum+=(s.y+s.dy*t)*w;heightWeight+=w;}
    }
    // Two nearby arms of the La Source bypass must share a continuous ground
    // field instead of jumping between different nearest-segment heights.
    if(heightWeight>0)height=heightSum/heightWeight;
    let weight=1-eased((Math.sqrt(best)-SPA_PIT_LAYOUT.fastHalfWidth-2)/(shoulder-SPA_PIT_LAYOUT.fastHalfWidth-2));
    const apronGap=Math.hypot(Math.max(SPA_PIT_LAYOUT.apronMinX-x,0,x-SPA_PIT_LAYOUT.apronMaxX),Math.max(SPA_PIT_LAYOUT.serviceMinZ-z,0,z-SPA_PIT_LAYOUT.serviceMaxZ));
    const apronWeight=1-eased(apronGap/16);
    if(apronWeight>weight){weight=apronWeight;height=SPA_PIT_LAYOUT.serviceY;}
    // The main roadway keeps its own earth bed where the two routes merge.
    weight*=eased((roadGap-this.width/2-1.5)/6);
    // The rendered terrain has a -1.5u backing offset. Its verge top should
    // meet the paving at -0.25u, rather than hang metres below the pit lane.
    return THREE.MathUtils.lerp(base,height+1.25,weight);
  }

  /** Actual rendered rolling-ground triangle height outside the road corridor.
   * Scenery bases use this rather than the ideal smooth interpolation above. */
  terrainMeshHeightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
    if(this.monacoDrive)return this.terrainHeightAt(x,z);
    if(!this.terrainGrid){
      const xs=this.samples.map(s=>s.point.x),zs=this.samples.map(s=>s.point.z),minX=Math.min(...xs)-220,maxX=Math.max(...xs)+220,minZ=Math.min(...zs)-200,maxZ=Math.max(...zs)+200;
      this.terrainGrid={minX,maxX,minZ,maxZ,nx:Math.ceil((maxX-minX)/12),nz:Math.ceil((maxZ-minZ)/12)};
    }
    const {minX,maxX,minZ,maxZ,nx,nz}=this.terrainGrid;
    const u=THREE.MathUtils.clamp((x-minX)/(maxX-minX)*nx,0,nx),v=THREE.MathUtils.clamp((z-minZ)/(maxZ-minZ)*nz,0,nz),ix=Math.min(nx-1,Math.floor(u)),iz=Math.min(nz-1,Math.floor(v)),tx=u-ix,tz=v-iz;
    const height=(dx:number,dz:number)=>this.terrainHeightAt(minX+(maxX-minX)*(ix+dx)/nx,minZ+(maxZ-minZ)*(iz+dz)/nz)-1.5;
    const h10=height(1,0),h01=height(0,1);
    if(tx+tz<=1){const h00=height(0,0);return h00+(h10-h00)*tx+(h01-h00)*tz;}
    const h11=height(1,1);return h11+(h01-h11)*(1-tx)+(h10-h11)*(1-tz);
  }

  nearest(x:number,z:number): TrackSample {
    if(x===this.lastX&&z===this.lastZ&&this.lastNearest)return this.lastNearest;
    // Match the original scan's first-sample result for non-finite coordinates.
    if(!Number.isFinite(x)||!Number.isFinite(z))return this.samples[0];
    let best=Infinity; let chosen=this.samples[0];
    const visit=(node:SampleNode)=>{
      if(node.indices){
        for(const index of node.indices){
          const s=this.samples[index],dx=s.point.x-x,dz=s.point.z-z,d=dx*dx+dz*dz;
          // The former linear scan wins ties in the original sample order.
          if(d<best||(d===best&&index<chosen.index)){best=d;chosen=s;}
        }
        return;
      }
      const left=node.left!,right=node.right!;
      const leftDistance=squaredBoxDistance(x,z,left),rightDistance=squaredBoxDistance(x,z,right);
      if(leftDistance<=rightDistance){
        if(leftDistance<=best)visit(left);
        if(rightDistance<=best)visit(right);
      }else{
        if(rightDistance<=best)visit(right);
        if(leftDistance<=best)visit(left);
      }
    };
    visit(this.nearestTree);
    this.lastX=x;this.lastZ=z;this.lastNearest=chosen;
    return chosen;
  }

  private indexPitSegments():void {
    const radius=Math.sqrt(36.5),size=this.pitCellSize;
    for(let i=0;i<this.pitSamples.length-1;i++){
      const a=this.pitSamples[i],b=this.pitSamples[i+1],dx=b.x-a.x,dz=b.z-a.z;
      const segment:PitSegment={x:a.x,y:a.y,z:a.z,dx,dy:b.y-a.y,dz,lengthSquared:dx*dx+dz*dz};
      for(let gx=Math.floor((Math.min(a.x,b.x)-radius)/size);gx<=Math.floor((Math.max(a.x,b.x)+radius)/size);gx++){
        let column=this.pitCells.get(gx);if(!column){column=new Map();this.pitCells.set(gx,column);}
        for(let gz=Math.floor((Math.min(a.z,b.z)-radius)/size);gz<=Math.floor((Math.max(a.z,b.z)+radius)/size);gz++){
          const segments=column.get(gz);if(segments)segments.push(segment);else column.set(gz,[segment]);
        }
      }
    }
  }

  isPitLane(x:number,z:number):boolean {
    if(this.monacoDrive)return this.monacoDrive.isPitLane(x,z,this.roadProjectionAt(x,z));
    if(this.id==='monza'){
      // The entry/exit ribbons share part of the GP straight. Main asphalt,
      // edge paint and the complete red/white kerb retain driving priority;
      // overlap with a pit spline must never activate the pit governor there.
      const road=this.roadProjectionAt(x,z);
      if(road.gap<=this.roadOffsetAt(road.distance,9.65)+.025)return false;
      if(isMonzaPitApron(x,z))return true;if(x< -92||x> -54||z< -116||z>188)return false;
    }
    else{const road=this.roadProjectionAt(x,z);if(road.gap<=this.widthAt(road.distance)/2+.15)return false;if(isSpaPitApron(x,z))return true;if(x<this.pitBounds.minX||x>this.pitBounds.maxX||z<this.pitBounds.minZ||z>this.pitBounds.maxZ)return false;}
    const segments=this.pitCells.get(Math.floor(x/this.pitCellSize))?.get(Math.floor(z/this.pitCellSize));
    if(!segments)return false;
    for(const s of segments){
      const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared));
      if((x-s.x-s.dx*t)**2+(z-s.z-s.dz*t)**2<=36.5)return true;
    }
    return false;
  }

  surfaceAt(x:number,z:number):'asphalt'|'grass'|'gravel' {
    if(this.monacoDrive){const road=this.roadProjectionAt(x,z);return this.monacoDrive.isPitLane(x,z,road)||road.gap<=this.widthAt(road.distance)/2+.2?'asphalt':'grass';}
    if(this.isPitLane(x,z))return 'asphalt';
    const s=this.nearest(x,z);
    const d=Math.hypot(s.point.x-x,s.point.z-z);
    if(d<=this.widthAt(s.distance)/2+0.8)return 'asphalt';
    // Legible tan runoffs at the principal braking and high speed zones.
    if(d>11 && d<23 && this.isGravelSection(s.distance))return 'gravel';
    return 'grass';
  }

  widthAt(distance:number):number {return this.monacoDrive?this.monacoDrive.widthAt(distance):roadWidthAt(distance,this.length,this.width,this.widthZones);}

  /** Scale the asphalt, edge paint and kerbs on the local normal about the centreline. */
  roadOffsetAt(distance:number,offset:number):number {
    return offset*this.widthAt(distance)/this.width;
  }

  private isGravelSection(distance:number):boolean {
    if(this.id==='spa')return isSpaGravel(distance,this.length);
    const t=distance/this.length;
    return (t>.14&&t<.22)||(t>.35&&t<.53)||(t>.64&&t<.71)||(t>.85&&t<.94);
  }

  private ribbon(inner:number,outer:number,y:number,mat:THREE.Material,filter?:(s:TrackSample)=>boolean,followWidth=false,groundClip?:GroundClipper) {
    const positions:number[]=[]; const indices:number[]=[];const uvs:number[]=[];
    // A long ground triangle could cross the entire road while its vertices
    // remain outside. Only cells around the two cuts need extra subdivisions.
    if(groundClip){
      for(let i=0;i<this.samples.length;i++){
        const a=this.samples[i],b=this.samples[(i+1)%this.samples.length];if(filter&&!filter(a))continue;
        const corners=[a,b].flatMap(sample=>[inner,outer].map(offset=>({x:sample.point.x+sample.right.x*offset,z:sample.point.z+sample.right.z*offset})));
        const affected=groundClip.intersects(Math.min(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.x)),Math.min(...corners.map(p=>p.z)),Math.max(...corners.map(p=>p.z)));
        const rows=affected?Math.ceil(Math.abs(outer-inner)/2):1,rowSize=rows+1,start=positions.length/3;
        for(const sample of [a,b])for(let j=0;j<=rows;j++){
          const offset=THREE.MathUtils.lerp(inner,outer,j/rows),x=sample.point.x+sample.right.x*offset,z=sample.point.z+sample.right.z*offset;
          positions.push(x,y,z);uvs.push(x/5,z/5);
        }
        for(let j=0;j<rows;j++){const k=start+j;indices.push(k,k+1,k+rowSize,k+1,k+rowSize+1,k+rowSize);}
      }
    }else for(let i=0;i<=this.samples.length;i++){
      const s=this.samples[i%this.samples.length];
      const a=followWidth?this.roadOffsetAt(s.distance,inner):inner,b=followWidth?this.roadOffsetAt(s.distance,outer):outer;
      positions.push(s.point.x+s.right.x*a,y,s.point.z+s.right.z*a,s.point.x+s.right.x*b,y,s.point.z+s.right.z*b);
      uvs.push((s.point.x+s.right.x*a)/5,(s.point.z+s.right.z*a)/5,(s.point.x+s.right.x*b)/5,(s.point.z+s.right.z*b)/5);
      if(i<this.samples.length && (!filter||filter(s))) {
        const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);
      }
    }
    let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
    if(groundClip){
      const clipped=clipHistoricRibbonGeometry(geo,groundClip.signed);
      if(clipped!==geo){geo.dispose();geo=mergeVertices(clipped,1e-6);clipped.dispose();}
      const stats=this.group.userData.historicTerrain;
      stats.originalTriangles+=this.samples.filter(sample=>!filter||filter(sample)).length*2;
      stats.sourceTriangles+=indices.length/3;stats.retainedTriangles+=(geo.index?.count??geo.getAttribute('position').count)/3;
    }
    const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;this.group.add(mesh);return mesh;
  }

  private build() {
    const historicConnection=createHistoricConnectionLayout(this),historicSouthConnection=createHistoricSouthConnectionLayout(this);
    const groundClip=historicGroundClipper([historicConnection,historicSouthConnection]);
    this.group.userData.historicTerrain={cutouts:2,originalTriangles:0,sourceTriangles:0,retainedTriangles:0};
    const inHistoricConnection=(x:number,z:number,margin:number)=>[historicConnection,historicSouthConnection].some(layout=>historicConnectionContains(x,z,layout,margin));
    const edgeClear=(sample:TrackSample,offset:number)=>{
      for(const along of [0,this.length/this.samples.length]){
        const s=this.sampleAt(sample.distance+along),d=this.roadOffsetAt(s.distance,offset);
        if(inHistoricConnection(s.point.x+s.right.x*d,s.point.z+s.right.z*d,.08))return false;
      }
      return true;
    };
    const sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();
    const mat=(color:number,roughness=0.88)=>{
      const key=`${color}:${roughness}`;let material=sharedMaterials.get(key);
      if(!material){material=new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});sharedMaterials.set(key,material);}
      return material;
    };
    const road=mat(0x56595b); const edge=mat(0xf3f1e9); const gravel=mat(0xc4b797); const runoff=mat(0x60885f);
    gravel.name='monza-gravel-runoff';runoff.name='monza-ground-runoff';
    const asphalt=asphaltTexture();if(asphalt)road.map=asphalt;
    road.name='monza-asphalt';road.userData.weatherSurface='road';
    this.ribbon(-24,24,0.014,runoff,undefined,false,groundClip);
    this.ribbon(-23,-11,0.023,gravel,s=>this.isGravelSection(s.distance),false,groundClip);
    this.ribbon(11,23,0.023,gravel,s=>this.isGravelSection(s.distance),false,groundClip);
    this.ribbon(-8.15,8.15,0.045,road,undefined,true);
    this.ribbon(-8,-7.82,0.057,edge,s=>edgeClear(s,-8),true);this.ribbon(7.82,8,0.057,edge,s=>edgeClear(s,8),true);
    const curbMats=[mat(0xf3f1e9),mat(0xc92f31)];
    for(let side=-1;side<=1;side+=2){
      for(let color=0;color<2;color++){
        this.ribbon(side*8.25,side*9.65,0.082,curbMats[color],s=>Math.floor(s.distance/3.2)%2===color&&edgeClear(s,side*8.25)&&edgeClear(s,side*9.65),true);
      }
      this.ribbon(side*9.65,side*10.8,0.035,mat(0x32845e),s=>edgeClear(s,side*10.2),true);
    }
    // Game's perimeter wall agrees with the collision distance used by physics.
    // Corrugated Armco profile; three runs and a canted catch fence are more
    // recognisable than two flat painted strips. Geometry remains instanced.
    const railVertices:number[]=[],railIndices:number[]=[];
    const profile=[[-.17,.02],[-.11,.10],[0,-.02],[.11,.10],[.17,.02]];
    for(const [y,z]of profile)railVertices.push(-2.12,y,z,2.12,y,z);
    for(let i=0;i<profile.length-1;i++){const a=i*2;railIndices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const railGeo=new THREE.BufferGeometry();railGeo.setAttribute('position',new THREE.Float32BufferAttribute(railVertices,3));railGeo.setIndex(railIndices);railGeo.computeVertexNormals();
    const railMat=mat(0x9ea7aa,0.48);railMat.metalness=.45;railMat.name='galvanised-armco';
    const railCount=Math.ceil(this.length/4.1)*2;
    const rails=new THREE.InstancedMesh(railGeo,railMat,railCount*3);
    const posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.14,4.9,.14),mat(0x7d8789,.48),railCount);
    const fenceMaterial=catchFenceMaterial();
    const fence=new THREE.InstancedMesh(new THREE.PlaneGeometry(4.22,3.3),fenceMaterial,railCount);
    const fenceTop=new THREE.InstancedMesh(new THREE.PlaneGeometry(4.22,.88),fenceMaterial,railCount);
    const braces=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.92,.1),mat(0x7d8789,.48),railCount);
    const o=new THREE.Object3D();let ri=0,pi=0,fi=0,historicFencePanels=0,historicSouthFencePanels=0;
    for(let d=0;d<this.length;d+=4.1){
      const s=this.sampleAt(d);
      for(const sign of [-1,1]){
        const before=this.sampleAt(d-2.05),after=this.sampleAt(d+2.05);
        const ax=before.point.x+before.right.x*24*sign,az=before.point.z+before.right.z*24*sign;
        const bx=after.point.x+after.right.x*24*sign,bz=after.point.z+after.right.z*24*sign;
        const x=(ax+bx)/2,z=(az+bz)/2;
        const closest=this.nearest(x,z);
        if(Math.hypot(x-closest.point.x,z-closest.point.z)<21)continue;
        // The main straight's inner rail is replaced by a properly located pit wall.
        if(z> -108 && z<181 && x> -75&&x< -50)continue;
        if(this.isPitLane(x,z))continue;
        // On the curved south return, an offset fence chord can be longer
        // than its GP centreline segment. Check its full span, not its centre.
        const portalFor=(layout:typeof historicConnection)=>historicConnectionContains(x,z,layout,2.3)||[0,.25,.5,.75,1].some(t=>historicConnectionContains(THREE.MathUtils.lerp(ax,bx,t),THREE.MathUtils.lerp(az,bz,t),layout,.7));
        const southPortal=portalFor(historicSouthConnection);
        if(southPortal||portalFor(historicConnection)){historicFencePanels++;if(southPortal)historicSouthFencePanels++;continue;}
        const yaw=Math.atan2(-(bz-az),bx-ax),span=(Math.hypot(bx-ax,bz-az)+.14)/4.24;
        // Offset curves have a different arc length from the centreline. Fit
        // every panel to its true boundary chord so Armco stays continuous.
        o.scale.set(span,1,1);
        for(const y of [.38,.77,1.16]){o.position.set(x,y,z);o.rotation.set(0,yaw,0);o.updateMatrix();rails.setMatrixAt(ri++,o.matrix);}
        o.scale.set(1,1,1);o.position.set(x,2.5,z);o.rotation.set(0,yaw,0);o.updateMatrix();posts.setMatrixAt(pi++,o.matrix);
        o.scale.set(span,1,1);o.position.set(x,3.15,z);o.rotation.set(0,yaw,0);o.updateMatrix();fence.setMatrixAt(fi,o.matrix);
        const outward=s.right.clone().multiplyScalar(sign);
        o.position.set(x-outward.x*.31,5.10,z-outward.z*.31);o.rotation.set(-sign*.78,yaw,0);o.updateMatrix();fenceTop.setMatrixAt(fi,o.matrix);
        o.scale.set(1,1,1);o.position.set(x-outward.x*.31,5.10,z-outward.z*.31);o.rotation.set(-sign*.78,yaw,0);o.updateMatrix();braces.setMatrixAt(fi,o.matrix);fi++;
      }
    }
    rails.count=ri;posts.count=pi;fence.count=fenceTop.count=braces.count=fi;
    rails.name='armco-three-rail';posts.name='catch-fence-posts';fence.name='catch-fence-mesh';fenceTop.name='catch-fence-canted-top';braces.name='catch-fence-canted-braces';
    for(const mesh of [rails,posts,fence,fenceTop,braces]){mesh.computeBoundingSphere();mesh.castShadow=false;this.group.add(mesh);}
    this.group.userData.safetyFurniture={armcoRails:3,fencePanels:fi,height:5.5,offset:24,pitJoinsKeptClear:true,historicConnectionPortalPanels:historicFencePanels,historicSouthConnectionPortalPanels:historicSouthFencePanels};
    // Pit lane is connected to the straight at both ends; first version has no pit gameplay.
    const pp:number[]=[],ii:number[]=[];
    for(let i=0;i<=180;i++){
      const p=this.pitCurve.getPoint(i/180),t=this.pitCurve.getTangent(i/180);const n=new THREE.Vector3(t.z,0,-t.x).normalize();
      for(const sign of [-1,1])pp.push(p.x+n.x*6*sign,.052,p.z+n.z*6*sign);
      if(i<180){const k=i*2;ii.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
    const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));pg.setAttribute('uv',new THREE.Float32BufferAttribute(pp.flatMap((_,i)=>i%3===0?[pp[i]/5,pp[i+2]/5]:[]),2));pg.setIndex(ii);pg.computeVertexNormals();
    // The pit ribbon overlaps the circuit at both joins. Keep its surface
    // appearance/UVs identical so the joins do not paint pale polygons over
    // the racing line; retain a separate instance for weather bindings.
    const pitRoad=road.clone();pitRoad.name='monza-pit-asphalt';pitRoad.userData.weatherSurface='road';
    const pm=new THREE.Mesh(pg,pitRoad);pm.receiveShadow=true;this.group.add(pm);
    // Share the exact east-edge vertices of the pit ribbon. A rectangle here
    // would either leave a grass gap or overlap the fast-lane asphalt.
    const apronBounds=MONZA_PIT_LAYOUT.drivableApron,apronPoints:number[]=[],apronIndices:number[]=[];
    for(let i=0;i<180;i++){
      const ai=i*6,bi=(i+1)*6,ax=pp[ai],az=pp[ai+2],bx=pp[bi],bz=pp[bi+2];
      const low=Math.max(Math.min(az,bz),apronBounds.minZ),high=Math.min(Math.max(az,bz),apronBounds.maxZ);
      if(low>=high)continue;
      const eastAt=(z:number)=>THREE.MathUtils.lerp(ax,bx,(z-az)/(bz-az)),a=eastAt(high),b=eastAt(low),k=apronPoints.length/3;
      apronPoints.push(a,.052,high,apronBounds.maxX,.052,high,b,.052,low,apronBounds.maxX,.052,low);
      apronIndices.push(k,k+1,k+2,k+1,k+3,k+2);
    }
    const apronGeometry=new THREE.BufferGeometry();apronGeometry.setAttribute('position',new THREE.Float32BufferAttribute(apronPoints,3));apronGeometry.setIndex(apronIndices);apronGeometry.computeVertexNormals();
    const workingApron=new THREE.Mesh(apronGeometry,mat(0x969e92));workingApron.name='monza-connected-working-apron';workingApron.receiveShadow=true;this.group.add(workingApron);
    const lineMat=mat(0xf6eb99);
    const line=new THREE.Mesh(new THREE.BoxGeometry(.15,.025,222),lineMat);line.position.set(-65,.081,36);this.group.add(line);
    // Start grid boxes, visible in the low follow camera.
    const gridMat=mat(0xe5e6d6);
    for(let i=0;i<10;i++){
      const g=new THREE.Group();const x=-85+(i%2===0?-3.8:3.8),z=106+Math.floor(i/2)*9;
      for(const dx of [-1.5,1.5]){const l=new THREE.Mesh(new THREE.BoxGeometry(.13,.028,3.4),gridMat);l.position.set(dx,0,0);g.add(l);}
      const l=new THREE.Mesh(new THREE.BoxGeometry(3.1,.028,.13),gridMat);l.position.z=-1.7;g.add(l);g.position.set(x,.085,z);this.group.add(g);
    }
    // Checkered finish stripe at distance zero.
    for(let x=0;x<16;x++)for(let z=0;z<2;z++){
      const square=new THREE.Mesh(new THREE.BoxGeometry(1,.018,1),mat((x+z)%2?0xf5f0df:0x243b38));
      square.position.set(-92.5+x,.089,99.5+z);this.group.add(square);
    }
  }

  /** Lines, curbs, grid slots and checker squares are static. Share materials
   * and draw each compatible batch once instead of one call per small box. */
  private batchStaticGeometry():void {
    this.group.updateMatrixWorld(true);
    const batches=new Map<string,THREE.Mesh[]>();
    let sourceMeshes=0;
    this.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||Array.isArray(object.material))return;
      sourceMeshes++;
      const key=[object.material.uuid,Object.keys(object.geometry.attributes).sort().join(','),!!object.geometry.index,object.castShadow,object.receiveShadow].join('|');
      const batch=batches.get(key);if(batch)batch.push(object);else batches.set(key,[object]);
    });
    let batchesDrawn=0;
    for(const meshes of batches.values()){
      batchesDrawn++;
      if(meshes.length===1)continue;
      const geometries=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      const geometry=mergeGeometries(geometries,false);
      geometries.forEach(g=>g.dispose());
      if(!geometry)continue;
      const first=meshes[0],mesh=new THREE.Mesh(geometry,first.material);
      mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;this.group.add(mesh);
      for(const original of meshes){original.removeFromParent();original.geometry.dispose();}
    }
    this.group.userData.batching={sourceMeshes,batches:batchesDrawn};
  }
}
