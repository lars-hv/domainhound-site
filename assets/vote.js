(() => {
  const ballot = document.getElementById('ballot');
  const home = document.getElementById('own-search').action;
  if (ballot && /^#[12]\.[A-Za-z0-9_-]{1,2000}$/.test(location.hash)) {
    location.replace(new URL('/r/' + location.hash, home));
    return;
  }
  document.getElementById('own-search').addEventListener('submit', event => {
    event.preventDefault();
    const url = new URL(event.currentTarget.action);
    url.hash = new URLSearchParams({ check: document.getElementById('own-name').value.trim() });
    location.assign(url);
  });
  if (!ballot) return;
  const key = 'domain-hound-vote:' + location.pathname;
  const feedback = document.getElementById('feedback');
  const buttons = [...document.querySelectorAll('.vote')];
  const refresh = document.getElementById('refresh');
  refresh.onclick = () => location.reload();

  function display() {
    let voted;
    try { voted = localStorage.getItem(key); } catch { voted = 'blocked'; }
    const tally = location.hash === '#tally' || Boolean(voted);
    for (const button of buttons) button.hidden = tally;
    for (const count of document.querySelectorAll('.count')) count.hidden = !tally;
    refresh.hidden = !tally;
    document.getElementById('intro').textContent = tally ? 'The votes so far.' : 'Which name would you go with?';
    if (voted === 'blocked') feedback.textContent = 'Allow browser storage to vote.';
    else if (voted === 'pending') feedback.textContent = 'Your vote was sent. Refresh the tally to check.';
    else if (voted) feedback.textContent = 'Thanks for voting.';
  }

  async function cast(index) {
    if (!navigator.onLine) {
      feedback.textContent = 'Reconnect to send your vote.';
      return;
    }
    try {
      if (localStorage.getItem(key)) return display();
      localStorage.setItem(key, 'pending');
    } catch {
      feedback.textContent = 'Allow browser storage to vote.';
      return;
    }
    try {
      const response = await fetch(location.pathname, { method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) });
      if (!response.ok) {
        localStorage.removeItem(key);
        if (response.status === 410) return location.reload();
        feedback.textContent = response.status === 429 ? 'Too many votes right now. Try again in a minute.' : 'Couldn’t save your vote. Try again.';
        return;
      }
      localStorage.setItem(key, ballot.dataset.expires);
      location.reload();
    } catch {
      // The server may already have counted the vote if its response was lost.
      display();
      feedback.textContent = 'Connection lost. Refresh to see the latest tally.';
    }
  }
  for (const button of buttons) button.onclick = async () => {
    buttons.forEach(b => { b.disabled = true; });
    try {
      const send = () => cast(Number(button.dataset.index));
      if (navigator.locks) await navigator.locks.request(key, send);
      else await send();
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  };
  window.addEventListener('storage', display);
  window.addEventListener('hashchange', display);
  display();
})();
