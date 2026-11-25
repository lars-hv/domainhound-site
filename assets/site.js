const installers = document.querySelectorAll('.installer');

function selectClient(index) {
  const terminal = document.querySelector('.terminal');
  const client = ['Claude Code', 'Codex', 'MCP client'][index];
  for (const mark of terminal.querySelectorAll('.brand-mark')) {
    mark.toggleAttribute('hidden', index !== (mark.matches('.claude-spark') ? 0 : 1));
  }
  for (const label of terminal.querySelectorAll('.hound-turn .speaker span')) {
    label.textContent = index === 0 ? 'Claude' : client;
  }
  terminal.querySelector('.window-name span').textContent = client;
  terminal.setAttribute('aria-label', client + ' example');
  for (const installer of installers) {
    installer.querySelectorAll('[role="tab"]').forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      panel.hidden = !selected;
      const button = panel.querySelector('.copy');
      button.querySelector('span').textContent = button.dataset.label;
    });
    installer.querySelector('.feedback').textContent = '';
  }
}

async function copyLine(panel, feedback) {
  const code = panel.querySelector('code');
  try {
    await navigator.clipboard.writeText(code.textContent);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('copy')) {
      feedback.textContent = 'Text selected. Use your device’s Copy action.';
      return;
    }
    selection.removeAllRanges();
  }
  if (panel.hidden) return;
  panel.querySelector('.copy span').textContent = 'Copied';
  const client = document.getElementById(panel.getAttribute('aria-labelledby'));
  feedback.textContent = client.textContent + ' setup copied.';
}

for (const installer of installers) {
  const tabs = [...installer.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectClient(index));
    tab.addEventListener('keydown', event => {
      const positions = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (!(event.key in positions)) return;
      event.preventDefault();
      const position = positions[event.key];
      selectClient(position);
      tabs[position].focus();
    });
  });
  for (const panel of installer.querySelectorAll('[role="tabpanel"]')) {
    const button = panel.querySelector('.copy');
    button.dataset.label = button.querySelector('span').textContent;
    button.addEventListener('click', () => copyLine(panel, installer.querySelector('.feedback')));
  }
}

/* Domain watch form. Fields carry no name, so a native submit could never send the email anywhere. */
(() => {
  const form = document.getElementById('watch');
  if (!form || !window.fetch || !window.AbortController) return;
  const endpoint = 'https://domainhound-alerts.domainhound.workers.dev/watch';
  const domainInput = document.getElementById('watch-domain');
  const emailInput = document.getElementById('watch-email');
  const trap = document.getElementById('watch-website');
  const button = form.querySelector('.watch-submit');
  const status = document.getElementById('watch-status');
  /* Same rules as the alerts service, so most mistakes are caught before sending. */
  function watchHostname(value) {
    const raw = value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!raw || raw.length > 253 || /[\s@:/?#]/.test(raw)) return null;
    try {
      const host = new URL('http://' + raw).hostname;
      return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,63}$/.test(host) ? host : null;
    } catch {
      return null;
    }
  }
  function validEmail(value) {
    const email = value.toLowerCase();
    return email.length <= 254 && /^[^\s@<>()[\]",;:\\]{1,64}@(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(email);
  }

  function showStatus(message, state, invalidInput) {
    status.textContent = message;
    status.dataset.state = state;
    if (invalidInput) {
      invalidInput.setAttribute('aria-invalid', 'true');
      invalidInput.setAttribute('aria-describedby', status.id);
      invalidInput.focus();
    }
  }

  function clearStatus() {
    for (const input of [domainInput, emailInput]) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
    showStatus('', '');
  }

  form.addEventListener('input', clearStatus);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.getAttribute('aria-disabled') === 'true') return;
    clearStatus();
    const domain = watchHostname(domainInput.value.trim());
    const email = emailInput.value.trim();
    if (!domain) return showStatus('Enter a domain like brightname.com.', 'error', domainInput);
    if (!validEmail(email)) return showStatus('Enter a valid email address.', 'error', emailInput);

    button.setAttribute('aria-disabled', 'true');
    domainInput.readOnly = emailInput.readOnly = true;
    showStatus('Sending…', 'sending');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, domain, website: trap.value }),
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal
      });
      if (response.status === 429) {
        showStatus('Too many tries. Wait a minute and try again.', 'error');
        return;
      }
      const result = await response.json().catch(() => null);
      if (response.status === 202 && result?.ok === true) {
        form.reset();
        showStatus('Check your inbox to confirm.', 'success');
      } else if ([400, 422].includes(response.status) && typeof result?.message === 'string' && result.message) {
        const field = response.status === 422 || /domain/i.test(result.message) ? domainInput : emailInput;
        showStatus(result.message, 'error', field);
      } else {
        showStatus('The watch service is unavailable. Try again later.', 'error');
      }
    } catch {
      showStatus('Couldn’t reach the server. Try again later.', 'error');
    } finally {
      clearTimeout(timer);
      domainInput.readOnly = emailInput.readOnly = false;
      button.removeAttribute('aria-disabled');
    }
  });

  button.disabled = false;
})();
