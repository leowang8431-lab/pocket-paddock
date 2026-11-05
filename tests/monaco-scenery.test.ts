import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout} from '../src/monaco-layout.ts';
import {createMonacoScenery} from '../src/monaco-scenery.ts';

const layout=createMonacoLayout(),scenery=createMonacoScenery(layout);
type P={x:number;z:number};
function inside(p:P,poly:readonly P[]){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;}
function orient(a:P,b:P,c:P){return(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function hasCrossings(poly:readonly P[]){for(let i=0;i<poly.length;i++)for(let j=i+2;j<poly.length;j++){if(i===0&&j===poly.length-1)continue;const a=poly[i],b=poly[(i+1)%poly.length],c=poly[j],d=poly[(j+1)%poly.length];if(orient(a,b,c)*orient(a,b,d)<-1e-8&&orient(c,d,a)*orient(c,d,b)<-1e-8)return true;}return false;}

function segmentDistance(p:P,a:P,b:P){const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function onOrInside(p:P,poly:readonly P[]){return inside(p,poly)||poly.some((a,i)=>segmentDistance(p,a,poly[(i+1)%poly.length])<1e-5);}
function intersects(a:P,b:P,c:P,d:P){const abC=orient(a,b,c),abD=orient(a,b,d),cdA=orient(c,d,a),cdB=orient(c,d,b);return abC*abD<0&&cdA*cdB<0||segmentDistance(a,c,d)<1e-6||segmentDistance(b,c,d)<1e-6||segmentDistance(c,a,b)<1e-6||segmentDistance(d,a,b)<1e-6;}
function polygonDistance(a:readonly P[],b:readonly P[]){if(onOrInside(a[0],b)||onOrInside(b[0],a))return 0;let minimum=Infinity;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];if(intersects(p,q,r,s))return 0;minimum=Math.min(minimum,segmentDistance(p,r,s),segmentDistance(q,r,s),segmentDistance(r,p,q),segmentDistance(s,p,q));}return minimum;}
function meshFootprint(root:THREE.Object3D){
 // Derive the occupied outline from real transformed geometry, including
 // roofs, hull bevels and flags. Metadata rectangles alone missed the sea.
 root.updateWorldMatrix(true,true);const unique=new Map<string,P>(),p=new THREE.Vector3();let meshes=0;
 root.traverse(object=>{if(!(object instanceof THREE.Mesh))return;meshes++;const vertices=object.geometry.attributes.position;for(let i=0;i<vertices.count;i++){p.fromBufferAttribute(vertices,i).applyMatrix4(object.matrixWorld);unique.set(`${p.x.toFixed(5)},${p.z.toFixed(5)}`,{x:p.x,z:p.z});}});
 assert.ok(meshes>0,`${root.name} has no actual geometry to inspect`);
 const sorted=[...unique.values()].sort((a,b)=>a.x-b.x||a.z-b.z);assert.ok(sorted.length>=3);
 const half=(points:readonly P[])=>{const hull:P[]=[];for(const point of points){while(hull.length>=2&&orient(hull[hull.length-2],hull[hull.length-1],point)<=1e-8)hull.pop();hull.push(point);}return hull;};
 const lower=half(sorted),upper=half([...sorted].reverse());return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function outlineSamples(hull:readonly P[]){const points:P[]=[];for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.45));for(let j=0;j<steps;j++){const t=j/steps;points.push({x:THREE.MathUtils.lerp(a.x,b.x,t),z:THREE.MathUtils.lerp(a.z,b.z,t)});}}return points;}

