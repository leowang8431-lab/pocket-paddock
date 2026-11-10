import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAiPitCompound,type AiPitContext} from '../src/ai-pit-strategy.ts';

const lapLength=1400;
const monza:AiPitContext={
  compound:'medium',wear:.65,stintDistance:3.95*lapLength,remainingDistance:4.05*lapLength,
  lapLength,lapTime:60,pitLoss:12,weather:'sunny',
};

test('actual wear, rather than a fixed lap, decides whether to stop',()=>{
  assert.equal(chooseAiPitCompound({...monza,wear:.20}),null);
  assert.equal(chooseAiPitCompound(monza),'medium');
  assert.equal(chooseAiPitCompound({...monza,pitLoss:90}),null);
});

test('soft tires stay out while healthy and can switch to a durable set for a long finish',()=>{
  const early={...monza,compound:'soft' as const,wear:.27,stintDistance:lapLength,remainingDistance:7.05*lapLength};
  assert.equal(chooseAiPitCompound(early),null);
  assert.equal(chooseAiPitCompound({...early,wear:.82,stintDistance:3*lapLength,remainingDistance:5.05*lapLength}),'hard');
});

test('the same decision allows a short soft-tire finish when the stop pays off',()=>{
  const short={...monza,compound:'hard' as const,wear:.70,stintDistance:5*lapLength,remainingDistance:1.05*lapLength,pitLoss:4};
  assert.equal(chooseAiPitCompound(short),'soft');
  assert.equal(chooseAiPitCompound({...short,remainingDistance:lapLength}),null);
  assert.equal(chooseAiPitCompound({...short,remainingDistance:0}),null);
});

test('wet-weather strategies only fit wet tires',()=>{
  const rain={...monza,weather:'rainy' as const,lapTime:75};
  assert.equal(chooseAiPitCompound({...rain,compound:'soft',wear:.10,stintDistance:lapLength,remainingDistance:6*lapLength}),'wet');
  assert.equal(chooseAiPitCompound({...rain,compound:'wet',wear:.75,stintDistance:4*lapLength}),'wet');
  assert.equal(chooseAiPitCompound({...rain,compound:'wet',wear:.04,stintDistance:.25*lapLength}),null);
});
