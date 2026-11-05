import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {batchStaticChildren} from './render-batches';

interface FixtureBounds {id:string;minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}
type Finish='paint'|'metal'|'rubber';
interface TeamControl {accent:THREE.MeshStandardMaterial;dark:THREE.MeshStandardMaterial;updateAtlas:(color:THREE.Color,name:string)=>void}
const teamControls=new WeakMap<THREE.Group,TeamControl>();

/** Recolour the review set with the same selection as the imported race car. */
export function updatePitStopStageTeam(stage:THREE.Group,color:THREE.ColorRepresentation,name:string):void {
  const control=teamControls.get(stage);if(!control)return;
  const accent=new THREE.Color(color);control.accent.color.copy(accent);control.dark.color.copy(accent).multiplyScalar(.59);
  control.updateAtlas(accent,name);
  Object.assign(stage.userData.pitStage,{teamName:name,color:`#${accent.getHexString()}`});
}

/** An open, camera-friendly miniature service bay for animation review.
 * The central work zone belongs entirely to the animated car and its crew.
 * Everything is authored geometry or a local canvas atlas; no remote assets. */
export function createPitStopStage():THREE.Group {
  const root=new THREE.Group();root.name='pit-stop-review-stage';
  // The car and parking marks remain +Z forward. Only the garage and its
  // service furniture turn: the open door now faces the car's -X sidepod.
  const garage=new THREE.Group();garage.name='pit-stop-side-facing-garage';garage.rotation.y=Math.PI/2;root.add(garage);
  const palette={floor:0xd6d8d1,edge:0xf1eee3,wall:0xe9e8df,red:0xc62b30,
    redDark:0x8e232b,ink:0x253a3b,steel:0x8e9b9c,dark:0x263131,yellow:0xe7b83b};
  const materials=new Map<string,THREE.MeshStandardMaterial>();
  const fixtures:FixtureBounds[]=[];
  const fixtureGroups:THREE.Group[]=[];
  const mat=(color:number,finish:Finish='paint')=>{
    const key=`${color}/${finish}`;let value=materials.get(key);
    if(!value){value=new THREE.MeshStandardMaterial({color,roughness:finish==='metal'?.34:finish==='rubber'?.92:.61,metalness:finish==='metal'?.58:.05});value.name=`pit-stage-${key}`;materials.set(key,value);}
    return value;
  };
  const add=(p:THREE.Object3D,g:THREE.BufferGeometry,x:number,y:number,z:number,color:number,finish:Finish='paint',shadow=true)=>{
    const m=new THREE.Mesh(g,mat(color,finish));m.position.set(x,y,z);m.castShadow=shadow;m.receiveShadow=true;p.add(m);return m;
  };
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number,radius=0,finish:Finish='paint',shadow=true)=>
    add(p,radius?new RoundedBoxGeometry(w,h,d,2,Math.min(radius,w/2,h/2,d/2)):new THREE.BoxGeometry(w,h,d),x,y,z,color,finish,shadow);
  const cyl=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,finish:Finish='metal',segments=12)=>
    add(p,new THREE.CylinderGeometry(r,r,h,segments),x,y,z,color,finish);
  const rod=(p:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,r:number,color:number,finish:Finish='metal')=>{
    const delta=b.clone().sub(a),m=cyl(p,0,0,0,r,delta.length(),color,finish,8);
    m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;
  };
  const fixture=(id:string,builder:(g:THREE.Group)=>void)=>{
    const g=new THREE.Group();g.name=id;builder(g);garage.add(g);
    // Move the furniture, rather than narrowing the crew or wheel paths. The
    // offsets are in garage-local X and become world Z after the quarter turn.
    if(id==='left-tool-trolley')g.position.x=-.9;
    if(id==='right-air-compressor')g.position.x=.35;
    fixtureGroups.push(g);return g;
  };

  // A shallow moulded display plinth with an independent, flush work surface.
  box(root,0,-.23,-.3,22,.42,19,palette.edge,.16,'paint',false);
  box(root,0,-.035,-.3,21.64,.07,18.64,palette.floor,.032,'paint',false);
  box(root,0,-.31,8.94,17.9,.075,.025,palette.red,0,'paint',false);
  for(let x=-9;x<=9;x+=3)box(root,x,.002,-.3,.009,.003,18.2,0xbfc5bf,0,'paint',false);
  for(let z=-7.8;z<=8;z+=3)box(root,0,.002,z,21.2,.003,.009,0xbfc5bf,0,'paint',false);
  // Paint is the only static content inside the crew's animation area.
  for(const side of [-1,1]){
    box(root,side*1.58,.009,0,.038,.009,5.8,palette.yellow,0,'paint',false);
    for(const z of [-2.9,2.9])box(root,side*1.12,.009,z,.94,.009,.038,palette.yellow,0,'paint',false);
    box(root,side*1.28,.01,1.5,.64,.012,.11,0xf2efe2,0,'paint',false);
  }
  box(root,0,.011,2.9,1.13,.012,.055,palette.yellow,0,'paint',false);
  box(root,0,.011,3.16,.055,.012,.35,palette.yellow,0,'paint',false);

  fixture('garage-back-and-open-door',g=>{
    box(g,0,2.2,-7.88,16.8,4.4,.32,palette.wall,.05);
    box(g,0,.37,-7.65,16.35,.72,.18,palette.ink,.035);
    box(g,0,3.48,-7.63,16.35,.055,.06,palette.red,0,'paint',false);
    for(const x of [-7.06,7.06]){
      box(g,x,2.24,-6.22,.29,4.48,.34,palette.steel,.035,'metal');
      box(g,x,.38,-6.22,.48,.76,.51,palette.ink,.055);
      box(g,x,2.18,-6.003,.055,2.85,.024,0xc8d1ce,0,'metal');
    }
    box(g,0,4.12,-6.19,14.45,.69,.44,palette.red,.08);
    box(g,0,3.73,-6.15,13.85,.06,.21,palette.ink,.02);
    box(g,0,4.72,-6.23,15.15,.16,.97,palette.edge,.055);
    const roller=cyl(g,0,4.48,-6.43,.19,13.82,0xc0c8c4,'metal',14);roller.rotation.z=Math.PI/2;
    for(let x=-6.6;x<=6.7;x+=.55){const band=cyl(g,x,4.48,-6.43,.193,.022,0x8e9894,'metal',14);band.rotation.z=Math.PI/2;}
    box(g,7.19,4.48,-6.43,.43,.46,.46,palette.ink,.055);
    // The top is deliberately open so the overhead review camera sees every wheel.
    for(const x of [-5.25,0,5.25]){
      box(g,x,4.4,-5.99,3.7,.09,.27,palette.ink,.025);
      box(g,x,4.34,-5.98,3.48,.025,.17,0xfff4cd,.009,'paint',false);
    }
    for(const side of [-1,1]){
      box(g,side*7.57,1.29,-7.03,1.13,2.58,1.47,palette.edge,.055);
      box(g,side*7.57,2.48,-7.03,1.18,.13,1.56,palette.red,.032);
    }
  });

  fixture('rear-strategy-workbench',g=>{
    box(g,0,1.06,-6.91,5.52,.14,.91,palette.steel,.045,'metal');
    for(const x of [-2.38,2.38])box(g,x,.5,-6.91,.16,1.0,.67,palette.ink,.025,'metal');
    box(g,0,.58,-7.08,4.96,.72,.11,palette.redDark,.035);
    for(const x of [-1.32,1.32]){
      box(g,x,1.17,-6.96,.43,.075,.3,palette.dark,.025,'metal');
      box(g,x,1.43,-7.13,.065,.55,.09,palette.dark,0,'metal');
      box(g,x,1.88,-7.1,2.2,1.17,.12,palette.dark,.045);
      box(g,x,1.146,-6.62,1.1,.035,.31,0x323e3e,.015);
      for(let row=0;row<3;row++)for(let col=0;col<11;col++)box(g,x-.46+col*.09,1.168,-6.72+row*.075,.065,.008,.046,0x8c9b97,0,'paint',false);
      box(g,x+.72,1.16,-6.62,.13,.045,.21,palette.dark,.02);
    }
    for(const x of [-3.51,3.51]){
      box(g,x,.77,-7.13,1.02,1.54,.87,palette.edge,.055);
      for(let i=0;i<5;i++){
        box(g,x,.25+i*.265,-6.679,.89,.225,.027,palette.red,.01);
        box(g,x,.28+i*.265,-6.65,.49,.025,.025,palette.steel,.009,'metal',false);
      }
    }
  });

  fixture('left-tool-trolley',g=>{
    box(g,-5.44,.69,-3.71,1.25,1.08,.76,palette.red,.08);
    box(g,-5.44,1.27,-3.71,1.36,.13,.86,palette.steel,.045,'metal');
    for(let i=0;i<5;i++){
      box(g,-5.44,.31+i*.19,-3.316,1.09,.16,.025,palette.redDark,.01);
      box(g,-5.44,.34+i*.19,-3.292,.67,.025,.025,0xc0c9c5,.008,'metal');
    }
    for(const x of [-5.91,-4.97])for(const z of [-3.95,-3.47]){
      const wheel=cyl(g,x,.11,z,.105,.075,palette.dark,'rubber',10);wheel.rotation.z=Math.PI/2;
    }
    rod(g,new THREE.Vector3(-6.08,1.13,-3.94),new THREE.Vector3(-6.08,1.13,-3.47),.037,palette.ink);
    box(g,-5.43,1.37,-3.8,.58,.11,.37,palette.dark,.035);
    for(let i=0;i<4;i++)box(g,-5.62+i*.13,1.435,-3.8,.06,.03,.23,palette.steel,.012,'metal');
  });

  fixture('right-air-compressor',g=>{
    const tank=cyl(g,5.41,.47,-4.04,.29,1.31,palette.red,'paint',16);tank.rotation.x=Math.PI/2;
    for(const z of [-4.43,-3.65])for(const x of [5.18,5.64])box(g,x,.14,z,.12,.28,.13,palette.ink,.035);
    box(g,5.41,.84,-4.18,.63,.31,.56,palette.dark,.04);
    for(let i=0;i<6;i++)box(g,5.12+i*.116,.86,-3.875,.033,.21,.035,palette.steel,0,'metal');
    const gauge=cyl(g,5.42,.85,-3.55,.13,.07,0xb6c3bd,'metal',16);gauge.rotation.x=Math.PI/2;
    const dial=cyl(g,5.42,.85,-3.508,.107,.012,palette.edge,'paint',16);dial.rotation.x=Math.PI/2;
    rod(g,new THREE.Vector3(5.42,.85,-3.493),new THREE.Vector3(5.46,.918,-3.493),.009,palette.dark);
    const points:THREE.Vector3[]=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI*10;points.push(new THREE.Vector3(6.16+Math.sin(a)*.20,.20+i/100*.26,-3.91+Math.cos(a)*.20));}
    add(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),90,.021,5,false),0,0,0,0x3a667c,'rubber');
    rod(g,new THREE.Vector3(5.7,.68,-3.55),new THREE.Vector3(6.13,.44,-3.71),.025,0x3a667c,'rubber');
  });

  fixture('rear-empty-spare-rack',g=>{
    for(const x of [-5.44,-4.63])for(const z of [-7.36,-6.39])box(g,x,1.01,z,.055,2.02,.055,palette.ink,.012,'metal');
    for(const y of [.19,1.02,1.91])for(const z of [-7.36,-6.39])rod(g,new THREE.Vector3(-5.44,y,z),new THREE.Vector3(-4.63,y,z),.034,palette.steel);
    for(const x of [-5.44,-4.63])for(const y of [.19,1.02,1.91])rod(g,new THREE.Vector3(x,y,-7.36),new THREE.Vector3(x,y,-6.39),.034,palette.steel);
    // Empty cradles reserve storage without duplicating the rig's eight wheels.
    for(const y of [.2,1.03])for(const x of [-5.24,-4.83])rod(g,new THREE.Vector3(x,y,-7.36),new THREE.Vector3(x,y,-6.39),.024,palette.steel);
  });

  fixture('right-fire-extinguisher',g=>{
    cyl(g,6.68,.43,-2.84,.15,.72,0xd03a35,'paint',14);
    cyl(g,6.68,.81,-2.84,.10,.08,palette.steel,'metal',12);
    box(g,6.68,.91,-2.84,.2,.055,.11,palette.ink,.015,'metal');
    box(g,6.68,.48,-2.688,.18,.22,.015,palette.edge,.01,'paint',false);
    rod(g,new THREE.Vector3(6.79,.86,-2.84),new THREE.Vector3(6.9,.35,-2.84),.027,palette.dark,'rubber');
    box(g,6.68,.055,-2.84,.45,.07,.42,palette.dark,.025);
  });

  fixture('retracted-overhead-service-lines',g=>{
    for(const side of [-1,1]){
      rod(g,new THREE.Vector3(side*5.75,3.73,-6.18),new THREE.Vector3(side*5.75,3.15,-5.35),.023,palette.dark,'rubber');
      const points:THREE.Vector3[]=[];for(let i=0;i<=70;i++){const a=i/70*Math.PI*10;points.push(new THREE.Vector3(side*5.75+Math.cos(a)*.08,3.15-i/70*.98,-5.35+Math.sin(a)*.08));}
      add(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),70,.016,5,false),0,0,0,palette.yellow,'rubber');
      box(g,side*5.75,2.1,-5.35,.13,.21,.11,palette.dark,.025,'metal');
    }
  });

  const canvas=typeof document==='undefined'?undefined:document.createElement('canvas');
  if(canvas){canvas.width=canvas.height=1024;}
  const ctx=canvas?.getContext('2d')??undefined;
  let labelRow=0;
  const map=canvas?new THREE.CanvasTexture(canvas):undefined;
  if(map){map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;map.name='pit-stop-local-display-atlas';}
  const displayMaterial=new THREE.MeshBasicMaterial({map:map??null,color:map?0xffffff:0xd8dfd8});
  displayMaterial.name='pit-stop-authored-label-and-monitor-atlas';
  const quad=(x:number,y:number,z:number,w:number,h:number,left:number,top:number,width:number,height:number)=>{
    const geometry=new THREE.PlaneGeometry(w,h),uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++){uv.setX(i,(left+uv.getX(i)*width)/1024);uv.setY(i,1-(top+(1-uv.getY(i))*height)/1024);}
    const m=new THREE.Mesh(geometry,displayMaterial);m.position.set(x,y,z);garage.add(m);return m;
  };
  const label=(text:string,x:number,y:number,z:number,w:number,h:number,bg='#c62b30',fg='#fff7e3')=>{
    const top=labelRow++*64;if(ctx){ctx.fillStyle=bg;ctx.fillRect(0,top,1024,64);ctx.fillStyle=fg;ctx.font='700 43px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,top+33,968);}
    return quad(x,y,z,w,h,0,top,1024,64);
  };
  const doorFascia=label('P O C K E T  P A D D O C K',0,4.12,-5.954,9.4,.41);
  // Keep one genuine visible door surface measurable after static batching.
  // The clone shares the mutable atlas, but its unique material retains name.
  doorFascia.name='pit-stop-garage-door-fascia';doorFascia.material=displayMaterial.clone();
  label('V2',-6.21,4.12,-5.951,.58,.45,'#f0eee1','#8e232b');
  label('FERRARI  /  PIT CREW',0,3.22,-7.697,6.9,.24,'#e9e8df','#253a3b');
  label('TOOLS',-6.34,.96,-3.296,.63,.10,'#8e232b');
  label('SERVICE',5.77,.48,-3.351,.61,.13,'#c62b30');
  label('SPARES',-5.035,2.02,-6.354,.75,.14,'#253a3b');
  // Two entirely authored telemetry screens share the same label texture.
  for(const [index,x]of [-1.32,1.32].entries()){
    const left=index*512,top=768;
    if(ctx){
      ctx.fillStyle='#112a30';ctx.fillRect(left,top,512,256);ctx.textAlign='left';ctx.textBaseline='alphabetic';
      ctx.fillStyle='#dce9df';ctx.font='bold 25px monospace';ctx.fillText(index?'TYRE / SERVICE':'PIT WALL / 16',left+24,top+36);
      ctx.fillStyle='#e9c35d';ctx.font='bold 41px monospace';ctx.fillText(index?'READY':'00:00.000',left+24,top+89);
      for(let row=0;row<4;row++){
        ctx.fillStyle='#334a4c';ctx.fillRect(left+24,top+115+row*27,464,13);
        ctx.fillStyle=row%2?'#bfcfb1':'#da5b56';ctx.fillRect(left+24,top+115+row*27,170+row*65,13);
      }
      ctx.fillStyle='#b7cbc4';ctx.font='15px monospace';ctx.fillText('POCKET / AUTHORING PREVIEW V2',left+24,top+244);
    }
    quad(x,1.88,-7.034,2.04,1.015,left,top,512,256);
  }
  if(map)map.needsUpdate=true;

  teamControls.set(root,{accent:mat(palette.red),dark:mat(palette.redDark),updateAtlas:(accent,name)=>{
    if(!ctx)return;
    const hex=`#${accent.getHexString()}`,dark=`#${accent.clone().multiplyScalar(.59).getHexString()}`;
    const bright=accent.r*.2126+accent.g*.7152+accent.b*.0722>.44;
    const draw=(row:number,text:string,bg:string,fg:string)=>{
      ctx.fillStyle=bg;ctx.fillRect(0,row*64,1024,64);ctx.fillStyle=fg;ctx.font='700 43px Arial, sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,row*64+33,968);
    };
    draw(0,'P O C K E T  P A D D O C K',hex,bright?'#173b36':'#fff7e3');
    draw(2,`${name.toUpperCase()}  /  PIT CREW`,'#e9e8df','#253a3b');
    draw(3,'TOOLS',dark,'#fff7e3');draw(4,'SERVICE',hex,bright?'#173b36':'#fff7e3');
    if(map)map.needsUpdate=true;
  }});

  // Flatten static fixtures before material batching, retaining distinct paint,
  // metal and rubber response instead of baking everything into one rough mesh.
  root.updateWorldMatrix(true,true);
  for(const g of fixtureGroups){const b=new THREE.Box3().setFromObject(g,true);fixtures.push({id:g.name,minX:b.min.x,maxX:b.max.x,minY:b.min.y,maxY:b.max.y,minZ:b.min.z,maxZ:b.max.z});}
  const meshes:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
  for(const mesh of meshes)if(mesh.parent!==root)root.attach(mesh);
  for(const mesh of meshes){
    // Bake the completed world orientation into real vertex positions/normals.
    // Neither callers nor diagnostics need to apply a hidden stage rotation.
    mesh.updateMatrix();mesh.geometry.applyMatrix4(mesh.matrix);mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);mesh.updateMatrix();
  }
  const emptyGroups:THREE.Group[]=[];root.traverse(o=>{if(o instanceof THREE.Group&&o!==root)emptyGroups.push(o);});
  for(const group of emptyGroups.reverse())if(group.children.length===0)group.removeFromParent();
  batchStaticChildren(root);
  for(const child of root.children)if(child instanceof THREE.Mesh){
    if(child.material===mat(palette.yellow))child.name='pit-stop-parking-frame';
    if(child.material===mat(0xf2efe2))child.name='pit-stop-front-wheel-markers';
  }
  let triangles=0,drawCalls=0;root.traverse(o=>{if(o instanceof THREE.Mesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;drawCalls++;}});
  const b=new THREE.Box3().setFromObject(root);
  root.userData.pitStage={version:2,teamName:'Ferrari',color:'#c62b30',label:'Side-facing miniature service bay V2',
    garageDoor:{center:{x:-6.2,y:2.1,z:0},facing:{x:1,y:0,z:0},fasciaObjectName:'pit-stop-garage-door-fascia',surfaceX:-5.954},
    carForward:{x:0,z:1},sidepodDirection:{x:-1,z:0},parkingForward:{x:0,z:1},
    parkingFrameObjectName:'pit-stop-parking-frame',frontWheelMarkersObjectName:'pit-stop-front-wheel-markers',
    actionClearance:{minX:-5,maxX:5,minZ:-5,maxZ:5},
    fixtures,groundY:0,geometry:{triangles,drawCalls},
    bounds:{min:b.min.toArray(),max:b.max.toArray()},
    displayData:'Authored decorative screens, no live timing feed',
    materials:'Locally generated atlas and procedural geometry; no downloaded textures',
    artistic:'An open miniature review set, not a measured reconstruction of a real team garage.'};
  return root;
}
