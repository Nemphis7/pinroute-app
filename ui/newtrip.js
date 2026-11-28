// The new-trip planner. It starts from the traveller's own words ("I want to go to Japan in April"): Claude fills the
// draft from them and the planner moves on to the first step the words leave open. Set up by hand, two ways in:
//   I know when:  When (days off, length, airports) → Where (countries ranked for those months) → Flights (deals)
//   I know where: Country → Best time (weather and fares by month) → Flights
// Both end with "Plan <country> with this flight", which creates the trip from the fare. Fares come from Pinroute's
// own search, behind one Find flights button: recent Aviasales prices and live airline fares.
import { ArrowLeft, ArrowRight, MessageSquare, Plane, ExternalLink, X, Building2, Landmark, Trees, Waves, Search, MapPin, RotateCcw, Check, Sparkles, CalendarDays, Globe } from 'lucide';
import {
  REGIONS, DESTS, INTERESTS, INTEREST_NAME, LENGTHS, MONTHS, MON, destById, windowMonths, seasonFit, fitLabel, rankDests,
  addDays, diffDays, dealPP, dealRatio, dealLabel, dealsFor, dealNights, budgetFit, roughCost, bestMonthsText, nextMonths, monthsToCheck,
} from '../src/discover.mjs';
import { app, ui, call, go, render, showError, tell, ask, waiting, narrow } from './core.js';
import { answerBlock } from './answer.js';
import { h, icon, day, dm, longDay, span, money, nightsTxt, plural, today } from './dom.js';
import { worldSvg, legend } from './world.js';
import { openAirMap } from './airmap.js';
import { openConfirm } from './tripmenu.js';
import { scene, kindOfTags } from './scene.js';

// A country's postcard, from what it is known for
const destArt = (d, w = 400, hgt = 200, sky) => scene(d.name, kindOfTags(d.tags), { w, h: hgt, sky });

const N = { view: null, d: null, homes: [], deals: {}, flights: {}, seq: 0, all: false, sort: 'deal', scan: {}, q: '', air: { q: '', list: [] }, regionsOpen: false, mx: {} };
const ICON = { city: Building2, culture: Landmark, nature: Trees, beach: Waves };
const STEPS = { when: [['when', 'When'], ['where', 'Where'], ['flights', 'Flights']], where: [['country', 'Country'], ['season', 'Best time'], ['flights', 'Flights']] };
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const level = (f) => (f >= 0.85 ? 3 : f >= 0.6 ? 2 : f >= 0.4 ? 1 : 0);

export function takeNew(sc) {
  N.view = sc;
  N.d = { ...sc.draft };
  N.homes = sc.homes || [];
  N.deals = sc.deals || {};
  N.flights = sc.flights || {};
}
export const newState = N;

// ---------------------------------------------------------------- saving the draft
const ARGS = { from: 'free_from', until: 'free_until', minNights: 'min_nights', maxNights: 'max_nights', adults: 'adults', budget: 'budget',
  homes: 'home_airports', regions: 'regions', interests: 'interests', compare: 'compare', country: 'country', way: 'way', step: 'step', wishes: 'wishes', focus: 'focus' };
async function save(patch, line) {
  Object.assign(N.d, patch);
  render();
  const seq = ++N.seq;
  const args = Object.fromEntries(Object.entries(patch).filter(([k, v]) => ARGS[k] && v != null).map(([k, v]) => [ARGS[k], v]));
  try {
    const r = await call('plan_new_trip', args);
    if (seq === N.seq) takeNew(r.structuredContent);
    showError('');
    if (line) tell(line);
  } catch (e) {
    showError(e.message || String(e));
    if (seq === N.seq) await refresh(true);
  }
  render();
}
// Redraws only when the draft changed; a save made while it looked wins over what it found
export async function refresh(quiet) {
  try {
    const seq = N.seq, was = JSON.stringify(N.view);
    const sc = (await call('plan_new_trip', {})).structuredContent;
    if (seq !== N.seq || JSON.stringify(sc) === was) return;
    takeNew(sc); render();
  } catch (e) { if (!quiet) showError(e.message || String(e)); }
}
const goStep = (step) => save({ step });
const months = () => windowMonths(N.d.from, N.d.until);
const monthNames = () => months().map((m) => MONTHS[m]).join(' and ');
const home = () => N.homes[0] || null;
const nightsRange = () => (N.d.minNights === N.d.maxNights ? `${N.d.minNights}` : `${N.d.minNights}–${N.d.maxNights}`);

// ---------------------------------------------------------------- the card in the chat
export function newCard() {
  const d = N.d, target = d.way === 'where' ? destById(d.country) : null;
  const sub = [target && d.step !== 'flights' ? null : `Free ${span(d.from, d.until)}`, `${nightsRange()} nights`, plural(d.adults, 'traveller'),
    N.homes.length ? `from ${N.homes.map((a) => a.code).join(', ')}` : null].filter(Boolean).join(' · ');
  let status;
  if (d.step === 'flights') {
    const best = bestDeal(rowsFor());
    status = best ? `Best deal: ${best.d.name} from ${money(dealPP(best.best), best.best.currency)} per person` : `Comparing ${d.compare.map((id) => destById(id)?.name).join(', ')}`;
  } else if (target) status = `Best months for ${target.name}: ${bestMonthsText(target)}`;
  else if (d.step === 'where') status = `Best for ${monthNames()}: ${rankDests(d, home()).slice(0, 3).map((r) => r.d.name).join(', ')}`;
  else if (d.step === 'prompt') status = d.wishes ? `“${d.wishes}”` : 'Next: tell Claude where you want to go';
  else status = d.way === 'where' ? 'Next: choose the country' : 'Next: where is good then';
  return {
    title: target ? `New trip: ${target.name}` : 'New trip', sub, status,
    eyebrow: d.step === 'flights' ? 'Flight deals' : d.step === 'where' ? 'Where is good then' : d.step === 'season' ? 'Best time' : 'New trip',
    art: target ? { seed: target.name, kind: kindOfTags(target.tags), sky: 'golden' } : { seed: 'New trip', kind: 'beach', sky: 'tropic' },
    side: worldSvg(target ? { mode: 'pick', target: target.id, mini: true } : { months: months(), compare: d.compare, regions: d.regions, mini: true }),
  };
}

