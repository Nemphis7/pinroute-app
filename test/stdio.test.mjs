// Local mode: the same server over stdin/stdout, as Claude Desktop runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('runs over stdio with the same tools', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', new URL('../src/stdio.mjs', import.meta.url).pathname],
    env: { ...process.env, FLIGHT_PROVIDER: 'demo', DATA_DIR: mkdtempSync(join(tmpdir(), 'pinroute-')) },
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport);
  try {                                   // a failed check must still stop the child process, or the run never ends
    const { tools } = await client.listTools();
    assert.equal(tools.length, 34);
    const r = await client.callTool({ name: 'create_trip', arguments: { name: 'Test', start: '2026-12-01', adults: 1, stops: [{ place: 'Ao Nang', nights: 2 }, { place: 'Bangkok', nights: 1 }] } });
    assert.equal(r.structuredContent.legs[0].from, 'KBV');
  } finally { await client.close(); }
});
