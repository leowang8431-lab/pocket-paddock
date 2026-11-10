import * as THREE from 'three';
import {MONACO_COORDINATES} from './monaco-coordinates';
import {asphaltTexture,catchFenceMaterial} from './monza-details';
import {batchStaticChildren} from './render-batches';
import {createMonacoPitPlan,buildMonacoPitSurfaces,type MonacoPitPlan,type MonacoPitBox,type MonacoPitProfile} from './monaco-pit-layout';
import {addStartGridPaint} from './start-grid';

export const MONACO_METRES_PER_UNIT=3.2;
export const MONACO_REAL_LENGTH=3337;
export const MONACO_REFERENCES={
 map:'https://acm.mc/wp-content/uploads/2025/05/Hospitalites_ACM_F12026_F-3.pdf',
 circuit:'https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-the-circuit-de-monaco.vFsmfGHr6RWyLFtxi58wi',
 coordinates:'https://github.com/bacinger/f1-circuits/blob/master/circuits/mc-1929.geojson',
};
export interface MonacoSample {point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3;distance:number;index:number;}
export interface MonacoCorner {number:number;id:string;name:string;zh:string;point:THREE.Vector3;distance:number;sourceIndex:number;}
const origin=[7.4258,43.7367] as const;
const lonScale=111320*Math.cos(origin[1]*Math.PI/180)/MONACO_METRES_PER_UNIT,latScale=111320/MONACO_METRES_PER_UNIT;
/** North is -Z, east is +X. This is a local projection, not a survey CRS. */
export function projectMonaco(lon:number,lat:number){return new THREE.Vector3((lon-origin[0])*lonScale,0,-(lat-origin[1])*latScale);}
const descriptions:readonly (readonly [number,string,string,string])[]=[
 [129,'sainte-devote','Sainte Dévote','圣德沃特'],[140,'beau-rivage','Beau Rivage','博里瓦日上坡'],
 [153,'massenet','Massenet','马斯内'],[0,'casino','Casino','赌场广场'],
 [8,'mirabeau-haut','Mirabeau Haute','米拉波上弯'],[21,'grand-hotel-hairpin','Grand Hotel Hairpin','费尔蒙发夹弯'],
 [29,'mirabeau-bas','Mirabeau Bas','米拉波下弯'],[39,'portier','Portier','波捷弯'],
 [45,'tunnel','Tunnel','隧道'],[55,'nouvelle-entry','Nouvelle Chicane · entry','新减速弯入口'],
 [60,'nouvelle-exit','Nouvelle Chicane · exit','新减速弯出口'],[67,'tabac','Tabac','烟草弯'],
 [73,'piscine-entry','Louis Chiron · entry','路易·希龙入口'],[79,'piscine-exit','Louis Chiron · exit','路易·希龙出口'],
 [84,'swimming-pool-right','Piscine · right','泳池右弯'],[88,'swimming-pool-left','Piscine · left','泳池左弯'],
 [99,'rascasse-approach','Rascasse Approach','拉斯卡斯前弯'],[107,'rascasse','La Rascasse','拉斯卡斯'],
 [111,'anthony-noghes','Anthony Noghès','安东尼·诺盖斯'],
];
const baseMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.78});
const clamp=THREE.MathUtils.clamp;

/** Standalone layout-review model. Elevated stations are authored to communicate
 * the uphill/downhill rhythm, not lidar or surveyed elevations. Tight streets
 * are locally narrower rather than overlapping the adjacent road. */
export class MonacoLayout {
 readonly group=new THREE.Group();
 readonly samples:MonacoSample[]=[];
 readonly corners:MonacoCorner[]=[];
 readonly length:number;
 readonly realLength=MONACO_REAL_LENGTH;
 readonly bounds=new THREE.Box3();
 readonly pitPath:THREE.Vector3[];
 readonly pitBoxes:MonacoPitBox[];
 readonly pitProfile:MonacoPitProfile;
 private readonly pitPlan:MonacoPitPlan;
 readonly tunnel:{start:number;end:number};
 readonly roadWidths:number[]=[];
 readonly sourcePoints:THREE.Vector3[];
 readonly references=MONACO_REFERENCES;
 readonly startSourceIndex=118;
 private readonly curve:THREE.CatmullRomCurve3;
 private readonly count=1500;