// ---------------------------------------------------------------- the step bar (full screen)
export function newSteps() {
  if (N.d.step === 'prompt') return [];
  const list = STEPS[N.d.way] || STEPS.when;
  return [h('ol', { class: 'steps', 'aria-label': N.d.way === 'where' ? 'I know where' : 'I know when' },
    list.map(([id, label], i) => h('li', {}, h('button', { class: 'step', 'aria-current': N.d.step === id ? 'step' : null, onclick: () => goStep(id) },
      h('span', { class: 'n', text: String(i + 1) }), h('span', { class: 'lbl', text: label }))))),
  h('button', { class: `ghost${narrow() ? ' icon' : ''}`, 'aria-label': 'Start over', title: 'Start over', onclick: startOver }, icon(RotateCcw), narrow() ? null : 'Start over')];
}
// A fresh draft: dates, countries, wishes and fares go; the airports and travellers stay
function startOver() {
  openConfirm({
    title: 'Start this new trip over?',
    text: 'The dates, countries, wishes and fares saved for it go. Your departure airports and travellers stay, and your trips are not touched.',
    action: 'Start over',
    run: async () => { N.wish = null; N.scan = {}; N.mx = {}; takeNew((await call('plan_new_trip', { reset: true })).structuredContent); render(); tell('the traveller started the new trip over.'); },
  });
}

// ---------------------------------------------------------------- "What do you have in mind?": a quick chat with Claude
// The traveller says it in their own words ("Indonesia, but only Sulawesi"); Claude sets up the draft from it: countries,
// interests, length, and for part of a country a focus with that area's airports, which the fare look-ups then use.
function wishBox() {
  const text = N.wish ?? N.d.wishes ?? '';
  const focus = Object.entries(N.d.focus || {});
  return h('section', { class: 'wish' },
    h('label', { class: 'wish-l', for: 'wish' }, h('b', { text: 'What do you have in mind?' }), h('span', { class: 'small', text: ' Optional. Claude sets up the planner from it.' })),
    h('textarea', { id: 'wish', rows: 2, maxlength: 500, value: text, placeholder: 'e.g. Indonesia, but only Sulawesi · diving and quiet beaches · no more than two flights inside the country',
      oninput: (e) => { N.wish = e.target.value; const b = document.getElementById('wish-go'); if (b) b.disabled = !e.target.value.trim(); } }),
    focus.length ? h('div', { class: 'chips' }, focus.map(([id, f]) => h('span', { class: 'token' }, h('b', { text: `${destById(id)?.name}: ${f.area}` }), ` ${f.airports.join(', ')}`,
      h('button', { class: 'icon ghost', 'aria-label': `Remove the focus on ${f.area}`, onclick: () => save({ focus: [{ country: id, area: '', airports: [] }] }) }, icon(X))))) : null,
    h('div', { class: 'acts' },
      h('button', { id: 'wish-go', disabled: !text.trim(), onclick: askWishes }, icon(MessageSquare), 'Ask Claude to set this up'),
      waiting.wish ? h('span', { class: 'small busy', text: 'Claude is setting up your trip; the planner follows.' }) : null),
    answerBlock('wish', { poll: refresh }));
}
async function askWishes() {
  const text = (N.wish ?? N.d.wishes ?? '').trim();
  if (!text) return;
  await save({ wishes: text });
  N.wish = null;
  const since = N.d.updated;
  const where = N.d.way === 'where';
  ask('wish', `Here is what I have in mind for my new trip in Pinroute: "${text}". Set up my Pinroute draft to match with save_new_trip_draft (the planner is open and follows): ${where ? 'the country (country)' : 'the countries worth comparing (compare)'}, and the regions, interests, trip length (min_nights, max_nights), dates and travellers if I said them. For a part of a country I named, such as an island or a region, add a focus with its name and its main airports with scheduled flights (IATA codes, busiest first), so Pinroute looks up fares to those airports. Leave my wishes as they are. Then say in two or three lines what you set.`,
    { poll: refresh, done: () => (N.d.updated || '') > (since || ''), tries: 45 });
}

// ---------------------------------------------------------------- From the traveller's words (the usual start)
// The words go to Claude, which fills the draft with save_new_trip_draft; the server then moves the draft on to the
// first step still open, and the planner follows. "I know when" and "I know where" stay here, small, for setting it up by hand.
function promptStep() {
  const text = N.wish ?? N.d.wishes ?? '';
  const send = () => { const t = (N.wish ?? N.d.wishes ?? '').trim(); if (t) askStart(t); };
  return [
    head('Where do you want to go?', 'Say it the way you would tell a friend: where, when, for how long, who is coming. Claude fills in the trip and the planner takes you to the next step.'),
    h('section', { class: 'prompt' },
      h('label', { class: 'sr-only', for: 'words', text: 'Describe your trip' }),
      h('textarea', { id: 'words', rows: 3, maxlength: 500, value: text, placeholder: 'I want to go on a trip to Japan in April for two weeks, cities and some hiking…',
        oninput: (e) => { N.wish = e.target.value; const b = document.getElementById('words-go'); if (b) b.disabled = !e.target.value.trim() || !!waiting.start; },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } }),
      h('div', { class: 'prompt-acts' },
        h('button', { id: 'words-go', class: 'primary', disabled: !text.trim() || !!waiting.start, onclick: send }, icon(Sparkles), waiting.start ? 'Claude is on it…' : 'Plan it with Claude'),
        manualWays())),
    waiting.start ? h('p', { class: 'note busy', text: 'Claude is setting up your trip from your words; the planner moves on by itself.' }) : null,
    answerBlock('start', { poll: refresh }),
  ];
}
function manualWays() {
  const way = (id, ic, title, flow) => h('button', { class: 'way ghost', title: flow, onclick: () => save({ way: id, step: id === 'where' ? 'country' : 'when' }) }, icon(ic), h('span', { text: title }));
  return h('span', { class: 'ways' }, h('span', { class: 'small', text: 'Or set it up yourself:' }),
    way('when', CalendarDays, 'I know when', 'When → Where → Flights'), way('where', Globe, 'I know where', 'Country → Best time → Flights'));
}
function askStart(text) {
  N.wish = null;
  const since = N.d.updated;
  ask('start', `I want to plan a new trip in Pinroute. In my words: "${text}". Set up my Pinroute draft from it with save_new_trip_draft (the planner is open and follows; leave way and step out, so it moves on by itself): the country if I named one, or the countries worth comparing; my free dates (free_from, free_until; a month or season counts as its first and last day) and the trip length (min_nights, max_nights) if I said them; travellers, budget and departure airports if I said them; regions and interests. For a part of a country I named, such as an island or a region, add a focus with its name and its main airports with scheduled flights (IATA codes, busiest first). Leave my wishes as they are. Then say in two or three lines what you set. If my words don't say enough to choose a country or dates, set what they do say and ask me one short question.`,
    { poll: refresh, done: () => (N.d.updated || '') > (since || '') && N.d.step !== 'prompt', tries: 45 });
}
// From the start screen: a fresh draft with the words, then Claude fills it in
export async function startFromWords(text) {
  const r = await go('plan_new_trip', { reset: true, way: 'prompt', wishes: text });
  if (r) askStart(text);
}
export const startPrompt = () => go('plan_new_trip', { way: 'prompt' });

