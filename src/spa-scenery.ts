import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Track} from './track';
import type {StandLayout,Bounds2} from './stand-layout';
import {addPitComplex,pitFootprint,type PitFootprint,type PitComplexLayout} from './pit-complex';
import {batchStaticScenery,coloredGeometry} from './render-batches';
import {structuralRod} from './monza-details';
import {addSpaPitFacilities} from './spa-pit-facilities';
import {SPA_PIT_LAYOUT} from './spa-pit-layout';

const VENUE='https://www.spa-francorchamps.be/en/news/262_inauguration-of-the-new-infrastructure-of-the-circuit-of-spa-francorchamps';
const BOXES='https://www.spa-francorchamps.be/en/evenement-locationdesalles';
type SceneTrack=Track&{heightAt?:(x:number,z:number)=>number;terrainHeightAt?:(x:number,z:number)=>number;terrainMeshHeightAt?:(x:number,z:number)=>number};
export interface SpaStandLayout extends StandLayout {
  baseY:number;depth:number;pitch:number;rise:number;platform:number;columns:number;
  feature:boolean;reference:string;capacity:number;
}
const mats=new Map<number,THREE.MeshStandardMaterial>();
const signMaterials=new Map<string,THREE.MeshBasicMaterial>();
function mat(color:number){let m=mats.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.82});mats.set(color,m);}return m;}
function box(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);m.receiveShadow=true;p.add(m);return m;}
function ground(track:SceneTrack,x:number,z:number){return track.terrainMeshHeightAt?.(x,z)??track.terrainHeightAt?.(x,z)??track.heightAt?.(x,z)??track.nearest(x,z).point.y;}
function sign(text:string,w:number,h:number,bg='#233e45'){
  const key=`${text}/${w}/${h}/${bg}`,cached=signMaterials.get(key);if(cached)return new THREE.Mesh(new THREE.PlaneGeometry(w,h),cached);
  let map:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const c=document.createElement('canvas');c.width=1024;c.height=Math.max(64,Math.round(1024*h/w));const ctx=c.getContext('2d')!;
    ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#f0f0e6';ctx.font=`700 ${Math.floor(c.height*.62)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,c.height/2,984);
    map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
  }
  const material=new THREE.MeshBasicMaterial({map:map??null,color:map?0xffffff:0xdee6de,side:THREE.DoubleSide});signMaterials.set(key,material);
  return new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);
}
export function spaStandBounds(s:Pick<SpaStandLayout,'width'|'depth'>):Bounds2{return{minX:-s.width/2-3,maxX:s.width/2+3,minZ:-6,maxZ:s.depth+6};}
function local(s:Pick<SpaStandLayout,'x'|'z'|'yaw'>,x:number,z:number){const c=Math.cos(s.yaw),v=Math.sin(s.yaw);return{x:s.x+c*x+v*z,z:s.z-v*x+c*z};}
export function spaStandFootprint(s:SpaStandLayout,steps=3){const b=spaStandBounds(s),p:{x:number;z:number}[]=[];for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++)p.push(local(s,b.minX+(b.maxX-b.minX)*i/steps,b.minZ+(b.maxZ-b.minZ)*j/steps));return p;}
export function distanceToSpaStand(x:number,z:number,s:SpaStandLayout){const c=Math.cos(s.yaw),v=Math.sin(s.yaw),dx=x-s.x,dz=z-s.z,lx=c*dx-v*dz,lz=v*dx+c*dz,b=spaStandBounds(s);return Math.hypot(Math.max(b.minX-lx,0,lx-b.maxX),Math.max(b.minZ-lz,0,lz-b.maxZ));}
function collider(s:SpaStandLayout):Bounds2{const p=spaStandFootprint(s,1);return{minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minZ:Math.min(...p.map(v=>v.z)),maxZ:Math.max(...p.map(v=>v.z))};}
function rectCorners(s:SpaStandLayout){const b=spaStandBounds(s);return[[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ]].map(([x,z])=>local(s,x,z));}
function separated(a:SpaStandLayout,b:SpaStandLayout,gap=5){
  const pa=rectCorners(a),pb=rectCorners(b);
  for(const s of [a,b])for(const [x,z]of [[Math.cos(s.yaw),-Math.sin(s.yaw)],[Math.sin(s.yaw),Math.cos(s.yaw)]]){
    const aa=pa.map(p=>p.x*x+p.z*z),bb=pb.map(p=>p.x*x+p.z*z);
    if(Math.max(...aa)+gap<=Math.min(...bb)||Math.max(...bb)+gap<=Math.min(...aa))return true;
  }
  return false;
}
function distanceToRect(x:number,z:number,p:PitFootprint){const c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=x-p.x,dz=z-p.z;return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-p.width/2),Math.max(0,Math.abs(s*dx+c*dz)-p.depth/2));}

