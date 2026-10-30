export type CircuitId='monza'|'spa';
export const CIRCUITS={
  monza:{name:'Monza',zh:'蒙扎',country:'ITALIA',countryZh:'意大利',realLength:5793},
  spa:{name:'Spa-Francorchamps',zh:'斯帕',country:'BELGIUM',countryZh:'比利时',realLength:7004},
} as const;
export const isCircuitId=(value:unknown):value is CircuitId=>value==='monza'||value==='spa';
export function circuitRecordKey(circuit:CircuitId,wet:boolean){
  return circuit==='spa'?`pocket-paddock.spa.${wet?'wet.':''}v1.best`:
    wet?'pocket-paddock.monza.wet.v2.best':'pocket-paddock.monza.v3.best';
}
