import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {FleetCar} from './fleet-car';
import {createFixedPitReleaseSignal} from './pit-stop-release-signal';

export type PitCompound='soft'|'medium'|'hard'|'wet';
export type PitStopPhase='park'|'lift'|'unlock'|'remove'|'fit'|'tighten'|'lower'|'release';
export const PIT_COMPOUND_COLORS:Record<PitCompound,number>={soft:0xf05249,medium:0xf3cb39,hard:0xf2f0df,wet:0x4b8edd};
export const PIT_COMPOUND_LABELS:Record<PitCompound,string>={soft:'S',medium:'M',hard:'H',wet:'W'};
export const PIT_STOP_PHASES:readonly {id:PitStopPhase;name:string;start:number;end:number}[]=[
  {id:'park',name:'停车确认',start:0,end:.6},
  {id:'lift',name:'抬升赛车',start:.6,end:1.2},
  {id:'unlock',name:'松开轮毂螺母',start:1.2,end:2},
  {id:'remove',name:'拆下旧轮胎',start:2,end:3.35},
  {id:'fit',name:'装上新轮胎',start:3.35,end:5.1},
  {id:'tighten',name:'锁紧并确认',start:5.1,end:6.4},
  {id:'lower',name:'赛车落地',start:6.4,end:7.2},
  {id:'release',name:'放行',start:7.2,end:8},
];

const clamp=THREE.MathUtils.clamp;
const smooth=(a:number,b:number,t:number)=>{const n=clamp((t-a)/(b-a),0,1);return n*n*(3-2*n);};
const lerp=THREE.MathUtils.lerp;
interface Crew {root:THREE.Group;helmet:THREE.Group;job:'gunner'|'remove'|'fit'|'jack'|'stabilize';wheelId?:string;}
interface PreviewWheelDetail {geometry:THREE.BufferGeometry;source:THREE.BufferGeometry;ranges:{offset:number;count:number;sourceMaterial:string}[];}
interface WheelRig {
  id:string;side:number;front:boolean;anchor:THREE.Vector3;radius:number;halfWidth:number;outerHalfWidth:number;
  source:THREE.Object3D;sourceVisible:boolean;
  old:THREE.Group;fresh:THREE.Group;hub:THREE.Group;nut:THREE.Mesh;
  gun:THREE.Group;socket:THREE.Group;lamp:THREE.Mesh;hose:Hose;
  gunner:Crew;remover:Crew;fitter:Crew;delay:number;
}
interface Jack {root:THREE.Group;pad:THREE.Group;handle:THREE.Group;grip:THREE.Mesh;operator:Crew;front:boolean;supports:THREE.Mesh[];contact:THREE.Vector3;}