test('all remaining and new quay stands are supported by land, face their own circuit section and keep the pit lane open',()=>{
 const footprints:P[][]=[],stands=scenery.summary.stands;
 assert.deepEqual(new Set(stands.map(stand=>stand.id)),new Set(['K','E','N','O','P','T','Q1','Q2','Q3']));
 const facilities=scenery.group.getObjectByName('monaco-pits-and-grandstands')!;
 assert.equal(facilities.getObjectByName('monaco-grandstand-V'),undefined);
 for(const{id,targetDistance,quay}of stands){
  const stand=facilities.getObjectByName(`monaco-grandstand-${id}`);assert.ok(stand,`Stand ${id} disappeared rather than being moved ashore`);
  const hull=meshFootprint(stand),samples=outlineSamples(hull);footprints.push(hull);
  for(const p of samples){assert.ok(onOrInside(p,scenery.summary.landPolygon),`Stand ${id} roof/base extends beyond the quay at ${p.x},${p.z}`);assert.ok(!inside(p,scenery.summary.seaPolygon),`Stand ${id} still occupies open sea`);const n=layout.nearest(p.x,p.z);assert.ok(n.gap>layout.widthAt(n.distance)/2+.6,`Stand ${id} occupies the racing surface`);}
  for(let i=1;i<layout.pitPath.length;i++){const a=layout.pitPath[i-1],b=layout.pitPath[i];assert.ok(!onOrInside(a,hull)&&!onOrInside(b,hull),`Stand ${id} covers the pit centreline`);for(let j=0;j<hull.length;j++){const p=hull[j],q=hull[(j+1)%hull.length];assert.ok(!intersects(p,q,a,b),`Stand ${id} crosses the pit lane`);assert.ok(Math.min(segmentDistance(p,a,b),segmentDistance(q,a,b),segmentDistance(a,p,q),segmentDistance(b,p,q))>layout.pitProfile.fastWidth/2+.15,`Stand ${id} roof leaves insufficient pit-lane space`);}}
  const front=new THREE.Vector3(0,0,1).transformDirection(stand.matrixWorld),origin=stand.getWorldPosition(new THREE.Vector3()),station=layout.sampleAt(targetDistance),target=station.point.clone().sub(origin).setY(0).normalize();assert.ok(front.dot(target)>.9,`Stand ${id} spectators face away from their circuit section`);
  if(id==='N'||id==='O'){const nearest=layout.nearest(origin.x,origin.z),towardsStraight=nearest.point.clone().sub(origin).setY(0).normalize();assert.ok(front.dot(towardsStraight)>.999,'The city-side open terraces must face the closest start straight');const original=id==='N'?{x:-125.51175521997301,z:81.17836542973969}:{x:-120.0006856088655,z:106.06500231499739};assert.ok(Math.hypot(origin.x-original.x,origin.z-original.z)<.02,'Angle correction must preserve the original terrace sites');}
  if(quay){assert.ok(targetDistance>layout.corners[13].distance&&targetDistance<layout.corners[16].distance,`Stand ${id} was moved outside the requested T14–T17 quay`);assert.ok(origin.clone().sub(station.point).dot(station.right)>0,`Stand ${id} moved to the city side rather than the requested harbour side`);assert.ok(origin.z>layout.corners[13].point.z&&origin.z<layout.corners[16].point.z);}
 }
 for(let i=0;i<footprints.length;i++)for(let j=i+1;j<footprints.length;j++)assert.ok(polygonDistance(footprints[i],footprints[j])>.6,'Complete stand roofs overlap each other');
});

test('the isolated V terrace is replaced at its original site by a complete building with safe roof and balcony space',()=>{
 const replacement=scenery.summary.replacementBuilding;assert.ok(replacement);assert.equal(replacement.sourceStand,'V');
 const building=scenery.buildings.getObjectByName('monaco-harbor-residence');assert.ok(building);
 const hull=meshFootprint(building),origin=building.getWorldPosition(new THREE.Vector3()),old={x:-121.95616315282709,z:151.94748706047665,yaw:2.2339237158079563};
 assert.ok(Math.hypot(origin.x-old.x,origin.z-old.z)<.05,'The building must occupy the actual removed stand site');
 const bounds=new THREE.Box3().setFromObject(building);assert.ok(bounds.max.y-bounds.min.y>12);
 for(const point of outlineSamples(hull)){
  assert.ok(onOrInside(point,scenery.summary.landPolygon));
  const dx=point.x-old.x,dz=point.z-old.z,localX=Math.cos(old.yaw)*dx-Math.sin(old.yaw)*dz,localZ=Math.sin(old.yaw)*dx+Math.cos(old.yaw)*dz;
  assert.ok(Math.abs(localX)<10.01&&Math.abs(localZ)<5.76,'The replacement roof or balconies exceed the former stand site');
  const n=layout.nearest(point.x,point.z);assert.ok(n.gap>layout.widthAt(n.distance)/2+1);
 }
 for(const stand of scenery.summary.stands){const object=scenery.group.getObjectByName(`monaco-grandstand-${stand.id}`)!;assert.ok(polygonDistance(hull,meshFootprint(object))>.6,'The replacement building overlaps a grandstand');}
});

