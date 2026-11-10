import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {Car} from './car';
import {createRubberNormalMap,createCarbonNormalMap,createTyreSidewallTexture} from './visual-finish';
import {DEFAULT_DRIVER,DEFAULT_TEAM,getDriver,getTeam,type DriverOption,type TeamId} from './team-catalog';
import {createDrsWing} from './drs-wing';
import {attachMirrorSupports} from './car-mirror-supports';
import {createSidepodWordmark} from './sidepod-wordmark';

type ModelState = 'loading' | 'ready' | 'fallback';
type MaterialPalette = Record<string,{color:number[];metalness:number;roughness:number}>;
interface Palettes {
  teams:Record<string,MaterialPalette>;
  helmets:Record<string,MaterialPalette>;
}
interface Wheel {
  pivot:THREE.Object3D;
  spin:THREE.Group;
  front:boolean;
  radius:number;
}
interface ColorSection {offset:number;count:number;material:string}
export interface FleetRenderPose {travel:number;steeringAngle:number;helmetRoll:number;helmetPitch:number;drsOpen?:boolean}

const MODEL_SCALE=1.4;
const MODEL_BASE=`${import.meta.env?.BASE_URL??'./'}models/`;
// Cache immutable source bytes, never parsed/mutable glTF objects. Player and
// rival templates therefore share three downloads while owning their geometry.
const sourceRequests=new Map<string,Promise<ArrayBuffer>>();
function sourceBytes(file:string):Promise<ArrayBuffer>{
  const url=`${MODEL_BASE}${file}`,cached=sourceRequests.get(url);if(cached)return cached;
  const request=fetch(url,{signal:AbortSignal.timeout(20000)}).then(response=>{
    if(!response.ok)throw new Error(`${file}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }).catch(error=>{sourceRequests.delete(url);throw error;});
  sourceRequests.set(url,request);return request;
}

/** User-provided shared chassis/helmet, with palettes rather than 33 downloads.
 * Gameplay coordinates stay +Z forward, with the origin at road level. */
export class FleetCar {
  private drsHinge?:THREE.Group;
  private drsOpen=false;
  readonly group=new THREE.Group();
  private fallback?:Car;
  private model?:THREE.Group;
  private helmet?:THREE.Group;
  private readonly helmetMount=new THREE.Group();
  private readonly wheels:Wheel[]=[];
  private readonly wheelDetails:{geometry:THREE.BufferGeometry;sections:ColorSection[]}[]=[];
  private readonly wheelMetal=new THREE.MeshStandardMaterial({name:'wheel-metal-batch',vertexColors:true,roughness:.29,metalness:.65,envMapIntensity:.9});
  private palettes?:Palettes;
  private team:TeamId=DEFAULT_TEAM;
  private driver:DriverOption=getDriver(DEFAULT_DRIVER);
  private state:ModelState='loading';
  private pending?:Promise<void>;
  private elapsed=0;
  private readonly atlas=document.createElement('canvas');
  private readonly texture:THREE.CanvasTexture;
  private readonly decalMaterial:THREE.MeshBasicMaterial;
  private rubberNormal?:THREE.DataTexture;
  private carbonNormal?:THREE.DataTexture;
  private sidewallMaterial?:THREE.MeshBasicMaterial;
  private dimensions={width:2.53,length:4.47,height:1.80};

  constructor(){
    this.group.name='pocket-fleet-car';
    this.atlas.width=1024;this.atlas.height=512;
    this.texture=new THREE.CanvasTexture(this.atlas);
    this.texture.colorSpace=THREE.SRGBColorSpace;
    this.texture.anisotropy=4;
    this.decalMaterial=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,alphaTest:.03,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    this.select(this.team,this.driver);
  }

  get status():ModelState{return this.state;}

  get summary(){
    let triangles=0,drawCalls=0;
    this.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      triangles+=(object.geometry.index?.count??object.geometry.attributes.position?.count??0)/3;
      drawCalls+=Array.isArray(object.material)?object.geometry.groups.length||object.material.length:1;
    });
    const colors=(root:THREE.Object3D|undefined)=>{
      const result:Record<string,string>={};
      root?.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        for(const m of Array.isArray(object.material)?object.material:[object.material])
          if(m instanceof THREE.MeshStandardMaterial)result[m.name]=`#${m.color.getHexString()}`;
      });
      return result;
    };
    return {
      status:this.state,team:this.team,driver:this.driver.id,number:this.driver.number,
      source:this.state==='ready'?'provided-glb':this.state==='fallback'?'procedural-fallback':'loading',triangles,drawCalls,
      finish:{clearcoat:this.state==='ready',tyreSidewalls:this.state==='ready'?4:0,decalResolution:this.atlas.width},
      dimensions:{...this.dimensions},bodyColors:colors(this.model),helmetColors:colors(this.helmet),
      wheels:this.wheels.map(w=>({name:w.pivot.name,front:w.front,steering:w.pivot.rotation.y,spin:w.spin.rotation.x})),
      drs:{active:this.drsOpen,angle:this.drsHinge?.rotation.x??0,triangles:this.drsHinge?.userData.triangles??0},
    };
  }

  /** Idempotent. A failed request leaves the original car ready to drive. */
  load():Promise<void>{
    if(this.pending)return this.pending;
    if(this.state==='fallback')return Promise.resolve();
    this.pending=this.loadModels();return this.pending;
  }

  useFallback():void{
    if(this.state!=='loading')return;
    this.fallback=new Car('coral','leclerc-2024');
    this.group.add(this.fallback.group);
    this.select(this.team,this.driver);
    this.state='fallback';
  }

  select(team:TeamId,driver:DriverOption):void{
    // A selection made during loading is applied when both models are ready.
    this.team=team;this.driver=driver;
    this.group.userData.team=team;this.group.userData.driver=driver.id;
    this.group.userData.number=driver.number;
    if(this.fallback){
      this.fallback.setLivery(['aston','mercedes'].includes(team)?'teal':['haas','audi','cadillac','williams'].includes(team)?'ivory':'coral');
    }
    if(this.model&&this.helmet&&this.palettes){
      this.applyPalette(this.model,this.palettes.teams[team]);
      this.applyPalette(this.helmet,this.palettes.helmets[driver.id]);
      this.paintWheelDetails(this.palettes.teams[team]);
    }
    this.paintDecals();
  }

  setDrs(active:boolean,immediate=false):void{this.drsOpen=active;if(immediate&&this.drsHinge)this.drsHinge.rotation.x=active?-.5:0;}

  update(speed:number,steering:number,dt:number,frontWheelAngle?:number):void{
    if(this.state!=='ready'){this.fallback?.update(speed,steering,dt);return;}
    this.elapsed+=dt;
    for(const wheel of this.wheels){
      wheel.spin.rotation.x=(wheel.spin.rotation.x+speed*dt/(wheel.radius*MODEL_SCALE))%(Math.PI*2);
      if(wheel.front)wheel.pivot.rotation.y=THREE.MathUtils.damp(wheel.pivot.rotation.y,frontWheelAngle??steering*.38,12,dt);
    }
    this.helmetMount.rotation.z=THREE.MathUtils.damp(this.helmetMount.rotation.z,steering*Math.min(Math.abs(speed)/80,.075),6,dt);
    this.helmetMount.rotation.x=Math.sin(this.elapsed*8)*Math.min(Math.abs(speed)/4000,.012);
    if(this.drsHinge)this.drsHinge.rotation.x=THREE.MathUtils.damp(this.drsHinge.rotation.x,this.drsOpen?-.5:0,16,dt);
  }

  /** Stateless pose for the shared AI render template; no player animation or
   * material state is shared with this separate FleetCar instance. */
  setRenderPose(pose:FleetRenderPose):void{
    if(this.state!=='ready')return;
    for(const wheel of this.wheels){
      wheel.spin.rotation.x=(pose.travel/(wheel.radius*MODEL_SCALE))%(Math.PI*2);
      wheel.pivot.rotation.y=wheel.front?pose.steeringAngle:0;
    }
    this.helmetMount.rotation.z=pose.helmetRoll;this.helmetMount.rotation.x=pose.helmetPitch;
    this.setDrs(!!pose.drsOpen,true);
  }

  private async loadModels():Promise<void>{
    const loader=new GLTFLoader();
    // allSettled lets failed partial parses release their objects too.
    const results=await Promise.allSettled([
      sourceBytes('car.glb').then(b=>loader.parseAsync(b,MODEL_BASE)),
      sourceBytes('helmet.glb').then(b=>loader.parseAsync(b,MODEL_BASE)),
      sourceBytes('palettes.json').then(b=>JSON.parse(new TextDecoder().decode(b)) as Palettes),
    ] as const);
    try{
      const [carResult,helmetResult,paletteResult]=results;
      if(carResult.status==='rejected')throw carResult.reason;
      if(helmetResult.status==='rejected')throw helmetResult.reason;
      if(paletteResult.status==='rejected')throw paletteResult.reason;
      const palettes=paletteResult.value;
      if(!palettes.teams[this.team]||!palettes.helmets[this.driver.id])throw new Error('模型配色索引不完整');
      this.palettes=palettes;
      this.model=carResult.value.scene;
      this.helmet=helmetResult.value.scene;
      this.model.name='supplied-car';this.helmet.name='supplied-helmet';
      this.model.scale.setScalar(MODEL_SCALE);
      this.prepareFinish();
      this.drsHinge=createDrsWing(this.model);
      attachMirrorSupports(this.model);
      this.setDrs(this.drsOpen,true);
      for(const axle of ['front','rear'] as const)for(const side of ['left','right'] as const){
        const pivot=this.model.getObjectByName(`wheel-${axle}-${side}`);
        if(!pivot||pivot instanceof THREE.Mesh)throw new Error(`车轮节点缺失：${axle}-${side}`);
        const spin=new THREE.Group();spin.name=`spin-${axle}-${side}`;
        for(const child of [...pivot.children])spin.add(child);
        pivot.add(spin);
        this.batchWheelDetail(spin);
        this.wheels.push({pivot,spin,front:axle==='front',radius:axle==='front'?.335:.36});
      }
      this.helmetMount.name='driver-helmet-mount';
      this.helmetMount.position.set(0,.766,.0558);
      this.helmetMount.scale.set(1.15,1.15,1.15*1.24);
      this.helmetMount.add(this.helmet);
      this.model.add(this.helmetMount);
      this.model.traverse(object=>{
        if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;}
      });
      this.addDecals();
      this.addDetailTrim();
      this.select(this.team,this.driver);
      this.group.add(this.model);
      if(this.fallback){
        this.fallback.group.removeFromParent();
        disposeObject(this.fallback.group);this.fallback=undefined;
      }
      this.model.updateMatrixWorld(true);
      const size=new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
      this.dimensions={width:size.x,length:size.z,height:size.y};
      this.group.userData.dimensions=this.dimensions;
      this.state='ready';
    }catch(error){
      // A malformed successful response is not a reusable source either.
      // Clear only the failing entries so a later template/load may retry.
      const files=['car.glb','helmet.glb','palettes.json'];
      results.forEach((result,index)=>{if(result.status==='rejected')sourceRequests.delete(`${MODEL_BASE}${files[index]}`);});
      console.warn('车队模型载入失败，已使用口袋原创赛车。',error);
      this.model?.removeFromParent();
      for(const result of results.slice(0,2)){
        if(result.status==='fulfilled'&&'scene' in result.value)disposeObject(result.value.scene);
      }
      this.model=undefined;this.helmet=undefined;this.wheels.length=0;this.wheelDetails.length=0;this.palettes=undefined;
      this.useFallback();
    }
  }

  /** One-time material/UV preparation. Selection only updates colours afterwards.
   * The geometry and the source's linear RGB palette are preserved. */
  private prepareFinish():void{
    if(!this.model||!this.helmet)return;
    this.rubberNormal=createRubberNormalMap();this.carbonNormal=createCarbonNormalMap();
    const replacements=new Map<THREE.Material,THREE.Material>();
    const upgrade=(source:THREE.Material)=>{
      if(!(source instanceof THREE.MeshStandardMaterial))return source;
      if(replacements.has(source))return replacements.get(source)!;
      let result:THREE.MeshStandardMaterial=source;
      if(['paint','paint2','white','visor','helm_shell','helm_ring','helm_cap'].includes(source.name)){
        result=new THREE.MeshPhysicalMaterial({
          name:source.name,color:source.color.clone(),roughness:source.roughness,metalness:source.metalness,
          side:source.side,clearcoat:source.name==='visor'?1:.72,clearcoatRoughness:source.name==='visor'?.12:.23,
          envMapIntensity:source.name==='visor'?1.3:.85,
        });
      }
      if(source.name==='tire'){
        result.normalMap=this.rubberNormal!;result.normalScale.set(.12,.12);
        result.envMapIntensity=.3;
      }else if(source.name==='carbon'){
        result.normalMap=this.carbonNormal!;result.normalScale.set(.12,.12);
        result.envMapIntensity=.6;
      }
      replacements.set(source,result);return result;
    };
    for(const root of [this.model,this.helmet])root.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const sourceMaterials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of sourceMaterials){
        if(!(material instanceof THREE.MeshStandardMaterial)||!['tire','carbon'].includes(material.name))continue;
        const positions=object.geometry.attributes.position,normals=object.geometry.attributes.normal;
        const uvs=new Float32Array(positions.count*2);
        for(let i=0;i<positions.count;i++){
          const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
          if(material.name==='tire'){
            uvs[i*2]=Math.atan2(z,y)/(2*Math.PI)+.5;uvs[i*2+1]=x/.36+.5;
          }else{
            const ax=Math.abs(normals.getX(i)),ay=Math.abs(normals.getY(i)),az=Math.abs(normals.getZ(i));
            const [u,v]=ay>=ax&&ay>=az?[x,z]:ax>=az?[z,y]:[x,y];
            uvs[i*2]=u*7;uvs[i*2+1]=v*7;
          }
        }
        object.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      }
      object.material=Array.isArray(object.material)?sourceMaterials.map(upgrade):upgrade(sourceMaterials[0]);
    });
    // Replaced GLTF materials have never been rendered. Shared source objects
    // are disposed only once; their new counterparts remain cached per car.
    for(const [source,result] of replacements)if(source!==result)source.dispose();
  }

  private addDetailTrim():void{
    if(!this.model)return;
    this.sidewallMaterial=new THREE.MeshBasicMaterial({
      name:'pocket-tyre-sidewall-finish',map:createTyreSidewallTexture(),transparent:true,
      alphaTest:.06,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
    });
    for(const wheel of this.wheels){
      const tyre=wheel.spin.children.find(o=>o instanceof THREE.Mesh&&(o.material as THREE.Material).name==='tire') as THREE.Mesh|undefined;
      if(!tyre)continue;
      const side=wheel.pivot.name.endsWith('left')?-1:1;
      const geometry=tyreSidewallGeometry(tyre.geometry,side,wheel.radius);
      const mesh=new THREE.Mesh(geometry,this.sidewallMaterial);mesh.name='pocket-tyre-sidewall';mesh.renderOrder=2;
      wheel.spin.add(mesh);
    }
    // Shaped foam shoulder pads, a fabric upper torso and neck sit inside the
    // open cockpit; they do not cover the source Halo or change its silhouette.
    const parts:THREE.BufferGeometry[]=[];
    const part=(geometry:THREE.BufferGeometry,x:number,y:number,z:number)=>{
      const g=geometry.index?geometry.toNonIndexed():geometry.clone();
      g.translate(x,y,z);parts.push(g);geometry.dispose();
    };
    part(new RoundedBoxGeometry(.28,.12,.18,2,.035),0,.53,.08);
    part(new THREE.CylinderGeometry(.07,.085,.12,16),0,.59,.0558);
    for(const side of [-1,1])part(new RoundedBoxGeometry(.09,.07,.22,2,.027),side*.19,.575,-.035);
    const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
    if(merged){
      const material=new THREE.MeshStandardMaterial({name:'cockpit-fabric-and-padding',color:0x151b20,roughness:.85,metalness:0,envMapIntensity:.2});
      const trim=new THREE.Mesh(merged,material);trim.name='driver-cockpit-trim';trim.castShadow=trim.receiveShadow=true;this.model.add(trim);
    }
    this.group.userData.visualFinish={clearcoat:true,normalMaps:['rubber','carbon'],tyreLettering:false,decalSize:[1024,512]};
  }

  /** Three small metal/accent primitives share one lit, multicolour draw. The
   * tyre keeps its own rough material, and all original colours remain intact. */
  private batchWheelDetail(spin:THREE.Group):void{
    const parts:THREE.BufferGeometry[]=[],sections:ColorSection[]=[];
    let offset=0;
    for(const child of [...spin.children]){
      if(!(child instanceof THREE.Mesh)||!(child.material instanceof THREE.MeshStandardMaterial)||child.material.name==='tire')continue;
      const geometry=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();
      for(const attribute of Object.keys(geometry.attributes))if(attribute!=='position'&&attribute!=='normal')geometry.deleteAttribute(attribute);
      child.updateMatrix();geometry.applyMatrix4(child.matrix);geometry.clearGroups();
      const count=geometry.attributes.position.count;
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
      sections.push({offset,count,material:child.material.name});offset+=count;
      parts.push(geometry);child.removeFromParent();child.geometry.dispose();
    }
    if(!parts.length)return;
    const geometry=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());
    if(!geometry)throw new Error('车轮材质批次无法合并');
    const mesh=new THREE.Mesh(geometry,this.wheelMetal);mesh.name='wheel-detail-batch';mesh.userData.paletteSections=sections.map(section=>({...section}));spin.add(mesh);
    this.wheelDetails.push({geometry,sections});
  }

  private paintWheelDetails(palette:MaterialPalette):void{
    for(const {geometry,sections} of this.wheelDetails){
      const colors=geometry.attributes.color;
      for(const section of sections){
        const color=palette[section.material]?.color??[1,1,1];
        for(let i=section.offset;i<section.offset+section.count;i++)colors.setXYZ(i,color[0],color[1],color[2]);
      }
      colors.needsUpdate=true;
    }
  }

  private applyPalette(root:THREE.Object3D,palette:MaterialPalette|undefined):void{
    if(!palette)return;
    const updated=new Set<THREE.Material>();
    root.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!(material instanceof THREE.MeshStandardMaterial)||updated.has(material))continue;
        updated.add(material);
        const source=palette[material.name];if(!source)continue;
        // glTF baseColorFactor is already linear; converting as sRGB washes it out.
        material.color.setRGB(source.color[0],source.color[1],source.color[2],THREE.LinearSRGBColorSpace);
        material.opacity=1;material.transparent=false;
        const name=material.name;
        if(name==='tire'){material.roughness=.88;material.metalness=.02;}
        else if(name==='chrome'||name==='rim'){material.roughness=.24;material.metalness=.72;material.envMapIntensity=.9;}
        else if(name==='visor'){material.roughness=.12;material.metalness=.36;}
        else if(name==='carbon'||name==='dark'){material.roughness=name==='carbon'?.49:.55;material.metalness=.12;}
        else{material.roughness=name.startsWith('helm')?.27:.29;material.metalness=.14;}
      }
    });
  }

  private paintDecals():void{
    const ctx=this.atlas.getContext('2d')!;
    ctx.setTransform(2,0,0,2,0,0);
    ctx.clearRect(0,0,512,256);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    const text=(value:string,x:number,y:number,size:number,maxWidth:number,dark=false)=>{
      ctx.font=`900 ${size}px Arial, sans-serif`;
      ctx.strokeStyle=dark?'#fff8e6':'#142f36';ctx.fillStyle=dark?'#142f36':'#fff8e6';ctx.lineWidth=Math.max(3,size*.08);
      ctx.strokeText(value,x,y,maxWidth);ctx.fillText(value,x,y,maxWidth);
    };
    // Leave consistent margins for the longest names as well as the short ones.
    text(getTeam(this.team).name.toUpperCase(),256,64,56,456);
    text(String(this.driver.number),128,194,112,236,true);
    const code:Record<TeamId,string>={mclaren:'MCL',ferrari:'FER',redbull:'RBR',mercedes:'MER',aston:'AMR',alpine:'ALP',williams:'WIL',haas:'HAA',racingbulls:'VCB',audi:'AUD',cadillac:'CAD'};
    ctx.fillStyle=getTeam(this.team).color;
    ctx.beginPath();ctx.roundRect(292,142,184,99,22);ctx.fill();
    text(code[this.team],384,194,56,163);
    this.texture.needsUpdate=true;
  }

  private addDecals():void{
    if(!this.model||!this.helmet)return;
    const parts:THREE.BufferGeometry[]=[],wordmarks:Record<string,unknown>[]=[];
    const numberUV=[0,0,.5,.5] as const;
    const wordmarkUV=[0,.5,1,1] as const;
    const crestUV=[.5,0,1,.5] as const;
    const plane=(width:number,height:number,uv:readonly number[],position:THREE.Vector3,rotation:THREE.Euler)=>{
      const g=new THREE.PlaneGeometry(width,height);
      const attr=g.attributes.uv;
      for(let i=0;i<attr.count;i++)attr.setXY(i,uv[0]+attr.getX(i)*(uv[2]-uv[0]),uv[1]+attr.getY(i)*(uv[3]-uv[1]));
      g.applyMatrix4(new THREE.Matrix4().compose(position,new THREE.Quaternion().setFromEuler(rotation),new THREE.Vector3(1,1,1)));
      parts.push(g);
    };
    // Rear-wing endplate numbers replace the source's expensive 3D lettering.
    for(const side of [-1,1]){
      plane(.184,.132,numberUV,new THREE.Vector3(side*.519,.805,-1.38),new THREE.Euler(0,side*Math.PI/2,0));
      const wordmark=createSidepodWordmark(this.model,side,wordmarkUV);parts.push(wordmark);wordmarks.push({...wordmark.userData});
    }
    // The tiny nose badge identifies the team without inventing a sponsor logo.
    plane(.132,.078,crestUV,new THREE.Vector3(0,.425,1.29),new THREE.Euler(-Math.PI/2,0,0));
    const merged=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());
    if(merged){const mesh=new THREE.Mesh(merged,this.decalMaterial);mesh.name='driver-and-team-decals';mesh.renderOrder=2;mesh.userData.wordmarks=wordmarks;this.model.add(mesh);}
    // A curved patch follows the back of the helmet and is legible from chase view.
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    const columns=10,rows=4;
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      // Above the rear Halo tube; a lower patch is hidden in normal chase view.
      const localY=.125+(y/rows-.5)*.10;
      const theta=(x/columns-.5)*.82;
      const ring=Math.sqrt(1-(localY/.214)**2);
      positions.push(Math.sin(theta)*.201*ring,localY,-Math.cos(theta)*.209*ring);
      // Back-facing patch: local +X goes left when seen from behind.
      uvs.push((1-x/columns)*.5,y/rows*.5);
      if(x<columns&&y<rows){const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);}
    }
    const patch=new THREE.BufferGeometry();patch.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));patch.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));patch.setIndex(indices);patch.computeVertexNormals();
    const helmetNumber=new THREE.Mesh(patch,this.decalMaterial);helmetNumber.name='helmet-driver-number';helmetNumber.renderOrder=2;this.helmet.add(helmetNumber);
  }
}

