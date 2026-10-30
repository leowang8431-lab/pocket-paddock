/** Presentation-only gearbox: it never changes acceleration, grip or timing.
 * Speed is in game units (HUD km/h = speed * 6). */
export type Gear=-1|0|1|2|3|4|5|6|7|8;
export interface PowertrainInput {speed:number;throttle:number;brake?:number;active?:boolean}
export interface PowertrainState {
  gear:Gear;rpm:number;targetRpm:number;throttle:number;load:number;
  shift:'up'|'down'|null;shiftProgress:number;shiftSerial:number;
  torqueCut:number;revBlip:number;startBurst:number;launch:number;
  phase:'idle'|'free-rev'|'driving'|'shifting'|'reverse';
}
export const IDLE_RPM=3300;
export const REDLINE_RPM=14000;
const upper=[42,74,106,138,170,202,234,268];
const lower=[0,28,57,88,119,151,183,215];
const finite=(v:number)=>Number.isFinite(v)?v:0;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const damp=(a:number,b:number,rate:number,dt:number)=>a+(b-a)*(1-Math.exp(-rate*dt));
export const gearLabel=(gear:Gear)=>gear===-1?'R':gear===0?'N':String(gear);

export class Powertrain {
  private gear:Gear=0;private rpm=IDLE_RPM;private targetRpm=IDLE_RPM;
  private throttle=0;private load=0;private shift:'up'|'down'|null=null;
  private shiftAge=1;private shiftSerial=0;private cooldown=0;
  private startAge=1;private initialized=false;private kmh=0;
  reset(){
    this.gear=0;this.rpm=this.targetRpm=IDLE_RPM;this.throttle=this.load=0;
    this.shift=null;this.shiftAge=this.startAge=1;this.shiftSerial=0;
    this.cooldown=0;this.initialized=false;this.kmh=0;
  }
  update(dt:number,input:PowertrainInput):PowertrainState {
    if(!Number.isFinite(dt)||dt<=0||input.active===false)return this.summary;
    let remaining=Math.min(dt,1);
    while(remaining>1e-9){const step=Math.min(1/120,remaining);this.step(step,input);remaining-=step;}
    return this.summary;
  }
  private step(dt:number,input:PowertrainInput){
    const speed=finite(input.speed);this.kmh=Math.abs(speed)*6;
    const throttle=clamp(finite(input.throttle),0,1),brake=clamp(finite(input.brake??0),0,1);
    if(!this.initialized){this.initialized=true;this.startAge=0;}
    this.startAge+=dt;this.shiftAge+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.shiftAge>=.24)this.shift=null;
    this.throttle=damp(this.throttle,throttle,20,dt);
    const previous=this.gear;
    if(speed<-.18)this.gear=-1;
    else if(speed<=.18)this.gear=0;
    else if(this.gear<=0)this.gear=1;
    else if(this.cooldown===0){
      if(this.gear<8&&this.kmh>=upper[this.gear-1])this.gear=(this.gear+1) as Gear;
      else if(this.gear>1&&this.kmh<lower[this.gear-1])this.gear=(this.gear-1) as Gear;
    }
    if(previous>0&&this.gear>0&&previous!==this.gear){
      this.shift=this.gear>previous?'up':'down';this.shiftAge=0;
      // Arcade braking can shed the whole speed range in about 1.5 seconds.
      // Fast sequential downshifts keep low gears audible before the stop.
      this.cooldown=this.shift==='up'?.27:.13;this.shiftSerial++;
    }else if(this.gear<=0){this.shift=null;this.shiftAge=1;this.cooldown=0;}
    const effective=this.gear===-1?Math.max(throttle,brake):throttle;
    this.load=damp(this.load,effective,15,dt);
    const blip=this.shift==='down'?Math.max(0,1-this.shiftAge/.20):0;
    if(this.gear===0)this.targetRpm=IDLE_RPM+7200*Math.pow(this.throttle,.65);
    else if(this.gear===-1)this.targetRpm=clamp(IDLE_RPM+this.kmh/42*5700+this.load*450,IDLE_RPM,9800);
    else this.targetRpm=clamp(IDLE_RPM+this.kmh/upper[this.gear-1]*9700+this.load*500+blip*1700,IDLE_RPM,REDLINE_RPM);
    this.rpm=damp(this.rpm,this.targetRpm,this.shift?38:this.gear===0?10:16,dt);
    this.rpm=clamp(this.rpm,IDLE_RPM,REDLINE_RPM);
  }
  get summary():PowertrainState {
    const torqueCut=this.shift==='up'?Math.max(0,1-this.shiftAge/.115):0;
    const revBlip=this.shift==='down'?Math.max(0,1-this.shiftAge/.20):0;
    return{gear:this.gear,rpm:this.rpm,targetRpm:this.targetRpm,throttle:this.throttle,load:this.load,
      shift:this.shift,shiftProgress:this.shift?clamp(this.shiftAge/.24,0,1):1,shiftSerial:this.shiftSerial,
      torqueCut,revBlip,startBurst:this.initialized?Math.max(0,1-this.startAge/.65):0,
      launch:this.load*Math.max(0,1-this.kmh/65),
      phase:this.gear===0?(this.throttle>.04?'free-rev':'idle'):this.shift?'shifting':this.gear===-1?'reverse':'driving'};
  }
}

export interface EngineTimbre {
  cycleHz:number;bodyGain:number;loadGain:number;filterHz:number;
  resonanceHz:number;resonanceDb:number;volume:number;
}
/** RPM drives complete recorded mechanical cycles, not a high sine whine.
 * Acoustic register is authored for this miniature; drivetrain RPM is intact. */
export function engineTimbre(state:PowertrainState,audible:boolean):EngineTimbre {
  const rpm=clamp(finite(state.rpm),IDLE_RPM,REDLINE_RPM),load=clamp(finite(state.load),0,1);
  const cut=1-.74*clamp(finite(state.torqueCut),0,1),blip=clamp(finite(state.revBlip),0,1);
  const launch=clamp(finite(state.launch),0,1),burst=clamp(finite(state.startBurst),0,1);
  return{cycleHz:rpm/120,bodyGain:.72+load*.10,loadGain:.10+load*.26+blip*.05,
    filterHz:780+load*900+(rpm-IDLE_RPM)/20,resonanceHz:270+load*110,resonanceDb:2+load*2,
    volume:audible?(.065+load*.092+launch*.018+burst*.022+blip*.016)*cut:0};
}
