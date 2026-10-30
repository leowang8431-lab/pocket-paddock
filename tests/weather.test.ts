import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {VehiclePhysics,type Controls,type PhysicsTrack} from '../src/physics.ts';
import {RaceSession,BEST_STORAGE_KEY,WET_BEST_STORAGE_KEY} from '../src/race.ts';
import {WeatherController} from '../src/weather.ts';
import {Track} from '../src/track.ts';
import {QUALITY_PROFILES} from '../src/quality.ts';

const noInput:Controls={throttle:false,brake:false,left:false,right:false};
const straight:PhysicsTrack={width:16,surfaceAt:()=> 'asphalt',nearest:(x,z)=>({point:{x:0,z},tangent:{x:0,z:1},distance:z})};
function moving(wet:boolean,speed=28){const car=new VehiclePhysics();car.reset(0,0,0);car.weather=wet?'rainy':'sunny';car.speed=speed;car.vz=speed;return car;}

test('rain requires a longer braking distance and consumes more grip in the same turn',()=>{
  const distances=[];
  for(const wet of [false,true]){
    const car=moving(wet);let steps=0;
    while(car.speed>3&&steps++<1000)car.update(1/120,{...noInput,brake:true},straight);
    assert.ok(steps<1000);distances.push(car.z);
  }
  assert.ok(distances[1]>distances[0]*1.25,'wet stopping distance is materially longer');
  const dry=moving(false),wet=moving(true);
  for(let i=0;i<20;i++){dry.update(1/120,{...noInput,left:true},straight);wet.update(1/120,{...noInput,left:true},straight);}
  assert.ok(Math.abs(wet.yawRate)<Math.abs(dry.yawRate));assert.ok(wet.gripUsage>=dry.gripUsage);
});

test('reset keeps selected weather and wet acceleration stays bounded without teleporting',()=>{
  const dry=moving(false,0),wet=moving(true,0);
  for(let i=0;i<240;i++){dry.update(1/120,{...noInput,throttle:true},straight);wet.update(1/120,{...noInput,throttle:true},straight);}
  assert.ok(wet.speed>10&&wet.speed<dry.speed);assert.ok(Number.isFinite(wet.x+wet.z+wet.heading));
  wet.reset(0,0,0);assert.equal(wet.weather,'rainy');assert.equal(wet.speed,0);
});

const circuit={length:240,width:16,checkpoints:[0,40,80,120,160,200]};
function lap(race:RaceSession,stepTime:number){race.start();race.update(4.5,0,0,1);for(let d=10;d<=240;d+=10)race.update(stepTime,d%240,0,1);}
test('wet laps save separately and changing weather restores each existing record',()=>{
  const values=new Map([[BEST_STORAGE_KEY,'60']]);
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const race=new RaceSession(circuit,storage);
  assert.equal(race.best,60);race.setWeather('rainy');assert.equal(race.best,null);
  lap(race,2);assert.equal(race.best,48);assert.equal(values.get(WET_BEST_STORAGE_KEY),'48');assert.equal(values.get(BEST_STORAGE_KEY),'60');
  race.setWeather('sunny');assert.equal(race.best,60);lap(race,1);assert.equal(values.get(BEST_STORAGE_KEY),'24');
  assert.equal(new RaceSession(circuit,storage,'rainy').best,48);assert.equal(new RaceSession(circuit,storage).best,24);
});

test('wet mode works when local storage is unavailable',()=>{
  const storage={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}};
  const race=new RaceSession(circuit,storage,'rainy');assert.equal(race.storageAvailable,false);lap(race,2);assert.equal(race.best,48);assert.equal(race.completed,1);
  race.setWeather('sunny');assert.equal(race.best,null);lap(race,1);assert.equal(race.best,24);
  race.setWeather('rainy');assert.equal(race.best,48);race.setWeather('sunny');assert.equal(race.best,24);
});

test('weather visuals reuse buffers, stay finite, and freeze their clock at a zero update step',()=>{
  const scene=new THREE.Scene(),track=new Track(),sun=new THREE.DirectionalLight(),hemisphere=new THREE.HemisphereLight();scene.add(track.group,sun,hemisphere);
  const weather=new WeatherController(scene,sun,hemisphere,track),camera=new THREE.PerspectiveCamera();
  weather.setQuality(QUALITY_PROFILES.performance);weather.setMode('rainy');
  const position=new THREE.Vector3(0,.1,0);weather.update(.2,camera,position,25,Math.PI);
  const geometry=(weather.group.getObjectByName('rain-streaks') as THREE.LineSegments).geometry;
  const attribute=geometry.getAttribute('position'),before=Array.from(attribute.array);
  const time=weather.summary.elapsed;weather.update(0,camera,position,25,Math.PI);
  assert.deepEqual(Array.from(attribute.array),before);assert.equal(weather.summary.elapsed,time);assert.equal(weather.summary.rainParticles,320);assert.ok(weather.summary.wetSurfaces>=2);
  const uuids: string[]=[];weather.group.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments||o instanceof THREE.Points)uuids.push(o.geometry.uuid);});
  for(let i=0;i<40;i++)weather.setMode(i%2?'rainy':'sunny');
  const after:string[]=[];weather.group.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments||o instanceof THREE.Points)after.push(o.geometry.uuid);});
  assert.deepEqual(after,uuids);assert.ok(before.every(Number.isFinite));
  weather.setMode('sunny');assert.equal(weather.summary.rainParticles,0);assert.equal(weather.group.getObjectByName('rain-streaks')?.visible,false);
});