 constructor(){
  this.group.name='monaco-circuit-layout-v1';
  const raw=MONACO_COORDINATES.slice(0,-1).map(([lon,lat])=>projectMonaco(lon,lat));
  const order=Array.from({length:raw.length},(_,i)=>(i+this.startSourceIndex)%raw.length);
  // Heights follow the officially described climb to Casino and descent to the
  // waterfront. Horizontal positions retain the reusable geographic reference.
  const heightSources:[[number,number],...[number,number][]]=[[118,1.2],[129,1.45],[140,6.5],[153,12.8],[0,14],[8,11.7],[21,8.8],[29,6.0],[39,3.3],[45,2.25],[51,1.35],[55,1.2],[67,1.2],[88,1.2],[107,1.2],[117,1.2]];
  const station=heightSources.map(([index,y])=>({at:order.indexOf(index),y})).sort((a,b)=>a.at-b.at);
  this.sourcePoints=raw.map(p=>p.clone());
  const points=order.map((source,at)=>{
   let j=0;while(j<station.length-1&&station[j+1].at<at)j++;
   const a=station[j],b=station[(j+1)%station.length],end=j===station.length-1?order.length:b.at;
   const t=clamp((at-a.at)/Math.max(1,end-a.at),0,1),smooth=t*t*(3-2*t),p=raw[source].clone();p.y=THREE.MathUtils.lerp(a.y,b.y,smooth);this.sourcePoints[source].copy(p);return p;
  });
  this.curve=new THREE.CatmullRomCurve3(points,true,'centripetal');this.curve.arcLengthDivisions=24000;this.length=this.curve.getLength();
  for(let i=0;i<this.count;i++){const t=i/this.count,point=this.curve.getPointAt(t),tangent=this.curve.getTangentAt(t).normalize(),right=new THREE.Vector3(tangent.z,0,-tangent.x).normalize();this.samples.push({point,tangent,right,distance:t*this.length,index:i});this.bounds.expandByPoint(point);}
  for(let i=0;i<descriptions.length;i++){const [sourceIndex,id,name,zh]=descriptions[i],sample=this.nearest(raw[sourceIndex].x,raw[sourceIndex].z);this.corners.push({number:i+1,id,name,zh,point:sample.point.clone(),distance:sample.distance,sourceIndex});}
  this.tunnel={start:this.nearest(raw[40].x,raw[40].z).distance,end:this.nearest(raw[51].x,raw[51].z).distance};
  for(const s of this.samples){
   let separation=Infinity;
   for(let k=0;k<this.count;k+=2){const other=this.samples[k],arc=Math.abs(s.distance-other.distance);if(Math.min(arc,this.length-arc)<15)continue;separation=Math.min(separation,Math.hypot(s.point.x-other.point.x,s.point.z-other.point.z));}
   const a=this.samples[(s.index+this.count-1)%this.count],b=this.samples[(s.index+1)%this.count],turn=Math.max(Math.acos(clamp(a.tangent.dot(s.tangent),-1,1)),Math.acos(clamp(b.tangent.dot(s.tangent),-1,1))),radius=(this.length/this.count)/Math.max(.001,turn);
   this.roadWidths.push(Math.min(6.4,Math.max(2.6,separation-1.85),radius*1.3));
  }
  // A narrow section begins before its apex. Limiting neighbour differences
  // avoids folded offset triangles when a very short geographic segment turns.
  const widths=this.roadWidths.slice();for(let i=0;i<this.count;i++)for(let k=-7;k<=7;k++)this.roadWidths[i]=Math.min(this.roadWidths[i],widths[(i+k+this.count)%this.count]+Math.abs(k)*.18);
  this.pitPlan=createMonacoPitPlan(this);this.pitPath=this.pitPlan.path;this.pitBoxes=this.pitPlan.boxes;this.pitProfile=this.pitPlan.profile;this.build();
  this.group.userData.monacoLayout={version:1,realLength:MONACO_REAL_LENGTH,metresPerUnit:MONACO_METRES_PER_UNIT,origin:[...origin],turns:19,references:MONACO_REFERENCES,
   artistic:'Geographic horizontal loop; authored miniature elevations and variable street widths. Start-line placement and pit lane are approximate model-review locations; not a survey, driving-ready track or season-specific homologation.',startSourceIndex:this.startSourceIndex};
 }
 project(lon:number,lat:number){return projectMonaco(lon,lat);}
 sampleAt(distance:number):MonacoSample{
  const d=((distance%this.length)+this.length)%this.length,t=d/this.length,point=this.curve.getPointAt(t),tangent=this.curve.getTangentAt(t).normalize(),right=new THREE.Vector3(tangent.z,0,-tangent.x).normalize();return{point,tangent,right,distance:d,index:Math.floor(t*this.count)%this.count};
 }
 nearest(x:number,z:number):MonacoSample&{gap:number}{
  let best=this.samples[0],distance=Infinity;for(const sample of this.samples){const d=(sample.point.x-x)**2+(sample.point.z-z)**2;if(d<distance){distance=d;best=sample;}}return{...best,gap:Math.sqrt(distance)};
 }
 widthAt(distance:number){const at=(((distance%this.length)+this.length)%this.length)/this.length*this.count,i=Math.floor(at),t=at-i;return THREE.MathUtils.lerp(this.roadWidths[i],this.roadWidths[(i+1)%this.count],t);}
 heightAt(x:number,z:number){return this.nearest(x,z).point.y;}

