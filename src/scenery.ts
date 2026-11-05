import {MONZA_PIT_LAYOUT} from './monza-pit-layout';
import * as THREE from 'three';
import { Track } from './track';
import { createStandLayouts, createBrakingBoards, distanceToStand, standDimensions, type StandLayout } from './stand-layout';
import { batchStaticScenery, coloredGeometry } from './render-batches';
import {structuralRod} from './monza-details';
import {addPitComplex,pitTreeExclusion} from './pit-complex';
import {teams} from './team-catalog';
import {addCircuitSurroundings} from './monza-surroundings';
import {addMonzaLandmarks,landmarkTreeExclusion} from './monza-landmarks';
import {addMonzaForest} from './monza-forest';
import {addTracksideSafety,tracksideTreeExclusion} from './trackside-safety';
import {addMonzaHistoricOval,createHistoricOvalLayout,historicOvalTreeExclusion} from './monza-historic-oval';
import {addMonzaHistoricConnection,createHistoricConnectionLayout,distanceToHistoricConnection,historicConnectionTreeExclusion} from './monza-historic-connection';
import {addMonzaHistoricSouthConnection,createHistoricSouthConnectionLayout} from './monza-historic-south-connection';
import {createMonzaMarshalLayouts,distanceToMarshalPost} from './monza-marshal-layout';
import {ARCHITECTURE_HEIGHT_SCALE,scaleArchitectureHeight} from './architecture-scale';
import {createMonacoGameScenery} from './monaco-game-scenery';

