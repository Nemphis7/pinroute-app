// Local mode: Claude Desktop starts this file itself and talks to it over stdin/stdout, so no hosting is needed.
// Your key stays on your computer (in .env or in Claude Desktop's config). Nothing may be printed to stdout here:
// that channel carries the protocol.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadDotEnv } from './env.mjs';

loadDotEnv();
const { buildServer } = await import('./app.mjs');
await buildServer().connect(new StdioServerTransport());
