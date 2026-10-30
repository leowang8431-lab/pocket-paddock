import test from 'node:test';
import assert from 'node:assert/strict';
import {Powertrain,IDLE_RPM,REDLINE_RPM,engineTimbre,gearLabel} from '../src/powertrain.ts';
import {ENGINE_CYCLE_BANK,ENGINE_RECORDING_REFERENCE} from '../src/engine-cycles.ts';

const dt=1/120;
function hold(p:Powertrain,seconds:number,speed:number,throttle=1,brake=0){
  for(let i=0;i<Math.round(seconds/dt);i++)p.update(dt,{speed,throttle,brake,active:true});
  return p.summary;
}
function accelerate(p:Powertrain){
  const shifts:{gear:number;rpm:number;target:number;cut:number}[]=[];let serial=0;
  for(let i=0;i<8/dt;i++){
    const s=p.update(dt,{speed:Math.min(44,i*dt*6.2),throttle:1,active:true});
    if(s.shiftSerial!==serial){shifts.push({gear:s.gear,rpm:s.rpm,target:s.targetRpm,cut:s.torqueCut});serial=s.shiftSerial;}
  }
  return shifts;
}

test('a stopped engine idles, revs under analog start throttle and releases smoothly',()=>{
  const p=new Powertrain();assert.equal(p.summary.rpm,IDLE_RPM);
  hold(p,.6,0,0);const idle=p.summary;
  const half=hold(p,.7,0,.5);assert.equal(half.gear,0);assert.equal(half.phase,'free-rev');assert.ok(half.rpm>idle.rpm+3500);
  const full=hold(p,.7,0,1);assert.ok(full.rpm>half.rpm+1000);assert.ok(full.launch>.99);
  const released=hold(p,.7,0,0);assert.equal(released.phase,'idle');assert.ok(released.rpm<IDLE_RPM+150);
  assert.equal(gearLabel(0),'N');assert.equal(gearLabel(-1),'R');assert.equal(gearLabel(8),'8');
});

test('automatic shifts have visible RPM drops and a short audible torque cut',()=>{
  const p=new Powertrain();hold(p,.7,6.9);const before=p.summary;
  const shift=p.update(dt,{speed:7.1,throttle:1});assert.equal(shift.gear,2);assert.equal(shift.shift,'up');assert.equal(shift.torqueCut,1);
  assert.ok(shift.targetRpm<before.rpm*.76);
  const cut=engineTimbre(shift,true),normal=engineTimbre({...shift,torqueCut:0},true);assert.ok(cut.volume<normal.volume*.3);
  const after=hold(p,.12,7.1);assert.ok(after.rpm<before.rpm*.79);assert.equal(after.torqueCut,0);
  const shifts=accelerate(new Powertrain());assert.deepEqual(shifts.map(s=>s.gear),[2,3,4,5,6,7,8]);assert.ok(shifts.every(s=>s.cut>.9));
});

test('hysteresis prevents gear hunting near an upshift threshold',()=>{
  const p=new Powertrain();hold(p,.8,7.2);assert.equal(p.summary.gear,2);
  const serial=p.summary.shiftSerial;
  for(let i=0;i<600;i++)p.update(dt,{speed:(42+Math.sin(i*.2)*2)/6,throttle:.55});
  assert.equal(p.summary.gear,2);assert.equal(p.summary.shiftSerial,serial);
});

test('braking produces bounded downshift rev-matching blips and reverse has its own state',()=>{
  const p=new Powertrain();hold(p,.8,7.2);hold(p,.5,5,0,1);const before=p.summary;
  const down=p.update(dt,{speed:4.5,throttle:0,brake:1});assert.equal(down.gear,1);assert.equal(down.shift,'down');assert.equal(down.revBlip,1);assert.ok(down.targetRpm>before.rpm+2500);
  const blipped=hold(p,.07,4.5,0,1);assert.ok(blipped.rpm>before.rpm+2000);
  hold(p,.5,4.5,0,1);assert.equal(p.summary.revBlip,0);
  const reverse=hold(p,.5,-3,0,1);assert.equal(reverse.gear,-1);assert.equal(reverse.phase,'reverse');assert.ok(reverse.rpm>IDLE_RPM+1500);
});

test('pause and invalid steps preserve every gearbox/envelope value; reset starts a clean engine',()=>{
  const p=new Powertrain();hold(p,1,7.2);const frozen=p.summary;
  for(const dt of [0,-1,NaN])assert.deepEqual(p.update(dt,{speed:40,throttle:0}),frozen);
  assert.deepEqual(p.update(1,{speed:0,throttle:0,active:false}),frozen);
  p.reset();assert.equal(p.summary.gear,0);assert.equal(p.summary.rpm,IDLE_RPM);assert.equal(p.summary.shiftSerial,0);assert.equal(p.summary.startBurst,0);
  const started=p.update(dt,{speed:0,throttle:1});assert.ok(started.startBurst>.95);
});