/** Reusable hose vertices: seeking never replaces geometry or allocates GPU buffers. */
class Hose {
  readonly object:THREE.Mesh;
  private readonly segments=18;
  private readonly sides=6;
  private readonly curve=new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()]);
  private readonly drop=new THREE.CubicBezierCurve3(new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3());
  private readonly p=new THREE.Vector3();private readonly t=new THREE.Vector3();
  private readonly n=new THREE.Vector3();private readonly b=new THREE.Vector3();
  constructor(material:THREE.Material){
    const count=(this.segments+1)*(this.sides+1),g=new THREE.BufferGeometry(),indices:number[]=[];
    g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
    for(let i=0;i<this.segments;i++)for(let j=0;j<this.sides;j++){const a=i*(this.sides+1)+j;indices.push(a,a+this.sides+1,a+1,a+1,a+this.sides+1,a+this.sides+2);}
    g.setIndex(indices);this.object=new THREE.Mesh(g,material);this.object.name='pit-air-hose';this.object.receiveShadow=true;
  }
  update(start:THREE.Vector3,side:number,z:number){
    // The hose leaves the actual grip bottom and drops in front of the
    // worker's chest before bending outwards at floor level.
    this.drop.v0.copy(start);this.drop.v1.set(start.x,Math.max(.085,start.y-.20),start.z);this.drop.v2.set(start.x,.055,start.z);this.drop.v3.set(start.x+side*.24,.055,start.z);
    const points=this.curve.points;points[0].copy(this.drop.v3);points[1].set(side*2.55,.055,start.z+.12);points[2].set(side*3.3,.055,z+.68);points[3].set(side*4.02,.055,z+.42);
    const positions=this.object.geometry.attributes.position,normals=this.object.geometry.attributes.normal;
    for(let i=0;i<=this.segments;i++){
      const u=i/this.segments;
      if(u<=.45){this.drop.getPoint(u/.45,this.p);this.drop.getTangent(u/.45,this.t);}else{this.curve.getPoint((u-.45)/.55,this.p);this.curve.getTangent((u-.45)/.55,this.t);}
      this.n.set(0,1,0).cross(this.t);if(this.n.lengthSq()<.0001)this.n.set(1,0,0).cross(this.t);this.n.normalize();this.b.crossVectors(this.t,this.n).normalize();
      for(let j=0;j<=this.sides;j++){const a=j/this.sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a),index=i*(this.sides+1)+j;
        const x=this.n.x*c+this.b.x*s,y=this.n.y*c+this.b.y*s,zz=this.n.z*c+this.b.z*s;
        positions.setXYZ(index,this.p.x+x*.018,this.p.y+y*.018,this.p.z+zz*.018);normals.setXYZ(index,x,y,zz);
      }
    }
    positions.needsUpdate=normals.needsUpdate=true;this.object.geometry.computeBoundingSphere();
  }
}

/** A reviewable animation rig around the exact FleetCar wheel meshes.
 * The visible car keeps its body, suspension, wings and cockpit. Its four
 * original wheel pivots are temporarily hidden; eight complete shared clones
 * show old tyres travelling out and replacements travelling in.
 * Time is absolute, so pause, reverse seeking and replay have no state drift.
 * This is an artistic eight-second review sequence, not a race timing rule. */
export class PitStopAnimation {
  readonly group=new THREE.Group();
  readonly duration=8;
  readonly phases=PIT_STOP_PHASES;
  private readonly wheels:WheelRig[]=[];
  private readonly crew:Crew[]=[];
  private readonly stabilizers:{person:Crew;side:number;pad:THREE.Mesh}[]=[];
  private readonly jacks:Jack[]=[];
  private readonly previewWheelDetails:PreviewWheelDetail[]=[];
  private readonly ownGeometry=new Set<THREE.BufferGeometry>();
  private readonly ownMaterials=new Set<THREE.Material>();
  private readonly teamMaterial:THREE.MeshPhysicalMaterial;
  private readonly green:THREE.MeshBasicMaterial;
  private readonly red:THREE.MeshBasicMaterial;
  private fixedRelease?:ReturnType<typeof createFixedPitReleaseSignal>;
  private releaseReady=false;
  private time=0;
  private compound:PitCompound='medium';
  private oldCompound:PitCompound='soft';
  private lift=0;
  private readonly baseY:number;
  private disposed=false;

