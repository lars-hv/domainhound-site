import { guessMode, normalize, validDomainForm } from './search-mode.mjs';
import { askFriend, referral } from './ask-friend.mjs';
import { recordUsage } from './usage.mjs';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const priceDay = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const rateLimit = 'Too many searches. Try again in a few minutes.';
const moreNames = 'Sniffing out more names…';
const region = document.getElementById('search-results');
const announcement = document.getElementById('result-announcement');
const pages = document.getElementById('result-pages');
const paths = [...document.querySelectorAll('.search-paths a')];
let currentSearch;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function link(label, href, className) {
  const node = el('a', className, label);
  node.href = href;
  return node;
}

function statusLine() {
  const node = el('p', 'hunt-status');
  node.setAttribute('role', 'status');
  return node;
}

function cancelSearch() {
  if (!currentSearch) return;
  currentSearch.controller.abort();
  currentSearch.status.textContent = '';
  currentSearch.submit.removeAttribute('aria-disabled');
  currentSearch = null;
}

function clearResults() {
  document.dispatchEvent(new CustomEvent('watch-suggestion'));
  document.getElementById('real-search').hidden = false;
  region.hidden = true;
  pages.replaceChildren();
  announcement.textContent = '';
}

function showPath(selected) {
  for (const path of paths) {
    const open = path === selected;
    path.setAttribute('aria-expanded', String(open));
    document.getElementById(path.getAttribute('aria-controls')).hidden = !open;
  }
}

const topEndings = ['.com', '.ai', '.io'];
const endingOf = domain => domain.slice(domain.indexOf('.'));

const visibleShops = 3;
const trackedShops = new Set(['Spaceship', 'Porkbun', 'Namecheap', 'Dynadot', 'Gandi', 'Cloudflare']);

function trackBuy(anchor, shop, domain) {
  if (!trackedShops.has(shop)) return;
  const ending = endingOf(domain).slice(1);
  if (!/^(?:[a-z0-9-]{1,63}|co\.uk)$/.test(ending)) return;
  const count = () => recordUsage('buy', shop.toLowerCase(), ending);
  anchor.addEventListener('click', count);
  anchor.addEventListener('auxclick', event => {
    if (event.button === 1) count();
  });
}

function shopTable(item, canBuy) {
  const table = el('table', 'shop-table');
  table.setAttribute('aria-label', 'Shop prices for ' + item.domain);
  const header = table.createTHead().insertRow();
  for (const title of ['Shop', 'Year 1', 'Per year', '3 years']) {
    const cell = el('th', '', title);
    cell.scope = 'col';
    header.append(cell);
  }
  let body = table.createTBody();
  for (const [index, quote] of item.quotes.entries()) {
    if (index === visibleShops) {
      body = table.createTBody();
      body.hidden = true;
    }
    const row = body.insertRow();
    const shop = el('th');
    shop.scope = 'row';
    const linked = canBuy && quote.buyUrl && quote.threeYearUsd <= item.cap;
    const name = el(linked ? 'a' : 'span', 'shop-name', quote.shop);
    if (linked) {
      name.href = quote.buyUrl;
      trackBuy(name, quote.shop, item.domain);
    }
    shop.append(name);
    if (quote.threeYearUsd === item.quotes[0].threeYearUsd) shop.append(el('small', 'lowest', 'Cheapest'));
    if (!quote.buyUrl) shop.append(el('small', '', 'Price only'));
    row.append(shop);
    for (const amount of [quote.firstYearUsd, quote.renewalUsd, quote.threeYearUsd]) {
      row.insertCell().textContent = usd.format(amount);
    }
  }
  if (!body.hidden) return table;
  const extra = body.rows.length;
  const label = '+' + extra + (extra === 1 ? ' more shop' : ' more shops');
  const more = el('button', 'more-shops', label);
  more.type = 'button';
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => {
    if (body.hidden) recordUsage('more_shops');
    body.hidden = !body.hidden;
    more.setAttribute('aria-expanded', String(!body.hidden));
    more.textContent = body.hidden ? label : 'Show fewer shops';
  });
  const comparison = document.createDocumentFragment();
  comparison.append(table, more);
  return comparison;
}

function domainCard(item, best, requested) {
  const card = el('section', best ? 'offer-row best-domain' : 'offer-row');
  card.dataset.domain = item.domain;
  const head = el('div', 'offer-head');
  head.append(el('h4', 'domain-title', item.domain), el('span', 'verdict', 'Available'));
  card.append(head);
  const labels = [requested && 'You asked for this', best && 'Hound’s pick'].filter(Boolean);
  if (labels.length) card.append(el('b', 'pick-label', labels.join(' · ')));
  if (best?.pickBudget != null) card.append(el('p', 'offer-condition',
    'Preferred ending at ' + usd.format(best.pickBudget) + ' or less over 3 years.'));
  const offer = best?.pickPrice ?? item.quotes[0];
  if (offer) {
    const first = el('p', 'first-price');
    first.append(el('strong', '', usd.format(offer.firstYearUsd)), ' first year');
    const total = el('p', 'three-year', usd.format(offer.threeYearUsd) + ' over 3 years at ' + offer.shop);
    card.append(first, el('p', 'renewal', 'Renewal ' + usd.format(offer.renewalUsd) + '/year'), total);
    if (offer.minimumYears > 1) {
      const term = ' for ' + offer.minimumYears + ' years';
      card.append(el('p', 'offer-condition', usd.format(offer.firstPaymentUsd) + term +
        ' upfront. Renewal ' + usd.format(offer.renewalPaymentUsd) + term + '.'));
    }
  } else {
    card.append(el('p', 'offer-condition', 'No standard price listed.'));
  }
  if (item.premium) card.append(el('p', 'offer-condition', item.premium));
  const condition = item.eligibility?.note || item.eligibility?.need;
  const requirement = typeof condition === 'string' && condition.trim();
  if (item.eligibility) card.append(el('p', 'offer-condition', requirement || 'Check who can buy this domain.'));
  const shop = (!item.eligibility || requirement) && item.offer;
  const checks = el('div', 'primary-checks');
  card.append(checks);
  if (shop) {
    const total = shop.threeYearUsd !== offer.threeYearUsd ? ' · ' + usd.format(shop.threeYearUsd) + ' for 3 years' : '';
    const buy = link('Buy at ' + shop.shop + total, shop.buyUrl, 'action');
    buy.setAttribute('aria-label', 'Buy ' + item.domain + ' at ' + shop.shop);
    trackBuy(buy, shop.shop, item.domain);
    card.append(buy);
    if (shop.shop === 'Cloudflare') card.append(el('p', 'offer-condition buy-note', 'Cloudflare requires its own DNS.'));
    if (shop.renewalUsd > 3 * shop.firstYearUsd) {
      card.append(el('p', 'renewal-warning buy-note', 'Renewal at ' + shop.shop + ' costs more than 3 times the first year.'));
    }
  }
  if (item.quotes.length) card.append(shopTable(item, Boolean(shop)));
  const toggle = el('button', 'checks-toggle', 'Name checks');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Name checks for ' + item.domain);
  toggle.setAttribute('aria-expanded', 'false');
  card.append(toggle);
  return card;
}

