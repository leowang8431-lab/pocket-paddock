import type {Track} from './track';
import {createHistoricOvalLayout,distanceToHistoricOval} from './monza-historic-oval';
import {createStandLayouts,distanceToStand} from './stand-layout';
import {createBackgroundLandmarkLayouts,distanceToLandmark} from './monza-landmarks';
import {createCircuitPropLayouts} from './monza-surroundings';

type MarshalTrack=Pick<Track,'id'|'width'|'length'|'samples'|'corners'|'sampleAt'|'nearest'|'isPitLane'|'colliders'|'widthAt'>;
interface Point2 {x:number;z:number}
export interface MonzaMarshalLayout {
  id:string;cornerIndex:number;name:string;x:number;z:number;yaw:number;
  original:Point2;shift:Point2;moved:boolean;reasons:string[];
  roof:{width:5.5;depth:5.5};sign:{width:12;depth:.1};
  bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  equipment?:{id:string;x:number;z:number;yaw:number};
  clearance:{road:number;historic:number;stands:number;landmarks:number};
}
export interface MarshalLayoutOptions {
  /** True means this world-space footprint point is reserved, for example by
   * the separately authored old-road connection and its three-unit margin. */
  excluded?:(x:number,z:number)=>boolean;
}

/** Includes the complete square roof and the wide, rotated vertical name board.
 * Sampling their interiors also detects a road crossing the middle of a roof. */
export function marshalPostFootprint(layout:Pick<MonzaMarshalLayout,'x'|'z'|'yaw'>):Point2[] {
  const points:Point2[]=[],c=Math.cos(layout.yaw),s=Math.sin(layout.yaw);
  for(let i=0;i<=12;i++)for(let j=0;j<=12;j++)points.push({x:layout.x+(i/12-.5)*5.5,z:layout.z+(j/12-.5)*5.5});
  for(let i=0;i<=48;i++)for(const localZ of [-.05,0,.05]){
    const localX=(i/48-.5)*12;
    points.push({x:layout.x+c*localX+s*localZ,z:layout.z-s*localX+c*localZ});
  }
  return points;
}

export function distanceToMarshalPost(x:number,z:number,layout:Pick<MonzaMarshalLayout,'x'|'z'|'yaw'>):number {
  const dx=x-layout.x,dz=z-layout.z,c=Math.cos(layout.yaw),s=Math.sin(layout.yaw);
  const roof=Math.hypot(Math.max(Math.abs(dx)-2.75,0),Math.max(Math.abs(dz)-2.75,0));
  const sign=Math.hypot(Math.max(Math.abs(c*dx-s*dz)-6,0),Math.max(Math.abs(s*dx+c*dz)-.05,0));
  return Math.min(roof,sign);
}

/** Keep the existing corner marker whenever its complete geometry is safe.
 * Only conflicting posts move, using deterministic nearby candidates; names,
 * height, roof style and their road-facing orientation remain unchanged. */
