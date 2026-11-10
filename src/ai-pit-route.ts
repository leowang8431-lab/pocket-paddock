import type {Track} from './track';
import type {TeamId} from './team-catalog';
import {getPitServiceBay,PIT_SPEED_LIMIT} from './pit-lane-controller';
import {SPA_PIT_LAYOUT} from './spa-pit-layout';

interface Point {x:number;z:number;}
interface Node extends Point {arc:number;base:number;}
interface Pose extends Point {heading:number;}
export interface AiPitCar extends Pose {
  speed:number;distance:number;lateral:number;vx:number;vz:number;yawRate:number;frontWheelAngle:number;throttle?:number;
}
export type AiPitPhase='entry'|'approach'|'service'|'exit'|'done';
type Bay=ReturnType<typeof getPitServiceBay>;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(t:number)=>{const v=clamp(t,0,1);return v*v*(3-2*v);};
const wrap=(n:number,length:number)=>((n%length)+length)%length;
const angle=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
const heading=(a:Point,b:Point)=>Math.atan2(b.x-a.x,b.z-a.z);

function append(nodes:Node[],point:Point,base:number){
  const last=nodes.at(-1),delta=last?Math.hypot(point.x-last.x,point.z-last.z):0;
  if(last&&delta<1e-8)return;
  nodes.push({x:point.x,z:point.z,arc:(last?.arc??0)+delta,base});
}
function sample(nodes:readonly Node[],at:number){
  const arc=clamp(at,0,nodes.at(-1)!.arc);
  let lo=0,hi=nodes.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(nodes[mid].arc<=arc)lo=mid;else hi=mid;}
  const a=nodes[lo],b=nodes[hi],t=(arc-a.arc)/(b.arc-a.arc);
  return {x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),base:lerp(a.base,b.base,t),heading:heading(a,b)};
}

/** Routes share the track's real lane and garage assignments. Only the
 * connections to the actual moving car and back onto the racing line vary. */
