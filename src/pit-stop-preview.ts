import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {FleetCar} from './fleet-car';
import {PitStopAnimation} from './pit-stop-animation';
import {PitStopAudio} from './pit-stop-audio';
import {PIT_STOP_DURATION,PIT_STOP_RACE_PHASES,toPitPoseTime} from './pit-stop-timing';
import {createPitStopStage,updatePitStopStageTeam} from './pit-stop-stage';
import {createStudioEnvironment} from './visual-finish';
import {getTeam,isTeamId,teams,type TeamId} from './team-catalog';
import './pit-stop-preview.css';

const icon=(kind:'play'|'pause'|'replay'|'arrow')=>`<svg viewBox="0 0 24 24" aria-hidden="true">${kind==='play'?'<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>':kind==='pause'?'<path d="M8 5v14M16 5v14" stroke-width="3"/>':kind==='replay'?'<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>':'<path d="m14 6-6 6 6 6M8 12h13"/>'}</svg>`;
const root=document.querySelector<HTMLDivElement>('#pit-app')!;
root.innerHTML=`<div class="pit-shell">
<header class="pit-header"><a class="pit-brand" href="./" aria-label="Pocket Paddock"><span class="pit-logo">pp</span><span><strong>Pocket Paddock</strong><small>口 袋 围 场</small></span></a><div class="pit-header-note"><i></i> PIT STOP ATELIER <span>／</span> 动作预览</div><a class="pit-back" href="./">${icon('arrow')}返回赛道</a></header>
<main class="pit-layout"><section class="pit-stage-wrap" aria-label="可旋转的三维换胎动画"><div id="pit-viewport"></div><div class="pit-stage-title"><div class="pit-eyebrow">THE ART OF A PIT STOP</div><h1>每一秒，都有配合。</h1><p>先看清动作，再决定如何驶回赛道。</p></div><div class="pit-edition"><span>ANIMATION STUDY</span><b>05</b></div><div class="pit-loader" id="pp-loader"><i></i><span id="pp-loading-text">正在准备赛车与维修组…</span></div><div class="pit-orbit-note">拖动旋转 · 滚轮缩放</div><div class="pit-camera-bar" aria-label="观察视角">${[['overview','整体'],['front','车头'],['side','侧面'],['wheel','车轮'],['top','俯视']].map(([id,label])=>`<button type="button" data-pit-camera="${id}" aria-pressed="${id==='overview'}">${label}</button>`).join('')}</div><div class="pit-phase-chip">2.6 秒 · 四轮并行</div></section>
<aside class="pit-inspector"><div class="pit-inspector-top"><div><div class="pit-eyebrow">MODEL INSPECTOR</div><h2>换胎动作审核</h2></div><span class="pit-model-badge">V5</span></div><label class="pit-select-row"><span>维修车队</span><select id="pp-team" aria-label="维修车队">${teams.map(team=>`<option value="${team.id}" ${team.id==='ferrari'?'selected':''}>${team.label} · ${team.name}</option>`).join('')}</select></label><label class="pit-select-row"><span class="pit-tire-label"><i id="pp-tire-dot"></i>换装轮胎</span><select id="pp-compound" aria-label="换装轮胎"><option value="soft">软胎 · S</option><option value="medium" selected>中胎 · M</option><option value="hard">硬胎 · H</option><option value="wet">雨胎 · W</option></select></label><ol id="pp-phases" class="pit-phase-list" aria-label="跳转动画阶段"></ol><div class="pit-current-info"><small>CURRENT ACTION</small><strong id="pp-phase">准备就绪</strong><p id="pp-detail">点击播放，观察完整的换胎配合。</p></div><p class="pit-person-note"><b>16 位维修员 · 每侧 2 拆 2 装</b><br>饱满椭圆躯干，工具与轮胎近身操作。<br>正常播放约 2.6 秒，慢放用于动作审核。</p><details class="pit-audio-credits"><summary>音效来源</summary><p>真实工具及橡胶录音剪辑拟音，非 F1 车队现场录音。</p><ul><li><a href="https://freesound.org/people/sevenbsb/sounds/349398/" target="_blank" rel="noopener">Air Impact Wrench — sevenbsb</a> · CC0</li><li><a href="https://freesound.org/people/rsellick/sounds/545547/" target="_blank" rel="noopener">metal clanks.wav — rsellick</a> · CC0</li><li><a href="https://freesound.org/people/datsinoil/sounds/689246/" target="_blank" rel="noopener">Rubber Band Thud.wav — datsinoil</a> · CC0</li></ul><p>处理：真实冲击片段交叉淡化拼接、单声道、滤除高频嘶声，保留原音高。</p></details></aside></main>
<section class="pit-transport" aria-label="动画播放控制"><div class="pit-transport-top"><button type="button" id="pp-play" class="pit-play" aria-label="播放演示" aria-pressed="false" disabled>${icon('play')}<span>播放演示</span></button><button type="button" id="pp-replay" class="pit-replay" aria-label="从头重播" title="从头重播" disabled>${icon('replay')}</button><div class="pit-transport-heading"><span>01</span><strong id="pp-transport-phase">停车确认</strong></div><div class="pit-transport-end"><span id="pp-time" class="pit-time">00.00 <small>／ 02.60s</small></span><label class="pit-loop"><input type="checkbox" id="pp-loop" checked>循环演示</label><label class="pit-rate">速度<select id="pp-rate" aria-label="播放速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option></select></label></div></div><div class="pit-audio-bar"><button type="button" id="pp-audio" class="pit-audio-toggle" aria-label="关闭换胎音效" aria-pressed="true"><span aria-hidden="true">◖♪</span><b>音效 开</b></button><label class="pit-volume">音量<input id="pp-volume" type="range" min="0" max="100" value="60" step="1" aria-label="换胎音效音量"></label><span id="pp-audio-status" role="status">点击播放，启用工具实录音效</span></div><div class="pit-timeline-wrap"><input type="range" id="pp-timeline" min="0" max="2.6" value="0" step="0.0001" aria-label="换胎动画时间轴" disabled><div class="pit-ticks">${[0,.5,1,1.5,2,2.6].map(t=>`<span style="left:${t/PIT_STOP_DURATION*100}%">${t===0?'0s':t}</span>`).join('')}</div></div></section><footer class="pit-footer"><span><kbd class="pit-key">空格</kbd>播放／暂停 <kbd class="pit-key">R</kbd>重播 · 时间轴可拖动，逐步检查车轮与工具的位置</span><span id="pp-status" class="pit-status" data-status="loading">正在准备完整赛车模型</span></footer></div>`;

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
type CameraView='overview'|'front'|'side'|'wheel'|'top';
type Compound='soft'|'medium'|'hard'|'wet';
const colors:Record<Compound,string>={soft:'#e75546',medium:'#e8c847',hard:'#e4e5d9',wet:'#5c9edf'};
const details=[
  '赛车停稳，四组人员各就各位，前后千斤顶准备抬车。',
  '前后千斤顶同步抬升，四只轮胎离开地面。',
  '风枪近身对准螺母，松开后由枪手带离轮胎抽出路线。',
  '拆胎员靠近旧轮侧面，随轮胎抽出、向外撤离回收。',
  '装胎员贴近新轮送入轮轴，装好后退让给风枪手。',
  '风枪锁紧新轮，四组作业完成后撤开工具。',
  '前后千斤顶放下赛车，轮胎重新接触地面。',
  '人员和千斤顶退出行车区域，车前固定放行灯转绿。',
];
let ready=false,playing=false,time=0,rate=1,loop=true,view:CameraView='overview',teamId:TeamId='ferrari',compound:Compound='medium';
let rig:PitStopAnimation|undefined;
const audio=new PitStopAudio();
void audio.prepare();
const scene=new THREE.Scene();scene.background=new THREE.Color('#eeeee5');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
el('pit-viewport').append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(41,1,.06,110);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=2.1;controls.maxDistance=38;controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI*.47;controls.target.set(0,.8,0);
scene.add(new THREE.HemisphereLight(0xf5f6ed,0x6a7a64,1.5));
const sun=new THREE.DirectionalLight(0xfff1d8,2.7);sun.position.set(5,11,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=11;sun.shadow.camera.bottom=-10;sun.shadow.camera.near=.5;sun.shadow.camera.far=34;sun.shadow.normalBias=.025;sun.shadow.bias=-.00012;sun.shadow.radius=3;scene.add(sun);
const rim=new THREE.DirectionalLight(0xd9e9ef,.85);rim.position.set(-7,6,-5);scene.add(rim);
scene.environment=createStudioEnvironment(renderer);
const stage=createPitStopStage();scene.add(stage);
const car=new FleetCar();car.select('ferrari',getTeam('ferrari').drivers[0]);car.group.position.y=.11;
const positions:Record<CameraView,{eye:THREE.Vector3;target:THREE.Vector3;fov:number}>={
  overview:{eye:new THREE.Vector3(8.4,6.5,9.3),target:new THREE.Vector3(0,.8,-.3),fov:38},
  front:{eye:new THREE.Vector3(0,5.4,14.7),target:new THREE.Vector3(0,.6,-.2),fov:40},
  side:{eye:new THREE.Vector3(15,5.6,1.7),target:new THREE.Vector3(0,.6,0),fov:42},
  wheel:{eye:new THREE.Vector3(5.2,2.6,5),target:new THREE.Vector3(1.3,.66,1.1),fov:38},
  top:{eye:new THREE.Vector3(0,17,.01),target:new THREE.Vector3(0,.3,0),fov:43},
};
function setView(next:CameraView){
  view=next;const preset=positions[next],factor=next==='wheel'?Math.max(1,1/camera.aspect):Math.max(1,1.2/camera.aspect);
  camera.fov=preset.fov;controls.target.copy(preset.target);camera.position.copy(preset.eye).sub(preset.target).multiplyScalar(factor).add(preset.target);
  camera.lookAt(controls.target);camera.updateProjectionMatrix();controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-pit-camera]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.pitCamera===next)));
}
function resize(){const box=el('pit-viewport').getBoundingClientRect();camera.aspect=box.width/Math.max(1,box.height);renderer.setPixelRatio(Math.min(devicePixelRatio,1.65,Math.sqrt(2200000/Math.max(1,box.width*box.height))));renderer.setSize(box.width,box.height,false);setView(view);}
new ResizeObserver(resize).observe(el('pit-viewport'));resize();
function setPlaying(value:boolean){playing=ready&&value;if(playing&&time>=PIT_STOP_DURATION)time=0;if(playing)previous=performance.now();if(playing&&audio.summary.enabled)void audio.unlock();audio.sync(time,playing,rate);el<HTMLButtonElement>('pp-play').setAttribute('aria-pressed',String(playing));el('pp-play').innerHTML=`${icon(playing?'pause':'play')}<span>${playing?'暂停演示':'播放演示'}</span>`;el('pp-play').setAttribute('aria-label',playing?'暂停演示':'播放演示');}
let audioUiKey='';
function updateAudioUi(){
  const state=audio.summary,key=`${state.status}/${state.enabled}/${state.volume}/${state.unlocked}`;if(key===audioUiKey)return;audioUiKey=key;
  const button=el<HTMLButtonElement>('pp-audio');button.setAttribute('aria-pressed',String(state.enabled));button.setAttribute('aria-label',state.enabled?'关闭换胎音效':'开启换胎音效');button.querySelector('b')!.textContent=state.enabled?'音效 开':'音效 关';
  el('pp-audio-status').textContent=!state.enabled?'音效已关闭':state.status==='error'?'音效未载入，点音效按钮可重试':state.status==='unsupported'?'当前浏览器不支持音效':state.volume===0?'音量为零':state.ready&&state.unlocked?'工具实录 · 与换胎动作同步':state.status==='loading'?'正在准备工具音效…':'点击播放，启用工具实录音效';
}
function updateUi(){
  if(!rig)return;
  const phases=PIT_STOP_RACE_PHASES,index=Math.max(0,phases.findIndex(p=>time>=p.start&&time<p.end)),phase=time>=PIT_STOP_DURATION?phases.at(-1)!:phases[index];
  el('pp-phase').textContent=phase.name;el('pp-transport-phase').textContent=phase.name;el('pp-detail').textContent=details[phases.indexOf(phase)]??details.at(-1)!;
  el('pp-time').innerHTML=`${time.toFixed(2).padStart(5,'0')} <small>／ ${PIT_STOP_DURATION.toFixed(2)}s</small>`;
  el<HTMLInputElement>('pp-timeline').value=time.toFixed(3);document.querySelector<HTMLElement>('.pit-timeline-wrap')!.style.setProperty('--pit-progress',`${time/PIT_STOP_DURATION*100}%`);
  document.querySelectorAll<HTMLButtonElement>('[data-pit-phase]').forEach(button=>{const p=phases[Number(button.dataset.pitPhase)];button.setAttribute('aria-current',p===phase?'step':'false');button.dataset.passed=String(time>=p.end);});
}
function replay(){time=0;rig?.setTime(toPitPoseTime(time));setPlaying(true);updateUi();}
el('pp-play').onclick=()=>setPlaying(!playing);el('pp-replay').onclick=replay;
el('pp-audio').onclick=()=>{if(audio.summary.status==='error'){audio.setEnabled(true);void audio.unlock();}else{audio.setEnabled(!audio.summary.enabled);if(audio.summary.enabled)void audio.unlock();}audio.sync(time,playing,rate);updateAudioUi();};
el<HTMLInputElement>('pp-volume').oninput=()=>{audio.setVolume(Number(el<HTMLInputElement>('pp-volume').value)/100);audio.sync(time,playing,rate);updateAudioUi();};
el<HTMLInputElement>('pp-timeline').oninput=()=>{setPlaying(false);time=Number(el<HTMLInputElement>('pp-timeline').value);rig?.setTime(toPitPoseTime(time));updateUi();};
el<HTMLSelectElement>('pp-rate').onchange=()=>{rate=Number(el<HTMLSelectElement>('pp-rate').value);audio.sync(time,playing,rate);};
el<HTMLInputElement>('pp-loop').onchange=()=>{loop=el<HTMLInputElement>('pp-loop').checked;};
el<HTMLSelectElement>('pp-compound').onchange=()=>{compound=el<HTMLSelectElement>('pp-compound').value as Compound;rig?.setCompound(compound);el('pp-tire-dot').style.background=colors[compound];rig?.setTime(toPitPoseTime(time));};
el<HTMLSelectElement>('pp-team').onchange=()=>{
  const value=el<HTMLSelectElement>('pp-team').value;if(!isTeamId(value))return;teamId=value;const team=getTeam(value);car.select(value,team.drivers[0]);rig?.setTeam(new THREE.Color(team.color).getHex());
  updatePitStopStageTeam(stage,team.color,team.name);rig?.setTime(toPitPoseTime(time));
};
document.querySelectorAll<HTMLButtonElement>('[data-pit-camera]').forEach(button=>button.onclick=()=>setView(button.dataset.pitCamera as CameraView));
window.addEventListener('keydown',event=>{if(['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName))return;if(event.code==='Space'){event.preventDefault();setPlaying(!playing);}if(event.code==='KeyR'&&ready)replay();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
window.addEventListener('pagehide',()=>{setPlaying(false);audio.dispose();});
const snapshot=()=>({ready,playing,time,duration:PIT_STOP_DURATION,poseTime:toPitPoseTime(time),rate,loop,view,team:teamId,compound,audio:audio.summary,rig:rig?.summary??null,car:car.summary,renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,width:renderer.domElement.width,height:renderer.domElement.height},stage:stage.userData.pitStage});
if(import.meta.env?.DEV)(window as unknown as {__PIT:unknown}).__PIT={car,audio,get rig(){return rig;},scene,camera,renderer,snapshot};
let previous=performance.now();renderer.setAnimationLoop(now=>{
  const dt=Math.max(0,(now-previous)/1000);previous=now;
  if(ready&&rig){if(playing){time+=dt*rate;if(time>PIT_STOP_DURATION){if(loop)time%=PIT_STOP_DURATION;else{time=PIT_STOP_DURATION;setPlaying(false);}}}rig.setTime(toPitPoseTime(time));updateUi();}
  audio.sync(time,playing,rate);updateAudioUi();controls.update();renderer.render(scene,camera);
});
void car.load().then(()=>{
  if(car.status!=='ready')throw new Error('完整赛车模型没有准备成功，请刷新后重试。');
  rig=new PitStopAnimation(car);rig.setCompound(compound);rig.setTeam(new THREE.Color(getTeam(teamId).color).getHex());scene.add(car.group,rig.group);
  el('pp-phases').innerHTML=PIT_STOP_RACE_PHASES.map((phase,index)=>`<li><button type="button" data-pit-phase="${index}" aria-current="${index===0?'step':'false'}"><b>${String(index+1).padStart(2,'0')}</b><span>${phase.name}</span><small>${phase.start.toFixed(2)}s</small></button></li>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-pit-phase]').forEach(button=>button.onclick=()=>{setPlaying(false);const phase=PIT_STOP_RACE_PHASES[Number(button.dataset.pitPhase)];time=(phase.start+phase.end)/2;rig!.setTime(toPitPoseTime(time));updateUi();});
  ready=true;el('pp-loader').hidden=true;el('pp-status').dataset.status='ready';el('pp-status').textContent='完整赛车模型已就绪 · 可自由观察';
  for(const id of ['pp-play','pp-replay','pp-timeline'])(el(id) as HTMLButtonElement|HTMLInputElement).disabled=false;
  rig.setTime(0);updateUi();
}).catch(error=>{el('pp-loading-text').textContent=String(error);el('pp-status').dataset.status='error';el('pp-status').textContent='模型加载失败';console.error(error);});
