import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Track} from './track';
import {teams,type TeamId} from './team-catalog';
import {createStandLayouts,distanceToStand,type Bounds2} from './stand-layout';
import {createCircuitPropLayouts} from './monza-surroundings';
import {addGarageHeaders,pitGlazingMaterial,structuralRod} from './monza-details';
import {ARCHITECTURE_HEIGHT_SCALE,scaleArchitectureHeight} from './architecture-scale';

const REFERENCE='https://www.monzanet.it/wp-content/uploads/2025/11/Brochure_Hospitality_GPf12026.pdf';
export interface PitFootprint {
  id:string;kind:string;x:number;z:number;width:number;depth:number;yaw:number;height:number;minY:number;solid:boolean;
}
export interface PitStairLayout extends PitFootprint {towerId:string;deckHeight:number;bridgeHeadroom:number;entrance:{x:number;y:number;z:number};path:{x:number;y:number;z:number}[]}
export interface StrategyPodLayout extends PitFootprint {teamId:TeamId;teamName:string}
export interface PitComplexLayout {
  reference:string;artistic:string;heightScale:number;boxes:PitFootprint;towers:PitFootprint[];clubs:PitFootprint[];
  clockBeam:PitFootprint&{brand:'RIOLEX';clearHeight:number;posts:PitFootprint[]};
  props:PitFootprint[];stairs:PitStairLayout[];strategyPods:StrategyPodLayout[];screenData:'authored decorative telemetry';footprints:PitFootprint[];
}
type PitTrack=Pick<Track,'width'|'length'|'samples'|'corners'|'nearest'|'sampleAt'|'isPitLane'>;
export function pitFootprint(layout:PitFootprint,steps=6){
  const c=Math.cos(layout.yaw),s=Math.sin(layout.yaw),points:{x:number;z:number}[]=[];
  for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++){
    const x=(i/steps-.5)*layout.width,z=(j/steps-.5)*layout.depth;
    points.push({x:layout.x+c*x+s*z,z:layout.z-s*x+c*z});
  }
  return points;
}
export function pitTreeExclusion(x:number,z:number,layout:PitComplexLayout){
  return layout.footprints.some(p=>{
    const dx=x-p.x,dz=z-p.z,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-p.width/2),Math.max(0,Math.abs(s*dx+c*dz)-p.depth/2))<7;
  });
}
const footprint=(id:string,kind:string,x:number,z:number,width:number,depth:number,height:number,minY=0,solid=true,yaw=0):PitFootprint=>({id,kind,x,z,width,depth,height,minY,solid,yaw});

/** Towers are separate trackside facilities, not two extra cylindrical ends
 * stuck onto the garages. The brochure places them at the two straight ends. */
export function createPitComplexLayout(track:PitTrack):PitComplexLayout {
  const boxes=footprint('palazzina-box','garages',-40,32,18,165,16.1);
  const towers:PitFootprint[]=[],stands=createStandLayouts(track),props=createCircuitPropLayouts(track);
  for(const [id,x0,z0]of [['tower-north',-120,-144],['tower-south',-123,206]] as const){
    let chosen:PitFootprint|undefined;
    for(const [dx,dz]of [[0,0],[-3,0],[0,-3],[0,3],[-6,0],[-3,-6],[-3,6],[-9,0]]){
      if(chosen)break;
      const x=x0+dx,z=z0+dz,n=track.nearest(x,z).point;
      const p=footprint(id,'tower',x,z,13.4,11.2,20.8,0,true,Math.atan2(x-n.x,z-n.z));
      if(pitFootprint(p,12).every(v=>{
        const s=track.nearest(v.x,v.z);
        return Math.hypot(v.x-s.point.x,v.z-s.point.z)>26&&!track.isPitLane(v.x,v.z)&&stands.every(a=>distanceToStand(v.x,v.z,a)>1.5)&&props.every(a=>Math.hypot(v.x-a.x,v.z-a.z)>Math.hypot(a.width,a.depth)/2+1);
      }))chosen=p;
    }
    if(!chosen)throw new Error(`No safe hospitality tower: ${id}`);
    towers.push(chosen);
  }
  const stairs:PitStairLayout[]=towers.map(t=>{
    const c=Math.cos(t.yaw),s=Math.sin(t.yaw),world=(x:number,y:number,z:number)=>({x:t.x+c*x+s*z,y,z:t.z-s*x+c*z});
    return{...footprint(`${t.id}-stairs`,'tower-stairs',world(-1.4,0,7.9).x,world(-1.4,0,7.9).z,6.4,8.1,6.48,0,true,t.yaw),towerId:t.id,deckHeight:5.38,bridgeHeadroom:2.41,entrance:world(-3.1,5.38,3.97),path:[world(-3.1,0,11.2),world(-3.1,.33625,10.75),world(-3.1,2.69,7.39),world(-1.4,2.69,6.7),world(.3,3.02625,7.1),world(.3,5.38,10.46),world(-3.1,5.38,11.05),world(-3.1,5.38,3.97)]};
  });
  // One complete room per roster team, opposite the matching garage bay.
  // Derive coverage from the roster instead of the old every-other-team sample.
  const strategyPods:StrategyPodLayout[]=teams.map((team,i)=>({...footprint(`pit-strategy-${team.id}`,'strategy-pod',-72.7,-43+i*13.2,3.6,9.4,4.65),teamId:team.id,teamName:team.name}));
  const clubs=[
    footprint('race-club','glazed-lounge',-40,22,20.6,151,16.1,7.5,false),
    footprint('fans-club','curved-pit-corner',-40,105,18.4,19,16.3,7.5,false),
    footprint('garden-lounge','covered-garden',-22,-86,22.4,22,9.8),
    footprint('monza-village','paddock-marquees',-15,111,24,22,7.6),
  ];
  const posts=[footprint('clock-pillar-left','clock-support',-74.5,124,.72,.9,8.6),footprint('clock-pillar-right','clock-support',-51.5,124,.72,.9,8.6)];
  const clockBeam={...footprint('riolex-clock-bridge','clock-bridge',-63,124,24,.85,10.3,6.8,false),brand:'RIOLEX' as const,clearHeight:6.8,posts};
  const equipment:PitFootprint[]=[];
  for(let i=0;i<12;i++){
    const z=-43+i*13.2;
    equipment.push(footprint(`garage-${i+1}-service-bay`,'pit-apron',-50.6,z,6.1,10.8,6.55,0,false));
  }
  // These objects are the architecture. People, pit equipment, consoles and
  // the ground-level pit wall retain their original physical proportions.
  for(const p of [boxes,...towers,...stairs,...clubs,...posts,clockBeam]){
    p.height*=ARCHITECTURE_HEIGHT_SCALE;p.minY*=ARCHITECTURE_HEIGHT_SCALE;
  }
  for(const route of stairs){
    route.deckHeight*=ARCHITECTURE_HEIGHT_SCALE;route.bridgeHeadroom*=ARCHITECTURE_HEIGHT_SCALE;
    route.entrance.y*=ARCHITECTURE_HEIGHT_SCALE;
    for(const p of route.path)p.y*=ARCHITECTURE_HEIGHT_SCALE;
  }
  clockBeam.clearHeight*=ARCHITECTURE_HEIGHT_SCALE;
  return{heightScale:ARCHITECTURE_HEIGHT_SCALE,reference:REFERENCE,artistic:'Brochure pp.5–9 and 14–16: long garage/hospitality block, separate straight-end towers, covered Garden Lounge and curved Fans Club corner. Dimensions, bay count and positions are compressed; building heights are artistically increased by 25% with unchanged horizontal footprints; the RIOLEX clock name and graphical decoration are fictional.',boxes,towers,clubs,clockBeam,props:equipment,stairs,strategyPods,screenData:'authored decorative telemetry',footprints:[boxes,...towers,...stairs,...clubs,...posts,...equipment,...strategyPods]};
}

