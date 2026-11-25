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
    const score = el('p', 'name-score', 'Name score ' + (Number.isFinite(item.score) ? item.score + '/100' : 'unknown'));
    score.append(el('span', 'score-band', item.band || 'Band unknown'));
    card.append(score);
    const reasons = el('ul', 'reason-list');
    for (const reason of item.reasons.slice(0, 3)) reasons.append(el('li', '', reason));
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

function detailRow(list, title, text, sources = []) {
  const row = el('div');
  const description = el('dd', '', text);
  for (const source of sources.filter(Boolean)) description.append(' ', source);
  row.append(el('dt', '', title), description);
  list.append(row);
}

function renderDetails(body, data) {
  const list = el('dl');
  const apple = data.appStore;
  const us = data.trademarks?.us;
  const apps = (apple?.matches || []).map(match => sourceLink(match.name, match.url, ['apps.apple.com']));
  detailRow(list, 'App Store', {
    taken: 'Matching app found.', no_match_found: 'No matching app found.'
  }[apple?.status] || 'Unknown.', apps);
  const play = sourceLink('Check Google Play', data.googlePlay?.link, ['play.google.com']);
  detailRow(list, 'Google Play', play ? 'Manual check.' : 'Unknown.', [play]);
  const marks = (us?.marks || []).map(mark => sourceLink(mark.mark, mark.url, ['uspto.gov']));
  detailRow(list, 'US trademarks', {
    exact_match_found: 'Exact live mark found.', no_exact_match_found: 'No exact live word mark found.'
  }[us?.status] || 'Unknown.', [...marks, sourceLink('Search USPTO', us?.searchUrl, ['uspto.gov'])]);
  const profiles = { github: ['github.com'], npm: ['npmjs.com'], bluesky: ['bsky.app'] };
  for (const handle of data.handles || []) {
    const hosts = profiles[String(handle.platform).toLowerCase()];
    if (!Array.isArray(hosts)) continue;
    detailRow(list, handle.platform, {
      taken: 'Taken.', 'not-found': 'No public profile found.'
    }[handle.state] || 'Unknown.', [sourceLink('Check profile', handle.link, hosts)]);
  }
  body.replaceChildren(list);
  if (data.complete === false) body.append(el('p', '', 'Some checks are still unknown.'));
}

