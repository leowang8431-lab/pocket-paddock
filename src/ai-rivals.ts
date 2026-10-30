import * as THREE from 'three';
import {FleetCar,type FleetRenderPose} from './fleet-car';
import type {AiRival} from './ai-race';
import {getDriver,type DriverId,type TeamId} from './team-catalog';
import {roadPose,type ElevationTrack} from './road-pose';

type State='unloaded'|'loading'|'ready'|'fallback'|'failed';
type TintMaterial=THREE.Material&{color?:THREE.Color;map?:THREE.Texture|null;vertexColors?:boolean};
interface Section {offset:number;count:number;material:string}
interface Batch {mesh:THREE.InstancedMesh;source:THREE.Mesh;sourceIndex:number;section?:string}
interface Decal {source:THREE.Mesh;sourceIndex:number;slots:THREE.Mesh[]}
interface Appearance {
  key:string;team:TeamId;driver:DriverId;number:number;colors:THREE.Color[];
  wheelColors:Record<string,THREE.Color>;decalMaterial?:THREE.Material;decalTexture?:THREE.Texture;
  bodyColors:Record<string,string>;helmetColors:Record<string,string>;
}
interface Pose extends FleetRenderPose {distance:number;elapsed:number}
const appearanceKey=(r:Pick<AiRival,'team'|'driver'>)=>`${r.team}/${r.driver}`;
const tint=(material:THREE.Material)=>(material as TintMaterial).color?.clone()??new THREE.Color(0xffffff);

/** Every visible surface comes from the same prepared FleetCar/GLBs as the
 * player. Geometry and finish textures are shared across all opponents. Only
 * numbers/wordmarks have per-driver canvases; no substitute low-poly chassis. */
