import test from 'node:test';
import assert from 'node:assert/strict';
import {PitStopAudio,PIT_STOP_AUDIO_CUES,PIT_STOP_AUDIO_DURATION,mixPitStopScore,pitStopAudioCues,type PitPcm,type PitSoundKind} from '../src/pit-stop-audio.ts';
import {toPitPoseTime,toPitRaceTime} from '../src/pit-stop-timing.ts';

const recording=(value=1):PitPcm=>({sampleRate:16000,samples:Float32Array.from({length:16000},(_,i)=>Math.sin(i*.13)*value)});
const fixtures=():Record<PitSoundKind,PitPcm>=>({'wheel-gun':recording(),'jack':recording(.5),'tyre':recording(.7)});
const energy=(samples:Float32Array,start:number,end:number,rate:number)=>samples.slice(Math.round(start*rate),Math.round(end*rate)).reduce((sum,x)=>sum+x*x,0);

test('wheel-gun recordings occur only after lift or new-wheel insertion and before gun withdrawal at every staggered corner',()=>{
  for(const corner of ['front-left','front-right','rear-left','rear-right']){
    const cues=PIT_STOP_AUDIO_CUES.filter(c=>c.corner===corner),unlock=cues.find(c=>c.action==='unlock')!,tighten=cues.find(c=>c.action==='tighten')!,ground=cues.find(c=>c.action==='old-tyre-ground')!,seated=cues.find(c=>c.action==='new-tyre-seated')!;
    const delay=toPitPoseTime(seated.time)-5.1;
    assert.ok(toPitPoseTime(unlock.time)-delay>=1.2&&toPitPoseTime(unlock.time+unlock.duration)-delay<1.85);
    assert.ok(unlock.duration>.4,'Unlock must sustain mechanical pulses throughout the contact window');
    assert.ok(toPitPoseTime(tighten.time)-delay>=5.55&&toPitPoseTime(tighten.time+tighten.duration)-delay<=6.3);
    assert.ok(tighten.duration>.34,'Tightening must not collapse into a single click');
    assert.ok(toPitPoseTime(ground.time)-delay>=3.35-1e-8&&toPitPoseTime(seated.time)-delay>=5.1-1e-8);
  }
  assert.ok(PIT_STOP_AUDIO_CUES.every(c=>c.time+c.duration<=PIT_STOP_AUDIO_DURATION));
  assert.ok(!PIT_STOP_AUDIO_CUES.some(c=>c.time>=toPitRaceTime(7.8)),'The release light must not invent an electronic beep');
});

test('the stereo score preserves quiet handoff windows, recorded waveform content and shared peak headroom',()=>{
  const samples=fixtures(),original=samples['wheel-gun'].samples.slice(),mixed=mixPitStopScore(samples,32000);
  assert.equal(mixed.left.length,Math.round(2.6*32000));assert.equal(mixed.right.length,mixed.left.length);
  for(const [start,end]of [[0,.12],[.82,1.1],[1.36,1.60],[1.80,1.84],[2.36,2.47]]){
    assert.equal(energy(mixed.left,start,end,mixed.sampleRate),0);assert.equal(energy(mixed.right,start,end,mixed.sampleRate),0);
  }
  for(const cue of PIT_STOP_AUDIO_CUES)assert.ok(energy(mixed.left,cue.time,cue.time+cue.duration,mixed.sampleRate)>0);
  assert.ok(mixed.peak>0&&mixed.peak<=.900001);assert.ok(mixed.normalization>0&&mixed.normalization<=1);
  assert.notDeepEqual(mixed.left,mixed.right,'Slight left/right wheel placement should be audible');
  assert.deepEqual(samples['wheel-gun'].samples,original,'Mixing must not mutate the licensed source recording');
  assert.ok([...mixed.left,...mixed.right].every(Number.isFinite));
});

