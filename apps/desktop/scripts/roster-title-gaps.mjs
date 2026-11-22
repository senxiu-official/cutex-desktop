// Real-renderer regression for the 花名册's spacing (owner 2026-11-19 zero gap between titles; cross-review: decided by
// what a block ends with, not by its fold). Loads the mock preview (the compiled styles) in headless Chrome and, for
// every 项目颜色 separation and several fold states, measures each pair of neighbouring roster blocks
// ([data-roster-kind] siblings, at every level): a block whose last line is a title touches the next block's title
// (gap 0); a block whose last line is a row (agent rows, pinned rows, a fold line, a folded 文件夹's attention projects)
// keeps the gap: 12 px next to a 文件夹 / 系统行, else the separation's project gap.
// Start the mock preview (pnpm --filter desktop preview:web, or vite --config vite.preview.config.ts), then
//   node scripts/roster-title-gaps.mjs
// Optional: ROSTER_PREVIEW_URL (default http://127.0.0.1:5199/), ROSTER_CHROME (a Chrome / Chromium executable).
// Exit 1 on any wrong gap. No daemon calls; a private temporary profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = new URL(process.env.ROSTER_PREVIEW_URL || "http://127.0.0.1:5199/");
assert(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use a local mock preview");
assert(!["24260", "24270", "25360", "25370"].includes(url.port), "Control ports are not previews");
const chromePath = process.env.ROSTER_CHROME || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "google-chrome");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "roster-gaps-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1418,1400", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
let failures = 0;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
    } catch {
      await sleep(100);
    }
  }
  assert(port, "Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) pending.get(m.id)?.(m), pending.delete(m.id);
  };
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const navigate = async () => {
    await send("Page.navigate", { url: url.href });
    for (let i = 0; i < 150; i++) {
      if (await ev(`!!document.querySelector('nav[data-sidebar-roster="roster"] [data-group-key]')`).catch(() => false)) return;
      await sleep(200);
    }
    throw new Error("the roster never showed");
  };
  await send("Page.enable");
  await navigate();
  await ev(`localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false })); localStorage.setItem("cutex-desktop.locale", "zh-CN"); 1`);
  await navigate();
  await sleep(1500);
  // The modules the preview loaded (the same instances the app uses).
  await ev(`window.qaImport = (p) => import(performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === p).at(-1)?.name || p); 1`);
  // Folders over the mock's projects: the first holds the project with agents needing you (an attention project).
  const keys = await ev(`(() => {
    const nav = document.querySelector('nav[data-sidebar-roster="roster"]');
    const blocks = [...nav.querySelectorAll('[data-group-key]')].filter((n) => !n.dataset.groupKey.startsWith("__"));
    return [...new Set(blocks.map((n) => n.dataset.groupKey))];
  })()`);
  assert(keys.length >= 4, `the mock has too few projects (${keys.length})`);

  /** Every pair of neighbouring blocks: [what, gap, expected]. */
  const measure = () =>
    ev(`(() => {
      const nav = document.querySelector('nav[data-sidebar-roster="roster"]');
      const content = '[data-row-selectable], [data-agent-fold], [data-project-remark], [data-pinned-rows], [data-roster-kind] > p';
      const title = '[data-stick], [data-one-row], [data-roster-kind] > button';
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.height > 0 ? r : null; };
      const lastBottom = (block, sel) => Math.max(-1e9, ...[...block.querySelectorAll(sel)].map(shown).filter(Boolean).map((r) => r.bottom));
      const sys = (b) => ["folder", "system"].includes(b.dataset.rosterKind);
      const projectGap = parseFloat(getComputedStyle(nav).getPropertyValue("--roster-gap-project"));
      const name = (b) => (b.querySelector('[data-folder-name], [data-stick], [data-one-row]')?.textContent || b.dataset.rosterKind).trim().slice(0, 18);
      const out = [];
      for (const block of nav.querySelectorAll('[data-roster-kind]')) {
        const next = block.nextElementSibling;
        if (!next?.matches('[data-roster-kind]') || !shown(block) || !shown(next)) continue;
        // Its last line: a title, or rows (whichever ends lower).
        const endsTitle = lastBottom(block, title) >= lastBottom(block, content);
        const gap = Math.round((next.getBoundingClientRect().top - block.getBoundingClientRect().bottom) * 100) / 100;
        const expected = endsTitle ? 0 : sys(block) || sys(next) ? 12 : projectGap;
        out.push([name(block) + " → " + name(next), endsTitle ? "title" : "rows", gap, expected]);
      }
      return out;
    })()`);

  const setup = (folded, shows, firstOpen) =>
    ev(`(async () => {
      const p = await window.qaImport("/src/lib/prefs.ts");
      const keys = ${JSON.stringify(keys)};
      p.setUiPref("sectionCollapsedShows", ${JSON.stringify(shows)});
      p.updateSections(() => ["科研 Research", "开发 Development", "生活", "不重要"].map((name, i) => ({ id: "gap" + i, name, collapsed: i === 0 ? !${firstOpen} : ${folded}, members: keys[i] ? [keys[i]] : [] })));
      return 1;
    })()`);
  const SCENARIOS = [
    // Every folder folded to its title (summary): titles touch.
    { name: "pure folded titles", folded: true, shows: "summary", firstOpen: false },
    // Folders open: their projects' rows end before the next title.
    { name: "expanded projects", folded: false, shows: "summary", firstOpen: true },
    // 「收起时显示：需要处理的项目」: the folded first folder still lists its attention project, expanded with rows.
    { name: "folded with attention project", folded: true, shows: "attention", firstOpen: false, mustHaveRows: "科研 Research" },
  ];
  for (const sep of ["none", "iconLine", "rail", "tint", "header"]) {
    for (const s of SCENARIOS) {
      await ev(`(async () => { (await window.qaImport("/src/lib/prefs.ts")).setUiPref("projectSeparation", ${JSON.stringify(sep)}); return 1; })()`);
      await setup(s.folded, s.shows, s.firstOpen);
      await sleep(500);
      const pairs = await measure();
      const bad = pairs.filter(([, , gap, expected]) => Math.abs(gap - expected) > 0.5);
      if (s.mustHaveRows && !pairs.some(([what, ends]) => what.startsWith(s.mustHaveRows) && ends === "rows")) bad.push([`${s.mustHaveRows}: no rows under the folded folder (the case is not set up)`, "-", NaN, NaN]);
      if (!pairs.some(([, ends]) => ends === "title")) bad.push(["no title → title pair measured", "-", NaN, NaN]);
      console.log(`${bad.length ? "FAIL" : "ok  "} ${sep.padEnd(8)} ${s.name}: ${pairs.length} pairs (${pairs.filter((p) => p[1] === "title").length} title → title, ${pairs.filter((p) => p[1] === "rows").length} rows → title)`);
      for (const b of bad) console.log(`       ${b[0]} [ends with ${b[1]}]: gap ${b[2]}, expected ${b[3]}`);
      failures += bad.length;
    }
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome may still hold a file for a moment; the folder is in the system temp directory.
  }
}
process.exit(failures ? 1 : 0);
