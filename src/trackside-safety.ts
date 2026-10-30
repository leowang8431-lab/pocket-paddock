import * as THREE from 'three';
import type {Track} from './track';
import {createStandLayouts,distanceToStand} from './stand-layout';
import {createPitComplexLayout,pitFootprint} from './pit-complex';
import {createBackgroundLandmarkLayouts,distanceToLandmark} from './monza-landmarks';
import {createCircuitPropLayouts} from './monza-surroundings';
import {structuralRod} from './monza-details';

export const MONZA_MEDICAL_REFERENCE='https://www.monzanet.it/lassistenza-sanitaria-per-gli-eventi-dellautodromo-nazionale-monza-affidata-ad-areu/';
export const MONZA_SERVICE_REFERENCE='https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf';
interface Footprint {x:number;z:number;yaw:number;width:number;depth:number}
export interface SafetyVehicle extends Footprint {id:string;kind:'recovery-crane'|'medical-van';height:number;reference:string;artistic:string}
export interface TyreBarrier {id:string;corner:string;distance:number;side:number;offsets:number[];stacks:number;spacing:number;layers:number;tyres:number}
export interface TracksideSafetyLayout {vehicles:SafetyVehicle[];tyreBarriers:TyreBarrier[];artistic:string}
export function distanceToSafetyFootprint(x:number,z:number,p:Footprint){
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=x-p.x,dz=z-p.z;
  return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-p.width/2),Math.max(0,Math.abs(s*dx+c*dz)-p.depth/2));
}
export function safetyFootprint(p:Footprint,steps=8){return pitFootprint({...p,id:'safety',kind:'safety',height:1,minY:0,solid:false},steps);}
export function tyreStackPositions(track:Track,barrier:TyreBarrier){
  const points:{x:number;z:number;y:number;distance:number;offset:number}[]=[];
  for(let i=0;i<barrier.stacks;i++)for(const offset of barrier.offsets){
    const distance=barrier.distance+(i-(barrier.stacks-1)/2)*barrier.spacing,sample=track.sampleAt(distance);
    for(let layer=0;layer<barrier.layers;layer++)points.push({x:sample.point.x+sample.right.x*offset*barrier.side,z:sample.point.z+sample.right.z*offset*barrier.side,y:.18+layer*.26,distance,offset});
  }
  return points;
}

/** Service types follow official circuit references. Positions, sizes and the
 * fictional medical livery are authored for this miniature, not a 2026 survey. */
