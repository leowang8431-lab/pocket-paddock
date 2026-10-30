import type {Controls} from './physics';
import {GamepadInput,mergeDrivingControls,type GamepadSummary} from './gamepad';
export class Input {
  keys=new Set<string>();touch=new Set<string>();
  private readonly gamepad:GamepadInput;
  private focused=true;
  constructor(onAction:(code:string)=>void){
    this.gamepad=new GamepadInput(onAction);
    window.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey||e.altKey)&&e.code!=='Escape')return;
      if(e.target instanceof HTMLSelectElement&&e.code!=='Escape')return;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
      const interactive=e.target instanceof Element&&e.target.closest('button,a,input,select,textarea,[contenteditable]');
      if(!e.repeat&&!(e.code==='Enter'&&interactive))onAction(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>{this.focused=false;this.clear();this.gamepad.suspend();});
    window.addEventListener('focus',()=>{this.focused=true;this.gamepad.suspend();});
    document.addEventListener('visibilitychange',()=>{this.clear();this.gamepad.suspend();});
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(button=>{
      const key=button.dataset.control!;
      button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);this.touch.add(key);});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>this.touch.delete(key));
    });
  }
  clear(){this.keys.clear();this.touch.clear();this.gamepad.clear();}
  pollGamepad():void{
    if(!this.focused||document.hidden){this.gamepad.suspend();return;}
    try{
      if(typeof navigator.getGamepads!=='function'){this.gamepad.poll([],false);return;}
      this.gamepad.poll(Array.from(navigator.getGamepads()));
    }catch{this.gamepad.poll([],false);}
  }
  get gamepadSummary():GamepadSummary{return {...this.gamepad.summary};}
  rumble():void{void this.gamepad.rumble();}
  get controls():Controls {const has=(...k:string[])=>k.some(v=>this.keys.has(v)||this.touch.has(v));return mergeDrivingControls({throttle:has('KeyW','ArrowUp'),brake:has('KeyS','ArrowDown'),left:has('KeyA','ArrowLeft'),right:has('KeyD','ArrowRight')},this.gamepad.controls);}
}
