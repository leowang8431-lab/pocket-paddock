import type {RaceSession,RaceTrack} from './race';
import {PLAYER_GRID_DISTANCE} from './ai-race';

export type RaceMode='time-trial'|'race';
export function isRaceMode(value:unknown):value is RaceMode{return value==='time-trial'||value==='race';}

/** Ranking follows validated checkpoint progress. Skipping a checkpoint cannot
 * leap the player ahead of cars that actually drove that section. */
export class CompetitionProgress {
  progress=PLAYER_GRID_DISTANCE;
  finished=false;
  finishTime:number|null=null;
  private crossedStart=false;
  constructor(private readonly track:RaceTrack,readonly totalLaps=3){}
  reset(){this.progress=PLAYER_GRID_DISTANCE;this.finished=false;this.finishTime=null;this.crossedStart=false;}
  update(race:Pick<RaceSession,'completed'|'nextCheckpoint'>,distance:number,time:number){
    if(this.finished)return;
    const length=this.track.length;
    if(race.completed>=this.totalLaps){this.progress=this.totalLaps*length;this.finished=true;this.finishTime=time;return;}
    if(distance<length/2||race.completed>0)this.crossedStart=true;
    if(!this.crossedStart){this.progress=distance-length;return;}
    const next=race.nextCheckpoint>=this.track.checkpoints.length?length:this.track.checkpoints[race.nextCheckpoint];
    this.progress=race.completed*length+Math.min(Math.max(0,distance),next);
  }
}
