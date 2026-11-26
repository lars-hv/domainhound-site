import { guessMode, normalize } from './search-mode.mjs';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const rateLimit = 'The hound needs a breather. Try again in a few minutes.';
const moreNames = 'Sniffing out more names…';
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
  document.getElementById('real-search').hidden = false;
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

const topEndings = ['.com', '.ai', '.io'];
const endingOf = domain => domain.slice(domain.indexOf('.'));

function availableRow(item, best) {
  const row = el('div', best ? 'offer-row best-domain' : 'offer-row');
  row.append(el('strong', 'domain-title', item.domain),
    el('span', 'verdict' + (item.premium ? '' : ' available'), item.premium || 'Available'));
  const offer = item.offer;
  if (offer) {
    const term = offer.minimumYears > 1 ? ' for ' + offer.minimumYears + ' years' : '';
    row.append(el('span', 'price', usd.format(offer.firstPaymentUsd) + (term || ' first year')),
      el('span', 'price', 'Renewal ' + usd.format(offer.renewalPaymentUsd) + (term || '/year')),
      el('span', 'shop', offer.shop));
    const buy = link('Buy', offer.buyUrl, 'action');
    buy.setAttribute('aria-label', 'Buy ' + item.domain + ' at ' + offer.shop);
    row.append(buy);
  } else {
    row.append(el('span', 'price', 'Price unavailable'));
  }
  return row;
}

function watchChip(item, prominent) {
  const chip = link('', '/watch/?domain=' + encodeURIComponent(item.domain), 'taken-chip');
  chip.setAttribute('aria-label', 'Watch ' + item.domain);
  if (prominent) chip.append(el('s', 'domain-title', item.domain), ' Taken · ', el('u', '', 'Watch'));
  else chip.textContent = endingOf(item.domain);
  return chip;
}

function nameCard(name, items, best, suggestion) {
  const card = el('article', 'hunt-card');
  card.setAttribute('aria-label', name);
  if (suggestion) card.append(el('h3', '', name));
  const taken = items.filter(item => item.status === 'taken');
  const top = el('div', 'top-taken');
  for (const ending of topEndings) {
    const item = taken.find(item => endingOf(item.domain) === ending);
    if (item) top.append(watchChip(item, true));
  }
  if (top.childElementCount) card.append(top);
  const offers = el('div', 'ending-list');
  if (best) offers.append(availableRow(best, true));
  for (const item of items) {
    if (item.status === 'available' && item.domain !== best?.domain) offers.append(availableRow(item, false));
  }
  if (offers.childElementCount) card.append(offers);
  if (taken.length) {
    const group = el('div', 'taken-group');
    const lesser = taken.filter(item => !topEndings.includes(endingOf(item.domain)));
    if (lesser.length) {
      const line = el('div', 'taken-list');
      line.append(el('b', '', 'Taken'), ...lesser.map(item => watchChip(item, false)));
      group.append(line);
    }
    const next = el('p', '', 'Your agent can find the owner, draft an offer or watch the domain. ');
    next.append(link('Connect your agent', '#install'));
    group.append(next);
    card.append(group);
  }
  if (suggestion) {
    const foot = el('div', 'suggestion-foot');
    if (Number.isFinite(suggestion.score)) {
      foot.append(el('span', 'name-score', 'Name score ' + suggestion.score + '/100'));
      if (suggestion.band) foot.append(el('span', 'score-band', suggestion.band));
      const reasons = el('ul', 'reason-list');
      for (const reason of suggestion.reasons) {
        const text = reason.replace(/^Not checked: /i, 'Score excludes ').replace(/\bis free\b/gi, 'is available');
        reasons.append(el('li', '', text));
      }
      if (reasons.childElementCount) foot.append(reasons);
    }
    if (suggestion.shareUrl) foot.append(link('Share', suggestion.shareUrl));
    if (foot.childElementCount) card.append(foot);
  }
  return card;
}

