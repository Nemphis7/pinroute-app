// "I already have my flight": for travellers who booked their flight themselves. They paste the booking confirmation
// (or type the flight numbers) and Claude reads it, or they fill in the flight here. Pinroute then skips the flight
// search, marks the flight booked and plans the trip around its times (add_booked_flight on the server).
import { Check, ClipboardPaste, X } from 'lucide';
import { ui, waiting, render } from './core.js';
import { h, icon, day } from './dom.js';

// key → { open, text, out: {…}, back: {…}, ref }; kept between renders so what was typed stays
const F = {};
const state = (key) => (F[key] ||= { open: false, text: '', out: {}, back: {}, ref: '', err: '' });
export const ownOpen = (key) => !!F[key]?.open;
export const openOwn = (key, open = true) => { state(key).open = open; render(); };

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const CODE = /^[A-Za-z]{3}$/;

// The low-key way in: a quiet link under the search
export const ownLink = (key, label = 'I already have my flight') =>
  h('button', { class: 'link own-link', 'aria-expanded': String(ownOpen(key)), onclick: () => openOwn(key, !ownOpen(key)) }, label);

// One flight's fields. fixed: { from, to } that can't change (a leg of the route); date: the day to start from
function flightFields(key, side, title, { fixed, date, optional } = {}) {
  const f = state(key)[side];
  if (fixed) Object.assign(f, { from: fixed.from, to: fixed.to });
  if (date && !f.date) f.date = date;
  const set = (k, up) => (e) => { f[k] = up ? e.target.value.toUpperCase() : e.target.value; };
  const id = (k) => `own-${key.replace(/[^\w]/g, '-')}-${side}-${k}`;
  const field = (k, label, input) => h('label', { class: 'field', for: id(k) }, h('span', { text: label }), input);
  return h('fieldset', { class: 'own-flight' },
    h('legend', {}, h('b', { text: title }), optional ? h('span', { class: 'small', text: ' optional' }) : null,
      fixed ? h('span', { class: 'small', text: ` ${fixed.from} → ${fixed.to}` }) : null),
    h('div', { class: 'own-grid' },
      field('number', 'Flight number', h('input', { type: 'text', id: id('number'), class: 'code-in', value: f.number || '', placeholder: 'LH 772', maxlength: 40, autocomplete: 'off', oninput: set('number', true) })),
      fixed ? null : field('from', 'From', h('input', { type: 'text', id: id('from'), class: 'code-in', value: f.from || '', placeholder: 'FRA', maxlength: 3, autocomplete: 'off', oninput: set('from', true) })),
      fixed ? null : field('to', 'To', h('input', { type: 'text', id: id('to'), class: 'code-in', value: f.to || '', placeholder: 'BKK', maxlength: 3, autocomplete: 'off', oninput: set('to', true) })),
      field('date', 'Leaves on', h('input', { type: 'date', id: id('date'), value: f.date || '', oninput: set('date') })),
      field('departs', 'Departs', h('input', { type: 'time', id: id('departs'), value: f.departs || '', oninput: set('departs') })),
      field('arrives', 'Lands', h('input', { type: 'time', id: id('arrives'), value: f.arrives || '', oninput: set('arrives') })),
      field('plus', 'Lands on', h('select', { id: id('plus'), onchange: (e) => { f.plus = Number(e.target.value); } },
        [[0, 'Same day'], [1, 'Next day'], [2, '2 days later']].map(([v, l]) => h('option', { value: String(v), selected: (f.plus || 0) === v }, l))))));
}

// A flight as add_booked_flight takes it, or null when it is left empty; an error when it is half filled in
function flightArg(f) {
  const any = ['number', 'from', 'to', 'date', 'departs', 'arrives'].some((k) => String(f[k] || '').trim());
  if (!any) return null;
  if (!CODE.test(f.from || '') || !CODE.test(f.to || '')) return { error: 'Give both airports as 3-letter codes, such as FRA or BKK.' };
  if (!f.date) return { error: 'Give the day the flight leaves.' };
  return {
    from: f.from.toUpperCase(), to: f.to.toUpperCase(), date: f.date,
    ...(f.departs ? { departs: f.departs } : {}), ...(f.arrives ? { arrives: f.arrives } : {}),
    ...(f.plus ? { arrive_date: addDays(f.date, f.plus) } : {}),
    ...(f.number?.trim() ? { number: f.number.trim() } : {}),
  };
}