export function pitSolidColliders(layout:PitComplexLayout):Bounds2[]{
  return [...layout.towers,...layout.stairs,...layout.strategyPods,...layout.clockBeam.posts,layout.clubs[2],layout.clubs[3]].map(p=>{
    const points=pitFootprint(p,1);return{minX:Math.min(...points.map(v=>v.x)),maxX:Math.max(...points.map(v=>v.x)),minZ:Math.min(...points.map(v=>v.z)),maxZ:Math.max(...points.map(v=>v.z))};
  });
}

/** A decorative local race clock. It starts at 10:10 and advances with the
 * supplied animation step, so pausing never consults an unrelated wall clock. */
export class PitClockController {
  private elapsed=0;
  constructor(private readonly hour:THREE.Group,private readonly minute:THREE.Group,private readonly second:THREE.Group){this.update(0);}
  update(dt:number){
    if(Number.isFinite(dt)&&dt>0)this.elapsed+=dt;
    const seconds=36_600+this.elapsed;
    for(const [pivot,angle]of [[this.hour,-(seconds%43_200)/43_200*Math.PI*2],[this.minute,-(seconds%3600)/3600*Math.PI*2],[this.second,-(seconds%60)/60*Math.PI*2]] as const){
      pivot.rotation.z=angle;
      // Scenery's final freeze deliberately excludes no whole building. Only
      // these six tiny moving nodes opt back into normal matrix updates.
      pivot.traverse(o=>{o.matrixAutoUpdate=true;o.matrixWorldAutoUpdate=true;});
      pivot.updateMatrix();pivot.updateWorldMatrix(false,true);
    }
  }
  get summary(){return{brand:'RIOLEX',elapsed:this.elapsed,timeOfDaySeconds:36_600+this.elapsed,hourAngle:this.hour.rotation.z,minuteAngle:this.minute.rotation.z,secondAngle:this.second.rotation.z};}
}

interface Label {text:string;position:THREE.Vector3;rotation:THREE.Euler;width:number;height:number;fg:string;bg:string}
/** Textured glass and atlas labels remain one draw each. All opaque structure,
 * machinery, people and seats enter the existing spatial scenery batches. */