export function createTracksideSafetyLayout(track:Track):TracksideSafetyLayout{
  const stands=createStandLayouts(track),pit=createPitComplexLayout(track),landmarks=createBackgroundLandmarkLayouts(track),props=createCircuitPropLayouts(track);
  const vehicles:SafetyVehicle[]=[],tyreBarriers:TyreBarrier[]=[];
  const buildings=pit.footprints;
  for(const [kind,cornerIndex]of [['recovery-crane',0],['recovery-crane',3],['medical-van',2],['medical-van',7]] as const){
    let placed:SafetyVehicle|undefined;
    for(const advance of [0,-18,18,-35,35,-52,52])for(const side of [1,-1])for(const offset of [40,47,55,63,72]){
      if(placed)continue;const sample=track.sampleAt(track.corners[cornerIndex].distance+advance),point=sample.point.clone().addScaledVector(sample.right,side*offset);
      const crane=kind==='recovery-crane',candidate:SafetyVehicle={id:`${kind}-${cornerIndex}`,kind,x:point.x,z:point.z,yaw:Math.atan2(sample.tangent.x,sample.tangent.z),width:crane?8.6:4.2,depth:crane?14.2:10.4,height:crane?11.2:4.8,reference:crane?MONZA_SERVICE_REFERENCE:MONZA_MEDICAL_REFERENCE,artistic:'Decorative circuit-service vehicle outside all guardrails; placement is not a surveyed service post. CIRCUIT MEDICAL is fictional.'};
      if(vehicles.some(p=>Math.hypot(p.x-point.x,p.z-point.z)<Math.hypot(p.width,p.depth)/2+Math.hypot(candidate.width,candidate.depth)/2+4))continue;
      if(safetyFootprint(candidate).every(p=>{
        const n=track.nearest(p.x,p.z);
        return Math.hypot(p.x-n.point.x,p.z-n.point.z)>26&&!track.isPitLane(p.x,p.z)
          &&stands.every(s=>distanceToStand(p.x,p.z,s)>3)&&buildings.every(b=>distanceToSafetyFootprint(p.x,p.z,b)>2)
          &&landmarks.every(b=>distanceToLandmark(p.x,p.z,b)>3)&&props.every(b=>distanceToSafetyFootprint(p.x,p.z,b)>2)
          &&track.corners.every(c=>{const s=track.sampleAt(c.distance);return Math.hypot(p.x-s.point.x-s.right.x*29,p.z-s.point.z-s.right.z*29)>4.4;});
      }))placed=candidate;
    }
    if(!placed)throw new Error(`No safe trackside service footprint: ${kind}/${cornerIndex}`);vehicles.push(placed);
  }
  for(const cornerIndex of [0,2,6,7]){
    let placed:TyreBarrier|undefined;
    for(const rowOffsets of [[22.30,23.22],[23.22]])for(const advance of [0,-12,-24,12,24,-36,36,-50,50,-65,65])for(const side of [1,-1]){
      if(placed)continue;
      const candidate:TyreBarrier={id:`tyre-buffer-${cornerIndex}`,corner:track.corners[cornerIndex].name,distance:track.corners[cornerIndex].distance+advance,side,offsets:rowOffsets,stacks:20,spacing:.92,layers:3,tyres:20*rowOffsets.length*3};
      const safe=tyreStackPositions(track,candidate).filter(p=>p.y<.2).every(p=>{
        const inner=track.sampleAt(p.distance),ix=inner.point.x+inner.right.x*18.5*side,iz=inner.point.z+inner.right.z*18.5*side;
        if(track.surfaceAt(ix,iz)!=='gravel')return false;
        for(let k=0;k<8;k++){
          const x=p.x+Math.cos(k*Math.PI/4)*.44,z=p.z+Math.sin(k*Math.PI/4)*.44,n=track.nearest(x,z),distance=Math.hypot(x-n.point.x,z-n.point.z);
          if(distance<21.8||distance>23.8||track.isPitLane(x,z)||stands.some(s=>distanceToStand(x,z,s)<1)||buildings.some(b=>distanceToSafetyFootprint(x,z,b)<1)||landmarks.some(b=>distanceToLandmark(x,z,b)<1))return false;
        }
        return true;
      });
      if(safe)placed=candidate;
    }
    if(!placed)throw new Error(`No safe gravel tyre buffer: ${cornerIndex}`);tyreBarriers.push(placed);
  }
  return{vehicles,tyreBarriers,artistic:'Four gravel runoff tyre buffers and four service vehicles are decorative. No new collision volumes or timing rules. Positions compressed from circuit facility types, not exact operator or 2026 coordinates.'};
}
export function tracksideTreeExclusion(x:number,z:number,layout:TracksideSafetyLayout){return layout.vehicles.some(p=>distanceToSafetyFootprint(x,z,p)<7);}

