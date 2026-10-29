import './style.css';
import * as THREE from 'three';
import {Track} from './track';
import {createScenery} from './scenery';
import {Car,type HelmetId,type Livery} from './car';
import {VehiclePhysics} from './physics';
import {RaceSession,formatTime} from './race';
import {Input} from './input';
import {ChaseCamera} from './camera';
import {UI} from './ui';
import {EngineAudio} from './audio';
import {SkidMarks} from './skid-marks';
import type {StandLayout} from './stand-layout';
import {AdaptiveQuality,isQualityMode,qualityPixelRatio,type QualityMode} from './quality';

const ui=new UI();document.body.dataset.state='menu';
function boot(){
  const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  ui.el('viewport').appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c7dbca');scene.fog=new THREE.Fog('#c7dbca',130,430);
  const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,1000);
  scene.add(new THREE.HemisphereLight(0xfffae4,0x719b7f,2.6));
  const sun=new THREE.DirectionalLight(0xfff0d1,3.5);sun.castShadow=false;sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-55;sun.shadow.camera.right=55;sun.shadow.camera.top=55;sun.shadow.camera.bottom=-55;sun.shadow.camera.near=1;sun.shadow.camera.far=200;
  sun.shadow.normalBias=.04;sun.shadow.bias=-.0002;sun.shadow.radius=3;scene.add(sun,sun.target);
  const track=new Track(),scenery=createScenery(track);scene.add(track.group,scenery);
  const skidMarks=new SkidMarks();scene.add(skidMarks.mesh);
  const car=new Car('coral','leclerc-2024');scene.add(car.group);
  const vehicle=new VehiclePhysics();
  let storage:Storage|undefined;try{storage=localStorage;}catch{/* Game remains playable in private storage contexts. */}
  let renderDirty=true;
  let savedQuality:QualityMode='auto';try{const saved=storage?.getItem('pocket-paddock.graphics');if(isQualityMode(saved))savedQuality=saved;}catch{}
  const gl=renderer.getContext(),debugRenderer=gl.getExtension('WEBGL_debug_renderer_info');
  const software=debugRenderer?/swiftshader|llvmpipe|software|microsoft basic/i.test(String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL))):false;
  const sceneryLods:{lod:THREE.LOD;distances:number[]}[]=[];
  scenery.traverse(object=>{if(object instanceof THREE.LOD)sceneryLods.push({lod:object,distances:object.levels.map(l=>l.distance)});});
  const applyQuality=()=>{
    const p=quality.profile;
    renderer.setPixelRatio(qualityPixelRatio(innerWidth,innerHeight,devicePixelRatio,p,quality.resolutionScale));renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=p.shadows;sun.castShadow=p.shadows;
    camera.far=p.far;camera.updateProjectionMatrix();
    if(scene.fog instanceof THREE.Fog){scene.fog.near=p.fogNear;scene.fog.far=p.fogFar;}
    for(const {lod,distances} of sceneryLods)lod.levels.forEach((level,i)=>{level.distance=distances[i]*p.sceneryDistance/215;});
    document.body.dataset.quality=p.level;renderDirty=true;
  };
  const quality=new AdaptiveQuality(savedQuality,software,applyQuality);applyQuality();
  const qualitySelect=ui.el<HTMLSelectElement>('quality');qualitySelect.value=savedQuality;
  const setQuality=(mode:QualityMode)=>{quality.setMode(mode);qualitySelect.value=mode;try{storage?.setItem('pocket-paddock.graphics',mode);}catch{}};
  qualitySelect.onchange=()=>{if(isQualityMode(qualitySelect.value))setQuality(qualitySelect.value);qualitySelect.blur();};
  const race=new RaceSession(track,storage),chase=new ChaseCamera(camera),audio=new EngineAudio();
  let collisionCooldown=0,shownResult=0,lastUI=0,lastState=race.state;
  const startLights:THREE.Mesh[]=[];scene.traverse(o=>{if(o.name.startsWith('start-light-'))startLights.push(o as THREE.Mesh);});
  function place(distance=0){const sample=track.sampleAt(distance);vehicle.reset(sample.point.x,sample.point.z,Math.atan2(sample.tangent.x,sample.tangent.z));chase.snap();renderDirty=true;}
  function start(){input.clear();place();race.start();skidMarks.clear();shownResult=0;ui.toast('准备起步 · 弯前先刹车，回正再全油门');}
  function togglePause(){input.clear();if(race.state==='paused')race.resume();else race.pause();renderDirty=true;}
  function reset(){if(race.state!=='racing'&&race.state!=='paused')return;const d=track.nearest(vehicle.x,vehicle.z).distance;const cp=track.checkpoints[Math.max(0,race.nextCheckpoint-1)];const safe=Math.min(d,cp+2);place(safe);race.resetPosition(safe);input.clear();ui.toast('已回到上个检查点附近 · 本圈成绩无效');}
  const input=new Input(code=>{if(code==='Escape'||code==='KeyP')togglePause();if(code==='KeyR')reset();if(code==='Enter'&&race.state==='menu')start();});
  ui.el('start').onclick=start;ui.el('pause').onclick=togglePause;ui.el('resume').onclick=togglePause;ui.el('reset').onclick=reset;ui.el('restart').onclick=start;
  ui.el('garage-back').onclick=()=>{race.state='menu';input.clear();place();};
  ui.el('sound').onclick=async()=>{const enabled=await audio.toggle();ui.text('sound',enabled?'声音 开':'声音 关');ui.el('sound').setAttribute('aria-label',enabled?'关闭引擎声音':'开启引擎声音');};
  document.querySelectorAll<HTMLButtonElement>('[data-livery]').forEach(button=>button.onclick=()=>{
    car.setLivery(button.dataset.livery as Livery);renderDirty=true;document.querySelectorAll('[data-livery]').forEach(b=>{const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});ui.text('livery-label',button.getAttribute('aria-label')!);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-helmet]').forEach(button=>button.onclick=()=>{
    car.setHelmet(button.dataset.helmet as HelmetId);renderDirty=true;document.querySelectorAll('[data-helmet]').forEach(b=>{const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){race.pause();input.clear();}});
  window.addEventListener('blur',()=>race.pause());
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;applyQuality();});
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(3.1,5.2),new THREE.MeshBasicMaterial({map:contactShadow(),transparent:true,depthWrite:false,opacity:.42}));contact.rotation.x=-Math.PI/2;scene.add(contact);
  const targetGate=new THREE.Group();scene.add(targetGate);const gateMat=new THREE.MeshBasicMaterial({color:0xf0ca66,transparent:true,opacity:.6,depthWrite:false});
  for(const sign of [-1,1]){const p=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,3,6),gateMat);p.position.set(sign*7,1.5,0);targetGate.add(p);const top=new THREE.Mesh(new THREE.OctahedronGeometry(.5),gateMat);top.position.set(sign*7,3.4,0);targetGate.add(top);}
  place();ui.el('loading').hidden=true;
  let previous=performance.now(),accumulator=0;const fixed=1/120;
  let simulationMs=0,renderMs=0,lastCheckpoint=-1,appliedLightCount=-1,lastPerformanceUI=0;
  const snapshot=()=>({state:race.state,speed:vehicle.speed,x:vehicle.x,z:vehicle.z,heading:vehicle.heading,steering:vehicle.steering,surface:vehicle.surface,elapsed:race.elapsed,lap:race.lap,valid:race.valid,best:race.best,completed:race.completed,nextCheckpoint:race.nextCheckpoint,checkpointCount:track.checkpoints.length,distance:track.nearest(vehicle.x,vehicle.z).distance,trackLength:track.length,collision:vehicle.collision,gripUsage:vehicle.gripUsage,sliding:vehicle.sliding,lateralSpeed:vehicle.lateralSpeed,yawRate:vehicle.yawRate,quality:quality.summary,performance:{simulationMs,renderMs},renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),width:renderer.domElement.width,height:renderer.domElement.height}});
  let overview:string|null=null;
  if(import.meta.env.DEV){
    const stands=scenery.userData.stands as StandLayout[];
    const setOverview=(id:string|null)=>{
      overview=id;scene.fog=id?null:new THREE.Fog('#c7dbca',quality.profile.fogNear,quality.profile.fogFar);renderDirty=true;
      if(!id){applyQuality();chase.snap();return;}
      const stand=stands.find(s=>s.id===id);
      const center=stand?new THREE.Vector3((stand.x+stand.target.x)/2,0,(stand.z+stand.target.z)/2):new THREE.Vector3(70,0,-65);
      camera.far=1600;camera.fov=45;camera.position.copy(center).add(new THREE.Vector3(0,stand?165:850,.01));camera.lookAt(center);camera.updateProjectionMatrix();
    };
    (window as unknown as {__PP:unknown}).__PP={snapshot,track,race,vehicle,stands,setOverview,setQuality,get quality(){return quality.summary;}};
  }
  function frame(now:number){
    requestAnimationFrame(frame);const frameMs=now-previous,dt=Math.min(frameMs/1000,.08);previous=now;
    const active=race.state==='racing'||race.state==='countdown';quality.observe(frameMs,active&&!document.hidden);
    const simulationStart=performance.now();
    if(active){
      accumulator+=dt;
      while(accumulator>=fixed){
        if(race.state==='racing')vehicle.update(fixed,input.controls,track);
        const sample=track.nearest(vehicle.x,vehicle.z);
        const lateral=Math.hypot(vehicle.x-sample.point.x,vehicle.z-sample.point.z);
        race.update(fixed,sample.distance,lateral,Math.sin(vehicle.heading)*sample.tangent.x+Math.cos(vehicle.heading)*sample.tangent.z);
        accumulator-=fixed;
      }
    }else accumulator=0;
    simulationMs=performance.now()-simulationStart;
    if(lastState!==race.state)renderDirty=true;
    if(lastState==='countdown'&&race.state==='racing')ui.toast('GO! · 开始你的第一圈');lastState=race.state;
    if(race.completed>shownResult){shownResult=race.completed;const r=race.result!;ui.toast(r.valid?`${r.best?'刷新个人最佳！':'完成有效圈'} ${formatTime(r.time)}`:'已完成无效圈 · 新一圈开始，继续挑战');}
    collisionCooldown=Math.max(0,collisionCooldown-dt);
    if(vehicle.collision>.9&&collisionCooldown<=0){collisionCooldown=3;ui.toast('碰到护栏 · 减速后调整方向，或按 R 回到赛道');}
    audio.update(vehicle.speed,race.state==='racing',input.controls.throttle);
    if(now-lastUI>(active?100:250)){ui.update(race,vehicle,track);ui.el('throttle-led').classList.toggle('active',input.controls.throttle);ui.el('brake-led').classList.toggle('active',input.controls.brake);lastUI=now;}
    if(now-lastPerformanceUI>700){ui.text('fps',active&&quality.fps?`${quality.fps} FPS`:'— FPS');ui.el('fps').title=`${quality.profile.label} · ${renderer.domElement.width} × ${renderer.domElement.height}`;lastPerformanceUI=now;}
    // The garage and paused frame are static. Settings/resize mark them dirty.
    if(!active&&!renderDirty&&!overview)return;
    car.group.position.set(vehicle.x,.11,vehicle.z);car.group.rotation.y=vehicle.heading;
    car.update(race.state==='racing'?vehicle.speed:0,vehicle.steering,dt);
    const bodyRoll=race.state==='racing'?-vehicle.steering*Math.min(Math.abs(vehicle.speed)/40,1)*.035:0;
    car.group.rotation.z=THREE.MathUtils.lerp(car.group.rotation.z,bodyRoll,dt*7);
    contact.position.set(vehicle.x,.104,vehicle.z);contact.rotation.z=-vehicle.heading;
    if(!overview)chase.update(car.group.position,vehicle.heading,vehicle.speed,dt,race.state==='menu');
    skidMarks.update(vehicle,dt,race.state==='racing');
    if(vehicle.collision>.1&&race.state==='racing')camera.position.x+=Math.sin(now*.08)*vehicle.collision*.07;
    sun.target.position.set(vehicle.x,0,vehicle.z);sun.position.set(vehicle.x-35,65,vehicle.z+25);sun.target.updateMatrixWorld();
    if(lastCheckpoint!==race.nextCheckpoint){const target=track.sampleAt(track.checkpoints[race.nextCheckpoint]??0);targetGate.position.copy(target.point);targetGate.rotation.y=Math.atan2(target.tangent.x,target.tangent.z);lastCheckpoint=race.nextCheckpoint;}
    targetGate.visible=race.state==='racing';
    const lightCount=race.state==='countdown'?Math.min(5,Math.floor(race.countdown/.6)+1):0;
    if(appliedLightCount!==lightCount){startLights.forEach(mesh=>{const i=Number(mesh.name.split('-').at(-1));const m=mesh.material as THREE.MeshStandardMaterial;m.color.set(i<lightCount?0xff3025:0x402f2c);m.emissive?.set(i<lightCount?0xed2115:0x000000);});appliedLightCount=lightCount;}
    const renderStart=performance.now();renderer.render(scene,camera);renderMs=performance.now()-renderStart;renderDirty=false;
  }
  requestAnimationFrame(frame);
}
function contactShadow(){const c=document.createElement('canvas');c.width=128;c.height=128;const ctx=c.getContext('2d')!;const gradient=ctx.createRadialGradient(64,64,12,64,64,64);gradient.addColorStop(0,'rgba(13,38,31,.8)');gradient.addColorStop(1,'rgba(13,38,31,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
try{boot();}catch(error){console.error(error);ui.el('loading').hidden=true;const box=document.createElement('section');box.className='error-box';const h=document.createElement('h2');h.textContent='围场暂时无法载入';const p=document.createElement('p');p.textContent='请使用支持 WebGL 的现代浏览器，并开启硬件加速。详细错误：'+String(error);const button=document.createElement('button');button.textContent='重新载入';button.onclick=()=>location.reload();box.append(h,p,button);ui.root.append(box);}
