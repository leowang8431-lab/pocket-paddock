import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

interface GarageAnchor {id:number;center:THREE.Vector3;front:THREE.Vector3;depth:number;apronWidth:number;}
interface PitwallHost {pitBoxes:readonly GarageAnchor[];pitProfile:{fastWidth:number;};}
export interface MonacoPitwallPod {
 id:string;teamName:string;teamColor:number;center:THREE.Vector3;front:THREE.Vector3;
 width:number;depth:number;group:THREE.Group;
}

/** Compact pit-wall cabins occupy the island between the fast lane and the
 * racing-straight barrier, opposite the garages. The rear-only canopy leaves
 * the actual monitors and operators exposed to the normal oblique map view.
 * Every rendered part remains inside the audited 3.3 x 1.7 footprint. */
export function createMonacoPitwall(layout:PitwallHost,teams:readonly (readonly [string,number])[]){
 const group=new THREE.Group();group.name='monaco-pitwall-strategy-rooms';
 const pods:MonacoPitwallPod[]=[],materials=new Map<number,THREE.MeshStandardMaterial>();
 const material=(color:number)=>{let m=materials.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.76});materials.set(color,m);}return m;};
 const box=(p:THREE.Object3D,name:string,x:number,y:number,z:number,w:number,h:number,d:number,color:number,round=0)=>{
  const geometry=round?new RoundedBoxGeometry(w,h,d,1,Math.min(round,w/3,h/3,d/3)):new THREE.BoxGeometry(w,h,d),mesh=new THREE.Mesh(geometry,material(color));
  mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;p.add(mesh);return mesh;
 };
 const ellipse=(p:THREE.Object3D,name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number)=>{
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,9),material(color));mesh.name=name;mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;p.add(mesh);return mesh;
 };
 const label=(p:THREE.Group,teamName:string,color:number)=>{
  let texture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');
   if(ctx){ctx.fillStyle='#183c3c';ctx.fillRect(0,0,1024,128);ctx.fillStyle=`#${color.toString(16).padStart(6,'0')}`;ctx.fillRect(0,0,30,128);ctx.fillStyle='#f5f1dc';ctx.font='700 70px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(teamName,520,69,930);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;}
  }
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2.97,.235),new THREE.MeshBasicMaterial({map:texture??null,color:texture?0xffffff:color,side:THREE.FrontSide}));
  mesh.name='monaco-pitwall-team-name';mesh.position.set(0,1.995,-.204);p.add(mesh);
 };
 for(const [index,garage]of layout.pitBoxes.entries()){
  const [teamName,teamColor]=teams[index%teams.length],front=garage.front.clone().negate().setY(0).normalize();
  const pitCenter=garage.center.clone().addScaledVector(garage.front,garage.depth/2+garage.apronWidth+layout.pitProfile.fastWidth/2);
  const center=pitCenter.addScaledVector(garage.front,4.2),pod=new THREE.Group();pod.name=`monaco-pitwall-pod-${index+1}`;pod.position.copy(center);pod.rotation.y=Math.atan2(front.x,front.z);group.add(pod);
  // The shore is at .65; the platform is physically supported up to the pit
  // surface instead of hanging half a unit above the white pedestrian island.
  const rise=Math.max(.04,center.y-.65);
  box(pod,'monaco-pitwall-supported-base',0,-rise/2,0,3.22,rise,1.58,0xc6cbbd);
  box(pod,'monaco-pitwall-floor',0,.025,0,3.24,.05,1.6,0xe3e3d1);
  box(pod,'monaco-pitwall-front-step',0,.055,.775,2.94,.06,.13,0xb7c5b9);
  box(pod,'monaco-pitwall-back-wall',0,.83,-.78,3.24,1.6,.08,0x315958);
  box(pod,'monaco-pitwall-team-rear-band',0,1.45,-.731,3.12,.20,.018,teamColor);
  for(const side of [-1,1]){
   box(pod,'monaco-pitwall-side-panel',side*1.585,.46,-.04,.075,.85,1.45,0xd2d9ca);
   box(pod,'monaco-pitwall-rear-canopy-post',side*1.54,1.05,-.72,.065,2.1,.065,0x56786f);
  }
  // Only the rear .6u is roofed: screens, keyboards and people are not hidden
  // below an opaque lid when the user looks down from the pit-lane camera.
  box(pod,'monaco-pitwall-rear-half-canopy',0,2.13,-.52,3.3,.10,.6,0xede9d7);
  box(pod,'monaco-pitwall-team-fascia',0,1.995,-.23,3.13,.27,.045,0x183c3c);
  box(pod,'monaco-pitwall-canopy-team-stripe',0,2.18,-.52,3.3,.025,.60,teamColor);
  label(pod,teamName,teamColor);
  box(pod,'monaco-pitwall-console-top',0,.88,-.06,2.95,.095,.43,0xcdd6c4,.035);
  for(const x of [-1.32,0,1.32])box(pod,'monaco-pitwall-console-leg',x,.425,-.10,.075,.84,.29,0x536e64);
  for(const [screenIndex,x]of [-1.14,-.43,.43,1.14].entries()){
   const screen=new THREE.Group();screen.name=`monaco-pitwall-monitor-${index+1}-${screenIndex+1}`;screen.position.set(x,1.27,-.22);pod.add(screen);
   box(screen,'monaco-pitwall-monitor-stand',0,-.19,0,.05,.38,.055,0x54776d);
   box(screen,'monaco-pitwall-monitor-frame',0,0,0,.65,.43,.065,0x173b3a,.025);
   box(screen,'monaco-pitwall-monitor-lcd',0,0,.038,.585,.362,.012,0x102d36);
   box(screen,'monaco-pitwall-monitor-header',0,.135,.048,.55,.030,.006,teamColor);
   for(let row=0;row<4;row++){
    box(screen,'monaco-pitwall-timing-label',-.09,.075-row*.066,.049,.31,.017,.006,row%2?0xa8dbc0:0xd6e2c6);
    box(screen,'monaco-pitwall-timing-value',.20,.075-row*.066,.049,.095,.017,.006,row===2?0xe8c96c:0x68bbb1);
   }
   const keyboard=box(pod,'monaco-pitwall-keyboard',x,.945,.07,.55,.025,.145,0x294f46,.018);keyboard.userData.screen=screenIndex+1;
   for(let row=0;row<3;row++)for(let key=0;key<7;key++)box(pod,'monaco-pitwall-keycap',x-.225+key*.074,.962,.022+row*.043,.039,.012,.024,0x9aafa0);
   box(pod,'monaco-pitwall-mouse',x+.285,.95,.065,.07,.035,.11,0x415f55,.02);
  }
  for(const [operatorIndex,x]of [-.78,.78].entries()){
   const operator=new THREE.Group();operator.name=`monaco-pitwall-operator-${index+1}-${operatorIndex+1}`;pod.add(operator);
   box(operator,'monaco-pitwall-chair-seat',x,.52,.42,.53,.10,.45,0x31594e,.055);
   box(operator,'monaco-pitwall-chair-back',x,.80,.66,.54,.52,.085,0x31594e,.045);
   box(operator,'monaco-pitwall-chair-pedestal',x,.27,.43,.08,.50,.08,0x54756a);
   box(operator,'monaco-pitwall-chair-foot',x,.065,.43,.40,.045,.30,0x54756a);
   ellipse(operator,'monaco-pitwall-oval-torso',x,.91,.39,.24,.345,.19,teamColor);
   ellipse(operator,'monaco-pitwall-team-helmet',x,1.43,.37,.215,.23,.215,teamColor);
   box(operator,'monaco-pitwall-helmet-visor',x,1.44,.17,.29,.085,.027,0x183c3d,.02);
   // A thin headset band makes the team engineer silhouette distinct without
   // adding arms or legs to the approved torso-and-helmet figure style.
   box(operator,'monaco-pitwall-headset-earcup',x+.208,1.44,.37,.045,.105,.095,0x1d3836,.018);
   box(operator,'monaco-pitwall-headset-microphone',x+.17,1.37,.19,.035,.025,.18,0x1d3836);
  }
  pod.userData={teamName,teamColor,side:'pit-wall-opposite-garages',monitors:4,keyboards:4,seats:2,operators:2,operatorStyle:'oval-torso-and-team-helmet-no-legs',canopy:'rear-only-open-console',width:3.3,depth:1.7};
  pods.push({id:pod.name,teamName,teamColor,center:center.clone(),front,width:3.3,depth:1.7,group:pod});
 }
 const summary={name:group.name,rooms:pods.length,monitors:pods.length*4,keyboards:pods.length*4,operators:pods.length*2,seats:pods.length*2,location:'island-between-pit-fast-lane-and-main-straight',footprint:{width:3.3,depth:1.7},teams:pods.map(p=>({id:p.id,name:p.teamName,color:p.teamColor,center:p.center.toArray(),front:p.front.toArray()})),artistic:'Compact strategy cabins match the eight review-model garage fronts. Authored miniature layout, not an actual surveyed Monaco pit-wall plan.'};
 group.userData.monacoPitwall=summary;
 return{group,pods,summary};
}
