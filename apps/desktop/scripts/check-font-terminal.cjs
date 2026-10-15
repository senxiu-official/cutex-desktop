// Standalone real Electron + real TerminalBody + in-memory mock PTY acceptance.
// Does not start product main, connect a daemon, spawn a shell, or load real userData.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const appDir = path.resolve(__dirname, '..');
const appRequire = createRequire(path.join(appDir, 'package.json'));
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const out = path.resolve(outArg ? outArg.slice(6) : path.join(repo, '.dev/font-terminal-check'));
fs.mkdirSync(out, { recursive: true });

async function build() {
  // Vite's eager glob becomes the same static imports in this independent bundle.
  const globPlugin = { name: 'standalone-vite-globs', setup(builder) {
    builder.onLoad({ filter: /[\\/]dev[\\/]mockModules\.ts$/ }, ({ path: filename }) => ({
      contents: `import { mock } from '../modules/terminal/mock'; export const MODULE_MOCKS = [{id:'terminal', mock}];`,
      loader: 'ts', resolveDir: path.dirname(filename),
    }));
    builder.onLoad({ filter: /[\\/]modules[\\/]i18nCatalog\.ts$/ }, ({ path: filename }) => {
      const dir = path.dirname(filename);
      const names = fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'i18n.ts'))).sort();
      const imports = names.map((name, i) => `import * as d${i} from ${JSON.stringify('./' + name + '/i18n')};`).join('\n');
      const map = '{' + names.map((name, i) => `${JSON.stringify('./' + name + '/i18n.ts')}:d${i}`).join(',') + '}';
      const contents = imports + '\n' + fs.readFileSync(filename, 'utf8').replace(/import\.meta\.glob<ModuleDictionary>\([^;]+\)/, map);
      return { contents, loader: 'ts', resolveDir: dir };
    });
  }};
  const viteRequire = createRequire(appRequire.resolve('vite/package.json'));
  await viteRequire('esbuild').build({
    entryPoints: [path.join(appDir, 'dev/fontTerminalProbe.tsx')], outfile: path.join(out, 'probe.js'), bundle: true,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'import.meta.env.DEV': 'true', 'process.env.NODE_ENV': '"development"' },
    plugins: [globPlugin], logLevel: 'warning',
  });
  fs.writeFileSync(path.join(out, 'probe.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'"><link rel="stylesheet" href="probe.css"><style>:root{--bg:#fff;--fg:#222;--surface-2:#cdd}body{margin:20px}[data-terminal-view]{height:100%;width:100%;box-sizing:border-box}#root{width:850px;height:420px}#root>div{height:100%}</style></head><body><div id="root"></div><script src="probe.js"></script></body></html>`);
}

async function electronMain() {
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', path.join(out, `private-user-data-${process.pid}`));
  await app.whenReady();
  const blocked = [];
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    blocked.push(details.url); callback({ cancel: true });
  });
  const win = new BrowserWindow({ show: false, width: 1050, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const consoleMessages = [];
  win.webContents.on('console-message', (event) => consoleMessages.push({ level: event.level, message: event.message }));
  await win.loadFile(path.join(out, 'probe.html'));
  const deadline = Date.now() + 25000;
  let result;
  let captured = false;
  while (!result && Date.now() < deadline) {
    if (!captured && await win.webContents.executeJavaScript('Boolean(window.terminalProbeCaptureReady)')) {
      fs.writeFileSync(path.join(out, 'terminal.png'), (await win.webContents.capturePage()).toPNG());
      captured = true;
      await win.webContents.executeJavaScript('window.terminalProbeCaptured = true');
    }
    result = await win.webContents.executeJavaScript('window.terminalProbeResult ?? null');
    if (!result) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  result ??= { passed: false, error: 'Probe timed out' };
  result.versions = process.versions;
  result.blockedNetworkRequests = blocked;
  result.consoleMessages = consoleMessages;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  win.destroy();
  app.exit(result.passed && blocked.length === 0 ? 0 : 1);
}

async function nodeMain() {
  for (const name of ['result.json', 'runner-error.txt', 'terminal.png']) {
    const artifact = path.join(out, name);
    if (fs.existsSync(artifact)) fs.unlinkSync(artifact);
  }
  await build();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(path.join(out, 'process.log'), 'w');
  const child = spawn(appRequire('electron'), [__filename, `--out=${out}`], { cwd: out, env, windowsHide: true, stdio: ['ignore', log, log] });
  const timeout = setTimeout(() => child.kill(), 35000);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timeout); fs.closeSync(log);
  const resultPath = path.join(out, 'result.json');
  const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  console.log(JSON.stringify({ exitCode: code, resultPath, passed: result?.passed, error: result?.error, snapshots: result?.snapshots?.map(({ label, cols, rows, fontSize, charWidth, resizeCount, fontStatus }) => ({ label, cols, rows, fontSize, charWidth, resizeCount, fontStatus })) }, null, 2));
  process.exitCode = code === 0 && result?.passed ? 0 : 1;
}

(process.versions.electron ? electronMain() : nodeMain()).catch((error) => {
  fs.writeFileSync(path.join(out, 'runner-error.txt'), error.stack || String(error));
  console.error(error); process.exit(1);
});