function dateOf(value) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : 'unknown';
}

function updateFootnote() {
  const note = pages.querySelector('.quote-caption');
  if (!note) return;
  const friendLine = pages.querySelector('.friend-referral');
  if (friendLine) friendLine.hidden = !pages.querySelector('.offer-row');
  const dates = new Set();
  let unknown = 0;
  for (const group of pages.querySelectorAll('.hunt-card')) {
    for (const date of (group.dataset.priceDates || '').split(' ').filter(Boolean)) dates.add(date);
    unknown += Number(group.dataset.unknown || 0);
  }
  const parts = [];
  if (dates.size) {
    const missing = dates.delete('unknown');
    const dated = [...dates].sort().map(date => priceDay.format(new Date(date)));
    if (dated.length) parts.push('Price list dated ' + dated.join(' and ') + '.');
    if (missing) parts.push(dated.length ? 'Some prices are undated.' : 'Price date unknown.');
    parts.push('USD before tax.');
  }
  if (unknown) parts.push(unknown + (unknown === 1 ? ' ending' : ' endings') + ' couldn’t be checked.');
  note.textContent = parts.join(' ');
}

function nameCard(name, items, best, { suggestion, priceDate, requested, showName = Boolean(suggestion) } = {}) {
  const card = el('article', 'hunt-card');
  card.setAttribute('aria-label', name);
  if (showName) card.append(el('h3', '', name));
  const available = items.filter(item => item.status === 'available');
  const shared = available.find(item => item.domain === best?.domain) || available[0];
  const quote = best?.pickPrice || shared?.quotes[0];
  card.dataset.voteName = JSON.stringify({ name, domain: shared?.domain ?? null, pick: Boolean(shared && shared.domain === best?.domain),
    now: quote?.firstPaymentUsd ?? null, renew: quote?.renewalPaymentUsd ?? null, term: quote?.minimumYears ?? 1 });
  card.dataset.conflict = 'unknown';
  const dates = available.flatMap(item => item.quotes.map(quote => dateOf(quote.checkedAt || quote.snapshotDate || priceDate)));
  card.dataset.priceDates = [...new Set(dates)].join(' ');
  card.dataset.unknown = items.filter(item => item.status === 'unknown').length;
  const first = requested?.status === 'available' ? requested : requested ? null
    : available.find(item => item.domain === best?.domain) ?? available[0];
  if (!first) {
    if (!requested) card.append(el('p', 'ending-summary', items.length && items.every(item => item.status === 'taken')
      ? 'All checked endings are taken.' : 'No available endings confirmed.'));
    card.append(el('div', 'primary-checks'));
  }
  if (available.length) {
    const offers = el('div', 'ending-list');
    const ordered = first ? [first, ...available.filter(item => item !== first)] : available;
    for (const item of ordered) offers.append(domainCard(item, item.domain === best?.domain ? best : null, item === requested));
    if (!first) card.append(el('h3', 'alternatives-title', 'Available instead'));
    card.append(offers);
  }
  const taken = items.filter(item => item.status === 'taken' && item !== requested);
  if (taken.length) {
    const priority = topEndings.flatMap(ending => taken.filter(item => endingOf(item.domain) === ending));
    const sorted = [...priority, ...taken.filter(item => !priority.includes(item))];
    const group = el('div', 'taken-group');
    const line = el('p', 'taken-list');
    line.append(el('b', '', 'Taken'));
    for (const item of sorted) {
      const watch = link(endingOf(item.domain), '/watch/?domain=' + encodeURIComponent(item.domain));
      watch.setAttribute('aria-label', 'Watch ' + item.domain);
      line.append(' ', watch);
    }
    const next = el('span', 'taken-next', 'Watch an ending, ');
    next.append(link('ask your agent to draft an offer', '#install'), ', or ', link('hunt for another name', '#name'), '.');
    line.append(' ', next);
    group.append(line);
    card.append(group);
  }
  const reserved = items.filter(item => item.status === 'reserved');
  if (reserved.length) card.append(el('p', 'taken-list', 'Reserved by the registry · ' + reserved.map(item => endingOf(item.domain)).join(', ')));
  if (suggestion) {
    if (Number.isFinite(suggestion.score)) {
      const badge = el('span', 'name-score', 'Name score ' + suggestion.score + '/100');
      card.querySelector('h3').after(badge);
    }
    const foot = el('div', 'suggestion-foot');
    const why = el('details');
    why.append(el('summary', '', 'Why this name?'));
    if (suggestion.band) why.append(el('p', 'score-band', suggestion.band));
    const reasons = el('ul', 'reason-list');
    for (const reason of suggestion.reasons || []) {
      const text = reason.replace(/^Not checked: /i, 'Score excludes ')
        .replace(/(\.[a-z]+) is free\b/gi, '$1 is available').replace(/\bFree (\.[a-z]+)\b/gi, 'Available $1');
      reasons.append(el('li', '', text));
    }
    if (reasons.childElementCount) why.append(reasons);
    if (why.childElementCount > 1) foot.append(why);
    if (suggestion.shareUrl) {
      foot.append(link('Share', suggestion.shareUrl));
      currentSearch?.track.share(suggestion.shareUrl);
    }
    if (foot.childElementCount) card.append(foot);
  }
  return card;
}

