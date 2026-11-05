import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {FleetCar} from '../src/fleet-car.ts';
import {AiRivals} from '../src/ai-rivals.ts';
import {AiRace} from '../src/ai-race.ts';
import {Track} from '../src/track.ts';
import {getDriver} from '../src/team-catalog.ts';

/** CPU-only canvas stand-in. Geometry/material tests do not claim raster QA;
 * the browser checks verify the actual fonts, maps and GL shader rendering. */
function canvas(){
  const result={width:0,height:0,texts:[] as string[],getContext:(_type:string)=>context};
  const context=new Proxy<Record<string,unknown>>({
    clearRect:()=>{result.texts=[];},fillText:(text:string)=>result.texts.push(String(text)),
    drawImage:(source:{texts:string[]})=>{result.texts=source.texts.slice();},
  },{get:(target,key)=>key in target?target[key as string]:(()=>{}),set:(target,key,value)=>{target[key as string]=value;return true;}});
  return result;
}
function meshes(root:THREE.Object3D){const parts:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)parts.push(o);});return parts;}
const colorDistance=(a:THREE.Color,b:THREE.Color)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
const matrixClose=(a:THREE.Matrix4,b:THREE.Matrix4)=>a.elements.every((v,i)=>Math.abs(v-b.elements[i])<.00001);