// ---------------------------------------------------------------- the screen
export const newKey = () => `new|${N.d.step}`;
export function newScreen() {
  const step = N.d.step;
  const body = { prompt: promptStep, when: whenStep, where: whereStep, flights: flightsStep, country: countryStep, season: seasonStep }[step] || whenStep;
  const mapFirst = narrow() && (step === 'where' || step === 'country');
  const map = mapPane();
  return h('div', { class: 'nt' },
    mapFirst ? map : null,
    h('div', { class: 'nt-main', id: 'nt-main' }, body()),
    mapFirst || narrow() ? null : map);
}

function mapPane() {
  const d = N.d, pick = d.step === 'country' || d.step === 'season';
  const svg = pick
    ? worldSvg({ mode: 'pick', target: d.country, onPick: (id) => pickCountry(id) })
    : worldSvg({ months: months(), compare: d.compare, regions: d.regions, onPick: d.step === 'when' ? null : toggleCompare });
  return h('aside', { class: 'nt-map' }, svg,
    pick ? h('p', { class: 'small', text: 'Tap a country to choose it.' })
      : [legend(), h('p', { class: 'small', text: `Weather in ${monthNames()}.${d.step === 'when' ? '' : ' Tap a country to compare it.'}` })]);
}

const head = (title, lead) => h('header', { class: 'nt-head' }, h('h2', { text: title }), lead ? h('p', { class: 'meta lead', text: lead }) : null);
const field = (label, control, id) => h('label', { class: 'field', for: id || null }, h('span', { text: label }), control);
const box = (...kids) => h('section', { class: 'box' }, ...kids);
// done: what this step has set, shown with a check beside the way on, once it is enough to go on
function stepNav(back, next, done) {
  return h('nav', { class: 'stepnav' },
    back ? h('button', { class: 'ghost', onclick: back[1] }, icon(ArrowLeft), back[0]) : null,
    done ? h('p', { class: 'stepnav-done' }, icon(Check), h('span', { text: done })) : h('span', { class: 'stepnav-done' }),
    next ? h('button', { class: 'primary', disabled: !!next[2], onclick: next[1] }, next[0], icon(ArrowRight)) : null);
}
function dateInput(id, value, min, onSet) {
  return h('input', { id, type: 'date', value, min, onchange: (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onSet(e.target.value); } });
}
function numInput(id, value, min, max, onSet, extra = {}) {
  return h('input', { id, type: 'number', inputmode: 'numeric', min, max, value: value === '' ? '' : String(value), ...extra,
    onchange: (e) => { const v = parseInt(e.target.value, 10); onSet(Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min); } });
}
const chip = (label, pressed, onclick, ...kids) => h('button', { class: 'chip', 'aria-pressed': String(!!pressed), onclick }, ...kids, label);

function lengthChips() {
  return h('div', { class: 'chips' }, LENGTHS.map(([a, b, l]) => h('button', { class: 'chip', 'aria-pressed': String(N.d.minNights === a && N.d.maxNights === b),
    onclick: () => save({ minNights: a, maxNights: b }) }, l, h('span', { class: 'num', text: `${a}–${b}` }))));
}

// ---------------------------------------------------------------- When
function whenStep() {
  const d = N.d, width = diffDays(d.from, d.until), bad = width < d.minNights;
  return [
    head('When are you free?', 'The days you could be away, how long the trip should be and where you can fly from. Flights are searched for any dates that fit.'),
    wishBox(),
    box(
      h('div', { class: 'grid2' },
        field('Free from', dateInput('w-from', d.from, today(), (v) => save({ from: v, ...(d.until <= v ? { until: addDays(v, Math.max(d.maxNights, 7)) } : {}) })), 'w-from'),
        field('Free until', dateInput('w-until', d.until, addDays(d.from, 1), (v) => save({ until: v })), 'w-until')),
      h('div', { class: 'field' }, h('span', { text: 'Trip length' }), lengthChips()),
      h('div', { class: 'grid2' },
        field('Shortest, nights', numInput('w-min', d.minNights, 1, 60, (v) => save({ minNights: v, ...(d.maxNights < v ? { maxNights: v } : {}) })), 'w-min'),
        field('Longest, nights', numInput('w-max', d.maxNights, 1, 60, (v) => save({ maxNights: v, ...(d.minNights > v ? { minNights: v } : {}) })), 'w-max')),
      bad ? h('p', { class: 'note warn', text: `The window is ${plural(width, 'day')}, shorter than the ${d.minNights} nights you want. Move the last day or shorten the trip.` })
        : h('p', { class: 'meta', text: `Any ${nightsRange()} nights between ${day(d.from)} and ${day(d.until)} · ${months().map((m) => MONTHS[m]).join(', ')}` })),
    box(
      h('div', { class: 'grid2' },
        field('Travellers', numInput('w-adults', d.adults, 1, 9, (v) => save({ adults: v })), 'w-adults'),
        field('Budget for the whole trip, € (optional)', numInput('w-budget', d.budget || '', 0, 1000000, (v) => save({ budget: v }), { step: 100, placeholder: 'e.g. 4000' }), 'w-budget')),
      fromField('w')),
    stepNav(null, ['Next: where is good then', () => goStep('where'), bad], bad ? null : [`Free ${span(d.from, d.until)}`, `${nightsRange()} nights`, plural(d.adults, 'traveller'), N.homes.length ? `from ${N.homes.map((a) => a.code).join(', ')}` : null].filter(Boolean).join(' · ')),
  ];
}

