import * as THREE from 'three';
import { Track } from './track';
import { createStandLayouts, createBrakingBoards, type StandLayout } from './stand-layout';
import { batchStaticScenery, coloredGeometry } from './render-batches';

const palette={cream:0xf2eddc,teal:0x24564e,mint:0x86b7a0,coral:0xe87a61,navy:0x263c40,yellow:0xf2ca6d};
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
function addCrowd(parent:THREE.Group,width:number,rows:number){
  if(!crowdShapes){
    const clothes=coloredGeometry([
      {geometry:new THREE.BoxGeometry(.48,.65,.38),color:0xffffff},
      {geometry:new THREE.SphereGeometry(.235,6,3,0,Math.PI*2,0,Math.PI/2).translate(0,.51,0),color:0xffffff},
    ]);
    const parts=coloredGeometry([
      {geometry:new THREE.IcosahedronGeometry(.21,0).translate(0,.51,0),color:0xf1d0ab},
      {geometry:new THREE.BoxGeometry(.32,.045,.2).translate(0,.60,-.20),color:palette.navy},
      {geometry:new THREE.BoxGeometry(.16,.065,.065).translate(0,.52,-.205),color:palette.navy},
      {geometry:new THREE.BoxGeometry(.59,.48,.12).translate(0,-.03,.29),color:palette.teal},
      {geometry:new THREE.BoxGeometry(.59,.1,.58).translate(0,-.3,.03),color:palette.teal},
    ]);
    // Beyond 85 units a person's face is subpixel; retain a coloured seated
    // body and head rather than drawing all the cap, face and chair triangles.
    crowdShapes=[{clothes,parts},{
      clothes:new THREE.BoxGeometry(.48,.65,.38),
      parts:coloredGeometry([{geometry:new THREE.OctahedronGeometry(.23,0).translate(0,.51,0),color:0xf1d0ab}]),
    }];
  }
  const lod=new THREE.LOD(),centerZ=rows*1.75/2;lod.name='spectator-lod';lod.position.z=centerZ;
  const capacity=Math.floor(width/1.5)*rows,o=new THREE.Object3D();
  const colors=[palette.coral,palette.teal,palette.yellow,0xd8e4da,0x84a7bc,0xffffff];
  for(let level=0;level<crowdShapes.length;level++){
    const shape=crowdShapes[level],group=new THREE.Group();
    const clothes=new THREE.InstancedMesh(shape.clothes,crowdClothesMaterial,capacity);
    const parts=new THREE.InstancedMesh(shape.parts,crowdPartsMaterial,capacity);let index=0;
    for(let row=0;row<rows;row++)for(let col=0;col<Math.floor(width/1.5);col++){
      if((col+row*7)%11===0)continue;
      o.position.set(-width/2+.8+col*1.5,2.06+row*.68,row*1.75+.2-centerZ);o.updateMatrix();
      clothes.setMatrixAt(index,o.matrix);clothes.setColorAt(index,new THREE.Color(colors[(col*3+row*7)%colors.length]));
      parts.setMatrixAt(index,o.matrix);index++;
    }
    clothes.count=parts.count=index;clothes.computeBoundingSphere();parts.computeBoundingSphere();
    group.add(clothes,parts);lod.addLevel(group,level===0?0:85,.12);
  }
  lod.addLevel(new THREE.Group(),245,.1);parent.add(lod);
}

