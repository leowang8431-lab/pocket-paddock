import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {createStandLayouts,createBrakingBoards,distanceToStand,distanceToBounds,standCollider,standLocalBounds,standFootprint} from '../src/stand-layout.ts';

const track=new Track();
const stands=createStandLayouts(track);

test('every spectator front faces the intended road, including the three straight stands',()=>{
  assert.equal(stands.length,7);
  for(const stand of stands){
    const dx=stand.target.x-stand.x,dz=stand.target.z-stand.z;
    const dot=(-Math.sin(stand.yaw)*dx-Math.cos(stand.yaw)*dz)/Math.hypot(dx,dz);
    assert.ok(dot>.999999,`${stand.id} faces the wrong way (${dot})`);
    if(stand.id.startsWith('straight')||stand.id==='centrale')assert.ok(-Math.sin(stand.yaw)>.98);
  }
});

test('viewing directions stay forward from every row and the ends of each tier',()=>{
  for(const stand of stands){
    const c=Math.cos(stand.yaw),s=Math.sin(stand.yaw),front={x:-s,z:-c};
    for(let row=0;row<stand.rows;row++)for(const column of [-stand.width/2+.8,0,stand.width/2-.8]){
      const localZ=row*1.75+.2;
      const x=stand.x+c*column+s*localZ,z=stand.z-s*column+c*localZ;
      const dx=stand.target.x-x,dz=stand.target.z-z;
      assert.ok((front.x*dx+front.z*dz)/Math.hypot(dx,dz)>.5,`${stand.id} row ${row} looks away from the road`);
    }
  }
});

test('complete rotated bases and roof overhangs leave a walkway beyond the guardrail along the whole track',()=>{
  for(const stand of stands){
    let min=Infinity;
    // This finer sampling is independent of the 1600-point authoring pass.
    for(let i=0;i<6000;i++){
      const p=track.sampleAt(i/6000*track.length).point;
      min=Math.min(min,distanceToStand(p.x,p.z,stand));
    }
    assert.ok(min>28.6,`${stand.id} full footprint too close: ${min}`);
    assert.ok(stand.minTrackClearance>=29);
    for(const point of standFootprint(stand))assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z));
  }
});

test('the Alboreto stand is outside the hairpin instead of covering the return straight',()=>{
  const stand=stands.find(s=>s.id==='alboreto')!;
  assert.ok(stand.z>stand.target.z+45);
  assert.ok(stand.minTrackClearance>45);
  const returnStraight=track.samples.filter(s=>s.point.x< -80&&s.point.z>140);
  assert.ok(returnStraight.every(s=>distanceToStand(s.point.x,s.point.z,stand)>track.width/2+10));
});

test('no occupied stand area, including roof corners, overlaps the curved pit lane',()=>{
  for(const stand of stands){
    const b=standLocalBounds(stand),c=Math.cos(stand.yaw),s=Math.sin(stand.yaw);
    for(let x=b.minX;x<=b.maxX;x+=.75)for(let z=b.minZ;z<=b.maxZ;z+=.75){
      const wx=stand.x+c*x+s*z,wz=stand.z-s*x+c*z;
      assert.equal(track.isPitLane(wx,wz),false,`${stand.id} overlaps pit lane`);
    }
  }
});

test('stand collisions come from the same layout and conservative AABBs also remain clear of the road',()=>{
  assert.equal(track.colliders.length,stands.length+2);
  for(const stand of stands){
    const b=standCollider(stand);
    assert.ok(track.colliders.some(c=>c.minX===b.minX&&c.maxX===b.maxX&&c.minZ===b.minZ&&c.maxZ===b.maxZ));
    let min=Infinity;
    for(let i=0;i<6000;i++)min=Math.min(min,distanceToBounds(track.sampleAt(i/6000*track.length).point,b));
    assert.ok(min>26.6,`${stand.id} collider enters the run-off: ${min}`);
  }
});

test('150/100/50 braking references precede corner entry at the HUD distance scale',()=>{
  const boards=createBrakingBoards(track);assert.equal(boards.length,12);
  for(const board of boards){
    const beforeEntry=(board.entryDistance-board.distance+track.length)%track.length;
    assert.ok(Math.abs(beforeEntry-Number(board.label)*.6)<1e-7,board.id);
    const sample=track.sampleAt(board.distance);
    const normal={x:Math.sin(board.yaw),z:Math.cos(board.yaw)};
    assert.ok(normal.x*sample.tangent.x+normal.z*sample.tangent.z<-.999999,`${board.id} faces away from approaching cars`);
    // Check the entire 2.2-wide sign against all road samples, including
    // neighbouring pieces of the circuit, not only its own anchor point.
    for(const along of [-1.1,0,1.1]){
      const x=board.x+Math.cos(board.yaw)*along,z=board.z-Math.sin(board.yaw)*along;
      const near=track.nearest(x,z);
      assert.ok(Math.hypot(x-near.point.x,z-near.point.z)>11.8,`${board.id} enters the curb`);
    }
  }
});