  constructor(private readonly car:Pick<FleetCar,'group'|'status'>){
    if(car.status!=='ready')throw new Error('Load the supplied FleetCar before creating the pit-stop animation.');
    for(const id of ['front-left','front-right','rear-left','rear-right']){
      const wheel=car.group.getObjectByName(`wheel-${id}`);
      if(!wheel?.getObjectByName(`spin-${id}`))throw new Error(`Cannot animate missing supplied wheel ${id}`);
    }
    this.baseY=car.group.position.y;
    this.group.name='pocket-pit-stop-animation';
    this.group.userData={role:'pit-stop-animation',duration:this.duration,style:'ellipsoid-torso-and-team-helmet',source:'provided-glb',compoundMarker:'none'};
    this.teamMaterial=this.material(0xd8473d,.45,.08,true) as THREE.MeshPhysicalMaterial;
    this.green=new THREE.MeshBasicMaterial({color:0x63e68a});this.red=new THREE.MeshBasicMaterial({color:0xf26755});this.ownMaterials.add(this.green);this.ownMaterials.add(this.red);
    car.group.updateMatrixWorld(true);
    const inverse=car.group.matrixWorld.clone().invert();
    for(const [i,id] of ['front-left','front-right','rear-left','rear-right'].entries()){
      const source=car.group.getObjectByName(`wheel-${id}`),spin=source?.getObjectByName(`spin-${id}`);
      if(!source||!spin)throw new Error(`Cannot animate missing supplied wheel ${id}`);
      const transform=inverse.clone().multiply(source.matrixWorld),anchor=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();transform.decompose(anchor,quaternion,scale);
      const front=id.startsWith('front'),side=id.endsWith('right')?1:-1,radius=(front?.335:.36)*scale.y,halfWidth=(front?.1525:.1775)*scale.x;
      let outerHalfWidth=halfWidth;
      spin.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const matrix=inverse.clone().multiply(object.matrixWorld),p=new THREE.Vector3(),positions=object.geometry.attributes.position;for(let v=0;v<positions.count;v++){p.fromBufferAttribute(positions,v).applyMatrix4(matrix).sub(anchor);outerHalfWidth=Math.max(outerHalfWidth,Math.abs(p.x));}});
      const clone=(kind:'old'|'new')=>{
        const root=new THREE.Group();root.name=`pit-${kind}-wheel-${id}`;root.userData={role:`${kind}-wheel`,wheelId:id,source:'provided-glb',compound:kind==='old'?this.oldCompound:this.compound};
        const shared=spin.clone(true);shared.name=`shared-wheel-geometry-${kind}-${id}`;shared.scale.copy(scale);shared.quaternion.copy(quaternion);root.add(shared);
        // Keep all original surfaces. Only the accent batch gets independent
        // colour buffers so preview neutralisation never alters FleetCar.
        shared.traverse(object=>{
          if(!(object instanceof THREE.Mesh)||object.name!=='wheel-detail-batch')return;
          const sourceGeometry=object.geometry,geometry=sourceGeometry.clone();this.ownGeometry.add(geometry);object.geometry=geometry;
          const sections=(object.userData.paletteSections??[]) as {offset:number;count:number;material:string}[];
          const ranges=sections.filter(section=>section.material==='paint2').map(section=>({offset:section.offset,count:section.count,sourceMaterial:section.material}));
          object.userData={...object.userData,previewWheelAccent:'neutral-metal',sourceGeometryUuid:sourceGeometry.uuid,neutralizedSections:['paint2']};
          geometry.userData={...geometry.userData,sourceGeometryUuid:sourceGeometry.uuid,previewNeutralizedRanges:ranges.map(range=>({...range}))};
          this.previewWheelDetails.push({geometry,source:sourceGeometry,ranges});
        });
        this.group.add(root);return root;
      };
      const old=clone('old'),fresh=clone('new');
      const hub=new THREE.Group();hub.name=`pit-brake-hub-${id}`;hub.userData={role:'brake-hub',wheelId:id};
      const disc=this.mesh(new THREE.CylinderGeometry(radius*.55,radius*.55,.07,24),this.material(0x89908d,.3,.7),'pit-brake-disc');disc.rotation.z=Math.PI/2;hub.add(disc);
      const center=this.mesh(new THREE.CylinderGeometry(.095,.095,.13,12),this.material(0x303e3e,.3,.65),'pit-wheel-stub');center.rotation.z=Math.PI/2;center.position.x=side*.04;hub.add(center);
      this.box(hub,side*.02,.04,-radius*.45,.12,.18,.14,this.material(0x977243,.38,.65),'pit-brake-caliper');this.group.add(hub);
      const nut=this.mesh(new THREE.CylinderGeometry(.067,.067,.045,6),this.material(0xd6b667,.28,.75),'pit-wheel-nut');nut.rotation.z=Math.PI/2;this.group.add(nut);
      const gun=new THREE.Group();gun.name=`pit-wheel-gun-${id}`;gun.userData={role:'wheel-gun',wheelId:id};
      this.box(gun,side*.05,0,0,.25,.15,.14,this.material(0x566365,.32,.7),'pit-gun-body');
      this.box(gun,side*.095,-.13,0,.075,.21,.10,this.material(0x1e2e32,.68),'pit-gun-grip');
      const socket=new THREE.Group();socket.name='pit-gun-socket';socket.position.x=-side*.15;
      const bit=this.mesh(new THREE.CylinderGeometry(.052,.052,.19,12),this.material(0xc7d0c8,.22,.85),'pit-gun-bit');bit.rotation.z=Math.PI/2;socket.add(bit);gun.add(socket);
      const lamp=this.mesh(new THREE.SphereGeometry(.029,8,6),this.red,'pit-gun-status-lamp');lamp.position.set(side*.11,.065,.06);gun.add(lamp);this.group.add(gun);
      const hose=new Hose(this.material(0x263e40,.75));this.ownGeometry.add(hose.object.geometry);this.group.add(hose.object);
      const gunner=this.person('gunner',id),remover=this.person('remove',id),fitter=this.person('fit',id);
      this.wheels.push({id,side,front,anchor,radius,halfWidth,outerHalfWidth,source,sourceVisible:source.visible,old,fresh,hub,nut,gun,socket,lamp,hose,gunner,remover,fitter,delay:[0,.07,.12,.035][i]});
      source.visible=false;
    }
    for(const front of [true,false])this.jacks.push(this.jack(front));
    for(const side of [-1,1]){
      const person=this.person('stabilize');person.root.name=`pit-crew-stabilize-${side<0?'left':'right'}`;
      delete person.root.userData.wheelId;Object.assign(person.root.userData,{side:side<0?'left':'right',motion:'brace-during-lift',supportTarget:'sidepod'});
      const pad=this.mesh(new THREE.CylinderGeometry(.08,.08,.10,12),this.material(0x23383a,.82),'pit-steady-support-pad');pad.rotation.x=Math.PI/2;person.root.add(pad);
      this.stabilizers.push({person,side,pad});
    }
    this.fixedRelease=createFixedPitReleaseSignal();this.group.add(this.fixedRelease.group);
    this.refreshPreviewWheelDetails();
    this.setTime(0);
  }

  setTeam(color:number):void{this.teamMaterial.color.setHex(color);this.refreshPreviewWheelDetails();}
  /** Gameplay passes the actually fitted compound; the review page retains its
   * soft-tyre starting example unless this is explicitly called. */
  setOldCompound(compound:PitCompound):void{
    if(!(compound in PIT_COMPOUND_COLORS))return;
    this.oldCompound=compound;
    for(const wheel of this.wheels)wheel.old.userData.compound=compound;
  }
  setCompound(compound:PitCompound):void{
    if(!(compound in PIT_COMPOUND_COLORS))return;
    this.compound=compound;
    for(const wheel of this.wheels)wheel.fresh.userData.compound=compound;
  }

  /** Seek in either direction without changing gameplay position or heading. */
  setTime(seconds:number):void{
    if(this.disposed)return;
    this.time=clamp(Number.isFinite(seconds)?seconds:0,0,this.duration);
    const t=this.time;
    this.lift=.205*smooth(.6,1.2,t)*(1-smooth(6.4,7.2,t));
    this.car.group.position.y=.11+this.lift;
    this.group.position.set(this.car.group.position.x,0,this.car.group.position.z);this.group.quaternion.copy(this.car.group.quaternion);
    for(const w of this.wheels){
      const local=t-w.delay,s=w.side,a=w.front?1:-1,hubY=.11+w.anchor.y+this.lift;
      const pull=smooth(2.2,2.65,local),withdraw=smooth(2.65,3.05,local),stow=smooth(3.05,3.35,local),align=smooth(3.35,4.45,local),insert=smooth(4.45,5.1,local);
      w.old.position.set(s*lerp(Math.abs(w.anchor.x)+.58*pull,2.75,withdraw),lerp(hubY,w.radius+.055,stow),w.anchor.z+a*1.05*stow);
      // A lifted tyre first reaches a point outside the axle, then slides
      // straight inward. It never travels diagonally through the sidepod.
      w.fresh.position.set(s*lerp(lerp(4.05,Math.abs(w.anchor.x)+.61,align),Math.abs(w.anchor.x),insert),lerp(w.radius+.055,hubY,align),lerp(w.anchor.z-a*.55,w.anchor.z,align));
      w.old.rotation.set(0,0,0);w.fresh.rotation.set(0,0,0);
      w.old.rotation.x=-a*.22*withdraw;w.fresh.rotation.x=a*.14*(1-align);
      w.hub.position.copy(w.anchor);w.hub.position.y=hubY;w.hub.visible=local>2.20&&local<5.03;
      const removed=local>=2.65,installed=local>=5.1;
      w.nut.position.set(w.anchor.x+s*(w.halfWidth+.045),hubY,w.anchor.z);w.nut.visible=!removed||installed;
      w.nut.rotation.x=-local*34*(smooth(1.2,1.35,local)-smooth(1.9,2,local))+local*35*(smooth(5.1,5.3,local)-smooth(6.15,6.35,local));
      const clear=smooth(1.85,2.10,local)*(1-smooth(5.35,5.55,local)),back=smooth(6.30,6.65,local);
      w.gun.position.set(w.anchor.x+s*(w.halfWidth+.17+.20*clear+.35*back),hubY-.04*clear,w.anchor.z+a*.95*(clear+back));
      w.socket.rotation.x=local*95;
      w.lamp.material=local>=6.25?this.green:this.red;
      const grip=new THREE.Vector3(w.gun.position.x+s*.095,w.gun.position.y-.13,w.gun.position.z);
      this.posePerson(w.gunner,grip.x+s*(this.torsoFront(w.gunner,grip.y)+.0375+.06),grip.z,grip.x,grip.z,0,.07);
      w.gunner.root.userData.holding='pit-gun-grip';
      w.hose.update(new THREE.Vector3(grip.x,w.gun.position.y-.235,grip.z),s,w.anchor.z);
      // The tyre handler waits outside the gunner's route, steps into the
      // axle line only after the gun has withdrawn, and carries the tyre
      // close to the chest rather than following a distant parallel lane.
      const enterAxis=smooth(1.88,2.05,local),approach=smooth(2.05,2.2,local);
      const oldHoldX=w.old.position.x+s*(w.outerHalfWidth+this.torsoFront(w.remover,w.old.position.y)+.06);
      this.posePerson(w.remover,lerp(s*2.7,oldHoldX,approach),lerp(w.anchor.z-a*.65,w.old.position.z,enterAxis),w.old.position.x,w.old.position.z,0,.045);
      w.remover.root.userData.holding=local>=2.2?w.old.name:null;
      const newHoldX=w.fresh.position.x+s*(w.outerHalfWidth+this.torsoFront(w.fitter,w.fresh.position.y)+.06),letGo=smooth(5.1,5.35,local);
      this.posePerson(w.fitter,lerp(newHoldX,s*3.35,letGo),w.fresh.position.z,w.fresh.position.x,w.fresh.position.z,0,.045);
      w.fitter.root.userData.holding=local<=5.1?w.fresh.name:null;
      w.old.userData.attached=local<=2.2;w.fresh.userData.attached=installed;
    }
    for(const jack of this.jacks){
      const s=jack.front?1:-1;
      // Seat the rubber saddle against the actual underside, rather than a
      // fixed low pad under empty space/the rear wing. Lower it clear before
      // either jack rolls away from the grounded car.
      const disengage=(jack.contact.y-.155)*smooth(7.2,7.26,t);
      jack.pad.position.y=jack.contact.y-.0475+this.lift-disengage;
      for(const [index,support]of jack.supports.entries()){
        const x=index?1:-1,start=new THREE.Vector3(x*.19,.10,.02),end=new THREE.Vector3(x*.13,jack.pad.position.y+.02,jack.pad.position.z),d=end.clone().sub(start);
        support.position.copy(start).lerp(end,.5);support.scale.y=d.length();support.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
      }
      jack.handle.rotation.x=-s*(.18+smooth(.65,1.2,t)*.32-smooth(6.4,7.2,t)*.32);
      const retreat=smooth(7.26,7.55,t),sidestep=smooth(7.4,7.8,t);
      jack.root.position.x=jack.front?-1.75*sidestep:0;
      jack.root.position.z=jack.front?2.65+retreat:-(2.65+.52*smooth(7.26,7.8,t));
      jack.handle.updateMatrix();jack.root.updateMatrix();
      const grip=jack.grip.position.clone().applyMatrix4(jack.handle.matrix).applyMatrix4(jack.root.matrix);
      this.posePerson(jack.operator,grip.x,grip.z+s*(this.torsoFront(jack.operator,grip.y)+.038+.055),grip.x,grip.z,0,.055);
      jack.operator.root.userData.holding='pit-jack-grip';
    }
    const brace=smooth(.55,1.2,t)*(1-smooth(6.45,7.2,t)),retreatSteady=smooth(6.45,7.2,t);
    for(const {person,side,pad}of this.stabilizers){
      const body=person.root.getObjectByName('pit-person-torso')!;body.position.z=.015*brace;
      const stripe=person.root.getObjectByName('pit-person-chest-stripe')!;stripe.position.z=.015*brace;
      person.helmet.position.z=.04*brace;
      const supportY=.58+this.lift,supportFace=Math.max(...[-.08,0,.08].map(dy=>this.torsoFront(person,supportY+dy))),supportZ=supportFace+.05+.045;
      this.posePerson(person,side*lerp(.73+supportZ,1.72,retreatSteady),0,0,0,0,.11*brace);
      person.root.userData.bracing=brace>.01;person.root.userData.supportHeight=supportY;
      pad.position.set(0,supportY,supportZ);
    }
    this.releaseReady=t>=7.8&&this.lift<.0001&&this.wheels.every(w=>w.fresh.userData.attached);
    this.fixedRelease?.setReady(this.releaseReady);
    this.group.updateMatrixWorld(true);this.car.group.updateMatrixWorld(true);
  }

  get summary(){
    const phase=this.phases.find(p=>this.time>=p.start&&this.time<p.end)??this.phases.at(-1)!;
    return {time:this.time,duration:this.duration,phase:phase.id,phaseName:phase.name,lift:this.lift,compound:this.compound,oldCompound:this.oldCompound,crewCount:this.crew.length,style:'ellipsoid-torso-and-team-helmet',compoundMarker:'none',crewRoles:{gunner:4,remove:4,fit:4,jack:2,stabilize:2},legs:false,releaseReady:this.releaseReady,
      wheels:this.wheels.map(w=>({id:w.id,oldAttached:!!w.old.userData.attached,newAttached:!!w.fresh.userData.attached,oldPosition:{...w.old.position},newPosition:{...w.fresh.position},hubPosition:{...w.hub.position}}))};
  }

  /** Only dispose preview-owned props; source wheel buffers belong to FleetCar. */
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    for(const w of this.wheels)w.source.visible=w.sourceVisible;
    this.car.group.position.y=this.baseY;
    this.fixedRelease?.dispose();
    this.group.removeFromParent();this.group.clear();
    for(const g of this.ownGeometry)g.dispose();for(const m of this.ownMaterials)m.dispose();
  }

  private refreshPreviewWheelDetails():void{
    const neutral=new THREE.Color(0x6c6c6c);
    for(const detail of this.previewWheelDetails){
      const colors=detail.geometry.attributes.color,sourceColors=detail.source.attributes.color;if(!colors||!sourceColors)continue;
      for(let i=0;i<colors.count;i++)colors.setXYZ(i,sourceColors.getX(i),sourceColors.getY(i),sourceColors.getZ(i));
      for(const range of detail.ranges)for(let i=range.offset;i<range.offset+range.count;i++)colors.setXYZ(i,neutral.r,neutral.g,neutral.b);
      colors.needsUpdate=true;
    }
  }
  private material(color:number,roughness=.65,metalness=0,physical=false):THREE.MeshStandardMaterial{
    const material=physical?new THREE.MeshPhysicalMaterial({color,roughness,metalness,clearcoat:.55,clearcoatRoughness:.25}):new THREE.MeshStandardMaterial({color,roughness,metalness});
    this.ownMaterials.add(material);return material;
  }
  private mesh(geometry:THREE.BufferGeometry,material:THREE.Material,name:string){
    this.ownGeometry.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
  }
  private box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material,name:string,r=.035){
    const mesh=this.mesh(new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/4,h/4,d/4)),material,name);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  }
  private rod(parent:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,radius:number,material:THREE.Material,name:string){
    const delta=b.clone().sub(a),mesh=this.mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),8),material,name);mesh.position.copy(a).lerp(b,.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(mesh);return mesh;
  }
  private person(job:Crew['job'],wheelId?:string):Crew{
    const root=new THREE.Group();root.name=`pit-crew-${job}-${wheelId??this.crew.length}`;root.userData={role:'pit-crew',job,wheelId,style:'ellipsoid-torso-and-team-helmet',legs:false};
    const crouch=job==='gunner'||job==='stabilize',height=crouch?.78:.96,bodyY=.1+height/2;
    const torso=this.mesh(new THREE.SphereGeometry(1,20,14),this.teamMaterial,'pit-person-torso');torso.position.y=bodyY;torso.scale.set(.34,height/2,.29);torso.userData.shape='ellipsoid';root.add(torso);
    const chest=this.mesh(new THREE.SphereGeometry(1.012,14,4,Math.PI*.23,Math.PI*.54,1.10,.13),this.material(0xf4f0db),'pit-person-chest-stripe');chest.position.y=bodyY;chest.scale.copy(torso.scale);chest.userData={curved:true,conformsTo:'pit-person-torso'};root.add(chest);
    const helmet=new THREE.Group();helmet.name='pit-person-helmet-pose';helmet.position.y=.1+height+.25;root.add(helmet);
    const shell=this.mesh(new THREE.SphereGeometry(.255,16,10),this.teamMaterial,'pit-person-team-helmet');shell.scale.set(1,.96,1.08);helmet.add(shell);
    const visor=this.mesh(new THREE.SphereGeometry(.264,12,4,Math.PI*.24,Math.PI*.52,.95,.82),this.material(0x162e35,.18,.45),'pit-person-dark-visor');visor.scale.z=1.08;helmet.add(visor);
    const stripe=this.mesh(new THREE.SphereGeometry(.258,3,10,Math.PI*.475,Math.PI*.05,.04,1.05),this.material(0xe8ecdf,.55),'pit-person-helmet-stripe');stripe.scale.z=1.08;helmet.add(stripe);
    const collar=this.mesh(new THREE.CylinderGeometry(.16,.18,.08,12),this.material(0x203438,.7),'pit-person-neck-collar');collar.position.y=.1+height-.015;root.add(collar);
    const person={root,helmet,job,wheelId};this.crew.push(person);this.group.add(root);return person;
  }
  private posePerson(person:Crew,x:number,z:number,lookX:number,lookZ:number,lean:number,helmetPitch:number){
    person.root.position.set(x,0,z);person.root.rotation.set(0,Math.atan2(lookX-x,lookZ-z),lean);person.helmet.rotation.x=helmetPitch;
  }
  private torsoFront(person:Crew,height:number):number{
    const torso=person.root.getObjectByName('pit-person-torso')!;
    const y=(height-torso.position.y)/torso.scale.y;
    return torso.position.z+torso.scale.z*Math.sqrt(Math.max(0,1-y*y));
  }
  /** Probe once in car-local coordinates. Triangle tests ignore material-side
   * settings and exclude complete wheel/helmet subtrees, so a body saddle is
   * fitted to structure rather than a tyre, decal or high rear wing. */
  private jackContact(front:boolean):THREE.Vector3{
    const axle=this.wheels.filter(wheel=>wheel.front===front).reduce((z,wheel)=>z+wheel.anchor.z,0)/2;
    const z=axle+(front?.62:-.52),ray=new THREE.Ray(new THREE.Vector3(0,-2,z),new THREE.Vector3(0,1,0));
    const inverse=this.car.group.matrixWorld.clone().invert(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
    let underside=Infinity;
    this.car.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      for(let parent:THREE.Object3D|null=object;parent&&parent!==this.car.group;parent=parent.parent)if(/^(wheel-|driver-|supplied-helmet|helmet-)/.test(parent.name))return;
      const positions=object.geometry.attributes.position,index=object.geometry.index,matrix=inverse.clone().multiply(object.matrixWorld);
      for(let i=0;i<(index?.count??positions.count);i+=3){
        a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(matrix);b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(matrix);c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(matrix);
        if(ray.intersectTriangle(a,b,c,false,hit)&&hit.y>=0&&hit.y<underside)underside=hit.y;
      }
    });
    return new THREE.Vector3(0,.11+(Number.isFinite(underside)?underside:.25),z);
  }

  private jack(front:boolean):Jack{
    const root=new THREE.Group(),s=front?1:-1;root.name=`pit-${front?'front':'rear'}-jack`;root.userData={role:'pit-jack',front};
    const metal=this.material(0x8c9998,.3,.7),dark=this.material(0x263b3e,.68),rubber=this.material(0x1c292b,.88);
    this.box(root,0,.08,0,.65,.10,.42,metal,'pit-jack-base');
    for(const x of [-.27,.27]){const wheel=this.mesh(new THREE.CylinderGeometry(.085,.085,.075,10),rubber,'pit-jack-wheel');wheel.rotation.z=Math.PI/2;wheel.position.set(x,.085,.08);root.add(wheel);}
    const contact=this.jackContact(front),pad=new THREE.Group();pad.name='pit-jack-lift-pad';pad.position.z=contact.z-s*2.65;this.box(pad,0,.02,0,.34,.055,.35,dark,'pit-jack-contact');root.add(pad);
    root.userData.contact={x:contact.x,y:contact.y,z:contact.z,source:'supplied-car-underside'};
    const supports=[-1,1].map(x=>{const support=this.mesh(new THREE.CylinderGeometry(.035,.035,1,8),metal,`pit-jack-support-${x<0?'left':'right'}`);root.add(support);return support;});
    const handle=new THREE.Group();handle.position.set(0,.14,s*.03);
    this.rod(handle,new THREE.Vector3(0,0,0),new THREE.Vector3(0,.62,s*.40),.028,metal,'pit-jack-handle');
    const grip=this.rod(handle,new THREE.Vector3(-.19,.62,s*.40),new THREE.Vector3(.19,.62,s*.40),.038,dark,'pit-jack-grip');root.add(handle);
    const operator=this.person('jack');this.group.add(root);return{root,pad,handle,grip,operator,front,supports,contact};
  }
}
