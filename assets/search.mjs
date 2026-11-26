import { guessMode, normalize } from './search-mode.mjs';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const rateLimit = 'The hound needs a breather. Try again in a few minutes.';
const moreNames = 'Sniffing out more names...';
const region = document.getElementById('search-results');
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
  region.hidden = true;
  pages.replaceChildren();
}

function showPath(selected) {
  for (const path of paths) {
    const open = path === selected;
    path.setAttribute('aria-expanded', String(open));
    document.getElementById(path.getAttribute('aria-controls')).hidden = !open;
  }
}

function payment(label, amount) {
  const pair = el('div');
  pair.append(el('dt', '', label), el('dd', '', usd.format(amount)));
  return pair;
}

// Term, renewal, DNS and date disclosures that travel with every shown price.
function priceNotes(offer) {
  const notes = el('div', 'price-notes');
  const years = offer.minimumYears;
  if (years > 1) {
    notes.append(el('p', 'price-note', years + '-year minimum. ' + usd.format(offer.firstPaymentUsd) +
      ' upfront, then ' + usd.format(offer.renewalPaymentUsd) + ' per ' + years + ' years.'));
  }
  if (offer.threeYearPick) notes.append(el('p', 'price-note', 'Lowest three-year cost · ' + usd.format(offer.threeYearUsd)));
  if (offer.renewalJump) notes.append(el('span', 'jump', 'Renewal jumps'));
  if (offer.needsCloudflareDns) notes.append(el('span', 'price-note', 'Needs Cloudflare DNS'));
  let checked = ' · Price date unknown';
  if (offer.checkedAt) checked = ' · Checked ' + offer.checkedAt.slice(0, 10);
  else if (offer.snapshotDate) checked = ' · Price snapshot ' + offer.snapshotDate.slice(0, 10);
  notes.append(el('p', 'price-note', 'USD before tax' + checked));
  return notes;
}

function bookLink(offer) {
  return link('Book it at ' + offer.shop + ' for ' + usd.format(offer.firstPaymentUsd), offer.buyUrl, 'action');
}

function addPrice(card, actions, offer) {
  const quote = el('dl', 'hunt-quote');
  quote.append(payment('First year', offer.firstYearUsd), payment('Renewal per year', offer.renewalUsd));
  card.append(quote, priceNotes(offer));
  actions.append(bookLink(offer));
}

function resultCard(mode, item, shortlistUrl) {
  const row = el('li');
  const card = el('article', 'hunt-card');
  const identity = el('div', 'result-identity');
  const idea = mode === 'idea';
  const status = item.premium === 'Reserved' ? 'Reserved' :
    { available: 'Available', taken: 'Taken', unknown: 'Unknown' }[item.status] || 'Unknown';
  identity.append(el('h3', idea ? '' : 'domain-title', idea ? item.name : item.domain),
    el('span', 'verdict ' + item.status, status));
  card.append(identity);

  if (idea) {
    card.append(el('p', 'domain-title', item.domain));
    if (item.endings?.length) card.append(suggestionEndings(item.endings));
    const score = el('p', 'name-score', 'Name score ' + (Number.isFinite(item.score) ? item.score + '/100' : 'unknown'));
    score.append(el('span', 'score-band', item.band || 'Band unknown'));
    card.append(score);
    const reasons = el('ul', 'reason-list');
    for (const reason of item.reasons.slice(0, 3)) reasons.append(el('li', '', reason.replace(/^Not checked: /i, 'Score excludes ')));
    if (reasons.childElementCount) card.append(reasons);
    else card.append(el('p', '', 'Score reasons unavailable.'));
  }

  const actions = el('div', 'result-actions');
  if (item.status === 'available' && item.offer && !item.premium) addPrice(card, actions, item.offer);
  else if (item.status === 'unknown') card.append(el('p', '', 'Availability unknown. Verify at a registrar.'));
  else if (item.premium) card.append(el('p', '', item.premium + '. Verify at a registrar.'));
  else if (item.status === 'available') card.append(el('p', '', 'Checkout price unknown. Verify at a registrar.'));
  if (item.eligibility) card.append(el('p', '', item.eligibility.note || item.eligibility.need || 'Eligibility requirements apply.'));
  if (item.note) card.append(el('p', '', item.note));
  if (item.status === 'taken' && /^[^.]+\.[a-z]{2,63}$/i.test(item.domain)) {
    actions.append(link('Watch', '/watch/?domain=' + encodeURIComponent(item.domain)));
  }
  if (item.shareUrl && (idea || item.shareUrl !== shortlistUrl)) actions.append(link('Share', item.shareUrl));
  if (actions.childElementCount) card.append(actions);
  row.append(card);
  return row;
}

