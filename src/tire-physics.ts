import type {WeatherMode} from './conditions';
import {WHEELBASE} from './handling';
import type {Surface} from './physics';

export type TireCompound = 'soft' | 'medium' | 'hard' | 'wet';

interface CompoundProfile {
  dryGrip: number;
  rainGrip: number;
  drySpeed: number;
  rainSpeed: number;
  wearPerUnit: number;
  optimalTemperature: number;
  temperatureWindow: number;
  heatRate: number;
}

// Calibrated for the game's shortened circuits and speed scale.
const profiles: Readonly<Record<TireCompound, CompoundProfile>> = {
  soft:   {dryGrip:1.065,rainGrip:.92,drySpeed:1.024,rainSpeed:.985,wearPerUnit:.000234,optimalTemperature:88,temperatureWindow:9,heatRate:1.12},
  medium: {dryGrip:1,    rainGrip:.88,drySpeed:1,    rainSpeed:.970,wearPerUnit:.000143,optimalTemperature:91,temperatureWindow:12,heatRate:1},
  hard:   {dryGrip:.955, rainGrip:.83,drySpeed:.983, rainSpeed:.955,wearPerUnit:.000092,optimalTemperature:97,temperatureWindow:14,heatRate:.87},
  wet:    {dryGrip:.86,  rainGrip:1.12,drySpeed:.949,rainSpeed:1,   wearPerUnit:.000122,optimalTemperature:66,temperatureWindow:16,heatRate:1.04},
};

export interface TireWheel {
  /** Normal force in units of vehicle weight. Downforce adds to the total. */
  load: number;
  temperature: number;
  wear: number;
  slipRatio: number;
  /** Signed contact patch slip angle in radians. Positive force points right. */
  slipAngle: number;
  /** Tire-axis longitudinal and lateral force divided by vehicle mass. */
  forceX: number;
  forceY: number;
}

export interface TireSummary {
  compound: TireCompound;
  wear: number;
  remaining: number;
  temperature: number;
  gripMultiplier: number;
  speedMultiplier: number;
  /** Front left, front right, rear left, rear right. */
  wheels: readonly Readonly<TireWheel>[];
}

export interface TireStepInput {
  dt: number;
  speed: number;
  lateralSpeed: number;
  yawRate: number;
  steerAngle: number;
  longitudinalDemand: number;
  lateralDemand: number;
  /** Baseline acceleration budgets including surface, weather and aero. */
  longitudinalGrip: number;
  lateralGrip: number;
  weather: WeatherMode;
  surface: Surface;
}

export interface TireForces {
  longitudinalAcceleration: number;
  lateralAcceleration: number;
  lateralLimit: number;
  gripUsage: number;
  sliding: boolean;
  speedMultiplier: number;
}

const frontWeight = .46;
const frontOffset = WHEELBASE * (1 - frontWeight);
const rearOffset = -WHEELBASE * frontWeight;
const halfTrack = .95;
const clamp = (n:number,min:number,max:number) => Math.max(min,Math.min(max,n));
const finite = (n:number) => Number.isFinite(n) ? n : 0;

// Normalized Magic Formula shape, using the slip where force reaches its peak.
// Pacejka & Besselink (1997), https://doi.org/10.1080/00423119708969658
const shape = 1.35;
const peakTangent = Math.tan(Math.PI / (2 * shape));
function slipResponse(slip:number,peak:number):number {
  return Math.sin(shape * Math.atan(peakTangent * slip / peak));
}

function temperatureGrip(temperature:number,profile:CompoundProfile):number {
  const difference = temperature - profile.optimalTemperature;
  const outside = Math.max(0,Math.abs(difference) - profile.temperatureWindow);
  return Math.max(.74,1 - outside * (difference > 0 ? .004 : .0028));
}

function treadGrip(wear:number):number {
  return 1 - .10 * wear - .22 * wear * wear;
}

const wetOnDryAbrasion = 1.85;

/** Speed drops progressively over the last ten percent of tire life. */
export function tireSpeedFalloff(wear:number):number {
  const progress=clamp((wear-.90)/.10,0,1);
  return progress*progress*(3-2*progress);
}

const treadSpeed = (wear:number) => 1 - .10 * wear - .35 * tireSpeedFalloff(wear);

/** Clean-asphalt reference at operating temperature for race strategy. */
export function predictTireCondition(compound:TireCompound,weather:WeatherMode,wear:number) {
  const profile = profiles[compound];
  const rainy = weather === 'rainy';
  const worn = clamp(finite(wear),0,1);
  return {
    gripMultiplier:(rainy ? profile.rainGrip : profile.dryGrip) * treadGrip(worn),
    speedMultiplier:(rainy ? profile.rainSpeed : profile.drySpeed) * treadSpeed(worn),
    wearPerUnit:profile.wearPerUnit * .81 * (compound === 'wet' && !rainy ? wetOnDryAbrasion : 1),
  };
}

