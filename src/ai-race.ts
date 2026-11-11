import type {Track,TrackSample} from './track';
import {WEATHER_PHYSICS,type WeatherMode} from './conditions';
import {teams,getTeam,getDriver,DEFAULT_TEAM,type TeamId,type DriverId} from './team-catalog';
import {RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH,resolveRaceContact,resolveWallImpulse,type RaceContactBody} from './race-contact';
import {TRACK_SPEED_SCALE} from './speed-scale';
import {TireSet,type TireCompound} from './tire-physics';
import {lateralGripForSpeed} from './handling';
import {PLAYER_GRID_DISTANCE,startGridSlot,type RaceGridSlot} from './start-grid';
import {createMonacoDrsZones,createMonzaDrsZones,createSpaDrsZones,withinZone,type DrsZone} from './drs';
import {AiPitRoutes,type AiPitVisit,type AiPitPhase} from './ai-pit-route';
import {chooseAiPitCompound} from './ai-pit-strategy';
import {AiRacingLine} from './ai-racing-line';
import {PIT_SPEED_LIMIT} from './pit-lane-controller';
import {TRACK_LIMIT_DELAY_SECONDS,TRACK_LIMIT_MARGIN,TRACK_LIMIT_PENALTY_SECONDS} from './race';

export {PLAYER_GRID_DISTANCE,PLAYER_GRID_LATERAL,type RaceGridSlot} from './start-grid';
export interface RaceGrid {player:RaceGridSlot;rivals:RaceGridSlot[];}
export interface AiRival extends RaceContactBody {
  id:string;team:TeamId;driver:DriverId;distance:number;speed:number;
  yawRate:number;lateral:number;frontWheelAngle:number;throttle:number;drsActive:boolean;
  lap:number;completedLaps:number;finished:boolean;finishTime:number|null;
  compound:TireCompound;tyreWear:number;pitState:Exclude<AiPitPhase,'done'>|'idle';pitStops:number;penalty:number;
}
export interface RaceStanding {
  id:string;team:TeamId;driver:DriverId;progress:number;position:number;isPlayer:boolean;
  lap:number;finished:boolean;finishTime:number|null;
}
export interface AiPlayerObstacle {x:number;z:number;heading:number;speed:number;finished:boolean;pitLane?:boolean;}
interface RivalPlan {
  skill:number;targetLane:number;homeLane:number;passCooldown:number;reaction:number;
  lineBlend:number;lineReviewAt:number;preferFastLine:boolean;
  tires:TireSet;previousDistance:number;laneVelocity:number;lateralImpulse:number;yawImpulse:number;yawOffset:number;impactRecovery:number;
  stintStart:number;lapStart:number;lapTime:number;pittedThisLap:boolean;
  visit?:AiPitVisit;nextCompound?:TireCompound;
  offroadTime:number;offroadCharged:boolean;
}
interface TrafficCar {gap:number;lateral:number;speed:number;}
interface SpeedPlan {top:number;braking:number;buffer:number;mechanical:number;aero:number;skill:number;engine:number;}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const signedAngle=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));
const laneScale=(curvature:number,lateral:number)=>Math.max(.35,1-curvature*lateral);
const contactRangeSquared=4*(RACE_CAR_HALF_LENGTH**2+RACE_CAR_HALF_WIDTH**2);
const maxSpeed=40*TRACK_SPEED_SCALE;
const maxDrsSpeed=44.5*TRACK_SPEED_SCALE;
const dryCompounds:readonly TireCompound[]=['medium','soft','hard'];
export function createRaceGrid(count:number,random=Math.random,previousPlayer?:RaceGridSlot):RaceGrid {
  const slots=Array.from({length:clamp(Math.floor(Number.isFinite(count)?count:5),1,10)+1},(_,i)=>startGridSlot(i));
  for(let i=slots.length-1;i>0;i--){
    const draw=random(),j=Number.isFinite(draw)?clamp(Math.floor(draw*(i+1)),0,i):i;
    [slots[i],slots[j]]=[slots[j],slots[i]];
  }
  if(previousPlayer?.distance===slots[0].distance&&previousPlayer.lateral===slots[0].lateral){
    const draw=random(),last=slots.length-1;
    const rivalSlot=Number.isFinite(draw)?clamp(1+Math.floor(draw*last),1,last):last;
    [slots[0],slots[rivalSlot]]=[slots[rivalSlot],slots[0]];
  }
  const [player,...rivals]=slots;
  return {player,rivals};
}

/** Deterministic arcade opponents. Their continuous, unwrapped progress is the
 * source of both their visible position and their lap/finish results. They use
 * curvature-based braking, modest passing lanes and no speed rubber-banding.
 * Call update only while the race clock is running; no wall-clock timers exist. */
