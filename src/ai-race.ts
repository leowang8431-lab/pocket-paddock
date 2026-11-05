import type {Track} from './track';
import {WEATHER_PHYSICS,type WeatherMode} from './conditions';
import {teams,getTeam,getDriver,DEFAULT_TEAM,type TeamId,type DriverId} from './team-catalog';

export const PLAYER_GRID_DISTANCE=-12;
export const PLAYER_GRID_LATERAL=-2.5;
export interface AiRival {
  id:string;team:TeamId;driver:DriverId;distance:number;speed:number;
  x:number;z:number;heading:number;lateral:number;frontWheelAngle:number;
  lap:number;completedLaps:number;finished:boolean;finishTime:number|null;
}
export interface RaceStanding {
  id:string;team:TeamId;driver:DriverId;progress:number;position:number;isPlayer:boolean;
  lap:number;finished:boolean;finishTime:number|null;
}
export interface AiPlayerObstacle {x:number;z:number;heading:number;speed:number;finished:boolean;}
interface RivalPlan {skill:number;targetLane:number;homeLane:number;passCooldown:number;reaction:number}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const signedAngle=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));

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
  private readonly plans:RivalPlan[]=[];
  private touching=new Set<string>();
  private playerTeam:TeamId=DEFAULT_TEAM;
  private playerDriver:DriverId=getTeam(DEFAULT_TEAM).drivers[0].id;
  private playerObstacle:AiPlayerObstacle|null=null;
  constructor(readonly track:Track,count=5,totalLaps=3){
    this.count=clamp(Math.floor(Number.isFinite(count)?count:5),1,10);
    this.totalLaps=clamp(Math.floor(Number.isFinite(totalLaps)?totalLaps:3),1,99);
    this.curvature=new Float64Array(track.samples.length);
    const step=track.length/track.samples.length,span=3;
    for(let i=0;i<this.curvature.length;i++){
      const a=track.samples[(i-span+track.samples.length)%track.samples.length].tangent;
      const b=track.samples[(i+span)%track.samples.length].tangent;
      this.curvature[i]=signedAngle(Math.atan2(b.x,b.z)-Math.atan2(a.x,a.z))/(step*span*2);
    }
    this.start();
  }
  start(playerTeam:TeamId=DEFAULT_TEAM,playerDriver?:DriverId):void {
    this.playerTeam=playerTeam;
    this.playerDriver=playerDriver&&getDriver(playerDriver)?.teamId===playerTeam?playerDriver:getTeam(playerTeam).drivers[0].id;
    this.time=0;this.rivals.length=0;this.plans.length=0;this.touching.clear();this.playerObstacle=null;
    const roster=teams.filter(team=>team.id!==playerTeam);
    // Six places in a two-column grid: the player occupies P3, left row two.
    const skills=[.955,1,.975,.94,.985,.965,.99,.95,.98,.96];
    for(let i=0;i<this.count;i++){
      const slot=i<2?i:i+1,row=Math.floor(slot/2);
      const team=roster[i%roster.length],driver=team.drivers[i>=roster.length?1:0];
      const lateral=slot%2?-PLAYER_GRID_LATERAL:PLAYER_GRID_LATERAL;
      const rival:AiRival={id:`ai-${i+1}`,team:team.id,driver:driver.id,distance:-5-row*7,speed:0,x:0,z:0,heading:0,lateral,frontWheelAngle:0,lap:1,completedLaps:0,finished:false,finishTime:null};
      this.rivals.push(rival);this.plans.push({skill:skills[i],targetLane:lateral,homeLane:lateral,passCooldown:0,reaction:i*.12});this.place(rival,0);
    }
  }
  private curvatureAt(distance:number):number {
    const index=((Math.floor(distance/this.track.length*this.curvature.length)%this.curvature.length)+this.curvature.length)%this.curvature.length;
    return this.curvature[index];
  }
  /** The actual player pose is observed, never moved or assigned AI progress.
   * Other circuits deliberately ignore this new Monaco traffic input. */
  setPlayerObstacle(obstacle:AiPlayerObstacle|null):void {
    this.playerObstacle=obstacle&&Number.isFinite(obstacle.x+obstacle.z+obstacle.heading+obstacle.speed)?{...obstacle}:null;
  }
  private monacoPlayerAt(distance:number){
    const player=this.playerObstacle;if(!player||player.finished)return null;
    const projection=this.track.roadProjectionAt(player.x,player.z);
    if(projection.gap>this.track.widthAt(projection.distance)/2+2.9)return null;
    const sample=this.track.sampleAt(projection.distance),lateral=(player.x-sample.point.x)*sample.right.x+(player.z-sample.point.z)*sample.right.z;
    const gap=signedDistance(projection.distance-((distance%this.track.length+this.track.length)%this.track.length),this.track.length);
    return{gap,lateral,speed:Math.max(0,player.speed*Math.cos(player.heading-Math.atan2(sample.tangent.x,sample.tangent.z)))};
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
      if(other===rival||other.finished)return[];
      const gap=signedDistance(other.distance-rival.distance,this.track.length);
      // A deterministic priority also separates two cars leaving the same row.
      return gap>.02||Math.abs(gap)<=.02&&j<index?[{other,gap:Math.max(0,gap)}]:[];
    });
    const player=this.monacoPlayerAt(rival.distance);
    if(player&&player.gap>=-.02)ahead.push({other:{...rival,id:'player',lateral:player.lateral,speed:player.speed},gap:Math.max(0,player.gap)});
    ahead.sort((a,b)=>a.gap-b.gap);
    const observed=ahead.filter(entry=>entry.gap<Math.max(42,rival.speed*1.8));
    const blocker=observed.find(entry=>merging||Math.abs(entry.other.lateral-rival.lateral)<2.9);
    if(blocker){
      if(!merging&&this.time>2.5&&plan.passCooldown===0){
        const passingLane=-Math.sign(rival.lateral||plan.targetLane||plan.homeLane)*Math.min(2.8,limit);
        const laneFree=!this.rivals.some(other=>other!==rival&&!other.finished&&Math.abs(other.lateral-passingLane)<2.9&&Math.abs(signedDistance(other.distance-rival.distance,this.track.length))<12)&&!(player&&Math.abs(player.lateral-passingLane)<2.9&&Math.abs(player.gap)<12);
        if(laneFree){plan.targetLane=passingLane;plan.passCooldown=3;}
      }
      if(merging||Math.abs(rival.lateral-blocker.other.lateral)<2.9){
        const closing=Math.max(0,rival.speed-blocker.other.speed),desiredGap=6.5+rival.speed*(weather==='rainy'?.9:.7)+closing*.5;
        target=Math.min(target,Math.max(0,blocker.other.speed+(blocker.gap-desiredGap)*.85));
      }
    }
    // If an unusual collision/restart leaves a car late to merge, brake first
    // rather than snapping its lateral position inside the next narrow road.
    for(let ahead=3;ahead<=100;ahead+=3){const excess=Math.abs(rival.lateral)-this.monacoLaneLimitAt(rival.distance+ahead);if(excess>.05)target=Math.min(target,ahead/(excess/.95+.45));}
    return target;
  }
  /** Look far enough ahead to brake before a tight turn, rather than changing
   * speed only after the car has already reached the corner apex. */
  targetSpeed(rival:AiRival,weather:WeatherMode='sunny'):number {
    const index=this.rivals.indexOf(rival),skill=this.plans[index]?.skill??.96;
    const wet=WEATHER_PHYSICS[weather],top=37.8*skill*(weather==='rainy'?.90:1),braking=23*wet.braking;
    let target=top;
    for(let ahead=0;ahead<=95;ahead+=5){
      const curve=Math.abs(this.curvatureAt(rival.distance+ahead));
      // Conservative cornering accounts for the AI's perfect centre-line path.
      // It keeps a clean human lap competitive without speed rubber-banding.
      const denominator=Math.max(.001,curve-.0015*wet.grip);
      const corner=Math.min(top,Math.sqrt(7.5*wet.grip/denominator)*skill);
      target=Math.min(target,Math.sqrt(corner*corner+2*braking*Math.max(0,ahead-5)));
    }
    return target;
  }
  update(dt:number,weather:WeatherMode='sunny'):void {
    if(!Number.isFinite(dt)||dt<=0)return;
    // Bound individual integration steps for callers other than the game's
    // 120 Hz fixed clock. Splitting preserves acceleration and finish ordering.
    if(dt>1/60){let remaining=dt;while(remaining>1e-9){const step=Math.min(1/60,remaining);this.update(step,weather);remaining-=step;}return;}
    const started=this.time;this.time+=dt;
    const wet=WEATHER_PHYSICS[weather];
    for(let i=0;i<this.rivals.length;i++){
      const rival=this.rivals[i],plan=this.plans[i];
      if(rival.finished||this.time<plan.reaction)continue;
      plan.passCooldown=Math.max(0,plan.passCooldown-dt);
      let target=this.targetSpeed(rival,weather);
      if(this.track.id==='monaco')target=this.monacoTrafficTarget(rival,i,target,this.monacoLanePreview(rival),weather);
      else{
      const ahead=this.rivals.filter(other=>other!==rival&&!other.finished).map(other=>({other,gap:(other.distance-rival.distance+this.track.length)%this.track.length}));
      const blocker=ahead.filter(entry=>entry.gap>0&&entry.gap<14&&Math.abs(entry.other.lateral-rival.lateral)<2.7).sort((a,b)=>a.gap-b.gap)[0];
      if(blocker&&this.time>2.5){
        const passingLane=-Math.sign(rival.lateral||plan.targetLane)*2.8;
        const laneFree=!this.rivals.some(other=>other!==rival&&!other.finished&&Math.abs(other.lateral-passingLane)<2.6&&Math.abs(signedDistance(other.distance-rival.distance,this.track.length))<11);
        if(laneFree&&plan.passCooldown===0){plan.targetLane=passingLane;plan.passCooldown=3;}
        // A safe queue while moving across; prevents AI cars interpenetrating.
        if(Math.abs(rival.lateral-blocker.other.lateral)<2.5&&blocker.gap<8)target=Math.min(target,Math.max(0,blocker.other.speed+(blocker.gap-5)*1.1));
      }
      }
      const acceleration=12.4*wet.acceleration*(1-rival.speed/55),braking=25*wet.braking;
      const gradeForce=5.886*Math.sin(Math.atan(this.track.gradeAt(rival.distance)));
      rival.speed=clamp(rival.speed+clamp(target-rival.speed,-braking*dt,acceleration*dt)-gradeForce*dt,0,40);
      const previousDistance=rival.distance,next=previousDistance+rival.speed*dt,finish=this.totalLaps*this.track.length;
      const previousLateral=rival.lateral;
      const laneRate=this.track.id==='monaco'?Math.min(.95,rival.speed*.15):.95;
      rival.lateral+=clamp(plan.targetLane-rival.lateral,-laneRate*dt,laneRate*dt);
      if(next>=finish){
        rival.distance=finish;rival.finished=true;rival.finishTime=started+dt*(finish-previousDistance)/Math.max(1e-9,next-previousDistance);rival.speed=0;
      }else rival.distance=next;
      rival.completedLaps=Math.min(this.totalLaps,Math.floor(Math.max(0,rival.distance)/this.track.length+1e-10));
      rival.lap=Math.min(this.totalLaps,rival.completedLaps+1);
      this.place(rival,(rival.lateral-previousLateral)/dt);
    }
  }
  private place(rival:AiRival,laneVelocity:number):void {
    const sample=this.track.sampleAt(rival.distance);
    rival.x=sample.point.x+sample.right.x*rival.lateral;rival.z=sample.point.z+sample.right.z*rival.lateral;
    if(this.track.id==='monaco'){
      const curve=this.curvatureAt(rival.distance),along=Math.max(.25,1-curve*rival.lateral),steeringLimit=this.track.steeringAngleForSpeed?.(rival.speed)??.56;
      rival.heading=Math.atan2(sample.tangent.x,sample.tangent.z)+Math.atan2(laneVelocity,Math.max(rival.speed*along,2));
      rival.frontWheelAngle=clamp(Math.atan(curve*3.1/along),-steeringLimit,steeringLimit);
    }else{
      rival.heading=Math.atan2(sample.tangent.x,sample.tangent.z)+Math.atan2(laneVelocity,Math.max(rival.speed,2));
      rival.frontWheelAngle=clamp(Math.atan(this.curvatureAt(rival.distance)*3.1),-.25,.25);
    }
  }
  standings(playerProgress:number,playerFinished=false,playerFinishTime?:number):RaceStanding[]{
    const progress=Number.isFinite(playerProgress)?playerProgress:PLAYER_GRID_DISTANCE;
    const player:RaceStanding={id:'player',team:this.playerTeam,driver:this.playerDriver,progress,position:0,isPlayer:true,lap:Math.min(this.totalLaps,Math.floor(Math.max(0,progress)/this.track.length)+1),finished:playerFinished,finishTime:playerFinished&&Number.isFinite(playerFinishTime)?playerFinishTime!:null};
    const rows:RaceStanding[]=[player,...this.rivals.map(r=>({id:r.id,team:r.team,driver:r.driver,progress:r.distance,position:0,isPlayer:false,lap:r.lap,finished:r.finished,finishTime:r.finishTime}))];
    rows.sort((a,b)=>{
      if(a.finished!==b.finished)return a.finished?-1:1;
      if(a.finished&&b.finished){const delta=(a.finishTime??Infinity)-(b.finishTime??Infinity);if(delta)return delta;}
      return b.progress-a.progress||Number(b.isPlayer)-Number(a.isPlayer)||a.id.localeCompare(b.id);
    });rows.forEach((row,i)=>{row.position=i+1;});return rows;
  }
  /** Bounded physical separation and speed loss, never a progress teleport.
   * Finished rivals leave the active grid and cannot block the finish line. */
  contact(x:number,z:number,heading:number,speed:number,dt:number):{x:number;z:number;speed:number;hit:boolean}{
    if(!Number.isFinite(dt)||dt<=0)return{x,z,speed,hit:false};
    let hit=false;const nextTouching=new Set<string>();
    for(const rival of this.rivals){
      if(rival.finished)continue;
      const dx=x-rival.x,dz=z-rival.z,rightX=Math.cos(rival.heading),rightZ=-Math.sin(rival.heading),forwardX=Math.sin(rival.heading),forwardZ=Math.cos(rival.heading);
      const side=dx*rightX+dz*rightZ,along=dx*forwardX+dz*forwardZ;
      const radius=Math.hypot(side/2.25,along/4.1);
      if(radius>=1)continue;
      hit=true;nextTouching.add(rival.id);
      let nx=side/(2.25*2.25)*rightX+along/(4.1*4.1)*forwardX,nz=side/(2.25*2.25)*rightZ+along/(4.1*4.1)*forwardZ;
      const magnitude=Math.hypot(nx,nz);if(magnitude<1e-9){nx=Math.cos(heading);nz=-Math.sin(heading);}else{nx/=magnitude;nz/=magnitude;}
      const push=Math.min((1-radius)*2.25,.18+dt*5);x+=nx*push;z+=nz*push;
      if(!this.touching.has(rival.id)){
        const alignment=Math.max(0,Math.cos(heading-rival.heading));
        const closing=Math.max(0,Math.abs(speed)-rival.speed*alignment);
        const factor=clamp(.91-closing*.008,.58,.91);speed*=factor;rival.speed=Math.max(0,rival.speed-Math.min(3,closing*.18));
      }
    }
    this.touching=nextTouching;return{x,z,speed,hit};
  }
}
function signedDistance(value:number,length:number){return ((value+length*1.5)%length)-length/2;}
