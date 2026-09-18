import { fetch, ProxyAgent } from 'undici';
import { config } from './config.js';
import { sleep, randomBetween } from './log.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const API_BASE = 'https://www.olx.in/api/relevance/v4/search';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const TIMEOUT_MS = 25_000;

// Only OLX traffic goes through the proxy; Telegram stays direct.
const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;

export class BlockedError extends Error {}
export class NetworkError extends Error {}
export class ParseError extends Error {}

export function parseFilterUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)olx\.in$/.test(url.hostname)) return null;
  const category = url.pathname.match(/_c(\d+)/);
  if (!category) return null;
  const location = url.pathname.match(/([a-z0-9-]+)_g(\d+)/i);
  return {
    url: url.toString(),
    categoryId: category[1],
    locationId: location?.[2] ?? null,
    locationName: location ? titleCase(location[1].replace(/-/g, ' ')) : 'All India',
  };
}

async function request(url, accept, referer) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: accept,
        'Accept-Language': 'en-IN,en;q=0.9',
        Referer: referer,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      dispatcher,
    });
  } catch (err) {
    throw new NetworkError(`${err.name}: ${err.cause?.message ?? err.message}`);
  }
  if ([403, 429, 503].includes(res.status)) throw new BlockedError(`HTTP ${res.status}`);
  if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
  return res;
}

// OLX embeds the exact API query it derives from the filter URL in the page state,
// so we read it instead of re-implementing their filter-string grammar.
export async function resolveApiQuery(filterUrl) {
  const res = await request(filterUrl, 'text/html,application/xhtml+xml', 'https://www.olx.in/');
  const html = await res.text();
  const match = html.match(/items#\\u002Fapi\\u002Frelevance\\u002Fv4\\u002Fsearch#([^"]+)"/);
  if (!match) {
    if (/captcha|access denied/i.test(html)) throw new BlockedError('Captcha / access denied page');
    throw new ParseError('Search query not found in OLX page');
  }
  const params = new URLSearchParams(match[1].replace(/\\u0026/g, '&'));
  for (const k of ['page', 'facet_limit', 'location_facet_limit', 'size', 'sorting', 'relaxedfilters']) {
    params.delete(k);
  }
  params.set('sorting', 'desc-creation');
  params.set('relaxedfilters', 'false');
  params.set('lang', 'en-IN');
  return params.toString();
}

export async function fetchListings(apiQuery, referer) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(randomBetween(2000, 5000));
    const res = await request(`${API_BASE}?${apiQuery}&size=${PAGE_SIZE}&page=${page}`, 'application/json', referer);
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      throw new BlockedError('Non-JSON response (likely a bot challenge)');
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new ParseError('Invalid JSON from OLX');
    }
    if (!Array.isArray(body.data)) throw new ParseError('OLX response has no data array');
    all.push(...body.data);
    if (body.data.length < PAGE_SIZE) break;
  }
  return all;
}

export function parseItem(raw) {
  const id = raw?.ad_id ?? raw?.id;
  if (!id) return null;
  const params = Object.fromEntries(
    (raw.parameters ?? []).map((p) => [p.key, p.value_name ?? p.formatted_value ?? p.value])
  );
  const loc = raw.locations_resolved ?? {};
  const km = parseInt(String(params.mileage ?? '').replace(/\D/g, ''), 10);
  return {
    adId: String(id),
    title: raw.title ?? 'Untitled',
    price: raw.price?.value?.raw ?? null,
    year: parseInt(params.year, 10) || null,
    km: Number.isFinite(km) ? km : null,
    fuel: params.petrol ?? null,
    transmission: params.transmission ?? null,
    owner: params.first_owner ?? null,
    city: loc.ADMIN_LEVEL_3_name ?? null,
    locality: loc.SUBLOCALITY_LEVEL_1_name ?? null,
    locationIds: Object.entries(loc)
      .filter(([k]) => k.endsWith('_id'))
      .map(([, v]) => String(v)),
    isDealer: Boolean(raw.is_business),
    sellerName: raw.user_name ?? null,
    imageUrl: raw.images?.[0]?.url?.replace(':443', '') ?? null,
    url: `https://www.olx.in/item/iid-${id}`,
    postedAt: raw.created_at_first ?? raw.created_at ?? null,
  };
}

export function matchesScope(listing, filter) {
  if (filter.scope !== 'city' || !filter.location_id) return true;
  return listing.locationIds.includes(filter.location_id);
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
