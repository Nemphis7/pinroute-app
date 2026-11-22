// Reads KEY=value lines from .env (if present) without overriding variables that are already set.
// Keys such as AMADEUS_API_KEY live here or in the host's settings, never in code or in a chat.
import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(file = new URL('../.env', import.meta.url)) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