// The panel. mode 'trip': a new trip from the booked flights (out and home). mode 'leg': one flight for a leg.
//   ask(text): asks Claude to read a pasted booking; save(args): saves what was filled in (add_booked_flight's args)
export function ownPanel(key, { mode, leg, intro, ask: askClaude, save }) {
  const st = state(key);
  if (!st.open) return null;
  const busy = !!waiting[`own|${key}`];
  const submit = async () => {
    st.err = '';
    const out = flightArg(st.out), back = mode === 'trip' ? flightArg(st.back) : null;
    const bad = [out, back].find((x) => x?.error);
    if (bad) { st.err = bad.error; render(); return; }
    if (!out && !(mode === 'trip' && back)) { st.err = mode === 'trip' ? 'Fill in the flight out, or paste your booking above.' : 'Fill in the flight, or paste your booking above.'; render(); return; }
    if (mode === 'trip' && !out) { st.err = 'Fill in the flight out too.'; render(); return; }
    if (mode === 'trip' && !back) { st.err = 'Fill in the flight home too. Only one way booked? Paste it above and tell Claude how long you stay.'; render(); return; }
    const args = { ...(mode === 'trip' ? { out, back } : { out }), ...(st.ref.trim() ? { booking_ref: st.ref.trim() } : {}) };
    const r = await save(args);
    if (r) { F[key] = undefined; render(); }
  };
  const read = () => {
    const t = st.text.trim();
    if (!t) { st.err = 'Paste your booking confirmation or type the flight numbers first.'; render(); return; }
    st.err = '';
    askClaude(t, `own|${key}`);
  };
  const legDate = leg?.date;
  return h('section', { class: 'own box', 'aria-label': 'Your booked flight' },
    h('div', { class: 'own-head' },
      h('div', {}, h('h3', { text: mode === 'trip' ? 'Start from the flights you booked' : 'Add the flight you booked' }),
        h('p', { class: 'small', text: intro || 'Paste your booking confirmation, or just the flight numbers and dates. Claude reads it, Pinroute skips the flight search, marks the flight booked and plans around its times.' })),
      h('button', { class: 'ghost icon', 'aria-label': 'Close', title: 'Close', onclick: () => openOwn(key, false) }, icon(X))),
    h('label', { class: 'sr-only', for: `own-text-${key.replace(/[^\w]/g, '-')}`, text: 'Your booking' }),
    h('textarea', { id: `own-text-${key.replace(/[^\w]/g, '-')}`, rows: 3, maxlength: 4000, value: st.text,
      placeholder: mode === 'trip' ? 'e.g. LH 772 Frankfurt–Bangkok on 3 March, back TG 920 on 17 March, ref XK7P2Q' : `e.g. ${leg?.from || 'BKK'}–${leg?.to || 'HKT'} FD 3025 at 10:40${legDate ? ` on ${day(legDate)}` : ''}`,
      oninput: (e) => { st.text = e.target.value; } }),
    h('div', { class: 'acts' },
      h('button', { class: 'primary', disabled: busy || ui.busy, onclick: read }, icon(ClipboardPaste), busy ? 'Claude is reading it…' : 'Read it with Claude')),
    busy ? h('p', { class: 'note busy', text: 'Claude is reading your booking; your flights show here once saved.' }) : null,
    h('details', { class: 'own-manual', open: st.manual || null, ontoggle: (e) => { st.manual = e.target.open; } },
      h('summary', { text: 'Or fill it in yourself' }),
      flightFields(key, 'out', mode === 'trip' ? 'Flight out' : 'Your flight', mode === 'leg' ? { fixed: { from: leg.from, to: leg.to }, date: legDate } : {}),
      mode === 'trip' ? flightFields(key, 'back', 'Flight home') : null,
      h('label', { class: 'field own-ref', for: `own-ref-${key.replace(/[^\w]/g, '-')}` }, h('span', { text: 'Booking reference' }),
        h('input', { type: 'text', id: `own-ref-${key.replace(/[^\w]/g, '-')}`, value: st.ref, placeholder: 'Optional', maxlength: 40, autocomplete: 'off', oninput: (e) => { st.ref = e.target.value; } })),
      h('p', { class: 'small', text: 'Times as on your ticket, local at each airport.' }),
      h('div', { class: 'acts' }, h('button', { disabled: ui.busy, onclick: submit }, icon(Check), mode === 'trip' ? 'Plan around these flights' : 'Save as booked'))),
    st.err ? h('p', { class: 'note warn', role: 'alert', text: st.err }) : null);
}
export const clearOwn = (key) => { F[key] = undefined; };
