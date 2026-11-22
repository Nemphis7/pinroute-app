// The database: rows belong to one owner, version 0.1's store.json moves in once, and the developer can take over
// the trips saved before sign-in. Runs in child processes where a fresh data folder matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STORE = new URL('../src/store.mjs', import.meta.url).href;
const run = (dir, code) => JSON.parse(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
  `const s = await import(${JSON.stringify(STORE)}); const out = await (async () => { ${code} })(); console.log(JSON.stringify(out));`],
{ env: { ...process.env, DATA_DIR: dir, RAILWAY_VOLUME_MOUNT_PATH: '' } }).toString());

test('moves version 0.1\'s store.json in once, as the local owner\'s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinroute-old-'));
  writeFileSync(join(dir, 'store.json'), JSON.stringify({
    trips: { trp_old: { id: 'trp_old', name: 'Plan B', start: '2026-11-14', adults: 2, stops: [{ place: 'Bangkok', nights: 1, iata: 'BKK' }], choices: {}, created: '2026-11-22T14:00:00.000Z', updated: '2026-11-22T14:00:00.000Z' } },
    picks: { 'koh-lanta': [{ name: 'Time for Lime', kind: 'food', why: 'x', source_url: 'https://example.com' }] },
  }));
  const first = run(dir, 'return { trips: s.listTrips(s.LOCAL).map((t) => t.name), picks: s.getPicks(s.LOCAL, "Koh Lanta").length };');
  assert.deepEqual(first, { trips: ['Plan B'], picks: 1 });
  assert.ok(!existsSync(join(dir, 'store.json')) && existsSync(join(dir, 'store.json.imported')), 'the old file is set aside');
  assert.deepEqual(run(dir, 'return s.listTrips(s.LOCAL).length;'), 1, 'not imported twice');
});

test('never lets one owner read, overwrite or delete another\'s trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinroute-own-'));
  const out = run(dir, `
    s.putTrip('ana', { id: 'trp_1', name: 'Ana', start: '2026-12-01', adults: 1, stops: [] });
    let overwrite = 'saved';
    try { s.putTrip('ben', { id: 'trp_1', name: 'Ben', start: '2026-12-01', adults: 1, stops: [] }); } catch { overwrite = 'refused'; }
    return { benSees: s.getTrip('ben', 'trp_1'), overwrite, benDeletes: s.deleteTrip('ben', 'trp_1'), anaName: s.getTrip('ana', 'trp_1').name };`);
  assert.deepEqual(out, { benSees: null, overwrite: 'refused', benDeletes: false, anaName: 'Ana' });
});

test('hands the trips saved before sign-in to the first signed-in person with none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinroute-adopt-'));
  const out = run(dir, `
    s.putTrip(s.LOCAL, { id: 'trp_a', name: 'Plan B', start: '2026-11-14', adults: 2, stops: [] });
    s.mergePicks(s.LOCAL, 'Koh Lanta', [{ name: 'Time for Lime', kind: 'food', why: 'x', source_url: 'https://example.com' }]);
    const moved = s.adoptLocal('user_dev');
    return { moved, again: s.adoptLocal('user_other'), dev: s.listTrips('user_dev').map((t) => t.id), picks: s.getPicks('user_dev', 'Koh Lanta').length, local: s.listTrips(s.LOCAL).length };`);
  assert.deepEqual(out, { moved: 1, again: 0, dev: ['trp_a'], picks: 1, local: 0 });
});

test('counts searches per owner and day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinroute-use-'));
  assert.deepEqual(run(dir, `s.bumpUsage('ana', 'search'); s.bumpUsage('ana', 'search'); s.bumpUsage('ben', 'search');
    return [s.usage('ana', 'search'), s.usage('ben', 'search'), s.usage('cat', 'search')];`), [2, 1, 0]);
});