function addForest(root:THREE.Group,locations:{x:number;z:number;s:number;color:THREE.Color}[]){
  const shapes=[coloredGeometry([
    {geometry:new THREE.CylinderGeometry(.35,.55,4.5,6).translate(0,2,0),color:0x997c59},
    {geometry:new THREE.IcosahedronGeometry(3.3,0).scale(1,1.25,1).translate(0,6,0),color:0x6e9268},
    {geometry:new THREE.IcosahedronGeometry(2.5,0).scale(.8,1,.8).translate(1.2,8.5,.5),color:0x8caa79},
  ]),coloredGeometry([
    {geometry:new THREE.CylinderGeometry(.36,.55,4.5,4).translate(0,2,0),color:0x997c59},
    {geometry:new THREE.OctahedronGeometry(4,0).scale(1,1.2,1).translate(.3,6.7,0),color:0x7d9d70},
  ])];
  const treeMaterial=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true});
  const cells=new Map<string,typeof locations>();const size=92;
  for(const p of locations){const key=`${Math.floor(p.x/size)},${Math.floor(p.z/size)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(p);}
  const o=new THREE.Object3D();
  for(const [key,trees] of cells){
    const [cx,cz]=key.split(',').map(Number),x=(cx+.5)*size,z=(cz+.5)*size;
    const lod=new THREE.LOD();lod.name=`forest-cell-${key}`;lod.position.set(x,0,z);
    for(let level=0;level<shapes.length;level++){
      const mesh=new THREE.InstancedMesh(shapes[level],treeMaterial,trees.length);
      trees.forEach((p,i)=>{
        o.position.set(p.x-x,0,p.z-z);o.scale.setScalar(p.s);o.rotation.set(0,(p.x*13.7+p.z*3.8)%(Math.PI*2),0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);
        mesh.setColorAt(i,new THREE.Color().setScalar(.75+p.color.g*.5));
      });
      mesh.computeBoundingSphere();lod.addLevel(mesh,level===0?0:120,.12);
    }
    lod.addLevel(new THREE.Group(),340,.1);root.add(lod);
  }
  root.userData.treeCells=cells.size;root.userData.treeInstances=locations.length;
}
function grandstand(parent:THREE.Group,layout:StandLayout){
  const {x,z,yaw,width,rows,covered}=layout;
  const g=new THREE.Group();g.name=`grandstand-${layout.id}`;g.position.set(x,0,z);g.rotation.y=yaw;g.userData.layout=layout;parent.add(g);
  box(g,0,.7,5,width+2,1.3,15,palette.cream);
  for(let row=0;row<rows;row++){
    box(g,0,1.1+row*.68,row*1.75,width,.55,1.8,0xd6d9ca);
    box(g,0,1.6+row*.68,row*1.75+.4,width,.2,.8,row%2?palette.coral:palette.teal);
  }
  if(covered){
    for(const cx of [-width/2+2,width/2-2]){box(g,cx,5.6,9,.45,11,.45,palette.teal);box(g,cx,7.5,-1,.25,9,.25,palette.teal);}
    const roof=box(g,0,10.6,5,width+5,.55,18,palette.cream);roof.rotation.x=-.06;
    box(g,0,10.3,-4,width+5,.9,.3,palette.coral);
  }
  // Two draws per stand instead of six; local -Z still faces the road, with
  // forward cap brims/eyes and the seat back behind the spectator at +Z.
  addCrowd(g,width,rows);
  box(g,0,.8,-2.2,width+2,.28,.18,palette.teal);
  const label=sign('AUTODROMO  •  MONZA',width*.7,1.3);label.position.set(0,2,-2.3);label.rotation.y=Math.PI;g.add(label);
  return g;
}

export function createScenery(track:Track):THREE.Group {
  const root=new THREE.Group();root.name='Monza miniature paddock';
  const base=box(root,65,-3.1,-64,810,5.9,850,0x57816c);
  base.receiveShadow=true;
  const grass=box(root,65,-.24,-64,804,.35,844,0xa9c793);grass.castShadow=false;
  // Subtle park lawn islands break up broad flat color without textures or downloads.
  const lawnMaterial=material(0x9bbd86);
  for(const [x,z,w,d] of [[25,-60,65,135],[105,-180,40,65],[-175,-160,80,155],[190,80,110,125]]){
    const m=new THREE.Mesh(new THREE.CircleGeometry(1,40),lawnMaterial);m.rotation.x=-Math.PI/2;m.scale.set(w,d,1);m.position.set(x,-.052,z);m.receiveShadow=true;root.add(m);
  }
  // Pits are on the driver's right of the main straight; the stand faces them.
  const pit=new THREE.Group();pit.name='P房与围场';root.add(pit);
  box(pit,-45,.035,34,26,.1,190,0xb4b8a7);
  box(pit,-40,4.2,32,18,8.4,165,palette.cream);
  box(pit,-40,9.1,32,20,.75,169,palette.teal);
  box(pit,-40,11.5,32,18,4.1,165,palette.cream);
  // Upper paddock club glazing, with readable mullions rather than a plain block.
  box(pit,-49.12,11.7,32,.12,2.6,160,0x527e7a);
  for(let j=0;j<24;j++)box(pit,-49.3,11.7,-47+j*6.9,.25,3,.22,palette.cream);
  box(pit,-40,14,32,21,.7,170,palette.cream);
  const teamColors=[palette.coral,palette.teal,palette.yellow,0x6296ac,0xa080b3,0xdb8e62];
  for(let i=0;i<12;i++){
    const z=-43+i*13.2,color=teamColors[Math.floor(i/2)];
    box(pit,-49.25,3,z,.22,5.8,10.9,palette.navy);
    box(pit,-49.45,5.95,z,.4,.65,11.5,color);
    for(const pz of [z-5.7,z+5.7])box(pit,-49.6,3.1,pz,.55,6.2,.4,palette.cream);
    // Recess floor, strip lighting and workshop shelf visible from the lane.
    box(pit,-48.3,.15,z,3.3,.17,10.8,0x77817c);
    box(pit,-49.6,5.6,z,.35,.16,9.8,palette.cream);
    box(pit,-49.7,1.7,z+3.4,.6,1.5,2.1,0x6e8f87);
    box(pit,-53,.12,z,4.5,.16,10.6,color);
    for(const dz of [-5.3,5.3])box(pit,-55,.14,z+dz,7,.06,.14,palette.cream);
    // Pit crew: repeated toy silhouettes, safely beyond the driveable lane.
    for(let p=0;p<2;p++){
      const crew=new THREE.Group();crew.position.set(-52.5,0,z+(p?3:-3));
      box(crew,0,.95,0,.5,1.15,.4,color);
      const head=new THREE.Mesh(new THREE.SphereGeometry(.33,8,6),material(palette.cream));head.position.y=1.8;crew.add(head);
      for(const dx of [-.15,.15])box(crew,dx,.25,0,.19,.5,.28,palette.navy);
      pit.add(crew);
    }
    const number=sign(String(i+1).padStart(2,'0'),1.6,1.1);number.position.set(-49.9,7.25,z);number.rotation.y=-Math.PI/2;pit.add(number);
  }
  // Pit wall leaves the fast lane, garages and both entry/exit joins clear.
  box(pit,-73.8,.72,34,.7,1.45,218,palette.cream);
  box(pit,-73.8,1.52,34,.9,.16,218,palette.teal);
  for(let z=-64;z<132;z+=22){
    box(pit,-72.4,2.4,z,1,1.4,5.3,palette.teal);
    box(pit,-72.4,3.5,z,2.3,.3,6.1,palette.cream);
  }
  const pitTitle=sign('P O C K E T   P A D D O C K',90,3);pitTitle.rotation.y=-Math.PI/2;pitTitle.position.set(-49.55,12,32);pit.add(pitTitle);
  // Paddock hospitality trailers and service facilities behind the P building.
  for(let i=0;i<6;i++){
    const x=-14+(i%2)*17,z=-35+Math.floor(i/2)*57;
    box(pit,x,2.6,z,12,5.2,36,palette.cream);box(pit,x,5.5,z,13,.5,37,teamColors[i]);
    box(pit,x-6.1,3,z,.1,1.4,28,0x527e7a);
  }
  // Rendering, full-footprint safety checks and ground collision share one
  // authoring manifest. In particular the last stand is OUTSIDE Alboreto.
  const standLayouts=createStandLayouts(track);
  root.userData.stands=standLayouts;
  for(const layout of standLayouts)grandstand(root,layout);
  // Finish gantry and the five individually addressable start lights.
  const gantry=new THREE.Group();gantry.name='start-gantry';root.add(gantry);
  for(const x of [-99,-71])box(gantry,x,5.4,92,.65,10.8,.65,palette.teal);
  box(gantry,-85,10.3,92,29,1.5,1.3,palette.cream);
  const banner=sign('MONZA  •  TEMPLE OF SPEED',26,1.25);banner.position.set(-85,10.3,92.67);gantry.add(banner);
  box(gantry,-85,8.7,92,10.8,2.1,1.35,palette.navy);
  for(let i=0;i<5;i++){
    const lm=new THREE.MeshStandardMaterial({color:0x542827,emissive:0xee382e,emissiveIntensity:.05,roughness:.3});
    for(let row=0;row<2;row++){
      const bulb=new THREE.Mesh(new THREE.SphereGeometry(.36,12,8),row===0?lm:lm.clone());
      bulb.scale.z=.28;bulb.position.set(-89+i*2,8.3+row*.8,92.76);bulb.name=row===0?`start-light-${i}`:`start-light-secondary-${i}`;gantry.add(bulb);
    }
  }
  // Marshal posts, corner names and braking boards give useful driving references.
  for(let i=0;i<track.corners.length;i++){
    const c=track.corners[i],s=track.sampleAt(c.distance),o=s.point.clone().addScaledVector(s.right,29);
    box(root,o.x,1.6,o.z,4.4,3.2,4.4,palette.cream);box(root,o.x,3.4,o.z,5.5,.45,5.5,palette.coral);
    const label=sign(c.name.split(' · ')[0].toUpperCase(),12,2.4);label.position.copy(o).add(new THREE.Vector3(0,6,0));label.rotation.y=Math.atan2(-s.right.x,-s.right.z);root.add(label);
  }
  const brakingBoards=createBrakingBoards(track);root.userData.brakingBoards=brakingBoards;
  for(const layout of brakingBoards){
    const board=sign(layout.label,2.2,2.8,'#23483f','#f5f0db');board.name=`braking-board-${layout.id}`;
    board.position.set(layout.x,1.7,layout.z);board.rotation.y=layout.yaw;root.add(board);
    box(root,layout.x,.65,layout.z,.14,1.3,.14,palette.teal);
  }
  // The historic high-speed banking passes over Serraglio, as on the venue map.
  const bridge=track.sampleAt(track.corners[5].distance-8);const bg=new THREE.Group();bg.position.copy(bridge.point);bg.rotation.y=Math.atan2(bridge.tangent.x,bridge.tangent.z);root.add(bg);
  box(bg,0,9.8,0,78,1.1,11,0xc6c8b4);box(bg,0,10.6,-5.3,78,1.5,.4,0xb7bfae);box(bg,0,10.6,5.3,78,1.5,.4,0xb7bfae);
  for(const x of [-26,26]){box(bg,x,4.9,0,2,9.8,10,0xb3b7a5);box(bg,x,7.8,0,6,1.2,11,0xc6c8b4);}
  // Deterministic planted park. Instancing keeps the full miniature inexpensive.
  let seed=51234;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const locations:{x:number;z:number;s:number;color:THREE.Color}[]=[];
  for(let attempts=0;attempts<7000&&locations.length<620;attempts++){
    const x=-213+random()*550,z=-410+random()*735;
    if(x>-154&&x<20&&z>-120&&z<215)continue;
    const s=track.nearest(x,z);if(Math.hypot(x-s.point.x,z-s.point.z)<34)continue;
    if(x>40&&x<120&&z>-35&&z<70)continue;
    locations.push({x,z,s:.7+random()*.7,color:new THREE.Color().setHSL(.29+random()*.07,.23+random()*.12,.35+random()*.15)});
  }
  addForest(root,locations);
  batchStaticScenery(root);
  // These objects never move. Crowd/tree LOD still changes visibility, while
  // static world matrices and scenery shadow draws need no per-frame updates.
  root.updateMatrixWorld(true);
  root.traverse(object=>{object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;if(object instanceof THREE.Mesh)object.castShadow=false;});
  return root;
}
