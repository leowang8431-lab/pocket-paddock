/** Formal-game pit integration QA. Monza uses keyboard-only driving from the
 * starting grid through the whole circuit to the pit entrance. Spa uses an
 * explicitly labelled entrance fixture, then real keyboard and game controls.
 * No progress, checkpoint, RNG, stop duration or pit-state writes are made. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {driveManualPitExit} from './pit-manual-driver.mjs';

const url=process.env.PP_URL??'http://127.0.0.1:5173/';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/pit-game-v13');await fs.mkdir(out,{recursive:true});
const timeout=Number(process.env.PP_TIMEOUT_MS??240000);
const spaOnly=process.env.PP_SPA_ONLY==='1';
const report={version:'0.14',status:'running',method:'Monza: real keyboard driving from the grid around the whole circuit and into the pits. Spa: declared placement fixture eight units before the actual entrance, followed by real keyboard inputs and automatic game control. Read-only rendered rig/audio observations.',limitations:['Headless Chrome; no physical controller or another computer tested.','Spa entrance fixtures verify pit integration, not a complete Spa driving lap.','Videos capture the actual game canvas and pit-effect audio output; engine audio is not mixed into the review recording.'],checks:[],scenarios:[],errors:[],networkErrors:[]};
if(spaOnly)report.method='Spa only: declared placement fixture eight units before the actual entrance, followed by real keyboard inputs and automatic game control. Read-only rendered rig/audio observations. Monza full-lap scenario omitted explicitly via PP_SPA_ONLY.';
const save=()=>fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2));
const check=async(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify({name,fixture:details.fixture??null,duration:details.duration??details.serviceStart?.duration??null,maximumKmh:details.maximumKmh??null}));await save();};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(25000);
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('requestfailed',r=>{if(!r.url().endsWith('/favicon.ico'))report.networkErrors.push({url:r.url(),error:r.failure()?.errorText});});
const snap=()=>page.evaluate(()=>window.__PP.snapshot());
const shot=name=>page.screenshot({path:path.join(out,`${name}.png`)});
async function open(circuit,team,compound){
  const target=new URL(url);target.searchParams.set('circuit',circuit);await page.goto(target.href,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready'&&!document.querySelector('#start').disabled,undefined,{timeout:40000});
  await page.locator('#quality').selectOption('performance');await page.locator('#race-mode').selectOption('time-trial');await page.locator('#team-select').selectOption(team);await page.locator('#pit-compound').selectOption(compound);
  if(!await page.evaluate(()=>window.__PP.engineAudio.enabled))await page.locator('#sound').click();
  await page.waitForFunction(()=>window.__PP.pitAudio.summary.ready&&window.__PP.pitAudio.summary.unlocked,undefined,{timeout:30000});
  await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing',undefined,{timeout:25000});
}
async function restart(){if((await snap()).state!=='paused')await page.keyboard.press('Escape');await page.locator('#restart').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing',undefined,{timeout:25000});}

async function driveToEntrance(fixture=false){
  if(fixture)await page.evaluate(()=>{
    // The fixture only places a fresh, manually controlled vehicle before the
    // gate. It does not request pit assistance or change any session progress.
    const p=window.__PP,e=p.pit.entry,tx=Math.sin(e.heading),tz=Math.cos(e.heading);
    p.vehicle.reset(e.x-tx*8,e.z-tz*8,e.heading);p.vehicle.speed=6;p.vehicle.vx=tx*6;p.vehicle.vz=tz*6;
  });
  await page.evaluate(({fixture,timeout})=>{
    const game=window.__PP,track=game.track,path=track.pitPath,held=new Set(),start=performance.now(),nodes=[];let length=0;
    for(const p of path){const prev=nodes.at(-1);if(prev)length+=Math.hypot(p.x-prev.x,p.z-prev.z);nodes.push({x:p.x,z:p.z,d:length});}
    const entryMain=track.nearest(nodes[0].x,nodes[0].z).distance;
    const state=window.__pitEntryDrive={done:false,fixture,phase:'main-track',trace:[],brakeFrames:0,maximumLateral:0,started:game.snapshot(),last:null};let lastTrace=0,inPit=fixture;
    const key=(code,on)=>{if(on&&!held.has(code)){dispatchEvent(new KeyboardEvent('keydown',{code}));held.add(code);}if(!on&&held.has(code)){dispatchEvent(new KeyboardEvent('keyup',{code}));held.delete(code);}};
    const stop=(reason,s)=>{for(const code of held)dispatchEvent(new KeyboardEvent('keyup',{code}));state.done=true;state.reason=reason;state.last=s;};
    const pitTarget=(x,z,ahead)=>{
      let best=Infinity,at=0;
      for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz))),px=a.x+t*dx,pz=a.z+t*dz,gap=(x-px)**2+(z-pz)**2;if(gap<best){best=gap;at=a.d+t*(b.d-a.d);}}
      const target=Math.min(length,at+ahead);for(let i=1;i<nodes.length;i++)if(nodes[i].d>=target){const a=nodes[i-1],b=nodes[i],t=(target-a.d)/(b.d-a.d);return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};}return nodes.at(-1);
    };
    const tick=()=>{
      const now=performance.now(),s=game.snapshot(),near=track.nearest(s.x,s.z),lateral=Math.hypot(s.x-near.point.x,s.z-near.point.z);state.maximumLateral=Math.max(state.maximumLateral,lateral);
      if(s.pit.active){stop('captured-by-real-entrance',s);return;}if(now-start>timeout){stop('timeout',s);return;}if(s.state!=='racing'){stop('unexpected-race-state',s);return;}
      if(now-lastTrace>1000){state.trace.push({wallSeconds:(now-start)/1000,distance:s.distance,x:s.x,z:s.z,speed:s.speed,heading:s.heading,valid:s.valid,nextCheckpoint:s.nextCheckpoint,phase:state.phase});lastTrace=now;}
      if(near.distance>=entryMain-12)inPit=true;state.phase=inPit?'pit-entry':'main-track';
      const lookahead=inPit?4+Math.abs(s.speed)*.18:7+Math.abs(s.speed)*.24;
      const look=inPit?pitTarget(s.x,s.z,lookahead):track.sampleAt(near.distance+lookahead).point;
      const desired=Math.atan2(look.x-s.x,look.z-s.z),error=Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading));let targetSpeed=inPit?8:40;
      if(!inPit)for(let ahead=0;ahead<=65;ahead+=4){const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+4),curvature=Math.acos(Math.max(-1,Math.min(1,a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z)))/4,local=Math.max(8,Math.min(40,Math.sqrt(8.3/Math.max(.0001,curvature))));targetSpeed=Math.min(targetSpeed,Math.sqrt(local*local+42*Math.max(0,ahead-8)));}
      const required=(2*Math.abs(s.speed)*Math.sin(error)/lookahead)/Math.max(.01,game.steerYaw(Math.abs(s.speed))),braking=s.speed>targetSpeed+.8;if(braking)state.brakeFrames++;
      key('KeyW',s.speed<targetSpeed);key('KeyS',braking);key('KeyA',required>s.steering+.025);key('KeyD',required<s.steering-.025);requestAnimationFrame(tick);
    };tick();
  },{fixture,timeout});
  await page.waitForFunction(()=>window.__pitEntryDrive?.done,undefined,{timeout:timeout+10000});const result=await page.evaluate(()=>window.__pitEntryDrive);report.scenarios.push(result);await save();assert.equal(result.reason,'captured-by-real-entrance',`${fixture?'Entrance fixture':'Full-grid keyboard run'} failed`);return result;
}
async function installObservers(label){
  await page.evaluate(label=>{
    const game=window.__PP,audio=game.pitAudio,ctx=audio.audioContext,output=audio.output;if(!ctx||!output)throw new Error('Pit audio not unlocked');
    const processor=ctx.createScriptProcessor(2048,2,2),silent=ctx.createGain();silent.gain.value=0;const levels=[];
    processor.onaudioprocess=e=>{let peak=0,sum=0,count=0;for(let c=0;c<e.inputBuffer.numberOfChannels;c++){const values=e.inputBuffer.getChannelData(c);for(const x of values){peak=Math.max(peak,Math.abs(x));sum+=x*x;count++;}}const s=game.snapshot();levels.push({time:ctx.currentTime,state:s.state,pitState:s.pit.state,elapsed:s.pit.serviceElapsed,peak,rms:Math.sqrt(sum/Math.max(1,count))});};output.connect(processor);processor.connect(silent);silent.connect(ctx.destination);
    const trace=[],begun=performance.now();let lastTrace=0,seen=false,serviceStart=null,serviceEnd=null,recorder=null,chunks=[],done=false,destination=null,stream=null,stopPromise=null;
    const observe=()=>{
      const s=game.snapshot(),now=performance.now();if(s.pit.active)seen=true;
      if(now-lastTrace>100||s.pit.state!==trace.at(-1)?.phase){trace.push({wallSeconds:(now-begun)/1000,state:s.state,phase:s.pit.state,kmh:s.speed*6,x:s.x,z:s.z,heading:s.heading,raceElapsed:s.elapsed,lap:s.lap,nextCheckpoint:s.nextCheckpoint,duration:s.pit.serviceDuration,serviceElapsed:s.pit.serviceElapsed,view:s.pit.view,audio:s.pit.audio});lastTrace=now;}
      if(s.pit.state==='service'&&serviceStart===null){serviceStart={wallTime:now,elapsed:s.pit.serviceElapsed,duration:s.pit.serviceDuration,stop:{...s.pit.stop}};stream=document.querySelector('#viewport canvas').captureStream(30);destination=ctx.createMediaStreamDestination();output.connect(destination);for(const t of destination.stream.getAudioTracks())stream.addTrack(t);const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'].find(m=>MediaRecorder.isTypeSupported(m));recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000,audioBitsPerSecond:128000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};stopPromise=new Promise(resolve=>recorder.onstop=resolve);recorder.start(100);}
      if(serviceStart&&s.pit.state==='exit'&&serviceEnd===null)serviceEnd={wallTime:now,duration:s.pit.serviceDuration,elapsed:s.pit.serviceElapsed};
      if(serviceEnd&&now-serviceEnd.wallTime>900&&recorder?.state==='recording')recorder.stop();
      if(seen&&!s.pit.active){done=true;return;}requestAnimationFrame(observe);
    };requestAnimationFrame(observe);
    window.__pitGameObserver={label,trace,levels,get seen(){return seen;},get done(){return done;},get serviceStart(){return serviceStart;},get serviceEnd(){return serviceEnd;},resetLevels:()=>{levels.length=0;},levelMetrics:()=>({chunks:levels.length,peak:Math.max(0,...levels.map(v=>v.peak))}),exportVideo:async()=>{if(recorder?.state==='recording')recorder.stop();if(stopPromise)await stopPromise;if(destination)output.disconnect(destination);for(const t of stream?.getTracks()??[])t.stop();const bytes=new Uint8Array(await new Blob(chunks,{type:recorder?.mimeType??'video/webm'}).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);},dispose:()=>{processor.disconnect();silent.disconnect();output.disconnect(processor);}};
  },label);
}
async function pauseProof(label){
  await page.waitForFunction(()=>{const s=window.__PP.snapshot();return s.pit.state==='service'&&s.pit.serviceElapsed>.25;},undefined,{timeout:120000});
  await shot(`${label}-service`);const service=await snap();assert.equal(service.pit.view.active,true);assert.equal(service.pit.view.rig.crewCount,16);assert.equal(service.pit.audio.activeSource,true);assert.ok(service.pit.serviceDuration>=2&&service.pit.serviceDuration<=4);assert.ok(Math.hypot(service.x-service.pit.stop.x,service.z-service.pit.stop.z)<1e-6);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.waitForTimeout(120);
  const geometry=()=>page.evaluate(()=>{const g=window.__PP,rig=g.pitView.group;g.car.group.updateMatrixWorld(true);rig?.updateMatrixWorld(true);const matrices=[];for(const root of [g.car.group,rig])root?.traverse(o=>matrices.push([o.uuid,o.visible,...o.matrixWorld.elements]));return matrices;});
  const before=await snap(),beforeGeometry=await geometry();await page.evaluate(()=>window.__pitGameObserver.resetLevels());await page.waitForTimeout(400);const after=await snap(),silence=await page.evaluate(()=>window.__pitGameObserver.levelMetrics());
  assert.equal(after.elapsed,before.elapsed);assert.equal(after.pit.serviceElapsed,before.pit.serviceElapsed);assert.equal(after.pit.serviceDuration,before.pit.serviceDuration);assert.equal(after.pit.audio.activeSource,false);assert.deepEqual(after.pit.view,before.pit.view);assert.deepEqual(await geometry(),beforeGeometry);assert.ok(silence.chunks>0&&silence.peak<.0001);await shot(`${label}-paused`);
  await page.locator('#resume').click();await check(`${label}-service-pause-freezes-actual-model-time-random-draw-and-audio`,{duration:before.pit.serviceDuration,elapsed:before.pit.serviceElapsed,silence,crew:16});
  return service;
}
async function completeVisit(label,compound,fullLap=false){
  await page.waitForFunction(()=>window.__PP.snapshot().pit.state==='exit',undefined,{timeout:30000});const exit=await snap();await shot(`${label}-exit`);
  assert.equal(exit.pit.currentCompound,compound);assert.equal(exit.pit.view.currentCompound,compound);assert.equal(exit.pit.view.active,false);assert.equal(exit.pit.view.markerCount,0);assert.equal(exit.pit.audio.activeSource,false);
  assert.equal(exit.pit.controlled,false);assert.equal(exit.pit.limited,true);const parked={x:exit.x,z:exit.z,distance:exit.pit.raceDistance};await page.waitForTimeout(350);const waiting=await snap();assert.ok(Math.hypot(waiting.x-parked.x,waiting.z-parked.z)<.001);assert.equal(waiting.pit.raceDistance,parked.distance,'Waiting in a released car advanced pit progress');
  const manualExit=await driveManualPitExit(page);await check(`${label}-real-keyboard-manual-pit-exit`,{manualExit});
  await page.waitForFunction(()=>window.__pitGameObserver.done,undefined,{timeout:120000});const final=await snap();const evidence=await page.evaluate(()=>{const o=window.__pitGameObserver;return{trace:o.trace,levels:o.levels,serviceStart:o.serviceStart,serviceEnd:o.serviceEnd};});
  assert.equal(final.pit.active,false);assert.equal(final.pit.completedStops,1);assert.equal(final.pit.view.active,false);assert.equal(final.pit.currentCompound,compound);assert.ok(evidence.trace.filter(t=>t.phase!=='idle').every(t=>Math.abs(t.kmh)<=120.0001));assert.ok(evidence.trace.filter(t=>t.phase==='service').every(t=>Math.abs(t.kmh)<.01));assert.ok(evidence.levels.some(l=>l.pitState==='service'&&l.peak>.01));
  const serviceRows=evidence.trace.filter(t=>t.phase==='service'&&t.state==='racing');assert.ok(serviceRows.length>=2);assert.ok(serviceRows.at(-1).raceElapsed>serviceRows[0].raceElapsed,'Race timing stopped during tyre service');
  assert.ok(Math.abs(evidence.serviceEnd.elapsed-evidence.serviceStart.duration)<.001);if(fullLap){assert.equal(final.completed,1);assert.equal(final.valid,true);const result=await page.evaluate(()=>window.__PP.race.result);assert.equal(result?.valid,true);}
  const video=await page.evaluate(()=>window.__pitGameObserver.exportVideo());await fs.writeFile(path.join(out,`${label}-service.webm`),Buffer.from(video,'base64'));await page.evaluate(()=>window.__pitGameObserver.dispose());
  const baseline=await snap();await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');const manual=await snap();assert.ok(Math.hypot(manual.x-baseline.x,manual.z-baseline.z)>3);assert.ok(manual.speed>baseline.speed+.5,'Manual throttle did not return after exit');
  await check(`${label}-120-kmh-auto-parking-random-service-tyre-change-and-manual-exit`,{final,serviceStart:evidence.serviceStart,serviceEnd:evidence.serviceEnd,maximumKmh:Math.max(...evidence.trace.filter(t=>t.phase!=='idle').map(t=>Math.abs(t.kmh))),video:`${label}-service.webm`,trace:evidence.trace,audioNonzero:true});return final;
}

try{
  if(!spaOnly){
  await open('monza','ferrari','soft');await installObservers('monza-ferrari-real-drive');
  const drive=await driveToEntrance(false);assert.ok(drive.brakeFrames>0);assert.equal(drive.last.pit.team,'ferrari');await shot('monza-real-drive-approach');
  await check('monza-keyboard-only-grid-to-pit-entrance',{fixture:false,brakeFrames:drive.brakeFrames,trace:drive.trace,captured:drive.last});
  // Contradictory manual inputs must not override automatic pit control.
  await page.keyboard.down('a');await page.keyboard.down('s');await page.keyboard.down('w');await page.waitForTimeout(350);const held=await snap();for(const key of ['a','s','w'])await page.keyboard.up(key);assert.equal(held.pit.active,true);assert.ok(held.speed*6<=120.0001);assert.equal(held.drs.active,false);
  await pauseProof('monza');await completeVisit('monza','soft',true);
  }

  await open('spa','mclaren','hard');await installObservers('spa-entry-fixture');await driveToEntrance(true);await shot('spa-fixture-approach');await pauseProof('spa');await completeVisit('spa','hard',false);
  await check('spa-explicit-entrance-fixture-completes-a-second-independent-random-stop',{fixture:'Vehicle placed eight game units before the real entrance; subsequent input/state progression is real.',duration:(await snap()).pit.serviceDuration});

  await restart();await page.locator('#pit-compound').selectOption('wet');await driveToEntrance(true);
  await page.waitForFunction(()=>window.__PP.snapshot().pit.state==='service',undefined,{timeout:120000});const cancelled=await snap();assert.equal(cancelled.pit.currentCompound,'medium');await page.keyboard.press('r');await page.waitForTimeout(160);const reset=await snap();assert.equal(reset.pit.active,false);assert.equal(reset.pit.completedStops,0);assert.equal(reset.pit.currentCompound,'medium');assert.equal(reset.pit.view.active,false);assert.equal(reset.pit.audio.activeSource,false);assert.equal(reset.valid,false);await shot('spa-service-reset-cancelled');await check('reset-cancels-without-free-tyres-or-counted-service',{before:cancelled.pit,after:reset.pit});
  await restart();await driveToEntrance(true);await page.keyboard.press('Escape');const duration=(await snap()).pit.serviceDuration;await page.locator('#restart').click();await page.waitForTimeout(150);const fresh=await snap();assert.equal(fresh.state,'countdown');assert.equal(fresh.pit.active,false);assert.equal(fresh.pit.completedStops,0);assert.equal(fresh.pit.serviceDuration,0);assert.equal(fresh.pit.view.active,false);assert.equal(fresh.pit.audio.activeSource,false);await check('restart-clears-the-active-visit-and-its-single-duration-draw',{previousDraw:duration,fresh:fresh.pit});
  await page.keyboard.press('Escape');await page.locator('#garage-back').click();assert.equal((await snap()).state,'menu');assert.equal((await snap()).pit.active,false);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed';await save();console.log(JSON.stringify({status:'passed',checks:report.checks.length,scenarios:report.scenarios.length,output:out}));
}catch(error){report.status='failed';report.failure=String(error);report.last=await snap().catch(()=>null);report.drive=await page.evaluate(()=>window.__pitEntryDrive??null).catch(()=>null);console.error(error);process.exitCode=1;await shot('failure').catch(()=>{});await save();}finally{await browser.close();}