// Departure airports: up to six, the first is the main one (flight times, deal ratings and the quick check use it)
function fromField(p) {
  const list = h('ul', { class: 'ac', id: `${p}-ac`, role: 'listbox', hidden: true });
  const input = h('input', { id: `${p}-air`, type: 'search', placeholder: N.homes.length ? 'Add another airport' : 'City or airport code, e.g. Frankfurt', autocomplete: 'off',
    'aria-controls': `${p}-ac`, value: N.air.q, disabled: N.homes.length >= 6,
    oninput: (e) => findAir(e.target.value, list), onkeydown: (e) => { if (e.key === 'Enter' && N.air.list[0]) { e.preventDefault(); addHome(N.air.list[0]); } if (e.key === 'Escape') list.hidden = true; } });
  return h('div', { class: 'field' },
    h('span', { text: 'Flying from' }),
    N.homes.length ? h('div', { class: 'tokens' }, N.homes.map((a, i) => h('span', { class: 'token' }, h('b', { text: a.code }), ` ${a.city}`, i === 0 && N.homes.length > 1 ? h('span', { class: 'small', text: ' · main' }) : null,
      h('button', { class: 'icon ghost', 'aria-label': `Remove ${a.city} (${a.code})`, onclick: () => save({ homes: N.d.homes.filter((c) => c !== a.code) }) }, icon(X))))) : null,
    h('div', { class: 'airrow' }, h('div', { class: 'acwrap' }, icon(Search), input, list),
      h('button', { disabled: N.homes.length >= 6, onclick: pickOnMap }, icon(MapPin), 'Pick on a map')),
    N.homes.length ? null : h('p', { class: 'small', text: 'Add an airport to see flight times and to search fares.' }));
}
function pickOnMap() {
  openAirMap(N.homes, (list) => {
    const add = list.filter((a) => !N.d.homes.includes(a.code)).slice(0, 6 - N.d.homes.length);
    if (!add.length) { render(); return; }
    N.homes = [...N.homes, ...add.map((a) => ({ code: a.code, city: String(a.city).replace(/\s*\(.*\)\s*$/, ''), country: a.country, lat: a.lat, lon: a.lon }))];
    save({ homes: [...N.d.homes, ...add.map((a) => a.code)] }, `the traveller added ${add.map((a) => a.code).join(', ')} as departure airports.`);
  });
}
let airTimer = null;
function findAir(q, list) {
  N.air.q = q;
  clearTimeout(airTimer);
  if (q.trim().length < 2) { list.hidden = true; return; }
  airTimer = setTimeout(async () => {
    try {
      const r = await call('find_airports', { query: q.trim(), limit: 6 });
      N.air.list = (r.structuredContent?.airports || []).filter((a) => !N.d.homes.includes(a.code));
      list.replaceChildren(...(N.air.list.length ? N.air.list.map((a) => h('li', { role: 'option' }, h('button', { class: 'ghost', onclick: () => addHome(a) },
        h('b', { class: 'code', text: a.code }), h('span', { text: `${a.city} · ${a.name}, ${a.country}` })))) : [h('li', { class: 'small', text: 'No airport matches.' })]));
      list.hidden = false;
    } catch (e) { showError(e.message || String(e)); }
  }, 220);
}
function addHome(a) {
  N.air = { q: '', list: [] };
  N.homes = [...N.homes, { code: a.code, city: String(a.city).replace(/\s*\(.*\)\s*$/, ''), country: a.country, lat: a.lat, lon: a.lon }];
  save({ homes: [...N.d.homes, a.code] }, `the traveller added ${a.code} as a departure airport.`);
}

// ---------------------------------------------------------------- Where
function toggleCompare(id) {
  const c = N.d.compare;
  if (c.includes(id)) return save({ compare: c.filter((x) => x !== id) });
  if (c.length >= 8) { showError('Compare up to 8 countries at a time.'); return null; }
  return save({ compare: [...c, id] });
}

function whereStep() {
  const d = N.d, ranked = rankDests(d, home());
  const shown = N.all ? ranked : ranked.slice(0, 12);
  const ms = months();
  return [
    head('Where is good then?', `Countries ranked by the weather in ${monthNames()}, your interests${home() ? ` and the flight time from ${home().city}` : ''}. Tick up to 8 to compare flights, here or on the map.`),
    box(
      h('details', { class: 'regions-pick', open: N.regionsOpen, ontoggle: (e) => { N.regionsOpen = e.target.open; } },
        h('summary', {}, h('span', { text: 'Regions' }), h('span', { class: 'meta', text: d.regions.length ? d.regions.join(', ') : 'Anywhere' })),
        h('div', { class: 'chips' },
          chip('Anywhere', !d.regions.length, () => save({ regions: [] })),
          REGIONS.map((r) => chip(r, d.regions.includes(r), () => save({ regions: d.regions.includes(r) ? d.regions.filter((x) => x !== r) : [...d.regions, r] }))))),
      h('div', { class: 'field' }, h('span', { text: 'You want' }), h('div', { class: 'chips' },
        INTERESTS.map((t) => chip(INTEREST_NAME[t], d.interests.includes(t), () => save({ interests: d.interests.includes(t) ? d.interests.filter((x) => x !== t) : [...d.interests, t] }), icon(ICON[t])))))),
    h('div', { class: 'acts' },
      h('button', { onclick: askTake }, icon(MessageSquare), 'Ask Claude about these'),
      h('span', { class: 'small', text: waiting.take ? 'Claude is answering; it shows here.' : 'Festivals, crowds and weather caveats for your dates.' })),
    answerBlock('take'),
    d.compare.length ? h('div', { class: 'picked' },
      h('span', { class: 'small', text: `Comparing ${d.compare.length} of 8:` }),
      h('span', { class: 'chips' }, d.compare.map((id) => h('span', { class: 'token' }, h('b', { text: destById(id)?.name || id }),
        h('button', { class: 'icon ghost', 'aria-label': `Remove ${destById(id)?.name || id}`, onclick: () => toggleCompare(id) }, icon(X))))),
      h('button', { class: 'ghost clear-all', onclick: () => save({ compare: [] }, 'the traveller cleared the countries to compare.') }, icon(X), 'Clear all')) : null,
    h('ul', { class: 'dests' }, shown.map((r, i) => destRow(r, i, ms))),
    ranked.length > 12 ? h('button', { class: 'ghost', onclick: () => { N.all = !N.all; render(); } }, N.all ? 'Show the top 12' : `Show all ${ranked.length}`) : null,
    stepNav(['When', () => goStep('when')], [`Next: compare flights (${d.compare.length})`, () => goStep('flights'), !d.compare.length],
      d.compare.length ? d.compare.map((id) => destById(id)?.name).filter(Boolean).join(', ') : null),
  ];
}

