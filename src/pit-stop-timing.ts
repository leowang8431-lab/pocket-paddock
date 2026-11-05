import type {PitStopPhase} from './pit-stop-animation';

/** Public stop time in seconds. The rig's eight authoring units remain a pose
 * coordinate; these anchors assign more of the real stop to gun engagement. */
export const PIT_STOP_DURATION=2.6;
const poseSeconds=[0,.6,1.2,2,3.35,5.1,6.4,7.2,8] as const;
const raceSeconds=[0,.10,.28,.82,1.15,1.62,2.25,2.48,PIT_STOP_DURATION] as const;
const phaseLabels:readonly [PitStopPhase,string][]=[
  ['park','停车确认'],['lift','抬升赛车'],['unlock','松开轮毂螺母'],['remove','拆下旧轮胎'],
  ['fit','装上新轮胎'],['tighten','锁紧并确认'],['lower','赛车落地'],['release','放行'],
];
export const PIT_STOP_RACE_PHASES:readonly {id:PitStopPhase;name:string;start:number;end:number}[]=phaseLabels.map(([id,name],i)=>({id,name,start:raceSeconds[i],end:raceSeconds[i+1]}));

function mapTime(seconds:number,from:readonly number[],to:readonly number[]){
  const t=Number.isNaN(seconds)?from[0]:Math.min(from.at(-1)!,Math.max(from[0],seconds));
  for(let i=1;i<from.length;i++)if(t<=from[i])return to[i-1]+(to[i]-to[i-1])*(t-from[i-1])/(from[i]-from[i-1]);
  return to.at(-1)!;
}
/** Convert actual stop seconds to the existing rig's authoring pose time. */
export const toPitPoseTime=(raceTime:number)=>mapTime(raceTime,raceSeconds,poseSeconds);
/** Convert a rig contact/withdrawal instant to actual stop seconds. */
export const toPitRaceTime=(poseTime:number)=>mapTime(poseTime,poseSeconds,raceSeconds);