function ideaCard(item) {
  const row = el('li');
  row.append(nameCard(item.name, [item, ...(item.endings || [])], item, { suggestion: item }));
  return row;
}

// Details are raw API records. Only the expected source may supply each outbound link.
function sourceLink(label, href, hosts) {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return null;
    return link(label, url.href);
  } catch {
    return null;
  }
}

const platforms = [
  ['LinkedIn', 'www.linkedin.com/company/'], ['X', 'x.com/'], ['Instagram', 'www.instagram.com/'],
  ['Threads', 'www.threads.com/@'], ['TikTok', 'www.tiktok.com/@'], ['YouTube', 'www.youtube.com/@'],
  ['GitHub', 'github.com/'], ['Facebook', 'www.facebook.com/'], ['Twitch', 'www.twitch.tv/'],
  ['Reddit', 'www.reddit.com/user/']
];

function checkLine(title, outcome, target, linkLabel) {
  const line = el('div', 'check-line');
  target.textContent = outcome;
  target.setAttribute('aria-label', [title, outcome, linkLabel].filter(Boolean).join(' · '));
  line.append(el('b', '', title), target);
  return line;
}

function appChecks(data, name, pending) {
  const key = encodeURIComponent(name);
  const apple = data.appStore;
  const match = (Array.isArray(apple?.matches) ? apple.matches : [])
    .map(item => sourceLink('', item?.url, ['apps.apple.com'])).find(Boolean);
  const outcome = row => {
    if (['taken', 'exact_match_found'].includes(row?.status)) return 'Taken';
    if (['no_match_found', 'not-found'].includes(row?.status)) return 'No matching app found';
    return row?.status === 'pending' || (!row && pending) ? 'Still checking' : "Couldn't check";
  };
  const play = data.googlePlay;
  const appleLine = checkLine('App Store (iOS)', outcome(apple),
    match || link('', 'https://apps.apple.com/us/iphone/search?term=' + key));
  if (apple?.source === 'browser') appleLine.dataset.source = 'browser';
  return [
    appleLine,
    checkLine('Google Play (Android)', outcome(play), sourceLink('', play?.link, ['play.google.com']) ||
      link('', 'https://play.google.com/store/search?c=apps&q=' + key), 'Search Google Play'),
  ];
}

function handleChecks(data, name) {
  const handle = encodeURIComponent(name.toLowerCase().replace(/\s+/g, ''));
  const handles = el('div');
  handles.append(el('h5', '', 'Handles'));
  const list = el('div', 'handle-list');
  const rows = Array.isArray(data.handles) ? data.handles : [];
  const outcomes = { taken: 'Taken', 'not-found': 'No profile found', 'not-seen': 'No page found in public archives' };
  for (const [title, base] of platforms) {
    const row = rows.find(item => String(item?.platform).trim().toLowerCase() === title.toLowerCase());
    const hosts = [base.split('/')[0].replace(/^www\./, '')];
    if (title === 'X') hosts.push('twitter.com');
    if (title === 'Threads') hosts.push('threads.net');
    const linkedInSearch = title === 'LinkedIn' && !outcomes[row?.state];
    const fallback = linkedInSearch
      ? 'https://www.linkedin.com/search/results/companies/?' + new URLSearchParams({ keywords: name })
      : 'https://' + base + handle;
    const target = sourceLink('', row?.link, hosts) || link('', fallback);
    const archived = row?.state === 'taken' && Number.isInteger(row.seenYear);
    const outcome = archived ? 'Found in ' + row.seenYear : outcomes[row?.state] ?? "Couldn't check";
    const search = linkedInSearch || row?.state === 'not-seen';
    list.append(checkLine(title, outcome, target, search ? 'Search ' + title : undefined));
  }
  handles.append(list);
  return handles;
}

function trademarkNotice(us, name) {
  const notice = el('aside', 'trademark-warning');
  const marks = Array.isArray(us.marks) && us.marks.length ? us.marks : [{ mark: name }];
  for (const mark of marks) {
    if (!mark) continue;
    const line = el('p', '', 'Heads-up: ');
    line.append(el('strong', '', mark.mark || name), ' has an exact live US trademark match',
      mark.owner ? ' (' + mark.owner + '). ' : '. ');
    line.append(sourceLink('Read the filing', mark.url, ['tsdr.uspto.gov']) ||
      link('Search US trademarks', 'https://tmsearch.uspto.gov/'));
    notice.append(line);
  }
  notice.append(el('p', '', 'Search aid, not legal advice.'));
  return notice;
}

let panelNumber = 0;
let selectedDomain;

function syncChecks() {
  const buttons = [...pages.querySelectorAll('.checks-toggle')];
  const active = buttons.find(button => button.parentElement.dataset.domain === selectedDomain);
  if (active) selectedDomain = active.parentElement.dataset.domain;
  for (const panel of pages.querySelectorAll('.detail-checks')) {
    panel.hidden = !active || !panel.parentElement.contains(active);
    for (const button of panel.parentElement.querySelectorAll('.checks-toggle')) {
      button.setAttribute('aria-expanded', String(button === active));
      button.setAttribute('aria-controls', panel.id);
    }
  }
}

