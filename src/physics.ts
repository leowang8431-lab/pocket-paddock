import {WEATHER_PHYSICS,type WeatherMode} from './conditions';
import {BRAKE_BUILD_SECONDS,BRAKE_RELEASE_SECONDS,lateralGripForSpeed,steeringAngleForSpeed,WHEELBASE} from './handling';
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
export class VehiclePhysics {
  x=0; z=0; heading=0; speed=0; steering=0; vx=0; vz=0; collision=0; surface:Surface='asphalt';
  /** Tire demand / available grip. Values above one mean the front tires saturate. */
  gripUsage=0; sliding=false; lateralSpeed=0; yawRate=0;
  brakePressure=0; throttlePressure=0; frontWheelAngle=0; drsActive=false;
  private brakingFromForward=false;
  private reverseHold=0;
  weather:WeatherMode='sunny';
  reset(x:number,z:number,heading:number) {
    Object.assign(this,{x,z,heading,speed:0,steering:0,vx:0,vz:0,collision:0,
      gripUsage:0,sliding:false,lateralSpeed:0,yawRate:0,brakePressure:0,throttlePressure:0,
      frontWheelAngle:0,drsActive:false,brakingFromForward:false,reverseHold:0});
  }
  update(dt:number, input:Controls, track:PhysicsTrack) {
    if(!Number.isFinite(dt)||dt<=0)return;
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
    if(this.brakingFromForward&&this.speed<=.12){
      this.reverseHold+=dt;
      if(this.reverseHold>=.28)this.brakingFromForward=false;
    }
    const drs=this.drsActive&&this.weather==='sunny'&&this.surface==='asphalt'&&brakeTarget===0&&this.brakePressure<.01&&this.speed>0;
    const maxSpeed=this.surface==='asphalt'?(drs?44.5:40):this.surface==='grass'?15:9;
    // DRS changes drag and the speed governor, never the velocity directly.
    const governor=clamp((maxSpeed-this.speed)/2,0,1);
    const engineAcceleration=brakeTarget>0||this.brakePressure>.01?0:15.5*this.throttlePressure*weather.acceleration*(1-Math.max(0,this.speed)/55)*governor;
    const reverse=brakeTarget>0&&throttleTarget===0&&!this.brakingFromForward;
    const brakeAcceleration=this.brakePressure*weather.braking*(this.speed>.12?32.5:reverse?7:0);
    const drag=Math.sign(this.speed)*(drs?.55:1.9)*Math.pow(Math.abs(this.speed)/40,2);
    const previousSpeed=this.speed;
    // Gravity acts only along the actual 3D road grade. The flat fast path is
    // numerically identical to the existing Monza handling. Brakes hold a car
    // parked on a slope; no artificial jump or teleport is introduced.
    let slopeForce=0;
    if(track.gradeAlongHeadingAt){const grade=track.gradeAlongHeadingAt(this.x,this.z,this.heading);slopeForce=5.886*grade/Math.sqrt(1+grade*grade);}
    else if(track.gradeAt){const near=track.nearest(this.x,this.z),grade=track.gradeAt(near.distance),aligned=Math.sin(this.heading)*near.tangent.x+Math.cos(this.heading)*near.tangent.z;slopeForce=5.886*grade/Math.sqrt(1+grade*grade)*aligned;}
    this.speed+=(engineAcceleration-brakeAcceleration-drag-slopeForce)*dt;
    if(previousSpeed>0&&this.speed<0&&this.brakePressure>0)this.speed=0;
    if(this.brakingFromForward&&this.speed<=.12)this.speed=0;
    if(throttleTarget===0&&brakeTarget===0)this.speed=damp(this.speed,0,this.surface==='asphalt'?.13:1.8,dt);
    if(this.speed>maxSpeed&&this.surface!=='asphalt')this.speed=damp(this.speed,maxSpeed,3,dt);
    this.speed=Math.max(-7,Math.min(44.5,this.speed));
    const absoluteSpeed=Math.abs(this.speed);
    const tireGrip=lateralGripForSpeed(this.speed,this.weather,this.surface)*(drs?.94:1);
    const longitudinalGrip=(this.surface==='asphalt'?36:20)*weather.braking;
    // Simplified friction circle: braking hard leaves less tire force for turning.
    // Rolling resistance and grass drag are not counted as a braking input.
    const longitudinalUse=Math.min(.94,Math.abs(engineAcceleration-brakeAcceleration)/longitudinalGrip);
    const lateralGrip=tireGrip*Math.sqrt(1-longitudinalUse*longitudinalUse);
    const steeringAngle=(track.steeringAngleForSpeed??steeringAngleForSpeed)(this.speed);
    this.frontWheelAngle=this.steering*steeringAngle;
    const requestedYaw=this.steering*(this.speed/WHEELBASE)*Math.tan(steeringAngle);
    const lateralDemand=Math.abs(requestedYaw)*absoluteSpeed;
    const yawLimit=lateralGrip/Math.max(absoluteSpeed,1);
    const targetYaw=clamp(requestedYaw,-yawLimit,yawLimit);
    this.yawRate=clamp(damp(this.yawRate,targetYaw,12,dt),-yawLimit,yawLimit);
    this.heading+=this.yawRate*dt;
    this.gripUsage=clamp(lateralDemand/Math.max(.1,lateralGrip),0,1.5);
    this.sliding=absoluteSpeed>5&&this.gripUsage>1.02;

    // The velocity direction has inertia. Tire force can rotate it only by a
    // bounded amount, rather than snapping velocity to the steering direction.
    const sign=Math.sign(this.speed)||1;
    const velocityLength=Math.hypot(this.vx,this.vz);
    let velocityHeading=velocityLength>.4?Math.atan2(this.vx*sign,this.vz*sign):this.heading;
    const slip=Math.atan2(Math.sin(this.heading-velocityHeading),Math.cos(this.heading-velocityHeading));
    const response=(this.surface==='asphalt'?12:this.surface==='grass'?7:5)*weather.response;
    velocityHeading+=clamp(slip*response,-yawLimit,yawLimit)*dt;
    this.vx=Math.sin(velocityHeading)*this.speed;this.vz=Math.cos(velocityHeading)*this.speed;
    this.lateralSpeed=this.vx*Math.cos(this.heading)-this.vz*Math.sin(this.heading);
    this.x+=this.vx*dt; this.z+=this.vz*dt;
    for(const b of track.colliders??[]){
      const radius=.95;
      if(this.x>b.minX-radius&&this.x<b.maxX+radius&&this.z>b.minZ-radius&&this.z<b.maxZ+radius){
        const exits=[{d:this.x-(b.minX-radius),x:b.minX-radius,z:this.z},{d:b.maxX+radius-this.x,x:b.maxX+radius,z:this.z},{d:this.z-(b.minZ-radius),x:this.x,z:b.minZ-radius},{d:b.maxZ+radius-this.z,x:this.x,z:b.maxZ+radius}];
        exits.sort((a,b)=>a.d-b.d);this.x=exits[0].x;this.z=exits[0].z;this.speed*=.3;this.vx*=.15;this.vz*=.15;this.collision=1;
      }
    }
    const wallSegments=track.barrierSegmentsAt?.(this.x,this.z)??track.barrierSegments??[];
    if(wallSegments.length){const height=track.heightAt?.(this.x,this.z)??0;for(const wall of wallSegments){
      if(height+1.3<wall.bottom||height>wall.top+.2)continue;
      const dx=wall.bx-wall.ax,dz=wall.bz-wall.az,t=clamp(((this.x-wall.ax)*dx+(this.z-wall.az)*dz)/(dx*dx+dz*dz),0,1),px=wall.ax+t*dx,pz=wall.az+t*dz,ox=this.x-px,oz=this.z-pz,d=Math.hypot(ox,oz),minimum=wall.radius+.95;
      if(d<minimum){const nx=d>1e-8?ox/d:-dz/Math.hypot(dx,dz),nz=d>1e-8?oz/d:dx/Math.hypot(dx,dz);this.x=px+nx*(minimum+.005);this.z=pz+nz*(minimum+.005);this.speed*=.3;this.vx*=.15;this.vz*=.15;this.collision=1;}
    }}
    const near=track.nearest(this.x,this.z), dx=this.x-near.point.x,dz=this.z-near.point.z;
    // Perimeter fences remain at their original 24-unit offset. Local road
    // narrowing adds runoff; it must not move the invisible collision wall.
    const lateral=Math.hypot(dx,dz), boundary=track.barrierOffset??track.width/2+16;
    if(!track.barrierSegments?.length&&lateral>boundary && this.surface!=='asphalt') {
      this.x=near.point.x+dx/lateral*(boundary-0.3); this.z=near.point.z+dz/lateral*(boundary-0.3);
      this.speed*=0.35; this.vx*=0.2;this.vz*=0.2; this.collision=1;
    }
  }
}