test('a hard racing-speed stop still produces the complete sequential downshift chain',()=>{
  const p=new Powertrain();accelerate(p);assert.equal(p.summary.gear,8);
  const gears:number[]=[];let serial=p.summary.shiftSerial;
  for(let i=0;i<1.5/dt;i++){
    const s=p.update(dt,{speed:Math.max(0,44*(1-i*dt/1.4)),throttle:0,brake:1});
    if(s.shiftSerial!==serial){if(s.shift==='down')gears.push(s.gear);serial=s.shiftSerial;}
  }
  assert.deepEqual(gears,[7,6,5,4,3,2,1]);assert.equal(p.summary.gear,0);
});

test('all synth frequencies and gains remain finite and muted output is exactly zero',()=>{
  const p=new Powertrain();
  for(let i=0;i<2400;i++){
    const state=p.update(dt,{speed:Math.sin(i*.006)*50,throttle:i%200/199,brake:1});
    assert.ok(state.rpm>=IDLE_RPM&&state.rpm<=REDLINE_RPM);
    const tone=engineTimbre(state,true);assert.ok(Object.values(tone).every(Number.isFinite));assert.ok(tone.volume>=0&&tone.volume<.22);
    assert.ok(tone.cycleHz>=27&&tone.cycleHz<=117);assert.equal(engineTimbre(state,false).volume,0);
  }
});

test('the lower engine register keeps throttle and gear pitch changes without boosting the output envelope',()=>{
  const p=new Powertrain(),idle=hold(p,.8,0,0),rev=hold(p,.8,0,1);
  const idleTone=engineTimbre(idle,true),revTone=engineTimbre(rev,true);
  assert.ok(revTone.cycleHz>idleTone.cycleHz*3,'Throttle must still have a clear pitch rise');
  // The waveform contains the recorded mechanical overtones. The acoustic
  // cycle rate changes while simulated revs and shift thresholds stay intact.
  assert.ok(rev.rpm>10000&&rev.rpm<11000);
  assert.ok(revTone.cycleHz<100);
  assert.ok(revTone.bodyGain>revTone.loadGain*1.8,'The rich low cycle must dominate its smoother load variant');
  assert.ok(revTone.filterHz<3000);
  const previousEnvelope=.065+rev.load*.092+rev.launch*.018+rev.startBurst*.022+rev.revBlip*.016;
  assert.equal(revTone.volume,previousEnvelope,'A deeper sound must not be implemented by turning up the volume');
  hold(p,.7,6.9);const before=engineTimbre(p.summary,true);
  p.update(dt,{speed:7.1,throttle:1});hold(p,.12,7.1);
  assert.ok(engineTimbre(p.summary,true).cycleHz<before.cycleHz*.79,'Upshift pitch drop must survive the retune');
  const beforeDown=hold(p,.5,5,0,1);p.update(dt,{speed:4.5,throttle:0,brake:1});hold(p,.07,4.5,0,1);
  assert.ok(engineTimbre(p.summary,true).cycleHz>engineTimbre(beforeDown,true).cycleHz*1.2,'Downshift rev-match must survive the retune');
});

test('licensed recording-derived cycles retain multiple strong mechanical harmonics instead of a pure sine',()=>{
  assert.equal(ENGINE_RECORDING_REFERENCE.license,'CC0-1.0');
  assert.equal(ENGINE_RECORDING_REFERENCE.verifiedEngineIdentity,false);
  assert.equal(ENGINE_CYCLE_BANK.length,2);
  for(const cycle of ENGINE_CYCLE_BANK){
    assert.equal(cycle.real.length,cycle.imag.length);assert.ok(cycle.averagedCycles>=40);
    assert.ok(cycle.real.every(Number.isFinite)&&cycle.imag.every(Number.isFinite));
    const energy=cycle.real.map((r,i)=>r*r+cycle.imag[i]**2),total=energy.reduce((a,b)=>a+b,0);
    assert.ok(energy.slice(2).reduce((a,b)=>a+b,0)/total>.10,'A mechanical cycle must have more than the first harmonic');
  }
  const body=ENGINE_CYCLE_BANK[0],amplitude=(n:number)=>Math.hypot(body.real[n],body.imag[n]);
  assert.ok(amplitude(3)>amplitude(1)*.6&&amplitude(6)>amplitude(1)*.6,'Preserve the strong recorded combustion harmonics');
});
