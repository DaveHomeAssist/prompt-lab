// Load existing key on open (masked)
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) {
    document.getElementById('key').placeholder = 'sk-ant-••••••••' + apiKey.slice(-4);
  }
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const val = document.getElementById('key').value.trim();
  const status = document.getElementById('status');

  if (!val.startsWith('sk-ant-')) {
    status.textContent = '⚠ Key should start with sk-ant-';
    status.style.color = '#f87171';
    return;
  }

  chrome.storage.local.set({ apiKey: val }, () => {
    status.textContent = '✓ Saved';
    status.style.color = '#4ade80';
    document.getElementById('key').value = '';
    document.getElementById('key').placeholder = 'sk-ant-••••••••' + val.slice(-4);
  });
});
