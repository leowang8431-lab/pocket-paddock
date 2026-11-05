import type {TeamId} from './team-catalog';

/** The miniature Monaco garage row has eight physical bays. The player's
 * selected team receives a branded reserved bay; other circuits keep all of
 * their permanent team garages. Non-base teams use the configurable last bay. */
export const MONACO_PIT_TEAMS:readonly TeamId[]=['mclaren','ferrari','redbull','mercedes','aston','alpine','williams','haas'];
export function monacoPitIndex(team:TeamId):number{
 const index=MONACO_PIT_TEAMS.indexOf(team);return index<0?MONACO_PIT_TEAMS.length-1:index;
}
