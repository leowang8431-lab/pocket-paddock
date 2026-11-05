import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {batchStaticScenery} from './render-batches';
import {createMonacoPitwall} from './monaco-pitwall';

export const MONACO_ACM_REFERENCE='https://acm.mc/wp-content/uploads/2025/05/Hospitalites_ACM_F12026_F-3.pdf';
export interface MonacoSceneSample {point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3;distance:number;}
export interface MonacoPitGarageBox {id:number;center:THREE.Vector3;front:THREE.Vector3;tangent:THREE.Vector3;width:number;depth:number;apronCenter:THREE.Vector3;apronWidth:number;}
export interface MonacoSceneryLayout {
  samples:readonly MonacoSceneSample[];length:number;bounds:THREE.Box3;
  corners:readonly {number:number;id:string;name:string;zh:string;point:THREE.Vector3;distance:number}[];
  sampleAt(distance:number):MonacoSceneSample;nearest(x:number,z:number):MonacoSceneSample&{gap:number};
  project(lon:number,lat:number):THREE.Vector3; heightAt(x:number,z:number):number;widthAt(distance:number):number;
  pitPath:readonly THREE.Vector3[];tunnel:{start:number;end:number};
  pitBoxes:readonly MonacoPitGarageBox[];
  pitProfile:{fastWidth:number;apronWidth:number;garageDepth:number;entryDistance:number;exitDistance:number;};
}
export interface MonacoLandmark {id:string;name:string;zh:string;point:THREE.Vector3;description:string;bounds:THREE.Box3;}
export interface MonacoPlacement {id:string;kind:string;x:number;z:number;width:number;depth:number;yaw:number;minY:number;clearance:number;overTunnel:boolean;}
export interface MonacoHarborFootprint {id:string;x:number;z:number;width:number;depth:number;yaw:number;}
export interface MonacoBoatPlacement extends MonacoHarborFootprint {size:number;sail:boolean;}
export interface MonacoHarborObstacle extends MonacoHarborFootprint {kind:'dock'|'breakwater';}
export interface MonacoTreePlacement {id:string;type:'palm'|'cypress'|'pine';x:number;z:number;radius:number;height:number;}
export interface MonacoStandPlacement extends MonacoHarborFootprint {targetDistance:number;quay:boolean;}
type P={x:number;z:number};
const inside=(x:number,z:number,polygon:readonly P[])=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;};

/** A first, geographic-plan-informed toy city. Architecture is deliberately
 * simplified; scale/elevation/boat berths are authored, not surveyed assets. */
