/**
 * Browser regression for the local development build.
 * Start `npm run dev`, then run `node scripts/check-browser.mjs`.
 * Optional: PP_URL, CHROME_PATH, PP_OUTPUT and PP_TIMEOUT_MS environment variables.
 * The driving checks use keyboard events only: no position, timer or checkpoint writes.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL=process.env.PP_URL??'http://127.0.0.1:5173/';
const executablePath=process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const output=path.resolve(process.env.PP_OUTPUT??'outputs');
const timeout=Number(process.env.PP_TIMEOUT_MS??210000);
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const page=await context.newPage();
const errors=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const screenshot=name=>page.screenshot({path:path.join(output,`pocket-paddock-v2-${name}.png`)});
const record=async(check,data={})=>{
  const row={check,...data};results.push(row);console.log(JSON.stringify(row));
  await fs.writeFile(path.join(output,'browser-validation-v2.json'),JSON.stringify(results,null,2));
};

async function startRace(restart=false){
  if(restart){
    await page.keyboard.press('Escape');
    await page.locator('#restart').click();
  }else await page.locator('#start').click();
  await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
}

async function keyboardDrive(fullThrottle){
  await page.evaluate(({fullThrottle,timeout})=>{
    const game=window.__PP,held=new Set();
    const begun=performance.now();
    const state=window.__keyboardDrive={done:false,fullThrottle,maximumLateral:0,maximumGrip:0,brakingFrames:0,slidingFrames:0,trace:[],last:null};
    let previousTrace=0;
    const key=(code,on)=>{
      if(on&&!held.has(code)){window.dispatchEvent(new KeyboardEvent('keydown',{code}));held.add(code);}
      if(!on&&held.has(code)){window.dispatchEvent(new KeyboardEvent('keyup',{code}));held.delete(code);}
    };
    const stop=(reason,s)=>{
      for(const code of held)window.dispatchEvent(new KeyboardEvent('keyup',{code}));
      state.done=true;state.reason=reason;state.last=s;state.lapResult=game.race.result;
    };
    const controller=()=>{
      const now=performance.now(),s=game.snapshot(),track=game.track;
      const near=track.nearest(s.x,s.z);
      const lateral=Math.hypot(s.x-near.point.x,s.z-near.point.z);
      state.maximumLateral=Math.max(state.maximumLateral,lateral);
      state.maximumGrip=Math.max(state.maximumGrip,s.gripUsage??0);
      if(s.sliding)state.slidingFrames++;
      if(now-previousTrace>1000){state.trace.push({...s,lateral,wallSeconds:(now-begun)/1000});previousTrace=now;}
      if(s.completed>0){stop('lap-complete',s);return;}
      if(fullThrottle&&(!s.valid||s.collision>.5)){stop('off-track-or-impact',s);return;}
      if(now-begun>timeout){stop('timeout',s);return;}
      if(s.state!=='racing'){stop('unexpected-pause',s);return;}

      // This is an automated player, not a game assist. It reads the centerline
      // and sends the same four binary controls as a keyboard player.
      const lookahead=7+Math.abs(s.speed)*.24;
      const look=track.sampleAt(near.distance+lookahead);
      const desired=Math.atan2(look.point.x-s.x,look.point.z-s.z);
      const error=Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading));
      let targetSpeed=40;
      for(let ahead=0;ahead<=65;ahead+=4){
        const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+4);
        const curvature=Math.acos(Math.max(-1,Math.min(1,a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z)))/4;
        const localSpeed=Math.max(8,Math.min(40,Math.sqrt(8.3/Math.max(.0001,curvature))));
        targetSpeed=Math.min(targetSpeed,Math.sqrt(localSpeed*localSpeed+42*Math.max(0,ahead-8)));
      }
      const requestedYawAtFullSteer=(Math.abs(s.speed)/3.1)*Math.tan(.48)/(1+Math.abs(s.speed)*.055);
      const required=(2*Math.abs(s.speed)*Math.sin(error)/lookahead)/Math.max(.01,requestedYawAtFullSteer);
      const braking=!fullThrottle&&s.speed>targetSpeed+.8;
      if(braking)state.brakingFrames++;
      key('KeyW',fullThrottle||s.speed<targetSpeed);
      key('KeyS',braking);
      key('KeyA',required>s.steering+.025);
      key('KeyD',required<s.steering-.025);
      requestAnimationFrame(controller);
    };
    controller();
  },{fullThrottle,timeout});
}

try{
  await page.goto(baseURL,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__PP?.snapshot().state==='menu');
  await record('load',{state:await snapshot()});
  // Keyboard focus must select a livery without activating the global Enter shortcut.
  await page.locator('[data-livery="teal"]').focus();await page.keyboard.press('Enter');
  assert.equal((await snapshot()).state,'menu');
  assert.equal(await page.locator('[data-livery="teal"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-helmet="norris-2024"]').focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('[data-helmet="norris-2024"]').getAttribute('aria-pressed'),'true');
  await screenshot('garage');
  await record('keyboard-settings');

  // Overview is a DEV-only camera; it changes neither placement nor physics.
  const standAudit=await page.evaluate(()=>{
    const game=window.__PP;
    return {supported:typeof game.setOverview==='function',stands:game.stands??[]};
  });
  assert.ok(standAudit.supported,'DEV overview is available for scene QA');
  assert.ok(standAudit.stands.length>=5,'all stand placements are visible to the audit');
  const cleanView=await page.addStyleTag({content:'.menu-only,.topbar,.controls,.race-hud,.race-actions,.map-card,.telemetry,.toast{visibility:hidden!important}'});
  await page.evaluate(()=>window.__PP.setOverview('all'));await page.waitForTimeout(350);await screenshot('stands-overview');
  for(const stand of standAudit.stands){
    if(!/centrale|rettifilo|ascari/i.test(stand.id))continue;
    await page.evaluate(id=>window.__PP.setOverview(id),stand.id);await page.waitForTimeout(200);await screenshot(`stand-${stand.id}`);
  }
  await page.evaluate(()=>window.__PP.setOverview(null));await cleanView.evaluate(element=>element.remove());
  await record('stand-camera-audit',{stands:standAudit.stands});

  await startRace();
  await page.keyboard.down('w');await page.waitForTimeout(2000);await page.keyboard.up('w');
  const driving=await snapshot();assert.ok(driving.speed>10,'throttle accelerates');assert.ok(driving.distance>10,'car moves');
  await page.keyboard.down('a');await page.waitForTimeout(350);await page.keyboard.up('a');
  assert.ok(Math.abs((await snapshot()).heading-driving.heading)>.03,'left steering turns');
  await page.keyboard.press('Escape');await page.waitForTimeout(100);const frozen=await snapshot();await page.waitForTimeout(400);
  const paused=await snapshot();assert.equal(paused.state,'paused');assert.equal(paused.elapsed,frozen.elapsed);assert.equal(paused.x,frozen.x);assert.equal(paused.z,frozen.z);
  await page.locator('#resume').click();await page.keyboard.press('r');await page.waitForTimeout(100);
  const reset=await snapshot();assert.equal(reset.valid,false);assert.ok(reset.speed<1);await record('driving-pause-resume-reset',{state:reset});

  await startRace(true);await keyboardDrive(true);
  await page.waitForFunction(()=>window.__keyboardDrive.maximumGrip>1||window.__keyboardDrive.done,{},{timeout:60000});
  await screenshot('grip-limit');
  await record('grip-feedback',{text:await page.locator('#grip-label').textContent(),maximumGrip:await page.evaluate(()=>window.__keyboardDrive.maximumGrip)});
  await page.waitForFunction(()=>window.__keyboardDrive.done,{},{timeout});
  const fullThrottle=await page.evaluate(()=>window.__keyboardDrive);
  assert.equal(fullThrottle.brakingFrames,0,'no brake input in the full throttle attempt');
  assert.equal(fullThrottle.reason,'off-track-or-impact','full throttle requires a correction before a valid lap');
  assert.ok(fullThrottle.maximumLateral>8,'full throttle runs wide');
  assert.ok(fullThrottle.maximumGrip>1,'the car reaches its tire grip limit');
  assert.equal(fullThrottle.last.best,null,'a failed full-throttle attempt cannot save a best');
  await screenshot('full-throttle-wide');await record('full-throttle-fails',{...fullThrottle,trace:undefined});

  await startRace(true);await keyboardDrive(false);
  await page.waitForFunction(()=>window.__keyboardDrive.brakingFrames>0||window.__keyboardDrive.done,{},{timeout:60000});
  await screenshot('braking');
  await page.waitForFunction(()=>window.__keyboardDrive.done,{},{timeout});
  const braking=await page.evaluate(()=>window.__keyboardDrive);
  assert.equal(braking.reason,'lap-complete','planned braking finishes a complete lap');
  assert.ok(braking.brakingFrames>0,'the successful lap uses brakes');
  assert.equal(braking.lapResult.valid,true);assert.ok(braking.last.best>12);
  await screenshot('lap');await record('braking-valid-full-lap',{...braking,trace:undefined});

  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP);
  assert.equal((await snapshot()).best,braking.last.best);await record('best-persists-after-reload',{best:(await snapshot()).best});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#start').isVisible());
  assert.equal(await page.locator('.touch-controls').isVisible(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await startRace();assert.equal(await page.locator('.touch-controls').isVisible(),true);
  const throttle=await page.locator('[data-control="KeyW"]').boundingBox();assert.ok(throttle);
  await page.mouse.move(throttle.x+throttle.width/2,throttle.y+throttle.height/2);await page.mouse.down();await page.waitForTimeout(1000);await page.mouse.up();
  assert.ok((await snapshot()).speed>7,'pointer-held throttle accelerates');await screenshot('mobile');await record('mobile-pointer-controls');
  assert.deepEqual(errors,[]);await record('browser-errors',{errors,status:'passed'});
}catch(error){
  process.exitCode=1;console.error(error);
  await screenshot('failure').catch(()=>{});
  await record('failure',{message:String(error),errors,state:await snapshot().catch(()=>null)});
}finally{
  await context.close();await browser.close();
}