pages.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.matches('.checks-toggle')) {
    const domain = button.parentElement.dataset.domain;
    selectedDomain = selectedDomain === domain ? null : domain;
    syncChecks();
    if (selectedDomain) document.getElementById(button.getAttribute('aria-controls'))?.scrollIntoView({ block: 'nearest' });
  }
});

function checksPanel(name, source, signal, firstChecks = {}, appleName = name) {
  const box = el('section', 'detail-checks');
  box.hidden = true;
  box.id = 'name-checks-' + ++panelNumber;
  box.setAttribute('aria-label', 'Name checks for ' + name);
  const list = el('div', 'check-grid');
  const status = statusLine();
  const retry = el('button', 'hint-switch', 'Retry checks');
  retry.type = 'button';
  retry.hidden = true;
  box.append(el('h4', '', 'Name checks for “' + name + '”'), list, status, retry);
  let host;
  let path;
  let data = firstChecks;
  let pending = Boolean(source);
  let browserApple;
  let checkingApple = false;
  list.append(handleChecks(data, name));

  function showChecks() {
    const slot = host?.querySelector('.primary-checks');
    if (!slot) return;
    const workerApple = data.appStore;
    if (workerApple?.status === 'unknown' && browserApple === undefined && !checkingApple && !signal.aborted) {
      checkingApple = true;
      void import('./search-api.mjs').then(api => api.checkAppStore(appleName, signal)).catch(() => null).then(result => {
        browserApple = result;
        checkingApple = false;
        if (!signal.aborted) showChecks();
      });
    }
    const appStore = !workerApple || ['unknown', 'pending'].includes(workerApple.status)
      ? browserApple ?? (checkingApple ? { status: 'pending' } : workerApple) : workerApple;
    const us = data.trademarks?.us;
    const apps = [appStore?.status, data.googlePlay?.status];
    const appMatch = apps.some(s => ['taken', 'exact_match_found'].includes(s));
    const markMatch = us?.status === 'exact_match_found';
    const clear = apps.every(s => ['no_match_found', 'not-found'].includes(s)) && us?.status === 'no_exact_match_found';
    host.dataset.conflict = markMatch ? (appMatch ? 'both' : 'mark') : appMatch ? 'app' : clear ? 'clear' : 'unknown';
    slot.replaceChildren(...appChecks({ ...data, appStore }, name, pending));
    const track = currentSearch?.controller.signal === signal && currentSearch.track;
    if (['taken', 'exact_match_found'].some(status =>
      status === appStore?.status || status === data.googlePlay?.status)) track?.outcome('app_taken');
    if (us?.status === 'exact_match_found') {
      slot.append(trademarkNotice(us, name));
      track?.outcome('trademark');
    }
    else if (us?.status === 'pending' || (!us && pending)) slot.append(el('p', 'trademark-pending', 'Trademark check still running.'));
    else if (us?.status === 'no_exact_match_found') slot.append(el('p', 'mark-result', 'US trademark: no exact live match found.'));
    else slot.append(el('p', 'trademark-pending', 'US trademark: couldn’t check.'));
  }

  function mount(card) {
    host = card;
    if (card.querySelector('.ending-list') && !card.contains(box)) {
      const foot = card.querySelector('.suggestion-foot');
      if (foot) foot.before(box);
      else card.append(box);
    }
    showChecks();
  }
  async function load() {
    if (!source || signal.aborted) return;
    retry.hidden = true;
    pending = true;
    showChecks();
    status.textContent = 'Checking handles…';
    try {
      const api = await import('./search-api.mjs');
      path ??= await source(api);
      if (signal.aborted) return;
      if (path) {
        const details = await api.loadDetails(path, signal);
        if (signal.aborted) return;
        data = api.mergeChecks(data, details);
        list.replaceChildren(handleChecks(data, name));
        retry.hidden = data.complete !== false;
      }
      status.textContent = retry.hidden ? '' : 'Some checks are still pending.';
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error.status === 410 ? 'These checks expired. Search the name again.' :
        error.status === 429 ? rateLimit : 'Couldn’t load these checks.';
      retry.hidden = [400, 410].includes(error.status);
    } finally {
      pending = false;
      for (const row of [data.appStore, data.googlePlay, data.trademarks?.us]) {
        if (row?.status === 'pending') row.status = 'unknown';
      }
      if (!signal.aborted) showChecks();
    }
  }
  retry.addEventListener('click', load);
  function update(first, term = appleName) {
    data = { ...data, ...first };
    appleName = term;
    showChecks();
  }
  return { box, load, mount, update };
}

// The generator may know only the winning ending. Reuse the domain lookup
// needed for its details token to fill in the rest of the same card.
function refreshDomains(card, item, response, panel) {
  const generated = Boolean(item.domain);
  const initial = generated ? [item, ...item.endings] : item.endings;
  const requested = new Set(initial.map(row => row.domain));
  const rows = new Map(response.items.filter(row => generated || requested.has(row.domain)).map(row => [row.domain, row]));
  for (const row of initial) if (!rows.has(row.domain)) rows.set(row.domain, row);
  const selected = rows.get(item.domain);
  const best = response.best || (selected?.status === 'available' && selected.offer ? selected : null);
  const summary = generated ? item : null;
  const fresh = nameCard(item.name, [...rows.values()], best, { suggestion: summary, priceDate: response.priceDate, showName: true });
  const focused = card.contains(document.activeElement) ? document.activeElement : null;
  refreshCard(card, fresh);
  panel.mount(card);
  panel.update(response.firstChecks, response.query?.name);
  syncChecks();
  updateFootnote();
  restoreControl(card, focused);
}

function attachChecks(card, item, checks, load = true) {
  const key = nameKey(item.name);
  let panel = checks.panels.get(key);
  if (!panel?.queued) {
    const source = Object.hasOwn(item, 'detailsPath') ? () => item.detailsPath : async api => {
      const response = await api.runSearch('name', { name: item.name }, checks.signal, item.domain ? 60 : Infinity);
      if (checks.signal.aborted) return null;
      refreshDomains(card, item, response, panel);
      return card.contains(panel.box) ? response.detailsPath : null;
    };
    panel = checksPanel(item.name, source, checks.signal, item.firstChecks ?? {});
    checks.panels.set(key, panel);
  }
  panel.mount(card);
  if (load && !panel.queued) {
    panel.queued = true;
    checks.queue.push(panel);
  }
  drainChecks(checks);
}

