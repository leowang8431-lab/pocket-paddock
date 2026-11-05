import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMonacoLayout,MONACO_METRES_PER_UNIT} from '../src/monaco-layout.ts';
import {createMonacoDrsPreview} from '../src/monaco-drs-preview.ts';

test('Monaco map DRS uses the actual FIA 2025 offsets and traverses the start-line wrap only once',()=>{
 const layout=createMonacoLayout(),{group,zone}=createMonacoDrsPreview(layout);
 assert.equal(zone.season,2025);
 assert.ok(Math.abs((zone.detection-layout.corners[15].distance)*MONACO_METRES_PER_UNIT-80)<1e-8);
 assert.ok(zone.detection<layout.corners[16].distance);
 assert.ok(Math.abs((zone.activation-layout.corners[18].distance)*MONACO_METRES_PER_UNIT-18)<1e-8);
 assert.ok(zone.activation<layout.length&&zone.end<zone.activation);
 assert.ok(group.userData.note.includes('does not enable DRS physics'));
 const guide=group.getObjectByName('monaco-drs-straight-edge-guide') as THREE.Mesh<THREE.BufferGeometry>,p=guide.geometry.attributes.position,index=guide.geometry.index!,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<p.count;i++){a.fromBufferAttribute(p,i);const n=layout.nearest(a.x,a.z);assert.ok(n.gap<layout.widthAt(n.distance)/2);assert.ok(a.y>n.point.y&&a.y-n.point.y<.1);}
 for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1)).sub(a);c.fromBufferAttribute(p,index.getX(i+2)).sub(a);assert.ok(b.cross(c).y>0);}
 for(const label of ['detect','open','end'])assert.ok(group.getObjectByName(`monaco-drs-line-${label}`));
});
