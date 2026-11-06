// Validate an actual published desktop update on a fresh CI runner.
// Both packages retain their production keys and update URLs; no rebuild or test hooks.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { registerHooks } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.GITHUB_WORKSPACE || join(dirname(fileURLToPath(import.meta.url)), '../..'));
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './blake2b' && context.parentURL?.endsWith('/src/main/minisign.ts') ? './blake2b.ts' : specifier, context);
} });
const { verifyPrehashed, releaseKeyring, parsePublicKey } = await import(pathToFileURL(join(root, 'apps/desktop/src/main/minisign.ts')).href);
const digest = async (file, algorithm) => {
  const hash = createHash(algorithm);
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest();
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const verify = async (file, keys = releaseKeyring()) => verifyPrehashed(await digest(file, 'blake2b512'), readFileSync(file + '.minisig', 'utf8'), keys, file.split(/[\\/]/).at(-1));
if (process.argv.includes('--self-test')) {
  const fixture = join(root, 'apps/desktop/test/fixtures/minisign');
  const file = join(fixture, 'payload.txt');
  const keys = [parsePublicKey(readFileSync(join(fixture, 'test.pub'), 'utf8'))];
  await verify(file, keys);
  let refused = false;
  try { await verify(file); } catch { refused = true; }
  assert(refused, 'production keys accepted the test key');
  refused = false;
  try { verifyPrehashed(Buffer.alloc(64), readFileSync(file + '.minisig', 'utf8'), keys, 'payload.txt'); } catch { refused = true; }
  assert(refused, 'changed payload accepted');
  refused = false;
  try { verifyPrehashed(await digest(file, 'blake2b512'), readFileSync(file + '.minisig', 'utf8'), keys, 'other.txt'); } catch { refused = true; }
  assert(refused, 'wrong signed filename accepted');
  console.log('Signature preflight self-test passed.');
  process.exit(0);
}

const from = process.env.FROM_VERSION || '0.2.1';
const to = process.env.TO_VERSION || '0.2.2';
const commit = process.env.TO_COMMIT;
assert(/^\d+\.\d+\.\d+$/.test(from) && /^\d+\.\d+\.\d+$/.test(to), 'invalid versions');
assert(/^[a-f0-9]{40}$/.test(commit || ''), 'TO_COMMIT must be the exact public product commit');
const work = resolve(process.env.PUBLIC_UPDATE_WORK || join(process.env.RUNNER_TEMP || '', 'desktop-public-update'));
assert(!existsSync(work), 'work directory must be fresh');
mkdirSync(work, { recursive: true });
const dirs = Object.fromEntries(['assets', 'base', 'home', 'userData', 'shortcuts', 'logs'].map(k => [k, join(work, k)]));
Object.values(dirs).forEach(d => mkdirSync(d, { recursive: true }));
const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const platform = win ? 'windows-x64' : mac ? `macos-${process.arch}` : 'linux-x64';
const extension = win || mac ? 'zip' : 'tar.gz';
const archiveName = `cutex-desktop-${from}-${platform}.${extension}`;
const result = { from, to, expectedPublicCommit: commit, platform, officialPackages: true, rebuilt: false, testHooks: false, ok: false };
const run = (cmd, args, extra = {}) => {
  const out = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...extra });
  assert(out.status === 0, `${cmd} exited ${out.status}: ${out.stderr || out.stdout}`);
  return out.stdout;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(label, test, timeout = 120_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await test(); if (value) return value; } catch (e) { last = e; }
    await sleep(1500);
  }
  throw new Error(`${label} timed out${last ? ': ' + last.message : ''}`);
}
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
let launched;
async function cdp(url, method, params = {}) {
  const socket = new WebSocket(url);
  await new Promise((r, j) => { socket.addEventListener('open', r); socket.addEventListener('error', j); });
  try {
    return await new Promise((r, j) => {
      const timer = setTimeout(() => j(new Error(`${method} timed out`)), 30_000);
      socket.addEventListener('message', event => {
        const data = JSON.parse(String(event.data));
        if (data.id === 1) { clearTimeout(timer); data.error ? j(new Error(data.error.message)) : r(data.result); }
      });
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally { socket.close(); }
}
async function page() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
  for (const p of list.filter(p => p.type === 'page')) {
    const v = await cdp(p.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: "typeof cutex === 'object' && !!cutex.update", returnByValue: true });
    if (v.result?.value) return p;
  }
  throw new Error('main window is not available');
}
async function evaluate(expression) {
  const p = await page();
  const value = await cdp(p.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
  return value.result.value;
}
async function shot(name) {
  try {
    const p = await page(); const v = await cdp(p.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dirs.logs, `${name}.png`), Buffer.from(v.data, 'base64'));
  } catch {}
}
try {
  run('gh', ['release', 'download', `v${from}`, '-R', 'senxiu-official/cutex-desktop', '-D', dirs.assets,
    '-p', archiveName, '-p', archiveName + '.minisig', '-p', 'SHA256SUMS', '-p', 'SHA256SUMS.minisig']);
  result.archiveSignature = await verify(join(dirs.assets, archiveName));
  result.sumsSignature = await verify(join(dirs.assets, 'SHA256SUMS'));
  const hash = (await digest(join(dirs.assets, archiveName), 'sha256')).toString('hex');
  const line = readFileSync(join(dirs.assets, 'SHA256SUMS'), 'utf8').split(/\r?\n/).find(l => l.endsWith('  ' + archiveName));
  assert(line?.slice(0, 64) === hash, 'old archive hash differs from signed sums');
  result.fromArchiveSha256 = hash;
  const release = join(dirs.base, 'releases', from + (mac ? '.noindex' : ''));
  mkdirSync(join(dirs.base, 'releases'), { recursive: true });
  const archive = join(dirs.assets, archiveName);
  for (const path of [release, join(work, 'unpack'), join(dirs.base, 'current')]) {
    const within = relative(work, resolve(path));
    assert(within && !within.startsWith('..') && !isAbsolute(within), 'install target escapes its private work directory');
  }
  if (win) {
    run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:OLD_ZIP -DestinationPath $env:OLD_UNPACK; Move-Item -LiteralPath (Join-Path $env:OLD_UNPACK $env:OLD_NAME) -Destination $env:OLD_RELEASE; New-Item -ItemType Junction -Path $env:OLD_CURRENT -Target $env:OLD_RELEASE | Out-Null"],
      { env: { ...process.env, OLD_ZIP: archive, OLD_UNPACK: join(work, 'unpack'), OLD_NAME: archiveName.replace(/\.zip$/, ''), OLD_RELEASE: release, OLD_CURRENT: join(dirs.base, 'current') } });
  } else {
    if (mac) {
      run('ditto', ['-x', '-k', archive, join(work, 'unpack')]);
      run('mv', [join(work, 'unpack', archiveName.replace(/\.zip$/, '')), release]);
      run('codesign', ['--verify', '--deep', '--strict', join(release, 'Cutex.app')]);
    } else { mkdirSync(release); run('tar', ['-xzf', archive, '-C', release, '--strip-components=1']); }
    run('ln', ['-s', release, join(dirs.base, 'current')]);
  }
  writeFileSync(join(dirs.base, 'channel'), 'release\n');
  const metadataPath = rel => mac ? join(rel, 'Cutex.app/Contents/Resources/app/package.json') : join(rel, 'resources/app/package.json');
  const old = JSON.parse(readFileSync(metadataPath(release), 'utf8'));
  assert(old.version === from && old.updateTestHooks !== true, 'old package identity/hooks differ');
  result.fromPackage = { version: old.version, commit: old.commit, updateTestHooks: old.updateTestHooks === true };
  const executable = mac ? join(release, 'Cutex.app/Contents/MacOS/Cutex') : join(release, win ? 'cutex.exe' : 'cutex');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ELECTRON_|CUTEX_|GH_TOKEN$|GITHUB_TOKEN$|ACTIONS_RUNTIME_TOKEN$)/.test(key)) delete env[key];
  Object.assign(env, { CUTEX_DESKTOP_MULTI_INSTANCE: '1', CUTEX_DESKTOP_USER_DATA: dirs.userData,
    CUTEX_DESKTOP_SHORTCUT_ROOT: dirs.shortcuts, CUTEX_DESKTOP_HOME: dirs.home, CUTEX_MANAGEMENT_URL: 'http://127.0.0.1:9' });
  if (!win && !mac) { env.HOME = dirs.home; delete env.WAYLAND_DISPLAY; }
  const output = openSync(join(dirs.logs, 'app.log'), 'a');
  launched = spawn(executable, [`--remote-debugging-port=${port}`, ...(mac ? ['--use-mock-keychain'] : win ? [] : ['--no-sandbox', '--ozone-platform=x11'])],
    { env, windowsHide: true, stdio: ['ignore', output, output] });
  await until('old application', page);
  result.before = await evaluate('cutex.update.state()');
  assert(result.before.binary === true && result.before.current?.version === from, 'old binary install not recognized');
  await shot('before');
  const offer = await evaluate('cutex.update.check()');
  assert(offer.state === 'available' && offer.latest?.version === to, `actual public channel did not offer ${to}: ${JSON.stringify(offer)}`);
  result.offer = offer.latest;
  await evaluate('cutex.update.apply()').catch(() => {});
  const after = await until('actual updated application', async () => {
    const s = await evaluate('cutex.update.state()');
    return s.current?.version === to && s.state !== 'updating' ? s : null;
  }, 10 * 60_000);
  assert(after.current?.commit === commit, 'updated application reports a different product commit');
  result.after = after;
  result.current = realpathSync(join(dirs.base, 'current'));
  const pkg = JSON.parse(readFileSync(metadataPath(result.current), 'utf8'));
  assert(pkg.version === to && pkg.commit === commit && pkg.updateTestHooks !== true, 'updated package identity/hooks differ');
  result.toPackage = { version: pkg.version, commit: pkg.commit, updateTestHooks: pkg.updateTestHooks === true };
  await until('update readiness confirmation', async () => /started fine/.test(readFileSync(join(dirs.userData, 'update.log'), 'utf8')), 60_000);
  await shot('after');
  result.ok = true;
} catch (error) {
  result.error = error.stack;
  await shot('failure');
  process.exitCode = 1;
} finally {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
    await cdp(v.webSocketDebuggerUrl, 'Browser.close');
  } catch { if (launched && launched.exitCode === null) launched.kill(); }
  writeFileSync(join(dirs.logs, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
