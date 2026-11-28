// Used by both the static preview and the interactive table.
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];

export const columns = {
  company: 'Company', domain: 'Domain', ending: 'Ending', batch: 'Batch',
  funding: 'Raised (Form D)', has_com: 'Has the .com?',
};
export const pageSize = 50;
export const defaultOrder = key => key === 'funding' || key === 'has_com' ? 'desc' : 'asc';

function value(row, key) {
  if (key === 'funding') return row.funding?.sold ?? null;
  if (key === 'has_com') return Number(row.has_com === true);
  if (key === 'batch') {
    const [season, year] = row.batch.split(' ');
    return Number(year) * 4 + seasons.indexOf(season);
  }
  return row[key];
}

export function sorted(rows, key, order) {
  return [...rows].sort((left, right) => {
    const a = value(left, key), b = value(right, key);
    let result;
    if (a == null || b == null) result = Number(a == null) - Number(b == null);
    else {
      result = typeof a === 'string' ? collator.compare(a, b) : a - b;
      if (order === 'desc') result = -result;
    }
    return result || collator.compare(left.company, right.company) || left.id - right.id;
  });
}

const escape = text => String(text).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function tableRows(rows) {
  return rows.map(row => {
    const f = row.funding;
    let amount = 'No match';
    if (f) {
      const dollars = formatter.format(f.sold);
      const source = `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(f.cik)}&amp;owner=exclude&amp;forms=D`;
      amount = `<a href="${source}" title="Latest filing: ${escape(f.latest_filing)}"
        aria-label="${escape(row.company)}, ${dollars}, view SEC filings">${dollars}</a>`;
    }
    return `<tr><th scope="row">${escape(row.company)}</th>
      <td data-label="Domain" class="site-domain">${escape(row.domain)}</td>
      <td data-label="Ending">${escape(row.ending)}</td><td data-label="Batch">${escape(row.batch)}</td>
      <td data-label="Raised (Form D)" class="amount">${amount}</td>
      <td data-label="Has the .com?">${row.has_com ? 'Yes' : 'Unverified'}</td></tr>`;
  }).join('\n');
}
