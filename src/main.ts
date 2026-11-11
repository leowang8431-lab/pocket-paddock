import './style.css';
import './garage.css';
import * as THREE from 'three';
import {Track} from './track';
import {createScenery} from './scenery';
import {createSpaScenery} from './spa-scenery';
import {CIRCUITS,isCircuitId,type CircuitId} from './circuits';
import {roadPose} from './road-pose';
import {FleetCar} from './fleet-car';
import {teams,getTeam,getDriver,DEFAULT_TEAM,DEFAULT_DRIVER,type TeamId,type DriverId} from './team-catalog';
import {VehiclePhysics,type Controls} from './physics';
import {RaceSession,formatTime,TRACK_LIMIT_PENALTY_SECONDS} from './race';
import {Input} from './input';
import {ChaseCamera,isCameraMode,type CameraMode,type MenuView} from './camera';
import {UI} from './ui';
import {EngineAudio} from './audio';
import {Powertrain} from './powertrain';
import {ARCHITECTURE_HEIGHT_SCALE} from './architecture-scale';
import {SkidMarks} from './skid-marks';
import type {StandLayout} from './stand-layout';
import {AdaptiveQuality,classifyGraphicsCapability,isQualityMode,qualityPixelRatio,type QualityMode} from './quality';
import {WeatherController} from './weather';
import {isWeatherMode,type WeatherMode} from './conditions';
import {createStudioEnvironment} from './visual-finish';
import {DrsController,createMonzaDrsZones,createSpaDrsZones,createMonacoDrsZones} from './drs';
import {createDrsMarkers} from './drs-markers';
import {fullSteerYawForSpeed,WHEELBASE} from './handling';
import {AiRace,createRaceGrid,type RaceGridSlot} from './ai-race';
import {AiRivals} from './ai-rivals';
import {CompetitionProgress,isRaceMode,type RaceMode} from './competition';
import {RaceIntervals} from './race-intervals';
import {PitLaneController} from './pit-lane-controller';
import {PitServiceView} from './pit-service-view';
import {PitStopAudio} from './pit-stop-audio';
import type {PitCompound} from './pit-stop-animation';
import {monacoPitIndex} from './monaco-team-pits';
import {KMH_PER_SPEED_UNIT} from './speed-scale';
import {TravelTransition} from './travel-transition';
import {DANZHOU,TRAVEL_DESTINATIONS} from './travel-map';

