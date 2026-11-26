// All search requests and wire formats stay here.
import { shareDomain, sharePage, shareUrlLimit } from '../r/share-format.mjs';

const hosted = 'https://domainhound-mcp.domainhound.workers.dev';
const configured = document.querySelector('meta[name="domain-hound-api"]')?.content.trim();
const apiBase = new URL(configured || hosted);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(apiBase.hostname);
if (apiBase.username || apiBase.password || (apiBase.protocol !== 'https:' && !(loopback && apiBase.protocol === 'http:'))) {
  throw new Error('Invalid search API origin');
}

async function request(path, signal, body) {
  const post = body !== undefined;
  const timeout = AbortSignal.timeout(path === '/v1/generate' ? 90_000 : 25_000);
  const response = await fetch(new URL(path, apiBase.origin), {
    method: post ? 'POST' : 'GET',
    headers: post ? { 'Content-Type': 'application/json' } : undefined,
    body: post ? JSON.stringify(body) : undefined,
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) throw Object.assign(new Error('Search failed'), { status: response.status });
  return response.json();
}

function shareUrl(share) {
  const href = share?.url;
  return typeof href === 'string' && href.length < shareUrlLimit && href.startsWith(sharePage) &&
    /^#[12]\.[A-Za-z0-9_-]+$/.test(href.slice(sharePage.length)) ? href : null;
}

const registrars = new Map([
  ['Spaceship', 'https://www.spaceship.com/domain-search/?query='],
  ['Dynadot', 'https://www.dynadot.com/domain/search?domain='],
  ['Gandi', 'https://shop.gandi.net/en/domain/suggest?search='],
  ['Cloudflare', 'https://www.cloudflare.com/domains/search/?q=']
]);
const numericPrices = ['firstYearUsd', 'renewalUsd', 'firstPaymentUsd', 'renewalPaymentUsd', 'threeYearUsd'];

function validPrice(offer) {
  return typeof offer?.shop === 'string' && offer.shop.trim() &&
    Number.isInteger(offer.minimumYears) && offer.minimumYears >= 1 &&
    numericPrices.every(key => Number.isFinite(offer[key]) && offer[key] >= 0);
}

function bookable(offer, domain) {
  const base = registrars.get(offer?.shop);
  return base && !offer.dataOnly && offer.buyUrl === base + encodeURIComponent(domain);
}

function domainItem(row, cap = Infinity) {
  if (typeof row?.domain !== 'string' || row.domain.length > 253 || !shareDomain.test(row.domain)) return null;
  const confirmed = row.status === 'available' && ['rdap-404', 'whois-not-found'].includes(row.evidence) &&
    Number.isFinite(Date.parse(row.checkedAt));
  const status = confirmed ? 'available' : row.status === 'taken' ? 'taken' : 'unknown';
  const premium = row.premium || (row.reason === 'reserved' && 'Reserved');
  const prices = confirmed && !premium && row.priceShown && Array.isArray(row.prices) ? row.prices : [];
  const quotes = prices.filter(validPrice).map(offer => ({
    ...offer, buyUrl: bookable(offer, row.domain) ? offer.buyUrl : null
  })).sort((a, b) => a.threeYearUsd - b.threeYearUsd || a.firstPaymentUsd - b.firstPaymentUsd);
  const offer = quotes.find(quote => quote.buyUrl && quote.threeYearUsd <= cap) || null;
  return { domain: row.domain, status, premium, eligibility: row.eligibility, quotes, offer };
}

// The generator and personal-name endpoints also supply a compact offer for the
// lowest three-year cost. Preserve that basis if a per-shop comparison is absent.
function compactOffer(offer) {
  if (!offer || !Number.isInteger(offer.minimumYears) || offer.minimumYears < 1) return [];
  return [{ ...offer, firstYearUsd: offer.firstPaymentUsd / offer.minimumYears,
    renewalPaymentUsd: offer.renewalPaymentUsd ?? offer.renewalUsd * offer.minimumYears }];
}

// The other registry-confirmed endings of one generated name: available first, taken after,
// unknown and premium rows left out.
function suggestionEndings(rows, pickDomain) {
  const seen = new Set([pickDomain]);
  const endings = [];
  for (const row of rows) {
    const item = domainItem(row);
    if (!item || item.premium || item.status === 'unknown' || seen.has(item.domain)) continue;
    seen.add(item.domain);
    endings.push(item);
  }
  return endings.sort((a, b) => (a.status === 'available' ? 0 : 1) - (b.status === 'available' ? 0 : 1));
}

function ideaItem(entry, snapshotDate) {
  const pick = entry?.domain;
  const rows = Array.isArray(entry?.domains) ? entry.domains : [];
  const row = rows.find(candidate => candidate?.domain === pick?.domain);
  if (!row || typeof entry.name !== 'string' || !entry.name) return null;
  const prices = pick.prices ?? compactOffer({ ...pick, checkedAt: null, snapshotDate });
  const item = domainItem({ ...row, priceShown: true, prices }, 60);
  if (!item?.offer) return null;
  const score = entry.score;
  const valid = Number.isInteger(score?.total) && score.total >= 0 && score.total <= 100;
  return { ...item, name: entry.name, score: valid ? score.total : null, band: valid ? score.band : null,
    reasons: Array.isArray(score?.reasons) ? score.reasons.filter(reason => typeof reason === 'string').slice(0, 3) : [],
    endings: suggestionEndings(rows, item.domain), shareUrl: shareUrl(entry.share) };
}

function personalItem(row) {
  const prices = row.prices ?? compactOffer(row.bestPrice);
  return domainItem({ ...row, priceShown: true, prices });
}

const detailsPath = /^\/v1\/check\/details\?id=[A-Za-z0-9_-]+$/;
// The server's pick is shown only when it names a registry-confirmed row and
// matches one of that row's bookable registrar offers to the cent.
const pickTerms = ['firstPaymentUsd', 'renewalUsd', 'renewalPaymentUsd', 'minimumYears', 'threeYearUsd'];

function bestItem(data) {
  const pick = data.choice?.pick;
  if (typeof pick?.domain !== 'string') return null;
  const row = data.domains.find(candidate => candidate?.domain === pick.domain);
  const item = row && !row.eligibility ? domainItem(row) : null;
  if (item?.status !== 'available' || item.premium || !row.priceShown || !Array.isArray(row.prices)) return null;
  const matched = item.quotes.some(offer => offer.buyUrl && offer.shop === pick.shop &&
    offer.buyUrl === pick.buyUrl && pickTerms.every(key => offer[key] === pick[key]) &&
    Boolean(offer.needsCloudflareDns) === Boolean(pick.needsCloudflareDns));
  return matched ? item : null;
}

const asciiLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function checkedQuery(query) {
  if (typeof query?.ascii !== 'string' || !asciiLabel.test(query.ascii)) return null;
  const exactDomain = typeof query.exactDomain === 'string' && shareDomain.test(query.exactDomain) &&
    query.exactDomain.startsWith(query.ascii + '.') ?
    query.exactDomain : null;
  return { name: typeof query.name === 'string' && query.name ? query.name : query.ascii, ascii: query.ascii, exactDomain };
}

// .ai is never an automatic pick for a bare name, so the leading endings skip it.
const leadingEndings = ['com', 'io', 'dev', 'app'];

// True only when every leading ending is confirmed taken. Unknown or missing rows never count.
function leadingTaken(items, ascii) {
  return leadingEndings.every(ending => items.some(item => item.domain === ascii + '.' + ending && item.status === 'taken'));
}

// Generator version 2 answers first with stage "initial" and a details handle,
// then finishIdeas polls /v1/generate/details until stage "final". A response
// without a stage is the version 1 single answer and counts as final.
const generationPath = '/v1/generate/details';
const defaultPollMs = 1_500;

function pollDelay(value, fallback = null) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function generationDetails(details) {
  const id = details?.id;
  const expiresAt = typeof details?.expiresAt === 'number' ? details.expiresAt : Date.parse(details?.expiresAt);
  const pollAfterMs = pollDelay(details?.pollAfterMs);
  if (details?.path !== generationPath || typeof id !== 'string' || !id || id.length > 512 ||
    !Number.isFinite(expiresAt) || pollAfterMs === null) return null;
  return { id, path: generationPath, expiresAt, pollAfterMs };
}

// The contract has no per-name ban or generic marker today; banned words are
// dropped by the generator. Only an explicit boolean flag hides a name here.
function flagged(entry) {
  return entry?.banned === true || entry?.generic === true;
}

function ideaResult(data) {
  if (!Array.isArray(data?.names)) throw new Error('Invalid generator response');
  const initial = data.stage === 'initial';
  const items = data.names.filter(entry => !flagged(entry))
    .map(entry => ideaItem(entry, data.priceSnapshot?.checkedAt))
    .filter(Boolean);
  // The initial list keeps the generator's order so early cards stay put.
  if (!initial) items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    items, complete: data.complete, shareUrl: shareUrl(data.share), generationSource: data.path,
    generationDetails: initial ? generationDetails(data.details) : null
  };
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

export async function finishIdeas(result, signal) {
  const details = result?.generationDetails;
  if (!details) throw new Error('Nothing to finish');
  let wait = details.pollAfterMs;
  for (;;) {
    if (Date.now() + wait >= details.expiresAt) throw new Error('Search expired');
    await pause(wait, signal);
    if (Date.now() >= details.expiresAt) throw new Error('Search expired');
    const data = await request(details.path, signal, { id: details.id });
    if (data?.stage === 'final') return ideaResult(data);
    if (data?.stage !== 'pending') throw new Error('Invalid generator response');
    wait = pollDelay(data.retryAfterMs, defaultPollMs);
  }
}

export async function runSearch(mode, input, signal, cap = Infinity) {
  let data;
  if (mode === 'idea') data = await request('/v1/generate', signal, { ...input, idea: input.idea.replace(/\s+/g, ' ').trim() });
  else if (mode === 'personal') data = await request('/v1/personal', signal, input);
  else if (mode === 'name') data = await request('/v1/check?' + new URLSearchParams({ name: input.name }), signal);
  else throw new Error('Unknown search mode');
  if (mode === 'idea') return ideaResult(data);

  const items = mode === 'personal' ? data.results.map(personalItem) : data.domains.map(row => domainItem(row, cap));
  const result = {
    items: items.filter(Boolean), complete: data.complete,
    shareUrl: shareUrl(data.share), generationSource: data.path,
    detailsPath: mode === 'name' && items.some(item => item?.status === 'available') &&
      detailsPath.test(data.details?.path) ? data.details.path : null
  };
  if (mode === 'name') {
    result.best = bestItem(data);
    result.priceDate = data.priceSnapshot?.checkedAt;
    result.query = checkedQuery(data.query);
    result.leadingTaken = !!result.query && leadingTaken(result.items, result.query.ascii);
  }
  return result;
}

// Close names for a taken name: prefixed and suffixed forms without hyphens.
export function variantLabels({ ascii, name }) {
  const stem = (ascii.startsWith('xn--') ? name : ascii).toLowerCase().replace(/[\s-]/g, '');
  if (!/^[\p{L}\p{M}\p{N}]+$/u.test(stem)) return [];
  return ['get' + stem, 'try' + stem, stem + 'hq', stem + 'app'].filter(label => label.length <= 63);
}

export async function closeVariant(label, signal) {
  const response = await runSearch('name', { name: label }, signal);
  return response.best ? { ...response.best, name: label, shareUrl: response.shareUrl,
    endings: response.items.filter(item => item.domain !== response.best.domain), detailsPath: response.detailsPath } : null;
}

// The Worker caps steering names at 40 characters. The idea can still carry the full name.
// Returns the whole idea result so the page can show the preview and call finishIdeas.
export function closeIdeas(name, signal) {
  const input = { idea: 'names like ' + name };
  if (name.length <= 40) input.wanted = [name];
  return runSearch('idea', input, signal);
}

export function loadDetails(path, signal) {
  if (!detailsPath.test(path)) throw new Error('Invalid details path');
  return request(path, signal);
}