/** Follow the rounded sidewall profile rather than floating a flat decal disc
 * outside a curved tyre. Only the subtle, transparent moulded marks are drawn. */
function tyreSidewallGeometry(source:THREE.BufferGeometry,side:number,radius:number):THREE.BufferGeometry{
  const position=source.attributes.position,profile=new Map<number,number>();
  for(let i=0;i<position.count;i++){
    const r=Math.round(Math.hypot(position.getY(i),position.getZ(i))*1000)/1000;
    profile.set(r,Math.max(profile.get(r)??0,Math.abs(position.getX(i))));
  }
  const samples=[...profile].sort((a,b)=>a[0]-b[0]);
  const axial=(r:number)=>{
    for(let i=1;i<samples.length;i++){
      if(r>samples[i][0])continue;
      const [a,x]=samples[i-1],[b,y]=samples[i];return THREE.MathUtils.lerp(x,y,THREE.MathUtils.clamp((r-a)/Math.max(.0001,b-a),0,1));
    }
    return samples.at(-1)?.[1]??.15;
  };
  const columns=64,rows=4,positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const outer=radius*.916,inner=radius*.657;
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const theta=column/columns*Math.PI*2,r=THREE.MathUtils.lerp(inner,outer,row/rows);
    const y=Math.sin(theta)*r,z=Math.cos(theta)*r;
    positions.push(side*(axial(r)+.002),y,z);
    // From +X the viewer's right points towards -Z; the opposite side reverses it.
    uvs.push(.5-side*z/(outer*2),.5+y/(outer*2));
    if(row<rows&&column<columns){
      const a=row*(columns+1)+column,b=a+1,c=a+columns+1,d=c+1;
      if(side>0)indices.push(a,b,c,b,d,c);else indices.push(a,c,b,b,c,d);
    }
  }
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  result.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));result.setIndex(indices);result.computeVertexNormals();
  return result;
}

/** Original fallback and glTF internals can share geometries/materials. */
function disposeObject(root:THREE.Object3D):void{
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
  });
  for(const material of materials){
    for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
    material.dispose();
  }
  textures.forEach(texture=>texture.dispose());geometries.forEach(geometry=>geometry.dispose());
}
