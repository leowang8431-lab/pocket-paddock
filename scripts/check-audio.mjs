/** Render the actual recording-derived mechanical graph offline. No runtime
 * audio downloads, random noise or air layer. Output is a game demonstration
 * using processed CC0 recording cycles, not an unmodified F1 onboard track. */
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/v11-audio');await fs.mkdir(out,{recursive:true});

/** Hann-windowed, averaged power spectrum of the actual rendered PCM. This
 * measures sound energy, independently of the oscillator target parameters. */
function spectrum(pcm,sampleRate,start,end){
 const size=4096,power=new Float64Array(size/2+1);let windows=0;
 for(let offset=Math.ceil(start*sampleRate);offset+size<=Math.floor(end*sampleRate);offset+=size/2){
  const real=new Float64Array(size),imag=new Float64Array(size);
  for(let i=0;i<size;i++)real[i]=pcm[offset+i]*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));
  for(let i=1,j=0;i<size;i++){
   let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
   if(i<j)[real[i],real[j]]=[real[j],real[i]];
  }
  for(let span=2;span<=size;span*=2){
   const angle=-2*Math.PI/span,stepR=Math.cos(angle),stepI=Math.sin(angle);
   for(let base=0;base<size;base+=span){
    let wr=1,wi=0;
    for(let j=0;j<span/2;j++){
     const a=base+j,b=a+span/2,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];
     real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
     const next=wr*stepR-wi*stepI;wi=wr*stepI+wi*stepR;wr=next;
    }
   }
  }
  for(let bin=0;bin<power.length;bin++)power[bin]+=real[bin]**2+imag[bin]**2;
  windows++;
 }
 assert.ok(windows>0,'Spectrum window has insufficient PCM');
 let total=0,weighted=0,low=0,upper=0,dominant=0,textureTotal=0,textureLog=0,textureBins=0;
 for(let bin=1;bin<power.length;bin++){
  const hz=bin*sampleRate/size;if(hz<35||hz>10000)continue;
  const energy=power[bin];total+=energy;weighted+=energy*hz;
  if(hz<400)low+=energy;if(hz>=1200)upper+=energy;
  if(hz<=2500){textureTotal+=energy;textureLog+=Math.log(Math.max(1e-20,energy));textureBins++;}
  if(energy>(power[dominant]??0)||dominant===0)dominant=bin;
 }
 assert.ok(total>0);
 return{windows,binHz:sampleRate/size,centroidHz:weighted/total,dominantHz:dominant*sampleRate/size,below400Share:low/total,above1200Share:upper/total,flatness35to2500:Math.exp(textureLog/textureBins)/(textureTotal/textureBins)};
}
function readMono16Wav(bytes){
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
 let format,data;
 for(let offset=12;offset+8<=bytes.length;){
  const id=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),body=offset+8;
  if(id==='fmt ')format={codec:bytes.readUInt16LE(body),channels:bytes.readUInt16LE(body+2),sampleRate:bytes.readUInt32LE(body+4),bits:bytes.readUInt16LE(body+14)};
  if(id==='data')data=bytes.subarray(body,body+length);
  offset=body+length+(length%2);
 }
 assert.ok(format&&data);assert.equal(format.codec,1);assert.equal(format.channels,1);assert.equal(format.bits,16);
 const pcm=Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2));return{...format,pcm};
}

