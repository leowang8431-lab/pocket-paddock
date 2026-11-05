import * as THREE from 'three';
import type {Track} from './track';
import {createHistoricOvalLayout} from './monza-historic-oval';
import {addMonzaHistoricConnection,historicConnectionSurfacePoint,type HistoricConnectionLayout,type HistoricConnectionSample} from './monza-historic-connection';
import {createHistoricSouthPlan} from './monza-historic-south-plan';

type ConnectionTrack=Pick<Track,'id'|'nearest'|'isPitLane'|'widthAt'|'sampleAt'>;
const cache=new WeakMap<object,HistoricConnectionLayout|null>();
const smooth=(t:number)=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};

/** Closed scenic return from the old south bank into the west GP shoulder.
 * This is the final portion of the same single convex curve used by the old
 * banking, with its crossfall removed before the actual merge taper. */
export function createHistoricSouthConnectionLayout(track:ConnectionTrack):HistoricConnectionLayout|null {
  if(cache.has(track))return cache.get(track)!;
  if(track.id!=='monza'){cache.set(track,null);return null;}
  const oval=createHistoricOvalLayout(track),old=oval.samples.at(-1)!,plan=createHistoricSouthPlan(track);
  const total=plan.length-plan.splitArc,count=Math.ceil(total/.65),samples:HistoricConnectionSample[]=[];let length=0;
  for(let i=0;i<=count;i++){
    const arc=total*i/count,at=plan.sampleAtArc(plan.splitArc+arc),p=at.point,direction=i===0?new THREE.Vector3(old.tangent.x,0,old.tangent.z):at.tangent;
    const right=new THREE.Vector3(direction.z,0,-direction.x),progress=i/count,previous=samples.at(-1),flatten=smooth(progress/.5);
    if(previous)length+=Math.hypot(p.x-previous.x,p.z-previous.z);
    samples.push({x:p.x,z:p.z,distance:length,width:oval.width,baseHeight:THREE.MathUtils.lerp(old.baseHeight,.045,flatten),bank:old.bank*(1-flatten),tangent:{x:direction.x,z:direction.z},right:{x:right.x,z:right.z}});
  }
  const layout:HistoricConnectionLayout={id:'monza-historic-south-connection',samples,length,modernDistance:plan.modernDistance,modernSide:1,closedToRacing:true,gateSample:Math.round(count*.26),footprintMargin:.65,mergeIntoMainRoad:true,
    artistic:'Closed miniature southern maintenance return on the same single convex cubic sweep as the old banking. Crossfall and base height become flat halfway through the return; its full-width GP merge is trimmed against the real racing asphalt. Authored scenery rather than a surveyed or playable historical junction.'};
  cache.set(track,layout);return layout;
}

export function addMonzaHistoricSouthConnection(root:THREE.Group,track:ConnectionTrack,layout=createHistoricSouthConnectionLayout(track)):HistoricConnectionLayout|null {
  if(!layout)return null;
  addMonzaHistoricConnection(root,track,layout);
  const group=root.getObjectByName(layout.id)!;
  const material=new THREE.MeshStandardMaterial({color:0xa0a694,roughness:.91}),footMaterial=new THREE.MeshStandardMaterial({color:0x8f9987,roughness:.91});
  let count=0,next=3;
  for(const sample of layout.samples){
    if(sample.distance<next||sample.bank<.4||sample.width<4)continue;
    next=sample.distance+6;
    const half=sample.width/2;
    let clear=true;
    for(const offset of [-half-.22,-half/2,0,half/2,half+.22])for(const along of [-.30,.30]){
      const x=sample.x+sample.right.x*offset+sample.tangent.x*along,z=sample.z+sample.right.z*offset+sample.tangent.z*along,near=track.nearest(x,z);
      if(Math.hypot(x-near.point.x,z-near.point.z)<=26.8||track.isPitLane(x,z))clear=false;
    }
    if(!clear)continue;
    const thickness=.18+.37*sample.bank,shape=new THREE.Shape();
    shape.moveTo(-half,.06);shape.lineTo(half,.06);
    for(let j=6;j>=0;j--)shape.lineTo((j/6-.5)*sample.width,Math.max(.08,historicConnectionSurfacePoint(sample,j/6).y-thickness+.015));
    shape.closePath();
    const hole=new THREE.Path();hole.moveTo(sample.width*.1,.12);hole.lineTo(sample.width*.1,.18);hole.quadraticCurveTo(sample.width*.29,1.35*sample.bank,sample.width*.43,.18);hole.lineTo(sample.width*.43,.12);hole.closePath();shape.holes.push(hole);
    const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(sample.right.x,0,sample.right.z),new THREE.Vector3(0,1,0),new THREE.Vector3(sample.tangent.x,0,sample.tangent.z));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.38,bevelEnabled:false,curveSegments:6,steps:1});geometry.translate(0,0,-.19);geometry.applyMatrix4(basis);geometry.translate(sample.x,0,sample.z);
    const rib=new THREE.Mesh(geometry,material);rib.name=`historic-south-connection-support-${count}`;rib.receiveShadow=true;group.add(rib);
    for(const offset of [-half+.18,half-.18]){
      const footGeometry=new THREE.BoxGeometry(.70,.16,.70).applyMatrix4(basis).translate(sample.x+sample.right.x*offset,.08,sample.z+sample.right.z*offset);
      const foot=new THREE.Mesh(footGeometry,footMaterial);foot.name=`historic-south-connection-foot-${count}-${offset}`;foot.receiveShadow=true;group.add(foot);
    }
    count++;
  }
  group.userData.supportCount=count;
  return layout;
}
