interface TimingPoint {distance:number;time:number}
interface History extends TimingPoint {samples:TimingPoint[];observedTime:number}

/** Keep each car's measured passage times for the live interval tower. */
export class RaceIntervals {
  private readonly cars=new Map<string,History>();

  reset(){this.cars.clear();}

  record(id:string,distance:number,time:number){
    const car=this.cars.get(id);
    if(!car){this.cars.set(id,{samples:[{distance,time}],distance,time,observedTime:time});return;}
    // Record the first moving sample after a stop, so interpolation cannot
    // spread waiting at a garage or for traffic over a section of track.
    if(distance>car.distance&&car.observedTime-car.time>.18){
      if(car.distance>car.samples.at(-1)!.distance)car.samples.push({distance:car.distance,time:car.time});
      car.samples.push({distance:car.distance,time:car.observedTime});
    }
    car.observedTime=time;
    if(distance<=car.distance)return;
    if(time-car.samples.at(-1)!.time>=.12)car.samples.push({distance,time});
    car.distance=distance;car.time=time;
  }

  gap(ahead:string,distance:number,time:number):number|undefined {
    const car=this.cars.get(ahead);
    if(!car||distance<car.samples[0].distance||distance>car.distance)return;
    const points=car.samples;
    let low=0,high=points.length;
    while(low+1<high){
      const mid=(low+high)>>1;
      if(points[mid].distance<distance)low=mid;else high=mid;
    }
    if(points[0].distance===distance)return Math.max(0,time-points[0].time);
    const a=points[low],b=points[high]??car;
    const passed=b.distance>a.distance?a.time+(b.time-a.time)*(distance-a.distance)/(b.distance-a.distance):a.time;
    return Math.max(0,time-passed);
  }
}