test('AI reuses the complete player GLBs, finish and per-driver palettes with only three source requests',async()=>{
  const track=new Track();
  const originalDocument=globalThis.document,originalFetch=globalThis.fetch,requests:string[]=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{assert.equal(tag,'canvas');return canvas();}}});
  globalThis.fetch=async input=>{const name=String(input).split('/').at(-1)!;requests.push(name);return new Response(await fs.readFile(new URL(`../public/models/${name}`,import.meta.url)));};
  try{
    const player=new FleetCar(),models=new AiRivals(5);assert.equal(models.status,'unloaded');assert.equal(models.group.children.length,0);
    // Concurrent requests exercise the actual shared immutable-byte cache.
    await Promise.all([player.load(),models.load()]);assert.equal(player.status,'ready');assert.equal(models.status,'ready');
    assert.deepEqual(requests.sort(),['car.glb','helmet.glb','palettes.json']);
    const race=new AiRace(track),rivals=race.rivals;
    player.select(rivals[0].team,getDriver(rivals[0].driver));
    models.setVisible(true);models.update(rivals,0);
    const summary=models.summary;assert.equal(summary.source,'provided-glb');assert.equal(summary.trianglesPerCar,player.summary.triangles);assert.equal(summary.trianglesPerCar,27677);
    assert.deepEqual(summary.dimensions,player.summary.dimensions);assert.equal(summary.cars,5);assert.equal(summary.draws,43);assert.equal(summary.instancedParts,33);assert.equal(summary.decalPartsPerCar,2);
    assert.deepEqual(summary.drivers[0].bodyColors,player.summary.bodyColors);assert.deepEqual(summary.drivers[0].helmetColors,player.summary.helmetColors);
    const parts=meshes(models.group),instanced=parts.filter(m=>m instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    assert.equal(instanced.length,33);assert.ok(instanced.every(m=>m.count===5));
    // Verify exact source buffers, face coverage and transforms for one static
    // vehicle, rather than trusting the renderer's diagnostic triangle label.
    const reference=meshes(player.group),bySource=new Map<number,THREE.Mesh[]>();
    for(const part of parts){const sourceIndex=Number(part.userData.sourceIndex);if(!bySource.has(sourceIndex))bySource.set(sourceIndex,[]);bySource.get(sourceIndex)!.push(part);}
    const first=rivals[0];first.x=0;first.z=0;first.heading=0;first.distance=0;first.frontWheelAngle=0;models.update(rivals.map((r,i)=>i?{...r,finished:true}:r),0);
    player.setRenderPose(models.summary.drivers[0].pose!);
    player.group.position.y=.11;player.group.updateMatrixWorld(true);
    let renderedTriangles=0;
    for(let i=0;i<reference.length;i++){
      const source=reference[i],targetParts=bySource.get(i)!;assert.ok(targetParts?.length);
      const live=targetParts.filter(m=>m instanceof THREE.InstancedMesh||m.visible);
      for(const part of live){
        assert.deepEqual(Array.from(part.geometry.attributes.position.array),Array.from(source.geometry.attributes.position.array));
        assert.deepEqual(Array.from(part.geometry.attributes.normal.array),Array.from(source.geometry.attributes.normal.array));
        const m=part instanceof THREE.InstancedMesh?new THREE.Matrix4().fromArray(part.instanceMatrix.array,0):part.matrix;
        assert.ok(matrixClose(m,source.matrixWorld),`source ${i}/${source.name} has different scale, pivot or offset: ${m.elements} / ${source.matrixWorld.elements}`);
        const count=Math.min(part.geometry.drawRange.count,part.geometry.index?.count??part.geometry.attributes.position.count);renderedTriangles+=count/3;
        const actual=part.material as THREE.MeshStandardMaterial,expected=source.material as THREE.MeshStandardMaterial;
        for(const key of ['roughness','metalness','normalScale','clearcoat','clearcoatRoughness','envMapIntensity'] as const){assert.deepEqual(actual[key as keyof typeof actual],expected[key as keyof typeof expected]);}
        if(part instanceof THREE.InstancedMesh){
          const actualColor=new THREE.Color();part.getColorAt(0,actualColor);
          if(part.userData.paletteSection){
            const section=(source.userData.paletteSections as {offset:number;material:string}[]).find(s=>s.material===part.userData.paletteSection)!;
            const color=source.geometry.attributes.color;assert.ok(colorDistance(actualColor,new THREE.Color().setRGB(color.getX(section.offset),color.getY(section.offset),color.getZ(section.offset)))<1e-6);
          }else assert.ok(colorDistance(actualColor,expected.color)<1e-6);
        }
      }
    }
    assert.equal(renderedTriangles,player.summary.triangles,'source surfaces are neither dropped nor duplicated');
    // Every driver has a separate actual canvas copy; shared source canvases
    // would otherwise silently repaint every opponent with the last number.
    models.update(rivals.map(r=>({...r,finished:false})),0);
    const decalMaps=new Set<THREE.Texture>();
    for(const r of rivals){
      const decals=parts.filter(p=>p.visible&&p.userData.driver===r.driver);assert.equal(decals.length,2);
      const number=getDriver(r.driver).number;
      for(const decal of decals){const map=(decal.material as THREE.MeshBasicMaterial).map!;assert.equal(map.userData.number,number);assert.ok(map.image.texts.includes(String(number)));decalMaps.add(map);}
    }
    assert.equal(decalMaps.size,5);
    const geometryIds=parts.map(p=>p.geometry.uuid),textureIds=[...decalMaps].map(t=>t.uuid);
    race.update(.5);models.update(race.rivals,.5);assert.ok(models.summary.drivers.some(r=>r.pose!.travel>0));
    const paused=meshes(models.group).map(p=>p instanceof THREE.InstancedMesh?Array.from(p.instanceMatrix.array):p.matrix.elements.slice());models.update(race.rivals,0);
    assert.deepEqual(meshes(models.group).map(p=>p instanceof THREE.InstancedMesh?Array.from(p.instanceMatrix.array):p.matrix.elements.slice()),paused,'pause freezes wheels, steering and helmet as well as world position');
    assert.deepEqual(parts.map(p=>p.geometry.uuid),geometryIds);assert.deepEqual([...decalMaps].map(t=>t.uuid),textureIds);
    const allFinished=race.rivals.map(r=>({...r,finished:true}));models.update(allFinished,0);assert.equal(models.summary.cars,0);assert.equal(models.summary.draws,0);assert.ok(parts.every(p=>p instanceof THREE.InstancedMesh?p.count===0:!p.visible));
    race.start('mercedes','kimi_antonelli_12');models.update(race.rivals,0);assert.equal(models.summary.cars,5);assert.equal(requests.length,3);assert.ok(models.summary.drivers.every(r=>r.number===getDriver(r.driver).number));
    models.setVisible(false);models.update(race.rivals,0);assert.equal(models.group.visible,false);
    const loadingPlayer=new FleetCar(),savedRaceModels=new AiRivals(5);await savedRaceModels.load(loadingPlayer);assert.equal(loadingPlayer.status,'ready');assert.equal(savedRaceModels.status,'ready');assert.equal(requests.length,3);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalDocument===undefined)delete(globalThis as {document?:Document}).document;
    else Object.defineProperty(globalThis,'document',{configurable:true,value:originalDocument});
  }
});