test('the actual rotated boats stay in water with distinct headings and irregular spacing, clear of every dock',()=>{
 const boats:THREE.Object3D[]=[];scenery.group.traverse(o=>{if(/^monaco-(yacht|sailboat)-\d+$/.test(o.name))boats.push(o);});assert.ok(boats.length>=25);
 const dockNames=['monaco-harbor-dock-12','monaco-harbor-dock-13','monaco-harbor-dock-15','monaco-harbor-dock-17','port-hercule-breakwater'];
 const obstacles=dockNames.map(name=>{const object=scenery.group.getObjectByName(name);assert.ok(object,`${name} has no inspectable geometry`);return{name,hull:meshFootprint(object)};});
 const headings=new Set<number>(),xs=new Set<number>(),zs=new Set<number>(),hulls:P[][]=[];
 for(const boat of boats){const hull=meshFootprint(boat);hulls.push(hull);for(const p of outlineSamples(hull))assert.ok(onOrInside(p,scenery.summary.seaPolygon),`${boat.name} hull/flag leaves the water`);for(const obstacle of obstacles)assert.ok(polygonDistance(hull,obstacle.hull)>.35,`${boat.name} intersects ${obstacle.name}`);
  const forward=new THREE.Vector3(0,0,-1).transformDirection(boat.matrixWorld),yaw=(Math.atan2(forward.x,forward.z)+Math.PI*2)%(Math.PI*2);headings.add(Math.floor(yaw/(Math.PI/6)));const p=boat.getWorldPosition(new THREE.Vector3());xs.add(Math.round(p.x));zs.add(Math.round(p.z));
 }
 for(let i=0;i<hulls.length;i++)for(let j=i+1;j<hulls.length;j++)assert.ok(polygonDistance(hulls[i],hulls[j])>.65,`${boats[i].name} overlaps ${boats[j].name}`);
 assert.ok(headings.size>=8,'Boat headings still form a nearly parallel fleet');assert.ok(xs.size>=boats.length*.55&&zs.size>=boats.length*.55,'Boats still fall into a few regular coordinate rows');
});

