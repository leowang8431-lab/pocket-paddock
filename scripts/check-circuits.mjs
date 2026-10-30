/** Real circuit selector navigation, retained settings and rainy hill driving.
 * Requires Vite DEV diagnostics. No vehicle, checkpoint, speed or clock writes.
 * Optional: PP_URL, PP_OUTPUT, CHROME_PATH.
 */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve(process.env.PP_OUTPUT??'outputs/v12-circuits');await fs.mkdir(out,{recursive:true});
const url=process.env.PP_URL??'http://127.0.0.1:5173/?circuit=monza';
const report={status:'running',method:'Real select navigation, keyboard pedals and steering; read-only geometry diagnostics. No vehicle/progress/time writes.',limitations:['Automated keyboard driving; no physical controller or another computer used.','Screenshots may hide only the pause dialog to show the frozen rendered scene.'],checks:[],settings:[],drive:[],errors:[],networkErrors:[]};
const save=()=>fs.writeFile(path.join(out,'circuit-validation.json'),JSON.stringify(report,null,2));
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify(report.checks.at(-1)));};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(25000);
page.on('pageerror',error=>report.errors.push(String(error)));
page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
page.on('requestfailed',request=>{if(!request.url().endsWith('/favicon.ico'))report.networkErrors.push({url:request.url(),error:request.failure()?.errorText});});
await page.addInitScript(()=>{
  // A private fresh browser profile receives known board data. Existing user records are untouched.
  for(const [key,value]of Object.entries({'pocket-paddock.monza.v3.best':'91.125','pocket-paddock.monza.wet.v2.best':'102.25','pocket-paddock.spa.v1.best':'151.375','pocket-paddock.spa.wet.v1.best':'181.5'}))localStorage.setItem(key,value);
});
const settle=async()=>{await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready'&&!document.querySelector('#start').disabled);await page.waitForTimeout(300);};
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const settings=()=>page.evaluate(()=>({snapshot:window.__PP.snapshot(),title:document.title,header:document.querySelector('#circuit-title').textContent,labels:[...document.querySelectorAll('[data-circuit-code]')].map(n=>n.textContent),selector:document.querySelector('#circuit').value,circuitDataset:document.body.dataset.circuit,flag:getComputedStyle(document.querySelector('.italy')).backgroundImage,map:document.querySelector('#minimap').toDataURL(),menuBest:document.querySelector('#menu-best').textContent,selectedDriver:document.querySelector('[data-driver][aria-pressed=true]')?.dataset.driver,camera:document.querySelector('#camera-mode').value,language:document.querySelector('#language').value,weather:document.querySelector('#weather').value,quality:document.querySelector('#quality').value}));
const capture=async name=>{await page.screenshot({path:path.join(out,`${name}.png`),animations:'disabled'});};
async function selectCircuit(circuit){await page.locator('#circuit').selectOption(circuit);await page.waitForURL(u=>u.searchParams.get('circuit')===circuit);await settle();}
function assertSettings(s,circuit,wet=true){
  assert.equal(s.snapshot.circuit,circuit);assert.equal(s.selector,circuit);assert.equal(s.circuitDataset,circuit);
  assert.equal(s.snapshot.car.team,'ferrari');assert.equal(s.snapshot.car.driver,'lewis_hamilton_44');assert.equal(s.selectedDriver,'lewis_hamilton_44');
  assert.equal(s.snapshot.language,'en');assert.equal(s.snapshot.camera.mode,'close');assert.equal(s.camera,'close');assert.equal(s.quality,'balanced');
  assert.equal(s.snapshot.weather.mode,wet?'rainy':'sunny');assert.equal(s.weather,wet?'rainy':'sunny');
  assert.ok(s.labels.length>=2&&s.labels.every(label=>label===(circuit==='spa'?'SPA':'MONZA')));
  assert.match(s.header,circuit==='spa'?/SPA-FRANCORCHAMPS, BELGIUM/:/MONZA, ITALIA/);
  assert.match(s.title,circuit==='spa'?/Spa-Francorchamps/:/Monza/);
  const key=circuit==='spa'?wet?'pocket-paddock.spa.wet.v1.best':'pocket-paddock.spa.v1.best':wet?'pocket-paddock.monza.wet.v2.best':'pocket-paddock.monza.v3.best';
  assert.equal(s.snapshot.recordKey,key);assert.equal(s.snapshot.best,circuit==='spa'?wet?181.5:151.375:wet?102.25:91.125);
}
async function inspectGround(){
  return page.evaluate(()=>{
    const pp=window.__PP,s=pp.snapshot(),track=pp.track,car=pp.car.group,camera=pp.viewCamera,scene=car.parent;
    const rain=scene.getObjectByName('rain-streaks'),splashes=scene.getObjectByName('rain-road-splashes'),film=scene.getObjectByName('wet-asphalt-film');
    const grade=track.gradeAlongHeadingAt(s.x,s.z,s.heading),expected={carY:track.heightAt(s.x,s.z)+.11,pitch:-Math.atan(grade)};
    const ps=splashes.geometry.attributes.position;let splashError=0,minSplashY=Infinity,maxSplashY=-Infinity;
    for(let i=0;i<ps.count;i++){const x=splashes.position.x+ps.getX(i),z=splashes.position.z+ps.getZ(i),y=ps.getY(i)+splashes.position.y;minSplashY=Math.min(minSplashY,y);maxSplashY=Math.max(maxSplashY,y);splashError=Math.max(splashError,Math.abs(y-track.heightAt(x,z)-.115));}
    const matrix=car.matrix.clone();let filmError=0;
    for(let i=0;i<film.count;i+=9){film.getMatrixAt(i,matrix);const e=matrix.elements;filmError=Math.max(filmError,Math.abs(e[13]-track.heightAt(e[12],e[14])-.059));}
    return{snapshot:s,car:{x:car.position.x,y:car.position.y,z:car.position.z,pitch:car.rotation.x},expected,
      camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z,roadClearance:camera.position.y-track.heightAt(camera.position.x,camera.position.z),terrainClearance:camera.position.y-track.terrainHeightAt(camera.position.x,camera.position.z)},
      rain:{visible:rain.visible,count:rain.geometry.drawRange.count/2,worldY:rain.position.y,expectedY:car.position.y-.11,localHeightMin:Math.min(...rain.geometry.attributes.position.array.filter((_v,i)=>i%3===1)),localHeightMax:Math.max(...rain.geometry.attributes.position.array.filter((_v,i)=>i%3===1))},
      splashes:{visible:splashes.visible,count:ps.count,minY:minSplashY,maxY:maxSplashY,maxSurfaceError:splashError},film:{visible:film.visible,count:film.count,maxSurfaceError:filmError}};
  });
}
function assertGround(proof){
  assert.ok(Math.abs(proof.car.y-proof.expected.carY)<1e-7);assert.ok(Math.abs(proof.car.pitch-proof.expected.pitch)<1e-7);
  assert.ok(proof.camera.roadClearance>=.7999);assert.ok(proof.camera.terrainClearance>.2);
  assert.equal(proof.rain.visible,true);assert.ok(proof.rain.count>=320);assert.ok(Math.abs(proof.rain.worldY-proof.rain.expectedY)<1e-7);
  assert.equal(proof.splashes.visible,true);assert.equal(proof.splashes.count,180);assert.ok(proof.splashes.maxSurfaceError<.0001);
  assert.equal(proof.film.visible,true);assert.ok(proof.film.maxSurfaceError<.001);
}
async function driveTo(goal){
  await page.evaluate(goal=>{
    const game=window.__PP,held=new Set(),started=performance.now();window.__circuitDrive={done:false,goal,trace:[],maximumLateral:0,brakingFrames:0};let lastTrace=0;
    const key=(code,on)=>{if(on&&!held.has(code)){dispatchEvent(new KeyboardEvent('keydown',{code}));held.add(code);}if(!on&&held.has(code)){dispatchEvent(new KeyboardEvent('keyup',{code}));held.delete(code);}};
    const stop=(reason,s)=>{for(const code of held)dispatchEvent(new KeyboardEvent('keyup',{code}));window.__circuitDrive.done=true;window.__circuitDrive.reason=reason;window.__circuitDrive.last=s;};
    const tick=()=>{
      const s=game.snapshot(),track=game.track,near=track.nearest(s.x,s.z),lateral=Math.hypot(s.x-near.point.x,s.z-near.point.z),result=window.__circuitDrive;
      result.maximumLateral=Math.max(result.maximumLateral,lateral);
      if(performance.now()-lastTrace>1000){result.trace.push({distance:s.distance,time:s.elapsed,speed:s.speed,valid:s.valid,lateral,elevation:s.elevation,grade:s.grade});lastTrace=performance.now();}
      if(s.distance>=goal){stop('reached-hill',s);return;}if(performance.now()-started>120000){stop('timeout',s);return;}if(s.state!=='racing'){stop('unexpected-state',s);return;}
      const lookahead=4.5+Math.abs(s.speed)*.19,look=track.sampleAt(near.distance+lookahead),desired=Math.atan2(look.point.x-s.x,look.point.z-s.z),error=Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading));let target=35;
      for(let ahead=0;ahead<=85;ahead+=2.5){
        const a=track.sampleAt(near.distance+ahead),b=track.sampleAt(near.distance+ahead+2.5),curve=Math.acos(Math.max(-1,Math.min(1,a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z)))/2.5;
        const corner=Math.max(5.5,Math.min(35,Math.sqrt(4.7/Math.max(.0001,curve))));target=Math.min(target,Math.sqrt(corner*corner+30*Math.max(0,ahead-7)));
      }
      const required=(2*Math.abs(s.speed)*Math.sin(error)/lookahead)/Math.max(.01,game.steerYaw(Math.abs(s.speed))),braking=s.speed>target+.55;
      if(braking)result.brakingFrames++;key('KeyW',s.speed<target);key('KeyS',braking);key('KeyA',required>s.steering+.018);key('KeyD',required<s.steering-.018);requestAnimationFrame(tick);
    };tick();
  },goal);
  await page.waitForFunction(()=>window.__circuitDrive.done,undefined,{timeout:135000});const result=await page.evaluate(()=>window.__circuitDrive);report.drive.push(result);await save();assert.equal(result.reason,'reached-hill');return result;
}
try{
  await page.goto(url,{waitUntil:'networkidle'});await settle();assert.equal((await snapshot()).circuit,'monza');
  await page.locator('#team-select').selectOption('ferrari');await page.locator('[data-driver=lewis_hamilton_44]').click();await page.locator('#language').selectOption('en');await page.locator('#weather').selectOption('rainy');await page.locator('#camera-mode').selectOption('close');await page.locator('#quality').selectOption('balanced');await settle();
  const monza=await settings();assertSettings(monza,'monza');report.settings.push({...monza,map:undefined});await capture('monza-menu-settings');
  await selectCircuit('spa');const spa=await settings();assertSettings(spa,'spa');assert.notEqual(spa.map,monza.map,'Canvas minimap still shows the old circuit');assert.match(spa.flag,/rgb\(36, 37, 37\)/);report.settings.push({...spa,map:undefined});await capture('spa-menu-settings');check('Monza-to-Spa-selector-reload-retains-driver-language-weather-camera');
  await selectCircuit('monza');const returned=await settings();assertSettings(returned,'monza');assert.equal(returned.map,monza.map);assert.notEqual(returned.flag,spa.flag);report.settings.push({...returned,map:undefined});check('Spa-to-Monza-selector-reload-restores-Monza-title-flag-minimap');
  await page.locator('#weather').selectOption('sunny');await page.waitForTimeout(300);const monzaDry=await settings();assertSettings(monzaDry,'monza',false);report.settings.push({...monzaDry,map:undefined});
  await selectCircuit('spa');const spaDry=await settings();assertSettings(spaDry,'spa',false);report.settings.push({...spaDry,map:undefined});
  await page.locator('#language').selectOption('zh');await page.waitForTimeout(200);assert.equal(await page.locator('.track-pill strong').textContent(),'斯帕');assert.match(await page.locator('#circuit option:checked').textContent(),/斯帕.*比利时/);await page.locator('#language').selectOption('en');
  await page.locator('#weather').selectOption('rainy');await page.locator('#race-mode').selectOption('time-trial');await settle();assert.equal((await snapshot()).best,181.5);check('four-weather-circuit-boards-and-Spa-Chinese-English-labels');
  await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');assert.equal(await page.locator('#circuit').isDisabled(),true);
  await driveTo(665);await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.waitForTimeout(140);
  const uphill=await inspectGround();assertGround(uphill);assert.ok(uphill.car.pitch<-.075,'Actual car should visibly pitch uphill');report.uphill=uphill;
  const modalStyle=await page.addStyleTag({content:'#pause-modal{display:none!important}'});await capture('spa-rain-uphill-car');await modalStyle.evaluate(n=>n.remove());
  const frozen=await snapshot();await page.waitForTimeout(400);const still=await snapshot();for(const key of ['elapsed','x','z','speed','heading','distance','elevation'])assert.equal(still[key],frozen[key]);assert.deepEqual(still.powertrain,frozen.powertrain);assert.deepEqual(still.weather,frozen.weather);check('rainy-hill-player-mesh-camera-rain-and-splashes-follow-elevation-and-pause');
  await page.locator('#resume').click();await driveTo(935);await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.waitForTimeout(140);
  const crest=await inspectGround();assertGround(crest);assert.ok(crest.car.y>uphill.car.y+15);report.crest=crest;
  const crestStyle=await page.addStyleTag({content:'#pause-modal{display:none!important}'});await capture('spa-rain-kemmel-high-ground');await crestStyle.evaluate(n=>n.remove());
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed';check('rain-effects-also-follow-the-high-ground-with-no-console-or-loading-errors');await save();
}catch(error){report.status='failed';report.failure=String(error);report.lastSnapshot=await snapshot().catch(()=>null);report.lastDrive=await page.evaluate(()=>window.__circuitDrive).catch(()=>null);console.error(error);process.exitCode=1;await capture('failure').catch(()=>{});await save();}finally{await browser.close();}
