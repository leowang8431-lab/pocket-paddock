import {teams,type TeamId} from './team-catalog';
import type {PitCompound} from './pit-stop-animation';
import {SPA_PIT_LAYOUT} from './spa-pit-layout';
import {MONZA_PIT_LAYOUT} from './monza-pit-layout';
import {monacoPitIndex} from './monaco-team-pits';
import type {MonacoDrivingTrack} from './monaco-drive-track';
import {KMH_PER_SPEED_UNIT} from './speed-scale';

type Point={x:number;y:number;z:number};
export interface PitLaneTrack {
  readonly id:'monza'|'spa'|'monaco';readonly length:number;readonly width:number;
  readonly monacoDrive?:Pick<MonacoDrivingTrack,'pitBoxes'|'pitProfile'>;
  readonly pitPath:readonly Readonly<Point>[];
  readonly spaPitProfile?:{exitFlatArc:number};
  nearest(x:number,z:number):{point:{x:number;z:number};distance:number};
  roadProjectionAt?(x:number,z:number):{gap:number};
  isPitLane(x:number,z:number):boolean;
  heightAt?(x:number,z:number):number;
  widthAt?(distance:number):number;
}
export interface PitVehicle {
  x:number;z:number;heading:number;speed:number;vx:number;vz:number;steering:number;
  brakePressure:number;throttlePressure:number;frontWheelAngle:number;drsActive:boolean;
  surface:'asphalt'|'grass'|'gravel';collision:number;gripUsage:number;sliding:boolean;lateralSpeed:number;yawRate:number;
}
type Node=Point&{arc:number;base:number};
type Projection=Point&{arc:number;gap:number;tx:number;tz:number};
export type PitLaneState='idle'|'approach'|'service'|'exit';
export const PIT_SPEED_LIMIT_KMH=120;
export const PIT_SPEED_LIMIT=PIT_SPEED_LIMIT_KMH/KMH_PER_SPEED_UNIT;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(t:number)=>{const n=clamp(t,0,1);return n*n*(3-2*n);};
const angle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const approach=(a:number,b:number,d:number)=>a<b?Math.min(b,a+d):Math.max(b,a-d);
const modulo=(n:number,length:number)=>((n%length)+length)%length;

/** One physical bay assignment for the player and automated rivals. */
export function getPitServiceBay(track:Pick<PitLaneTrack,'id'|'monacoDrive'>,team:TeamId){
  const index=track.id==='monaco'?monacoPitIndex(team):Math.max(0,teams.findIndex(t=>t.id===team));
  const bay=track.id==='monaco'?track.monacoDrive?.pitBoxes[index]:undefined;
  if(track.id==='monaco'&&!bay)throw new Error('Monaco garage assignment is unavailable.');
  const x=bay?.apronCenter.x??(track.id==='monza'?MONZA_PIT_LAYOUT.stopX:SPA_PIT_LAYOUT.stopX);
  const y=bay?.apronCenter.y??0,z=bay?.apronCenter.z??(track.id==='monza'?MONZA_PIT_LAYOUT.firstBayZ+index*MONZA_PIT_LAYOUT.baySpacing:243-index*13.2);
  return {id:`${track.id}:${index}`,x,y,z,heading:bay?Math.atan2(bay.tangent.x,bay.tangent.z):Math.PI};
}

/** The manual entrance feeds one deterministic route through the selected bay.
 * Route nodes reuse the rendered pit road, including Spa's separate ramps.
 * A single random service duration is drawn only when a valid entrance is crossed. */
export class PitLaneController {
  private readonly lane:Node[]=[];
  private readonly gate:Projection;
  private readonly entranceEnd:number;
  private route:Node[]=[];
  private routeArc=0;
  private stopArc=0;
  private state:PitLaneState='idle';
  private team:TeamId=teams[0].id;
  private compound:PitCompound='medium';
  private currentCompound:PitCompound='medium';
  private serviceDuration=0;
  private serviceElapsed=0;
  private completedStops=0;
  private priorManual:Projection|null=null;
  private priorPosition:{x:number;z:number}|null=null;
  private raceStart=0;
  private raceSpan=0;
  private capturedBase=0;
  private raceDistance=0;
  private groundHeight=0;
  private limited=false;
  private legalPit=false;
  private forward=0;
  private manualPosition:{x:number;z:number}|null=null;
  private manualBase=0;
  private stop={x:0,y:0,z:0,heading:Math.PI,groundHeight:0};

