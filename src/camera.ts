import * as THREE from 'three';
import {CAMERA_MODES,CAMERA_PROFILES,MENU_PROFILES,MENU_VIEWS,drivingCameraScale,menuCameraScale,type CameraMode,type MenuView} from './camera-profiles';
export {CAMERA_MODES,CAMERA_PROFILES,MENU_VIEWS,isCameraMode,isMenuView,type CameraMode,type MenuView} from './camera-profiles';

/** Follow translation exactly; smooth only the local orbit and mode change.
 * Lerping a moving world-space target adds speed / damping units of distance:
 * the old 4.8/s follower lagged another 8.3 units at top speed. That made the
 * car shrink under acceleration, even without a motion-blur rendering pass. */
export class ChaseCamera {
  private readonly look=new THREE.Vector3();
  private readonly forward=new THREE.Vector3();
  private readonly right=new THREE.Vector3();
  private readonly anchor=new THREE.Vector3();
  private initialized=false;
  private transitionRequested=false;
  private inMenu=false;
  private followHeading=0;
  private forwardOffset=0;
  private sideOffset=0;
  private height=0;
  private lookAhead=0;
  private lookHeight=0;
  private fieldOfView=48;
  private selectedMode:CameraMode='standard';
  private selectedMenuView:MenuView='front';

  constructor(public camera:THREE.PerspectiveCamera){}
  get mode(){return this.selectedMode;}
  get menuView(){return this.selectedMenuView;}
  setMode(mode:CameraMode){if(mode!==this.selectedMode){this.selectedMode=mode;this.transitionRequested=true;}}
  cycleMode():CameraMode{this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.selectedMode)+1)%CAMERA_MODES.length]);return this.selectedMode;}
  setMenuView(view:MenuView){if(view!==this.selectedMenuView){this.selectedMenuView=view;this.snap();}}
  cycleMenuView():MenuView{this.setMenuView(MENU_VIEWS[(MENU_VIEWS.indexOf(this.selectedMenuView)+1)%MENU_VIEWS.length]);return this.selectedMenuView;}

  update(position:THREE.Vector3,heading:number,_speed:number,dt:number,menu=false){
    // Explicit view changes and reset/resize can reframe one paused frame.
    // All other zero-step updates leave position, orientation and FOV frozen.
    if(menu!==this.inMenu)this.initialized=false;
    if(this.initialized&&!(Number.isFinite(dt)&&dt>0)&&!this.transitionRequested)return;
    const step=Number.isFinite(dt)?THREE.MathUtils.clamp(dt,0,.1):0;
    const instant=!this.initialized||step===0;
    const blend=instant?1:1-Math.exp(-8*step);
    const rotationBlend=instant?1:1-Math.exp(-7.5*step);
    const targetHeading=Number.isFinite(heading)?heading:this.followHeading;
    const angle=Math.atan2(Math.sin(targetHeading-this.followHeading),Math.cos(targetHeading-this.followHeading));
    this.followHeading=instant?targetHeading:this.followHeading+angle*rotationBlend;
    const profile=CAMERA_PROFILES[this.selectedMode],menuProfile=MENU_PROFILES[this.selectedMenuView];
    const portrait=menu&&this.camera.aspect<1;
    const scale=menu?menuCameraScale(this.camera.aspect):drivingCameraScale(this.camera.aspect);
    const forward=menu?menuProfile.forward*scale:-profile.distance*scale;
    const side=menu?menuProfile.side*scale:0;
    const height=menu?menuProfile.height:profile.height;
    const lookAhead=menu?0:profile.lookAhead;
    // The portrait showroom occupies the upper third, above the garage card.
    const lookHeight=menu?(portrait?-2.3:.78):profile.lookHeight;
    const fov=menu?43:profile.fov;
    this.forwardOffset=THREE.MathUtils.lerp(this.forwardOffset,forward,blend);
    this.sideOffset=THREE.MathUtils.lerp(this.sideOffset,side,blend);
    this.height=THREE.MathUtils.lerp(this.height,height,blend);
    this.lookAhead=THREE.MathUtils.lerp(this.lookAhead,lookAhead,blend);
    this.lookHeight=THREE.MathUtils.lerp(this.lookHeight,lookHeight,blend);
    this.fieldOfView=THREE.MathUtils.lerp(this.fieldOfView,fov,blend);
    this.forward.set(Math.sin(this.followHeading),0,Math.cos(this.followHeading));
    this.right.set(Math.cos(this.followHeading),0,-Math.sin(this.followHeading));
    this.camera.position.copy(position).addScaledVector(this.forward,this.forwardOffset).addScaledVector(this.right,this.sideOffset);
    this.camera.position.y+=this.height;
    this.look.copy(position).addScaledVector(this.forward,this.lookAhead);this.look.y+=this.lookHeight;
    this.camera.lookAt(this.look);
    if(Math.abs(this.camera.fov-this.fieldOfView)>1e-7){this.camera.fov=this.fieldOfView;this.camera.updateProjectionMatrix();}
    this.anchor.copy(position);this.initialized=true;this.transitionRequested=false;this.inMenu=menu;
  }

  snap(){this.initialized=false;this.transitionRequested=true;}
  get summary(){
    const profile=CAMERA_PROFILES[this.selectedMode];
    return{mode:this.selectedMode,menuView:this.selectedMenuView,menu:this.inMenu,
      distance:Math.hypot(this.camera.position.x-this.anchor.x,this.camera.position.z-this.anchor.z),
      height:this.camera.position.y-this.anchor.y,fov:this.camera.fov,
      targetDistance:profile.distance*drivingCameraScale(this.camera.aspect),targetHeight:profile.height,
      position:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z},
      look:{x:this.look.x,y:this.look.y,z:this.look.z},translationLocked:true};
  }
}
