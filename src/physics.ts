export type Surface = 'asphalt' | 'grass' | 'gravel';
export interface Controls { throttle: boolean; brake: boolean; left: boolean; right: boolean }
export interface PhysicsTrack {
  width: number;
  colliders?: readonly {minX:number;maxX:number;minZ:number;maxZ:number}[];
  nearest(x: number, z: number): {point: {x:number;z:number}; tangent: {x:number;z:number}; distance:number};
  surfaceAt(x:number,z:number): Surface;
}
const damp = (a:number,b:number,k:number,dt:number) => a+(b-a)*(1-Math.exp(-k*dt));
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,value));
export class VehiclePhysics {
  x=0; z=0; heading=0; speed=0; steering=0; vx=0; vz=0; collision=0; surface:Surface='asphalt';
  /** Tire demand / available grip. Values above one mean the front tires saturate. */
  gripUsage=0; sliding=false; lateralSpeed=0; yawRate=0;
  reset(x:number,z:number,heading:number) {
    Object.assign(this,{x,z,heading,speed:0,steering:0,vx:0,vz:0,collision:0,
      gripUsage:0,sliding:false,lateralSpeed:0,yawRate:0});
  }
  update(dt:number, input:Controls, track:PhysicsTrack) {
    this.surface=track.surfaceAt(this.x,this.z);
    this.collision=Math.max(0,this.collision-dt*2);
    const steerTarget=(Number(input.left)-Number(input.right));
    this.steering=damp(this.steering,steerTarget,8,dt);
    const maxSpeed=this.surface==='asphalt'?40:this.surface==='grass'?15:9;
    const engineAcceleration=input.throttle?15.5*(1-Math.max(0,this.speed)/47):0;
    const brakeAcceleration=input.brake?(this.speed>0.8?30:7):0;
    this.speed+=(engineAcceleration-brakeAcceleration)*dt;
    if(!input.throttle&&!input.brake) this.speed=damp(this.speed,0,this.surface==='asphalt'?0.28:1.8,dt);
    if(this.speed>maxSpeed) this.speed=damp(this.speed,maxSpeed, this.surface==='asphalt'?1:3,dt);
    this.speed=Math.max(-7,Math.min(40,this.speed));
    const absoluteSpeed=Math.abs(this.speed);
    const tireGrip=this.surface==='asphalt'?14.5:this.surface==='grass'?5.8:3.6;
    const longitudinalGrip=this.surface==='asphalt'?36:20;
    // Simplified friction circle: braking hard leaves less tire force for turning.
    // Rolling resistance and grass drag are not counted as a braking input.
    const longitudinalUse=Math.min(.94,Math.abs(engineAcceleration-brakeAcceleration)/longitudinalGrip);
    const lateralGrip=tireGrip*Math.sqrt(1-longitudinalUse*longitudinalUse);
    const requestedYaw=this.steering*(this.speed/3.1)*Math.tan(.48)/(1+absoluteSpeed*.055);
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
    const response=this.surface==='asphalt'?12:this.surface==='grass'?7:5;
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
    const near=track.nearest(this.x,this.z), dx=this.x-near.point.x,dz=this.z-near.point.z;
    const lateral=Math.hypot(dx,dz), boundary=track.width/2+16;
    if(lateral>boundary && this.surface!=='asphalt') {
      this.x=near.point.x+dx/lateral*(boundary-0.3); this.z=near.point.z+dz/lateral*(boundary-0.3);
      this.speed*=0.35; this.vx*=0.2;this.vz*=0.2; this.collision=1;
    }
  }
}
