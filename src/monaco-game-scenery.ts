import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createMonacoScenery} from './monaco-scenery';
import {MONACO_GAME_SCALE,type MonacoBarrierSegment} from './monaco-drive-track';
import type {MonacoLayout} from './monaco-layout';
import {MONACO_PIT_TEAMS,monacoPitIndex} from './monaco-team-pits';
import {teams,type TeamId} from './team-catalog';
import type {StandLayout} from './stand-layout';

interface SceneTrack {readonly monacoLayout?:MonacoLayout;readonly monacoScale:number;readonly group:THREE.Group;}
type Footprint={id:string;x:number;z:number;width:number;depth:number;yaw:number;minY:number;kind:string;overTunnel:boolean};

/** Runtime batching preserves already-baked colours. Reusing the ordinary
 * primitive batcher would turn the approved map's vertex-colour meshes white. */
function batchRuntimeMap(root:THREE.Group,protectedRoots:readonly THREE.Object3D[],cellSize=96){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),cells=new Map<string,THREE.BufferGeometry[]>(),sources:THREE.Mesh[]=[];
 const protectedMesh=(object:THREE.Object3D)=>{for(let o:THREE.Object3D|null=object;o;o=o.parent)if(protectedRoots.includes(o))return true;return false;};
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||Array.isArray(object.material)||protectedMesh(object))return;
  const material=object.material;if(!(material instanceof THREE.MeshStandardMaterial)||material.transparent||material.map||material.emissive.getHex()!==0)return;
  const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();geometry.clearGroups();
  for(const name of Object.keys(geometry.attributes))if(!['position','normal','uv','color'].includes(name))geometry.deleteAttribute(name);
  if(!geometry.attributes.normal)geometry.computeVertexNormals();const count=geometry.attributes.position.count;
  if(!geometry.attributes.uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
  const old=material.vertexColors?geometry.attributes.color:undefined,colors=new Float32Array(count*3);
  for(let i=0;i<count;i++){colors[i*3]=(old?.getX(i)??1)*material.color.r;colors[i*3+1]=(old?.getY(i)??1)*material.color.g;colors[i*3+2]=(old?.getZ(i)??1)*material.color.b;}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));geometry.computeBoundingBox();
  const center=geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(root.matrixWorld),key=`${Math.floor(center.x/cellSize)},${Math.floor(center.z/cellSize)}`;
  if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(geometry);sources.push(object);
 });
 const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.8});
 for(const [key,parts]of cells){const geometry=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=`monaco-runtime-cell-${key}`;mesh.receiveShadow=true;mesh.castShadow=false;root.add(mesh);}
 for(const mesh of sources){mesh.removeFromParent();mesh.geometry.dispose();}
 return{cells:cells.size,sourceDraws:sources.length,cellSize};
}

function footprintEdges(p:Footprint,scale:number):MonacoBarrierSegment[]{
 const c=Math.cos(p.yaw),s=Math.sin(p.yaw),points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>({x:(p.x+c*x*p.width/2+s*z*p.depth/2)*scale,z:(p.z-s*x*p.width/2+c*z*p.depth/2)*scale}));
 return points.map((a,i)=>{const b=points[(i+1)%points.length];return{ax:a.x,az:a.z,bx:b.x,bz:b.z,radius:.06*scale,bottom:p.minY*scale,top:(p.minY+5)*scale};});
}

/** The accepted Monaco map is used directly, at the same uniform scale as the
 * track adapter. The independent model-review page remains unchanged. */
