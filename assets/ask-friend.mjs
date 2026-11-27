import { readApiOrigin } from './api-origin.mjs';
import { isInternalTraffic, recordUsage } from './usage.mjs';

function button(label, cls) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className = cls;
  return node;
}

async function copy(url, status) {
  try {
    await navigator.clipboard.writeText(url);
    recordUsage('friend_link_copied');
    status.textContent = 'Link copied.';
  } catch {
    const field = document.createElement('input');
    field.readOnly = true;
    field.value = url;
    field.setAttribute('aria-label', 'Link to copy');
    status.replaceChildren('Copy this link ', field);
    field.focus();
    field.select();
  }
}

export function referral() {
  const line = document.createElement('p');
  line.className = 'friend-referral';
  const action = button('Copy link', 'friend-text');
  const feedback = document.createElement('span');
  feedback.setAttribute('role', 'status');
  action.onclick = () => copy(new URL('/', location.origin).href, feedback);
  line.append('Free. If it helped, send it to a founder friend. ', action, ' ', feedback);
  return line;
}

export async function createVote(names) {
  const api = readApiOrigin();
  const res = await fetch(new URL('/v1/votes', api), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(isInternalTraffic() && { 'X-Domain-Hound-Internal': '1' }) },
    body: JSON.stringify({ names }) });
  if (!res.ok) throw new Error(String(res.status));
  const { path } = await res.json();
  if (typeof path !== 'string' || !/^\/v\/[a-f0-9]{32}$/.test(path)) throw new Error('Invalid link');
  return new URL(path, api).href;
}

export function askFriend(getNames) {
  const panel = document.createElement('div');
  panel.className = 'ask-friend';
  const ask = button('Ask a friend', 'action');
  ask.title = 'Create a 30-day vote link for these names';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const links = document.createElement('span');
  links.className = 'friend-links';
  panel.append(ask, links, status);

  async function create(names) {
    ask.disabled = true;
    status.textContent = 'Creating your link…';
    try {
      const url = await createVote(names);
      const copyButton = button('Copy vote link', 'action');
      copyButton.onclick = () => copy(url, status);
      const tally = document.createElement('a');
      tally.href = url + '#tally';
      tally.textContent = 'See tally';
      links.replaceChildren(copyButton, tally);
      ask.hidden = true;
      status.textContent = 'Ready to share. Link lasts 30 days.';
      copyButton.focus();
    } catch (error) {
      status.textContent = error.message === '429' ? 'Too many links right now. Try again in a minute.' : 'Couldn’t create a link. Try again.';
    } finally { ask.disabled = false; }
  }

  ask.onclick = () => {
    const names = [...new Map(getNames().map(row => [row.name.toLowerCase(), row])).values()];
    if (!names.length) { status.textContent = 'Wait for a name to finish checking.'; return; }
    if (names.length <= 5) return create(names);
    const choose = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Choose up to five names';
    choose.append(legend);
    const boxes = names.map((row, index) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = index < 5;
      label.append(box, row.name);
      choose.append(label);
      return box;
    });
    const confirm = button('Create vote link', 'action');
    choose.onchange = () => {
      const count = boxes.filter(box => box.checked).length;
      confirm.disabled = count === 0 || count > 5;
      status.textContent = count > 5 ? 'Choose five names or fewer.' : '';
    };
    confirm.onclick = () => {
      links.replaceChildren();
      ask.hidden = false;
      create(names.filter((_, index) => boxes[index].checked));
    };
    choose.append(confirm);
    ask.hidden = true;
    links.replaceChildren(choose);
    boxes[0].focus();
  };
  return panel;
}
