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