// The other confirmed endings of a suggestion: available first, taken after.
function suggestionEndings(endings) {
  const list = el('ul', 'suggestion-endings');
  for (const ending of endings) {
    const row = el('li');
    row.dataset.status = ending.status;
    row.append(el('span', '', ending.domain), ' ',
      el('span', 'verdict ' + ending.status, ending.status === 'available' ? 'Available' : 'Taken'));
    list.append(row);
  }
  return list;
}

// Every taken ending in one quiet group below the available ones, so the person
// sees what was considered and what their agent can do next.
function takenGroup() {
  const box = el('section', 'taken-group');
  const list = el('ul', 'taken-list');
  const next = el('p', '', 'Your agent can find the owner and draft an offer, or watch it for you. ');
  next.append(link('Install', '#install'));
  box.append(el('h3', '', 'Taken'), list, next);
  box.hidden = true;
  return {
    box,
    add(items) {
      for (const item of items) {
        const row = el('li');
        row.append(el('span', 'domain-title', item.domain));
        if (/^[^.]+\.[a-z]{2,63}$/i.test(item.domain)) {
          row.append(' ', link('Watch', '/watch/?domain=' + encodeURIComponent(item.domain)));
        }
        list.append(row);
      }
      box.hidden = !list.childElementCount;
    },
    get count() { return list.childElementCount; }
  };
}

function cardList(mode, items, shortlistUrl) {
  const list = el('ul', 'hunt-list ' + (mode === 'idea' ? 'idea-list' : 'ending-list'));
  for (const item of items) list.append(resultCard(mode, item, shortlistUrl));
  return list;
}

