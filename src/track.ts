import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStandLayouts, standCollider } from './stand-layout';
import {asphaltTexture,catchFenceMaterial} from './monza-details';
import {createWidthZones,roadWidthAt,type WidthZone} from './track-width';
import {createSpaDefinition,buildSpaTrack,isSpaGravel} from './spa-track';
export type CircuitId='monza'|'spa';

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
  private readonly pitCurve: THREE.CatmullRomCurve3;
  private readonly pitSamples:THREE.Vector3[];
  private readonly pitBounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  private readonly nearestTree:SampleNode;
  private lastX=NaN; private lastZ=NaN; private lastNearest?:TrackSample;
  private readonly pitCells=new Map<number,Map<number,PitSegment[]>>();
  private readonly pitCellSize=12;
  private terrainGrid?:{minX:number;maxX:number;minZ:number;maxZ:number;nx:number;nz:number};

  constructor(readonly id:CircuitId='monza') {
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
    for (let i=0; i<1600; i++) {
      const t=i/1600;
      const tangent=this.curve.getTangentAt(t).setY(0).normalize();
      this.samples.push({point:this.curve.getPointAt(t),tangent,
        right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:t*this.length,index:i,t});
    }
    this.nearestTree=sampleTree(this.samples,this.samples.map(s=>s.index));
    this.pitCurve=id==='spa'?new THREE.CatmullRomCurve3([
      this.sampleAt(this.nearest(spa!.corners.at(-1)!.x,spa!.corners.at(-1)!.z).distance-75).point,new THREE.Vector3(-155,-4.8,300),new THREE.Vector3(-155,-1.8,278),
      new THREE.Vector3(-107,0,265),new THREE.Vector3(-107,0,200),
      new THREE.Vector3(-107,0,110),new THREE.Vector3(-107,0,49),this.sampleAt(60).point,
    ],false,'centripetal'):new THREE.CatmullRomCurve3([
      new THREE.Vector3(-85,0,181),new THREE.Vector3(-63,0,151),new THREE.Vector3(-63,0,90),
      new THREE.Vector3(-63,0,0),new THREE.Vector3(-63,0,-78),new THREE.Vector3(-85,0,-108),
    ],false,'centripetal');
    this.pitSamples=this.pitCurve.getPoints(id==='spa'?252:180);
    if(id==='spa'){
      // The garages stand on one level slab. Restrict the height transitions to
      // the entrance/exit ramps instead of allowing Catmull-Rom to overshoot
      // between the otherwise level interior control points.
      const entry=this.pitSamples[0].clone(),exit=this.pitSamples.at(-1)!.clone();
      const smooth=(t:number)=>t*t*(3-2*t);
      for(let i=0;i<this.pitSamples.length;i++){
        const p=this.pitSamples[i],entryWeight=i<108?1-smooth(i/108):0,exitWeight=i>216?smooth((i-216)/36):0;
        p.y=entry.y*entryWeight+exit.y*exitWeight;
        if(i>=108)p.x=-107+(exit.x+107)*exitWeight;
      }
    }
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
    this.colliders=id==='spa'?[]:[{minX:-74.3,maxX:-73.3,minZ:-75,maxZ:143},{minX:-49.2,maxX:-30.8,minZ:-50.5,maxZ:114.5}];
    if(id==='monza'){this.colliders.push(...createStandLayouts(this).map(standCollider));this.build();}
    else buildSpaTrack(this,this.pitSamples);
    this.batchStaticGeometry();
  }

  sampleAt(distance:number): TrackSample {
    const d=((distance%this.length)+this.length)%this.length;
    const t=d/this.length;
    const point=this.curve.getPointAt(t);
    const tangent=this.curve.getTangentAt(t).setY(0).normalize();
    return {point,tangent,right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:d,t,index:Math.floor(t*this.samples.length)%this.samples.length};
  }

  /** Longitudinal slope (rise / horizontal run), with an exact flat Monza fast path. */
  gradeAt(distance:number):number {
    if(this.id==='monza')return 0;
    const d=((distance%this.length)+this.length)%this.length,t=this.curve.getTangentAt(d/this.length);
    return t.y/Math.max(1e-8,Math.hypot(t.x,t.z));
  }

  /** Continuous surface height uses the exact same sampled chords as the road.
   * Pit-lane ramps use their own continuous 3D chords, not the nearest race lane. */
  heightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
    if(this.isPitLane(x,z)){
      let best=Infinity,height=0;
      for(const s of this.pitCells.get(Math.floor(x/this.pitCellSize))?.get(Math.floor(z/this.pitCellSize))??[]){
        const t=THREE.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared,0,1),dx=x-s.x-s.dx*t,dz=z-s.z-s.dz*t,d=dx*dx+dz*dz;
        if(d<best){best=d;height=s.y+s.dy*t;}
      }return height;
    }
    const near=this.nearest(x,z);let best=Infinity,height=near.point.y;
    for(let k=-2;k<=1;k++){
      const a=this.samples[(near.index+k+this.samples.length)%this.samples.length].point,b=this.samples[(near.index+k+1+this.samples.length)%this.samples.length].point;
      const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),d=(x-a.x-dx*t)**2+(z-a.z-dz*t)**2;
      if(d<best){best=d;height=a.y+(b.y-a.y)*t;}
    }return height;
  }

  /** Signed slope along the car's own forward axis, including pit ramps. */
  gradeAlongHeadingAt(x:number,z:number,heading:number):number {
    if(this.id==='monza')return 0;
    if(this.isPitLane(x,z)){
      let best=Infinity,result=0;
      for(const s of this.pitCells.get(Math.floor(x/this.pitCellSize))?.get(Math.floor(z/this.pitCellSize))??[]){
        const t=THREE.MathUtils.clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared,0,1),d=(x-s.x-s.dx*t)**2+(z-s.z-s.dz*t)**2;
        if(d<best){best=d;result=s.dy/s.lengthSquared*(Math.sin(heading)*s.dx+Math.cos(heading)*s.dz);}
      }return result;
    }
    const near=this.nearest(x,z);return this.gradeAt(near.distance)*(Math.sin(heading)*near.tangent.x+Math.cos(heading)*near.tangent.z);
  }

  /** A broad blended Ardennes ground field, pinned to the roadway at its edges. */
  terrainHeightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
    const near=this.nearest(x,z),distance=Math.hypot(x-near.point.x,z-near.point.z),surface=this.heightAt(x,z);
    if(distance<=28)return surface;
    const closest:{distance:number;height:number}[]=[];
    for(let i=0;i<this.samples.length;i+=16){const p=this.samples[i].point,d=(p.x-x)**2+(p.z-z)**2;closest.push({distance:d,height:p.y});}
    closest.sort((a,b)=>a.distance-b.distance);let sum=0,weights=0;
    for(const p of closest.slice(0,6)){const weight=1/(p.distance+1600);sum+=p.height*weight;weights+=weight;}
    const t=THREE.MathUtils.clamp((distance-28)/70,0,1),blend=t*t*(3-2*t);
    return THREE.MathUtils.lerp(surface,sum/weights,blend);
  }

  /** Actual rendered rolling-ground triangle height outside the road corridor.
   * Scenery bases use this rather than the ideal smooth interpolation above. */
  terrainMeshHeightAt(x:number,z:number):number {
    if(this.id==='monza')return 0;
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
    if(this.id==='monza'){if(x< -92||x> -54||z< -116||z>188)return false;}
    else if(x<this.pitBounds.minX||x>this.pitBounds.maxX||z<this.pitBounds.minZ||z>this.pitBounds.maxZ)return false;
    const segments=this.pitCells.get(Math.floor(x/this.pitCellSize))?.get(Math.floor(z/this.pitCellSize));
    if(!segments)return false;
    for(const s of segments){
      const t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/s.lengthSquared));
      if((x-s.x-s.dx*t)**2+(z-s.z-s.dz*t)**2<=36.5)return true;
    }
    return false;
  }

  surfaceAt(x:number,z:number):'asphalt'|'grass'|'gravel' {
    if(this.isPitLane(x,z))return 'asphalt';
    const s=this.nearest(x,z);
    const d=Math.hypot(s.point.x-x,s.point.z-z);
    if(d<=this.widthAt(s.distance)/2+0.8)return 'asphalt';
    // Legible tan runoffs at the principal braking and high speed zones.
    if(d>11 && d<23 && this.isGravelSection(s.distance))return 'gravel';
    return 'grass';
  }

  widthAt(distance:number):number {return roadWidthAt(distance,this.length,this.width,this.widthZones);}

  /** Scale the asphalt, edge paint and kerbs on the local normal about the centreline. */
  roadOffsetAt(distance:number,offset:number):number {
    return offset*this.widthAt(distance)/this.width;
  }

  private isGravelSection(distance:number):boolean {
    if(this.id==='spa')return isSpaGravel(distance,this.length);
    const t=distance/this.length;
    return (t>.14&&t<.22)||(t>.35&&t<.53)||(t>.64&&t<.71)||(t>.85&&t<.94);
  }

  private ribbon(inner:number,outer:number,y:number,mat:THREE.Material,filter?:(s:TrackSample)=>boolean,followWidth=false) {
    const positions:number[]=[]; const indices:number[]=[];const uvs:number[]=[];
    for(let i=0;i<=this.samples.length;i++){
      const s=this.samples[i%this.samples.length];
      const a=followWidth?this.roadOffsetAt(s.distance,inner):inner,b=followWidth?this.roadOffsetAt(s.distance,outer):outer;
      positions.push(s.point.x+s.right.x*a,y,s.point.z+s.right.z*a,
        s.point.x+s.right.x*b,y,s.point.z+s.right.z*b);
      uvs.push((s.point.x+s.right.x*a)/5,(s.point.z+s.right.z*a)/5,(s.point.x+s.right.x*b)/5,(s.point.z+s.right.z*b)/5);
      if(i<this.samples.length && (!filter||filter(s))) {
        const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;this.group.add(mesh);return mesh;
  }

  private build() {
    const sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();
    const mat=(color:number,roughness=0.88)=>{
      const key=`${color}:${roughness}`;let material=sharedMaterials.get(key);
      if(!material){material=new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});sharedMaterials.set(key,material);}
      return material;
    };
    const road=mat(0x56595b); const edge=mat(0xf3f1e9); const gravel=mat(0xc4b797); const runoff=mat(0x60885f);
    const asphalt=asphaltTexture();if(asphalt)road.map=asphalt;
    road.name='monza-asphalt';road.userData.weatherSurface='road';
    this.ribbon(-24,24,0.014,runoff);
    this.ribbon(-23,-11,0.023,gravel,s=>this.isGravelSection(s.distance));
    this.ribbon(11,23,0.023,gravel,s=>this.isGravelSection(s.distance));
    this.ribbon(-8.15,8.15,0.045,road,undefined,true);
    this.ribbon(-8,-7.82,0.057,edge,undefined,true);this.ribbon(7.82,8,0.057,edge,undefined,true);
    const curbMats=[mat(0xf3f1e9),mat(0xc92f31)];
    for(let side=-1;side<=1;side+=2){
      for(let color=0;color<2;color++){
        this.ribbon(side*8.25,side*9.65,0.082,curbMats[color],s=>Math.floor(s.distance/3.2)%2===color,true);
      }
      this.ribbon(side*9.65,side*10.8,0.035,mat(0x32845e),undefined,true);
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
    const o=new THREE.Object3D();let ri=0,pi=0,fi=0;
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
    this.group.userData.safetyFurniture={armcoRails:3,fencePanels:fi,height:5.5,offset:24,pitJoinsKeptClear:true};
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
