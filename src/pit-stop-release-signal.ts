import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** A fixed, two-sided release light ahead of the car. Its side post supports
 * a high cantilever, leaving the full driving and crew corridor open below.
 * The rig owns this as a direct child; no jack or worker carries its frame. */
export class FixedPitReleaseSignal {
  readonly group=new THREE.Group();
  private readonly geometries=new Set<THREE.BufferGeometry>();
  private readonly materials=new Set<THREE.Material>();
  private readonly redLamps:THREE.Mesh[]=[];
  private readonly greenLamps:THREE.Mesh[]=[];
  private readonly red:THREE.MeshBasicMaterial;
  private readonly green:THREE.MeshBasicMaterial;
  private readonly off:THREE.MeshPhysicalMaterial;
  private ready=false;
  private disposed=false;

  constructor(){
    this.group.name='pit-release-signal';this.group.position.set(0,0,4.6);
    this.group.userData={role:'release-signal',mount:'fixed-gantry',ready:false,color:'red',
      sidePostObjectName:'pit-release-sidepost',boomObjectName:'pit-release-overhead-boom',panelObjectName:'pit-release-panel'};
    const frame=this.standard(0x475a5b,.36,.63),base=this.standard(0x263d3e,.56,.32),metal=this.standard(0xa4b2ac,.30,.76),housing=this.standard(0x1d3032,.42,.18);
    this.off=new THREE.MeshPhysicalMaterial({color:0x213639,roughness:.24,metalness:.13,clearcoat:.7,clearcoatRoughness:.22});this.materials.add(this.off);
    this.red=new THREE.MeshBasicMaterial({color:0xff584b});this.green=new THREE.MeshBasicMaterial({color:0x70ec97});this.materials.add(this.red);this.materials.add(this.green);

    this.box('pit-release-post-base',2.7,.04,0,.52,.08,.54,base,.03);
    const post=this.mesh('pit-release-sidepost',new THREE.CylinderGeometry(.042,.052,2.78,14),frame);
    post.position.set(2.7,1.45,0);
    this.box('pit-release-overhead-boom',1.35,2.78,0,2.84,.065,.074,frame,.025);
    this.rod('pit-release-gantry-brace',new THREE.Vector3(2.7,2.34,0),new THREE.Vector3(2.24,2.78,0),.022,frame);
    this.box('pit-release-panel-hanger',0,2.68,0,.063,.23,.063,frame,.014);
    this.box('pit-release-panel',0,2.42,0,.70,.38,.19,housing,.065);

    const fastenerGeometry=new THREE.CylinderGeometry(.026,.026,.022,6);
    for(const z of [-.16,.16]){const bolt=this.mesh('pit-release-base-fastener',fastenerGeometry,metal);bolt.position.set(2.7,.088,z);}
    const bezelGeometry=new THREE.TorusGeometry(.113,.014,6,24),bulbGeometry=new THREE.SphereGeometry(.096,16,10);
    for(const face of [-1,1])for(const [color,x]of [['red',-.16],['green',.16]] as const){
      const bezel=this.mesh(`pit-release-${color}-bezel`,bezelGeometry,metal);bezel.position.set(x,2.42,face*.121);
      const lamp=this.mesh(`pit-release-${color}-lamp`,bulbGeometry,this.off);lamp.position.set(x,2.42,face*.13);lamp.castShadow=false;
      lamp.userData={role:'release-lamp',color,face:face===1?'forward':'rearward'};
      (color==='red'?this.redLamps:this.greenLamps).push(lamp);
    }
    this.setReady(false);this.group.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(this.group,true);
    this.group.userData.bounds={min:bounds.min.toArray(),max:bounds.max.toArray()};this.group.userData.boundsSpace='rig-local';
  }

  /** Colour is the sole animated property. Every position, scale and rotation
   * is fixed from construction, including during reverse seeks and replay. */
  setReady(ready:boolean):void {
    if(this.disposed)return;this.ready=Boolean(ready);
    this.group.userData.ready=this.ready;this.group.userData.color=this.ready?'green':'red';
    for(const lamp of this.redLamps)lamp.material=this.ready?this.off:this.red;
    for(const lamp of this.greenLamps)lamp.material=this.ready?this.green:this.off;
  }

  get summary(){
    return{ready:this.ready,color:this.ready?'green':'red',mount:'fixed-gantry',
      position:{x:this.group.position.x,y:this.group.position.y,z:this.group.position.z},
      panelCenter:{x:0,y:2.42,z:4.6},lamps:{red:this.redLamps.length,green:this.greenLamps.length},disposed:this.disposed};
  }

  /** This component owns only its own small frame and lamp resources. */
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    this.group.removeFromParent();this.group.clear();
    for(const geometry of this.geometries)geometry.dispose();for(const material of this.materials)material.dispose();
    this.geometries.clear();this.materials.clear();
  }

  private standard(color:number,roughness:number,metalness:number){
    const material=new THREE.MeshStandardMaterial({color,roughness,metalness});this.materials.add(material);return material;
  }
  private mesh(name:string,geometry:THREE.BufferGeometry,material:THREE.Material){
    this.geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);return mesh;
  }
  private box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material,radius:number){
    const mesh=this.mesh(name,new RoundedBoxGeometry(w,h,d,1,Math.min(radius,w/2,h/2,d/2)),material);mesh.position.set(x,y,z);return mesh;
  }
  private rod(name:string,a:THREE.Vector3,b:THREE.Vector3,radius:number,material:THREE.Material){
    const direction=b.clone().sub(a),mesh=this.mesh(name,new THREE.CylinderGeometry(radius,radius,direction.length(),10),material);
    mesh.position.copy(a).lerp(b,.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return mesh;
  }
}

export function createFixedPitReleaseSignal():FixedPitReleaseSignal{return new FixedPitReleaseSignal();}
