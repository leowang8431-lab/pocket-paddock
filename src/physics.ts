import {WEATHER_PHYSICS,type WeatherMode} from './conditions';
import {BRAKE_BUILD_SECONDS,BRAKE_RELEASE_SECONDS,lateralGripForSpeed,steeringAngleForSpeed,WHEELBASE} from './handling';
import {TireSet} from './tire-physics';
import {TRACK_SPEED_SCALE} from './speed-scale';
import {resolveWallImpulse} from './race-contact';
export type Surface = 'asphalt' | 'grass' | 'gravel';
export interface Controls { throttle: boolean; brake: boolean; left: boolean; right: boolean; throttleAmount?:number; brakeAmount?:number; steerAmount?:number }
export interface PhysicsTrack {
  width: number;
  steeringAngleForSpeed?:(speed:number)=>number;
  heightAt?:(x:number,z:number)=>number;
  barrierSegments?:readonly {ax:number;az:number;bx:number;bz:number;radius:number;bottom:number;top:number}[];
  barrierSegmentsAt?:(x:number,z:number)=>readonly {ax:number;az:number;bx:number;bz:number;radius:number;bottom:number;top:number}[];
  gradeAt?:(distance:number)=>number;
  gradeAlongHeadingAt?:(x:number,z:number,heading:number)=>number;
  barrierOffset?:number;
  colliders?: readonly {minX:number;maxX:number;minZ:number;maxZ:number}[];
  nearest(x: number, z: number): {point: {x:number;z:number}; tangent: {x:number;z:number}; distance:number};
  surfaceAt(x:number,z:number): Surface;
}
const damp = (a:number,b:number,k:number,dt:number) => a+(b-a)*(1-Math.exp(-k*dt));
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,value));
const approach=(value:number,target:number,step:number)=>value<target?Math.min(target,value+step):Math.max(target,value-step);
const pedal=(amount:number|undefined,pressed:boolean)=>amount!==undefined&&Number.isFinite(amount)?clamp(amount,0,1):Number(pressed);
const maxRoadSpeed=40*TRACK_SPEED_SCALE,maxDrsSpeed=44.5*TRACK_SPEED_SCALE;
const obstacleRadius=.95;
export class VehiclePhysics {
  readonly tires=new TireSet();
  x=0; z=0; heading=0; speed=0; steering=0; vx=0; vz=0; collision=0; surface:Surface='asphalt';
  /** Tire demand / available grip. Values above one mean the front tires saturate. */
  gripUsage=0; sliding=false; lateralSpeed=0; yawRate=0;
  brakePressure=0; throttlePressure=0; frontWheelAngle=0; drsActive=false;
  private brakingFromForward=false;
  private reverseHold=0;
  private steeringYaw=0;
  private impactYaw=0;
  weather:WeatherMode='sunny';
  reset(x:number,z:number,heading:number) {
    Object.assign(this,{x,z,heading,speed:0,steering:0,vx:0,vz:0,collision:0,
      gripUsage:0,sliding:false,lateralSpeed:0,yawRate:0,brakePressure:0,throttlePressure:0,
      frontWheelAngle:0,drsActive:false,brakingFromForward:false,reverseHold:0,steeringYaw:0,impactYaw:0});
  }
  /** The contact solver updates world velocity before it reaches the tires. */
  receiveContact(impactSpeed:number) {
    if(impactSpeed<=0)return;
    const forward=this.vx*Math.sin(this.heading)+this.vz*Math.cos(this.heading);
    const speed=Math.hypot(this.vx,this.vz);
    const direction=Math.abs(forward)>.25*speed?Math.sign(forward):Math.sign(this.speed)||1;
    this.speed=direction*speed;
    this.lateralSpeed=this.vx*Math.cos(this.heading)-this.vz*Math.sin(this.heading);
    this.impactYaw=this.yawRate-this.steeringYaw;
    this.collision=Math.max(this.collision,clamp(impactSpeed/11,.12,1));
  }
  clearImpact() {
    this.steeringYaw=this.impactYaw=this.yawRate=0;
  }
  update(dt:number, input:Controls, track:PhysicsTrack) {
    if(!Number.isFinite(dt)||dt<=0)return 0;
    const weather=WEATHER_PHYSICS[this.weather];
    this.surface=track.surfaceAt(this.x,this.z);
    this.collision=Math.max(0,this.collision-dt*2);
    const steerTarget=input.steerAmount!==undefined&&Number.isFinite(input.steerAmount)?clamp(input.steerAmount,-1,1):(Number(input.left)-Number(input.right));
    this.steering=damp(this.steering,steerTarget,8,dt);
    const brakeTarget=pedal(input.brakeAmount,input.brake),throttleTarget=pedal(input.throttleAmount,input.throttle);
    this.brakePressure=approach(this.brakePressure,brakeTarget,dt/(brakeTarget>this.brakePressure?BRAKE_BUILD_SECONDS:BRAKE_RELEASE_SECONDS));
    this.throttlePressure=approach(this.throttlePressure,throttleTarget,dt/(throttleTarget>this.throttlePressure?.13:.06));
    if(brakeTarget===0){this.brakingFromForward=false;this.reverseHold=0;}
    else if(this.speed>.12){this.brakingFromForward=true;this.reverseHold=0;}
    if(this.brakingFromForward&&Math.abs(this.speed)<=.12){
      this.reverseHold+=dt;
      if(this.reverseHold>=.28)this.brakingFromForward=false;
    }
    const drs=this.drsActive&&this.weather==='sunny'&&this.surface==='asphalt'&&brakeTarget===0&&this.brakePressure<.01&&this.speed>0;
    const maxSpeed=this.surface==='asphalt'?(drs?maxDrsSpeed:maxRoadSpeed)*this.tires.speedMultiplier:this.surface==='grass'?15:9;
    // DRS changes drag and the speed governor, never the velocity directly.
    const governor=clamp((maxSpeed-this.speed)/2,0,1);
    const engineAcceleration=brakeTarget>0||this.brakePressure>.01?0:15.5*TRACK_SPEED_SCALE*this.throttlePressure*weather.acceleration*(1-Math.max(0,this.speed)/(55*TRACK_SPEED_SCALE))*governor;
    const reverse=brakeTarget>0&&throttleTarget===0&&!this.brakingFromForward;
    const rebound=this.speed<-.12&&(this.brakingFromForward||this.speed< -7);
    const brakeAcceleration=this.brakePressure*weather.braking*(this.speed>.12?32.5:rebound?-32.5:reverse?7:0);
    const drag=Math.sign(this.speed)*(drs?.55:1.9)*Math.pow(Math.abs(this.speed)/maxRoadSpeed,2);
    const previousSpeed=this.speed;
    const steer=track.steeringAngleForSpeed??steeringAngleForSpeed;
    const requestedYaw=this.steering*(this.speed/WHEELBASE)*Math.tan(steer(this.speed));
    const lateralGrip=lateralGripForSpeed(this.speed,this.weather,this.surface)*(drs?.94:1);
    const velocityLength=Math.hypot(this.vx,this.vz),direction=Math.sign(this.speed)||1;
    const forwardSpeed=this.vx*Math.sin(this.heading)+this.vz*Math.cos(this.heading);
    const bodyLateral=this.vx*Math.cos(this.heading)-this.vz*Math.sin(this.heading);
    const driftBlend=velocityLength>1e-6?clamp((Math.abs(bodyLateral)/velocityLength-.10)/.22,0,1):0;
    const tireForces=this.tires.step({dt,speed:this.speed*(1-driftBlend)+forwardSpeed*driftBlend,lateralSpeed:bodyLateral,yawRate:this.yawRate,
      steerAngle:this.steering*steer(this.speed),longitudinalDemand:engineAcceleration-brakeAcceleration,
      lateralDemand:requestedYaw*Math.abs(this.speed),longitudinalGrip:(this.surface==='asphalt'?36:20)*weather.braking,
      lateralGrip,weather:this.weather,surface:this.surface});
    // Gravity acts only along the actual 3D road grade. The flat fast path is
    // numerically identical to the existing Monza handling. Brakes hold a car
    // parked on a slope; no artificial jump or teleport is introduced.
    let slopeForce=0;
    if(track.gradeAlongHeadingAt){const grade=track.gradeAlongHeadingAt(this.x,this.z,this.heading);slopeForce=5.886*grade/Math.sqrt(1+grade*grade);}
    else if(track.gradeAt){const near=track.nearest(this.x,this.z),grade=track.gradeAt(near.distance),aligned=Math.sin(this.heading)*near.tangent.x+Math.cos(this.heading)*near.tangent.z;slopeForce=5.886*grade/Math.sqrt(1+grade*grade)*aligned;}
    const longitudinalForce=tireForces.longitudinalAcceleration-slopeForce;
    const alongVelocity=driftBlend>0?1-driftBlend+driftBlend*direction*forwardSpeed/velocityLength:1;
    const sideDrag=driftBlend>0?Math.max(0,-tireForces.lateralAcceleration*bodyLateral/velocityLength)*driftBlend:0;
    this.speed+=(alongVelocity*longitudinalForce-drag)*dt;
    this.speed=approach(this.speed,0,sideDrag*dt);
    if(previousSpeed>0&&this.speed<0&&this.brakePressure>0)this.speed=0;
    if(rebound&&this.speed>0&&brakeTarget>0)this.speed=0;
    if(this.brakingFromForward&&Math.abs(this.speed)<=.12)this.speed=0;
    if(throttleTarget===0&&brakeTarget===0)this.speed=damp(this.speed,0,this.surface==='asphalt'?.13:1.8,dt);
    if(this.speed>maxSpeed&&this.surface!=='asphalt')this.speed=damp(this.speed,maxSpeed,3,dt);
    this.speed=Math.max(this.speed,Math.min(-7,previousSpeed));
    const absoluteSpeed=Math.abs(this.speed);
    const steeringAngle=steer(this.speed);
    this.frontWheelAngle=this.steering*steeringAngle;
    const steeringYaw=this.steering*this.speed/WHEELBASE*Math.tan(steeringAngle);
    const yawLimit=tireForces.lateralLimit/Math.max(absoluteSpeed,1);
    const targetYaw=clamp(steeringYaw,-yawLimit,yawLimit);
    this.steeringYaw=clamp(damp(this.steeringYaw,targetYaw,12,dt),-yawLimit,yawLimit);
    this.impactYaw=damp(this.impactYaw,0,3.5*weather.response*this.tires.gripMultiplier,dt);
    this.yawRate=this.steeringYaw+this.impactYaw;
    this.heading+=this.yawRate*dt;
    this.gripUsage=clamp(Math.abs(steeringYaw)*absoluteSpeed/Math.max(.1,tireForces.lateralLimit),0,1.5);

    // The velocity direction has inertia. Tire force can rotate it only by a
    // bounded amount, rather than snapping velocity to the steering direction.
    const sign=Math.sign(this.speed)||1;
    let velocityHeading=velocityLength>1e-6&&sign===direction?Math.atan2(this.vx*sign,this.vz*sign):this.heading;
    const slip=Math.atan2(Math.sin(this.heading-velocityHeading),Math.cos(this.heading-velocityHeading));
    this.sliding=absoluteSpeed>5&&(this.gripUsage>1.02||Math.abs(slip)>.12);
    const response=(this.surface==='asphalt'?12:this.surface==='grass'?7:5)*weather.response;
    // At large slip both force components can turn the velocity vector.
    // In a broadside slide the throttle acts across the current direction of travel.
    const driftYaw=sign*(longitudinalForce*Math.sin(slip)+tireForces.lateralAcceleration*Math.cos(slip))/Math.max(absoluteSpeed,1);
    const assistedYaw=clamp(slip*response,-yawLimit,yawLimit);
    velocityHeading+=(assistedYaw*(1-driftBlend)+driftYaw*driftBlend)*dt;
    this.vx=Math.sin(velocityHeading)*this.speed;this.vz=Math.cos(velocityHeading)*this.speed;
    this.lateralSpeed=this.vx*Math.cos(this.heading)-this.vz*Math.sin(this.heading);
    this.x+=this.vx*dt; this.z+=this.vz*dt;
    let impactSpeed=0;
    for(const b of track.colliders??[]){
      const left=b.minX-obstacleRadius,right=b.maxX+obstacleRadius,near=b.minZ-obstacleRadius,far=b.maxZ+obstacleRadius;
      if(this.x>left&&this.x<right&&this.z>near&&this.z<far){
        const exits=[{d:this.x-left,nx:-1,nz:0},{d:right-this.x,nx:1,nz:0},{d:this.z-near,nx:0,nz:-1},{d:far-this.z,nx:0,nz:1}];
        const {d,nx,nz}=exits.sort((a,b)=>a.d-b.d)[0];
        this.x+=nx*d;this.z+=nz*d;
        impactSpeed=Math.max(impactSpeed,resolveWallImpulse(this,nx,nz,this.x-nx*obstacleRadius,this.z-nz*obstacleRadius));
      }
    }
    const wallSegments=track.barrierSegmentsAt?.(this.x,this.z)??track.barrierSegments??[];
    if(wallSegments.length){const height=track.heightAt?.(this.x,this.z)??0;for(const wall of wallSegments){
      if(height+1.3<wall.bottom||height>wall.top+.2)continue;
      const dx=wall.bx-wall.ax,dz=wall.bz-wall.az,lengthSquared=dx*dx+dz*dz;
      if(lengthSquared===0)continue;
      const t=clamp(((this.x-wall.ax)*dx+(this.z-wall.az)*dz)/lengthSquared,0,1),px=wall.ax+t*dx,pz=wall.az+t*dz;
      const ox=this.x-px,oz=this.z-pz,d=Math.hypot(ox,oz),minimum=wall.radius+obstacleRadius;
      if(d<minimum){
        const nx=d>1e-8?ox/d:-dz/Math.sqrt(lengthSquared),nz=d>1e-8?oz/d:dx/Math.sqrt(lengthSquared);
        this.x=px+nx*(minimum+.005);this.z=pz+nz*(minimum+.005);
        impactSpeed=Math.max(impactSpeed,resolveWallImpulse(this,nx,nz,px+nx*wall.radius,pz+nz*wall.radius));
      }
    }}
    const near=track.nearest(this.x,this.z), dx=this.x-near.point.x,dz=this.z-near.point.z;
    // Perimeter fences remain at their original 24-unit offset. Local road
    // narrowing adds runoff; it must not move the invisible collision wall.
    const lateral=Math.hypot(dx,dz), boundary=track.barrierOffset??track.width/2+16;
    if(!track.barrierSegments?.length&&lateral>boundary && this.surface!=='asphalt') {
      const nx=-dx/lateral,nz=-dz/lateral;
      this.x=near.point.x-nx*(boundary-0.3);this.z=near.point.z-nz*(boundary-0.3);
      impactSpeed=Math.max(impactSpeed,resolveWallImpulse(this,nx,nz,this.x-nx*obstacleRadius,this.z-nz*obstacleRadius));
    }
    this.receiveContact(impactSpeed);
    return impactSpeed;
  }
}
