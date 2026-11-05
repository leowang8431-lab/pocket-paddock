import test from 'node:test';
import assert from 'node:assert/strict';
import {CIRCUITS,circuitRecordKey,isCircuitId} from '../src/circuits.ts';
import {RaceSession,BEST_STORAGE_KEY,WET_BEST_STORAGE_KEY} from '../src/race.ts';
import {localizedCorner} from '../src/i18n.ts';

test('the game accepts Monaco while rejecting URLs and inherited object properties as circuit IDs',()=>{
 for(const id of ['monza','spa','monaco'])assert.equal(isCircuitId(id),true);
 for(const value of ['Monaco','monaco.html','../monaco','__proto__','constructor','toString','',null,undefined,1,{}])assert.equal(isCircuitId(value),false);
 assert.equal(CIRCUITS.monaco.realLength,3337);assert.equal(CIRCUITS.monaco.code,'MONACO');
 assert.equal(circuitRecordKey('monza',false),BEST_STORAGE_KEY);assert.equal(circuitRecordKey('monza',true),WET_BEST_STORAGE_KEY);
});

test('new Monaco dry and wet results reload independently without overwriting the four existing boards',()=>{
 const seeds=new Map([
  ['pocket-paddock.monza.v3.best','91.125'],['pocket-paddock.monza.wet.v2.best','102.25'],
  ['pocket-paddock.spa.v1.best','151.375'],['pocket-paddock.spa.wet.v1.best','181.5'],
 ]),values=new Map(seeds),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const course={id:'monaco' as const,length:240,width:16,checkpoints:[0,40,80,120,160,200]},session=new RaceSession(course,storage);
 assert.equal(session.best,null);
 const driveLap=(step:number)=>{session.start();session.update(4.5,0,0,1);for(let d=10;d<=240;d+=10)session.update(step,d%240,0,1);assert.equal(session.result?.valid,true);};
 driveLap(2);assert.equal(session.best,48);session.setWeather('rainy');assert.equal(session.best,null);driveLap(2.5);assert.equal(session.best,60);
 assert.equal(new RaceSession(course,storage,'sunny').best,48);assert.equal(new RaceSession(course,storage,'rainy').best,60);
 session.setWeather('sunny');assert.equal(session.best,48);
 for(const [key,value]of seeds)assert.equal(values.get(key),value,`${key} was overwritten by a Monaco result`);
 assert.equal(values.size,6);assert.notEqual(circuitRecordKey('monaco',false),circuitRecordKey('monaco',true));
});

test('Monaco and future bilingual corner labels no longer fall back to the Monza start straight',()=>{
 for(const [en,zh]of [['Sainte Dévote','圣德沃特'],['Grand Hotel Hairpin','费尔蒙发夹弯'],['La Rascasse','拉斯卡斯'],['Anthony Noghès','安东尼·诺盖斯']]){
  const name=`${en} · ${zh}`;assert.equal(localizedCorner(name,'en'),en);assert.equal(localizedCorner(name,'zh'),name);
 }
 assert.equal(localizedCorner('Eau Rouge · 红水弯','en'),'Eau Rouge');
 assert.equal(localizedCorner('Rettifilo · 第一减速弯','en'),'Rettifilo · First chicane');
 assert.equal(localizedCorner('起终点直道','en'),'Start / finish straight');
});
