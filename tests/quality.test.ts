import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality,QUALITY_PROFILES,qualityPixelRatio,isQualityMode,classifyGraphicsCapability} from '../src/quality.ts';

test('high DPI does not multiply the canvas beyond the selected pixel budget',()=>{
  const ratio=qualityPixelRatio(1920,1080,3,QUALITY_PROFILES.balanced);
  assert.ok(1920*1080*ratio*ratio<=1_450_001);
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
  assert.equal(quality.resolutionScale,.55);assert.equal(quality.profile.shadows,false);
  assert.ok(!isQualityMode('ultra'));assert.ok(isQualityMode('performance'));
});

test('large external monitors still respect the smallest automatic pixel budget',()=>{
  const ratio=qualityPixelRatio(3840,2160,2,QUALITY_PROFILES.performance,.55);
  const pixels=3840*2160*ratio*ratio;
  assert.ok(pixels<=640_000*.55*.55+1);assert.ok(ratio<.28);
  const quality=new AdaptiveQuality('auto',true);for(let i=0;i<1000;i++)quality.observe(100,true);
  assert.equal(quality.resolutionScale,.55);
});

test('sustained sub-50fps rendering downgrades promptly but isolated compilation stalls do not',()=>{
  const slow=new AdaptiveQuality();for(let i=0;i<105;i++)slow.observe(21,true);assert.equal(slow.level,'performance');
  const stable=new AdaptiveQuality();for(let i=0;i<120;i++)stable.observe(16.67,true);
  stable.observe(1800,true);for(let i=0;i<180;i++)stable.observe(16.67,true);
  assert.equal(stable.level,'balanced');assert.equal(stable.resolutionScale,1);
});

test('capability hints lower only an explicitly constrained initial automatic profile',()=>{
  assert.deepEqual(classifyGraphicsCapability({}),{tier:'standard',preferPerformance:false});
  assert.equal(classifyGraphicsCapability({cores:NaN,deviceMemory:0,maxTextureSize:undefined}).preferPerformance,false);
  assert.equal(classifyGraphicsCapability({software:true,cores:16}).tier,'software');
  for(const hint of [{cores:4},{deviceMemory:4},{maxTextureSize:4096}])assert.equal(classifyGraphicsCapability(hint).tier,'constrained');
  const conservative=new AdaptiveQuality('auto',true);conservative.setMode('high');assert.equal(conservative.level,'high');conservative.setMode('auto');assert.equal(conservative.level,'performance');
  for(let i=0;i<1800;i++)conservative.observe(16.67,true);assert.equal(conservative.level,'performance','a constrained device does not repeatedly jump to the larger balanced budget');
});

test('recovery requires sustained 60fps headroom and never overrides a manual mode',()=>{
  const quality=new AdaptiveQuality();for(let i=0;i<1000;i++)quality.observe(55,true);assert.equal(quality.resolutionScale,.55);
  for(let i=0;i<1000;i++)quality.observe(19,true);assert.equal(quality.resolutionScale,.55,'roughly53fps is not enough recovery headroom');
  for(let i=0;i<1000;i++)quality.observe(16.67,true);assert.ok(quality.resolutionScale>.55&&quality.resolutionScale<=.7);
  quality.setMode('balanced');for(let i=0;i<1000;i++)quality.observe(200,true);assert.equal(quality.level,'balanced');assert.equal(quality.resolutionScale,1);
});
test('very slow software frames still trigger automatic downgrades',()=>{
  const quality=new AdaptiveQuality();for(let i=0;i<30;i++)quality.observe(400,true);
  assert.equal(quality.level,'performance');assert.ok(quality.fps<=3);
});
