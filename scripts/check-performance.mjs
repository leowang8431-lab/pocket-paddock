/** Repeatable browser performance comparison. Run against the published version
 * before editing, then against local production/DEV after editing. This measures
 * this test machine, not a promise about another player's GPU or browser. */
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const args=Object.fromEntries(process.argv.slice(2).reduce((out,arg,i,all)=>{if(arg.startsWith('--'))out.push([arg.slice(2),all[i+1]]);return out;},[]));
const url=args.url??process.env.PP_PERF_URL??'https://pocket-paddock-monza.pluckybrush65.chatgpt.site/';
const label=args.label??'before';
const dprs=(args.dprs??'1,2').split(',').map(Number);
const cpu=Number(args.cpu??4),sampleMs=Number(args['sample-ms']??8000);
const executablePath=process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const outPath=path.resolve(args.output??`work/perf-${label}.json`);
const report={label,requestedURL:url,viewport:{width:1440,height:900},cpuThrottle:cpu,sampleMs,createdUTC:new Date().toISOString(),scenarios:[],limitations:'Headless Chrome on this machine. CDP CPU throttling is synthetic; this is not a real-phone or player-GPU FPS guarantee.'};
await fs.mkdir(path.dirname(outPath),{recursive:true});
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});
const quantile=(a,p)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor((b.length-1)*p))];};

async function measure(page,duration){
  return page.evaluate(duration=>new Promise(resolve=>{
    const started=performance.now(),samples=[],calls=[],triangles=[];
    let previous=0,lastCalls=window.__perfDraw.calls,lastTriangles=window.__perfDraw.triangles;
    const sample=now=>{
      if(previous){samples.push(now-previous);calls.push(window.__perfDraw.calls-lastCalls);triangles.push(window.__perfDraw.triangles-lastTriangles);}
      previous=now;lastCalls=window.__perfDraw.calls;lastTriangles=window.__perfDraw.triangles;
      if(now-started<duration){requestAnimationFrame(sample);return;}
      resolve({duration:now-started,frameIntervals:samples,drawCalls:calls,triangles,longTasks:window.__perfLongTasks.filter(e=>e.startTime>=started),snapshot:window.__PP?.snapshot?.()??null,quality:window.__PP?.quality??null,canvas:(()=>{const c=document.querySelector('#viewport canvas');return c?{width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight}:null;})(),domState:document.body.dataset.state,speedText:document.querySelector('#speed')?.textContent});
    };requestAnimationFrame(sample);
  }),duration);
}
function summarize(raw){
  const ms=raw.frameIntervals;
  const rendered=raw.drawCalls.filter(v=>v>0),renderedTriangles=raw.triangles.filter((_,i)=>raw.drawCalls[i]>0);
  let sinceRender=0;const renderIntervals=[];
  for(let i=0;i<ms.length;i++){sinceRender+=ms[i];if(raw.drawCalls[i]>0){renderIntervals.push(sinceRender);sinceRender=0;}}
  const intervalTotal=ms.reduce((a,b)=>a+b,0);
  return {sampleDurationMs:raw.duration,frames:ms.length,renderedFrames:rendered.length,medianFrameMs:quantile(ms,.5),p95FrameMs:quantile(ms,.95),meanFPS:ms.length?1000*ms.length/intervalTotal:0,renderedFPS:rendered.length?1000*rendered.length/intervalTotal:0,medianRenderedFrameMs:quantile(renderIntervals,.5),p95RenderedFrameMs:quantile(renderIntervals,.95),p95FPS:ms.length?1000/quantile(ms,.95):0,over33ms:ms.filter(v=>v>33.4).length,longTaskCount:raw.longTasks.length,longTaskTotalMs:raw.longTasks.reduce((n,e)=>n+e.duration,0),medianDrawCalls:quantile(rendered,.5),p95DrawCalls:quantile(rendered,.95),medianTriangles:quantile(renderedTriangles,.5),drawCallsPerSecond:intervalTotal?raw.drawCalls.reduce((a,b)=>a+b,0)*1000/intervalTotal:0,canvas:raw.canvas,domState:raw.domState,speedText:raw.speedText,snapshot:raw.snapshot,quality:raw.quality};
}

