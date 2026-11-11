import './race-control-preview.css';
import { CIRCUITS, isCircuitId, type CircuitId } from './circuits';
import type { RaceMode } from './competition';
import type { Language } from './i18n';
import type { TireCompound } from './tire-physics';
import { getDriver, getTeam, isDriverId, isTeamId, teams, type DriverId, type TeamId } from './team-catalog';
import { RaceControlStage, type RaceControlView } from './race-control-stage';
import { installRaceControlGamepad } from './race-control-gamepad';
import travelData from './travel-map-data.json';
import { DANZHOU, TRAVEL_DESTINATIONS } from './travel-map';
import { TravelTransition } from './travel-transition';

type Settings = {
  circuit: CircuitId;
  team: TeamId;
  driver: DriverId;
  mode: RaceMode;
  compound: TireCompound;
  sound: boolean;
  language: Language;
  weather: 'sunny' | 'rainy';
};

declare global {
  interface Window {
    startRaceControlGame(frame: HTMLIFrameElement, settings: Settings): Promise<void>;
  }
}

const app = document.querySelector<HTMLElement>('#race-control-preview')!;
app.innerHTML = `
  <div class="rc-app" id="rc-app">
    <header class="rc-header">
      <div class="rc-brand"><span class="rc-brand-mark" aria-hidden="true">pp<i></i></span><span>Pocket Paddock</span></div>
      <div class="rc-header-actions">
        <div class="rc-lang" role="group" aria-label="Language">
          <button type="button" lang="en" data-language="en" aria-pressed="true">EN</button>
          <span aria-hidden="true">/</span>
          <button type="button" lang="zh-CN" data-language="zh" aria-pressed="false">中文</button>
        </div>
        <button type="button" class="rc-sound" id="rc-sound" aria-pressed="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" width="18" height="18"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 8a6 6 0 0 1 0 8m2.5-10a9 9 0 0 1 0 12"/></svg><span id="rc-sound-label"></span>
        </button>
      </div>
    </header>
    <main class="rc-layout">
      <section class="rc-stage is-loading" id="rc-stage" aria-labelledby="rc-title">
        <div class="rc-stage-canvas" id="rc-stage-canvas" role="img"></div>
        <div class="rc-stage-title"><h1 id="rc-title">RACE<br>CONTROL</h1></div>
        <p class="rc-stage-status" id="rc-stage-status" role="status"></p>
        <div class="rc-stage-controls">
          <label class="rc-driver-tag"><span id="rc-driver-number" aria-hidden="true"></span><select id="rc-driver" aria-label="Driver"></select></label>
          <div class="rc-view-group" id="rc-view-group" role="group" aria-label="Car view">
            <button type="button" data-view="front" aria-pressed="true"></button>
            <button type="button" data-view="side" aria-pressed="false"></button>
            <button type="button" data-view="rear" aria-pressed="false"></button>
          </div>
        </div>
      </section>
      <section class="rc-panel" aria-labelledby="rc-circuit-name">
        <div class="rc-brief">
          <p class="rc-eyebrow" id="rc-briefing"></p>
          <h2 id="rc-circuit-name"></h2>
          <p class="rc-country"><span class="rc-country-flag" id="rc-flag" aria-hidden="true"></span><span id="rc-country"></span><span id="rc-length"></span></p>
        </div>
        <svg class="rc-track-map" id="rc-track-map" viewBox="0 0 360 144" role="img" aria-label="Monza circuit outline">
          <path class="rc-map-shadow" id="rc-map-shadow" fill="none"></path>
          <path class="rc-map-line" id="rc-map-line" fill="none" pathLength="1"></path>
          <g class="rc-start-marker" id="rc-start-marker"><circle r="6" fill="#10232c" stroke="currentColor" stroke-width="2"/><circle r="2" fill="currentColor"/></g>
        </svg>
        <div class="rc-fields">
          <label class="rc-field"><span id="rc-circuit-label"></span><select id="rc-circuit"></select></label>
          <label class="rc-field"><span id="rc-team-label"></span><select id="rc-team"></select></label>
          <label class="rc-field"><span id="rc-mode-label"></span><select id="rc-mode"></select></label>
          <label class="rc-field"><span id="rc-tyres-label"></span><select id="rc-tyres"></select></label>
        </div>
        <button class="rc-launch" id="rc-launch" type="button" disabled><span id="rc-launch-label"></span><span aria-hidden="true">→</span></button>
        <p class="rc-panel-status" id="rc-panel-status" role="status" hidden></p>
        <p class="rc-gamepad-status" id="rc-gamepad-status" role="status" hidden></p>
      </section>
    </main>
  </div>
  <section id="loading" class="rc-travel" hidden></section>
  <section class="rc-play" id="rc-play" hidden>
    <header class="rc-play-bar"><button type="button" id="rc-return"></button><span>Pocket Paddock</span></header>
    <iframe id="rc-game" allow="autoplay; gamepad" title="Pocket Paddock"></iframe>
    <p class="rc-play-loading" id="rc-play-status" role="status" hidden></p>
  </section>`;

