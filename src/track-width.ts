/** Local road widths: preserve the Monza centreline and all perimeter fences.
 * Both sides move inward by half the width difference. Paint and kerbs follow
 * the same 95% normal scale; a smooth entry/exit avoids a road-edge step. */
export interface WidthZone {
  id:'roggia'|'lesmo-2';name:string;center:number;
  before:number;after:number;transition:number;scale:number;
}
export function createWidthZones(corners:readonly {name:string;distance:number}[]):WidthZone[]{
  return [
    {id:'roggia',name:corners[2].name,center:corners[2].distance,before:32,after:48,transition:20,scale:.95},
    {id:'lesmo-2',name:corners[4].name,center:corners[4].distance,before:21,after:28,transition:20,scale:.95},
  ];
}
export function roadWidthAt(distance:number,length:number,baseWidth:number,zones:readonly WidthZone[]):number {
  if(!Number.isFinite(distance))return baseWidth;
  const d=((distance%length)+length)%length;
  let scale=1;
  for(const zone of zones){
    const relative=((d-zone.center+length*1.5)%length)-length/2;
    const outside=Math.max(-zone.before-relative,relative-zone.after,0);
    const t=Math.min(1,outside/zone.transition),smooth=t*t*(3-2*t);
    scale=Math.min(scale,zone.scale+(1-zone.scale)*smooth);
  }
  return baseWidth*scale;
}
