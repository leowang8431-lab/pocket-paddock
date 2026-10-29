import type {Controls} from './physics';
export class Input {
  keys=new Set<string>();touch=new Set<string>();
  constructor(onAction:(code:string)=>void){
    window.addEventListener('keydown',e=>{
      if(e.target instanceof HTMLSelectElement&&e.code!=='Escape')return;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
      const interactive=e.target instanceof Element&&e.target.closest('button,a,input,select,textarea,[contenteditable]');
      if(!e.repeat&&!(e.code==='Enter'&&interactive))onAction(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.clear());
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(button=>{
      const key=button.dataset.control!;
      button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);this.touch.add(key);});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>this.touch.delete(key));
    });
  }
  clear(){this.keys.clear();this.touch.clear();}
  get controls():Controls {const has=(...k:string[])=>k.some(v=>this.keys.has(v)||this.touch.has(v));return{throttle:has('KeyW','ArrowUp'),brake:has('KeyS','ArrowDown'),left:has('KeyA','ArrowLeft'),right:has('KeyD','ArrowRight')};}
}
