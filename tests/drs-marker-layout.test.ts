import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {createMonzaDrsZones} from '../src/drs.ts';
import {createDrsSignLayouts} from '../src/drs-markers.ts';

test('Rettifilo opening board sits fully on the driver-left grass, clear of both roads',()=>{
  const track=new Track(),zones=createMonzaDrsZones(track),signs=createDrsSignLayouts(track,zones);
  assert.equal(signs.length,6);
  const board=signs.find(s=>s.zone===2&&s.atlasRow===1)!;
  assert.equal(board.distance,zones[1].start,'only the roadside position changes, not the DRS activation point');
  assert.ok(board.offset>0);
  assert.ok(board.position.x<board.sample.point.x,'at the northbound finish straight the left verge is west');
  assert.ok(board.position.x+1.6<-99-.325-1,'the full opening board clears the gantry support by at least one unit');
  for(const edge of [-1.6,0,1.6]){
    const p=board.position.clone().addScaledVector(board.sample.right,edge),nearest=track.nearest(p.x,p.z);
    assert.ok(Math.hypot(p.x-nearest.point.x,p.z-nearest.point.z)>track.widthAt(nearest.distance)/2+4,'the full board must clear the curb and asphalt');
    assert.equal(track.isPitLane(p.x,p.z),false);
  }
  const detector=signs.find(s=>s.zone===2&&s.atlasRow===2)!;
  assert.ok(detector.offset>0,'retain the previously moved detection board');
});
