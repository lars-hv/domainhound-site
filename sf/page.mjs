const select = document.getElementById('batch-select');
const columns = [...document.querySelectorAll('.column')];
const details = document.querySelector('.batch-details tbody');
const templates = new Map(Array.from(document.getElementById('batch-templates').children,
  template => [template.dataset.batch, template]));

function choose(batch) {
  const template = templates.get(batch);
  if (!template) return;
  select.value = batch;
  for (const bar of columns) bar.setAttribute('aria-pressed', String(bar.dataset.batch === batch));
  details.replaceChildren(template.content.cloneNode(true));
}

select.disabled = false;
select.addEventListener('change', () => choose(select.value));
for (const bar of columns) {
  bar.disabled = false;
  bar.addEventListener('click', () => choose(bar.dataset.batch));
}

const field = document.getElementById('candidate');
field.form.addEventListener('submit', () => { field.value = field.value.trim(); });
