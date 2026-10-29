import * as THREE from 'three';
export class ChaseCamera {
  private look=new THREE.Vector3(); private initialized=false;
  private behind=new THREE.Vector3();private right=new THREE.Vector3();private target=new THREE.Vector3();private targetLook=new THREE.Vector3();
  constructor(public camera:THREE.PerspectiveCamera){}
  update(position:THREE.Vector3,heading:number,speed:number,dt:number,menu=false){
    const behind=this.behind.set(Math.sin(heading),0,Math.cos(heading));
    const right=this.right.set(Math.cos(heading),0,-Math.sin(heading));
    const target=this.target.copy(position).addScaledVector(behind,menu?-11:-8.4-Math.abs(speed)*0.045).addScaledVector(right,menu?-8:0);
    target.y+=menu?6.8:4.3+Math.abs(speed)*0.017;
    const look=this.targetLook.copy(position).addScaledVector(behind,menu?3:6+Math.abs(speed)*0.1);look.y+=0.9;
    const a=this.initialized?1-Math.exp(-4.8*dt):1;
    this.camera.position.lerp(target,a);this.look.lerp(look,a);this.camera.lookAt(this.look);this.initialized=true;
    this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,menu?43:50+Math.abs(speed)*0.14,a);this.camera.updateProjectionMatrix();
  }
  snap(){this.initialized=false;}
}
