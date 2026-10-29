export type RaceState='menu'|'countdown'|'racing'|'paused';
export interface RaceTrack {length:number;width:number;checkpoints:number[]}
export interface LapResult {time:number;valid:boolean;best:boolean}
// Handling revisions have separate records; keep the old key untouched.
export const BEST_STORAGE_KEY='pocket-paddock.monza.v2.best';
export class RaceSession {
  state:RaceState='menu'; previousState:RaceState='racing'; countdown=0; elapsed=0; lap=1;
  best:number|null=null; last:number|null=null; nextCheckpoint=1; valid=true; offroad=0; totalOffroad=0;
  invalidReason:'track-limits'|'reset'|null=null;
  lastDistance=0; completed=0; result:LapResult|null=null; storageAvailable=true;
  constructor(public track:RaceTrack,private storage?:Pick<Storage,'getItem'|'setItem'>) {
    try {const raw=storage?.getItem(BEST_STORAGE_KEY);if(raw){const n=Number(raw);if(Number.isFinite(n)&&n>0)this.best=n;}}catch{this.storageAvailable=false;}
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
    const beyondLimit=lateral>this.track.width/2+1.6;
    this.offroad=beyondLimit?this.offroad+dt:0;
    if(beyondLimit)this.totalOffroad+=dt;
    if(this.offroad>0.35||this.totalOffroad>0.65)this.invalidate();
    const len=this.track.length;
    const delta=((distance-this.lastDistance+len*1.5)%len)-len/2;
    if(delta>0 && delta<Math.max(30,len*0.025) && forward>0.3 && lateral<this.track.width/2+2) {
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
    const best=valid&&(this.best===null||time<this.best);
    if(best){this.best=time;try{this.storage?.setItem(BEST_STORAGE_KEY,String(time));}catch{this.storageAvailable=false;}}
    this.last=time;this.result={time,valid,best};this.completed++;this.lap++;this.elapsed=0;this.nextCheckpoint=1;this.valid=true;this.offroad=0;this.totalOffroad=0;this.invalidReason=null;
  }
}
export function formatTime(seconds:number|null):string {
  if(seconds===null)return '—:——.———';
  const ms=Math.floor(seconds*1000+1e-6),minutes=Math.floor(ms/60000),s=Math.floor(ms/1000)%60;
  return `${minutes}:${String(s).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
