const byId = id => document.getElementById(id);
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code.textContent);
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      if (document.execCommand('copy')) {
        selection.removeAllRanges();
        return true;
      }
    } catch { /* Leave the text selected for manual copy. */ }
    return false;
  }
}

const clients = document.querySelectorAll('[data-client]');
const instructions = document.querySelectorAll('[data-for-client]');
const manual = 'Text selected. Use your device’s Copy action.';
const step = byId('setup-step');
const copied = byId('copied');
step.hidden = true;
document.querySelector('.clients').hidden = false;
byId('chatgpt-copy').hidden = false;
byId('other-copy').hidden = false;

for (const button of clients) {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', async () => {
    for (const option of clients) option.setAttribute('aria-pressed', String(option === button));
    for (const item of instructions) item.hidden = item.dataset.forClient !== button.dataset.client;
    step.hidden = false;
    copied.textContent = '';
    const code = step.querySelector('[data-for-client]:not([hidden]) [data-copy]');
    if (!code) return;
    const ok = await copyCode(code);
    if (button.getAttribute('aria-pressed') === 'true') {
      const success = button.dataset.client === 'claude' ? 'URL copied.' : 'Command copied. Then ask “Is lanternbay.com available?”';
      copied.textContent = ok ? success : manual;
    }
  });
}

byId('chatgpt-copy').addEventListener('click', async () => {
  const ok = await copyCode(byId('chatgpt-url'));
  if (!byId('chatgpt-copy').closest('[data-for-client]').hidden) copied.textContent = ok ? 'URL copied.' : manual;
});

byId('other-copy').addEventListener('click', async () => {
  byId('other-status').textContent = await copyCode(byId('other-config')) ? 'Config copied.' : manual;
});