test('invalid recordings cannot create non-finite audio samples and missing inputs give an explicit diagnostic',()=>{
  const samples=fixtures();samples.jack={sampleRate:16000,samples:Float32Array.of(NaN,Infinity,-Infinity,0)};
  const mixed=mixPitStopScore(samples);assert.ok([...mixed.left,...mixed.right].every(Number.isFinite));
  samples.tyre={sampleRate:32000,samples:new Float32Array(0)};assert.throws(()=>mixPitStopScore(samples),/Missing pit recording: tyre/);
  assert.throws(()=>mixPitStopScore(fixtures(),0),/sample rate/);
});

class FakeBuffer {
  numberOfChannels:number;length:number;sampleRate:number;data:Float32Array[];
  constructor(channels:number,length:number,rate:number){this.numberOfChannels=channels;this.length=length;this.sampleRate=rate;this.data=Array.from({length:channels},()=>new Float32Array(length));}
  getChannelData(i:number){return this.data[i];}
  copyToChannel(data:Float32Array,i:number){this.data[i].set(data);}
}
class FakeSource {
  buffer:unknown;playbackRate={value:1};onended:(()=>void)|null=null;started:number[]|null=null;stopped=false;connected=false;
  connect(){this.connected=true;}disconnect(){this.connected=false;}start(when:number,offset:number){this.started=[when,offset];}stop(){this.stopped=true;}
}
class FakeContext {
  static latest:FakeContext;currentTime=0;sampleRate=32000;state='suspended';destination={};sources:FakeSource[]=[];
  constructor(){FakeContext.latest=this;}
  createGain(){return {gain:{value:0,cancelScheduledValues(){},setValueAtTime(){}},connect(){},disconnect(){}};}
  createBuffer(channels:number,length:number,rate:number){return new FakeBuffer(channels,length,rate);}
  decodeAudioData(){const b=new FakeBuffer(1,16000,16000);b.data[0].set(recording().samples);return Promise.resolve(b);}
  createBufferSource(){const source=new FakeSource();this.sources.push(source);return source;}
  resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
}
const mockAudio=async(run:()=>Promise<void>,fail=false)=>{
  const audioDescriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext'),originalFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,writable:true,value:FakeContext});
  globalThis.fetch=async()=>{if(fail)throw new Error('recording unavailable');return new Response(new ArrayBuffer(2));};
  try{await run();}finally{if(audioDescriptor)Object.defineProperty(globalThis,'AudioContext',audioDescriptor);else Reflect.deleteProperty(globalThis,'AudioContext');globalThis.fetch=originalFetch;}
};

test('pause, muted seek, resume, rate change and loop restart keep exactly one absolute-clock audio source',async()=>mockAudio(async()=>{
  const audio=new PitStopAudio();await audio.prepare();assert.equal(audio.summary.ready,true);assert.equal(audio.summary.unlocked,false);
  audio.sync(.4,true,.5);assert.equal(audio.summary.activeSource,false,'Preloading must not bypass the playback gesture');
  await audio.unlock();const context=FakeContext.latest;audio.sync(.4,true,.5);const first=context.sources.at(-1)!;assert.deepEqual(first.started,[0,.4]);
  for(let i=1;i<=60;i++){context.currentTime=i/60;audio.sync(.4+i/120,true,.5);}assert.equal(context.sources.length,1,'Normal animation frames must reuse the same source');
  audio.sync(.9,false,.5);assert.equal(first.stopped,true);assert.equal(audio.summary.activeSource,false);
  audio.sync(1.95,false,.5);assert.equal(context.sources.length,1,'A paused timeline seek is silent');
  audio.sync(1.95,true,.5);assert.deepEqual(context.sources.at(-1)!.started,[0,1.95]);
  audio.sync(1.95,true,1);assert.equal(context.sources.at(-2)!.stopped,true);assert.equal(context.sources.at(-1)!.playbackRate.value,1);
  audio.sync(.1,true,1);assert.deepEqual(context.sources.at(-1)!.started,[0,.1],'Looping restarts from the actual animation time');
  audio.setEnabled(false);assert.equal(audio.summary.activeSource,false);audio.sync(.4,true,1);const count=context.sources.length;assert.equal(audio.summary.activeSource,false);
  audio.setEnabled(true);audio.sync(.4,true,1);assert.equal(context.sources.length,count+1);
  audio.setVolume(0);assert.equal(audio.summary.activeSource,false);audio.setVolume(.5);audio.sync(PIT_STOP_AUDIO_DURATION,true,1);assert.equal(audio.summary.activeSource,false);
  const exportPcm=audio.scorePcm!;assert.equal(exportPcm.channels.length,2);exportPcm.channels[0].fill(0);assert.ok(audio.scorePcm!.channels[0].some(v=>v!==0),'An exported recording must be an isolated copy');
  audio.dispose();audio.dispose();assert.equal(audio.summary.status,'disposed');assert.equal(context.state,'closed');
}));

