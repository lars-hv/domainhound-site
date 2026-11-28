const select = document.getElementById('batch-select');
const columns = [...document.querySelectorAll('.column')];
const details = document.querySelector('.batch-details');

const snapshot = document.getElementById('offline-directory');
const directory = snapshot ? JSON.parse(snapshot.textContent) : null;

function enableChart(batches) {
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
      const sites = tr.insertCell();
      sites.textContent = count;
      sites.title = pct + '% of sites';
    }
  };
  select.disabled = false;
  select.addEventListener('change', () => choose(select.value));
  for (const bar of columns) {
    bar.disabled = false;
    bar.addEventListener('click', () => choose(bar.dataset.batch));
  }
}
enableChart(JSON.parse(document.getElementById('batch-data').textContent));

const form = document.getElementById('check-form');
const field = document.getElementById('candidate');
const status = document.getElementById('check-status');
const matches = document.getElementById('matches');
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
  if (directory) {
    const query = name.toLowerCase();
    const hits = directory.filter(([brand, domain]) =>
      brand.toLowerCase() === query || domain === query);
    for (const [brand, domain] of hits) {
      const row = document.createElement('li');
      const address = document.createElement('b');
      address.textContent = domain;
      row.append(brand, address);
      matches.append(row);
    }
    status.textContent = hits.length ? 'Listed in this snapshot' : 'No listing for that name in this snapshot.';
    return;
  }
  const request = current = new AbortController();
  status.textContent = 'Checking endings…';
  try {
    const { runSearch } = await import('/assets/search-api.mjs');
    if (request.signal.aborted) return;
    const result = await runSearch('name', { name }, request.signal);
    if (request.signal.aborted) return;
    const labels = { taken: 'Taken', available: 'Available', reserved: 'Reserved', unknown: 'Unconfirmed' };
    for (const item of result.items) {
      const li = document.createElement('li');
      const domain = document.createElement('b');
      domain.textContent = item.domain;
      li.append(domain, labels[item.status]);
      matches.append(li);
    }
    status.textContent = result.items.length ? 'Domain check results' : 'No endings confirmed. Try another name.';
  } catch (error) {
    if (!request.signal.aborted) status.textContent = error.status === 429
      ? 'Too many checks. Try again in a few minutes.' : 'Couldn’t check that name. Please try again.';
  }
});
form.hidden = false;

const share = document.getElementById('share');
if (!directory && (navigator.share || navigator.clipboard?.writeText)) {
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
