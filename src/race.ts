import type {WeatherMode} from './conditions';
import {circuitRecordKey,type CircuitId} from './circuits';
export type RaceState='menu'|'countdown'|'racing'|'paused'|'finished';
export interface RaceTrack {id?:CircuitId;length:number;width:number;checkpoints:number[];widthAt?:(distance:number)=>number}
export interface LapResult {time:number;valid:boolean;best:boolean}
// Handling revisions have separate records; keep the old key untouched.
export const BEST_STORAGE_KEY='pocket-paddock.monza.v3.best';
export const WET_BEST_STORAGE_KEY='pocket-paddock.monza.wet.v2.best';
export class RaceSession {
  state:RaceState='menu'; previousState:RaceState='racing'; countdown=0; elapsed=0; lap=1;
  best:number|null=null; last:number|null=null; nextCheckpoint=1; valid=true; offroad=0; totalOffroad=0;
  invalidReason:'track-limits'|'reset'|null=null;
  lastDistance=0; completed=0; result:LapResult|null=null; storageAvailable=true;
  weather:WeatherMode='sunny';
  /** Opponent races keep lap validation but never update the time-trial board. */
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
  start() {this.state='countdown';this.countdown=0;this.elapsed=0;this.lap=1;this.last=null;this.nextCheckpoint=1;this.valid=true;this.offroad=0;this.totalOffroad=0;this.invalidReason=null;this.lastDistance=0;this.completed=0;this.result=null;}
  pause(){if(this.state==='racing'||this.state==='countdown'){this.previousState=this.state;this.state='paused';}}
  resume(){if(this.state==='paused')this.state=this.previousState;}
  invalidate(reason:'track-limits'|'reset'='track-limits'){this.valid=false;this.invalidReason??=reason;}
  resetPosition(distance:number){this.invalidate('reset');this.lastDistance=distance;}
  update(dt:number,distance:number,lateral:number,forward:number) {
    if(this.state==='countdown'){this.countdown+=dt;if(this.countdown>=4.5){this.state='racing';this.lastDistance=distance;}return;}
    if(this.state!=='racing')return;
    this.elapsed+=dt;
    const halfWidth=(this.track.widthAt?.(distance)??this.track.width)/2;
    const beyondLimit=lateral>halfWidth+1.6;
    this.offroad=beyondLimit?this.offroad+dt:0;
    if(beyondLimit)this.totalOffroad+=dt;
    if(this.offroad>0.35||this.totalOffroad>0.65)this.invalidate();
    const len=this.track.length;
    const delta=((distance-this.lastDistance+len*1.5)%len)-len/2;
    if(delta>0 && delta<Math.max(30,len*0.025) && forward>0.3 && lateral<halfWidth+2) {
      const target=this.nextCheckpoint===this.track.checkpoints.length?len:this.track.checkpoints[this.nextCheckpoint];
      const ahead=(target-this.lastDistance+len)%len;
      if(ahead<=delta+0.001) {
        if(this.nextCheckpoint===this.track.checkpoints.length) this.finish();
        else this.nextCheckpoint++;
      }
    }
    this.lastDistance=distance;
  }
  private finish(){
    const time=this.elapsed,valid=this.valid&&time>12;
    const best=this.recordBests&&valid&&(this.best===null||time<this.best);
    if(best){this.best=time;this.weatherBests[this.weather]=time;try{this.storage?.setItem(this.storageKey,String(time));}catch{this.storageAvailable=false;}}
    this.last=time;this.result={time,valid,best};this.completed++;this.lap++;this.elapsed=0;this.nextCheckpoint=1;this.valid=true;this.offroad=0;this.totalOffroad=0;this.invalidReason=null;
  }
}
export function formatTime(seconds:number|null):string {
  if(seconds===null)return '—:——.———';
  const ms=Math.floor(seconds*1000+1e-6),minutes=Math.floor(ms/60000),s=Math.floor(ms/1000)%60;
  return `${minutes}:${String(s).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