function ideaCard(item) {
  const row = el('li');
  row.append(nameCard(item.name, [item, ...(item.endings || [])], item, item));
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
  ['TikTok', 'www.tiktok.com/@'], ['YouTube', 'www.youtube.com/@'], ['GitHub', 'github.com/']
];

function checkChip(title, state, target) {
  const chip = el('span', 'check-chip');
  chip.append(el('b', '', title), ' ');
  target.textContent = state || 'Check';
  target.setAttribute('aria-label', title + ' · ' + target.textContent);
  chip.append(target);
  return chip;
}

function checkGroups(data, name) {
  const key = encodeURIComponent(name);
  const handle = encodeURIComponent(name.toLowerCase().replace(/\s+/g, ''));
  const apple = data.appStore;
  const match = (Array.isArray(apple?.matches) ? apple.matches : [])
    .map(item => sourceLink('App Store', item?.url, ['apps.apple.com'])).find(Boolean);
  const apps = el('div', 'check-line');
  apps.append(el('strong', '', 'Apps'), checkChip('App Store',
    { taken: 'Match found', no_match_found: 'No match found' }[apple?.status],
    match || link('', 'https://apps.apple.com/us/iphone/search?term=' + key)),
    checkChip('Google Play', null, sourceLink('', data.googlePlay?.link, ['play.google.com']) ||
      link('', 'https://play.google.com/store/search?c=apps&q=' + key)));
  const handles = el('div', 'check-line');
  handles.append(el('strong', '', 'Handles'));
  const rows = Array.isArray(data.handles) ? data.handles : [];
  for (const [title, base] of platforms) {
    const row = rows.find(item => String(item?.platform).trim().toLowerCase() === title.toLowerCase());
    const hosts = [base.split('/')[0].replace(/^www\./, '')];
    if (title === 'X') hosts.push('twitter.com');
    const target = sourceLink('', row?.link, hosts) || link('', 'https://' + base + handle);
    handles.append(checkChip(title, { taken: 'Taken', 'not-found': 'No public profile found' }[row?.state], target));
  }
  return [apps, handles];
}

function checksPanel(name, source, signal) {
  const box = el('section', 'detail-checks');
  box.setAttribute('aria-label', 'Name checks for ' + name);
  const list = el('div');
  list.append(...checkGroups({}, name));
  const status = statusLine();
  const retry = el('button', 'hint-switch', 'Retry checks');
  retry.type = 'button';
  retry.hidden = true;
  box.append(list, status, retry);
  let path;
  async function load() {
    if (!source || signal.aborted) return;
    retry.hidden = true;
    status.textContent = 'Checking apps and handles…';
    try {
      const api = await import('./search-api.mjs');
      path ??= await source(api);
      if (signal.aborted) return;
      if (path) {
        const data = await api.loadDetails(path, signal);
        if (signal.aborted) return;
        list.replaceChildren(...checkGroups(data, name));
        retry.hidden = data.complete !== false;
      }
      status.textContent = retry.hidden ? '' : 'Some checks are still pending.';
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error.status === 410 ? 'These checks expired. Search the name again.' :
        error.status === 429 ? rateLimit : 'Couldn’t load these checks. Your domain results are above.';
      retry.hidden = [400, 410].includes(error.status);
    }
  }
  retry.addEventListener('click', load);
  return { box, load };
}

// The generator may know only the winning ending. Reuse the domain lookup
// needed for its details token to fill in the rest of the same card.
function refreshDomains(card, item, response, panel) {
  const generated = Boolean(item.domain);
  const initial = generated ? [item, ...item.endings] : item.endings;
  const rows = new Map(initial.map(row => [row.domain, row]));
  for (const row of response.items) {
    if (generated || rows.has(row.domain)) rows.set(row.domain, row);
  }
  const selected = rows.get(item.domain);
  const best = selected?.status === 'available' && selected.offer ? selected : null;
  const summary = generated ? (best ? item : { name: item.name }) : null;
  const fresh = nameCard(item.name, [...rows.values()], best, summary);
  const focused = card.contains(document.activeElement) ? document.activeElement : null;
  refreshCard(card, fresh, panel);
  const offers = card.querySelector('.ending-list');
  if ([...rows.values()].some(item => item.status === 'available' && !item.premium)) offers.after(panel);
  else panel.remove();
  if (focused?.href && !focused.isConnected) {
    [...card.querySelectorAll('a')].find(node => node.href === focused.href)?.focus({ preventScroll: true });
  }
}