export class AiPitRoutes {
  readonly entryDistance:number;
  readonly exitDistance:number;
  private readonly entryStation:number;
  private readonly exitStation:number;
  private readonly lane:Node[]=[];
  private readonly paths=new Map<string,{nodes:Node[];stopArc:number}>();
  constructor(private readonly track:Track){
    for(const point of track.pitPath){
      const last=this.lane.at(-1);
      append(this.lane,point,last?last.base+Math.hypot(point.x-last.x,point.z-last.z):0);
    }
    const first=this.lane[0],last=this.lane.at(-1)!;
    this.entryStation=track.roadProjectionAt(first.x,first.z).distance;
    this.exitStation=track.roadProjectionAt(last.x,last.z).distance;
    this.entryDistance=wrap(this.entryStation-28,track.length);
    this.exitDistance=wrap(this.exitStation+14,track.length);
  }
  get laneLength():number{return this.lane.at(-1)!.base;}
  bayId(team:TeamId):string{return getPitServiceBay(this.track,team).id;}
  begin(car:AiPitCar,team:TeamId,serviceSeconds:number):AiPitVisit {
    const bay=getPitServiceBay(this.track,team),path=this.pathFor(bay);
    const start=sample(this.lane,0),end=sample(this.lane,this.lane.at(-1)!.arc);
    const approach=wrap(this.entryStation-wrap(car.distance,this.track.length),this.track.length);
    const exitSpan=wrap(this.exitDistance-this.exitStation,this.track.length),exit=this.track.sampleAt(this.exitDistance);
    const route:Node[]=[];
    this.join(route,car,start,car.distance,car.distance+approach,-approach,0);
    let stopRouteArc=0;
    for(const point of path.nodes){
      append(route,point,point.base);
      if(point.base===path.stopArc)stopRouteArc=route.at(-1)!.arc;
    }
    this.join(route,end,{x:exit.point.x,z:exit.point.z,heading:Math.atan2(exit.tangent.x,exit.tangent.z)},
      this.exitStation,this.exitStation+exitSpan,end.base,end.base+exitSpan);
    const line=this.track.sampleAt(0);
    const side=(p:Point)=>(p.x-line.point.x)*line.tangent.x+(p.z-line.point.z)*line.tangent.z;
    let timingArc=0;
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],before=side(a),after=side(b);
      if(before<0&&after>=0){timingArc=lerp(a.arc,b.arc,-before/(after-before));break;}
    }
    const startDistance=car.distance,lapEnd=Math.ceil(startDistance/this.track.length)*this.track.length;
    const finishDistance=lapEnd+this.exitDistance;
    const totalArc=route.at(-1)!.arc;
    if(timingArc===0)timingArc=totalArc*(lapEnd-startDistance)/(finishDistance-startDistance);
    return new AiPitVisit(route,bay,stopRouteArc,path.stopArc,timingArc,startDistance,lapEnd,finishDistance,serviceSeconds);
  }

  /** Blend along the GP centreline instead of cutting across the preceding
   * corner. Endpoint tangents align to the pit lane and to the race car. */
  private join(nodes:Node[],a:Pose,b:Pose,d0:number,d1:number,base0:number,base1:number){
    const first=this.track.sampleAt(d0),last=this.track.sampleAt(d1);
    const lateralA=(a.x-first.point.x)*first.right.x+(a.z-first.point.z)*first.right.z;
    const lateralB=(b.x-last.point.x)*last.right.x+(b.z-last.point.z)*last.right.z;
    const startX=a.x-first.point.x-first.right.x*lateralA,startZ=a.z-first.point.z-first.right.z*lateralA;
    const endX=b.x-last.point.x-last.right.x*lateralB,endZ=b.z-last.point.z-last.right.z*lateralB;
    const startFx=Math.sin(a.heading)-first.tangent.x,startFz=Math.cos(a.heading)-first.tangent.z;
    const endFx=Math.sin(b.heading)-last.tangent.x,endFz=Math.cos(b.heading)-last.tangent.z;
    const segments=Math.max(1,Math.ceil((d1-d0)/.45));
    for(let i=0;i<=segments;i++){
      const t=i/segments,d=lerp(d0,d1,t),w=smooth(t),sample=this.track.sampleAt(d),lateral=lerp(lateralA,lateralB,w);
      const lead=(d-d0)*(1-w)**2,tail=(d-d1)*w*w;
      append(nodes,{
        x:sample.point.x+sample.right.x*lateral+lerp(startX,endX,w)+startFx*lead+endFx*tail,
        z:sample.point.z+sample.right.z*lateral+lerp(startZ,endZ,w)+startFz*lead+endFz*tail,
      },lerp(base0,base1,t));
    }
  }
  private pathFor(bay:Bay){
    const cached=this.paths.get(bay.id);if(cached)return cached;
    const monaco=this.track.id==='monaco',end=this.lane.at(-1)!.arc;
    let stopArc=0,gap=Infinity;
    for(let i=1;i<this.lane.length;i++){
      const a=this.lane[i-1],b=this.lane[i],dx=b.x-a.x,dz=b.z-a.z;
      if(!monaco){
        if(a.z>=bay.z&&b.z<=bay.z){stopArc=lerp(a.arc,b.arc,(a.z-bay.z)/(a.z-b.z));break;}
        continue;
      }
      const t=clamp(((bay.x-a.x)*dx+(bay.z-a.z)*dz)/(dx*dx+dz*dz),0,1);
      const next=(bay.x-a.x-t*dx)**2+(bay.z-a.z-t*dz)**2;
      if(next<gap){gap=next;stopArc=lerp(a.arc,b.arc,t);}
    }
    if(stopArc<=0||stopArc>=end)throw new Error('The AI pit bay is outside the service road.');
    const stop=sample(this.lane,stopArc),radius=monaco?36:this.track.id==='spa'?26:14,nodes:Node[]=[];
    // The first Spa bay is close to the start of the paved working apron.
    // Keep the first half of its lateral approach inside the fast lane.
    const approachRadius=this.track.id==='spa'?Math.min(radius,1.8*(SPA_PIT_LAYOUT.serviceMaxZ-bay.z)):radius;
    const deltaX=bay.x-stop.x,deltaZ=bay.z-stop.z;
    const tangentX=Math.sin(bay.heading)-Math.sin(stop.heading),tangentZ=Math.cos(bay.heading)-Math.cos(stop.heading);
    const count=Math.ceil(end/.5);
    const stations=[...Array.from({length:count+1},(_,i)=>Math.min(i*.5,end)),stopArc].sort((a,b)=>a-b);
    for(const base of stations){
      const p=sample(this.lane,base),offset=base-stopArc,w=1-smooth(Math.abs(offset)/(offset<0?approachRadius:radius));
      append(nodes,{x:p.x+(deltaX+tangentX*offset)*w,z:p.z+(deltaZ+tangentZ*offset)*w},base);
    }
    const result={nodes,stopArc};this.paths.set(bay.id,result);return result;
  }
}

