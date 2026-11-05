import {Powertrain,engineTimbre,type PowertrainState} from './powertrain';
import {ENGINE_CYCLE_BANK,ENGINE_RECORDING_REFERENCE} from './engine-cycles';
export {Powertrain,engineTimbre} from './powertrain';
export {ENGINE_CYCLE_BANK,ENGINE_RECORDING_REFERENCE} from './engine-cycles';
export type {PowertrainInput,PowertrainState} from './powertrain';

/** Two rich mechanical cycle shapes extracted from a real licensed recording.
 * No noise buffer, air layer, random generator or audible sine oscillator.
 * Slow, inaudible controls gently vary combustion pitch and level at high RPM. */
export class EngineVoice {
  readonly output:GainNode;
  private readonly bodies:OscillatorNode[]=[];
  private readonly gains:GainNode[]=[];
  private readonly highpass:BiquadFilterNode;
  private readonly engineFilter:BiquadFilterNode;
  private readonly resonance:BiquadFilterNode;
  private readonly combustion:GainNode;
  private readonly flutterControls:OscillatorNode[]=[];
  private readonly flutterAmplitude:GainNode[]=[];
  private readonly flutterPitch:GainNode[]=[];
  private readonly compressor:DynamicsCompressorNode;
  private disposed=false;
  constructor(private readonly context:BaseAudioContext){
    this.output=context.createGain();this.output.gain.value=0;
    this.compressor=context.createDynamicsCompressor();this.compressor.threshold.value=-14;
    this.compressor.knee.value=17;this.compressor.ratio.value=3.4;this.compressor.attack.value=.003;this.compressor.release.value=.095;
    this.output.connect(this.compressor);this.compressor.connect(context.destination);
    this.highpass=context.createBiquadFilter();this.highpass.type='highpass';this.highpass.frequency.value=24;this.highpass.Q.value=.55;
    this.engineFilter=context.createBiquadFilter();this.engineFilter.type='lowpass';this.engineFilter.frequency.value=1000;this.engineFilter.Q.value=.55;
    this.resonance=context.createBiquadFilter();this.resonance.type='peaking';this.resonance.frequency.value=300;this.resonance.Q.value=.85;this.resonance.gain.value=2;
    this.combustion=context.createGain();this.combustion.gain.value=1;
    this.highpass.connect(this.resonance);this.resonance.connect(this.engineFilter);this.engineFilter.connect(this.combustion);this.combustion.connect(this.output);
    for(const cycle of ENGINE_CYCLE_BANK){
      const oscillator=context.createOscillator(),gain=context.createGain();gain.gain.value=0;
      oscillator.setPeriodicWave(context.createPeriodicWave(Float32Array.from(cycle.real),Float32Array.from(cycle.imag),{disableNormalization:true}));
      oscillator.connect(gain);gain.connect(this.highpass);oscillator.start();this.bodies.push(oscillator);this.gains.push(gain);
    }
    // These two oscillators only drive AudioParams. They add no audible tone
    // or hiss; their different rhythms prevent a flat sustained engine note.
    for(const hz of [8.9,12.7]){
      const control=context.createOscillator(),amplitude=context.createGain(),pitch=context.createGain();
      control.frequency.value=hz;amplitude.gain.value=pitch.gain.value=0;
      control.connect(amplitude);amplitude.connect(this.combustion.gain);
      control.connect(pitch);for(const body of this.bodies)pitch.connect(body.detune);
      control.start();this.flutterControls.push(control);this.flutterAmplitude.push(amplitude);this.flutterPitch.push(pitch);
    }
  }
  /** replace=false is only for chronological OfflineAudioContext scheduling. */
  apply(state:PowertrainState,audible:boolean,when=this.context.currentTime,replace=true){
    if(this.disposed)return;const tone=engineTimbre(state,audible),time=Math.max(0,when);
    const target=(param:AudioParam,value:number,tau:number)=>{
      if(replace){if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(time);else param.cancelScheduledValues(time);}
      param.setTargetAtTime(value,time,tau);
    };
    for(const oscillator of this.bodies)target(oscillator.frequency,tone.cycleHz,.018);
    target(this.gains[0].gain,tone.bodyGain,.025);target(this.gains[1].gain,tone.loadGain,.035);
    target(this.engineFilter.frequency,tone.filterHz,.045);
    target(this.resonance.frequency,tone.resonanceHz,.04);target(this.resonance.gain,tone.resonanceDb,.04);
    target(this.output.gain,tone.volume,audible?.025:.012);
    const smooth=(value:number)=>{const x=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));return x*x*(3-2*x);};
    // The normal top-speed cruise is around 12,500 RPM, below the absolute
    // redline. Keep its small mechanical flutter audible without requiring DRS.
    const upperRegister=smooth((state.rpm-11200)/1400),load=smooth((state.load-.2)/.65);
    const flutter=audible?upperRegister*load*(1-.85*smooth(state.torqueCut)):0;
    for(let i=0;i<this.flutterControls.length;i++){
      target(this.flutterAmplitude[i].gain,flutter*[.055,.022][i],.08);
      target(this.flutterPitch[i].gain,flutter*[4.8,1.8][i],.08);
    }
  }
  silence(when=this.context.currentTime){if(!this.disposed){this.output.gain.cancelScheduledValues(when);this.output.gain.setTargetAtTime(0,when,.012);}}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    for(const source of this.bodies){try{source.stop();}catch{}source.disconnect();}
    for(const source of this.flutterControls){try{source.stop();}catch{}source.disconnect();}
    for(const gain of this.gains)gain.disconnect();
    for(const gain of [...this.flutterAmplitude,...this.flutterPitch])gain.disconnect();
    this.highpass.disconnect();this.resonance.disconnect();this.engineFilter.disconnect();this.combustion.disconnect();this.output.disconnect();this.compressor.disconnect();
  }
  get summary(){return{source:'CC0-recording-derived-mechanical-cycles',mechanicalWaveforms:ENGINE_CYCLE_BANK.length,airLayers:0,noiseBuffers:0,highRpmFlutter:{onsetRpm:11200,fullRpm:12600,controlHz:[8.9,12.7],maxLevelDepth:.077,maxPitchCents:6.6},reference:ENGINE_RECORDING_REFERENCE.source};}
}