/** Full roofs and foundations, including the returning road, are audited.
 * Only the main stand is an architectural reference; the twenty smaller
 * stands are authored spectator facilities, not claims of surveyed locations. */
export function createSpaStandLayouts(track:SceneTrack,facilities:readonly PitFootprint[]=[]):SpaStandLayout[]{
  const placed:SpaStandLayout[]=[];
  const raidillon=track.corners.find(c=>/raidillon/i.test(c.name))??track.corners[2];
  const specs=[{id:'spa-raidillon',distance:raidillon.distance+28,feature:true},...Array.from({length:20},(_,i)=>({id:`spa-tribune-${String(i+1).padStart(2,'0')}`,distance:((i+.45)/20*track.length)%track.length,feature:false}))];
  for(const spec of specs){
    let chosen:SpaStandLayout|undefined;
    // Track.right is the historic XZ normal; its negative lies to the driver's
    // right in our +Z climbing view. Match the photographed Raidillon side.
    for(const shift of [0,20,-20,45,-45,75,-75,110,-110])for(const side of [-1,1])for(const offset of spec.feature?[58,72,88,108,132,156]:[44,54,66,80,98]){
      if(chosen)break;
      const sample=track.sampleAt(spec.distance+shift),point=sample.point.clone().addScaledVector(sample.right,side*offset),columns=spec.feature?115:30,rows=spec.feature?40:10;
      const candidate:SpaStandLayout={id:spec.id,x:point.x,z:point.z,yaw:Math.atan2(point.x-sample.point.x,point.z-sample.point.z),width:spec.feature?86:38,rows,covered:true,target:{x:sample.point.x,z:sample.point.z,distance:sample.distance},minTrackClearance:Infinity,minColliderClearance:Infinity,baseY:0,depth:spec.feature?30:17,pitch:spec.feature?.75:1.65,rise:spec.feature?.34:.64,platform:spec.feature?6.2:1.4,columns,capacity:rows*columns,feature:spec.feature,reference:spec.feature?VENUE:BOXES};
      if(!placed.every(s=>separated(s,candidate)))continue;
      const occupied=spaStandFootprint(candidate,5);
      if(!occupied.every(p=>!track.isPitLane(p.x,p.z)&&facilities.every(b=>distanceToRect(p.x,p.z,b)>5)))continue;
      const bound=collider(candidate);
      for(const {point:p}of track.samples){
        candidate.minTrackClearance=Math.min(candidate.minTrackClearance,distanceToSpaStand(p.x,p.z,candidate));
        candidate.minColliderClearance=Math.min(candidate.minColliderClearance,Math.hypot(Math.max(bound.minX-p.x,0,p.x-bound.maxX),Math.max(bound.minZ-p.z,0,p.z-bound.maxZ)));
      }
      if(candidate.minTrackClearance<29||candidate.minColliderClearance<27)continue;
      candidate.baseY=Math.max(...spaStandFootprint(candidate,12).map(p=>ground(track,p.x,p.z)))+.12;chosen=candidate;
    }
    if(!chosen)throw new Error(`No safe Spa stand placement: ${spec.id}`);placed.push(chosen);
  }
  return placed;
}

