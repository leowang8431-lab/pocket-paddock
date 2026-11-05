import * as THREE from 'three';
import type {FleetCar} from './fleet-car';
import {PitStopAnimation,type PitCompound} from './pit-stop-animation';
import {PIT_STOP_DURATION,toPitPoseTime} from './pit-stop-timing';
import {getTeam,type TeamId} from './team-catalog';

/** The approved review rig, rendered at the player's actual garage position.
 * Only the active stop owns a crew. The source car and wheel geometry never
 * move into a preview scene or acquire neutral preview colour buffers. */
export class PitServiceView {
  private rig:PitStopAnimation|null=null;
  private progress=0;
  private currentCompound:PitCompound='medium';
  private requestedCompound:PitCompound='medium';
  private selectedTeam:TeamId|null=null;
  private groundHeight=0;
  private error:string|null=null;
  private disposed=false;

  constructor(private readonly car:Pick<FleetCar,'group'|'status'>,private readonly scene:THREE.Object3D){}

  begin(team:TeamId,compound:PitCompound,groundHeight=0):boolean{
    if(this.disposed)return false;
    this.cancel();this.error=null;
    if(this.car.status!=='ready'){this.error='The supplied car model is not ready for a wheel service.';return false;}
    this.requestedCompound=compound;this.selectedTeam=team;this.groundHeight=Number.isFinite(groundHeight)?groundHeight:0;
    try{
      this.rig=new PitStopAnimation(this.car);this.rig.setTeam(new THREE.Color(getTeam(team).color).getHex());
      this.rig.setOldCompound(this.currentCompound);this.rig.setCompound(compound);this.scene.add(this.rig.group);this.progress=0;this.setProgress(0,this.groundHeight);return true;
    }catch(error){this.error=String(error);this.rig?.dispose();this.rig=null;return false;}
  }

  /** Call after the normal road pose is applied, including on paused frames.
   * x/z/yaw stay on the controller's parking spot; only lift is added to y. */
  setProgress(progress:number,groundHeight=this.groundHeight):void{
    if(!this.rig||this.disposed)return;
    this.progress=THREE.MathUtils.clamp(Number.isFinite(progress)?progress:0,0,1);
    this.groundHeight=Number.isFinite(groundHeight)?groundHeight:0;
    this.rig.setTime(toPitPoseTime(this.progress*PIT_STOP_DURATION));
    this.car.group.position.y+=this.groundHeight;this.rig.group.position.y=this.groundHeight;
    this.car.group.updateMatrixWorld(true);this.rig.group.updateMatrixWorld(true);
  }

  finish():void{
    if(!this.rig)return;
    this.setProgress(1);this.rig.dispose();this.rig=null;
    this.car.group.position.y=this.groundHeight+.11;this.currentCompound=this.requestedCompound;
  }

  /** Cancellation restores the old wheels and compound; it never finishes a
   * service. The next driving frame remains free to set a new road height. */
  cancel():void{
    if(this.rig){this.rig.dispose();this.rig=null;this.car.group.position.y=this.groundHeight+.11;}
    this.progress=0;
  }

  setCurrentCompound(compound:PitCompound):void{
    if(this.rig||this.disposed)return;
    this.currentCompound=compound;this.requestedCompound=compound;
  }

  get group(){return this.rig?.group??null;}
  get summary(){return{active:!!this.rig,progress:this.progress,team:this.selectedTeam,currentCompound:this.currentCompound,requestedCompound:this.requestedCompound,groundHeight:this.groundHeight,markerCount:0,rig:this.rig?.summary??null,error:this.error};}
  dispose(){
    if(this.disposed)return;this.cancel();this.disposed=true;
  }
}
