import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Track} from './track';
import {structuralRod} from './monza-details';
import {createStandLayouts,distanceToStand} from './stand-layout';
import {createHistoricOvalLayout,historicOvalTreeExclusion} from './monza-historic-oval';
import {createHistoricConnectionLayout,historicConnectionContains} from './monza-historic-connection';
import {createHistoricSouthConnectionLayout} from './monza-historic-south-connection';

const MAP='https://www.monzanet.it/wp-content/uploads/2023/09/MAPPA_CIRCUITO_2023_tribune.pdf';
const BROCHURE='https://www.monzanet.it/wp-content/uploads/2026/01/ITA2026-Experience-HU-brochure.pdf';
const PIT_MAP='https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf';

export interface CircuitPropLayout {
  id:string;kind:'camera-platform'|'lamp'|'marshal-equipment'|'transporter'|'food-truck'|'park-rest'|'safety-bay'|'wayfinding'|'video-screen';
  x:number;z:number;yaw:number;width:number;depth:number;reference:string;
  cameraTarget?:{x:number;z:number};cameraDeckHeight?:number;
}
type PropTrack=Pick<Track,'width'|'length'|'samples'|'corners'|'sampleAt'|'nearest'|'isPitLane'>&Partial<Pick<Track,'id'|'widthAt'>>;
export function propFootprint(layout:CircuitPropLayout,steps=4){
  const points:{x:number;z:number}[]=[],c=Math.cos(layout.yaw),s=Math.sin(layout.yaw);
  for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++){
    const x=(i/steps-.5)*layout.width,z=(j/steps-.5)*layout.depth;
    points.push({x:layout.x+c*x+s*z,z:layout.z-s*x+c*z});
  }
  return points;
}
function clear(track:PropTrack,prop:CircuitPropLayout){
  const stands=createStandLayouts(track),historic=track.id==='monza'&&track.widthAt?createHistoricOvalLayout(track as Required<PropTrack>):undefined;
  const connection=historic?createHistoricConnectionLayout(track as Required<PropTrack>):null;
  const southConnection=historic?createHistoricSouthConnectionLayout(track as Required<PropTrack>):null;
  return propFootprint(prop).every(p=>{const n=track.nearest(p.x,p.z);return Math.hypot(p.x-n.point.x,p.z-n.point.z)>track.width/2+2&&!track.isPitLane(p.x,p.z)&&stands.every(stand=>distanceToStand(p.x,p.z,stand)>1)&&(!historic||!historicOvalTreeExclusion(p.x,p.z,historic,2))&&[connection,southConnection].every(layout=>!historicConnectionContains(p.x,p.z,layout,2));});
}

/** Real facility types and venue relationships, scaled to the miniature.
 * These positions are authored for the game, not coordinates from a survey. */