let crowdNear:{body:THREE.BufferGeometry;head:THREE.BufferGeometry},crowdFar:typeof crowdNear;
function addCrowd(p:THREE.Group,s:SpaStandLayout){
  if(!crowdNear){crowdNear={body:new THREE.BoxGeometry(.39,.53,.32),head:coloredGeometry([{geometry:new THREE.OctahedronGeometry(.185,1).translate(0,.39,0),color:0xe4c5a5},{geometry:new THREE.BoxGeometry(.22,.045,.12).translate(0,.46,-.15),color:0x293c42}])};crowdFar={body:new THREE.BoxGeometry(.39,.53,.32),head:coloredGeometry([{geometry:new THREE.OctahedronGeometry(.18,0).translate(0,.39,0),color:0xe4c5a5}])};}
  const lod=new THREE.LOD();lod.name='spa-spectator-lod';const mid=s.depth/2;lod.position.z=mid;
  const bodyMat=new THREE.MeshLambertMaterial({color:0xffffff}),headMat=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),transform=new THREE.Object3D(),colors=[0xbc3834,0xe6e3d8,0x314656,0xc5a948,0xb83132,0x8794a1];let count=0;
  for(const [i,shape]of [crowdNear,crowdFar].entries()){
    const level=new THREE.Group(),bodies=new THREE.InstancedMesh(shape.body,bodyMat,s.capacity),heads=new THREE.InstancedMesh(shape.head,headMat,s.capacity);count=0;
    for(let row=0;row<s.rows;row++)for(let col=0;col<s.columns;col++){
      if((col+row*11)%13===0)continue;
      const x=s.feature?-s.width/2+1.4+col*.68+Math.floor(col/23)*1.4:-s.width/2+.8+col*1.23;
      transform.position.set(x,s.platform+.69+row*s.rise,row*s.pitch+.4-mid);transform.updateMatrix();bodies.setMatrixAt(count,transform.matrix);heads.setMatrixAt(count,transform.matrix);bodies.setColorAt(count,new THREE.Color(colors[(row*7+col*3)%colors.length]));count++;
    }
    bodies.count=heads.count=count;bodies.name='spa-crowd-bodies';heads.name='spa-crowd-heads';for(const m of [bodies,heads]){m.computeBoundingSphere();m.castShadow=false;}level.add(bodies,heads);lod.addLevel(level,i===0?0:100,.12);
  }
  lod.addLevel(new THREE.Group(),s.feature?700:420,.12);lod.userData={spectators:count,capacity:s.capacity,drawsPerLevel:2};p.add(lod);return count;
}

