const select = document.getElementById('batch-select');
const charts = [...document.querySelectorAll('[data-batch]')];
const latest = select.value;
const shareStatus = document.getElementById('share-status');

function showBatch(batch) {
  const active = charts.find(chart => chart.dataset.batch === batch) || charts.at(-1);
  for (const chart of charts) chart.hidden = chart !== active;
  select.value = active.dataset.batch;
  shareStatus.textContent = '';
}

function batchUrl() {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('batch', select.value);
  return url;
}

select.disabled = false;
select.addEventListener('change', () => {
  showBatch(select.value);
  // Sandboxed and file previews may have an opaque origin.
  try { history.pushState(null, '', batchUrl()); } catch {}
});
const restoreBatch = () => showBatch(new URL(location.href).searchParams.get('batch') || latest);
window.addEventListener('popstate', restoreBatch);
restoreBatch();

const share = document.getElementById('share');
share.hidden = !/^https?:$/.test(location.protocol);
share.addEventListener('click', async () => {
  const url = batchUrl().href;
  try {
    if (navigator.share) await navigator.share({ title: 'SF Startup Domains', url });
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      shareStatus.textContent = 'Link copied.';
    } else shareStatus.textContent = url;
  } catch (error) {
    if (error.name !== 'AbortError') shareStatus.textContent = url;
  }
});

const form = document.getElementById('check-form');
const field = document.getElementById('candidate');
const status = document.getElementById('check-status');
const matches = document.getElementById('matches');
const watch = document.getElementById('watch-link');
let current;
function resetSearch() {
  current?.abort();
  matches.replaceChildren();
  watch.hidden = true;
  watch.removeAttribute('href');
  status.textContent = '';
  field.setCustomValidity('');
}
field.addEventListener('input', resetSearch);

// The hosted checker accepts requests from the product's origin. Portable previews
// can read these two public registry records directly with the registry's CORS permission.
const registries = {
  com: 'https://rdap.verisign.com/com/v1/domain/',
  ai: 'https://rdap.identitydigital.services/rdap/domain/',
};
async function registryResult(label, ending, signal) {
  const domain = label + '.' + ending;
  let status = 'unknown';
  try {
    const response = await fetch(registries[ending] + domain, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error',
    });
    const record = await response.json();
    if (response.ok && record.objectClassName === 'domain' && record.ldhName?.toLowerCase() === domain) status = 'taken';
    if (response.status === 404 && record.errorCode === 404) status = 'no_record';
  } catch { /* A registry can be temporarily unreachable. */ }
  return { domain, status };
}

function nameLabel(input) {
  const text = input.normalize('NFC').toLowerCase().replace(/\s+/gu, '').replace(/\.(ai|com)\.?$/, '');
  if (!/^[\p{L}\p{M}\p{N}-]+$/u.test(text)) return null;
  try {
    const ascii = new URL('https://' + text + '.example').hostname.split('.')[0];
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(ascii) ? ascii : null;
  } catch { return null; }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  resetSearch();
  const label = nameLabel(field.value.trim());
  if (!label) {
    field.setCustomValidity('Enter a startup name, such as Example or Example.ai.');
    field.reportValidity();
    return;
  }
  const request = current = new AbortController();
  status.textContent = 'Checking domains…';
  try {
    let items;
    const portable = location.origin !== 'https://domainhound.dev' || document.documentElement.hasAttribute('data-registry-preview');
    if (portable) {
      items = await Promise.all(Object.keys(registries).map(ending => registryResult(label, ending, request.signal)));
    } else {
      const { runSearch } = await import('../assets/search-api.mjs');
      if (request.signal.aborted) return;
      items = (await runSearch('name', { name: label }, request.signal)).items;
    }
    if (request.signal.aborted) return;
    const labels = { taken: 'Taken', available: 'Available', reserved: 'Reserved', no_record: 'No registry record', unknown: 'Unconfirmed' };
    for (const item of items) {
      const li = document.createElement('li');
      const domain = document.createElement('b');
      domain.textContent = item.domain;
      li.append(domain, labels[item.status]);
      matches.append(li);
    }
    status.textContent = items.some(item => item.status !== 'unknown')
      ? (portable ? 'Live registry results' : 'Domain check results') : 'No endings confirmed. Please try again.';
    const exact = label + '.com';
    if (items.some(item => item.domain === exact && item.status === 'taken')) {
      watch.href = 'https://domainhound.dev/watch/?' + new URLSearchParams({ domain: exact });
      watch.hidden = false;
    }
  } catch (error) {
    if (!request.signal.aborted) status.textContent = error.status === 429
      ? 'Too many checks. Try again in a few minutes.' : 'Couldn’t check that name. Please try again.';
  }
});
form.hidden = false;
