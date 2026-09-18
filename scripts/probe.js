import { parseFilterUrl, resolveApiQuery, fetchListings, parseItem, matchesScope, currentProxy } from '../src/olx.js';
import { sleep } from '../src/log.js';
import { config } from '../src/config.js';

const input = process.argv[2];
const runs = parseInt(process.argv[3] ?? '3', 10);
const parsed = input && parseFilterUrl(input);
if (!parsed) {
  console.log('Usage: npm run probe -- "<olx search url>" [runs]');
  process.exit(1);
}

if (config.proxyUrls.length) console.log(`Using ${config.proxyUrls.length} proxy(s), starting with ${currentProxy()}`);
console.log(`Location: ${parsed.locationName} (${parsed.locationId ?? 'none'}), category ${parsed.categoryId}`);
const t0 = Date.now();
const query = await resolveApiQuery(parsed.url);
console.log(`\n1) Page read OK in ${Date.now() - t0} ms. API query:\n   ${query}\n`);

for (let i = 1; i <= runs; i++) {
  const t = Date.now();
  try {
    const items = (await fetchListings(query, parsed.url)).map(parseItem).filter(Boolean);
    const inCity = items.filter((l) => matchesScope(l, { scope: 'city', location_id: parsed.locationId }));
    console.log(`2.${i}) API OK via ${currentProxy() ?? 'direct'} in ${Date.now() - t} ms: ${items.length} ads total, ${inCity.length} in ${parsed.locationName}`);
    if (i === 1) {
      inCity
        .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
        .slice(0, 5)
        .forEach((l) => console.log(`     ${l.postedAt?.slice(0, 10)}  ₹${l.price}  ${l.km} km  ${l.title}  [${l.locality}]  ${l.url}`));
    }
  } catch (err) {
    console.log(`2.${i}) FAILED: ${err.constructor.name}: ${err.message}`);
  }
  if (i < runs) await sleep(15_000);
}
