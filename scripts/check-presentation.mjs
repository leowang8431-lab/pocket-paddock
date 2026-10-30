/** v0.9 showroom / chase-camera / shared powertrain / live audio integration QA.
 * Run against Vite DEV: PP_URL=http://127.0.0.1:5173 node scripts/check-presentation.mjs
 * Optional PP_UI_ONLY=1 and PP_LAYOUTS=desktop,portrait,landscape for layout iteration.
 * Inputs are real DOM / keyboard / injected standard Gamepad API. Never writes
 * vehicle position, speed, race time, checkpoints or powertrain state.
 */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve(process.env.PP_OUTPUT??'outputs/v09-presentation');
await fs.mkdir(out,{recursive:true});
const report={status:'running',createdAt:new Date().toISOString(),url:process.env.PP_URL??'http://127.0.0.1:5173/',
  method:'Real UI and driving inputs; visible mesh vertices projected through the actual view camera; no vehicle/timer writes.',
  limitations:['Synthetic standard gamepad; no physical controller tested.','Headless Web Audio graph sampled digitally; no physical speaker listening test.','Short straight acceleration/braking check; this script does not claim a complete lap.'],
  checks:[],layouts:[],drivingSamples:[],errors:[],networkErrors:[]};
const save=()=>fs.writeFile(path.join(out,'presentation-validation.json'),JSON.stringify(report,null,2));
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify(report.checks.at(-1)));};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(()=>{
  window.__presentationPad={index:0,id:'Presentation QA Standard Pad',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0,pressed:false,touched:false}))};
  window.__presentationPadConnected=false;
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__presentationPadConnected?[window.__presentationPad]:[]});
});
const page=await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror',error=>report.errors.push(String(error)));
page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
page.on('requestfailed',request=>{if(!request.url().endsWith('/favicon.ico'))report.networkErrors.push({url:request.url(),error:request.failure()?.errorText});});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const settle=async()=>{await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready'&&!document.querySelector('#start').disabled);await page.waitForTimeout(100);};
const shot=async name=>{const file=`${name}.png`;await page.screenshot({path:path.join(out,file),animations:'disabled'});return file;};
const key=async(code,down)=>down?page.keyboard.down(code):page.keyboard.up(code);
const press=async code=>{await key(code,true);await page.waitForTimeout(90);await key(code,false);await page.waitForTimeout(90);};
const frozen=(before,after)=>{
  assert.equal(after.state,'paused');
  for(const field of ['elapsed','x','z','speed','heading','distance'])assert.equal(after[field],before[field],`Paused ${field} advanced`);
  assert.deepEqual(after.powertrain,before.powertrain,'Paused powertrain advanced');
};
const hud=()=>page.evaluate(()=>({gear:document.querySelector('#gear').textContent.trim(),rpm:Number(document.querySelector('#rpm-value').textContent.replace(/[^\d]/g,'')),shift:document.querySelector('#shift-state').textContent}));

async function inspectLayout(name,view){
  const evidence=await page.evaluate(()=>{
    const pp=window.__PP,group=pp.car.group,camera=pp.viewCamera,state=pp.snapshot();
    if(!camera)throw new Error('DEV __PP.viewCamera is required for actual mesh projection');
    const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:!!(r.width&&r.height)&&getComputedStyle(el).visibility!=='hidden'};};
    const garage=rect('.garage'),start=rect('#start'),showcase=rect('.car-showcase'),canvas=rect('#viewport canvas');
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,vertices=0,behind=0,garageCovered=0,meshes=0;
    const point=group.position.clone();
    group.traverseVisible(object=>{
      if(!object.isMesh||!object.geometry?.attributes?.position)return;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.every(material=>material.visible===false||material.opacity===0))return;
      meshes++;const positions=object.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld).project(camera);
        const x=canvas.x+(point.x+1)*canvas.width/2,y=canvas.y+(1-point.y)*canvas.height/2;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);vertices++;
        if(point.z<-1||point.z>1)behind++;
        if(x>=garage.x&&x<=garage.right&&y>=garage.y&&y<=garage.bottom)garageCovered++;
      }
    });
    const dx=camera.position.x-group.position.x,dz=camera.position.z-group.position.z;
    const forwardDot=(dx*Math.sin(group.rotation.y)+dz*Math.cos(group.rotation.y))/Math.hypot(dx,dz);
    return {viewport:{width:innerWidth,height:innerHeight},state:state.state,camera:state.camera,car:state.car,
      bounds:{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY},meshes,vertices,behind,garageCovered,garageCoverage:garageCovered/vertices,
      forwardDot,garage,start,showcase,canvas,scrollWidth:document.documentElement.scrollWidth,
      selectedView:[...document.querySelectorAll('[data-menu-view]')].filter(el=>el.getAttribute('aria-pressed')==='true').map(el=>el.dataset.menuView),
      team:document.querySelector('#team-select').value,driver:document.querySelector('[data-driver][aria-pressed=true]')?.dataset.driver,
      showcaseTeam:document.querySelector('#showcase-team').textContent,showcaseDriver:document.querySelector('#showcase-driver').textContent,showcaseNumber:document.querySelector('#showcase-number').textContent,
      selectedDriverText:document.querySelector('[data-driver][aria-pressed=true] .driver-name strong')?.textContent,
      selectedDriverNumber:document.querySelector('[data-driver][aria-pressed=true] .driver-number')?.textContent,
      frame:state.renderer.frame??null};
  });
  evidence.name=name;evidence.view=view;
  evidence.screenshot=await shot(`${name}-${view}`);
  report.layouts.push(evidence);await save();
  assert.equal(evidence.state,'menu');assert.deepEqual(evidence.selectedView,[view]);assert.equal(evidence.camera.menuView,view);
  assert.ok(evidence.vertices>1000&&evidence.meshes>0,'Expected the ready imported car, not an empty showroom');
  assert.equal(evidence.behind,0,'Car vertex outside camera near/far range');
  assert.ok(evidence.bounds.minX>=0&&evidence.bounds.maxX<=evidence.viewport.width&&evidence.bounds.minY>=0&&evidence.bounds.maxY<=evidence.viewport.height,`Car clipped: ${JSON.stringify(evidence.bounds)}`);
  assert.ok(evidence.bounds.width>=evidence.viewport.width*.15&&evidence.bounds.height>=Math.min(evidence.viewport.height*.13,evidence.viewport.width*.22),`Car too small to inspect: ${JSON.stringify(evidence.bounds)}`);
  assert.ok(evidence.garageCoverage<.01,`Garage overlays ${(evidence.garageCoverage*100).toFixed(2)}% of car vertices`);
  assert.ok(evidence.start.visible&&evidence.start.x>=0&&evidence.start.right<=evidence.viewport.width&&evidence.start.y>=0&&evidence.start.bottom<=evidence.viewport.height,'Start button is not wholly on screen');
  assert.ok(evidence.scrollWidth<=evidence.viewport.width,'Page has horizontal overflow');
  assert.equal(evidence.showcaseDriver,evidence.selectedDriverText,'Showroom driver name does not follow selection');
  assert.equal(Number(evidence.showcaseNumber),Number(evidence.selectedDriverNumber),'Showroom number does not follow selection');
  if(view==='front')assert.ok(evidence.forwardDot>.25&&evidence.forwardDot<.98,`Expected front three-quarter view, dot=${evidence.forwardDot}`);
  if(view==='rear')assert.ok(evidence.forwardDot<-.25,`Expected rear view, dot=${evidence.forwardDot}`);
  return evidence;
}

