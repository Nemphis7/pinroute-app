import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlace, repairStop } from '../src/geo.mjs';

test('a stop whose name only contains a Thai place is not taken for it', () => {
  // "Favignana" holds "nan": it once drew a Sicily route out to Nan, in northern Thailand
  const f = resolvePlace('Favignana', 'TPS', { lat: 37.93, lon: 12.33, island: true });
  assert.equal(f.placeId, null);
  assert.deepEqual([f.lat, f.lon, f.iata], [37.93, 12.33, 'TPS']);
  assert.equal(resolvePlace('Favignana').placeId, null);
  assert.equal(resolvePlace('Paisley').placeId, null);
  // Thai places still match by name and by their words
  assert.equal(resolvePlace('Nan').placeId, 'nan');
  assert.equal(resolvePlace('Pai').placeId, 'pai');
  assert.equal(resolvePlace('Khao Sok').placeId, 'khao-sok');
  assert.equal(resolvePlace('Koh Lanta Yai').placeId, 'koh-lanta');
  assert.equal(resolvePlace('Railay').placeId, 'ao-nang');
});

test('a position or airport far from the Thai place of that name wins', () => {
  const far = resolvePlace('Pai', null, { lat: 40, lon: -3 });
  assert.equal(far.placeId, null);
  assert.equal(far.lat, 40);
  assert.equal(resolvePlace('Nan', 'PMO').placeId, null);
  assert.equal(resolvePlace('Chiang Mai', 'CNX', { lat: 18.79, lon: 98.98 }).placeId, 'chiang-mai');
});

test('a stop saved with the old loose match goes back near its own airport', () => {
  const s = repairStop({ place: 'Favignana', placeId: 'nan', region: 'North', lat: 18.78, lon: 100.77, iata: 'PMO', nights: 3 });
  assert.equal(s.placeId, null);
  assert.equal(s.iata, 'PMO');
  assert.ok(Math.abs(s.lat - 38.2) < 0.5 && Math.abs(s.lon - 13.1) < 0.5);
  assert.equal(s.nights, 3);
  const lost = repairStop({ place: 'Favignana', placeId: 'nan', lat: 18.78, lon: 100.77, iata: 'NNT' });
  assert.deepEqual([lost.lat, lost.lon, lost.iata], [null, null, null]);
  const kept = { place: 'Koh Lanta', placeId: 'koh-lanta', lat: 7.62, lon: 99.05, iata: 'KBV' };
  assert.equal(repairStop(kept), kept);
});
