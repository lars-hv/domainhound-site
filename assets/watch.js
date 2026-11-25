/* Domain watch form. Fields carry no name, so a native submit could never send the email anywhere. */
(() => {
  const form = document.getElementById('watch');
  if (!form || !window.fetch || !window.AbortController) return;
  const endpoint = 'https://domainhound-alerts.domainhound.workers.dev/watch';
  const domainInput = document.getElementById('watch-domain');
  const emailInput = document.getElementById('watch-email');
  const nameInput = document.getElementById('watch-name');
  const news = document.getElementById('watch-news');
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

  const requestedDomain = new URLSearchParams(window.location.search).get('domain');
  if (requestedDomain) domainInput.value = watchHostname(requestedDomain.trim()) || '';

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
    for (const input of [domainInput, emailInput, nameInput]) {
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
    const name = nameInput.value.trim();
    if (!domain) return showStatus('Enter a domain like brightname.com.', 'error', domainInput);
    if (!validEmail(email)) return showStatus('Enter a valid email address.', 'error', emailInput);
    if (name.length > nameInput.maxLength) return showStatus('Use 80 characters or fewer for your name.', 'error', nameInput);

    const payload = { email, domain, source: 'site', website: trap.value };
    if (name) payload.name = name;
    if (news.checked) payload.news = 'yes';

    button.setAttribute('aria-disabled', 'true');
    domainInput.readOnly = emailInput.readOnly = nameInput.readOnly = true;
    news.disabled = true;
    showStatus('Sending…', 'sending');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
      domainInput.readOnly = emailInput.readOnly = nameInput.readOnly = false;
      news.disabled = false;
      button.removeAttribute('aria-disabled');
    }
  });

  button.disabled = false;
})();
