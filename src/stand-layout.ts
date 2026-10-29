/** Authoring data shared by scenery, collisions and the layout audit. */
export interface Point2 { x:number; z:number }
export interface LayoutSample { point:Point2; tangent:Point2; right:Point2; distance:number }
export interface LayoutTrack {
  width:number;
  length:number;
  samples:readonly {point:Point2}[];
  corners:readonly {name:string;distance:number}[];
  sampleAt(distance:number):LayoutSample;
  isPitLane(x:number,z:number):boolean;
}
export interface Bounds2 {minX:number;maxX:number;minZ:number;maxZ:number}
export interface StandLayout {
  id:string; x:number; z:number; yaw:number; width:number; rows:number; covered:boolean;
  target:Point2 & {distance:number};
  minTrackClearance:number;
  minColliderClearance:number;
}

/** Local -Z is the viewing front; +Z contains the rising tiers. Bounds include
 * the roof overhang, its small pitch, support columns, fascia and base slab. */
export function standLocalBounds(stand:Pick<StandLayout,'width'|'covered'>):Bounds2 {
  const half=stand.width/2+(stand.covered?2.5:1);
  return {minX:-half,maxX:half,minZ:stand.covered?-4.3:-2.5,maxZ:stand.covered?14.3:12.5};
}

export function distanceToStand(x:number,z:number,stand:StandLayout):number {
  const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw),dx=x-stand.x,dz=z-stand.z;
  const lx=c*dx-s*dz,lz=s*dx+c*dz,b=standLocalBounds(stand);
  return Math.hypot(Math.max(b.minX-lx,0,lx-b.maxX),Math.max(b.minZ-lz,0,lz-b.maxZ));
}

export function standFootprint(stand:StandLayout):Point2[] {
  const b=standLocalBounds(stand),c=Math.cos(stand.yaw),s=Math.sin(stand.yaw);
  return [[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ]].map(([x,z])=>({x:stand.x+c*x+s*z,z:stand.z-s*x+c*z}));
}

/** Ground collision uses the occupied base, not the raised roof. This
 * conservative world AABB is also checked against every track segment. */
export function standCollider(stand:StandLayout):Bounds2 {
  const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw),half=stand.width/2+1;
  const points=[[-half,-2.5],[half,-2.5],[half,12.5],[-half,12.5]].map(([x,z])=>({x:stand.x+c*x+s*z,z:stand.z-s*x+c*z}));
  return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
}

export function distanceToBounds(point:Point2,b:Bounds2):number {
  return Math.hypot(Math.max(b.minX-point.x,0,point.x-b.maxX),Math.max(b.minZ-point.z,0,point.z-b.maxZ));
}

function measureClearance(track:LayoutTrack,stand:StandLayout):void {
  const collider=standCollider(stand);
  stand.minTrackClearance=Infinity;stand.minColliderClearance=Infinity;
  for(const {point} of track.samples){
    stand.minTrackClearance=Math.min(stand.minTrackClearance,distanceToStand(point.x,point.z,stand));
    stand.minColliderClearance=Math.min(stand.minColliderClearance,distanceToBounds(point,collider));
  }
}

function pitConflict(track:LayoutTrack,stand:StandLayout):boolean {
  const b=standLocalBounds(stand),c=Math.cos(stand.yaw),s=Math.sin(stand.yaw);
  // Probe the entire occupied area, not just the centre or four corners.
  for(let x=b.minX;x<=b.maxX;x+=1.5)for(let z=b.minZ;z<=b.maxZ;z+=1.5){
    if(track.isPitLane(stand.x+c*x+s*z,stand.z-s*x+c*z))return true;
  }
  return false;
}

