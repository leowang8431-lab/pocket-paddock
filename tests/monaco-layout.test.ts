import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout,MONACO_METRES_PER_UNIT,MONACO_REAL_LENGTH} from '../src/monaco-layout.ts';
import {MONACO_COORDINATES} from '../src/monaco-coordinates.ts';

const layout=createMonacoLayout();
test('Monaco retains one closed geographic loop, the northbound start straight and all nineteen official-map corner identities',()=>{
 assert.equal(MONACO_REAL_LENGTH,3337);assert.equal(MONACO_METRES_PER_UNIT,3.2);
 assert.equal(layout.corners.length,19);assert.deepEqual(layout.corners.map(c=>c.number),Array.from({length:19},(_,i)=>i+1));
 assert.ok(Math.abs(layout.length*MONACO_METRES_PER_UNIT-MONACO_REAL_LENGTH)<25);
 assert.ok(layout.sampleAt(0).point.distanceTo(layout.sampleAt(layout.length).point)<1e-10);
 assert.ok(layout.samples[0].tangent.z<-.98,'The start straight must point north towards Sainte Dévote');
 let previous=0;for(const corner of layout.corners){assert.ok(corner.distance>previous);previous=corner.distance;const [lon,lat]=MONACO_COORDINATES[corner.sourceIndex],geo=layout.project(lon,lat);assert.ok(Math.hypot(geo.x-corner.point.x,geo.z-corner.point.z)<.65);}
 assert.equal(layout.corners[3].id,'casino');assert.equal(layout.corners[3].sourceIndex,0);
 assert.equal(layout.corners[5].id,'grand-hotel-hairpin');assert.equal(layout.corners[5].sourceIndex,21);
 assert.equal(layout.corners[17].id,'rascasse');assert.equal(layout.corners[18].id,'anthony-noghes');
});

test('the authored hill rises from Sainte Dévote to Casino, descends to Portier and the actual tunnel stays on the coast section',()=>{
 const byNumber=(n:number)=>layout.corners[n-1];
 assert.ok(byNumber(4).point.y-byNumber(1).point.y>12);
 assert.ok(byNumber(5).point.y>byNumber(6).point.y&&byNumber(6).point.y>byNumber(7).point.y&&byNumber(7).point.y>byNumber(8).point.y);
 assert.ok(byNumber(8).distance<layout.tunnel.start&&layout.tunnel.start<byNumber(9).distance&&byNumber(9).distance<layout.tunnel.end&&layout.tunnel.end<byNumber(10).distance);
 for(const corner of layout.corners.slice(9))assert.ok(Math.abs(corner.point.y-1.2)<.01);
 assert.ok(layout.bounds.min.y>1.15&&layout.bounds.max.y<14.1);
});

test('actual asphalt triangles are finite, upward-facing and meet the sampled centre without pinched adjacent streets crossing',()=>{
 const road=layout.group.getObjectByName('monaco-asphalt-ribbon') as THREE.Mesh<THREE.BufferGeometry>,positions=road.geometry.attributes.position,index=road.geometry.index!;
 assert.equal(positions.count,(layout.samples.length+1)*2);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<positions.count;i++)assert.ok(Number.isFinite(positions.getX(i)+positions.getY(i)+positions.getZ(i)));
 for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(positions,index.getX(i));b.fromBufferAttribute(positions,index.getX(i+1)).sub(a);c.fromBufferAttribute(positions,index.getX(i+2)).sub(a);assert.ok(b.cross(c).y>0,'An actual road triangle folded down at a tight street corner');}
 for(let i=0;i<layout.samples.length;i+=11){a.fromBufferAttribute(positions,i*2);b.fromBufferAttribute(positions,i*2+1);assert.ok(a.add(b).multiplyScalar(.5).distanceTo(layout.samples[i].point)<2e-5);}
 let minimumGap=Infinity;
 for(let i=0;i<layout.samples.length;i+=3)for(let j=i+3;j<layout.samples.length;j+=3){const first=layout.samples[i],second=layout.samples[j],arc=Math.abs(first.distance-second.distance);if(Math.min(arc,layout.length-arc)<15)continue;const gap=Math.hypot(first.point.x-second.point.x,first.point.z-second.point.z)-(layout.roadWidths[i]+layout.roadWidths[j])/2;minimumGap=Math.min(minimumGap,gap);}
 assert.ok(minimumGap>1.2,'Two non-adjacent road ribbons overlap around Mirabeau or the hairpin');
 assert.ok(Math.min(...layout.roadWidths)>2&&Math.max(...layout.roadWidths)<=6.4);
});

