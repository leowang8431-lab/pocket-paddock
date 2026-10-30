/** Integration checks for weather, localization, scene details and pause rules.
 * Run against Vite DEV after `npm run dev`. No vehicle position writes. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const url=process.env.PP_URL??'http://127.0.0.1:5173/';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/monza-weather-regression');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
await context.addInitScript(()=>{if(!localStorage.getItem('experience-test-seed')){localStorage.setItem('experience-test-seed','1');localStorage.setItem('pocket-paddock.monza.v3.best','61.5');localStorage.setItem('pocket-paddock.monza.wet.v2.best','79.4');}});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const record=(name,data={})=>{checks.push({name,...data});console.log(JSON.stringify(checks.at(-1)));};
const screenshot=name=>page.screenshot({path:path.join(out,`${name}.png`)});
try{
 await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');
 const initial=await snapshot();assert.equal(initial.weather.mode,'sunny');assert.equal(initial.best,61.5);assert.ok(initial.weather.wetSurfaces>=2);
 const landmarks=await page.evaluate(()=>window.__PP.landmarks);assert.ok(landmarks.some(l=>l.id==='hospitality-tower'));assert.ok(landmarks.some(l=>l.id==='pit-building'));record('monza-landmarks-and-road-bindings',{landmarks:landmarks.map(l=>l.id)});
 await page.locator('#language').selectOption('en');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.locator('#start').textContent(),/track/i);
 await page.locator('#team-select').selectOption('mercedes');await page.locator('[data-driver="kimi_antonelli_12"]').click();
 assert.match(await page.locator('[data-driver="kimi_antonelli_12"] strong').textContent(),/Antonelli/);
 await page.locator('#weather').selectOption('rainy');await tick();const wet=await snapshot();
 assert.equal(wet.weather.mode,'rainy');assert.equal(wet.best,79.4);assert.match(wet.recordKey,/wet/);assert.ok(wet.weather.rainParticles>0);assert.equal(wet.state,'menu');
 assert.match(await page.locator('#toast').textContent(),/Rainy/);assert.match(await page.locator('#menu-best').textContent(),/1:19\.400/);
 await screenshot('rainy-english-garage');record('weather-and-language',{language:wet.language,weather:wet.weather,best:wet.best});
 // Warm the rain buffers before checking repeated switching for resource growth.
 await page.waitForTimeout(300);const memory=(await snapshot()).renderer;
 for(let i=0;i<10;i++){await page.locator('#weather').selectOption(i%2?'rainy':'sunny');await page.locator('#language').selectOption(i%2?'en':'zh');await tick();}
 const after=(await snapshot()).renderer;assert.equal(after.geometries,memory.geometries);assert.equal(after.textures,memory.textures);record('weather-and-language-reuse-resources',{geometries:after.geometries,textures:after.textures});
 await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');assert.ok(await page.locator('#weather').isDisabled());
 await page.keyboard.down('w');await page.waitForTimeout(1700);await page.keyboard.up('w');assert.ok((await snapshot()).speed>10);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');const paused=await snapshot();await page.waitForTimeout(300);const frozen=await snapshot();
 assert.equal(frozen.elapsed,paused.elapsed);assert.equal(frozen.weather.elapsed,paused.weather.elapsed);assert.equal(frozen.x,paused.x);assert.deepEqual(frozen.car.wheels,paused.car.wheels);assert.ok(await page.locator('#weather').isEnabled());
 await page.locator('#language').selectOption('zh');assert.match(await page.locator('#resume').textContent(),/继续/);assert.equal((await snapshot()).elapsed,paused.elapsed);record('pause-freezes-rain-car-timer-and-language-switch');
 await page.locator('#weather').selectOption('sunny');const changed=await snapshot();assert.equal(changed.state,'paused');assert.equal(changed.elapsed,0);assert.equal(changed.best,61.5);assert.equal(changed.weather.rainParticles,0);assert.equal(changed.valid,true);assert.equal(changed.completed,0);assert.equal(changed.recordKey,'pocket-paddock.monza.v3.best');
 await page.locator('#language').selectOption('en');assert.match(await page.locator('#toast').textContent(),/Sunny/);assert.match(await page.locator('#toast').textContent(),/restarted/);record('weather-switch-restarts-attempt-and-restores-record');
 await page.locator('#resume').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');await page.keyboard.press('r');assert.equal((await snapshot()).valid,false);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');await page.locator('#garage-back').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='menu');
 await page.locator('#weather').selectOption('rainy');await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');const persisted=await snapshot();
 assert.equal(persisted.weather.mode,'rainy');assert.equal(persisted.language,'en');assert.equal(persisted.car.driver,'kimi_antonelli_12');assert.equal(persisted.best,79.4);record('settings-and-separate-records-persist');
 for(const viewport of [{width:391,height:844},{width:740,height:391},{width:1440,height:720}]){
  await page.setViewportSize(viewport);await tick();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const selector of ['#language','#weather','#quality']){const bounds=await page.locator(selector).boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);}
  await page.locator('#start').scrollIntoViewIfNeeded();const button=await page.locator('#start').boundingBox();assert.ok(button&&button.y>=0&&button.y+button.height<=viewport.height);await screenshot(`layout-${viewport.width}x${viewport.height}`);
 }
 record('responsive-settings-and-start');assert.deepEqual(errors,[]);record('browser-errors',{errors});
 await fs.writeFile(path.join(out,'experience-validation.json'),JSON.stringify({status:'passed',checks,limitations:'Automated Chrome; not measured on a real phone or every GPU.'},null,2));
}catch(error){console.error(error);process.exitCode=1;await screenshot('failure').catch(()=>{});await fs.writeFile(path.join(out,'experience-failure.json'),JSON.stringify({error:String(error),errors,state:await snapshot().catch(()=>null)},null,2));}finally{await browser.close();}