export function addSpaGrandstand(parent:THREE.Group,track:SceneTrack,s:SpaStandLayout){
  const g=new THREE.Group();g.name=`grandstand-${s.id}`;g.position.set(s.x,s.baseY,s.z);g.rotation.y=s.yaw;g.userData.layout=s;parent.add(g);
  const b=spaStandBounds(s),top=s.platform+(s.rows-1)*s.rise,roofY=top+(s.feature?5.0:5.5),back=s.depth+1.5;
  box(g,0,.18,s.depth/2,s.width+1,.36,s.depth+6,0xb4b6ad);
  // Retaining plinths meet the sampled terrain under every support bay.
  const footings:{x:number;z:number;bottom:number}[]=[];
  const footing=(x:number,z:number,width=1.1)=>{const p=local(s,x,z),floor=ground(track,p.x,p.z)-s.baseY,h=Math.max(.3,-floor);box(g,x,-h/2,z,width,h,width,0x8f9690);footings.push({x:p.x,z:p.z,bottom:s.baseY-h});};
  for(let x=-s.width/2;x<=s.width/2;x+=6)for(const z of [-2,s.depth])footing(x,z);
  // A continuous raked seating bowl closes the spaces between the tiers.
  // Separate floating horizontal strips are not a supported grandstand.
  const front=-.45,rear=(s.rows-1)*s.pitch+.7,bottom=s.platform-.45,frontTop=s.platform-.22,backTop=top-.22;
  const vertices=[-s.width/2,bottom,front,s.width/2,bottom,front,-s.width/2,bottom,rear,s.width/2,bottom,rear,-s.width/2,frontTop,front,s.width/2,frontTop,front,-s.width/2,backTop,rear,s.width/2,backTop,rear];
  const bowlGeometry=new THREE.BufferGeometry();bowlGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));bowlGeometry.setIndex([4,6,5,5,6,7,0,1,2,1,3,2,0,4,1,1,4,5,2,3,6,3,7,6,0,2,4,2,6,4,1,5,3,3,5,7]);bowlGeometry.computeVertexNormals();const bowl=new THREE.Mesh(bowlGeometry,mat(0xaeb2a9));bowl.name='continuous-raked-seating-bowl';g.add(bowl);
  for(let row=0;row<s.rows;row++){
    box(g,0,s.platform+row*s.rise,row*s.pitch,s.width,.22,s.pitch+.06,0xbcbeb5);
    box(g,0,s.platform+.29+row*s.rise,row*s.pitch+.15,s.width,.13,.42,s.feature?0xd0cfbf:0xa3adb2);
  }
  if(s.feature){
    // Photo-based long box front, shaded glazing band and private terrace.
    box(g,0,2.3,4,s.width,4.6,10,0xa6aaa3);box(g,0,5.0,3,s.width+1.8,.35,13,0xbfc2b9);
    const panels:THREE.BufferGeometry[]=[];
    for(let x=-s.width/2+1.4;x<s.width/2-1.4;x+=3.0){const geo=new THREE.BoxGeometry(2.75,2.3,.08);geo.translate(x,3.25,-1.16);panels.push(geo);box(g,x+1.42,3.25,-1.23,.13,2.6,.20,0xb9beb9);}
    const glass=new THREE.Mesh(mergeGeometries(panels,false)!,new THREE.MeshStandardMaterial({color:0x698a98,roughness:.27,metalness:.24}));glass.name='raidillon-hospitality-glazing';g.add(glass);panels.forEach(p=>p.dispose());
    for(const y of [5.5,6.1])box(g,0,y,-3.5,s.width,.06,.06,0xb3beba);
    for(let x=-s.width/2;x<=s.width/2;x+=3)box(g,x,5.55,-3.5,.055,1.2,.055,0xb3beba);
    for(let aisle=1;aisle<5;aisle++){
      const x=-s.width/2+1.4+aisle*23*.68+(aisle-.5)*1.4;
      for(let step=0;step<s.rows*2;step++)box(g,x,s.platform+step*s.rise/2+.07,step*s.pitch/2,.95,.12,s.pitch/2+.03,0xb7b9b0);
      structuralRod(g,new THREE.Vector3(x-.53,s.platform+1.1,0),new THREE.Vector3(x-.53,top+1.1,(s.rows-1)*s.pitch),.035,mat(0x7d8b8c));
    }
    // Two exterior switchbacks connect actual hillside level to the terrace;
    // both flights stay beside, rather than inside, the glazed box walls.
    const access:{x:number;z:number;groundY:number;landingY:number}[]=[];
    for(const side of [-1,1]){
      const outer=side*(s.width/2+2.45),inner=side*(s.width/2+.7),walk=side*(s.width/2+1.55),p=local(s,outer,8),start=ground(track,p.x,p.z)-s.baseY,
        finish=s.platform-.1,mid=(start+finish)/2,steps=Math.max(16,Math.ceil((finish-start)/.36));
      for(let i=0;i<steps;i++){
        const f=(i+.5)/steps,z1=8-f*8.8,z2=-.8+f*8.8;
        box(g,outer,start+(mid-start)*f,z1,.7,.16,8.8/steps+.03,0xb8bdb7);
        box(g,inner,mid+(finish-mid)*f,z2,.7,.16,8.8/steps+.03,0xb8bdb7);
      }
      box(g,side*(s.width/2+1.575),mid,-1.15,2.5,.18,1.0,0xb8bdb7);
      box(g,side*(s.width/2+1.125),finish,8.2,1.55,.18,.8,0xb8bdb7);
      box(g,walk,finish,2.3,.70,.18,12.4,0xb8bdb7);
      box(g,side*(s.width/2-.2),finish,-3.5,4.2,.18,1.0,0xb8bdb7);
      for(const [x,a,b]of [[outer,new THREE.Vector3(outer,start+1.05,8),new THREE.Vector3(outer,mid+1.05,-.8)],
        [inner,new THREE.Vector3(inner,mid+1.05,-.8),new THREE.Vector3(inner,finish+1.05,8)]] as const){
        structuralRod(g,a,b,.04,mat(0x84918d));box(g,x,start+.55,8,.055,1.1,.055,0x84918d);
      }
      access.push({x:p.x,z:p.z,groundY:start+s.baseY,landingY:finish+s.baseY});
    }
    g.userData.terraceAccess=access;
  }
  const roof=box(g,0,roofY,s.depth/2,s.width+6,.36,s.depth+10,0x696f70);roof.name='raidillon-suspended-grey-canopy';roof.rotation.x=-.035;
  box(g,0,roofY-.12,-4.8,s.width+6,.7,.18,0x7c8181);
  for(let x=-s.width/2-1;x<=s.width/2+1;x+=8){
    footing(x,back,.7);
    box(g,x,roofY/2,back,.30,roofY,.30,0x9ca7a7);
    structuralRod(g,new THREE.Vector3(x,roofY-3,back),new THREE.Vector3(x,roofY-.45,-4),.085,mat(0x949e9e));
    structuralRod(g,new THREE.Vector3(x,roofY-.5,back),new THREE.Vector3(x,roofY-.5,-4),.055,mat(0x858f90));
  }
  for(const z of [0,.25,.5,.75,1].map(f=>s.depth*f))box(g,0,roofY-.4,z,s.width+5,.14,.12,0x899495);
  const label=sign(s.feature?'RAIDILLON • CIRCUIT DE SPA-FRANCORCHAMPS':'CIRCUIT DE SPA-FRANCORCHAMPS',Math.min(s.width-4,66),s.feature?.9:.8);label.position.set(0,s.feature?1.15:1.7,-2.2);label.rotation.y=Math.PI;g.add(label);
  g.userData.spectators=addCrowd(g,s);g.userData.reference={url:s.reference,capacityTarget:s.feature?4600:s.capacity,artistic:'Photo-informed architectural proportions; not a survey or a construction drawing. Grey continuous canopy, steep seating and lower hospitality boxes.'};
  g.userData.fullBounds=b;g.userData.footings=footings;return g;
}

