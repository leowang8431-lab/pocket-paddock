import type {WeatherMode} from './conditions';
import type {RaceState} from './race';

export const MONZA_DRS_REFERENCE='https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf';
export const MONZA_REAL_LENGTH=5793;
export const SPA_REAL_LENGTH=7004;
export const SPA_DRS_REFERENCE='https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_quarantine_zone_and_red_zones.pdf';
export const MONACO_DRS_REFERENCE='https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_race_directors_event_notes_-_circuit_map_pit_lane_map_ers_battery_containment_area_red_zones.pdf';
export interface DrsZone {id:1|2;name:string;detection:number;start:number;end:number;sourceYear:2025}
interface DrsTrack {length:number;width:number;corners:{name:string;distance:number}[];nearest(x:number,z:number):{distance:number}}
export function wrapDistance(distance:number,length:number){return((distance%length)+length)%length;}
export function withinZone(distance:number,zone:Pick<DrsZone,'start'|'end'>,length:number){
  return wrapDistance(distance-zone.start,length)<wrapDistance(zone.end-zone.start,length);
}

/** The real offsets are compressed by the circuit-length ratio. Corner exit
 * anchors follow our artistic centreline, rather than claiming survey accuracy.
 * FIA 2025 Doc 5 p.2: detect1 95m beforeT7, activate1 170m afterT7;
 * detect2 20m afterT11, activate2 12m afterthefinishline. */
export function createMonzaDrsZones(track:DrsTrack):DrsZone[]{
  const scale=track.length/MONZA_REAL_LENGTH;
  const turn7=track.corners.find(c=>c.name.startsWith('Lesmo 2'))!.distance;
  const turn7Exit=track.nearest(195,-207).distance;
  const turn11Exit=track.nearest(-85,165).distance;
  return[
    {id:1,name:'Serraglio',detection:wrapDistance(turn7-95*scale,track.length),start:wrapDistance(turn7Exit+170*scale,track.length),end:track.nearest(99,-61).distance-4,sourceYear:2025},
    {id:2,name:'Rettifilo',detection:wrapDistance(turn11Exit+20*scale,track.length),start:12*scale,end:track.nearest(-85,-118).distance-3,sourceYear:2025},
  ];
}

/** FIA 2025 Belgian GP: 240m before T2 / 305m after T4, and
 * 160m before T18 / 30m after T19. Exit anchors follow the game centreline. */
export function createSpaDrsZones(track:DrsTrack):DrsZone[]{
  const scale=track.length/SPA_REAL_LENGTH;
  const corner=(name:RegExp)=>{const c=track.corners.find(c=>name.test(c.name));if(!c)throw new Error(`Missing Spa corner: ${name}`);return c.distance;};
  const eau=corner(/Eau Rouge/i),crest=corner(/Raidillon/i),combes=corner(/Les Combes/i),source=corner(/La Source/i),busStop=corner(/Bus Stop/i);
  const turn19Exit=busStop+55*scale;
  return[
    {id:1,name:'Kemmel',detection:wrapDistance(eau-240*scale,track.length),start:wrapDistance(crest+305*scale,track.length),end:wrapDistance(combes-110*scale,track.length),sourceYear:2025},
    {id:2,name:'Pit Straight',detection:wrapDistance(busStop-160*scale,track.length),start:wrapDistance(turn19Exit+30*scale,track.length),end:wrapDistance(source-65*scale,track.length),sourceYear:2025},
  ];
}

/** The retained 2025 map specifies detection 80m after T16 and activation
 * 18m after T19. Closing before T1 is an authored braking margin. */
export function createMonacoDrsZones(track:DrsTrack):DrsZone[]{
 const turn16=track.corners[15],turn19=track.corners[18],turn1=track.corners[0];
 if(!turn16||!turn19||!turn1)throw new Error('Monaco requires all nineteen corner anchors.');
 const scale=track.length/3337;
 return[{id:1,name:'Boulevard Albert I',detection:wrapDistance(turn16.distance+80*scale,track.length),start:wrapDistance(turn19.distance+18*scale,track.length),end:wrapDistance(turn1.distance-35*scale,track.length),sourceYear:2025}];
}
export type DrsState='outside'|'ready'|'active'|'wet'|'slow'|'braking'|'offtrack'|'closed';
export interface DrsSummary {state:DrsState;zone:number|null;distanceToZone:number;active:boolean;available:boolean}
export interface DrsContext {state:RaceState;weather:WeatherMode;distance:number;speed:number;brake:number;onRoad:boolean;pitLane:boolean;forward:number;collision:number}

/** Practice/time-trial DRS: no invented AI car or one-second gap requirement.
 * Each zone needs a fresh manual request. Braking/zone-exit clears the request. */
export class DrsController {
  private requested=false;
  private current:DrsSummary={state:'closed',zone:null,distanceToZone:0,active:false,available:false};
  constructor(readonly zones:readonly DrsZone[],readonly length:number,readonly realLength=MONZA_REAL_LENGTH){}
  get summary():DrsSummary{return{...this.current};}
  reset(){this.requested=false;this.current={...this.current,active:false,available:false,state:'closed'};}
  toggle():boolean{
    if(this.current.active){this.requested=false;this.current={...this.current,active:false,state:'ready'};return true;}
    if(!this.current.available)return false;
    this.requested=true;this.current={...this.current,active:true,state:'active'};return true;
  }
  update(context:DrsContext):DrsSummary{
    const zone=this.zones.find(zone=>withinZone(context.distance,zone,this.length));
    let next=Infinity;for(const candidate of this.zones)next=Math.min(next,wrapDistance(candidate.start-context.distance,this.length));
    let state:DrsState='ready';
    if(context.state!=='racing')state='closed';
    else if(context.weather==='rainy')state='wet';
    else if(!context.onRoad||context.pitLane||context.forward<.3||context.collision>.05)state='offtrack';
    else if(!zone)state='outside';
    else if(context.brake>0)state='braking';
    else if(context.speed<12)state='slow';
    const available=state==='ready';
    if(!available)this.requested=false;
    const active=available&&this.requested;
    this.current={state:active?'active':state,zone:zone?.id??null,distanceToZone:zone?0:Math.round(next*this.realLength/this.length),active,available};
    return this.summary;
  }
}
