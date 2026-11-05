/** Recorded workshop effects sequenced against the pit animation's absolute clock.
 * No procedural air/wind layer, music, or race-broadcast samples are added. */
import {PIT_STOP_DURATION,toPitRaceTime} from './pit-stop-timing';
export type PitSoundKind='wheel-gun'|'jack'|'tyre';
export interface PitPcm {samples:Float32Array;sampleRate:number;}
export interface PitSoundCue {kind:PitSoundKind;time:number;duration:number;gain:number;pan:number;action:string;corner?:string;}
export const PIT_STOP_AUDIO_DURATION=PIT_STOP_DURATION;
const corners=[{id:'front-left',delay:0,pan:-.55},{id:'front-right',delay:.07,pan:.55},{id:'rear-left',delay:.12,pan:-.38},{id:'rear-right',delay:.035,pan:.38}] as const;
/** Map contact windows, not playback speed: each recording retains its original
 * pitch at 1x. Pose 1.85 starts withdrawal; 5.55 finishes returning to the hub. */
const contact=(start:number,end:number)=>({time:toPitRaceTime(start),duration:toPitRaceTime(end)-toPitRaceTime(start)});
const cues:PitSoundCue[]=[
  {kind:'jack',...contact(.68,.98),gain:.38,pan:-.10,action:'lift-front'},
  {kind:'jack',...contact(.76,1.06),gain:.30,pan:.10,action:'lift-rear'},
  ...corners.flatMap(({id,delay,pan}):PitSoundCue[]=>[
    {kind:'wheel-gun',...contact(1.22+delay,1.84+delay),gain:.55,pan,action:'unlock',corner:id},
    {kind:'tyre',time:toPitRaceTime(3.35+delay),duration:.14,gain:.27,pan,action:'old-tyre-ground',corner:id},
    {kind:'tyre',time:toPitRaceTime(5.10+delay),duration:.12,gain:.14,pan,action:'new-tyre-seated',corner:id},
    {kind:'wheel-gun',...contact(5.56+delay,6.28+delay),gain:.52,pan,action:'tighten',corner:id},
  ]),
  {kind:'jack',...contact(6.45,6.75),gain:.25,pan:-.08,action:'lower'},
  {kind:'tyre',time:toPitRaceTime(7.20),duration:.12,gain:.32,pan:0,action:'car-ground'},
];
export const PIT_STOP_AUDIO_CUES:readonly PitSoundCue[]=cues.sort((a,b)=>a.time-b.time);

/** Re-time the recorded actions for this stop, without stretching the waveform
 * or changing its original pitch. A long stop sustains the mechanical burst. */
export function pitStopAudioCues(duration=PIT_STOP_AUDIO_DURATION):PitSoundCue[]{
  if(!Number.isFinite(duration)||duration<2||duration>4)throw new Error('Pit stop duration must be between 2 and 4 seconds.');
  const scale=duration/PIT_STOP_AUDIO_DURATION;
  return PIT_STOP_AUDIO_CUES.map(cue=>({...cue,time:cue.time*scale,duration:cue.kind==='wheel-gun'?Math.min(.64,cue.duration*scale):cue.duration*scale}));
}

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
/** Linear resampling retains each real recording's pitch. Short envelopes trim
 * tails cleanly; the final shared gain preserves relative level without clipping. */
