export type QualityMode='auto'|'performance'|'balanced'|'high';
export type QualityLevel=Exclude<QualityMode,'auto'>;
export interface QualityProfile {
  level:QualityLevel; label:string; pixelBudget:number; maxPixelRatio:number;
  shadows:boolean; far:number; fogNear:number; fogFar:number; sceneryDistance:number;
}
export const QUALITY_PROFILES:Record<QualityLevel,QualityProfile>={
  performance:{level:'performance',label:'流畅',pixelBudget:640_000,maxPixelRatio:1,shadows:false,far:190,fogNear:65,fogFar:180,sceneryDistance:150},
  balanced:{level:'balanced',label:'均衡',pixelBudget:1_050_000,maxPixelRatio:1.25,shadows:false,far:280,fogNear:100,fogFar:265,sceneryDistance:215},
  high:{level:'high',label:'精细',pixelBudget:2_000_000,maxPixelRatio:1.5,shadows:true,far:420,fogNear:140,fogFar:400,sceneryDistance:320},
};
const levels:QualityLevel[]=['performance','balanced','high'];
export function isQualityMode(value:unknown):value is QualityMode{return value==='auto'||value==='performance'||value==='balanced'||value==='high';}
export function qualityPixelRatio(width:number,height:number,deviceRatio:number,profile:QualityProfile,resolutionScale=1){
  const budgetRatio=Math.sqrt(profile.pixelBudget/Math.max(1,width*height));
  return Math.max(.28,Math.min(deviceRatio,profile.maxPixelRatio,budgetRatio)*resolutionScale);
}

/** Only rendering changes. The physics clock, rules and input never depend on quality. */
export class AdaptiveQuality {
  mode:QualityMode;level:QualityLevel;resolutionScale=1;fps=0;frameMs=16.67;
  private elapsed=0;private slow=0;private healthy=0;private cooldown=0;private count=0;private windowMs=0;
  constructor(mode:QualityMode='auto',software=false,private onChange:()=>void=()=>{}){
    this.mode=mode;this.level=mode==='auto'?(software?'performance':'balanced'):mode;
  }
  get profile(){return QUALITY_PROFILES[this.level];}
  get summary(){return {mode:this.mode,level:this.level,label:this.profile.label,resolutionScale:this.resolutionScale,fps:this.fps,frameMs:this.frameMs};}
  setMode(mode:QualityMode){
    this.mode=mode;this.level=mode==='auto'?'balanced':mode;this.resolutionScale=1;
    this.slow=0;this.healthy=0;this.cooldown=0;this.elapsed=0;this.onChange();
  }
  observe(ms:number,active:boolean){
    if(!active||!Number.isFinite(ms)||ms<=0){this.slow=0;this.healthy=0;return;}
    const trendMs=Math.min(ms,250);
    this.elapsed+=trendMs;this.cooldown=Math.max(0,this.cooldown-trendMs);
    this.windowMs+=ms;this.count++;
    if(this.windowMs>=700){this.fps=Math.round(1000*this.count/this.windowMs);this.frameMs=this.windowMs/this.count;this.windowMs=0;this.count=0;}
    if(this.mode!=='auto'||this.elapsed<1500||this.cooldown>0)return;
    if(ms>25){this.slow+=trendMs;this.healthy=0;}else{this.slow=Math.max(0,this.slow-ms*.35);this.healthy=ms<19?this.healthy+ms:0;}
    if(this.slow>=1400){
      const i=levels.indexOf(this.level);
      if(i>0)this.level=levels[i-1];else this.resolutionScale=Math.max(.65,this.resolutionScale-.15);
      this.cooldown=2500;this.slow=0;this.healthy=0;this.onChange();
    }else if(this.healthy>=12_000&&this.level==='performance'){
      // Recover resolution gradually; never automatically enable dynamic shadows.
      if(this.resolutionScale<1)this.resolutionScale=Math.min(1,this.resolutionScale+.15);
      else this.level='balanced';
      this.cooldown=8000;this.healthy=0;this.onChange();
    }
  }
}
