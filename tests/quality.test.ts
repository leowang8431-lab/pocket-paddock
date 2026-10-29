import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality,QUALITY_PROFILES,qualityPixelRatio,isQualityMode} from '../src/quality.ts';

test('high DPI does not multiply the canvas beyond the selected pixel budget',()=>{
  const ratio=qualityPixelRatio(1920,1080,3,QUALITY_PROFILES.balanced);
  assert.ok(1920*1080*ratio*ratio<=1_050_001);
  assert.ok(ratio<1);
  assert.equal(qualityPixelRatio(640,360,2,QUALITY_PROFILES.performance),1);
});
test('sustained slow frames downgrade automatic quality without changing manual settings',()=>{
  let changes=0;const auto=new AdaptiveQuality('auto',false,()=>changes++);
  for(let i=0;i<150;i++)auto.observe(40,true);
  assert.equal(auto.level,'performance');assert.ok(changes>=1);assert.ok(auto.fps<=25);
  const manual=new AdaptiveQuality('high');for(let i=0;i<200;i++)manual.observe(70,true);
  assert.equal(manual.level,'high');assert.equal(manual.resolutionScale,1);
});
test('paused frames and isolated stalls do not lower automatic quality',()=>{
  const quality=new AdaptiveQuality();for(let i=0;i<300;i++)quality.observe(100,false);
  for(let i=0;i<150;i++)quality.observe(16.67,true);quality.observe(120,true);
  for(let i=0;i<100;i++)quality.observe(16.67,true);
  assert.equal(quality.level,'balanced');
});
test('software rendering starts conservatively and automatic mode has a resolution floor',()=>{
  const quality=new AdaptiveQuality('auto',true);assert.equal(quality.level,'performance');
  for(let i=0;i<1000;i++)quality.observe(55,true);
  assert.equal(quality.resolutionScale,.65);assert.equal(quality.profile.shadows,false);
  assert.ok(!isQualityMode('ultra'));assert.ok(isQualityMode('performance'));
});
test('very slow software frames still trigger automatic downgrades',()=>{
  const quality=new AdaptiveQuality();for(let i=0;i<30;i++)quality.observe(400,true);
  assert.equal(quality.level,'performance');assert.ok(quality.fps<=3);
});
