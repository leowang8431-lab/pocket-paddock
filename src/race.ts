import type {WeatherMode} from './conditions';
import {circuitRecordKey,type CircuitId} from './circuits';
export type RaceState='menu'|'countdown'|'racing'|'paused'|'finished';
export interface RaceTrack {id?:CircuitId;length:number;width:number;checkpoints:number[];widthAt?:(distance:number)=>number}
export interface LapResult {time:number;valid:boolean;best:boolean;penalty:number}
export const TRACK_LIMIT_PENALTY_SECONDS=3;
export const TRACK_LIMIT_MARGIN=1.6;
export const TRACK_LIMIT_DELAY_SECONDS=.35;
const cumulativeTrackLimitDelay=.65;
const finishLineMargin=2;
// Handling revisions have separate records; keep the old key untouched.
export const BEST_STORAGE_KEY='pocket-paddock.monza.v3.best';
export const WET_BEST_STORAGE_KEY='pocket-paddock.monza.wet.v2.best';
export class RaceSession {
  state:RaceState='menu'; previousState:RaceState='racing'; countdown=0; elapsed=0; lap=1;
  best:number|null=null; last:number|null=null; nextCheckpoint=1; valid=true; offroad=0; totalOffroad=0;
  invalidReason:'track-limits'|'reset'|null=null;
  lastDistance=0; completed=0; result:LapResult|null=null; storageAvailable=true;
  lapPenalty=0;totalPenalty=0;penaltyCount=0;
  private lapTravel=0;
  private excursionCharged=false;
  private unpenalizedOffroad=0;
  weather:WeatherMode='sunny';
  /** Opponent races score laps but never update the time-trial board. */
  recordBests=true;
  private readonly weatherBests:Record<WeatherMode,number|null>={sunny:null,rainy:null};
  get storageKey(){return circuitRecordKey(this.track.id??'monza',this.weather==='rainy');}
  constructor(public track:RaceTrack,private storage?:Pick<Storage,'getItem'|'setItem'>,weather:WeatherMode='sunny') {
    this.setWeather(weather);
  }
  setWeather(weather:WeatherMode){
    this.weatherBests[this.weather]=this.best;
    this.weather=weather;this.best=this.weatherBests[weather];
    try {const raw=this.storage?.getItem(this.storageKey);if(raw){const n=Number(raw);if(Number.isFinite(n)&&n>0&&(this.best===null||n<this.best))this.best=n;}}catch{this.storageAvailable=false;}
    this.weatherBests[weather]=this.best;
  }
  start() {this.state='countdown';this.countdown=0;this.elapsed=0;this.lap=1;this.last=null;this.nextCheckpoint=1;this.valid=true;this.offroad=0;this.totalOffroad=0;this.invalidReason=null;this.lastDistance=0;this.completed=0;this.result=null;
    this.lapPenalty=0;this.totalPenalty=0;this.penaltyCount=0;this.lapTravel=0;this.excursionCharged=false;this.unpenalizedOffroad=0;
  }
  pause(){if(this.state==='racing'||this.state==='countdown'){this.previousState=this.state;this.state='paused';}}
  resume(){if(this.state==='paused')this.state=this.previousState;}
  invalidate(reason:'track-limits'|'reset'='track-limits'){this.valid=false;this.invalidReason??=reason;}
  resetPosition(distance:number){
    this.invalidate('reset');
    this.lapTravel=Math.min(this.lapTravel,distance);
    this.lastDistance=distance;
  }
  update(dt:number,distance:number,lateral:number,forward:number,legalPit=false) {
    if(!Number.isFinite(dt)||dt<=0)return;
    if(this.state==='countdown'){this.countdown+=dt;if(this.countdown>=4.5){this.state='racing';this.lastDistance=distance;}return;}
    if(this.state!=='racing')return;
    this.elapsed+=dt;
    const halfWidth=(this.track.widthAt?.(distance)??this.track.width)/2;
    this.updateTrackLimits(dt,!legalPit&&lateral>halfWidth+TRACK_LIMIT_MARGIN);
    const len=this.track.length;
    const delta=((distance-this.lastDistance+len*1.5)%len)-len/2;
    const plausible=Math.abs(delta)<Math.max(30,len*.025);
    if(plausible)this.lapTravel+=delta;
    if(plausible&&delta>0&&forward>.3&&(legalPit||lateral<halfWidth+finishLineMargin)){
      // A net half-circuit of measured travel re-arms the finish after a lap.
      // Grid movement and repeated crossings around the line are too short.
      if(distance<this.lastDistance){
        if(this.lapTravel>=len*.5){
          const fraction=Math.min(1,(len-this.lastDistance)/delta);
          this.finish(dt*(1-fraction),distance);
        }else this.lapTravel=distance;
      }else if(this.nextCheckpoint<this.track.checkpoints.length){
        // Checkpoints guide the driver and the reset position. They never gate a lap.
        const target=this.track.checkpoints[this.nextCheckpoint];
        const ahead=(target-this.lastDistance+len)%len;
        if(ahead<=delta+.001)this.nextCheckpoint++;
      }
    }
    this.lastDistance=distance;
  }
  private updateTrackLimits(dt:number,beyondLimit:boolean){
    if(!beyondLimit){this.offroad=0;this.excursionCharged=false;return;}
    this.offroad+=dt;
    this.totalOffroad+=dt;
    if(this.excursionCharged)return;
    this.unpenalizedOffroad+=dt;
    if(this.offroad<TRACK_LIMIT_DELAY_SECONDS&&this.unpenalizedOffroad<cumulativeTrackLimitDelay)return;
    this.lapPenalty+=TRACK_LIMIT_PENALTY_SECONDS;
    this.totalPenalty+=TRACK_LIMIT_PENALTY_SECONDS;
    this.penaltyCount++;
    this.excursionCharged=true;
    this.unpenalizedOffroad=0;
  }
  private finish(remainder:number,distance:number){
    const rawTime=this.elapsed-remainder;
    const penalty=this.lapPenalty,time=rawTime+penalty,valid=this.valid&&rawTime>12;
    const best=this.recordBests&&valid&&penalty===0&&(this.best===null||time<this.best);
    if(best){this.best=time;this.weatherBests[this.weather]=time;try{this.storage?.setItem(this.storageKey,String(time));}catch{this.storageAvailable=false;}}
    this.last=time;this.result={time,valid,best,penalty};this.completed++;this.lap++;
    this.elapsed=remainder;this.lapTravel=distance;this.nextCheckpoint=1;this.valid=true;this.invalidReason=null;
    this.lapPenalty=0;this.totalOffroad=0;this.unpenalizedOffroad=0;
  }
}
export function formatTime(seconds:number|null):string {
  if(seconds===null)return '—:——.———';
  const ms=Math.floor(seconds*1000+1e-6),minutes=Math.floor(ms/60000),s=Math.floor(ms/1000)%60;
  return `${minutes}:${String(s).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
