import type {RaceSession,RaceTrack} from './race';
import {PLAYER_GRID_DISTANCE} from './ai-race';

export type RaceMode='time-trial'|'race';
export function isRaceMode(value:unknown):value is RaceMode{return value==='time-trial'||value==='race';}

/** Running order follows lap count and position on the circuit. Finishing
 * order uses the interpolated crossing time plus the player's penalties. */
export class CompetitionProgress {
  progress=PLAYER_GRID_DISTANCE;
  finished=false;
  finishTime:number|null=null;
  private crossedStart=false;
  private lastDistance:number|null=null;
  private lastTime=0;
  constructor(private readonly track:RaceTrack,readonly totalLaps=3){}
  reset(startDistance=PLAYER_GRID_DISTANCE){this.progress=startDistance;this.finished=false;this.finishTime=null;this.crossedStart=false;this.lastDistance=null;this.lastTime=0;}
  update(race:Pick<RaceSession,'completed'|'totalPenalty'>,distance:number,time:number){
    if(this.finished)return;
    const length=this.track.length;
    const before=this.lastDistance,delta=before===null?0:distance-before;
    if(race.completed>=this.totalLaps){
      this.progress=this.totalLaps*length;this.finished=true;
      const crossing=before!==null&&delta<-.9*length?this.lastTime+(time-this.lastTime)*(length-before)/(length+delta):time;
      this.finishTime=crossing+race.totalPenalty;
      return;
    }
    this.lastDistance=distance;this.lastTime=time;
    if(distance<length/2)this.crossedStart=true;
    else if(delta>.9*length)this.crossedStart=false;
    if(!this.crossedStart){this.progress=(race.completed-1)*length+distance;return;}
    this.progress=race.completed*length+distance;
  }
}
