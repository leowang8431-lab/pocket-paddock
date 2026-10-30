/** Actual keyboard DRS deployment and complete-lap test, with no teleports. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/v06-drs');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
try{
 await page.goto(process.env.PP_URL??'http://127.0.0.1:5173/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');
 await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');await page.keyboard.down('w');await page.waitForFunction(()=>window.__PP.snapshot().drs.available);
 await page.keyboard.press('f');await page.waitForTimeout(180);const active=await snapshot();assert.equal(active.drs.active,true);assert.ok(active.car.drs.angle<-.2);assert.equal(active.drs.zone,2);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');const frozen=await snapshot();await page.waitForTimeout(250);assert.equal((await snapshot()).car.drs.angle,frozen.car.drs.angle);assert.equal((await snapshot()).elapsed,frozen.elapsed);
 await page.locator('#resume').click();await page.keyboard.down('s');await page.waitForTimeout(100);await page.keyboard.up('s');await page.keyboard.up('w');assert.equal((await snapshot()).drs.active,false);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.locator('#restart').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
 await page.evaluate(()=>{
  const game=window.__PP,held=new Set(),start=performance.now();
  const result=window.__drsPlayer={done:false,openedZones:[],maxSpeed:0,brakingFrames:0,maxOffset:0,trace:[]};
  const key=(code,on)=>{if(on&&!held.has(code)){window.dispatchEvent(new KeyboardEvent('keydown',{code}));held.add(code);}if(!on&&held.has(code)){window.dispatchEvent(new KeyboardEvent('keyup',{code}));held.delete(code);}};
  let previousTrace=0;
  const step=()=>{
   const s=game.snapshot(),track=game.track,near=track.nearest(s.x,s.z),speed=Math.abs(s.speed),lookahead=7+speed*.24;
   result.maxOffset=Math.max(result.maxOffset,Math.hypot(s.x-near.point.x,s.z-near.point.z));result.maxSpeed=Math.max(result.maxSpeed,s.speed);
   if(s.completed||performance.now()-start>160000||s.state!=='racing'){
    held.forEach(code=>window.dispatchEvent(new KeyboardEvent('keyup',{code})));result.done=true;result.last=s;result.lap=game.race.result;return;
   }
   const target=track.sampleAt(near.distance+lookahead),wanted=Math.atan2(target.point.x-s.x,target.point.z-s.z),error=Math.atan2(Math.sin(wanted-s.heading),Math.cos(wanted-s.heading));
   let targetSpeed=s.drs.available?44.5:40;
   for(let ahead=0;ahead<=75;ahead+=4){const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+4),curvature=Math.acos(Math.max(-1,Math.min(1,a.tangent.dot(b.tangent))))/4;const local=Math.max(8,Math.min(44.5,Math.sqrt(8.3/Math.max(.0001,curvature))));targetSpeed=Math.min(targetSpeed,Math.sqrt(local*local+42*Math.max(0,ahead-8)));}
   const required=2*speed*Math.sin(error)/lookahead/Math.max(.01,game.steerYaw(speed)),braking=s.speed>targetSpeed+.8;
   key('KeyW',s.speed<targetSpeed);key('KeyS',braking);key('KeyA',required>s.steering+.025);key('KeyD',required<s.steering-.025);
   if(braking)result.brakingFrames++;
   if(s.drs.available&&!s.drs.active&&!braking&&s.brakePressure===0){window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}));}
   if(s.drs.active&&!result.openedZones.includes(s.drs.zone))result.openedZones.push(s.drs.zone);
   if(performance.now()-previousTrace>1000){result.trace.push({distance:s.distance,speed:s.speed,drs:s.drs});previousTrace=performance.now();}
   requestAnimationFrame(step);
  };step();
 });
 await page.waitForFunction(()=>window.__drsPlayer.done,{},{timeout:180000});const result=await page.evaluate(()=>window.__drsPlayer);
 assert.equal(result.lap?.valid,true);assert.deepEqual([...result.openedZones].sort(),[1,2]);assert.ok(result.maxSpeed>41);assert.ok(result.brakingFrames>0);await page.screenshot({path:path.join(out,'valid-drs-lap.png')});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.locator('#weather').selectOption('rainy');await page.locator('#resume').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
 await page.keyboard.down('w');await page.waitForTimeout(1450);await page.keyboard.press('f');await page.keyboard.up('w');assert.equal((await snapshot()).drs.active,false);assert.equal((await snapshot()).drs.state,'wet');
 assert.deepEqual(errors,[]);const report={status:'passed',manualOpenAndBrakeClose:true,pausedFlapFrozen:true,rainDisabled:true,...result,errors};await fs.writeFile(path.join(out,'drs-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,trace:undefined}));
}catch(error){console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,state:await snapshot().catch(()=>null),player:await page.evaluate(()=>window.__drsPlayer??null).catch(()=>null)},null,2));}finally{await browser.close();}