export class AiRace {
  readonly rivals:AiRival[]=[];
  readonly totalLaps:number;
  readonly count:number;
  time=0;
  private readonly curvature:Float64Array;
  private readonly drsZones:readonly DrsZone[];
  private readonly pitRoutes:AiPitRoutes;
  private readonly racingLine:AiRacingLine;
  private readonly previewSpeeds=new Float64Array(19);
  private readonly previewLengths=new Float64Array(18);
  private readonly plans:RivalPlan[]=[];
  private readonly gridOrder=new Map<string,number>();
  private playerGridDistance=PLAYER_GRID_DISTANCE;
  private playerTeam:TeamId=DEFAULT_TEAM;
  private playerDriver:DriverId=getTeam(DEFAULT_TEAM).drivers[0].id;
  private playerObstacle:AiPlayerObstacle|null=null;
  private startingWeather:WeatherMode|undefined;
  private observedPlayer:{distance:number;lateral:number;speed:number}|null=null;
  constructor(readonly track:Track,count=5,totalLaps=3,private readonly pitStopsEnabled=true){
    this.count=clamp(Math.floor(Number.isFinite(count)?count:5),1,10);
    this.totalLaps=clamp(Math.floor(Number.isFinite(totalLaps)?totalLaps:3),1,99);
    this.drsZones=track.id==='spa'?createSpaDrsZones(track):track.id==='monaco'?createMonacoDrsZones(track):createMonzaDrsZones(track);
    this.pitRoutes=new AiPitRoutes(track);
    this.racingLine=new AiRacingLine(track);
    this.curvature=new Float64Array(track.samples.length);
    const step=track.length/track.samples.length,span=3;
    for(let i=0;i<this.curvature.length;i++){
      const a=track.samples[(i-span+track.samples.length)%track.samples.length].tangent;
      const b=track.samples[(i+span)%track.samples.length].tangent;
      this.curvature[i]=signedAngle(Math.atan2(b.x,b.z)-Math.atan2(a.x,a.z))/(step*span*2);
    }
    this.start();
  }
  start(playerTeam:TeamId=DEFAULT_TEAM,playerDriver?:DriverId,weather?:WeatherMode,grid?:RaceGrid):void {
    this.playerTeam=playerTeam;
    this.playerDriver=playerDriver&&getDriver(playerDriver)?.teamId===playerTeam?playerDriver:getTeam(playerTeam).drivers[0].id;
    this.time=0;this.rivals.length=0;this.plans.length=0;this.playerObstacle=null;this.observedPlayer=null;this.startingWeather=weather;
    const roster=teams.filter(team=>team.id!==playerTeam),playerSlot=grid?.player??startGridSlot(2);
    this.playerGridDistance=playerSlot.distance;
    this.gridOrder.clear();
    const slots=[{id:'player',...playerSlot}];
    const skills=[.955,1,.975,.94,.985,.965,.99,.95,.98,.96];
    for(let i=0;i<this.count;i++){
      const slot=grid?.rivals[i]??startGridSlot(i<2?i:i+1);
      const team=roster[i%roster.length],driver=team.drivers[i>=roster.length?1:0];
      const {distance,lateral}=slot;
      const compound=weather==='rainy'?'wet':dryCompounds[i%dryCompounds.length];
      const rival:AiRival={id:`ai-${i+1}`,team:team.id,driver:driver.id,distance,speed:0,x:0,z:0,heading:0,vx:0,vz:0,yawRate:0,lateral,frontWheelAngle:0,throttle:0,drsActive:false,lap:1,completedLaps:0,finished:false,finishTime:null,compound,tyreWear:0,pitState:'idle',pitStops:0,penalty:0};
      const tires=new TireSet();
      tires.fit(compound,weather);
      this.rivals.push(rival);
      slots.push({id:rival.id,...slot});
      this.plans.push({skill:skills[i],targetLane:lateral,homeLane:lateral,passCooldown:0,reaction:i*.12,lineBlend:0,lineReviewAt:0,preferFastLine:false,tires,previousDistance:rival.distance,laneVelocity:0,lateralImpulse:0,yawImpulse:0,yawOffset:0,impactRecovery:0,
        stintStart:distance,lapStart:0,lapTime:0,pittedThisLap:false,offroadTime:0,offroadCharged:false});
      this.place(rival,0);
    }
    slots.sort((a,b)=>b.distance-a.distance||a.lateral-b.lateral).forEach((slot,i)=>this.gridOrder.set(slot.id,i));
  }
  private curvatureAt(distance:number):number {
    const index=((Math.floor(distance/this.track.length*this.curvature.length)%this.curvature.length)+this.curvature.length)%this.curvature.length;
    return this.curvature[index];
  }
  /** The actual player pose provides traffic input on every circuit. */
  setPlayerObstacle(obstacle:AiPlayerObstacle|null):void {
    this.playerObstacle=obstacle&&Number.isFinite(obstacle.x+obstacle.z+obstacle.heading+obstacle.speed)?{...obstacle}:null;
  }
  private observePlayer(){
    const player=this.playerObstacle;if(!player||player.finished||player.pitLane)return null;
    const projection=this.track.roadProjectionAt(player.x,player.z);
    if(projection.gap>this.track.widthAt(projection.distance)/2+2.9)return null;
    const sample=this.track.sampleAt(projection.distance),lateral=(player.x-sample.point.x)*sample.right.x+(player.z-sample.point.z)*sample.right.z;
    return{distance:projection.distance,lateral,speed:player.speed*Math.cos(player.heading-Math.atan2(sample.tangent.x,sample.tangent.z))};
  }
  private playerAt(distance:number){
    const player=this.observedPlayer;
    return player&&{gap:signedDistance(player.distance-distance,this.track.length),lateral:player.lateral,speed:player.speed};
  }
  private onRaceLane(index:number){
    const visit=this.plans[index].visit;
    return !visit||visit.laneArc<0||visit.laneArc>=this.pitRoutes.laneLength;
  }
  /** The provided GLB occupies a 2.70-unit circle around its actual origin.
   * Reserve 2.90 on Monaco, including trim and width changes across the car.
   * Tight bends are single file even when their painted road is wide. */
  private monacoLaneLimitAt(distance:number):number {
    const half=Math.min(this.track.widthAt(distance-3),this.track.widthAt(distance),this.track.widthAt(distance+3))/2;
    const curve=Math.abs(this.curvatureAt(distance)),turn=clamp((.080-curve)/.035,0,1);
    return Math.max(0,Math.min(2.8,half-2.90))*turn;
  }
  private monacoLanePreview(rival:AiRival):number {
    let limit=2.8;
    // At most .95 units of lateral motion per second: seeing three seconds
    // ahead lets a passing car finish its merge before the road constricts.
    const horizon=Math.max(95,rival.speed*3.4+15);
    for(let ahead=0;ahead<=horizon;ahead+=5)limit=Math.min(limit,this.monacoLaneLimitAt(rival.distance+ahead));
    return limit;
  }
  private monacoTrafficTarget(rival:AiRival,index:number,target:number,limit:number,weather:WeatherMode):number {
    const plan=this.plans[index],merging=limit<2.6;
    if(merging)plan.targetLane=0;
    else if(Math.abs(plan.targetLane)<.001)plan.targetLane=plan.homeLane;
    const ahead=this.rivals.flatMap((other,j)=>{
      if(other===rival||other.finished||!this.onRaceLane(j))return[];
      const gap=signedDistance(other.distance-rival.distance,this.track.length);
      // A deterministic priority also separates two cars leaving the same row.
      return gap>.02||Math.abs(gap)<=.02&&j<index?[{other,gap:Math.max(0,gap)}]:[];
    });
    const player=this.playerAt(rival.distance);
    if(player&&player.gap>=-.02)ahead.push({other:{...rival,id:'player',lateral:player.lateral,speed:player.speed},gap:Math.max(0,player.gap)});
    ahead.sort((a,b)=>a.gap-b.gap);
    const observed=ahead.filter(entry=>entry.gap<Math.max(42,rival.speed*1.8));
    const blocker=observed.find(entry=>merging||Math.abs(entry.other.lateral-rival.lateral)<2.9);
    if(blocker){
      if(!merging)this.considerPass(rival,plan,{gap:blocker.gap,lateral:blocker.other.lateral,speed:blocker.other.speed},player,target,limit);
      if(merging||Math.abs(rival.lateral-blocker.other.lateral)<2.9){
        const closing=Math.max(0,rival.speed-blocker.other.speed),desiredGap=6.5+rival.speed*(weather==='rainy'?.9:.7)+closing*.5;
        target=Math.min(target,Math.max(0,blocker.other.speed+(blocker.gap-desiredGap)*.85));
      }
    }
    // If an unusual collision/restart leaves a car late to merge, brake first
    // rather than snapping its lateral position inside the next narrow road.
    const blend=plan.lineBlend,baseOffset=plan.targetLane*(1-blend);
    const lineError=blend>0?rival.lateral-baseOffset-this.racingLine.offsetAt(rival.distance)*blend:0;
    for(let ahead=3;ahead<=100;ahead+=3){
      const station=rival.distance+ahead;
      const offset=blend>0?baseOffset+this.racingLine.offsetAt(station)*blend+lineError*Math.exp(-ahead/Math.max(6,rival.speed*.65)):rival.lateral;
      const excess=Math.abs(offset)-this.monacoLaneLimitAt(station);
      if(excess>.05)target=Math.min(target,ahead/(excess/.95+.45));
    }
    return target;
  }
  private openTrafficTarget(rival:AiRival,plan:RivalPlan,target:number,weather:WeatherMode):number {
    const player=this.playerAt(rival.distance);
    const lookahead=Math.max(22,rival.speed*1.4);
    let blocker:TrafficCar|null=player&&player.gap>0&&player.gap<lookahead&&Math.abs(player.lateral-rival.lateral)<2.8?player:null;
    for(let i=0;i<this.rivals.length;i++){
      const other=this.rivals[i];
      if(other===rival||other.finished||!this.onRaceLane(i)||Math.abs(other.lateral-rival.lateral)>=2.8)continue;
      const gap=signedDistance(other.distance-rival.distance,this.track.length);
      if(gap>0&&gap<(blocker?.gap??lookahead))blocker={gap,lateral:other.lateral,speed:other.speed};
    }
    if(!blocker)return target;
    this.considerPass(rival,plan,blocker,player,target,2.8);
    const closing=Math.max(0,rival.speed-blocker.speed),desiredGap=5.8+rival.speed*(weather==='rainy'?.32:.23)+closing*.6;
    return Math.min(target,Math.max(0,blocker.speed+(blocker.gap-desiredGap)*1.2));
  }
  private considerPass(rival:AiRival,plan:RivalPlan,blocker:TrafficCar,player:TrafficCar|null,target:number,limit:number):void {
    if(this.time<2.5||plan.passCooldown>0||plan.impactRecovery>0||plan.lineBlend<.1&&Math.abs(plan.targetLane-rival.lateral)>.3)return;
    const advantage=target-blocker.speed,closing=rival.speed-blocker.speed;
    // A slower car only warrants a pass if we can catch it in a few seconds.
    if(advantage<1.15||blocker.gap>10+Math.max(0,closing,advantage)*3.5)return;
    const passingLane=-Math.sign(blocker.lateral||rival.lateral||plan.homeLane)*limit;
    if(Math.abs(passingLane-blocker.lateral)<2.75||Math.abs(passingLane-rival.lateral)<.4)return;
    const changeTime=Math.abs(passingLane-rival.lateral)/.95;
    const passSpeed=Math.max(rival.speed,Math.min(target,blocker.speed+6));
    const sideBySideDistance=Math.max(22,passSpeed*(changeTime+1));
    const monaco=this.track.id==='monaco';
    for(let d=0;d<=sideBySideDistance;d+=10){
      const station=rival.distance+d;
      const roadLimit=monaco?this.monacoLaneLimitAt(station):this.track.widthAt(station)/2-2.9;
      if(roadLimit+.05<Math.abs(passingLane)||Math.abs(this.curvatureAt(station))>.045)return;
    }
    const conflicts=(gap:number,speed:number)=> {
      const after=gap+(speed-passSpeed)*changeTime;
      const rear=gap+(speed-rival.speed)*changeTime;
      return Math.min(gap,after)<8+passSpeed*.22&&Math.max(gap,rear)>-7-Math.max(0,speed)*.19;
    };
    if(player&&Math.abs(player.lateral-passingLane)<2.85&&conflicts(player.gap,player.speed))return;
    for(let i=0;i<this.rivals.length;i++){
      const other=this.rivals[i];
      if(other===rival||other.finished||!this.onRaceLane(i))continue;
      if(Math.min(Math.abs(other.lateral-passingLane),Math.abs(this.plans[i].targetLane-passingLane))>=2.85)continue;
      if(conflicts(signedDistance(other.distance-rival.distance,this.track.length),other.speed))return;
    }
    plan.targetLane=passingLane;
    plan.passCooldown=changeTime+1.25;
  }
  private speedPlan(rival:AiRival,weather:WeatherMode,plan?:RivalPlan):SpeedPlan {
    const skill=plan?.skill??.96;
    const wet=WEATHER_PHYSICS[weather],grip=plan?.tires.gripMultiplier??1;
    const cap=this.drsAvailable(rival,weather)?maxDrsSpeed:maxSpeed;
    const top=cap*(.97+.03*skill)*(weather==='rainy'?.91:1)*(plan?.tires.speedMultiplier??1);
    const narrow=this.track.id==='monaco';
    const margin=narrow?.82:.98;
    return{top,braking:(narrow?28:30)*wet.braking*grip,buffer:narrow?5:4,skill,
      mechanical:margin*lateralGripForSpeed(0,weather)*grip,aero:margin*8.5*wet.grip*grip/(40*40),
      engine:15.5*TRACK_SPEED_SCALE*wet.acceleration};
  }
  private lineCurvature(distance:number,lane:number,blend:number){
    const center=this.curvatureAt(distance),fixed=center/laneScale(center,lane);
    return blend===0?fixed:fixed+(this.racingLine.curvatureAt(distance)-fixed)*blend;
  }
  private cornerSpeed(curve:number,pace:SpeedPlan){
    return Math.min(pace.top,Math.sqrt(pace.mechanical/Math.max(.001,Math.abs(curve)-pace.aero))*pace.skill);
  }
  private pathMetric(distance:number,lane:number,blend:number){
    const fixed=laneScale(this.curvatureAt(distance),lane);
    return blend===0?fixed:fixed+(this.racingLine.metricAt(distance)-fixed)*blend;
  }
  private laneRate(blend:number){return .95+(this.track.id==='monaco'?0:6.6*blend);}
  private pathSpeedLimit(distance:number,lane:number,blend:number,pace:SpeedPlan,metric:number){
    const corner=this.cornerSpeed(this.lineCurvature(distance,lane,blend),pace);
    if(blend===0)return corner;
    const slope=Math.abs(this.racingLine.slopeAt(distance)*blend);
    return slope<.001?corner:Math.min(corner,this.laneRate(blend)*metric/slope);
  }
  /** Integrate the speed envelope backward for braking and forward for exit speed. */
  private lineTime(rival:AiRival,lane:number,pace:SpeedPlan,fast:boolean){
    const speeds=this.previewSpeeds,lengths=this.previewLengths,blend=Number(fast),step=6;
    for(let i=speeds.length-1;i>=0;i--){
      const distance=rival.distance+i*step,metric=this.pathMetric(distance,lane,blend);
      const cap=this.pathSpeedLimit(distance,lane,blend,pace,metric);
      if(i===lengths.length){speeds[i]=cap;continue;}
      const length=lengths[i]=step*metric;
      speeds[i]=Math.min(cap,Math.sqrt(speeds[i+1]**2+2*pace.braking*length));
    }
    let speed=Math.min(speeds[0],Math.max(0,rival.speed)),time=0;
    for(let i=0;i<lengths.length;i++){
      const acceleration=pace.engine*Math.max(0,1-speed/(55*TRACK_SPEED_SCALE));
      const exitSpeed=Math.min(speeds[i+1],Math.sqrt(speed**2+2*acceleration*lengths[i]));
      time+=2*lengths[i]/Math.max(1,speed+exitSpeed);speed=exitSpeed;
    }
    const offset=fast?this.racingLine.offsetAt(rival.distance):lane;
    return time+.045*Math.abs(offset-rival.lateral);
  }
  private updateLine(index:number,pace:SpeedPlan,dt:number){
    const rival=this.rivals[index],plan=this.plans[index],length=this.track.length;
    const isClose=(gap:number,speed:number)=>Math.abs(gap)<8+.65*Math.max(0,gap>0?rival.speed-speed:speed-rival.speed);
    const player=this.playerAt(rival.distance);
    const traffic=player&&isClose(player.gap,player.speed)||this.rivals.some((other,i)=>i!==index&&!other.finished&&this.onRaceLane(i)&&
      isClose(signedDistance(other.distance-rival.distance,length),other.speed));
    const pitAhead=(this.pitRoutes.entryDistance-rival.distance%length+length)%length;
    const preparingPit=this.pitStopsEnabled&&rival.tyreWear>.45&&this.totalLaps*length-rival.distance>length&&pitAhead<45;
    const available=this.time>3.5&&rival.distance>=0&&!traffic&&!preparingPit&&plan.passCooldown===0&&plan.impactRecovery===0;
    if(available&&this.time>=plan.lineReviewAt){
      const fixed=this.lineTime(rival,plan.targetLane,pace,false),fast=this.lineTime(rival,plan.targetLane,pace,true);
      plan.preferFastLine=fast<fixed+(plan.preferFastLine?.10:-.025);
      plan.lineReviewAt=this.time+.35;
    }
    const target=Number(available&&plan.preferFastLine);
    plan.lineBlend+=clamp(target-plan.lineBlend,-2.5*dt,1.25*dt);
  }
  /** Look ahead along the chosen route to brake before the apex. */
  targetSpeed(rival:AiRival,weather:WeatherMode='sunny'):number {
    const plan=this.plans[this.rivals.indexOf(rival)];
    return this.brakingTarget(rival,plan,this.speedPlan(rival,weather,plan));
  }
  private brakingTarget(rival:AiRival,plan:RivalPlan|undefined,pace:SpeedPlan):number {
    const lane=plan?.targetLane??0,blend=plan?.lineBlend??0;
    let target=pace.top,length=0;
    for(let ahead=0;ahead<=95;ahead+=5){
      const distance=rival.distance+ahead,metric=this.pathMetric(distance,lane,blend);
      const corner=this.pathSpeedLimit(distance,lane,blend,pace,metric);
      target=Math.min(target,Math.sqrt(corner**2+2*pace.braking*Math.max(0,length-pace.buffer)));
      length+=5*metric;
    }
    return target;
  }
  private drsAvailable(rival:AiRival,weather:WeatherMode):boolean {
    return weather==='sunny'&&rival.speed>13&&this.drsZones.some(zone=>withinZone(rival.distance,zone,this.track.length));
  }
  private considerPit(index:number,weather:WeatherMode){
    const rival=this.rivals[index],plan=this.plans[index],length=this.track.length,entry=this.pitRoutes.entryDistance;
    if(!this.pitStopsEnabled||rival.distance<=plan.previousDistance||rival.speed<=.1)return;
    const gate=entry+(Math.floor((plan.previousDistance-entry)/length)+1)*length;
    if(rival.distance<gate||gate<0)return;
    const bay=this.pitRoutes.bayId(rival.team);
    if(this.plans.some((other,i)=>other.visit&&(other.visit.bayId===bay||other.visit.laneArc<16&&
      Math.hypot(this.rivals[i].x-rival.x,this.rivals[i].z-rival.z)<10)))return;
    if(this.playerObstacle?.pitLane&&this.pitRoutes.bayId(this.playerTeam)===bay)return;
    const remainingDistance=this.totalLaps*length-rival.distance;
    const lapTime=plan.lapTime||length/(weather==='rainy'?28:31);
    const skippedTrack=(this.pitRoutes.exitDistance-entry+length)%length;
    // Tight pit entries and exits take longer than cruising at the limiter.
    const approachLoss=this.track.id==='monaco'?15:this.track.id==='spa'?11:15;
    const pitLoss=Math.max(8,this.pitRoutes.laneLength/PIT_SPEED_LIMIT+approachLoss-skippedTrack/length*lapTime);
    const compound=chooseAiPitCompound({compound:rival.compound,wear:rival.tyreWear,stintDistance:rival.distance-plan.stintStart,remainingDistance,lapLength:length,lapTime,pitLoss,weather});
    if(!compound)return;
    plan.nextCompound=compound;
    plan.visit=this.pitRoutes.begin(rival,rival.team,2+2*Math.random());
    plan.pittedThisLap=true;rival.pitState='entry';rival.drsActive=false;
  }
  private pitTrafficLimit(index:number,visit:AiPitVisit){
    const rival=this.rivals[index],fx=Math.sin(rival.heading),fz=Math.cos(rival.heading);
    // Leave the garage only when there is room to cross back into the fast lane.
    // Cars stopped in other bays do not reserve that lane.
    if(visit.phase==='exit'&&visit.laneArc<=visit.stopArc+.05&&this.plans.some((plan,i)=>{
      const other=plan.visit,speed=this.rivals[i].speed;
      if(i===index||!other||speed<.5||other.phase==='service')return false;
      const gap=visit.stopArc-other.laneArc;
      return gap> -22&&gap<speed*3.3;
    }))return 0;
    let limit=PIT_SPEED_LIMIT;
    const follow=(other:Pick<AiPlayerObstacle,'x'|'z'|'heading'|'speed'>)=>{
      const dx=other.x-rival.x,dz=other.z-rival.z;
      const gap=dx*fx+dz*fz;
      if(gap<=0||gap>22||Math.abs(dx*fz-dz*fx)>2.75)return;
      const speed=Math.max(0,other.speed*Math.cos(other.heading-rival.heading));
      limit=Math.min(limit,Math.max(0,speed+(gap-6.2)*1.55));
    };
    for(const other of this.rivals)if(other!==rival&&!other.finished)follow(other);
    if(this.playerObstacle&&!this.playerObstacle.finished)follow(this.playerObstacle);
    if(visit.phase==='exit'&&visit.laneArc>=this.pitRoutes.laneLength-12&&visit.laneArc<this.pitRoutes.laneLength-2){
      // Yield at the merge if a faster car on the main track is about to pass.
      const merge=this.pitRoutes.exitDistance;
      const approaching=(distance:number,speed:number)=>{
        const gap=signedDistance(merge-distance,this.track.length);
        return speed>12&&gap>-6&&gap<speed*.9;
      };
      if(this.rivals.some((other,j)=>other!==rival&&!other.finished&&this.onRaceLane(j)&&approaching(other.distance,other.speed))||
        this.observedPlayer&&approaching(this.observedPlayer.distance,this.observedPlayer.speed))limit=0;
    }
    return limit;
  }
  private drivePit(index:number,dt:number,weather:WeatherMode){
    const rival=this.rivals[index],plan=this.plans[index],visit=plan.visit!;
    const oldPhase=visit.phase;
    visit.step(rival,dt,oldPhase==='service'?PIT_SPEED_LIMIT:this.pitTrafficLimit(index,visit));
    rival.drsActive=false;
    if(oldPhase==='service'&&visit.phase==='exit'){
      const compound=plan.nextCompound!;
      plan.tires.fit(compound,weather);
      rival.compound=compound;rival.tyreWear=0;rival.pitStops++;
    }
    if(visit.phase==='done'){
      plan.visit=undefined;plan.nextCompound=undefined;plan.targetLane=plan.homeLane;
      plan.lineBlend=0;plan.lineReviewAt=0;plan.preferFastLine=false;
      plan.stintStart=rival.distance;
      plan.laneVelocity=plan.lateralImpulse=plan.yawImpulse=plan.yawOffset=plan.impactRecovery=0;
    }
    rival.pitState=visit.phase==='done'?'idle':visit.phase;
  }
  update(dt:number,weather:WeatherMode='sunny'):void {
    if(!Number.isFinite(dt)||dt<=0)return;
    // Bound individual integration steps for callers other than the game's
    // 120 Hz fixed clock. Splitting preserves acceleration and finish ordering.
    if(dt>1/60){let remaining=dt;while(remaining>1e-9){const step=Math.min(1/60,remaining);this.update(step,weather);remaining-=step;}return;}
    if(this.startingWeather===undefined){
      this.startingWeather=weather;
      if(weather==='rainy')this.plans.forEach((plan,i)=>{plan.tires.fit('wet',weather);this.rivals[i].compound='wet';});
    }
    const started=this.time;this.time+=dt;
    const wet=WEATHER_PHYSICS[weather];
    this.observedPlayer=this.observePlayer();
    for(let i=0;i<this.rivals.length;i++){
      const rival=this.rivals[i],plan=this.plans[i];
      plan.previousDistance=rival.distance;
      const waitingForStart=this.time<plan.reaction;
      if(rival.finished||waitingForStart&&plan.impactRecovery===0)continue;
      if(plan.visit){this.drivePit(i,dt,weather);continue;}
      plan.passCooldown=Math.max(0,plan.passCooldown-dt);
      const pace=this.speedPlan(rival,weather,plan);
      this.updateLine(i,pace,dt);
      let target=this.brakingTarget(rival,plan,pace);
      if(this.track.id==='monaco')target=this.monacoTrafficTarget(rival,i,target,this.monacoLanePreview(rival),weather);
      else target=this.openTrafficTarget(rival,plan,target,weather);
      const offRoad=Math.abs(rival.lateral)>this.track.widthAt(rival.distance)/2;
      const surface=offRoad?this.track.surfaceAt(rival.x,rival.z):'asphalt';
      if(surface!=='asphalt')target=Math.min(target,surface==='grass'?13:17);
      target*=1-.32*Math.min(1,Math.abs(plan.yawOffset));
      const grip=plan.tires.gripMultiplier;
      const centerCurve=this.curvatureAt(rival.distance);
      const curve=this.lineCurvature(rival.distance,plan.targetLane,plan.lineBlend);
      const lateralDemand=curve*rival.speed**2;
      const lateralGrip=lateralGripForSpeed(rival.speed,weather,surface);
      const gripUse=lateralDemand/Math.max(.1,lateralGrip*grip);
      const traction=Math.sqrt(Math.max(0,1-gripUse**2));
      const engine=pace.engine*Math.max(0,1-rival.speed/(55*TRACK_SPEED_SCALE));
      const acceleration=Math.min(engine,30*wet.grip*grip*traction);
      const steeringAuthority=1-.8*clamp(plan.impactRecovery/.32,0,1);
      const braking=32.5*wet.braking*grip*steeringAuthority;
      const gradeForce=5.886*Math.sin(Math.atan(this.track.gradeAt(rival.distance)));
      const drive=waitingForStart?0:clamp((target-rival.speed)/dt,-braking,acceleration*steeringAuthority);
      rival.throttle=acceleration>0?Math.max(0,drive/acceleration):0;
      rival.drsActive=!offRoad&&drive>0&&this.drsAvailable(rival,weather);
      const minimumSpeed=Math.min(0,rival.speed);
      rival.speed=clamp(rival.speed+(drive-gradeForce)*dt,minimumSpeed,Math.max(target,rival.speed));
      const x=rival.x,z=rival.z,heading=rival.heading;
      const blend=plan.lineBlend;
      const pathOffset=blend===0?plan.targetLane:plan.targetLane+(this.racingLine.offsetAt(rival.distance)-plan.targetLane)*blend;
      const scale=laneScale(centerCurve,rival.lateral);
      const laneRate=Math.min(this.laneRate(blend),Math.abs(rival.speed)*.2)*steeringAuthority;
      const laneError=pathOffset-rival.lateral,laneAcceleration=6.5+(this.track.id==='monaco'?0:10*blend);
      const lead=blend===0?0:blend*this.racingLine.slopeAt(rival.distance)*rival.speed/scale;
      const correction=blend>0?laneError*4:Math.sign(laneError)*Math.sqrt(2*laneAcceleration*Math.abs(laneError));
      const wantedLaneVelocity=clamp(lead+correction,-laneRate,laneRate);
      plan.laneVelocity+=clamp(wantedLaneVelocity-plan.laneVelocity,-laneAcceleration*dt,laneAcceleration*dt);
      if(blend===0&&(Math.abs(laneError)<1e-9||plan.laneVelocity*laneError>0&&Math.abs(plan.laneVelocity*dt)>Math.abs(laneError)))plan.laneVelocity=laneError/dt;
      const lateralVelocity=plan.laneVelocity+plan.lateralImpulse;
      rival.lateral+=lateralVelocity*dt;
      const alongSpeed=Math.sign(rival.speed)*Math.sqrt(Math.max(0,rival.speed**2-plan.laneVelocity**2));
      rival.distance+=alongSpeed/scale*dt;
      // Tires scrub the sideways momentum and steer back into line over time.
      // The first movement after an impact still uses the received impulse.
      const scrub=Math.min(Math.abs(plan.lateralImpulse)*3.6,lateralGrip*grip*.78);
      plan.lateralImpulse-=Math.sign(plan.lateralImpulse)*scrub*dt;
      plan.yawOffset=signedAngle(plan.yawOffset+plan.yawImpulse*dt);
      const align=-15*plan.yawOffset-7*plan.yawImpulse;
      plan.yawImpulse+=clamp(align,-grip*13,grip*13)*dt;
      plan.impactRecovery=Math.max(0,plan.impactRecovery-dt);
      const sample=this.place(rival,plan.laneVelocity,plan.yawOffset,curve);
      rival.vx=(rival.x-x)/dt;rival.vz=(rival.z-z)/dt;
      rival.yawRate=signedAngle(rival.heading-heading)/dt;
      if(this.track.id==='monaco'&&(Math.abs(plan.lateralImpulse)>.05||Math.abs(plan.yawOffset)>.015||Math.abs(rival.lateral)>2.81)){
        this.recoverFromWall(rival,plan,sample);
      }
      plan.tires.step({
        dt,speed:rival.speed,lateralSpeed:rival.vx*Math.cos(rival.heading)-rival.vz*Math.sin(rival.heading),yawRate:rival.yawRate,steerAngle:rival.frontWheelAngle,
        longitudinalDemand:drive,lateralDemand,
        longitudinalGrip:26*wet.braking,lateralGrip,weather,surface,
      });
      rival.tyreWear=plan.tires.summary.wear;
      this.considerPit(i,weather);
    }
    const finish=this.totalLaps*this.track.length;
    for(let i=0;i<this.rivals.length;i++){
      const rival=this.rivals[i];
      if(rival.finished||this.plans[i].visit)continue;
      for(let j=i+1;j<this.rivals.length;j++)if(!this.rivals[j].finished&&!this.plans[j].visit)this.contactRival(i,this.rivals[j],dt,j);
    }
    for(let i=0;i<this.rivals.length;i++){
      const rival=this.rivals[i],plan=this.plans[i];
      if(rival.finished)continue;
      if(!plan.visit&&Math.abs(rival.lateral)>this.track.widthAt(rival.distance)/2+TRACK_LIMIT_MARGIN){
        plan.offroadTime+=dt;
        if(!plan.offroadCharged&&plan.offroadTime>=TRACK_LIMIT_DELAY_SECONDS){rival.penalty+=TRACK_LIMIT_PENALTY_SECONDS;plan.offroadCharged=true;}
      }else{plan.offroadTime=0;plan.offroadCharged=false;}
      const length=this.track.length;
      if(Math.floor(rival.distance/length)>Math.floor(plan.previousDistance/length)){
        if(plan.previousDistance>=0&&!plan.pittedThisLap&&!plan.visit)plan.lapTime=clamp(this.time-plan.lapStart,length/45,length/12);
        plan.lapStart=this.time;plan.pittedThisLap=!!plan.visit;
      }
      if(rival.distance>=finish){
        rival.finishTime=started+dt*clamp((finish-plan.previousDistance)/Math.max(1e-9,rival.distance-plan.previousDistance),0,1)+rival.penalty;
        rival.distance=finish;rival.finished=true;rival.speed=rival.vx=rival.vz=rival.yawRate=rival.throttle=0;
        rival.drsActive=false;
        this.place(rival,0);
      }
      this.updateLap(rival);
    }
  }
  private updateLap(rival:AiRival):void {
    rival.completedLaps=Math.min(this.totalLaps,Math.floor(Math.max(0,rival.distance)/this.track.length+1e-10));
    rival.lap=Math.min(this.totalLaps,rival.completedLaps+1);
  }
  private place(rival:AiRival,laneVelocity:number,yawOffset=0,curve=this.curvatureAt(rival.distance)):TrackSample {
    const sample=this.track.sampleAt(rival.distance);
    rival.x=sample.point.x+sample.right.x*rival.lateral;rival.z=sample.point.z+sample.right.z*rival.lateral;
    const steeringLimit=this.track.steeringAngleForSpeed?.(rival.speed)??.25;
    rival.heading=Math.atan2(sample.tangent.x,sample.tangent.z)+Math.atan2(laneVelocity,Math.max(Math.abs(rival.speed),2))+yawOffset;
    rival.frontWheelAngle=clamp(Math.atan(curve*3.1),-steeringLimit,steeringLimit);
    return sample;
  }
  standings(playerProgress:number,playerFinished=false,playerFinishTime?:number):RaceStanding[]{
    const progress=Number.isFinite(playerProgress)?playerProgress:this.playerGridDistance;
    const player:RaceStanding={id:'player',team:this.playerTeam,driver:this.playerDriver,progress,position:0,isPlayer:true,lap:Math.min(this.totalLaps,Math.floor(Math.max(0,progress)/this.track.length)+1),finished:playerFinished,finishTime:playerFinished&&Number.isFinite(playerFinishTime)?playerFinishTime!:null};
    const rows:RaceStanding[]=[player,...this.rivals.map(r=>({id:r.id,team:r.team,driver:r.driver,progress:r.distance,position:0,isPlayer:false,lap:r.lap,finished:r.finished,finishTime:r.finishTime}))];
    rows.sort((a,b)=>{
      if(a.finished!==b.finished)return a.finished?-1:1;
      if(a.finished&&b.finished){const delta=(a.finishTime??Infinity)-(b.finishTime??Infinity);if(delta)return delta;}
      return b.progress-a.progress||this.gridOrder.get(a.id)!-this.gridOrder.get(b.id)!;
    });rows.forEach((row,i)=>{row.position=i+1;});return rows;
  }
  private recoverFromWall(rival:AiRival,plan:RivalPlan,{point,right,tangent}:TrackSample):void {
    // Use the rendered Monaco barriers during contact recovery. Test the
    // whole rotated car against their side planes, not just its centre.
    const side=Math.sign(rival.lateral),fx=Math.sin(rival.heading),fz=Math.cos(rival.heading);
    const walls=this.track.barrierSegmentsAt(rival.x+side*right.x*2,rival.z+side*right.z*2);
    let correction=0,normalX=0,normalZ=0,contactOffset=0;
    for(const wall of walls){
      if(point.y+1.3<wall.bottom||point.y>wall.top+.2)continue;
      const dx=wall.bx-wall.ax,dz=wall.bz-wall.az,length=Math.hypot(dx,dz);
      if(length===0)continue;
      const tx=dx/length,tz=dz/length;
      const roadSide=Math.sign((point.x-wall.ax)*tz-(point.z-wall.az)*tx);
      const nx=tz*roadSide,nz=-tx*roadSide,inward=-(nx*right.x+nz*right.z)*side;
      if(inward<.55)continue;
      const forwardAlong=Math.abs(fx*tx+fz*tz),forwardAcross=Math.abs(fx*nx+fz*nz);
      const halfAlong=RACE_CAR_HALF_LENGTH*forwardAlong+RACE_CAR_HALF_WIDTH*forwardAcross;
      const along=(rival.x-wall.ax)*tx+(rival.z-wall.az)*tz;
      if(along< -halfAlong||along>length+halfAlong)continue;
      const halfAcross=RACE_CAR_HALF_LENGTH*forwardAcross+RACE_CAR_HALF_WIDTH*forwardAlong;
      const wallGap=(rival.x-wall.ax)*nx+(rival.z-wall.az)*nz;
      const visibleEdge=halfAcross+.10;
      const push=(wall.radius+visibleEdge-wallGap)/inward;
      if(push>correction){correction=push;normalX=nx;normalZ=nz;contactOffset=visibleEdge;}
    }
    if(correction<=0)return;
    rival.lateral-=side*correction;
    rival.x-=side*right.x*correction;rival.z-=side*right.z*correction;
    const {vx,vz,yawRate}=rival;
    resolveWallImpulse(rival,normalX,normalZ,rival.x-normalX*contactOffset,rival.z-normalZ*contactOffset);
    const dvx=rival.vx-vx,dvz=rival.vz-vz;
    rival.speed+=dvx*tangent.x+dvz*tangent.z;
    plan.lateralImpulse+=dvx*right.x+dvz*right.z;
    plan.yawImpulse+=rival.yawRate-yawRate;
  }
  private applyContact(index:number,x:number,z:number,vx:number,vz:number,yawRate:number):void {
    const rival=this.rivals[index],plan=this.plans[index];
    const dx=rival.x-x,dz=rival.z-z,dvx=rival.vx-vx,dvz=rival.vz-vz,dyaw=rival.yawRate-yawRate;
    if(dx===0&&dz===0&&dvx===0&&dvz===0&&dyaw===0)return;
    const sample=this.track.sampleAt(rival.distance),{tangent,right}=sample;
    const along=laneScale(this.curvatureAt(rival.distance),rival.lateral);
    // Project only the correction/impulse. Reprojecting the full car can jump
    // to a different branch where the circuit folds back or crosses itself.
    rival.distance+=(dx*tangent.x+dz*tangent.z)/along;
    rival.lateral+=dx*right.x+dz*right.z;
    rival.speed+=dvx*tangent.x+dvz*tangent.z;
    plan.lateralImpulse+=dvx*right.x+dvz*right.z;
    plan.yawImpulse+=dyaw;
    const impulse=Math.hypot(dvx,dvz)+Math.abs(dyaw);
    if(impulse>.8)plan.impactRecovery=Math.max(plan.impactRecovery,Math.min(.32,.08+.025*impulse));
    if(this.track.id==='monaco')this.recoverFromWall(rival,plan,sample);
    this.updateLap(rival);
  }
  private contactRival(index:number,other:RaceContactBody,dt:number,otherIndex?:number):number {
    const rival=this.rivals[index],dx=other.x-rival.x,dz=other.z-rival.z;
    if(dx*dx+dz*dz>=contactRangeSquared)return 0;
    if(this.track.id!=='monza'){
      const rivalHeight=this.track.sampleAt(rival.distance).point.y;
      const otherHeight=otherIndex===undefined?this.track.heightAt(other.x,other.z):this.track.sampleAt(this.rivals[otherIndex].distance).point.y;
      if(Math.abs(rivalHeight-otherHeight)>2.4)return 0;
    }
    const {x,z,vx,vz,yawRate}=rival;
    const bx=other.x,bz=other.z,bvx=other.vx,bvz=other.vz,byaw=other.yawRate??0;
    const impact=resolveRaceContact(rival,other,dt);
    this.applyContact(index,x,z,vx,vz,yawRate);
    if(otherIndex!==undefined)this.applyContact(otherIndex,bx,bz,bvx,bvz,byaw);
    return impact;
  }
  /** The player and rivals receive the same contact impulse. A zero return
   * can still separate overlapping poses without changing their velocity. */
  contactPlayer(body:RaceContactBody,dt:number):number {
    let impact=0;
    for(let i=0;i<this.rivals.length;i++){
      if(!this.rivals[i].finished&&!this.plans[i].visit)impact=Math.max(impact,this.contactRival(i,body,dt));
    }
    return impact;
  }
}
function signedDistance(value:number,length:number){return value-Math.floor(value/length+.5)*length;}