export function mixPitStopScore(sounds:Record<PitSoundKind,PitPcm>,sampleRate=32000,duration=PIT_STOP_AUDIO_DURATION){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Invalid pit audio sample rate.');
  const stopCues=pitStopAudioCues(duration);
  const length=Math.ceil(duration*sampleRate),left=new Float32Array(length),right=new Float32Array(length);
  for(const cue of stopCues){
    const sound=sounds[cue.kind];
    if(!sound||!sound.samples.length||!Number.isFinite(sound.sampleRate)||sound.sampleRate<=0)throw new Error(`Missing pit recording: ${cue.kind}`);
    const start=Math.round(cue.time*sampleRate),count=Math.min(Math.round(cue.duration*sampleRate),Math.floor(sound.samples.length*sampleRate/sound.sampleRate),length-start);
    const angle=(clamp(cue.pan,-1,1)+1)*Math.PI/4,lg=Math.cos(angle)*cue.gain,rg=Math.sin(angle)*cue.gain;
    const fade=Math.max(1,Math.round(.006*sampleRate));
    for(let i=0;i<count;i++){
      const at=i*sound.sampleRate/sampleRate,index=Math.floor(at),fraction=at-index;
      const a=sound.samples[index]??0,b=sound.samples[Math.min(index+1,sound.samples.length-1)]??0;
      const envelope=Math.min(1,i/fade,(count-1-i)/fade),value=(a+(b-a)*fraction)*envelope;
      if(!Number.isFinite(value))continue;
      left[start+i]+=value*lg;right[start+i]+=value*rg;
    }
  }
  let peak=0;for(let i=0;i<length;i++)peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
  const normalization=peak>.90?.90/peak:1;
  if(normalization!==1)for(let i=0;i<length;i++){left[i]*=normalization;right[i]*=normalization;}
  return {left,right,sampleRate,duration,peak:peak*normalization,normalization};
}

type AudioStatus='idle'|'loading'|'locked'|'ready'|'unsupported'|'error'|'disposed';
/** One score source follows the same clock as the visual animation. Pausing or
 * scrubbing stops it immediately; resuming starts at the new absolute offset. */
