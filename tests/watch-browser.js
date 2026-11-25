// Runs inside the rendered page with a fake worker. No email service is involved.
async function checkWatch({ dedicated, width }) {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  const form = document.querySelector('#watch');
  const domain = form.querySelector('#watch-domain');
  const email = form.querySelector('#watch-email');
  const news = form.querySelector('input[type="checkbox"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[role="status"]');

  assert(news.labels[0].textContent.trim() === 'Send me rare Domain Hound news. Unsubscribe anytime.', 'News consent text changed');
  assert(form.querySelectorAll('input[type="checkbox"]').length === 1 && !news.checked && !news.required, 'News must be optional and unticked');
  assert(email.value === '', 'Never prefill email from the URL');
  assert(domain.value === (dedicated ? 'xn--bcher-kva.com' : ''), 'Expected only a valid domain to be prefilled');
  assert(!button.disabled && button.textContent === 'Watch it', 'Watch button must be ready');
  await document.fonts.ready;
  assert(document.documentElement.scrollWidth <= width, 'Page overflows horizontally');
  const bounds = button.getBoundingClientRect();
  assert(bounds.height >= 44, 'Watch button is too small');
  if (dedicated) {
    assert(bounds.top >= 0 && bounds.bottom <= innerHeight, 'Signup below first viewport: ' + bounds.bottom);
  }

  const calls = [];
  let reply;
  window.fetch = async (url, options) => {
    assert(url === 'https://domainhound-alerts.domainhound.workers.dev/watch', 'Wrong worker URL');
    assert(options.method === 'POST' && options.headers['content-type'] === 'application/json', 'Expected JSON POST');
    assert(options.credentials === 'omit', 'Watch request should omit credentials');
    calls.push(JSON.parse(options.body));
    return reply();
  };

  // Wait for the asynchronous submit handler, including its finally block.
  async function expectStatus(state, words) {
    for (let attempt = 0; attempt < 100 && status.dataset.state !== state; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(status.dataset.state === state && words.test(status.textContent), 'Unexpected status: ' + status.textContent);
  }
  function fill(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  fill(domain, 'invalid');
  button.click();
  assert(document.activeElement === domain && domain.getAttribute('aria-invalid') === 'true', 'Focus invalid domain');
  fill(domain, 'HTTPS://Example.com/path');
  button.click();
  assert(document.activeElement === email && calls.length === 0, 'Validate before sending');

  fill(email, 'reader@example.com');
  let release;
  reply = () => new Promise(resolve => { release = resolve; });
  button.click();
  await expectStatus('sending', /Sending/);
  button.click();
  assert(calls.length === 1 && news.disabled, 'Duplicate submission or editable in-flight consent');
  const payload = calls[0];
  assert(payload.newsConsent === false && payload.email === email.value && payload.domain === 'example.com' && payload.website === '', 'Wrong opt-out payload');
  release(new Response(JSON.stringify({ ok: true }), { status: 202 }));
  await expectStatus('success', /inbox to confirm/i);
  assert(!news.checked && !news.disabled && !email.value, 'Reset sensitive fields after acceptance');

  fill(domain, 'example.com');
  fill(email, 'reader@example.com');
  news.labels[0].click();
  assert(news.checked, 'Consent label must toggle the checkbox');
  const failures = [
    [429, {}, /too many/i],
    [422, { message: 'Alerts cover .com for now.' }, /cover .com/],
    [500, {}, /unavailable/i],
    [202, { ok: false }, /unavailable/i],
    [0, {}, /reach the server/i]
  ];
  for (const [code, body, words] of failures) {
    reply = () => {
      if (code === 0) throw new TypeError('Mock offline');
      return new Response(JSON.stringify(body), { status: code });
    };
    button.click();
    await expectStatus('error', words);
    assert(news.checked && email.value && !news.disabled, 'Keep entries for retry');
  }
  reply = () => new Response(JSON.stringify({ ok: true }), { status: 202 });
  button.click();
  await expectStatus('success', /inbox to confirm/i);
  assert(calls.length === failures.length + 2 && calls.slice(1).every(call => call.newsConsent === true), 'Wrong opt-in payload');
  assert(!news.checked, 'Future signups must start unticked');

  form.querySelector('summary').click();
  assert(form.querySelector('details').open && /up to four per watch, including confirmation/i.test(form.innerText), 'Show the email cap');
  assert(/turn off news, stop one watch or erase everything/i.test(form.innerText), 'Explain signed-link controls');
  assert(new URL(form.querySelector('.watch-help a').href).pathname.endsWith('/privacy/'), 'Privacy link broken');
}
