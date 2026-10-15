for (const [name, state] of [['Sample simulation', 'Running'], ['Sample analysis', 'Queued'], ['Sample report', 'Complete']]) {
  const row = document.createElement('li'); row.textContent = `${name} — ${state}`;
  document.getElementById('jobs').append(row);
}
const status = document.getElementById('status');
async function refresh() {
  try {
    const agents = await window.sandboxBridge.call('agents.list');
    const list = document.getElementById('agents'); list.replaceChildren();
    for (const agent of agents) {
      const row = document.createElement('li');
      const button = document.createElement('button'); button.textContent = `${agent.name} · ${agent.state}`;
      button.addEventListener('click', () => window.sandboxBridge.call('agents.open', { id: agent.id }).catch(() => { status.textContent = 'Could not open that Agent. Refresh the list and check the open permission.'; }));
      row.append(button); list.append(row);
    }
    status.textContent = `${agents.length} agents`;
  } catch { status.textContent = 'Allow Agent metadata access to show the current host’s agents.'; }
}
document.getElementById('refresh').addEventListener('click', refresh);
void refresh();
