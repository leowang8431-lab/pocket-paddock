import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceSession, formatTime, BEST_STORAGE_KEY } from '../src/race.ts';

const track = { length: 240, width: 16, checkpoints: [0, 40, 80, 120, 160, 200] };

function begin(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const session = new RaceSession(track, storage);
  session.start();
  session.update(4.5, 0, 0, 1);
  assert.equal(session.state, 'racing');
  return session;
}

/** Drive the real session API in small forward steps, crossing all checkpoint planes. */
function lap(session: RaceSession, secondsPerStep = 1) {
  for (let distance = 10; distance <= track.length; distance += 10) {
    session.update(secondsPerStep, distance % track.length, 0, 1);
  }
}

test('a complete forward lap records time and persists a best; slower laps retain it', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const session = begin(storage);
  lap(session);
  assert.equal(session.completed, 1);
  assert.equal(session.lap, 2);
  assert.deepEqual(session.result, { time: 24, valid: true, best: true });
  assert.equal(session.elapsed, 0);
  assert.equal(session.best, 24);
  assert.equal(new RaceSession(track, storage).best, 24);

  lap(session, 1.5);
  assert.equal(session.completed, 2);
  assert.deepEqual(session.result, { time: 36, valid: true, best: false });
  assert.equal(session.best, 24);
  assert.equal(new RaceSession(track, storage).best, 24);
});

test('backward travel and repeated finish crossings cannot create a lap', () => {
  const session = begin();
  for (let distance = 230; distance >= 0; distance -= 10) {
    session.update(1, distance, 0, -1);
  }
  for (let i = 0; i < 6; i++) {
    session.update(1, 239, 0, -1);
    session.update(1, 1, 0, 1);
  }
  assert.equal(session.completed, 0);
  assert.equal(session.nextCheckpoint, 1);
  assert.equal(session.best, null);
});

test('jumping over the first checkpoint then driving to the line cannot count', () => {
  const session = begin();
  session.update(1, 55, 0, 1);
  for (let distance = 65; distance < 240; distance += 10) {
    session.update(1, distance, 0, 1);
  }
  session.update(1, 0, 0, 1);
  assert.equal(session.completed, 0);
  assert.equal(session.nextCheckpoint, 1);
  assert.equal(session.best, null);
});

test('nearby checkpoints still require forward vehicle motion', () => {
  const session = begin();
  session.update(1, 20, 0, 1);
  session.update(1, 40, 0, -1);
  assert.equal(session.nextCheckpoint, 1);
  assert.equal(session.completed, 0);
});

test('sustained off-road travel invalidates this lap and the following lap recovers', () => {
  const session = begin();
  session.update(0.7, 0, track.width / 2 + 4, 1);
  assert.equal(session.valid, false);
  lap(session);
  assert.equal(session.completed, 1);
  assert.equal(session.result?.valid, false);
  assert.equal(session.best, null);

  lap(session);
  assert.equal(session.result?.valid, true);
  assert.equal(session.best, 24);
});

test('resetting back onto the circuit invalidates the lap without awarding progress', () => {
  const session = begin();
  session.update(1, 10, 0, 1);
  session.resetPosition(0);
  assert.equal(session.valid, false);
  assert.equal(session.nextCheckpoint, 1);
  lap(session);
  assert.equal(session.result?.valid, false);
  assert.equal(session.result?.best, false);
  assert.equal(session.best, null);
});

test('pause freezes both countdown and lap time; resume restores the prior state', () => {
  const session = new RaceSession(track);
  session.start();
  session.update(2, 0, 0, 1);
  session.pause();
  session.update(30, 0, 0, 1);
  assert.equal(session.state, 'paused');
  assert.equal(session.countdown, 2);
  assert.equal(session.elapsed, 0);
  session.resume();
  assert.equal(session.state, 'countdown');
  session.update(2.5, 0, 0, 1);
  session.update(3, 10, 0, 1);
  session.pause();
  const distance = session.lastDistance;
  session.update(60, 200, 0, 1);
  assert.equal(session.elapsed, 3);
  assert.equal(session.lastDistance, distance);
  session.resume();
  assert.equal(session.state, 'racing');
  session.update(1, 20, 0, 1);
  assert.equal(session.elapsed, 4);
});

test('restart clears a running attempt and retains the saved personal best', () => {
  const session = begin();
  lap(session);
  session.update(3, 10, 0, 1);
  session.invalidate();
  session.start();
  assert.equal(session.state, 'countdown');
  assert.equal(session.elapsed, 0);
  assert.equal(session.lap, 1);
  assert.equal(session.completed, 0);
  assert.equal(session.nextCheckpoint, 1);
  assert.equal(session.valid, true);
  assert.equal(session.result, null);
  assert.equal(session.best, 24);
});

test('unavailable local storage does not prevent racing or retaining an in-memory best', () => {
  const storage = {
    getItem() { throw new Error('Storage disabled'); },
    setItem() { throw new Error('Quota exceeded'); },
  };
  const session = begin(storage);
  assert.equal(session.storageAvailable, false);
  lap(session);
  assert.equal(session.best, 24);
  assert.equal(session.result?.valid, true);
  assert.equal(session.storageAvailable, false);
});

test('a write error is reported even if reading local storage initially succeeded', () => {
  const session = begin({
    getItem() { return null; },
    setItem() { throw new Error('Quota exceeded'); },
  });
  assert.equal(session.storageAvailable, true);
  lap(session);
  assert.equal(session.best, 24);
  assert.equal(session.storageAvailable, false);
});

test('invalid stored times are ignored and a valid stored time is loaded', () => {
  for (const raw of ['NaN', 'Infinity', '-5', '0', 'broken', '']) {
    const session = new RaceSession(track, { getItem: () => raw, setItem() {} });
    assert.equal(session.best, null, `Rejected stored value: ${raw}`);
  }
  assert.equal(new RaceSession(track, { getItem: () => '25.125', setItem() {} }).best, 25.125);
});

test('times display minutes, seconds and three decimal places', () => {
  assert.equal(formatTime(null), '—:——.———');
  assert.equal(formatTime(0), '0:00.000');
  assert.equal(formatTime(65.125), '1:05.125');
});

test('repeated short track cuts accumulate instead of clearing on every re-entry',()=>{
  const session=begin();
  for(let i=0;i<3;i++){session.update(.24,10+i,10.2,1);session.update(.1,11+i,0,1);}
  assert.equal(session.valid,false);
  assert.equal(session.invalidReason,'track-limits');
  assert.equal(session.offroad,0);
  assert.ok(session.totalOffroad>.65);
  lap(session);assert.equal(session.result?.valid,false);
  assert.equal(session.totalOffroad,0);
  lap(session);assert.equal(session.result?.valid,true);
});

test('normal kerb contact and a brief isolated excursion retain a valid lap',()=>{
  const session=begin();session.update(.5,10,9.4,1);session.update(.1,11,10.2,1);session.update(.5,12,0,1);
  assert.equal(session.valid,true);assert.ok(session.totalOffroad<.65);
});

test('new handling records do not import or overwrite old handling records',()=>{
  const data=new Map([['pocket-paddock.monza.v1.best','45']]);
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  const session=begin(storage);assert.equal(session.best,null);lap(session);
  assert.equal(data.get('pocket-paddock.monza.v1.best'),'45');assert.equal(data.get(BEST_STORAGE_KEY),'24');
  assert.equal(new RaceSession(track,storage).best,24);
});
