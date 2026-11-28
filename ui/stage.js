// The route map as a stage, full screen: it stays on screen while the traveller moves along the route, and its camera
// flies to whatever they pick (a stop and its neighbours, or both ends of a leg). On opening, the route draws itself
// leg by leg and the stops drop in; waves move on the sea and cloud shadows drift over the land. "Play your trip"
// flies from stop to stop in travel order with a postcard caption, the way you'd daydream over a map.
// The map is built once per trip and state; renders only change classes and move the camera, so nothing restarts.
import { Plane, Ship, Car, Bus, TrainFront, CarTaxiFront, Play, Pause, Expand } from 'lucide';
import { h, s, icon, span, nightsTxt, day } from './dom.js';
import { scene, kindOf } from './scene.js';

const S = { el: null, wrap: null, svg: null, key: '', vb: null, raf: 0, M: null, V: null, o: null, playing: 0, cap: null, mover: null };
// A ferry or road leg moves as the ride chosen for it: a bus, a train, a boat
const RIDE = { ferry: Ship, speedboat: Ship, bus: Bus, minivan: Bus, combined: Bus, train: TrainFront, taxi: CarTaxiFront, drive: Car };
const rideOf = (l) => (l.mode !== 'flight' && l.chosen?.ride) || l.mode;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// The persistent element: the map, the caption and the two buttons
export function stageEl() {
  if (S.el) return S.el;
  S.cap = h('div', { class: 'stage-cap', hidden: true, 'aria-live': 'polite' });
  S.play = h('button', { class: 'stage-btn', title: 'Play your trip', 'aria-label': 'Play your trip', onclick: () => (S.playing ? stopPlay() : playTrip()) }, icon(Play), h('span', { text: 'Play your trip' }));
  S.fit = h('button', { class: 'stage-btn icon', title: 'Whole route', 'aria-label': 'Show the whole route', onclick: () => { stopPlay(); flyTo(fullBox()); } }, icon(Expand));
  S.wrap = h('div', { class: 'stage-map' });
  S.el = h('aside', { class: 'aside-map stage' }, S.wrap, h('div', { class: 'stage-ctl' }, S.play, S.fit), S.cap, h('div', { class: 'stage-rose', 'aria-hidden': 'true' }, rose()));
  S.wrap.addEventListener('pointerdown', () => stopPlay());
  window.addEventListener('resize', () => { if (S.svg && S.target) flyTo(S.target, 0); });
  return S.el;
}

// o: { V, M, sel, settled(l), onPick(sel), onHover(stop, on, leg), ghosts?: [{ id, name, points }], onGhost?(id) }
// ghosts are the other route options, drawn faint under the route; a tap on one shows it instead
export function updateStage(o) {
  stageEl();
  S.o = o; S.V = o.V; S.M = o.M;
  if (!o.M) { S.wrap.replaceChildren(); S.svg = null; return; }
  const key = JSON.stringify([o.V.trip.id, o.M.w, o.M.h, o.M.points, o.V.stops.map((x) => x.nights), o.V.legs.map((l) => [l.key, o.settled(l)]), (o.ghosts || []).map((g) => g.id)]);
  const fresh = key !== S.key;
  if (fresh) { S.key = key; build(); }
  mark();
  if (!S.playing) {
    const t = boxFor(o.sel);
    if (fresh && !S.vb) { S.vb = fitAspect(fullBox(1.6)); apply(S.vb); }
    if (!S.target || JSON.stringify(t) !== JSON.stringify(S.target)) flyTo(t, fresh ? 1600 : 1100);
  }
}

function rose() {
  const svg = s('svg', { viewBox: '-20 -20 40 40' });
  svg.append(s('circle', { r: 17, class: 'r0' }), s('path', { d: 'M0,-15 L4,0 L0,15 L-4,0 Z', class: 'r1' }), s('path', { d: 'M0,-15 L4,0 L-4,0 Z', class: 'r2' }), s('text', { y: -6.5, 'text-anchor': 'middle', class: 'r3' }, 'N'));
  return svg;
}