function destRow({ d, fit, hours, cost }, i, ms) {
  const on = N.d.compare.includes(d.id), [, fl] = fitLabel(fit), bf = budgetFit(cost, N.d.budget);
  return h('li', {}, h('label', { class: `dest${on ? ' on' : ''}` },
    h('input', { type: 'checkbox', checked: on, 'aria-label': `Compare ${d.name}`, onchange: () => toggleCompare(d.id) }),
    h('span', { class: 'dthumb' }, destArt(d, 160, 160)),
    h('div', { class: 'dbody' },
      h('div', { class: 'dname' }, h('b', { text: d.name }), h('span', { class: 'small', text: d.region }), i < 3 && fit >= 0.6 ? h('span', { class: 'tag', text: 'Top pick' }) : null),
      h('p', { class: 'why', text: d.why }),
      h('div', { class: 'meta-row' },
        h('span', { class: 'fit' }, h('i', { class: `sw f${level(fit)}` }), fl),
        hours ? h('span', { text: `about ${hours} h flight` }) : null,
        bf ? h('span', { class: `bud ${bf[0]}`, title: `Flights about ${money(cost.flights)} and ${money(cost.ground)} on the ground for ${cost.nights} nights`, text: `${bf[1]} · about ${money(cost.total)}` }) : null,
        h('span', { class: 'tags' }, d.tags.map((t) => h('span', { title: INTEREST_NAME[t] }, icon(ICON[t])))))),
    monthStrip(d, ms)));
}
function monthStrip(d, ms) {
  return h('span', { class: 'mstrip', role: 'img', 'aria-label': `${d.name}: best ${bestMonthsText(d)}` },
    d.months.split('').map((c, m) => h('i', { class: `w${c}${ms.includes(m) ? ' in' : ''}`, title: `${MONTHS[m]}: ${c === 'G' ? 'good' : c === 'o' ? 'mixed' : 'poor'} weather` })));
}

function askTake() {
  const d = N.d, top = rankDests(d, home()).slice(0, 8).map((r) => `${r.d.name} (${fitLabel(r.fit)[1].toLowerCase()})`).join(', ');
  const wants = d.interests.length ? `, and we like ${d.interests.map((t) => INTEREST_NAME[t].toLowerCase()).join(', ')}` : '';
  ask('take', `I'm free between ${longDay(d.from)} and ${longDay(d.until)} for ${nightsRange()} nights, ${plural(d.adults, 'traveller')}${home() ? ` flying from ${home().city}` : ''}${wants}. Pinroute ranks these countries by the weather then: ${top}. Which 2 or 3 would you pick for exactly these dates, and why? Think of festivals and holidays, crowds, prices and weather caveats. Keep it short.`);
}

// ---------------------------------------------------------------- Flights
function rowsFor() {
  return N.d.compare.map(destById).filter(Boolean).map((d) => {
    const list = dealsFor(N.deals[d.id], N.d);
    return { d, list, best: list[0] || null, fit: seasonFit(d, months()) };
  });
}
function bestDeal(rows) {
  const done = rows.filter((x) => x.best);
  return done.sort((a, b) => (dealRatio(a.best) ?? 9) - (dealRatio(b.best) ?? 9) || dealPP(a.best) - dealPP(b.best))[0] || null;
}

function flightsStep() {
  const d = N.d, rows = rowsFor();
  const key = { deal: (x) => (x.best ? dealRatio(x.best) ?? dealPP(x.best) / 1000 : 9), price: (x) => (x.best ? dealPP(x.best) : 9e9), weather: (x) => -x.fit };
  rows.sort((a, b) => key[N.sort](a) - key[N.sort](b));
  const top = bestDeal(rows);
  const scanning = rows.some((x) => N.scan[x.d.id] === 'loading');
  const ids = rows.map((x) => x.d.id), off = scanning || !N.homes.length || !rows.length;
  return [
    head('Find a flight deal', `Return flights from ${N.homes.map((a) => a.code).join(' or ') || 'your airport'} for ${nightsRange()} nights between ${dm(d.from)} and ${dm(d.until)}, ${plural(d.adults, 'traveller')}. Choose one to start planning that country.`),
    h('div', { class: 'toolbar' },
      h('div', { class: 'acts' },
        h('button', { class: top ? '' : 'primary', disabled: off, title: findTitle(), onclick: () => findAll(ids) }, icon(Plane), scanning ? 'Searching…' : 'Find flights')),
      h('div', { class: 'sorter', role: 'group', 'aria-label': 'Sort' }, h('span', { class: 'small', text: 'Sort' }),
        [['deal', 'Deal'], ['price', 'Price'], ['weather', 'Weather']].map(([k, l]) => h('button', { 'aria-pressed': String(N.sort === k), onclick: () => { N.sort = k; render(); } }, l)))),
    !N.homes.length ? h('p', { class: 'note warn' }, 'Add a departure airport first. ', h('button', { class: 'link', onclick: () => goStep(d.way === 'where' ? 'season' : 'when') }, 'Add one')) : null,
    top ? bestBanner(top) : null,
    rows.length ? h('div', { class: 'deal-rows' }, rows.map(countryDeals))
      : h('div', { class: 'empty' }, h('p', { text: 'No countries to compare yet.' }), h('button', { onclick: () => goStep(d.way === 'where' ? 'country' : 'where') }, 'Choose countries')),
    h('p', { class: 'small foot', text: `Ratings compare the price per person with a rough guide for the distance, about €120 plus 7 cents a km for a return economy ticket. They point out unusual prices; they are not a forecast. Fares change quickly${N.flights.recent ? '; recent prices are what Aviasales travellers found in the last days, so check them before booking' : ''}.` }),
    N.flights.partnerLinks ? commissionNote() : null,
    stepNav([d.way === 'where' ? 'Best time' : 'Where', () => goStep(d.way === 'where' ? 'season' : 'where')], null),
  ];
}

function bestBanner(x) {
  const dl = dealLabel(dealRatio(x.best));
  return h('section', { class: 'banner art' },
    h('div', { class: 'hero-art' }, destArt(x.d, 900, 220, 'golden')), h('div', { class: 'hero-shade' }),
    h('p', { class: 'eyebrow', text: 'Best deal right now' }),
    h('div', { class: 'bhead' }, h('h3', { text: `${x.d.name} from ${money(dealPP(x.best), x.best.currency)} per person` }), dl ? h('span', { class: `badge ${dl[0]}`, text: dl[1] }) : null),
    h('p', { class: 'meta', text: `${fitLabel(x.fit)[1]} · ${day(x.best.depart)} → ${day(x.best.return)} · ${x.best.airline} · via ${x.best.source}` }),
    h('div', { class: 'acts' }, h('button', { class: 'primary', disabled: ui.busy, onclick: () => startFrom(x.d, x.best) }, `Plan ${x.d.name} with this flight`, icon(ArrowRight))));
}

