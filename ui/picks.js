// What to do at a stop: the local picks Claude researched and the tours found there, one card at a time to keep or
// skip (a swipe, the two round buttons, or the arrow keys), and the ones kept arranged into the days of the stay:
// morning, afternoon and evening, the arrival day from the afternoon, the leaving day a morning. A pick the traveller
// moves to another day or part of the day stays there (plan_local_picks); the rest follow Pinroute's arrangement.
import { X, Check, Undo2, Sunrise, Sun, Moon, ExternalLink, Ticket, Star, Sparkles, MessageSquare, CalendarDays, Utensils, Wine, Umbrella, Mountain, Compass, BedDouble, ShoppingBag, PlaneLanding, Luggage, Trash2 } from 'lucide';
import { app, textOf, showError, tell, waiting } from './core.js';
import { answerBlock } from './answer.js';
import { h, icon, day, money } from './dom.js';
import { scene } from './scene.js';
import { SLOTS, planDays } from './days.js';

export const KIND = { food: 'Food', drink: 'Drinks', beach: 'Beach', view: 'View', activity: 'Activity', stay: 'Stay', shop: 'Shopping', other: 'Other' };
export const KIND_ICON = { food: Utensils, drink: Wine, beach: Umbrella, view: Mountain, activity: Compass, stay: BedDouble, shop: ShoppingBag, other: Sparkles };
const SCENE = { food: 'city', drink: 'city', shop: 'city', stay: 'city', beach: 'beach', view: 'nature', activity: 'island', other: 'nature' };
const SKY = { food: 'golden', drink: 'dusk', shop: 'morning', stay: 'golden', beach: 'tropic', view: 'dusk', activity: 'tropic', other: 'morning' };

const SLOT = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const SLOT_ICON = { morning: Sunrise, afternoon: Sun, evening: Moon };
const lc = (s) => String(s || '').toLowerCase();

// ---------------------------------------------------------------- the section on a stop
let C = null;                  // the planner's hooks: { view, render, refresh, askPicks, findTours, tourState, skeleton }
export const initPicks = (ctx) => { C = ctx; };

const deck = {};               // place → { last: the last choice, to undo: { name, tour } }
let editing = null;            // `${place}|${name}` of the plan opened to move
const saving = new Set();

// What is still to decide at a stop: undecided picks first, then tours not kept or skipped
function toDecide(x) {
  const picks = C.view().picks[x.place] || [];
  const have = new Set(picks.map((p) => lc(p.name)));
  const t = C.tourState(x);
  const tours = (t.list || []).filter((a) => !have.has(lc(a.title)) && !(t.skipped || []).includes(a.title));
  return [...picks.filter((p) => !p.status).map((p) => ({ type: 'pick', name: p.name, p })),
    ...tours.map((a) => ({ type: 'tour', name: a.title, a }))];
}

export function picksSection(x) {
  const V = C.view();
  const picks = V.picks[x.place] || [];
  const queue = toDecide(x);
  const kept = picks.filter((p) => p.status === 'keep');
  const skipped = picks.filter((p) => p.status === 'skip');
  const t = C.tourState(x);
  const researching = waiting[`picks|${x.place}`];
  const nextStop = V.stops[x.index + 1]?.place || null;
  const days = kept.length ? planDays(x, picks, { next: nextStop }) : null;
  const deckEl = queue.length ? deckBlock(x, queue, picks.length + (t.list?.length || 0)) : null;
  const plan = days ? daysBlock(x, days, kept) : kept.length && !x.nights ? keptList(x, kept) : null;
  return [
    deckEl,
    !queue.length && picks.length && !researching ? doneBlock(x, kept, skipped) : null,
    !picks.length && !queue.length && !researching && t.state !== 'loading' ? h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h3', { text: `Things to do in ${x.place}` })),
      h('div', { class: 'empty-state' }, h('span', { class: 'kind-ic' }, icon(Sparkles)),
        h('p', { class: 'meta', text: `Nothing here yet. Claude can look through recent Reddit threads, Instagram posts and travel blogs for the places locals love${V.activities?.on ? ', and Pinroute can find tours' : ''}. You then keep or skip each one, and the ones you keep become a plan for your days here.` })),
      h('div', { class: 'acts' }, askBtn(x, picks, true), V.activities?.on ? toursBtn(x, t) : null)) : null,
    researching ? C.skeleton(`Claude is researching picks for ${x.place}`) : null,
    t.state === 'loading' ? C.skeleton(`Finding tours in ${x.place}`, 2) : null,
    t.state === 'error' ? h('p', { class: 'note warn', text: t.error }) : null,
    t.state === 'done' && !t.list.length ? h('p', { class: 'meta', text: `No tours found around ${x.place}.` }) : null,
    answerBlock(`picks|${x.place}`, { poll: C.refresh }),
    plan,
    skipped.length ? skippedBlock(x, skipped) : null,
    t.more?.length ? h('p', { class: 'small' }, `More tours in ${x.place}: `, t.more.flatMap((l, j) => [j ? ' · ' : '', h('button', { class: 'link', text: l.site, onclick: () => app.openLink({ url: l.url }) })])) : null,
    t.state === 'done' && V.activities?.partnerLinks ? h('p', { class: 'small foot', text: 'GetYourGuide and Klook links carry Pinroute\'s partner ID: Pinroute may earn a commission on a booking. The price you pay is the same.' }) : null,
  ];
}