function element<T extends HTMLElement | SVGElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

const menu = element('rc-app');
const stageHost = element('rc-stage');
const stageStatus = element('rc-stage-status');
const panelStatus = element('rc-panel-status');
const map = element<SVGSVGElement>('rc-track-map');
const circuitSelect = element<HTMLSelectElement>('rc-circuit');
const teamSelect = element<HTMLSelectElement>('rc-team');
const driverSelect = element<HTMLSelectElement>('rc-driver');
const modeSelect = element<HTMLSelectElement>('rc-mode');
const tyresSelect = element<HTMLSelectElement>('rc-tyres');
const launchButton = element<HTMLButtonElement>('rc-launch');
const play = element('rc-play');
const playStatus = element('rc-play-status');
const gameFrame = element<HTMLIFrameElement>('rc-game');
const returnButton = element<HTMLButtonElement>('rc-return');
const circuitIds = Object.keys(CIRCUITS) as CircuitId[];
const views = [...menu.querySelectorAll<HTMLButtonElement>('[data-view]')];
const languages = [...menu.querySelectorAll<HTMLButtonElement>('[data-language]')];
const countryEn: Record<CircuitId, string> = { monza: 'Italy', spa: 'Belgium', monaco: 'Monaco' };
const flags: Record<CircuitId, string> = {
  monza: 'linear-gradient(90deg,#169a68 33.3%,#f5f4e7 33.3% 66.6%,#e34746 66.6%)',
  spa: 'linear-gradient(90deg,#181820 33.3%,#ffcf45 33.3% 66.6%,#eb484a 66.6%)',
  monaco: 'linear-gradient(#e9434b 50%,#f5f4e7 50%)',
};

const settings: Settings = {
  circuit: 'monza', team: 'mclaren', driver: 'lando_norris_04', mode: 'race',
  compound: 'medium', sound: true, language: 'en', weather: 'sunny',
};
const arrivalKey = 'pocket-paddock.race-control.arrival';
let arrival: CircuitId | undefined;
try {
  const saved = sessionStorage.getItem(arrivalKey);
  if (isCircuitId(saved)) settings.circuit = arrival = saved;
} catch { /* The preview can start with storage disabled. */ }
let stage: RaceControlStage | undefined;
let initialCar: Promise<void> | undefined;
let modelRequest = 0;
let modelState: 'loading' | 'ready' | 'error' = 'loading';
let busy = false;
let playRequest = 0;

const local = (en: string, zh: string) => settings.language === 'zh' ? zh : en;
const circuitName = (id: CircuitId) => local(CIRCUITS[id].name, CIRCUITS[id].zh);
const setText = (id: string, value: string) => { element(id).textContent = value; };
const travelLayer = element('loading');
const travel = new TravelTransition(travelLayer, menu, () => settings.language);

function options<T extends string>(select: HTMLSelectElement, items: readonly [T, string][], selected: T) {
  select.replaceChildren(...items.map(([value, text]) => new Option(text, value, false, value === selected)));
}

function updateCarLabels() {
  const team = getTeam(settings.team);
  const driver = getDriver(settings.driver);
  menu.style.setProperty('--rc-accent', team.color);
  setText('rc-driver-number', `#${String(driver.number).padStart(2, '0')}`);
  options(driverSelect, team.drivers.map(item => [item.id, local(item.name, item.label)]), driver.id);
  element('rc-stage-canvas').setAttribute('aria-label', `${local(team.name, team.label)} · ${local(driver.name, driver.label)}`);
}

function updateModelStatus() {
  stageHost.classList.toggle('is-loading', modelState === 'loading' && modelRequest <= 1);
  stageHost.classList.toggle('is-switching', modelState === 'loading' && modelRequest > 1);
  stageStatus.hidden = modelState === 'ready';
  stageStatus.textContent = modelState === 'error'
    ? local('The 3D car could not load. Try another team or reload.', '无法加载 3D 赛车。请尝试切换车队或刷新页面。')
    : local('Loading car and helmet…', '正在加载赛车和头盔…');
  launchButton.disabled = modelState !== 'ready' || busy;
}

