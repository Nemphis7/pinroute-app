// The start screen: the two ways to plan a new trip, the draft to carry on with, and the trips, the one under way
// first. In the chat it is a small card; full screen it is Pinroute's home.
import { CalendarDays, Globe, ArrowRight, Maximize2, Pencil, Trash2, Sparkles } from 'lucide';
import { go, setMode, canFull, isFull, render, call, show } from './core.js';
import { h, icon, span, days, today, plural, nightsTxt } from './dom.js';
import { startWay, continueDraft, startFromWords, startPrompt } from './newtrip.js';
import { openEdit, openDelete } from './tripmenu.js';
import { scene, kindOfTags } from './scene.js';
import { destById } from '../src/discover.mjs';

const H = { view: null, words: '' };
export function takeHome(sc) { H.view = sc; }
export const homeState = H;

const when = (t) => {
  if (t.state === 'now') return t.here ? `Under way · today in ${t.here}` : 'Under way';
  if (t.state === 'done') return 'Done';
  const n = days(today(), t.start);
  return n <= 1 ? 'Starts tomorrow' : n < 14 ? `Starts in ${n} days` : n < 60 ? `Starts in ${Math.round(n / 7)} weeks` : `Starts in ${Math.round(n / 30)} months`;
};
const openTrip = (id) => go('open_planner', { trip_id: id });
const reload = async () => show(await call('open_planner', {}));

export function homeCard() {
  const v = H.view, lead = v.trips[0] && v.trips[0].state !== 'done' ? v.trips[0] : null;
  return {
    title: 'Pinroute',
    sub: v.trips.length ? plural(v.trips.length, 'trip') : 'No trips yet',
    status: lead ? `${lead.name} · ${when(lead)}` : v.draft ? `New trip in progress · free ${span(v.draft.from, v.draft.until)}` : 'Tell Claude where you want to go, and Pinroute plans the trip with you.',
    eyebrow: lead ? when(lead) : null,
    art: { seed: lead ? lead.name : 'Pinroute', kind: 'island', sky: 'golden' },
    side: null,
    actions: [
      h('button', { class: 'primary', onclick: () => (canFull() && !isFull() ? setMode('fullscreen') : render()) }, icon(Maximize2), 'Open Pinroute'),
      h('button', { onclick: startPrompt }, 'Plan a new trip'),
    ],
  };
}

export function homeScreen() {
  const v = H.view, d = v.draft;
  // The other way in, kept small: setting the trip up by hand when the words don't say enough
  const way = (id, ic, title, flow) => h('button', { class: 'way ghost', title: flow, onclick: () => startWay(id) }, icon(ic), h('span', { text: title }));
  const go = () => { const t = H.words.trim(); if (t) { H.words = ''; startFromWords(t); } };
  const dc = d?.country ? destById(d.country) : null;
  return h('div', { class: 'home' },
    h('header', { class: 'home-hero' },
      h('div', { class: 'hero-art' }, scene('Where to next', 'beach', { sky: 'golden', w: 1200, h: 260 })), h('div', { class: 'hero-shade' }),
      h('div', { class: 'home-hero-t' },
        h('span', { class: 'eyebrow', text: v.trips.length ? `${plural(v.trips.length, 'trip')} planned` : 'Pinroute' }),
        h('h2', { text: 'Where to next?' }),
        h('p', { class: 'meta lead', text: 'Say it the way you would tell a friend. Claude fills in the trip, and you pick from there.' }))),
    h('section', { class: 'prompt' },
      h('label', { class: 'sr-only', for: 'start-words', text: 'Describe your trip' }),
      h('textarea', { id: 'start-words', rows: 2, maxlength: 500, value: H.words,
        placeholder: 'I want to go on a trip to Japan in April for two weeks, cities and some hiking…',
        oninput: (e) => { H.words = e.target.value; const b = document.getElementById('start-go'); if (b) b.disabled = !e.target.value.trim(); },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } } }),
      h('div', { class: 'prompt-acts' },
        h('button', { id: 'start-go', class: 'primary', disabled: !H.words.trim(), onclick: go }, icon(Sparkles), 'Plan it with Claude'),
        h('span', { class: 'ways' }, h('span', { class: 'small', text: 'Or set it up yourself:' }),
          way('when', CalendarDays, 'I know when', 'When → Where → Flights'),
          way('where', Globe, 'I know where', 'Country → Best time → Flights')))),
    d ? h('div', { class: 'resume' },
      h('span', { class: 'resume-art' }, scene(dc ? dc.name : 'New trip', dc ? kindOfTags(dc.tags) : 'island', { w: 120, h: 120 })),
      h('div', { class: 'resume-t' }, h('b', { text: d.country ? `New trip: ${d.country}` : 'New trip in progress' }),
        h('p', { class: 'small', text: [`free ${span(d.from, d.until)}`, `${d.minNights}–${d.maxNights} nights`, d.compare.length && !d.country ? `comparing ${d.compare.join(', ')}` : null, d.deals ? plural(d.deals, 'fare') + ' saved' : null].filter(Boolean).join(' · ') })),
      h('button', { class: 'primary', onclick: continueDraft }, 'Continue', icon(ArrowRight))) : null,
    h('div', { class: 'sect-head' }, h('h3', { class: 'sect', text: 'Your trips' }), v.trips.length ? h('span', { class: 'small', text: plural(v.trips.length, 'trip') }) : null),
    v.trips.length ? h('ul', { class: 'trips tiles' }, v.trips.map((t, i) => h('li', { class: `trip-li tile ${t.state}`, style: `animation-delay:${i * 60}ms` },
      h('button', { class: `row trip ${t.state}`, onclick: () => openTrip(t.id) },
        h('span', { class: 'tile-art' }, scene(t.name, 'island', { w: 480, h: 240 })), h('span', { class: 'hero-shade' }),
        h('span', { class: `state ${t.state === 'now' ? 'done' : 'todo'}`, text: when(t) }),
        h('span', { class: 'main' }, h('span', { class: 'place', text: t.name }),
          h('span', { class: 'sub', text: `${span(t.start, t.end)} · ${nightsTxt(days(t.start, t.end))}` }),
          h('span', { class: 'sub places', text: `${t.places.join(', ')}${t.stops > t.places.length ? '…' : ''}` }))),
      h('span', { class: 'row-acts' },
        h('button', { class: 'ghost icon', 'aria-label': `Rename ${t.name}`, title: 'Rename', onclick: () => openEdit({ id: t.id, name: t.name }, reload) }, icon(Pencil)),
        h('button', { class: 'ghost icon', 'aria-label': `Delete ${t.name}`, title: 'Delete', onclick: () => openDelete(t, reload) }, icon(Trash2))))))
      : h('p', { class: 'empty', text: 'No trips yet. Tell Claude about one above, and it ends up here.' }));
}
