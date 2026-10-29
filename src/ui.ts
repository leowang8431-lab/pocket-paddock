import {formatTime, type RaceSession} from './race';
import type {Track} from './track';
import type {VehiclePhysics} from './physics';
import {drivingAdvice} from './driving-coach';
export class UI {
  root:HTMLElement;map:HTMLCanvasElement;ctx:CanvasRenderingContext2D;toastUntil=0;
  private elements=new Map<string,HTMLElement>();
  private mapBackground?:HTMLCanvasElement;private mapTrack?:Track;
  private mapProject:(x:number,z:number)=>number[]=()=>[0,0];
  constructor(){
    this.root=document.querySelector('#app')!;
    this.root.innerHTML=`
    <div id="viewport" aria-label="3D 赛车场景"></div>
    <header class="topbar"><a class="brand" href="./" aria-label="口袋围场首页"><span class="brand-mark">pp<span>·</span></span><span>Pocket Paddock<small>口 袋 围 场</small></span></a><div class="event-label"><span class="live-dot"></span>自由计时赛 <i></i> MONZA, ITALIA <span class="italy">▮▮▮</span></div><label class="quality-control" title="自动模式会根据帧率调整画质；流畅模式优先降低渲染负担">画质<select id="quality" aria-label="画质设置"><option value="auto">自动</option><option value="performance">流畅</option><option value="balanced">均衡</option><option value="high">精细</option></select><span id="fps" aria-label="帧率">— FPS</span></label><button class="icon-button" id="sound" title="开启引擎声音" aria-label="开启引擎声音">声音 关</button></header>
    <section class="menu-copy menu-only"><div class="eyebrow"><span>01</span> THE TEMPLE OF SPEED</div><h1>小小赛车。<br><em>大大野心。</em></h1><p>把速度的殿堂，装进口袋。<br>驾驶你的方程式赛车，跑出属于你的完美一圈。</p><div class="track-pill"><span class="italy">▮▮▮</span><strong>蒙扎</strong><span>意大利 · 艺术化短赛道</span><span class="pill-arrow">↗</span></div></section>
    <section id="garage" class="garage menu-only" aria-label="赛车设置"><div class="panel-heading"><span class="eyebrow">YOUR PADDOCK</span><span class="version">性能优化 / 03</span></div><h2>准备好，出发。</h2><p class="muted">单人驾驶 · 计时挑战 · 无需下载</p><div class="field-title"><span>01</span> 选择车身配色 <strong id="livery-label">珊瑚红</strong></div><div class="liveries"><button class="swatch selected" data-livery="coral" aria-label="珊瑚红" aria-pressed="true" style="--swatch:#f0644e"><span>✓</span></button><button class="swatch" data-livery="teal" aria-label="围场青" aria-pressed="false" style="--swatch:#248b82"><span>✓</span></button><button class="swatch" data-livery="ivory" aria-label="奶油白" aria-pressed="false" style="--swatch:#e6dfcc"><span>✓</span></button><span class="livery-note">你的赛车，你的风格。</span></div><div class="field-title"><span>02</span> 选择头盔参考</div><div class="helmet-options"><button class="helmet-option selected" data-helmet="leclerc-2024" aria-pressed="true"><span class="helmet-icon red-helmet">16</span><span><strong>勒克莱尔</strong><small>2024 · 摩纳哥站</small></span><span class="radio"></span></button><button class="helmet-option" data-helmet="norris-2024" aria-pressed="false"><span class="helmet-icon yellow-helmet">4</span><span><strong>诺里斯</strong><small>2024 · 赛季头盔</small></span><span class="radio"></span></button></div><p class="reference-note">参照真实头盔配色与图案，采用 Q 版简化。</p><div class="personal-best"><span>个人最佳 <small>MONZA</small></span><strong id="menu-best">—:——.———</strong></div><button id="start" class="primary-button">驶入赛道 <span>↗</span></button><p class="start-note">弯前制动 · 稳住弯心 · 回正加速</p></section>
    <div class="world-caption menu-only"><span class="caption-dot"></span> MONZA <span>小比例，大热爱。</span></div>
    <div class="race-hud race-only"><div class="lap-block"><span class="hud-label">LAP / 圈数</span><strong id="lap">01</strong><small id="sector">检查点 1 / 24</small></div><div class="time-block"><span class="hud-label">当前圈时间</span><strong id="current-time">0:00.000</strong><small id="validity">寻找你的节奏</small></div><div class="best-block"><span class="hud-label">个人最佳</span><strong id="best-time">—:——.———</strong><small id="last-time">上一圈 —</small></div></div>
    <div class="race-actions race-only"><button id="reset" class="glass-button" title="R 重置赛车">↺ <span>回到赛道</span><kbd>R</kbd></button><button id="pause" class="glass-button" title="Esc 暂停">Ⅱ <span>暂停</span><kbd>ESC</kbd></button></div>
    <div class="map-card race-only"><div><span>MONZA</span><small id="corner-name">起终点直道</small></div><canvas id="minimap" width="360" height="290" aria-label="赛道地图与赛车位置"></canvas><span class="map-note"><b></b> 你的位置 <span>● 下一检查点</span></span></div>
    <div class="telemetry race-only"><span id="surface">● 沥青路面</span><div class="speed"><strong id="speed">0</strong><span>KM/H</span><b id="gear">N</b></div><div class="rev-bar"><i id="rev-fill"></i></div><div class="pedals"><span id="throttle-led">油门</span><span id="brake-led">制动</span><span>抓地有限</span></div><div id="grip-meter" class="grip-meter"><span>轮胎负荷</span><div><i id="grip-fill"></i></div><b id="grip-label">充足</b></div></div>
    <div id="driving-hint" class="driving-hint race-only" role="status">入弯前制动，出弯后加速</div>
    <footer class="controls"><span class="control-group"><kbd>W</kbd><kbd>↑</kbd> 油门</span><span class="control-group"><kbd>S</kbd><kbd>↓</kbd> 制动 / 倒车</span><span class="control-group"><kbd>A</kbd><kbd>D</kbd> 转向</span><span class="control-group desktop-control"><kbd>R</kbd> 重置</span><span class="footer-tag">MADE FOR THE LOVE OF RACING <span>✳</span></span></footer>
    <div id="countdown" class="countdown" aria-live="polite" hidden><div id="countdown-lights" class="countdown-lights">${Array.from({length:5},()=>'<i></i>').join('')}</div><strong id="countdown-text">准备起步</strong><span>红灯熄灭后，按 W 或 ↑ 加速</span></div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <div id="pause-modal" class="modal" hidden><section class="pause-panel"><span class="eyebrow">TAKE A BREATHER</span><h2>休息一下，再追速度。</h2><p>计时和赛车已暂停。</p><button id="resume" class="primary-button">继续驾驶 <span>→</span></button><button id="restart" class="secondary-button">重新开始计时赛</button><button id="garage-back" class="text-button">返回围场 · 调整赛车</button></section></div>
    <div class="touch-controls race-only"><div><button data-control="KeyA" aria-label="向左转">◀</button><button data-control="KeyD" aria-label="向右转">▶</button></div><div><button data-control="KeyS" aria-label="刹车">制动</button><button data-control="KeyW" aria-label="油门">油门</button></div></div>
    <div id="loading" class="loading"><span class="brand-mark">pp·</span><strong>正在布置你的围场…</strong><span>连接赛道 · 安装轮胎 · 检查发车灯</span></div>`;
    this.map=this.el<HTMLCanvasElement>('minimap');this.ctx=this.map.getContext('2d')!;
  }
  el<T extends HTMLElement=HTMLElement>(id:string){let el=this.elements.get(id);if(!el){el=document.getElementById(id)!;this.elements.set(id,el);}return el as T;}
  text(id:string,value:string){const el=this.el(id);if(el.textContent!==value)el.textContent=value;}
  toast(message:string){this.text('toast',message);this.el('toast').hidden=false;this.toastUntil=performance.now()+4000;}
  update(race:RaceSession,vehicle:VehiclePhysics,track:Track){
    if(document.body.dataset.state!==race.state)document.body.dataset.state=race.state;
    this.el('pause-modal').hidden=race.state!=='paused';
    this.el('countdown').hidden=race.state!=='countdown';
    const lightCount=Math.min(5,Math.floor(race.countdown/0.6)+1);
    this.el('countdown-lights').querySelectorAll('i').forEach((v,i)=>v.classList.toggle('on',i<lightCount));
    this.text('countdown-text',race.countdown<3?'准备起步':'盯住红灯…');
    this.text('lap',String(race.lap).padStart(2,'0'));this.text('current-time',formatTime(race.elapsed));
    this.text('best-time',formatTime(race.best));this.text('menu-best',formatTime(race.best));
    this.text('sector',`检查点 ${Math.min(race.nextCheckpoint,track.checkpoints.length)} / ${track.checkpoints.length}`);
    this.text('validity',race.valid?'有效圈 · 按顺序通过检查点':race.invalidReason==='reset'?'重置失效 · 完成此圈后重新计时':'超出赛道 · 本圈成绩无效');
    this.el('validity').classList.toggle('invalid',!race.valid);
    this.text('last-time',`上一圈 ${formatTime(race.last)}`);
    const kmh=Math.round(Math.abs(vehicle.speed)*6);this.text('speed',String(kmh));this.text('gear',vehicle.speed<-.1?'R':kmh<2?'N':String(Math.min(7,1+Math.floor(kmh/36))));
    this.el('rev-fill').style.width=`${Math.min(100,kmh/240*100)}%`;
    this.text('surface',vehicle.surface==='asphalt'?'● 沥青路面':vehicle.surface==='grass'?'● 草地 · 抓地力降低':'● 砂石 · 抓地力降低');
    this.el('surface').classList.toggle('offroad',vehicle.surface!=='asphalt');
    const distance=track.nearest(vehicle.x,vehicle.z).distance;
    const usage=vehicle.gripUsage;
    this.el('grip-fill').style.width=`${Math.min(100,usage*100)}%`;
    this.el('grip-meter').classList.toggle('saturated',vehicle.sliding);
    this.text('grip-label',vehicle.sliding?'极限':usage>.75?'接近极限':'充足');
    const advice=drivingAdvice(track,distance,vehicle);
    this.text('driving-hint',advice.text);this.el('driving-hint').dataset.level=advice.level;
    let corner='起终点直道';for(const c of track.corners)if(distance>=c.distance)corner=c.name;
    this.text('corner-name',corner);this.drawMap(track,vehicle,race);
    if(this.toastUntil&&performance.now()>this.toastUntil){this.el('toast').hidden=true;this.toastUntil=0;}
  }
  private drawMap(track:Track,vehicle:VehiclePhysics,race:RaceSession){
    const ctx=this.ctx,w=360,h=290;ctx.clearRect(0,0,w,h);
    if(this.mapTrack!==track){
      this.mapTrack=track;let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for(const s of track.samples){minX=Math.min(minX,s.point.x);maxX=Math.max(maxX,s.point.x);minZ=Math.min(minZ,s.point.z);maxZ=Math.max(maxZ,s.point.z);}
      const scale=Math.min((w-42)/(maxX-minX),(h-30)/(maxZ-minZ));
      this.mapProject=(x:number,z:number)=>[w/2+(x-(minX+maxX)/2)*scale,h/2+(z-(minZ+maxZ)/2)*scale];
      this.mapBackground=document.createElement('canvas');this.mapBackground.width=w;this.mapBackground.height=h;
      const bg=this.mapBackground.getContext('2d')!;
      bg.beginPath();track.samples.forEach((s,i)=>{const [x,y]=this.mapProject(s.point.x,s.point.z);if(i===0)bg.moveTo(x,y);else bg.lineTo(x,y);});bg.closePath();bg.strokeStyle='#c3d0c6';bg.lineWidth=8;bg.lineJoin='round';bg.stroke();bg.strokeStyle='#fffef6';bg.lineWidth=3;bg.stroke();
    }
    ctx.drawImage(this.mapBackground!,0,0);const project=this.mapProject;
    const target=track.sampleAt(track.checkpoints[race.nextCheckpoint]??0);let [cx,cy]=project(target.point.x,target.point.z);ctx.fillStyle='#d99a30';ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill();
    const [x,y]=project(vehicle.x,vehicle.z);ctx.fillStyle='#f16a4c';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
}