test('the new planted silhouettes have actual low geometry outside the driving envelope',()=>{
 const vegetation=scenery.group.getObjectByName('monaco-palms-and-gardens')!;vegetation.updateWorldMatrix(true,true);
 const trees=scenery.summary.trees;assert.ok(trees.length>0);
 for(const type of ['palm','cypress','pine'] as const){const declared=trees.filter(tree=>tree.type===type);assert.ok(declared.length>0,`${type} silhouette missing`);assert.equal(declared.length,scenery.summary.treeCounts[type]);}
 const point=new THREE.Vector3(),seen=new Set<string>();let checked=0;
 vegetation.traverse(object=>{if(!(object instanceof THREE.Mesh))return;const position=object.geometry.attributes.position;for(let i=0;i<position.count;i++){
  point.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld);const key=`${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
  const n=layout.nearest(point.x,point.z);if(point.y<=n.point.y+3.5){assert.ok(n.gap>layout.widthAt(n.distance)/2+.4,'A real trunk or low branch blocks the street');checked++;}
 }});
 assert.ok(checked>trees.length*3,'The audit did not observe the actual planted geometry');
});

test('the inner harbour is water, all race lanes stay on land, and simple shore polygons completely cover the diorama',()=>{
 const {seaPolygon,landPolygon,coastline}=scenery.summary;
 assert.ok(!hasCrossings(seaPolygon)&&!hasCrossings(landPolygon),'Shoreline self-intersection creates spikes or missing triangles');
 for(let i=1;i<coastline.length;i++)assert.ok(coastline[i].z>coastline[i-1].z,'The authored coast must progress through the harbour');
 assert.ok(inside({x:-25,z:65},seaPolygon),'Port Hercule must occupy the inner bay between the long circuit arms');
 for(const sample of layout.samples){assert.ok(inside(sample.point,landPolygon),'A geographic road sample ended in the sea');assert.ok(!inside(sample.point,seaPolygon));}
 const minX=Math.min(...landPolygon.map(p=>p.x)),maxX=Math.max(...seaPolygon.map(p=>p.x)),minZ=Math.min(...seaPolygon.map(p=>p.z)),maxZ=Math.max(...seaPolygon.map(p=>p.z));
 for(let x=minX+.73;x<maxX;x+=7.31)for(let z=minZ+.61;z<maxZ;z+=8.47){const p={x,z};assert.notEqual(inside(p,landPolygon),inside(p,seaPolygon),`Water/land overlap or gap at ${x},${z}`);}
});

test('landmarks, hotel overhangs, stands and the actual garage fronts preserve vehicle space',()=>{
 for(const placement of scenery.summary.placements){
  assert.ok(placement.clearance>1,`${placement.id} intrudes into the road envelope`);
  const cs=Math.cos(placement.yaw),sn=Math.sin(placement.yaw);
  for(let u=-.5;u<=.5;u+=.25)for(let v=-.5;v<=.5;v+=.25){const x=placement.x+cs*u*placement.width+sn*v*placement.depth,z=placement.z-sn*u*placement.width+cs*v*placement.depth,n=layout.nearest(x,z);
   if(n.gap<layout.widthAt(n.distance)/2+1){assert.ok(placement.overTunnel&&n.distance>=layout.tunnel.start&&n.distance<=layout.tunnel.end&&placement.minY>n.point.y+5.4,`${placement.id} fails actual sampled road clearance`);}
  }
 }
 assert.equal(scenery.summary.pitBays,8,'The service area must contain the complete continuous garage row');
 const pits=scenery.summary.placements.filter(p=>p.kind==='pit-building');
 assert.equal(pits.length,layout.pitBoxes.length);
 for(const pit of pits){let gap=Infinity;for(const p of layout.pitPath)gap=Math.min(gap,Math.hypot(pit.x-p.x,pit.z-p.z));const expected=layout.pitProfile.fastWidth/2+layout.pitProfile.apronWidth+layout.pitProfile.garageDepth/2;assert.ok(Math.abs(gap-expected)<.4,'Garage centres must leave both the complete working apron and the six-unit fast lane');}
 const rascasse=scenery.landmarks.find(p=>p.id==='rascasse')!;
 assert.ok(rascasse.point.distanceTo(layout.corners[17].point)<30);
});

test('the tunnel is geometrically open at car height and its removable roof does not move the city',()=>{
 const sides=scenery.group.getObjectByName('monaco-tunnel-open-interior')!,p=new THREE.Vector3();let checked=0;
 sides.updateWorldMatrix(true,true);
 sides.traverse(object=>{if(!(object instanceof THREE.Mesh)||object.name.startsWith('monaco-building-label-'))return;const position=object.geometry.attributes.position;
  // A 3.5-unit clear envelope covers the complete lane, including the lower
  // sides of the curved entrance arches, with ample room for an F1 model.
  for(let i=0;i<position.count;i++){p.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld);const n=layout.nearest(p.x,p.z);if(n.gap<layout.widthAt(n.distance)/2-.25){assert.ok(p.y>n.point.y+3.5,'A wall or portal fills the car-height tunnel interior');checked++;}}
 });
 assert.ok(checked>10,'The audit must inspect the actual overhead tunnel mesh');
 const matrix=scenery.buildings.matrixWorld.clone();scenery.setTunnelCutaway(true);assert.equal(scenery.tunnelRoof.visible,false);assert.ok(scenery.buildings.matrixWorld.equals(matrix));scenery.setTunnelCutaway(false);assert.equal(scenery.tunnelRoof.visible,true);
 scenery.setCityVisible(false);assert.equal(scenery.buildings.visible,false);assert.equal(scenery.tunnelRoof.visible,true);scenery.setCityVisible(true);
});

test('the recognisable city, pool, marina and grandstands fit the initial export budget',()=>{
 assert.ok(scenery.summary.cityBuildings>=70&&scenery.summary.hotelSegments>=4);
 assert.ok(scenery.summary.yachts>=25&&scenery.summary.sailboats>=4&&scenery.summary.docks>=3);
 assert.ok(scenery.summary.grandstands>=7&&scenery.summary.spectators>=450);
 assert.deepEqual(new Set(scenery.landmarks.map(p=>p.id)),new Set(['harbor','casino','hairpin','tunnel','swimming-pool','pits','rascasse','sainte-devote']));
 const cities=scenery.summary.placements.filter(p=>p.kind==='city');assert.ok(cities.some(p=>p.z<-100)&&cities.some(p=>p.z>120)&&cities.some(p=>p.x< -110)&&cities.some(p=>p.x>40),'Buildings must be distributed round the circuit rather than truncated into one far-away row grid');
 const boats:THREE.Object3D[]=[];let triangles=0,meshes=0;
 scenery.group.traverse(object=>{if(/^monaco-(yacht|sailboat)-\d+$/.test(object.name))boats.push(object);if(!(object instanceof THREE.Mesh))return;meshes++;const position=object.geometry.attributes.position;triangles+=(object.geometry.index?.count??position.count)/3;for(let i=0;i<position.count;i++)assert.ok(Number.isFinite(position.getX(i)+position.getY(i)+position.getZ(i)));for(const material of Array.isArray(object.material)?object.material:[object.material])assert.ok(material instanceof THREE.MeshStandardMaterial||material instanceof THREE.MeshBasicMaterial);if(object.name.startsWith('monaco-building-label-'))assert.equal((object.material as THREE.Material).side,THREE.FrontSide,'Signs must not show mirrored back faces');});
 assert.equal(boats.length,scenery.summary.yachts);for(const boat of boats)assert.ok(inside(boat.position,scenery.summary.seaPolygon));
 // Individual boats, docks and stands retain inspectable geometry instead of
 // being flattened into anonymous cells; their additional draws are bounded.
 // Eight separately inspectable strategy cabins add one merged body and one
 // team-label plane each; retain the original triangle ceiling and bound the
 // explicit sixteen additional draw calls above the 150-draw base budget.
 assert.ok(triangles<350000&&meshes<=166,`${triangles} triangles / ${meshes} draws exceeds the scenery budget`);
 assert.ok(scenery.group.userData.monacoScenery.artistic.includes('not a surveyed or 1:1 reconstruction'));
});
