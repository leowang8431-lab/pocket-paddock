export class EngineAudio {
  enabled=false; private ctx?:AudioContext;private oscillator?:OscillatorNode;private gain?:GainNode;
  async toggle(){
    this.enabled=!this.enabled;
    if(this.enabled){try{
      if(!this.ctx){this.ctx=new AudioContext();this.oscillator=this.ctx.createOscillator();this.gain=this.ctx.createGain();const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=450;this.oscillator.type='sawtooth';this.oscillator.connect(filter);filter.connect(this.gain);this.gain.connect(this.ctx.destination);this.gain.gain.value=0;this.oscillator.start();}
      await this.ctx.resume();
    }catch{this.enabled=false;}}
    return this.enabled;
  }
  update(speed:number,active:boolean,throttle:boolean){if(this.ctx&&this.gain&&this.oscillator){const t=this.ctx.currentTime;this.oscillator.frequency.setTargetAtTime(48+Math.abs(speed)*4.5+(throttle?15:0),t,.08);this.gain.gain.setTargetAtTime(this.enabled && active ? .035 : 0,t,.12);}}
}