export function addPitComplex(parent:THREE.Group,track:PitTrack){
  const root=scaleArchitectureHeight(new THREE.Group());root.name='monza-pit-complex-v11';parent.add(root);
  const layout=createPitComplexLayout(track),materials=new Map<number,THREE.MeshStandardMaterial>(),labels:Label[]=[];
  const mat=(color:number)=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.78}));return materials.get(color)!;};
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);m.receiveShadow=true;p.add(m);return m;};
  const cyl=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,n=12)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,n),mat(color));m.position.set(x,y,z);p.add(m);return m;};
  const rod=(p:THREE.Object3D,a:number[],b:number[],r=.04,color=0xaab5ad)=>structuralRod(p,new THREE.Vector3(...a),new THREE.Vector3(...b),r,mat(color));
  // Pit personnel deliberately use only a toy torso and a team-colour helmet.
  // No skin-colour face, hat, arms, legs or feet; desks/chairs keep their supports.
  const person=(parent:THREE.Object3D,id:string,role:'mechanic'|'engineer',teamId:TeamId|'circuit',color:number,x:number,z:number)=>{
    const avatar=new THREE.Group();avatar.name=`pit-person-${id}`;avatar.position.set(x,0,z);parent.add(avatar);
    avatar.userData={role,teamId,style:'torso-and-team-helmet',legs:false,teamColor:`#${new THREE.Color(color).getHexString()}`};
    const seated=role==='engineer',bodyY=seated?2.45:.76,bodyH=seated?.95:1.20,helmetY=seated?3.18:1.68;
    const body=box(avatar,0,bodyY,0,seated?.56:.62,bodyH,seated?.61:.46,color);body.name='pit-person-torso';
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.32,8,6),mat(color));helmet.name='pit-person-team-helmet';helmet.position.y=helmetY;avatar.add(helmet);
    const visor=new THREE.Mesh(new THREE.SphereGeometry(.327,8,2,-.88,1.76,.91,.80),mat(0x172b30));visor.name='pit-person-dark-visor';visor.position.y=helmetY;avatar.add(visor);
    if(seated){
      const band=new THREE.Mesh(new THREE.TorusGeometry(.345,.028,4,10,Math.PI).rotateY(Math.PI/2),mat(0x20362d));band.position.y=helmetY+.01;band.name='engineer-headset';avatar.add(band);
      for(const side of [-1,1]){const ear=cyl(avatar,0,helmetY,side*.32,.10,.10,0x20362d,6);ear.rotation.x=Math.PI/2;ear.name='engineer-earpiece';}
      const mic=rod(avatar,[0,helmetY-.07,.35],[-.34,helmetY-.15,.17],.023,0x243c30);mic.name='engineer-microphone';
    }
    return avatar;
  };
  const label=(p:THREE.Object3D,text:string,x:number,y:number,z:number,width:number,height:number,yaw=0,fg='#f4edcf',bg='#315b50')=>{
    root.updateWorldMatrix(true,false);p.updateWorldMatrix(true,false);
    const transform=root.matrixWorld.clone().invert().multiply(p.matrixWorld),q=new THREE.Quaternion(),scale=new THREE.Vector3();
    transform.decompose(new THREE.Vector3(),q,scale);q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw));
    labels.push({text,position:new THREE.Vector3(x,y,z).applyMatrix4(transform),rotation:new THREE.Euler().setFromQuaternion(q),width,height:height*scale.y,fg,bg});
  };
  const panels:THREE.BufferGeometry[]=[];
  const panel=(parent:THREE.Object3D,style:number,x:number,y:number,z:number,width:number,height:number,rotation:THREE.Euler)=>{
    root.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);
    const g=new THREE.PlaneGeometry(width,height),uv=g.attributes.uv,col=style%4,row=Math.floor(style/4);
    for(let i=0;i<uv.count;i++){uv.setX(i,(col+(uv.getX(i)*.96+.02))/4);uv.setY(i,1-(row+((1-uv.getY(i))*.94+.03))/2);}
    g.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation));g.translate(x,y,z);g.applyMatrix4(root.matrixWorld.clone().invert().multiply(parent.matrixWorld));panels.push(g);
  };
  const glazing=typeof document==='undefined'?new THREE.MeshStandardMaterial({name:'monza-pit-glazing',color:0x809da4,roughness:.23,metalness:.28,map:new THREE.Texture()}):pitGlazingMaterial();glazing.side=THREE.DoubleSide;
  const glassBox=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),glazing);m.position.set(x,y,z);p.add(m);return m;};
  const cream=0xe3e5dd,steel=0xaeb8b3,dark=0x405451,teamColors=teams.map(t=>new THREE.Color(t.color).getHex());

  box(root,-40,.22,32,18,.4,165,0xc4c9bf);box(root,-31.4,3.9,32,.8,7.8,165,0xafbab2);
  box(root,-40,7.45,32,18,.75,165,cream);box(root,-40,8.0,32,20.2,.4,167,0xc1cbc3);
  const apron=new THREE.Group();apron.name='pit-service-apron-equipment';apron.position.x=1.8;apron.scale.y=1/ARCHITECTURE_HEIGHT_SCALE;root.add(apron);
  // Twelve deep, genuinely open mouths: shutter guides, raised shutters,
  // workshop light bars, equipment and a coloured service apron per bay.
  for(let i=0;i<12;i++){
    const z=-43+i*13.2,color=teamColors[i]??0x526c60;
    for(const dz of [-5.75,5.75]){box(root,-40,3.6,z+dz,18,7.2,.45,0x77847a);box(root,-49.45,3.6,z+dz,.62,7.2,.7,cream);}
    box(root,-34.3,3.0,z,.28,5.7,11.3,0x3c4e4a);box(root,-42,.45,z,14,.1,11.0,0x697870);
    box(root,-49.5,6.2,z,.36,.6,11.45,steel);
    for(let slat=0;slat<5;slat++)box(root,-49.72,5.6+slat*.12,z,.12,.06,10.4,0x85978e);
    for(const dz of [-5.45,5.45]){box(root,-49.84,3.15,z+dz,.15,5.9,.15,steel);box(root,-49.93,3.0,z+dz,.025,5.1,.035,0x435951);}
    for(const x of [-47.7,-43.4,-38.8])box(root,x,6.3,z,.18,.1,9.8,0xf3f1d9);
    box(root,-35.15,1.7,z+3.55,.9,2.3,2.8,0x65786b);box(root,-35.65,2.9,z+3.55,.95,.14,3,color);
    for(let shelf=0;shelf<3;shelf++)box(root,-35.7,.85+shelf*.67,z+3.55,1,.07,2.6,dark);
    for(const dz of [-3.8,-2.7])for(let tyre=0;tyre<3;tyre++)cyl(root,-44.4,.66+tyre*.36,z+dz,.46,.35,0x27302d);
    // A wheeled tool trolley, folded front jack and cable reel inside the bay.
    box(root,-46.4,1.0,z+3.7,1.15,1.15,2.0,color);
    for(let drawer=0;drawer<4;drawer++)box(root,-47.0,.63+drawer*.23,z+3.7,.035,.035,1.76,0xc6d1c6);
    for(const dz of [-.75,.75])for(const dx of [-.45,.45])cyl(root,-46.4+dx,.35,z+3.7+dz,.15,.16,0x22372e,8).rotation.z=Math.PI/2;
    box(root,-47.2,.58,z-3.9,1.8,.13,.4,0xc9d2c2);rod(root,[-47.9,.6,z-3.9],[-46.4,1.8,z-3.9],.055,steel);
    const extinguisher=cyl(root,-48.1,.95,z+4.75,.17,.9,0xb84333,10);box(root,extinguisher.position.x,1.48,z+4.75,.1,.16,.18,0x263a31);
    // Shared yellow service limit / parking rectangle stays outside fast lane.
    box(apron,-53,.1,z,5.2,.13,10.7,0x77887b);
    for(const dz of [-5.2,5.2])box(apron,-53,.18,z+dz,5.5,.025,.11,0xe4cf81);
    box(apron,-55.75,.185,z,.11,.025,10.55,0xe4cf81);box(apron,-52.6,.19,z,2.9,.026,.15,color);
    // The horizontal boom and hanging cable are above the service bay, not the
    // pit fast lane; alternate bays leave the building silhouette legible.
    if(i%2===0){
      box(apron,-49.85,5.1,z-4.25,.22,2.65,.22,0x71877a);
      rod(apron,[-49.85,6.4,z-4.25],[-55.0,6.4,z-4.25],.065,0xb9c7b9);
      rod(apron,[-49.85,5.4,z-4.25],[-54.1,6.4,z-4.25],.045,0x879a8c);
      rod(apron,[-54.8,6.35,z-4.25],[-54.8,2.2,z-4.25],.025,0x253c30);
      box(apron,-54.8,1.95,z-4.25,.20,.5,.22,0x3d5646);
    }
    // Two mechanics and a monitor desk: all shoulders and tools remain within
    // the fixed service bay, clear even where the pit spline bulges eastward.
    for(const [j,dz] of [-2.8,2.9].entries())person(apron,`mechanic-${i+1}-${j+1}`,'mechanic',teams[i]?.id??'circuit',color,-52.5,z+dz);
    box(apron,-50.6,1.24,z+3.9,1.35,.15,2.4,0x697f72);
    for(const dz of [3.25,4.55]){
      box(apron,-50.1,2.0,z+dz,.13,.98,1.18,0x20352e);box(apron,-50.05,1.57,z+dz,.23,.5,.16,0x6d8375);
      panel(apron,i%3,-50.18,2.02,z+dz,1.03,.80,new THREE.Euler(0,-Math.PI/2,0));
    }
    box(apron,-50.7,1.36,z+3.9,.46,.07,1.35,0x263a30);panel(apron,7,-50.7,1.402,z+3.9,1.18,.37,new THREE.Euler(-Math.PI/2,0,Math.PI/2));
    box(root,-34.48,4.4,z-1.0,.14,1.45,3.1,0x233c31);panel(root,3,-34.56,4.4,z-1.0,2.86,1.23,new THREE.Euler(0,-Math.PI/2,0));
    for(const dz of [-4.85,4.85])box(root,-48.4,5.7,z+dz,1.6,.09,.10,0xe9eacb);
    // Coiled air hose, pressure bottle and a short overhead cable tray.
    const hose=new THREE.Mesh(new THREE.TorusGeometry(.31,.045,5,16),mat(0x293e32));hose.rotation.y=-Math.PI/2;hose.position.set(-48.8,2.1,z-4.7);root.add(hose);
    cyl(root,-47.9,1.0,z-4.75,.20,1.4,0x6b8582);box(root,-47.9,1.78,z-4.75,.13,.13,.20,0xaabbaa);
    box(root,-48.5,6.65,z,1.0,.12,10.2,0x71897c);

    for(const x of [-55.25,-54.65]){cyl(apron,x,.5,z+3.85,.43,.7,0x26342b);box(apron,x,.15,z+3.85,.7,.1,1.0,0x6c8170);}
  }
  if(typeof document!=='undefined')addGarageHeaders(root);

  // The continuous Race Club rooms occupy the first/second hospitality levels.
  box(root,-40,9.0,22,18,1.1,143,cream);box(root,-40,12.8,22,18,.7,143,cream);
  glassBox(root,-49.12,10.8,22,.12,2.72,141);glassBox(root,-30.88,10.8,22,.12,2.72,141);
  for(let z=-47;z<93;z+=4.7)for(const x of [-49.28,-30.72])box(root,x,10.8,z,.17,3.0,.15,0xe6eae1);
  box(root,-40,13.38,22,20.3,.38,146,0xc4cdc4);
  for(let z=-48;z<96;z+=9.2){box(root,-40,13.6,z,19.9,.035,.12,0x9eaea2);for(const x of [-49.55,-30.45])box(root,x,13.95,z,.07,.9,.07,0x869d8e);}
  for(const x of [-49.55,-30.45])for(const y of [13.75,14.3])box(root,x,y,22,.07,.07,145,0x869d8e);
  // Eight shallow roof bays give the outlined diagram its long segmented roof.
  for(let z=-44;z<92;z+=17.8){
    for(const sign of [-1,1]){const roof=box(root,-40+sign*5.1,14.1,z,10.4,.20,17.4,0xe6e9df);roof.rotation.z=-sign*.055;}
    rod(root,[-50.1,13.95,z-8.5],[-40,15.5,z-8.5],.06,0xe8ece1);rod(root,[-40,15.5,z-8.5],[-29.9,13.95,z-8.5],.06,0xe8ece1);
  }
  label(root,'RACE CLUB',-49.32,12.85,8,23,.9,-Math.PI/2);
  label(root,'AUTODROMO NAZIONALE MONZA',-49.57,8.48,27,89,1.0,-Math.PI/2,'#2d4c3b','#e7eadf');

  const curvedPoints=(rx:number,rz:number)=>Array.from({length:25},(_,i)=>{const a=i/24*Math.PI;return new THREE.Vector2(Math.cos(a)*rx,-Math.sin(a)*rz);});
  const dShape=(rx:number,rz:number,back:number)=>new THREE.Shape([...curvedPoints(rx,rz).map(p=>new THREE.Vector2(p.x,-p.y)),new THREE.Vector2(-rx,-back),new THREE.Vector2(rx,-back)]);
  const slab=(p:THREE.Group,y:number,rx:number,rz:number,back:number,color:number,thickness=.24)=>{
    const shape=dShape(rx,rz,back),g=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:12}).rotateX(-Math.PI/2);
    const m=new THREE.Mesh(g,mat(color));m.position.y=y;p.add(m);return m;
  };
  const curvedWall=(p:THREE.Group,bottom:number,top:number,rx:number,rz:number)=>{
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[],points=curvedPoints(rx,rz);
    for(let i=0;i<points.length;i++){const v=points[i];vertices.push(v.x,bottom,v.y,v.x,top,v.y);uv.push(i/24,0,i/24,1);if(i<24){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();p.add(new THREE.Mesh(g,glazing));
  };
  // Fans Club is the broad rounded corner of the P building in the supplied
  // photograph, distinct from the two slender, freestanding Tower facilities.
  const fans=new THREE.Group();fans.name='monza-fans-club-curved-corner';fans.position.set(-40,0,105);fans.rotation.y=Math.PI/2;root.add(fans);
  for(const y of [7.8,11.5,15.2])slab(fans,y,8.8,8.8,8.4,0xd4ded1,.32);
  for(const [lo,hi]of [[8.15,11.4],[11.85,15.1]])curvedWall(fans,lo,hi,8.45,8.45);
  for(let i=0;i<=24;i++){const a=i/24*Math.PI;box(fans,Math.cos(a)*8.47,11.6,-Math.sin(a)*8.47,.13,7.1,.13,0xe0e7dc);}
  for(const y of [8.3,11.95])for(let i=0;i<24;i++){const a=i/24*Math.PI,b=(i+1)/24*Math.PI;rod(fans,[Math.cos(a)*8.86,y,-Math.sin(a)*8.86],[Math.cos(b)*8.86,y,-Math.sin(b)*8.86],.04,0xaebcaf);}
  label(root,'FANS CLUB',-49.22,14.5,105,12,1.0,-Math.PI/2);
  // Control room, compact podium and flagpoles remain over the garage apron.
  box(root,-50.8,7.0,84,5.6,.4,11.8,0xbfcbbd);glassBox(root,-53.15,8.2,84,.12,1.9,10.8);box(root,-50.8,9.45,84,5.9,.3,12.4,0xcbd7c6);
  label(root,'RACE CONTROL',-53.35,7.35,84,9.3,.65,-Math.PI/2);
  box(root,-53.0,4.05,60,6,.45,15.3,0xbdcabc);box(root,-50,5.6,60,.35,3.8,15.3,0x31583d);
  for(let j=0;j<3;j++)box(root,-53.1,4.52+(j===1?.2:0),56+j*4,2.1,.5+(j===1?.4:0),3.0,cream);
  for(let z=52.7;z<67.6;z+=2.4)box(root,-56.1,4.8,z,.07,1.25,.07,0x879e8a);box(root,-56.1,5.43,60,.07,.07,15.3,0x879e8a);
  label(root,'MONZA',-50.23,6.1,60,11.5,1.0,-Math.PI/2);
  for(const z of [55,60,65]){box(root,-50.2,8.4,z,.06,3.8,.06,0xb4c4b3);for(let i=0;i<3;i++)box(root,-50.2,9.5,z+.3+i*.42,.025,1.0,.42,[0x278c55,0xf1f0e8,0xc44d3a][i]);}

  // Tall, narrow standalone towers stand on pilotis, with glazed viewing floors
  // and an external access stair, as in brochure p.14 rather than a castle.
  for(const spec of layout.towers){
    const g=new THREE.Group();g.name=spec.id;g.position.set(spec.x,0,spec.z);g.rotation.y=spec.yaw;root.add(g);
    for(const x of [-3.8,3.8])for(const z of [-1.7,3.1])box(g,x,2.6,z,.33,5.2,.33,0x97aaa3);
    box(g,3.9,7.4,3.1,2,14.8,2.5,0xb2c0b7);
    for(const y of [5.1,8.75,12.4,16.05,19.7])slab(g,y,4.95,4.55,4.1,0xc6d2ca,.28);
    for(let floor=0;floor<4;floor++){
      const lo=5.4+floor*3.65,hi=8.65+floor*3.65;curvedWall(g,lo,hi,4.7,4.3);
      if(floor===0){
        glassBox(g,-4.025,(lo+hi)/2,3.97,.45,hi-lo,.13);glassBox(g,.925,(lo+hi)/2,3.97,6.65,hi-lo,.13);
        glassBox(g,-3.1,8.225,3.97,1.4,.85,.13);
        for(const x of [-3.83,-2.37])box(g,x,6.59,4.00,.13,2.42,.16,0xdce4d8);box(g,-3.1,7.80,4.00,1.6,.13,.16,0xdce4d8);
      }else glassBox(g,0,(lo+hi)/2,3.97,8.5,hi-lo,.13);
      for(let i=0;i<=12;i++){const a=i/12*Math.PI;box(g,Math.cos(a)*4.72,(lo+hi)/2,-Math.sin(a)*4.32,.12,hi-lo,.12,0xe4e9e1);}
    }
    slab(g,20.12,5.1,4.7,4.25,0x526d61,.18);
    // A back-of-house switchback has a real landing/door, with the upper
    // return bridge above the lower flight rather than through the glazed drum.
    const stairs=new THREE.Group();stairs.name=`${spec.id}-access-stair`;g.add(stairs);
    const deck=5.38,rise=deck/16;
    for(let step=0;step<8;step++){
      const y=(step+1)*rise,z=10.75-step*.48;box(stairs,-3.1,y-.09,z,1.45,.18,.56,0xb6c8ba);
      const y2=(step+9)*rise,z2=7.10+step*.48;box(stairs,.3,y2-.09,z2,1.45,.18,.56,0xb6c8ba);
      if([0,2,4,7].includes(step))for(const x of [-3.825,-2.375])box(stairs,x,y+.48,z,.055,.96,.055,0x748e7e);
      if([0,2,4,7].includes(step))for(const x of [-.425,1.025])box(stairs,x,y2+.48,z2,.055,.96,.055,0x748e7e);
    }
    box(stairs,-1.4,2.60,6.70,4.85,.18,1.50,0xc3d0c1);box(stairs,-1.4,deck-.14,11.05,4.85,.28,1.20,0xc3d0c1);
    box(stairs,-3.1,deck-.14,7.55,1.45,.28,6.95,0xc3d0c1);box(stairs,-3.1,deck-.14,4.05,1.45,.28,.40,0xc3d0c1);
    for(const x of [-3.825,-2.375]){rod(stairs,[x,1.34,11.03],[x,3.69,7.11],.045);rod(stairs,[x,.17,11.03],[x,2.51,7.11],.065);}
    for(const x of [-.425,1.025]){rod(stairs,[x,4.02,6.82],[x,6.38,10.74],.045);rod(stairs,[x,2.85,6.82],[x,5.20,10.74],.065);}
    for(const x of [-4.06,1.2])for(const z of [6.5,11.4])box(stairs,x,(z<8?2.51:5.10)/2,z,.15,z<8?2.51:5.10,.15,0x819b8c);
    for(const z of [4.8,8.8])box(stairs,-4.06,2.55,z,.15,5.10,.15,0x819b8c);
    for(const x of [-3.825,-2.375]){
      const end=x< -3?11.65:10.45;rod(stairs,[x,6.38,4.08],[x,6.38,end],.045);
      for(let z=4.6;z<end;z+=1.4)box(stairs,x,5.85,z,.055,1.05,.055,0x748e7e);
    }
    rod(stairs,[-3.825,6.38,11.65],[1.025,6.38,11.65],.045);rod(stairs,[1.025,6.38,10.45],[1.025,6.38,11.65],.045);
    rod(stairs,[-3.825,3.69,5.95],[1.025,3.69,5.95],.045);

    label(g,'TOWER',0,19.2,-4.75,5.6,.65);
  }
  // Garden Lounge: a separate low frontage with a row of tensile peaks and
  // stepped cream seats, taken from the provided official photograph.
  const garden=new THREE.Group();garden.position.set(-22,0,-86);garden.rotation.y=-Math.PI/2;garden.name='garden-lounge';root.add(garden);
  box(garden,0,.22,0,20,.42,22,0xc6d1c0);box(garden,0,2.15,3.7,19,4.3,10.3,0xa6b6a3);
  glassBox(garden,0,2.4,-1.5,18,2.7,.12);
  for(let row=0;row<4;row++){
    box(garden,0,4.4+row*.5,2.8+row*1.5,19.1,.4,1.5,0xc6d0bd);
    for(let col=0;col<15;col++){box(garden,-8.8+col*1.25,4.75+row*.5,2.8+row*1.5,.64,.16,.6,0xe4e8da);box(garden,-8.8+col*1.25,5.0+row*.5,3.13+row*1.5,.65,.5,.1,0xe4e8da);}
  }
  for(const x of [-7,0,7]){
    const canopy=new THREE.Mesh(new THREE.ConeGeometry(5.1,2.2,4).rotateY(Math.PI/4),mat(0xf0f1e5));canopy.scale.z=1.6;canopy.position.set(x,8.55,1.8);garden.add(canopy);
    for(const dx of [-3.5,3.5])for(const z of [-3.8,7.4])box(garden,x+dx,5.1,z,.10,5.3,.10,0x9fb1a0);
    rod(garden,[x-3.5,7.6,-3.8],[x,9.5,1.8],.04,0xd1dbca);rod(garden,[x+3.5,7.6,7.4],[x,9.5,1.8],.04,0xd1dbca);
  }
  label(garden,'GARDEN LOUNGE',0,4.4,-1.66,16,.85);
  // Village is behind the pit block and clear of Monza House / transporters.
  const village=new THREE.Group();village.name='monza-village-marquees';village.position.set(-15,0,111);root.add(village);
  for(const x of [-6,6])for(const z of [-5,5]){
    box(village,x,2.0,z,9.8,4.0,8.8,0xe5e9db);glassBox(village,x,2.0,z+4.45,8.4,2.7,.12);
    const roof=new THREE.Mesh(new THREE.ConeGeometry(7.3,3.0,4).rotateY(Math.PI/4),mat(0xf0f1e5));roof.scale.z=.90;roof.position.set(x,5.5,z);village.add(roof);
  }
  label(village,'MONZA VILLAGE',0,4.6,10.5,17,1.0);

  // Rear stairs, louvres and service doors are useful visual detail from both
  // the grid and paddock cameras, without external model downloads.
  box(root,-22.8,.06,31,8,.12,166,0x9ba997);
  for(const z of [-18,41,87]){
    for(let step=0;step<15;step++)box(root,-27,step*.47+.25,z-5.5+step*.72,4.9,.18,1.05,0xa5b5a5);
    for(const x of [-29.3,-24.7])rod(root,[x,1.3,z-5.5],[x,8.1,z+4.8],.06,0x78937f);
    box(root,-27,7.3,z+5.15,5.5,.18,2,0xa1b29e);
  }
  for(let z=-42;z<101;z+=13.2){box(root,-30.97,2.4,z,.10,4.6,3.0,0x667e6d);for(let i=0;i<5;i++)box(root,-30.83,6.25+i*.12,z,.04,.05,4.6,0x809a85);}
  for(const z of [-25,23,67]){box(root,-35,14.8,z,4.4,.8,5.7,0x8fa28e);for(let i=0;i<7;i++)box(root,-37.25,14.8,z-2.3+i*.7,.05,.6,.07,0x546f5c);}
  // Leave a service corridor between the building and pit wall.
  const pitWall=new THREE.Group();pitWall.name='pit-wall-original-height';pitWall.scale.y=1/ARCHITECTURE_HEIGHT_SCALE;root.add(pitWall);
  box(pitWall,-73.8,.72,34,.7,1.45,218,0xc8d0c2);box(pitWall,-73.8,1.52,34,.9,.16,218,0x6d8373);
  for(let pod=0;pod<layout.strategyPods.length;pod++){
    const spec=layout.strategyPods[pod],team=teams.find(t=>t.id===spec.teamId)!,z=spec.z,color=new THREE.Color(team.color).getHex();
    const station=new THREE.Group();station.name=spec.id;station.scale.y=1/ARCHITECTURE_HEIGHT_SCALE;station.userData={teamId:team.id,teamName:team.name,engineers:4,monitors:8,completeRoom:true};root.add(station);
    const floor=box(station,-72.7,.14,z,3.6,.28,9.4,0xa8b9a8);floor.name='strategy-room-floor';const roof=box(station,-72.7,4.52,z,3.6,.22,9.4,0xe1e8dc);roof.name='strategy-room-roof';
    for(const dz of [-4.55,4.55]){box(station,-74.15,2.35,z+dz,.12,4.1,.12,0x607f6c);const side=box(station,-72.7,2.35,z+dz,2.9,4.1,.10,0x355546);side.name='strategy-room-side-wall';box(station,-72.7,.65,z+dz,2.9,.26,.12,color);}
    box(station,-72.6,2.32,z,1.65,.16,8.75,0x607d69);const rear=box(station,-74.12,2.35,z,.16,4.1,9.1,color);rear.name='strategy-room-rear-wall';
    box(station,-73.0,.74,z-3.7,1.0,1.1,1.05,0x263d31);for(let j=0;j<5;j++)box(station,-72.48,.46+j*.15,z-3.7,.025,.04,.78,0x769684);
    const fascia=box(station,-71.02,4.22,z,.14,.74,9.1,color);fascia.name='strategy-room-team-fascia';
    label(station,`${team.name.toUpperCase()} • PIT WALL`,-70.94,4.22,z,8.2,.48,Math.PI/2,'#f5f1df',team.color);
    label(station,team.name.toUpperCase(),-74.21,4.05,z,8.2,.43,-Math.PI/2,'#f5f1df',team.color);
    for(let seat=0;seat<4;seat++){
      const dz=-3.0+seat*2.0,cz=z+dz;
      for(let tier=0;tier<2;tier++){
        const monitor=box(station,-73.1,2.88+tier*.94,cz,.14,.83,1.72,0x1a3029);monitor.name='pit-wall-monitor';
        panel(station,(seat+tier+pod)%7,-73.015,2.88+tier*.94,cz,1.58,.70,new THREE.Euler(0,Math.PI/2,0));
      }
      const keyboard=box(station,-72.38,2.445,cz,.46,.07,1.22,0x283d32);keyboard.name='strategy-room-keyboard';panel(station,7,-72.38,2.488,cz,1.12,.38,new THREE.Euler(-Math.PI/2,0,Math.PI/2));
      box(station,-71.83,1.87,cz,.77,.16,.83,0x243b31);box(station,-71.39,2.25,cz,.13,.78,.83,0x2d4c3b);
      for(const dx of [-.27,.27])for(const zz of [-.29,.29])box(station,-71.83+dx,.91,cz+zz,.07,1.7,.07,0x718a79);
      rod(station,[-72.16,1.02,cz-.29],[-72.16,1.02,cz+.29],.035,0xa4b7a3);
      person(station,`${team.id}-${seat+1}`,'engineer',team.id,color,-71.97,cz);
    }
    const tray=box(station,-73.50,.37,z,.20,.18,8.2,0x253e31);tray.name='pit-wall-cable-tray';
  }


  // The brand lettering is deliberately fictional. The beam spans the pit
  // lane above 6.8 units; its only ground-level solids are the two side posts.
  const beam=layout.clockBeam;
  for(const p of beam.posts)box(root,p.x,4.25,p.z,p.width,8.5,p.depth,0x15533c);
  box(root,beam.x,8.55,beam.z,24,3.5,.8,0x125b3f);box(root,beam.x,6.96,beam.z+.43,22,.25,.08,0x122e21);
  label(root,'RIOLEX',-70,8.55,124.44,6.6,1.35,0,'#d8c371','#15583d');label(root,'RIOLEX',-56,8.55,124.44,6.6,1.35,0,'#d8c371','#15583d');
  label(root,'MONZA  •  POCKET PADDOCK',-63,7.10,124.48,19,.42,0,'#c5bd80','#173d2b');
  const clock=new THREE.Group();clock.name='riolex-pit-entry-clock';clock.position.set(-63,8.6,124.50);root.add(clock);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(1.32,.10,6,48),mat(0xbda655));clock.add(rim);
  let faceTexture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d')!;ctx.fillStyle='#eeeee0';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#344c3b';
    for(let i=0;i<60;i++){const a=i/60*Math.PI*2,r=i%5===0?192:207;ctx.lineWidth=i%5===0?7:2;ctx.beginPath();ctx.moveTo(256+Math.sin(a)*r,256-Math.cos(a)*r);ctx.lineTo(256+Math.sin(a)*223,256-Math.cos(a)*223);ctx.stroke();}
    ctx.fillStyle='#315b42';ctx.textAlign='center';ctx.font='bold 30px Georgia';ctx.fillText('RIOLEX',256,167);ctx.font='15px Arial';ctx.fillText('MONZA',256,337);faceTexture=new THREE.CanvasTexture(c);faceTexture.colorSpace=THREE.SRGBColorSpace;
  }
  const face=new THREE.Mesh(new THREE.CircleGeometry(1.25,48),new THREE.MeshBasicMaterial({map:faceTexture??null,color:faceTexture?0xffffff:0xeeeee0}));face.position.z=.025;clock.add(face);
  const hands:THREE.Group[]=[];
  for(const [name,length,width,color,z]of [['hour',.69,.10,0x284e38,.055],['minute',.97,.065,0x284e38,.075],['second',1.06,.025,0xb4863d,.095]] as const){
    const pivot=new THREE.Group();pivot.name=`pit-clock-hand-${name}`;clock.add(pivot);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(width,length,.025),new THREE.MeshBasicMaterial({color}));hand.position.set(0,length*.43,z);pivot.add(hand);hands.push(pivot);
  }
  const hub=new THREE.Mesh(new THREE.CircleGeometry(.10,16),new THREE.MeshBasicMaterial({color:0x9a8441}));hub.position.z=.12;clock.add(hub);
  const clockController=new PitClockController(hands[0],hands[1],hands[2]);
  // Authored telemetry patterns are generated locally. Photographs are used
  // only as modelling references and are never shipped as game textures.
  let screenTexture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d')!;
    for(let tile=0;tile<8;tile++){
      const x=(tile%4)*256,y=Math.floor(tile/4)*256;ctx.fillStyle='#102822';ctx.fillRect(x,y,256,256);ctx.fillStyle='#8da89c';ctx.fillRect(x+8,y+8,240,19);ctx.font='bold 13px Arial';ctx.fillStyle='#dcebdd';ctx.fillText(['LIVE TIMING','TYRE / TEMP','TELEMETRY','CAR STATUS','WEATHER','RACE PLAN','TRACK MAP','KEYBOARD'][tile],x+15,y+22);
      if(tile===7){for(let row=0;row<6;row++)for(let col=0;col<13;col++){ctx.fillStyle=(row+col)%9===0?'#4a8c74':'#668378';ctx.fillRect(x+10+col*18,y+52+row*25,15,17);}continue;}
      if(tile===0||tile===5){ctx.font='12px Consolas';for(let row=0;row<10;row++){ctx.fillStyle=row===2?'#c1b1dd':row%2?'#9fc9ba':'#e1e6d0';ctx.fillText(`${String(row+1).padStart(2,'0')}  ${[4,16,63,1,81][row%5]}  1:${22+row}.${String(385+row*37).padStart(3,'0')}`,x+13,y+51+row*18);}}
      else if(tile===6){const pts=track.samples.filter((_,i)=>i%20===0);ctx.beginPath();pts.forEach((p,i)=>{const px=x+35+(p.point.x+90)*.46,py=y+40+(p.point.z+350)*.31;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});ctx.closePath();ctx.strokeStyle='#6fceaf';ctx.lineWidth=4;ctx.stroke();}
      else{for(let line=0;line<4;line++){ctx.beginPath();for(let i=0;i<52;i++){const px=x+12+i*4.4,py=y+65+line*42+Math.sin(i*.35+line*2)*9+Math.sin(i*.71)*4;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}ctx.strokeStyle=['#9fd8bf','#dbc681','#8ca9d0','#b99dd5'][line];ctx.lineWidth=2;ctx.stroke();}ctx.fillStyle='#c1d9ce';ctx.font='12px Consolas';ctx.fillText(tile===1?'FL 92  FR 94   RL 88  RR 91':'LINK OK   MODE RACE',x+15,y+241);}
    }
    screenTexture=new THREE.CanvasTexture(c);screenTexture.colorSpace=THREE.SRGBColorSpace;screenTexture.anisotropy=4;
  }
  const screenMesh=new THREE.Mesh(mergeGeometries(panels,false)!,new THREE.MeshBasicMaterial({map:screenTexture??null,color:screenTexture?0xffffff:0x7ea899}));screenMesh.name='pit-telemetry-screen-atlas';root.add(screenMesh);panels.forEach(p=>p.dispose());
  root.userData.strategyDetails={teams:layout.strategyPods.map(p=>p.teamId),peopleStyle:'torso-and-team-helmet',mechanics:24,pods:layout.strategyPods.length,engineers:layout.strategyPods.length*4,monitors:layout.strategyPods.length*8,garageMonitors:36,keyboardPanels:layout.strategyPods.length*4+12,screenData:layout.screenData,references:['https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/','https://www.formula1.com/en/latest/article/the-insiders-guide-to-the-pit-wall.CFwHwjTcLNO5Gf4B3Dy4o']};
  // Atlas all small hospitality/clock signs into a single draw.
  let atlas:THREE.CanvasTexture|undefined;const atlasHeight=THREE.MathUtils.ceilPowerOfTwo(Math.max(1024,labels.length*64));
  if(typeof document!=='undefined'){
    const c=document.createElement('canvas');c.width=1024;c.height=atlasHeight;const ctx=c.getContext('2d')!;
    labels.forEach((l,i)=>{
      const y=i*64;ctx.fillStyle=l.bg;ctx.fillRect(0,y,1024,62);ctx.fillStyle=l.fg;ctx.font=`bold ${l.text.length>25?32:42}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';
      // Atlas rows have a different aspect from each physical sign. Cancel
      // that mapping here so RIOLEX has normal letter proportions in world
      // space instead of six impossibly thin letters on a wide green beam.
      const horizontalScale=l.height*1024/(l.width*62);ctx.save();ctx.translate(512,y+32);ctx.scale(horizontalScale,1);ctx.fillText(l.text,0,0,975/horizontalScale);ctx.restore();
    });atlas=new THREE.CanvasTexture(c);atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;
  }
  const parts=labels.map((l,i)=>{const g=new THREE.PlaneGeometry(l.width,l.height),uv=g.attributes.uv;for(let v=0;v<uv.count;v++)uv.setY(v,1-(i*64+(1-uv.getY(v))*62)/atlasHeight);g.applyQuaternion(new THREE.Quaternion().setFromEuler(l.rotation));g.translate(l.position.x,l.position.y,l.position.z);return g;});
  const labelMesh=new THREE.Mesh(mergeGeometries(parts,false)!,new THREE.MeshBasicMaterial({map:atlas??null,side:THREE.DoubleSide}));labelMesh.name='pit-complex-sign-atlas';root.add(labelMesh);parts.forEach(g=>g.dispose());
  // One textured-glass batch across all rooms and both towers.
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),glassParts:THREE.BufferGeometry[]=[],glassMeshes:THREE.Mesh[]=[];
  root.traverse(o=>{if(o instanceof THREE.Mesh&&o.material===glazing){glassParts.push(o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)));glassMeshes.push(o);}});
  const glass=new THREE.Mesh(mergeGeometries(glassParts,false)!,glazing);glass.name='pit-complex-glazing-batch';root.add(glass);glassParts.forEach(g=>g.dispose());glassMeshes.forEach(m=>{m.removeFromParent();m.geometry.dispose();});
  root.userData.labelTexts=labels.map(l=>l.text);root.userData.layout=layout;
  return{group:root,layout,clockController,colliders:pitSolidColliders(layout)};
}
