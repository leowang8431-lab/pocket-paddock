/** Browser regression of the supplied models. Start `npm run dev` first. */
import {chromium} from '@playwright/test';
import {Color,LinearSRGBColorSpace} from 'three';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const url=process.env.PP_URL??'http://127.0.0.1:5173/';
const output=path.resolve(process.env.PP_OUTPUT??'outputs/models-regression');
const palettes=JSON.parse(await fs.readFile('public/models/palettes.json','utf8'));
const parseCSV=text=>{const [header,...rows]=text.trim().split(/\r?\n/).map(line=>line.split(','));return rows.map(row=>Object.fromEntries(header.map((h,i)=>[h,row[i]])));};
const teams=parseCSV(await fs.readFile('public/models/teams_index.csv','utf8'));
const drivers=parseCSV(await fs.readFile('public/models/helmets_index.csv','utf8'));
const stem=file=>path.posix.basename(file,'.glb');
const hex=source=>`#${new Color().setRGB(...source.color.slice(0,3),LinearSRGBColorSpace).getHexString()}`;
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>{if(/\/models\/(car\.glb|helmet\.glb|palettes\.json)/.test(r.url()))requests.push(r.url());});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sceneResources=()=>page.evaluate(()=>{const g=new Set(),m=new Set();window.__PP.car.group.traverse(o=>{if(o.isMesh){g.add(o.geometry.uuid);for(const material of Array.isArray(o.material)?o.material:[o.material])m.add(material.uuid);}});return{geometries:[...g].sort(),materials:[...m].sort()};});
try{
 await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');
 await settle(); // Observe the first supplied-model render, after fallback disposal.
 assert.equal(await page.locator('#team-select option').count(),11);
 const resources=await sceneResources(),memory=(await snapshot()).renderer;
 for(let cycle=0;cycle<3;cycle++)for(const team of teams){
  await page.locator('#team-select').selectOption(team.team_key);
  for(const driver of drivers.filter(d=>d.team===team.team)){
   const id=stem(driver.glb);await page.locator(`[data-driver="${id}"]`).click();await settle();
   const s=await snapshot();assert.equal(s.state,'menu');assert.equal(s.car.team,team.team_key);assert.equal(s.car.driver,id);assert.equal(s.car.number,Number(driver.number));
   assert.equal(s.car.bodyColors.paint,hex(palettes.teams[team.team_key].paint));
   for(const key of ['helm_shell','helm_ring','helm_cap'])assert.equal(s.car.helmetColors[key],hex(palettes.helmets[id][key]));
   assert.equal(await page.locator(`[data-driver="${id}"]`).getAttribute('aria-pressed'),'true');
   if(cycle===0)checks.push({team:team.team_key,driver:id,number:s.car.number,body:s.car.bodyColors.paint,helmet:s.car.helmetColors});
  }
 }
 assert.deepEqual(await sceneResources(),resources,'switching reuses GPU geometry and materials');
 const after=(await snapshot()).renderer;
 assert.equal(after.geometries,memory.geometries);assert.equal(after.textures,memory.textures);
 assert.equal(requests.filter(r=>r.endsWith('car.glb')).length,1);assert.equal(requests.filter(r=>r.endsWith('helmet.glb')).length,1);assert.equal(requests.filter(r=>r.endsWith('palettes.json')).length,1);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready');
 assert.equal((await snapshot()).car.driver,'valtteri_bottas_77','selection persists');
 const wheelBefore=(await snapshot()).car.wheels;
 await page.locator('#start').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
 await page.keyboard.down('w');await page.waitForTimeout(1100);await page.keyboard.down('a');await page.waitForTimeout(220);await page.keyboard.up('w');await page.keyboard.up('a');
 const moving=await snapshot();assert.ok(moving.speed>5);assert.ok(moving.car.wheels.every((w,i)=>Math.abs(w.spin-wheelBefore[i].spin)>.01));assert.ok(moving.car.wheels.filter(w=>w.front).every(w=>Math.abs(w.steering)>.01));assert.ok(moving.car.wheels.filter(w=>!w.front).every(w=>w.steering===0));
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');const paused=await snapshot();await page.waitForTimeout(220);assert.deepEqual((await snapshot()).car.wheels,paused.car.wheels);
 await page.locator('#garage-back').click();await page.waitForFunction(()=>window.__PP.snapshot().state==='menu');
 await page.locator('#team-select').selectOption('ferrari');await page.locator('[data-driver="lewis_hamilton_44"]').click();await settle();await page.screenshot({path:path.join(output,'garage.png')});
 assert.deepEqual(errors,[]);
 // Slow initial requests exercise a second selection before models arrive.
 const delayed=await context.newPage();await delayed.route('**/models/*.glb',async route=>{await new Promise(resolve=>setTimeout(resolve,900));await route.continue();});
 await delayed.goto(url,{waitUntil:'domcontentloaded'});await delayed.waitForSelector('#team-select');
 if(await delayed.locator('#start').isDisabled()){
  await delayed.locator('#team-select').selectOption('mclaren');await delayed.locator('[data-driver="oscar_piastri_81"]').click();
  await delayed.waitForFunction(()=>window.__PP.snapshot().car.status==='ready');assert.equal(await delayed.evaluate(()=>window.__PP.snapshot().car.driver),'oscar_piastri_81');
 }else throw Error('Delayed-load test did not reach the loading state');
 await delayed.close();
 // Broken model delivery must leave a usable car, start button and driving.
 const fallbackContext=await browser.newContext(),fallback=await fallbackContext.newPage();
 await fallback.route('**/models/car.glb',r=>r.fulfill({status:503,body:'deliberate model failure'}));
 await fallback.goto(url,{waitUntil:'networkidle'});await fallback.waitForFunction(()=>window.__PP?.snapshot().car.status==='fallback');
 assert.ok(await fallback.locator('#start').isEnabled());assert.match(await fallback.locator('#model-status').textContent(),/原创/);
 await fallback.locator('#start').click();await fallback.waitForFunction(()=>window.__PP.snapshot().state==='racing');await fallback.keyboard.down('w');await fallback.waitForTimeout(800);await fallback.keyboard.up('w');assert.ok(await fallback.evaluate(()=>window.__PP.snapshot().speed)>5);await fallbackContext.close();
 const report={status:'passed',teamCount:11,driverCount:22,switchCount:66,checks,modelRequestsBeforeReload:3,sharedResources:true,memoryBefore:{geometries:memory.geometries,textures:memory.textures},memoryAfter:{geometries:after.geometries,textures:after.textures},selectionPersists:true,wheelSpinAndSteering:true,pauseFreezesWheels:true,latestSelectionDuringLoad:true,failedLoadStillPlayable:true,errors};
 await fs.writeFile(path.join(output,'models-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error(error);process.exitCode=1;}finally{await browser.close();}