test('a missing effect reports an audio error while animation-clock calls remain safe and silent',async()=>mockAudio(async()=>{
  const audio=new PitStopAudio();await audio.prepare();assert.equal(audio.summary.ready,false);assert.equal(audio.summary.status,'error');assert.match(audio.summary.error!,/recording unavailable/);
  assert.doesNotThrow(()=>audio.sync(1.5,true,1));audio.dispose();
},true));

test('two-to-four-second stops retain contact timing, continuous recordings and the original sample pitch',()=>{
  const samples=fixtures(),sampleRate=32000;
  const atOnset=(duration:number)=>{
    const cue=pitStopAudioCues(duration).find(c=>c.action==='unlock')!,mix=mixPitStopScore(samples,sampleRate,duration),start=Math.round(cue.time*sampleRate);
    assert.equal(mix.left.length,Math.ceil(duration*sampleRate));assert.equal(mix.duration,duration);
    for(const action of ['unlock','tighten'])assert.equal(pitStopAudioCues(duration).filter(c=>c.action===action).length,4);
    for(const c of pitStopAudioCues(duration)){assert.ok(c.time>=0&&c.time+c.duration<=duration+1e-9);if(c.kind==='wheel-gun')assert.ok(c.duration<=.64);}
    // This interval precedes the next corner's staggered start even at 2s.
    // Equal wave samples across different stop lengths demonstrate that cue
    // times move while the original waveform is not sped up or stretched.
    return Float32Array.from(mix.left.slice(start+16,start+512),v=>v/mix.normalization);
  };
  const shortest=atOnset(2);for(const duration of [2.6,4]){const actual=atOnset(duration);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-shortest[i])<1e-6,'A stop duration changed the original waveform pitch');}
  assert.throws(()=>pitStopAudioCues(1.5),/between 2 and 4/);assert.throws(()=>pitStopAudioCues(5),/between 2 and 4/);
});

test('changing the sampled stop duration rebuilds once from cached recordings while pause and frame updates keep it fixed',async()=>mockAudio(async()=>{
  const originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async(...args)=>{requests++;return originalFetch(...args);};
  const audio=new PitStopAudio();audio.setDuration(4);await audio.prepare();await audio.unlock();assert.equal(requests,3);assert.equal(audio.summary.scoreDuration,4);
  const context=FakeContext.latest,builds=audio.summary.scoreBuilds;audio.sync(3.3,true,1);assert.deepEqual(context.sources.at(-1)!.started,[0,3.3]);
  for(let i=1;i<=24;i++){context.currentTime=i/120;audio.setDuration(4);audio.sync(3.3+i/120,true,1);}
  assert.equal(audio.summary.scoreBuilds,builds);audio.sync(3.5,false,1);assert.equal(audio.summary.duration,4);assert.equal(audio.summary.activeSource,false);
  audio.setDuration(2);assert.equal(audio.summary.scoreDuration,2);assert.equal(audio.summary.scoreBuilds,builds+1);assert.equal(requests,3);audio.sync(1.8,true,1);assert.deepEqual(context.sources.at(-1)!.started,[0,1.8]);audio.sync(2,true,1);assert.equal(audio.summary.activeSource,false);audio.dispose();
}));