function countryDeals({ d, list, fit }) {
  const st = N.scan[d.id];
  const [, fl] = fitLabel(fit);
  let body;
  if (list.length) {
    body = [dealItem(d, list[0], true),
      compareBlock(d, list[0]),
      list.length > 1 ? h('details', {}, h('summary', { text: `${plural(list.length - 1, 'more fare')}` }), list.slice(1, 8).map((x) => dealItem(d, x, false))) : null];
  } else if (st === 'loading') body = h('p', { class: 'meta busy', text: 'Checking fares…' });
  else body = h('div', { class: 'acts' }, h('span', { class: 'meta', text: 'No fares yet.' }),
    h('button', { class: 'ghost', disabled: !N.homes.length, title: findTitle(), onclick: () => findAll([d.id]) }, icon(Plane), 'Find flights'));
  return h('article', { class: 'country', id: `deals-${d.id}` },
    h('div', { class: 'c-art' }, destArt(d, 800, 120)),
    h('header', {}, h('div', {}, h('h3', { text: N.d.focus?.[d.id] ? `${d.name}: ${N.d.focus[d.id].area}` : d.name }),
      h('p', { class: 'small', text: N.d.focus?.[d.id] ? `${d.region} · fares to ${N.d.focus[d.id].airports.join(', ')}` : `${d.region} · arrive at ${d.gw} or another airport` })),
      h('span', { class: 'fit' }, h('i', { class: `sw f${level(fit)}` }), fl)),
    st?.error ? h('p', { class: 'note warn', text: st.error }) : null,
    body);
}

// ---------------------------------------------------------------- the same dates from other airports, to other airports
// A table of departure airports (rows) and the country's arrival airports (columns), each switchable; a cell holds the
// cheapest fare per person on that route for the fare's dates. Each route switched on is one search.
function compareBlock(d, x) {
  if (!N.homes.length) return null;
  const arrivals = N.view.arrivals?.[d.id] || [];
  const tos = arrivals.some((a) => a.code === x.to) ? arrivals : [{ code: x.to, city: x.to }, ...arrivals];
  const key = `${x.depart}|${x.return}`;
  let m = N.mx[d.id];
  if (!m || m.key !== key) m = N.mx[d.id] = { open: !!m?.open, key, homes: N.homes.slice(0, 4).map((a) => a.code), tos: [x.to], pick: null };
  m.homes = m.homes.filter((c) => N.homes.some((a) => a.code === c));
  const fares = (N.deals[d.id] || []).filter((y) => y.depart === x.depart && y.return === x.return);
  const cell = (f, t) => fares.filter((y) => y.from === f && y.to === t).sort((a, b) => dealPP(a) - dealPP(b))[0] || null;
  const st = N.scan[`c|${d.id}`];
  const searched = (f, t) => (st?.searched || []).find((r) => r.from === f && r.to === t);
  const cheapest = fares.slice().sort((a, b) => dealPP(a) - dealPP(b))[0] || null;
  const picked = fares.find((y) => y.id === m.pick) || cheapest;
  const routes = m.homes.length * m.tos.length;
  const flip = (list, c) => (list.includes(c) ? list.filter((v) => v !== c) : [...list, c]);
  const head = (a, on, onclick, scope) => h('th', { scope }, h('button', { class: 'mx-h', 'aria-pressed': String(on), title: `${on ? 'Leave out' : 'Include'} ${a.city} (${a.code})`, onclick },
    h('b', { text: a.code }), h('span', { class: 'small', text: a.city })));
  const table = h('div', { class: 'mx-wrap' }, h('table', { class: 'mx' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'small', text: 'From ↓ to →' })),
      tos.map((a) => head(a, m.tos.includes(a.code), () => { m.tos = flip(m.tos, a.code); render(); }, 'col')))),
    h('tbody', {}, N.homes.map((a) => h('tr', {},
      head(a, m.homes.includes(a.code), () => { m.homes = flip(m.homes, a.code); render(); }, 'row'),
      tos.map((t) => {
        const on = m.homes.includes(a.code) && m.tos.includes(t.code), f = cell(a.code, t.code), r = searched(a.code, t.code);
        const text = f ? money(dealPP(f), f.currency) : on && st === 'loading' ? '…' : r ? (r.error ? '!' : 'none') : '';
        return h('td', { class: [on ? '' : 'off', f && f === cheapest ? 'win' : '', f && f === picked ? 'picked' : ''].filter(Boolean).join(' ') },
          f ? h('button', { class: 'mx-c', 'aria-pressed': String(f === picked), title: `${a.code} → ${t.code}: ${money(dealPP(f), f.currency)} per person, ${f.airline}`, onclick: () => { m.pick = f.id; render(); } }, text)
            : h('span', { class: 'mx-c', title: r?.error || (r ? 'No fares on this route' : on ? 'Not searched yet' : 'Switched off'), text }));
      }))))));
  return h('details', { class: 'compare', open: m.open, ontoggle: (e) => { m.open = e.target.open; } },
    h('summary', { text: 'Same dates, other airports' }),
    h('p', { class: 'small', text: `${day(x.depart)} → ${day(x.return)}, per person. Switch airports on or off; each route is one search.` }),
    table,
    picked && picked.id !== x.id ? dealItem(d, picked, false) : null,
    st?.error ? h('p', { class: 'note warn', text: st.error }) : null,
    st?.leftOut?.length ? h('p', { class: 'small', text: `Searched a spread that includes every airport; ${plural(st.leftOut.length, 'route')} left out to save searches. Switch some airports off to compare those.` }) : null,
    h('div', { class: 'acts' },
      h('button', { disabled: !routes || st === 'loading' || N.flights.searchesLeft === 0, onclick: () => compareRoutes(d, x, m) },
        st === 'loading' ? 'Comparing…' : `Compare ${plural(routes, 'route')}`),
      N.flights.searchesLeft != null ? h('span', { class: 'small', text: `${N.flights.searchesLeft} of ${N.flights.searchesPerDay} searches left today` }) : null));
}
async function compareRoutes(d, x, m) {
  N.scan[`c|${d.id}`] = 'loading';
  render();
  try {
    const r = await call('scan_flight_deals', { country: d.id, origins: m.homes, destinations: m.tos, depart: x.depart, return: x.return });
    N.scan[`c|${d.id}`] = { searched: r.structuredContent?.searched || [], leftOut: r.structuredContent?.left_out || [] };
    m.pick = null;
  } catch (e) { N.scan[`c|${d.id}`] = { error: e.message || String(e) }; }
  await refresh(true);
}
function dealItem(d, x, main) {
  const dl = dealLabel(dealRatio(x));
  const cost = N.d.budget ? roughCost(d, { adults: x.adults, nights: dealNights(x), flightTotal: x.price }) : null;
  const bf = cost && budgetFit(cost, N.d.budget);
  return h('div', { class: `deal${main ? ' main' : ''}` },
    h('div', { class: 'dprice' }, h('b', { class: 'pp', text: money(dealPP(x), x.currency) }),
      h('span', { class: 'meta', text: `per person${x.adults > 1 ? ` · ${money(x.price, x.currency)} for ${x.adults}` : ''}` }),
      dl ? h('span', { class: `badge ${dl[0]}`, text: dl[1] }) : null),
    h('p', { class: 'meta', text: `${day(x.depart)} → ${day(x.return)} · ${nightsTxt(dealNights(x))}${x.fits ? '' : ', outside your trip length'} · ${x.from} → ${x.to}${x.back_from && x.back_from !== x.to ? `, home from ${x.back_from}` : ''}` }),
    h('p', { class: 'small', text: [x.airline, x.stops == null ? null : x.stops ? plural(x.stops, 'change') : 'Direct', `via ${x.source}`, x.recent ? 'a recent price, check it before booking' : `checked ${time(x.at)}`].filter(Boolean).join(' · ') }),
    x.out ? h('p', { class: 'small', text: `Out: ${x.out}` }) : null,
    x.back ? h('p', { class: 'small', text: `Back: ${x.back}` }) : null,
    bf ? h('p', { class: `small bud ${bf[0]}`, text: `${bf[1]}: about ${money(cost.total)} with ${money(cost.ground)} on the ground` }) : null,
    h('div', { class: 'acts' },
      h('button', { disabled: ui.busy, onclick: () => startFrom(d, x) }, `Plan ${d.name} with this flight`, icon(ArrowRight)),
      x.link ? h('button', { class: 'ghost', onclick: () => app.openLink({ url: x.link }) }, icon(ExternalLink), x.recent ? 'Check on Aviasales' : 'Booking page') : null,
      x.recent ? null : h('button', { class: 'ghost', onclick: () => openFlightLink({ from: x.from, to: x.to, depart: x.depart, return: x.return, adults: x.adults }) }, icon(ExternalLink), 'Compare on Aviasales')));
}
// One Find flights button, as on a trip's flight legs: Pinroute's own search, recent Aviasales prices from every home
// airport first (when the server has them), then airline fares from the main one.
const findTitle = () => [N.flights.recent ? 'Recent Aviasales prices from each of your airports' : null, N.flights.live ? 'live airline fares' : 'demo fares'].filter(Boolean).join(', then ');
export const commissionNote = () => h('p', { class: 'small foot', text: 'Aviasales links carry Pinroute\'s partner ID: Pinroute may earn a commission on a booking. The price you pay is the same.' });
// A link to compare and book any flight on Aviasales, made on the server (with the partner ID when it has one)
export async function openFlightLink(args) {
  try { const r = await call('flight_link', args); await app.openLink({ url: r.structuredContent.url }); }
  catch (e) { showError(e.message || String(e)); }
}

