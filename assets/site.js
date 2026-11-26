const installers = document.querySelectorAll('.installer');

function selectClient(index) {
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
    const disclosure = panel.closest('details');
    if (disclosure) disclosure.open = true;
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

const setup = document.getElementById('install');
const connect = document.getElementById('connect');
setup.classList.add('interactive');
connect.addEventListener('click', () => {
  setup.open = !setup.open;
  if (setup.open) setup.querySelector('[aria-selected="true"]').focus();
});
setup.addEventListener('toggle', () => connect.setAttribute('aria-expanded', String(setup.open)));

function openLinkedInstaller() {
  if (location.hash === '#install') setup.open = true;
}
openLinkedInstaller();
window.addEventListener('hashchange', openLinkedInstaller);
window.addEventListener('pageshow', openLinkedInstaller);
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!event.target.closest('a[href="#install"]')) return;
  setup.open = true;
  setup.querySelector('[aria-selected="true"]').focus();
});

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