async function attachAudioSampler(){
  return page.evaluate(()=>{
    const audio=window.__PP.engineAudio,ctx=audio?.ctx,voice=audio?.voice;
    if(!ctx||!voice?.output)throw new Error('DEV __PP.engineAudio.ctx/voice.output is required for real digital audio sampling');
    const analyser=ctx.createAnalyser(),mute=ctx.createGain();analyser.fftSize=2048;mute.gain.value=0;
    // A second silent branch reads the real existing engine graph. The game's
    // original compressor/destination branch and all simulation state stay intact.
    voice.output.connect(analyser);analyser.connect(mute);mute.connect(ctx.destination);
    window.__presentationAudio={analyser,mute,output:voice.output,ctx};
    return {context:ctx.state,sampleRate:ctx.sampleRate,outputGain:voice.output.gain.value};
  });
}
async function audioRms(){
  return page.evaluate(async()=>{
    const audio=window.__presentationAudio;if(!audio)throw new Error('Audio analyser has not been attached');
    const data=new Float32Array(audio.analyser.fftSize),samples=[];
    for(let i=0;i<10;i++){
      await new Promise(resolve=>setTimeout(resolve,25));audio.analyser.getFloatTimeDomainData(data);
      let sum=0,peak=0;for(const v of data){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
      samples.push({rms:Math.sqrt(sum/data.length),peak});
    }
    return {context:audio.ctx.state,outputGain:audio.output.gain.value,maxRms:Math.max(...samples.map(s=>s.rms)),maxPeak:Math.max(...samples.map(s=>s.peak)),samples};
  });
}
async function driveUntil(test,code,{timeout=11000,description='drive condition'}={}){
  await key(code,true);
  try{
    return await page.evaluate(async({test,timeout,description})=>{
      const predicate=Function('s',`return (${test})(s)`),started=performance.now(),samples=[];
      return await new Promise((resolve,reject)=>{
        const frame=()=>{
          const s=window.__PP.snapshot();samples.push({t:performance.now()-started,speed:s.speed,elapsed:s.elapsed,x:s.x,z:s.z,camera:s.camera,powertrain:s.powertrain,frame:s.renderer.frame??null});
          if(predicate(s))return resolve({snapshot:s,samples});
          if(performance.now()-started>timeout)return reject(new Error(`Timeout reaching ${description}: ${JSON.stringify(s)}`));
          requestAnimationFrame(frame);
        };frame();
      });
    },{test:test.toString(),timeout,description});
  }finally{await key(code,false);}
}

try{
  await page.goto(report.url,{waitUntil:'networkidle'});await settle();
  const initial=await snapshot();
  assert.equal(initial.audio.enabled,false);assert.equal(initial.audio.context,'not-created','AudioContext must be created only after a sound user gesture');
  check('initial-audio-disabled-and-context-not-created');
  const layouts={desktop:{width:1440,height:900},portrait:{width:391,height:844},landscape:{width:740,height:391}};
  const chosen=(process.env.PP_LAYOUTS??'desktop,portrait,landscape').split(',');
  for(const name of chosen){
    assert.ok(layouts[name],`Unknown PP_LAYOUTS entry ${name}`);await page.setViewportSize(layouts[name]);await settle();
    const options=await page.locator('#team-select option').evaluateAll(nodes=>nodes.map(node=>node.value));
    assert.equal(options.length,11);const team=options[name==='desktop'?4:name==='portrait'?6:9];
    await page.locator('#team-select').selectOption(team);await settle();
    const drivers=await page.locator('[data-driver]').count();assert.equal(drivers,2);
    await page.locator('[data-driver]').nth(1).click();await settle();
    const selected=(await snapshot()).car;
    for(const view of ['front','side','rear']){
      await page.locator(`[data-menu-view=${view}]`).click();await page.waitForTimeout(100);
      await inspectLayout(name,view);assert.equal((await snapshot()).car.team,selected.team);assert.equal((await snapshot()).car.driver,selected.driver);
    }
    await page.locator('[data-menu-view=front]').click();
    await page.locator('#start').click({trial:true});
    check(`${name}-showroom-complete-car-and-selectable-team-driver`,{viewport:layouts[name],team:selected.team,driver:selected.driver});
  }
  await page.setViewportSize(layouts.desktop);await settle();
  await page.locator('#camera-mode').selectOption('far');const savedCar=(await snapshot()).car;
  await page.reload({waitUntil:'networkidle'});await settle();const restored=await snapshot();
  assert.equal(restored.camera.mode,'far');assert.equal(await page.locator('#camera-mode').inputValue(),'far');
  assert.equal(restored.car.team,savedCar.team);assert.equal(restored.car.driver,savedCar.driver);
  check('camera-preference-and-team-driver-persist-after-refresh');
  if(process.env.PP_UI_ONLY==='1'){
    report.status='passed';report.scope='showroom UI only';assert.deepEqual(report.errors,[]);await save();
  }else{
    await page.locator('#camera-mode').selectOption('standard');await page.locator('#race-mode').selectOption('time-trial');
    await page.locator('#sound').click();await page.waitForFunction(()=>window.__PP.snapshot().audio.enabled&&window.__PP.snapshot().audio.context==='running');
    const audioGraph=await attachAudioSampler();const menuSilence=await audioRms();
    assert.ok(menuSilence.maxRms<.0001,`Menu audio should remain silent: ${menuSilence.maxRms}`);
    await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='countdown');
    const beforeRev=await snapshot();await key('w',true);await page.waitForTimeout(550);const revving=await snapshot(),revSound=await audioRms();await key('w',false);
    assert.equal(revving.state,'countdown');assert.equal(revving.x,beforeRev.x);assert.equal(revving.z,beforeRev.z);assert.equal(revving.speed,0);
    assert.equal(revving.powertrain.gear,0);assert.ok(revving.powertrain.rpm>6000,'Countdown throttle must visibly free-rev');
    assert.equal(revSound.context,'running');assert.ok(revSound.maxRms>.0001&&revSound.maxPeak>.001,'Real engine graph has no non-zero output');
    check('sound-user-gesture-live-output-and-countdown-free-rev',{audioGraph,menuSilence,revSound,rpm:revving.powertrain.rpm});
    await shot('countdown-revving');await page.waitForFunction(()=>window.__PP.snapshot().state==='racing',undefined,{timeout:15000});
    const buttonModes=[(await snapshot()).camera.mode];
    for(let i=0;i<3;i++){await page.locator('#camera-cycle').click();buttonModes.push((await snapshot()).camera.mode);}
    assert.equal(new Set(buttonModes.slice(0,3)).size,3);assert.equal(buttonModes[0],buttonModes[3]);
    check('visible-racing-camera-button-cycles-three-profiles',{visited:buttonModes});
    await page.waitForTimeout(750);
    const stationary=await snapshot();assert.equal(stationary.speed,0);assert.ok(Math.abs(stationary.camera.height-2.8)<.03);assert.ok(Math.abs(stationary.camera.distance-8)<.03);
    const accelerating=await driveUntil(s=>s.speed>=30,'w',{description:'180 km/h on the start straight'});
    report.drivingSamples.push(...accelerating.samples);const fast=accelerating.snapshot;await press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.waitForTimeout(300);const fastPaused=await snapshot();
    assert.ok(fast.speed>=30);assert.equal(fast.surface,'asphalt');assert.ok(fast.powertrain.gear>=4,'Expected actual upshifts while accelerating');
    for(const field of ['distance','height','fov'])assert.ok(Math.abs(fast.camera[field]-stationary.camera[field])<.04,`Camera ${field} changed with speed: ${stationary.camera[field]} → ${fast.camera[field]}`);
    const gears=[...new Set(accelerating.samples.map(s=>s.powertrain.gear))],upshifts=accelerating.samples.filter(s=>s.powertrain.shift==='up');
    assert.ok(gears.length>=4&&upshifts.length>0,'Acceleration did not exercise sequential upshifts');
    if(Number.isFinite(fast.renderer.frame)&&Number.isFinite(stationary.renderer.frame))assert.ok(fast.renderer.frame>stationary.renderer.frame,'No actual renderer frames advanced while driving');
    const fastHud=await hud();assert.equal(fastHud.gear,String(fastPaused.powertrain.gear));assert.ok(Math.abs(fastHud.rpm-Math.round(fastPaused.powertrain.rpm))<=1,'HUD RPM differs from the frozen shared powertrain');
    check('real-acceleration-upshifts-shared-hud-and-speed-invariant-camera',{speedKmh:fast.speed*6,gears,initialCamera:stationary.camera,fastCamera:fast.camera,shiftSerial:fast.powertrain.shiftSerial,hud:fastHud,renderedFrames:Number.isFinite(fast.renderer.frame)&&Number.isFinite(stationary.renderer.frame)?fast.renderer.frame-stationary.renderer.frame:null});
    await shot('fast-car-detail-paused');
    const visited=[fastPaused.camera.mode];
    for(let i=0;i<3;i++){
      await press('c');await page.waitForTimeout(80);const s=await snapshot();frozen(fastPaused,s);visited.push(s.camera.mode);
      assert.ok(Math.abs(s.camera.height-s.camera.targetHeight)<.02&&Math.abs(s.camera.distance-s.camera.targetDistance)<.02,'Paused camera cycle did not reframe');
    }
    assert.equal(new Set(visited.slice(0,3)).size,3);assert.equal(visited[0],visited[3]);
    check('keyboard-c-three-camera-profiles-while-simulation-paused',{visited});
    await page.evaluate(()=>{window.__presentationPadConnected=true;});await page.waitForFunction(()=>window.__PP.snapshot().gamepad.connected);await page.waitForTimeout(120);
    const padStart=(await snapshot()).camera.mode;
    await page.evaluate(()=>{window.__presentationPad.buttons[11]={value:1,pressed:true,touched:true};});await page.waitForTimeout(160);const padChanged=await snapshot();
    assert.notEqual(padChanged.camera.mode,padStart);frozen(fastPaused,padChanged);await page.waitForTimeout(260);assert.equal((await snapshot()).camera.mode,padChanged.camera.mode,'Held R3 repeated camera cycling');
    await page.evaluate(()=>{window.__presentationPad.buttons[11]={value:0,pressed:false,touched:false};});await page.waitForTimeout(120);
    frozen(fastPaused,await snapshot());
    check('synthetic-r3-edge-while-simulation-paused',{physicalControllerTested:false});
    const pausedSound=await audioRms();assert.ok(pausedSound.maxRms<.0001,'Paused engine audio should decay to silence');
    await page.locator('#resume').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
    const braking=await driveUntil(s=>s.speed<=.12,'s',{timeout:7000,description:'braking to standstill'});
    report.drivingSamples.push(...braking.samples);await press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.waitForTimeout(300);const stopped=await snapshot();
    assert.ok(braking.samples.some(s=>s.powertrain.shift==='down'),'No downshift occurred under actual braking');
    assert.ok(stopped.powertrain.shiftSerial>fast.powertrain.shiftSerial,'Braking did not advance shift event serial');
    assert.ok(Math.abs(stopped.speed)<=.12);const stoppedHud=await hud();assert.equal(stoppedHud.gear,stopped.powertrain.gear===0?'N':String(stopped.powertrain.gear));assert.ok(Math.abs(stoppedHud.rpm-Math.round(stopped.powertrain.rpm))<=1);
    check('real-braking-sequential-downshifts-and-hud',{stopKmh:stopped.speed*6,initialShiftSerial:fast.powertrain.shiftSerial,stoppedShiftSerial:stopped.powertrain.shiftSerial,gears:[...new Set(braking.samples.map(s=>s.powertrain.gear))],hud:stoppedHud,pausedSound});
    await shot('stopped-powertrain');
    await page.locator('#garage-back').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='menu');await settle();
    await page.locator('#sound').click();await page.waitForFunction(()=>!window.__PP.snapshot().audio.enabled);assert.ok((await audioRms()).maxRms<.0001);
    assert.deepEqual(report.errors,[],'Browser console/page errors occurred');assert.deepEqual(report.networkErrors,[],'A local dependency request failed');
    check('no-browser-errors-and-return-to-silent-garage',{errors:report.errors,networkErrors:report.networkErrors});
    report.status='passed';report.scope='showroom, live input camera/powertrain/audio integration';await save();
  }
}catch(error){
  report.status='failed';report.failure=String(error);report.stack=error.stack;report.state=await snapshot().catch(()=>null);
  report.failureScreenshot=await shot('failure').catch(()=>null);await save();console.error(error);process.exitCode=1;
}finally{
  await page.keyboard.up('w').catch(()=>{});await page.keyboard.up('s').catch(()=>{});
  await page.evaluate(()=>{const a=window.__presentationAudio;if(a){a.output.disconnect(a.analyser);a.analyser.disconnect();a.mute.disconnect();}}).catch(()=>{});
  await browser.close();
}