async function findAll(ids) {
  const origins = N.homes.map((a) => a.code).slice(0, 8);
  ids.forEach((id) => { N.scan[id] = 'loading'; });
  render();
  for (const id of ids) {                           // one country at a time: each scan already runs its dates side by side
    const errors = [];
    if (N.flights.recent) {
      try { await call('scan_flight_deals', { country: id, origins, source: 'recent' }); } catch (e) { errors.push(e.message || String(e)); }
      await refresh(true);
    }
    try { await call('scan_flight_deals', { country: id, source: 'live' }); } catch (e) { errors.push(e.message || String(e)); }
    N.scan[id] = errors.length && !(N.deals[id] || []).length ? { error: errors[0] } : null;
    await refresh(true);
  }
  render();
}

async function startFrom(d, x) {
  const r = await go('start_trip_from_flight', { deal_id: x.id });
  if (r) tell(`the traveller started the trip "${r.structuredContent.trip.name}" (trip_id "${r.structuredContent.trip.id}") from the fare ${x.from} → ${x.to} on ${x.depart}, back ${x.return}, ${money(x.price, x.currency)} for ${x.adults}. Its route is one stop so far.`);
}

// ---------------------------------------------------------------- Country (I know where)
function countryStep() {
  const list = h('div', { class: 'regions', id: 'c-list' }, countryGroups());
  return [
    head('Where do you want to go?', 'Pick the country. Next you see the best months to go and what flights cost in each.'),
    wishBox(),
    h('div', { class: 'acwrap' }, icon(Search), h('input', { id: 'c-q', type: 'search', placeholder: 'Vietnam, Japan, Peru…', value: N.q, autocomplete: 'off', 'aria-label': 'Find a country',
      oninput: (e) => { N.q = e.target.value; list.replaceChildren(...countryGroups()); } })),
    list,
    stepNav(null, [destById(N.d.country) ? `Next: best time for ${destById(N.d.country).name}` : 'Next: best time', () => goStep('season'), !destById(N.d.country)],
      destById(N.d.country) ? `${destById(N.d.country).name} chosen` : null),
  ];
}
function countryGroups() {
  const q = N.q.trim().toLowerCase();
  const list = DESTS.filter((d) => !q || d.name.toLowerCase().includes(q) || d.region.toLowerCase().includes(q));
  const groups = REGIONS.filter((r) => list.some((d) => d.region === r)).map((r) => h('section', { class: 'region' }, h('h3', { text: r }),
    h('div', { class: 'picks-grid' }, list.filter((d) => d.region === r).map((d) => h('button', { class: 'dp', 'aria-pressed': String(N.d.country === d.id), onclick: () => pickCountry(d.id) },
      h('b', { text: d.name }), h('span', { class: 'small', text: `Best ${bestMonthsText(d)}` }))))));
  return groups.length ? groups : [h('p', { class: 'meta', text: 'No country matches. Pinroute has weather and prices for 60 countries so far.' })];
}
const pickCountry = (id) => save({ country: id, step: 'season', way: 'where' }, `the traveller chose ${destById(id)?.name} for a new trip.`);