function checkQueue(signal) {
  return { signal, panels: new Map(), queue: [], active: 0 };
}

function drainChecks(checks) {
  while (!checks.signal.aborted && checks.active < 4 && checks.queue.length) {
    checks.active++;
    checks.queue.shift().load().finally(() => {
      checks.active--;
      drainChecks(checks);
    });
  }
}

function steering(items, idea) {
  const form = el('form', 'steer-form');
  const choices = el('div', 'steer-choices');
  const names = [...new Set(items.map(item => item.name))];
  const selects = ['Like', 'Also like', 'Avoid'].map(label => {
    const field = el('label', '', label);
    const select = el('select');
    select.append(new Option('Choose a name', ''));
    for (const name of names) select.append(new Option(name, name));
    field.append(select);
    choices.append(field);
    return select;
  });
  const status = statusLine();
  const submit = el('button', 'action', 'Find more names');
  submit.type = 'submit';
  form.append(choices, submit, status);
  form.addEventListener('change', () => {
    if (currentSearch?.submit === submit) cancelSearch();
    const selected = selects.map(select => select.value).filter(Boolean);
    for (const select of selects) {
      for (const option of select.options) {
        option.disabled = !!option.value && option.value !== select.value && selected.includes(option.value);
      }
    }
    status.textContent = '';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const [first, second, disliked] = selects.map(select => select.value);
    if (!first && !second && !disliked) {
      status.textContent = 'Choose at least one name.';
      selects[0].focus();
      return;
    }
    search('idea', { idea, round: 2, wanted: [first, second].filter(Boolean), avoid: disliked ? [disliked] : [] }, status, submit);
  });
  return form;
}

const nameKey = name => String(name).toLowerCase().replace(/[\s-]/g, '');

function restoreControl(container, focused) {
  if (!focused || focused === document.activeElement || !container?.isConnected) return;
  const label = focused.getAttribute('aria-label');
  const control = focused.isConnected ? focused : [...container.querySelectorAll('a, button, summary')].find(node =>
    (label && node.getAttribute('aria-label') === label) || (focused.href && node.href === focused.href) ||
    (node.tagName === 'SUMMARY' && focused.tagName === 'SUMMARY' && node.textContent === focused.textContent));
  control?.focus({ preventScroll: true });
}

function refreshCard(old, fresh) {
  if (old.querySelector('.suggestion-foot details[open]')) fresh.querySelector('.suggestion-foot details')?.setAttribute('open', '');
  Object.assign(old.dataset, fresh.dataset);
  old.replaceChildren(...fresh.childNodes);
}

function updateIdeaCards(list, items, settling, checks, loadChecks) {
  const existing = new Map([...list.children].map(row => [row.dataset.name, row]));
  const focused = document.activeElement;
  let focusedRow = focused;
  while (focusedRow && focusedRow.parentElement !== list) focusedRow = focusedRow.parentElement;
  const motion = settling && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map(motion ? [...existing.values()].map(row => [row, row.getBoundingClientRect()]) : []);
  let next = list.firstElementChild;
  items.forEach(item => {
    const key = nameKey(item.name);
    const card = ideaCard(item);
    const row = existing.get(key) || card;
    existing.delete(key);
    row.dataset.name = key;
    if (row !== card) refreshCard(row.firstElementChild, card.firstElementChild);
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
    attachChecks(row.firstElementChild, item, checks, loadChecks);
  });
  for (const row of existing.values()) row.remove();
  list.hidden = !list.childElementCount;
  if (list.isConnected) {
    syncChecks();
    updateFootnote();
  }
  if (focusedRow && list.contains(focusedRow)) restoreControl(focusedRow, focused);
  const nudge = value => Math.max(-8, Math.min(8, value));
  for (const [row, start] of before) {
    if (row.parentElement !== list) continue;
    const end = row.getBoundingClientRect();
    const x = nudge(start.x - end.x);
    const y = nudge(start.y - end.y);
    if (x || y) row.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }],
      { duration: 160, easing: 'ease-out' });
  }
}

