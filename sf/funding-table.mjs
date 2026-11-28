import { columns, defaultOrder, sorted, tableRows } from './funding.mjs';

async function enableFundingTable() {
  const response = await fetch('/data/sf/top50.json');
  if (!response.ok) return;
  const { companies } = await response.json();
  const table = document.querySelector('#company-table');
  const picker = document.querySelector('#funding-sort');
  let key = 'raised_usd', order = 'desc';

  function update() {
    table.tBodies[0].innerHTML = tableRows(sorted(companies, key, order));
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
    raised_usd: ['low to high', 'high to low'], team_size: ['low to high', 'high to low'],
    com: ['available first', 'yes first'],
  };
  for (const [field, label] of Object.entries(columns)) {
    const labels = directions[field] || ['A to Z', 'Z to A'];
    for (const [i, dir] of ['asc', 'desc'].entries()) {
      picker.add(new Option(`${label}, ${labels[i]}`, field + ':' + dir));
    }
  }
  picker.value = 'raised_usd:desc';
  picker.addEventListener('change', () => {
    [key, order] = picker.value.split(':');
    update();
  });
  picker.parentElement.hidden = false;
}

enableFundingTable().catch(() => {}); // The initial 50 rows and data download stay available.