export function createCircuitPropLayouts(track:PropTrack):CircuitPropLayout[]{
  const result:CircuitPropLayout[]=[];
  const put=(kind:CircuitPropLayout['kind'],id:string,x:number,z:number,width:number,depth:number,yaw=0,reference=BROCHURE)=>{
    const prop={kind,id,x,z,width,depth,yaw,reference};
    if(!clear(track,prop))throw new Error(`Unsafe circuit prop placement: ${id}`);
    result.push(prop);
  };
  // These narrow broadcast bays sit on the rail-side edge of the walkway,
  // leaving its full 3.5-unit pedestrian strip open behind the platforms.
  // Positions are authored for the toy circuit rather than surveyed TV posts.
  for(const [id,z,deckHeight,lead] of [
    ['start-line-camera',110,5.2,-18],['north-braking-camera',-112,4.2,25],
    ['straight-speed-camera',-41,5.2,-32],['centrale-camera',35,6.2,12],
    ['south-straight-camera',157,4.7,-24],
  ] as const){
    const x=-111.9,near=track.nearest(x,z),aim=track.sampleAt(near.distance+lead);
    put('camera-platform',id,x,z,3.7,4.4,0,PIT_MAP);
    Object.assign(result.at(-1)!,{cameraTarget:{x:aim.point.x,z:aim.point.z},cameraDeckHeight:deckHeight});
  }
  for(const z of [-98,-28,86,126])put('lamp',`straight-walkway-lamp-${z}`,-116,z,3.6,2.2,0,MAP);
  for(let i=0;i<track.corners.length;i++){
    const corner=track.corners[i],sample=track.sampleAt(corner.distance),yaw=Math.atan2(sample.tangent.x,sample.tangent.z);
    // Equipment is behind the existing marshal hut and catch fence. Check
    // the whole base against nearby track sections and the curved pit joins.
    let placed=false;
    for(const side of [1,-1])for(const offset of [34,39,44]){
      if(placed)continue;
      const p=sample.point.clone().addScaledVector(sample.right,side*offset);
      const prop:CircuitPropLayout={id:`marshal-equipment-${i+1}`,kind:'marshal-equipment',x:p.x,z:p.z,width:3.4,depth:3.4,yaw,reference:MAP};
      if(clear(track,prop)){result.push(prop);placed=true;}
    }
  }
  for(let i=0;i<4;i++)put('transporter',`paddock-transporter-${i+1}`,i%2?-2:-17,-38+Math.floor(i/2)*59,6.6,25.5,0,PIT_MAP);
  put('food-truck','fan-cafe',-142,112,5.8,9.7,Math.PI,BROCHURE);
  put('food-truck','circuit-shop',-155,112,5.8,9.7,Math.PI,BROCHURE);
  put('park-rest','fan-courtyard',-147,126,13.3,7.5,0,BROCHURE);
  // Full team strategy rooms are built once in pit-complex.ts; do not add the
  // old duplicate desk/figure pods on top of them.
  put('safety-bay','pit-exit-safety-car',-47,-65,8,16.5,0,PIT_MAP);
  put('wayfinding','walkway-north-entry',-116,-58,2.0,1.5,Math.PI/2,MAP);
  put('wayfinding','walkway-fan-entry',-116,119,2.0,1.5,Math.PI/2,MAP);
  put('video-screen','centrale-video-screen',-43,-68,1.2,14.3,0,MAP);
  return result;
}

/** All opaque parts enter the existing spatial vertex-colour architecture
 * batch. Only the shared information atlas and the TV face add a texture draw. */