export class AiPitVisit {
  readonly bayId:string;
  readonly serviceSeconds:number;
  phase:AiPitPhase='entry';
  laneArc:number;
  private arc=0;
  private elapsed=0;
  constructor(private readonly route:readonly Node[],private readonly bay:Bay,private readonly serviceArc:number,
    readonly stopArc:number,private readonly timingArc:number,private readonly startDistance:number,private readonly lapEnd:number,
    private readonly endDistance:number,serviceSeconds:number){
    this.bayId=bay.id;this.laneArc=route[0].base;
    this.serviceSeconds=clamp(Number.isFinite(serviceSeconds)?serviceSeconds:3,2,4);
  }
  step(car:AiPitCar,dt:number,speedLimit=PIT_SPEED_LIMIT):void {
    if(!Number.isFinite(dt)||dt<=0||this.phase==='done')return;
    if(this.phase==='service'){
      car.speed=car.vx=car.vz=car.yawRate=0;
      this.elapsed+=dt;
      if(this.elapsed+1e-9>=this.serviceSeconds)this.phase='exit';
      return;
    }
    const exiting=this.phase==='exit',end=this.route.at(-1)!.arc,remaining=Math.max(0,(exiting?end:this.serviceArc)-this.arc);
    const limit=clamp(Number.isFinite(speedLimit)?speedLimit:PIT_SPEED_LIMIT,0,PIT_SPEED_LIMIT),entryBrake=28,pitBrake=13;
    const entryDistance=this.phase==='entry'?Math.max(0,-this.laneArc):0;
    const brake=entryDistance>0?entryBrake:pitBrake;
    let target=entryDistance>0&&limit===PIT_SPEED_LIMIT?Math.sqrt(limit*limit+2*entryBrake*entryDistance):limit;
    if(!exiting)target=Math.min(target,Math.sqrt(2*pitBrake*remaining));
    for(const lookahead of [0,4,10,18]){
      const near=sample(this.route,this.arc+lookahead),far=sample(this.route,this.arc+lookahead+4);
      const turn=Math.abs(angle(far.heading-near.heading))/4;
      if(turn>.012)target=Math.min(target,Math.sqrt(7.5/turn+2*brake*Math.max(0,lookahead-2)));
    }
    const oldSpeed=Math.max(0,car.speed);
    const speed=oldSpeed+clamp(target-oldSpeed,-brake*dt,7.5*dt);
    this.arc+=Math.min(remaining,(oldSpeed+speed)*.5*dt);
    const point=sample(this.route,this.arc),lastHeading=car.heading;
    this.laneArc=point.base;
    const atStop=!exiting&&this.serviceArc-this.arc<1e-8,done=exiting&&end-this.arc<1e-8;
    const headingTarget=atStop?this.bay.heading:point.heading;
    car.heading+=angle(headingTarget-car.heading)*(atStop||done?1:1-Math.exp(-18*dt));
    car.x=point.x;car.z=point.z;
    car.speed=atStop?0:this.laneArc>=0?Math.min(speed,limit):speed;
    car.vx=Math.sin(point.heading)*car.speed;car.vz=Math.cos(point.heading)*car.speed;
    car.yawRate=atStop?0:angle(car.heading-lastHeading)/dt;
    car.frontWheelAngle=atStop||done?0:clamp(Math.atan(car.yawRate*3.1/Math.max(car.speed,2)),-.45,.45);
    if(car.throttle!==undefined)car.throttle=clamp((speed-oldSpeed)/(7.5*dt),0,1);
    car.lateral=0;
    car.distance=this.arc<this.timingArc
      ?lerp(this.startDistance,this.lapEnd,this.arc/this.timingArc)
      :lerp(this.lapEnd,this.endDistance,(this.arc-this.timingArc)/(end-this.timingArc));
    if(atStop){this.phase='service';if(car.throttle!==undefined)car.throttle=0;}
    else if(done)this.phase='done';
    else if(!exiting&&this.laneArc>=0)this.phase='approach';
  }
}