const palette={cream:0xe5e2d8,teal:0x315a50,mint:0x86b7a0,coral:0xc53b34,navy:0x273338,yellow:0xe3bc42};
const materials=new Map<number,THREE.MeshStandardMaterial>();
function material(color:number){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.8}));return materials.get(color)!;}
function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function sign(text:string,width:number,height:number,fg='#f5f0db',bg='#24564e'){
  const c=document.createElement('canvas');c.width=1024;c.height=Math.max(128,Math.round(1024*height/width));
  const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;
  ctx.font=`700 ${Math.floor(c.height*.52)}px Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,c.height*.53,960);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
}

const crowdClothesMaterial=new THREE.MeshLambertMaterial({color:0xffffff});
const crowdPartsMaterial=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true});
let crowdShapes:{clothes:THREE.BufferGeometry;parts:THREE.BufferGeometry}[]|undefined;
function addCrowd(parent:THREE.Group,width:number,rows:number,aisles=false){
  if(!crowdShapes){
    const clothes=coloredGeometry([
      {geometry:new THREE.BoxGeometry(.48,.65,.38),color:0xffffff},
      {geometry:new THREE.SphereGeometry(.235,6,3,0,Math.PI*2,0,Math.PI/2).translate(0,.51,0),color:0xffffff},
    ]);
    const parts=coloredGeometry([
      {geometry:new THREE.SphereGeometry(.21,8,5).translate(0,.51,0),color:0xf1d0ab},
      {geometry:new THREE.BoxGeometry(.32,.045,.2).translate(0,.60,-.20),color:palette.navy},
      {geometry:new THREE.BoxGeometry(.16,.065,.065).translate(0,.52,-.205),color:palette.navy},
      {geometry:new THREE.BoxGeometry(.59,.48,.12).translate(0,-.03,.29),color:palette.teal},
      {geometry:new THREE.BoxGeometry(.59,.1,.58).translate(0,-.3,.03),color:palette.teal},
    ]);
    // Keep two draws at either distance, even with twice as many people.
    crowdShapes=[{clothes,parts},{
      clothes:new THREE.BoxGeometry(.48,.65,.38),
      parts:coloredGeometry([{geometry:new THREE.OctahedronGeometry(.23,0).translate(0,.51,0),color:0xf1d0ab}]),
    }];
  }
  const lod=new THREE.LOD(),centerZ=(rows-1)*1.75/2;lod.name='spectator-lod';lod.position.z=centerZ;
  const capacity=Math.floor(width/1.5)*rows,o=new THREE.Object3D();
  const colors=[palette.coral,palette.teal,palette.yellow,0xd8e4da,0x84a7bc,0xffffff];let spectators=0;
  for(let level=0;level<crowdShapes.length;level++){
    const shape=crowdShapes[level],group=new THREE.Group();
    const clothes=new THREE.InstancedMesh(shape.clothes,crowdClothesMaterial,capacity);
    const parts=new THREE.InstancedMesh(shape.parts,crowdPartsMaterial,capacity);let index=0;
    clothes.name='spectator-clothes';parts.name='spectator-faces-seats';
    for(let row=0;row<rows;row++)for(let col=0;col<Math.floor(width/1.5);col++){
      if((col+row*7)%11===0)continue;
      if(aisles&&[-width*.32,0,width*.32].some(x=>Math.abs(-width/2+.8+col*1.5-x)<1.0))continue;
      o.position.set(-width/2+.8+col*1.5,2.06+row*.68,row*1.75+.2-centerZ);o.updateMatrix();
      clothes.setMatrixAt(index,o.matrix);clothes.setColorAt(index,new THREE.Color(colors[(col*3+row*7)%colors.length]));
      parts.setMatrixAt(index,o.matrix);index++;
    }
    spectators=index;clothes.count=parts.count=index;clothes.computeBoundingSphere();parts.computeBoundingSphere();
    group.add(clothes,parts);lod.addLevel(group,level===0?0:85,.12);
  }
  lod.addLevel(new THREE.Group(),245,.1);lod.userData={spectators,drawsPerLevel:2};parent.add(lod);return spectators;
}

/** Exported for geometry audits; all occupied bounds use the same row profile. */
export function grandstand(parent:THREE.Group,layout:StandLayout){
  const {x,z,yaw,width,rows,covered}=layout,d=standDimensions(layout),backZ=11.7+d.depthExtension;
  const g=new THREE.Group();g.name=`grandstand-${layout.id}`;g.position.set(x,0,z);g.rotation.y=yaw;g.userData.layout=layout;g.userData.dimensions=d;parent.add(g);
  box(g,0,.7,d.baseCenterZ,width+2,1.3,d.baseDepth,palette.cream);
  for(let row=0;row<rows;row++){
    box(g,0,1.1+row*.68,row*1.75,width,.55,1.8,0xd6d9ca);
    const seatColor=layout.id==='centrale'?(row%2?0xd7dedb:0x638da7):(row%2?0xd7dedb:0x7e9caa);
    if(layout.id==='centrale'){
      const aisles=[-width*.32,0,width*.32],edges=[-width/2,...aisles,width/2];
      for(let i=0;i<edges.length-1;i++){const left=edges[i]+(i?1.0:0),right=edges[i+1]-(i<edges.length-2?1.0:0);box(g,(left+right)/2,1.6+row*.68,row*1.75+.4,right-left,.2,.8,seatColor);}
    }else box(g,0,1.6+row*.68,row*1.75+.4,width,.2,.8,seatColor);
  }
  // Rear structure now reaches the last row; the extra tiers do not float
  // beyond the old five-row slab. Railings sit behind the occupied seats.
  const rearFloor=1.375+(rows-1)*.68,rearRailZ=d.lastRowZ+1.45;
  for(let cx=-width/2+1;cx<=width/2-1;cx+=7.5){
    box(g,cx,rearFloor/2,backZ,.18,rearFloor,.18,0x7f8d82);
    box(g,cx,rearFloor+.55,rearRailZ,.055,1.1,.055,0x8c9b8e);
  }
  for(const y of [.25,1.05])box(g,0,rearFloor+y,rearRailZ,width,.055,.055,0x8c9b8e);
  if(covered){
    const frontY=d.roofY-Math.sin(.06)*d.roofDepth/2,backY=d.roofY+Math.sin(.06)*d.roofDepth/2;
    for(const cx of [-width/2+2,width/2-2]){
      box(g,cx,backY/2,backZ,.45,backY,.45,palette.teal);box(g,cx,frontY/2,-1,.25,frontY,.25,palette.teal);
    }
    const roof=box(g,0,d.roofY,d.roofCenterZ,width+5,.55,d.roofDepth,palette.cream);roof.name='grandstand-canopy';roof.rotation.x=-.06;
    box(g,0,frontY+.2,-4,width+5,.9,.3,0x788780);
    for(let cx=-width/2+3;cx<width/2;cx+=8){
      structuralRod(g,new THREE.Vector3(cx,d.roofY-.35,-3.4),new THREE.Vector3(cx,d.roofY-.75,12.5+d.depthExtension),.055,material(0x7b8482));
      structuralRod(g,new THREE.Vector3(cx,d.roofY-1.6,8.8+d.depthExtension),new THREE.Vector3(cx,d.roofY-.35,-3.4),.045,material(0x7b8482));
    }
  }
  g.userData.spectators=addCrowd(g,width,rows,layout.id==='centrale');
  if(layout.id==='centrale'){
    for(const x of [-width*.32,0,width*.32]){
      for(let step=0;step<rows*2;step++){
        const z=-.58+step*.875,y=.9+step*.34;
        box(g,x,y,z,1.7,.15,.88,0xbfc5b9);box(g,x,y+.083,z-.4,1.7,.026,.06,0xd7b858);
      }
      for(const dx of [-1,1]){
        structuralRod(g,new THREE.Vector3(x+dx,1.9,-.6),new THREE.Vector3(x+dx,1.9+(rows-.5)*.68,d.lastRowZ+.25),.045,material(0x8c9b8e));
        for(let j=0;j<rows;j++)box(g,x+dx,1.5+j*.68,-.3+j*1.75,.045,1.1,.045,0x8c9b8e);
      }
    }
    const seats=new THREE.InstancedMesh(new THREE.BoxGeometry(.59,.58,.12),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.78}),Math.floor(width/1.5)*rows);
    seats.name='centrale-individual-seat-backs';const transform=new THREE.Object3D();let count=0;
    for(let row=0;row<rows;row++)for(let col=0;col<Math.floor(width/1.5);col++){
      const x=-width/2+.8+col*1.5;if([-width*.32,0,width*.32].some(a=>Math.abs(x-a)<1))continue;
      transform.position.set(x,1.95+row*.68,row*1.75+.82);transform.updateMatrix();seats.setMatrixAt(count,transform.matrix);seats.setColorAt(count++,new THREE.Color(row%2?0xe1e5dc:0x5c85a2));
    }
    seats.count=count;seats.computeBoundingSphere();g.add(seats);
    for(let x=-width/2+3;x<width/2;x+=13.5){
      box(g,x,(d.roofY-.2)/2,backZ,.25,d.roofY-.2,.25,0x7f8d82);
      structuralRod(g,new THREE.Vector3(x,d.roofY-1.7,backZ),new THREE.Vector3(x,d.roofY-.35,-3.2),.085,material(0x8b998d));
    }
    for(let x=-width/2+2;x<width/2;x+=3.4)structuralRod(g,new THREE.Vector3(x,d.roofY-.49-Math.sin(.06)*d.depthExtension/2,-3.35),new THREE.Vector3(x,d.roofY+.48+Math.sin(.06)*d.depthExtension/2,12.4+d.depthExtension),.027,material(0xb1b9ae));
    for(const side of [-1,1]){
      const x=side*(width/2-1.8);box(g,x,d.roofY,-2.8,.07,5.0,.07,0x87998a);
      for(let stripe=0;stripe<3;stripe++){
        const flag=box(g,x-side*(.3+stripe*.5),d.roofY+1.4,-2.8,.5,1.1,.035,[0x188651,0xf0f0e4,0xc43c32][stripe]);flag.rotation.y=side*.13;
      }
    }
    g.userData.detail={aisles:3,individualSeats:count,roofRibs:Math.ceil((width-4)/3.4),reference:'Monza official hospitality photographs and Centrale covered-grandstand map'};
  }
  box(g,0,.8,-2.2,width+2,.28,.18,palette.teal);
  for(let cx=-width/2+1;cx<=width/2-1;cx+=7.5)box(g,cx,1.9,-2.2,.07,2.2,.07,0x929c96);
  for(const y of [1.0,1.7,2.5])box(g,0,y,-2.2,width-2,.07,.07,0x929c96);
  const label=sign(layout.id==='centrale'?'TRIBUNA CENTRALE  •  MONZA':'AUTODROMO  •  MONZA',width*.7,layout.id==='centrale'?.8:1.3);label.position.set(0,layout.id==='centrale'?1.08:2,-2.3);label.rotation.y=Math.PI;g.add(label);
  return g;
}

export function createScenery(track:Track):THREE.Group {
  if(track.id==='monaco')return createMonacoGameScenery(track);
  const root=new THREE.Group();root.name='Monza miniature paddock';
  const base=box(root,65,-3.1,-64,810,5.9,850,0x405b3b);
  base.receiveShadow=true;
  const grass=box(root,65,-.24,-64,804,.35,844,0x7e9a5c);grass.castShadow=false;
  // Subtle park lawn islands break up broad flat color without textures or downloads.
  const lawnMaterial=material(0x738e53);
  for(const [x,z,w,d] of [[25,-60,65,135],[105,-180,40,65],[-175,-160,80,155],[190,80,110,125]]){
    const m=new THREE.Mesh(new THREE.CircleGeometry(1,40),lawnMaterial);m.rotation.x=-Math.PI/2;m.scale.set(w,d,1);m.position.set(x,-.052,z);m.receiveShadow=true;root.add(m);
  }
  // Pits are on the driver's right of the main straight; the stand faces them.
  const pit=new THREE.Group();pit.name='P房与围场';root.add(pit);
  const foundation=MONZA_PIT_LAYOUT.foundation;
  const pitFoundation=box(pit,foundation.x,.035,foundation.z,foundation.width,.1,foundation.depth,0x989d97);pitFoundation.name='monza-pit-foundation';
  const pitComplex=addPitComplex(pit,track);
  root.userData.pitComplex=pitComplex.layout;root.userData.pitClockController=pitComplex.clockController;root.userData.pitColliders=pitComplex.colliders;
  // Rendering, full-footprint safety checks and ground collision share one
  // authoring manifest. In particular the last stand is OUTSIDE Alboreto.
  const standLayouts=createStandLayouts(track);
  root.userData.stands=standLayouts;
  for(const layout of standLayouts)grandstand(root,layout);
  // Finish gantry and the five individually addressable start lights.
  const gantry=new THREE.Group();gantry.name='start-gantry';gantry.position.z=MONZA_PIT_LAYOUT.gantryZ-92;root.add(gantry);
  // The pit-side support sits in the gap after the final strategy room.
  // Move the complete gantry, lamps and banner together, clear of its roof.
  for(const x of [-99,-70])box(gantry,x,5.4,92,.65,10.8,.65,palette.teal);
  box(gantry,-84.55,10.3,92,29.9,1.5,1.3,palette.cream);
  const banner=sign('MONZA  •  TEMPLE OF SPEED',26,1.25);banner.position.set(-85,10.3,92.67);gantry.add(banner);
  box(gantry,-85,8.7,92,10.8,2.1,1.35,palette.navy);
  for(let i=0;i<5;i++){
    const lm=new THREE.MeshStandardMaterial({color:0x542827,emissive:0xee382e,emissiveIntensity:.05,roughness:.3});
    for(let row=0;row<2;row++){
      const bulb=new THREE.Mesh(new THREE.SphereGeometry(.36,12,8),row===0?lm:lm.clone());
      bulb.scale.z=.28;bulb.position.set(-89+i*2,8.3+row*.8,92.76);bulb.name=row===0?`start-light-${i}`:`start-light-secondary-${i}`;gantry.add(bulb);
    }
  }
  const historicConnection=createHistoricConnectionLayout(track),historicSouthConnection=createHistoricSouthConnectionLayout(track);
  const connections=[historicConnection,historicSouthConnection];
  const marshalPosts=createMonzaMarshalLayouts(track,{excluded:(x,z)=>connections.some(layout=>distanceToHistoricConnection(x,z,layout)<3.05)});
  root.userData.marshalPosts=marshalPosts;
  // Move each complete roof and corner label together, not just its walls.
  for(const post of marshalPosts){
    const hut=new THREE.Group();hut.name=post.id;root.add(hut);
    box(hut,post.x,1.6,post.z,4.4,3.2,4.4,palette.cream);box(hut,post.x,3.4,post.z,5.5,.45,5.5,palette.coral);
    const label=sign(post.name.split(' · ')[0].toUpperCase(),12,2.4);label.position.set(post.x,6,post.z);label.rotation.y=post.yaw;hut.add(label);scaleArchitectureHeight(hut);
  }
  const brakingBoards=createBrakingBoards(track);root.userData.brakingBoards=brakingBoards;
  for(const layout of brakingBoards){
    const board=sign(layout.label,2.2,2.8,'#23483f','#f5f0db');board.name=`braking-board-${layout.id}`;
    board.position.set(layout.x,1.7,layout.z);board.rotation.y=layout.yaw;root.add(board);
    box(root,layout.x,.65,layout.z,.14,1.3,.14,palette.teal);
  }
  // Scenery-only 1955 banking retains the real north/GP underpass relationship.
  const bridge=track.sampleAt(track.corners[5].distance-8),historicOval=createHistoricOvalLayout(track);
  addMonzaHistoricOval(root,track,historicOval);
  addMonzaHistoricConnection(root,track,historicConnection);
  addMonzaHistoricSouthConnection(root,track,historicSouthConnection);
  root.userData.landmarks=[
    {id:'pit-building',name:'Palazzina Box / Race Club',x:pitComplex.layout.boxes.x,z:32,width:18,length:165,height:16.1,reference:pitComplex.layout.reference,artistic:'Twelve shortened garage bays with upper Race Club glazing, segmented roof, apron workstations and service circulation; brochure pp.5–9/16 and user pitlane photographs.'},
    {id:'hospitality-tower',name:'Tower Hospitality',x:pitComplex.layout.towers[1].x,z:pitComplex.layout.towers[1].z,height:20.8,reference:pitComplex.layout.reference,artistic:'Two independent straight-end towers with glazed viewing floors and pilotis; placement compressed from the official hospitality diagram.'},
    {id:'fans-club',name:'Fans Club',x:pitComplex.layout.clubs[1].x,z:105,height:16.3,reference:pitComplex.layout.reference,artistic:'Curved glazed corner of the pit building, distinct from the freestanding towers.'},
    {id:'pit-lane',name:'Pit lane',x:-63,z:34,width:12,length:260},
    {id:'centrale',name:'Tribuna Centrale',x:standLayouts[0].x,z:standLayouts[0].z,reference:'Monza official grandstand map, opposite the pit building'},
    {id:'podium',name:'Podio',x:-53+MONZA_PIT_LAYOUT.buildingOffsetX,z:60,width:6,length:15.3,height:7.6,artistic:'Compressed cantilevered podium with Italian tricolour accents.'},
    {id:'race-control',name:'Direzione Gara',x:-50.8+MONZA_PIT_LAYOUT.buildingOffsetX,z:84,width:5.9,length:12.4,height:9.6,artistic:'Interpretive miniature glazed control balcony above the garage apron; not a claim of a planned new control building being complete.'},
    {id:'pit-clock',name:'RIOLEX pit entry clock',x:-63,z:124,width:24,length:.85,height:10.3,reference:pitComplex.layout.reference,artistic:'User-reference green clock bridge, with a fictional RIOLEX wordmark, live analog hands; vertical scaling keeps the doorways and under-beam clearance consistent.'},
    {id:'historic-banking',name:'Sopraelevata / Serraglio',x:bridge.point.x,z:bridge.point.z,reference:historicOval.references[0],artistic:historicOval.artistic},
  ];
  for(const landmark of root.userData.landmarks)if(typeof landmark.height==='number')landmark.height*=ARCHITECTURE_HEIGHT_SCALE;
  root.userData.architecture={heightScale:ARCHITECTURE_HEIGHT_SCALE,footprintsPreserved:true};
  const circuitProps=addCircuitSurroundings(root,track);
  const backgroundLandmarks=addMonzaLandmarks(root,track);
  const tracksideSafety=addTracksideSafety(root,track);
  root.userData.landmarks.push(
    {id:'paddock-service-row',name:'Paddock transporters and service access',x:-9,z:-8,artistic:'Four parked transporters and awnings replace generic blocks; access sequence follows FIA pit/service relationships, not the 2025 garage order.'},
    {id:'fan-courtyard',name:'Circuit shop / cafe / park access',x:-147,z:117,reference:'Official hospitality brochure: shops and food trucks outside the paddocks',artistic:'Miniature visitor courtyard in the gap behind the start-straight stands; not a surveyed Fangio-statue or Roccolo location.'},
    {id:'broadcast-screen',name:'Centrale video screen',x:-43,z:-68,artistic:'Compressed venue screen facing the main grandstand, outside the pit exit.'},
  );
  // Deterministic planted park. Instancing keeps the full miniature inexpensive.
  let seed=51234;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const locations:{x:number;z:number;s:number;color:THREE.Color}[]=[];
  for(let attempts=0;attempts<7000&&locations.length<620;attempts++){
    const x=-213+random()*550,z=-410+random()*735;
    if(x>-154&&x<20&&z>-120&&z<215)continue;
    const s=track.nearest(x,z);if(Math.hypot(x-s.point.x,z-s.point.z)<34)continue;
    if(x>40&&x<120&&z>-35&&z<70)continue;
    if(circuitProps.some(prop=>Math.hypot(x-prop.x,z-prop.z)<Math.hypot(prop.width,prop.depth)/2+3.8))continue;
    if(backgroundLandmarks.some(layout=>landmarkTreeExclusion(x,z,layout,track)))continue;
    if(pitTreeExclusion(x,z,pitComplex.layout))continue;
    locations.push({x,z,s:.7+random()*.7,color:new THREE.Color().setHSL(.29+random()*.07,.23+random()*.12,.35+random()*.15)});
  }
  // Keep the established deterministic park. Only trees whose crowns would
  // enter a service bay or the enlarged grandstands move to a nearby clear spot.
  let relocated=0,relocatedForStands=0,relocatedForServices=0,relocatedForHistoric=0,resampledForFacilities=0;
  let relocationSeed=791906;
  const relocationRandom=()=>{relocationSeed=(Math.imul(relocationSeed,1664525)+1013904223)>>>0;return relocationSeed/4294967296;};
  const standTreeExclusion=(x:number,z:number)=>standLayouts.some(stand=>distanceToStand(x,z,stand)<7);
  const treeClear=(x:number,z:number)=>{
    const near=track.nearest(x,z);
    return !(x>-154&&x<20&&z>-120&&z<215)&&!(x>40&&x<120&&z>-35&&z<70)
      &&Math.hypot(x-near.point.x,z-near.point.z)>=34
      &&!circuitProps.some(prop=>Math.hypot(x-prop.x,z-prop.z)<Math.hypot(prop.width,prop.depth)/2+3.8)
      &&!backgroundLandmarks.some(layout=>landmarkTreeExclusion(x,z,layout,track))
      &&!pitTreeExclusion(x,z,pitComplex.layout)&&!tracksideTreeExclusion(x,z,tracksideSafety)&&!standTreeExclusion(x,z)
      &&!historicOvalTreeExclusion(x,z,historicOval)&&connections.every(layout=>!historicConnectionTreeExclusion(x,z,layout))
      &&marshalPosts.every(post=>distanceToMarshalPost(x,z,post)>7);
  };
  for(const location of locations){
    const standConflict=standTreeExclusion(location.x,location.z),serviceConflict=tracksideTreeExclusion(location.x,location.z,tracksideSafety),historicConflict=historicOvalTreeExclusion(location.x,location.z,historicOval)||connections.some(layout=>historicConnectionTreeExclusion(location.x,location.z,layout))||marshalPosts.some(post=>distanceToMarshalPost(location.x,location.z,post)<=7);
    if(!standConflict&&!serviceConflict&&!historicConflict)continue;
    let moved=false;
    for(const radius of [10,16,24,32,45,64,90,128])for(let i=0;i<16;i++){
      if(moved)continue;const angle=i*Math.PI/8,x=location.x+Math.cos(angle)*radius,z=location.z+Math.sin(angle)*radius;
      if(x>=-213&&x<=337&&z>=-410&&z<=325&&treeClear(x,z)){location.x=x;location.z=z;moved=true;relocated++;if(standConflict)relocatedForStands++;if(serviceConflict)relocatedForServices++;if(historicConflict)relocatedForHistoric++;}
    }
    // With twenty-one stands a few trees cannot find a local gap. A separate
    // seeded resample keeps all 620 crowns, all four silhouettes and every
    // facility exclusion without moving unrelated original trees.
    if(!moved)for(let attempt=0;attempt<4000;attempt++){
      const x=-213+relocationRandom()*550,z=-410+relocationRandom()*735;
      if(treeClear(x,z)){
        location.x=x;location.z=z;moved=true;relocated++;resampledForFacilities++;
        if(standConflict)relocatedForStands++;if(serviceConflict)relocatedForServices++;if(historicConflict)relocatedForHistoric++;break;
      }
    }
    if(!moved)throw new Error('Cannot safely relocate a facility tree');
  }
  addMonzaForest(root,locations);Object.assign(root.userData.forest,{relocatedForFacilities:relocated,relocatedForStands,relocatedForServices,relocatedForHistoric,resampledForFacilities,
    facilityClearance:7,locations:locations.map(({x,z,s})=>({x,z,s}))});
  root.userData.grandstands={count:standLayouts.length,spectators:root.children.filter(g=>g.name.startsWith('grandstand-')).reduce((sum,g)=>sum+g.userData.spectators,0),crowdDrawsPerVisibleStand:2,artistic:'Twenty-one authored Monza park stands. The original seven anchors are preserved; fourteen added stands are not claims of actual venue positions.'};
  batchStaticScenery(root);
  // These objects never move. Crowd/tree LOD still changes visibility, while
  // static world matrices and scenery shadow draws need no per-frame updates.
  root.updateMatrixWorld(true);
  root.traverse(object=>{object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;if(object instanceof THREE.Mesh)object.castShadow=false;});
  return root;
}