// ---------------------------------------------------------------- drawing
function legPath(l) {
  const M = S.M, a = M.points[l.after], b = M.points[l.after + 1];
  if (l.after < 0 || l.after >= S.V.stops.length - 1 || !a || !b || (a[0] === b[0] && a[1] === b[1])) return null;
  if (l.mode !== 'flight') return `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), k = Math.min(48, len * 0.2);
  return `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2 - (dy / len) * k},${(a[1] + b[1]) / 2 + (dx / len) * k} ${b[0]},${b[1]}`;
}

function build() {
  const { M, V, o } = S;
  const svg = s('svg', { class: 'map stage-svg', viewBox: `0 0 ${M.w} ${M.h}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': `Map of the route: ${V.stops.map((x) => x.place).join(', ')}` });
  const defs = s('defs');
  const sea = s('radialGradient', { id: 'st-sea', cx: '50%', cy: '45%', r: '70%' });
  sea.append(s('stop', { offset: 0, class: 'sea-0' }), s('stop', { offset: 1, class: 'sea-1' }));
  const sh = s('filter', { id: 'st-sh', x: '-5%', y: '-5%', width: '110%', height: '110%' });
  sh.append(s('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, 'flood-opacity': 0.2 }));
  const blur = s('filter', { id: 'st-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  blur.append(s('feGaussianBlur', { stdDeviation: 14 }));
  const grid = s('pattern', { id: 'st-grid', width: 48, height: 48, patternUnits: 'userSpaceOnUse' });
  grid.append(s('path', { d: 'M48 0 L0 0 0 48', class: 'grid' }));
  defs.append(sea, sh, blur, grid);
  const W = M.w, H = M.h;
  svg.append(defs, s('rect', { class: 'sea', x: -W, y: -H, width: W * 3, height: H * 3, fill: 'url(#st-sea)' }), s('rect', { x: -W, y: -H, width: W * 3, height: H * 3, fill: 'url(#st-grid)' }));
  // waves: short strokes that bob on the sea
  const waves = s('g', { class: 'waves' });
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, y = rnd() * H, l = 8 + rnd() * 10;
    waves.append(s('path', { d: `M${x},${y} q${l / 4},-2.5 ${l / 2},0 t${l / 2},0`, style: `animation-delay:${(-rnd() * 6).toFixed(2)}s` }));
  }
  svg.append(waves, s('path', { class: 'land', d: M.land, filter: 'url(#st-sh)' }));
  // cloud shadows drifting across
  const clouds = s('g', { class: 'clouds', filter: 'url(#st-blur)' });
  for (let i = 0; i < 4; i++) clouds.append(s('ellipse', { cx: rnd() * W, cy: rnd() * H, rx: 40 + rnd() * 50, ry: 20 + rnd() * 20, style: `animation-delay:${(-rnd() * 40).toFixed(1)}s` }));
  svg.append(clouds);
  // the other route options, faint, each with its letter: a tap shows that one
  if (o.ghosts?.length) {
    const ghosts = s('g', { class: 'ghosts' });
    for (const gh of o.ghosts) {
      const p = (gh.points || []).filter(Boolean);
      if (p.length < 2) continue;
      const d = `M${p.map((q) => q.join(',')).join(' L')}`;
      const g = s('g', { class: 'ghost', 'data-opt': gh.id, role: 'button', 'aria-label': `Show route ${gh.id}: ${gh.name}` });
      g.append(s('path', { class: 'ghost-hit', d }), s('path', { class: 'ghost-route', d }), s('title', {}, `Route ${gh.id}: ${gh.name}`));
      const m = p[Math.floor((p.length - 1) / 2)], n = p[Math.floor((p.length - 1) / 2) + 1] || m;
      const tag = s('g', { transform: `translate(${(m[0] + n[0]) / 2},${(m[1] + n[1]) / 2})` });
      const inner = s('g', { class: 'pin-s' });
      inner.append(s('circle', { class: 'ghost-dot', r: 10 }), s('text', { class: 'ghost-tag', 'text-anchor': 'middle', dy: '0.35em' }, gh.id));
      tag.append(inner);
      g.append(tag);
      g.addEventListener('click', () => { stopPlay(); S.o.onGhost?.(gh.id); });
      ghosts.append(g);
    }
    svg.append(ghosts);
  }
  // the route, leg by leg in travel order
  const routes = s('g', { class: 'routes' });
  let n = 0;
  for (const l of V.legs) {
    const d = legPath(l);
    if (!d) continue;
    const delay = `animation-delay:${(0.25 + n * 0.32).toFixed(2)}s`;
    routes.append(s('path', { class: 'route-halo', d, style: delay }));
    routes.append(s('path', { class: `route ${l.mode === 'flight' ? 'flight' : 'ground'}${o.settled(l) ? ' ok' : ''}`, d, 'data-leg': l.key, ...(l.mode === 'flight' ? { pathLength: 100 } : {}), style: delay }));
    n += 1;
  }
  svg.append(routes);
  S.moverG = s('g', { class: 'mover-layer' });
  svg.append(S.moverG);
  // the stops: one pin per place, numbered, named
  const seen = new Set();
  const pins = s('g', { class: 'pins' });
  V.stops.forEach((x, i) => {
    const p = M.points[i];
    if (!p || seen.has(p.join())) return;
    seen.add(p.join());
    const g = s('g', { class: 'pin go', transform: `translate(${p[0]},${p[1]})`, 'data-stop': i });
    const inner = s('g', { class: 'pin-s', style: `animation-delay:${(0.2 + i * 0.32).toFixed(2)}s` });
    inner.append(s('circle', { class: 'pulse', r: 11 }), s('circle', { class: 'dot', r: 11 }), s('text', { class: 'num', 'text-anchor': 'middle', dy: '0.35em' }, String(i + 1)),
      s('text', { class: 'label', x: 17, y: -1 }, x.place), s('text', { class: 'label sub', x: 17, y: 13 }, x.nights ? nightsTxt(x.nights) : day(x.arrive)), s('title', {}, x.place));
    g.append(inner);
    g.addEventListener('click', () => { stopPlay(); S.o.onPick({ kind: 'stop', index: i }); });
    g.addEventListener('mouseenter', () => S.o.onHover(i, true));
    g.addEventListener('mouseleave', () => S.o.onHover(i, false));
    pins.append(g);
  });
  svg.append(pins);
  S.svg = svg;
  S.wrap.replaceChildren(svg);
  S.el.classList.remove('intro'); void S.el.offsetWidth; S.el.classList.add('intro');
  if (S.vb) apply(S.vb);
}

// Selection classes, and the plane or boat on the selected leg
function mark() {
  const { svg, o } = S;
  if (!svg) return;
  const sel = o.sel;
  for (const g of svg.querySelectorAll('.pin')) g.classList.toggle('sel', sel?.kind === 'stop' && Number(g.dataset.stop) === sel.index);
  for (const p of svg.querySelectorAll('.route')) p.classList.toggle('sel', sel?.kind === 'leg' && p.dataset.leg === sel.key);
  const top = svg.querySelector('.pin.sel');
  if (top) top.parentNode.append(top);                      // the selected pin above its neighbours
  const l = sel?.kind === 'leg' ? o.V.legs.find((x) => x.key === sel.key) : null;
  const d = l && legPath(l);
  const k = d ? `${l.key}|${d}|${rideOf(l)}` : '';
  if (S.moverKey !== k) { S.moverKey = k; S.moverG.replaceChildren(...(d && !reduced() ? [mover(d, rideOf(l), true)] : [])); }
}

function mover(d, mode, loop) {
  const g = s('g', { class: 'mover' });
  const inner = s('g', { class: 'pin-s' });
  inner.append(s('circle', { r: 10 }));
  const ic = icon(mode === 'flight' ? Plane : RIDE[mode] || Car);
  ic.setAttribute('x', -6.5); ic.setAttribute('y', -6.5); ic.setAttribute('width', 13); ic.setAttribute('height', 13);
  if (mode === 'flight') ic.setAttribute('transform', 'rotate(45)');
  inner.append(ic);
  g.append(inner, s('animateMotion', { dur: loop ? '3.4s' : '1.3s', repeatCount: loop ? 'indefinite' : '1', fill: 'freeze', path: d, calcMode: 'spline', keyPoints: '0;1', keyTimes: '0;1', keySplines: '0.45 0 0.55 1' }));
  return g;
}

// ---------------------------------------------------------------- the camera
const pts = () => S.M.points.filter(Boolean);
function bbox(list, pad = 0.3, min = 0.22) {
  const xs = list.map((p) => p[0]), ys = list.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, S.M.w * min), hh = Math.max(y1 - y0, S.M.h * min);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x: cx - (w * (1 + pad)) / 2, y: cy - (hh * (1 + pad)) / 2, w: w * (1 + pad), h: hh * (1 + pad) };
}
function fullBox(zoomOut = 1) {
  const p = pts();
  if (!p.length) return { x: 0, y: 0, w: S.M.w, h: S.M.h };
  const b = bbox(p, 0.25, 0.4);
  return { x: b.x - (b.w * (zoomOut - 1)) / 2, y: b.y - (b.h * (zoomOut - 1)) / 2, w: b.w * zoomOut, h: b.h * zoomOut };
}
function boxFor(sel) {
  const { M, V } = S;
  if (!sel) return fullBox();
  if (sel.kind === 'stop') {
    const i = sel.index, near = [i - 1, i, i + 1].map((j) => M.points[j]).filter(Boolean);
    const p = M.points[i];
    if (!p) return fullBox();
    const b = bbox(near.length ? near : [p], 0.35, 0.28);
    // keep the stop itself near the middle
    const cx = (b.x + b.w / 2 + p[0]) / 2, cy = (b.y + b.h / 2 + p[1]) / 2;
    return { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h };
  }
  const l = V.legs.find((x) => x.key === sel.key);
  if (!l || !legPath(l)) return fullBox();
  return bbox([M.points[l.after], M.points[l.after + 1]], 0.5, 0.2);
}
// The box grown to the stage's shape, so nothing asked for is cut off
function fitAspect(b) {
  const r = S.el.getBoundingClientRect(), A = r.width && r.height ? r.width / r.height : 1;
  let { x, y, w, h: hh } = b;
  if (w / hh < A) { const nw = hh * A; x -= (nw - w) / 2; w = nw; } else { const nh = w / A; y -= (nh - hh) / 2; hh = nh; }
  return { x, y, w, h: hh };
}
function apply(v) {
  if (!S.svg) return;
  S.svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
  const cw = S.el.getBoundingClientRect().width || 1;
  S.svg.style.setProperty('--k', (v.w / cw).toFixed(4));   // map units per screen pixel: pins and lines keep their size
}
function flyTo(b, ms = 1100) {
  S.target = b;
  if (!S.svg) return Promise.resolve();
  const to = fitAspect(b), from = S.vb || to;
  cancelAnimationFrame(S.raf);
  if (reduced() || !ms || !S.el.isConnected) { S.vb = to; apply(to); return Promise.resolve(); }
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      // zoom out a little on the way, as a camera does over a long hop
      const lift = Math.sin(Math.PI * t) * 0.12 * Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / (from.w || 1));
      const w = (from.w + (to.w - from.w) * e) * (1 + lift), hh = (from.h + (to.h - from.h) * e) * (1 + lift);
      const cx = from.x + from.w / 2 + (to.x + to.w / 2 - from.x - from.w / 2) * e, cy = from.y + from.h / 2 + (to.y + to.h / 2 - from.y - from.h / 2) * e;
      S.vb = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
      apply(S.vb);
      if (t < 1) S.raf = requestAnimationFrame(step); else { S.vb = to; apply(to); done(); }
    };
    S.raf = requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- play the trip
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function playTrip() {
  const { V } = S;
  const run = ++S.playing;
  S.el.classList.add('playing');
  S.play.replaceChildren(icon(Pause), h('span', { text: 'Pause' }));
  const stops = V.stops.filter((x, i) => S.M.points[i]);
  await flyTo(fullBox(), 900);
  for (let n = 0; n < stops.length; n++) {
    if (S.playing !== run) return;
    const x = stops[n], i = x.index;
    const leg = n ? V.legs.find((l) => l.after === stops[n - 1].index) : null;
    const d = leg && legPath(leg);
    if (d && !reduced()) S.moverG.replaceChildren(mover(d, rideOf(leg), false));
    caption(x, leg);
    for (const g of S.svg.querySelectorAll('.pin')) g.classList.toggle('play', Number(g.dataset.stop) === i);
    S.o.onHover(i, true);
    await flyTo(boxFor({ kind: 'stop', index: i }), 1300);
    await wait(1500);
    S.o.onHover(i, false);
  }
  if (S.playing === run) stopPlay();
}
function stopPlay() {
  if (!S.playing) return;
  S.playing = 0;
  S.el.classList.remove('playing');
  S.cap.hidden = true;
  S.play.replaceChildren(icon(Play), h('span', { text: 'Play your trip' }));
  for (const g of S.svg?.querySelectorAll('.pin.play') || []) g.classList.remove('play');
  S.moverKey = null;
  mark();
  flyTo(boxFor(S.o.sel), 1000);
}
const RIDE_WORD = { ferry: 'ferry', speedboat: 'speedboat', bus: 'bus', minivan: 'minivan', combined: 'bus and ferry', train: 'train', taxi: 'private transfer', drive: 'car' };
// How the traveller got here: "By ferry · 09:00–10:30" when a ride is chosen for the leg in
function arrival(leg) {
  if (!leg || !leg.chosen) return null;
  if (leg.mode === 'flight') {
    const f = /(\d{1,2}:\d{2})\s*[A-Z]{3}\s*→\s*(\d{1,2}:\d{2})/.exec(leg.chosen.summary || '');
    return f || leg.booked ? `By air${f ? ` · lands ${f[2]}` : ''}${leg.booked ? ' · booked' : ''}` : null;
  }
  const t = /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/.exec(leg.chosen.summary || '');
  return `By ${RIDE_WORD[leg.chosen.ride] || 'road'}${t ? ` · ${t[1]}–${t[2]}` : ''}${leg.booked ? ' · booked' : ''}`;
}
function caption(x, leg) {
  const n = S.V.stops.length, by = arrival(leg);
  S.cap.hidden = false;
  S.cap.replaceChildren(h('span', { class: 'cap-art' }, scene(x.place, kindOf(x, x.index, n), { w: 120, h: 120 })),
    h('span', { class: 'cap-t' }, h('span', { class: 'small', text: `Stop ${x.index + 1} of ${n}` }), h('b', { text: x.place }),
      h('span', { class: 'small', text: x.nights ? `${span(x.arrive, x.depart)} · ${nightsTxt(x.nights)}` : day(x.arrive) }),
      by ? h('span', { class: 'small cap-by', text: by }) : null));
  S.cap.classList.remove('in'); void S.cap.offsetWidth; S.cap.classList.add('in');
}