export function addTracksideSafety(root:THREE.Group,track:Track,layout=createTracksideSafetyLayout(track)){
  const mats=new Map<number,THREE.MeshStandardMaterial>(),mat=(color:number)=>{let m=mats.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.7,metalness:.08});mats.set(color,m);}return m;};
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);p.add(m);return m;};
  const cyl=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,segments=10)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),mat(color));m.position.set(x,y,z);p.add(m);return m;};
  const rod=(p:THREE.Object3D,a:number[],b:number[],r:number,color:number)=>structuralRod(p,new THREE.Vector3(...a),new THREE.Vector3(...b),r,mat(color));
  const labels:{p:THREE.Group;text:string}[]=[];
  for(const vehicle of layout.vehicles){
    const g=new THREE.Group();g.name=vehicle.id;g.position.set(vehicle.x,0,vehicle.z);g.rotation.y=vehicle.yaw;g.userData.layout=vehicle;root.add(g);
    if(vehicle.kind==='recovery-crane'){
      // Tracked compact recovery crane, folded toward the protected service
      // bay. The complete boom and hanging cable stay within its footprint.
      for(const x of [-2.1,2.1]){
        box(g,x,.65,-.5,1.1,1.05,7.3,0x27322e);
        for(let j=0;j<6;j++){const wheel=cyl(g,x,.72,-3.35+j*1.13,.43,1.15,0x5f665b);wheel.rotation.z=Math.PI/2;}
        for(let j=0;j<16;j++){box(g,x,1.2,-3.8+j*.45,1.18,.12,.17,0x677063);box(g,x,.11,-3.8+j*.45,1.18,.12,.17,0x556053);}
      }
      box(g,0,1.43,-.5,4.7,.5,7.0,0xc49c31);cyl(g,0,1.84,-.5,1.55,.45,0x596557,16);
      box(g,0,2.5,-2.65,4.4,1.05,2.2,0xd5ac39);box(g,-1.45,2.85,.1,1.6,2.1,2.6,0xe7bb44);
      box(g,-1.46,3.16,1.42,1.36,1.25,.04,0x547d88);box(g,-2.27,3.16,.08,.04,1.25,2.15,0x547d88);
      box(g,-1.45,4.0,.1,1.85,.18,2.85,0xaaa883);box(g,-1.45,2.66,1.45,1.4,.13,.05,0x253c35);
      for(let j=0;j<5;j++){const stripe=box(g,-1.7+j*.8,2.64,-3.78,.30,.72,.04,0x283a2f);stripe.rotation.z=-.32;}
      box(g,.8,2.66,-.3,1.5,1.25,2.4,0xc49729);
      rod(g,[.6,2.9,-.9],[.6,5.9,2.4],.35,0xe1b440);rod(g,[.6,5.9,2.4],[.6,9.4,5.25],.25,0xe6bd50);
      rod(g,[.6,3.0,.2],[.6,5.0,2.1],.13,0x525e55);rod(g,[.6,5.0,2.1],[.6,5.9,2.4],.075,0xc9d0c7);
      rod(g,[.6,5.7,1.95],[.6,8.9,4.88],.11,0x535d55);rod(g,[.6,8.9,4.88],[.6,9.4,5.25],.065,0xd2d8cb);
      rod(g,[.6,9.4,5.25],[.6,4.3,5.25],.025,0x37443d);
      box(g,.6,4.18,5.25,.32,.4,.30,0x293c32);const hook=new THREE.Mesh(new THREE.TorusGeometry(.24,.065,5,10,Math.PI*1.65),mat(0xc9a348));hook.position.set(.6,3.78,5.25);hook.rotation.z=-Math.PI*.33;g.add(hook);
      for(const x of [-1.95,1.95]){rod(g,[x,1.7,-2.8],[x,2.4,-2.8],.045,0xa8b0a1);rod(g,[x,1.7,-.9],[x,2.4,-.9],.045,0xa8b0a1);rod(g,[x,2.4,-2.8],[x,2.4,-.9],.045,0xa8b0a1);}
      cyl(g,-1.45,4.24,.3,.16,.29,0xe9a133,8);labels.push({p:g,text:'CIRCUIT RECOVERY'});
    }else{
      box(g,0,1.8,0,3.35,2.9,8.35,0xe9eadd);box(g,0,3.32,-.5,3.28,.32,6.9,0xf5f4e6);
      box(g,0,1.05,4.3,3.3,1.3,.45,0xe9eadd);box(g,0,2.57,3.9,3.05,1.45,.055,0x536e77);
      box(g,0,.74,4.57,3.4,.32,.26,0x69736c);box(g,0,1.17,4.54,1.45,.4,.05,0x34443d);
      for(const x of [-1.70,1.70]){
        box(g,x,2.62,2.57,.035,1.2,1.85,0x597e88);box(g,x,1.75,-.35,.045,.30,7.0,0x548c50);box(g,x,1.38,-.35,.047,.18,7.05,0xd7c756);
        box(g,x,2.43,-1.5,.055,1.3,.28,0x387654);box(g,x,2.43,-1.5,.057,.28,1.3,0x387654);
        for(const z of [1.43,-3.5])box(g,x,2.02,z,.055,.07,.47,0x68776e);
        box(g,x,2.46,1.23,.035,1.8,.025,0x9ba89b);box(g,x,2.28,-.05,.035,1.5,.025,0x9ba89b);
        box(g,x*1.09,2.35,3.2,.30,.5,.27,0x3f5049);
        for(const z of [-2.7,2.7]){const wheel=cyl(g,x,.68,z,.66,.35,0x29342f,14);wheel.rotation.z=Math.PI/2;const rim=cyl(g,x*1.11,.68,z,.34,.04,0xb0b7ab,10);rim.rotation.z=Math.PI/2;}
      }
      for(const x of [-1.18,1.18]){box(g,x,1.24,4.54,.67,.35,.07,0xece9bc);box(g,x,1.22,-4.2,.40,.62,.07,0xbc4b3b);box(g,x,3.65,1.7,.66,.28,.65,0x4574a5);}
      box(g,0,3.51,1.7,2.9,.17,.65,0xa3aaa0);box(g,0,3.63,1.7,1.1,.22,.50,0xf1ecda);
      box(g,0,2.0,-4.2,.035,2.65,.045,0x929e92);box(g,0,1.15,-4.26,1.9,.15,.05,0x7d8c80);
      labels.push({p:g,text:'CIRCUIT MEDICAL'});
    }
  }
  // A single locally generated label atlas; no CDN or image request is needed.
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#ebeddf';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#2c624d';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 36px Arial';ctx.fillText('CIRCUIT MEDICAL',512,32);ctx.fillText('CIRCUIT RECOVERY',512,96);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const labelMat=new THREE.MeshBasicMaterial({map,side:THREE.FrontSide});
    for(const {p,text}of labels)for(const side of [-1,1]){
      const medical=text==='CIRCUIT MEDICAL',geometry=new THREE.PlaneGeometry(medical?3.8:3.0,.43),uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setY(i,(medical?.5:0)+uv.getY(i)*.5);
      const label=new THREE.Mesh(geometry,labelMat);label.position.set((medical?1.73:2.22)*side,medical?2.98:2.65,medical?-1.4:-2.65);label.rotation.y=side*Math.PI/2;p.add(label);
    }
  }
  const count=layout.tyreBarriers.reduce((sum,b)=>sum+b.tyres,0),tyres=new THREE.InstancedMesh(new THREE.TorusGeometry(.31,.13,4,10).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.97}),count),object=new THREE.Object3D(),black=new THREE.Color(0x303932),end=new THREE.Color(0xbcc4b6);let index=0;
  tyres.name='runoff-tyre-buffers';
  for(const barrier of layout.tyreBarriers){const points=tyreStackPositions(track,barrier);for(let i=0;i<points.length;i++){const p=points[i];object.position.set(p.x,p.y,p.z);object.updateMatrix();tyres.setMatrixAt(index,object.matrix);tyres.setColorAt(index,i<barrier.layers||i>=points.length-barrier.layers?end:black);index++;}}
  tyres.computeBoundingSphere();tyres.userData.triangles=count*80;root.add(tyres);root.userData.tracksideSafety=layout;return layout;
}