const arrivedKey='pocket-paddock.travel.arrived';
function rememberArrival(id:CircuitId){
  try{localStorage.setItem('pocket-paddock.circuit',id);}catch{}
  try{sessionStorage.setItem(arrivedKey,id);return true;}catch{return false;}
}
const launchUrl=new URL(location.href);
const requested=launchUrl.searchParams.get('circuit');
const fallbackDeparture=launchUrl.searchParams.get('departed');
let lastArrival:CircuitId|undefined;
let preferred:CircuitId='monza';
try{const saved=localStorage.getItem('pocket-paddock.circuit');if(isCircuitId(saved))preferred=saved;}catch{}
try{const saved=sessionStorage.getItem(arrivedKey);if(isCircuitId(saved))lastArrival=saved;}catch{}
if(!lastArrival&&isCircuitId(requested)&&isCircuitId(fallbackDeparture))lastArrival=fallbackDeparture;
const firstArrival=lastArrival===undefined;
let circuitId:CircuitId=isCircuitId(requested)?requested:lastArrival??preferred;
const ui=new UI();ui.setCircuit(circuitId);document.body.dataset.state='menu';
const loading=ui.el('loading');
if(ui.root.contains(loading))document.body.append(loading);
const transition=new TravelTransition(loading,ui.root,()=>ui.language);
function boot(){
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  ui.el('viewport').appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c7dbca');scene.fog=new THREE.Fog('#c7dbca',130,430);
  const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,1000);
  const hemisphere=new THREE.HemisphereLight(0xeaf3ff,0x74876d,2.1);scene.add(hemisphere);
  scene.environment=createStudioEnvironment(renderer);scene.environmentIntensity=.48;
  const sun=new THREE.DirectionalLight(0xfff0d1,3.5);sun.castShadow=false;sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-55;sun.shadow.camera.right=55;sun.shadow.camera.top=55;sun.shadow.camera.bottom=-55;sun.shadow.camera.near=1;sun.shadow.camera.far=200;
  sun.shadow.normalBias=.04;sun.shadow.bias=-.0002;sun.shadow.radius=3;scene.add(sun,sun.target);
  const track=new Track(circuitId),scenery=circuitId==='spa'?createSpaScenery(track):createScenery(track);scene.add(track.group,scenery);
  const pitClock=scenery.userData.pitClockController as {update:(dt:number)=>void;readonly summary:unknown}|undefined;
  const pitColliders=scenery.userData.pitColliders as {minX:number;maxX:number;minZ:number;maxZ:number}[]|undefined;
  if(pitColliders)track.colliders.push(...pitColliders);
  const facilitySegments=scenery.userData.facilityBarrierSegments as typeof track.barrierSegments|undefined;
  if(facilitySegments){track.barrierSegments.push(...facilitySegments);track.rebuildBarrierIndex();}
  const drsZones=circuitId==='monaco'?createMonacoDrsZones(track):circuitId==='spa'?createSpaDrsZones(track):createMonzaDrsZones(track),drs=new DrsController(drsZones,track.length,CIRCUITS[circuitId].realLength);
  track.group.userData.drsZones=drsZones;scene.add(createDrsMarkers(track,drsZones));
  const skidMarks=new SkidMarks();scene.add(skidMarks.mesh);
  const car=new FleetCar();scene.add(car.group);
  const vehicle=new VehiclePhysics();
  const pit=new PitLaneController(track),pitView=new PitServiceView(car,scene),pitAudio=new PitStopAudio();
  let pitControlled=false,pitServiceArmed=false,pitCamera=false,lastPitCompleted=0,nextPitCompound:PitCompound='medium';
  let fittedPitStops=0,startingCompound:PitCompound|undefined;
  function cancelPit(){pit.cancel();pitView.cancel();pitAudio.sync(0,false,1);pitControlled=false;pitServiceArmed=false;}
  let storage:Storage|undefined;try{storage=localStorage;}catch{/* Game remains playable in private storage contexts. */}
  const heightAt=(x:number,z:number)=>track.heightAt(x,z);
  const circuitSelect=ui.el<HTMLSelectElement>('circuit');
  let switchingCircuit=false,revealScheduled=false;
  circuitSelect.onchange=()=>{
    const next=circuitSelect.value;if(!isCircuitId(next)||next===circuitId||race.state!=='menu'||switchingCircuit)return;
    switchingCircuit=true;transition.prepare(next);input.clear();
    const url=new URL(location.href);url.searchParams.set('circuit',next);
    if(rememberArrival(circuitId))url.searchParams.delete('departed');
    else url.searchParams.set('departed',circuitId);
    requestAnimationFrame(()=>requestAnimationFrame(()=>location.assign(url.href)));
  };
  let renderDirty=true;
  let savedWeather:WeatherMode='sunny';try{const saved=storage?.getItem('pocket-paddock.weather');if(isWeatherMode(saved))savedWeather=saved;}catch{}
  const weather=new WeatherController(scene,sun,hemisphere,track);weather.setMode(savedWeather);vehicle.weather=savedWeather;
  ui.setWeather(savedWeather);
  let savedQuality:QualityMode='auto';try{const saved=storage?.getItem('pocket-paddock.graphics');if(isQualityMode(saved))savedQuality=saved;}catch{}
  const gl=renderer.getContext(),debugRenderer=gl.getExtension('WEBGL_debug_renderer_info');
  const software=debugRenderer?/swiftshader|llvmpipe|software|microsoft basic/i.test(String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL))):false;
  const graphicsCapability=classifyGraphicsCapability({software,cores:navigator.hardwareConcurrency,deviceMemory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory,maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)});
  const sceneryLods:{lod:THREE.LOD;distances:number[]}[]=[];
  scenery.traverse(object=>{if(object instanceof THREE.LOD)sceneryLods.push({lod:object,distances:object.levels.map(l=>l.distance)});});
  const applyQuality=()=>{
    const p=quality.profile;
    renderer.setPixelRatio(qualityPixelRatio(innerWidth,innerHeight,devicePixelRatio,p,quality.resolutionScale));renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=p.shadows;sun.castShadow=p.shadows;
    camera.far=p.far*(circuitId!=='monza'?2.2:1);camera.updateProjectionMatrix();
    weather.setQuality(p);sun.shadow.mapSize.set(p.level==='high'?2048:1024, p.level==='high'?2048:1024);
    for(const {lod,distances} of sceneryLods)lod.levels.forEach((level,i)=>{level.distance=distances[i]*p.sceneryDistance/215;});
    document.body.dataset.quality=p.level;renderDirty=true;
  };
  const quality=new AdaptiveQuality(savedQuality,graphicsCapability.preferPerformance,applyQuality);applyQuality();
  const qualitySelect=ui.el<HTMLSelectElement>('quality');qualitySelect.value=savedQuality;
  const setQuality=(mode:QualityMode)=>{quality.setMode(mode);qualitySelect.value=mode;try{storage?.setItem('pocket-paddock.graphics',mode);}catch{}};
  qualitySelect.onchange=()=>{if(isQualityMode(qualitySelect.value))setQuality(qualitySelect.value);qualitySelect.blur();};
  let soundEnabled=true;try{soundEnabled=storage?.getItem('pocket-paddock.sound')!=='off';}catch{}
  const race=new RaceSession(track,storage,savedWeather),chase=new ChaseCamera(camera),audio=new EngineAudio(soundEnabled),powertrain=new Powertrain();
  pitAudio.setEnabled(soundEnabled);ui.setSound(soundEnabled);
  function unlockSound(){if(audio.enabled){void audio.unlock();void pitAudio.unlock();}}
  try{const saved=storage?.getItem('pocket-paddock.camera');if(isCameraMode(saved))chase.setMode(saved);}catch{}
  function refreshCamera(){ui.setCamera(chase.mode,chase.menuView);renderDirty=true;}
  function chooseCamera(mode:CameraMode){chase.setMode(mode);try{storage?.setItem('pocket-paddock.camera',mode);}catch{}refreshCamera();}
  function cycleCamera(){chooseCamera(chase.cycleMode());}
  ui.el<HTMLSelectElement>('camera-mode').value=chase.mode;
  ui.el<HTMLSelectElement>('camera-mode').onchange=()=>{const select=ui.el<HTMLSelectElement>('camera-mode');if(isCameraMode(select.value))chooseCamera(select.value);select.blur();};
  ui.el('camera-cycle').onclick=cycleCamera;
  document.querySelectorAll<HTMLButtonElement>('[data-menu-view]').forEach(button=>{button.onclick=()=>{if(race.state==='menu'){chase.setMenuView(button.dataset.menuView as MenuView);refreshCamera();button.blur();}};});
  refreshCamera();
  let mode:RaceMode='time-trial';try{const saved=storage?.getItem('pocket-paddock.mode');if(isRaceMode(saved))mode=saved;}catch{}
  const totalLaps=CIRCUITS[circuitId].raceLaps;
  const opponents=new AiRace(track,5,totalLaps),competition=new CompetitionProgress(track,totalLaps),rivalModels=new AiRivals(5);rivalModels.setGround(circuitId!=='monza'?track:undefined);scene.add(rivalModels.group);rivalModels.setVisible(false);
  const intervals=new RaceIntervals();
  let rivalLoadRequested=false;
  function ensureRivals(){
    if(mode!=='race')return;
    if(!rivalLoadRequested){rivalLoadRequested=true;void rivalModels.load(car).catch(()=>{}).then(()=>{renderDirty=true;refreshModelStatus();});}
    refreshModelStatus();
  }
  let collisionCooldown=0,shownResult=0,shownPenaltyCount=0,lastUI=0,lastState=race.state;
  let previousPlayerGrid:RaceGridSlot|undefined;
  const startLights:THREE.Mesh[]=[];scene.traverse(o=>{if(o.name.startsWith('start-light-'))startLights.push(o as THREE.Mesh);});
  function place(distance=0,lateral=0){cancelPit();const sample=track.sampleAt(distance);vehicle.reset(sample.point.x+sample.right.x*lateral,sample.point.z+sample.right.z*lateral,Math.atan2(sample.tangent.x,sample.tangent.z));powertrain.reset();drs.reset();car.setDrs(false,true);chase.snap();renderDirty=true;}
  function refreshTyres(){const {compound,remaining,temperature}=vehicle.tires.summary;ui.setTyres({compound,health:remaining,temperature});}
  function fitStartingTyres(){
    const compound=startingCompound??(weather.mode==='rainy'?'wet':'medium');
    startingCompoundSelect.value=compound;
    pit.reset(compound);pitView.setCurrentCompound(compound);vehicle.tires.fit(compound,weather.mode);refreshTyres();
  }
  function prepareAttempt(randomGrid=mode==='race'){
    cancelPit();fitStartingTyres();lastPitCompleted=fittedPitStops=0;
    const grid=randomGrid?createRaceGrid(opponents.count,Math.random,previousPlayerGrid):undefined;
    if(grid)previousPlayerGrid=grid.player;
    opponents.start(selectedTeam,selectedDriver,weather.mode,grid);competition.reset(grid?.player.distance);
    intervals.reset();shownPenaltyCount=0;
    race.recordBests=mode==='time-trial';ui.hideCompetitionResult();
    return grid?.player;
  }
  function start(){unlockSound();if(car.status==='loading')return;if(mode==='race'&&rivalModels.status!=='ready'&&rivalModels.status!=='fallback'){ensureRivals();return;}if(document.activeElement instanceof HTMLElement)document.activeElement.blur();input.clear();const spawn=prepareAttempt();place(spawn?.distance,spawn?.lateral);race.start();rivalModels.setVisible(mode==='race');skidMarks.clear();shownResult=0;refreshCompetitionUI();ui.toastKey('toast.start');}
  function togglePause(){input.clear();pitAudio.sync(pit.summary.serviceElapsed,false,1);if(race.state==='paused'){unlockSound();race.resume();}else race.pause();renderDirty=true;}
  function reset(){if(race.state!=='racing'&&race.state!=='paused')return;const d=track.nearest(vehicle.x,vehicle.z).distance;const cp=track.checkpoints[Math.max(0,race.nextCheckpoint-1)];const safe=Math.min(d,cp+2);place(safe);race.resetPosition(safe);input.clear();ui.toastKey('toast.reset');}
  function refreshDrs(controls:Controls){
    if(pit.summary.active){drs.reset();vehicle.drsActive=false;car.setDrs(false,true);return;}
    const sample=track.nearest(vehicle.x,vehicle.z),lateral=Math.hypot(vehicle.x-sample.point.x,vehicle.z-sample.point.z);
    drs.update({state:race.state,weather:weather.mode,distance:sample.distance,speed:vehicle.speed,brake:Math.max(vehicle.brakePressure,controls.brakeAmount??Number(controls.brake)),onRoad:track.surfaceAt(vehicle.x,vehicle.z)==='asphalt'&&lateral<track.widthAt(sample.distance)/2+1.2,pitLane:track.isPitLane(vehicle.x,vehicle.z),forward:Math.sin(vehicle.heading)*sample.tangent.x+Math.cos(vehicle.heading)*sample.tangent.z,collision:vehicle.collision});
    vehicle.drsActive=drs.summary.active;
  }
  function toggleDrs(){
    if(race.state!=='racing'||pit.summary.active)return;
    refreshDrs(input.controls);const wasOpen=drs.summary.active;
    if(drs.toggle())ui.toastKey(wasOpen?'drs.close':'drs.open');else ui.toastKey(weather.mode==='rainy'?'drs.wet':'drs.unavailable');
    vehicle.drsActive=drs.summary.active;car.setDrs(vehicle.drsActive);ui.setDrs(drs.summary);renderDirty=true;
  }
  function backToGarage(){race.state='menu';input.clear();ui.hideCompetitionResult();rivalModels.setVisible(false);place();refreshCompetitionUI();ui.el('start').focus();}
  function classifying(){return race.state==='finished'&&competition.finishTime!==null&&opponents.time+1e-6<competition.finishTime;}
  function recordIntervals(){
    if(!competition.finished)intervals.record('player',competition.progress,opponents.time);
    for(const rival of opponents.rivals)intervals.record(rival.id,rival.distance,opponents.time);
  }
  function competitionInfo(){
    const rows=opponents.standings(competition.progress,competition.finished,competition.finishTime??undefined);
    const playerPit=pit.summary,finished=competition.finished&&race.state==='finished'&&!classifying();
    return{enabled:mode==='race',lap:Math.min(race.lap,opponents.totalLaps),totalLaps:opponents.totalLaps,
      position:rows.find(r=>r.isPlayer)!.position,total:rows.length,elapsed:competition.finishTime??opponents.time+race.totalPenalty,
      finished,penalty:race.totalPenalty,rows:rows.map((row,i)=>{
        const ahead=rows[i-1],rival=opponents.rivals.find(r=>r.id===row.id);
        const gap=!ahead?undefined:row.finishTime!==null&&ahead.finishTime!==null?row.finishTime-ahead.finishTime:
          row.finished||finished?undefined:intervals.gap(ahead.id,row.progress,opponents.time);
        return{id:row.id,name:ui.language==='zh'?getDriver(row.driver).label:getDriver(row.driver).name,position:row.position,
          color:getTeam(row.team).color,player:row.isPlayer,finished:row.finished,gap,
          pitState:rival?.pitState??playerPit.state,pitStops:rival?.pitStops??playerPit.completedStops};
      })};
  }
  function refreshCompetitionUI(){ui.setCompetition(competitionInfo());ui.el<HTMLSelectElement>('race-mode').disabled=race.state!=='menu';circuitSelect.disabled=race.state!=='menu';}
  const input=new Input(code=>{
    if(code==='GamepadDisconnected'){
      if(race.state==='racing'||race.state==='countdown')race.pause();
      input.clear();vehicle.throttlePressure=0;vehicle.brakePressure=0;vehicle.drsActive=false;drs.reset();car.setDrs(false,true);renderDirty=true;ui.toastKey('gamepad.disconnected');return;
    }
    if(!ui.el('diagnostics-modal').hidden){if(code==='GamepadBack'||code==='GamepadConfirm'||code==='Escape')ui.hideDiagnostics();return;}
    if(race.state==='finished'){if(code==='GamepadConfirm'||code==='Enter')start();else if(code==='GamepadBack'||code==='Escape')backToGarage();return;}
    if(code==='Escape'||code==='KeyP')togglePause();
    if(code==='KeyC')cycleCamera();
    if(code==='KeyR')reset();if(code==='KeyF')toggleDrs();
    if(code==='Enter'&&race.state==='menu')start();
    if(code==='GamepadConfirm'){if(race.state==='menu')start();else if(race.state==='paused')togglePause();}
    if(code==='GamepadBack'&&race.state==='paused')backToGarage();
    if(race.state==='menu'&&(code==='GamepadLeft'||code==='GamepadRight')){
      const index=teams.findIndex(t=>t.id===selectedTeam),team=teams[(index+(code==='GamepadRight'?1:-1)+teams.length)%teams.length];chooseCar(team.id,team.drivers[0].id);
    }
    if(race.state==='menu'&&(code==='GamepadUp'||code==='GamepadDown')){
      const team=getTeam(selectedTeam),index=team.drivers.findIndex(d=>d.id===selectedDriver);chooseCar(team.id,team.drivers[(index+1)%team.drivers.length].id);
    }
  });
  ui.el('start').onclick=start;ui.el('pause').onclick=togglePause;ui.el('resume').onclick=togglePause;ui.el('reset').onclick=reset;ui.el('restart').onclick=start;
  ui.el('garage-back').onclick=backToGarage;ui.el('drs-toggle').onclick=toggleDrs;
  ui.el('competition-restart').onclick=start;ui.el('competition-garage').onclick=backToGarage;
  ui.el('sound').onclick=()=>{
    const enabled=!audio.enabled;
    audio.setEnabled(enabled);pitAudio.setEnabled(enabled);ui.setSound(enabled);unlockSound();
    try{storage?.setItem('pocket-paddock.sound',enabled?'on':'off');}catch{}
  };
  const startingCompoundSelect=ui.el<HTMLSelectElement>('starting-compound');
  try{const saved=storage?.getItem('pocket-paddock.starting-compound');if(['soft','medium','hard','wet'].includes(saved??''))startingCompound=saved as PitCompound;}catch{}
  fitStartingTyres();
  startingCompoundSelect.onchange=()=>{
    if(race.state!=='menu')return;
    startingCompound=startingCompoundSelect.value as PitCompound;
    try{storage?.setItem('pocket-paddock.starting-compound',startingCompound);}catch{}
    fitStartingTyres();startingCompoundSelect.blur();renderDirty=true;
  };
  const pitCompoundSelect=ui.el<HTMLSelectElement>('pit-compound');
  try{const saved=storage?.getItem('pocket-paddock.pit-compound');if(['soft','medium','hard','wet'].includes(saved??''))nextPitCompound=saved as PitCompound;}catch{}
  pitCompoundSelect.value=nextPitCompound;
  pitCompoundSelect.onchange=()=>{if(pit.summary.controlled){pitCompoundSelect.value=nextPitCompound;return;}const value=pitCompoundSelect.value;if(['soft','medium','hard','wet'].includes(value)){nextPitCompound=value as PitCompound;try{storage?.setItem('pocket-paddock.pit-compound',value);}catch{}}pitCompoundSelect.blur();};
  ui.el<HTMLSelectElement>('weather').onchange=()=>{
    const select=ui.el<HTMLSelectElement>('weather'),mode=select.value;
    if(!isWeatherMode(mode)||mode===weather.mode)return;
    if(race.state!=='menu'&&race.state!=='paused'){ui.setWeather(weather.mode);return;}
    const paused=race.state==='paused';
    weather.setMode(mode);vehicle.weather=mode;race.setWeather(mode);const spawn=prepareAttempt(paused&&!race.recordBests);race.start();
    if(paused)race.pause();else race.state='menu';
    input.clear();place(spawn?.distance,spawn?.lateral);rivalModels.setVisible(!!spawn);skidMarks.clear();shownResult=0;lastCheckpoint=-1;renderDirty=true;
    ui.setWeather(mode);ui.update(race,vehicle,track);select.blur();
    try{storage?.setItem('pocket-paddock.weather',mode);}catch{}
    ui.toastKey(paused?'toast.restartWeather':'toast.weather',{weather:mode});
  };
  let selectedTeam:TeamId=DEFAULT_TEAM,selectedDriver:DriverId=DEFAULT_DRIVER;
  try{
    const saved=JSON.parse(storage?.getItem('pocket-paddock.garage.v1')??'null');
    const team=teams.find(t=>t.id===saved?.team),driver=team?.drivers.find(d=>d.id===saved?.driver);
    if(team&&driver){selectedTeam=team.id;selectedDriver=driver.id;}
  }catch{/* Ignore unavailable storage or an old/invalid selection. */}
  const chooseCar=(teamId:TeamId,driverId:DriverId)=>{
    const team=getTeam(teamId),driver=getDriver(driverId);
    if(driver.teamId!==team.id)return;
    selectedTeam=team.id;selectedDriver=driver.id;
    (scenery.userData.selectPitTeam as ((team:TeamId)=>void)|undefined)?.(team.id);
    car.select(team.id,driver);pitView.setCurrentCompound(pit.summary.currentCompound);ui.setTeam(team.id,driver.id);renderDirty=true;
    try{storage?.setItem('pocket-paddock.garage.v1',JSON.stringify({team:team.id,driver:driver.id}));}catch{}
  };
  chooseCar(selectedTeam,selectedDriver);
  const modeSelect=ui.el<HTMLSelectElement>('race-mode');modeSelect.value=mode;race.recordBests=mode==='time-trial';refreshCompetitionUI();
  modeSelect.onchange=()=>{if(race.state!=='menu'||!isRaceMode(modeSelect.value))return;mode=modeSelect.value;race.recordBests=mode==='time-trial';try{storage?.setItem('pocket-paddock.mode',mode);}catch{}input.clear();refreshCompetitionUI();ensureRivals();refreshModelStatus();modeSelect.blur();renderDirty=true;};
  ui.el<HTMLSelectElement>('team-select').onchange=()=>{
    const select=ui.el<HTMLSelectElement>('team-select'),team=teams.find(t=>t.id===select.value);
    if(team)chooseCar(team.id,team.drivers[0].id);
    select.blur();input.clear();
  };
  ui.el('driver-options').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-driver]');
    const driver=getTeam(selectedTeam).drivers.find(d=>d.id===button?.dataset.driver);
    if(driver){chooseCar(selectedTeam,driver.id);button?.blur();input.clear();}
  };
  ui.el<HTMLButtonElement>('start').disabled=true;
  function refreshModelStatus(){
    const needsGrid=mode==='race',gridLoading=needsGrid&&(rivalModels.status==='unloaded'||rivalModels.status==='loading'),gridFailed=needsGrid&&rivalModels.status==='failed';
    const loading=car.status==='loading'||gridLoading,fallback=car.status==='fallback'||needsGrid&&rivalModels.status==='fallback';
    const state=loading?'loading':fallback||gridFailed?'fallback':'ready';
    const key=gridFailed?'model.gridFailed':loading?(gridLoading?'model.gridLoading':'model.loading'):fallback?'model.fallback':'model.ready';
    ui.setModelStatus(state,ui.t(key));ui.el<HTMLButtonElement>('start').disabled=loading||gridFailed;
  }
  refreshModelStatus();
  ensureRivals();
  void car.load().then(()=>{
    pitView.setCurrentCompound(pit.summary.currentCompound);renderDirty=true;
    refreshModelStatus();
  });
  document.addEventListener('paddock-language',()=>{refreshModelStatus();ui.setSound(audio.enabled);ui.update(race,vehicle,track);refreshCompetitionUI();refreshCamera();ui.setPowertrain(powertrain.summary);refreshTyres();ui.setPit({...pit.summary,team:selectedTeam,compound:pit.summary.controlled?pit.summary.compound:nextPitCompound});lastPerformanceUI=0;renderDirty=true;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){race.pause();pitAudio.sync(pit.summary.serviceElapsed,false,1);input.clear();}});
  window.addEventListener('blur',()=>{race.pause();pitAudio.sync(pit.summary.serviceElapsed,false,1);});
  window.addEventListener('pagehide',event=>{if(!event.persisted){pitView.cancel();pitAudio.dispose();}});
  window.addEventListener('pageshow',event=>{
    if(!event.persisted||!revealScheduled)return;
    rememberArrival(circuitId);
    if(switchingCircuit){switchingCircuit=false;circuitSelect.value=circuitId;transition.hide();}
  });
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;chase.snap();applyQuality();});
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(3.1,5.2),new THREE.MeshBasicMaterial({map:contactShadow(),transparent:true,depthWrite:false,opacity:.42}));contact.rotation.x=-Math.PI/2;scene.add(contact);
  const targetGate=new THREE.Group();scene.add(targetGate);const gateMat=new THREE.MeshBasicMaterial({color:0xf0ca66,transparent:true,opacity:.6,depthWrite:false});
  for(const sign of [-1,1]){const p=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,3,6),gateMat);p.position.set(sign*7,1.5,0);targetGate.add(p);const top=new THREE.Mesh(new THREE.OctahedronGeometry(.5),gateMat);top.position.set(sign*7,3.4,0);targetGate.add(top);}
  const pitParking=new THREE.Group();pitParking.name='active-team-pit-parking-frame';
  const parkingMaterial=new THREE.MeshBasicMaterial({color:0xe5d695,transparent:true,opacity:.8,depthWrite:false});
  for(const side of [-1,1]){const a=new THREE.Mesh(new THREE.BoxGeometry(.07,.025,6.4),parkingMaterial);a.position.x=side*1.75;pitParking.add(a);const b=new THREE.Mesh(new THREE.BoxGeometry(3.55,.025,.07),parkingMaterial);b.position.z=side*3.2;pitParking.add(b);}scene.add(pitParking);pitParking.visible=false;
  place();
  let previous=performance.now(),accumulator=0;const fixed=1/120;
  let simulationMs=0,renderMs=0,lastCheckpoint=-1,appliedLightCount=-1,lastPerformanceUI=0;
  const snapshot=()=>({circuit:circuitId,elevation:heightAt(vehicle.x,vehicle.z),grade:track.gradeAt(track.nearest(vehicle.x,vehicle.z).distance),state:race.state,mode,camera:chase.summary,powertrain:powertrain.summary,tyres:vehicle.tires.summary,audio:audio.summary,aiModels:rivalModels.summary,pitClock:pitClock?.summary??null,pit:{...pit.summary,view:pitView.summary,audio:pitAudio.summary},competition:{...competitionInfo(),progress:competition.progress,time:opponents.time,rivals:opponents.rivals.map(r=>({...r}))},language:ui.language,weather:weather.summary,gamepad:input.gamepadSummary,drs:drs.summary,brakePressure:vehicle.brakePressure,throttlePressure:vehicle.throttlePressure,frontWheelAngle:vehicle.frontWheelAngle,recordKey:race.storageKey,car:car.summary,speed:vehicle.speed,speedKmh:Math.abs(vehicle.speed)*KMH_PER_SPEED_UNIT,x:vehicle.x,z:vehicle.z,heading:vehicle.heading,steering:vehicle.steering,surface:vehicle.surface,elapsed:race.elapsed,lap:race.lap,valid:race.valid,best:race.best,completed:race.completed,nextCheckpoint:race.nextCheckpoint,checkpointCount:track.checkpoints.length,distance:track.nearest(vehicle.x,vehicle.z).distance,trackLength:track.length,roadWidth:track.widthAt(track.nearest(vehicle.x,vehicle.z).distance),collision:vehicle.collision,gripUsage:vehicle.gripUsage,sliding:vehicle.sliding,lateralSpeed:vehicle.lateralSpeed,yawRate:vehicle.yawRate,quality:quality.summary,performance:{simulationMs,renderMs},renderer:{frame:renderer.info.render.frame,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,pixelRatio:renderer.getPixelRatio(),width:renderer.domElement.width,height:renderer.domElement.height}});
  let diagnostics:unknown;
  ui.el('diagnostics').onclick=()=>{
    if(race.state==='racing'||race.state==='countdown'){race.pause();input.clear();ui.update(race,vehicle,track);renderDirty=true;}
    diagnostics={version:'0.15.0',createdAt:new Date().toISOString(),origin:location.origin,protocol:location.protocol,secureContext:window.isSecureContext,browser:navigator.userAgent,graphics:{renderer:debugRenderer?String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)):String(gl.getParameter(gl.RENDERER)),vendor:debugRenderer?String(gl.getParameter(debugRenderer.UNMASKED_VENDOR_WEBGL)):String(gl.getParameter(gl.VENDOR)),hardwareThreads:navigator.hardwareConcurrency,deviceMemoryGB:(navigator as Navigator&{deviceMemory?:number}).deviceMemory??'unavailable',capability:graphicsCapability},game:snapshot(),samplingNote:'FPS samples driving/rain preview. A first render may include shader compilation; this local report is not automatically uploaded.'};
    ui.showDiagnostics(diagnostics);
  };
  ui.el('diagnostics-export').onclick=()=>{
    if(!diagnostics)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostics,null,2)],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download='Pocket-Paddock-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  let overview:string|null=null,appliedCameraView='';
  if(import.meta.env.DEV){
    const stands=scenery.userData.stands as StandLayout[];
    const setOverview=(id:string|null)=>{
      overview=id;camera.clearViewOffset();appliedCameraView='';if(id)scene.fog=null;renderDirty=true;
      if(!id){camera.near=.1;applyQuality();chase.snap();return;}
      const stand=stands.find(s=>s.id===id);
      const center=stand?new THREE.Vector3((stand.x+stand.target.x)/2,0,(stand.z+stand.target.z)/2):new THREE.Vector3(70,0,-65);
      if(circuitId!=='monza'&&!stand){const b=new THREE.Box3().setFromPoints(track.samples.map(s=>s.point));b.getCenter(center);}
      center.y=track.terrainHeightAt(center.x,center.z);
      camera.near=3;camera.far=circuitId!=='monza'?7000:1600;camera.fov=45;camera.position.copy(center).add(new THREE.Vector3(0,stand?165:circuitId!=='monza'?2400:850,.01));camera.lookAt(center);camera.updateProjectionMatrix();
    };
    const setCarView=(view:'front'|'side'|'rear'|null)=>{
      if(!view){setOverview(null);return;}
      overview=`car-${view}`;camera.clearViewOffset();appliedCameraView='';renderDirty=true;scene.fog=null;
      const forward=new THREE.Vector3(Math.sin(vehicle.heading),0,Math.cos(vehicle.heading));
      const right=new THREE.Vector3(Math.cos(vehicle.heading),0,-Math.sin(vehicle.heading));
      const center=new THREE.Vector3(vehicle.x,heightAt(vehicle.x,vehicle.z)+.9,vehicle.z);
      camera.position.copy(center).addScaledVector(forward,view==='front'?6.4:view==='rear'?-6.4:1).addScaledVector(right,view==='side'?6.5:3.3);
      camera.position.y=heightAt(vehicle.x,vehicle.z)+3.1;camera.near=.1;camera.fov=40;camera.lookAt(center);camera.updateProjectionMatrix();
    };
    const setSceneView=(view:'pits'|'fence'|'forest'|'centrale'|'paddock'|'courtyard'|'crane'|'medical'|'tyres'|'roggia'|'lesmo2'|'raidillon'|'eau-rouge'|null)=>{
      if(!view){setOverview(null);return;}
      overview=`scene-${view}`;camera.clearViewOffset();appliedCameraView='';scene.fog=null;renderDirty=true;camera.far=800;camera.fov=48;
      if(circuitId==='monaco'){
        const bay=track.monacoDrive!.pitBoxes[monacoPitIndex(selectedTeam)];camera.near=.3;camera.far=2200;
        camera.position.copy(bay.apronCenter).addScaledVector(bay.front,22).addScaledVector(bay.tangent,-34);camera.position.y+=16;camera.lookAt(bay.center.clone().add(new THREE.Vector3(0,5,0)));camera.updateProjectionMatrix();return;
      }
      if(circuitId==='spa'){
        camera.near=.3;camera.far=2200;
        if(view==='raidillon'||view==='centrale'||view==='eau-rouge'||view==='forest'){
          const feature=track.corners.find(c=>c.name.startsWith(view==='eau-rouge'?'Eau Rouge':'Raidillon'))!;
          const s=track.sampleAt(feature.distance),stand=(scenery.userData.stands as StandLayout[]).find(s=>s.id==='raidillon');
          camera.position.copy(s.point).addScaledVector(s.tangent,-65).addScaledVector(s.right,-24);camera.position.y=heightAt(camera.position.x,camera.position.z)+7;
          const look=stand?new THREE.Vector3((stand.x+s.point.x)/2,track.terrainHeightAt(stand.x,stand.z)+9,(stand.z+s.point.z)/2):s.point.clone().add(new THREE.Vector3(0,9,0));
          camera.lookAt(look);
        }else{camera.position.set(-106,22,290);camera.lookAt(-44,8,148);}
        camera.updateProjectionMatrix();return;
      }
      if(view==='pits'){camera.position.set(-111,14,151);camera.lookAt(-43,8,46);}
      if(view==='fence'){camera.position.set(-97,4.4,-82);camera.lookAt(-109,2,-145);}
      if(view==='centrale'){camera.position.set(-96,7,106);camera.lookAt(-125,5,35);}
      if(view==='paddock'){camera.position.set(24,13,116);camera.lookAt(-8,3,26);}
      if(view==='courtyard'){camera.position.set(-178,9,151);camera.lookAt(-147,1.8,119);}
      if(view==='forest'){const s=track.sampleAt(track.corners[5].distance-20);camera.position.copy(s.point).add(new THREE.Vector3(0,5,12));camera.lookAt(s.point.clone().addScaledVector(s.tangent,55));}
      if(view==='roggia'||view==='lesmo2'){const s=track.sampleAt(track.corners[view==='roggia'?2:4].distance);camera.position.copy(s.point).addScaledVector(s.tangent,-28);camera.position.y=30;camera.lookAt(s.point);}
      if(view==='crane'||view==='medical'){
        const layout=scenery.userData.tracksideSafety;
        const p=layout.vehicles.find((v:{kind:string})=>v.kind===(view==='crane'?'recovery-crane':'medical-van'));
        const right=new THREE.Vector3(Math.cos(p.yaw),0,-Math.sin(p.yaw)),forward=new THREE.Vector3(Math.sin(p.yaw),0,Math.cos(p.yaw));
        camera.position.set(p.x,view==='crane'?9:6,p.z).addScaledVector(right,view==='crane'?15:10).addScaledVector(forward,view==='crane'?17:12);
        camera.lookAt(p.x,view==='crane'?4:1.8,p.z);
      }
      if(view==='tyres'){
        const b=scenery.userData.tracksideSafety.tyreBarriers[1],s=track.sampleAt(b.distance);
        camera.position.copy(s.point).addScaledVector(s.right,b.side*14).addScaledVector(s.tangent,-13);camera.position.y=3;
        const target=s.point.clone().addScaledVector(s.right,b.side*22);target.y=.6;camera.lookAt(target);
      }
      camera.updateProjectionMatrix();
    };
    const setLandmarkView=(id:string)=>{
      const landmark=(scenery.userData.backgroundLandmarks as {id:string;x:number;z:number;yaw:number;width:number;depth:number;height:number}[]).find(l=>l.id===id);if(!landmark)return;
      overview=`landmark-${id}`;camera.clearViewOffset();appliedCameraView='';scene.fog=null;renderDirty=true;camera.far=800;camera.fov=48;
      const near=track.nearest(landmark.x,landmark.z).point,dx=near.x-landmark.x,dz=near.z-landmark.z,d=Math.hypot(dx,dz),range=Math.max(landmark.width,landmark.depth)*1.15;
      camera.position.set(landmark.x+dx/d*range,landmark.height*.85,landmark.z+dz/d*range);camera.lookAt(landmark.x,landmark.height*.35,landmark.z);camera.updateProjectionMatrix();
      if(id==='serraglio-gate'){camera.position.y=5.1;camera.lookAt(landmark.x,2.1,landmark.z);}
    };
    const setPitView=(view:'pit-wide'|'clock'|'garages')=>{
      overview=view;camera.clearViewOffset();appliedCameraView='';scene.fog=null;renderDirty=true;camera.far=800;camera.fov=48;
      if(circuitId==='monaco'){
        const bay=track.monacoDrive!.pitBoxes[monacoPitIndex(selectedTeam)];camera.near=.3;camera.far=2200;
        camera.position.copy(bay.apronCenter).addScaledVector(bay.front,view==='pit-wide'?45:14).addScaledVector(bay.tangent,view==='pit-wide'?-80:-12);camera.position.y+=view==='pit-wide'?65:9;camera.lookAt(bay.center.clone().add(new THREE.Vector3(0,view==='pit-wide'?8:3.5,0)));camera.updateProjectionMatrix();return;
      }
      if(circuitId==='spa'){
        camera.near=.3;
        if(view==='clock'){camera.position.set(-66,6.8,49);camera.lookAt(-63,10.7,76);}
        else if(view==='garages'){camera.position.set(-64,5.3,108);camera.lookAt(-45,4.4,172);}
        else{camera.position.set(35,66,310);camera.lookAt(-44,7,168);}
        camera.updateProjectionMatrix();return;
      }
      if(view==='pit-wide'){camera.position.set(-151,59,194);camera.lookAt(-43,6,22);}
      if(view==='clock'){camera.position.set(-66,5.4*ARCHITECTURE_HEIGHT_SCALE,151);camera.lookAt(-63,8.55*ARCHITECTURE_HEIGHT_SCALE,124);}
      if(view==='garages'){camera.position.set(-67,4.0,88);camera.lookAt(-48,3.5,38);}
      camera.updateProjectionMatrix();
    };
    (window as unknown as {__PP:unknown}).__PP={snapshot,track,race,vehicle,car,pit,pitView,pitAudio,viewCamera:camera,engineAudio:audio,rivalModels,architecture:scenery.userData.architecture,forest:scenery.userData.forest,tracksideSafety:scenery.userData.tracksideSafety,pitComplex:scenery.userData.pitComplex,pitClock,stands,landmarks:scenery.userData.landmarks,backgroundLandmarks:scenery.userData.backgroundLandmarks,circuitProps:scenery.userData.circuitProps,drsZones,steerYaw:(speed:number)=>track.steeringAngleForSpeed?speed/WHEELBASE*Math.tan(track.steeringAngleForSpeed(speed)):fullSteerYawForSpeed(speed),setOverview,setCarView,setSceneView,setLandmarkView,setPitView,setQuality,get quality(){return quality.summary;}};
  }
  let lastGamepadStatus='';
  function frame(now:number){
    requestAnimationFrame(frame);const frameMs=now-previous,dt=Math.min(frameMs/1000,.08);previous=now;
    input.pollGamepad();
    const gamepad=input.gamepadSummary,gamepadStatus=JSON.stringify(gamepad);
    if(gamepadStatus!==lastGamepadStatus){ui.setGamepad(gamepad);lastGamepadStatus=gamepadStatus;}
    const active=race.state==='racing'||race.state==='countdown'||classifying();
    const rainPreview=weather.mode==='rainy'&&race.state==='menu'&&!document.hidden;
    quality.observe(frameMs,(active||rainPreview)&&!document.hidden);
    const simulationStart=performance.now();
    let contactSpeed=0;
    if(active){
      accumulator+=dt;
      while(accumulator>=fixed){
        if(race.state==='finished'){
          if(classifying()){opponents.setPlayerObstacle(null);opponents.update(fixed,weather.mode);recordIntervals();}
          accumulator-=fixed;continue;
        }
        if(race.state==='racing'){
          const controls=input.controls,wasControlled=pit.summary.controlled;
          pitControlled=pit.update(fixed,vehicle,selectedTeam,nextPitCompound);
          if(pitControlled&&!wasControlled){input.clear();vehicle.clearImpact();}
          const service=pit.summary;
          if(service.completedStops>fittedPitStops){
            fittedPitStops=service.completedStops;vehicle.tires.fit(service.currentCompound,weather.mode);
          }
          refreshDrs(controls);if(!pitControlled)contactSpeed=Math.max(contactSpeed,vehicle.update(fixed,controls,track));
          if(mode==='race'){
            opponents.setPlayerObstacle({x:vehicle.x,z:vehicle.z,heading:vehicle.heading,speed:vehicle.speed,finished:competition.finished,pitLane:service.active||service.limited});
            opponents.update(fixed,weather.mode);
            if(!pitControlled){
              const impact=opponents.contactPlayer(vehicle,fixed);
              vehicle.receiveContact(impact);contactSpeed=Math.max(contactSpeed,impact);
            }
          }
          // Enforce the governor after manual acceleration and contacts, then
          // certify only the pit distance physically driven on this step.
          pit.afterPhysics(fixed,vehicle);
        }
        const pedals=input.controls;
        powertrain.update(fixed,{speed:vehicle.speed,throttle:race.state==='countdown'?(pedals.throttleAmount??Number(pedals.throttle)):vehicle.throttlePressure,brake:pitControlled?vehicle.brakePressure:pedals.brakeAmount??Number(pedals.brake),active:race.state==='racing'||race.state==='countdown'});
        const sample=track.nearest(vehicle.x,vehicle.z);
        const lateral=Math.hypot(vehicle.x-sample.point.x,vehicle.z-sample.point.z);
        const pitProgress=pit.summary,raceDistance=pitProgress.legalPit?pitProgress.raceDistance:sample.distance;
        const speed=Math.hypot(vehicle.vx,vehicle.vz);
        const forward=speed>.1?(vehicle.vx*sample.tangent.x+vehicle.vz*sample.tangent.z)/speed:0;
        race.update(fixed,raceDistance,lateral,pitProgress.legalPit?pitProgress.forward:forward,pitProgress.legalPit);
        if(mode==='race'&&race.state==='racing'){
          competition.update(race,raceDistance,opponents.time);
          recordIntervals();
          if(competition.finished){cancelPit();race.state='finished';input.clear();vehicle.speed=vehicle.vx=vehicle.vz=0;vehicle.throttlePressure=vehicle.brakePressure=0;vehicle.drsActive=false;drs.reset();car.setDrs(false,true);renderDirty=true;}
        }
        accumulator-=fixed;
      }
    }else accumulator=0;
    if(active)refreshDrs(input.controls);
    simulationMs=performance.now()-simulationStart;
    if(lastState!==race.state)renderDirty=true;
    if(lastState==='countdown'&&race.state==='racing')ui.toastKey('toast.go');lastState=race.state;
    if(race.completed>shownResult){
      shownResult=race.completed;const result=race.result!;
      ui.toastKey(classifying()?'toast.classifying':!result.valid?'toast.lapInvalid':result.penalty?'toast.lapPenalty':result.best?'toast.lapBest':'toast.lapComplete',{time:formatTime(result.time),seconds:result.penalty});
    }else if(race.penaltyCount>shownPenaltyCount){ui.toastKey('toast.trackPenalty',{seconds:TRACK_LIMIT_PENALTY_SECONDS});}
    shownPenaltyCount=race.penaltyCount;
    collisionCooldown=Math.max(0,collisionCooldown-dt);
    if(vehicle.collision>.9&&collisionCooldown<=0){collisionCooldown=3;ui.toastKey('toast.collision');input.rumble();}
    if(contactSpeed>1.2){audio.playContact(contactSpeed);chase.bump(contactSpeed);}
    audio.setPowertrain(powertrain.summary,race.state==='racing'||race.state==='countdown');
    const pitState=pit.summary,servicing=pitState.state==='service';
    if(servicing&&!pitServiceArmed){pitServiceArmed=true;pitAudio.setDuration(pitState.serviceDuration);pitView.begin(pitState.team,pitState.compound,pitState.stop.y);}
    if(!servicing&&pitServiceArmed){if(pitState.completedStops>lastPitCompleted)pitView.finish();else pitView.cancel();pitServiceArmed=false;}
    lastPitCompleted=pitState.completedStops;pitAudio.sync(servicing?pitState.serviceElapsed:0,servicing&&race.state==='racing',1);
    if(now-lastUI>(active?100:250)){ui.update(race,vehicle,track);refreshCompetitionUI();ui.setPowertrain(powertrain.summary);ui.setDrs(drs.summary);refreshTyres();ui.setPit({...pit.summary,team:selectedTeam,compound:pit.summary.controlled?pit.summary.compound:nextPitCompound});ui.el('throttle-led').classList.toggle('active',pitState.controlled?vehicle.throttlePressure>.01:input.controls.throttle);ui.el('brake-led').classList.toggle('active',pitState.controlled?vehicle.brakePressure>.01:input.controls.brake);lastUI=now;}
    if(now-lastPerformanceUI>700){ui.text('fps',(active||rainPreview)&&quality.fps?`${quality.fps} FPS`:'— FPS');ui.el('fps').title=`${ui.t(`quality.${quality.profile.level}`)} · ${renderer.domElement.width} × ${renderer.domElement.height}`;lastPerformanceUI=now;}
    // The garage and paused frame are static. Settings/resize mark them dirty.
    if(!active&&!renderDirty&&!overview&&!rainPreview)return;
    const surfacePose=roadPose(track,vehicle.x,vehicle.z,vehicle.heading);
    car.group.position.set(vehicle.x,surfacePose.height,vehicle.z);car.group.rotation.set(surfacePose.pitch,vehicle.heading,car.group.rotation.z,'YXZ');
    const animationDt=race.state==='paused'||race.state==='finished'?0:dt;
    car.setDrs(drs.summary.active);car.update(race.state==='racing'?vehicle.speed:0,vehicle.steering,animationDt,vehicle.frontWheelAngle);
    const bodyRoll=race.state==='racing'?-vehicle.steering*Math.min(Math.abs(vehicle.speed)/40,1)*.035:0;
    car.group.rotation.z=servicing?0:THREE.MathUtils.lerp(car.group.rotation.z,bodyRoll,animationDt*7);
    if(servicing)pitView.setProgress(pitState.progress,pitState.stop.y);
    contact.position.set(vehicle.x,surfacePose.height-.006,vehicle.z);contact.rotation.set(-Math.PI/2,0,-vehicle.heading);
    if(surfacePose.pitch)contact.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(vehicle.heading),0,-Math.sin(vehicle.heading)),surfacePose.pitch));
    if(!overview){
      const menu=race.state==='menu',composition=menu?`${innerWidth}/${innerHeight}`:'race';
      if(composition!==appliedCameraView){
        if(menu){const stageCenter=innerWidth<=800?(innerWidth>innerHeight?.28:.5):.35;camera.setViewOffset(innerWidth,innerHeight,(.5-stageCenter)*innerWidth,0,innerWidth,innerHeight);}else camera.clearViewOffset();
        appliedCameraView=composition;
      }
      if(servicing){
        if(!pitCamera){pitCamera=true;chase.snap();}
        const scale=Math.max(1,.85/camera.aspect),side=circuitId==='monaco'?1:-1;
        camera.position.copy(car.group.position).add(new THREE.Vector3(side*9,6.1,9).multiplyScalar(scale));camera.lookAt(vehicle.x,pitState.stop.y+.8,vehicle.z);camera.fov=43;camera.updateProjectionMatrix();
      }else{if(pitCamera){pitCamera=false;chase.snap();}chase.update(car.group.position,vehicle.heading,vehicle.speed,animationDt,menu);}
    }
    if(!overview&&circuitId!=='monza')camera.position.y=Math.max(camera.position.y,heightAt(camera.position.x,camera.position.z)+.8);
    weather.update(race.state==='paused'?0:dt,camera,car.group.position,vehicle.speed,vehicle.heading);
    skidMarks.update(vehicle,dt,race.state==='racing'&&!pitState.active,circuitId!=='monza'?heightAt:undefined);
    if(vehicle.collision>.1&&race.state==='racing')camera.position.x+=Math.sin(now*.08)*vehicle.collision*.07;
    sun.target.position.set(vehicle.x,surfacePose.height,vehicle.z);sun.position.set(vehicle.x-35,surfacePose.height+65,vehicle.z+25);sun.target.updateMatrixWorld();
    if(lastCheckpoint!==race.nextCheckpoint){const target=track.sampleAt(track.checkpoints[race.nextCheckpoint]??0);targetGate.position.copy(target.point);targetGate.rotation.y=Math.atan2(target.tangent.x,target.tangent.z);lastCheckpoint=race.nextCheckpoint;}
    targetGate.visible=race.state==='racing'&&!pitState.active;
    pitParking.visible=pitState.active&&pitState.state!=='exit';if(pitParking.visible){pitParking.position.set(pitState.stop.x,pitState.stop.y+.065,pitState.stop.z);pitParking.rotation.y=pitState.stop.heading;}
    const lightCount=race.state==='countdown'?Math.min(5,Math.floor(race.countdown/.6)+1):0;
    if(appliedLightCount!==lightCount){startLights.forEach(mesh=>{const i=Number(mesh.name.split('-').at(-1));const m=mesh.material as THREE.MeshStandardMaterial;m.color.set(i<lightCount?0xff3025:0x402f2c);m.emissive?.set(i<lightCount?0xed2115:0x000000);});appliedLightCount=lightCount;}
    rivalModels.update(opponents.rivals,active?dt:animationDt);pitClock?.update(animationDt);
    const renderStart=performance.now();renderer.render(scene,camera);renderMs=performance.now()-renderStart;renderDirty=false;
    if(!loading.hidden&&!switchingCircuit&&!revealScheduled&&car.status!=='loading'){
      revealScheduled=true;
      requestAnimationFrame(()=>{
        if(!switchingCircuit)void transition.reveal(circuitId,firstArrival).then(()=>rememberArrival(circuitId));
      });
    }
  }
  requestAnimationFrame(frame);
}
function contactShadow(){const c=document.createElement('canvas');c.width=128;c.height=128;const ctx=c.getContext('2d')!;const gradient=ctx.createRadialGradient(64,64,12,64,64,64);gradient.addColorStop(0,'rgba(13,38,31,.8)');gradient.addColorStop(1,'rgba(13,38,31,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
async function startPaddock(){
  try{
    if(firstArrival&&!isCircuitId(requested)){
      circuitId=await transition.choose(preferred);
      ui.setCircuit(circuitId);
      launchUrl.searchParams.set('circuit',circuitId);
      if(location.protocol!=='file:')try{history.replaceState(history.state,'',launchUrl);}catch{}
    }
    if(firstArrival||lastArrival!==circuitId){
      const origin=lastArrival?TRAVEL_DESTINATIONS[lastArrival]:DANZHOU;
      await transition.journey(circuitId,origin);
    }else transition.prepare(circuitId);
    // Paint the completed circuit outline before building the scenery on the main thread.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    boot();
  }catch(error){
    console.error(error);transition.hide();const box=document.createElement('section');box.className='error-box';const h=document.createElement('h2'),p=document.createElement('p'),button=document.createElement('button');const translate=()=>{h.textContent=ui.t('error.title');p.textContent=ui.t('error.body',{error:String(error)});button.textContent=ui.t('error.reload');};translate();document.addEventListener('paddock-language',translate);button.onclick=()=>location.reload();box.append(h,p,button);ui.root.append(box);
  }
}
void startPaddock();
