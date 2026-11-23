// The planner's link to Claude and the state every screen shares: which screen is up, the host's display mode,
// calling Pinroute's tools through the host, asking Claude for work that needs a model, and telling Claude what changed.
import { App } from '@modelcontextprotocol/ext-apps';

// Size reports start once the host has answered (see the start in planner.js), so none is sent into a closed channel
export const app = new App({ name: 'Pinroute planner', version: '0.4.1' }, {}, { autoResize: false });
export const $ = (id) => document.getElementById(id);
export const ui = { ctx: {}, busy: false };

let paint = () => {}, open = () => {};
export const onRender = (f) => { paint = f; };
export const render = () => paint();
// Showing a tool result switches to its screen: the start screen, the new-trip planner or a trip
export const onShow = (f) => { open = f; };
export const show = (r) => open(r);

export const canFull = () => (ui.ctx.availableDisplayModes || []).includes('fullscreen');
export const isFull = () => ui.ctx.displayMode === 'fullscreen';
export const layout = () => (isFull() ? 'app' : canFull() ? 'card' : 'stacked');
export const narrow = () => layout() === 'stacked' || window.innerWidth < 720;

export const textOf = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

export function showError(msg) { const el = $('error'); if (el) { el.textContent = msg; el.hidden = !msg; } }

export async function call(name, args = {}) {
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error(textOf(r) || 'That did not work. Try again in a moment.');
  return r;
}

// Where the traveller is and has been: each place is the tool call that shows it again, so Back reopens it fresh.
// The screen sets `here` from what it shows (see where() in planner.js); go() remembers the place it leaves.
export const nav = { here: null, back: [] };
const same = (a, b) => a && b && a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args);

// Opens a screen from a tool call, full screen when the host offers it
export async function go(name, args, { full = true, remember = true } = {}) {
  const from = nav.here;
  ui.busy = true; render();
  try {
    const r = await call(name, args);
    showError('');
    show(r);
    if (remember && from && !same(from, nav.here)) nav.back = [...nav.back, from].slice(-20);
    if (full && canFull() && !isFull()) await setMode('fullscreen');
    return r;
  } catch (e) { showError(e.message || String(e)); return null; }
  finally { ui.busy = false; render(); }
}
export function goBack() {
  const to = nav.back.at(-1);
  if (!to) return null;
  nav.back = nav.back.slice(0, -1);
  return go(to.name, to.args, { remember: false });
}
export const setHere = (place) => { nav.here = place; };

export async function setMode(mode) {
  try {
    const r = await app.requestDisplayMode({ mode });
    ui.ctx = { ...ui.ctx, displayMode: r?.mode || mode };
  } catch (e) { showError(e.message || String(e)); }
  render();
}

export const tell = (line) => app.updateModelContext({ content: [{ type: 'text', text: `In the Pinroute planner, ${line}` }] }).catch(() => {});

// Asking Claude: a message in the conversation, then the screen watches the server for what Claude saves.
// poll() fetches the latest state; done() says whether what was asked for has arrived.
export const waiting = {};
export async function ask(key, message, { poll, done, every = 8000, tries = 30 } = {}) {
  waiting[key] = true;
  render();
  await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] }).catch((e) => showError(e.message || String(e)));
  if (!poll || !done) return;
  let n = 0;
  const timer = setInterval(async () => {
    n += 1;
    await poll(true);
    if (done() || n >= tries) { clearInterval(timer); if (done()) delete waiting[key]; render(); }
  }, every);
}