// The server's validated pick: real first-year and renewal amounts, with the same disclosures.
function bestDomain(item) {
  const box = el('section', 'best-domain');
  const title = el('h3', '', 'Best domain: ');
  title.append(el('span', 'domain-title', item.domain));
  box.append(title, el('p', 'best-price', usd.format(item.offer.firstYearUsd) + ' first year, ' +
    usd.format(item.offer.renewalUsd) + ' renewal'), priceNotes(item.offer));
  if (item.note) box.append(el('p', '', item.note));
  const actions = el('div', 'result-actions');
  actions.append(bookLink(item.offer));
  box.append(actions);
  return box;
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

const detailSections = ['appStore', 'googlePlay', 'trademarks', 'handles'];
const detailLabels = { appStore: 'App Store', googlePlay: 'Google Play', trademarks: 'US trademarks', handles: 'Handles' };
const checkingDetails = 'Checking apps, trademarks and handles…';
const autoChecks = 4;

// Known platforms keep their own hosts. A platform the page does not know yet may
// link to a public HTTPS host supplied by the API.
const profileHosts = {
  github: ['github.com'], npm: ['npmjs.com'], bluesky: ['bsky.app'], youtube: ['youtube.com'],
  instagram: ['instagram.com'], x: ['x.com', 'twitter.com'], tiktok: ['tiktok.com'], facebook: ['facebook.com'],
  linkedin: ['linkedin.com'], reddit: ['reddit.com'], twitch: ['twitch.tv'], threads: ['threads.com', 'threads.net']
};
const publicHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const handleStates = {
  taken: ['taken', 'Taken.'], 'not-found': ['clear', 'No public profile found.'], check: ['check', 'Check yourself.']
};

function profileLink(row, platform) {
  if (Object.hasOwn(profileHosts, platform)) return sourceLink('Check profile', row.link, profileHosts[platform]);
  try {
    const url = new URL(row.link);
    return publicHost.test(url.hostname) ? sourceLink('Check profile', url.href, [url.hostname]) : null;
  } catch {
    return null;
  }
}

// One row: a decorative state icon in the term, the plain-words state and links in the description.
function detailRow(title, state, text, sources = []) {
  const row = el('div');
  row.dataset.state = state;
  const term = el('dt');
  const icon = el('span', 'detail-icon');
  icon.setAttribute('aria-hidden', 'true');
  term.append(icon, title);
  const description = el('dd', '', text);
  for (const source of sources.filter(Boolean)) description.append(' ', source);
  row.append(term, description);
  return row;
}

function pendingRows(sections) {
  return sections.map(section => detailRow(detailLabels[section], 'pending', 'Checking…'));
}

function detailRows(data, name) {
  const rows = [];
  const apple = data.appStore;
  const us = data.trademarks?.us;
  const apps = (Array.isArray(apple?.matches) ? apple.matches : []).map(match => sourceLink(match?.name, match?.url, ['apps.apple.com']));
  if (!apps.some(Boolean)) {
    const search = new URL('https://apps.apple.com/us/iphone/search');
    search.searchParams.set('term', name);
    apps.push(link('Search App Store', search.href));
  }
  rows.push(detailRow('App Store', ...({
    taken: ['taken', 'Matching app found.'], no_match_found: ['clear', 'No matching app found.']
  }[apple?.status] || ['unknown', 'Unknown.']), apps));
  const play = sourceLink('Check Google Play', data.googlePlay?.link, ['play.google.com']);
  rows.push(detailRow('Google Play', ...(play ? ['check', 'Manual check.'] : ['unknown', 'Unknown.']), [play]));
  const marks = (Array.isArray(us?.marks) ? us.marks : []).map(mark => sourceLink(mark?.mark, mark?.url, ['uspto.gov']));
  rows.push(detailRow('US trademarks', ...({
    exact_match_found: ['taken', 'Exact live mark found.'], no_exact_match_found: ['clear', 'No exact live word mark found.']
  }[us?.status] || ['unknown', 'Unknown.']), [...marks, sourceLink('Search USPTO', us?.searchUrl, ['uspto.gov'])]));
  const platforms = new Set();
  for (const handle of (Array.isArray(data.handles) ? data.handles : [])) {
    const title = typeof handle?.platform === 'string' ? handle.platform.trim() : '';
    const platform = title.toLowerCase();
    if (!title || platforms.has(platform)) continue;
    platforms.add(platform);
    rows.push(detailRow(title, ...(handleStates[handle.state] || ['unknown', 'Unknown.']), [profileLink(handle, platform)]));
  }
  return rows;
}

// A details response is a snapshot. An incomplete snapshot can be retried manually.
function checksPanel(name, source, signal, { heading = 'h3', pending = detailSections } = {}) {
  const box = el('section', 'detail-checks');
  const status = statusLine();
  const list = el('dl');
  const note = el('p', '', 'Some checks are still unknown.');
  const retry = el('button', 'action', 'Retry checks');
  retry.type = 'button';
  note.hidden = retry.hidden = true;
  const title = heading === 'h3' ? 'Name checks for ' + name : 'Apps, trademarks and handles';
  box.append(el(heading, '', title));
  box.append(status, list, note, retry);
  list.replaceChildren(...pendingRows(pending));
  let path = null;
  let running = false;
  let started = false;
  let done = false;
  let shown = false;
  async function load() {
    if (running || done || signal.aborted) return;
    running = started = true;
    retry.hidden = note.hidden = true;
    status.textContent = checkingDetails;
    if (!shown) list.replaceChildren(...pendingRows(pending));
    try {
      const api = await import('./search-api.mjs');
      if (!path) {
        const found = await source(api);
        if (signal.aborted) return;
        path = found.path;
        pending = found.pending || pending;
        if (!shown) list.replaceChildren(...pendingRows(pending));
      }
      const data = await api.loadDetails(path, signal);
      if (signal.aborted) return;
      list.replaceChildren(...detailRows(data, name));
      shown = true;
      done = data.complete !== false;
      status.textContent = '';
      note.hidden = retry.hidden = done;
    } catch (error) {
      if (signal.aborted) return;
      if (!shown) list.replaceChildren();
      status.textContent = error.status === 410 ? 'These checks expired. Search the name again.' :
        error.status === 429 ? rateLimit : 'Couldn’t load these checks. Your domain results are above.';
      retry.hidden = [400, 410].includes(error.status);
    } finally {
      running = false;
    }
  }
  retry.addEventListener('click', load);
  return { box, loadOnce: () => { if (!started) load(); } };
}

// Wait for the ranking before spending the four automatic checks. Preview
// cards can still be opened, and a name keeps its lookup across list updates.
function attachChecks(card, item, automatic, checks) {
  const key = nameKey(item.name);
  let panel = checks.panels.get(key);
  if (!panel) {
    const source = api => Object.hasOwn(item, 'detailsPath')
      ? { path: item.detailsPath } : api.nameChecks(item.name, checks.signal);
    panel = checksPanel(item.name, source, checks.signal, { heading: 'h4' });
    panel.node = panel.box;
    if (!automatic) {
      panel.node = el('details', 'suggestion-checks');
      panel.node.append(el('summary', '', 'Name checks for ' + item.name), panel.box);
      panel.node.addEventListener('toggle', event => { if (event.currentTarget.open) panel.loadOnce(); });
    }
    checks.panels.set(key, panel);
  }
  if (automatic) {
    if (panel.node !== panel.box) {
      panel.node.replaceWith(panel.box);
      panel.node = panel.box;
    }
    panel.loadOnce();
  }
  if (panel.node.parentElement !== card) card.append(panel.node);
}

function steering(items, idea) {
  const form = el('form', 'steer-form');
  const title = el('h3', '', 'Which two do you love, and which one do you hate?');
  const choices = el('div', 'steer-choices');
  const names = [...new Set(items.map(item => item.name))];
  const selects = ['Love most', 'Also love', 'Hate'].map(label => {
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
  form.append(title, choices, submit, status);
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
      status.textContent = 'Choose at least one name for the next round.';
      selects[0].focus();
      return;
    }
    search('idea', { idea, round: 2, wanted: [first, second].filter(Boolean), avoid: disliked ? [disliked] : [] }, status, submit);
  });
  return form;
}