async function verifyControls(page){
  await page.locator('#pause').click();await page.waitForFunction(()=>document.body.dataset.state==='paused');
  const read=()=>page.evaluate(()=>({state:document.body.dataset.state,snapshot:window.__PP?.snapshot?.()??null,time:document.querySelector('#current-time')?.textContent,pixels:(()=>{const c=document.querySelector('#viewport canvas');return c.width*c.height;})(),selected:document.querySelector('#quality')?.value}));
  const frozen=await read();
  await page.locator('#quality').selectOption('performance');await page.waitForTimeout(300);const low=await read();
  await page.locator('#quality').selectOption('high');await page.waitForTimeout(300);const high=await read();
  assert.ok(high.pixels>low.pixels,'the quality selector changes the actual render resolution');
  assert.equal(high.state,'paused');assert.equal(high.time,frozen.time,'quality changes do not advance the paused clock');
  if(frozen.snapshot&&high.snapshot){assert.equal(high.snapshot.elapsed,frozen.snapshot.elapsed);assert.equal(high.snapshot.x,frozen.snapshot.x);assert.equal(high.snapshot.z,frozen.snapshot.z);}
  await page.locator('#quality').selectOption('auto');await page.waitForTimeout(250);const autoBefore=await read();
  // Synthetic sustained render pressure verifies the real frame monitor rather
  // than calling AdaptiveQuality.observe or mutating its internal state.
  await page.evaluate(()=>{window.__perfSyntheticLoad=true;function load(){if(!window.__perfSyntheticLoad)return;const start=performance.now();while(performance.now()-start<40){}requestAnimationFrame(load);}requestAnimationFrame(load);});
  try{
    await page.locator('#resume').click();await page.waitForTimeout(6500);
  }finally{await page.evaluate(()=>{window.__perfSyntheticLoad=false;});}
  const autoAfter=await read();
  assert.ok(autoAfter.pixels<autoBefore.pixels,'automatic quality lowers rendering load after sustained slow frames');
  await page.locator('#pause').click();await page.waitForFunction(()=>document.body.dataset.state==='paused');
  await page.locator('#quality').selectOption('performance');await page.reload({waitUntil:'networkidle'});await page.locator('#start').waitFor({state:'visible'});
  assert.equal(await page.locator('#quality').inputValue(),'performance','manual quality persists on reload');
  return{qualitySwitch:true,pauseFrozen:true,automaticDowngrade:true,manualChoicePersists:true,lowPixels:low.pixels,highPixels:high.pixels,autoPixelsBefore:autoBefore.pixels,autoPixelsAfter:autoAfter.pixels,method:'6.5s of a synthetic 40ms rAF workload; no physics or quality-state mutation'};
}

try{
  for(const dpr of dprs){
    const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:dpr});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{
      window.__perfDraw={calls:0,triangles:0};window.__perfLongTasks=[];
      try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__perfLongTasks.push({startTime:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
      for(const proto of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype]){
        if(!proto)continue;
        for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
          const original=proto[name];if(!original||original.__perfWrapped)continue;
          const wrapped=function(...args){
            window.__perfDraw.calls++;
            const count=name.startsWith('drawElements')?args[1]:args[2];
            const instances=name.endsWith('Instanced')?(name==='drawElementsInstanced'?args[4]:args[3]):1;
            if(args[0]===4)window.__perfDraw.triangles+=count/3*instances;
            return Reflect.apply(original,this,args);
          };wrapped.__perfWrapped=true;proto[name]=wrapped;
        }
      }
    });
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
    const response=await page.goto(url,{waitUntil:'networkidle',timeout:45000});
    await page.waitForSelector('#start',{state:'visible',timeout:20000});
    await page.locator('#loading').waitFor({state:'hidden',timeout:20000});
    await page.waitForTimeout(1500);
    const environment=await page.evaluate(()=>{
      const canvas=document.querySelector('#viewport canvas');const gl=canvas?.getContext('webgl2')??canvas?.getContext('webgl');const debug=gl?.getExtension('WEBGL_debug_renderer_info');
      return {title:document.title,dpr:devicePixelRatio,userAgent:navigator.userAgent,webglRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),webglVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl?.getParameter(gl.VENDOR),resources:performance.getEntriesByType('resource').filter(e=>/\.js(?:\?|$)/.test(e.name)).map(e=>e.name)};
    });
    const menu=summarize(await measure(page,Math.min(4000,sampleMs)));
    await page.locator('#start').click();await page.waitForFunction(()=>document.body.dataset.state==='racing',{},{timeout:20000});
    await page.keyboard.down('w');
    const drivingPromise=measure(page,sampleMs);
    await page.waitForTimeout(Math.min(4500,sampleMs*.55));await page.keyboard.down('a');await page.waitForTimeout(220);await page.keyboard.up('a');
    const driving=summarize(await drivingPromise);await page.keyboard.up('w');
    const controls=args['verify-controls']==='true'?await verifyControls(page):null;
    const scenario={dpr,finalURL:page.url(),httpStatus:response?.status(),environment,menu,driving,controls,errors};report.scenarios.push(scenario);
    await fs.writeFile(outPath,JSON.stringify(report,null,2));console.log(JSON.stringify(scenario));
    await context.close();
  }
}catch(error){report.error=String(error);console.error(error);process.exitCode=1;}
finally{await fs.writeFile(outPath,JSON.stringify(report,null,2));await browser.close();}
