import * as THREE from 'three';
import type {Track} from './track';
import {createStandLayouts,distanceToStand} from './stand-layout';
import {createCircuitPropLayouts} from './monza-surroundings';
import {ARCHITECTURE_HEIGHT_SCALE,scaleArchitectureHeight} from './architecture-scale';

const HOSPITALITY='https://www.monzanet.it/wp-content/uploads/2025/11/Brochure_Hospitality_GPf12026.pdf';
const PARK='https://reggiadimonza.it/architetture/';
type LandmarkTrack=Pick<Track,'width'|'length'|'samples'|'corners'|'nearest'|'sampleAt'|'isPitLane'|'colliders'>;
export interface BackgroundLandmarkLayout {
  id:'monza-house'|'ultimate-hospitality'|'costa-alta'|'serraglio-gate';
  name:string;x:number;z:number;yaw:number;width:number;depth:number;height:number;
  reference:string;artistic:string;
}

export function landmarkFootprint(layout:BackgroundLandmarkLayout,steps=8){
  const result:{x:number;z:number}[]=[],c=Math.cos(layout.yaw),s=Math.sin(layout.yaw);
  for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++){
    const x=(i/steps-.5)*layout.width,z=(j/steps-.5)*layout.depth;
    result.push({x:layout.x+c*x+s*z,z:layout.z-s*x+c*z});
  }
  return result;
}
export function distanceToLandmark(x:number,z:number,layout:BackgroundLandmarkLayout){
  const c=Math.cos(layout.yaw),s=Math.sin(layout.yaw),dx=x-layout.x,dz=z-layout.z;
  return Math.hypot(Math.max(Math.abs(c*dx-s*dz)-layout.width/2,0),Math.max(Math.abs(s*dx+c*dz)-layout.depth/2,0));
}

/** Compressed relationships from the venue map, not surveyed building positions.
 * Check the complete footprint against the neighbouring road, not just its centre. */
export function createBackgroundLandmarkLayouts(track:LandmarkTrack):BackgroundLandmarkLayout[]{
  const stands=createStandLayouts(track),props=createCircuitPropLayouts(track),placed:BackgroundLandmarkLayout[]=[];
  const specs:BackgroundLandmarkLayout[]=[
    {id:'monza-house',name:'Monza House',x:-6,z:59,yaw:1.05,width:26,depth:20,height:9.5,reference:HOSPITALITY,artistic:'2026 brochure pp.11/18 verifies the independent lounge, garden and position between paddock and Ascari exit. Exterior facade is an authored miniature, not a photographed replica.'},
    {id:'ultimate-hospitality',name:'Ultimate Hospitality',x:94,z:113,yaw:-.65,width:42,depth:24,height:9.5,reference:HOSPITALITY,artistic:'2026 brochure pp.13/18: single-level metal canopy, glazing, white terrace furniture and red seating beside the Ascari–Parabolica straight. Shortened and moved inward for game visibility.'},
    {id:'costa-alta',name:'Cascina Costa Alta',x:-136,z:-211,yaw:-.4,width:35,depth:23,height:14,reference:PARK,artistic:'Existing park hostel: arched openings, central pediment and belvedere. Compressed into the western park background; no claim that it is visible from a real F1 cockpit.'},
    {id:'serraglio-gate',name:'Serraglio dei Cervi',x:101,z:-178,yaw:-.8,width:23,depth:14,height:13,reference:PARK,artistic:'Existing Bosco Bello pointed-arch gateway with two slender towers near Serraglio. Park location and distance are compressed; not a reconstruction of proposed restoration works.'},
  ];
  for(const original of specs){
    let chosen:BackgroundLandmarkLayout|undefined;
    const shifts=[[0,0],[0,-12],[-12,0],[12,0],[0,12],[-12,-12],[12,-12],[-24,0],[24,0],[0,-24],[0,24],[-24,-24],[24,24]];
    for(const [dx,dz]of shifts){
      const candidate={...original,x:original.x+dx,z:original.z+dz};
      const facing=track.nearest(candidate.x,candidate.z).point;
      // The authored terrace/window side is local -Z. Face that side toward
      // the nearby driving section instead of showing a blank rear facade.
      candidate.yaw=Math.atan2(candidate.x-facing.x,candidate.z-facing.z);
      const radius=Math.hypot(candidate.width,candidate.depth)/2;
      if(props.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<radius+Math.hypot(p.width,p.depth)/2+3))continue;
      if(placed.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<radius+Math.hypot(p.width,p.depth)/2+6))continue;
      const safe=landmarkFootprint(candidate).every(p=>{
        const near=track.nearest(p.x,p.z);
        return Math.hypot(p.x-near.point.x,p.z-near.point.z)>28&&!track.isPitLane(p.x,p.z)
          &&stands.every(s=>distanceToStand(p.x,p.z,s)>4)
          &&track.colliders.every(b=>Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ))>3);
      });
      if(safe){chosen=candidate;break;}
    }
    if(!chosen)throw new Error(`No safe Monza landmark footprint: ${original.id}`);
    chosen.height*=ARCHITECTURE_HEIGHT_SCALE;chosen.artistic+=' Building height artistically increased by 25%, with the same audited horizontal footprint.';
    placed.push(chosen);
  }
  return placed;
}

