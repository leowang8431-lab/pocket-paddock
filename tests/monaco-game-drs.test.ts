import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {createMonacoDrsZones,DrsController,withinZone} from '../src/drs.ts';

test('Monaco has one functional 2025-reference DRS zone across the finish straight',()=>{
 const track=new Track('monaco'),zones=createMonacoDrsZones(track),zone=zones[0],scale=track.length/3337;
 assert.equal(zones.length,1);assert.ok(Math.abs(zone.detection-track.corners[15].distance-80*scale)<1e-8);assert.ok(Math.abs(zone.start-track.corners[18].distance-18*scale)<1e-8);
 assert.equal(withinZone(0,zone,track.length),true);assert.equal(withinZone(track.corners[0].distance,zone,track.length),false);
 const controller=new DrsController(zones,track.length,3337),context={state:'racing' as const,weather:'sunny' as const,distance:0,speed:20,brake:0,onRoad:true,pitLane:false,forward:1,collision:0};
 assert.equal(controller.update(context).available,true);assert.equal(controller.toggle(),true);assert.equal(controller.update(context).active,true);
 assert.equal(controller.update({...context,brake:1}).active,false);assert.equal(controller.update({...context,weather:'rainy'}).available,false);assert.equal(controller.update({...context,pitLane:true}).available,false);
});
