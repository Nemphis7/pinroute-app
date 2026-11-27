// Typing on a phone. Claude's composer and the phone's keyboard sit over the bottom of the planner, so a field the
// traveller taps could end up behind them. While a text field has focus the planner:
//   - marks the app as typing: the bottom tabs step aside and the scrolling pane gets room below its content;
//   - scrolls the field to the top of its pane (and, in the chat, of the conversation), where nothing covers it;
//   - follows the keyboard where the frame can see it (visualViewport), so full screen and dialogs end above it.
// Areas the host keeps clear (safeAreaInsets) are padded in the CSS through --safe-top/right/bottom/left.
import { ui } from './core.js';

const TEXT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select';
const isText = (el) => !!el?.matches?.(TEXT);
export const touch = () => ui.ctx.platform === 'mobile' || !!ui.ctx.deviceCapabilities?.touch || !!window.matchMedia?.('(pointer: coarse)').matches;

const root = () => document.getElementById('app');

// The part of the frame the keyboard covers, as --kb; 0 where the frame cannot tell
function keyboard() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  document.documentElement.style.setProperty('--kb', `${kb}px`);
}

function reveal() {
  const el = document.activeElement;
  if (!isText(el) || !touch()) return;
  el.scrollIntoView({ block: 'start', inline: 'nearest' });
}

let timers = [];
const later = () => { timers.forEach(clearTimeout); timers = [80, 360].map((ms) => setTimeout(reveal, ms)); };   // once now-ish, once the keyboard is up

// A render puts the same field back (same id) right after taking it out: that is not a new tap, so no new scroll
let left = { id: null, at: 0 };
document.addEventListener('focusout', (e) => {
  if (!isText(e.target)) return;
  left = { id: e.target.id || null, at: performance.now() };
  setTimeout(() => { if (!isText(document.activeElement)) delete root()?.dataset.typing; }, 0);
});
document.addEventListener('focusin', (e) => {
  if (!isText(e.target)) return;
  const r = root();
  if (r && touch()) r.dataset.typing = 'true';
  if (e.target.id && e.target.id === left.id && performance.now() - left.at < 100) return;
  later();
});

window.visualViewport?.addEventListener('resize', () => { keyboard(); if (isText(document.activeElement)) later(); });
window.visualViewport?.addEventListener('scroll', keyboard);
keyboard();

// The host's safe areas: in full screen on a phone, where its own controls and the system bars are
export function applyInsets(inset = {}) {
  for (const side of ['top', 'right', 'bottom', 'left']) document.documentElement.style.setProperty(`--safe-${side}`, `${Math.max(0, Math.round(inset[side] || 0))}px`);
}