export function createMonacoScenery(layout:MonacoSceneryLayout){
  const group=new THREE.Group();group.name='monaco-harbour-city-v1';
  const buildings=new THREE.Group();buildings.name='monaco-city-buildings';group.add(buildings);
  const facilities=new THREE.Group();facilities.name='monaco-pits-and-grandstands';group.add(facilities);
  const waterfront=new THREE.Group();waterfront.name='port-hercule-marina';group.add(waterfront);
  const tunnelRoof=new THREE.Group();tunnelRoof.name='monaco-tunnel-removable-roof';group.add(tunnelRoof);
  const tunnelSides=new THREE.Group();tunnelSides.name='monaco-tunnel-open-interior';group.add(tunnelSides);
  const vegetation=new THREE.Group();vegetation.name='monaco-palms-and-gardens';group.add(vegetation);
  const mats=new Map<number,THREE.MeshStandardMaterial>(),placements:MonacoPlacement[]=[],landmarks:MonacoLandmark[]=[],boats:MonacoBoatPlacement[]=[],harborObstacles:MonacoHarborObstacle[]=[],trees:MonacoTreePlacement[]=[],reviewObjects:{object:THREE.Group;parent:THREE.Group}[]=[];
  const corners=(number:number)=>layout.corners.find(c=>c.number===number)!;
  const mat=(color:number)=>{let m=mats.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.77});mats.set(color,m);}return m;};
  const box=(p:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number,round=0)=>{const m=new THREE.Mesh(round?new RoundedBoxGeometry(w,h,d,2,Math.min(round,w/3,h/3,d/3)):new THREE.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;p.add(m);return m;};
  const cyl=(p:THREE.Object3D,x:number,y:number,z:number,r:number,h:number,color:number,n=12)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,n),mat(color));m.position.set(x,y,z);m.castShadow=true;p.add(m);return m;};
  const rod=(p:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,r:number,color:number)=>{const d=b.clone().sub(a),m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),6),mat(color));m.position.copy(a).lerp(b,.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());p.add(m);return m;};
  const sphere=(p:THREE.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1,10,7),mat(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;p.add(m);return m;};
  const cornerPoints=(x:number,z:number,w:number,d:number,yaw:number,steps=4)=>{const out:P[]=[],c=Math.cos(yaw),s=Math.sin(yaw);for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++){const u=(i/steps-.5)*w,v=(j/steps-.5)*d;out.push({x:x+c*u+s*v,z:z-s*u+c*v});}return out;};
  const rectangle=(p:MonacoHarborFootprint)=>{const c=Math.cos(p.yaw),s=Math.sin(p.yaw);return[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([u,v])=>({x:p.x+c*u*p.width+s*v*p.depth,z:p.z-s*u*p.width+c*v*p.depth}));};
  const orient=(a:P,b:P,c:P)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  const crosses=(a:P,b:P,c:P,d:P)=>orient(a,b,c)*orient(a,b,d)<-1e-9&&orient(c,d,a)*orient(c,d,b)<-1e-9;
  const segmentDistance=(p:P,a:P,b:P)=>{const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
  const containsFootprint=(p:MonacoHarborFootprint,polygon:readonly P[],margin=.2)=>{const vertices=rectangle(p);if(!vertices.every(v=>inside(v.x,v.z,polygon)))return false;for(let i=0;i<polygon.length;i++)for(let j=0;j<4;j++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if(crosses(vertices[j],vertices[(j+1)%4],a,b)||segmentDistance(vertices[j],a,b)<margin)return false;}return true;};
  const rectanglesApart=(a:MonacoHarborFootprint,b:MonacoHarborFootprint,gap=0)=>{const dx=b.x-a.x,dz=b.z-a.z;for(const angle of [a.yaw,b.yaw])for(const axis of [{x:Math.cos(angle),z:-Math.sin(angle)},{x:Math.sin(angle),z:Math.cos(angle)}]){const reach=(p:MonacoHarborFootprint)=>(Math.abs(axis.x*Math.cos(p.yaw)-axis.z*Math.sin(p.yaw))*p.width+Math.abs(axis.x*Math.sin(p.yaw)+axis.z*Math.cos(p.yaw))*p.depth)/2;if(Math.abs(dx*axis.x+dz*axis.z)>reach(a)+reach(b)+gap)return true;}return false;};
  const pitDistance=(x:number,z:number)=>{let minimum=Infinity;for(let i=1;i<layout.pitPath.length;i++)minimum=Math.min(minimum,segmentDistance({x,z},layout.pitPath[i-1],layout.pitPath[i]));return minimum;};
  const clearance=(x:number,z:number,w:number,d:number,yaw:number,minY=0,allowTunnel=false)=>{
    let minimum=Infinity;
    for(const p of cornerPoints(x,z,w,d,yaw,6)){const n=layout.nearest(p.x,p.z),gap=n.gap-layout.widthAt(n.distance)/2;
      if(allowTunnel&&n.distance>=layout.tunnel.start&&n.distance<=layout.tunnel.end&&minY>n.point.y+5.4)continue;
      minimum=Math.min(minimum,gap);
    }return minimum;
  };
  const occupied:(P&{w:number;d:number})[]=[];
  const separated=(x:number,z:number,w:number,d:number,gap=1)=>occupied.every(p=>Math.abs(x-p.x)>(w+p.w)/2+gap||Math.abs(z-p.z)>(d+p.d)/2+gap);
  const remember=(id:string,kind:string,x:number,z:number,w:number,d:number,yaw:number,minY:number,overTunnel=false)=>{
    placements.push({id,kind,x,z,width:w,depth:d,yaw,minY,clearance:clearance(x,z,w,d,yaw,minY,overTunnel),overTunnel});occupied.push({x,z,w:w+1,d:d+1});
  };
  const landmark=(id:string,name:string,zh:string,object:THREE.Object3D,description:string)=>{object.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(object,true),point=bounds.getCenter(new THREE.Vector3());landmarks.push({id,name,zh,point,description,bounds});object.userData.landmark={id,name,zh,reference:MONACO_ACM_REFERENCE,artistic:description};};
  const nameSign=(parent:THREE.Object3D,text:string,x:number,y:number,z:number,w:number,h:number,yaw=0)=>{
    let texture:THREE.CanvasTexture|undefined;
    if(typeof document!=='undefined'){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');if(ctx){ctx.fillStyle='#244e49';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#fff3cc';ctx.font='700 74px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,67,985);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;}}
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture??null,color:texture?0xffffff:0x2c5750,side:THREE.FrontSide}));m.name=`monaco-building-label-${text.toLowerCase().replaceAll(' ','-')}`;m.position.set(x,y,z);m.rotation.y=yaw;parent.add(m);
  };
  const min=layout.bounds.min,max=layout.bounds.max,west=min.x-58,east=max.x+82,north=min.z-54,south=max.z+68;
  const plate=box(group,(west+east)/2,-3.4,(north+south)/2,east-west,6.2,south-north,0x234b48,3.0);plate.name='monaco-diorama-base';
  // The coastline follows the sea side from Portier, through the tunnel, the
  // Nouvelle/Tabac quays, the swimming pool and La Rascasse. The open harbour
  // is inside the long arms of the circuit, not merely outside a land rectangle.
  // Authored simple shore: unlike a raw offset of tight chicanes, this
  // monotonic quay outline cannot fold back into needles or self-intersect.
  const coast:P[]=[{x:126,z:-158},{x:132,z:-124},{x:128,z:-98},{x:115,z:-74},{x:94,z:-50},{x:68,z:-34},{x:37,z:-22},{x:3,z:-7},{x:-26,z:3},{x:-62,z:13},{x:-79,z:24},{x:-76,z:47},{x:-65,z:74},{x:-64,z:109},{x:-46,z:138},{x:-48,z:158}];
  const landPolygon=[...coast,{x:west,z:south},{x:west,z:north},{x:east,z:north}];
  // Both surfaces meet along the last coast-to-southwest segment. Omitting
  // that shared vertex would leave a large triangular hole in the board.
  const seaPolygon=[...coast,{x:west,z:south},{x:east,z:south},{x:east,z:north}];
  const shape=(poly:readonly P[])=>new THREE.Shape(poly.map(p=>new THREE.Vector2(p.x,-p.z)));
  const landGeometry=new THREE.ExtrudeGeometry(shape(landPolygon),{depth:1.0,bevelEnabled:false});landGeometry.rotateX(-Math.PI/2).translate(0,-.35,0);
  const land=new THREE.Mesh(landGeometry,mat(0xe2dfc8));land.name='monaco-coastal-land-and-quays';land.receiveShadow=true;group.add(land);
  const waterMaterial=new THREE.MeshStandardMaterial({color:0x79c9d1,roughness:.27,metalness:.12});const waterGeometry=new THREE.ShapeGeometry(shape(seaPolygon));waterGeometry.rotateX(-Math.PI/2).translate(0,.03,0);
  const water=new THREE.Mesh(waterGeometry,waterMaterial);water.name='port-hercule-and-mediterranean-water';water.receiveShadow=true;waterfront.add(water);
  for(let i=1;i<coast.length;i++){const a=coast[i-1],b=coast[i],length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.02)continue;const m=box(waterfront,(a.x+b.x)/2,.18,(a.z+b.z)/2,1.25,1.1,length+.06,0xd3d0bb);m.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}
  const harbourCenter=layout.project(7.4254,43.7349);harbourCenter.y=.05;
  // Berths project into the inner harbour from the quay. Their platforms can
  // sit over water, but never over the driving surface.
  let dockCount=0;
  for(const no of [12,13,15,17]){const c=corners(no),s=layout.sampleAt(c.distance+3),length=24+no%3*5,p=s.point.clone().addScaledVector(s.right,layout.widthAt(s.distance)/2+9);
    if(layout.nearest(p.x,p.z).gap<5)continue;
    const center=p.clone().addScaledVector(s.right,length/2),dock=new THREE.Group();dock.name=`monaco-harbor-dock-${no}`;waterfront.add(dock);reviewObjects.push({object:dock,parent:waterfront});const m=box(dock,center.x,.53,center.z,1.5,.6,length,0xd4d1ba);m.rotation.y=Math.atan2(s.right.x,s.right.z);dockCount++;
    for(let t=3;t<length;t+=5){const b=p.clone().addScaledVector(s.right,t);cyl(dock,b.x,.95,b.z,.16,.45,0x4e6e72,6);}
    harborObstacles.push({id:dock.name,kind:'dock',x:center.x,z:center.z,width:1.5,depth:length,yaw:m.rotation.y});
  }
  const pier=layout.project(7.4237,43.73228),tip=layout.project(7.4286,43.73352),pierDir=tip.clone().sub(pier),pierLength= Math.hypot(pierDir.x,pierDir.z);
  const breakwaterGroup=new THREE.Group();breakwaterGroup.name='port-hercule-breakwater';waterfront.add(breakwaterGroup);reviewObjects.push({object:breakwaterGroup,parent:waterfront});
  const breakwater=box(breakwaterGroup,(pier.x+tip.x)/2,.40,(pier.z+tip.z)/2,5,1.35,pierLength,0xc3c2b1);breakwater.rotation.y=Math.atan2(pierDir.x,pierDir.z);
  cyl(breakwaterGroup,tip.x,2.3,tip.z,1.2,3.2,0xf6f1d8);cyl(breakwaterGroup,tip.x,4.1,tip.z,1.45,.45,0xc65d4a);
  harborObstacles.push({id:breakwaterGroup.name,kind:'breakwater',x:(pier.x+tip.x)/2,z:(pier.z+tip.z)/2,width:5,depth:pierLength+3,yaw:breakwater.rotation.y});
  const harborChannel={from:{x:harbourCenter.x,z:harbourCenter.z},to:{x:tip.x+14,z:tip.z+14},halfWidth:5};
  let boatCount=0,sailboats=0;
  function boat(x:number,z:number,size:number,yaw:number,sail:boolean,index:number){
    const b=new THREE.Group();b.name=`monaco-${sail?'sailboat':'yacht'}-${index}`;b.position.set(x,.13,z);b.rotation.y=yaw;b.scale.setScalar(size);waterfront.add(b);reviewObjects.push({object:b,parent:waterfront});
    const hullShape=new THREE.Shape([new THREE.Vector2(-1.25,-3.8),new THREE.Vector2(1.25,-3.8),new THREE.Vector2(1.45,1.9),new THREE.Vector2(.75,3.7),new THREE.Vector2(0,4.8),new THREE.Vector2(-.75,3.7),new THREE.Vector2(-1.45,1.9)]);
    const hullGeo=new THREE.ExtrudeGeometry(hullShape,{depth:.75,bevelEnabled:true,bevelSize:.2,bevelThickness:.15,bevelSegments:1});hullGeo.rotateX(-Math.PI/2).translate(0,.05,0);
    const hull=new THREE.Mesh(hullGeo,mat(index%5===0?0x274c64:0xf9f5e7));hull.castShadow=true;b.add(hull);
    box(b,0,.95,-.2,2.3,.14,6.4,0xd4b994,.15);box(b,0,1.4,-.6,1.8,.85,3.35,0xf9f8ed,.18);box(b,0,1.68,.9,1.84,.42,.18,0x376875,.06);
    box(b,0,2.0,-.8,1.6,.22,2.7,0xf3eee1,.12);box(b,0,2.28,-1.0,1.20,.42,1.25,0xe9eee8,.1);box(b,0,2.3,-.31,1.23,.29,.10,0x466f7a);
    for(const side of [-1,1])for(const level of [.98,1.28])rod(b,new THREE.Vector3(side*1.3,level,-3.5),new THREE.Vector3(side*1.25,level,2.7),.028,0xf4f1e5);
    rod(b,new THREE.Vector3(0,2.4,-1),new THREE.Vector3(0,sail?10.5:3.2,-1),.045,0xd4ded7);
    if(sail){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,2.5,-1,0,10.1,-1,0,2.5,3.2],3));g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:index%2?0xfff5dd:0xddd4c2,side:THREE.DoubleSide,roughness:.9}));b.add(m);sailboats++;}
    else{box(b,-.6,1.3,-2.8,.55,.3,.9,0x72b1b0,.08);box(b,.6,1.3,-2.8,.55,.3,.9,0xc6b590,.08);}
    const flag=box(b,.15,2.0,-3.8,.6,.23,.04,0xc5574c);box(b,.15,1.77,-3.8,.6,.23,.04,0xf4eee0);flag.name='monaco-red-white-ensign';
    boats.push({id:b.name,x,z,width:3.4*size,depth:10.2*size,yaw,size,sail});boatCount++;
  }
  // Stable irregular anchorage: small loose groups near berths plus individual
  // yachts across the bay. Every heading is independently authored by a fixed
  // seed; no row/column lattice survives and the entrance channel stays clear.
  let harborSeed=0x4d4f4e41;const harborRandom=()=>{harborSeed=(Math.imul(harborSeed,1664525)+1013904223)>>>0;return harborSeed/4294967296;};
  const anchorageClusters=[{x:-55,z:38},{x:-39,z:93},{x:4,z:25},{x:45,z:12},{x:43,z:82},{x:12,z:123}];
  for(let attempt=0;attempt<5000&&boatCount<36;attempt++){
    const clustered=harborRandom()<.63,anchor=anchorageClusters[Math.floor(harborRandom()*anchorageClusters.length)],angle=harborRandom()*Math.PI*2,radius=Math.sqrt(harborRandom())*22;
    const x=clustered?anchor.x+Math.cos(angle)*radius:-64+harborRandom()*179,z=clustered?anchor.z+Math.sin(angle)*radius:-15+harborRandom()*169,size=.67+harborRandom()*.49,yaw=harborRandom()*Math.PI*2;
    const candidate:MonacoBoatPlacement={id:'candidate',x,z,width:3.4*size,depth:10.2*size,yaw,size,sail:boatCount%6===0};
    if(!containsFootprint(candidate,seaPolygon,1.1)||boats.some(p=>!rectanglesApart(candidate,p,2.1))||harborObstacles.some(p=>!rectanglesApart(candidate,p,1.5)))continue;
    if(cornerPoints(x,z,candidate.width,candidate.depth,yaw,3).some(p=>segmentDistance(p,harborChannel.from,harborChannel.to)<harborChannel.halfWidth+1.1))continue;
    boat(x,z,size,yaw,candidate.sail,boatCount+1);
  }
  const harbourBounds=new THREE.Box3(new THREE.Vector3(harbourCenter.x-56,0,harbourCenter.z-55),new THREE.Vector3(harbourCenter.x+70,10,harbourCenter.z+64));
  landmarks.push({id:'harbor',name:'Port Hercule',zh:'赫尔克里港',point:harbourCenter.clone().setY(3),bounds:harbourBounds,description:'ACM-map-informed inner harbour, seawall and breakwater, with authored miniature berths and yachts.'});

  function windows(parent:THREE.Object3D,w:number,d:number,h:number,stories:number,color=0x597982){
    const cols=Math.max(2,Math.floor(w/2.4));for(let floor=0;floor<stories;floor++)for(let col=0;col<cols;col++){
      const x=(col-(cols-1)/2)*(w/(cols+.4)),y=1.5+floor*(h/stories);box(parent,x,y,d/2+.04,Math.min(1.15,w/(cols+1)*.56),Math.min(1.25,h/stories*.45),.09,color);
      if(floor>0&&col%2===0){box(parent,x,y-.7,d/2+.35,1.7,.12,.9,0xdcd9c8);box(parent,x,y-.35,d/2+.72,1.7,.46,.07,0xb4bdb5);}
    }
    for(const side of [-1,1])for(let floor=0;floor<stories;floor++)for(let j=0;j<Math.max(2,Math.floor(d/3));j++)box(parent,side*(w/2+.04),1.5+floor*h/stories,(j-(Math.max(2,Math.floor(d/3))-1)/2)*2.6,.09,1.1,.9,color);
  }
  function findLandmarkSpot(anchor:THREE.Vector3,w:number,d:number,preferred:THREE.Vector2,range=20){
    let best:{x:number;z:number;score:number}|undefined;
    for(let u=-range;u<=range;u+=2)for(let v=-range;v<=range;v+=2){const x=anchor.x+preferred.x+u,z=anchor.z+preferred.y+v;if(!inside(x,z,landPolygon)||clearance(x,z,w,d,0)<1.5||!separated(x,z,w,d))continue;const score=u*u+v*v;if(!best||score<best.score)best={x,z,score};}
    if(!best)for(let u=-range*2;u<=range*2;u+=2)for(let v=-range*2;v<=range*2;v+=2){const x=anchor.x+preferred.x+u,z=anchor.z+preferred.y+v;if(!inside(x,z,landPolygon)||clearance(x,z,w,d,0)<1.5||!separated(x,z,w,d))continue;const score=u*u+v*v;if(!best||score<best.score)best={x,z,score};}
    if(!best)throw new Error('No clear Monaco landmark footprint.');return best;
  }
  // Monte-Carlo's cream stone casino and the neighbouring hotel are composed
  // rather than represented by an anonymous high-rise block.
  const casinoAnchor=layout.project(7.428023,43.73916),casinoSpot=findLandmarkSpot(casinoAnchor,35,19,new THREE.Vector2(3,3),24),casino=new THREE.Group();casino.name='casino-and-hotel-de-paris';casino.position.set(casinoSpot.x,Math.max(10,layout.heightAt(casinoSpot.x,casinoSpot.z)-.25),casinoSpot.z);buildings.add(casino);
  box(casino,0,-casino.position.y/2+.3,0,35,casino.position.y,19,0xc3bcaa);box(casino,-5,4.6,0,21,9.2,11,0xeee1c1,.5);box(casino,-5,9.35,0,23,.45,12.5,0xf7e9cc);
  for(const x of [-15,-9,0,5]){box(casino,x,5.7,0,1.1,10.5,12,0xead6b1);sphere(casino,x,11.6,0,1.8,2.6,1.8,0x86a59a);cyl(casino,x,13.8,0,.16,1.6,0xd4bd83,8);}
  for(let i=0;i<7;i++){const x=-13.6+i*2.85;box(casino,x,4.4,5.57,1.25,4.0,.1,0x52716c);box(casino,x,1.0,6.4,1.6,.4,1.65,0xe8ddbe);}
  const paris=new THREE.Group();paris.position.set(13.5,0,1.2);casino.add(paris);box(paris,0,7.4,0,9,14.8,15,0xd8c9b3,.35);windows(paris,8.9,15,13.4,5,0x597984);box(paris,0,15.1,0,10,.55,16,0xf1e4cf);
  nameSign(casino,'CASINO MONTE-CARLO',-5,7.7,5.65,15,.85);nameSign(casino,'HOTEL DE PARIS',13.5,13.4,8.76,8,.65);
  cyl(casino,7.5,.45,2.5,2.3,.55,0xebe4ca,20);cyl(casino,7.5,.76,2.5,1.8,.15,0x6ab8c1,20);cyl(casino,7.5,1.2,2.5,.35,.9,0xe5dbc4,10);
  remember('casino-and-hotel','landmark',casino.position.x,casino.position.z,35,19,0,casino.position.y);landmark('casino','Casino / Hôtel de Paris','赌场与巴黎大酒店',casino,'Cream masonry, domes, pilasters, arcade and fountain use recognisable silhouettes; the footprint and height are compressed for the model.');

  const hairpin=corners(6),hotel=new THREE.Group();hotel.name='fairmont-stepped-hotel';buildings.add(hotel);let hotelSegments=0;
  for(let i=0;i<9;i++){const a=-.8+i*.22,r=16.5,x=hairpin.point.x+Math.cos(a)*r,z=hairpin.point.z+Math.sin(a)*r,yaw=-a+Math.PI/2,w=4.0,d=8.0;
    if(clearance(x,z,w+1,d+1,yaw,9,true)<1.3)continue;
    const wing=new THREE.Group();wing.position.set(x,9,z);wing.rotation.y=yaw;hotel.add(wing);const h=10+(i%3)*1.05;
    box(wing,0,h/2,0,w,h,d,0xcac8b9,.13);for(let floor=0;floor<5;floor++){box(wing,0,1.3+floor*1.8,d/2+.08,w+.3,.65,.12,0x48737c);box(wing,0,1.0+floor*1.8,d/2+.3,w+.65,.14,.85,0xefead9);}
    box(wing,0,h+.15,-.4,w+.5,.35,d-.8,0x9fb8aa);box(wing,0,h+.5,-1,w-.4,.16,d-3.0,0x9fb5a0);
    for(const side of [-1,1]){const v=new THREE.Vector3(side*1.4,0,-3).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(new THREE.Vector3(x,0,z));if(clearance(v.x,v.z,.6,.6,0)>1)cyl(hotel,v.x,4.7,v.z,.28,8.6,0xc1c0ae,8);}
    remember(`fairmont-wing-${i}`,'hotel-wing',x,z,w+.8,d+.8,yaw,9,true);hotelSegments++;
  }
  const hotelLabel=hairpin.point.clone().add(new THREE.Vector3(15,22,8));nameSign(hotel,'FAIRMONT MONTE CARLO',hotelLabel.x,hotelLabel.y,hotelLabel.z,18,1.05,-Math.PI/2);
  landmark('hairpin','Grand Hôtel Hairpin / Fairmont','费尔蒙发夹与阶梯酒店',hotel,'The hotel follows the outside of T6 as stepped curved wings; the actual tunnel remains open below the elevated sea-side overhang where applicable.');

  // True tunnel void: two side treatments and removable overhead segments.
  // There is no opaque road-level box occupying the carriageway.
  for(let d=layout.tunnel.start;d<layout.tunnel.end;d+=4.5){const next=Math.min(layout.tunnel.end,d+4.5),s=layout.sampleAt((d+next)/2),yaw=Math.atan2(s.tangent.x,s.tangent.z),w=layout.widthAt(s.distance),length=next-d+.15;
    const roof=new THREE.Group();roof.position.copy(s.point);roof.rotation.y=yaw;tunnelRoof.add(roof);box(roof,0,5.35,0,w+2.6,.6,length,0xcfc9b7);box(roof,-w/2-.8,6.0,0,1.2,.8,length,0xd8d2bf);
    const wall=new THREE.Group();wall.position.copy(s.point);wall.rotation.y=yaw;tunnelSides.add(wall);box(wall,-w/2-.9,2.65,0,.7,5.3,length,0xc2c4b9);box(wall,w/2+.9,4.8,0,.65,.8,length,0xc4c8bd);
    if(Math.floor((d-layout.tunnel.start)/4.5)%2===0){box(wall,w/2+.9,2.25,0,.6,4.5,.65,0xd6d4c4);box(wall,0,4.95,0,w-1,.08,.18,0xecebd1);}
  }
  for(const d of [layout.tunnel.start,layout.tunnel.end]){const s=layout.sampleAt(d),p=new THREE.Group();p.position.copy(s.point);p.rotation.y=Math.atan2(s.tangent.x,s.tangent.z);p.name='monaco-tunnel-portal';tunnelSides.add(p);const w=layout.widthAt(d);for(const side of [-1,1])box(p,side*(w/2+.8),2.25,0,.9,4.5,1.1,0xdad8c7);
    const g=new THREE.TorusGeometry(w/2+.8,.46,6,24,Math.PI),m=new THREE.Mesh(g,mat(0xe4ddca));m.position.y=2.3;m.scale.y=.62;p.add(m);nameSign(p,'TUNNEL',0,5.6,.63,w+1.5,.8);}
  const tunnelTarget=layout.sampleAt((layout.tunnel.start+layout.tunnel.end)/2).point.clone().add(new THREE.Vector3(0,2,0));landmarks.push({id:'tunnel',name:'Portier Tunnel',zh:'波尔蒂耶隧道',point:tunnelTarget,bounds:new THREE.Box3().setFromObject(tunnelSides,true),description:'A continuous curved road under a separate removable roof, with real open portals, sea-side columns and internal light bars.'});

  function plantTree(type:MonacoTreePlacement['type'],x:number,z:number,h:number){
    const radius=type==='palm'?4.15:type==='pine'?2.35:1.2,near=layout.nearest(x,z),footprint={id:'tree-candidate',x,z,width:radius*2,depth:radius*2,yaw:0};
    if(near.gap<layout.widthAt(near.distance)/2+radius+1.35||pitDistance(x,z)<radius+3.0||!containsFootprint(footprint,landPolygon,.4)||placements.some(other=>!rectanglesApart(footprint,other,.8))||harborObstacles.some(other=>!rectanglesApart(footprint,other,.8))||trees.some(other=>Math.hypot(x-other.x,z-other.z)<radius+other.radius+.6))return;
    const p=new THREE.Group();p.name=`monaco-tree-${type}-${trees.length+1}`;p.position.set(x,.65,z);vegetation.add(p);
    if(type==='palm'){
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.17,.36,h,8),mat(0x927a55));trunk.position.y=h/2;trunk.rotation.z=.055;p.add(trunk);
      for(let i=0;i<7;i++){const a=i/7*Math.PI*2,leaf=new THREE.Mesh(new THREE.SphereGeometry(1,7,4),mat(i%2?0x4f7b54:0x70915c));leaf.scale.set(.38,.15,2.5);leaf.position.set(Math.sin(a)*1.5,h+.1,Math.cos(a)*1.5);leaf.rotation.set(-.25,a,0);p.add(leaf);}sphere(p,.1,h+.1,0,.4,.38,.4,0x8d8055);
    }else if(type==='cypress'){
      cyl(p,0,h*.24,0,.18,h*.48,0x887359,7);sphere(p,0,h*.59,0,1.05,h*.43,1.05,0x42644a);sphere(p,0,h*.83,0,.71,h*.24,.71,0x53734e);
    }else{
      cyl(p,0,h*.35,0,.21,h*.7,0x8d7558,7);
      for(const [r,y,ch]of [[2.3,h*.43,h*.43],[1.8,h*.66,h*.39],[1.2,h*.84,h*.34]]){const crown=new THREE.Mesh(new THREE.ConeGeometry(r,ch,8),mat(y>h*.7?0x5d7b55:0x4a6c4d));crown.position.y=y;p.add(crown);}
    }
    trees.push({id:p.name,type,x,z,radius,height:h});
  }

  // Swimming pool and adjacent terraces project from the quay, as in ACM's
  // plan. Water is visibly contained by its own coping and clear of the road.
  const ps=layout.sampleAt((corners(13).distance+corners(14).distance)/2);let poolPoint=ps.point.clone().addScaledVector(ps.right,15.5);const poolYaw=Math.atan2(ps.tangent.x,ps.tangent.z);
  for(let offset=15.5;offset<=45.5;offset+=2){const candidate=ps.point.clone().addScaledVector(ps.right,offset);if(clearance(candidate.x,candidate.z,13,24,poolYaw)>1.5){poolPoint=candidate;break;}}
  const pool=new THREE.Group();pool.name='monaco-swimming-pool-complex';pool.position.set(poolPoint.x,.85,poolPoint.z);pool.rotation.y=Math.atan2(ps.tangent.x,ps.tangent.z);facilities.add(pool);
  box(pool,0,0,0,13,.65,24,0xe5dfc9,.5);box(pool,0,.45,0,8.0,.45,17.4,0xf8f5df,.3);box(pool,0,.72,0,7.3,.12,16.6,0x66bdcf);
  for(let lane=0;lane<4;lane++)box(pool,-2.55+lane*1.7,.79,0,.055,.025,15.7,0xd6f0df);for(const z of [-7.5,7.5])for(let lane=0;lane<4;lane++)box(pool,-2.55+lane*1.7,.89,z,.8,.22,.55,0xf2eee2);
  for(const side of [-1,1])for(let i=0;i<6;i++){box(pool,side*5.2,.55,-9+i*3.5,1.2,.18,2,0xd5c39f);cyl(pool,side*5.2,1.3,-9+i*3.5,.035,1.3,0xa7b3a6,5);}
  remember('swimming-pool-platform','pool',pool.position.x,pool.position.z,13,24,pool.rotation.y,.7);
  landmark('swimming-pool','Piscine / Stade Nautique Rainier III','泳池区',pool,'A 50-metre-pool-inspired rectangle, coping, lanes and quay terrace; dimensions are compressed and the surrounding stands are simplified.');

  // Reserve this small landmark before the stand search so a moved terrace
  // cannot displace the restaurant away from its named corner.
  const rc=corners(18),rp=rc.point.clone().addScaledVector(layout.sampleAt(rc.distance).right,-13),rascasseSpot=findLandmarkSpot(rp,10,11,new THREE.Vector2(0,0),30),rascasse=new THREE.Group();rascasse.name='la-rascasse-restaurant';rascasse.position.set(rascasseSpot.x,.8,rascasseSpot.z);buildings.add(rascasse);
  box(rascasse,0,2.7,0,8.5,5.4,7.5,0xefd79f,.35);box(rascasse,0,5.6,0,9.3,.4,8.2,0xc77b59);for(const x of [-2.8,0,2.8]){box(rascasse,x,2.2,3.8,1.4,2.3,.1,0x496a65);box(rascasse,x,3.7,4.3,2,.17,1.2,0xb65d4f);}
  box(rascasse,0,1.1,4.6,8.7,.15,2,0xd2b587);nameSign(rascasse,'LA RASCASSE',0,4.7,3.83,7.4,.65);remember('rascasse','landmark',rascasse.position.x,rascasse.position.z,9.4,10,0,.8);landmark('rascasse','La Rascasse','拉斯卡斯餐厅弯',rascasse,'A recognisable ochre restaurant, red awnings and low roof beside the harbour-end hairpin; position is adjusted to keep the circuit clear.');

  let grandstands=0,spectators=0;
  const stands:MonacoStandPlacement[]=[];
  let replacementBuilding:(MonacoHarborFootprint&{sourceStand:'V'})|undefined;
  function buildStand(p:THREE.Vector3,yaw:number,rows:number,width:number,depth:number,covered:boolean,id:string,targetDistance:number,quay=false){
    const stand=new THREE.Group();stand.name=`monaco-grandstand-${id}`;stand.position.set(p.x,Math.max(.9,layout.nearest(p.x,p.z).point.y-.25),p.z);stand.rotation.y=yaw;facilities.add(stand);reviewObjects.push({object:stand,parent:facilities});
    box(stand,0,-.25,0,width+1.6,.65,depth+1.2,0xcacbbd);
    const cols=Math.floor(width/1.7);
    for(let row=0;row<rows;row++){const y=.35+row*.55,z=depth/2-1.0-row*(quay?.85:1.15);box(stand,0,y/2,z,width,y+.25,quay?.90:1.19,0xb7c1b9);box(stand,0,y+.27,z,width,.15,.48,0x7caaa4);
      for(let col=0;col<cols;col++){if(col===Math.floor(cols/2))continue;const x=(col-(cols-1)/2)*1.7,color=[0xe16754,0xd7bd64,0x547c91,0xebe5d0,0x518171][(row*3+col)%5];const body=new THREE.Mesh(new THREE.SphereGeometry(1,7,5),mat(color));body.position.set(x,y+.85,z);body.scale.set(.30,.45,.25);stand.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(1,7,5),mat(0xe2d2b4));head.position.set(x,y+1.46,z);head.scale.set(.31,.34,.31);stand.add(head);
        // A thin front-facing eye band makes the corrected audience direction
        // visible on these three terraces instead of using featureless heads.
        if(id==='E'||id==='P'||id==='T')box(stand,x,y+1.49,z+.278,.25,.065,.022,0x3f5956);
        spectators++;}
    }
    const back=-depth/2;for(const side of [-1,1])rod(stand,new THREE.Vector3(side*width/2,1.5,depth/2),new THREE.Vector3(side*width/2,rows*.55+1.6,back),.055,0x879b98);
    if(covered){const roofY=rows*.55+3;box(stand,0,roofY,0,width+2,.25,depth+2,0xf1edda);for(const side of [-1,1])box(stand,side*(width/2-.4),roofY/2,back,.2,roofY,.2,0x6a8988);}
    nameSign(stand,`TRIBUNE ${id}`,0,1.15,depth/2+.13,Math.min(10,width-1),.8);remember(`grandstand-${id}`,'grandstand',p.x,p.z,width+2,depth+2,yaw,stand.position.y);
    const occupiedStand=occupied[occupied.length-1];occupiedStand.w=Math.abs(Math.cos(yaw))*(width+2)+Math.abs(Math.sin(yaw))*(depth+2)+1;occupiedStand.d=Math.abs(Math.sin(yaw))*(width+2)+Math.abs(Math.cos(yaw))*(depth+2)+1;
    stands.push({id,targetDistance,quay,x:p.x,z:p.z,width:width+2,depth:depth+2,yaw});grandstands++;
  }
  function grandstand(no:number,side:number,rows:number,width:number,covered:boolean,id:string){
    const anchor=layout.sampleAt(corners(no).distance+4);
    let selected:{p:THREE.Vector3;yaw:number;rows:number;width:number;depth:number}|undefined;
    for(const scale of [1,.86,.72]){
      const candidateWidth=width*scale,candidateRows=Math.max(4,Math.round(rows*scale)),candidateDepth=candidateRows*1.15+2.6,candidates:{p:THREE.Vector3;yaw:number;score:number}[]=[];
      for(const direction of [side,-side])for(const along of [0,-8,8,-16,16,-24,24,-36,36,-48,48,-64,64])for(const extra of [0,4,8,13,19,27,36]){
        const s=layout.sampleAt(anchor.distance+along),offset=layout.widthAt(s.distance)/2+candidateDepth/2+4.3+extra,p=s.point.clone().addScaledVector(s.right,direction*offset),yaw=Math.atan2(anchor.point.x-p.x,anchor.point.z-p.z);
        candidates.push({p,yaw,score:p.distanceToSquared(anchor.point)+(direction===side?0:36)});
      }
      candidates.sort((a,b)=>a.score-b.score);
      for(const candidate of candidates){const{p,yaw}=candidate,footprint={id:`grandstand-${id}`,x:p.x,z:p.z,width:candidateWidth+2,depth:candidateDepth+2,yaw};
        if(!containsFootprint(footprint,landPolygon,.35)||placements.some(other=>!rectanglesApart(footprint,other,2))||harborObstacles.some(other=>!rectanglesApart(footprint,other,1)))continue;
        if(cornerPoints(p.x,p.z,footprint.width,footprint.depth,yaw,4).some(v=>pitDistance(v.x,v.z)<3.2)||clearance(p.x,p.z,footprint.width,footprint.depth,yaw)<1.5)continue;
        selected={p,yaw,rows:candidateRows,width:candidateWidth,depth:candidateDepth};break;
      }
      if(selected)break;
    }
    if(!selected)throw new Error(`No supported on-land grandstand site for ${id}.`);const{p,yaw,depth}=selected;rows=selected.rows;width=selected.width;
    if(id==='V'){
      // Keep the reviewed former V site and its reserved footprint exactly;
      // replace this isolated spectator block with a five-storey residence.
      const residence=new THREE.Group();residence.name='monaco-harbor-residence';residence.position.set(p.x,.85,p.z);residence.rotation.y=yaw;buildings.add(residence);reviewObjects.push({object:residence,parent:buildings});
      box(residence,0,-.08,0,18,.55,10,0xcfc7b2,.15);box(residence,0,7.5,0,16,15,8.5,0xe7d7bb,.3);box(residence,0,.55,0,16.25,1.1,8.7,0xcbbb9e);
      windows(residence,16,8.5,14.4,5,0x4f7276);
      for(const x of [-6.5,6.5])box(residence,x,7.5,4.37,.42,15,.36,0xf4ead3);
      for(const y of [3,6,9,12,15])box(residence,0,y,0,16.5,.19,9.0,0xf4ead3);
      box(residence,0,1.65,4.36,1.8,3.1,.12,0x355957);box(residence,0,3.35,4.82,3.5,.22,1.1,0x9f715b);
      const roofGeometry=new THREE.ConeGeometry(10.0,2.3,4);roofGeometry.rotateY(Math.PI/4);const roof=new THREE.Mesh(roofGeometry,mat(0xb87859));roof.scale.set(1.16,1,.67);roof.position.y=16.1;residence.add(roof);
      for(const x of [-5.3,5.3])box(residence,x,16.7,-1.4,.9,1.8,1.0,0xd4c6aa);
      nameSign(residence,'RESIDENCE DU PORT',0,3.95,4.46,8.8,.65);
      remember('monaco-harbor-residence','residential',p.x,p.z,width+2,depth+2,yaw,.65);
      const reserved=occupied[occupied.length-1];reserved.w=Math.abs(Math.cos(yaw))*(width+2)+Math.abs(Math.sin(yaw))*(depth+2)+1;reserved.d=Math.abs(Math.sin(yaw))*(width+2)+Math.abs(Math.cos(yaw))*(depth+2)+1;
      replacementBuilding={sourceStand:'V',id:residence.name,x:p.x,z:p.z,width:width+2,depth:depth+2,yaw};return;
    }
    buildStand(p,yaw,rows,width,depth,covered,id,anchor.distance);
  }
  grandstand(12,-1,7,25,false,'K');grandstand(13,-1,6,20,false,'E');grandstand(14,1,6,17,false,'N');grandstand(15,1,7,17,false,'O');grandstand(16,1,8,20,true,'P');grandstand(17,1,8,26,true,'T');grandstand(19,-1,6,18,false,'V');

  // These small terraces belong to the narrow harbour-side quay only. They
  // may slide a few metres along T14--T17, but can never escape inland.
  for(const [id,target] of [['Q1',corners(14).distance+7],['Q2',corners(14).distance+25],['Q3',corners(16).distance+38]] as const){
    let placed=false;const rejected={land:0,occupied:0,dock:0,road:0,pit:0};
    for(const size of [{width:13,rows:5,depth:6.5},{width:12,rows:4,depth:5.2},{width:10.5,rows:4,depth:4.1}]){
      const depth=size.depth;
      for(const along of [0,-2,2,-4,4,-6,6,-8,8,-10,10,-13,13,-16,16,-19,19]){
        const station=THREE.MathUtils.clamp(target+along,corners(14).distance+7,corners(17).distance-7),s=layout.sampleAt(station),yaw=Math.atan2(-s.right.x,-s.right.z);
        for(const margin of [1.6,2.0,2.5,3.2,4.0]){
          const offset=layout.widthAt(station)/2+(depth+2)/2+margin,p=s.point.clone().addScaledVector(s.right,offset),footprint={id:`grandstand-${id}`,x:p.x,z:p.z,width:size.width+2,depth:depth+2,yaw};
          if(!containsFootprint(footprint,landPolygon,.3)){rejected.land++;continue;}if(placements.some(other=>!rectanglesApart(footprint,other,1.25))){rejected.occupied++;continue;}if(harborObstacles.some(other=>!rectanglesApart(footprint,other,1))){rejected.dock++;continue;}
          if(clearance(p.x,p.z,footprint.width,footprint.depth,yaw)<1.15){rejected.road++;continue;}if(cornerPoints(p.x,p.z,footprint.width,footprint.depth,yaw,4).some(v=>pitDistance(v.x,v.z)<3.2)){rejected.pit++;continue;}
          buildStand(p,yaw,size.rows,size.width,depth,false,id,station,true);placed=true;break;
        }
        if(placed)break;
      }
      if(placed)break;
    }
    if(!placed)throw new Error(`No supported harbour-side terrace for ${id}: ${JSON.stringify(rejected)}`);
  }

  // These city-side terraces face the actual road directly in front of them,
  // rather than aiming diagonally across the island at their old bend anchor.
  // Local +Z is the low/front row; the higher rows recede along local -Z.
  for(const id of ['E','N','O','P','T']){
    const stand=stands.find(p=>p.id===id)!,nearest=layout.nearest(stand.x,stand.z),yaw=Math.atan2(nearest.point.x-stand.x,nearest.point.z-stand.z);
    facilities.getObjectByName(`monaco-grandstand-${id}`)!.rotation.y=yaw;
    stand.yaw=yaw;stand.targetDistance=nearest.distance;
    const placement=placements.find(p=>p.id===`grandstand-${id}`)!;placement.yaw=yaw;placement.clearance=clearance(stand.x,stand.z,stand.width,stand.depth,yaw);
    const reserve=occupied[placements.indexOf(placement)];reserve.w=Math.abs(Math.cos(yaw))*stand.width+Math.abs(Math.sin(yaw))*stand.depth+1;reserve.d=Math.abs(Math.sin(yaw))*stand.width+Math.abs(Math.cos(yaw))*stand.depth+1;
  }

  // A single two-storey garage row follows the widened working corridor. The
  // core owns its three adjacent surfaces; these facilities add no ground sheet
  // over the fast lane or apron, avoiding the previous colour/depth overlap.
  const pits=new THREE.Group();pits.name='monaco-pit-garages';facilities.add(pits);reviewObjects.push({object:pits,parent:facilities});
  const row=new THREE.Group();row.name='monaco-pit-continuous-building';pits.add(row);reviewObjects.push({object:row,parent:pits});
  const bays=layout.pitBoxes,teams=[['MCLAREN',0xe67f3b],['FERRARI',0xc74d47],['RED BULL',0x42618b],['MERCEDES',0x55a59d],['ASTON',0x447b66],['ALPINE',0x679aca],['WILLIAMS',0x547ec0],['HAAS',0xaaa99d]] as const;
  if(!bays.length)throw new Error('Monaco pit garage anchors are missing.');
  type Seam={point:THREE.Vector3;front:THREE.Vector3};
  const seams=(apron=false):Seam[]=>{
    const center=(bay:MonacoPitGarageBox)=>apron?bay.apronCenter:bay.center,result:Seam[]=[];
    for(let i=0;i<=bays.length;i++){
      if(i===0)result.push({point:center(bays[0]).clone().addScaledVector(bays[0].tangent,-bays[0].width/2),front:bays[0].front.clone()});
      else if(i===bays.length){const b=bays[i-1];result.push({point:center(b).clone().addScaledVector(b.tangent,b.width/2),front:b.front.clone()});}
      else result.push({point:center(bays[i-1]).clone().lerp(center(bays[i]),.5),front:bays[i-1].front.clone().add(bays[i].front).normalize()});
    }return result;
  };
  const garageSeams=seams(),apronSeams=seams(true);
  const band=(name:string,stations:readonly Seam[],depth:number,bottom:number,top:number,color:number,frontOffset=0)=>{
    const vertices:number[]=[],indices:number[]=[];
    for(const s of stations)for(const height of [bottom,top])for(const side of [-1,1]){const p=s.point.clone().addScaledVector(s.front,frontOffset+side*depth/2);vertices.push(p.x,p.y+height,p.z);}
    const quad=(a:number,b:number,c:number,d:number)=>indices.push(a,b,c,a,c,d);
    for(let i=0;i<stations.length-1;i++){const a=i*4,b=a+4;quad(a+2,a+3,b+3,b+2);quad(a,b,b+1,a+1);quad(a+1,b+1,b+3,a+3);quad(a,a+2,b+2,b);}
    const end=(stations.length-1)*4;quad(0,1,3,2);quad(end,end+2,end+3,end+1);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,mat(color));mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;row.add(mesh);
  };
  const depth=layout.pitProfile.garageDepth;
  band('monaco-pit-foundation',garageSeams,depth-.04,-.59,0,0xcac5b2);
  band('monaco-pit-continuous-rear-wall',garageSeams,.16,0,3.35,0xd7d7c6,-depth/2+.08);
  band('monaco-pit-upper-storey',garageSeams,depth+.05,3.3,5.8,0xe5e4d6);
  band('monaco-pit-continuous-roof',garageSeams,depth+.2,5.82,6.08,0xece7d4);
  // Thin lines stand above the core's apron; no duplicate full asphalt plane.
  band('monaco-pit-yellow-safety-line',apronSeams,.055,.025,.043,0xd5ae46,layout.pitProfile.apronWidth/2-.58);
  for(const [index,b] of bays.entries()){
    const bay=new THREE.Group();bay.name=`monaco-pit-box-${index+1}`;bay.position.copy(b.center);bay.rotation.y=Math.atan2(b.front.x,b.front.z);pits.add(bay);reviewObjects.push({object:bay,parent:pits});
    const [team,color]=teams[index%teams.length],w=b.width,d=b.depth;
    box(bay,0,.045,0,w,.09,d-.08,0xa4aaa0);
    box(bay,0,1.45,-d/2+.12,w-.34,2.7,.14,0x3c5556);
    // The continuous rear wall alone left the first garage open at its end.
    // Every bay has two full-depth sides and an unobstructed front entrance.
    for(const side of [-1,1]){const wall=box(bay,side*(w/2-.08),1.65,0,.16,3.3,d,0xd7d7c6);wall.name=`monaco-pit-side-wall-${index+1}-${side<0?'left':'right'}`;}
    for(const side of [-1,1])box(bay,side*(w/2-.10),1.65,d/2-.08,.20,3.3,.24,0xe7e5d7);
    box(bay,0,3.13,d/2-.06,w,.38,.22,0xaeb9ac);
    for(let shutter=0;shutter<3;shutter++)box(bay,0,2.89+shutter*.10,d/2-.18,w-.42,.06,.08,0xc8cec1);
    box(bay,0,3.52,d/2+.035,w-.05,.27,.08,color);
    box(bay,0,4.65,d/2+.037,w-.18,1.65,.08,0x648a90);
    for(const x of [-.27,.27])box(bay,x*w,4.65,d/2+.085,.045,1.65,.025,0xc9d5cb);
    box(bay,0,5.56,d/2+.08,w-.14,.10,.15,0xf3edda);
    // Side-wall equipment keeps a real 2.4 x 2.8 central car footprint clear.
    const cabinetX=-w/2+.5;
    box(bay,cabinetX,.55,-d*.12,.60,1.05,.58,color,.05);for(let j=0;j<3;j++)box(bay,cabinetX,.32+j*.25,-d*.12+.30,.50,.04,.035,0xd7ddd0);
    const station=new THREE.Group();station.name=`monaco-pit-strategy-workstation-${index+1}`;station.position.set(w/2-.5,0,-.12);station.rotation.y=-Math.PI/2;bay.add(station);
    box(station,0,.90,0,1.68,.12,.64,0xcbd2c3,.04);
    for(const side of [-1,1])box(station,side*.68,.43,0,.09,.86,.48,0x617873);
    for(const side of [-1,1]){
      const screen=new THREE.Group();screen.name=`monaco-pit-telemetry-monitor-${index+1}-${side<0?'left':'right'}`;screen.position.set(side*.43,1.43,-.12);station.add(screen);
      box(screen,0,-.23,0,.065,.46,.07,0x58726d);box(screen,0,0,0,.78,.51,.075,0x173c3c,.025);
      box(screen,0,0,.043,.69,.42,.014,0x123a45);
      // Readable telemetry traces, timing rows and a coloured header face the operator.
      box(screen,0,.16,.054,.64,.035,.008,color);
      for(let line=0;line<4;line++){box(screen,-.12,.085-line*.073,.054,.33,.019,.008,line%2?0x9fd8b4:0xd2e5d2);box(screen,.23,.085-line*.073,.054,.13,.019,.008,line===1?0xe7c57b:0x71b9b4);}
      box(station,side*.43,.978,.19,.62,.025,.19,0x294945,.02);for(let row=0;row<3;row++)for(let key=0;key<7;key++)box(station,side*.43-.25+key*.08,.995,.13+row*.047,.047,.012,.025,0x9aac9c);
    }
    box(station,.73,.985,.18,.12,.045,.17,0x425d57,.035);
    sphere(bay,-w/2+.45,.74,.83,.26,.38,.23,color);sphere(bay,-w/2+.45,1.22,.83,.22,.24,.22,color);box(bay,-w/2+.45,1.23,1.025,.32,.10,.035,0x263e40,.02);
    station.userData={monitors:2,keyboards:2,seats:0,operators:0,location:'right-side-wall-maintenance-console'};
    for(const side of [-1,1]){box(bay,side*1.2,.102,0,.025,.014,2.8,0xd0c183);box(bay,0,.102,side*1.4,2.4,.014,.025,0xd0c183);}
    bay.userData={area:w*d,clearCarFootprint:{minX:-1.2,maxX:1.2,minZ:-1.4,maxZ:1.4},maintenanceCrew:1,operatorStyle:'torso-and-team-helmet'};
    remember(bay.name,'pit-building',b.center.x,b.center.z,w+.2,d+.2,bay.rotation.y,b.center.y-.59);
    const reserve=occupied[occupied.length-1];reserve.w=Math.abs(Math.cos(bay.rotation.y))*(w+.2)+Math.abs(Math.sin(bay.rotation.y))*(d+.2)+.8;reserve.d=Math.abs(Math.sin(bay.rotation.y))*(w+.2)+Math.abs(Math.cos(bay.rotation.y))*(d+.2)+.8;
    const frame=new THREE.Group();frame.name=`monaco-pit-parking-box-${index+1}`;frame.position.copy(b.apronCenter).addScaledVector(b.front,-.25);frame.rotation.y=bay.rotation.y;row.add(frame);reviewObjects.push({object:frame,parent:row});
    const frameWidth=w-.7,frameDepth=Math.min(2.5,b.apronWidth-.9);
    if(index===0){
      // The first station straddles the entry's gentle bend. Its paint follows
      // the real apron rather than projecting a rigid rectangle off the floor.
      const path=layout.pitPath,arc=[0];for(let i=1;i<path.length;i++)arc.push(arc[i-1]+path[i].distanceTo(path[i-1]));
      const centre=b.apronCenter.clone().addScaledVector(b.front,layout.pitProfile.fastWidth/2+b.apronWidth/2);let at=0,gap=Infinity;
      for(let i=1;i<path.length;i++){const a=path[i-1],d=path[i].clone().sub(a),t=THREE.MathUtils.clamp(centre.clone().sub(a).dot(d)/d.lengthSq(),0,1),dist=a.clone().addScaledVector(d,t).distanceToSquared(centre);if(dist<gap){gap=dist;at=arc[i-1]+t*(arc[i]-arc[i-1]);}}
      const normal=(i:number)=>new THREE.Vector3(path[Math.min(path.length-1,i+1)].z-path[Math.max(0,i-1)].z,0,path[Math.max(0,i-1)].x-path[Math.min(path.length-1,i+1)].x).normalize();
      frame.updateMatrix();const inverse=frame.matrix.clone().invert(),vertices:number[]=[],indices:number[]=[];
      const point=(distance:number,offset:number)=>{let i=1;while(i<arc.length-1&&arc[i]<distance)i++;const t=(distance-arc[i-1])/(arc[i]-arc[i-1]),p=path[i-1].clone().lerp(path[i],t).addScaledVector(normal(i-1).lerp(normal(i),t).normalize(),offset);p.y+=.063;return p.applyMatrix4(inverse);};
      const quad=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>{const k=vertices.length/3;for(const p of [a,b,c,d])vertices.push(p.x,p.y,p.z);indices.push(k,k+1,k+2,k,k+2,k+3);};
      for(const offset of [layout.pitProfile.fastWidth/2+.75,layout.pitProfile.fastWidth/2+b.apronWidth-.25])for(let j=0;j<8;j++){const a=at-frameWidth/2+j*frameWidth/8,z=a+frameWidth/8;quad(point(a,offset-.0225),point(z,offset-.0225),point(z,offset+.0225),point(a,offset+.0225));}
      for(const distance of [at-frameWidth/2,at+frameWidth/2])quad(point(distance-.0225,layout.pitProfile.fastWidth/2+.75),point(distance+.0225,layout.pitProfile.fastWidth/2+.75),point(distance+.0225,layout.pitProfile.fastWidth/2+b.apronWidth-.25),point(distance-.0225,layout.pitProfile.fastWidth/2+b.apronWidth-.25));
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();frame.add(new THREE.Mesh(geometry,mat(0xd7b44f)));
    }else for(const side of [-1,1]){box(frame,side*frameWidth/2,.036,0,.045,.018,frameDepth,0xd7b44f);box(frame,0,.036,side*frameDepth/2,frameWidth,.018,.045,0xd7b44f);}
    box(frame,0,.044,0,.65,.025,.065,color);
  }
  // All eight front signs share one texture/mesh rather than eight draw calls.
  // The inspectable bay/parking groups retain their actual opaque geometry.
  let numberTexture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=bays.length*128;const ctx=canvas.getContext('2d');
    if(ctx){ctx.fillStyle='#244e49';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff3cc';ctx.font='700 65px Arial';ctx.textAlign='center';ctx.textBaseline='middle';bays.forEach((_,i)=>ctx.fillText(`${String(i+1).padStart(2,'0')} / ${teams[i%teams.length][0]}`,512,i*128+67,960));numberTexture=new THREE.CanvasTexture(canvas);numberTexture.colorSpace=THREE.SRGBColorSpace;}
  }
  const numberVertices:number[]=[],numberUvs:number[]=[],numberIndices:number[]=[];
  for(const [i,b]of bays.entries()){
    const yaw=Math.atan2(b.front.x,b.front.z),across=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),center=b.center.clone().addScaledVector(b.front,b.depth/2+.075).add(new THREE.Vector3(0,3.06,0));
    const half=(b.width-.32)/2,first=numberVertices.length/3,v0=1-(i+1)/bays.length,v1=1-i/bays.length;
    for(const [x,y]of [[-half,-.2],[half,-.2],[half,.2],[-half,.2]]){const p=center.clone().addScaledVector(across,x);numberVertices.push(p.x,p.y+y,p.z);}
    numberUvs.push(0,v0,1,v0,1,v1,0,v1);numberIndices.push(first,first+1,first+2,first,first+2,first+3);
  }
  const numberGeometry=new THREE.BufferGeometry();numberGeometry.setAttribute('position',new THREE.Float32BufferAttribute(numberVertices,3));numberGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(numberUvs,2));numberGeometry.setIndex(numberIndices);numberGeometry.computeVertexNormals();
  const numberSigns=new THREE.Mesh(numberGeometry,new THREE.MeshBasicMaterial({map:numberTexture??null,color:numberTexture?0xffffff:0x244e49,side:THREE.FrontSide}));numberSigns.name='monaco-building-label-pit-frontages';pits.add(numberSigns);
  const pitBays=bays.length;
  const pitGarageRow={name:pits.name,buildingGroup:row.name,bays:pitBays,storeys:2,roofHeight:6.08,apronWidth:layout.pitProfile.apronWidth,fastWidth:layout.pitProfile.fastWidth,garageDepth:depth,garageWidth:bays[0].width,garageArea:bays[0].width*depth,previousGarageArea:3.4*3,clearCarFootprint:{width:2.4,depth:2.8},separatorWidth:.5,parkingInset:.25,parkingDepth:Math.min(2.5,layout.pitProfile.apronWidth-.9),sideWalls:pitBays*2,strategyWorkstations:pitBays,monitors:pitBays*2,keyboards:pitBays*2};
  landmark('pits','Monaco Pit Lane / Garage Row','起终点与连续维修区',pits,'A continuous two-storey garage row follows the working apron beside a distinct six-unit fast lane. Garage frontage and bay count are compressed for the review model; parking boxes and workstation details remain outside the fast lane.');
  // Pit-wall strategy is across the fast lane, separate from garage work PCs.
  const pitwall=createMonacoPitwall(layout,teams);facilities.add(pitwall.group);reviewObjects.push({object:pitwall.group,parent:facilities});
  for(const pod of pitwall.pods){reviewObjects.push({object:pod.group,parent:pitwall.group});remember(pod.id,'pitwall-strategy',pod.center.x,pod.center.z,pod.width,pod.depth,pod.group.rotation.y,.65);}
  // A little church at Sainte Dévote gives the first corner a distinct civic
  // landmark, separate from the waterfront and Monte-Carlo hotel architecture.
  const dev=corners(1),dp=dev.point.clone().addScaledVector(layout.sampleAt(dev.distance).right,-18),ds=findLandmarkSpot(dp,13,16,new THREE.Vector2(0,0),22),church=new THREE.Group();church.position.set(ds.x,Math.max(.8,layout.heightAt(ds.x,ds.z)),ds.z);church.name='sainte-devote-chapel';buildings.add(church);
  box(church,0,3.4,0,7.5,6.8,12,0xeee2c4);const churchRoof=new THREE.Mesh(new THREE.ConeGeometry(7.2,3.2,4),mat(0xbd795d));churchRoof.rotation.y=Math.PI/4;churchRoof.scale.x=.67;churchRoof.position.y=8.2;church.add(churchRoof);box(church,4.1,6.8,3.5,3,13.6,3,0xe4d7b8);sphere(church,4.1,14,3.5,1.8,1.65,1.8,0xb9bc9d);box(church,0,2.1,6.07,2.2,3.5,.1,0x5c776b);remember('sainte-devote-chapel','landmark',church.position.x,church.position.z,13,16,0,church.position.y);
  landmark('sainte-devote','Sainte Dévote Chapel','圣德沃特教堂',church,'A simplified chapel and bell tower near the first corner; the small footprint is moved clear of the racing line.');


  // Dense but deterministic city blocks are filtered against the full road,
  // not just their centres. Roofs, balconies and foundations share that bound.
  let cityCount=0;const cityColors=[0xe5cfb9,0xe2bba6,0xefdfc6,0xd8d9c7,0xcac5bc,0xf2e9d4];
  const cityCandidates:{row:number;col:number;score:number}[]=[];
  for(let row=0;row<23;row++)for(let col=0;col<22;col++){const x=west+13+col*16+(row%2)*4+(col*3%5-2),z=north+14+row*17+(row*7+col)%5-2,n=layout.nearest(x,z);cityCandidates.push({row,col,score:Math.abs(n.gap-24)+((row*37+col*13)%17)*.7});}
  cityCandidates.sort((a,b)=>a.score-b.score);
  for(const{row,col}of cityCandidates){if(cityCount>=86)break;const x=west+13+col*16+(row%2)*4+(col*3%5-2),z=north+14+row*17+(row*7+col)%5-2,w=8+(col%3)*1.6,d=8+(row%3)*1.0;
    if(!inside(x,z,landPolygon)||!cornerPoints(x,z,w+2,d+2,0,2).every(p=>inside(p.x,p.z,landPolygon))||clearance(x,z,w+2,d+2,0)<1.8||!separated(x,z,w+2,d+2,2))continue;
    const near=layout.nearest(x,z),ground=Math.max(.7,near.point.y-.3)+Math.min(12,Math.max(0,near.gap-25)*.17),height=6+(row*7+col*3)%15,building=new THREE.Group();building.position.set(x,ground,z);building.name=`monaco-city-block-${cityCount+1}`;buildings.add(building);
    if(ground>.8)box(building,0,-ground/2+.32,0,w+1.8,ground,d+1.8,0xc2bcaa);box(building,0,height/2,0,w,height,d,cityColors[(row+col)%cityColors.length],.22);windows(building,w,d,height,Math.max(2,Math.floor(height/2.5)));
    box(building,0,height+.15,0,w+.9,.32,d+.9,0xe9e4d5);if((row+col)%3===0){const roof=new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*.73,2.5,4),mat(0xba8066));roof.rotation.y=Math.PI/4;roof.scale.z=d/w;roof.position.y=height+1.4;building.add(roof);}else{box(building,0,height+.8,-1,w*.72,1.1,d*.55,0xc7cbc1);box(building,w*.27,height+1.6,-d*.24,1.4,.65,1.9,0x8faaa7);}
    remember(building.name,'city',x,z,w+2,d+2,0,ground);cityCount++;
  }

  // Plant only after the architectural sites are reserved: full crowns stay
  // on land and clear of garages, stands, the separate pit lane and roads.
  for(const no of [1,2,3,4,5,7,12]){const s=layout.sampleAt(corners(no).distance);for(const offset of [-15,-21])for(const along of [-8,3,13]){const p=s.point.clone().addScaledVector(s.right,offset).addScaledVector(s.tangent,along);plantTree('palm',p.x,p.z,6.4+(no%3)*.7);}}
  let treeSeed=0x4d434752;const treeRandom=()=>{treeSeed=(Math.imul(treeSeed,1664525)+1013904223)>>>0;return treeSeed/4294967296;};
  for(let attempt=0;attempt<2600&&trees.length<110;attempt++){const s=layout.sampleAt(treeRandom()*layout.length),p=s.point.clone().addScaledVector(s.right,(treeRandom()>.48?1:-1)*(8+treeRandom()*36)).addScaledVector(s.tangent,(treeRandom()-.5)*18),choice=treeRandom(),type=choice<.18?'palm':choice<.61?'cypress':'pine';plantTree(type,p.x,p.z,6.2+treeRandom()*5.2);}
  const treeCounts={palm:trees.filter(p=>p.type==='palm').length,cypress:trees.filter(p=>p.type==='cypress').length,pine:trees.filter(p=>p.type==='pine').length};

  // Keep useful authored groups for inspector toggles and GLB export; baking
  // within each group preserves their visibility and world-space positions.
  // Large review objects retain their own real merged geometry so shoreline
  // regression tests can inspect the actual boat bows and complete stand roofs.
  for(const {object}of reviewObjects)object.removeFromParent();
  for(const root of [buildings,facilities,waterfront,tunnelRoof,tunnelSides,vegetation])batchStaticScenery(root,72);
  for(const {object,parent}of reviewObjects){const compactPitObject=/^monaco-pit-(box|parking-box)-\d+$/.test(object.name)||object.name==='monaco-pit-continuous-building'||object.name.startsWith('monaco-pitwall-');batchStaticScenery(object,compactPitObject?1000000:72);parent.add(object);}
  let roofHidden=false;
  const summary={version:5,cityBuildings:cityCount,hotelSegments,yachts:boatCount,sailboats,docks:dockCount,grandstands,spectators,pitBays,pitGarageRow,pitWall:pitwall.summary,landmarks:landmarks.length,treeCounts,trees,boats,harborObstacles,harborChannel,stands,replacementBuilding,reference:MONACO_ACM_REFERENCE,artistic:'Miniature architectural massing and authored heights/shoreline berths, not a surveyed or 1:1 reconstruction.',placements,coastline:coast,seaPolygon,landPolygon};
  group.userData.monacoScenery={...summary,placements:undefined};
  return{group,buildings,tunnelRoof,landmarks,pitwall,summary,setTunnelCutaway(value:boolean){roofHidden=value;tunnelRoof.visible=!roofHidden;},setCityVisible(value:boolean){buildings.visible=value;}};
}