export class TireSet {
  private readonly wheels:TireWheel[] = Array.from({length:4},()=>({
    load:0,temperature:0,wear:0,slipRatio:0,slipAngle:0,forceX:0,forceY:0,
  }));
  private readonly state:TireSummary = {
    compound:'medium',wear:0,remaining:1,temperature:0,gripMultiplier:1,speedMultiplier:1,wheels:this.wheels,
  };
  private readonly result:TireForces = {
    longitudinalAcceleration:0,lateralAcceleration:0,lateralLimit:0,gripUsage:0,sliding:false,speedMultiplier:1,
  };
  private profile = profiles.medium;
  private longitudinalTransfer = 0;
  private lateralTransfer = 0;

  constructor() {
    this.fit('medium');
  }

  /** Current values. The tire set reuses this view on every physics tick. */
  get summary():Readonly<TireSummary> { return this.state; }
  get speedMultiplier():number { return this.state.speedMultiplier; }
  get gripMultiplier():number { return this.state.gripMultiplier; }

  fit(compound:TireCompound,weather:WeatherMode='sunny'):void {
    this.profile = profiles[compound];
    this.state.compound = compound;
    this.longitudinalTransfer = this.lateralTransfer = 0;
    const temperature = this.profile.optimalTemperature - (weather === 'rainy' && compound !== 'wet' ? 10 : 0);
    for (let i=0;i<4;i++) {
      const wheel = this.wheels[i];
      wheel.load = (i < 2 ? frontWeight : 1 - frontWeight) * .5;
      wheel.temperature = temperature;
      wheel.wear = wheel.slipRatio = wheel.slipAngle = wheel.forceX = wheel.forceY = 0;
    }
    this.updateSummary(0,temperature,temperatureGrip(temperature,this.profile),weather);
    this.result.longitudinalAcceleration = this.result.lateralAcceleration = this.result.lateralLimit = this.result.gripUsage = 0;
    this.result.sliding = false;
    this.result.speedMultiplier = this.speedMultiplier;
  }

  private updateSummary(wear:number,temperature:number,conditionGrip:number,weather:WeatherMode):void {
    const rainy = weather === 'rainy';
    this.state.wear = wear;
    this.state.remaining = 1 - wear;
    this.state.temperature = temperature;
    this.state.gripMultiplier = conditionGrip * (rainy ? this.profile.rainGrip : this.profile.dryGrip);
    this.state.speedMultiplier = (rainy ? this.profile.rainSpeed : this.profile.drySpeed) * treadSpeed(wear);
  }

