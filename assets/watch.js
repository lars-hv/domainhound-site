import { recordUsage } from './usage.mjs';

/* Domain watch form. Fields carry no name, so a native submit could never send the email anywhere. */
(() => {
  const form = document.getElementById('watch');
  if (!form || !window.fetch || !window.AbortController) return;
  const endpoint = 'https://domainhound-alerts.domainhound.workers.dev/watch';
  const domainInput = document.getElementById('watch-domain');
  const emailInput = document.getElementById('watch-email');
  const nameInput = document.getElementById('watch-name');
  const stamp = document.getElementById('watch-stamp');
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
  if (!stamp && requestedDomain) domainInput.value = watchHostname(requestedDomain.trim()) || '';

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
    for (const input of [domainInput, emailInput, nameInput].filter(Boolean)) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
    showStatus('', '');
  }

  if (stamp) {
    const clearStamp = () => {
      stamp.hidden = true;
      stamp.textContent = '';
    };
    domainInput.addEventListener('input', clearStamp);
    form.addEventListener('reset', clearStamp);
    document.addEventListener('watch-suggestion', event => {
      if (domainInput.readOnly) return;
      const domain = event.detail;
      if (!domain && stamp.hidden) return;
      domainInput.value = domain || '';
      clearStatus();
      clearStamp();
      if (domain) {
        stamp.textContent = 'Taken · ' + domain;
        stamp.hidden = false;
      }
    });
  }
  form.addEventListener('input', clearStatus);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.getAttribute('aria-disabled') === 'true') return;
    clearStatus();
    const domain = watchHostname(domainInput.value.trim());
    const email = emailInput.value.trim();
    if (!domain) return showStatus('Enter a domain like brightname.com.', 'error', domainInput);
    if (!validEmail(email)) return showStatus('Enter an email like you@example.com.', 'error', emailInput);

    if (!trap.value) recordUsage('watch_submitted');
    const payload = { email, domain, source: 'site', website: trap.value };
    if (nameInput?.value.trim()) payload.name = nameInput.value.trim();
    if (news?.checked) payload.news = 'yes';

    button.setAttribute('aria-disabled', 'true');
    domainInput.readOnly = emailInput.readOnly = true;
    if (nameInput) nameInput.readOnly = true;
    if (news) news.disabled = true;
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
        showStatus('Check your email to start your watch.', 'success');
      } else if ([400, 422].includes(response.status) && typeof result?.message === 'string' && result.message) {
        const field = response.status === 422 || /domain/i.test(result.message) ? domainInput : emailInput;
        showStatus(result.message, 'error', nameInput && /name/i.test(result.message) ? nameInput : field);
      } else {
        showStatus('We couldn’t start your watch. Try again later.', 'error');
      }
    } catch {
      showStatus('We couldn’t start your watch. Try again later.', 'error');
    } finally {
      clearTimeout(timer);
      domainInput.readOnly = emailInput.readOnly = false;
      if (nameInput) nameInput.readOnly = false;
      if (news) news.disabled = false;
      button.removeAttribute('aria-disabled');
    }
  });

  button.disabled = false;
})();