export class AiRivals {
  readonly group=new THREE.Group();
  private ground?:ElevationTrack;
  setGround(track?:ElevationTrack){this.ground=track;}
  private state:State='unloaded';
  private template?:FleetCar;
  private pending?:Promise<void>;
  private readonly sources:THREE.Mesh[]=[];
  private readonly batches:Batch[]=[];
  private readonly decals:Decal[]=[];
  private readonly appearances=new Map<string,Appearance>();
  private readonly poses=new Map<string,Pose>();
  private active:readonly AiRival[]=[];
  private roster='';
  private visibleCount=0;
  private sourceTriangles=0;
  private readonly object=new THREE.Object3D();
  private readonly matrix=new THREE.Matrix4();
  constructor(readonly capacity=5){
    if(!Number.isInteger(capacity)||capacity<1||capacity>10)throw new Error('Invalid rival render capacity');
    this.group.name='ai-shared-player-glb-grid';this.group.visible=false;
    this.group.userData.features=['provided-glb','exposed-wheels','front-wing','rear-wing','open-cockpit','halo','helmet','driver-number','tyre-sidewalls'];
  }
  get status(){return this.state;}
  load(player?:FleetCar):Promise<void>{
    if(this.pending)return this.pending;
    this.state='loading';
    this.pending=(async()=>{
      if(player?.status==='loading')await player.load();
      this.template=new FleetCar();
      // If the player already fell back, use the identical fallback chassis
      // rather than silently giving opponents a different recovered model.
      if(player?.status!=='fallback')await this.template.load();
      this.state=this.template.status==='ready'?'ready':'fallback';
      this.build();this.update(this.active,0);
    })().catch(error=>{this.clearBuiltParts();this.state='failed';this.pending=undefined;console.warn('AI 车队模型未就绪。',error);});
    return this.pending;
  }
  private clearBuiltParts(){
    for(const {mesh,source}of this.batches){
      if(mesh.geometry!==source.geometry)mesh.geometry.dispose();
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach(m=>m.dispose());
    }
    for(const entry of this.appearances.values()){entry.decalMaterial?.dispose();entry.decalTexture?.dispose();}
    this.group.clear();this.sources.length=this.batches.length=this.decals.length=0;
    this.appearances.clear();this.poses.clear();this.roster='';this.visibleCount=this.sourceTriangles=0;
    this.template=undefined;
  }
  private build(){
    const template=this.template!;template.group.updateMatrixWorld(true);
    template.group.traverse(object=>{if(object instanceof THREE.Mesh)this.sources.push(object);});
    this.sourceTriangles=this.sources.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
    for(let index=0;index<this.sources.length;index++){
      const source=this.sources[index];
      if(Array.isArray(source.material))throw new Error('Fleet source must expose single-material parts');
      if(source.name==='driver-and-team-decals'||source.name==='helmet-driver-number'){
        const slots=Array.from({length:this.capacity},(_,slot)=>{
          const mesh=new THREE.Mesh(source.geometry,source.material);mesh.name=`ai-driver-decal-${index}-${slot}`;mesh.matrixAutoUpdate=false;mesh.visible=false;
          mesh.receiveShadow=source.receiveShadow;mesh.castShadow=source.castShadow;mesh.renderOrder=source.renderOrder;
          mesh.userData.sourceIndex=index;mesh.userData.sourceName=source.name;this.group.add(mesh);return mesh;
        });this.decals.push({source,sourceIndex:index,slots});continue;
      }
      const sections=source.userData.paletteSections as Section[]|undefined;
      // The player's wheel batch contains paint2, rim and chrome. Split its
      // existing draw ranges (sharing positions/normals) so each instance keeps
      // the exact palette; do not tint all three metal regions with paint2.
      for(const section of sections??[undefined]){
        const material=source.material.clone() as TintMaterial;material.color?.set(0xffffff);
        let geometry=source.geometry;
        if(section){
          geometry=new THREE.BufferGeometry();
          for(const [name,attribute]of Object.entries(source.geometry.attributes))geometry.setAttribute(name,attribute);
          geometry.setIndex(source.geometry.index);geometry.setDrawRange(section.offset,section.count);
          material.vertexColors=false;
        }
        const mesh=new THREE.InstancedMesh(geometry,material,this.capacity);mesh.count=0;
        mesh.name=`ai-glb-${index}-${section?.material??source.name??material.name}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.receiveShadow=source.receiveShadow;mesh.castShadow=source.castShadow;mesh.renderOrder=source.renderOrder;
        mesh.userData.sourceIndex=index;mesh.userData.sourceName=source.name;mesh.userData.paletteSection=section?.material;
        this.batches.push({mesh,source,sourceIndex:index,section:section?.material});this.group.add(mesh);
      }
    }
    this.group.userData.dimensions={...template.summary.dimensions};
    this.group.userData.sourceTriangles=this.sourceTriangles;
  }
  private capture(rival:AiRival):Appearance{
    const template=this.template!;template.select(rival.team,getDriver(rival.driver));
    const summary=template.summary;
    const colors=this.sources.map(mesh=>tint(mesh.material as THREE.Material));
    const wheelColors:Record<string,THREE.Color>={};
    for(const mesh of this.sources){
      const sections=mesh.userData.paletteSections as Section[]|undefined;
      const color=mesh.geometry.getAttribute('color');
      for(const section of sections??[])wheelColors[section.material]=new THREE.Color().setRGB(color.getX(section.offset),color.getY(section.offset),color.getZ(section.offset));
    }
    let decalTexture:THREE.Texture|undefined,decalMaterial:THREE.Material|undefined;
    if(this.decals.length){
      const original=this.decals[0].source.material as TintMaterial,map=original.map!;
      const canvas=document.createElement('canvas');canvas.width=map.image.width;canvas.height=map.image.height;
      canvas.getContext('2d')!.drawImage(map.image,0,0);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=map.colorSpace;texture.anisotropy=map.anisotropy;
      texture.wrapS=map.wrapS;texture.wrapT=map.wrapT;texture.magFilter=map.magFilter;texture.minFilter=map.minFilter;
      texture.name=`ai-driver-${rival.driver}-number-${getDriver(rival.driver).number}`;
      texture.userData={driver:rival.driver,number:getDriver(rival.driver).number};
      decalTexture=texture;decalMaterial=original.clone();(decalMaterial as TintMaterial).map=texture;
    }
    return{key:appearanceKey(rival),team:rival.team,driver:rival.driver,number:getDriver(rival.driver).number,colors,wheelColors,decalTexture,decalMaterial,bodyColors:summary.bodyColors,helmetColors:summary.helmetColors};
  }
  private syncRoster(rivals:readonly AiRival[]){
    const roster=rivals.map(appearanceKey).join('|');if(roster===this.roster)return;
    const wanted=new Set(rivals.map(appearanceKey));
    for(const [key,entry]of this.appearances)if(!wanted.has(key)){entry.decalMaterial?.dispose();entry.decalTexture?.dispose();this.appearances.delete(key);}
    for(const rival of rivals)if(!this.appearances.has(appearanceKey(rival)))this.appearances.set(appearanceKey(rival),this.capture(rival));
    this.roster=roster;this.poses.clear();
  }
  setVisible(visible:boolean){this.group.visible=visible;}
  update(rivals:readonly AiRival[],dt=1/60){
    this.active=rivals;
    if(!this.template||!this.sources.length)return;
    this.syncRoster(rivals);
    const step=Number.isFinite(dt)?Math.max(0,Math.min(dt,.1)):0;
    let count=0;
    for(const rival of rivals){
      if(rival.finished||count>=this.capacity)continue;
      const appearance=this.appearances.get(appearanceKey(rival))!;
      let pose=this.poses.get(rival.id);
      if(!pose||rival.distance<pose.distance-.01){pose={distance:rival.distance,elapsed:0,travel:0,steeringAngle:rival.frontWheelAngle,helmetRoll:0,helmetPitch:0};this.poses.set(rival.id,pose);}
      else if(step>0){
        pose.travel+=Math.max(0,rival.distance-pose.distance);pose.elapsed+=step;
        pose.steeringAngle=THREE.MathUtils.damp(pose.steeringAngle,rival.frontWheelAngle,12,step);
        const steering=rival.frontWheelAngle/.38;
        pose.helmetRoll=THREE.MathUtils.damp(pose.helmetRoll,steering*Math.min(Math.abs(rival.speed)/80,.075),6,step);
        pose.helmetPitch=Math.sin(pose.elapsed*8)*Math.min(Math.abs(rival.speed)/4000,.012);
      }
      pose.distance=rival.distance;this.template.setRenderPose(pose);this.template.group.updateMatrixWorld(true);
      const ground=roadPose(this.ground,rival.x,rival.z,rival.heading);
      this.object.position.set(rival.x,ground.height,rival.z);this.object.rotation.set(ground.pitch,rival.heading,0,'YXZ');this.object.scale.setScalar(1);this.object.updateMatrix();
      for(const batch of this.batches){
        this.matrix.multiplyMatrices(this.object.matrix,batch.source.matrixWorld);batch.mesh.setMatrixAt(count,this.matrix);
        batch.mesh.setColorAt(count,batch.section?appearance.wheelColors[batch.section]:appearance.colors[batch.sourceIndex]);
      }
      for(const decal of this.decals){
        const mesh=decal.slots[count];this.matrix.multiplyMatrices(this.object.matrix,decal.source.matrixWorld);mesh.matrix.copy(this.matrix);mesh.matrixWorldNeedsUpdate=true;
        mesh.material=appearance.decalMaterial!;mesh.visible=true;mesh.userData.driver=rival.driver;mesh.userData.number=appearance.number;
      }
      count++;
    }
    this.visibleCount=count;
    for(const {mesh}of this.batches){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
    for(const decal of this.decals)for(let i=count;i<this.capacity;i++)decal.slots[i].visible=false;
  }
  get summary(){
    const drivers=this.active.filter(r=>!r.finished).slice(0,this.capacity).map(r=>{
      const a=this.appearances.get(appearanceKey(r));return{id:r.id,team:r.team,driver:r.driver,number:getDriver(r.driver).number,bodyColors:a?.bodyColors,helmetColors:a?.helmetColors,pose:this.poses.get(r.id)?{...this.poses.get(r.id)}:null};
    });
    return{status:this.state,source:this.state==='ready'?'provided-glb':this.state==='fallback'?'procedural-fallback':this.state==='failed'?'unavailable':'loading',cars:this.visibleCount,draws:this.visibleCount?this.batches.length+this.decals.length*this.visibleCount:0,trianglesPerCar:this.sourceTriangles,dimensions:this.group.userData.dimensions,instancedParts:this.batches.length,decalPartsPerCar:this.decals.length,drivers,roster:drivers};
  }
}