  constructor(private readonly track:PitLaneTrack,private readonly random:()=>number=Math.random){
    let arc=0;
    for(const p of track.pitPath){const previous=this.lane.at(-1);if(previous)arc+=Math.hypot(p.x-previous.x,p.z-previous.z);this.lane.push({...p,arc,base:arc});}
    if(this.lane.length<2||arc<10)throw new Error('A connected pit lane is required.');
    // A gate beyond the overlap at the road join cannot be crossed by a car
    // simply following the main straight, even at the full road-edge width.
    const gateNode=this.lane.find(p=>{const near=track.nearest(p.x,p.z);return p.arc>5&&Math.hypot(p.x-near.point.x,p.z-near.point.z)>(track.widthAt?.(near.distance)??track.width)/2+2;});
    this.gate=this.sample(this.lane,gateNode?.arc??Math.min(20,arc*.1));
    // The whole Monza entry branch, including the settling straight before
    // the first possible team bay, is an assistance area. The reference gate
    // remains useful for navigation; crossing one narrow line is not required.
    const firstApproachedBayZ=MONZA_PIT_LAYOUT.firstBayZ+(teams.length-1)*MONZA_PIT_LAYOUT.baySpacing;
    this.entranceEnd=track.id==='monza'?this.projectAtZ(firstApproachedBayZ+32).arc:this.gate.arc+8;
  }
  get entry(){return{x:this.gate.x,y:this.gate.y,z:this.gate.z,heading:Math.atan2(this.gate.tx,this.gate.tz),laneArc:this.gate.arc};}
  get exit(){const p=this.sample(this.lane,this.lane.at(-1)!.arc);return{x:p.x,y:p.y,z:p.z,heading:Math.atan2(p.tx,p.tz)};}
  get summary(){return{state:this.state,active:this.state!=='idle',controlled:this.state==='approach'||this.state==='service',limited:this.limited,legalPit:this.legalPit,forward:this.forward,team:this.team,compound:this.compound,currentCompound:this.currentCompound,
    serviceDuration:this.serviceDuration,serviceElapsed:this.serviceElapsed,progress:this.serviceDuration?clamp(this.serviceElapsed/this.serviceDuration,0,1):0,
    completedStops:this.completedStops,raceDistance:this.raceDistance,speedLimitKmh:PIT_SPEED_LIMIT_KMH,groundHeight:this.groundHeight,
    routeDistance:this.routeArc,routeLength:this.route.at(-1)?.arc??0,stop:{...this.stop},entry:this.entry,exit:this.exit};}

  /** Cancel just this visit, retaining tyres which were actually installed. */
  cancel(){this.state='idle';this.route=[];this.routeArc=0;this.stopArc=0;this.priorManual=null;this.priorPosition=null;this.manualPosition=null;this.serviceElapsed=0;this.serviceDuration=0;this.limited=false;this.legalPit=false;this.forward=0;}
  reset(compound:PitCompound='medium'){this.cancel();this.currentCompound=compound;this.compound=compound;this.completedStops=0;this.raceDistance=0;}

