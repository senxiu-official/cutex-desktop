const note = document.getElementById('note');
const status = document.getElementById('status');
window.sandboxBridge.call('settings.get', { key: 'note' }).then(value => {
  note.value = typeof value === 'string' ? value : '';
  status.textContent = 'Ready';
}).catch(() => { status.textContent = 'Allow this plugin to use its own settings to load and save notes.'; });
document.getElementById('save').addEventListener('click', async () => {
  try {
    await window.sandboxBridge.call('settings.set', { key: 'note', value: note.value });
    status.textContent = 'Saved';
  } catch { status.textContent = 'Note was not saved. Check this plugin’s settings permission.'; }
});