export function addCircuitSurroundings(root:THREE.Group,track:Track){
  const layouts=createCircuitPropLayouts(track),materials=new Map<number,THREE.MeshStandardMaterial>();
  const mat=(color:number)=>{let m=materials.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.8});materials.set(color,m);}return m;};
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);p.add(m);return m;};
  const cyl=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,sides=8)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,sides),mat(color));m.position.set(x,y,z);p.add(m);return m;};
  const rod=(p:THREE.Object3D,a:number[],b:number[],r:number,color:number)=>structuralRod(p,new THREE.Vector3(...a),new THREE.Vector3(...b),r,mat(color));
  const labels:{text:string;position:THREE.Vector3;rotation:THREE.Euler;width:number;height:number;dark?:boolean}[]=[];
  const label=(text:string,p:THREE.Object3D,x:number,y:number,z:number,width:number,height:number,rotation=new THREE.Euler(),dark=false)=>{
    p.updateWorldMatrix(true,false);const position=new THREE.Vector3(x,y,z).applyMatrix4(p.matrixWorld),q=p.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(rotation));
    labels.push({text,position,rotation:new THREE.Euler().setFromQuaternion(q),width,height,dark});
  };
  // Spectator access runs behind the rail and before the grandstand footprint.
  box(root,-115.5,.005,37,3.5,.045,324,0xaaa999);
  box(root,-8.8,.018,-3,32,.04,112,0x939c90);
  box(root,-149,.018,113,28,.04,14,0xb1b09c);
  box(root,-129,.005,119,26,.045,3.2,0xaaa999);
  for(const x of [-21.2,-12.8,-6.2,2.2])box(root,x,.045,-11,.12,.015,89,0xd0d0bc);
  for(const z of [-70,15,102]){
    box(root,-118.8,.24,z,1.5,.48,2.5,0x8a8b7b);
    box(root,-118.8,.53,z,1.65,.1,2.65,0xc4c4b5);
    for(let j=0;j<3;j++)box(root,-118.8,.1+j*.16,z,1.51,.018,2.51,0x717b6d);
  }
  for(const layout of layouts){
    const g=new THREE.Group();g.name=`venue-${layout.id}`;g.position.set(layout.x,0,layout.z);g.rotation.y=layout.yaw;root.add(g);
    if(layout.kind==='lamp'){
      cyl(g,0,.18,0,.38,.36,0x929b91);cyl(g,0,4.3,0,.095,8.5,0x63756c);
      rod(g,[0,7.9,0],[1.0,8.5,0],.075,0x6d7c76);box(g,1.1,8.49,0,1.15,.18,.48,0x566662);box(g,1.1,8.38,0,.95,.035,.36,0xdde4cf);
    }else if(layout.kind==='camera-platform'){
      const deck=layout.cameraDeckHeight??5.2;
      box(g,0,.18,0,3.6,.36,4.3,0xaab2a4).name='camera-platform-base';
      for(const x of [-1.4,1.4])for(const z of [-1.7,1.7]){
        cyl(g,x,(deck+.4)/2,z,.09,deck+.2,0x7b8b83);rod(g,[x,.5,-1.7],[x,deck,1.7],.045,0x929d91);
      }
      box(g,0,deck,0,3.4,.23,4.0,0x7f8e85);
      for(const x of [-1.6,1.6])for(const z of [-1.9,1.9])cyl(g,x,deck+.6,z,.035,1.2,0xa9b8aa);
      for(const y of [deck+.45,deck+1.1]){
        box(g,0,y,-1.9,3.3,.045,.045,0xa9b8aa);box(g,0,y,1.9,3.3,.045,.045,0xa9b8aa);
        box(g,-1.6,y,0,.045,.045,3.8,0xa9b8aa);
      }
      // Ladder stays within the base footprint rather than sticking into the path.
      for(const x of [1.1,1.7])rod(g,[x,.4,1.8],[x,deck+.35,1.8],.035,0xa9b8aa);
      for(let y=.55;y<deck;y+=.42)box(g,1.4,y,1.8,.65,.04,.05,0xa9b8aa);
      const target=layout.cameraTarget??track.nearest(layout.x,layout.z).point;
      const rig=new THREE.Group();rig.name='broadcast-camera-rig';rig.position.y=deck;
      // The optical axis is local -Z. Rotate the whole camera, tripod and
      // operator together so the barrel visibly points at the intended asphalt.
      rig.rotation.y=Math.atan2(layout.x-target.x,layout.z-target.z)-layout.yaw;g.add(rig);
      for(const [x,z]of [[-.52,.42],[.52,.42],[0,-.48]])rod(rig,[x,.16,z],[0,1.11,0],.045,0x273a36).name='broadcast-tripod-leg';
      cyl(rig,0,1.15,0,.12,.20,0x1e302c);
      box(rig,0,1.48,-.03,.62,.48,.79,0x293d37).name='broadcast-camera-body';
      box(rig,.34,1.47,.07,.12,.27,.31,0x65766c);
      box(rig,0,1.51,-.57,.43,.39,.52,0x172621);
      const barrel=cyl(rig,0,1.51,-.95,.17,.28,0x203a34,10);barrel.rotation.x=Math.PI/2;barrel.name='broadcast-camera-lens';
      const lens=cyl(rig,0,1.51,-1.098,.135,.025,0x385d66,10);lens.rotation.x=Math.PI/2;
      box(rig,0,1.76,-.57,.46,.06,.54,0x21352e); // Lens hood / rain shield.
      rod(rig,[.17,1.15,.18],[.32,1.22,.57],.035,0x263b32);
      const torso=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),mat(0x426258));torso.name='broadcast-operator-torso';torso.position.set(0,.82,.87);torso.scale.set(.31,.52,.23);
      // Operator shares the camera's yaw, with head close to the viewfinder.
      rig.add(torso);
      const head=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),mat(0xc4b79c));head.position.set(0,1.53,.76);rig.add(head);
      box(rig,0,1.68,.77,.49,.08,.46,0x253b34);
      for(const side of [-1,1]){
        cyl(rig,side*.23,1.53,.76,.09,.09,0x243c36,6).rotation.z=Math.PI/2;
        rod(rig,[side*.23,1.12,.78],[side*.31,1.27,.30],.07,0x426258);
        rod(rig,[side*.14,.40,.9],[side*.19,.15,.95],.10,0x293d34);
      }
      label('TV',g,0,deck-.04,-2.025,1.1,.42,new THREE.Euler(0,Math.PI,0),true);
    }else if(layout.kind==='marshal-equipment'){
      box(g,0,.12,0,3.3,.24,3.3,0x939c87);
      box(g,-.9,.62,.45,.8,.9,.75,0x30724f);box(g,-.9,1.2,.45,.9,.16,.85,0xc5cbc1);
      for(const x of [.4,1.1]){cyl(g,x,.62,.4,.20,1.02,0xc9402e);box(g,x,1.18,.4,.35,.08,.18,0x283d36);rod(g,[x,1.12,.4],[x+.25,.85,.4],.035,0x34463c);}
      box(g,0,.45,-.9,2.5,.8,.45,0x647768);box(g,0,.9,-.9,2.6,.12,.52,0xb5c0a8);
      cyl(g,-1.2,2.0,-1.1,.045,3.8,0x9caaa0);
      box(g,-.8,3.1,-1.1,.8,.5,.025,0xe7bf35);box(g,-.8,2.55,-1.1,.8,.5,.025,0x4e9450);
      label('POSTO',g,0,1.22,-1.15,2.2,.44,new THREE.Euler(0,Math.PI,0));
    }else if(layout.kind==='transporter'){
      // Parked tractor/trailer and open service awning, behind the pit block.
      const color=[0xc6cdd0,0xb53731,0x315b74,0x858b8a][Number(layout.id.at(-1))-1];
      box(g,0,2.7,-2.5,4.4,4.2,18.5,0xc9cdc8);box(g,-2.24,3.9,-2.5,.08,.65,17.6,color);
      for(const z of [-9,-5,4])for(const x of [-2.05,2.05]){const w=cyl(g,x,.65,z,.62,.43,0x252c2b,10);w.rotation.z=Math.PI/2;}
      box(g,0,1.4,8.1,4.0,1.7,6.3,color);box(g,0,3.0,9.0,3.9,1.6,4.5,color);
      box(g,0,3.0,11.28,3.3,1.1,.05,0x536d75);box(g,0,.82,11.3,3.9,.37,.1,0xaeb9ac);
      for(const x of [-1.5,1.5]){box(g,x,1.37,11.42,.6,.3,.05,0xe0e5cd);const w=cyl(g,Math.sign(x)*2.0,.65,9.1,.65,.5,0x252c2b,10);w.rotation.z=Math.PI/2;}
      box(g,-2.65,4.9,-2.5,1.1,.14,13.8,color);for(const z of [-8,3])cyl(g,-2.9,2.45,z,.045,4.9,0x96a69b);
      box(g,-2.65,.95,-4,.75,.15,3.6,0xbec6ba);
    }else if(layout.kind==='food-truck'){
      const shop=layout.id==='circuit-shop',color=shop?0x315a50:0xc59153;
      box(g,0,1.5,0,3.8,2.7,7.3,0xe1decc);box(g,0,2.0,3.25,3.6,2.3,2.1,color);
      box(g,-1.95,2.1,-.7,.08,1.2,3.7,0x405d59);box(g,-2.2,1.45,-.7,.55,.15,4.2,0xc8c7b6);
      box(g,-2.25,3.2,-.7,1.0,.15,5.4,color);for(const z of [-3.2,1.7])cyl(g,-2.55,1.55,z,.035,3.1,0xb0bbac);
      for(const z of [-2.8,2.8])for(const x of [-1.95,1.95]){const w=cyl(g,x,.55,z,.48,.35,0x2b3430,10);w.rotation.z=Math.PI/2;}
      label(shop?'CIRCUIT SHOP':'CAFFÈ MONZA',g,-1.995,2.95,-.7,4.1,.65,new THREE.Euler(0,-Math.PI/2,0),true);
      box(g,0,3.6,-.7,3.9,.2,6.1,color);
    }else if(layout.kind==='park-rest'){
      box(g,0,.015,0,12.4,.08,7.4,0xb7b4a0);
      for(const x of [-3.6,3.6]){
        cyl(g,x,.86,0,.8,.14,0xa2aa99,12);cyl(g,x,.43,0,.08,.86,0x667a69);
        for(const z of [-1.2,1.2]){box(g,x,.44,z,2.0,.14,.45,0x876b4b);for(const dx of [-.7,.7])box(g,x+dx,.2,z,.1,.4,.3,0x546a59);}
      }
      for(const x of [-5.7,5.7]){box(g,x,.55,2.3,1.0,1.1,1.0,0x8b9a7d);const shrub=new THREE.Mesh(new THREE.SphereGeometry(.8,8,5),mat(0x557343));shrub.position.set(x,1.35,2.3);g.add(shrub);}
    }else if(layout.kind==='safety-bay'){
      box(g,0,.06,0,7.8,.12,16.2,0x969e91);
      for(const z of [-6.6,6.6])box(g,0,.135,z,7.3,.025,.13,0xe5e8d5);
      for(const x of [-3.7,3.7])box(g,x,.135,0,.13,.025,13.2,0xe5e8d5);
      box(g,0,1.0,-2.2,2.4,1.25,5.2,0xa7b7b7);box(g,0,1.85,-2.6,2.1,.75,2.5,0x50666e);
      box(g,0,2.35,-2.2,1.2,.15,.35,0xe7bc35);for(const x of [-1.1,1.1])for(const z of [-3.8,-.5]){const w=cyl(g,x,.5,z,.44,.3,0x252e2a,10);w.rotation.z=Math.PI/2;}
      for(const z of [-6.9,6.9]){cyl(g,3.6,.48,z,.13,.9,0xd45b32);cyl(g,3.6,.67,z,.15,.12,0xe8e5cf);}
      label('SAFETY / MEDICAL',g,-3.85,1.4,1.8,5.3,.7,new THREE.Euler(0,-Math.PI/2,0),true);
    }else if(layout.kind==='video-screen'){
      for(const z of [-5.6,5.6]){box(g,0,7.5,z,.45,15,.45,0x6f8175);rod(g,[0,6,-5.6],[0,14,5.6],.12,0x94a28f);}
      box(g,0,15.0,0,.8,6.2,14.3,0x334d43);
      label('MONZA  /  TEMPLE OF SPEED',g,-.44,15.0,0,13.6,5.55,new THREE.Euler(0,-Math.PI/2,0),true);
    }else{
      cyl(g,0,1.9,0,.06,3.8,0x7f9482);box(g,0,3.0,0,1.95,.9,.11,0x31583f);
      label(layout.id==='walkway-fan-entry'?'SHOP  /  PARCO  →':'TRIBUNA CENTRALE  →',g,0,3.0,-.067,1.8,.66,new THREE.Euler(0,Math.PI,0));
    }
  }
  // White directional arrows and dashed pedestrian/service markings are on
  // the garage apron rather than the driveable pit-lane centre.
  for(const z of [-36,4,44,91]){
    box(root,-53.7,.225,z,.16,.018,5.5,0xe6e5ce);
    const a=box(root,-54.0,.226,z-2.4,.14,.018,1.4,0xe6e5ce);a.rotation.y=.5;
    const b=box(root,-53.4,.226,z-2.4,.14,.018,1.4,0xe6e5ce);b.rotation.y=-.5;
  }
  addInformationAtlas(root,labels);
  root.userData.circuitProps=layouts;
  return layouts;
}

