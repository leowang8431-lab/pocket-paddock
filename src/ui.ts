import './pit-service.css';
import type {PitCompound} from './pit-stop-animation';
import {CIRCUITS,type CircuitId} from './circuits';
import {formatTime, type RaceSession} from './race';
import type {Track} from './track';
import type {VehiclePhysics} from './physics';
import {drivingAdvice} from './driving-coach';
import {gearLabel,REDLINE_RPM,type PowertrainState} from './powertrain';
import type {CameraMode,MenuView} from './camera-profiles';
import {teams, getTeam, getDriver, DEFAULT_TEAM, DEFAULT_DRIVER, type TeamId, type DriverId} from './team-catalog';
import {t,isLanguage,translations,localizedCorner,type Language,type TranslationKey,type TranslationParams} from './i18n';
export interface DrsDisplay {state:'outside'|'ready'|'active'|'wet'|'slow'|'braking'|'offtrack'|'closed';zone:number|null;distanceToZone:number;active:boolean;available:boolean}
export interface PitDisplay {
  state:'idle'|'approach'|'service'|'exit';active:boolean;controlled:boolean;limited:boolean;serviceElapsed:number;serviceDuration:number;
  team:TeamId;compound:PitCompound;currentCompound:PitCompound;completedStops:number;
}
const pitLetters:Record<PitCompound,string>={soft:'S',medium:'M',hard:'H',wet:'W'};
const pitColors:Record<PitCompound,string>={soft:'#e8604a',medium:'#e2bd3c',hard:'#e5e6dc',wet:'#609bdb'};
export interface CompetitionDisplay {
  enabled:boolean;lap:number;totalLaps:number;position:number;total:number;elapsed:number;finished:boolean;
  rows:{id:string;name:string;position:number;color:string;player:boolean;finished:boolean;/** Optional time gap in seconds. */gap?:number}[];
}
const teamCodes:Record<TeamId,string>={mclaren:'MCL',ferrari:'FER',redbull:'RBR',mercedes:'MER',aston:'AMR',alpine:'ALP',williams:'WIL',haas:'HAA',racingbulls:'VCB',audi:'AUD',cadillac:'CAD'};
// UI swatches sampled from the supplied GLB palettes, with no extra download.
const helmetSwatches:Record<DriverId,string[]>={
  lando_norris_04:['#ff8000','#0057b8','#ffffff'],oscar_piastri_81:['#ffffff','#ff8000','#0057b8'],
  charles_leclerc_16:['#dc0000','#ffffff','#1a1a1a'],lewis_hamilton_44:['#6a1b9a','#ffd400','#1a1a1a'],
  max_verstappen_01:['#ff6b00','#e10600','#ffffff'],isack_hadjar_06:['#0b3c8c','#ffffff','#e10600'],
  george_russell_63:['#0033a0','#ffffff','#00d2be'],kimi_antonelli_12:['#ffffff','#0057b8','#e10600'],
  fernando_alonso_14:['#0057b8','#ffd400','#ffffff'],lance_stroll_18:['#00594f','#ffffff','#cedc00'],
  pierre_gasly_10:['#0055a4','#ffffff','#e10600'],franco_colapinto_43:['#6cace4','#ffffff','#ffd700'],
  alex_albon_23:['#0b1f3a','#ffffff','#e10600'],carlos_sainz_55:['#c8102e','#ffd400','#0057b8'],
  esteban_ocon_31:['#0055a4','#ffffff','#1a1a1a'],oliver_bearman_87:['#dc0000','#ffffff','#1a1a1a'],
  liam_lawson_30:['#121f45','#ffffff','#e4002b'],arvid_lindblad_41:['#0057b8','#ffd400','#ffffff'],
  nico_hulkenberg_27:['#ffffff','#00a19a','#1a1a1a'],gabriel_bortoleto_05:['#009c3b','#ffdf00','#ffffff'],
  sergio_perez_11:['#006847','#ffffff','#c8102e'],valtteri_bottas_77:['#0057b8','#ffffff','#1a1a1a'],
};
export class UI {
  root:HTMLElement;map:HTMLCanvasElement;ctx:CanvasRenderingContext2D;toastUntil=0;
  private elements=new Map<string,HTMLElement>();
  private mapBackground?:HTMLCanvasElement;private mapTrack?:Track;
  private mapProject:(x:number,z:number)=>number[]=()=>[0,0];
  private displayedTeam?:TeamId;
  language:Language='zh';
  private circuitId:CircuitId='monza';
  private selectedTeam:TeamId=DEFAULT_TEAM;private selectedDriver:DriverId=DEFAULT_DRIVER;
  private weather:'sunny'|'rainy'='sunny';private soundEnabled=false;
  private modelState:'loading'|'ready'|'fallback'='loading';
  private context?:{race:RaceSession;vehicle:VehiclePhysics;track:Track};
  private localizedNodes:{node:Text;key:TranslationKey;prefix:string;suffix:string}[]=[];
  private localizedAttributes:{element:Element;attribute:string;key:TranslationKey}[]=[];
  private toastEntry?:{key:TranslationKey;params:TranslationParams};
  private drs:DrsDisplay={state:'outside',zone:null,distanceToZone:0,active:false,available:false};
  private gamepad={connected:false,name:'',supported:true};
  private competition:CompetitionDisplay={enabled:false,lap:1,totalLaps:3,position:1,total:6,elapsed:0,finished:false,rows:[]};
  private competitionListSignature='';
  private pit:PitDisplay={state:'idle',active:false,controlled:false,limited:false,serviceElapsed:0,serviceDuration:0,team:DEFAULT_TEAM,compound:'medium',currentCompound:'medium',completedStops:0};
  constructor(){
    this.root=document.querySelector('#app')!;
    this.root.innerHTML=`
    <div id="viewport" aria-label="3D 赛车场景"></div>
    <header class="topbar"><a class="brand" href="./" aria-label="口袋围场首页"><span class="brand-mark">pp<span>·</span></span><span>Pocket Paddock<small>口 袋 围 场</small></span></a><div class="event-label"><span class="live-dot"></span><span id="event-title">自由计时赛</span> <i></i><span id="circuit-title">MONZA, ITALIA</span> <span class="italy">▮▮▮</span></div><label class="quality-control" title="自动模式会根据帧率调整画质；流畅模式优先降低渲染负担">画质<select id="quality" aria-label="画质设置"><option value="auto">自动</option><option value="performance">流畅</option><option value="balanced">均衡</option><option value="high">精细</option></select><span id="fps" aria-label="帧率">— FPS</span></label><button class="icon-button" id="sound" title="开启游戏声音" aria-label="开启游戏声音">声音 关</button></header>
    <section class="menu-copy menu-only"><div class="eyebrow"><span>13</span> <b id="circuit-kicker">THE TEMPLE OF SPEED</b></div><h1>下一圈，<br><em>由你领跑。</em></h1><p>选一支车队，找到你的节奏。<br>在蒙扎，把每一个弯变成优势。</p><div class="hero-features"><span>晴雨切换</span><span>键盘 / 手柄</span><span>单人 / 人机</span></div><div class="track-pill"><span class="italy">▮▮▮</span><strong>蒙扎</strong><span>意大利 · 艺术化短赛道</span><span class="pill-arrow">↗</span></div></section>
    <section class="car-showcase menu-only" aria-label="赛车展示"><div class="showcase-title"><span class="showcase-number" id="showcase-number">16</span><div><span class="eyebrow">YOUR CONTENDER</span><strong id="showcase-team">Ferrari</strong><small id="showcase-driver">Charles Leclerc</small></div></div><div class="showcase-views" role="group" aria-label="展示角度"><button data-menu-view="front" aria-pressed="true">前侧</button><button data-menu-view="side" aria-pressed="false">侧面</button><button data-menu-view="rear" aria-pressed="false">车尾</button></div><p class="showcase-note">挑选车手，查看车身与头盔细节</p></section>
    <section id="garage" class="garage menu-only team-garage" aria-label="车队与车手设置">
      <div class="garage-header"><div class="panel-heading"><span class="eyebrow">YOUR PADDOCK</span><span class="version">围场车库 / 13</span></div>
      <h2>准备你的发车阵容。</h2><p class="muted">11 支车队 · 22 位车手</p><div class="race-mode-setting"><label for="race-mode">比赛模式</label><select id="race-mode" aria-label="比赛模式"><option value="time-trial">单人计时挑战</option><option value="race">人机竞速 · 3 圈 · 5 AI</option></select><small id="race-mode-note">独自练习走线 · 挑战个人最佳</small></div><div class="camera-setting circuit-setting"><label id="circuit-select-label" for="circuit">赛道</label><select id="circuit" aria-label="赛道选择">${Object.entries(CIRCUITS).map(([id,item])=>`<option value="${id}">${item.zh} · ${item.countryZh}</option>`).join('')}</select></div><div class="camera-setting"><label for="camera-mode">驾驶视角</label><select id="camera-mode" aria-label="驾驶视角"><option value="close">近距</option><option value="standard" selected>标准</option><option value="far">远距</option></select><span>C / R3</span></div></div>
      <div class="garage-scroll">
        <div class="team-grid-heading"><label class="field-title" for="team-select"><span>01</span> 选择车队</label><div class="team-select-wrap"><select id="team-select" aria-label="选择车队">${teams.map(team=>`<option value="${team.id}">${team.label} · ${team.name}</option>`).join('')}</select></div></div>
        <div class="team-grid" id="team-grid" role="group" aria-label="车队阵容">${teams.map(team=>`<button class="team-card" data-team="${team.id}" aria-pressed="false" style="--team-color:${team.color}"><span class="team-code">${teamCodes[team.id]}</span><span class="team-card-name">${team.label}</span><span class="team-check" aria-hidden="true">✓</span></button>`).join('')}</div>
        <div class="field-title driver-heading"><span>02</span> 选择车手 <strong id="team-label">Ferrari</strong><b id="driver-label">#16</b></div>
        <div id="driver-options" class="driver-options" role="group" aria-label="车手与头盔选择"></div>
        <p class="garage-equality">相同车辆性能 · 选择你的风格</p>
        <p class="reference-note">用户提供的风格化模型 · 年份未标注</p>
        <details class="controller-help"><summary>手柄与驾驶操作</summary><p>连接手柄后，请先按任意按钮唤醒</p><p>左摇杆转向 · RT 油门 · LT 制动 · X / □ DRS · Y / △ 重置 · Menu 暂停 · R3 视角</p><p>围场：← / → 选车队，↑ / ↓ 选车手，A / × 出发；暂停时 A / × 继续、B / ○ 返回车库。</p></details>
      </div>
      <div class="garage-launch"><div class="personal-best"><span>个人最佳 <small data-circuit-code>MONZA</small></span><strong id="menu-best">—:——.———</strong></div>
      <div class="garage-status-row"><p id="model-status" class="model-status" data-status="loading" role="status" aria-live="polite">正在加载赛车与头盔…</p><p id="gamepad-status" class="gamepad-status" role="status"></p></div>
      <button id="start" class="primary-button" disabled>驶入赛道 <span>↗</span></button><p class="start-note">弯前制动 · 稳住弯心 · 回正加速</p></div>
    </section>
    <div class="world-caption menu-only"><span class="caption-dot"></span><b data-circuit-code>MONZA</b> <span>小比例，大热爱。</span></div>
    <div class="race-hud race-only"><div class="lap-block"><span class="hud-label">LAP / 圈数</span><strong id="lap">01</strong><small id="sector">检查点 1 / 24</small></div><div class="time-block"><span class="hud-label">当前圈时间</span><strong id="current-time">0:00.000</strong><small id="validity">寻找你的节奏</small></div><div class="best-block"><span class="hud-label">个人最佳</span><strong id="best-time">—:——.———</strong><small id="last-time">上一圈 —</small></div></div>
    <div class="race-actions race-only"><button id="reset" class="glass-button" title="R 重置赛车">↺ <span>回到赛道</span><kbd>R</kbd></button><button id="pause" class="glass-button" title="Esc 暂停">Ⅱ <span>暂停</span><kbd>ESC</kbd></button><button id="camera-cycle" class="glass-button" type="button" title="C 切换视角">◉ <span id="camera-label">标准视角</span><kbd>C</kbd></button></div>
    <div class="map-card race-only"><div><span data-circuit-code>MONZA</span><small id="corner-name">起终点直道</small></div><span id="race-driver" class="race-driver">#16 勒克莱尔 · 法拉利</span><canvas id="minimap" width="360" height="290" aria-label="赛道地图与赛车位置"></canvas><span class="map-note"><b></b> 你的位置 <span>● 下一检查点</span></span></div>
    <div class="telemetry race-only"><span id="surface">● 沥青路面</span><div class="speed"><strong id="speed">0</strong><span>KM/H</span><b id="gear">N</b></div><div class="engine-readout"><span id="rpm-value">3,300 RPM</span><small id="shift-state"></small></div><div class="rev-bar"><i id="rev-fill"></i></div><div class="pedals"><span id="throttle-led">油门</span><span id="brake-led">制动</span><span>抓地有限</span></div><div id="grip-meter" class="grip-meter"><span>轮胎负荷</span><div><i id="grip-fill"></i></div><b id="grip-label">充足</b></div></div>
    <div class="drs-card race-only"><button id="drs-toggle" type="button" aria-label="切换 DRS 后翼" aria-pressed="false" disabled><span class="drs-wordmark">DRS <i aria-hidden="true">↗</i></span><kbd>F</kbd></button><div class="drs-copy"><strong id="drs-status" role="status">等待开放区</strong><span id="drs-zone"></span></div></div>
    <div id="driving-hint" class="driving-hint race-only" role="status">入弯前制动，出弯后加速</div>
    <section id="pit-panel" class="pit-service-panel" aria-label="维修区与轮胎" data-state="idle"><div class="pit-service-heading"><div><span class="pit-eyebrow">PIT LANE</span><strong id="pit-status" role="status">手动驾驶</strong></div><span id="pit-limit" class="pit-speed-limit" aria-label="维修区限速120公里每小时"><b>120</b><small>KM/H</small></span></div><div class="pit-tyre-setting"><span class="pit-current"><small id="pit-current-label">当前轮胎</small><b id="pit-current-compound">M</b></span><label id="pit-compound-label" for="pit-compound">下一套</label><select id="pit-compound" aria-label="下一套轮胎"><option value="soft">软胎 · S</option><option value="medium" selected>中性胎 · M</option><option value="hard">硬胎 · H</option><option value="wet">雨胎 · W</option></select></div><div id="pit-service-timer" class="pit-service-timer" hidden><div><span id="pit-time-label">换胎剩余</span><strong id="pit-remaining">—</strong><small id="pit-service-duration"></small></div><div id="pit-progress-track" class="pit-progress-track" role="progressbar" aria-label="换胎进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="pit-progress"></i></div></div><p id="pit-description">驶入维修区，系统自动接管</p><div class="pit-service-foot"><span id="pit-team">Ferrari</span><small id="pit-stop-count"></small></div></section>
    <aside id="competition-leaderboard" class="competition-leaderboard" aria-label="实时比赛排名" hidden><div class="competition-board-heading"><span id="competition-position-label">场上名次</span><strong id="race-position">P01 <small>/ 6</small></strong></div><ol id="competition-rows"></ol></aside>
    <div id="competition-result" class="competition-result" hidden><section class="competition-result-panel" role="dialog" aria-modal="true" aria-labelledby="competition-title"><div class="finish-chequer" aria-hidden="true"></div><span class="eyebrow">CHEQUERED FLAG</span><h2 id="competition-title">冲线完成！</h2><p id="competition-summary"></p><div class="competition-result-stats"><div><span id="competition-result-position-label">完赛名次</span><strong id="competition-result-position">P01</strong></div><div><span id="competition-result-time-label">比赛总用时</span><strong id="competition-result-time">0:00.000</strong></div></div><ol id="competition-result-rows" class="competition-result-rows"></ol><p id="competition-classification-note" class="competition-classification-note">冲线时排名 · 未完赛车按赛道进度排序</p><p id="competition-record-note" class="competition-record-note">竞速圈速不计入计时榜</p><button id="competition-restart" class="primary-button" type="button">再比一场 <span>↗</span></button><button id="competition-garage" class="secondary-button" type="button">返回围场</button></section></div>
    <footer class="controls"><span class="control-group"><kbd>W</kbd><kbd>↑</kbd> 油门</span><span class="control-group"><kbd>S</kbd><kbd>↓</kbd> 制动 / 倒车</span><span class="control-group"><kbd>A</kbd><kbd>D</kbd> 转向</span><span class="control-group desktop-control"><kbd>R</kbd> 重置</span><span class="control-group drs-control"><kbd>F</kbd> DRS</span><span class="control-group desktop-control"><kbd>C</kbd> 视角</span><span class="footer-tag">MADE FOR THE LOVE OF RACING <span>✳</span></span></footer>
    <div id="countdown" class="countdown" aria-live="polite" hidden><div id="countdown-lights" class="countdown-lights">${Array.from({length:5},()=>'<i></i>').join('')}</div><strong id="countdown-text">准备起步</strong><span>红灯熄灭后，按 W 或 ↑ 加速</span></div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <div id="diagnostics-modal" class="diagnostics-modal" hidden><section class="diagnostics-panel" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title"><div class="diagnostics-heading"><h2 id="diagnostics-title">本机性能信息</h2><button id="diagnostics-close" type="button">关闭</button></div><p class="diagnostics-explanation">3D 画面在访问者的设备上渲染，网速主要影响加载。持续低帧率时，请先选择自动或流畅画质，并检查浏览器硬件加速。</p><pre id="diagnostics-report" tabindex="0" aria-label="本机诊断报告"></pre><p class="diagnostics-privacy">诊断仅在本机生成，不会自动上传。关闭后保持当前暂停状态，可自行继续驾驶。</p><button id="diagnostics-export" class="secondary-button" type="button">导出诊断文件</button></section></div>
    <div id="pause-modal" class="modal" hidden><section class="pause-panel"><span class="eyebrow">TAKE A BREATHER</span><h2>休息一下，再追速度。</h2><p>计时和赛车已暂停。</p><button id="resume" class="primary-button">继续驾驶 <span>→</span></button><button id="restart" class="secondary-button">重新开始计时赛</button><button id="garage-back" class="text-button">返回围场 · 调整赛车</button></section></div>
    <div class="touch-controls race-only"><div><button data-control="KeyA" aria-label="向左转">◀</button><button data-control="KeyD" aria-label="向右转">▶</button></div><div><button data-control="KeyS" aria-label="刹车">制动</button><button data-control="KeyW" aria-label="油门">油门</button></div></div>
    <div id="loading" class="loading"><span class="brand-mark">pp·</span><strong>正在布置你的围场…</strong><span>连接赛道 · 安装轮胎 · 检查发车灯</span></div>`;
    this.map=this.el<HTMLCanvasElement>('minimap');this.ctx=this.map.getContext('2d')!;
    this.prepareLocalization();
    try{const saved=localStorage.getItem('pocket-paddock.language');if(isLanguage(saved))this.language=saved;}catch{}
    this.setLanguage(this.language);
    this.el<HTMLSelectElement>('language').onchange=()=>{const select=this.el<HTMLSelectElement>('language');if(isLanguage(select.value))this.setLanguage(select.value);select.blur();};
    this.el('team-grid').onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-team]');if(!button)return;const select=this.el<HTMLSelectElement>('team-select');select.value=button.dataset.team!;select.dispatchEvent(new Event('change',{bubbles:true}));if(event.detail>0)button.blur();};
    this.el('diagnostics-close').onclick=()=>this.hideDiagnostics();
    this.el('diagnostics-modal').onclick=event=>{if(event.target===this.el('diagnostics-modal'))this.hideDiagnostics();};
    document.addEventListener('keydown',event=>{
      if(this.el('diagnostics-modal').hidden)return;
      event.stopPropagation();
      if(event.code==='Escape'){event.preventDefault();this.hideDiagnostics();return;}
      if(event.code==='Tab'){
        const items=[this.el('diagnostics-close'),this.el('diagnostics-report'),this.el('diagnostics-export')],index=items.indexOf(document.activeElement as HTMLElement);
        if(index<0||(!event.shiftKey&&index===items.length-1)||(event.shiftKey&&index===0)){event.preventDefault();items[event.shiftKey?items.length-1:0].focus();}
      }
    },true);
    document.addEventListener('keydown',event=>{
      if(this.el('competition-result').hidden||!this.el('diagnostics-modal').hidden||event.code!=='Tab')return;
      const first=this.el('competition-restart'),last=this.el('competition-garage');
      if(!this.el('competition-result').contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();event.stopPropagation();(event.shiftKey?last:first).focus();}
    },true);
  }
  el<T extends HTMLElement=HTMLElement>(id:string){let el=this.elements.get(id);if(!el){el=document.getElementById(id)!;this.elements.set(id,el);}return el as T;}
  text(id:string,value:string){const el=this.el(id);if(el.textContent!==value)el.textContent=value;}
  t(key:TranslationKey,params:TranslationParams={}){return t(this.language,key,params);}
  /** Bind text nodes rather than replace controls: focus, input listeners and
   * the current selection all survive a language change. */
  private prepareLocalization(){
    this.root.querySelector('.version')!.textContent=translations.zh['garage.version'];
    const header=this.root.querySelector('.topbar')!,group=document.createElement('div');group.className='display-controls';
    group.append(this.root.querySelector('.quality-control')!);header.append(group);
    group.insertAdjacentHTML('beforeend','<button id="diagnostics" class="diagnostics-button" type="button" title="性能信息" aria-label="性能信息"><span aria-hidden="true">i</span></button>');
    group.insertAdjacentHTML('beforeend',`<label class="compact-setting" id="weather-control"><span class="setting-label">天气</span><select id="weather" aria-label="天气设置"><option value="sunny">晴天</option><option value="rainy">雨天</option></select></label><label class="compact-setting language-control"><span class="setting-label">语言</span><select id="language" aria-label="界面语言"><option value="zh">中文</option><option value="en">English</option></select></label>`);
    group.append(this.el('sound'));
    const qualityLabel=this.root.querySelector('.quality-control')!;
    for(const node of [...qualityLabel.childNodes])if(node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()==='画质'){const label=document.createElement('b');label.className='setting-label';label.textContent='画质';node.replaceWith(label);}
    this.root.querySelector('.garage .muted')!.insertAdjacentHTML('afterend','<div class="weather-summary"><span id="weather-condition"></span><small>切换天气重新计时 · 晴雨成绩分开保存</small></div>');
    const bestLabel=this.root.querySelector('.personal-best>span')!;bestLabel.innerHTML='<span id="menu-best-label"></span><small data-circuit-code>MONZA</small>';
    this.root.querySelector('.best-block .hud-label')!.id='best-label';
    this.root.querySelector('.pedals')!.insertAdjacentHTML('afterend','<div class="pedal-pressure"><div><span>油门开度</span><div class="pressure-track"><i id="throttle-pressure-fill"></i></div><b id="throttle-pressure-value">0%</b></div><div><span>制动压力</span><div class="pressure-track"><i id="brake-pressure-fill"></i></div><b id="brake-pressure-value">0%</b></div></div>');
    const keys=new Map(Object.entries(translations.zh).filter(([,value])=>!value.includes('{')).map(([key,value])=>[value,key as TranslationKey]));
    const walker=document.createTreeWalker(this.root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode as Text,value=node.data.trim(),key=keys.get(value as never);
      if(!key||node.parentElement?.closest('#driver-options,#team-select,#language,#team-grid'))continue;
      const start=node.data.indexOf(value);this.localizedNodes.push({node,key,prefix:node.data.slice(0,start),suffix:node.data.slice(start+value.length)});
    }
    this.root.querySelectorAll('*').forEach(element=>{for(const attribute of ['aria-label','title']){const value=element.getAttribute(attribute),key=value?keys.get(value as never):undefined;if(key)this.localizedAttributes.push({element,attribute,key});}});
    // Replace legacy tooltip wording with the current graphics explanation.
    this.localizedAttributes.push({element:qualityLabel,attribute:'title',key:'quality.help'});
  }
  setLanguage(language:Language){
    this.language=language;document.documentElement.lang=language==='zh'?'zh-CN':'en';document.body.dataset.language=language;
    document.title=language==='zh'?'Pocket Paddock · 口袋围场':'Pocket Paddock · Monza Time Trial';
    try{localStorage.setItem('pocket-paddock.language',language);}catch{}
    for(const {node,key,prefix,suffix} of this.localizedNodes)if(node.isConnected)node.data=prefix+this.t(key)+suffix;
    for(const {element,attribute,key} of this.localizedAttributes)element.setAttribute(attribute,this.t(key));
    this.el<HTMLSelectElement>('language').value=language;
    this.el<HTMLSelectElement>('team-select').querySelectorAll('option').forEach(option=>{const team=getTeam(option.value as TeamId);option.textContent=language==='zh'?`${team.label} · ${team.name}`:team.name;});
    this.setTeam(this.selectedTeam,this.selectedDriver);this.setWeather(this.weather);this.setSound(this.soundEnabled);this.setModelStatus(this.modelState);
    this.setDrs(this.drs);this.setGamepad(this.gamepad);this.renderPit();
    if(this.context)this.update(this.context.race,this.context.vehicle,this.context.track);
    this.setCompetition(this.competition);this.setCircuit(this.circuitId);
    if(this.toastEntry)this.text('toast',this.t(this.toastEntry.key,this.localizedParams(this.toastEntry.params)));
    document.dispatchEvent(new CustomEvent('paddock-language',{detail:{language}}));
  }
  setWeather(mode:'sunny'|'rainy'){
    this.weather=mode;this.el<HTMLSelectElement>('weather').value=mode;document.body.dataset.weather=mode;
    this.text('weather-condition',`${mode==='sunny'?'☀':'☂'} ${this.t(mode==='sunny'?'weather.dry':'weather.wet')}`);
    this.text('menu-best-label',this.t(mode==='sunny'?'best.sunny':'best.rainy'));this.text('best-label',this.t(mode==='sunny'?'best.sunny':'best.rainy'));
    this.el('weather-control').title=this.t(this.el<HTMLSelectElement>('weather').disabled?'weather.locked':'weather.help');
    this.el('weather-condition').parentElement!.title=this.t('weather.help');
  }
  setSound(enabled:boolean){this.soundEnabled=enabled;this.text('sound',this.t(enabled?'sound.on':'sound.off'));const label=this.t(enabled?'sound.disable':'sound.enable');this.el('sound').setAttribute('aria-label',label);this.el('sound').title=label;}
  private localizedParams(params:TranslationParams){const result={...params};if(params.weather==='sunny'||params.weather==='rainy')result.weather=this.t(params.weather==='sunny'?'weather.sunny':'weather.rainy');return result;}
  toast(message:string){this.toastEntry=undefined;this.text('toast',message);this.el('toast').hidden=false;this.toastUntil=performance.now()+4000;}
  toastKey(key:TranslationKey,params:TranslationParams={}){this.toast(this.t(key,this.localizedParams(params)));this.toastEntry={key,params};}
  setTeam(teamId:TeamId,driverId:DriverId){
    const team=getTeam(teamId),requested=getDriver(driverId);
    const selected=requested.teamId===teamId?requested:team.drivers[0];
    this.selectedTeam=teamId;this.selectedDriver=selected.id;
    this.el<HTMLSelectElement>('team-select').value=teamId;
    this.el('garage').style.setProperty('--team-color',team.color);
    this.root.style.setProperty('--selected-team',team.color);this.renderPit();this.text('showcase-team',this.language==='zh'?team.label:team.name);this.text('showcase-driver',this.language==='zh'?selected.label:selected.name);this.text('showcase-number',String(selected.number).padStart(2,'0'));
    this.text('team-label',team.name);this.text('driver-label',`#${selected.number}`);
    this.text('race-driver',`#${selected.number} ${this.language==='zh'?selected.label:selected.name} · ${this.language==='zh'?team.label:team.name}`);
    this.el('race-driver').style.setProperty('--team-color',team.color);
    this.el('team-grid').querySelectorAll<HTMLButtonElement>('[data-team]').forEach(button=>{const option=getTeam(button.dataset.team as TeamId),active=option.id===teamId;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',this.t('garage.selectTeam',{team:this.language==='zh'?option.label:option.name}));button.title=option.name;button.querySelector('.team-card-name')!.textContent=this.language==='zh'?option.label:option.name;});
    if(this.displayedTeam!==teamId){
      this.displayedTeam=teamId;
      this.el('driver-options').innerHTML=team.drivers.map(driver=>{const [shell,ring,cap]=helmetSwatches[driver.id];return`<button class="driver-option" data-driver="${driver.id}" aria-pressed="false"><span class="driver-card-top"><span class="driver-helmet" aria-hidden="true" style="--helmet-shell:${shell};--helmet-ring:${ring};--helmet-cap:${cap}"><i></i></span><span class="driver-number">${driver.number}</span><span class="radio" aria-hidden="true"></span></span><span class="driver-name"><strong>${driver.label}</strong><small>${driver.name}</small></span></button>`;}).join('');
    }
    this.el('driver-options').querySelectorAll<HTMLButtonElement>('[data-driver]').forEach(button=>{
      const driver=team.drivers.find(d=>d.id===button.dataset.driver)!,active=driver.id===selected.id;
      button.querySelector('strong')!.textContent=this.language==='zh'?driver.label:driver.name;
      button.querySelector('small')!.textContent=this.language==='zh'?driver.name:`#${driver.number} · ${team.name}`;
      button.setAttribute('aria-label',this.t('garage.selectDriver',{driver:this.language==='zh'?driver.label:driver.name,number:driver.number}));
      button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
    });
  }
  setModelStatus(state:'loading'|'ready'|'fallback',_message?:string){
    this.modelState=state;this.el('model-status').dataset.status=state;this.text('model-status',this.t(`model.${state}`));
  }
  setCamera(mode:CameraMode,view:MenuView){
    this.el<HTMLSelectElement>('camera-mode').value=mode;
    this.el('camera-mode').querySelectorAll<HTMLOptionElement>('option').forEach(o=>{o.textContent=this.t(`camera.${o.value as CameraMode}`);});
    this.text('camera-label',this.t(`camera.${mode}`));
    this.root.querySelectorAll<HTMLButtonElement>('[data-menu-view]').forEach(button=>{const selected=button.dataset.menuView===view;button.setAttribute('aria-pressed',String(selected));button.textContent=this.t(`showcase.${button.dataset.menuView as MenuView}`);});
  }
  setPit(info:PitDisplay){this.pit={...info};this.renderPit();}
  private renderPit(){
    const info=this.pit,panel=this.el('pit-panel'),menu=(this.context?.race.state??document.body.dataset.state??'menu')==='menu';
    const target=menu?this.root.querySelector('.garage-scroll')!:this.root;
    if(panel.parentElement!==target){if(menu)target.insertBefore(panel,target.querySelector('.controller-help'));else target.append(panel);}
    panel.dataset.state=info.state;panel.dataset.active=String(info.active);panel.hidden=this.context?.race.state==='finished';
    document.body.dataset.pitActive=String(info.active);document.body.dataset.pitControlled=String(info.controlled);panel.dataset.limited=String(info.limited);
    const team=getTeam(info.active?info.team:this.selectedTeam);panel.style.setProperty('--pit-team',team.color);
    const label=this.t(`pit.compound.${info.currentCompound}`);this.text('pit-current-compound',pitLetters[info.currentCompound]);
    this.el('pit-current-compound').style.setProperty('--pit-tyre-color',pitColors[info.currentCompound]);this.el('pit-current-compound').title=label;this.el('pit-current-compound').setAttribute('aria-label',`${this.t('pit.current')}: ${label}`);
    this.text('pit-current-label',this.t('pit.current'));this.text('pit-compound-label',this.t('pit.next'));
    const select=this.el<HTMLSelectElement>('pit-compound');select.setAttribute('aria-label',this.t('pit.nextTyres'));select.value=info.compound;select.disabled=info.controlled;
    for(const option of select.options)option.textContent=this.t(`pit.compound.${option.value as PitCompound}`);
    this.text('pit-status',this.t(info.state==='idle'&&info.limited?'pit.status.limited':`pit.status.${info.state}`));this.text('pit-description',this.t(info.state==='idle'&&info.limited?'pit.help.exit':`pit.help.${info.state}`));
    this.text('pit-team',this.language==='zh'?team.label:team.name);this.text('pit-stop-count',info.completedStops?this.t('pit.completed',{count:info.completedStops}):'');
    const service=info.state==='service',duration=Number.isFinite(info.serviceDuration)?Math.max(0,info.serviceDuration):0,elapsed=Number.isFinite(info.serviceElapsed)?Math.max(0,info.serviceElapsed):0;
    this.el('pit-service-timer').hidden=!service;this.text('pit-time-label',this.t('pit.remaining'));
    this.text('pit-remaining',`${Math.max(0,duration-elapsed).toFixed(2)} s`);this.text('pit-service-duration',this.t('pit.target',{seconds:duration.toFixed(2)}));
    const progress=duration>0?Math.max(0,Math.min(1,elapsed/duration)):0;this.el('pit-progress').style.width=`${progress*100}%`;this.el('pit-progress-track').setAttribute('aria-valuenow',String(Math.round(progress*100)));
    panel.setAttribute('aria-label',this.t('pit.panel'));this.el('pit-limit').setAttribute('aria-label',this.t('pit.limit'));this.el('pit-progress-track').setAttribute('aria-label',this.t('pit.progress'));
  }
  setPowertrain(state:PowertrainState){
    this.text('gear',gearLabel(state.gear));this.text('rpm-value',`${Math.round(state.rpm).toLocaleString(this.language==='zh'?'zh-CN':'en-US')} RPM`);
    this.text('shift-state',state.shift?this.t(state.shift==='up'?'engine.up':'engine.down'):'');this.el('gear').dataset.shift=state.shift??'steady';
    this.el('rev-fill').style.width=`${Math.min(100,state.rpm/REDLINE_RPM*100)}%`;
  }
  showDiagnostics(info:unknown){let report:string;try{report=JSON.stringify(info,null,2)??String(info);}catch{report=String(info);}this.text('diagnostics-report',report);this.el('diagnostics-modal').hidden=false;this.el('diagnostics-close').focus();}
  hideDiagnostics(){this.el('diagnostics-modal').hidden=true;this.el('diagnostics').focus();}
  setGamepad(status:{connected:boolean;name:string;supported:boolean}){this.gamepad={...status};const key=!status.supported?(status.connected?'gamepad.unsupported':'gamepad.unavailable'):status.connected?'gamepad.connected':'gamepad.disconnected';this.text('gamepad-status',this.t(key,{name:status.name}));this.el('gamepad-status').dataset.connected=String(status.connected&&status.supported);this.el('gamepad-status').title=status.connected?status.name:this.t('gamepad.waiting');}
  /** Call after update() so the race classification replaces the TT HUD labels. */
  setCircuit(id:CircuitId){
    this.circuitId=id;document.body.dataset.circuit=id;
    const c=CIRCUITS[id],zh=this.language==='zh';
    this.el<HTMLSelectElement>('circuit').value=id;
    this.text('circuit-select-label',zh?'赛道':'Circuit');
    this.el('circuit').setAttribute('aria-label',zh?'赛道选择':'Circuit selection');
    this.el('circuit').querySelectorAll('option').forEach(option=>{const item=CIRCUITS[option.value as CircuitId];option.textContent=zh?`${item.zh} · ${item.countryZh}`:item.name;});
    this.text('circuit-title',`${c.heading}, ${c.country}`);
    this.root.querySelectorAll('[data-circuit-code]').forEach(el=>{el.textContent=c.code;});
    this.text('circuit-kicker',c.kicker);
    this.root.querySelector('.track-pill strong')!.textContent=zh?c.zh:c.name;
    this.root.querySelector('.track-pill>span:nth-of-type(2)')!.textContent=zh?`${c.countryZh} · ${c.kindZh}`:c.locationEn;
    const copy=this.root.querySelector('.menu-copy>p')!;copy.textContent=zh?`选一支车队，找到你的节奏。在${c.zh}，把每一个弯变成优势。`:`Choose your team. Find your rhythm. Make every corner count at ${c.name}.`;
    document.title=zh?'Pocket Paddock · 口袋围场':`Pocket Paddock · ${c.name} ${this.competition.enabled?'Race':'Time Trial'}`;
  }
  setCompetition(info:CompetitionDisplay){
    this.competition={...info,rows:info.rows.slice(0,6)};
    const enabled=info.enabled;
    document.body.dataset.competition=String(enabled);
    document.title=this.language==='zh'?'Pocket Paddock · 口袋围场':enabled?`Pocket Paddock · ${CIRCUITS[this.circuitId].name} Race`:`Pocket Paddock · ${CIRCUITS[this.circuitId].name} Time Trial`;
    const mode=this.el<HTMLSelectElement>('race-mode');
    mode.value=enabled?'race':'time-trial';
    mode.querySelectorAll('option').forEach(option=>option.textContent=this.t(option.value==='race'?'race.mode.ai':'race.mode.tt'));
    this.text('race-mode-note',this.t(enabled?'race.note.ai':'race.note.tt'));
    this.text('event-title',this.t(enabled?'race.event':'event'));
    this.text('restart',this.t(enabled?'race.restartPaused':'restart'));
    this.el('competition-leaderboard').hidden=!enabled;
    this.el('competition-leaderboard').setAttribute('aria-label',this.t('race.board'));
    this.text('competition-position-label',this.t('race.position'));
    this.text('competition-title',this.t('race.result'));
    this.text('competition-result-position-label',this.t('race.resultPosition'));
    this.text('competition-result-time-label',this.t('race.totalTime'));
    this.text('competition-classification-note',this.t('race.classification'));
    this.text('competition-record-note',this.t('race.noRecord'));
    // Keep the button nodes so main.ts handlers and focus survive live translation.
    const restart=this.el('competition-restart');
    if(restart.firstChild?.nodeType===Node.TEXT_NODE)restart.firstChild.textContent=this.t('race.restart')+' ';
    this.text('competition-garage',this.t('race.garage'));
    if(enabled){
      this.text('lap',`${Math.max(1,Math.min(info.lap,info.totalLaps))}/${info.totalLaps}`);
      this.text('best-label',this.t('race.totalTime'));this.text('best-time',formatTime(info.elapsed));
      this.text('last-time',this.t('race.noRecord'));
      this.text('race-position',`P${String(info.position).padStart(2,'0')} / ${info.total}`);
      this.text('competition-result-position',`P${String(info.position).padStart(2,'0')} / ${info.total}`);
      this.text('competition-result-time',formatTime(info.elapsed));
      this.text('competition-summary',this.t('race.summary',{laps:info.totalLaps,total:info.total}));
    }else this.text('best-label',this.t(this.weather==='sunny'?'best.sunny':'best.rainy'));
    const signature=JSON.stringify([this.language,this.competition.rows]);
    if(signature!==this.competitionListSignature){
      this.competitionListSignature=signature;
      for(const id of ['competition-rows','competition-result-rows']){
        const list=this.el(id);list.replaceChildren();
        for(const row of this.competition.rows){
          const item=document.createElement('li');item.dataset.id=row.id;item.dataset.player=String(row.player);item.dataset.finished=String(row.finished);
          item.style.setProperty('--rival-color',/^#[0-9a-f]{3,8}$/i.test(row.color)?row.color:'#3a745a');
          const rank=document.createElement('b'),name=document.createElement('span'),status=document.createElement('small');
          rank.textContent=String(row.position).padStart(2,'0');name.textContent=row.name;name.title=row.name;
          status.textContent=row.finished?this.t('race.finishedFlag'):row.player?this.t('race.you'):Number.isFinite(row.gap)?`+${Math.max(0,row.gap!).toFixed(1)}s`:this.t('race.runningFlag');
          item.append(rank,name,status);list.append(item);
        }
      }
    }
    const result=this.el('competition-result'),showResult=enabled&&info.finished,wasHidden=result.hidden;
    result.hidden=!showResult;
    if(showResult&&wasHidden)this.el('competition-restart').focus();
  }
  hideCompetitionResult(){this.competition={...this.competition,finished:false};this.el('competition-result').hidden=true;}
  setDrs(summary:DrsDisplay){
    this.drs={...summary};const button=this.el<HTMLButtonElement>('drs-toggle'),state=summary.active?'active':summary.state;
    this.text('drs-status',this.t(`drs.status.${state}`));
    this.text('drs-zone',summary.zone!==null?this.t('drs.zone',{zone:summary.zone}):Number.isFinite(summary.distanceToZone)&&summary.distanceToZone>0?this.t('drs.next',{distance:Math.ceil(summary.distanceToZone)}):this.t('drs.key'));
    button.disabled=!(summary.available||summary.active)||this.context?.race.state!=='racing';button.setAttribute('aria-pressed',String(summary.active));button.setAttribute('aria-label',this.t('drs.toggle'));button.title=this.t('drs.help');button.closest('.drs-card')!.setAttribute('data-state',state);
  }
  update(race:RaceSession,vehicle:VehiclePhysics,track:Track){
    this.context={race,vehicle,track};
    this.el<HTMLSelectElement>('race-mode').disabled=race.state!=='menu';
    this.setDrs(this.drs);
    if(document.body.dataset.state!==race.state)document.body.dataset.state=race.state;
    this.renderPit();
    this.el('pause-modal').hidden=race.state!=='paused';
    this.el('countdown').hidden=race.state!=='countdown';
    const lightCount=Math.min(5,Math.floor(race.countdown/0.6)+1);
    this.el('countdown-lights').querySelectorAll('i').forEach((v,i)=>v.classList.toggle('on',i<lightCount));
    const weatherSelect=this.el<HTMLSelectElement>('weather'),locked=race.state==='countdown'||race.state==='racing'||race.state==='finished';
    if(weatherSelect.disabled!==locked){weatherSelect.disabled=locked;this.el('weather-control').title=this.t(locked?'weather.locked':'weather.help');}
    this.text('countdown-text',this.t(race.countdown<3?'countdown.ready':'countdown.watch'));
    this.text('lap',String(race.lap).padStart(2,'0'));this.text('current-time',formatTime(race.elapsed));
    this.text('best-time',formatTime(race.best));this.text('menu-best',formatTime(race.best));
    this.text('sector',this.t('checkpoint',{current:Math.min(race.nextCheckpoint,track.checkpoints.length),total:track.checkpoints.length}));
    this.text('validity',this.t(race.valid?'valid':race.invalidReason==='reset'?'invalid.reset':'invalid.limits'));
    this.el('validity').classList.toggle('invalid',!race.valid);
    this.text('last-time',this.t('last',{time:formatTime(race.last)}));
    const kmh=Math.round(Math.abs(vehicle.speed)*6);this.text('speed',String(kmh));this.text('gear',vehicle.speed<-.1?'R':kmh<2?'N':String(Math.min(7,1+Math.floor(kmh/36))));
    this.el('rev-fill').style.width=`${Math.min(100,kmh/240*100)}%`;
    const pressure=vehicle as VehiclePhysics&{brakePressure?:number;throttlePressure?:number};
    for(const [id,value] of [['throttle',pressure.throttlePressure??0],['brake',pressure.brakePressure??0]] as const){const amount=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;this.el(`${id}-pressure-fill`).style.width=`${amount*100}%`;this.text(`${id}-pressure-value`,`${Math.round(amount*100)}%`);}
    this.text('surface',this.t(vehicle.surface==='asphalt'?(this.weather==='rainy'?'surface.wet':'surface.asphalt'):vehicle.surface==='grass'?'surface.grass':'surface.gravel'));
    this.el('surface').classList.toggle('offroad',vehicle.surface!=='asphalt');
    const distance=track.nearest(vehicle.x,vehicle.z).distance;
    const usage=vehicle.gripUsage;
    this.el('grip-fill').style.width=`${Math.min(100,usage*100)}%`;
    this.el('grip-meter').classList.toggle('saturated',vehicle.sliding);
    this.text('grip-label',this.t(vehicle.sliding?'grip.limit':usage>.75?'grip.near':'grip.full'));
    const advice=drivingAdvice(track,distance,vehicle,this.language);
    this.text('driving-hint',advice.text);this.el('driving-hint').dataset.level=advice.level;
    let corner='起终点直道';for(const c of track.corners)if(distance>=c.distance)corner=c.name;
    this.text('corner-name',localizedCorner(corner,this.language));this.drawMap(track,vehicle,race);
    if(this.toastUntil&&performance.now()>this.toastUntil){this.el('toast').hidden=true;this.toastUntil=0;this.toastEntry=undefined;}
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
      const zones=(track.group?.userData.drsZones??[]) as {start:number;end:number}[];
      bg.strokeStyle='#5b9c73';bg.lineWidth=4;bg.lineCap='round';
      for(const zone of zones){
        if(!Number.isFinite(zone.start+zone.end)||!Number.isFinite(track.length)||track.length<=0)continue;
        const span=((zone.end-zone.start)%track.length+track.length)%track.length;
        bg.beginPath();for(let d=0;d<=span;d+=Math.min(3,span||3)){
          const sample=track.sampleAt(zone.start+d),[x,y]=this.mapProject(sample.point.x,sample.point.z);if(d===0)bg.moveTo(x,y);else bg.lineTo(x,y);
        }bg.stroke();
      }
    }
    ctx.drawImage(this.mapBackground!,0,0);const project=this.mapProject;
    const target=track.sampleAt(track.checkpoints[race.nextCheckpoint]??0);let [cx,cy]=project(target.point.x,target.point.z);ctx.fillStyle='#d99a30';ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill();
    const [x,y]=project(vehicle.x,vehicle.z);ctx.fillStyle='#f16a4c';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
}