const layouts=new WeakMap<LayoutTrack,StandLayout[]>();
export function createStandLayouts(track:LayoutTrack):StandLayout[] {
  const cached=layouts.get(track);if(cached)return cached;
  const nearestDistance=(x:number,z:number)=>{
    let nearest=0,best=Infinity;
    for(let i=0;i<track.samples.length;i++){
      const p=track.samples[i].point,d=(p.x-x)**2+(p.z-z)**2;
      if(d<best){best=d;nearest=i;}
    }
    return nearest/track.samples.length*track.length;
  };
  const specs=[
    {id:'centrale',distance:nearestDistance(-85,35),offset:40,width:106,rows:6,covered:true},
    {id:'straight-north',distance:nearestDistance(-85,-96),offset:40,width:62,rows:5,covered:false},
    {id:'straight-south',distance:nearestDistance(-85,164),offset:40,width:48,rows:5,covered:true},
    {id:'rettifilo',distance:track.corners[0].distance,offset:50,width:46,rows:5,covered:false},
    {id:'roggia',distance:track.corners[2].distance,offset:42,width:46,rows:5,covered:false},
    {id:'ascari',distance:track.corners[6].distance,offset:44,width:54,rows:5,covered:false},
    // The old negative offset put this stand on the inside, across the return
    // straight. Place it outside the whole Alboreto hairpin instead.
    {id:'alboreto',distance:track.corners[7].distance,offset:51,width:48,rows:5,covered:false},
  ];
  const result:StandLayout[]=[];
  for(const spec of specs){
    const sample=track.sampleAt(spec.distance);
    let stand:StandLayout|undefined;
    for(let extra=0;extra<=100;extra+=2){
      const offset=spec.offset+extra;
      const x=sample.point.x+sample.right.x*offset,z=sample.point.z+sample.right.z*offset;
      const candidate:StandLayout={id:spec.id,x,z,yaw:Math.atan2(x-sample.point.x,z-sample.point.z),width:spec.width,rows:spec.rows,covered:spec.covered,target:{x:sample.point.x,z:sample.point.z,distance:spec.distance},minTrackClearance:0,minColliderClearance:0};
      measureClearance(track,candidate);
      // Keep all visible geometry behind the guardrail (24 units from the
      // centre), plus a walkway; leave the collider well outside the road.
      if(candidate.minTrackClearance>=29&&candidate.minColliderClearance>=27&&!pitConflict(track,candidate)){stand=candidate;break;}
    }
    if(!stand)throw new Error(`Grandstand ${spec.id} has no safe placement`);
    result.push(stand);
  }
  layouts.set(track,result);return result;
}

export interface BrakingBoardLayout {id:string;label:string;x:number;z:number;yaw:number;distance:number;entryDistance:number}
export function createBrakingBoards(track:LayoutTrack):BrakingBoardLayout[] {
  const curvature=(distance:number)=>{
    const a=track.sampleAt(distance-2).tangent,b=track.sampleAt(distance+2).tangent;
    return Math.acos(Math.min(1,Math.max(-1,a.x*b.x+a.z*b.z)))/4;
  };
  const boards:BrakingBoardLayout[]=[];
  for(const index of [0,2,6,7]){
    const corner=track.corners[index];let peakDistance=corner.distance,peak=0;
    for(let d=corner.distance-25;d<=corner.distance+20;d+=2){const k=curvature(d);if(k>peak){peak=k;peakDistance=d;}}
    let entry=peakDistance,flat=0;
    for(let d=peakDistance;d>=peakDistance-100;d-=2){
      entry=d;
      flat=curvature(d)<.012?flat+2:0;
      if(flat>=8){entry=d+8;break;}
    }
    for(const label of [150,100,50]){
      // The HUD uses 6 km/h per game unit/s: 1 unit = 5/3 displayed metres.
      // These are driving references in the shortened layout, not survey data.
      const distance=((entry-label*.6)%track.length+track.length)%track.length;
      const s=track.sampleAt(distance),x=s.point.x+s.right.x*14,z=s.point.z+s.right.z*14;
      boards.push({id:`${corner.name.split(' · ')[0]}-${label}`,label:String(label),x,z,yaw:Math.atan2(-s.tangent.x,-s.tangent.z),distance,entryDistance:((entry%track.length)+track.length)%track.length});
    }
  }
  return boards;
}
