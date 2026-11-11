import {RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH} from './race-contact';
import type {Track} from './track';

type RacingLineTrack=Pick<Track,'id'|'length'|'widthAt'|'sampleAt'|'samples'>;
interface LineData {
  offsets:Float64Array;
  curvature:Float64Array;
  metric:Float64Array;
  spacing:number;
}

const cache=new WeakMap<RacingLineTrack,LineData>();
const clearance=Math.hypot(RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH)+.25;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const smooth=(n:number)=>{const x=clamp(n,0,1);return x*x*(3-2*x);};
const previous=(i:number,count:number)=>i===0?count-1:i-1;
const next=(i:number,count:number)=>i+1===count?0:i+1;

/** Positive curvature turns toward the track's right vector. */
function turn(x:Float64Array,z:Float64Array,a:number,i:number,b:number):number {
  const ax=x[i]-x[a],az=z[i]-z[a],bx=x[b]-x[i],bz=z[b]-z[i];
  const edges=Math.hypot(ax,az)*Math.hypot(bx,bz)*Math.hypot(ax+bx,az+bz);
  return edges>1e-9?2*(az*bx-ax*bz)/edges:0;
}

function splineOffset(offsets:Float64Array,s:number):number {
  const i=Math.floor(s),t=s-i,count=offsets.length,b=next(i,count),u=1-t;
  return (offsets[previous(i,count)]*u**3+offsets[i]*(4-6*t*t+3*t**3)
    +offsets[b]*(1+3*t+3*t*t-3*t**3)+offsets[next(b,count)]*t**3)/6;
}

function buildLine(track:RacingLineTrack):LineData {
  const count=Math.max(32,Math.ceil(track.length/7.5)),spacing=track.length/count;
  const centerX=new Float64Array(count),centerZ=new Float64Array(count);
  const rightX=new Float64Array(count),rightZ=new Float64Array(count);
  const offsets=new Float64Array(count),bounds=new Float64Array(count);
  const x=new Float64Array(count),z=new Float64Array(count);
  const maxOffset=track.id==='monaco'?1.6:4.7;
  for(let i=0;i<count;i++){
    const sample=track.sampleAt(i*spacing);
    x[i]=centerX[i]=sample.point.x;z[i]=centerZ[i]=sample.point.z;
    rightX[i]=sample.right.x;rightZ[i]=sample.right.z;
  }
  for(let i=0;i<count;i++){
    // Every spline control influences four intervals. Use the narrowest
    // width over that support, including clearance for the whole chassis.
    let width=Infinity;
    for(let step=-5;step<=5;step++)width=Math.min(width,track.widthAt((i+step*.5)*spacing));
    const corridor=Math.max(0,Math.min(maxOffset,width*.5-clearance));
    const curvature=turn(x,z,previous(i,count),i,next(i,count));
    const narrowMonaco=track.id==='monaco'?smooth((width-9)/2.3)*smooth((.085-Math.abs(curvature))/.045):1;
    bounds[i]=corridor*narrowMonaco;
  }

  const place=(i:number,offset:number)=>{
    x[i]=centerX[i]+rightX[i]*offset;
    z[i]=centerZ[i]+rightZ[i]*offset;
  };
  const bendCost=(i:number)=>{
    const a=previous(i,count),b=next(i,count),curvature=turn(x,z,a,i,b);
    const length=(Math.hypot(x[i]-x[a],z[i]-z[a])+Math.hypot(x[b]-x[i],z[b]-z[i]))*.5;
    return curvature*curvature*length;
  };
  const maxChange=(track.id==='monaco'?.065:.21)*spacing;
  // Minimize integrated geometric curvature, allowing the line to use the
  // asphalt width. A small slope cost avoids pointless weaving on straights.
  for(const step of [1.1,.55,.24,.09]){
    for(let sweep=0;sweep<16;sweep++){
      for(let j=0;j<count;j++){
        const i=sweep%2===0?j:count-1-j,a=previous(i,count),b=next(i,count);
        if(bounds[i]===0)continue;
        const lo=Math.max(-bounds[i],offsets[a]-maxChange,offsets[b]-maxChange);
        const hi=Math.min(bounds[i],offsets[a]+maxChange,offsets[b]+maxChange);
        const current=offsets[i];
        const cost=(offset:number)=>{
          place(i,offset);
          const slopeCost=((offset-offsets[a])**2+(offsets[b]-offset)**2)/spacing;
          return bendCost(a)+bendCost(i)+bendCost(b)+.00018*slopeCost+.0000015*offset*offset*spacing;
        };
        let best=current,bestCost=cost(current);
        const left=Math.max(lo,current-step),right=Math.min(hi,current+step);
        if(left<current){
          const value=cost(left);
          if(value<bestCost){best=left;bestCost=value;}
        }
        if(right>current&&cost(right)<bestCost)best=right;
        offsets[i]=best;
        place(i,best);
      }
    }
  }

  // Sample the finished spline more densely than the optimizer controls so
  // brief curvature peaks and path-speed changes survive the lookup table.
  const samples=Math.max(64,Math.ceil(track.length/1.5)),step=track.length/samples;
  const pathX=new Float64Array(samples),pathZ=new Float64Array(samples);
  const curvature=new Float64Array(samples),metric=new Float64Array(samples);
  for(let i=0;i<samples;i++){
    const sample=track.sampleAt(i*step),offset=splineOffset(offsets,i/samples*count);
    pathX[i]=sample.point.x+sample.right.x*offset;
    pathZ[i]=sample.point.z+sample.right.z*offset;
  }
  const span=Math.max(2,Math.round(track.length/track.samples.length*3/step));
  for(let i=0;i<samples;i++){
    const a=previous(i,samples),b=next(i,samples);
    curvature[i]=turn(pathX,pathZ,(i+samples-span)%samples,i,(i+span)%samples);
    metric[i]=Math.max(.2,Math.hypot(pathX[b]-pathX[a],pathZ[b]-pathZ[a])/(2*step));
  }
  return {offsets,curvature,metric,spacing};
}

/** One smooth, periodic line shared by all AI cars on the same Track. */
export class AiRacingLine {
  private readonly data:LineData;
  private readonly length:number;
  constructor(track:RacingLineTrack) {
    this.length=track.length;
    const cached=cache.get(track);
    this.data=cached??buildLine(track);
    if(!cached)cache.set(track,this.data);
  }

  private indexAt(distance:number,count:number):number {
    const fraction=(distance/this.length)%1;
    const index=(fraction<0?fraction+1:fraction)*count;
    return index<count?index:0;
  }

  offsetAt(distance:number):number {
    return splineOffset(this.data.offsets,this.indexAt(distance,this.data.offsets.length));
  }

  /** Change in the lateral offset per unit of station distance. */
  slopeAt(distance:number):number {
    const offsets=this.data.offsets,count=offsets.length,s=this.indexAt(distance,count),i=Math.floor(s),t=s-i;
    const b=next(i,count),u=1-t;
    return (-offsets[previous(i,count)]*u*u+offsets[i]*(3*t*t-4*t)
      +offsets[b]*(1+2*t-3*t*t)+offsets[next(b,count)]*t*t)/(2*this.data.spacing);
  }

  private interpolate(values:Float64Array,distance:number):number {
    const s=this.indexAt(distance,values.length),i=Math.floor(s);
    return values[i]+(values[next(i,values.length)]-values[i])*(s-i);
  }

  curvatureAt(distance:number):number {return this.interpolate(this.data.curvature,distance);}

  /** Horizontal distance along the optimized line per unit of station. */
  metricAt(distance:number):number {return this.interpolate(this.data.metric,distance);}
}
