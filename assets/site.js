const byId = id => document.getElementById(id);
const connectorUrl = 'https://domainhound-mcp.domainhound.workers.dev/mcp';
const commands = {
  claude: connectorUrl,
  'claude-code': 'claude mcp add domain-hound -- npx -y domain-hound',
  codex: 'codex mcp add domain-hound -- npx -y domain-hound',
  chatgpt: connectorUrl
};

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
for (const button of clients) {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', async () => {
    const client = button.dataset.client;
    const code = byId('command');
    for (const option of clients) option.setAttribute('aria-pressed', String(option === button));
    byId('setup-step').hidden = false;
    for (const item of instructions) item.hidden = item.dataset.forClient !== client;
    code.textContent = commands[client];
    byId('copied').textContent = '';
    const ok = await copyCode(code);
    if (button.getAttribute('aria-pressed') === 'true') {
      let message = 'Copied. Then ask “Is lanternbay.com available?”';
      if (client === 'claude') message = 'URL copied.';
      if (client === 'chatgpt') message = 'URL copied. Then ask “@Domain Hound, is lanternbay.com available?”';
      byId('copied').textContent = ok ? message : manual;
    }
  });
}

document.querySelector('.other-copy').addEventListener('click', async () => {
  byId('other-status').textContent = await copyCode(byId('other-config')) ? 'Config copied.' : manual;
});
