import type {WeatherMode} from './conditions';
import {predictTireCondition,type TireCompound} from './tire-physics';

export interface AiPitContext {
  compound:TireCompound;
  /** Actual four-wheel mean wear, from 0 for fresh to 1 for exhausted. */
  wear:number;
  /** Distance traveled since the set was installed, in game units. */
  stintDistance:number;
  remainingDistance:number;
  lapLength:number;
  /** Reference lap time and estimated loss per stop, in simulation seconds. */
  lapTime:number;
  pitLoss:number;
  weather:WeatherMode;
}

const slicks = ['soft','medium','hard'] as const;
const wets = ['wet'] as const;
const clamp = (n:number,min:number,max:number) => Math.max(min,Math.min(max,n));

/** Forecast the remaining race once per entry opportunity. Delaying a stop
 * can win even when new tires would be faster this lap. */
export function chooseAiPitCompound({
  compound,wear,stintDistance,remainingDistance,lapLength,lapTime,pitLoss,weather,
}:AiPitContext):TireCompound|null {
  if(!Number.isFinite(wear+stintDistance+remainingDistance+lapLength+lapTime+pitLoss)
    ||lapLength<=0||lapTime<=0||pitLoss<0)return null;
  const remainingLaps=remainingDistance/lapLength;
  if(remainingLaps<=1||remainingLaps>99)return null;

  const freshCompounds=weather==='rainy'?wets:slicks;
  const correctCompound=weather==='rainy'?compound==='wet':compound!=='wet';
  const currentWear=clamp(wear,0,1);
  if(correctCompound&&currentWear<.08)return null;

  // Blend the model with measured wear from this car. An exhausted set only
  // tells us the minimum rate, so avoid mistaking saturation for slow wear.
  const referenceWear=predictTireCondition(compound,weather,0).wearPerUnit;
  const measuredRatio=currentWear/(Math.max(lapLength*.15,stintDistance)*referenceWear);
  const confidence=clamp(stintDistance/(lapLength*.75),0,1);
  const stress=1+confidence*(clamp(measuredRatio,currentWear>.98?1:.65,1.5)-1);

  function stintTime(tire:TireCompound,wearAtStart:number,laps:number) {
    const wearPerLap=predictTireCondition(tire,weather,0).wearPerUnit*lapLength*stress;
    const pace=(elapsed:number)=>{
      const {gripMultiplier,speedMultiplier}=predictTireCondition(tire,weather,wearAtStart+elapsed*wearPerLap);
      // A simplified mix of speed-limited straights and grip-limited corners.
      return .55/speedMultiplier+.45/Math.sqrt(gripMultiplier);
    };
    let time=0;
    for(let lap=0;lap<laps;lap++){
      const span=Math.min(1,laps-lap);
      time+=span*(pace(lap)+4*pace(lap+span*.5)+pace(lap+span))/6;
    }
    return time*lapTime;
  }

  const lastStop=Math.ceil(remainingLaps)-2;
  // bestFresh[i] is the fastest remaining strategy on a fresh set at
  // opportunity i. Its own entry/service loss is added by its caller.
  const bestFresh=new Float64Array(lastStop+1);
  let nextCompound:TireCompound|null=null;
  for(let start=lastStop;start>=0;start--){
    let best=Infinity;
    for(const tire of freshCompounds){
      let time=stintTime(tire,0,remainingLaps-start);
      for(let stop=start+1;stop<=lastStop;stop++){
        time=Math.min(time,stintTime(tire,0,stop-start)+pitLoss+bestFresh[stop]);
      }
      if(time<best){
        best=time;
        if(start===0)nextCompound=tire;
      }
    }
    bestFresh[start]=best;
  }

  let stay=stintTime(compound,currentWear,remainingLaps);
  for(let stop=1;stop<=lastStop;stop++){
    stay=Math.min(stay,stintTime(compound,currentWear,stop)+pitLoss+bestFresh[stop]);
  }
  return stay>pitLoss+bestFresh[0]+.35?nextCompound:null;
}
