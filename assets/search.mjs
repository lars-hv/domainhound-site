const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const rateLimit = 'The hound needs a breather. Try again in a few minutes.';
const region = document.getElementById('search-results');
const pages = document.getElementById('result-pages');
const tabs = [...document.querySelectorAll('.hunt-tabs [role="tab"]')];
const states = new Map();
let activeMode = 'idea';

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

function setVisiblePage() {
  for (const [mode, state] of states) state.page.hidden = mode !== activeMode;
  region.hidden = !states.get(activeMode).page.hasChildNodes();
}

function selectTab(index) {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
    if (selected) activeMode = panel.querySelector('form').dataset.mode;
  });
  setVisiblePage();
}

function payment(label, amount) {
  const pair = el('div');
  pair.append(el('dt', '', label), el('dd', '', usd.format(amount)));
  return pair;
}

function addPrice(card, actions, offer) {
  const quote = el('dl', 'hunt-quote');
  const years = offer.minimumYears;
  quote.append(payment('First year', offer.firstYearUsd), payment('Renewal per year', offer.renewalUsd));
  card.append(quote);
  const notes = el('div', 'price-notes');
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
  card.append(notes);
  actions.append(link('Book it at ' + offer.shop + ' for ' + usd.format(offer.firstPaymentUsd), offer.buyUrl, 'action'));
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

function detailsPanel(path, state) {
  const box = el('details', 'detail-checks');
  const body = el('div');
  const status = statusLine();
  const retry = el('button', 'action', 'Retry checks');
  retry.type = 'button';
  retry.hidden = true;
  let loaded = false;
  async function load() {
    if (loaded || state.detailsRequest) return;
    const request = new AbortController();
    state.detailsRequest = request;
    retry.hidden = true;
    status.textContent = 'Checking apps, trademarks and handles…';
    try {
      const { loadDetails } = await import('./search-api.mjs');
      const data = await loadDetails(path, request.signal);
      if (!box.isConnected) return;
      renderDetails(body, data);
      status.textContent = '';
      loaded = true;
    } catch (error) {
      if (!box.isConnected) return;
      status.textContent = error.status === 410 ? 'These checks expired. Search the name again.' :
        error.status === 429 ? rateLimit : 'Couldn’t load these checks. Your domain results are above.';
      retry.hidden = error.status === 410;
    } finally {
      if (state.detailsRequest === request) state.detailsRequest = null;
    }
  }
  box.append(el('summary', '', 'Check apps, trademarks and handles'), status, body, retry);
  box.addEventListener('toggle', () => { if (box.open) load(); });
  retry.addEventListener('click', load);
  return box;
}

function steering(state, items, idea) {
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
    search(state, { idea, round: 2, wanted: [first, second].filter(Boolean), avoid: disliked ? [disliked] : [] }, status, submit);
  });
  return form;
}

function renderPage(state, input, response) {
  const { mode } = state;
  const items = mode === 'idea' ? response.items.filter(item => item.status === 'available') : response.items;
  const head = el('header', 'results-head');
  const titles = { idea: input.round === 2 ? 'Your second shortlist.' : 'Your shortlist.', name: input.name, personal: 'Domains for ' + input.fullName };
  const heading = el('h2', '', titles[mode]);
  heading.tabIndex = -1;
  head.append(heading);
  if (response.shareUrl) head.append(link('Share shortlist', response.shareUrl));
  const page = document.createDocumentFragment();
  page.append(head);
  if (items.length) {
    const list = el('ul', 'hunt-list ' + (mode === 'idea' ? 'idea-list' : 'ending-list'));
    for (const item of items) list.append(resultCard(mode, item, response.shareUrl));
    page.append(list);
    if (mode === 'idea' && input.round !== 2) page.append(steering(state, items, input.idea));
  } else {
    const empty = {
      idea: 'No available names confirmed within $60 over three years. Try a different description.',
      name: 'No endings could be verified. Try again or check at a registrar.',
      personal: 'No personal domains found for this spelling. Try another version of your name.'
    };
    page.append(el('p', 'results-intro', empty[mode]));
  }
  if (response.complete === false) page.append(el('p', 'results-intro', 'Some checks didn’t finish. Availability is unknown for the unchecked names.'));
  if (mode === 'idea' && response.generationSource === 'deterministic') {
    page.append(el('p', 'results-intro', 'These suggestions use word pairs from your idea.'));
  }
  if (mode === 'name' && response.detailsPath) page.append(detailsPanel(response.detailsPath, state));
  state.page.replaceChildren(page);
  setVisiblePage();
  return heading;
}

const loading = {
  idea: 'Finding names and checking the registry…',
  name: 'Checking endings and registrar prices…',
  personal: 'Checking domains for your name…'
};

async function search(state, input, status, submit) {
  if (state.pending) return;
  state.pending = true;
  state.detailsRequest?.abort();
  state.detailsRequest = null;
  const refining = input.round === 2;
  if (!refining) state.page.replaceChildren();
  setVisiblePage();
  state.status.textContent = '';
  status.textContent = loading[state.mode];
  state.submit.setAttribute('aria-disabled', 'true');
  submit.setAttribute('aria-disabled', 'true');
  state.field.readOnly = true;
  try {
    const { runSearch } = await import('./search-api.mjs');
    const response = await runSearch(state.mode, input);
    const focusResult = state.mode === activeMode &&
      (state.form.contains(document.activeElement) || state.page.contains(document.activeElement) || document.activeElement === document.body);
    const heading = renderPage(state, input, response);
    status.textContent = '';
    if (focusResult) heading.focus();
  } catch (error) {
    if (error.status === 429) status.textContent = rateLimit;
    else if ([400, 422].includes(error.status)) {
      status.textContent = {
        idea: 'Describe your idea in up to 400 characters.',
        name: 'Enter a name or a domain, such as example.com.',
        personal: 'Enter your full name using up to 80 characters.'
      }[state.mode];
    }
    else if (navigator.onLine === false) status.textContent = 'You’re offline. Reconnect and search again.';
    else if (error.name === 'TimeoutError') status.textContent = 'The search timed out. Try again.';
    else status.textContent = 'Couldn’t finish the search. Try again in a moment.';
  } finally {
    state.pending = false;
    state.field.readOnly = false;
    state.submit.removeAttribute('aria-disabled');
    submit.removeAttribute('aria-disabled');
  }
}

for (const form of document.querySelectorAll('.hunt-form')) {
  const mode = form.dataset.mode;
  const field = document.getElementById(mode);
  const submit = form.querySelector('button');
  const page = el('div');
  const status = statusLine();
  const state = { form, field, mode, page, status, submit, pending: false, detailsRequest: null };
  pages.append(page);
  form.append(status);
  states.set(mode, state);
  const fieldKey = mode === 'personal' ? 'fullName' : mode;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!field.value.trim()) {
      field.setCustomValidity('Enter a ' + (mode === 'idea' ? 'description of your idea.' : 'name to check.'));
      field.reportValidity();
      return;
    }
    search(state, { [fieldKey]: field.value.trim() }, status, submit);
  });
  field.addEventListener('input', () => field.setCustomValidity(''));
  submit.disabled = false;
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', event => {
    const next = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length,
      Home: 0, End: tabs.length - 1
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(next);
    tabs[next].focus();
  });
});