// Close names for a taken name: same-name variants and generated names, each
// registry-confirmed and priced. The two sources fail independently.
async function recover(query, signal, box, seenDomains) {
  const api = await import('./search-api.mjs');
  if (signal.aborted) return;
  const status = statusLine();
  const heading = el('h3', '', 'Similar names');
  const variantList = el('ul', 'hunt-list idea-list');
  const ideaList = el('ul', 'hunt-list idea-list');
  variantList.hidden = ideaList.hidden = true;
  heading.hidden = true;
  box.append(heading, variantList, ideaList, status);
  box.hidden = false;
  status.textContent = 'Checking similar names…';
  const checks = checkQueue(signal);
  let variantItems = [];
  const showVariants = () => {
    updateIdeaCards(variantList, variantItems, false, checks, true);
    variantList.hidden = !variantItems.length;
    heading.hidden = variantList.hidden && ideaList.hidden;
  };
  const labels = api.variantLabels(query);
  const variants = Promise.allSettled(labels.map(label => api.closeVariant(label, signal))).then(results => {
    if (signal.aborted) return;
    variantItems = uniqueIdeas(results.map(result => result.value).filter(Boolean), seenDomains, [query.ascii, query.name]);
    if (ideaList.hidden) showVariants();
    const failed = results.filter(result => result.status === 'rejected');
    if (labels.length && failed.length === labels.length) throw failed[0].reason;
  });
  // On completion, variants claim their domains first, even when the preview arrived first.
  const closeItems = items => uniqueIdeas(items, [...seenDomains, ...variantItems.map(item => item.domain)],
    [query.ascii, query.name, ...variantItems.map(item => item.name)]).slice(0, 6);
  let preview;
  const ideas = api.closeIdeas(query.name, signal).then(response => {
    if (signal.aborted || !response.generationDetails) return response;
    preview = response;
    updateIdeaCards(ideaList, closeItems(response.items), false, checks, false);
    heading.hidden = variantList.hidden && ideaList.hidden;
    status.textContent = moreNames;
    return api.finishIdeas(response, signal);
  });
  const [variantOutcome, ideaOutcome] = await Promise.allSettled([variants, ideas]);
  if (signal.aborted) return;
  if (variantList.hidden) showVariants();
  const result = ideaOutcome.value ?? preview;
  if (result) updateIdeaCards(ideaList, closeItems(result.items), ideaOutcome.status === 'fulfilled' && !!preview,
    checks, true);
  heading.hidden = variantList.hidden && ideaList.hidden;
  const notes = [];
  const failure = (outcome, text) => {
    if (outcome.status !== 'rejected') return;
    notes.push(outcome.reason?.status === 429 ? rateLimit : text);
  };
  failure(variantOutcome, 'Couldn’t check similar spellings.');
  failure(ideaOutcome, preview && !ideaList.hidden ? 'Couldn’t load more names.' : 'Couldn’t load name ideas.');
  if (variantList.childElementCount || ideaList.childElementCount) box.append(voteFromCards(box));
  if (!variantList.childElementCount && !ideaList.childElementCount) {
    if (!notes.length) notes.push('We couldn’t confirm any similar names are available.');
  }
  status.textContent = [...new Set(notes)].join(' ');
}

function uniqueIdeas(items, excludedDomains = [], excludedNames = []) {
  const domains = new Set(excludedDomains);
  const names = new Set(excludedNames.map(nameKey));
  return items.filter(item => {
    const name = nameKey(item.name);
    if (domains.has(item.domain) || names.has(name)) return false;
    domains.add(item.domain);
    names.add(name);
    return true;
  });
}

function renderName(page, response, name, requested, signal) {
  const card = nameCard(name, response.items, response.best, { priceDate: response.priceDate, requested });
  page.append(card);
  const panel = checksPanel(name, response.detailsPath && (() => response.detailsPath), signal, response.firstChecks, response.query?.name);
  panel.mount(card);
  panel.load();
  if (!response.items.some(item => item.status === 'available') && response.query?.exactDomain && !response.endingsError) {
    const taken = response.complete && requested?.status === 'taken' && response.items.every(item => item.status === 'taken');
    const line = el('p', 'ending-summary', taken ? 'All checked endings are taken.' : 'No available endings confirmed.');
    const ideas = el('button', 'hint-switch', 'Find new names');
    ideas.type = 'submit';
    ideas.setAttribute('form', 'main-search');
    ideas.dataset.seed = response.query.name;
    line.append(' ', ideas);
    card.querySelector('.primary-checks')?.after(line);
  }
  if (response.endingsError) {
    page.append(el('p', 'hunt-status', response.endingsError === 'rate-limited' ? rateLimit : 'Couldn’t check other endings.'));
  }
  if (response.leadingTaken && !response.query.exactDomain) {
    const recovery = el('section', 'recovery');
    recovery.setAttribute('aria-label', 'Similar names');
    recovery.hidden = true;
    page.append(recovery);
    recover(response.query, signal, recovery, new Set(response.items.map(item => item.domain))).catch(() => {});
  }
}

function renderIdeas(page, sharing, input, response, signal) {
  const list = el('ul', 'hunt-list idea-list');
  const status = statusLine();
  status.classList.add('idea-progress');
  const followUp = el('div');
  const pending = !!response.generationDetails;

  const checks = checkQueue(signal);
  page.append(list, status, followUp);

  function render(result, settled, error) {
    const items = uniqueIdeas(result.items).map(item => item.shareUrl && item.shareUrl === result.shareUrl
      ? { ...item, shareUrl: null } : item);
    updateIdeaCards(list, items, settled && pending && !error, checks, settled);
    const share = sharing.querySelector('a');
    if (result.shareUrl) {
      currentSearch?.track.share(result.shareUrl);
      if (share) share.href = result.shareUrl;
      else sharing.append(link('Share results', result.shareUrl));
    } else share?.remove();
    if (!settled) {
      status.textContent = !items.length && result.suggestions?.length
        ? 'Checking domains for ' + result.suggestions.join(', ') + '…' : moreNames;
      return;
    }
    status.textContent = error ? (items.length ? 'Couldn’t load more names.' : 'Couldn’t finish the search. Try again.') : '';
    if (items.length && input.round !== 2) {
      const refine = el('details', 'refine');
      refine.append(el('summary', '', 'Refine these ideas'), steering(items, input.idea));
      followUp.append(refine);
    }
    if (!items.length && !error) status.textContent = 'No available names confirmed at $60 or less for 3 years. Try another description.';
  }

  render(response, !pending);
  if (!pending) return null;
  const clearProgress = () => { status.textContent = ''; };
  signal.addEventListener('abort', clearProgress, { once: true });
  return async function finish(loadFinal) {
    try {
      const final = await loadFinal(response, signal);
      if (!signal.aborted) render(final, true);
    } catch {
      if (!signal.aborted) render(response, true, true);
    } finally {
      signal.removeEventListener('abort', clearProgress);
    }
  };
}

function voteFromCards(scope, selector = '[data-vote-name]') {
  return askFriend(() => [...scope.querySelectorAll(selector)].map(card =>
    ({ ...JSON.parse(card.dataset.voteName), conflict: card.dataset.conflict })));
}