  /** Only approach/service own the car. Completion releases all controls on
   * that same step; afterPhysics certifies actual manual movement separately. */
  update(dt:number,vehicle:PitVehicle,team:TeamId,compound:PitCompound):boolean {
    if(!Number.isFinite(dt)||dt<=0)return this.state==='approach'||this.state==='service';
    this.legalPit=false;this.forward=0;
    if(this.state==='exit'){
      // Monza's two road ribbons overlap at the join. Once the player reaches
      // the GP asphalt/kerb, the visit can still certify its last route sample
      // without imposing another frame of the pit-road speed limit.
      if(this.track.id==='monza'){this.limited=this.track.isPitLane(vehicle.x,vehicle.z);if(this.limited)this.limitSpeed(vehicle);}
      else this.limitSpeed(vehicle);
      return false;
    }
    if(this.state==='idle'){
      if(this.track.id==='monza'){this.limited=this.track.isPitLane(vehicle.x,vehicle.z);if(this.limited)this.limitSpeed(vehicle);}
      const current=this.project(vehicle.x,vehicle.z),near=this.track.nearest(vehicle.x,vehicle.z);
      const half=(this.track.widthAt?.(near.distance)??this.track.width)/2;
      const alignment=Math.sin(vehicle.heading)*current.tx+Math.cos(vehicle.heading)*current.tz;
      const movingForward=alignment>(this.track.id==='monza'?-.1:.5)&&vehicle.speed>.1;
      const moved=this.priorPosition?Math.hypot(vehicle.x-this.priorPosition.x,vehicle.z-this.priorPosition.z):Infinity;
      const crossed=this.priorManual&&this.priorManual.arc<this.gate.arc&&current.arc>=this.gate.arc&&current.arc<this.gate.arc+8;
      const captureWidth=this.track.id==='monza'?6.05:this.track.id==='monaco'?Math.max(3.3,(this.track.monacoDrive?.pitProfile.fastWidth??0)/2-.95):3.3;
      const plausible=moved>1e-6&&moved<Math.max(1.2,Math.abs(vehicle.speed)*dt*2.5);
      const entered=this.track.id==='monza'
        ?current.arc<=this.entranceEnd&&current.gap<=captureWidth&&this.track.isPitLane(vehicle.x,vehicle.z)
        :!!crossed&&current.gap<captureWidth&&this.priorManual!.gap<captureWidth+.5;
      const legal=entered&&movingForward&&plausible&&Math.hypot(vehicle.x-near.point.x,vehicle.z-near.point.z)>half+1;
      this.priorManual=current;this.priorPosition={x:vehicle.x,z:vehicle.z};
      if(!legal)return false;
      this.begin(vehicle,current,team,compound);
      // Cap speed without teleporting to the lane centre on the capture frame.
      vehicle.speed=clamp(vehicle.speed,0,PIT_SPEED_LIMIT);this.setVehicleMotion(vehicle,0,current.tx,current.tz);
      this.limited=true;this.legalPit=true;this.forward=1;
      return true;
    }
    if(this.state==='service'){
      this.serviceElapsed=Math.min(this.serviceDuration,this.serviceElapsed+dt);
      vehicle.speed=0;this.setVehicleMotion(vehicle,0,Math.sin(this.stop.heading),Math.cos(this.stop.heading));
      this.limited=true;this.legalPit=true;this.forward=1;
      if(this.serviceElapsed>=this.serviceDuration){
        this.currentCompound=this.compound;this.completedStops++;this.state='exit';
        this.manualPosition={x:vehicle.x,z:vehicle.z};this.manualBase=this.project(vehicle.x,vehicle.z).arc;
        // No auto-acceleration or steering after the tyres have been installed.
        vehicle.throttlePressure=vehicle.brakePressure=0;vehicle.steering=vehicle.frontWheelAngle=vehicle.yawRate=0;
        return false;
      }
      return true;
    }
    const end=this.stopArc;
    const remaining=Math.max(0,end-this.routeArc),deceleration=12;
    const target=Math.min(PIT_SPEED_LIMIT,Math.sqrt(2*deceleration*remaining));
    const oldSpeed=clamp(vehicle.speed,0,PIT_SPEED_LIMIT);
    vehicle.speed=approach(oldSpeed,target,(target<oldSpeed?deceleration:4.5)*dt);
    const step=Math.min(remaining,(oldSpeed+vehicle.speed)*.5*dt);
    this.routeArc+=step;
    const p=this.sample(this.route,this.routeArc),oldHeading=vehicle.heading;
    vehicle.x=p.x;vehicle.z=p.z;this.groundHeight=p.y;
    const desired=Math.atan2(p.tx,p.tz);
    vehicle.heading+=angle(desired-vehicle.heading)*(1-Math.exp(-12*dt));
    vehicle.yawRate=angle(vehicle.heading-oldHeading)/dt;
    this.setVehicleMotion(vehicle,dt,p.tx,p.tz);
    if(vehicle.speed<oldSpeed-1e-6){vehicle.throttlePressure=0;vehicle.brakePressure=clamp((oldSpeed-vehicle.speed)/(deceleration*dt),0,1);}
    this.setRaceDistance(p.base);this.limited=true;this.legalPit=true;this.forward=1;
    if(remaining-step<1e-6){
      vehicle.speed=0;vehicle.heading=this.stop.heading;this.groundHeight=this.stop.y;this.setVehicleMotion(vehicle,0,Math.sin(this.stop.heading),Math.cos(this.stop.heading));this.state='service';
    }
    return true;
  }