test('the separate pit ribbon joins the loop at both ends and the complete procedural core stays inside an exportable geometry budget',()=>{
 assert.equal(layout.pitPath.length,231);
 for(const endpoint of [layout.pitPath[0],layout.pitPath.at(-1)!])assert.ok(layout.nearest(endpoint.x,endpoint.z).gap<.8);
 const pit=layout.group.getObjectByName('monaco-separate-pit-lane');assert.ok(pit instanceof THREE.Mesh);
 let triangles=0,meshes=0;
 layout.group.traverse(object=>{if(!(object instanceof THREE.Mesh))return;meshes++;const positions=object.geometry.attributes.position;for(let i=0;i<positions.count;i++)assert.ok(Number.isFinite(positions.getX(i)+positions.getY(i)+positions.getZ(i)));triangles+=(object.geometry.index?.count??positions.count)/3;});
 assert.ok(triangles<50000&&meshes<65,`${triangles} triangles / ${meshes} draws exceed the initial core budget`);
 assert.equal(layout.group.userData.monacoLayout.version,1);assert.ok(layout.group.getObjectByName('monaco-start-finish'));
});

test('vertical retaining skirts ground both road shoulders without covering the asphalt or tunnel carriageway',()=>{
 const skirt=layout.group.getObjectByName('monaco-road-retaining-skirt') as THREE.Mesh<THREE.BufferGeometry>;
 assert.ok(skirt instanceof THREE.Mesh);const positions=skirt.geometry.attributes.position,indices=skirt.geometry.index!;
 assert.equal(positions.count,(layout.samples.length+1)*4);assert.ok(indices.count/3>5800&&indices.count/3<=6000);
 for(let i=0;i<=layout.samples.length;i++)for(let side=0;side<2;side++){
  const lower=i*4+side*2,upper=lower+1,s=layout.samples[i%layout.samples.length];
  assert.ok(Math.abs(positions.getY(lower)-.65)<1e-6);assert.ok(Math.abs(positions.getY(upper)-(s.point.y-.02))<1e-6);
  assert.equal(positions.getX(lower),positions.getX(upper));assert.equal(positions.getZ(lower),positions.getZ(upper));
  assert.ok(Math.abs(Math.hypot(positions.getX(upper)-s.point.x,positions.getZ(upper)-s.point.z)-(layout.roadWidths[i%layout.samples.length]/2+.45))<2e-5);
 }
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 const usedVertices=new Set<number>();
 for(let i=0;i<indices.count;i+=3){const first=indices.getX(i);a.fromBufferAttribute(positions,first);b.fromBufferAttribute(positions,indices.getX(i+1)).sub(a);c.fromBufferAttribute(positions,indices.getX(i+2)).sub(a);const normal=b.cross(c),sample=layout.samples[Math.floor(first/4)],side=first%4>=2?1:-1;assert.ok(normal.lengthSq()>1e-6);assert.ok(normal.dot(sample.right)*side>0,'A retaining face points into the road');assert.ok(Math.abs(normal.y)<1e-8,'A retaining face must not make a horizontal cover across the route');for(let k=0;k<3;k++)usedVertices.add(indices.getX(i+k));}
 for(const vertex of usedVertices){if(vertex%2===0)continue;const x=positions.getX(vertex),y=positions.getY(vertex),z=positions.getZ(vertex);for(const pit of layout.pitPath){if(pit.y+.018>=y)continue;assert.ok(Math.hypot(x-pit.x,z-pit.z)>layout.pitProfile.fastWidth/2+.1,'A retaining face blocks the lower pit-lane merge');}}
 skirt.updateMatrixWorld(true);
 for(const distance of [layout.corners[3].distance,(layout.tunnel.start+layout.tunnel.end)/2]){const p=layout.sampleAt(distance).point,ray=new THREE.Raycaster(p.clone().add(new THREE.Vector3(0,.4,0)),new THREE.Vector3(0,1,0));assert.equal(ray.intersectObject(skirt).length,0,'Retaining faces must leave the uphill and tunnel road open above');}
});
