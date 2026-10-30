import {WEATHER_PHYSICS,type WeatherMode} from './conditions';
import type {Surface} from './physics';

export const WHEELBASE=3.1;
export const BRAKE_BUILD_SECONDS=.2;
export const BRAKE_RELEASE_SECONDS=.085;

/** Larger slow-speed circles, with a smoothly slower steering ratio at speed.
 * This is a toy-car road-wheel angle, not a measured F1 steering rack. */
export function steeringAngleForSpeed(speed:number):number {
  return .255/(1+Math.abs(speed)*.018);
}

/** Bounded arcade aero grip keeps quick corners responsive without granting
 * the small radius needed to take a chicane at top speed. */
export function lateralGripForSpeed(speed:number,weather:WeatherMode='sunny',surface:Surface='asphalt'):number {
  const base=surface==='asphalt'?14.5:surface==='grass'?5.8:3.6;
  const aero=surface==='asphalt'?8.5*Math.pow(Math.min(Math.abs(speed),45)/40,2):0;
  return (base+aero)*WEATHER_PHYSICS[weather].grip;
}

export function fullSteerYawForSpeed(speed:number):number {
  return speed/WHEELBASE*Math.tan(steeringAngleForSpeed(speed));
}
