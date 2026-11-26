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

const registryAvailable = 'Available at the registry';

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
  if (record.status !== registryAvailable) identity.append(element('span', 'status', record.status));
  const prices = element('dl', 'quotes');
  prices.append(price('Upfront', record.now, record.term), price('Renewal', record.renew, record.term, record.jump));
  item.append(identity, prices);
  return item;
}

function takenFooter(name, targets) {
  const base = name.toLowerCase().split('.')[0].replaceAll(' ', '');
  const summary = targets.map(domain => {
    const ending = domain.slice(base.length);
    const sameName = domain.startsWith(base + '.') && (/^\.[^.]+$/.test(ending) || ending === '.co.uk');
    return (sameName ? ending : domain) + ' taken';
  });
  const foot = element('div', 'group-foot');
  const watch = element('a', 'watch-link', 'Watch ' + targets[0]);
  watch.href = '/watch/?domain=' + encodeURIComponent(targets[0]);
  if (summary.length > 2) {
    const details = element('details', 'taken-summary');
    const preview = summary.slice(0, 2).join(' · ') + ' · +' + (summary.length - 2) + ' more';
    details.append(element('summary', '', preview), element('div', '', summary.slice(2).join(' · ')));
    foot.append(details);
  } else {
    foot.append(element('span', 'taken-summary', summary.join(' · ')));
  }
  foot.append(watch);
  return foot;
}

function nameGroup({ name, verdict, records, takenDomains: targets }, checkedAt, checkTime) {
  const card = element('article', 'paper');
  const heading = element('header', 'group-heading');
  heading.append(element('h2', '', name));
  if (verdict) heading.append(element('p', 'verdict', verdict));
  const meta = element('p', 'group-meta');
  const available = records.filter(record => record.status === registryAvailable).length;
  if (available) {
    const mixed = available < records.length;
    meta.append(mixed ? available + (available === 1 ? ' ending' : ' endings') + ' available at the registry · ' : registryAvailable + ' · ');
  }
  const time = element('time', '', checkTime);
  time.dateTime = checkedAt;
  meta.append('Checked ', time);
  heading.append(meta);
  card.append(heading);
  if (targets.length) card.append(takenFooter(name, targets));

  const rows = element('ul', 'domain-list');
  rows.setAttribute('aria-label', 'Domain prices in USD');
  const offers = [];
  const others = [];
  for (const record of records) {
    if (record.status === registryAvailable || record.status === 'Confirmed at shop') offers.push(record);
    else if (!(record.status === 'Taken' && record.now == null && record.renew == null && targets.includes(record.domain))) {
      others.push(record);
    }
  }
  offers.sort((a, b) => (a.now ?? Infinity) - (b.now ?? Infinity));
  for (const record of [...offers, ...others]) rows.append(domainRow(record));
  if (offers.length || others.length) card.append(rows);
  return card;
}

async function showReceipt() {
  const hash = location.hash;
  receipt.hidden = true;
  unavailable.hidden = true;
  copyButton.hidden = true;
  feedback.textContent = '';
  groups.replaceChildren();
  try {
    const data = await readShareFragment(hash);
    if (hash !== location.hash) return;
    if (!data?.groups.length) {
      unavailable.hidden = false;
      return;
    }
    const checkTime = timestamp.format(new Date(data.checkedAt)) + ' UTC';
    groups.replaceChildren(...data.groups.map(group => nameGroup(group, data.checkedAt, checkTime)));
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
    if (url === location.href) feedback.textContent = 'Share link copied.';
  } catch {
    if (url === location.href) feedback.textContent = 'Copy the full link from your address bar.';
  }
});

window.addEventListener('hashchange', showReceipt);
showReceipt();
