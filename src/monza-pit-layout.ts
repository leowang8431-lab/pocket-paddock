/** One placement source for Monza's static buildings and assisted pit stop.
 * The service markings stay fixed while the garage frontage moves inland. */
const apronOffsetX=1.8;
const parkingLocalX=-53;
export const MONZA_PIT_LAYOUT={
  buildingOffsetX:3,
  strategyX:-71.2,
  apronOffsetX,
  parkingLocalX,
  stopX:parkingLocalX+apronOffsetX,
  drivableApron:{minX:-58,maxX:-49.5,minZ:-56,maxZ:108},
  equipmentRetreatX:4.5,
  firstBayZ:-43,
  baySpacing:13.2,
  foundation:{x:-40,z:34,width:26,depth:190},
  village:{x:-14,z:-115},
  gantryZ:98,
} as const;

/** The connected working strip in front of the garages is paved too. */
export function isMonzaPitApron(x:number,z:number):boolean{
  const b=MONZA_PIT_LAYOUT.drivableApron;
  return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;
}

export const MONZA_GARAGE_COLLIDER={
  minX:-49.2+MONZA_PIT_LAYOUT.buildingOffsetX,
  maxX:-30.8+MONZA_PIT_LAYOUT.buildingOffsetX,
  minZ:-50.5,maxZ:114.5,
} as const;
