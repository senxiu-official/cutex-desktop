// Run with Node, not the product Electron entry. Each execution creates its own isolated profile.
// node apps/desktop/scripts/check-font-selection.cjs
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const desktop = path.resolve(__dirname, "..");
const workspace = path.resolve(desktop, "../..");

if (!process.versions.electron) {
  const output = path.join(workspace, ".dev", "font-selection-check", `${Date.now()}-${process.pid}`);
  fs.mkdirSync(output, { recursive: true });
  const esbuild = createRequire(require.resolve("vite/package.json"))("esbuild");
  esbuild.buildSync({
    entryPoints: [path.join(desktop, "dev", "fontSelectionProbe.tsx")], outfile: path.join(output, "probe.js"),
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", target: "chrome152",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
  });
  fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><title>Font selection isolated checks</title><style>body{font:16px/1.5 "Segoe UI",sans-serif;padding:20px}.markdown p{margin:1em 0}.font-run-cjk{font-family:serif}.font-run-latin{font-family:"Segoe UI",sans-serif}</style></head><body><p id="status">Running isolated checks</p><div id="app"></div><script src="probe.js"></script></body></html>');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [__filename, "--font-selection-output", output], {
    cwd: desktop, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const log = fs.createWriteStream(path.join(output, "process.log"));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const timer = setTimeout(() => { child.kill(); }, 90000);
  child.on("error", (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
  child.on("close", (code) => {
    clearTimeout(timer); log.end();
    const evidencePath = path.join(output, "evidence.json");
    const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) : null;
    console.log(JSON.stringify({ output, evidencePath, exitCode: code, passed: evidence?.passed ?? false,
      checks: evidence?.checks?.length ?? 0, failures: evidence?.checks?.filter((item) => !item.passed) ?? [], error: evidence?.error }, null, 2));
    process.exitCode = code === 0 && evidence?.passed ? 0 : 1;
  });
} else {
  const { app, BrowserWindow } = require("electron");
  const output = process.argv[process.argv.indexOf("--font-selection-output") + 1];
  if (!output || !path.resolve(output).startsWith(path.join(workspace, ".dev", "font-selection-check") + path.sep)) throw new Error("Invalid isolated output directory");
  app.setPath("userData", path.join(output, "profile"));
  app.setPath("sessionData", path.join(output, "profile"));
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app.commandLine.appendSwitch("disable-background-networking");
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const blockedRequests = [];
    window.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
      blockedRequests.push(details.url); callback({ cancel: true });
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("console-message", (_event, ...args) => fs.appendFileSync(path.join(output, "console.log"), args.map(String).join(" ") + "\n"));
    let passed = false;
    try {
      await window.loadFile(path.join(output, "index.html"));
      const result = await window.webContents.executeJavaScript("window.runFontSelectionProbe()");
      result.versions = process.versions;
      result.dependencies = Object.fromEntries(["react", "react-dom", "streamdown", "@streamdown/cjk", "@streamdown/code"].map((name) => [name,
        JSON.parse(fs.readFileSync(path.join(desktop, "node_modules", name, "package.json"), "utf8")).version]));
      result.blockedNetworkRequests = blockedRequests;
      fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(output, "fixture.png"), (await window.webContents.capturePage()).toPNG());
      passed = result.passed;
    } catch (error) {
      fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify({ passed: false, error: error.stack, blockedNetworkRequests: blockedRequests }, null, 2));
    } finally {
      window.destroy(); app.exit(passed ? 0 : 1);
    }
  }).catch((error) => {
    fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify({ passed: false, error: error.stack }, null, 2));
    app.exit(1);
  });
}