export function createMonzaMarshalLayouts(track:MarshalTrack,options:MarshalLayoutOptions={}):MonzaMarshalLayout[] {
  if(track.id!=='monza')return [];
  const historic=createHistoricOvalLayout(track),stands=createStandLayouts(track),landmarks=createBackgroundLandmarkLayouts(track),props=createCircuitPropLayouts(track),equipmentProps=props.filter(prop=>prop.kind==='marshal-equipment'),result:MonzaMarshalLayout[]=[];
  const conflicts=(candidate:Pick<MonzaMarshalLayout,'x'|'z'|'yaw'>,stopEarly:boolean)=>{
    const reasons=new Set<string>(),clearance={road:Infinity,historic:Infinity,stands:Infinity,landmarks:Infinity};
    for(const p of marshalPostFootprint(candidate)){
      const near=track.nearest(p.x,p.z),road=Math.hypot(p.x-near.point.x,p.z-near.point.z);
      clearance.road=Math.min(clearance.road,road);
      if(road<=26.05)reasons.add('modern-road-and-fence');
      if(track.isPitLane(p.x,p.z))reasons.add('pit-lane');
      const old=distanceToHistoricOval(p.x,p.z,historic);clearance.historic=Math.min(clearance.historic,old);
      if(old<3.05)reasons.add('historic-road');
      for(const stand of stands){const distance=distanceToStand(p.x,p.z,stand);clearance.stands=Math.min(clearance.stands,distance);if(distance<2.05)reasons.add('grandstand');}
      for(const landmark of landmarks){const distance=distanceToLandmark(p.x,p.z,landmark);clearance.landmarks=Math.min(clearance.landmarks,distance);if(distance<2.05)reasons.add('background-building');}
      if(options.excluded?.(p.x,p.z))reasons.add('reserved-connection');
      // Equipment follows its separately audited prop layout. Do not move it
      // here or invalidate that manifest's tree and old-road exclusions.
      for(const prop of equipmentProps){
        const c=Math.cos(prop.yaw),s=Math.sin(prop.yaw),dx=p.x-prop.x,dz=p.z-prop.z;
        if(Math.abs(c*dx-s*dz)<prop.width/2+.15&&Math.abs(s*dx+c*dz)<prop.depth/2+.15)reasons.add('marshal-equipment');
      }
      if(result.some(post=>distanceToMarshalPost(p.x,p.z,post)<.5))reasons.add('another-marshal-post');
      if(stopEarly&&reasons.size)return {reasons:[...reasons],clearance};
    }
    return {reasons:[...reasons],clearance};
  };
  for(let cornerIndex=0;cornerIndex<track.corners.length;cornerIndex++){
    const corner=track.corners[cornerIndex],sample=track.sampleAt(corner.distance),original={x:sample.point.x+sample.right.x*29,z:sample.point.z+sample.right.z*29};
    const yaw=Math.atan2(-sample.right.x,-sample.right.z),initial=conflicts({...original,yaw},false);
    let chosen:Point2|undefined=initial.reasons.length?undefined:original;
    // Search along the outside normal first, followed by small angular offsets.
    // This keeps safe original posts fixed and minimizes distracting relocation.
    for(const radius of [1,2,3,4,6,8,10,14,18,24,32,40,48,64]){
      if(chosen)break;
      for(const step of [0,1,-1,2,-2,3,-3,4,-4,5,-5,6,-6,7,-7,8]){
        const angle=step*Math.PI/8,c=Math.cos(angle),s=Math.sin(angle),dx=sample.right.x*c-sample.right.z*s,dz=sample.right.x*s+sample.right.z*c;
        const candidate={x:original.x+dx*radius,z:original.z+dz*radius,yaw};
        if(!conflicts(candidate,true).reasons.length){chosen=candidate;break;}
      }
    }
    if(!chosen)throw new Error(`No safe marshal post layout for ${corner.name}`);
    const footprint=marshalPostFootprint({...chosen,yaw}),equipment=props.find(p=>p.id===`marshal-equipment-${cornerIndex+1}`);
    result.push({id:`marshal-post-${cornerIndex}`,cornerIndex,name:corner.name,x:chosen.x,z:chosen.z,yaw,original,shift:{x:chosen.x-original.x,z:chosen.z-original.z},moved:chosen!==original,reasons:initial.reasons,
      roof:{width:5.5,depth:5.5},sign:{width:12,depth:.1},bounds:{minX:Math.min(...footprint.map(p=>p.x)),maxX:Math.max(...footprint.map(p=>p.x)),minZ:Math.min(...footprint.map(p=>p.z)),maxZ:Math.max(...footprint.map(p=>p.z))},
      equipment:equipment?{id:equipment.id,x:equipment.x,z:equipment.z,yaw:equipment.yaw}:undefined,clearance:conflicts({...chosen,yaw},false).clearance});
  }
  return result;
}
