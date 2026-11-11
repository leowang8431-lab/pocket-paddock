import './travel-transition.css';
import {CIRCUITS,type CircuitId} from './circuits';
import type {Language} from './i18n';
import {createTravelMap,DANZHOU,flightDuration,paintCircuitOutline,TRAVEL_DESTINATIONS} from './travel-map';

type Origin = Parameters<typeof flightDuration>[0];
const englishCountries:Record<CircuitId,string>={monza:'Italy',spa:'Belgium',monaco:'Monaco'};
const ease=(fraction:number)=>fraction*fraction*(3-2*fraction);
const clamp=(fraction:number)=>Math.max(0,Math.min(1,fraction));

function animate(duration:number,draw:(elapsed:number)=>void):Promise<void>{
  return new Promise(resolve=>{
    const start=performance.now();
    function frame(now:number){
      const elapsed=Math.min(now-start,duration);
      draw(elapsed);
      if(elapsed<duration)requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

export class TravelTransition {
  private readonly flight:HTMLElement;
  private readonly route:HTMLElement;
  private readonly door:HTMLElement;
  private readonly splash:HTMLElement;
  private readonly choices:HTMLElement;
  private readonly status:HTMLElement;
  private readonly world:HTMLCanvasElement;
  private readonly course:HTMLCanvasElement;
  private readonly lamps:HTMLElement[];

  constructor(private readonly layer:HTMLElement,private readonly app:HTMLElement,private readonly getLanguage:()=>Language){
    layer.classList.add('travel-transition');
    layer.removeAttribute('role');
    layer.removeAttribute('aria-atomic');
    layer.innerHTML=`
      <div class="travel-splash"><strong>Pocket Paddock</strong><p></p></div>
      <div class="travel-door" hidden>
        <div class="travel-door-copy">
          <div class="travel-lights" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
          <h1>Pocket Paddock</h1><p class="travel-door-note"></p>
          <div class="travel-choices" hidden></div>
        </div>
      </div>
      <div class="travel-flight" hidden aria-hidden="true">
        <canvas></canvas><div class="travel-flight-copy"><p></p><strong></strong></div>
        <span class="travel-credit">Natural Earth</span>
      </div>
      <div class="travel-route" hidden aria-hidden="true">
        <div class="travel-route-copy"><p></p><strong></strong><span></span></div><canvas></canvas>
      </div>
      <span class="travel-status" role="status"></span>`;
    this.flight=layer.querySelector('.travel-flight')!;
    this.route=layer.querySelector('.travel-route')!;
    this.door=layer.querySelector('.travel-door')!;
    this.splash=layer.querySelector('.travel-splash')!;
    this.choices=layer.querySelector('.travel-choices')!;
    this.status=layer.querySelector('.travel-status')!;
    this.world=this.flight.querySelector('canvas')!;
    this.course=this.route.querySelector('canvas')!;
    this.lamps=[...layer.querySelectorAll<HTMLElement>('.travel-lights i')];
  }

  private get quiet(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
  private local(zh:string,en:string){return this.getLanguage()==='zh'?zh:en;}
  private name(circuit:CircuitId){return this.local(CIRCUITS[circuit].zh,CIRCUITS[circuit].name);}

  private cover(phase:string){
    this.app.inert=true;
    this.layer.hidden=false;
    this.layer.dataset.travelPhase=phase;
    this.splash.hidden=true;
    this.flight.hidden=true;
    this.route.hidden=true;
    this.door.hidden=true;
    this.choices.hidden=true;
    this.door.style.transform='';
  }

  prepare(circuit:CircuitId){
    this.cover('loading');
    this.splash.hidden=false;
    const message=this.local(`正在准备${this.name(circuit)}车库`,`Preparing the ${this.name(circuit)} garage`);
    this.splash.querySelector('p')!.textContent=message;
    this.status.textContent=message;
  }

  choose(preferred:CircuitId):Promise<CircuitId>{
    this.cover('choose');
    this.door.hidden=false;
    this.choices.hidden=false;
    this.door.querySelector('.travel-door-note')!.textContent=this.local('选择第一站，从中国海南儋州出发','Choose your first circuit. Departing from Danzhou, Hainan, China.');
    this.status.textContent=this.local('请选择第一条赛道','Choose your first circuit');
    return new Promise(resolve=>{
      const buttons=(Object.keys(CIRCUITS) as CircuitId[]).map(id=>{
        const button=document.createElement('button');
        button.type='button';
        button.dataset.travelCircuit=id;
        const name=document.createElement('strong');name.textContent=this.name(id);
        const country=document.createElement('span');country.textContent=this.local(CIRCUITS[id].countryZh,englishCountries[id]);
        button.append(name,country);
        button.onclick=()=>{
          buttons.forEach(choice=>{choice.disabled=true;});
          resolve(id);
        };
        return button;
      });
      this.choices.replaceChildren(...buttons);
      this.choices.querySelector<HTMLButtonElement>(`[data-travel-circuit="${preferred}"]`)?.focus({preventScroll:true});
    });
  }

  async journey(circuit:CircuitId,origin:Origin=DANZHOU){
    const to=TRAVEL_DESTINATIONS[circuit];
    this.cover('flight');
    const departure=this.local(origin.name,origin.nameEn);
    const arrival=this.name(circuit);
    const country=this.local(to.country,englishCountries[circuit]);
    this.flight.querySelector('p')!.textContent=`${departure} → ${arrival}`;
    this.flight.querySelector('strong')!.textContent=country;
    this.status.textContent=this.local(`从${departure}飞往${arrival}`,`Flying from ${departure} to ${arrival}`);
    if(!this.quiet){
      this.flight.hidden=false;
      const map=createTravelMap(this.world);
      const language=this.getLanguage();
      await animate(flightDuration(origin),elapsed=>map.paint(origin,to,elapsed,language));
    }

    this.layer.dataset.travelPhase='trace';
    this.route.hidden=false;
    this.route.querySelector('p')!.textContent=this.local('正在准备赛道','Preparing circuit');
    this.route.querySelector('strong')!.textContent=to.title;
    this.route.querySelector('span')!.textContent=this.local(to.locale,country);
    this.route.style.opacity='1';
    if(this.quiet)paintCircuitOutline(this.course,circuit,1);
    else await animate(920,elapsed=>{
      this.route.style.opacity=String(ease(clamp(elapsed/150)));
      paintCircuitOutline(this.course,circuit,clamp((elapsed-100)/820));
    });
    this.flight.hidden=true;
    const preparing=this.local(`正在载入${arrival}车库`,`Loading the ${arrival} garage`);
    this.route.querySelector('p')!.textContent=preparing;
    this.status.textContent=preparing;
  }

  async reveal(circuit:CircuitId,first:boolean){
    if(first&&!this.quiet){
      this.door.hidden=false;
      this.door.querySelector('.travel-door-note')!.textContent=this.local(`${this.name(circuit)}车库已就绪`,`${this.name(circuit)} garage ready`);
      await animate(210,elapsed=>{this.route.style.opacity=String(1-elapsed/210);});
      this.route.hidden=true;
      this.splash.hidden=true;
      this.layer.dataset.travelPhase='garage';
      await animate(1470,elapsed=>{
        this.lamps.forEach((lamp,index)=>lamp.classList.toggle('lit',elapsed>=100+index*183));
        this.door.style.transform=`translate3d(0,${-103*ease(clamp((elapsed-1050)/420))}%,0)`;
      });
    }else if(!this.route.hidden&&!this.quiet){
      this.layer.dataset.travelPhase='reveal';
      await animate(260,elapsed=>{this.route.style.opacity=String(1-ease(elapsed/260));});
    }
    this.hide();
  }

  hide(){
    this.layer.hidden=true;
    this.layer.dataset.travelPhase='ready';
    this.app.inert=false;
  }
}
