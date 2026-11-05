import * as THREE from 'three';
import type {Track} from './track';
import type {QualityProfile} from './quality';
import type {WeatherMode} from './conditions';

interface SurfaceMaterial {material:THREE.MeshStandardMaterial;color:THREE.Color;roughness:number;metalness:number;environment:number}

/** Local, deterministic atmosphere. Rain uses one line buffer, one splash draw
 * and one instanced wet-film draw; no full-scene reflection pass or downloads. */
export class WeatherController {
  readonly group=new THREE.Group();
  mode:WeatherMode='sunny';
  private readonly sky:THREE.Mesh;
  private readonly skyMaterial:THREE.ShaderMaterial;
  private readonly rain:THREE.LineSegments;
  private readonly rainGeometry=new THREE.BufferGeometry();
  private readonly rainPositions=new Float32Array(1200*6);
  private readonly seeds=new Float32Array(1200*4);
  private readonly splashes:THREE.Points;
  private readonly wetFilm:THREE.InstancedMesh;
  private readonly surfaces:SurfaceMaterial[]=[];
  private rainCount=700;
  private time=0;
  private fogNear=100;
  private fogFar=265;
  private readonly fogColor=new THREE.Color();
  private readonly motion=new THREE.Vector3();

  constructor(private scene:THREE.Scene,private sun:THREE.DirectionalLight,private hemisphere:THREE.HemisphereLight,private track:Track){
    this.group.name='weather';
    this.skyMaterial=new THREE.ShaderMaterial({
      uniforms:{wet:{value:0},clock:{value:0}},side:THREE.BackSide,depthWrite:false,depthTest:false,toneMapped:false,
      vertexShader:`varying vec3 direction;void main(){direction=position;vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=clip.xyww;}`,
      fragmentShader:`varying vec3 direction;uniform float wet;uniform float clock;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
        void main(){vec3 d=normalize(direction);float h=clamp(d.y,0.,1.);
        vec3 horizon=mix(vec3(.78,.86,.91),vec3(.43,.49,.56),wet);
        vec3 zenith=mix(vec3(.20,.47,.76),vec3(.20,.26,.34),wet);
        vec3 color=mix(horizon,zenith,pow(h,.55));
        vec2 p=d.xz/max(.12,d.y+.17)*1.5+vec2(clock*.0018,0.);
        float cloud=.6*noise(p)+.27*noise(p*2.1)+.13*noise(p*4.4);
        float cover=smoothstep(mix(.51,.24,wet),mix(.79,.76,wet),cloud)*smoothstep(-.04,.21,d.y);
        color=mix(color,mix(vec3(.96,.96,.93),vec3(.54,.59,.64),wet),cover*.84);
        float sunDot=max(dot(d,normalize(vec3(-.48,.72,.36))),0.);
        color+=vec3(1.,.82,.55)*pow(sunDot,250.)*(1.-wet)*.55;
        gl_FragColor=vec4(color,1.);}`,
    });
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(700,24,12),this.skyMaterial);
    this.sky.name='monza-sky';this.sky.frustumCulled=false;this.sky.renderOrder=-1000;this.group.add(this.sky);
    let seed=718263;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<1200;i++){this.seeds[i*4]=(random()-.5)*64;this.seeds[i*4+1]=random()*25;this.seeds[i*4+2]=(random()-.5)*64;this.seeds[i*4+3]=15+random()*9;}
    this.rainGeometry.setAttribute('position',new THREE.BufferAttribute(this.rainPositions,3).setUsage(THREE.DynamicDrawUsage));
    this.rain=new THREE.LineSegments(this.rainGeometry,new THREE.LineBasicMaterial({color:0xc7d8ed,transparent:true,opacity:.43,depthWrite:false}));
    this.rain.name='rain-streaks';this.rain.frustumCulled=false;this.group.add(this.rain);
    const splashPositions=new Float32Array(180*3);
    for(let i=0;i<180;i++){splashPositions[i*3]=(random()-.5)*42;splashPositions[i*3+1]=.115;splashPositions[i*3+2]=(random()-.5)*42;}
    const splashGeometry=new THREE.BufferGeometry();splashGeometry.setAttribute('position',new THREE.BufferAttribute(splashPositions,3));
    this.splashes=new THREE.Points(splashGeometry,new THREE.PointsMaterial({color:0xbccfe1,size:.14,transparent:true,opacity:.28,depthWrite:false}));
    this.splashes.name='rain-road-splashes';this.splashes.frustumCulled=false;this.group.add(this.splashes);
    const filmMaterial=new THREE.MeshPhysicalMaterial({color:0x8394a5,roughness:.14,metalness:0,clearcoat:1,clearcoatRoughness:.1,transparent:true,opacity:.23,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
    this.wetFilm=new THREE.InstancedMesh(new THREE.CircleGeometry(1,16),filmMaterial,180);
    this.wetFilm.name='wet-asphalt-film';
    const object=new THREE.Object3D();
    for(let i=0;i<180;i++){
      const sample=track.sampleAt((i+.4)*track.length/180);
      const offset=(i%2?1:-1)*(track.id==='monaco'?track.widthAt(sample.distance)*(.18+random()*.18):4.8+random()*1.4);
      object.position.copy(sample.point).addScaledVector(sample.right,offset);object.position.y=track.heightAt(object.position.x,object.position.z)+.059;
      object.rotation.set(-Math.PI/2,0,-Math.atan2(sample.tangent.x,sample.tangent.z));
      if(track.id!=='monza')object.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(sample.right,-Math.atan(track.gradeAt(sample.distance))));
      object.scale.set(.2+random()*.65,1.3+random()*3.3,1);object.updateMatrix();this.wetFilm.setMatrixAt(i,object.matrix);
    }
    this.wetFilm.computeBoundingSphere();this.group.add(this.wetFilm);
    const visited=new Set<THREE.Material>();
    scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!(material instanceof THREE.MeshStandardMaterial)||visited.has(material))continue;
        if(!material.name.startsWith('monza-asphalt')&&material.userData.weatherSurface!=='road')continue;
        visited.add(material);this.surfaces.push({material,color:material.color.clone(),roughness:material.roughness,metalness:material.metalness,environment:material.envMapIntensity});
      }
    });
    scene.add(this.group);this.setMode('sunny');
  }

  get summary(){return{mode:this.mode,rainParticles:this.mode==='rainy'?this.rainCount:0,wetSurfaces:this.surfaces.length,elapsed:this.time};}
  setQuality(profile:QualityProfile){
    this.rainCount=profile.level==='performance'?320:profile.level==='balanced'?650:1100;
    this.rainGeometry.setDrawRange(0,this.rainCount*2);const scale=this.track.id!=='monza'?1.8:1;this.fogNear=profile.fogNear*scale;this.fogFar=profile.fogFar*scale;this.applyFog();
  }
  setMode(mode:WeatherMode){
    this.mode=mode;const wet=mode==='rainy';
    this.skyMaterial.uniforms.wet.value=wet?1:0;
    this.rain.visible=this.splashes.visible=this.wetFilm.visible=wet;
    this.sun.color.set(wet?0xd7e4f2:0xfff0d7);this.sun.intensity=wet?1.0:3.0;
    this.hemisphere.color.set(wet?0xcbd7e4:0xeaf3ff);this.hemisphere.groundColor.set(wet?0x58645d:0x74876d);this.hemisphere.intensity=wet?1.85:2.1;
    this.scene.environmentIntensity=wet?.32:.48;
    for(const surface of this.surfaces){
      surface.material.color.copy(surface.color).multiplyScalar(wet?.63:1);
      surface.material.roughness=wet?.22:surface.roughness;surface.material.metalness=wet?.08:surface.metalness;
      surface.material.envMapIntensity=wet?.72:surface.environment;
    }
    this.applyFog();
  }
  private applyFog(){
    const wet=this.mode==='rainy';this.fogColor.set(wet?0x8996a4:0xc5d7df);
    this.scene.background=this.fogColor.clone();
    if(!(this.scene.fog instanceof THREE.Fog))this.scene.fog=new THREE.Fog(this.fogColor,1,2);
    this.scene.fog.color.copy(this.fogColor);this.scene.fog.near=this.fogNear*(wet?.64:1);this.scene.fog.far=this.fogFar*(wet?.8:1);
  }
  update(dt:number,camera:THREE.Camera,position:THREE.Vector3,speed:number,heading:number){
    this.sky.position.copy(camera.position);
    if(this.mode!=='rainy')return;
    this.time+=dt;this.skyMaterial.uniforms.clock.value=this.time;
    this.motion.set(Math.sin(heading),0,Math.cos(heading));
    this.rain.position.copy(position);this.rain.position.y=this.track.id!=='monza'?position.y-.11:0;
    this.splashes.position.set(position.x,0,position.z);
    if(this.track.id!=='monza'){const p=this.splashes.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,this.track.heightAt(position.x+p.getX(i),position.z+p.getZ(i))+.115);p.needsUpdate=true;}
    for(let i=0;i<this.rainCount;i++){
      const k=i*4,j=i*6,fall=this.seeds[k+3];
      const y=((this.seeds[k+1]-this.time*fall)%25+25)%25;
      const x=this.seeds[k]+Math.sin(this.time*.35+i)*.18,z=this.seeds[k+2];
      this.rainPositions[j]=x;this.rainPositions[j+1]=y;this.rainPositions[j+2]=z;
      this.rainPositions[j+3]=x+.17+this.motion.x*Math.abs(speed)*.014;this.rainPositions[j+4]=y-.6;this.rainPositions[j+5]=z+.11+this.motion.z*Math.abs(speed)*.014;
    }
    this.rainGeometry.attributes.position.needsUpdate=true;
    (this.splashes.material as THREE.PointsMaterial).opacity=.17+Math.sin(this.time*13)*.07;
  }
}
