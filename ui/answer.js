// Claude's answer to a question asked in the planner, shown where it was asked: the text Claude saved with show_answer,
// its links, and a box to ask a follow-up, whose answer lands in the same place. Text goes through textContent only.
import { MessageSquare, ExternalLink, Sparkles } from 'lucide';
import { app, ask, answers, answerKey, waiting } from './core.js';
import { h, icon } from './dom.js';

// "**bold**" inside a line
const inline = (t) => t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? h('b', { text: p.slice(2, -2) }) : p));

// Paragraphs at blank lines; lines starting "- " or "* " (or "1. ") gather into a list
export function prose(text) {
  const out = [];
  for (const para of String(text || '').trim().split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    let list = null, kind = null;
    for (const l of lines) {
      const m = /^(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(l);
      if (m) {
        const k = m[1] ? 'ul' : 'ol';
        if (!list || kind !== k) { list = h(k); kind = k; out.push(list); }
        list.append(h('li', {}, inline(m[3])));
      } else {
        list = null;
        out.push(h('p', {}, inline(l.replace(/^#+\s*/, ''))));
      }
    }
  }
  return out;
}

const when = (iso) => { try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso)); } catch { return ''; } };
const drafts = {};

// key: what was asked, as passed to ask(); follow: the options to ask() a follow-up with (poll, done…)
export function answerBlock(key, follow = {}) {
  const a = answers[answerKey(key)];
  if (!a) return null;
  const id = `reply-${answerKey(key).replace(/[^\w-]/g, '_')}`;
  const send = () => {
    const t = (drafts[key] || '').trim();
    if (!t) return;
    drafts[key] = '';
    ask(key, `${t} (A follow-up to my question in the Pinroute planner.)`, follow);
  };
  return h('section', { class: 'answer', 'aria-label': 'Claude\'s answer' },
    h('p', { class: 'answer-by small' }, h('span', { class: 'spark' }, icon(Sparkles)), h('b', { text: 'Claude' }), a.at ? ` · ${when(a.at)}` : ''),
    h('div', { class: 'answer-text' }, prose(a.answer)),
    a.links?.length ? h('div', { class: 'answer-links' }, a.links.map((l) => h('button', { class: 'ghost', onclick: () => app.openLink({ url: l.url }) }, icon(ExternalLink), l.title))) : null,
    waiting[key] ? h('p', { class: 'small busy', text: 'Claude is answering; it shows here.' }) : null,
    h('div', { class: 'answer-reply' },
      h('label', { class: 'sr-only', for: id, text: 'Ask Claude a follow-up' }),
      h('textarea', { id, rows: 1, maxlength: 600, value: drafts[key] || '', placeholder: 'Ask a follow-up…',
        oninput: (e) => { drafts[key] = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } }),
      h('button', { onclick: send, disabled: !!waiting[key] }, icon(MessageSquare), 'Ask')));
}
