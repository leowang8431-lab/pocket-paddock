import type {Controls} from '../src/physics.ts';
import {VehiclePhysics} from '../src/physics.ts';
import type {Track} from '../src/track.ts';
import {PitLaneController} from '../src/pit-lane-controller.ts';
import type {TeamId} from '../src/team-catalog.ts';
import type {PitCompound} from '../src/pit-stop-animation.ts';
import {steeringAngleForSpeed,WHEELBASE} from '../src/handling.ts';

/** Test driver only: the runtime controller never steers a released car.
 * It sends the same analog pedal/steering controls as a gamepad, through the
 * unchanged VehiclePhysics. All checkpoint and service state stays public. */
export function manualPitControls(vehicle:VehiclePhysics,track:Track):Controls{
  const nodes=track.pitPath;let best=Infinity,chosen=1,fraction=0;
  for(let i=1;i<nodes.length;i++){
    const a=nodes[i-1],b=nodes[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((vehicle.x-a.x)*dx+(vehicle.z-a.z)*dz)/(dx*dx+dz*dz))),gap=(vehicle.x-a.x-dx*t)**2+(vehicle.z-a.z-dz*t)**2;
    if(gap<best){best=gap;chosen=i;fraction=t;}
  }
  let ahead=track.id==='spa'?4+Math.abs(vehicle.speed)*.32:8+Math.abs(vehicle.speed)*.8,x=nodes[chosen-1].x+(nodes[chosen].x-nodes[chosen-1].x)*fraction,z=nodes[chosen-1].z+(nodes[chosen].z-nodes[chosen-1].z)*fraction;
  for(let i=chosen;i<nodes.length;i++){
    const p=nodes[i],length=Math.hypot(p.x-x,p.z-z);
    if(length>=ahead){x+=(p.x-x)*ahead/Math.max(length,1e-9);z+=(p.z-z)*ahead/Math.max(length,1e-9);ahead=0;break;}
    ahead-=length;x=p.x;z=p.z;
  }
  if(ahead>0){const a=nodes.at(-2)!,b=nodes.at(-1)!,length=Math.hypot(b.x-a.x,b.z-a.z);x+=(b.x-a.x)/length*ahead;z+=(b.z-a.z)/length*ahead;}
  const target=Math.atan2(x-vehicle.x,z-vehicle.z),error=Math.atan2(Math.sin(target-vehicle.heading),Math.cos(target-vehicle.heading)),chord=Math.max(.5,Math.hypot(x-vehicle.x,z-vehicle.z)),curvature=2*Math.sin(error)/chord;
  // The Spa exit rounds the inside of La Source. The old long look-ahead
  // skipped over that whole bend and drove onto the adjacent race lane.
  const speed=track.id==='spa'&&Math.abs(curvature)>.055?1.5:Math.abs(error)>.7?5:9;
  const steer=track.id==='spa'?curvature*WHEELBASE/Math.tan((track.steeringAngleForSpeed??steeringAngleForSpeed)(vehicle.speed)):error*1.5;
  return{throttle:vehicle.speed<speed,brake:vehicle.speed>speed+.3,left:false,right:false,throttleAmount:vehicle.speed<speed?.65:0,brakeAmount:vehicle.speed>speed+.3?.35:0,steerAmount:Math.max(-1,Math.min(1,steer))};
}
export function stepPit(pit:PitLaneController,vehicle:VehiclePhysics,track:Track,team:TeamId,compound:PitCompound='wet',dt=1/120,controls?:Controls){
  const automatic=pit.update(dt,vehicle,team,compound);
  if(!automatic)vehicle.update(dt,controls??manualPitControls(vehicle,track),track);
  pit.afterPhysics(dt,vehicle);return automatic;
}
