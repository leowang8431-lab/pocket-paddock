import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHistoricRibbonGeometry,clipHistoricRibbonGeometry} from '../src/historic-ribbon-geometry.ts';
import {Track} from '../src/track.ts';
import {createHistoricSouthConnectionLayout,addMonzaHistoricSouthConnection} from '../src/monza-historic-south-connection.ts';

test('opaque ribbon clipping keeps interpolated colours and normals on the actual mesh boundary',()=>{
  const geometry=createHistoricRibbonGeometry({sampleCount:3,first:0,last:2,rows:6,surfacePoint:(i,u)=>new THREE.Vector3((u-.5)*4,.045,i)});
  const position=geometry.getAttribute('position'),colors:number[]=[];
  for(let i=0;i<position.count;i++)colors.push((position.getX(i)+2)/4,.25,.75);
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const clipped=clipHistoricRibbonGeometry(geometry,p=>p.x),p=clipped.getAttribute('position'),normal=clipped.getAttribute('normal'),color=clipped.getAttribute('color');let seam=0;
  assert.notEqual(clipped,geometry);assert.equal(clipped.index,null);
  for(let i=0;i<p.count;i++){
    assert.ok(p.getX(i)>=-1e-6);assert.ok(Math.abs(p.getY(i)-.045)<1e-7,'clipping cannot raise the paving');
    assert.ok(Math.abs(color.getX(i)-(p.getX(i)+2)/4)<1e-6);assert.equal(color.getY(i),.25);assert.equal(color.getZ(i),.75);
    assert.ok(Math.abs(normal.getY(i)-1)<1e-6);
    if(Math.abs(p.getX(i))<1e-6){seam++;assert.ok(Math.abs(color.getX(i)-.5)<1e-6);}
  }
  assert.ok(seam>=2);
});

test('a fully hidden road chunk becomes empty without producing nonfinite coordinates',()=>{
  const geometry=createHistoricRibbonGeometry({sampleCount:2,first:0,last:1,rows:6,thickness:.18,surfacePoint:(i,u)=>new THREE.Vector3(u,.045,i)});
  const empty=clipHistoricRibbonGeometry(geometry,()=>-1);
  assert.equal(empty.getAttribute('position').count,0);
  assert.equal(empty.getAttribute('normal').count,0);
  assert.equal(clipHistoricRibbonGeometry(geometry,()=>1),geometry,'unaffected chunks keep their original geometry and normals');
});

test('the full-width southern merge is physically trimmed outside GP asphalt at matching elevation',()=>{
  const track=new Track(),layout=createHistoricSouthConnectionLayout(track)!,root=new THREE.Group();
  assert.equal(layout.mergeIntoMainRoad,true);assert.ok(layout.samples.every(s=>s.width===10));
  addMonzaHistoricSouthConnection(root,track,layout);root.updateMatrixWorld(true);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),point=new THREE.Vector3();let probes=0,flatSeam=0;
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||!object.name.includes('-deck-'))return;
    const geometry=object.geometry,position=geometry.getAttribute('position'),index=geometry.index,count=index?.count??position.count;
    assert.ok(position.count>0,'fully clipped meshes must not enter the scene or GLB');
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i);b.fromBufferAttribute(position,index?index.getX(i+1):i+1);c.fromBufferAttribute(position,index?index.getX(i+2):i+2);
      const upward=b.clone().sub(a).cross(c.clone().sub(a)).y>1e-9;
      for(const weights of [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]){
        point.set(0,0,0).addScaledVector(a,weights[0]).addScaledVector(b,weights[1]).addScaledVector(c,weights[2]);
        const road=track.roadProjectionAt(point.x,point.z),gap=road.gap-8.15*track.widthAt(road.distance)/track.width;
        assert.ok(gap>=-.0001,`a clipped triangle still covers the racing asphalt: ${gap}`);probes++;
        if(upward&&gap<.002){flatSeam++;assert.ok(Math.abs(point.y-.045)<.00002,`the visible merge seam must meet the GP plane: ${JSON.stringify({point:point.toArray(),gap})}`);}
      }
    }
  });
  assert.ok(probes>500);assert.ok(flatSeam>10,'a finite-width visible seam must remain');
});
