import * as THREE from 'three';
import type {VehiclePhysics} from './physics';

/** Small reusable ring buffer; marks are only emitted when lateral grip saturates. */
export class SkidMarks {
  readonly mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.15,.012,1),new THREE.MeshBasicMaterial({color:0x263d37,transparent:true,opacity:.22,depthWrite:false}),480);
  private index=0;private count=0;private time=0;private transform=new THREE.Object3D();
  constructor(){this.mesh.count=0;this.mesh.frustumCulled=false;}
  clear(){this.index=0;this.count=0;this.mesh.count=0;}
  update(car:VehiclePhysics,dt:number,active:boolean){
    this.time+=dt;
    if(!active||!car.sliding||Math.abs(car.lateralSpeed)<.35||car.surface!=='asphalt'||Math.abs(car.speed)<7||this.time<.035)return;
    const length=Math.min(1.9,Math.abs(car.speed)*Math.min(this.time,.06)+.15);this.time=0;
    for(const side of [-1,1]){
      this.transform.position.set(car.x-Math.sin(car.heading)*1.35+Math.cos(car.heading)*side*.94,.104,car.z-Math.cos(car.heading)*1.35-Math.sin(car.heading)*side*.94);
      this.transform.rotation.set(0,Math.atan2(car.vx,car.vz),0);this.transform.scale.set(1,1,length);this.transform.updateMatrix();
      this.mesh.setMatrixAt(this.index,this.transform.matrix);this.index=(this.index+1)%480;this.count=Math.min(this.count+1,480);
    }
    this.mesh.count=this.count;this.mesh.instanceMatrix.needsUpdate=true;
  }
}
