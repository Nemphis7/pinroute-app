// The public pages the directory listing links to: help with example prompts, the privacy policy, the icon.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(null, { MCP_SECRET: 's3cret-path', SUPPORT_EMAIL: 'help@pinroute.example', OPERATOR_NAME: 'Pinroute Test Ltd' }); });
after(() => srv.server.close());

const get = async (p) => { const r = await fetch(`${srv.base}${p}`); return { type: r.headers.get('content-type'), text: await r.text() }; };

test('help explains setup, gives at least three example prompts and a support contact', async () => {
  const { type, text } = await get('/help');
  assert.match(type, /text\/html/);
  assert.match(text, /Add custom connector/);
  assert.ok((text.match(/<li>[^<]*Pinroute[^<]*<\/li>/g) || []).length >= 3, 'three or more example prompts');
  assert.match(text, /mailto:help@pinroute\.example/);
  assert.match(text, /Pinroute Test Ltd/);
  assert.match(text, /delete_my_data/);
  assert.doesNotMatch(text, /s3cret-path/, 'the secret never appears on a public page');
});

test('the privacy policy covers collection, use, sharing, retention and contact', async () => {
  const { text } = await get('/privacy');
  for (const part of ['What Pinroute keeps', 'What Pinroute does not keep', 'Who else is involved', 'How long it is kept', 'Your rights', 'help@pinroute.example']) assert.match(text, new RegExp(part), part);
  assert.match(text, /Amadeus/);
  assert.match(text, /Railway/);
});

test('serves the icon as SVG', async () => {
  const { type, text } = await get('/icon.svg');
  assert.match(type, /image\/svg\+xml/);
  assert.match(text, /^<svg /);
});
