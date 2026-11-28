// The plan for a stay: kept picks spread over its days, each where its kind suits, and a pick the traveller put on a
// day staying there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDays } from '../ui/days.js';

const stop = { arrive: '2027-06-19', depart: '2027-06-22', nights: 3 };
const pick = (name, kind, extra = {}) => ({ name, kind, why: 'x', source_url: 'https://example.com', status: 'keep', ...extra });
const where = (days) => Object.fromEntries(days.flatMap((d) => ['morning', 'afternoon', 'evening'].flatMap((s) => d.slots[s].map((p) => [p.name, `${d.date} ${s}`]))));

test('a day per date of the stay: the arrival from the afternoon, the leaving day a morning', () => {
  const days = planDays(stop, [], { next: 'Favignana' });
  assert.deepEqual(days.map((d) => [d.date, d.open.join(','), d.tag]), [
    ['2027-06-19', 'afternoon,evening', 'Arrive'], ['2027-06-20', 'morning,afternoon,evening', null],
    ['2027-06-21', 'morning,afternoon,evening', null], ['2027-06-22', 'morning', 'Leave for Favignana']]);
  assert.equal(planDays({ ...stop, nights: 0 }, []), null, 'no plan for a stop passed through');
});

test('only kept picks, each where its kind suits, two dinners never on one day', () => {
  const days = planDays(stop, [
    pick('Calvino', 'food'), pick('Salt pans', 'activity'), pick('Cantina', 'food'), pick('San Giuliano', 'beach'),
    pick('Aperitivo', 'drink'), pick('Skipped one', 'food', { status: 'skip' }), pick('Undecided', 'view', { status: undefined }), pick('Hotel', 'stay')]);
  const w = where(days);
  assert.deepEqual(Object.keys(w).sort(), ['Aperitivo', 'Calvino', 'Cantina', 'Salt pans', 'San Giuliano']);
  assert.match(w.Calvino, /evening$/); assert.match(w.Cantina, /evening$/); assert.match(w['Salt pans'], /morning$/);
  assert.match(w['San Giuliano'], /afternoon$/); assert.match(w.Aperitivo, /evening$/);
  assert.notEqual(w.Calvino.slice(0, 10), w.Cantina.slice(0, 10));
  assert.deepEqual(where(planDays(stop, [pick('Calvino', 'food'), pick('Salt pans', 'activity'), pick('Cantina', 'food'), pick('San Giuliano', 'beach'), pick('Aperitivo', 'drink')])), w, 'the same picks land the same way');
});

test('a pick the traveller put on a day stays there; a day outside the stay is ignored', () => {
  const w = where(planDays(stop, [pick('Calvino', 'food', { date: '2027-06-21', slot: 'afternoon' }), pick('Erice', 'view', { date: '2027-06-20' }), pick('Old', 'food', { date: '2026-01-01' })]));
  assert.equal(w.Calvino, '2027-06-21 afternoon');
  assert.equal(w.Erice, '2027-06-20 evening', 'its day kept, the part of the day its kind suits');
  assert.ok(w.Old && !w.Old.startsWith('2026'));
});