export class EngineAudio {
  enabled=false;private ctx?:AudioContext;private voice?:EngineVoice;
  private requested=false;
  private lastState=new Powertrain().summary;private audible=false;
  private readonly legacy=new Powertrain();private lastUpdate=0;
  async toggle(){
    this.requested=!this.requested;
    if(!this.requested){this.enabled=false;this.voice?.silence();return false;}
    try{
      if(!this.ctx){this.ctx=new AudioContext({latencyHint:'interactive'});this.voice=new EngineVoice(this.ctx);}
      await this.ctx.resume();this.enabled=this.requested;
      this.voice?.apply(this.lastState,this.enabled&&this.audible);
    }catch{
      this.enabled=false;this.requested=false;this.voice?.silence();
      if(this.ctx&&!this.voice){await this.ctx.close().catch(()=>{});this.ctx=undefined;}
    }
    return this.enabled;
  }
  setPowertrain(state:PowertrainState,audible:boolean){this.lastState={...state};this.audible=audible;this.voice?.apply(this.lastState,this.enabled&&audible);}
  /** Compatibility until callers use the shared HUD/powertrain state. */
  update(speed:number,active:boolean,throttle:boolean|number){
    const now=performance.now()/1000,dt=this.lastUpdate?Math.min(.1,Math.max(0,now-this.lastUpdate)):1/60;this.lastUpdate=now;
    this.setPowertrain(this.legacy.update(dt,{speed,throttle:Number(throttle),active}),active);
  }
  get summary(){return{enabled:this.enabled,context:this.ctx?.state??'not-created',source:'CC0-recording-derived-mechanical-cycles',airLayers:0,audible:this.enabled&&this.audible,gear:this.lastState.gear,rpm:this.lastState.rpm};}
  async dispose(){this.enabled=this.requested=false;this.voice?.dispose();await this.ctx?.close();this.voice=undefined;this.ctx=undefined;}
}
