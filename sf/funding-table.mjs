import { columns, defaultOrder, pageSize, sorted, tableRows } from './funding.mjs';

async function enableFundingTable() {
  const response = await fetch('/data/sf/companies.json');
  if (!response.ok) return;
  const { companies } = await response.json();
  const table = document.querySelector('#company-table');
  const picker = document.querySelector('#funding-sort');
  const more = document.querySelector('#funding-more');
  const status = document.querySelector('#funding-count');
  const total = companies.length.toLocaleString('en-US');
  let key = 'funding', order = 'desc', expanded = false;

  function update() {
    const rows = sorted(companies, key, order);
    const visible = expanded ? rows : rows.slice(0, pageSize);
    table.tBodies[0].innerHTML = tableRows(visible);
    status.textContent = `${visible.length.toLocaleString('en-US')} of ${total} companies`;
    more.textContent = expanded ? 'Show 50' : 'Show all';
    more.setAttribute('aria-expanded', String(expanded));
    picker.value = key + ':' + order;
    for (const th of table.tHead.rows[0].cells) {
      if (th.dataset.key === key) th.setAttribute('aria-sort', order === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }
  }

  for (const th of table.tHead.rows[0].cells) {
    const button = th.querySelector('button');
    button.disabled = false;
    button.addEventListener('click', () => {
      const next = th.dataset.key;
      order = next === key ? (order === 'asc' ? 'desc' : 'asc') : defaultOrder(next);
      key = next;
      update();
    });
  }
  const directions = {
    batch: ['oldest first', 'newest first'], funding: ['low to high', 'high to low'],
    has_com: ['unverified first', 'yes first'],
  };
  for (const [field, label] of Object.entries(columns)) {
    const labels = directions[field] || ['A to Z', 'Z to A'];
    for (const [i, dir] of ['asc', 'desc'].entries()) {
      picker.add(new Option(`${label}, ${labels[i]}`, field + ':' + dir));
    }
  }
  picker.value = 'funding:desc';
  picker.addEventListener('change', () => {
    [key, order] = picker.value.split(':');
    update();
  });
  picker.parentElement.hidden = false;
  more.hidden = companies.length <= pageSize;
  more.addEventListener('click', () => {
    expanded = !expanded;
    update();
  });
}

enableFundingTable().catch(() => {}); // The initial 50 rows and data download stay available.
