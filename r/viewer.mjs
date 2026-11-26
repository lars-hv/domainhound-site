import { readShareFragment } from './share-format.mjs';

const receipt = document.getElementById('receipt');
const groups = document.getElementById('groups');
const unavailable = document.getElementById('unavailable');
const copyButton = document.getElementById('copy-link');
const feedback = document.getElementById('copy-feedback');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const timestamp = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function price(label, amount, years, jump = false) {
  const pair = element('div');
  const term = years > 1 ? ' for ' + years + ' years' : '';
  const value = element('dd', '', amount == null ? 'No quote' : usd.format(amount) + term);
  if (jump) value.append(element('span', 'chip jump', 'Renewal jumps'));
  pair.append(element('dt', '', label), value);
  return pair;
}

function domainRow(record) {
  const item = element('li', 'domain-row');
  const identity = element('div');
  const title = element('div', 'domain-title');
  title.append(element('strong', 'domain', record.domain));
  if (record.pick) title.append(element('span', 'chip pick', 'Pick'));
  identity.append(title);
  if (Number.isFinite(record.bestValue)) {
    identity.append(element('span', 'chip best-value', 'Best value · ' + usd.format(record.bestValue) + ' over 3 years'));
  }
  identity.append(element('span', 'status', record.status));
  const prices = element('dl', 'quotes');
  prices.append(price('Due now', record.now, record.term), price('At renewal', record.renew, record.term, record.jump));
  item.append(identity, prices);
  return item;
}

function takenFooter(name, targets) {
  const base = name.toLowerCase().split('.')[0].replaceAll(' ', '');
  const foot = element('div', 'group-foot');
  foot.append(element('strong', '', 'Taken'));
  const extra = element('details', 'taken-summary');
  extra.append(element('summary', '', '+' + (targets.length - 2) + ' more'));
  targets.forEach((domain, index) => {
    const watch = element('a', 'watch-link', domain.startsWith(base + '.') ? domain.slice(base.length) : domain);
    watch.href = '/watch/?domain=' + encodeURIComponent(domain);
    watch.setAttribute('aria-label', 'Watch ' + domain);
    (index < 2 ? foot : extra).append(watch);
  });
  if (targets.length > 2) foot.append(extra);
  return foot;
}

function nameGroup({ name, verdict, records, takenDomains }) {
  const targets = [...new Set([...takenDomains, ...records
    .filter(record => record.status.startsWith('Taken')).map(record => record.domain)])];
  const card = element('article', 'paper');
  const heading = element('header', 'group-heading');
  heading.append(element('h2', '', name));
  if (verdict) heading.append(element('p', 'verdict', verdict));
  card.append(heading);

  const rows = element('ul', 'domain-list');
  rows.setAttribute('aria-label', 'Domain prices in USD');
  const offers = [];
  const others = [];
  for (const record of records) {
    if (record.status === 'Available' || record.status === 'Shop confirmed') offers.push(record);
    else if (!(record.status === 'Taken' && record.now == null && record.renew == null && targets.includes(record.domain))) {
      others.push(record);
    }
  }
  offers.sort((a, b) => (a.now ?? Infinity) - (b.now ?? Infinity));
  for (const record of [...offers, ...others]) rows.append(domainRow(record));
  if (offers.length || others.length) card.append(rows);
  if (targets.length) card.append(takenFooter(name, targets));
  return card;
}

async function showReceipt() {
  const hash = location.hash;
  receipt.hidden = true;
  unavailable.hidden = true;
  copyButton.hidden = true;
  feedback.textContent = '';
  groups.replaceChildren();
  unavailable.querySelector('h2').textContent = hash ? 'We couldn’t read this link.' : 'This link is incomplete.';
  try {
    const data = await readShareFragment(hash);
    if (hash !== location.hash) return;
    if (!data?.groups.length) {
      unavailable.hidden = false;
      return;
    }
    const time = document.getElementById('checked-at');
    time.dateTime = data.checkedAt;
    time.textContent = timestamp.format(new Date(data.checkedAt)) + ' UTC';
    groups.replaceChildren(...data.groups.map(nameGroup));
    receipt.hidden = false;
    copyButton.hidden = false;
  } catch {
    if (hash === location.hash) unavailable.hidden = false;
  }
}

copyButton.addEventListener('click', async () => {
  const url = location.href;
  feedback.textContent = '';
  try {
    await navigator.clipboard.writeText(url);
    if (url === location.href) feedback.textContent = 'Link copied.';
  } catch {
    if (url === location.href) feedback.textContent = 'Copy the full link from your address bar.';
  }
});

window.addEventListener('hashchange', showReceipt);
showReceipt();
