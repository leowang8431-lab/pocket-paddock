export type CircuitId='monza'|'spa'|'monaco';
export const CIRCUITS={
  monza:{name:'Monza',zh:'蒙扎',country:'ITALIA',countryZh:'意大利',realLength:5793,raceLaps:8,code:'MONZA',heading:'MONZA',kicker:'THE TEMPLE OF SPEED',kindZh:'艺术化短赛道',locationEn:'Italy · Miniature circuit'},
  spa:{name:'Spa-Francorchamps',zh:'斯帕',country:'BELGIUM',countryZh:'比利时',realLength:7004,raceLaps:5,code:'SPA',heading:'SPA-FRANCORCHAMPS',kicker:'THE ARDENNES CHALLENGE',kindZh:'起伏山地赛道',locationEn:'Belgium · Hills and forest'},
  monaco:{name:'Monaco',zh:'摩纳哥',country:'MONACO',countryZh:'摩纳哥',realLength:3337,raceLaps:5,code:'MONACO',heading:'MONTE-CARLO',kicker:'THE STREETS OF THE PRINCIPALITY',kindZh:'港湾城市街道赛',locationEn:'Monaco · Harbour street circuit'},
} as const;
export const isCircuitId=(value:unknown):value is CircuitId=>typeof value==='string'&&Object.hasOwn(CIRCUITS,value);
export function circuitRecordKey(circuit:CircuitId,wet:boolean){
  if(circuit==='monza')return wet?'pocket-paddock.monza.wet.v2.best':'pocket-paddock.monza.v3.best';
  return `pocket-paddock.${circuit}.${wet?'wet.':''}v1.best`;
}