const askBtn = (x, picks, primary) => h('button', { class: primary ? 'primary' : '', onclick: () => C.askPicks(x) }, icon(MessageSquare), picks.length ? 'Ask Claude for more' : 'Ask Claude for local picks');
const toursBtn = (x, t) => (t.state === 'loading' ? null : h('button', { class: '', onclick: () => C.findTours(x) }, icon(Ticket), t.list ? 'More tours' : `Find tours in ${x.place}`));

// ---- the deck: the next card on top, two peeking behind
function deckBlock(x, queue, total) {
  const d = deck[x.place] || (deck[x.place] = {});
  const done = Math.max(0, total - queue.length);
  const top = queue[0];
  return h('section', { class: 'block pickdeck' },
    h('div', { class: 'block-head' }, h('h3', { text: `Pick what you like in ${x.place}` }),
      h('span', { class: 'small', text: `${queue.length} to go` })),
    h('div', { class: 'deck-bar', role: 'progressbar', 'aria-label': 'Decided', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
      h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
    h('div', { class: 'deck' }, queue.slice(0, 3).reverse().map((it, j, arr) => card(x, it, arr.length - 1 - j))),
    h('div', { class: 'deck-acts' },
      h('button', { class: 'round no', 'aria-label': `Skip ${top.name}`, title: 'Skip (←)', disabled: saving.has(x.place), onclick: () => fly(x, top, 'skip') }, icon(X)),
      d.last ? h('button', { class: 'round undo', 'aria-label': `Undo: ${d.last.name}`, title: 'Undo', onclick: () => undo(x) }, icon(Undo2)) : h('span', { class: 'round-gap' }),
      h('button', { class: 'round yes', 'aria-label': `Keep ${top.name}`, title: 'Keep (→)', disabled: saving.has(x.place), onclick: () => fly(x, top, 'keep') }, icon(Check))),
    h('p', { class: 'small deck-hint', text: 'Swipe right to keep, left to skip' }),
    C.view().activities?.on && !C.tourState(x).list && C.tourState(x).state !== 'loading' ? h('div', { class: 'acts deck-more' }, toursBtn(x, C.tourState(x))) : null);
}

function poster(it, w = 480, ht = 200) {
  if (it.type === 'tour' && it.a.image) {
    return h('div', { class: 'poster' }, h('img', { src: it.a.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false',
      onerror: (e) => e.currentTarget.replaceWith(scene(it.name, 'island', { w, h: ht, sky: 'tropic' })) }));
  }
  const kind = it.type === 'tour' ? 'activity' : it.p.kind;
  return h('div', { class: 'poster' }, scene(it.name, SCENE[kind] || 'nature', { w, h: ht, sky: SKY[kind] }));
}

function card(x, it, depth) {
  const kind = it.type === 'tour' ? 'activity' : KIND[it.p.kind] ? it.p.kind : 'other';
  const a = it.a, p = it.p;
  const facts = a ? [a.priceFrom != null ? `from ${money(a.priceFrom, a.currency)}${a.perPerson ? ' pp' : ''}` : null, a.duration].filter(Boolean).join(' · ') : null;
  const why = a ? a.summary : p.why;
  const el = h('article', { class: `dcard k-${kind}${depth ? ' behind' : ' front'}`, style: `--d:${depth}`, 'aria-hidden': depth ? 'true' : null, tabindex: depth ? null : '0',
    'aria-label': depth ? null : `${it.name}. Right arrow keeps it, left arrow skips it.`,
    onkeydown: depth ? null : (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); fly(x, it, 'keep'); } else if (e.key === 'ArrowLeft') { e.preventDefault(); fly(x, it, 'skip'); } } },
    poster(it),
    h('span', { class: 'stamp keep', text: 'Keep' }), h('span', { class: 'stamp skip', text: 'Skip' }),
    h('div', { class: 'dbody' },
      h('div', { class: 'dtags' },
        h('span', { class: 'ktag' }, icon(it.type === 'tour' ? Ticket : KIND_ICON[kind]), it.type === 'tour' ? 'Tour' : KIND[kind]),
        p?.area ? h('span', { class: 'small', text: p.area }) : null,
        a?.rating ? h('span', { class: 'small rating' }, icon(Star), ` ${a.rating.toFixed(1)}${a.reviews ? ` (${a.reviews.toLocaleString('en-GB')})` : ''}`) : null),
      h('h4', { class: 'dname', text: it.name }),
      facts ? h('p', { class: 'dfacts', text: facts }) : null,
      why ? h('p', { class: 'why', text: why }) : null,
      depth ? null : h('div', { class: 'acts dlinks' },
        a ? a.links.map((l) => h('button', { class: 'chip', onclick: () => app.openLink({ url: l.url }) }, icon(ExternalLink), l.site))
          : p.source_url ? h('button', { class: 'chip', onclick: () => app.openLink({ url: p.source_url }) }, icon(ExternalLink), `Source · ${host(p.source_url)}`) : null)));
  if (!depth) swipe(el, x, it);
  return el;
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } };

