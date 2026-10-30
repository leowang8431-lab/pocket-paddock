export type CameraMode='close'|'standard'|'far';
export type MenuView='front'|'side'|'rear';
export const CAMERA_MODES:readonly CameraMode[]=['close','standard','far'];
export const MENU_VIEWS:readonly MenuView[]=['front','side','rear'];

export interface CameraProfile {
  readonly distance:number;
  readonly height:number;
  readonly lookAhead:number;
  readonly lookHeight:number;
  readonly fov:number;
}

/** A lower, stable camera is also a clarity control: acceleration never changes
 * the selected distance, height or field of view. */
export const CAMERA_PROFILES:Readonly<Record<CameraMode,CameraProfile>>={
  close:{distance:6.6,height:2.35,lookAhead:3,lookHeight:.78,fov:47},
  standard:{distance:8,height:2.8,lookAhead:4.3,lookHeight:.85,fov:48},
  far:{distance:10.3,height:3.35,lookAhead:5.3,lookHeight:.9,fov:49},
};

export const MENU_PROFILES:Readonly<Record<MenuView,{forward:number;side:number;height:number}>>={
  front:{forward:7.4,side:6.2,height:3.2},
  side:{forward:.6,side:9.4,height:3},
  rear:{forward:-7,side:6.6,height:3.2},
};

export function isCameraMode(value:unknown):value is CameraMode{return value==='close'||value==='standard'||value==='far';}
export function isMenuView(value:unknown):value is MenuView{return value==='front'||value==='side'||value==='rear';}

/** Portrait framing fits the complete wide tyres without varying with speed. */
export function drivingCameraScale(aspect:number){return Math.max(1,.64/Math.max(.3,aspect));}
export function menuCameraScale(aspect:number){return aspect<1?Math.max(1,.84/Math.max(.3,aspect)):1;}