function updateBriefing() {
  const id = settings.circuit;
  const circuit = CIRCUITS[id];
  setText('rc-circuit-name', local(id === 'spa' ? 'SPA' : circuit.code, circuit.zh));
  setText('rc-country', local(countryEn[id], circuit.countryZh));
  setText('rc-length', `${(circuit.realLength / 1000).toFixed(3)} km`);
  element('rc-flag').style.background = flags[id];
  map.setAttribute('aria-label', local(`${circuit.name} circuit outline`, `${circuit.zh}赛道线路图`));
  circuitSelect.value = id;
}

function drawTrack() {
  const outline = travelData.outlines[settings.circuit];
  const xs = outline.map(point => point[0]);
  const ys = outline.map(point => point[1]);
  const rotate = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
  const points = outline.map(([x, y]) => rotate ? [y, -x] : [x, y]);
  const east = points.map(point => point[0]);
  const north = points.map(point => point[1]);
  const left = Math.min(...east), right = Math.max(...east);
  const top = Math.min(...north), bottom = Math.max(...north);
  const scale = Math.min(316 / (right - left), 113 / (bottom - top));
  const projected = points.map(([x, y]) => [180 + (x - (left + right) / 2) * scale, 72 + (y - (top + bottom) / 2) * scale]);
  const path = `M${projected.map(point => point.map(value => value.toFixed(2)).join(' ')).join('L')}Z`;
  element<SVGPathElement>('rc-map-shadow').setAttribute('d', path);
  element<SVGPathElement>('rc-map-line').setAttribute('d', path);
  element<SVGGElement>('rc-start-marker').setAttribute('transform', `translate(${projected[0].join(' ')})`);
  map.dataset.circuit = settings.circuit;
}

function traceTrack() {
  map.classList.remove('is-tracing');
  map.getBoundingClientRect();
  map.classList.add('is-tracing');
}

function updateLanguage() {
  document.documentElement.lang = settings.language === 'en' ? 'en' : 'zh-CN';
  languages.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === settings.language)));
  element('rc-title').replaceChildren(...(settings.language === 'en' ? ['RACE', document.createElement('br'), 'CONTROL'] : ['发车指挥台']));
  setText('rc-briefing', local('Circuit briefing', '赛道简报'));
  setText('rc-circuit-label', local('Circuit', '赛道'));
  setText('rc-team-label', local('Team', '车队'));
  setText('rc-mode-label', local('Mode', '比赛模式'));
  setText('rc-tyres-label', local('Tyres', '发车轮胎'));
  setText('rc-launch-label', local('Enter circuit', '驶入赛道'));
  returnButton.textContent = local('← Back to preview', '← 返回首页预览');
  const viewNames = { front: local('Front', '前侧'), side: local('Side', '侧面'), rear: local('Rear', '车尾') };
  views.forEach(button => { button.textContent = viewNames[button.dataset.view as RaceControlView]; });
  element('rc-view-group').setAttribute('aria-label', local('Car view', '观车视角'));
  driverSelect.setAttribute('aria-label', local('Driver', '车手'));
  options(circuitSelect, circuitIds.map(id => [id, circuitName(id)]), settings.circuit);
  options(teamSelect, teams.map(team => [team.id, local(team.name, team.label)]), settings.team);
  options(modeSelect, [['race', local('AI Race', '人机竞速')], ['time-trial', local('Time Trial', '自由计时')]], settings.mode);
  options(tyresSelect, [['soft', local('Soft', '软胎')], ['medium', local('Medium', '中性胎')], ['hard', local('Hard', '硬胎')], ['wet', local('Wet', '雨胎')]], settings.compound);
  updateSound();
  updateCarLabels();
  updateBriefing();
  updateModelStatus();
}

function updateSound() {
  element('rc-sound').setAttribute('aria-pressed', String(settings.sound));
  setText('rc-sound-label', settings.sound ? local('Sound', '声音开') : local('Sound off', '声音关'));
}

async function loadCar() {
  if (!stage) return;
  const request = ++modelRequest;
  modelState = 'loading';
  updateModelStatus();
  let ready = false;
  try { ready = await stage.setCar(settings.team, settings.driver); }
  catch { /* The status below stays visible if the model cannot load. */ }
  if (request !== modelRequest) return;
  modelState = ready ? 'ready' : 'error';
  updateModelStatus();
}