const bundle=await build({entryPoints:['src/audio.ts'],bundle:true,write:false,format:'iife',globalName:'PocketEngine',platform:'browser'});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),headless:true});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.setContent('<html><body>Engine synthesis validation</body></html>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
   const {Powertrain,EngineVoice,EngineAudio,engineTimbre,ENGINE_RECORDING_REFERENCE}=PocketEngine,sampleRate=44100,duration=13,dt=1/120;
   const context=new OfflineAudioContext(1,sampleRate*duration,sampleRate),nodes={buffers:0,bufferSources:0,periodicWaves:0,oscillators:[],filters:[]};
   for(const [method,key]of [['createBuffer','buffers'],['createBufferSource','bufferSources'],['createPeriodicWave','periodicWaves']]){
     const original=context[method].bind(context);context[method]=(...args)=>{nodes[key]++;return original(...args);};
   }
   for(const [method,key]of [['createOscillator','oscillators'],['createBiquadFilter','filters']]){
     const original=context[method].bind(context);context[method]=(...args)=>{const node=original(...args);nodes[key].push(node);return node;};
   }
   const voice=new EngineVoice(context),p=new Powertrain(),trace=[];
   // Constructing or setting the live controller never opens an AudioContext.
   const mutedLive=new EngineAudio();mutedLive.setPowertrain(p.summary,true);const beforeGesture=mutedLive.summary;
   let lastSerial=0;
   for(let i=0;i<duration/dt;i++){
     const t=i*dt;let speed=0,throttle=0,brake=0,active=t>=.45&&!(t>=11.2&&t<12);
     if(t>=1&&t<2.2)throttle=Math.min(1,(t-1)*2);
     if(t>=2.2&&t<8.4){speed=Math.min(40,(t-2.2)*6.5);throttle=1;}
     if(t>=8.4&&t<10.6){speed=40*(1-(t-8.4)/2.2);brake=1;}
     if(t>=12){speed=(t-12)*5;throttle=1;}
     const state=p.update(active?dt:0,{speed,throttle,brake,active});voice.apply(state,active,t,false);
     if(state.shiftSerial!==lastSerial){trace.push({time:t,gear:state.gear,rpm:state.rpm,targetRpm:state.targetRpm,shift:state.shift,cut:state.torqueCut,blip:state.revBlip});lastSerial=state.shiftSerial;}
   }
   const buffer=await context.startRendering(),samples=buffer.getChannelData(0);
   const rms=(start,end)=>{let sum=0;for(let i=Math.floor(start*sampleRate);i<Math.floor(end*sampleRate);i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/((end-start)*sampleRate));};
   let peak=0,nonFinite=0;for(const value of samples){peak=Math.max(peak,Math.abs(value));if(!Number.isFinite(value))nonFinite++;}
   const pcm=new Int16Array(samples.length);for(let i=0;i<samples.length;i++)pcm[i]=Math.round(Math.max(-1,Math.min(1,samples[i]))*32767);
   // A separate fixed-RPM probe must repeat mechanical cycles accurately.
   // Random air layers would lower this cycle correlation, irrespective of EQ.
   const probeContext=new OfflineAudioContext(1,sampleRate,sampleRate),probeVoice=new EngineVoice(probeContext);
   const probeState={...new Powertrain().summary,rpm:9000,load:.8,throttle:.8,startBurst:0,launch:0};
   probeVoice.apply(probeState,true,0,false);const probe=(await probeContext.startRendering()).getChannelData(0),lag=sampleRate/engineTimbre(probeState,true).cycleHz;
   let xy=0,xx=0,yy=0;
   for(let i=Math.ceil(sampleRate*.5);i<sampleRate-Math.ceil(lag)-1;i++){
     const at=i+lag,k=Math.floor(at),v=probe[k]*(1-at+k)+probe[k+1]*(at-k);xy+=probe[i]*v;xx+=probe[i]**2;yy+=v*v;
   }
   const structure={buffers:nodes.buffers,bufferSources:nodes.bufferSources,periodicWaves:nodes.periodicWaves,oscillatorTypes:nodes.oscillators.map(n=>n.type),filterTypes:nodes.filters.map(n=>n.type),voice:voice.summary};
   return{sampleRate,duration,peak,nonFinite,structure,cycleCorrelation:xy/Math.sqrt(xx*yy),recording:ENGINE_RECORDING_REFERENCE,rms:{idle:rms(.7,.95),stationaryRev:rms(1.7,2.1),accelerating:rms(5,6),muted:rms(11.5,11.9),relaunch:rms(12.5,12.9)},beforeGesture,trace,pcm:Array.from(pcm)};
 });
 assert.equal(result.nonFinite,0);assert.ok(result.peak>.02&&result.peak<.9);assert.ok(result.rms.stationaryRev>result.rms.idle*1.5);assert.ok(result.rms.accelerating>.015);assert.ok(result.rms.muted<.00001);assert.ok(result.rms.relaunch>.02);
 assert.equal(result.structure.buffers,0);assert.equal(result.structure.bufferSources,0);assert.equal(result.structure.periodicWaves,2);assert.deepEqual(result.structure.oscillatorTypes,['custom','custom']);assert.ok(!result.structure.filterTypes.includes('bandpass'));assert.ok(result.cycleCorrelation>.995,'The fixed-RPM output must repeat real mechanical cycles without an independent random bed');
 assert.equal(result.beforeGesture.context,'not-created');assert.equal(result.beforeGesture.enabled,false);assert.ok(result.trace.filter(s=>s.shift==='up').length>=6);assert.ok(result.trace.filter(s=>s.shift==='down').length>=5);assert.deepEqual(errors,[]);
 const windows={idle:[.7,.95],stationaryRev:[1.7,2.1],accelerating:[5,6],relaunch:[12.5,12.9]};
 result.spectrum=Object.fromEntries(Object.entries(windows).map(([name,[start,end]])=>[name,spectrum(result.pcm,result.sampleRate,start,end)]));
 // Old previews are deliverables, not runtime assets. When the 0.9 WAV is
 // available, compare identical generated driving events without needing Git,
 // external recordings or a second audio graph in the game.
 const baselineFile=path.resolve(process.env.PP_AUDIO_BASELINE??'outputs/v09-audio/Pocket-Paddock-engine-preview.wav');
 let baselineBytes;try{baselineBytes=await fs.readFile(baselineFile);}catch(error){if(error.code!=='ENOENT'||process.env.PP_AUDIO_BASELINE)throw error;}
 if(baselineBytes){
  const baseline=readMono16Wav(baselineBytes);assert.equal(baseline.sampleRate,result.sampleRate);assert.equal(baseline.pcm.length,result.pcm.length);
  const previous=Object.fromEntries(Object.entries(windows).map(([name,[start,end]])=>[name,spectrum(baseline.pcm,baseline.sampleRate,start,end)]));
  const comparisons=Object.fromEntries(Object.keys(windows).map(name=>[name,{centroidRatio:result.spectrum[name].centroidHz/previous[name].centroidHz,previous:previous[name],current:result.spectrum[name]}]));
  // Spectral flatness is descriptive, not a quality target: increasing it
  // rewarded the hiss that the user explicitly asked us to remove. Structural
  // no-noise and deterministic-cycle tests above validate the actual goal.
  result.previousSoundComparison={file:baselineFile,method:'Same 13-second generated scenario, Hann 4096 FFT, overlapping windows; power-weighted centroid between 35 and 10000 Hz.',comparisons};
 }else result.previousSoundComparison={file:baselineFile,available:false,note:'The optional prior preview WAV is absent; this run validates current rendered signal, not a before/after comparison.'};
 const pcm=Buffer.alloc(result.pcm.length*2);result.pcm.forEach((value,i)=>pcm.writeInt16LE(value,i*2));const header=Buffer.alloc(44);
 header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(result.sampleRate,24);header.writeUInt32LE(result.sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
 const file=path.join(out,'Pocket-Paddock-engine-preview.wav');await fs.writeFile(file,Buffer.concat([header,pcm]));delete result.pcm;
 const report={status:'passed',method:'Actual OfflineAudioContext render of the same recording-derived, periodic-only EngineVoice used by the game.',...result,wav:file,errors};await fs.writeFile(path.join(out,'audio-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser.close();}
