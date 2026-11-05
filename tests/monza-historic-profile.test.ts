import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {createHistoricOvalLayout,historicBridgeProfileAt,historicOvalSurfacePoint} from '../src/monza-historic-oval.ts';

test('historic bridge has symmetric constant-grade approaches with tangent-continuous joins',()=>{
  const height=(d:number)=>historicBridgeProfileAt(d).height;
  assert.equal(height(0),.14);assert.equal(height(102),.14);
  assert.equal(height(184),9.25);assert.equal(height(225),9.25);assert.equal(height(267),9.25);
  assert.ok(Math.abs(height(349)-.14)<1e-12);
  const grade=9.11/70;
  for(const start of [114,125,140,155,167])assert.ok(Math.abs((height(start+5)-height(start))/5-grade)<1e-12,'climb middle must keep a constant grade');
  for(const start of [279,290,305,320,332])assert.ok(Math.abs((height(start+5)-height(start))/5+grade)<1e-12,'descent middle must keep a constant grade');
  const step=.001;
  for(const join of [102,114,172,184,267,279,337,349]){
    const before=(height(join)-height(join-step))/step,after=(height(join+step)-height(join))/step;
    assert.ok(Math.abs(before-after)<.00002,`grade breaks at ${join}`);
    if([102,184,267,349].includes(join))assert.ok(Math.max(Math.abs(before),Math.abs(after))<.00002,'ramp must meet flat ground/deck tangentially');
  }
  for(let d=102;d<=349;d+=.25){
    assert.ok(height(d)>=.14-1e-12&&height(d)<=9.25+1e-12,'profile must never overshoot or dip');
    assert.ok(Math.abs(height(d)-height(451-d))<1e-11,'approach and descent must have matching profiles');
  }
});

test('complete bridge deck is horizontal and descent never regains the old crossfall',()=>{
  const track=new Track(),layout=createHistoricOvalLayout(track);
  const deck=layout.samples.filter(s=>s.distance>=184&&s.distance<=267);
  assert.ok(deck.length>=30,'a meaningful length of flat deck is required');
  for(const sample of deck)for(const u of [0,.25,.5,.75,1]){
    assert.equal(sample.bank,0);
    assert.ok(Math.abs(historicOvalSurfacePoint(sample,u).y-9.25)<1e-12,'both bridge edges and its centre must be level');
  }
  for(const sample of layout.samples.filter(s=>s.distance>267&&s.distance<=349))assert.equal(sample.bank,0,'descent shoulders must not grow back into a hump');
  for(const sample of layout.samples.filter(s=>s.section==='south-banking'&&s.bank===1)){
    assert.ok(Math.abs(historicOvalSurfacePoint(sample,1).y-historicOvalSurfacePoint(sample,0).y-4)<1e-12,'the south banking must retain its 4-unit rise');
  }
});

test('flat eastern approach has support ribs while the modern road corridor remains open',()=>{
  const track=new Track(),before=JSON.stringify(track.samples),layout=createHistoricOvalLayout(track);
  const eastern=layout.supports.filter(s=>layout.samples[s.sample].section==='east-straight');
  assert.ok(eastern.length>=2,'elevated eastern approach needs actual supports');
  assert.ok(eastern.every(s=>layout.samples[s.sample].baseHeight>.9));
  assert.ok(layout.supports.every(s=>s.minRoadClearance>26.8),'support footprints must clear the modern road and fence');
  assert.equal(JSON.stringify(track.samples),before,'historic scenery cannot modify the driving road');
});
