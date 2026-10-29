import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStandLayouts, standCollider } from './stand-layout';

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
  x:number; z:number; dx:number; dz:number; lengthSquared:number;
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
  readonly width = 16;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly checkpoints: number[];
  readonly corners: { name: string; distance: number }[];
  /** Solid ground-level structures, shared with the vehicle collision solver. */
  readonly colliders: {minX:number;maxX:number;minZ:number;maxZ:number}[] = [
    {minX:-74.3,maxX:-73.3,minZ:-75,maxZ:143},
    {minX:-49.2,maxX:-30.8,minZ:-50.5,maxZ:114.5},
  ];
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly pitCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-85,0,181),new THREE.Vector3(-63,0,151),
    new THREE.Vector3(-63,0,90),new THREE.Vector3(-63,0,0),
    new THREE.Vector3(-63,0,-78),new THREE.Vector3(-85,0,-108),
  ],false,'centripetal');
  private readonly pitSamples = this.pitCurve.getPoints(180);
  private readonly nearestTree:SampleNode;
  private lastX=NaN; private lastZ=NaN; private lastNearest?:TrackSample;
  private readonly pitCells=new Map<number,Map<number,PitSegment[]>>();
  private readonly pitCellSize=12;

  constructor() {
    // Start on the pit straight. Clockwise: Rettifilo R/L, Biassono R,
    // Roggia L/R, Lesmo R/R, Serraglio, Ascari L/R/L, Alboreto R.
    const points = [
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
    this.curve.arcLengthDivisions = 6000;
    this.length = this.curve.getLength();
    for (let i=0; i<1600; i++) {
      const t=i/1600;
      const tangent=this.curve.getTangentAt(t).setY(0).normalize();
      this.samples.push({point:this.curve.getPointAt(t),tangent,
        right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:t*this.length,index:i,t});
    }
    this.nearestTree=sampleTree(this.samples,this.samples.map(s=>s.index));
    this.indexPitSegments();
    this.checkpoints=Array.from({length:24},(_,i)=>i*this.length/24);
    this.corners = [
      {name:'Rettifilo · 第一减速弯',x:-66,z:-153},
      {name:'Biassono · 大弯',x:26,z:-273},
      {name:'Roggia · 第二减速弯',x:153,z:-347},
      {name:'Lesmo 1 · 莱斯莫一号',x:229,z:-290},
      {name:'Lesmo 2 · 莱斯莫二号',x:218,z:-219},
      {name:'Serraglio · 森林直道',x:143,z:-145},
      {name:'Ascari · 阿斯卡里',x:81,z:0},
      {name:'Alboreto · 抛物线弯',x:-59,z:221},
    ].map(c=>({name:c.name,distance:this.nearest(c.x,c.z).distance}));
    this.colliders.push(...createStandLayouts(this).map(standCollider));
    this.build();
    this.batchStaticGeometry();
  }

  sampleAt(distance:number): TrackSample {
    const d=((distance%this.length)+this.length)%this.length;
    const t=d/this.length;
    const point=this.curve.getPointAt(t);
    const tangent=this.curve.getTangentAt(t).setY(0).normalize();
    return {point,tangent,right:new THREE.Vector3(tangent.z,0,-tangent.x),distance:d,t,index:Math.floor(t*this.samples.length)%this.samples.length};
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
      const segment:PitSegment={x:a.x,z:a.z,dx,dz,lengthSquared:dx*dx+dz*dz};
      for(let gx=Math.floor((Math.min(a.x,b.x)-radius)/size);gx<=Math.floor((Math.max(a.x,b.x)+radius)/size);gx++){
        let column=this.pitCells.get(gx);if(!column){column=new Map();this.pitCells.set(gx,column);}
        for(let gz=Math.floor((Math.min(a.z,b.z)-radius)/size);gz<=Math.floor((Math.max(a.z,b.z)+radius)/size);gz++){
          const segments=column.get(gz);if(segments)segments.push(segment);else column.set(gz,[segment]);
        }
      }
    }
  }

  isPitLane(x:number,z:number):boolean {
    if(x< -92||x> -54||z< -116||z>188)return false;
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
    if(d<=this.width/2+0.8)return 'asphalt';
    // Legible tan runoffs at the principal braking and high speed zones.
    if(d>11 && d<23 && this.isGravelSection(s.distance))return 'gravel';
    return 'grass';
  }

  private isGravelSection(distance:number):boolean {
    const t=distance/this.length;
    return (t>.14&&t<.22)||(t>.35&&t<.53)||(t>.64&&t<.71)||(t>.85&&t<.94);
  }

  private ribbon(inner:number,outer:number,y:number,mat:THREE.Material,filter?:(s:TrackSample)=>boolean) {
    const positions:number[]=[]; const indices:number[]=[];
    for(let i=0;i<=this.samples.length;i++){
      const s=this.samples[i%this.samples.length];
      positions.push(s.point.x+s.right.x*inner,y,s.point.z+s.right.z*inner,
        s.point.x+s.right.x*outer,y,s.point.z+s.right.z*outer);
      if(i<this.samples.length && (!filter||filter(s))) {
        const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;this.group.add(mesh);return mesh;
  }

  private build() {
    const sharedMaterials=new Map<string,THREE.MeshStandardMaterial>();
    const mat=(color:number,roughness=0.88)=>{
      const key=`${color}:${roughness}`;let material=sharedMaterials.get(key);
      if(!material){material=new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});sharedMaterials.set(key,material);}
      return material;
    };
    const road=mat(0x404c50); const edge=mat(0xf6f0d8); const gravel=mat(0xd7c5a2); const runoff=mat(0x70a58c);
    this.ribbon(-24,24,0.014,runoff);
    this.ribbon(-23,-11,0.023,gravel,s=>this.isGravelSection(s.distance));
    this.ribbon(11,23,0.023,gravel,s=>this.isGravelSection(s.distance));
    this.ribbon(-8.15,8.15,0.045,road);
    this.ribbon(-8,-7.82,0.057,edge);this.ribbon(7.82,8,0.057,edge);
    const curbMats=[mat(0xf5f1dc),mat(0xe96855)];
    for(let side=-1;side<=1;side+=2){
      for(let color=0;color<2;color++){
        this.ribbon(side*8.25,side*9.65,0.082,curbMats[color],s=>Math.floor(s.distance/3.2)%2===color);
      }
      this.ribbon(side*9.65,side*10.8,0.035,mat(0x3b9475));
    }
    // Game's perimeter wall agrees with the collision distance used by physics.
    const railGeo=new THREE.BoxGeometry(3.8,0.28,0.22);
    const railMat=mat(0xc7d7cf,0.65);
    const railCount=Math.ceil(this.length/4.1)*2;
    const rails=new THREE.InstancedMesh(railGeo,railMat,railCount*2);
    const posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.22,1.45,.22),mat(0x768f84),railCount);
    const o=new THREE.Object3D();let ri=0,pi=0;
    for(let d=0;d<this.length;d+=4.1){
      const s=this.sampleAt(d);
      for(const sign of [-1,1]){
        const x=s.point.x+s.right.x*24*sign,z=s.point.z+s.right.z*24*sign;
        const closest=this.nearest(x,z);
        if(Math.hypot(x-closest.point.x,z-closest.point.z)<21)continue;
        // The main straight's inner rail is replaced by a properly located pit wall.
        if(z> -108 && z<181 && x> -75&&x< -50)continue;
        const yaw=Math.atan2(-s.tangent.z,s.tangent.x);
        for(const y of [.55,1.1]){o.position.set(x,y,z);o.rotation.set(0,yaw,0);o.updateMatrix();rails.setMatrixAt(ri++,o.matrix);}
        o.position.set(x,.72,z);o.rotation.set(0,yaw,0);o.updateMatrix();posts.setMatrixAt(pi++,o.matrix);
      }
    }
    rails.count=ri;posts.count=pi;rails.castShadow=true;posts.castShadow=true;this.group.add(rails,posts);
    // Pit lane is connected to the straight at both ends; first version has no pit gameplay.
    const pp:number[]=[],ii:number[]=[];
    for(let i=0;i<=180;i++){
      const p=this.pitCurve.getPoint(i/180),t=this.pitCurve.getTangent(i/180);const n=new THREE.Vector3(t.z,0,-t.x).normalize();
      for(const sign of [-1,1])pp.push(p.x+n.x*6*sign,.052,p.z+n.z*6*sign);
      if(i<180){const k=i*2;ii.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
    const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));pg.setIndex(ii);pg.computeVertexNormals();const pm=new THREE.Mesh(pg,mat(0x68716f));pm.receiveShadow=true;this.group.add(pm);
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
