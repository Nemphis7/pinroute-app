// The world map of the new-trip screens. Countries come pre-drawn (src/world.mjs, at build time); Pinroute's 60 are
// shaded on one teal scale by how good the weather is in the traveller's months, darker is better, and the ones being
// compared are outlined and named. Islands too small for the map are dots. Every country has a hover title.
import WORLD from 'pinroute:world';
import { DESTS, destById, seasonFit, fitLabel, bestMonthsText } from '../src/discover.mjs';
import { h, s } from './dom.js';

const level = (f) => (f >= 0.85 ? 3 : f >= 0.6 ? 2 : f >= 0.4 ? 1 : 0);
export const SCALE = [[3, 'Great'], [2, 'Good'], [1, 'Mixed'], [0, 'Off season']];

// mode 'season': shaded by the months; 'pick': every country of Pinroute's list is a target to tap
export function worldSvg({ months = [], compare = [], target = null, regions = [], onPick = null, mini = false, mode = 'season' } = {}) {
  const svg = s('svg', { class: `world${mini ? ' mini' : ''}`, viewBox: `0 0 ${WORLD.w} ${WORLD.h}`, role: 'img',
    'aria-label': mode === 'pick' ? 'World map: tap a country to choose it' : 'World map shaded by the weather in your months' });
  const classOf = (d) => {
    const parts = ['c', 'dest'];
    if (regions.length && !regions.includes(d.region)) parts.push('dim');
    else parts.push(mode === 'pick' ? 'pick' : `f${level(seasonFit(d, months))}`);
    if (compare.includes(d.id)) parts.push('cmp');
    if (target === d.id) parts.push('target');
    return parts.join(' ');
  };
  const titleOf = (d) => (mode === 'pick' ? `${d.name} · best ${bestMonthsText(d)}` : `${d.name} · ${fitLabel(seasonFit(d, months))[1]}${compare.includes(d.id) ? ' · comparing' : ''}`);
  const hook = (el, d) => {
    el.append(s('title', {}, titleOf(d)));
    if (onPick && !mini) { el.classList.add('go'); el.addEventListener('click', () => onPick(d.id)); }
  };
  const top = [];
  for (const [id, path] of Object.entries(WORLD.countries)) {
    const d = destById(id);
    const el = s('path', { d: path, class: d ? classOf(d) : 'c' });
    if (d) { hook(el, d); if (compare.includes(id) || target === id) { top.push(el); continue; } }
    svg.append(el);
  }
  svg.append(...top);                                   // outlines drawn last, so no neighbour covers them
  for (const d of DESTS) {
    if (WORLD.countries[d.id]) continue;
    const [x, y] = WORLD.at[d.id];
    const dot = s('circle', { cx: x, cy: y, r: mini ? 9 : 6, class: `${classOf(d)} dot` });
    hook(dot, d);
    svg.append(dot);
  }
  if (!mini) {
    // Names above their country, or below, or further out, wherever they clear the names already placed
    const placed = [];
    for (const id of [...compare, target].filter(Boolean)) {
      const d = destById(id), p = WORLD.at[id];
      if (!d || !p) continue;
      const w = d.name.length * 12.5, hgt = 24;
      const spot = [-14, 34, -40, 60, -66].map((dy) => ({ x: p[0] - w / 2, y: p[1] + dy - hgt + 6, w, h: hgt, dy }))
        .find((b) => !placed.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h)) || { dy: -14 };
      if (spot.w) placed.push(spot);
      svg.append(s('text', { class: 'name', x: p[0], y: p[1] + spot.dy, 'text-anchor': 'middle' }, d.name));
    }
  }
  return svg;
}

export function legend() {
  return h('div', { class: 'legend', 'aria-label': 'Weather in your months' },
    SCALE.map(([n, label]) => h('span', {}, h('i', { class: `sw f${n}` }), label)),
    h('span', {}, h('i', { class: 'sw cmp' }), 'Comparing'));
}