// Dragging the top card: it follows the finger, tilts, and shows Keep or Skip; far enough and it flies off
function swipe(el, x, it) {
  let start = null, dx = 0, id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY }; dx = 0; id = e.pointerId;
    el.classList.add('drag');
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== id) return;
    const mx = e.clientX - start.x, my = e.clientY - start.y;
    if (!el.hasPointerCapture(id)) {
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { start = null; el.classList.remove('drag'); return; }   // a scroll
      if (Math.abs(mx) < 6) return;
      el.setPointerCapture(id);
    }
    dx = mx;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    el.style.setProperty('--keep', String(Math.max(0, Math.min(1, dx / 90))));
    el.style.setProperty('--skip', String(Math.max(0, Math.min(1, -dx / 90))));
  });
  const end = () => {
    if (!start) return;
    start = null; el.classList.remove('drag');
    if (Math.abs(dx) > 90) return fly(x, it, dx > 0 ? 'keep' : 'skip', el);
    el.style.transform = ''; el.style.removeProperty('--keep'); el.style.removeProperty('--skip');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// The card leaves to its side, then the choice is saved
function fly(x, it, status, el) {
  if (saving.has(x.place)) return;
  const top = el || document.querySelector('.pickdeck .dcard.front');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (top && !reduce) {
    top.classList.add('fly', status);
    top.style.setProperty(status === 'keep' ? '--keep' : '--skip', '1');
    top.style.transform = `translateX(${status === 'keep' ? 130 : -130}%) rotate(${status === 'keep' ? 18 : -18}deg)`;
    setTimeout(() => decide(x, it, status), 220);
  } else decide(x, it, status);
}

async function decide(x, it, status) {
  const V = C.view();
  const d = deck[x.place] || (deck[x.place] = {});
  if (it.type === 'tour' && status === 'skip') {
    const t = C.tourState(x);
    t.skipped = [...(t.skipped || []), it.name];
    d.last = { name: it.name, tour: true };
    C.render(); focusTop();
    return;
  }
  const list = V.picks[x.place] || (V.picks[x.place] = []);
  const before = list.map((p) => ({ ...p }));
  if (it.type === 'pick') { const p = list.find((q) => lc(q.name) === lc(it.name)); if (p) p.status = status; }
  d.last = { name: it.name, tour: it.type === 'tour' };
  saving.add(x.place);
  C.render(); focusTop();
  try {
    const r = it.type === 'tour' ? await app.callServerTool({ name: 'save_local_picks', arguments: { place: x.place, picks: [tourPick(it.a)] } })
      : await app.callServerTool({ name: 'plan_local_picks', arguments: { place: x.place, choices: [{ name: it.name, status }] } });
    if (r.isError) throw new Error(textOf(r) || 'Could not save that.');
    V.picks[x.place] = r.structuredContent?.picks || V.picks[x.place];
    showError('');
    if (!toDecide(x).length) tell(`the traveller sorted the picks for ${x.place}: kept ${V.picks[x.place].filter((p) => p.status === 'keep').map((p) => p.name).join(', ') || 'none'}.`);
  } catch (e) {
    V.picks[x.place] = before;
    d.last = null;
    showError(e.message || String(e));
  } finally { saving.delete(x.place); C.render(); focusTop(); }
}

const tourPick = (a) => ({ name: a.title.slice(0, 80), kind: 'activity', why: (a.summary || a.title).slice(0, 300), source_url: a.links[0].url, book_url: a.links[0].url, status: 'keep',
  ...(a.priceFrom != null ? { price_from: a.priceFrom, currency: a.currency } : {}) });

function focusTop() { requestAnimationFrame(() => { const t = document.querySelector('.pickdeck .dcard.front'); if (t && document.activeElement?.closest?.('.pickdeck')) t.focus({ preventScroll: true }); }); }

async function undo(x) {
  const d = deck[x.place];
  const last = d?.last;
  if (!last) return;
  d.last = null;
  const t = C.tourState(x);
  if (last.tour && (t.skipped || []).includes(last.name)) { t.skipped = t.skipped.filter((n) => n !== last.name); C.render(); return; }
  await choose(x, [{ name: last.name, status: null, date: null, slot: null }]);
}

// Saves choices on saved picks, showing them at once and putting them back if the save fails
async function choose(x, choices, line) {
  const V = C.view();
  const list = V.picks[x.place] || [];
  const before = list.map((p) => ({ ...p }));
  for (const c of choices) {
    const p = list.find((q) => lc(q.name) === lc(c.name));
    if (!p) continue;
    for (const f of ['status', 'date', 'slot']) if (c[f] !== undefined) { if (c[f] === null) delete p[f]; else p[f] = c[f]; }
    if (p.status === 'skip') { delete p.date; delete p.slot; }
  }
  C.render();
  try {
    const r = await app.callServerTool({ name: 'plan_local_picks', arguments: { place: x.place, choices } });
    if (r.isError) throw new Error(textOf(r) || 'Could not save that.');
    V.picks[x.place] = r.structuredContent?.picks || V.picks[x.place];
    showError('');
    if (line) tell(line);
  } catch (e) {
    V.picks[x.place] = before;
    showError(e.message || String(e));
  }
  C.render();
}

// ---- when every card is decided
function doneBlock(x, kept, skipped) {
  const V = C.view(), t = C.tourState(x);
  return h('section', { class: 'block sorted' },
    h('span', { class: 'sorted-ic' }, icon(Check)),
    h('div', { class: 'sorted-t' }, h('b', { text: kept.length ? `All sorted: ${kept.length} kept in ${x.place}` : `Nothing kept in ${x.place} yet` }),
      h('span', { class: 'small', text: skipped.length ? `${skipped.length} skipped. Want more ideas?` : 'Want more ideas?' })),
    h('div', { class: 'acts' }, askBtn(x, kept, false), V.activities?.on ? toursBtn(x, t) : null));
}

// ---- the plan: one card per day, the parts of the day down it
function daysBlock(x, days, kept) {
  const placed = days.reduce((a, d) => a + SLOTS.reduce((b, s) => b + d.slots[s].length, 0), 0);
  return h('section', { class: 'block plan' },
    h('div', { class: 'block-head' }, h('h3', { text: `Your days in ${x.place}` }),
      h('span', { class: 'small', text: `${days.length} days · ${placed} plan${placed === 1 ? '' : 's'} · tap one to move it` })),
    h('ol', { class: 'days' }, days.map((d, i) => h('li', { class: 'pday', style: `animation-delay:${i * 60}ms` },
      h('div', { class: 'pday-date' }, h('span', { class: 'wd', text: day(d.date).split(' ')[0] }), h('b', { text: String(Number(d.date.slice(8))) }), h('span', { class: 'mo', text: day(d.date).split(' ').at(-1) })),
      h('div', { class: 'pday-body' },
        h('div', { class: 'pday-head' }, h('b', { text: `Day ${i + 1}` }),
          d.tag ? h('span', { class: `daytag${i ? ' out' : ''}` }, icon(i ? Luggage : PlaneLanding), d.tag) : null),
        SLOTS.filter((s) => d.open.includes(s) || d.slots[s].length).map((s) => h('div', { class: `slot s-${s}${d.slots[s].length ? '' : ' empty'}` },
          h('span', { class: 'slot-l' }, icon(SLOT_ICON[s]), SLOT[s]),
          d.slots[s].length ? h('div', { class: 'slot-items' }, d.slots[s].map((p) => planItem(x, p, days, d.date)))
            : h('span', { class: 'slot-free', text: d.open.includes(s) ? 'Free time' : '' }))))))));
}

function planItem(x, p, days, at) {
  const kind = KIND[p.kind] ? p.kind : 'other';
  const key = `${x.place}|${lc(p.name)}`;
  const open = editing === key;
  return h('div', { class: `plan-item k-${kind}${open ? ' open' : ''}` },
    h('button', { class: 'pi-main', 'aria-expanded': String(open), onclick: () => { editing = open ? null : key; C.render(); } },
      h('span', { class: 'kind-ic' }, icon(KIND_ICON[kind])),
      h('span', { class: 'pick-t' }, h('span', { class: 'pname', text: p.name }),
        h('span', { class: 'kind', text: [KIND[kind], p.area, p.price_from != null ? `from ${money(p.price_from, p.currency)}` : null].filter(Boolean).join(' · ') })),
      p.pinned ? h('span', { class: 'pin-dot', title: 'You put it here' }) : null),
    open ? h('div', { class: 'pi-edit' },
      at ? h('span', { class: 'small', text: 'Move to' }) : null,
      at ? h('div', { class: 'chips' }, days.map((d, i) => h('button', { class: `chip${d.date === at ? ' on' : ''}`, 'aria-pressed': String(d.date === at),
        onclick: () => move(x, p, d.date, d.open.includes(p.slot) ? p.slot : d.open[0]) }, `Day ${i + 1} · ${day(d.date).split(' ')[0]}`))) : null,
      at ? h('div', { class: 'chips' }, SLOTS.map((s) => h('button', { class: `chip${p.slot === s ? ' on' : ''}`, 'aria-pressed': String(p.slot === s),
        onclick: () => move(x, p, at, s) }, icon(SLOT_ICON[s]), SLOT[s]))) : null,
      h('div', { class: 'acts' },
        p.book_url || p.source_url ? h('button', { class: 'ghost', onclick: () => app.openLink({ url: p.book_url || p.source_url }) }, icon(ExternalLink), p.book_url ? 'Book' : 'Source') : null,
        p.pinned ? h('button', { class: 'ghost', onclick: () => { editing = null; choose(x, [{ name: p.name, date: null, slot: null }]); } }, icon(CalendarDays), 'Let Pinroute place it') : null,
        h('button', { class: 'ghost danger', onclick: () => { editing = null; choose(x, [{ name: p.name, status: 'skip' }], `the traveller took ${p.name} out of their plan for ${x.place}.`); } }, icon(Trash2), 'Remove'))) : null);
}

function move(x, p, date, slot) {
  editing = null;
  choose(x, [{ name: p.name, date, slot }], `the traveller planned ${p.name} for ${day(date)}, ${SLOT[slot].toLowerCase()}, in ${x.place}.`);
}

// A stop with no nights: what was kept, as a list
function keptList(x, kept) {
  return h('section', { class: 'block plan' },
    h('div', { class: 'block-head' }, h('h3', { text: `Kept for ${x.place}` })),
    h('div', { class: 'slot-items' }, kept.map((p) => planItem(x, { ...p, slot: p.slot || 'afternoon' }, [], null))));
}

function skippedBlock(x, skipped) {
  return h('details', { class: 'skipped' },
    h('summary', {}, `Skipped (${skipped.length})`),
    h('ul', {}, skipped.map((p) => h('li', {},
      h('span', { class: 'pname', text: p.name }),
      h('button', { class: 'ghost', onclick: () => choose(x, [{ name: p.name, status: 'keep' }], `the traveller kept ${p.name} in ${x.place} after all.`) }, icon(Check), 'Keep')))));
}
