const byId = id => document.getElementById(id);
const commands = {
  claude: 'claude mcp add domain-hound -- npx -y domain-hound',
  codex: 'codex mcp add domain-hound -- npx -y domain-hound',
  chatgpt: 'https://domainhound-mcp.domainhound.workers.dev/mcp'
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
const manual = 'Text selected. Use your device’s Copy action.';
for (const button of clients) {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', async () => {
    const client = button.dataset.client;
    const web = client === 'chatgpt';
    const code = byId('command');
    for (const option of clients) option.setAttribute('aria-pressed', String(option === button));
    byId('setup-step').hidden = false;
    byId('plugins').hidden = !web;
    byId('instruction').textContent = web
      ? 'In Plugins, choose +, then Add custom MCP server. Name it Domain Hound, paste the URL and choose No authentication. Review, create and install.'
      : 'With Node.js 20+ installed, run this in your terminal.';
    code.textContent = commands[client];
    byId('copied').textContent = '';
    const ok = await copyCode(code);
    if (button.getAttribute('aria-pressed') === 'true') {
      byId('copied').textContent = !ok ? manual : web
        ? 'URL copied. Then ask “@Domain Hound, is lanternbay.com available?”'
        : 'Copied. Then ask “Is lanternbay.com available?”';
    }
  });
}

document.querySelector('.other-copy').addEventListener('click', async () => {
  byId('other-status').textContent = await copyCode(byId('other-config')) ? 'Config copied.' : manual;
});
