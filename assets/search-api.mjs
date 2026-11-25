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

function bookable(offer, domain) {
  const base = registrars.get(offer?.shop);
  return base && !offer.dataOnly && offer.buyUrl === base + encodeURIComponent(domain) &&
    Number.isInteger(offer.minimumYears) && offer.minimumYears >= 1 &&
    numericPrices.every(key => Number.isFinite(offer[key]) && offer[key] >= 0);
}

function domainItem(row, cap = Infinity) {
  if (typeof row?.domain !== 'string' || row.domain.length > 253 || !shareDomain.test(row.domain)) return null;
  const confirmed = row.status === 'available' && ['rdap-404', 'whois-not-found'].includes(row.evidence) &&
    Number.isFinite(Date.parse(row.checkedAt));
  const status = confirmed ? 'available' : row.status === 'taken' ? 'taken' : 'unknown';
  const premium = row.premium || (row.reason === 'reserved' && 'Reserved');
  const prices = confirmed && !premium && row.priceShown && Array.isArray(row.prices) ? row.prices : [];
  const offers = prices.filter(offer => bookable(offer, row.domain) && offer.threeYearUsd <= cap);
  offers.sort((a, b) => a.firstPaymentUsd - b.firstPaymentUsd || a.threeYearUsd - b.threeYearUsd);
  return { domain: row.domain, status, premium, offer: offers[0] || null,
    note: row.note, eligibility: row.eligibility };
}

// The generator and personal-name endpoints also supply a compact offer for the
// lowest three-year cost. Preserve that basis if a per-shop comparison is absent.
function compactOffer(offer) {
  if (!offer || !Number.isInteger(offer.minimumYears) || offer.minimumYears < 1) return [];
  return [{ ...offer, firstYearUsd: offer.firstPaymentUsd / offer.minimumYears,
    renewalPaymentUsd: offer.renewalPaymentUsd ?? offer.renewalUsd * offer.minimumYears,
    threeYearPick: true }];
}

function ideaItem(entry, snapshotDate) {
  const pick = entry?.domain;
  const row = entry?.domains?.find(candidate => candidate.domain === pick?.domain);
  if (!row || !entry.name) return null;
  const prices = pick.prices ?? compactOffer({ ...pick, checkedAt: null, snapshotDate });
  const item = domainItem({ ...row, priceShown: true, prices }, 60);
  if (!item?.offer) return null;
  const score = entry.score;
  const valid = Number.isInteger(score?.total) && score.total >= 0 && score.total <= 100;
  return { ...item, name: entry.name, score: valid ? score.total : null, band: valid ? score.band : null,
    reasons: Array.isArray(score?.reasons) ? score.reasons.filter(reason => typeof reason === 'string').slice(0, 3) : [],
    shareUrl: shareUrl(entry.share) };
}

function personalItem(row) {
  const prices = row.prices ?? compactOffer(row.bestPrice);
  return domainItem({ ...row, priceShown: true, prices });
}

const detailsPath = /^\/v1\/check\/details\?id=[A-Za-z0-9_-]+$/;

export async function runSearch(mode, input, signal) {
  let data;
  if (mode === 'idea') data = await request('/v1/generate', signal, { ...input, idea: input.idea.replace(/\s+/g, ' ').trim() });
  else if (mode === 'personal') data = await request('/v1/personal', signal, input);
  else if (mode === 'name') data = await request('/v1/check?' + new URLSearchParams({ name: input.name }), signal);
  else throw new Error('Unknown search mode');

  let items;
  if (mode === 'idea') items = data.names.map(entry => ideaItem(entry, data.priceSnapshot?.checkedAt));
  else if (mode === 'personal') items = data.results.map(personalItem);
  else items = data.domains.map(row => domainItem(row));
  return {
    items: items.filter(Boolean), complete: data.complete,
    shareUrl: shareUrl(data.share), generationSource: data.path,
    detailsPath: mode === 'name' && detailsPath.test(data.details?.path) ? data.details.path : null
  };
}

export function loadDetails(path, signal) {
  if (!detailsPath.test(path)) throw new Error('Invalid details path');
  return request(path, signal);
}
