import type {Object3D} from 'three';

/** Authored miniature height boost. Horizontal footprints and driving geometry
 * remain unchanged. Apply only to building roots, before scenery batching. */
export const ARCHITECTURE_HEIGHT_SCALE=1.25;

export function scaleArchitectureHeight<T extends Object3D>(building:T):T {
  if(building.userData.architectureHeightScale===ARCHITECTURE_HEIGHT_SCALE)return building;
  building.scale.y*=ARCHITECTURE_HEIGHT_SCALE;
  building.userData.architectureHeightScale=ARCHITECTURE_HEIGHT_SCALE;
  return building;
}