async function flyTo(id: CircuitId) {
  if (busy) return false;
  busy = true;
  updateModelStatus();
  panelStatus.hidden = true;
  const previous = settings.circuit;
  const first = arrival === undefined;
  try {
    await travel.journey(id, arrival ? TRAVEL_DESTINATIONS[arrival] : DANZHOU);
    if (first) await initialCar;
    settings.circuit = id;
    updateBriefing();
    drawTrack();
    await travel.reveal(id, first);
    if (first) stage?.playEntrance();
    arrival = id;
    try { sessionStorage.setItem(arrivalKey, id); } catch { /* Keep the arrival in memory. */ }
    traceTrack();
    return true;
  } catch {
    settings.circuit = previous;
    panelStatus.textContent = local('The transition could not finish. Please try again.', '赛道过场未完成，请重试。');
    panelStatus.hidden = false;
    updateBriefing();
    drawTrack();
    return false;
  } finally {
    travel.hide();
    busy = false;
    updateModelStatus();
  }
}

function returnToPreview() {
  playRequest++;
  gameFrame.removeAttribute('srcdoc');
  play.hidden = true;
  menu.inert = false;
  launchButton.focus({ preventScroll: true });
}

async function launchGame() {
  if (busy || modelState !== 'ready' || !play.hidden) return;
  if (arrival !== settings.circuit && !(await flyTo(settings.circuit))) return;
  const request = ++playRequest;
  panelStatus.hidden = true;
  play.hidden = false;
  menu.inert = true;
  playStatus.hidden = false;
  playStatus.textContent = local(`Preparing ${circuitName(settings.circuit)}…`, `正在载入${circuitName(settings.circuit)}…`);
  returnButton.focus({ preventScroll: true });
  try {
    await window.startRaceControlGame(gameFrame, { ...settings });
    if (request !== playRequest) return;
    playStatus.hidden = true;
    gameFrame.focus();
  } catch {
    if (request !== playRequest) return;
    returnToPreview();
    panelStatus.textContent = local('The race could not start. You can retry here.', '比赛未能启动，可以在这里重试。');
    panelStatus.hidden = false;
  }
}

languages.forEach(button => button.addEventListener('click', () => {
  settings.language = button.dataset.language === 'zh' ? 'zh' : 'en';
  updateLanguage();
}));
element('rc-sound').addEventListener('click', () => { settings.sound = !settings.sound; updateSound(); });
teamSelect.addEventListener('change', () => {
  if (!isTeamId(teamSelect.value)) return;
  settings.team = teamSelect.value;
  settings.driver = getTeam(settings.team).drivers[0].id;
  updateCarLabels();
  void loadCar();
});
driverSelect.addEventListener('change', () => {
  if (!isDriverId(driverSelect.value) || getDriver(driverSelect.value).teamId !== settings.team) return;
  settings.driver = driverSelect.value;
  updateCarLabels();
  void loadCar();
});
circuitSelect.addEventListener('change', async () => {
  const next = circuitIds.find(id => id === circuitSelect.value);
  if (next && next !== settings.circuit) await flyTo(next);
  circuitSelect.focus({ preventScroll: true });
});
modeSelect.addEventListener('change', () => { settings.mode = modeSelect.value === 'time-trial' ? 'time-trial' : 'race'; });
tyresSelect.addEventListener('change', () => {
  settings.compound = tyresSelect.value as TireCompound;
});
views.forEach(button => button.addEventListener('click', () => {
  stage?.setView(button.dataset.view as RaceControlView);
  views.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
launchButton.addEventListener('click', () => { void launchGame(); });
returnButton.addEventListener('click', returnToPreview);

updateLanguage();
drawTrack();
const firstChoice = arrival === undefined ? travel.choose(settings.circuit) : undefined;
try {
  stage = new RaceControlStage(element('rc-stage-canvas'), firstChoice !== undefined);
  initialCar = loadCar();
} catch {
  modelState = 'error';
  updateModelStatus();
}
if (firstChoice) void firstChoice.then(async circuit => {
  await flyTo(circuit);
  circuitSelect.focus({ preventScroll: true });
});
else traceTrack();

installRaceControlGamepad({
  menu, travel: travelLayer, isPlaying: () => !play.hidden, getLanguage: () => settings.language,
  status: element('rc-gamepad-status'),
});