/** Keep the crowns off the building and reserve one narrow sightline from the
 * nearest road. The rest of Monza's wooded park is intentionally retained. */
export function landmarkTreeExclusion(x:number,z:number,layout:BackgroundLandmarkLayout,track:Pick<Track,'nearest'>){
  if(distanceToLandmark(x,z,layout)<9)return true;
  const road=track.nearest(layout.x,layout.z).point,dx=layout.x-road.x,dz=layout.z-road.z,length2=dx*dx+dz*dz;
  const t=((x-road.x)*dx+(z-road.z)*dz)/length2;
  return t>.15&&t<1&&Math.hypot(x-road.x-dx*t,z-road.z-dz*t)<10;
}

/** All solid components are opaque Standard materials and enter the existing
 * spatial architecture batches. No extra texture fetch or reflection render. */
export function addMonzaLandmarks(root:THREE.Group,track:LandmarkTrack){
  const layouts=createBackgroundLandmarkLayouts(track),materials=new Map<number,THREE.MeshStandardMaterial>();
  const mat=(color:number)=>{let m=materials.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.8});materials.set(color,m);}return m;};
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));mesh.position.set(x,y,z);p.add(mesh);return mesh;};
  const cylinder=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,sides=8)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,sides),mat(color));mesh.position.set(x,y,z);p.add(mesh);return mesh;};
  const arch=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,color:number)=>{
    const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h-w/2);s.absarc(0,h-w/2,w/2,0,Math.PI,false);s.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.13,steps:1,bevelEnabled:false,curveSegments:5}),mat(color));mesh.position.set(x,y,z);p.add(mesh);return mesh;
  };
  const gable=(p:THREE.Object3D,x:number,y:number,z:number,w:number,rise:number,d:number,color:number)=>{
    const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,rise);shape.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:d,steps:1,bevelEnabled:false}),mat(color));mesh.position.set(x,y,z-d/2);p.add(mesh);return mesh;
  };
  const furniture=(p:THREE.Object3D,x:number,z:number)=>{
    cylinder(p,x,1.35,z,.9,.12,0xf2eee1);cylinder(p,x,.8,z,.09,1.0,0xaab6ae,6);
    for(const side of [-1,1]){box(p,x+side*1.55,.85,z,.85,.15,.9,0xe5e6dc);box(p,x+side*1.55,1.3,z+.38,.85,.9,.12,0xe5e6dc);}
  };
  const hedge=(p:THREE.Object3D,x:number,z:number,w:number,d:number)=>{box(p,x,.3,z,w,.6,d,0xb6b6a0);box(p,x,.85,z,w-.2,.65,d-.2,0x527950);};
  for(const layout of layouts){
    const group=scaleArchitectureHeight(new THREE.Group());group.name=`background-landmark-${layout.id}`;group.position.set(layout.x,.10,layout.z);group.rotation.y=layout.yaw;root.add(group);
    box(group,0,.06,0,layout.width,.12,layout.depth,0xd4d0b9);
    if(layout.id==='monza-house'){
      // Monza House's exterior is deliberately interpretive: the official
      // brochure supplies the lounge/garden programme, not facade photographs.
      box(group,0,3.3,3,20,6.4,9,0xe7e2d5);box(group,0,6.7,3,21,.35,10,0xf4eee0);
      box(group,0,3.2,-1.58,17.8,4.7,.12,0x6e8d91);
      for(let x=-8.7;x<=8.8;x+=2.9)box(group,x,3.2,-1.7,.16,5,.16,0xd7dbcf);
      box(group,0,4.7,-4.5,23,.3,6.6,0xe8e6d9);
      for(const x of [-10.8,10.8])box(group,x,2.4,-7.2,.20,4.6,.20,0xb4bdb0);
      for(const x of [-6,0,6])furniture(group,x,-4.8);
      hedge(group,-11.6,2.5,1.3,10);hedge(group,11.6,2.5,1.3,10);
      box(group,0,7.15,3,8,.5,5,0xc9d0c1);
    }else if(layout.id==='ultimate-hospitality'){
      // The photographed steel-grid canopy and glazing are the recognisable
      // feature, with a small red seating terrace facing the circuit.
      box(group,0,3.2,5.1,36,6.0,9.6,0xd9ded6);box(group,0,3.2,.24,34,4.9,.12,0x718d92);
      box(group,0,6.5,2.0,39,.3,17,0xdde1d8);
      for(let x=-18;x<=18;x+=6){box(group,x,3.3,-5.7,.22,6.5,.22,0xb3c0b7);box(group,x,3.3,.08,.22,6.5,.22,0xb3c0b7);box(group,x,6.25,2,.16,.30,15.4,0xa2afa7);}
      for(const z of [-4.4,.5,5.2,9])box(group,0,6.25,z,38,.28,.15,0xa2afa7);
      for(const x of [-12,-4,4,12])furniture(group,x,-3.3);
      for(let row=0;row<3;row++){
        const y=.4+row*.45,z=-10+row*1.15;box(group,0,y-.16,z,32,.3,1.1,0xbec9c3);
        for(let col=0;col<18;col++){const x=-14.5+col*1.7;box(group,x,y+.34,z,.8,.18,.68,0xbb3934);box(group,x,y+.65,z+.28,.8,.65,.13,0xbb3934);}
      }
      hedge(group,-19.7,2,1.2,14);hedge(group,19.7,2,1.2,14);
    }else if(layout.id==='costa-alta'){
      box(group,0,4.1,1,24,8,12,0xe0c785);gable(group,0,8.1,1,26,2.4,14,0xa8664b);
      for(const side of [-1,1]){box(group,side*13.7,3,2,5.6,5.8,15,0xddc48a);gable(group,side*13.7,5.9,2,6.7,1.8,16.5,0x9d654b);}
      box(group,0,10.0,1,7,3.4,7,0xe2cc91);gable(group,0,11.7,1,8.2,1.8,8.4,0xa8664b);
      for(const x of [-2.2,0,2.2])arch(group,x,9.35,-2.58,1.2,1.75,0x6f7d6e);
      for(const x of [-8,-4,0,4,8]){arch(group,x,.7,-5.14,2.3,3.1,0x5d736b);arch(group,x,4.8,-5.14,1.7,2.3,0x6b7b6e);}
      gable(group,0,7.8,-5.3,11.5,2.1,.5,0xe6d4a2);box(group,0,7.8,-5.42,12,.32,.8,0xe8d9b4);
      for(const x of [-5,5]){box(group,x,2.3,-5.5,.46,4.4,.5,0xebd8ad);box(group,x,.3,-5.6,.9,.4,.9,0xbab4a0);}
      for(let step=0;step<3;step++)box(group,0,.15+step*.18,-7.6+step*.65,12-step*.5,.3,.8,0xc1baa1);
    }else{
      const brick=0xad765d,stone=0xc6b99b;
      for(const side of [-1,1]){
        box(group,side*6.3,5.4,0,3.5,10.6,3.6,stone);box(group,side*6.3,.5,0,4.1,.8,4.2,0xc1aa84);box(group,side*6.3,10.8,0,4,.6,4.1,stone);
        box(group,side*6.3,11.35,0,3.6,.48,3.7,0xb3a48c);
        const spire=new THREE.Mesh(new THREE.ConeGeometry(.62,1.35,8),mat(0x9c9278));spire.position.set(side*6.3,12.2,0);group.add(spire);
        arch(group,side*6.3,7.4,-1.87,1.15,2.3,0x53665a);box(group,side*6.3,4,-1.87,1.0,1.1,.12,0xded5bd);
        for(let line=1;line<5;line++)box(group,side*6.3,line*.75,-1.82,3.5,.06,.08,0xab9b7e);
      }
      const shape=new THREE.Shape();shape.moveTo(-4.7,0);shape.lineTo(-4.7,6.4);shape.lineTo(0,10.3);shape.lineTo(4.7,6.4);shape.lineTo(4.7,0);shape.lineTo(3.25,0);shape.lineTo(3.25,4.9);shape.quadraticCurveTo(2.25,6.8,0,8.3);shape.quadraticCurveTo(-2.25,6.8,-3.25,4.9);shape.lineTo(-3.25,0);shape.closePath();
      const portal=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:1.6,steps:1,bevelEnabled:false,curveSegments:8}),mat(brick));portal.position.z=-.8;portal.name='serraglio-pointed-arch';group.add(portal);
      const trim=new THREE.Shape();trim.moveTo(-3.7,0);trim.lineTo(-3.7,5.1);trim.quadraticCurveTo(-2.6,7.3,0,8.85);trim.quadraticCurveTo(2.6,7.3,3.7,5.1);trim.lineTo(3.7,0);trim.lineTo(3.25,0);trim.lineTo(3.25,4.9);trim.quadraticCurveTo(2.25,6.8,0,8.3);trim.quadraticCurveTo(-2.25,6.8,-3.25,4.9);trim.lineTo(-3.25,0);trim.closePath();
      const edge=new THREE.Mesh(new THREE.ExtrudeGeometry(trim,{depth:.16,steps:1,bevelEnabled:false,curveSegments:8}),mat(0xd8c8a8));edge.position.z=-.97;group.add(edge);
      for(const side of [-1,1]){box(group,side*9.1,2.5,2.5,3.3,4.8,5.5,brick);gable(group,side*9.1,4.9,2.5,3.7,1.7,6,0x8c6048);}
    }
  }
  root.userData.backgroundLandmarks=layouts;
  return layouts;
}