function transformedFootprint(p:PitFootprint):PitFootprint{return{...p,x:p.x,z:200-p.z,yaw:-p.yaw};}
function unmirrorPitLabels(root:THREE.Group){
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material)||!('map'in object.material)||!object.material.map)return;
    const geometry=object.geometry.clone(),uv=geometry.attributes.uv,index=geometry.index;if(!uv)return;
    const parents=Array.from({length:uv.count},(_,i)=>i),find=(i:number):number=>parents[i]===i?i:parents[i]=find(parents[i]);
    const count=index?.count??uv.count;
    for(let i=0;i<count;i+=3){const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;parents[find(b)]=find(a);parents[find(c)]=find(a);}
    const ranges=new Map<number,{min:number;max:number}>();
    for(let i=0;i<uv.count;i++){const id=find(i),u=uv.getX(i),r=ranges.get(id);if(r){r.min=Math.min(r.min,u);r.max=Math.max(r.max,u);}else ranges.set(id,{min:u,max:u});}
    // Flip each connected sign/screen island in place. A whole-atlas flip
    // would swap telemetry tiles or put a different team's image on a room.
    for(let i=0;i<uv.count;i++){const r=ranges.get(find(i))!;uv.setX(i,r.min+r.max-uv.getX(i));}
    uv.needsUpdate=true;geometry.userData.readableReflectedLabels=true;object.geometry=geometry;
  });
}
function addSpaPaddock(parent:THREE.Group,track:SceneTrack){
  // Reuse complete team workstations and their authored people without copying
  // Monza's distinctive towers, Fans Club corner or oval-track scenery.
  const templateTrack=new Track(),template=new THREE.Group(),source=addPitComplex(template,templateTrack,'spa-template'),localRoot=new THREE.Group();
  localRoot.name='spa-gp-pit-building';localRoot.scale.y=1.25;parent.add(localRoot);
  const keep=['pit-service-apron-equipment','pit-wall-original-height','pit-telemetry-screen-atlas','pit-garage-number-and-team-atlas','riolex-pit-entry-clock',...source.layout.strategyPods.map(p=>p.id)];
  for(const name of keep){const node=source.group.getObjectByName(name);if(node){node.removeFromParent();localRoot.add(node);}}
  // Spa mirrors the shared paddock template. Its original Monza wall would
  // run through the eleven strategy rooms and the RIOLEX bridge post. Move
  // only this venue's wall towards the race lane, outside those solids.
  const pitWall=localRoot.getObjectByName('pit-wall-original-height') as THREE.Group;
  pitWall.position.x-=1.8;
  pitWall.userData.clearance={worldCenterX:-75.6,strategyRoomGap:.65,clockPostGap:.29};
  const details=addSpaPitFacilities(localRoot,parent);
  // Garage twelve is a neutral spare bay here; remove the Monza-only fallback
  // atlas row while retaining all eleven real team fascias.
  const headers=localRoot.getObjectByName('pit-garage-number-and-team-atlas') as THREE.Mesh;
  if(headers){const geo=headers.geometry.clone(),pos=geo.attributes.position,index=geo.index?.array??Array.from({length:pos.count},(_,i)=>i),keepIndices:number[]=[];
    for(let i=0;i<index.length;i+=3)if((pos.getZ(index[i])+pos.getZ(index[i+1])+pos.getZ(index[i+2]))/3<100)keepIndices.push(index[i],index[i+1],index[i+2]);
    geo.setIndex(keepIndices);geo.computeBoundingSphere();headers.geometry=geo;}
  // The compact sign atlas contains some Monza-only lounge labels. Keep only
  // the actual eleven pit-wall fascia planes; no detached glass/labels remain.
  const original=source.group.getObjectByName('pit-complex-sign-atlas') as THREE.Mesh;
  if(original){
    const geo=original.geometry.clone(),positions=geo.attributes.position,old=geo.index?.array??Array.from({length:positions.count},(_,i)=>i),indices:number[]=[];
    for(let i=0;i<old.length;i+=3){const x=(positions.getX(old[i])+positions.getX(old[i+1])+positions.getX(old[i+2]))/3;
      if(x< -70&&x> -75.5)indices.push(old[i],old[i+1],old[i+2]);}
    geo.setIndex(indices);geo.computeBoundingSphere();const mesh=new THREE.Mesh(geo,original.material);mesh.name='spa-strategy-room-team-atlas';localRoot.add(mesh);
  }
  box(localRoot,-40,-.22,32,18,.4,165,0xb4bbb3);box(localRoot,-31.4,3.8,32,.7,7.6,165,0xafb6b0);
  box(localRoot,-40,7.45,32,20,.65,167,0xd5d9d1);box(localRoot,-40,14.4,32,21,.55,168,0x9da8a6);
  for(let i=0;i<13;i++)box(localRoot,-49.25,3.7,-49.4+i*13.2,.55,7.4,.45,0xc8cfca);
  for(const z of [-50.4,114.5])box(localRoot,-40,7.3,z,18,14.6,.65,0xc8cec5);
  const glazing=new THREE.MeshStandardMaterial({color:0x7796a0,roughness:.28,metalness:.25});
  for(const y of [9.5,12.4]){
    const glass=new THREE.Mesh(new THREE.BoxGeometry(.15,2.35,163),glazing);glass.position.set(-49.15,y,32);localRoot.add(glass);
    box(localRoot,-49.4,y-1.25,32,.45,.18,164,0xe2e5db);
  }
  for(let z=-47;z<114;z+=5.5)box(localRoot,-49.35,11,z,.25,6.0,.15,0xd6dcd4);
  const title=sign('CIRCUIT DE SPA-FRANCORCHAMPS  •  PIT LANE',105,1.1);title.position.set(-49.62,8.0,32);title.rotation.y=-Math.PI/2;localRoot.add(title);
  // Fictional RIOLEX bridge retained as a recognisable game facility.
  for(const x of [-74.5,-51.5])box(localRoot,x,4.3,124,.72,8.6,.9,0x2c644f);
  box(localRoot,-63,8.55,124,24,3.5,.85,0x215b48);
  const riolex=sign('RIOLEX',8.4,1.05,'#215b48');riolex.position.set(-69.5,8.7,124.48);localRoot.add(riolex);
  unmirrorPitLabels(localRoot);
  const base=source.layout;
  const retained=[base.boxes,...base.props,...base.strategyPods,...base.clockBeam.posts];
  const boxes={...transformedFootprint(base.boxes),height:14.675*1.25};
  const layout:PitComplexLayout={...base,reference:BOXES,artistic:'Spa GP pit building proportions are authored for gameplay. Eleven complete team rooms and equipment reuse the shared paddock asset; Monza towers and Fans Club are not placed at Spa.',boxes,towers:[],stairs:[],clubs:[],props:base.props.map(transformedFootprint),strategyPods:base.strategyPods.map(p=>({...transformedFootprint(p),teamId:p.teamId,teamName:p.teamName})),clockBeam:{...transformedFootprint(base.clockBeam),brand:'RIOLEX',clearHeight:base.clockBeam.clearHeight,posts:base.clockBeam.posts.map(transformedFootprint)},footprints:retained.map(p=>p===base.boxes?boxes:transformedFootprint(p))};
  const colliders=[layout.boxes,...layout.strategyPods,...layout.clockBeam.posts].map(p=>{const c=Math.cos(p.yaw),s=Math.sin(p.yaw),ps=[[-p.width/2,-p.depth/2],[p.width/2,-p.depth/2],[p.width/2,p.depth/2],[-p.width/2,p.depth/2]].map(([x,z])=>({x:p.x+c*x+s*z,z:p.z-s*x+c*z}));return{minX:Math.min(...ps.map(v=>v.x)),maxX:Math.max(...ps.map(v=>v.x)),minZ:Math.min(...ps.map(v=>v.z)),maxZ:Math.max(...ps.map(v=>v.z))};});
  // Official pit timing coordinates place the F1 lane on the driver's right
  // of the uphill straight. Reflect the complete local asset, retaining each
  // team's longitudinal position and keeping all garage doors towards it.
  localRoot.rotation.y=Math.PI;localRoot.scale.x=-1;localRoot.position.set(0,0,200);localRoot.userData.layout=layout;localRoot.userData.strategyDetails=source.group.userData.strategyDetails;
  localRoot.userData.garageDetails={garages:details.garages.map(g=>({id:g.name,...g.userData})),parking:details.parking.filter(g=>g.userData.teamId).map(g=>({id:g.name,...g.userData})),removedLegacyPlates:details.removedLegacyPlates,removedLegacyPaint:details.removedLegacyPaint,equipmentRetreat:details.equipmentRetreat,shiftedTelemetryVertices:details.shiftedTelemetryVertices,frontage:details.frontage,groundOwner:details.groundOwner};
  const supports:{id:string;bottom:number;top:number}[]=[];
  for(const f of [layout.boxes,...layout.strategyPods]){
    const bottom=Math.min(...pitFootprint(f,8).map(p=>ground(track,p.x,p.z)))-.35,top=f===layout.boxes?SPA_PIT_LAYOUT.serviceY-.03:0;
    box(parent,f.x,(bottom+top)/2,f.z,f.width,top-bottom,f.depth,0x8d9991);
    supports.push({id:f.id,bottom,top});
  }
  localRoot.userData.foundations=supports;
  // Keep only the below-ground support. Track owns the adjacent gray working
  // apron, teal divider and fast-lane surfaces, never a second visible slab.
  const apronPoints=Array.from({length:17},(_,i)=>[ground(track,-31,73+i*190/16),ground(track,-56.85,73+i*190/16)]).flat(),apronBottom=Math.min(...apronPoints)-.35;
  box(parent,-43.925,(apronBottom-.2)/2,168,25.85,-.2-apronBottom,190,0x8d9991);
  templateTrack.group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});
  return{layout,colliders,clock:source.clockController,review:[...details.garages,...details.parking,...(details.equipment?[details.equipment]:[]),pitWall].map(object=>({object,parent:object.parent!}))};
}

