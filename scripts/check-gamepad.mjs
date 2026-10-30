/** Synthetic standard Gamepad API checks; does not claim a physical pad test. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/v06-gamepad');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(()=>{
 window.__virtualPad={index:0,id:'Virtual Xbox Standard Controller',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0,pressed:false}))};window.__virtualConnected=true;
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__virtualConnected?[window.__virtualPad]:[]});
});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const snapshot=()=>page.evaluate(()=>window.__PP.snapshot());
const button=async(index,value)=>{await page.evaluate(({index,value})=>{window.__virtualPad.buttons[index]={value,pressed:value>.5};},{index,value});};
const press=async index=>{await button(index,1);await page.waitForTimeout(90);await button(index,0);await page.waitForTimeout(90);};
const check=(name,data={})=>{checks.push({name,...data});console.log(JSON.stringify(checks.at(-1)));};
try{
 await page.goto(process.env.PP_URL??'http://127.0.0.1:5173/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__PP?.snapshot().car.status==='ready'&&window.__PP.snapshot().gamepad.connected);
 assert.match(await page.locator('#gamepad-status').textContent(),/Virtual Xbox/);
 const original=(await snapshot()).car.team;await press(15);assert.notEqual((await snapshot()).car.team,original);await press(13);assert.equal((await snapshot()).car.driver,'isack_hadjar_06');
 check('controller-menu-team-and-driver-selection');await press(0);await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');
 await button(7,.28);await page.waitForTimeout(1100);const quarter=await snapshot();assert.ok(Math.abs(quarter.throttlePressure-.25)<.001);assert.ok(quarter.speed>1&&quarter.speed<12);
 await page.evaluate(()=>{window.__virtualPad.axes[0]=-.34;});await page.waitForTimeout(450);const steering=await snapshot();assert.ok(steering.steering>.23&&steering.steering<.26);
 await page.evaluate(()=>{window.__virtualPad.axes[0]=0;});await button(7,1);await page.waitForTimeout(1100);assert.ok((await snapshot()).speed>12);
 check('analog-triggers-and-stick',{quarterThrottle:quarter.throttlePressure,quarterSteering:steering.steering});
 await page.waitForFunction(()=>window.__PP.snapshot().drs.available);await press(2);await page.waitForTimeout(120);const open=await snapshot();assert.equal(open.drs.active,true);assert.ok(open.car.drs.angle<-.1);await page.screenshot({path:path.join(out,'gamepad-drs.png')});
 await button(6,.28);await page.waitForTimeout(220);assert.equal((await snapshot()).drs.active,false);assert.ok(Math.abs((await snapshot()).brakePressure-.25)<.001);await button(6,0);await button(7,0);
 check('gamepad-drs-and-brake-auto-close');
 await button(9,1);await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');const paused=await snapshot();await page.waitForTimeout(450);assert.equal((await snapshot()).state,'paused');assert.equal((await snapshot()).elapsed,paused.elapsed);assert.equal((await snapshot()).x,paused.x);await button(9,0);await page.waitForTimeout(100);
 await page.locator('#diagnostics').click();await page.locator('#diagnostics-modal').waitFor({state:'visible'});await press(0);assert.equal(await page.locator('#diagnostics-modal').isVisible(),false);assert.equal((await snapshot()).state,'paused');
 await press(0);await page.waitForFunction(()=>window.__PP.snapshot().state==='racing');await button(7,.6);await page.waitForTimeout(250);
 await page.evaluate(()=>{window.__virtualConnected=false;});await page.waitForFunction(()=>window.__PP.snapshot().state==='paused');const disconnected=await snapshot();assert.equal(disconnected.gamepad.connected,false);assert.equal(disconnected.throttlePressure,0);assert.equal(disconnected.brakePressure,0);assert.equal(disconnected.drs.active,false);await page.waitForTimeout(250);assert.equal((await snapshot()).x,disconnected.x);
 check('pause-edge-diagnostics-and-disconnect-safety');
 await button(9,1);await page.evaluate(()=>{window.__virtualConnected=true;});await page.waitForFunction(()=>window.__PP.snapshot().gamepad.connected);await page.waitForTimeout(200);assert.equal((await snapshot()).state,'paused','held Menu at reconnection cannot resume');await button(9,0);await button(7,0);await page.waitForTimeout(100);
 await press(1);await page.waitForFunction(()=>window.__PP.snapshot().state==='menu');await page.locator('#language').selectOption('en');assert.match(await page.locator('#gamepad-status').textContent(),/Virtual Xbox/);
 assert.deepEqual(errors,[]);check('reconnect-baseline-and-back-to-garage',{errors});
 await fs.writeFile(path.join(out,'gamepad-validation.json'),JSON.stringify({status:'passed',physicalControllerTested:false,method:'Injected standard Gamepad API; no vehicle/timer/checkpoint writes.',checks},null,2));
}catch(error){console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,state:await snapshot().catch(()=>null)},null,2));}finally{await browser.close();}
