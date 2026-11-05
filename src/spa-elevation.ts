/** Periodic physical road elevation. A small spatial convolution rounds the
 * authored vertical knots before any render/physics samples are generated.
 * It is not a camera or car-pose filter. Horizontal geometry stays untouched. */
export class SpaElevationProfile {
 readonly sigma=5;
 readonly samples:readonly number[];
 readonly spacing:number;
 constructor(readonly length:number,heightAt:(distance:number)=>number,count=4096){
  this.spacing=length/count;const raw=Array.from({length:count},(_,i)=>heightAt(i*this.spacing)),radius=Math.ceil(3*this.sigma/this.spacing),weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)*this.spacing/this.sigma)**2)),total=weights.reduce((a,b)=>a+b,0),values:number[]=[];
  for(let i=0;i<count;i++){let sum=0;for(let j=-radius;j<=radius;j++)sum+=raw[(i+j+count)%count]*weights[j+radius];values.push(sum/total);}
  const zero=values[0];this.samples=values.map(y=>y-zero);
 }
 at(distance:number){
  const count=this.samples.length,at=((distance%this.length+this.length)%this.length)/this.spacing,i=Math.floor(at),t=at-i,a=this.samples[i],b=this.samples[(i+1)%count],ma=(this.samples[(i+1)%count]-this.samples[(i-1+count)%count])/2,mb=(this.samples[(i+2)%count]-this.samples[i])/2;
  return{height:(2*t*t*t-3*t*t+1)*a+(t*t*t-2*t*t+t)*ma+(-2*t*t*t+3*t*t)*b+(t*t*t-t*t)*mb,derivative:((6*t*t-6*t)*a+(3*t*t-4*t+1)*ma+(-6*t*t+6*t)*b+(3*t*t-2*t)*mb)/this.spacing};
 }
}