const nameKey = name => String(name).toLowerCase().replace(/[\s-]/g, '');

// Refresh a card's text in place. Its checks panel never leaves the DOM, so
// loaded rows, an open disclosure and focus inside it survive.
function refreshCard(old, fresh, kept) {
  const current = old.cloneNode(true);
  current.querySelector(':scope > .detail-checks, :scope > .suggestion-checks')?.remove();
  if (current.isEqualNode(fresh)) return;
  for (const child of [...old.childNodes]) if (child !== kept) child.remove();
  old.prepend(...fresh.childNodes);
}

function updateIdeaCards(list, items, settling, checks, automaticCount) {
  const existing = new Map([...list.children].map(row => [row.dataset.name, row]));
  const focused = document.activeElement;
  let focusedRow = focused;
  while (focusedRow && focusedRow.parentElement !== list) focusedRow = focusedRow.parentElement;
  const linkIndex = focusedRow ? [...focusedRow.querySelectorAll('a')].indexOf(focused) : -1;
  const motion = settling && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map(motion ? [...existing.values()].map(row => [row, row.getBoundingClientRect()]) : []);
  let next = list.firstElementChild;
  items.forEach((item, index) => {
    const key = nameKey(item.name);
    const card = resultCard('idea', item);
    const row = existing.get(key) || card;
    existing.delete(key);
    row.dataset.name = key;
    if (row !== card) refreshCard(row.firstElementChild, card.firstElementChild, checks.panels.get(key)?.node);
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
    attachChecks(row.firstElementChild, item, index < automaticCount, checks);
  });
  for (const row of existing.values()) row.remove();
  list.hidden = !list.childElementCount;
  if (document.activeElement !== focused && focused?.isConnected && list.contains(focused)) {
    focused.focus({ preventScroll: true });
  } else if (linkIndex !== -1 && document.activeElement !== focused && focusedRow.parentElement === list) {
    focusedRow.querySelectorAll('a')[linkIndex]?.focus({ preventScroll: true });
  }
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
  const owner = query.exactDomain || query.ascii + '.com';
  const status = statusLine();
  const heading = el('h3', '', 'Taken. Here are free names close to yours');
  const variantList = cardList('idea', []);
  const ideaList = cardList('idea', []);
  variantList.hidden = ideaList.hidden = true;
  box.append(heading, link('Who owns ' + owner + '? See if it can be bought', '/land/?d=' + encodeURIComponent(owner)),
    variantList, ideaList, status);
  box.hidden = false;
  status.textContent = 'Sniffing free names close to yours…';
  const checks = { signal, panels: new Map() };
  let variantItems = [];
  const showVariants = () => {
    variantList.replaceChildren(...variantItems.map((item, index) => {
      const row = resultCard('name', item);
      if (item.detailsPath) attachChecks(row.firstElementChild, item, index < autoChecks, checks);
      return row;
    }));
    variantList.hidden = !variantItems.length;
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
    updateIdeaCards(ideaList, closeItems(response.items), false, checks, 0);
    status.textContent = moreNames;
    return api.finishIdeas(response, signal);
  });
  const [variantOutcome, ideaOutcome] = await Promise.allSettled([variants, ideas]);
  if (signal.aborted) return;
  if (variantList.hidden) showVariants();
  const result = ideaOutcome.value ?? preview;
  if (result) updateIdeaCards(ideaList, closeItems(result.items), ideaOutcome.status === 'fulfilled' && !!preview,
    checks, autoChecks - variantItems.length);
  const notes = [];
  const failure = (outcome, text) => {
    if (outcome.status !== 'rejected') return;
    notes.push(outcome.reason?.status === 429 ? rateLimit : text);
  };
  failure(variantOutcome, 'Couldn’t check close versions of this name.');
  failure(ideaOutcome, preview && !ideaList.hidden ? 'Couldn’t load more names.' : 'Couldn’t load name ideas.');
  if (!variantList.childElementCount && !ideaList.childElementCount) {
    heading.textContent = 'Taken.';
    if (!notes.length) notes.push('No free names close to yours confirmed yet.');
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

// Name results: the validated pick, then the other available endings in the
// server's quality order, close free names, and every taken ending last.
// Unknown endings are not shown.
function nameSlots(response) {
  const items = response.items;
  const best = response.best;
  const lead = best ? bestDomain(best) : null;
  const available = items.filter(item => item.status === 'available' && item.domain !== best?.domain);
  const list = available.length ? cardList('name', available, response.shareUrl) : null;
  const more = el('div');
  more.hidden = true;
  const recovery = el('section', 'recovery');
  recovery.setAttribute('aria-label', 'Free names close to yours');
  recovery.hidden = true;
  const taken = takenGroup();
  taken.add(items.filter(item => item.status === 'taken'));
  const fallback = !!response.query && !response.query.exactDomain && response.leadingTaken;
  return { parts: [lead, list, more, recovery, taken.count ? taken.box : null].filter(Boolean), fallback, recovery, more, taken,
    empty: !lead && !list && !taken.count };
}

async function followUp(response, signal, slots) {
  const query = response.query;
  if (!query) return;
  const seen = new Set(response.items.map(item => item.domain));
  if (!query.exactDomain) {
    if (slots.fallback) await recover(query, signal, slots.recovery, seen);
    return;
  }
  const exact = response.items.find(item => item.domain === query.exactDomain);
  if (!query.exactDomain.endsWith('.com') || exact?.status !== 'taken') return;
  // Learn the other endings from the bare label and merge them into the same
  // order: available above, taken into the taken group under the exact answer.
  const status = statusLine();
  slots.more.append(status);
  slots.more.hidden = false;
  status.textContent = 'Checking other endings…';
  let bare;
  try {
    const api = await import('./search-api.mjs');
    bare = await api.runSearch('name', { name: query.ascii }, signal);
  } catch (error) {
    if (!signal.aborted) status.textContent = error.status === 429 ? rateLimit : 'Couldn’t check other endings. The result above stands.';
    return;
  }
  if (signal.aborted) return;
  status.textContent = '';
  const others = bare.items.filter(item => !seen.has(item.domain));
  for (const item of others) seen.add(item.domain);
  const best = bare.best && others.some(item => item.domain === bare.best.domain) ? bare.best : null;
  const available = others.filter(item => item.status === 'available' && item.domain !== best?.domain);
  if (best) slots.more.append(bestDomain(best));
  if (available.length) slots.more.append(cardList('name', available, bare.shareUrl));
  slots.taken.add(others.filter(item => item.status === 'taken'));
  if (!best && !available.length && !others.some(item => item.status === 'taken')) {
    status.textContent = 'No other endings could be verified.';
  }
  if (bare.leadingTaken) await recover(query, signal, slots.recovery, seen);
}

const incomplete = 'Some checks didn’t finish. Availability is unknown for the unchecked names.';

function renderIdeas(page, head, input, response, signal) {
  const list = cardList('idea', []);
  const status = statusLine();
  status.classList.add('idea-progress');
  const followUp = el('div');
  const pending = !!response.generationDetails;
  const share = head.querySelector('a');
  const checks = { signal, panels: new Map() };
  page.append(list, status, followUp);

  function render(result, settled, error) {
    const items = uniqueIdeas(result.items);
    updateIdeaCards(list, items, settled && pending && !error, checks, settled ? autoChecks : 0);
    if (result.shareUrl) {
      if (share) share.href = result.shareUrl;
      else head.append(link('Share shortlist', result.shareUrl));
    } else share?.remove();
    if (!settled) {
      status.textContent = moreNames;
      return;
    }
    status.textContent = error ? (items.length ? 'Couldn’t load more names.' : 'Couldn’t finish finding names. Try again in a moment.') : '';
    if (items.length && input.round !== 2) followUp.append(steering(items, input.idea));
    if (!items.length && !error) status.textContent = 'No available names confirmed within $60 over three years. Try a different description.';
    if (!error && result.complete === false) followUp.append(el('p', 'results-intro', incomplete));
    if (result.generationSource === 'deterministic') {
      followUp.append(el('p', 'results-intro', 'These suggestions use word pairs from your idea.'));
    }
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

function renderPage(mode, input, response, signal) {
  const items = response.items;
  const head = el('header', 'results-head');
  const titles = { idea: input.round === 2 ? 'Your second shortlist.' : 'Your shortlist.', name: input.name, personal: 'Domains for ' + input.fullName };
  const heading = el('h2', '', titles[mode]);
  heading.tabIndex = -1;
  head.append(heading);
  if (response.shareUrl) head.append(link('Share shortlist', response.shareUrl));
  const page = document.createDocumentFragment();
  page.append(head);
  let slots = null;
  let finish = null;
  if (mode === 'idea') {
    finish = renderIdeas(page, head, input, response, signal);
  } else if (mode === 'name') {
    slots = nameSlots(response);
    page.append(...slots.parts);
  } else {
    const available = items.filter(item => item.status === 'available');
    if (available.length) page.append(cardList(mode, available, response.shareUrl));
    const taken = takenGroup();
    taken.add(items.filter(item => item.status === 'taken'));
    if (taken.count) page.append(taken.box);
  }
  if (mode === 'name' ? slots.empty : mode === 'personal' && !items.some(item => item.status !== 'unknown')) {
    const empty = {
      name: 'No endings could be verified. Try again or check at a registrar.',
      personal: 'No personal domains found for this spelling. Try another version of your name.'
    };
    head.after(el('p', 'results-intro', empty[mode]));
  }

  let details = null;
  if (mode === 'name' && response.detailsPath) {
    const found = { path: response.detailsPath, pending: response.detailsPending };
    details = checksPanel(response.query?.name || input.name, () => found, signal, { pending: found.pending });
    page.append(details.box);
  }
  if (!page.querySelector('.taken-group:not([hidden])')) {
    const install = el('aside', 'results-install');
    install.append(el('h3', '', 'Let your agent buy and watch it'), link('Install', '#install', 'action'));
    page.append(install);
  }
  pages.replaceChildren(page);
  region.hidden = false;
  details?.loadOnce();
  if (slots) followUp(response, signal, slots).catch(() => {});
  return { heading, finish };
}

// On a short screen the results start under the hero. When the first result is
// below the fold, bring the results heading to the top once.
function revealResults(heading) {
  let first = heading.parentElement.nextElementSibling;
  while (first?.hidden) first = first.nextElementSibling;
  if (!first || first.getBoundingClientRect().top <= innerHeight * 0.8) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

const loading = {
  idea: 'Finding names and checking the registry…',
  name: 'Checking endings and registrar prices…',
  personal: 'Checking domains for your name…'
};

async function search(mode, input, status, submit) {
  if (submit.hasAttribute('aria-disabled')) return;
  cancelSearch();
  const controller = new AbortController();
  currentSearch = { controller, status, submit };
  if (input.round !== 2) clearResults();
  status.textContent = loading[mode];
  submit.setAttribute('aria-disabled', 'true');
  try {
    const { runSearch, finishIdeas } = await import('./search-api.mjs');
    if (controller.signal.aborted) return;
    const response = await runSearch(mode, input, controller.signal);
    if (controller.signal.aborted) return;
    const focusResult = submit.form.contains(document.activeElement) || document.activeElement === document.body;
    const { heading, finish } = renderPage(mode, input, response, controller.signal);
    status.textContent = '';
    if (focusResult) {
      heading.focus();
      revealResults(heading);
    }
    await finish?.(finishIdeas);
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
    else status.textContent = 'Couldn’t finish the search. Try again in a moment.';
    return status;
  } finally {
    if (!controller.signal.aborted) submit.removeAttribute('aria-disabled');
  }
}

const hints = {
  name: ['Checking a name', 'Use this as an idea instead'],
  idea: ['Finding free names for your idea', 'Search this as a name instead']
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
    run(modeNow());
  });
  switcher?.addEventListener('click', () => {
    override = modeNow() === 'name' ? 'idea' : 'name';
    updateHint();
    field.setCustomValidity('');
    // Already searched this text: run it the other way now and drop the old answer.
    if (submitted !== null && submitted === field.value) {
      cancelSearch();
      run(override);
    }
  });
  field.addEventListener('input', () => {
    field.setCustomValidity('');
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
    cancelSearch();
    clearResults();
    showPath(path);
    document.getElementById(path.getAttribute('aria-controls')).querySelector('input').focus();
  }
}
openLinkedPath();
window.addEventListener('hashchange', openLinkedPath);