  /** Run after player physics/contact on every live step. This hard governor
   * changes velocity only, leaving throttle, brake and steering in the player's
   * hands. A visit, an automatic driver and a speed-limited road are distinct. */
  afterPhysics(dt:number,vehicle:PitVehicle):void {
    if(!Number.isFinite(dt)||dt<=0)return;
    if(this.state==='approach'||this.state==='service'){this.limited=true;this.limitSpeed(vehicle);return;}
    const inRoad=this.track.isPitLane(vehicle.x,vehicle.z);
    if(this.state!=='exit'){this.limited=inRoad;if(this.limited)this.limitSpeed(vehicle);return;}
    const current=this.project(vehicle.x,vehicle.z),end=this.lane.at(-1)!.arc;
    const moved=this.manualPosition?Math.hypot(vehicle.x-this.manualPosition.x,vehicle.z-this.manualPosition.z):Infinity;
    const plausible=moved<=Math.max(.8,PIT_SPEED_LIMIT*dt*2.5);
    // A declared exit briefly shares asphalt with the race track. Follow its
    // connected corridor to the actual end, without granting all nearby main
    // road positions a pit exemption.
    const near=this.track.nearest(vehicle.x,vehicle.z),raceHalf=(this.track.widthAt?.(near.distance)??this.track.width)/2,raceGap=this.track.roadProjectionAt?.(vehicle.x,vehicle.z).gap??Math.hypot(vehicle.x-near.point.x,vehicle.z-near.point.z);
    // Spa's inner La Source exit shares coplanar paving with the race road
    // before the last forty units. Main-road ownership correctly disables
    // isPitLane there, but must not end an otherwise continuous legal visit.
    // Certify only that paved overlap, still within the narrow route corridor.
    const spaSharedExit=this.track.id==='spa'&&current.arc>=(this.track.spaPitProfile?.exitFlatArc??Infinity)&&raceGap<=raceHalf+.15;
    const merging=(current.arc>end-40||spaSharedExit)&&current.gap<3.3;
    const connected=(inRoad||merging)&&current.arc>=this.capturedBase-1;
    this.limited=this.track.id==='monza'?inRoad:true;if(this.limited)this.limitSpeed(vehicle);
    if(!plausible||!connected){this.endVisit();this.limited=inRoad;return;}
    // At a curved apron, the closest lane segment can switch while the car is
    // still moving continuously. Bound certification by actual displacement
    // and its direction; neither a projection branch nor a stationary wait
    // can jump checkpoints or advance a car which is reversing.
    const along=(vehicle.x-this.manualPosition!.x)*current.tx+(vehicle.z-this.manualPosition!.z)*current.tz;
    const advance=along>1e-8?clamp(current.arc-this.manualBase,0,moved*2.5):along< -1e-8?clamp(current.arc-this.manualBase,-moved*2.5,0):0;
    const certified=clamp(this.manualBase+advance,this.capturedBase,end);
    this.setRaceDistance(certified);this.groundHeight=this.track.heightAt?.(vehicle.x,vehicle.z)??current.y;
    this.legalPit=true;this.forward=advance>.000001?1:advance<-.000001?-1:0;
    this.manualBase=certified;this.manualPosition={x:vehicle.x,z:vehicle.z};
    // A stationary or reversing car never receives free progress. Merely
    // waiting cannot move routeDistance, the race clock's checkpoint distance,
    // or the exit state.
    for(let i=1;i<this.route.length;i++)if(this.route[i].base>=certified){const a=this.route[i-1],b=this.route[i],fraction=clamp((certified-a.base)/Math.max(1e-9,b.base-a.base),0,1);this.routeArc=lerp(a.arc,b.arc,fraction);break;}
    const last=this.lane.at(-1)!,past=(vehicle.x-last.x)*current.tx+(vehicle.z-last.z)*current.tz;
    if(certified>=end-.02&&current.arc>=end-.02&&past>=-.02&&advance>=0){
      this.setRaceDistance(end);this.routeArc=this.route.at(-1)?.arc??this.routeArc;this.groundHeight=last.y;
      this.endVisit();this.limited=false;
      // Preserve this one final, physically reached checkpoint sample. The
      // following idle update returns to normal main-road validation.
      this.legalPit=true;this.forward=1;
    }
  }

  private limitSpeed(vehicle:PitVehicle){
    const velocity=Math.hypot(vehicle.vx,vehicle.vz),peak=Math.max(Math.abs(vehicle.speed),velocity);
    if(peak>PIT_SPEED_LIMIT){const ratio=PIT_SPEED_LIMIT/peak;vehicle.speed*=ratio;vehicle.vx*=ratio;vehicle.vz*=ratio;vehicle.lateralSpeed*=ratio;}
    if(this.limited||this.state!=='idle')vehicle.drsActive=false;
  }
  private setRaceDistance(base:number){this.raceDistance=modulo(this.raceStart+this.raceSpan*clamp((base-this.capturedBase)/(this.lane.at(-1)!.arc-this.capturedBase),0,1),this.track.length);}
  private endVisit(){this.state='idle';this.priorManual=null;this.priorPosition=null;this.manualPosition=null;this.legalPit=false;this.forward=0;}

