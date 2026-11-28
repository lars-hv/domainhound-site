// Used by both the static preview and the interactive table.
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export const columns = {
  company: 'Company', domain: 'Domain', ending: 'Ending',
  raised_usd: 'Raised', team_size: 'Team size', com: 'Owns the .com?',
};
export const comLabels = { available: 'No, it’s free', registered: 'No, someone else has it', yes: 'Yes' };
export const defaultOrder = key => ['raised_usd', 'team_size', 'com'].includes(key) ? 'desc' : 'asc';

function value(row, key) {
  return key === 'com' ? row.com.status : row[key];
}

export function sorted(rows, key, order) {
  return [...rows].sort((left, right) => {
    const a = value(left, key), b = value(right, key);
    const comparison = typeof a === 'string' ? collator.compare(a, b) : a - b;
    const result = order === 'desc' ? -comparison : comparison;
    return result || collator.compare(left.company, right.company) || left.id - right.id;
  });
}

const escape = text => String(text).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function tableRows(rows) {
  return rows.map(row => {
    const dollars = wholeDollars.format(row.raised_usd);
    const amount = formatter.format(row.raised_usd);
    const fundingTitle = row.raised_is_floor ? `At least ${dollars}` : dollars;
    return `<tr><th scope="row">${escape(row.company)}</th>
      <td data-label="Domain" class="site-domain">${escape(row.domain)}</td>
      <td data-label="Ending">${escape(row.ending)}</td>
      <td data-label="Raised" class="amount" title="${fundingTitle}">${amount}${row.raised_is_floor ? '+' : ''}</td>
      <td data-label="Team size">${row.team_size.toLocaleString('en-US')}</td>
      <td data-label="Owns the .com?">${comLabels[row.com.status]}</td></tr>`;
  }).join('\n');
}
