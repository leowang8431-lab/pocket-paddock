import * as THREE from 'three';
import {asphaltTexture,catchFenceMaterial} from './monza-details';
import type {Track,TrackSample} from './track';

/** Horizontal plan from Tomislav Bacinger's f1-circuits, MIT.
 * https://github.com/bacinger/f1-circuits/blob/master/circuits/be-1925.geojson
 * Elevation stations follow the venue access/organiser map. This is a
 * drivable miniature reconstruction, not a surveyed 1:1 civil model. */
export const SPA_REFERENCE='https://www.spa-francorchamps.be/sites/default/files/pdf/en/SF_access-organiser.pdf';
export const SPA_GEOJSON_REFERENCE='https://github.com/bacinger/f1-circuits/blob/master/circuits/be-1925.geojson';
export const SPA_REAL_LENGTH=7004;
export const SPA_METRES_PER_UNIT=5/3;
const geographic:readonly (readonly [number,number])[]=[[5.96502,50.444251],[5.963419,50.446033],[5.963402,50.446113],[5.963473,50.446184],[5.963621,50.446217],[5.963786,50.446188],[5.964313,50.446019],[5.965592,50.445628],[5.966207,50.445387],[5.966847,50.445085],[5.967421,50.444779],[5.967876,50.444463],[5.970321,50.442606],[5.970493,50.442502],[5.970788,50.442385],[5.971315,50.442168],[5.971546,50.442022],[5.971741,50.441824],[5.971866,50.441644],[5.971949,50.441442],[5.97202,50.441069],[5.972061,50.440937],[5.972132,50.440815],[5.972268,50.440655],[5.973476,50.439424],[5.974245,50.438642],[5.974458,50.43835],[5.974594,50.438133],[5.974754,50.437784],[5.975719,50.435639],[5.977199,50.432382],[5.977542,50.431599],[5.97756,50.431472],[5.977524,50.431331],[5.977406,50.431218],[5.977234,50.431123],[5.977015,50.431048],[5.976885,50.430968],[5.976796,50.430874],[5.976725,50.430732],[5.976737,50.430591],[5.977033,50.429747],[5.977027,50.429601],[5.97698,50.429469],[5.97682,50.429323],[5.97663,50.429224],[5.973257,50.427739],[5.973044,50.427682],[5.972831,50.427678],[5.972606,50.42772],[5.972422,50.427805],[5.972292,50.427927],[5.972239,50.42805],[5.972227,50.428182],[5.972292,50.428305],[5.97241,50.428432],[5.972582,50.428521],[5.974056,50.429101],[5.974216,50.429205],[5.974304,50.429309],[5.97434,50.429431],[5.974322,50.429582],[5.973712,50.430723],[5.973523,50.431189],[5.973091,50.432627],[5.972878,50.433452],[5.972831,50.433593],[5.972724,50.433744],[5.972582,50.433867],[5.972369,50.433999],[5.972132,50.434098],[5.971872,50.434164],[5.971599,50.434192],[5.970717,50.43423],[5.97038,50.434206],[5.970072,50.43415],[5.969759,50.434065],[5.969504,50.433956],[5.969208,50.433782],[5.969019,50.433608],[5.968812,50.433358],[5.967977,50.432028],[5.967231,50.430845],[5.967071,50.430661],[5.966882,50.430534],[5.966622,50.43044],[5.966361,50.430393],[5.966119,50.430388],[5.965876,50.430421],[5.965669,50.430482],[5.965325,50.430624],[5.9651,50.430685],[5.964828,50.430713],[5.964556,50.430694],[5.964307,50.430643],[5.964094,50.430548],[5.963958,50.43044],[5.963792,50.430294],[5.962425,50.428927],[5.962289,50.428847],[5.962123,50.42879],[5.961922,50.428762],[5.961697,50.428771],[5.961502,50.428828],[5.960578,50.429257],[5.960034,50.429511],[5.959898,50.429624],[5.959756,50.429761],[5.959673,50.429893],[5.959614,50.430049],[5.959602,50.430209],[5.959643,50.430402],[5.959738,50.430567],[5.959862,50.430779],[5.960046,50.4311],[5.960365,50.431463],[5.960715,50.431779],[5.961247,50.43216],[5.962135,50.432712],[5.962656,50.432971],[5.9631,50.433136],[5.965385,50.433895],[5.965716,50.434027],[5.96603,50.434183],[5.96632,50.434357],[5.966568,50.434546],[5.966799,50.434744],[5.967107,50.435106],[5.967356,50.435455],[5.967924,50.436261],[5.968024,50.436436],[5.968084,50.436624],[5.968095,50.43686],[5.968036,50.437072],[5.967699,50.437624],[5.967332,50.438232],[5.966888,50.438991],[5.966775,50.439273],[5.966669,50.439608],[5.966604,50.439919],[5.966562,50.440183],[5.966432,50.441404],[5.966456,50.441484],[5.966533,50.441541],[5.966651,50.44156],[5.966852,50.441541],[5.96706,50.441541],[5.967202,50.44156],[5.967296,50.441626],[5.96732,50.441701],[5.967261,50.4418],[5.966533,50.442559]];
export const SPA_ELEVATION_STATIONS:readonly (readonly [number,number])[]=[
 [0,418],[220,424],[310,419],[690,403],[890,391],[1130,415],[1490,446],
 [2200,463],[2470,470],[2870,455],[3110,438],[3600,402],[4280,377],
 [4740,375],[5100,373],[5700,388],[6000,398],[6540,408],[7004,418],
];
const anchors:[string,number][]=[
 ['La Source · 拉索斯发夹',3],['Eau Rouge · 红水弯',13],['Raidillon · 拉迪永上坡',20],
 ['Kemmel · 凯梅尔直道',27],['Les Combes · 莱孔布',33],['Malmedy · 马尔梅迪',40],
 ['Bruxelles · 布鲁塞尔',49],['No Name · 无名弯',59],['Pouhon · 双左弯',72],
 ['Fagnes · 法涅',90],['Stavelot · 斯塔夫洛',105],['Paul Frère · 保罗弗雷尔',118],
 ['Blanchimont · 布兰希蒙',133],['Bus Stop · 巴士站减速弯',145],
];
function elevation(metres:number){
 const stations=SPA_ELEVATION_STATIONS;let i=0;while(i<stations.length-2&&metres>stations[i+1][0])i++;
 const [x0,y0]=stations[i],[x1,y1]=stations[i+1],h=x1-x0,t=THREE.MathUtils.clamp((metres-x0)/h,0,1);
 const secant=(j:number)=>(stations[j+1][1]-stations[j][1])/(stations[j+1][0]-stations[j][0]);
 const slope=(j:number)=>{if(j===0)return secant(0);if(j===stations.length-1)return secant(j-1);const a=secant(j-1),b=secant(j);return a*b<=0?0:2*a*b/(a+b);};
 const m0=slope(i),m1=slope(i+1);
 return (2*t*t*t-3*t*t+1)*y0+(t*t*t-2*t*t+t)*h*m0+(-2*t*t*t+3*t*t)*y1+(t*t*t-t*t)*h*m1;
}
export function createSpaDefinition(){
 const origin=geographic[0],m=111320,c=Math.cos(origin[1]*Math.PI/180);
 const projected=geographic.map(([lon,lat])=>new THREE.Vector2((lon-origin[0])*m*c,(lat-origin[1])*m));
 const direction=projected[1].clone().normalize(),distance=[0];
 for(let i=1;i<projected.length;i++)distance.push(distance.at(-1)!+projected[i].distanceTo(projected[i-1]));
 const planarLength=distance.at(-1)!+projected.at(-1)!.length();
 const entries=projected.map((p,i)=>({p,metres:distance[i]/planarLength*SPA_REAL_LENGTH}));
 // Add the documented elevation stations without changing the horizontal plan.
 for(const [metres]of SPA_ELEVATION_STATIONS.slice(1,-1)){
  let i=0;while(i<entries.length-1&&entries[i+1].metres<metres)i++;
  const a=entries[i],b=entries[(i+1)%entries.length],end=i===entries.length-1?SPA_REAL_LENGTH:b.metres;
  entries.push({p:a.p.clone().lerp(b.p,(metres-a.metres)/(end-a.metres)),metres});
  entries.sort((a,b)=>a.metres-b.metres);
 }
 let points=entries.map(({p,metres})=>new THREE.Vector3((p.x*direction.y-p.y*direction.x)*.6,(elevation(metres)-418)*.6,-p.dot(direction)*.6));
 const sourcePoints=points.slice(),atGeo=(index:number)=>entries.findIndex(e=>e.p===projected[index]);
 const arc=(start:THREE.Vector3,from:number,to:number,radius:number)=>{
  const sign=Math.sign(to-from),count=Math.ceil(Math.abs(to-from)*radius/2),result:THREE.Vector3[]=[];
  for(let i=0;i<=count;i++){const h=THREE.MathUtils.lerp(from,to,i/count);result.push(new THREE.Vector3(start.x+radius/sign*(Math.cos(from)-Math.cos(h)),start.y,start.z+radius/sign*(Math.sin(h)-Math.sin(from))));}return result;
 };
 // The geographic plan's two ~6-unit inner radii cannot be driven with the
 // game's unchanged 3.1-unit wheelbase/steering rack. Round only these local
 // centre lines with ~17- and 18-unit arcs; retain the hairpin and R/L chicane.
 const exit=sourcePoints[atGeo(6)].clone(),out=sourcePoints[atGeo(7)].clone().sub(exit).setY(0).normalize(),heading=Math.atan2(out.x,out.z),hairpinRadius=(exit.x-sourcePoints[0].x)/(1+Math.cos(heading));
 const hairpinStart=new THREE.Vector3(sourcePoints[0].x,3.4,exit.z+hairpinRadius*Math.sin(heading)),hairpin=arc(hairpinStart,Math.PI,heading,hairpinRadius);
 hairpin.forEach((p,i)=>p.y=THREE.MathUtils.lerp(hairpinStart.y,exit.y,i/(hairpin.length-1)));
 const hairpinAnchor=hairpin[Math.floor(hairpin.length/2)].clone();
 points=[sourcePoints[0],...hairpin,...sourcePoints.slice(atGeo(6)+1)];
 const busStart=sourcePoints[entries.findIndex(e=>e.metres===6540)],busEnd=sourcePoints.at(-1)!.clone(),incoming=busStart.clone().sub(sourcePoints[atGeo(140)]).setY(0).normalize(),from=Math.atan2(incoming.x,incoming.z),middle=Math.PI/3,radius=18;
 const first=arc(busStart,from,middle,radius),turn=first.at(-1)!,arcDx=radius*(Math.cos(middle)+1),straight=(busEnd.x-turn.x-arcDx)/Math.sin(middle),secondStart=turn.clone().add(new THREE.Vector3(Math.sin(middle)*straight,0,Math.cos(middle)*straight)),second=arc(secondStart,middle,Math.PI,radius);
 const bus=[...first,...second],run=[0];for(let i=1;i<bus.length;i++)run.push(run.at(-1)!+bus[i].distanceTo(bus[i-1]));
 const totalRun=run.at(-1)!+bus.at(-1)!.distanceTo(busEnd);bus.forEach((p,i)=>p.y=THREE.MathUtils.lerp(busStart.y,busEnd.y,run[i]/totalRun));
 const busAnchor=secondStart.clone();
 const busIndex=points.indexOf(busStart); // sourcePoints vectors are shared above.
 points.splice(busIndex,points.length-busIndex-1,...bus);
 const initial=new THREE.CatmullRomCurve3(points,true,'centripetal',.35);initial.arcLengthDivisions=300000;
 const scale=(SPA_REAL_LENGTH/SPA_METRES_PER_UNIT)/initial.getLength();
 points=points.map(p=>p.multiplyScalar(scale).add(new THREE.Vector3(-85,0,100)));
 const cornerPoints=anchors.map(([name,index])=>{const p=projected[index],authored=index===3?hairpinAnchor:index===145?busAnchor:undefined;return{name,x:-85+(authored?.x??(p.x*direction.y-p.y*direction.x)*.6)*scale,z:100+(authored?.z??-p.dot(direction)*.6)*scale};});
 return {points,corners:cornerPoints,scale,geographicPoints:geographic.length,reference:SPA_REFERENCE};
}