export class PitStopAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private source:AudioBufferSourceNode|null=null;
  private score:AudioBuffer|null=null;
  private decoded:Record<PitSoundKind,PitPcm>|null=null;
  private duration=PIT_STOP_AUDIO_DURATION;
  private scoreBuilds=0;
  private preparation:Promise<void>|null=null;
  private enabled=true;
  private volume=.6;
  private status:AudioStatus='idle';
  private error:string|null=null;
  private generation=0;
  private starts=0;
  private stops=0;
  private anchorTime=0;
  private anchorClock=0;
  private sourceRate=1;
  private lastTime=0;
  private disposed=false;

  private ensureContext(){
    if(this.disposed)return null;
    if(this.context)return this.context;
    const Constructor=globalThis.AudioContext??(globalThis as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Constructor){this.status='unsupported';return null;}
    try{
      this.context=new Constructor({latencyHint:'interactive'});this.master=this.context.createGain();
      this.master.gain.value=this.volume;this.master.connect(this.context.destination);return this.context;
    }catch(error){this.error=String(error);this.status='error';return null;}
  }

  /** Optional preload. Rejection is captured so a missing effect never stops 3D. */
  prepare():Promise<void>{
    if(this.preparation)return this.preparation;
    if(this.score||this.disposed)return Promise.resolve();
    const context=this.ensureContext();if(!context)return Promise.resolve();
    this.status='loading';this.error=null;
    this.preparation=(async()=>{
      const base=import.meta.env?.BASE_URL??'./';
      const entries=await Promise.all((['wheel-gun','jack','tyre'] as const).map(async kind=>{
        const response=await fetch(`${base}audio/pit-stop/${kind}.wav`);if(!response.ok)throw new Error(`Pit audio ${kind}: HTTP ${response.status}`);
        const buffer=await context.decodeAudioData(await response.arrayBuffer());
        const mono=new Float32Array(buffer.length);for(let channel=0;channel<buffer.numberOfChannels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/buffer.numberOfChannels;}
        return [kind,{samples:mono,sampleRate:buffer.sampleRate}] as const;
      }));
      if(this.disposed)return;
      this.decoded=Object.fromEntries(entries) as Record<PitSoundKind,PitPcm>;
      this.rebuildScore();
      this.status=context.state==='running'?'ready':'locked';
    })().catch(error=>{if(!this.disposed){this.error=String(error);this.status='error';}}).finally(()=>{this.preparation=null;});
    return this.preparation;
  }

  /** Call directly from click/keyboard/touch, before awaiting anything else. */
  async unlock():Promise<void>{
    const context=this.ensureContext();if(!context)return;
    try{if(context.state!=='running')await context.resume();if(this.disposed)return;await this.prepare();if(this.score)this.status=context.state==='running'?'ready':'locked';}
    catch(error){if(!this.disposed){this.error=String(error);this.status='error';}}
  }

  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.stop();}
  /** Set once when the controller samples a stop. Pausing never re-samples or
   * re-decodes recordings; normal frame updates reuse this exact score. */
  setDuration(seconds:number):void{
    const duration=clamp(Number.isFinite(seconds)?seconds:PIT_STOP_AUDIO_DURATION,2,4);
    if(Math.abs(duration-this.duration)<1e-9||this.disposed)return;
    this.stop();this.duration=duration;this.lastTime=Math.min(this.lastTime,duration);this.rebuildScore();
  }
  private rebuildScore(){
    if(!this.context||!this.decoded||this.disposed)return;
    const mix=mixPitStopScore(this.decoded,this.context.sampleRate,this.duration);
    this.score=this.context.createBuffer(2,mix.left.length,mix.sampleRate);this.score.copyToChannel(mix.left,0);this.score.copyToChannel(mix.right,1);this.scoreBuilds++;
  }
  setVolume(volume:number){this.volume=clamp(volume,0,1);if(this.master&&this.context){this.master.gain.cancelScheduledValues(this.context.currentTime);this.master.gain.setValueAtTime(this.volume,this.context.currentTime);}if(this.volume===0)this.stop();}
  private stop(){
    const source=this.source;if(!source)return;this.source=null;source.onended=null;
    try{source.stop();}catch{/* A completed source is already silent. */}source.disconnect();this.stops++;
  }
  sync(seconds:number,playing:boolean,rate:number){
    this.lastTime=clamp(seconds,0,this.duration);
    const context=this.context;
    if(this.disposed||!playing||!this.enabled||this.volume===0||!this.score||!context||context.state!=='running'||this.lastTime>=this.duration){this.stop();return;}
    const speed=clamp(rate,.25,2),expected=this.anchorTime+(context.currentTime-this.anchorClock)*this.sourceRate;
    if(this.source&&this.sourceRate===speed&&Math.abs(this.lastTime-expected)<.085)return;
    this.stop();
    try{
      const source=context.createBufferSource();source.buffer=this.score;source.playbackRate.value=speed;source.connect(this.master!);
      source.onended=()=>{if(this.source===source){this.source=null;source.disconnect();}};
      source.start(0,this.lastTime);this.source=source;this.anchorTime=this.lastTime;this.anchorClock=context.currentTime;this.sourceRate=speed;this.generation++;this.starts++;
    }catch(error){this.error=String(error);this.status='error';this.stop();}
  }
  /** Read-only output for an optional review recorder; no extra playback path. */
  get output():AudioNode|null{return this.master;}
  get audioContext():AudioContext|null{return this.context;}
  /** Copy the exact decoded stereo score for a review video or WAV export. */
  get scorePcm():{sampleRate:number;channels:[Float32Array,Float32Array]}|null{return this.score?{sampleRate:this.score.sampleRate,channels:[this.score.getChannelData(0).slice(),this.score.getChannelData(1).slice()]}:null;}
  get summary(){return {status:this.disposed?'disposed':this.status,ready:!!this.score,enabled:this.enabled,unlocked:this.context?.state==='running',contextState:this.context?.state??'unavailable',volume:this.volume,activeSource:!!this.source,generation:this.generation,starts:this.starts,stops:this.stops,time:this.lastTime,rate:this.sourceRate,duration:this.duration,scoreDuration:this.score?this.score.length/this.score.sampleRate:0,scoreBuilds:this.scoreBuilds,error:this.error};}
  dispose(){if(this.disposed)return;this.disposed=true;this.stop();this.master?.disconnect();this.score=null;this.decoded=null;this.master=null;const context=this.context;this.context=null;void context?.close().catch(()=>{});this.status='disposed';}
}