function attachChecks(card, item, checks) {
  const key = nameKey(item.name);
  let panel = checks.panels.get(key);
  if (!panel) {
    const source = Object.hasOwn(item, 'detailsPath') ? () => item.detailsPath : async api => {
      const response = await api.runSearch('name', { name: item.name }, checks.signal, item.domain ? 60 : Infinity);
      if (checks.signal.aborted) return null;
      refreshDomains(card, item, response, panel.box);
      return panel.box.parentElement === card ? response.detailsPath : null;
    };
    panel = checksPanel(item.name, source, checks.signal);
    checks.panels.set(key, panel);
    checks.queue.push(panel);
  }
  const offers = card.querySelector('.ending-list');
  if (offers.nextElementSibling !== panel.box) offers.after(panel.box);
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

// Keep the existing controls when the content has not changed.
function refreshCard(old, fresh, kept) {
  const current = old.cloneNode(true);
  current.querySelector(':scope > .detail-checks')?.remove();
  if (current.isEqualNode(fresh)) return;
  for (const child of [...old.childNodes]) if (child !== kept) child.remove();
  old.prepend(...fresh.childNodes);
}

function updateIdeaCards(list, items, settling, checks, loadChecks) {
  const existing = new Map([...list.children].map(row => [row.dataset.name, row]));
  const focused = document.activeElement;
  let focusedRow = focused;
  while (focusedRow && focusedRow.parentElement !== list) focusedRow = focusedRow.parentElement;
  const linkIndex = focusedRow ? [...focusedRow.querySelectorAll('a')].indexOf(focused) : -1;
  const motion = settling && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map(motion ? [...existing.values()].map(row => [row, row.getBoundingClientRect()]) : []);
  let next = list.firstElementChild;
  items.forEach(item => {
    const key = nameKey(item.name);
    const card = ideaCard(item);
    const row = existing.get(key) || card;
    existing.delete(key);
    row.dataset.name = key;
    if (row !== card) refreshCard(row.firstElementChild, card.firstElementChild, checks.panels.get(key)?.box);
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
    if (loadChecks) attachChecks(row.firstElementChild, item, checks);
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
  const heading = el('h3', '', 'Available names close to yours');
  const variantList = el('ul', 'hunt-list idea-list');
  const ideaList = el('ul', 'hunt-list idea-list');
  variantList.hidden = ideaList.hidden = true;
  box.append(heading, link('Who owns ' + owner + '? See if it can be bought', '/land/?d=' + encodeURIComponent(owner)),
    variantList, ideaList, status);
  box.hidden = false;
  status.textContent = 'Sniffing out similar names…';
  const checks = checkQueue(signal);
  let variantItems = [];
  const showVariants = () => {
    updateIdeaCards(variantList, variantItems, false, checks, true);
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
    updateIdeaCards(ideaList, closeItems(response.items), false, checks, false);
    status.textContent = moreNames;
    return api.finishIdeas(response, signal);
  });
  const [variantOutcome, ideaOutcome] = await Promise.allSettled([variants, ideas]);
  if (signal.aborted) return;
  if (variantList.hidden) showVariants();
  const result = ideaOutcome.value ?? preview;
  if (result) updateIdeaCards(ideaList, closeItems(result.items), ideaOutcome.status === 'fulfilled' && !!preview,
    checks, true);
  const notes = [];
  const failure = (outcome, text) => {
    if (outcome.status !== 'rejected') return;
    notes.push(outcome.reason?.status === 429 ? rateLimit : text);
  };
  failure(variantOutcome, 'Couldn’t check close versions of this name.');
  failure(ideaOutcome, preview && !ideaList.hidden ? 'Couldn’t load more names.' : 'Couldn’t load name ideas.');
  if (!variantList.childElementCount && !ideaList.childElementCount) {
    heading.textContent = 'Taken.';
    if (!notes.length) notes.push('No similar names confirmed available yet.');
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

function nameSlots(response, name, signal) {
  const card = nameCard(name, response.items, response.best);
  if (response.items.some(item => item.status === 'available' && !item.premium)) {
    const panel = checksPanel(name, response.detailsPath && (() => response.detailsPath), signal);
    card.querySelector('.ending-list').after(panel.box);
    panel.load();
  }
  const more = statusLine();
  const recovery = el('section', 'recovery');
  recovery.setAttribute('aria-label', 'Available names close to yours');
  recovery.hidden = true;
  const empty = !card.childElementCount;
  card.hidden = empty;
  return { card, more, recovery, empty };
}

async function followUp(response, signal, slots) {
  const query = response.query;
  if (!query) return;
  const seen = new Set(response.items.map(item => item.domain));
  if (!query.exactDomain) {
    if (response.leadingTaken) await recover(query, signal, slots.recovery, seen);
    return;
  }
  const exact = response.items.find(item => item.domain === query.exactDomain);
  if (!query.exactDomain.endsWith('.com') || exact?.status !== 'taken') return;
  // Learn the other endings from the bare label and merge them into the same
  // name card without duplicating the exact answer.
  const status = slots.more;
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
  const merged = nameSlots({ ...bare, items: [...response.items, ...others], best }, query.name, signal);
  slots.card.replaceWith(merged.card);
  if (!others.some(item => item.status !== 'unknown')) status.textContent = 'No other endings could be verified.';
  if (bare.leadingTaken) await recover(query, signal, slots.recovery, seen);
}

const incomplete = 'Some checks didn’t finish. Availability is unknown for the unchecked names.';

function renderIdeas(page, head, input, response, signal) {
  const list = el('ul', 'hunt-list idea-list');
  const status = statusLine();
  status.classList.add('idea-progress');
  const followUp = el('div');
  const pending = !!response.generationDetails;
  const share = head.querySelector('a');
  const checks = checkQueue(signal);
  page.append(list, status, followUp);

  function render(result, settled, error) {
    const items = uniqueIdeas(result.items);
    updateIdeaCards(list, items, settled && pending && !error, checks, settled);
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
    slots = nameSlots(response, response.query?.ascii || input.name.split('.')[0], signal);
    page.append(slots.card, slots.more, slots.recovery);
  } else {
    const groups = new Map();
    const checks = checkQueue(signal);
    for (const item of items.filter(item => item.status !== 'unknown')) {
      const name = item.domain.split('.')[0];
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    for (const [name, endings] of groups) {
      const card = nameCard(name, endings, null);
      page.append(card);
      if (endings.some(item => item.status === 'available' && !item.premium)) attachChecks(card, { name, endings }, checks);
    }
  }
  if (mode === 'name' ? slots.empty : mode === 'personal' && !items.some(item => item.status !== 'unknown')) {
    const empty = {
      name: 'No endings could be verified. Try again or check at a registrar.',
      personal: 'No personal domains found for this spelling. Try another version of your name.'
    };
    head.after(el('p', 'results-intro', empty[mode]));
  }

  pages.replaceChildren(page);
  region.hidden = false;
  document.getElementById('real-search').hidden = true;
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
  idea: ['Finding available names for your idea', 'Search this as a name instead']
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
  if (form.dataset.mode === 'auto') field.addEventListener('focus', () => {
    document.querySelector('.search-paths').hidden = false;
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
    path.parentElement.hidden = false;
    cancelSearch();
    clearResults();
    showPath(path);
    document.getElementById(path.getAttribute('aria-controls')).querySelector('input').focus();
  }
}
openLinkedPath();
window.addEventListener('hashchange', openLinkedPath);
