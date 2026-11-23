// Small DOM and formatting helpers shared by the planner's screens. Text always goes through textContent, never HTML.
const SVG = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}
// Lucide line icons, one size and one stroke
export function icon(node) {
  const svg = s('svg', { class: 'i', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const [tag, attrs] of node) svg.append(s(tag, attrs));
  return svg;
}

const UTC = { timeZone: 'UTC' };
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...UTC });
const DM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...UTC });
const DMY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...UTC });
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...UTC });
export const date = (iso) => new Date(`${iso}T00:00:00Z`);
export const day = (iso) => DAY.format(date(iso));
export const dm = (iso) => DM.format(date(iso));
export const dmy = (iso) => DMY.format(date(iso));
export const longDay = (iso) => LONG.format(date(iso));
export const span = (a, b) => {
  const A = date(a), B = date(b);
  if (a === b) return DM.format(A);
  return A.getUTCMonth() === B.getUTCMonth() && A.getUTCFullYear() === B.getUTCFullYear() ? `${A.getUTCDate()}–${DM.format(B)}` : `${DM.format(A)} – ${DM.format(B)}`;
};
export const days = (a, b) => Math.round((date(b) - date(a)) / 864e5);
export const nightsTxt = (n) => `${n} night${n === 1 ? '' : 's'}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const money = (n, c) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: c || 'EUR', maximumFractionDigits: 0 }).format(n);
export const hm = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
export const clock = (iso) => String(iso || '').slice(11, 16);            // times are local at each airport, shown as given
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