  private begin(vehicle:PitVehicle,position:Projection,team:TeamId,compound:PitCompound){
    this.team=team;this.compound=compound;this.state='approach';this.routeArc=0;this.serviceElapsed=0;
    const draw=this.random();this.serviceDuration=2+2*clamp(Number.isFinite(draw)?draw:.5,0,1);
    const {x,y,z,heading}=getPitServiceBay(this.track,team),monaco=this.track.id==='monaco';
    const projected=monaco?this.project(x,z):this.projectAtZ(z),baseStop=projected.arc;
    this.stop={x,y,z,heading,groundHeight:y};
    this.capturedBase=position.arc;this.raceStart=this.track.nearest(vehicle.x,vehicle.z).distance;
    const exit=this.lane.at(-1)!;this.raceSpan=modulo(this.track.nearest(exit.x,exit.z).distance-this.raceStart,this.track.length);
    this.raceDistance=this.raceStart;this.groundHeight=position.y;
    const points=[position.arc,baseStop,...Array.from({length:Math.ceil((exit.arc-position.arc)/.5)},(_,i)=>Math.min(exit.arc,position.arc+(i+1)*.5)),exit.arc].filter(s=>s>=position.arc).sort((a,b)=>a-b);
    this.route=[];let arc=0,lastBase=-Infinity;
    for(const base of points){
      if(base-lastBase<1e-7)continue;lastBase=base;
      const p=this.sample(this.lane,base),distance=Math.abs(base-baseStop),weight=1-smooth(distance/(monaco?36:this.track.id==='spa'?26:14));
      const target=monaco?{x:p.x+(x-projected.x)*weight,y:p.y+(y-projected.y)*weight,z:p.z+(z-projected.z)*weight}:{x:lerp(p.x,x,weight),y:lerp(p.y,0,weight),z:p.z};
      if(base===baseStop)Object.assign(target,{x,y,z});
      const merge=smooth((base-position.arc)/9),along=base-position.arc;
      const point={x:lerp(vehicle.x+position.tx*along,target.x,merge),y:lerp(position.y,target.y,merge),z:lerp(vehicle.z+position.tz*along,target.z,merge)};
      const previous=this.route.at(-1);if(previous)arc+=Math.hypot(point.x-previous.x,point.z-previous.z);
      this.route.push({...point,arc,base});if(base===baseStop)this.stopArc=arc;
    }
  }
  private setVehicleMotion(vehicle:PitVehicle,dt:number,tx:number,tz:number){
    vehicle.vx=tx*vehicle.speed;vehicle.vz=tz*vehicle.speed;
    vehicle.throttlePressure=vehicle.speed>0?.3:0;vehicle.brakePressure=vehicle.speed===0?1:0;
    vehicle.steering=dt?clamp(vehicle.yawRate*.35,-1,1):0;vehicle.frontWheelAngle=vehicle.steering*.3;
    vehicle.drsActive=false;vehicle.surface='asphalt';vehicle.collision=0;vehicle.gripUsage=0;vehicle.sliding=false;vehicle.lateralSpeed=0;
    if(!dt)vehicle.yawRate=0;
  }
  private sample(nodes:readonly Node[],at:number):Projection&{base:number}{
    const s=clamp(at,0,nodes.at(-1)!.arc);
    let lo=0,hi=nodes.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(nodes[mid].arc<=s)lo=mid;else hi=mid;}
    const a=nodes[lo],b=nodes[hi],d=Math.max(1e-9,b.arc-a.arc),t=(s-a.arc)/d,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1;
    return{x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t),arc:s,base:lerp(a.base,b.base,t),gap:0,tx:dx/length,tz:dz/length};
  }
  private project(x:number,z:number):Projection {
    let best:Projection={...this.lane[0],gap:Infinity,tx:0,tz:-1};
    for(let i=1;i<this.lane.length;i++){
      const a=this.lane[i-1],b=this.lane[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/len2,0,1),px=a.x+dx*t,pz=a.z+dz*t,gap=Math.hypot(x-px,z-pz);
      if(gap<best.gap){const length=Math.sqrt(len2);best={x:px,y:lerp(a.y,b.y,t),z:pz,arc:lerp(a.arc,b.arc,t),gap,tx:dx/length,tz:dz/length};}
    }return best;
  }
  private projectAtZ(z:number){
    // All service bays are on the monotonic straight between the two ramps.
    for(let i=1;i<this.lane.length;i++){const a=this.lane[i-1],b=this.lane[i];if(a.z>=z&&b.z<=z)return this.sample(this.lane,lerp(a.arc,b.arc,(a.z-z)/(a.z-b.z)));}
    throw new Error('The selected garage is not on the pit straight.');
  }
}