/** A terrain-aware road and its kerbs/Armco use the same 3D centre samples. */
export function buildSpaTrack(track:Track,pitPoints:readonly THREE.Vector3[]){
 const half=track.width/2;
 const root=track.group,materials=new Map<number,THREE.MeshStandardMaterial>();
 const mat=(color:number)=>{let result=materials.get(color);if(!result){result=new THREE.MeshStandardMaterial({color,roughness:.88,side:THREE.DoubleSide});materials.set(color,result);}return result;};
 const asphalt=mat(0x53585a);asphalt.name='spa-asphalt';asphalt.userData.weatherSurface='road';const texture=asphaltTexture();if(texture)asphalt.map=texture;
 const meshFrom=(positions:number[],indices:number[],material:THREE.Material,name:string)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(positions.flatMap((_,i)=>i%3===0?[positions[i]/5,positions[i+2]/5]:[]),2));g.setIndex(indices);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.name=name;m.receiveShadow=true;root.add(m);return m;};
 const curvature=(s:TrackSample)=>{const a=track.sampleAt(s.distance-1).tangent,b=track.sampleAt(s.distance+1).tangent;return Math.atan2(a.z*b.x-a.x*b.z,a.dot(b))/2;};
 const offsetAt=(s:TrackSample,offset:number)=>{const k=curvature(s);return offset*k>0?Math.sign(offset)*Math.min(Math.abs(offset),.985/Math.abs(k)):offset;};
 const railClear=(s:TrackSample,side:number)=>{if(curvature(s)*side*24>.95)return false;const x=s.point.x+s.right.x*24*side,z=s.point.z+s.right.z*24*side,n=track.nearest(x,z).point;return !track.isPitLane(x,z)&&Math.hypot(x-n.x,z-n.z)>21;};
 const ribbon=(inner:number,outer:number,raise:number,material:THREE.Material,name:string,filter?:(s:TrackSample)=>boolean)=>{
  const p:number[]=[],indices:number[]=[],offsets=name==='spa-road-earth-bed'?[-27,-18,-11,-6,-4,0,4,6,11,18,27]:[inner,outer],columns=offsets.length;
  for(let i=0;i<=track.samples.length;i++){
   const s=track.samples[i%track.samples.length],ground=raise<.03;
   for(const offset of offsets){const a=offsetAt(s,offset),x=s.point.x+s.right.x*a,z=s.point.z+s.right.z*a;p.push(x,(ground?Math.min(s.point.y,track.heightAt(x,z)):s.point.y)+raise,z);}
   if(i<track.samples.length&&(!filter||filter(s)))for(let j=0;j<columns-1;j++){const k=i*columns+j;indices.push(k,k+1,k+columns,k+1,k+columns+1,k+columns);}
  }return meshFrom(p,indices,material,name);
 };
 ribbon(-27,27,-.25,mat(0x66895a),'spa-road-earth-bed');
 ribbon(-23,-11,.018,mat(0xbdb28f),'spa-gravel-left',s=>isSpaGravel(s.distance,track.length));ribbon(11,23,.018,mat(0xbdb28f),'spa-gravel-right',s=>isSpaGravel(s.distance,track.length));
 ribbon(-half-.15,half+.15,.045,asphalt,'spa-road');ribbon(-half,-half+.18,.057,mat(0xe8e8da),'spa-left-edge');ribbon(half-.18,half,.057,mat(0xe8e8da),'spa-right-edge');
 for(const side of [-1,1]){
  for(let color=0;color<2;color++)ribbon(side*(half+.25),side*(half+1.1),.082,mat(color?0xd8b83b:0xc33c32),`spa-red-yellow-kerb-${side}-${color}`,s=>Math.floor(s.distance/3.2)%2===color);
  ribbon(side*(half+1.1),side*(half+1.9),.035,mat(0x527e50),`spa-kerb-shoulder-${side}`);
 }
 // One continuous strip per rail avoids upright panels cutting through slopes.
 for(const side of [-1,1])for(const y of [.38,.77,1.16]){
  const p:number[]=[],indices:number[]=[];for(let i=0;i<=track.samples.length;i++){
   const s=track.samples[i%track.samples.length],x=s.point.x+s.right.x*24*side,z=s.point.z+s.right.z*24*side;
   p.push(x,s.point.y+y-.17,z,x,s.point.y+y+.17,z);
   if(i<track.samples.length&&railClear(s,side)&&railClear(track.samples[(i+1)%track.samples.length],side)){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  }meshFrom(p,indices,mat(0x9da6a4),`spa-armco-${side}-${y}`);
 }
 const spacing=6,count=Math.ceil(track.length/spacing)*2,post=new THREE.InstancedMesh(new THREE.BoxGeometry(.14,4.9,.14),mat(0x8b9790),count),fence=new THREE.InstancedMesh(new THREE.PlaneGeometry(6.12,3.3),catchFenceMaterial(),count),o=new THREE.Object3D();let used=0;
 for(let d=0;d<track.length;d+=spacing)for(const side of [-1,1]){
  const s=track.sampleAt(d),x=s.point.x+s.right.x*24*side,z=s.point.z+s.right.z*24*side;if(!railClear(s,side))continue;
  const yaw=Math.atan2(-s.tangent.z,s.tangent.x),pitch=Math.atan(track.gradeAt(d));
  o.position.set(x,s.point.y+2.5,z);o.rotation.set(0,0,0);o.updateMatrix();post.setMatrixAt(used,o.matrix);
  o.position.set(x,s.point.y+3.15,z);o.rotation.set(0,yaw,pitch);o.updateMatrix();fence.setMatrixAt(used,o.matrix);used++;
 }
 post.name='spa-catch-fence-posts';fence.name='spa-catch-fence-mesh';post.count=fence.count=used;post.computeBoundingSphere();fence.computeBoundingSphere();root.add(post,fence);
 const pit=asphalt.clone();pit.name='spa-pit-asphalt';pit.userData.weatherSurface='road';const pp:number[]=[],pi:number[]=[];
 for(let i=0;i<pitPoints.length;i++){const p=pitPoints[i],a=pitPoints[Math.max(0,i-1)],b=pitPoints[Math.min(pitPoints.length-1,i+1)],n=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();for(const side of [-1,1])pp.push(p.x+n.x*6*side,p.y+.052,p.z+n.z*6*side);if(i<pitPoints.length-1){const k=i*2;pi.push(k,k+1,k+2,k+1,k+3,k+2);}}
 meshFrom(pp,pi,pit,'spa-pit-lane');
 // Start/finish and grid are perpendicular to the real start tangent.
 const s=track.sampleAt(0),yaw=Math.atan2(s.tangent.x,s.tangent.z);
 for(let x=0;x<track.width;x++)for(let z=0;z<2;z++){const m=new THREE.Mesh(new THREE.BoxGeometry(1,.018,1),mat((x+z)%2?0xecebdc:0x273f35));m.position.copy(s.point).addScaledVector(s.right,x-(track.width-1)/2).addScaledVector(s.tangent,z-.5);m.position.y+=.089;m.rotation.y=yaw;root.add(m);}
 for(let i=0;i<10;i++){const s=track.sampleAt(-8-Math.floor(i/2)*9),side=i%2?3.8:-3.8,g=new THREE.Group();g.position.copy(s.point).addScaledVector(s.right,side);g.position.y+=.085;g.rotation.y=Math.atan2(s.tangent.x,s.tangent.z);for(const dx of [-1.5,1.5]){const m=new THREE.Mesh(new THREE.BoxGeometry(.13,.028,3.4),mat(0xe5e6d6));m.position.x=dx;g.add(m);}const m=new THREE.Mesh(new THREE.BoxGeometry(3.1,.028,.13),mat(0xe5e6d6));m.position.z=1.7;g.add(m);root.add(g);}
 // Broad, continuous terrain follows nearby track heights; the road earth-bed
 // hides the small grid interpolation error beside the asphalt edge.
 const xs=track.samples.map(s=>s.point.x),zs=track.samples.map(s=>s.point.z),minX=Math.min(...xs)-220,maxX=Math.max(...xs)+220,minZ=Math.min(...zs)-200,maxZ=Math.max(...zs)+200,step=12,nx=Math.ceil((maxX-minX)/step),nz=Math.ceil((maxZ-minZ)/step),p:number[]=[],indices:number[]=[];
 for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){const x=minX+(maxX-minX)*ix/nx,z=minZ+(maxZ-minZ)*iz/nz;p.push(x,track.terrainHeightAt(x,z)-1.5,z);if(ix<nx&&iz<nz){const k=iz*(nx+1)+ix;indices.push(k,k+nx+1,k+1,k+1,k+nx+1,k+nx+2);}}
 const outside:number[]=[];
 const clearGroundTriangle=(a:number,b:number,c:number)=>{
  const points=[[p[a*3],p[a*3+2]],[p[b*3],p[b*3+2]],[p[c*3],p[c*3+2]]];
  const probes=[...points,[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],[(points[1][0]+points[2][0])/2,(points[1][1]+points[2][1])/2],[(points[2][0]+points[0][0])/2,(points[2][1]+points[0][1])/2],[(points[0][0]+points[1][0]+points[2][0])/3,(points[0][1]+points[1][1]+points[2][1])/3]];
  return probes.every(([x,z])=>{const s=track.nearest(x,z).point;return Math.hypot(x-s.x,z-s.z)>12;});
 };
 for(let i=0;i<indices.length;i+=3)if(clearGroundTriangle(indices[i],indices[i+1],indices[i+2]))outside.push(indices[i],indices[i+1],indices[i+2]);
 meshFrom(p,outside,mat(0x77925f),'spa-rolling-terrain');
 root.userData.spa={reference:SPA_REFERENCE,planReference:SPA_GEOJSON_REFERENCE,realLengthMetres:SPA_REAL_LENGTH,metresPerUnit:SPA_METRES_PER_UNIT,elevationReferenceMetres:418,road:'3D ribbon and kerbs share centreline elevation',artistic:'Horizontal GeoJSON adapted to game scale; La Source and Bus Stop locally rounded to suit the unchanged vehicle wheelbase. Interpolated public elevation stations, simplified runoffs and furniture. Not a survey or engineering model.'};
 root.userData.safetyFurniture={armcoRails:3,offset:24,pitJoinsKeptClear:true};
}
export function isSpaGravel(distance:number,length:number){const t=distance/length;return(t>.025&&t<.05)||(t>.125&&t<.18)||(t>.30&&t<.36)||(t>.41&&t<.46)||(t>.57&&t<.65)||(t>.91&&t<.96);}