function renderPage(mode, input, response, signal) {
  const items = response.items;
  const head = el('header', 'results-head');
  const titles = { idea: input.round === 2 ? 'More name ideas' : 'Name ideas', name: input.name, personal: 'Domains for ' + input.fullName };
  const exact = response.query?.exactDomain;
  const requested = exact && items.find(item => item.domain === exact);
  const taken = requested?.status === 'taken';
  const heading = el('h2', '', taken ? exact + ' is taken.' : titles[mode]);
  heading.tabIndex = -1;
  head.append(heading);
  const sharing = el('div', 'result-sharing');
  if (response.shareUrl) {
    sharing.append(link('Share results', response.shareUrl));
    currentSearch?.track.share(response.shareUrl);
  }
  const page = document.createDocumentFragment();
  page.append(head);
  if (taken) {
    const suggestWatch = () => document.dispatchEvent(new CustomEvent('watch-suggestion', { detail: exact }));
    suggestWatch();
    const watch = link('Watch it', '#watch-domain');
    watch.addEventListener('click', suggestWatch);
    watch.setAttribute('aria-label', 'Watch ' + exact);
    const actions = el('p', 'requested-actions');
    actions.append(watch, ' or ', link('ask your agent to draft an offer', '#install'), '.');
    head.append(actions);
  } else if (exact && requested?.status === 'reserved') {
    page.append(el('p', 'hunt-status', exact + ' is reserved by the registry.'));
  } else if (exact && requested?.status !== 'available') {
    page.append(el('p', 'hunt-status', 'Couldn’t confirm ' + exact + '.'));
  }
  let finish = null;
  if (mode === 'idea') {
    finish = renderIdeas(page, sharing, input, response, signal);
  } else if (mode === 'name') {
    renderName(page, response, response.query?.ascii || input.name.split('.')[0], requested, signal);
  } else {
    const groups = new Map();
    const checks = checkQueue(signal);
    for (const item of items) {
      const name = item.domain.split('.')[0];
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    const availableFirst = [...groups].sort(([, a], [, b]) =>
      Number(b.some(item => item.offer)) - Number(a.some(item => item.offer)));
    for (const [name, endings] of availableFirst) {
      const showName = endings.some(item => item.status !== 'unknown');
      const card = nameCard(name, endings, null, { priceDate: response.priceDate, showName });
      page.append(card);
      if (endings.some(item => item.status === 'available')) attachChecks(card, { name, endings }, checks);
    }
  }
  sharing.prepend(el('small', 'quote-caption'));
  page.append(sharing);
  head.append(voteFromCards(pages, mode === 'name' ? ':scope > [data-vote-name]' : '[data-vote-name]'));
  const friendLine = referral();
  friendLine.hidden = true;
  page.append(friendLine);
  pages.replaceChildren(page);
  selectedDomain = null;
  syncChecks();
  updateFootnote();
  region.hidden = false;
  document.getElementById('real-search').hidden = true;

  return { heading, finish };
}

function scrollToAnswer(target, block = 'start') {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block, behavior: reduce ? 'instant' : 'smooth' });
}

const loading = {
  idea: 'Finding name ideas…',
  name: 'Checking domains and prices…',
  personal: 'Checking domains for your name…'
};

function trackSearch(kind) {
  recordUsage('search', 'site', kind);
  const outcomes = new Set();
  const links = new Set();
  return {
    outcome(value) {
      if (outcomes.has(value)) return;
      outcomes.add(value);
      recordUsage('outcome', 'site', kind, value);
    },
    share(url) {
      if (links.has(url)) return;
      links.add(url);
      recordUsage('share_created');
    },
  };
}

async function search(mode, input, status, submit) {
  if (submit.hasAttribute('aria-disabled')) return;
  cancelSearch();
  const form = submit.form;
  const ownsFocus = () => form.contains(document.activeElement) || document.activeElement === document.body;
  function returnToField() {
    if (!ownsFocus()) return;
    form.querySelector('input, select')?.focus({ preventScroll: true });
    scrollToAnswer(form, 'center');
  }
  const controller = new AbortController();
  const kind = mode === 'personal' ? 'own_name' : mode === 'name' && input.name.includes('.') ? 'exact_domain' : mode;
  const track = trackSearch(kind);
  currentSearch = { controller, status, submit, track };
  if (input.round !== 2) clearResults();
  document.getElementById('real-search').hidden = true;
  status.textContent = loading[mode];
  submit.setAttribute('aria-disabled', 'true');
  try {
    const { runSearch, finishIdeas } = await import('./search-api.mjs');
    if (controller.signal.aborted) return;
    let response = await runSearch(mode, input, controller.signal);
    if (controller.signal.aborted) return;
    if (response.generationDetails && !response.items.length && !response.suggestions?.length) {
      status.textContent = moreNames;
      response = await finishIdeas(response, controller.signal);
      if (controller.signal.aborted) return;
    }
    if (!response.suggestions?.length && !response.query?.exactDomain && !response.items.some(item => item.status !== 'unknown')) {
      if (mode === 'idea') status.textContent = 'No available names confirmed at $60 or less for 3 years. Try another description.';
      else if (mode === 'personal' && response.complete !== false && !response.items.length) {
        status.textContent = 'No domains found for this spelling. Try another spelling.';
      } else status.textContent = 'Couldn’t confirm any domains. Try again.';
      track.outcome('pick_no');
      returnToField();
      return status;
    }
    const focusResult = ownsFocus();
    const { heading, finish } = renderPage(mode, input, response, controller.signal);
    status.textContent = '';
    const firstCard = pages.querySelector('.hunt-card:not([hidden])');
    const offer = firstCard?.querySelector('.offer-row');
    const watch = firstCard?.querySelector('.taken-list a');
    if (response.query?.exactDomain) {
      const exact = response.items.find(item => item.domain === response.query.exactDomain);
      const verdict = { available: 'Available', taken: 'Taken', reserved: 'Reserved by the registry' }[exact?.status] || 'Couldn’t confirm';
      announcement.textContent = response.query.exactDomain + ': ' + verdict + '.';
    } else if (offer) announcement.textContent = offer.dataset.domain + ': Available.';
    else if (watch) announcement.textContent = watch.getAttribute('aria-label').slice(6) + ': Taken.';
    if (focusResult) {
      heading.focus({ preventScroll: true });
      scrollToAnswer(heading);
    }
    // An initial ideas card is already visible, even if its check settles later.
    const picked = () => Boolean(pages.querySelector('.best-domain'));
    const hasPick = picked();
    if (hasPick) track.outcome('pick_yes');
    await finish?.(finishIdeas);
    if (!controller.signal.aborted) {
      if (!hasPick) track.outcome(picked() ? 'pick_yes' : 'pick_no');
      if (response.complete && !response.endingsError && response.items.length &&
          (!response.query?.exactDomain || response.items.some(item => item.domain === response.query.exactDomain)) &&
          response.items.every(item => item.status === 'taken')) track.outcome('all_taken');
    }
    return heading;
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 429) status.textContent = rateLimit;
    else if ([400, 422].includes(error.status)) {
      status.textContent = {
        idea: 'Describe your idea in up to 400 characters.',
        name: 'Enter a name or a domain, such as example.com.',
        personal: 'Enter your full name using up to 80 characters.'
      }[mode];
    }
    else if (navigator.onLine === false) status.textContent = 'You’re offline. Reconnect and search again.';
    else if (error.name === 'TimeoutError') status.textContent = 'The search timed out. Try again.';
    else status.textContent = 'Couldn’t finish the search. Try again.';
    returnToField();
    return status;
  } finally {
    if (!controller.signal.aborted) submit.removeAttribute('aria-disabled');
  }
}

