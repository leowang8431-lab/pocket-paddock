import test from 'node:test';
import assert from 'node:assert/strict';
import {GamepadInput,mergeDrivingControls,type GamepadLike} from '../src/gamepad.ts';

interface FakePad extends GamepadLike {axes:number[];buttons:{value:number;pressed:boolean}[]}
function pad(index=0,mapping='standard'):FakePad{
  return{index,id:`Test controller ${index}`,mapping,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0,pressed:false}))};
}
function press(pad:FakePad,index:number,on=true){pad.buttons[index]={pressed:on,value:on?1:0};}
const idle={throttle:false,brake:false,left:false,right:false};

test('standard analog sticks and triggers retain signed fractional travel after deadzones',()=>{
  const source=new GamepadInput(),device=pad();device.axes[0]=.56;device.buttons[6].value=.28;device.buttons[7].value=.52;
  source.poll([device]);
  assert.ok(Math.abs(source.controls.steerAmount+.5)<1e-9,'right axis becomes negative/left-positive steering');
  assert.ok(Math.abs(source.controls.brakeAmount-.25)<1e-9);assert.ok(Math.abs(source.controls.throttleAmount-.5)<1e-9);
  device.axes[0]=-.56;source.poll([device]);assert.ok(Math.abs(source.controls.steerAmount-.5)<1e-9);
  device.axes[0]=.12;device.buttons[6].value=.04;device.buttons[7].value=.01;source.poll([device]);
  assert.deepEqual(source.controls,{steerAmount:0,brakeAmount:0,throttleAmount:0});
  device.axes[0]=NaN;device.buttons[6].value=Infinity;device.buttons[7].value=-1;source.poll([device]);
  assert.deepEqual(source.controls,{steerAmount:0,brakeAmount:0,throttleAmount:0});
  device.axes[0]=-9;device.buttons[7].value=3;source.poll([device]);assert.equal(source.controls.steerAmount,1);assert.equal(source.controls.throttleAmount,1);
});

test('keyboard and touch commands override pad steering and combine pedal pressure by maximum',()=>{
  const analog={steerAmount:-.35,brakeAmount:.25,throttleAmount:.6};
  const merged=mergeDrivingControls({...idle,left:true,brake:true},analog);
  assert.equal(merged.steerAmount,1);assert.equal(merged.brakeAmount,1);assert.equal(merged.throttleAmount,.6);
  assert.equal(merged.left,true);assert.equal(merged.right,false);
  assert.equal(mergeDrivingControls({...idle,left:true,right:true},analog).steerAmount,0);
  const untouched=mergeDrivingControls(idle,analog);assert.equal(untouched.steerAmount,-.35);assert.equal(untouched.brakeAmount,.25);assert.equal(untouched.throttleAmount,.6);
});

test('action buttons fire only on new presses and clear cannot retrigger a held pause button',()=>{
  const actions:string[]=[],source=new GamepadInput(code=>actions.push(code)),device=pad();source.poll([device]);
  press(device,9);source.poll([device]);source.clear();source.poll([device]);source.poll([device]);assert.deepEqual(actions,['Escape']);
  press(device,9,false);source.poll([device]);press(device,9);source.poll([device]);assert.deepEqual(actions,['Escape','Escape']);
  for(const index of [9])press(device,index,false);source.poll([device]);
  const bindings:[[number,string],...Array<[number,string]>]=[[0,'GamepadConfirm'],[1,'GamepadBack'],[2,'KeyF'],[3,'KeyR'],[12,'GamepadUp'],[13,'GamepadDown'],[14,'GamepadLeft'],[15,'GamepadRight'],[4,'GamepadLeft'],[5,'GamepadRight']];
  for(const [index,action] of bindings){press(device,index);source.poll([device]);assert.equal(actions.at(-1),action);press(device,index,false);source.poll([device]);}
  const before=actions.length;press(device,4);press(device,14);source.poll([device]);assert.equal(actions.length,before+1,'duplicate shoulder/dpad direction is emitted once per frame');
});

test('held buttons at connection or refocus are baselined instead of automatically resuming a game',()=>{
  const actions:string[]=[],source=new GamepadInput(code=>actions.push(code)),device=pad();press(device,9);source.poll([device]);assert.deepEqual(actions,[]);
  press(device,9,false);source.poll([device]);source.suspend();press(device,9);source.poll([device]);assert.deepEqual(actions,[]);
  press(device,9,false);source.poll([device]);press(device,9);source.poll([device]);assert.deepEqual(actions,['Escape']);
});

test('the active standard controller remains selected until unplugged and disconnect clears inputs',()=>{
  const actions:string[]=[],source=new GamepadInput(code=>actions.push(code)),first=pad(2),other=pad(0);first.buttons[7].value=1;
  source.poll([null,null,first]);source.poll([other,null,first]);assert.equal(source.summary.index,2);assert.equal(source.controls.throttleAmount,1);
  source.poll([other]);assert.equal(source.summary.connected,false);assert.equal(source.controls.throttleAmount,0);assert.deepEqual(actions,['GamepadDisconnected']);
  source.poll([other]);assert.equal(source.summary.index,0);assert.equal(source.summary.connected,true);source.poll([other]);assert.deepEqual(actions,['GamepadDisconnected']);
});

test('standard mapping is preferred, unsupported mappings cannot issue controls, and absent API is safe',()=>{
  const source=new GamepadInput(),unsupported=pad(0,''),standard=pad(1);unsupported.axes[0]=1;unsupported.buttons[7].value=1;unsupported.id='\u0000'+('Long controller name '.repeat(10));
  source.poll([unsupported]);assert.equal(source.summary.connected,true);assert.equal(source.summary.supported,false);assert.equal(source.summary.name.length,64);assert.ok(!source.summary.name.includes('\u0000'));assert.equal(source.controls.throttleAmount,0);
  source.poll([unsupported,standard]);assert.equal(source.summary.index,1);assert.equal(source.summary.supported,true);
  source.poll([],false);source.poll(null,false);assert.deepEqual(source.summary,{connected:false,supported:false,name:'',index:null});assert.equal(source.controls.steerAmount,0);
});

test('optional haptics use guarded dual rumble and driver failures never reject',async()=>{
  const source=new GamepadInput(),device=pad();let calls=0;
  device.vibrationActuator={playEffect:(effect:string,parameters:{duration:number})=>{calls++;assert.equal(effect,'dual-rumble');assert.equal(parameters.duration,90);return Promise.reject(Error('unsupported effect'));}};
  source.poll([device]);await source.rumble();assert.equal(calls,1);
  source.poll([]);await source.rumble();assert.equal(calls,1);
  const old=pad();let pulse=0;old.hapticActuators=[{pulse:()=>{pulse++;throw Error('old driver');}}];source.poll([old]);await source.rumble();assert.equal(pulse,1);
});
