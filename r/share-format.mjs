// Version 2 stores a timestamp and up to five groups of [name, verdict, domain label, endings, facts?].
// A domain starts with a dot when it reuses the group's label. Prices are in integer cents.
// facts is optional and only holds what the local receipt worked out for that name:
// { p: pick row, b: [best value row, three-year payments in cents], j: renewal-jump bit mask by row, t: taken rows, preferred first }.
// Version 1 links have no facts: they decode with no pick or best value and with jumps worked out from their prices.
export const sharePage = 'https://domainhound.dev/r/';
export const shareUrlLimit = 2000;
export const shareNameLimit = 5;
export const shareRecordLimit = 28;
export const shareVersion = '2.';
const versions = { '1.': 1, '2.': 2 };
export const shareVerdicts = [null, 'No conflict found', 'Check first', 'Avoid'];
export const shareStatuses = [
  'Available at the registry',
  'Confirmed at shop',
  'Taken',
  'Taken, possible resale',
  'Not offered for registration',
  'May be premium, price at shop',
  'Premium, price at shop',
  'Check at shop',
  'Check at shop, possibly available based on DNS',
  'Check at shop, likely taken by DNS',
  'Still checking',
];

const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const baseLabel = new RegExp('^' + label + '$');
export const shareDomain = new RegExp('^' + label + '(?:\\.' + label + ')+$');
export const shareName = /^[\p{L}\p{N}\p{M}. -]{1,100}$/u;
const maximumInflatedBytes = 24 * 1024;
const isCents = value => value === null || (Number.isSafeInteger(value) && value >= 0);
const dollars = value => value === null ? null : value / 100;
const isTaken = row => /^Taken\b/.test(row.status);
const factKeys = ['p', 'b', 'j', 't'];

function parseFacts(facts, rows) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.keys(facts).some(key => !factKeys.includes(key))) return null;
  const { p: pick = null, b: best = null, j: jumps = 0, t: taken = [] } = facts;
  const validIndex = index => Number.isInteger(index) && index >= 0 && index < rows.length;
  const available = index => validIndex(index) && ['Available at the registry', 'Confirmed at shop'].includes(rows[index].status);
  if ((pick !== null && !available(pick))
      || (best !== null && !(Array.isArray(best) && best.length === 2 && available(best[0]) && best[1] !== null && isCents(best[1])))
      || !Number.isSafeInteger(jumps) || jumps < 0 || jumps >= 2 ** rows.length
      || !Array.isArray(taken) || new Set(taken).size !== taken.length
      || !taken.every(index => validIndex(index) && isTaken(rows[index]))) return null;
  return {
    records: rows.map((record, index) => ({ ...record, jump: Boolean(jumps & (1 << index)), pick: index === pick,
      ...(best?.[0] === index && { bestValue: dollars(best[1]) }) })),
    takenDomains: taken.map(index => rows[index].domain),
  };
}

// An old link only knows statuses and prices. A renewal over twice the first payment is the same rule the lookup used.
function legacyFacts(rows) {
  const taken = rows.filter(isTaken);
  return {
    records: rows.map(record => ({ ...record, jump: record.now === null || record.renew === null ? null : record.renew > 2 * record.now,
      pick: false })),
    takenDomains: [...taken.filter(record => record.domain.endsWith('.com')), ...taken.filter(record => !record.domain.endsWith('.com'))]
      .map(record => record.domain),
  };
}

function parseReceipt(receipt, version) {
  if (!Array.isArray(receipt) || receipt.length !== 2) return null;
  const [checkedAt, groups] = receipt;
  if (typeof checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(checkedAt)
      || !Number.isFinite(Date.parse(checkedAt)) || new Date(checkedAt).toISOString() !== checkedAt
      || !Array.isArray(groups) || !groups.length || groups.length > shareNameLimit) return null;
  const parsed = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length < 4 || group.length > (version === 1 ? 4 : 5)) return null;
    const [name, verdict, base, records] = group;
    if (typeof name !== 'string' || !shareName.test(name) || !name.trim() || !Number.isInteger(verdict)
        || verdict < 0 || verdict >= shareVerdicts.length
        || typeof base !== 'string' || (base && !baseLabel.test(base))
        || !Array.isArray(records) || !records.length || records.length > shareRecordLimit) return null;
    const endings = [];
    for (const record of records) {
      if (!Array.isArray(record) || record.length !== 5) return null;
      const [part, status, now, renew, term] = record;
      if (typeof part !== 'string') return null;
      const domain = part.startsWith('.') ? base + part : part;
      if (domain.length > 253 || !shareDomain.test(domain)
          || !Number.isInteger(status) || status < 0 || status >= shareStatuses.length
          || !isCents(now) || !isCents(renew) || !Number.isInteger(term) || term < 1 || term > 10) return null;
      endings.push({ domain, status: shareStatuses[status], now: dollars(now), renew: dollars(renew), term });
    }
    const facts = version === 1 ? legacyFacts(endings) : parseFacts(group[4] ?? {}, endings);
    if (!facts) return null;
    parsed.push({ name, verdict: shareVerdicts[verdict], ...facts });
  }
  return { checkedAt, groups: parsed };
}

export async function readShareFragment(fragment) {
  if (typeof fragment !== 'string' || sharePage.length + fragment.length >= shareUrlLimit) return null;
  const version = versions[fragment.slice(1, 3)];
  if (!fragment.startsWith('#') || !version) return null;
  const encoded = fragment.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), value => value.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let size = 0;
      let json = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumInflatedBytes) return null;
        json += decoder.decode(value, { stream: true });
      }
      return parseReceipt(JSON.parse(json + decoder.decode()), version);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    return null;
  }
}
