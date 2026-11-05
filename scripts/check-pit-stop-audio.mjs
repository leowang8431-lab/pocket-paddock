/** Actual UI + Web Audio output checks for the recorded pit-stop effects.
 * Connects a read-only recorder to the existing output; never writes rig time,
 * replaces a source buffer, or synthesises an expected audio result. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const url=process.env.PP_URL??'http://127.0.0.1:5173/pit-stop.html';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/pit-stop-preview-v5');
await fs.mkdir(out,{recursive:true});
const report={version:5,status:'running',url,createdAt:new Date().toISOString(),method:'Real UI playback and AudioContext output captured through ScriptProcessor; actual canvas + output-track MediaRecorder. No transforms or playback clocks injected.',checks:[],errors:[],networkErrors:[],limitations:['Headless Chrome on this computer; no additional physical computer, speaker or controller tested.','Audio is recorded workshop Foley, not asserted to be actual Formula 1 team audio.']};
const save=()=>fs.writeFile(path.join(out,'audio-validation.json'),JSON.stringify(report,null,2));
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify(report.checks.at(-1)));};
const executablePath=process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();page.setDefaultTimeout(20000);
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
page.on('requestfailed',r=>{if(!r.url().endsWith('/favicon.ico'))report.networkErrors.push({url:r.url(),error:r.failure()?.errorText});});
const snap=()=>page.evaluate(()=>window.__PIT.snapshot());
const pause=async()=>{if((await snap()).playing)await page.locator('#pp-play').click();await page.waitForTimeout(100);assert.equal((await snap()).playing,false);};
const seek=async seconds=>{await pause();await page.locator('#pp-timeline').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},seconds);await page.waitForTimeout(80);assert.ok(Math.abs((await snap()).time-seconds)<.021);};
const volume=async value=>{await page.locator('#pp-volume').evaluate((input,v)=>{input.value=String(v);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);await page.waitForTimeout(80);};

async function installRecorder(){
  await page.evaluate(()=>{
    const audio=window.__PIT.audio,ctx=audio.audioContext,output=audio.output;
    if(!ctx||!output)throw new Error('The real audio output is unavailable.');
    const processor=ctx.createScriptProcessor(2048,2,2),silent=ctx.createGain();silent.gain.value=0;
    const chunks=[];
    processor.onaudioprocess=event=>{
      const input=event.inputBuffer;
      chunks.push({time:window.__PIT.snapshot().time,clock:ctx.currentTime,left:input.getChannelData(0).slice(),right:input.getChannelData(Math.min(1,input.numberOfChannels-1)).slice()});
    };
    output.connect(processor);processor.connect(silent);silent.connect(ctx.destination);
    const metrics=(lower=-Infinity,upper=Infinity)=>{
      const selected=chunks.filter(c=>c.time>=lower&&c.time<upper);let peak=0,sum=0,count=0;
      for(const c of selected)for(let i=0;i<c.left.length;i++){const l=c.left[i],r=c.right[i];peak=Math.max(peak,Math.abs(l),Math.abs(r));sum+=l*l+r*r;count+=2;}
      return{chunks:selected.length,samples:count,rms:count?Math.sqrt(sum/count):0,peak};
    };
    const wav=()=>{
      const frames=chunks.reduce((n,c)=>n+c.left.length,0),buffer=new ArrayBuffer(44+frames*4),v=new DataView(buffer);
      const str=(at,text)=>{for(let i=0;i<text.length;i++)v.setUint8(at+i,text.charCodeAt(i));};
      str(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,ctx.sampleRate,true);v.setUint32(28,ctx.sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*4,true);
      let at=44;for(const c of chunks)for(let i=0;i<c.left.length;i++)for(const x of [c.left[i],c.right[i]]){v.setInt16(at,Math.round(Math.max(-1,Math.min(1,x))*32767),true);at+=2;}
      const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
    };
    let recorder=null,videoChunks=[],videoDone=null,videoStream=null,videoDestination=null;
    const startVideo=()=>{
      const canvas=document.querySelector('#pit-viewport canvas');videoStream=canvas.captureStream(30);videoDestination=ctx.createMediaStreamDestination();output.connect(videoDestination);for(const track of videoDestination.stream.getAudioTracks())videoStream.addTrack(track);
      const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mimeType)throw new Error('No WebM + audio recorder available.');
      videoChunks=[];recorder=new MediaRecorder(videoStream,{mimeType,videoBitsPerSecond:3500000,audioBitsPerSecond:128000});recorder.ondataavailable=e=>{if(e.data.size)videoChunks.push(e.data);};videoDone=new Promise(resolve=>recorder.onstop=resolve);recorder.start(200);return{mimeType,videoTracks:videoStream.getVideoTracks().length,audioTracks:videoStream.getAudioTracks().length};
    };
    const stopVideo=async()=>{
      if(!recorder)return null;recorder.stop();await videoDone;output.disconnect(videoDestination);for(const track of videoStream.getTracks())track.stop();
      const bytes=new Uint8Array(await new Blob(videoChunks,{type:recorder.mimeType}).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
    };
    let watchedPlayback=null;
    const armPlaybackClock=()=>{
      const watch={startedAt:null,firstAnimationTime:null,endedAt:null,wallSeconds:null,rate:null,duration:null,startPoseTime:null,endPoseTime:null};watchedPlayback=watch;
      const observe=()=>{
        if(watchedPlayback!==watch)return;const s=window.__PIT.snapshot();
        if(watch.startedAt===null&&s.playing){watch.startedAt=performance.now();watch.firstAnimationTime=s.time;watch.rate=s.rate;watch.duration=s.duration;watch.startPoseTime=s.rig?.time??null;}
        if(watch.startedAt!==null&&!s.playing&&s.time>=s.duration-.001){watch.endedAt=performance.now();watch.wallSeconds=(watch.endedAt-watch.startedAt)/1000+watch.firstAnimationTime/watch.rate;watch.endPoseTime=s.rig?.time??null;return;}
        requestAnimationFrame(observe);
      };requestAnimationFrame(observe);
    };
    window.__PIT_AUDIO_RECORDER={reset:()=>{chunks.length=0;},metrics,wav,startVideo,stopVideo,armPlaybackClock,playbackClock:()=>watchedPlayback,sampleRate:ctx.sampleRate};
  });
}
async function resetRecording(){await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.reset());}
async function recordedMetrics(milliseconds=300){await resetRecording();await page.waitForTimeout(milliseconds);return page.evaluate(()=>window.__PIT_AUDIO_RECORDER.metrics());}
function assertSilent(m,label){assert.ok(m.samples>0,`${label}: audio processing did not run`);assert.ok(m.peak<.0001,`${label}: output still sounds (peak ${m.peak})`);}

try{
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__PIT?.snapshot().ready,undefined,{timeout:40000});
  const initial=await snap();assert.equal(initial.playing,false);assert.equal(initial.audio.activeSource,false);assert.equal(initial.rate,1);assert.equal(initial.duration,2.6);assert.equal(Number(await page.locator('#pp-timeline').getAttribute('max')),2.6);
  await page.locator('#pp-loop').uncheck();await page.locator('#pp-rate').selectOption('1');
  await page.locator('#pp-play').click();
  await page.waitForFunction(()=>{const s=window.__PIT.snapshot().audio;return s.ready&&s.unlocked&&s.activeSource;},undefined,{timeout:30000});
  const unlocked=await snap();assert.equal(unlocked.audio.contextState,'running');assert.equal(unlocked.audio.scoreDuration,2.6);
  assert.equal(unlocked.audio.error,null);await pause();await installRecorder();
  check('real-play-gesture-unlocks-and-decodes-workshop-recordings',{initial:initial.audio,unlocked:unlocked.audio});

  // Record one whole, uninterrupted UI replay at 1x, including actual output.
  await seek(0);await volume(60);await resetRecording();
  report.video=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.startVideo());
  await page.waitForTimeout(100);const beforeComplete=await snap();await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.armPlaybackClock());
  await page.locator('#pp-replay').click();
  await page.waitForFunction(()=>!window.__PIT.snapshot().playing&&window.__PIT.snapshot().time>2.599,undefined,{timeout:14000});
  await page.waitForTimeout(180);
  const complete=await snap();assert.equal(complete.audio.activeSource,false);const wallClock=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.playbackClock());assert.equal(wallClock.duration,2.6);assert.ok(wallClock.wallSeconds>=2.3&&wallClock.wallSeconds<=3.2,`A normal pit stop lasted ${wallClock.wallSeconds}s instead of about 2.6s`);assert.ok(Math.abs(complete.rig.time-8)<.001,'A short UI timer did not actually finish the complete model animation');
  const recording=await page.evaluate(()=>({total:window.__PIT_AUDIO_RECORDER.metrics(),before:window.__PIT_AUDIO_RECORDER.metrics(0,.08),unlock:window.__PIT_AUDIO_RECORDER.metrics(.36,.65),remove:window.__PIT_AUDIO_RECORDER.metrics(1.17,1.34),tighten:window.__PIT_AUDIO_RECORDER.metrics(1.90,2.15),gunContinuity:[...[[.36,.45],[.45,.55],[.55,.65]].map(([a,b])=>({action:'unlock',from:a,to:b,...window.__PIT_AUDIO_RECORDER.metrics(a,b)})),...[[1.9,1.98],[1.98,2.06],[2.06,2.15]].map(([a,b])=>({action:'tighten',from:a,to:b,...window.__PIT_AUDIO_RECORDER.metrics(a,b)}))],sampleRate:window.__PIT_AUDIO_RECORDER.sampleRate,wav:window.__PIT_AUDIO_RECORDER.wav()}));
  const video=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.stopVideo());
  await fs.writeFile(path.join(out,'pit-stop-live-output.wav'),Buffer.from(recording.wav,'base64'));delete recording.wav;
  await fs.writeFile(path.join(out,'pit-stop-with-sound.webm'),Buffer.from(video,'base64'));
  assert.ok(recording.total.rms>.001&&recording.total.peak>.01,'Captured output is silent');assert.ok(recording.total.peak<=1,'Audio clips');
  assertSilent(recording.before,'No added pre-action wind');const afterService=await recordedMetrics(180);assertSilent(afterService,'No lingering air bed after the service');recording.afterService=afterService;
  assert.ok(recording.unlock.rms>.001,'Unlock gun is inaudible');assert.ok(recording.tighten.rms>.001,'Tightening gun is inaudible');for(const bin of recording.gunContinuity){assert.ok(bin.samples>0,`Missing recorded ${bin.action} interval ${bin.from}–${bin.to}`);assert.ok(bin.rms>.001,`${bin.action} has a silent gap at ${bin.from}–${bin.to}s`);}
  assert.ok(complete.audio.starts-beforeComplete.audio.starts<=4,'Normal 1x playback repeatedly restarted the audio source');
  report.recording={...recording,wallClock,wav:'pit-stop-live-output.wav',video:'pit-stop-with-sound.webm'};
  check('complete-2-6-second-replay-finishes-all-model-actions-with-continuous-recorded-gun-work',report.recording);

  // A second real UI pass preserves a slower review, without altering the
  // normal 2.6-second stop or fabricating audio during video export.
  await seek(0);await page.locator('#pp-rate').selectOption('0.5');await resetRecording();
  const reviewFormat=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.startVideo());await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.armPlaybackClock());
  await page.locator('#pp-replay').click();await page.waitForFunction(()=>!window.__PIT.snapshot().playing&&window.__PIT.snapshot().time>2.599,undefined,{timeout:10000});await page.waitForTimeout(180);
  const reviewClock=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.playbackClock()),reviewAudio=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.metrics());
  assert.ok(reviewClock.wallSeconds>=4.8&&reviewClock.wallSeconds<=5.8,`Half-speed review lasted ${reviewClock.wallSeconds}s`);assert.ok(reviewAudio.rms>.001,'Half-speed review lost the real audio output');
  const reviewVideo=await page.evaluate(()=>window.__PIT_AUDIO_RECORDER.stopVideo());await fs.writeFile(path.join(out,'pit-stop-half-speed-review.webm'),Buffer.from(reviewVideo,'base64'));
  report.halfSpeedReview={...reviewFormat,wallClock:reviewClock,audio:reviewAudio,video:'pit-stop-half-speed-review.webm'};await page.locator('#pp-rate').selectOption('1');
  check('half-speed-model-review-retains-synchronised-sound',report.halfSpeedReview);


  await seek(.38);assert.equal((await snap()).audio.activeSource,false);assertSilent(await recordedMetrics(),'Paused timeline seek');
  await page.locator('#pp-rate').selectOption('0.25');await page.locator('#pp-play').click();await page.waitForTimeout(140);
  const resumed=await snap();assert.equal(resumed.audio.activeSource,true);assert.equal(resumed.audio.rate,.25);assert.ok(Math.abs(resumed.time-resumed.audio.time)<.05);
  const resumedAudio=await recordedMetrics(350);assert.ok(resumedAudio.rms>.001,'Resume did not play from the selected gun position');
  await pause();assert.equal((await snap()).audio.activeSource,false);assertSilent(await recordedMetrics(),'Pause');
  check('paused-scrubbing-is-silent-and-resume-starts-from-the-selected-position',{resumed:resumed.audio,audible:resumedAudio});

  // Muting and volume zero silence the actual output, not only the UI flag.
  await seek(.38);await page.locator('#pp-play').click();await page.waitForTimeout(120);await page.locator('#pp-audio').click();await page.waitForTimeout(100);
  const muted=await snap();assert.equal(muted.audio.enabled,false);assert.equal(muted.audio.activeSource,false);assert.equal(await page.locator('#pp-audio').getAttribute('aria-pressed'),'false');assertSilent(await recordedMetrics(),'Sound toggle off');
  await pause();await seek(.38);await page.locator('#pp-audio').click();await page.locator('#pp-play').click();await page.waitForTimeout(140);assert.ok((await recordedMetrics(280)).rms>.001,'Sound did not recover after enabling');
  await volume(0);assert.equal((await snap()).audio.volume,0);assert.equal((await snap()).audio.activeSource,false);assertSilent(await recordedMetrics(),'Zero volume');await pause();
  await seek(.38);await volume(60);await page.locator('#pp-play').click();await page.waitForTimeout(140);assert.ok((await recordedMetrics(280)).rms>.001,'Sound did not recover after volume restore');await pause();
  check('sound-toggle-and-volume-zero-mute-real-output-and-restore-cleanly',{muted:muted.audio});

  const speedProof=[];
  for(const speed of ['0.5','0.25','1']){
    await seek(.38);await page.locator('#pp-rate').selectOption(speed);const before=await snap();await page.locator('#pp-play').click();await page.waitForTimeout(700);const after=await snap();
    assert.equal(after.audio.rate,Number(speed));assert.equal(after.audio.activeSource,true);assert.ok(Math.abs(after.time-after.audio.time)<.05);
    assert.ok(after.audio.starts-before.audio.starts<=3,`Stable ${speed}x playback retriggers continuously`);speedProof.push({speed,animationDelta:after.time-before.time,audio:after.audio});await pause();
  }
  await seek(.38);await page.locator('#pp-rate').selectOption('1');await page.locator('#pp-play').click();await page.waitForTimeout(100);const beforeChange=await snap();await page.locator('#pp-rate').selectOption('0.5');await page.waitForTimeout(100);const afterChange=await snap();assert.equal(afterChange.audio.rate,.5);assert.ok(afterChange.audio.generation>beforeChange.audio.generation);assert.ok(afterChange.time>beforeChange.time);await pause();
  check('quarter-half-full-speed-and-live-rate-changes-follow-the-animation-clock',{speeds:speedProof,change:afterChange.audio});

  await page.locator('#pp-loop').check();await page.locator('#pp-rate').selectOption('1');await seek(2.55);const beforeLoop=await snap();await page.locator('#pp-play').click();await page.waitForTimeout(500);const afterLoop=await snap();
  assert.equal(afterLoop.playing,true);assert.ok(afterLoop.time<1);assert.equal(afterLoop.audio.activeSource,true);assert.ok(afterLoop.audio.generation-beforeLoop.audio.generation>=2);assert.ok(afterLoop.audio.generation-beforeLoop.audio.generation<=3);await pause();await page.locator('#pp-loop').uncheck();
  check('loop-replaces-the-single-source-at-the-new-offset-without-stacking',{before:beforeLoop.audio,after:afterLoop.audio});

  await seek(.38);await page.locator('#pp-play').click();const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.waitForTimeout(200);const hidden=await page.evaluate(()=>document.hidden);
  if(hidden){assert.equal((await snap()).playing,false);assert.equal((await snap()).audio.activeSource,false);check('real-background-tab-pauses-animation-and-audio');}
  else{report.limitations.push('Headless tabs did not enter document.hidden when switching tabs; physical background-tab pausing was not verified.');}
  await other.close();await page.bringToFront();await pause();

  // Audio network failure is isolated from the car load and animation loop.
  const fallback=await context.newPage(),fallbackErrors=[];fallback.on('pageerror',e=>fallbackErrors.push(String(e)));
  await fallback.route('**/audio/pit-stop/**',route=>route.abort());await fallback.goto(url,{waitUntil:'networkidle'});await fallback.waitForFunction(()=>window.__PIT?.snapshot().ready,undefined,{timeout:40000});await fallback.locator('#pp-loop').uncheck();await fallback.locator('#pp-rate').selectOption('1');await fallback.locator('#pp-play').click();await fallback.waitForTimeout(650);
  const noAudio=await fallback.evaluate(()=>window.__PIT.snapshot());assert.equal(noAudio.ready,true);assert.equal(noAudio.playing,true);assert.ok(noAudio.time>.15);assert.equal(noAudio.audio.ready,false);assert.equal(noAudio.audio.status,'error');assert.equal(noAudio.audio.activeSource,false);assert.deepEqual(fallbackErrors,[]);await fallback.close();
  check('missing-recording-does-not-break-the-loaded-car-or-visual-animation',{audio:noAudio.audio,animationTime:noAudio.time});

  await seek(.52);await page.locator('[data-pit-camera=wheel]').click();await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'audio-wheel-closeup.png')});
  report.layouts=[];
  for(const [name,width,height]of [['desktop',1440,900],['portrait',391,844],['landscape',740,391]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(250);
    const layout=await page.evaluate(()=>{const ids=['pp-play','pp-replay','pp-timeline','pp-audio','pp-volume'],controls=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,controls};});
    assert.ok(layout.scrollWidth<=width+1,`${name} has horizontal overflow`);for(const c of layout.controls)assert.ok(c.x>=0&&c.right<=width+1&&c.width>0&&c.height>0,`${name} audio control outside horizontal bounds: ${c.id}`);report.layouts.push({name,...layout});await page.screenshot({path:path.join(out,`audio-layout-${name}.png`),fullPage:true});
  }
  check('audio-controls-fit-desktop-portrait-and-landscape-without-horizontal-overflow',{layouts:report.layouts.map(x=>x.name)});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed';await save();console.log(JSON.stringify({status:report.status,checks:report.checks.length,wav:report.recording.wav,video:report.recording.video,limitations:report.limitations}));
}catch(error){report.status='failed';report.failure=String(error);report.lastSnapshot=await snap().catch(()=>null);console.error(error);process.exitCode=1;await page.screenshot({path:path.join(out,'audio-failure.png'),fullPage:true}).catch(()=>{});await save();}finally{await browser.close();}
