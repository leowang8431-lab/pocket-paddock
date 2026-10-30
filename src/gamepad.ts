import type {Controls} from './physics';

export interface GamepadSummary {connected:boolean;supported:boolean;name:string;index:number|null}
export interface GamepadControls {steerAmount:number;brakeAmount:number;throttleAmount:number}
export interface GamepadLike {
  index:number;id:string;mapping:string;connected?:boolean;
  axes?:readonly number[];
  buttons?:readonly {value?:number;pressed?:boolean}[];
  vibrationActuator?:unknown;
  hapticActuators?:readonly unknown[];
}
type Haptics={playEffect?:(effect:string,parameters:Record<string,number>)=>unknown;pulse?:(intensity:number,duration:number)=>unknown};
const neutral=():GamepadControls=>({steerAmount:0,brakeAmount:0,throttleAmount:0});
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
const axis=(v:unknown)=>{const x=clamp(finite(v),-1,1);return Math.abs(x)<=.12?0:Math.sign(x)*(Math.abs(x)-.12)/.88;};
const trigger=(v:unknown)=>{const x=clamp(finite(v),0,1);return x<=.04?0:(x-.04)/.96;};
const buttonValue=(pad:GamepadLike,index:number)=>{const button=pad.buttons?.[index];return button?.value===undefined?Number(!!button?.pressed):finite(button.value);};
const actionButtons:readonly [number,string][]=[
  [0,'GamepadConfirm'],[1,'GamepadBack'],[2,'KeyF'],[3,'KeyR'],[9,'Escape'],[11,'KeyC'],
  [14,'GamepadLeft'],[15,'GamepadRight'],[12,'GamepadUp'],[13,'GamepadDown'],
  [4,'GamepadLeft'],[5,'GamepadRight'],
];

/** Gamepad API standard mapping, independent of navigator/DOM for fake-pad QA.
 * A newly connected or refocused controller first baselines held buttons;
 * release/repress is required, preventing a held Start from resuming a pause. */
export class GamepadInput {
  controls:GamepadControls=neutral();
  summary:GamepadSummary={connected:false,supported:true,name:'',index:null};
  private pad?:GamepadLike;
  private held=new Set<number>();
  private primeButtons=true;
  constructor(private onAction:(code:string)=>void=()=>{}){}

  poll(pads:readonly (GamepadLike|null|undefined)[]|null,available=true):void{
    const candidates=(pads??[]).filter((pad):pad is GamepadLike=>!!pad&&pad.connected!==false&&Number.isInteger(pad.index)&&pad.index>=0);
    let selected=this.pad?candidates.find(pad=>pad.index===this.pad!.index):undefined;
    if(this.pad&&!selected){
      this.pad=undefined;this.held.clear();this.primeButtons=true;this.controls=neutral();
      this.summary={connected:false,supported:available,name:'',index:null};this.onAction('GamepadDisconnected');return;
    }
    // Prefer the first standard controller, without switching away from one
    // already in use merely because another index appears earlier in the list.
    if(!selected||selected.mapping!=='standard')selected=candidates.find(pad=>pad.mapping==='standard')??selected??candidates[0];
    if(!selected){this.controls=neutral();this.summary={connected:false,supported:available,name:'',index:null};return;}
    if(this.pad?.index!==selected.index){this.held.clear();this.primeButtons=true;}
    this.pad=selected;
    const supported=available&&selected.mapping==='standard';
    this.summary={connected:true,supported,name:String(selected.id??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,64),index:selected.index};
    if(!supported){this.controls=neutral();this.held.clear();this.primeButtons=true;return;}
    this.controls={steerAmount:-axis(selected.axes?.[0])||0,brakeAmount:trigger(buttonValue(selected,6)),throttleAmount:trigger(buttonValue(selected,7))};
    const pressed=new Set<number>();
    for(const [index] of actionButtons)if(selected.buttons?.[index]?.pressed||buttonValue(selected,index)>.5)pressed.add(index);
    const actions=new Set<string>();
    if(!this.primeButtons)for(const [index,action] of actionButtons)if(pressed.has(index)&&!this.held.has(index))actions.add(action);
    // Update history before callbacks: a pause callback may call Input.clear().
    this.held=pressed;this.primeButtons=false;
    for(const action of actions)this.onAction(action);
  }

  /** Neutralize axes, keeping edge history so a held Start cannot fire twice. */
  clear():void{this.controls=neutral();}
  /** Ignore button changes made while the page is not accepting controller input. */
  suspend():void{this.clear();this.primeButtons=true;}

  async rumble():Promise<void>{
    if(!this.summary.connected||!this.summary.supported||!this.pad)return;
    const actuator=(this.pad.vibrationActuator??this.pad.hapticActuators?.[0]) as Haptics|undefined;
    try{
      if(typeof actuator?.playEffect==='function')await actuator.playEffect('dual-rumble',{startDelay:0,duration:90,weakMagnitude:.22,strongMagnitude:.38});
      else if(typeof actuator?.pulse==='function')await actuator.pulse(.3,90);
    }catch{/* Haptics are optional, browser/driver rejections never stop driving. */}
  }
}

/** Keyboard and touch remain decisive; pad travel retains fractional values. */
export function mergeDrivingControls(digital:Controls,gamepad:GamepadControls):Controls{
  const steerAmount=digital.left||digital.right?Number(digital.left)-Number(digital.right):clamp(finite(gamepad.steerAmount),-1,1);
  const brakeAmount=Math.max(Number(digital.brake),clamp(finite(gamepad.brakeAmount),0,1));
  const throttleAmount=Math.max(Number(digital.throttle),clamp(finite(gamepad.throttleAmount),0,1));
  return{throttle:throttleAmount>0,brake:brakeAmount>0,left:steerAmount>0,right:steerAmount<0,steerAmount,brakeAmount,throttleAmount};
}