 private build(){
  const texture=asphaltTexture(),road=new THREE.MeshStandardMaterial({color:0x686b6a,roughness:.92,...(texture?{map:texture}:{})});
  const roadVertices:number[]=[],roadUvs:number[]=[],roadIndices:number[]=[];
  const surface=(name:string,vertices:number[],indices:number[],material:THREE.Material,uv?:number[])=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;this.group.add(mesh);return mesh;};
  const edgeVertices=[[],[]] as number[][],edgeIndices=[[],[]] as number[][],kerbVertices=[[],[]] as number[][],kerbColors=[[],[]] as number[][],fenceVertices=[[],[]] as number[][],fenceIndices=[[],[]] as number[][];
  const skirtVertices:number[]=[],skirtIndices:number[]=[];
  const pitOpening=(x:number,z:number,_top:number)=>this.pitPlan.mergeAt(x,z);
  for(let i=0;i<=this.count;i++){
   const s=this.samples[i%this.count],width=this.roadWidths[i%this.count],base=i*2;
   for(const side of [-1,1]){roadVertices.push(s.point.x+s.right.x*width/2*side,s.point.y,s.point.z+s.right.z*width/2*side);roadUvs.push(side<0?0:1,i*this.length/this.count/7);}
   for(const [sideIndex,side]of [-1,1].entries()){
    for(const offset of [-.10,.025])edgeVertices[sideIndex].push(s.point.x+s.right.x*(width/2+offset)*side,s.point.y+.026,s.point.z+s.right.z*(width/2+offset)*side);
    for(const offset of [.03,.45])kerbVertices[sideIndex].push(s.point.x+s.right.x*(width/2+offset)*side,s.point.y+.016,s.point.z+s.right.z*(width/2+offset)*side);
    const c=new THREE.Color(Math.floor(s.distance/2.6)%2?0xefede3:0xd95043);for(let j=0;j<2;j++)kerbColors[sideIndex].push(c.r,c.g,c.b);
    const f=width/2+.74;for(const y of [.88,2.95])fenceVertices[sideIndex].push(s.point.x+s.right.x*(f+(y>2?.22:0))*side,s.point.y+y,s.point.z+s.right.z*(f+(y>2?.22:0))*side);
    // Only vertical retaining faces: the authored uphill now meets the plinth,
    // without a terrain slab covering the tunnel, asphalt or lower streets.
    const skirtOffset=(width/2+.45)*side;
    for(const y of [.65,s.point.y-.02])skirtVertices.push(s.point.x+s.right.x*skirtOffset,y,s.point.z+s.right.z*skirtOffset);
   }
   if(i<this.count){roadIndices.push(base,base+2,base+1,base+1,base+2,base+3);
    for(let side=0;side<2;side++){const k=i*4+side*2,next=this.samples[(i+1)%this.count],offset=(this.roadWidths[(i+1)%this.count]/2+.45)*(side?1:-1),x=next.point.x+next.right.x*offset,z=next.point.z+next.right.z*offset,current=k*3;
     // The entry/exit merge remains a genuine opening where the lower pit
     // carriageway meets a higher main-road edge; no skirt crosses that lane.
     if(pitOpening(skirtVertices[current],skirtVertices[current+2],s.point.y-.02)||pitOpening(x,z,next.point.y-.02))continue;
     if(side===0)edgeIndices[side].push(base,base+1,base+2,base+1,base+3,base+2);else edgeIndices[side].push(base,base+2,base+1,base+1,base+2,base+3);
     fenceIndices[side].push(base,base+1,base+2,base+1,base+3,base+2);
     if(side===0)skirtIndices.push(k,k+4,k+1,k+1,k+4,k+5);else skirtIndices.push(k,k+1,k+4,k+1,k+5,k+4);
    }
   }
  }
  surface('monaco-asphalt-ribbon',roadVertices,roadIndices,road,roadUvs);
  surface('monaco-road-retaining-skirt',skirtVertices,skirtIndices,new THREE.MeshStandardMaterial({color:0xc8c2af,roughness:.92}));
  const white=new THREE.MeshBasicMaterial({color:0xf3f1e8,side:THREE.DoubleSide});
  for(let side=0;side<2;side++){
   surface(`monaco-edge-paint-${side}`,edgeVertices[side],edgeIndices[side],white);
   const indices=edgeIndices[side];
   const k=surface(`monaco-red-white-kerb-${side}`,kerbVertices[side],indices,baseMaterial);k.geometry.setAttribute('color',new THREE.Float32BufferAttribute(kerbColors[side],3));
   const fence=surface(`monaco-catch-fence-${side}`,fenceVertices[side],fenceIndices[side],catchFenceMaterial());const uv:number[]=[];for(let i=0;i<=this.count;i++){uv.push(i*this.length/this.count/2,0,i*this.length/this.count/2,1);}fence.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  }
  const wallGeometry=new THREE.BoxGeometry(1,1,1),wallMaterial=new THREE.MeshStandardMaterial({color:0xc9cec7,roughness:.88});
  // Segment lengths keep walls on tight corners instead of cutting a chord over asphalt.
  const barrierGroup=new THREE.Group();barrierGroup.name='monaco-race-barriers';this.group.add(barrierGroup);
  for(let d=0;d<this.length;d+=1.8){const s=this.sampleAt(d),width=this.widthAt(d),next=this.sampleAt(d+1.8),yaw=Math.atan2(next.point.x-s.point.x,next.point.z-s.point.z);
   for(const side of [-1,1]){const position=s.point.clone().addScaledVector(s.right,(width/2+.65)*side);if(this.pitPlan.mergeAt(position.x,position.z))continue;const wall=new THREE.Mesh(wallGeometry.clone(),wallMaterial);wall.position.copy(position);wall.position.y+=.48;wall.scale.set(.26,.82,1.85);wall.rotation.y=yaw;wall.name='monaco-concrete-barrier';barrierGroup.add(wall);}
  }
  wallGeometry.dispose();batchStaticChildren(barrierGroup);
  this.group.add(buildMonacoPitSurfaces(this,this.pitPlan));
  const start=this.samples[0],yaw=Math.atan2(start.tangent.x,start.tangent.z),startGroup=new THREE.Group();startGroup.name='monaco-start-finish';startGroup.position.copy(start.point);startGroup.rotation.y=yaw;this.group.add(startGroup);
  const tile=new THREE.BoxGeometry(.49,.035,.49),lightFrame=new THREE.MeshStandardMaterial({color:0x274e49,roughness:.72});
  for(let x=0;x<12;x++)for(let z=0;z<2;z++){const mesh=new THREE.Mesh(tile.clone(),new THREE.MeshBasicMaterial({color:(x+z)%2?0xe9e7dc:0x3a4747}));mesh.position.set((x-5.5)*.5,.05,(z-.5)*.5);startGroup.add(mesh);}tile.dispose();
  // The pit building lies on local -X. Support the lights from the clear +X
  // grandstand verge instead of placing a second column through the garages.
  const gantry=new THREE.Group();gantry.name='monaco-start-light-gantry';startGroup.add(gantry);
  const postBottom=.65-start.point.y,postTop=6.5,post=new THREE.Mesh(new THREE.BoxGeometry(.45,postTop-postBottom,.45),lightFrame);post.position.set(4.5,(postTop+postBottom)/2,-.2);gantry.add(post);
  const footing=new THREE.Mesh(new THREE.BoxGeometry(.9,.12,1.05),lightFrame);footing.position.set(4.5,postBottom+.06,-.2);gantry.add(footing);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(8.4,.8,.65),lightFrame);beam.position.set(.55,6.4,-.2);gantry.add(beam);
  // Grid boxes are at negative longitudinal Z: bulbs protrude from that face
  // so waiting drivers see them before crossing the unchanged finish line.
  for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.25,10,8),new THREE.MeshStandardMaterial({color:0xa5483b,emissive:0x3a130e,roughness:.65}));lamp.name=`monaco-start-lamp-grid-facing-${i+1}`;lamp.position.set((i-2)*.82,6.37,-.57);gantry.add(lamp);}
  batchStaticChildren(gantry);
  addStartGridPaint(this.group,this,'monaco-start-grid-box',0,MONACO_METRES_PER_UNIT);
  batchStaticChildren(startGroup);batchStaticChildren(this.group);
 }
}
export function createMonacoLayout(){return new MonacoLayout();}