export function createMonacoGameScenery(track:SceneTrack):THREE.Group{
 const layout=track.monacoLayout;if(!layout)throw Error('Monaco scenery requires the track-owned layout');
 const scale=track.monacoScale;if(scale!==MONACO_GAME_SCALE)throw Error('Monaco render and driving scales disagree');
 const authored=createMonacoScenery(layout),root=authored.group;root.name='Monaco playable harbour city';root.scale.setScalar(scale);
 const sourceSummary=authored.summary,scaledBoxes=layout.pitBoxes.map(b=>({...b,center:b.center.clone().multiplyScalar(scale),apronCenter:b.apronCenter.clone().multiplyScalar(scale),front:b.front.clone(),tangent:b.tangent.clone(),width:b.width*scale,depth:b.depth*scale,apronWidth:b.apronWidth*scale}));
 const facilityBarrierSegments:MonacoBarrierSegment[]=[];
 for(const p of sourceSummary.placements){
  // A tunnel or an elevated hotel terrace must not become an invisible solid
  // box across its drivable road. Garage mouths have their own open U shape.
  if(p.overTunnel||p.kind==='pit-building'||p.kind==='pitwall-strategy')continue;
  facilityBarrierSegments.push(...footprintEdges(p,scale));
 }
 for(const b of scaledBoxes){const yaw=Math.atan2(b.front.x,b.front.z),c=Math.cos(yaw),s=Math.sin(yaw),point=(x:number,z:number)=>({x:b.center.x+c*x+s*z,z:b.center.z-s*x+c*z}),half=b.width/2-.08*scale,rear=-b.depth/2+.12*scale;
  for(const [a,z]of [[[-half,rear],[half,rear]],[[-half,-b.depth/2],[-half,b.depth/2]],[[half,-b.depth/2],[half,b.depth/2]]] as const){const first=point(a[0],a[1]),last=point(z[0],z[1]);facilityBarrierSegments.push({ax:first.x,az:first.z,bx:last.x,bz:last.z,radius:.08*scale,bottom:b.center.y,top:b.center.y+3.3*scale});}
 }
 for(const pod of authored.pitwall.pods)facilityBarrierSegments.push(...footprintEdges({id:pod.id,kind:'strategy',x:pod.center.x,z:pod.center.z,width:pod.width,depth:pod.depth,yaw:pod.group.rotation.y,minY:pod.center.y,overTunnel:false},scale));
 const stands:StandLayout[]=sourceSummary.stands.map(s=>{const target=layout.sampleAt(s.targetDistance);return{id:s.id,x:s.x*scale,z:s.z*scale,yaw:s.yaw,width:s.width*scale,rows:6,covered:s.id==='P'||s.id==='T',target:{x:target.point.x*scale,z:target.point.z*scale,distance:s.targetDistance*scale},minTrackClearance:scale,minColliderClearance:0};});
 const lastGarage=root.getObjectByName('monaco-pit-box-8')!,lastPod=authored.pitwall.pods[7].group;
 const mutableColors:{attribute:THREE.BufferAttribute;original:Float32Array}[]=[];
 for(const node of [lastGarage,lastPod])node.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry.attributes.color){const attribute=o.geometry.attributes.color as THREE.BufferAttribute;mutableColors.push({attribute,original:new Float32Array(attribute.array)});}});
 const garageAtlas=root.getObjectByName('monaco-building-label-pit-frontages') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
 const podLabel=lastPod.getObjectByName('monaco-pitwall-team-name') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
 const assignments=[...MONACO_PIT_TEAMS],originalColor=new THREE.Color(0xaaa99d);
 const canvasTexture=(mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>)=>{const map=mesh?.material.map;if(!map)return undefined;const canvas=map.image as HTMLCanvasElement;return typeof canvas?.getContext==='function'?{canvas,map}:undefined;};
 const selectPitTeam=(selected:TeamId)=>{
  const team=teams.find(t=>t.id===(monacoPitIndex(selected)===7?selected:'haas'))!;assignments[7]=team.id;const color=new THREE.Color(team.id==='haas'?0xaaa99d:team.color);
  for(const {attribute,original}of mutableColors){attribute.array.set(original);for(let i=0;i<attribute.count;i++)if(Math.abs(original[i*3]-originalColor.r)<1e-5&&Math.abs(original[i*3+1]-originalColor.g)<1e-5&&Math.abs(original[i*3+2]-originalColor.b)<1e-5)attribute.setXYZ(i,color.r,color.g,color.b);attribute.needsUpdate=true;}
  const atlas=canvasTexture(garageAtlas);if(atlas){const {canvas,map}=atlas,ctx=canvas.getContext('2d')!,row=7*128;ctx.fillStyle='#244e49';ctx.fillRect(0,row,canvas.width,128);ctx.fillStyle='#fff3cc';ctx.font='700 65px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`08 / ${team.name.toUpperCase()}`,512,row+67,960);map.needsUpdate=true;}
  const label=canvasTexture(podLabel);if(label){const {canvas,map}=label,ctx=canvas.getContext('2d')!;ctx.fillStyle='#183c3c';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=team.id==='haas'?'#aaa99d':team.color;ctx.fillRect(0,0,30,canvas.height);ctx.fillStyle='#f5f1dc';ctx.font='700 70px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(team.name.toUpperCase(),520,69,930);map.needsUpdate=true;}
  garageAtlas.userData.activeEighthTeam=team.id;podLabel.userData.activeEighthTeam=team.id;
  const pod=authored.pitwall.pods[7];pod.teamName=team.name;pod.teamColor=color.getHex();
  root.userData.monacoPitAssignments=[...assignments];root.userData.pitComplex.strategyPods[7].teamId=team.id;root.userData.pitComplex.strategyPods[7].teamName=team.name;
 };
 const batching=batchRuntimeMap(root,[lastGarage,lastPod]);
 root.userData.stands=stands;
 root.userData.pitComplex={reference:layout.references.map,artistic:'Approved eight-bay miniature Monaco row; the selected non-base team receives the configurable eighth bay.',heightScale:scale,boxes:{id:'monaco-garage-row',kind:'garages',x:scaledBoxes.reduce((s,b)=>s+b.center.x,0)/8,z:scaledBoxes.reduce((s,b)=>s+b.center.z,0)/8,width:scaledBoxes[0].center.distanceTo(scaledBoxes[7].center)+scaledBoxes[0].width,depth:layout.pitProfile.garageDepth*scale,yaw:Math.atan2(scaledBoxes[0].front.x,scaledBoxes[0].front.z),height:6.08*scale,minY:scaledBoxes[0].center.y,solid:false},garages:scaledBoxes,strategyPods:authored.pitwall.pods.map((p,i)=>({id:p.id,kind:'strategy-pod',teamId:assignments[i],teamName:p.teamName,x:p.center.x*scale,z:p.center.z*scale,width:p.width*scale,depth:p.depth*scale,yaw:p.group.rotation.y,height:2.1*scale,minY:p.center.y*scale,solid:true})),footprints:sourceSummary.placements.map(p=>({...p,x:p.x*scale,z:p.z*scale,width:p.width*scale,depth:p.depth*scale,minY:p.minY*scale})),screenData:'authored decorative telemetry'};
 root.userData.monacoPitBoxes=scaledBoxes;root.userData.monacoPitAssignments=[...assignments];root.userData.selectPitTeam=selectPitTeam;root.userData.pitColliders=[];root.userData.facilityBarrierSegments=facilityBarrierSegments;
 root.userData.landmarks=authored.landmarks.map(l=>({id:l.id,name:l.name,zh:l.zh,x:l.point.x*scale,z:l.point.z*scale,width:(l.bounds.max.x-l.bounds.min.x)*scale,length:(l.bounds.max.z-l.bounds.min.z)*scale,height:(l.bounds.max.y-l.bounds.min.y)*scale,reference:layout.references.map,artistic:l.description}));
 root.userData.backgroundLandmarks=authored.landmarks.map(l=>({id:l.id,x:l.point.x*scale,z:l.point.z*scale,yaw:0,width:(l.bounds.max.x-l.bounds.min.x)*scale,depth:(l.bounds.max.z-l.bounds.min.z)*scale,height:(l.bounds.max.y-l.bounds.min.y)*scale}));
 root.userData.architecture={heightScale:scale,footprintsPreserved:true,uniformWorldScale:scale,batching};root.userData.grandstands={count:sourceSummary.grandstands,spectators:sourceSummary.spectators};root.userData.forest={instances:sourceSummary.trees.length,kinds:Object.keys(sourceSummary.treeCounts),treeCounts:sourceSummary.treeCounts};root.userData.circuitProps=[];root.userData.tracksideSafety={vehicles:[],tyreBarriers:[]};root.userData.monacoGame={scale,reviewVersion:'1.6',cityBuildings:sourceSummary.cityBuildings,yachts:sourceSummary.yachts,trees:sourceSummary.trees.length,garages:8,strategyRooms:8};
 track.group.traverse(o=>{if(o.name.startsWith('monaco-start-lamp-grid-facing-'))o.name=`start-light-${Number(o.name.split('-').at(-1))-1}`;});
 selectPitTeam('haas');root.updateMatrixWorld(true);root.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;if(o instanceof THREE.Mesh)o.castShadow=false;});
 return root;
}
