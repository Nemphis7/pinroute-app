// Picks the flight source: Amadeus when its key is set, demo data otherwise (FLIGHT_PROVIDER=demo|amadeus overrides).
// Every provider returns the same fare shape, so the tools and the planner never change when a source is swapped.
import * as amadeus from './amadeus.mjs';
import * as demo from './demo.mjs';

export function flightProvider(env = process.env) {
  const want = (env.FLIGHT_PROVIDER || '').toLowerCase();
  if (want === 'demo') return demo;
  if (want === 'amadeus' || env.AMADEUS_API_KEY) return amadeus;
  return demo;
}