function detailsPanel(path, signal) {
  const box = el('details', 'detail-checks');
  const body = el('div');
  const status = statusLine();
  const retry = el('button', 'action', 'Retry checks');
  retry.type = 'button';
  retry.hidden = true;
  let loaded = false;
  let pending = false;
  async function load() {
    if (loaded || pending || signal.aborted) return;
    pending = true;
    retry.hidden = true;
    status.textContent = 'Checking apps, trademarks and handles…';
    try {
      const { loadDetails } = await import('./search-api.mjs');
      const data = await loadDetails(path, signal);
      if (signal.aborted) return;
      renderDetails(body, data);
      status.textContent = '';
      loaded = true;
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error.status === 410 ? 'These checks expired. Search the name again.' :
        error.status === 429 ? rateLimit : 'Couldn’t load these checks. Your domain results are above.';
      retry.hidden = error.status === 410;
    } finally {
      pending = false;
    }
  }
  box.append(el('summary', '', 'Check apps, trademarks and handles'), status, body, retry);
  box.addEventListener('toggle', () => { if (box.open) load(); });
  retry.addEventListener('click', load);
  return box;
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

function updateIdeaCards(list, items, settling = false) {
  const existing = new Map([...list.children].map(row => [row.dataset.name, row]));
  const focused = document.activeElement;
  const focusedRow = focused?.closest('li');
  const linkIndex = focusedRow?.parentElement === list ? [...focusedRow.querySelectorAll('a')].indexOf(focused) : -1;
  const motion = settling && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map(motion ? [...existing.values()].map(row => [row, row.getBoundingClientRect()]) : []);
  let next = list.firstElementChild;
  for (const item of items) {
    const key = nameKey(item.name);
    const card = resultCard('idea', item);
    const row = existing.get(key) || card;
    existing.delete(key);
    row.dataset.name = key;
    if (row !== card && !row.firstElementChild.isEqualNode(card.firstElementChild)) {
      row.replaceChildren(card.firstElementChild);
    }
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
  }
  for (const row of existing.values()) row.remove();
  list.hidden = !list.childElementCount;
  if (linkIndex !== -1 && document.activeElement !== focused && focusedRow.parentElement === list) {
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
  let variantItems = [];
  const showVariants = () => {
    variantList.replaceChildren(...variantItems.map(item => resultCard('name', item)));
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
    updateIdeaCards(ideaList, closeItems(response.items));
    status.textContent = moreNames;
    return api.finishIdeas(response, signal);
  });
  const [variantOutcome, ideaOutcome] = await Promise.allSettled([variants, ideas]);
  if (signal.aborted) return;
  if (variantList.hidden) showVariants();
  const result = ideaOutcome.value ?? preview;
  if (result) updateIdeaCards(ideaList, closeItems(result.items), ideaOutcome.status === 'fulfilled' && !!preview);
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

function nameSlots(response, exact) {
  const items = response.items;
  const best = response.best;
  const query = response.query;
  const fallback = !!query && !query.exactDomain && response.leadingTaken;
  const lead = best && !fallback ? bestDomain(best) : null;
  const rest = lead ? items.filter(item => item.domain !== best.domain) : items;
  const recovery = el('section', 'recovery');
  recovery.setAttribute('aria-label', 'Free names close to yours');
  recovery.hidden = true;
  const more = el('section', 'more-endings');
  more.hidden = true;
  const list = rest.length ? cardList('name', rest, response.shareUrl) : null;
  const parts = [lead, ...(exact ? [list, recovery] : [recovery, list]), more].filter(Boolean);
  return { parts, fallback, recovery, more, empty: !lead && !list };
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
  // Learn the other endings from the bare label; the exact answer above stays as it is.
  const status = statusLine();
  slots.more.append(el('h3', '', 'Other endings for ' + query.ascii), status);
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
  const others = bare.items.filter(item => item.domain !== query.exactDomain);
  for (const item of others) seen.add(item.domain);
  const fallback = bare.leadingTaken;
  const best = !fallback && bare.best?.domain !== query.exactDomain ? bare.best : null;
  if (best) slots.more.append(bestDomain(best));
  const rest = best ? others.filter(item => item.domain !== best.domain) : others;
  if (rest.length) slots.more.append(cardList('name', rest, bare.shareUrl));
  if (!best && !rest.length) status.textContent = 'No other endings could be verified.';
  if (fallback) await recover(query, signal, slots.recovery, seen);
}

const incomplete = 'Some checks didn’t finish. Availability is unknown for the unchecked names.';

function renderIdeas(page, head, input, response, signal) {
  const list = cardList('idea', []);
  const status = statusLine();
  status.classList.add('idea-progress');
  const followUp = el('div');
  const pending = !!response.generationDetails;
  const share = head.querySelector('a');
  page.append(list, status, followUp);

  function render(result, settled, error) {
    const items = uniqueIdeas(result.items);
    updateIdeaCards(list, items, settled && pending && !error);
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
    slots = nameSlots(response, !!response.query?.exactDomain);
    page.append(...slots.parts);
  } else if (items.length) {
    page.append(cardList(mode, items, response.shareUrl));
  }
  if (mode === 'name' ? slots.empty : mode === 'personal' && !items.length) {
    const empty = {
      name: 'No endings could be verified. Try again or check at a registrar.',
      personal: 'No personal domains found for this spelling. Try another version of your name.'
    };
    head.after(el('p', 'results-intro', empty[mode]));
  }
  if (mode !== 'idea' && response.complete === false) page.append(el('p', 'results-intro', incomplete));
  if (mode === 'name' && response.detailsPath) page.append(detailsPanel(response.detailsPath, signal));
  const install = el('aside', 'results-install');
  install.append(el('h3', '', 'Let your agent buy and watch it'), link('Install', '#install', 'action'));
  page.append(install);
  pages.replaceChildren(page);
  region.hidden = false;
  if (slots) followUp(response, signal, slots).catch(() => {});
  return { heading, finish };
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
    if (focusResult) heading.focus();
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
