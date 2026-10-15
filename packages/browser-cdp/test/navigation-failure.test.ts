import { describe, it, expect } from 'vitest';
import { ProtocolError } from '@cutex-desktop/browser-protocol';
import { BrowserCdpExecutor } from '../src/index.js';

function setup() {
  let url = 'https://example.com/';
  let failing = true;
  let denied = false;
  let allowed = true;
  let lostReply = false;
  let errorText = 'net::ERR_PROXY_CONNECTION_FAILED private diagnostics must not be copied';
  let generation = 0;
  const calls: string[] = [];
  const executor = new BrowserCdpExecutor({
    async send(method, params = {}) {
      calls.push(method);
      if (method === 'Page.navigate') {
        if (lostReply) throw new Error('Lost acknowledgement');
        if (failing) {
          if (errorText !== 'net::ERR_ABORTED') url = 'chrome-error://chromewebdata/';
          return { errorText };
        }
        url = String(params.url); return { frameId: 'main' };
      }
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url } } };
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      return {};
    },
    onEvent() { return () => {}; },
    onDetach() { return () => {}; },
  }, {
    nextPageGeneration: () => ++generation,
    authorize: () => { if (denied) throw new ProtocolError('permission_denied', 'Lease revoked'); },
    ensureVisible: () => {}, allowUrl: () => allowed,
  });
  return { executor, calls, recover: () => { failing = false; }, revoke: () => { denied = true; },
    block: () => { allowed = false; }, loseReply: () => { lostReply = true; }, setUrl: (value: string) => { url = value; },
    setErrorText: (value: string) => { errorText = value; } };
}

describe('failed navigation diagnostics without weakening authorization or URL policy', () => {
  it('reports a confirmed navigation failure without replay or raw diagnostics', async () => {
    const p = setup();
    try {
      await expect(p.executor.navigate('https://example.com/failed')).rejects.toMatchObject({
        code: 'navigation_failed', message: expect.stringContaining('Navigation failed'),
      });
      expect(p.calls.filter(c => c === 'Page.navigate')).toHaveLength(1);
      await expect(p.executor.read()).rejects.toMatchObject({
        code: 'navigation_failed', message: expect.stringContaining('unreadable error document'),
      });
      expect(p.calls).not.toContain('Accessibility.getFullAXTree');
      expect(p.calls.some(c => c.startsWith('Runtime.evaluate') || c === 'Page.captureScreenshot')).toBe(false);
    } finally { p.executor.dispose(); }
  });
  it.each(['read', 'find', 'screenshot'] as const)('blocks error-page %s without reading its content', async operation => {
    const p = setup(); p.setUrl('chrome-error://chromewebdata/');
    try {
      await expect(operation === 'find' ? p.executor.find({ text: 'error' }) : p.executor[operation]())
        .rejects.toMatchObject({ code: 'navigation_failed' });
      expect(p.calls).not.toContain('Accessibility.getFullAXTree');
      expect(p.calls).not.toContain('Page.captureScreenshot');
      expect(p.calls).not.toContain('Page.createIsolatedWorld');
    } finally { p.executor.dispose(); }
  });
  it('treats net::ERR_ABORTED (204, download, superseded) as outcome_unknown, not navigation_failed', async () => {
    const p = setup(); p.setErrorText('net::ERR_ABORTED');
    try {
      await expect(p.executor.navigate('https://example.com/no-content')).rejects.toMatchObject({
        code: 'outcome_unknown', message: expect.stringContaining('may have reached the server'),
      });
      expect(p.calls.filter(c => c === 'Page.navigate')).toHaveLength(1);
      // The old page stays readable (no error document).
      await expect(p.executor.read()).resolves.toMatchObject({ url: 'https://example.com/' });
    } finally { p.executor.dispose(); }
  });
  it('permits a new explicit allowed navigation on the same executor', async () => {
    const p = setup();
    try {
      await expect(p.executor.navigate('https://example.com/failed')).rejects.toMatchObject({ code: 'navigation_failed' });
      p.recover();
      await expect(p.executor.navigate('https://example.com/recovered')).resolves.toMatchObject({ status: 'dispatched' });
      await expect(p.executor.read()).resolves.toMatchObject({ nodes: [], url: 'https://example.com/recovered' });
      expect(p.calls.filter(c => c === 'Page.navigate')).toHaveLength(2);
    } finally { p.executor.dispose(); }
  });
  it('retains actual authorization denial after navigation failure', async () => {
    const p = setup();
    try {
      await expect(p.executor.navigate('https://example.com/failed')).rejects.toMatchObject({ code: 'navigation_failed' });
      p.revoke(); const count = p.calls.length;
      await expect(p.executor.read()).rejects.toMatchObject({ code: 'permission_denied' });
      expect(p.calls).toHaveLength(count);
    } finally { p.executor.dispose(); }
  });
  it('still refuses explicit chrome-error navigation and other forbidden schemes', async () => {
    const p = setup();
    try {
      for (const url of ['chrome-error://chromewebdata/', 'file:///etc/passwd', 'chrome://settings/']) {
        await expect(p.executor.navigate(url)).rejects.toMatchObject({ code: 'permission_denied' });
        p.setUrl(url === 'chrome-error://chromewebdata/' ? 'chrome-error://other/' : url);
        await expect(p.executor.read()).rejects.toMatchObject({ code: 'permission_denied' });
      }
      expect(p.calls).not.toContain('Page.navigate');
      expect(p.calls).not.toContain('Accessibility.getFullAXTree');
    } finally { p.executor.dispose(); }
  });
  it('does not bypass host URL restrictions during recovery', async () => {
    const p = setup(); p.block();
    try {
      await expect(p.executor.navigate('https://example.com/')).rejects.toMatchObject({ code: 'permission_denied' });
      expect(p.calls).not.toContain('Page.navigate');
    } finally { p.executor.dispose(); }
  });
  it('keeps lost navigation acknowledgement uncertain with no replay', async () => {
    const p = setup(); p.loseReply();
    try {
      await expect(p.executor.navigate('https://example.com/')).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(p.calls.filter(c => c === 'Page.navigate')).toHaveLength(1);
    } finally { p.executor.dispose(); }
  });
});