function addInformationAtlas(root:THREE.Group,labels:{text:string;position:THREE.Vector3;rotation:THREE.Euler;width:number;height:number;dark?:boolean}[]){
  if(typeof document==='undefined'||!labels.length)return;
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=2048;
  const ctx=canvas.getContext('2d')!,parts:THREE.BufferGeometry[]=[];const rowHeight=Math.floor(canvas.height/labels.length);
  for(let i=0;i<labels.length;i++){
    const l=labels[i],y=i*rowHeight;ctx.fillStyle=l.dark?'#294238':'#e4e5d3';ctx.fillRect(0,y,1024,rowHeight-2);
    ctx.fillStyle=l.dark?'#eeeeda':'#294238';ctx.font=`800 ${Math.floor(rowHeight*.56)}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(l.text,512,y+rowHeight*.51,985);
    const g=new THREE.PlaneGeometry(l.width,l.height),uv=g.attributes.uv;
    for(let j=0;j<uv.count;j++)uv.setY(j,1-(y+(1-uv.getY(j))*(rowHeight-2))/canvas.height);
    g.applyMatrix4(new THREE.Matrix4().compose(l.position,new THREE.Quaternion().setFromEuler(l.rotation),new THREE.Vector3(1,1,1)));parts.push(g);
  }
  const geometry=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));mesh.name='venue-wayfinding-and-screens';root.add(mesh);
}
