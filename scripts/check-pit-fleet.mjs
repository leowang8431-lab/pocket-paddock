/** Browser QA of the shared player/AI GLBs and the reference-based pit complex.
 * Real input drives the short race. Inspection cameras only produce scene QA
 * images; this is not a complete-lap or physical-controller test. */
import {chromium} from '@playwright/test';
import {Color,LinearSRGBColorSpace} from 'three';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const url=process.env.PP_URL??'http://127.0.0.1:5173/';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/v08-pit-fleet');
const skipPit=process.env.PP_SKIP_PIT==='true';
const palettes=JSON.parse(await fs.readFile('public/models/palettes.json','utf8'));
const drivers=Object.fromEntries((await fs.readFile('public/models/helmets_index.csv','utf8')).trim().split(/\r?\n/).slice(1).map(line=>{
  const [name,number,team,file]=line.split(',');return[path.posix.basename(file,'.glb'),{team,name,number:Number(number)}];
}));
const hex=material=>`#${new Color().setRGB(...material.color.slice(0,3),LinearSRGBColorSpace).getHexString()}`;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(/\/models\/(car\.glb|helmet\.glb|palettes\.json)(?:[?#]|$)/.test(r.url()))requests.push(r.url());});
const snap=()=>page.evaluate(()=>window.__PP.snapshot());
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const clockHands=()=>page.evaluate(()=>{
 const clock=window.__PP.pitClock;
 return['hour','minute','second'].map(name=>{
  const pivot=clock?.[name];if(!pivot?.children[0])throw Error(`Missing actual ${name} hand mesh`);
  return{name,worldMatrix:pivot.children[0].matrixWorld.elements.slice()};
 });
});
const record=(name,data={})=>{checks.push({name,...data});console.log(JSON.stringify(checks.at(-1)));};
const waitAI=()=>page.waitForFunction(()=>window.__PP?.snapshot().aiModels?.status==='ready',null,{timeout:30000});
const readyGrid=async()=>{
 await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().aiModels.cars===5);await settle();
 // See every car once, including those behind the follow camera. This warms
 // their number textures before comparing GPU counts across roster changes.
 await page.evaluate(()=>window.__PP.setOverview('all'));await settle();await page.evaluate(()=>window.__PP.setOverview(null));await settle();
 const s=await snap();assert.equal(s.state,'countdown');assert.equal(s.competition.position,3);return s;
};
const leaveRace=async()=>{
 const s=await snap();if(s.state==='racing'||s.state==='countdown')await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');
 await page.locator('#garage-back').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='menu');
};
const compareDimensions=(actual,expected)=>{for(const axis of ['width','length','height'])assert.ok(Math.abs(actual[axis]-expected[axis])<1e-5,`${axis} differs from the player GLB`);};

/** Check real buffers, rather than accepting a self-reported source label.
 * Wheel material sections may split a source draw; their ranges must still
 * cover that source exactly once. */
async function geometryProof(){
 return page.evaluate(()=>{
  const game=window.__PP,player=[];game.car.group.traverse(o=>{if(o.isMesh)player.push(o);});
  const hash=attribute=>{
   if(!attribute)return null;let h=2166136261;
   const array=attribute.array,bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
   for(const value of bytes)h=Math.imul(h^value,16777619);
   return`${attribute.itemSize}/${attribute.count}/${h>>>0}`;
  };
  const describe=geometry=>({position:hash(geometry.attributes.position),normal:hash(geometry.attributes.normal),uv:hash(geometry.attributes.uv),index:hash(geometry.index),count:geometry.index?.count??geometry.attributes.position.count});
  const textures=new Map();
  const texture=map=>{
   if(!map)return null;if(textures.has(map.uuid))return textures.get(map.uuid);
   const image=map.image,bytes=image?.data??image?.getContext?.('2d')?.getImageData(0,0,image.width,image.height).data;
   let digest=2166136261;if(image?.data)for(const value of bytes)digest=Math.imul(digest^value,16777619);
   let alphaSignature=null;
   if(bytes&&!image?.data){const cells=[];for(let row=0;row<4;row++)for(let col=0;col<8;col++){const x0=Math.floor(col*image.width/8),x1=Math.floor((col+1)*image.width/8),y0=Math.floor(row*image.height/4),y1=Math.floor((row+1)*image.height/4);let ink=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(bytes[(y*image.width+x)*4+3]>=128)ink++;cells.push(Math.round(ink/((x1-x0)*(y1-y0))*16));}alphaSignature=cells.join(',');}
   const result={width:image?.width,height:image?.height,digest:image?.data?digest>>>0:null,alphaSignature,colorSpace:map.colorSpace,wrapS:map.wrapS,wrapT:map.wrapT,anisotropy:map.anisotropy};textures.set(map.uuid,result);return result;
  };
  const material=mesh=>{
   const m=mesh.material,decal=['driver-and-team-decals','helmet-driver-number'].includes(mesh.userData.sourceName??mesh.name);
   return{type:m.type,side:m.side,transparent:m.transparent,depthWrite:m.depthWrite,alphaTest:m.alphaTest,roughness:m.roughness??null,metalness:m.metalness??null,clearcoat:m.clearcoat??null,clearcoatRoughness:m.clearcoatRoughness??null,envMapIntensity:m.envMapIntensity??null,normalScale:m.normalScale?{x:m.normalScale.x,y:m.normalScale.y}:null,normalMap:texture(m.normalMap),map:decal?!!m.map:texture(m.map)};
  };
  const actual=[];
  game.rivalModels.group.traverse(mesh=>{
   if(!mesh.isMesh||!mesh.visible)return;
   actual.push({name:mesh.name,sourceIndex:mesh.userData.sourceIndex,sourceName:mesh.userData.sourceName,instanced:!!mesh.isInstancedMesh,instances:mesh.isInstancedMesh?mesh.count:1,range:{start:mesh.geometry.drawRange.start,count:Number.isFinite(mesh.geometry.drawRange.count)?mesh.geometry.drawRange.count:(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)},geometry:describe(mesh.geometry),material:material(mesh),driver:mesh.userData.driver,number:mesh.userData.number,mapIdentity:mesh.material.map?.userData??null});
  });
  return{player:player.map(mesh=>({name:mesh.name,geometry:describe(mesh.geometry),material:material(mesh)})),actual};
 });
}
function assertGeometry(proof){
 assert.equal(proof.player.length,27,'the complete prepared player model has all 27 visible source parts');
 const used=new Set();
 for(const part of proof.actual){
  const source=proof.player[part.sourceIndex];assert.ok(source,`unexpected AI sourceIndex: ${part.sourceIndex}`);used.add(part.sourceIndex);
  for(const attribute of ['position','normal','uv','index'])assert.equal(part.geometry[attribute],source.geometry[attribute],`${part.name} does not retain the player ${attribute} buffer`);
  assert.deepEqual(part.material,source.material,`${part.name} loses the player's finish, normals or sidewall texture`);
  if(part.instanced)assert.equal(part.instances,5);
 }
 assert.equal(used.size,proof.player.length,'every player GLB part must appear on the opponents');
 for(let index=0;index<proof.player.length;index++){
  const rows=proof.actual.filter(part=>part.sourceIndex===index),instanced=rows.filter(part=>part.instanced);
  if(instanced.length){
   const ranges=instanced.map(part=>part.range).sort((a,b)=>a.start-b.start);let end=0;
   for(const range of ranges){assert.equal(range.start,end,'split wheel ranges must neither lose nor double geometry');end+=range.count;}
   assert.equal(end,proof.player[index].geometry.count);
  }else{
   assert.equal(rows.length,5,'every visible AI needs its own correctly numbered decal');
   assert.equal(new Set(rows.map(part=>part.driver)).size,5);
   for(const row of rows){assert.equal(row.number,drivers[row.driver].number);assert.equal(row.mapIdentity.driver,row.driver);assert.equal(row.mapIdentity.number,row.number);}
  }
 }
}

async function appearanceProof(){
 return page.evaluate(()=>{
  const game=window.__PP,summary=game.snapshot().aiModels;
  const batches=[];game.rivalModels.group.traverse(mesh=>{
   if(!mesh.isInstancedMesh||!mesh.visible)return;
   const colors=[];
   for(let slot=0;slot<mesh.count;slot++){
    const c=mesh.material.color.clone();if(mesh.instanceColor){const instance=c.clone();mesh.getColorAt(slot,instance);c.multiply(instance);}colors.push(`#${c.getHexString()}`);
   }
   batches.push({sourceIndex:mesh.userData.sourceIndex,sourceName:mesh.userData.sourceName,section:mesh.userData.paletteSection,material:mesh.material.name,colors});
  });
  const decals=[],hashes=new Map(),canvases=new Map();game.rivalModels.group.traverse(mesh=>{if(mesh.isMesh&&!mesh.isInstancedMesh&&mesh.visible&&mesh.userData.driver){
   const map=mesh.material.map;
   if(!hashes.has(map.uuid)){
    const canvas=map.image,bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261;for(const value of bytes)hash=Math.imul(hash^value,16777619);
    // Inspect the number's lower-left atlas quadrant too. Coarse alpha
    // occupancy ignores tiny readback rounding/noise but rejects empty or
    // identical driver glyphs even when canvas fingerprints are salted.
    const signature=[];let ink=0;
    for(let row=0;row<4;row++)for(let col=0;col<8;col++){
     const x0=Math.floor(col*canvas.width/16),x1=Math.floor((col+1)*canvas.width/16),y0=Math.floor(canvas.height/2+row*canvas.height/8),y1=Math.floor(canvas.height/2+(row+1)*canvas.height/8);let occupied=0;
     for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(bytes[(y*canvas.width+x)*4+3]>=128)occupied++;
     ink+=occupied;signature.push(Math.round(occupied/((x1-x0)*(y1-y0))*16));
    }
    hashes.set(map.uuid,{hash:hash>>>0,numberInk:ink,numberSignature:signature.join(',')});
   }
   if(!canvases.has(map.image))canvases.set(map.image,canvases.size);
   decals.push({driver:mesh.userData.driver,number:mesh.userData.number,map:map.uuid,material:mesh.material.uuid,canvas:canvases.get(map.image),...hashes.get(map.uuid)});
  }});
  return{summary,batches,decals};
 });
}
function assertAppearance(proof,playerTriangles,playerDimensions){
 const s=proof.summary;assert.equal(s.status,'ready');assert.equal(s.source,'provided-glb');assert.equal(s.cars,5);
 assert.equal(s.trianglesPerCar,playerTriangles);assert.equal(s.trianglesPerCar,27540);assert.ok(s.draws<=45&&s.draws>=27,'shared full-model rendering must not become five independent 27-draw cars');compareDimensions(s.dimensions,playerDimensions);
 assert.equal(s.roster.length,5);assert.equal(new Set(s.roster.map(r=>r.driver)).size,5);
 for(let slot=0;slot<s.roster.length;slot++){
  const rival=s.roster[slot];assert.equal(rival.number,drivers[rival.driver].number);
  assert.equal(rival.bodyColors.paint,hex(palettes.teams[rival.team].paint));
  for(const key of ['helm_shell','helm_ring','helm_cap'])assert.equal(rival.helmetColors[key],hex(palettes.helmets[rival.driver][key]));
  for(const part of proof.batches){
   const key=part.section??part.material;
   const palette=part.material.startsWith('helm_')||part.material==='visor'?palettes.helmets[rival.driver]:palettes.teams[rival.team];
   if(palette?.[key])assert.equal(part.colors[slot],hex(palette[key]),`${rival.driver}: rendered ${key} differs from the supplied palette`);
  }
  const decals=proof.decals.filter(d=>d.driver===rival.driver);assert.equal(decals.length,2);assert.equal(decals[0].map,decals[1].map,`${rival.driver} body/helmet must share that driver's exact texture object`);assert.equal(decals[0].material,decals[1].material);assert.equal(decals[0].canvas,decals[1].canvas);assert.equal(decals[0].hash,decals[1].hash);assert.ok(decals[0].numberInk>100,'the rendered number quadrant cannot be empty');
 }
 assert.equal(new Set(proof.decals.map(d=>d.map)).size,5,'a driver atlas is shared between that car and helmet, but not other drivers');
 assert.equal(new Set(proof.decals.map(d=>d.hash)).size,5,'the five real rendered driver atlases must contain distinct marks');
 assert.equal(new Set(proof.decals.map(d=>d.numberSignature)).size,5,'the five rendered number glyphs must remain visibly different');
}

try{
 await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');await page.locator('#quality').selectOption('balanced');await settle();
 const initial=await snap();assert.equal(initial.mode,'time-trial');assert.equal(initial.car.source,'provided-glb');
 await page.locator('#race-mode').selectOption('race');await waitAI();await page.locator('#start').waitFor({state:'visible'});assert.equal(await page.locator('#start').isEnabled(),true);
 const grid=await readyGrid(),geometry=await geometryProof();assertGeometry(geometry);
 const appearance=await appearanceProof();await fs.writeFile(path.join(out,'appearance-proof.json'),JSON.stringify(appearance,null,2));assertAppearance(appearance,grid.car.triangles,grid.car.dimensions);
 assert.equal(requests.length,3,'player and AI template share the same three fetches');
 await page.screenshot({path:path.join(out,'grid-shared-glb.png')});
 record('same-full-player-glb-buffers-and-driver-palettes',{trianglesPerCar:grid.aiModels.trianglesPerCar,sourceParts:geometry.player.length,draws:grid.aiModels.draws,dimensions:grid.aiModels.dimensions,drivers:grid.aiModels.roster.map(r=>({team:r.team,driver:r.driver,number:r.number})),modelRequests:requests.length});

 await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
 const before=await snap(),handsBefore=skipPit?null:await clockHands();await page.keyboard.down('w');await page.waitForTimeout(1050);await page.keyboard.up('w');
 await page.waitForFunction(()=>window.__PP.snapshot().aiModels.roster.some(r=>Math.abs(r.pose?.steeringAngle??0)>.01),null,{timeout:18000});
 const moving=await snap();assert.ok(moving.aiModels.roster.every(r=>r.pose.travel>5));assert.ok(moving.aiModels.roster.some((r,i)=>r.pose.travel>(before.aiModels.roster[i].pose?.travel??0)));
 if(!skipPit){assert.ok(moving.pitClock.elapsed>before.pitClock.elapsed);assert.notEqual(moving.pitClock.secondAngle,before.pitClock.secondAngle);assert.notDeepEqual(await clockHands(),handsBefore,'the actual visible clock hand transforms must move too');}
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await settle();const paused=await snap(),handsPaused=skipPit?null:await clockHands();
 await page.waitForTimeout(380);const frozen=await snap();assert.deepEqual(frozen.aiModels.roster.map(r=>r.pose),paused.aiModels.roster.map(r=>r.pose));assert.equal(frozen.competition.time,paused.competition.time);
 if(!skipPit){assert.deepEqual(frozen.pitClock,paused.pitClock);assert.deepEqual(await clockHands(),handsPaused);}
 record('real-rival-wheel-travel-steering-and-paused-clock',{elapsed:moving.competition.time,steeringAngles:moving.aiModels.roster.map(r=>r.pose.steeringAngle),clock:skipPit?undefined:paused.pitClock});

 // Repeated roster changes must repaint the real material instances and atlases
 // without downloading or allocating a new fleet each time.
 const memory=[];
 for(const [team,driver]of [['mercedes','kimi_antonelli_12'],['mclaren','oscar_piastri_81'],['ferrari','lewis_hamilton_44']]){
  await leaveRace();await page.locator('#team-select').selectOption(team);await page.locator(`[data-driver="${driver}"]`).click();await readyGrid();
  const s=await snap();assert.equal(s.car.driver,driver);assert.ok(s.aiModels.roster.every(r=>r.driver!==driver));assertAppearance(await appearanceProof(),s.car.triangles,s.car.dimensions);memory.push({geometries:s.renderer.geometries,textures:s.renderer.textures});
 }
 assert.deepEqual(memory[1],memory[0]);assert.deepEqual(memory[2],memory[0]);assert.equal(requests.length,3);
 record('repeated-roster-change-reuses-gpu-resources',{memory,modelRequests:requests.length});
 await leaveRace();

 let pit;
 if(!skipPit){
  pit=await page.evaluate(()=>window.__PP.pitComplex);assert.ok(pit,'pitComplex DEV manifest is present');assert.equal(pit.towers.length,2);assert.equal(pit.strategyPods.length,11);assert.deepEqual(pit.strategyPods.map(p=>p.teamId),Object.keys(palettes.teams));assert.ok(pit.strategyPods.some(p=>p.teamId==='ferrari'));assert.ok(pit.boxes.depth>=150);assert.equal(pit.clockBeam.brand,'RIOLEX');assert.ok(pit.clockBeam.clearHeight>=6);
  for(const id of ['garden-lounge','race-club','fans-club','monza-village'])assert.ok(pit.clubs.some(c=>c.id===id),`missing ${id}`);
  assert.equal(JSON.stringify(pit).includes('ROLEX'),false);assert.equal((await snap()).pitClock.brand,'RIOLEX');
  const clearance=await page.evaluate(()=>{const g=window.__PP;return g.pitComplex.towers.map(t=>({id:t.id,x:t.x,z:t.z,distance:Math.hypot(t.x-g.track.nearest(t.x,t.z).point.x,t.z-g.track.nearest(t.x,t.z).point.z),inPit:g.track.isPitLane(t.x,t.z)}));});
  assert.ok(clearance.every(t=>t.distance>21&&!t.inPit));
  await page.locator('#quality').selectOption('high');
  const clean=await page.addStyleTag({content:'#app>*:not(#viewport){visibility:hidden!important}body[data-state=menu] #viewport::after{display:none}'});
  for(const view of ['pit-wide','clock','garages']){await page.evaluate(view=>window.__PP.setPitView(view),view);await page.waitForTimeout(200);await page.screenshot({path:path.join(out,`${view}.png`)});}
  await clean.evaluate(e=>e.remove());await page.evaluate(()=>window.__PP.setOverview(null));
  record('pit-layout-and-riolex-reference-features',{pit,clearance});
 }
 assert.deepEqual(errors,[]);
 const report={status:'passed',scope:skipPit?'AI models only':'AI models and pit complex',physicalControllerTested:false,method:'Real DOM controls and a short driving sequence. DEV camera is used only for scene inspection; no player clock/checkpoint/position writes.',modelRequests:requests,checks,geometry,errors};
 await fs.writeFile(path.join(out,'pit-fleet-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scope:report.scope,checks:checks.map(c=>c.name),errors}));
}catch(error){console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,requests,state:await snap().catch(()=>null)},null,2));}finally{await browser.close();}