  /** Uses per-wheel slip and load. Returned forces are reused on each tick. */
  step(input:TireStepInput):Readonly<TireForces> {
    const dt = clamp(finite(input.dt),0,.05);
    if (dt === 0) return this.result;

    const speed = clamp(finite(input.speed),-100,100);
    const lateralSpeed = clamp(finite(input.lateralSpeed),-100,100);
    const yawRate = clamp(finite(input.yawRate),-10,10);
    const steer = clamp(finite(input.steerAngle),-.8,.8);
    const cosSteer = Math.cos(steer);
    const sinSteer = Math.sin(steer);
    const longGrip = clamp(finite(input.longitudinalGrip),0,150);
    const lateralGrip = clamp(finite(input.lateralGrip),0,150);
    const longDemand = clamp(finite(input.longitudinalDemand),-150,150);
    const lateralDemand = Math.abs(clamp(finite(input.lateralDemand),-150,150));
    const asphalt = input.surface === 'asphalt';
    const rainy = input.weather === 'rainy';
    const driving = longDemand > 0 || (longDemand < 0 && speed <= 0);
    const aero = asphalt ? .62 * (Math.min(Math.abs(speed),45) / 40) ** 2 : 0;
    const totalLoad = 1 + aero;
    const loadResponse = 1 - Math.exp(-22 * dt);
    // Transfer follows the force supported by the tires on the previous tick.
    const longUse = clamp(this.result.longitudinalAcceleration / Math.max(1,longGrip),-1,1);
    const latUse = clamp(this.result.lateralAcceleration / Math.max(1,lateralGrip),-1,1);
    this.longitudinalTransfer += (-.26 * longUse - this.longitudinalTransfer) * loadResponse;
    this.lateralTransfer += (.36 * latUse - this.lateralTransfer) * loadResponse;
    const frontLoad = clamp(frontWeight + .43 * aero + this.longitudinalTransfer,totalLoad * .16,totalLoad * .84);
    const brakeBias = clamp(.59 + .5 * (frontLoad / totalLoad - .56),.53,.64);
    const compoundGrip = rainy ? this.profile.rainGrip : this.profile.dryGrip;
    const ambient = rainy ? 22 : 31;
    const rainCooling = rainy ? .024 : 0;
    const dryWetFactor = this.state.compound === 'wet' && !rainy ? wetOnDryAbrasion : 1;
    const peakSlip = asphalt ? (rainy ? .105 : .125) : .17;
    const peakAngle = asphalt ? (rainy ? .125 : .145) : .21;
    const slipResponseRate = 1 - Math.exp(-78 * dt);
    let sumLong = 0;
    let sumLat = 0;
    let lateralLimit = 0;
    let wear = 0;
    let temperature = 0;
    let conditionGrip = 0;
    let peakLateralSlip = 0;

    for (let i=0;i<4;i++) {
      const wheel = this.wheels[i];
      const front = i < 2;
      const left = i % 2 === 0;
      const axleLoad = front ? frontLoad : totalLoad - frontLoad;
      const loadShift = clamp(this.lateralTransfer * (front ? .52 : .48),-.46 * axleLoad,.46 * axleLoad);
      wheel.load = axleLoad * .5 + (left ? loadShift : -loadShift);
      const nominalLoad = wheel.load * 4 / totalLoad;
      // Load-sensitive grip increases less than linearly with normal force.
      const loadShare = wheel.load / totalLoad * nominalLoad ** -.09;
      const tireGrip = temperatureGrip(wheel.temperature,this.profile) * treadGrip(wheel.wear);
      const maxLong = longGrip * loadShare * tireGrip * compoundGrip;
      const maxLat = lateralGrip * loadShare * tireGrip * compoundGrip;
      const axleShare = driving ? (front ? 0 : 1) : (front ? brakeBias : 1 - brakeBias);
      const wheelDemand = longDemand * axleShare * .5;
      const demandDirection = Math.sign(wheelDemand);
      const demandUse = Math.abs(wheelDemand) / Math.max(.001,maxLong);

      // The simplified driveline supplies a force demand. A relaxed equivalent
      // slip ratio replaces a separate rigid wheel/inertia solver.
      const peakRequest = Math.tan(Math.asin(Math.min(1,demandUse)) / shape) / peakTangent;
      const targetRatio = demandDirection * peakSlip * (peakRequest + Math.min(1.15,Math.max(0,demandUse - 1) * .65));
      wheel.slipRatio += (targetRatio - wheel.slipRatio) * slipResponseRate;
      const signedLongForce = maxLong * slipResponse(wheel.slipRatio,peakSlip);
      wheel.forceX = demandDirection * clamp(signedLongForce * demandDirection,0,Math.abs(wheelDemand));

      const patchForward = speed - yawRate * (left ? -halfTrack : halfTrack);
      const patchLateral = lateralSpeed + yawRate * (front ? frontOffset : rearOffset);
      const wheelForward = front ? patchForward * cosSteer + patchLateral * sinSteer : patchForward;
      const wheelLateral = front ? patchLateral * cosSteer - patchForward * sinSteer : patchLateral;
      wheel.slipAngle = Math.atan2(-wheelLateral,Math.max(1.7,Math.abs(wheelForward)));
      // The two force components share an elliptical contact-patch budget.
      const longitudinalUse = Math.min(1,Math.abs(wheel.forceX) / Math.max(.001,maxLong));
      const availableLat = maxLat * Math.sqrt(1 - longitudinalUse * longitudinalUse);
      wheel.forceY = availableLat * slipResponse(wheel.slipAngle,peakAngle);
      sumLong += wheel.forceX;
      sumLat += front ? wheel.forceY * cosSteer + wheel.forceX * sinSteer : wheel.forceY;
      lateralLimit += availableLat;
      peakLateralSlip = Math.max(peakLateralSlip,Math.abs(wheel.slipAngle));

      const rollingSpeed = Math.hypot(wheelForward,wheelLateral);
      const cooling = (wheel.temperature - ambient) * (.017 + .001 * rollingSpeed + rainCooling);
      const slipHeat = .24 * Math.abs(wheel.forceX * wheel.slipRatio * wheelForward)
        + .065 * Math.abs(wheel.forceY * wheelLateral);
      const generatedHeat = (.080 * rollingSpeed * nominalLoad ** .35 + slipHeat) * this.profile.heatRate;
      wheel.temperature = clamp(wheel.temperature + (generatedHeat - cooling) * dt,ambient,155);
      const lateralSlip = Math.min(1.7,Math.abs(wheel.slipAngle) / peakAngle);
      const drivenSlip = Math.min(1.7,Math.abs(wheel.slipRatio) / peakSlip);
      const overstress = Math.max(0,wheel.temperature - this.profile.optimalTemperature - this.profile.temperatureWindow);
      const abrasion = .76 + .46 * lateralSlip ** 2 + .31 * drivenSlip ** 2 + .009 * overstress + (asphalt ? 0 : .3);
      wheel.wear = Math.min(1,wheel.wear + rollingSpeed * dt * this.profile.wearPerUnit * nominalLoad ** .78 * abrasion * dryWetFactor);
      wear += wheel.wear;
      temperature += wheel.temperature;
      conditionGrip += temperatureGrip(wheel.temperature,this.profile) * treadGrip(wheel.wear);
    }

    this.updateSummary(wear * .25,temperature * .25,conditionGrip * .25,input.weather);
    this.result.longitudinalAcceleration = sumLong;
    this.result.lateralAcceleration = sumLat;
    this.result.lateralLimit = lateralLimit;
    this.result.gripUsage = clamp(lateralDemand / Math.max(.1,lateralLimit),0,1.5);
    this.result.sliding = Math.abs(speed) > 5 && (this.result.gripUsage > 1.02 || peakLateralSlip > peakAngle * 1.2);
    this.result.speedMultiplier = this.speedMultiplier;
    return this.result;
  }
}
