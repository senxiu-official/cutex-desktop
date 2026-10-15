// Run with Node 24: node apps/desktop/scripts/check-font-routing.cjs [output-directory]
// Vite serves only the preview; the sandboxed Electron window has no preload or real daemon.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const desktop = path.resolve(__dirname, '..');
const out = process.env.CUTEX_FONT_PROBE_OUT || path.resolve(process.argv[2] || path.join(desktop, '../../.dev/font-routing'));
fs.mkdirSync(out, { recursive: true });

if (!process.versions.electron) {
  (async () => {
    const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
    const server = await createServer({ configFile: path.join(desktop, 'vite.preview.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/font-routing.html`;
    const env = { ...process.env, CUTEX_FONT_PROBE_OUT: out, CUTEX_FONT_PROBE_URL: url };
    delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(out, 'electron.log'), 'w');
    const child = spawn(require('electron'), [__filename], { cwd: desktop, env, windowsHide: true, stdio: ['ignore', log, log] });
    const timer = setTimeout(() => child.kill(), 90000);
    child.on('exit', async (code) => {
      clearTimeout(timer); fs.closeSync(log); await server.close();
      const resultFile = path.join(out, 'result.json');
      const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
      console.log(JSON.stringify({ exitCode: code, ok: result?.ok, resultFile, checks: result?.checks?.length, failed: result?.checks?.filter((check) => !check.ok), error: result?.error }, null, 2));
      process.exitCode = code === 0 && result?.ok ? 0 : 1;
    });
  })().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1120, height: 1220, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const origin = new URL(process.env.CUTEX_FONT_PROBE_URL).origin;
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^(?:https?|wss?):/.test(details.url) && new URL(details.url.replace(/^ws/, 'http')).origin !== origin });
    });
    let result;
    let code = 0;
    try {
      await window.loadURL(process.env.CUTEX_FONT_PROBE_URL);
      result = await window.webContents.executeJavaScript('window.fontRoutingProbe.check()');
      window.webContents.debugger.attach('1.3');
      const cdp = (method, params = {}) => window.webContents.debugger.sendCommand(method, params);
      await cdp('DOM.enable'); await cdp('CSS.enable');
      const inspect = async (metrics) => {
        const doc = await cdp('DOM.getDocument');
        for (const metric of metrics) {
          const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#' + metric.id });
          metric.platformFonts = (await cdp('CSS.getPlatformFontsForNode', { nodeId })).fonts;
        }
      };
      await inspect(result.metrics);
      fs.writeFileSync(path.join(out, 'preview.png'), (await window.webContents.capturePage()).toPNG());
      // Both selected fonts cover Latin and Han: the assigned script must still win.
      const status = await window.webContents.executeJavaScript('window.fontRoutingProbe.setFonts({chatFont:"KingHwa_OldSong",chatCjkFont:"Microsoft YaHei"})');
      result.broadFontStatus = status;
      result.broadFontMetrics = await window.webContents.executeJavaScript('window.fontRoutingProbe.metrics().filter(m=>m.sample==="sample-broad")');
      await inspect(result.broadFontMetrics);
      const expected = (metric, family) => metric.platformFonts.length > 0 && metric.platformFonts.every((font) => font.familyName.toLowerCase().includes(family.toLowerCase()));
      if (!result.status.failedFamilies.length && !status.failedFamilies.length) {
        for (const metric of result.metrics.filter((m) => ['sample-english', 'sample-mixed', 'sample-apostrophe'].includes(m.sample))) {
          const family = metric.kind === 'font-run-cjk' ? 'KingHwa' : 'Segoe UI';
          result.checks.push({ name: `platform font ${metric.sample} ${metric.text}`, ok: expected(metric, family) });
        }
        result.checks.push({ name: 'broad cmap sample has both run kinds', ok: new Set(result.broadFontMetrics.map((m) => m.kind)).size === 2 });
        for (const metric of result.broadFontMetrics) result.checks.push({ name: `broad cmap isolation: ${metric.text}`, ok: expected(metric, metric.kind === 'font-run-cjk' ? 'Microsoft YaHei' : 'KingHwa') });
      } else result.platformFontCheckSkipped = 'Reference fonts are unavailable on this machine; inspect fallback metrics.';
      result.ok = result.checks.every((check) => check.ok);
      if (!result.ok) code = 1;
      result.versions = { electron: process.versions.electron, chrome: process.versions.chrome };
    } catch (error) { result = { ok: false, error: error.stack }; code = 1; }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    window.destroy(); app.exit(code);
  });
}
