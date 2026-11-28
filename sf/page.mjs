const select = document.getElementById('batch-select');
const columns = [...document.querySelectorAll('.column')];
const details = document.querySelector('.batch-details');

async function enableChart() {
  const response = await fetch('/data/sf/endings.json');
  if (!response.ok) return;
  const { batches } = await response.json();
  const choose = batch => {
    const row = batches.find(row => row.batch === batch);
    if (!row) return;
    select.value = batch;
    for (const bar of columns) bar.setAttribute('aria-pressed', String(bar.dataset.batch === batch));
    const share = ending => row.endings[ending]?.pct || 0;
    document.getElementById('batch-summary').textContent =
      `${row.websites} sites · ${share('.com')}% .com · ${share('.ai')}% .ai`;
    details.querySelector('caption').textContent = batch;
    const body = details.querySelector('tbody');
    body.replaceChildren();
    for (const [ending, { count, pct }] of Object.entries(row.endings)) {
      const tr = body.insertRow();
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = ending;
      tr.append(heading);
      tr.insertCell().textContent = count;
      tr.insertCell().textContent = pct + '%';
    }
  };
  select.disabled = false;
  select.addEventListener('change', () => choose(select.value));
  for (const bar of columns) {
    bar.disabled = false;
    bar.addEventListener('click', () => choose(bar.dataset.batch));
  }
}
enableChart().catch(() => {}); // The static chart, latest batch and download remain readable offline.

async function lookup(name, signal) {
  const { runSearch } = await import('/assets/search-api.mjs');
  signal.throwIfAborted();
  return runSearch('name', { name, extraEnding: 'si' }, signal);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });

function priceNote(item) {
  if (item.status === 'taken') return 'The owner sets the price.';
  if (item.status !== 'available') return '';
  const offer = item.quotes[0];
  if (!offer) return 'No standard price listed.';
  const term = offer.minimumYears > 1 ? ` for ${offer.minimumYears} years` : '';
  return `${usd.format(offer.firstPaymentUsd)} upfront${term} at ${offer.shop}. ` +
    `${usd.format(offer.renewalPaymentUsd)} to renew${term || ' each year'}.`;
}

for (const form of document.querySelectorAll('.name-check')) {
  const field = form.querySelector('input');
  const status = form.querySelector('.check-status');
  const matches = form.querySelector('.matches');
  let current;
  function resetSearch() {
    current?.abort();
    matches.replaceChildren();
    status.textContent = '';
    field.setCustomValidity('');
  }
  field.addEventListener('input', resetSearch);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    resetSearch();
    const name = field.value.trim();
    if (!name) {
      field.setCustomValidity('Enter a name or domain.');
      field.reportValidity();
      return;
    }
    const request = current = new AbortController();
    status.textContent = 'Checking endings…';
    try {
      const result = await lookup(name, request.signal);
      if (request.signal.aborted) return;
      const labels = { taken: 'Taken', available: 'Available', reserved: 'Reserved', unknown: 'Unconfirmed' };
      for (const item of result.items) {
        const li = document.createElement('li');
        const domain = document.createElement('b');
        domain.textContent = item.domain;
        const label = document.createElement('span');
        label.textContent = labels[item.status];
        li.append(domain, label);
        const note = priceNote(item);
        if (note) {
          const price = document.createElement('p');
          price.textContent = note;
          li.append(price);
        }
        matches.append(li);
      }
      status.textContent = result.items.length ? 'Domain check results' : 'No endings confirmed. Try another name.';
    } catch (error) {
      if (!request.signal.aborted) status.textContent = error.status === 429
        ? 'Too many checks. Try again in a few minutes.' : 'Couldn’t check that name. Please try again.';
    }
  });
  form.hidden = false;
}

const share = document.getElementById('share');
if (navigator.share || navigator.clipboard?.writeText) {
  share.hidden = false;
  share.addEventListener('click', async () => {
    const url = new URL('/sf/', location.origin).href;
    const message = document.getElementById('share-status');
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        message.textContent = 'Link copied.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') message.textContent = url;
    }
  });
}