// ---------------------------------------------------------------- Best time (I know where)
const W = { G: [100, 'Good'], o: [55, 'Mixed'], x: [22, 'Poor'] };
function seasonStep() {
  const d = destById(N.d.country);
  if (!d) return [head('Best time to go'), h('div', { class: 'empty' }, h('p', { text: 'Pick a country first.' }), h('button', { class: 'primary', onclick: () => goStep('country') }, 'Choose a country'))];
  const ms = nextMonths(today()), check = monthsToCheck(d, today());
  const all = N.deals[d.id] || [];
  const cheapest = (mo) => all.filter((x) => x.depart.startsWith(mo.ym)).sort((a, b) => dealPP(a) - dealPP(b))[0] || null;
  const priced = ms.filter(cheapest);
  const byPrice = (a, b) => dealPP(cheapest(a)) - dealPP(cheapest(b));
  const best = priced.filter((mo) => d.months[mo.m] === 'G').sort(byPrice)[0] || priced.filter((mo) => d.months[mo.m] === 'o').sort(byPrice)[0] || null;
  const scanning = check.some((mo) => N.scan[`m|${mo.ym}`] === 'loading') || N.scan[`y|${d.id}`] === 'loading';
  return [
    head(`When is best for ${N.d.focus?.[d.id] ? `${N.d.focus[d.id].area}, ${d.name}` : d.name}?`, `${d.why} Weather by month for the next year, and fares from ${N.homes.map((a) => a.code).join(' or ') || 'your airport'}${N.d.focus?.[d.id] ? ` to ${N.d.focus[d.id].airports[0]}` : ''} for the good months.`),
    h('section', { class: 'months', 'aria-label': 'Weather and fares by month' },
      h('div', { class: 'mgrid' }, ms.map((mo) => {
        const c = d.months[mo.m], x = cheapest(mo), dl = x && dealLabel(dealRatio(x)), st = N.scan[`m|${mo.ym}`];
        return h('button', { class: `mcell${best === mo ? ' sel' : ''}`, 'aria-label': `${MONTHS[mo.m]} ${mo.year}: ${W[c][1].toLowerCase()} weather${x ? `, from ${money(dealPP(x), x.currency)} per person` : ''}`, onclick: () => pickMonth(d, mo) },
          h('span', { class: `mbar w${c}` }, h('span', { style: `height:${W[c][0]}%` })),
          h('span', { class: 'mlbl', text: MON[mo.m] }),
          h('span', { class: 'mprice', text: st === 'loading' || N.scan[`y|${d.id}`] === 'loading' ? '…' : x ? money(dealPP(x), x.currency) : '' }),
          dl && (dl[0] === 'deal3' || dl[0] === 'deal2') ? h('span', { class: 'mdeal', text: 'Deal' }) : h('span', { class: 'mdeal' }));
      })),
      h('p', { class: 'small', text: `Bars show the weather, taller is better; under each month, the cheapest return per person found for ${nightsRange()} nights. Choose a month to see its flights.` })),
    h('div', { class: 'acts' },
      h('button', { class: best ? '' : 'primary', disabled: scanning || !N.homes.length,
        title: `${N.flights.recent ? 'The cheapest recent Aviasales price for each month ahead, then ' : ''}${N.flights.live ? 'live airline fares' : 'demo fares'} in ${check.map((mo) => MON[mo.m]).join(', ')}`,
        onclick: () => findMonths(d, check) }, icon(Plane), scanning ? 'Searching…' : 'Find flights')),
    N.scan[`y|${d.id}`]?.error ? h('p', { class: 'note warn', text: N.scan[`y|${d.id}`].error }) : null,
    ...check.map((mo) => N.scan[`m|${mo.ym}`]?.error ? h('p', { class: 'note warn', text: `${MONTHS[mo.m]}: ${N.scan[`m|${mo.ym}`].error}` }) : null),
    best ? h('section', { class: 'banner art' },
      h('div', { class: 'hero-art' }, destArt(d, 900, 220, 'golden')), h('div', { class: 'hero-shade' }),
      h('p', { class: 'eyebrow', text: 'Cheapest good month' }),
      h('h3', { text: `${MONTHS[best.m]} ${best.year}: from ${money(dealPP(cheapest(best)), cheapest(best).currency)} per person` }),
      h('p', { class: 'meta', text: `${W[d.months[best.m]][1]} weather · ${day(cheapest(best).depart)} → ${day(cheapest(best).return)} · ${cheapest(best).airline}` }),
      h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: () => pickMonth(d, best) }, `See flights in ${MONTHS[best.m]}`, icon(ArrowRight)))) : null,
    box(
      h('div', { class: 'field' }, h('span', { text: 'Trip length' }), lengthChips()),
      h('div', { class: 'grid2' }, field('Travellers', numInput('s-adults', N.d.adults, 1, 9, (v) => save({ adults: v })), 's-adults'), h('span')),
      fromField('s')),
    stepNav(['Country', () => goStep('country')], null),
  ];
}
const pickMonth = (d, mo) => save({ from: mo.from, until: addDays(mo.to, N.d.maxNights), compare: [d.id], step: 'flights' });

async function quickMonths(d, check) {
  check.forEach((mo) => { N.scan[`m|${mo.ym}`] = 'loading'; });
  render();
  for (const mo of check) {
    // back by the month's last day plus the usual trip length, so every departure tried falls inside the month
    const latest = addDays(mo.to, Math.round((N.d.minNights + N.d.maxNights) / 2));
    try { await call('scan_flight_deals', { country: d.id, earliest: mo.from, latest, dates: 2, source: 'live' }); N.scan[`m|${mo.ym}`] = null; }
    catch (e) { N.scan[`m|${mo.ym}`] = { error: e.message || String(e) }; }
    await refresh(true);
  }
  render();
}
async function findMonths(d, check) {
  if (N.flights.recent) await quickYear(d);
  await quickMonths(d, check);
}
// Recent prices: the cheapest fare for every month of the coming year in one look-up
async function quickYear(d) {
  N.scan[`y|${d.id}`] = 'loading';
  render();
  try { await call('scan_flight_deals', { country: d.id, by_month: true }); N.scan[`y|${d.id}`] = null; }
  catch (e) { N.scan[`y|${d.id}`] = { error: e.message || String(e) }; }
  await refresh(true);
}
// Used by the start screen
export const startWay = (way) => go('plan_new_trip', { way, step: way === 'where' ? 'country' : 'when' });
export const continueDraft = () => go('plan_new_trip', {});