const hints = {
  name: ['Name search', 'Search as an idea'],
  idea: ['Name ideas', 'Search as a name']
};

for (const form of document.querySelectorAll('.hunt-form')) {
  const field = form.querySelector('input');
  const submit = form.querySelector('.hunt-submit');
  const hint = form.querySelector('.search-hint');
  const switcher = hint?.querySelector('.hint-switch');
  const status = statusLine();
  form.append(status);
  // A one-click switch overrides the guess until the text changes.
  let override = null;
  let submitted = null;
  const modeNow = () => form.dataset.mode === 'personal' ? 'personal' : override || guessMode(field.value);

  function updateHint() {
    if (!hint) return;
    const mode = modeNow();
    hint.hidden = !mode;
    if (!mode) {
      hint.firstElementChild.textContent = '';
      return;
    }
    const [description, switchLabel] = hints[mode];
    if (hint.firstElementChild.textContent !== description) {
      hint.firstElementChild.textContent = description;
      switcher.textContent = switchLabel;
    }
  }

  async function run(mode) {
    const value = field.value.trim();
    if (mode === 'name' && value.includes('.') && !validDomainForm(normalize(value))) {
      status.textContent = 'Enter a name or a domain, such as example.com.';
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    let problem = '';
    if (!value) problem = mode === 'personal' ? 'Enter your full name using up to 80 characters.' : 'Enter a name or describe your idea.';
    else if (mode === 'personal' && value.length > 80) problem = 'Enter your full name using up to 80 characters.';
    else if (mode === 'idea' && normalize(value).length < 3) problem = 'Describe your idea in at least 3 characters.';
    if (problem) {
      field.setCustomValidity(problem);
      field.reportValidity();
      return;
    }
    if (form.dataset.mode === 'auto') {
      submitted = field.value;
      showPath(null);
    }
    const input = mode === 'personal' ? { fullName: value.replace(/’/g, "'").replace(/\s+/g, ' ') } :
      { [mode]: mode === 'name' ? normalize(value) : value };
    await search(mode, input, status, submit);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const seed = event.submitter?.dataset.seed;
    if (seed) {
      field.value = 'names like ' + seed;
      override = 'idea';
      updateHint();
    }
    run(modeNow());
  });
  switcher?.addEventListener('click', () => {
    override = modeNow() === 'name' ? 'idea' : 'name';
    updateHint();
    field.setCustomValidity('');
    field.removeAttribute('aria-invalid');
    status.textContent = '';
    // Already searched this text: run it the other way now and drop the old answer.
    if (submitted !== null && submitted === field.value) {
      cancelSearch();
      run(override);
    }
  });
  if (form.dataset.mode === 'auto') field.addEventListener('focus', () => {
    document.querySelector('.search-paths').hidden = false;
  });
  field.addEventListener('input', () => {
    field.setCustomValidity('');
    field.removeAttribute('aria-invalid');
    override = null;
    submitted = null;
    updateHint();
    if (currentSearch?.submit === submit) {
      cancelSearch();
      clearResults();
    } else if (currentSearch?.submit.hasAttribute('aria-disabled')) cancelSearch();
    status.textContent = '';
  });
  updateHint();
  submit.disabled = false;
}

for (const path of paths) {
  const panel = document.getElementById(path.getAttribute('aria-controls'));
  path.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const opening = panel.hidden;
    cancelSearch();
    clearResults();
    showPath(opening ? path : null);
    if (opening) panel.querySelector('input').focus();
  });
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelSearch();
    clearResults();
    showPath(null);
    path.focus();
  });
}

function openLinkedPath() {
  const path = paths.find(link => link.hash === location.hash);
  if (path) {
    path.parentElement.hidden = false;
    cancelSearch();
    clearResults();
    showPath(path);
    document.getElementById(path.getAttribute('aria-controls')).querySelector('input').focus();
  }
}
openLinkedPath();
window.addEventListener('hashchange', openLinkedPath);

// The vote page hands a visitor's own search back in a fragment so it stays out of request URLs.
const sharedSearch = new URLSearchParams(location.hash.slice(1)).get('check');
if (sharedSearch && sharedSearch.length <= 100) {
  const field = document.getElementById('name');
  field.value = sharedSearch;
  field.dispatchEvent(new Event('input'));
  history.replaceState(null, '', location.pathname + location.search);
  field.form.requestSubmit();
}