function addSpaForest(root:THREE.Group,track:SceneTrack,stands:SpaStandLayout[],facilities:readonly PitFootprint[]){
  const parts=[{geometry:new THREE.CylinderGeometry(.18,.37,6.5,6).translate(0,3.25,0),color:0x635842}];
  for(const [y,r,h]of [[6.6,2.6,5.5],[8.6,2.25,4.9],[10.5,1.7,4.7],[12.3,1.1,3.7]])parts.push({geometry:new THREE.ConeGeometry(r,h,8).translate(0,y,0),color:y<9?0x3e6448:0x537951});
  const pine=coloredGeometry(parts),broad=coloredGeometry([{geometry:new THREE.CylinderGeometry(.19,.38,6.2,6).translate(0,3.1,0),color:0x74644d},{geometry:new THREE.IcosahedronGeometry(3.5,1).scale(1,1.22,1).translate(0,8.1,0),color:0x597c48}]);
  const farPine=coloredGeometry([{geometry:new THREE.CylinderGeometry(.2,.35,5,5).translate(0,2.5,0),color:0x635842},{geometry:new THREE.ConeGeometry(2.5,11.5,6).translate(0,8.7,0),color:0x4b704b}]);
  const farBroad=coloredGeometry([{geometry:new THREE.CylinderGeometry(.2,.35,5,5).translate(0,2.5,0),color:0x74644d},{geometry:new THREE.OctahedronGeometry(3.4,0).scale(1,1.2,1).translate(0,7.8,0),color:0x597c48}]);
  const minX=Math.min(...track.samples.map(s=>s.point.x))-180,maxX=Math.max(...track.samples.map(s=>s.point.x))+180,minZ=Math.min(...track.samples.map(s=>s.point.z))-180,maxZ=Math.max(...track.samples.map(s=>s.point.z))+180;
  let seed=710284;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const cells=new Map<string,{x:number;y:number;z:number;size:number;kind:number}[]>();let count=0;
  for(let attempt=0;attempt<18000&&count<1800;attempt++){
    const x=minX+random()*(maxX-minX),z=minZ+random()*(maxZ-minZ),near=track.nearest(x,z),distance=Math.hypot(x-near.point.x,z-near.point.z);
    if(distance<39||distance>250||track.isPitLane(x,z)||stands.some(s=>distanceToSpaStand(x,z,s)<8)||facilities.some(p=>distanceToRect(x,z,p)<8))continue;
    const key=`${Math.floor(x/115)},${Math.floor(z/115)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push({x,y:ground(track,x,z),z,size:.8+random()*.8,kind:random()<.72?0:1});count++;
  }
  const material=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),o=new THREE.Object3D();
  for(const [key,locations]of cells){
    const [cx,cz]=key.split(',').map(Number),lod=new THREE.LOD();lod.name=`spa-forest-${key}`;lod.position.set((cx+.5)*115,0,(cz+.5)*115);
    for(let level=0;level<2;level++){
      const group=new THREE.Group();for(const kind of [0,1]){const points=locations.filter(p=>p.kind===kind);if(!points.length)continue;const mesh=new THREE.InstancedMesh(level===0?(kind?broad:pine):(kind?farBroad:farPine),material,points.length);
        points.forEach((p,i)=>{o.position.set(p.x-lod.position.x,p.y,p.z-lod.position.z);o.scale.setScalar(p.size);o.rotation.y=(p.x+p.z)%6.28;o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.computeBoundingSphere();mesh.name=`spa-${kind?'broadleaf':'fir'}-${level?'far':'near'}`;mesh.castShadow=false;group.add(mesh);
      }lod.addLevel(group,level===0?0:145,.12);
    }lod.addLevel(new THREE.Group(),760,.12);root.add(lod);
  }
  root.userData.forest={instances:count,cells:cells.size,kinds:['Ardennes-conifer','broadleaf'],maxDrawsPerCell:2,artistic:'An authored mixed Ardennes forest inspired by the official venue photographs; not a tree survey.'};
}

/** A separate elevated Ardennes venue, with a referenced Raidillon landmark.
 * Scenic dimensions and facilities are authored, not a literal 1:1 survey. */
export function createSpaScenery(track:SceneTrack):THREE.Group{
  const root=new THREE.Group();root.name='Spa-Francorchamps miniature Ardennes';
  const pit=addSpaPaddock(root,track),stands=createSpaStandLayouts(track,pit.layout.footprints);let people=0;
  for(const s of stands)people+=addSpaGrandstand(root,track,s).userData.spectators;
  root.userData.stands=stands;root.userData.pitComplex=pit.layout;root.userData.pitClockController=pit.clock;root.userData.pitColliders=[...pit.colliders,...stands.map(collider)];
  const raidillon=stands[0];
  root.userData.landmarks=[{id:'spa-raidillon-grandstand',name:'Raidillon Grandstand / Boxes',x:raidillon.x,z:raidillon.z,height:raidillon.platform+(raidillon.rows-1)*raidillon.rise+5,width:raidillon.width,length:raidillon.depth,reference:VENUE,artistic:'Grey continuous cantilever canopy, 4600 seat positions, steep grey tiers, lower glazed boxes and terrace. Photo-based proportions, not engineering dimensions.'},{id:'spa-gp-pits',name:'Spa GP Pit Building',x:pit.layout.boxes.x,z:pit.layout.boxes.z,width:pit.layout.boxes.width,length:pit.layout.boxes.depth,height:18,reference:BOXES,artistic:pit.layout.artistic}];
  root.userData.backgroundLandmarks=[];root.userData.circuitProps=[];root.userData.tracksideSafety={vehicles:[],tyreBarriers:[]};root.userData.architecture={heightScale:1,footprintsPreserved:true};
  root.userData.grandstands={count:stands.length,spectators:people,capacity:stands.reduce((a,b)=>a+b.capacity,0),raidillonSeatPositions:4600,crowdDrawsPerVisibleStand:2,reference:VENUE,artistic:'One reference-informed Raidillon stand and twenty authored spectator stands, all audited against the complete circuit.'};
  addSpaForest(root,track,stands,pit.layout.footprints);
  const gantry=new THREE.Group();gantry.name='spa-start-gantry';root.add(gantry);
  for(const x of [-99,-71])box(gantry,x,5.2,92,.5,10.4,.5,0x3d4d4e);box(gantry,-85,10.2,92,29,1.3,1.0,0xd4d8d0);
  const title=sign('SPA-FRANCORCHAMPS',26,1.0);title.position.set(-85,10.2,92.6);gantry.add(title);
  for(let i=0;i<5;i++){
    const material=new THREE.MeshStandardMaterial({color:0x492f2c,emissive:0xee382e,emissiveIntensity:.05});
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.36,10,7),material);bulb.scale.z=.25;bulb.position.set(-89+i*2,8.5,92.66);bulb.name=`start-light-${i}`;gantry.add(bulb);
  }
  for(const {object}of pit.review)object.removeFromParent();
  batchStaticScenery(root,110);
  for(const {object,parent}of pit.review){batchStaticScenery(object,1000000);parent.add(object);}
  root.updateMatrixWorld(true);root.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;if(o instanceof THREE.Mesh)o.castShadow=false;});
  return root;
}
