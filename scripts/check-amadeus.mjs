// One real Amadeus search, to check that your key works: npm run check:amadeus [FROM] [TO]
// Reads AMADEUS_API_KEY from the environment or .env. Prints a short summary, never the key.
import { loadDotEnv } from '../src/env.mjs';
import { searchFlights } from '../src/providers/amadeus.mjs';

loadDotEnv();
const [from = 'BKK', to = 'FRA'] = process.argv.slice(2);
const date = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
if (!process.env.AMADEUS_API_KEY) { console.error('AMADEUS_API_KEY is not set (put it in .env or the host\'s settings).'); process.exit(1); }

try {
  const r = await searchFlights({ origin: from, destination: to, date, adults: 1 });
  console.log(`Key works: ${r.fares.length} offers ${from} → ${to} on ${date}.`);
  for (const f of r.fares.slice(0, 3)) {
    const b = f.bounds[0];
    console.log(`  ${f.currency} ${f.total}  ${f.airline}  ${b.departs.slice(11, 16)} ${b.from} → ${b.arrives.slice(11, 16)} ${b.to}  ${b.stops ? `${b.stops} stop(s)` : 'direct'}`);
  }
  if (r.note) console.log(r.note);
  if (!r.fares.length) console.log('No offers on this route: Amadeus covers a subset of airlines. Try another pair, e.g. npm run check:amadeus LHR CDG');
} catch (e) {
  console.error(e.code === 'network' ? e.message : `Amadeus refused it: ${e.message}`);
  process.exit(1);
}
