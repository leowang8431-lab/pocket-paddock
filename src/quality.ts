export type QualityMode='auto'|'performance'|'balanced'|'high';
export type QualityLevel=Exclude<QualityMode,'auto'>;
export interface QualityProfile {
  level:QualityLevel; label:string; pixelBudget:number; maxPixelRatio:number;
  shadows:boolean; far:number; fogNear:number; fogFar:number; sceneryDistance:number;
}
export const QUALITY_PROFILES:Record<QualityLevel,QualityProfile>={
  performance:{level:'performance',label:'流畅',pixelBudget:640_000,maxPixelRatio:1,shadows:false,far:160,fogNear:55,fogFar:150,sceneryDistance:120},
  balanced:{level:'balanced',label:'均衡',pixelBudget:1_450_000,maxPixelRatio:1.35,shadows:false,far:300,fogNear:140,fogFar:290,sceneryDistance:230},
  high:{level:'high',label:'精细',pixelBudget:3_200_000,maxPixelRatio:1.8,shadows:true,far:480,fogNear:210,fogFar:460,sceneryDistance:360},
};
const levels:QualityLevel[]=['performance','balanced','high'];
export const MIN_AUTO_RESOLUTION_SCALE=.55;
export interface GraphicsCapabilityHints {software?:boolean;cores?:number;deviceMemory?:number;maxTextureSize?:number}
/** A conservative starting hint, not a GPU benchmark. Unknown values do not
 * downgrade the device; active-frame timing still controls later adaptation. */
export function classifyGraphicsCapability(hints:GraphicsCapabilityHints):{tier:'software'|'constrained'|'standard';preferPerformance:boolean}{
  if(hints.software)return{tier:'software',preferPerformance:true};
  const low=(value:number|undefined,limit:number)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=limit;
  const constrained=low(hints.cores,4)||low(hints.deviceMemory,4)||low(hints.maxTextureSize,4096);
  return{tier:constrained?'constrained':'standard',preferPerformance:constrained};
}
export function isQualityMode(value:unknown):value is QualityMode{return value==='auto'||value==='performance'||value==='balanced'||value==='high';}
export function qualityPixelRatio(width:number,height:number,deviceRatio:number,profile:QualityProfile,resolutionScale=1){
  const budgetRatio=Math.sqrt(profile.pixelBudget/Math.max(1,width*height));
  // An absolute DPR floor defeats the pixel budget on large external monitors.
  // Keep the minimum tied to that budget so 4K can also use the auto .55 floor.
  const minimumRatio=Math.min(.28,budgetRatio*MIN_AUTO_RESOLUTION_SCALE);
  return Math.max(minimumRatio,Math.min(deviceRatio,profile.maxPixelRatio,budgetRatio)*resolutionScale);
}

/** Only rendering changes. The physics clock, rules and input never depend on quality. */
export class AdaptiveQuality {
  mode:QualityMode;level:QualityLevel;resolutionScale=1;fps=0;frameMs=16.67;
  private elapsed=0;private slow=0;private healthy=0;private cooldown=0;private count=0;private windowMs=0;
  constructor(mode:QualityMode='auto',private readonly conservative=false,private onChange:()=>void=()=>{}){
    this.mode=mode;this.level=mode==='auto'?(conservative?'performance':'balanced'):mode;
  }
  get profile(){return QUALITY_PROFILES[this.level];}
  get summary(){return {mode:this.mode,level:this.level,label:this.profile.label,resolutionScale:this.resolutionScale,fps:this.fps,frameMs:this.frameMs};}
  setMode(mode:QualityMode){
    this.mode=mode;this.level=mode==='auto'?(this.conservative?'performance':'balanced'):mode;this.resolutionScale=1;
    this.slow=0;this.healthy=0;this.cooldown=0;this.elapsed=0;this.windowMs=0;this.count=0;this.fps=0;this.frameMs=16.67;this.onChange();
  }
  observe(ms:number,active:boolean){
    if(!active||!Number.isFinite(ms)||ms<=0){this.slow=0;this.healthy=0;return;}
    const trendMs=Math.min(ms,250);
    this.elapsed+=trendMs;this.cooldown=Math.max(0,this.cooldown-trendMs);
    this.windowMs+=ms;this.count++;
    if(this.windowMs>=700){this.fps=Math.round(1000*this.count/this.windowMs);this.frameMs=this.windowMs/this.count;this.windowMs=0;this.count=0;}
    if(this.mode!=='auto'||this.elapsed<1000||this.cooldown>0)return;
    if(ms>20){this.slow+=trendMs;this.healthy=0;}else{this.slow=Math.max(0,this.slow-ms*.6);this.healthy=ms<17.5?this.healthy+ms:0;}
    const severe=this.frameMs>=40;
    if(this.slow>=(severe?650:900)){
      const i=levels.indexOf(this.level);
      const previous=this.resolutionScale;
      if(i>0)this.level=levels[i-1];else this.resolutionScale=Math.max(MIN_AUTO_RESOLUTION_SCALE,Math.round((this.resolutionScale-.15)*100)/100);
      this.cooldown=severe?1500:1800;this.slow=0;this.healthy=0;
      if(i>0||previous!==this.resolutionScale)this.onChange();
    }else if(this.healthy>=12_000&&this.level==='performance'){
      // Recover resolution gradually; never automatically enable dynamic shadows.
      const previous=this.resolutionScale;
      if(this.resolutionScale<1)this.resolutionScale=Math.min(1,Math.round((this.resolutionScale+.15)*100)/100);
      else if(!this.conservative)this.level='balanced';
      this.cooldown=8000;this.healthy=0;
      if(this.level==='balanced'||previous!==this.resolutionScale)this.onChange();
    }
  }
}
