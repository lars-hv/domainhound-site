/* Domain request forms. Fields carry no name, so native submission never sends signup details. */
(() => {
  const form = document.getElementById('watch') || document.getElementById('land');
  if (!form || !window.fetch || !window.AbortController) return;
  const land = form.id === 'land';
  const path = land ? '/v1/landed' : '/watch';
  const endpoint = 'https://domainhound-alerts.domainhound.workers.dev' + path;
  const field = name => document.getElementById(form.id + '-' + name);
  const domainInput = field('domain');
  const emailInput = field('email');
  const nameInput = field('name');
  const noteInput = field('note');
  const news = field('news');
  const trap = field('website');
  const button = form.querySelector('.watch-submit');
  const status = field('status');
  const editable = [domainInput, emailInput, nameInput];
  if (noteInput) editable.push(noteInput);
  /* Same rules as the alerts service, so most mistakes are caught before sending. */
  function domainHostname(value) {
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

  const requestedDomain = new URLSearchParams(window.location.search).get(land ? 'd' : 'domain');
  if (requestedDomain) domainInput.value = domainHostname(requestedDomain.trim()) || '';

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
    for (const input of editable) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
    showStatus('', '');
  }

  function setSending(sending) {
    if (sending) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    for (const input of editable) input.readOnly = sending;
    news.disabled = sending;
  }

  form.addEventListener('input', clearStatus);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.getAttribute('aria-disabled') === 'true') return;
    clearStatus();
    const domain = domainHostname(domainInput.value.trim());
    const email = emailInput.value.trim();
    const name = nameInput.value.trim();
    const note = noteInput?.value.trim();
    if (!domain) return showStatus('Enter a domain like brightname.com.', 'error', domainInput);
    if (!validEmail(email)) return showStatus('Enter a valid email address.', 'error', emailInput);
    if (name.length > nameInput.maxLength) return showStatus('Use 80 characters or fewer for your name.', 'error', nameInput);
    if (note && note.length > noteInput.maxLength) return showStatus('Use 500 characters or fewer for your note.', 'error', noteInput);

    const payload = { email, domain, source: 'site', website: trap.value };
    if (name) payload.name = name;
    if (note) payload.note = note;
    if (news.checked) payload.news = 'yes';

    setSending(true);
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
      } else if (([400, 422].includes(response.status) || (land && response.status === 413))
        && typeof result?.message === 'string' && result.message) {
        const invalidInput = land ? null : (response.status === 422 || /domain/i.test(result.message) ? domainInput : emailInput);
        showStatus(result.message, 'error', invalidInput);
      } else {
        showStatus(land ? 'Couldn’t send your request. Try again later.' : 'The watch service is unavailable. Try again later.', 'error');
      }
    } catch {
      showStatus('Couldn’t reach the server. Try again later.', 'error');
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  });

  button.disabled = false;
})();
