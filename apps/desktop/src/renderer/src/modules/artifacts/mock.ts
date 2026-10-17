// Browser-preview artifact store (dev/mockTypes.ts; wire docs/research/artifacts-api-v1.md): the
// demo-study project's results — a report with three versions (agent, agent via a delegation, owner),
// a figure (SVG) with two, an auto-captured table (exclusive), an ambiguous and an unknown auto
// capture, an archived draft. demo-writer's thread publishes and cites them (`cutex:artifact/…@2`
// links and an image) and an HTML page (figures/dose-response.html, rendered in the offline frame);
// ~12 s after start demo-writer republishes the page (auto-open), ~20 s regression.md v4 (live update).
import { ARTIFACT_PUBLISHED_EVENT, ARTIFACT_SHOW_FEATURE, ARTIFACT_SHOW_REQUESTED_EVENT, ARTIFACT_UPDATED_EVENT, ARTIFACTS_FEATURE, artifactLink, artifactRef, parseArtifactRef, type ArtifactCandidate, type ArtifactContent, type ArtifactDetail, type ArtifactKind, type ArtifactProducer, type ArtifactResolveItem, type ArtifactScope, type ArtifactSummary, type ArtifactVersion } from "../../../../shared/artifactStore";
import type { DesktopApi } from "../../../../shared/ipc";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const ROOT = "D:\\Research\\demo";
const SCOPE: ArtifactScope = { kind: "project", id: "demo" };
const SCP_SESSIONS = new Set(["demo-dir", "demo-run", "demo-done", "demo-idle", "demo-idle2"]);

const REPORT = "af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8";
const FIGURE = "af-8b2d4f6a1c3e5b7d9f0a2c4e6b8d0f13";
const TABLE = "af-c0ffee00112233445566778899aabbcc";
const SUMMARY = "af-5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const HANDOFF = "af-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const DRAFT = "af-d4a7b1e9c3f5082e6a4d1c7b9e3f5a20";
const ACCEPT = "af-7c3e9a1b5d2f4086e1a9c7b3d5f2e480";
const DOODLE = "af-7d00d1e0a1b2c3d4e5f60718293a4b5c";
const SUMMARY_PDF = "af-9a8b7c6d5e4f30211203f4e5d6c7b8a9";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const bytes = (text: string) => new TextEncoder().encode(text).length;
const sha = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};

const agent = (sessionId: string, displayName: string, turnId: string | null, askId: string | null = null): ArtifactProducer => ({
  kind: "agent",
  sessionId,
  displayName,
  runtimeGeneration: 3,
  turnId,
  askId,
  profile: "omega",
  model: "deepseek-v4",
  attribution: null,
  candidates: [],
});
const OWNER: ArtifactProducer = { kind: "owner", sessionId: null, displayName: null, runtimeGeneration: null, turnId: null, askId: null, profile: null, model: null, attribution: null, candidates: [] };
const auto = (attribution: "exclusive" | "ambiguous" | "unknown", candidates: ArtifactCandidate[]): ArtifactProducer => ({
  kind: "auto",
  sessionId: attribution === "exclusive" ? candidates[0]!.sessionId : null,
  displayName: attribution === "exclusive" ? candidates[0]!.displayName : null,
  runtimeGeneration: null,
  turnId: attribution === "exclusive" ? candidates[0]!.turnId : null,
  askId: null,
  profile: null,
  model: null,
  attribution,
  candidates,
});

// ── contents ─────────────────────────────────────────────────────────────────────────────────────

const report = (n: number) =>
  [
    "# Regression: power vs. sample size",
    "",
    `Data: \`data/demo-trial.csv\` (n = ${n >= 2 ? 412 : 438}${n >= 2 ? ", 26 excluded by the new rule" : ""}).`,
    "",
    "## Model",
    "",
    "Logistic regression of response on dose, age and site, with site as a random intercept.",
    "",
    "| term | estimate | 95% CI |",
    "|---|---|---|",
    `| dose | ${n >= 2 ? "0.41" : "0.37"} | ${n >= 2 ? "0.29 – 0.53" : "0.24 – 0.50"} |`,
    "| age (10 y) | -0.08 | -0.15 – -0.01 |",
    "",
    "## Findings",
    "",
    n >= 2 ? "The dose effect is stable after the exclusion; power at n = 400 is 0.86." : "The dose effect is positive; power at n = 400 is about 0.83.",
    "",
    "- **Dose**: positive and stable across sites.",
    "- **Age**: a small negative effect.",
    "",
    "![power curve](figures/power-curve.svg)",
    "",
    "```r",
    "glmer(response ~ dose + age + (1 | site), family = binomial)",
    "```",
    ...(n >= 3 ? ["", "_Owner: wording of the findings checked; see table 2 for the per-site numbers._"] : []),
    ...(n >= 4 ? ["", "## Section 2: sensitivity", "", "Dropping site C moves the dose estimate by less than 0.02."] : []),
    "",
  ].join("\n");

const figure = (n: number) => {
  const pts = n >= 2 ? "20,150 70,118 120,82 170,58 220,44 270,36" : "20,150 70,124 120,94 170,72 220,58 270,50";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="300" height="180"><rect width="300" height="180" fill="#ffffff"/><g stroke="#cbd5e1" stroke-width="1"><line x1="20" y1="160" x2="290" y2="160"/><line x1="20" y1="20" x2="20" y2="160"/><line x1="20" y1="48" x2="290" y2="48" stroke-dasharray="4 4"/></g><polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="3"/><text x="150" y="176" font-size="11" text-anchor="middle" fill="#475569" font-family="sans-serif">sample size</text><text x="26" y="44" font-size="10" fill="#64748b" font-family="sans-serif">power 0.8</text><text x="282" y="30" font-size="11" text-anchor="end" fill="#2563eb" font-family="sans-serif">v${n}</text></svg>`;
};

/** An agent page (HTML artifact, §10.2): inline CSS + script, drawn on a canvas; it also tries the network to show it can't. */
const doodle = (n: number) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Dose response</title>
<style>
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
  header { padding: 10px 14px; background: ${n >= 2 ? "#4f46e5" : "#0ea5e9"}; color: white; display: flex; justify-content: space-between; align-items: baseline; }
  header b { font-size: 15px; }
  canvas { display: block; margin: 12px auto; background: white; border: 1px solid #e2e8f0; border-radius: 8px; max-width: calc(100% - 24px); }
  .row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 0 12px 12px; }
  button { border: 1px solid #cbd5e1; background: white; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  #net { text-align: center; color: #64748b; font-size: 12px; }
</style></head>
<body>
<header><b>Dose response by site</b><span>v${n} · demo-writer</span></header>
<canvas id="c" width="420" height="240"></canvas>
<div class="row"><button id="shuffle">Resample</button><button id="mode">${n >= 2 ? "Bars" : "Lines"}</button></div>
<p id="net">network: checking…</p>
<script>
  const sites = "ABCDEFGH".split("");
  let mode = ${n >= 2 ? '"bars"' : '"lines"'};
  let data = sites.map((s, i) => 0.35 + i * 0.012 + (Math.sin(i * 1.7) * 0.04));
  const c = document.getElementById("c"), g = c.getContext("2d");
  function draw() {
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = "#e2e8f0"; for (let y = 40; y <= 200; y += 40) { g.beginPath(); g.moveTo(40, y); g.lineTo(400, y); g.stroke(); }
    const x = (i) => 60 + i * 46, y = (v) => 220 - (v - 0.2) * 500;
    g.fillStyle = g.strokeStyle = ${n >= 2 ? '"#4f46e5"' : '"#0ea5e9"'}; g.lineWidth = 3;
    if (mode === "bars") data.forEach((v, i) => g.fillRect(x(i) - 14, y(v), 28, 220 - y(v)));
    else { g.beginPath(); data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.stroke(); data.forEach((v, i) => { g.beginPath(); g.arc(x(i), y(v), 4, 0, 7); g.fill(); }); }
    g.fillStyle = "#475569"; g.font = "11px system-ui"; sites.forEach((s, i) => g.fillText(s, x(i) - 3, 236));
  }
  document.getElementById("shuffle").onclick = () => { data = data.map((v) => v + (Math.random() - 0.5) * 0.03); draw(); };
  document.getElementById("mode").onclick = (e) => { mode = mode === "bars" ? "lines" : "bars"; e.target.textContent = mode === "bars" ? "Lines" : "Bars"; draw(); };
  draw();
  // The page is offline by design: this request must fail (CSP connect-src 'none').
  fetch("http://127.0.0.1:24270/v2/health").then(() => { net.textContent = "network: reachable (unexpected!)"; net.style.color = "#dc2626"; },
    () => { net.textContent = "network: blocked (offline page) ✓"; });
</script>
</body></html>
`;

const TABLE2 = ["site,n,excluded,dose_est,ci_low,ci_high", ...["A", "B", "C", "D", "E", "F", "G", "H"].map((s, i) => `${s},${48 + i * 3},${i % 3},${(0.35 + i * 0.012).toFixed(3)},${(0.21 + i * 0.01).toFixed(3)},${(0.49 + i * 0.013).toFixed(3)}`), '"all sites, pooled",412,26,0.410,0.290,0.530', ""].join("\n");
const SIM = "simulation summary (seed 2026)\nreplicates: 2000\nn grid: 200, 300, 400, 500\npower: 0.61, 0.76, 0.86, 0.92\nwall time: 14 min\n";
/** An acceptance record saved as JSON in a .txt (the preview reads it as a record). */
const ACCEPT_TEXT = JSON.stringify({
  artifact: "A1 tail sensitivity",
  corrected_acceptance: { documents: ["REPORT_v1_1.md", "RUNBOOK_v1_1.md"], tests: "23/23 passed", executed_keycheck: "reviews/tail-readonly-v1_1-keycheck.txt", result: "PASS=true,skipped_large=[],failures=[]", limits: "Single-sample discrete sensitivity and a fixed seed; not a coverage study of future stages.", resource_record: "1h45m15.4s summed unit wall; 2 retries" },
  director_verification: { tests: "17/17 passed", export_verifier: "reviews/tail-sensitivity-verifier.py", input_manifest: "all 19 sha256 match, including the chain-1 failure archive", raw_arm_order: [8, 10, 12], accepted: true },
  open_items: [{ id: "T3", note: "rerun with the released source data" }],
}, null, 2);
const HANDOFF_TEXT = "# Handoff to demo-lit\n\n- Table 2 is final.\n- The figure caption still needs the CI method.\n";
const DRAFT_TEXT = "# Old draft\n\nSuperseded by reports/regression.md.\n";

// ── the store ────────────────────────────────────────────────────────────────────────────────────

interface Stored {
  summary: Omit<ArtifactSummary, "latest" | "latestVersion">;
  versions: MockVersion[]; // oldest first
}

/** `b64`: `text` is the base64 of a binary version (a PDF), served as base64 windows. */
type MockVersion = ArtifactVersion & { text: string; b64?: true };

/** A one-page PDF (Helvetica, ASCII) as base64, built here for the PDF preview of an artifact. */
function tinyPdf(lines: string[]): string {
  const ops = lines.flatMap((l, i) => [...(i ? ["/F1 12 Tf", "0 -24 Td"] : []), `(${l}) Tj`]);
  const stream = ["BT", "/F1 20 Tf", "72 720 Td", ...ops, "ET", "0.39 0.4 0.95 rg", "72 520 300 120 re f"].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return btoa(out);
}

function binaryVersion(v: ArtifactVersion & { text: string }): MockVersion {
  return { ...v, b64: true, bytes: atob(v.text).length };
}

function version(artifactId: string, n: number, text: string, mediaType: string, path: string, producer: ArtifactProducer, at: string, extra: Partial<ArtifactVersion> = {}): ArtifactVersion & { text: string } {
  const ref = artifactRef(artifactId, n);
  return { artifactId, version: n, ref, link: artifactLink(ref), storage: "blob", sha256: sha(text), bytes: bytes(text), mediaType, sourcePath: `${ROOT}\\${path.replace(/\//g, "\\")}`, note: null, producer, git: { commit: "4c1d7e2a9b0f3e6d8a5c2b1f0e9d8c7b6a5f4e3d", dirty: false }, createdAt: at, text, ...extra };
}

function seed(): Map<string, Stored> {
  const writer = (turn: string, ask: string | null = null) => agent("demo-done", "demo-writer", turn, ask);
  const stats = (turn: string) => agent("demo-idle2", "demo-stats", turn);
  const make = (artifactId: string, name: string, kind: ArtifactKind, versions: (ArtifactVersion & { text: string })[], extra: Partial<Stored["summary"]> = {}): [string, Stored] => [
    artifactId,
    { summary: { artifactId, scope: SCOPE, name, kind, revision: versions.length, starred: false, archivedAt: null, createdAt: versions[0]!.createdAt, updatedAt: versions[versions.length - 1]!.createdAt, ...extra }, versions },
  ];
  return new Map([
    make(
      REPORT,
      "reports/regression.md",
      "report",
      [
        version(REPORT, 1, report(1), "text/markdown", "reports/regression.md", writer("demo-t5"), ago(180), { note: "first draft" }),
        version(REPORT, 2, report(2), "text/markdown", "reports/regression.md", writer("demo-t7", "ask-demo-reg"), ago(42), { note: "rerun with the new exclusion rule", git: { commit: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d", dirty: true } }),
        version(REPORT, 3, report(3), "text/markdown", "reports/regression.md", OWNER, ago(12), { note: "wording checked" }),
      ],
      { starred: true },
    ),
    make(FIGURE, "figures/power-curve.svg", "figure", [
      version(FIGURE, 1, figure(1), "image/svg+xml", "figures/power-curve.svg", stats("demo-t3"), ago(200)),
      version(FIGURE, 2, figure(2), "image/svg+xml", "figures/power-curve.svg", writer("demo-t7", "ask-demo-reg"), ago(41), { note: "after the exclusion" }),
    ]),
    make(TABLE, "results/table2.csv", "table", [version(TABLE, 1, TABLE2, "text/csv", "results/table2.csv", auto("exclusive", [{ sessionId: "demo-run", displayName: "demo-sampler", turnId: "demo-t2" }]), ago(35))]),
    make(SUMMARY, "output/sim-summary.txt", "data", [
      version(SUMMARY, 1, SIM, "text/plain", "output/sim-summary.txt", auto("ambiguous", [
        { sessionId: "demo-run", displayName: "demo-sampler", turnId: "demo-t2" },
        { sessionId: "demo-idle2", displayName: "demo-stats", turnId: "demo-t3" },
      ]), ago(25), { git: null }),
    ]),
    make(HANDOFF, "handoff/notes.md", "handoff", [version(HANDOFF, 1, HANDOFF_TEXT, "text/markdown", "handoff/notes.md", auto("unknown", []), ago(8))]),
    make(DOODLE, "figures/dose-response.html", "figure", [version(DOODLE, 1, doodle(1), "text/html", "figures/dose-response.html", writer("demo-t10"), ago(3), { note: "interactive sketch" })]),
    make(SUMMARY_PDF, "reports/dose-response-summary.pdf", "report", [
      binaryVersion(version(SUMMARY_PDF, 1, tinyPdf(["Dose-response summary", "Generated in the browser preview (mock artifact).", "Pooled slope 0.42 per mg; see table2.csv."]), "application/pdf", "reports/dose-response-summary.pdf", writer("demo-t9"), ago(20), { note: "PDF export of the report" })),
    ]),
    make(ACCEPT, "reviews/a1-acceptance.txt", "report", [version(ACCEPT, 1, ACCEPT_TEXT, "text/plain", "reviews/a1-acceptance.txt", writer("demo-t9"), ago(23), { note: "A1 tail sensitivity Director acceptance" })]),
    make(DRAFT, "reports/old-draft.md", "report", [version(DRAFT, 1, DRAFT_TEXT, "text/markdown", "reports/old-draft.md", writer("demo-t4"), ago(300))], { archivedAt: ago(100) }),
  ]);
}

const strip = ({ text: _text, b64: _b64, ...v }: MockVersion): ArtifactVersion => v;
const summaryOf = (s: Stored): ArtifactSummary => ({ ...s.summary, latestVersion: s.versions.length, latest: strip(s.versions[s.versions.length - 1]!) });

/** A small unified diff (LCS over lines; one hunk) for the mock's diff route. */
function unifiedDiff(a: string, b: string, from: number, to: number): string {
  const x = a.split("\n");
  const y = b.split("\n");
  const m = x.length;
  const n = y.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && x[i] === y[j]) {
      lines.push(` ${x[i]}`);
      i++;
      j++;
    } else if (j < n && (i >= m || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) lines.push(`+${y[j++]}`);
    else lines.push(`-${x[i++]}`);
  }
  if (!lines.some((l) => l[0] !== " ")) return "";
  return [`--- v${from}`, `+++ v${to}`, `@@ -1,${m} +1,${n} @@`, ...lines].join("\n");
}

// ── the thread (demo-writer) ──────────────────────────────────────────────────────────────────────

const label = (name: string) => name.split(/[\\/]/).filter(Boolean).pop() ?? name;

const publishCall = (id: string, path: string, artifactId: string, n: number, note: string, newVersion = true) => {
  const ref = artifactRef(artifactId, n);
  // cutex labels the markdown link with the last path segment only (src/artifacts/mod.rs markdown()).
  const result = { ok: true, artifact_id: artifactId, name: path, version: n, ref, link: artifactLink(ref), markdown: `[${label(path)} v${n}](${artifactLink(ref)})`, new_version: newVersion, scope: SCOPE };
  return { type: "mcpToolCall", id, server: "cutex", tool: "artifact_publish", status: "completed", durationMs: 180, arguments: { path, note, action_id: `pub-${id}` }, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } };
};

function writerThread() {
  const now = Math.floor(Date.now() / 1000);
  const r2 = artifactLink(artifactRef(REPORT, 2));
  const f2 = artifactLink(artifactRef(FIGURE, 2));
  const tLatest = artifactLink(artifactRef(TABLE, "latest"));
  const refused = { ok: false, error: "artifact_path_forbidden", message: "path is outside the workspace root" };
  return {
    thread: {
      id: "thread-demo-done",
      turns: [
        {
          id: "demo-t7",
          status: "completed",
          startedAt: now - 2700,
          completedAt: now - 2460,
          items: [
            { type: "userMessage", id: "scpw-u7", content: [{ type: "text", text: "按新的排除规则重跑回归，结果写进 reports/regression.md，曲线也更新一下。" }] },
            { type: "commandExecution", id: "scpw-c7", command: "Rscript analysis/regression.R --exclude rule-2", status: "completed", exitCode: 0, durationMs: 41000, aggregatedOutput: "26 rows excluded\nwrote reports/regression.md\nwrote figures/power-curve.svg" },
            publishCall("scpw-p7a", "reports/regression.md", REPORT, 2, "rerun with the new exclusion rule"),
            publishCall("scpw-p7b", "figures/power-curve.svg", FIGURE, 2, "after the exclusion"),
            {
              type: "agentMessage",
              id: "scpw-a7",
              text: `回归按新规则重跑完了，见 [regression.md v2](${r2})：剂量效应 0.41，排除 26 行后依然稳定。\n\n新的功效曲线：\n\n![功效曲线 v2](${f2})\n\n各站点的数字在自动捕获的 [table2.csv](${tLatest}) 里。`,
            },
          ],
        },
        {
          id: "demo-t9",
          status: "completed",
          startedAt: now - 300,
          completedAt: now - 200,
          items: [
            { type: "userMessage", id: "scpw-u9", content: [{ type: "text", text: "第二节也改一下，把敏感性分析放进去。原始数据也发一份。" }] },
            { type: "mcpToolCall", id: "scpw-p9", server: "cutex", tool: "artifact_publish", status: "completed", durationMs: 20, arguments: { path: "../raw/demo-trial-full.csv" }, result: { content: [{ type: "text", text: JSON.stringify(refused) }], structuredContent: refused, isError: true } },
            { type: "agentMessage", id: "scpw-a9", text: `第二节改完了，等你看。原始数据在工作区外面，发不了；报告还是 [regression.md v2](${r2})，你确认后我再发新版本。` },
          ],
        },
        {
          id: "demo-t10",
          status: "completed",
          startedAt: now - 190,
          completedAt: now - 170,
          items: [
            { type: "userMessage", id: "scpw-u10", content: [{ type: "text", text: "各站点的剂量效应画个图给我看看，能切换柱状和折线。" }] },
            publishCall("scpw-p10", "figures/dose-response.html", DOODLE, 1, "interactive sketch"),
            { type: "agentMessage", id: "scpw-a10", text: `画好了：[dose-response.html v1](${artifactLink(artifactRef(DOODLE, 1))})，可以点「Resample」和切换柱状 / 折线。` },
          ],
        },
      ],
    },
  };
}

// ── the mock ─────────────────────────────────────────────────────────────────────────────────────

const store = seed();
const refusal = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

// workstation (an SSH mock host) has its own store: the kks project's results (a report, an HTML page).
const REMOTE_SCOPE: ArtifactScope = { kind: "project", id: "kks" };
const REMOTE_SESSIONS = new Set(["kks-lead", "kks-eval", "kks-data"]);
const REMOTE_REPORT = "af-1e2d3c4b5a69788796a5b4c3d2e1f0a1";
const REMOTE_PAGE = "af-2f3e4d5c6b7a8998a7b6c5d4e3f2a1b2";
const remoteStores = new Map<string, Map<string, Stored>>();

function seedRemote(): Map<string, Stored> {
  const evaluator = (turn: string) => agent("kks-eval", "Evaluator", turn);
  const evalReport = (n: number) => `# Dev-split evaluation\n\nCheckpoint: \`ckpt-${n === 1 ? "0410" : "0415"}\`\n\n| metric | value |\n|---|---|\n| accuracy | ${n === 1 ? "0.812" : "0.837"} |\n| macro F1 | ${n === 1 ? "0.774" : "0.801"} |\n`;
  const make = (artifactId: string, name: string, kind: ArtifactKind, versions: (ArtifactVersion & { text: string })[]): [string, Stored] => [
    artifactId,
    { summary: { artifactId, scope: REMOTE_SCOPE, name, kind, revision: versions.length, starred: false, archivedAt: null, createdAt: versions[0]!.createdAt, updatedAt: versions[versions.length - 1]!.createdAt }, versions },
  ];
  return new Map([
    make(REMOTE_REPORT, "reports/eval-dev.md", "report", [
      version(REMOTE_REPORT, 1, evalReport(1), "text/markdown", "reports/eval-dev.md", evaluator("turn-eval-1"), ago(240)),
      version(REMOTE_REPORT, 2, evalReport(2), "text/markdown", "reports/eval-dev.md", evaluator("turn-eval"), ago(20), { note: "new checkpoint" }),
    ]),
    make(REMOTE_PAGE, "figures/loss.html", "figure", [version(REMOTE_PAGE, 1, doodle(2), "text/html", "figures/loss.html", agent("kks-lead", "KKS-Director", "turn-lead-3"), ago(15))]),
  ]);
}

function remoteStoreOf(hostId: string): Map<string, Stored> {
  let s = remoteStores.get(hostId);
  if (!s) remoteStores.set(hostId, (s = seedRemote()));
  return s;
}

export const mock: ModuleMock = {
  // `artifact-show`: the mock host opens only what an agent asked to show (scripted publish below).
  features: { new: [ARTIFACTS_FEATURE, ARTIFACT_SHOW_FEATURE] },
  thread: (sessionId) => (sessionId === "demo-done" ? writerThread() : null),
  api: (core) => storeApi(store, SCOPE, SCP_SESSIONS, core.emitHost),
  remote: (hostId, emitHost) => storeApi(remoteStoreOf(hostId), REMOTE_SCOPE, REMOTE_SESSIONS, emitHost),
  start: (core) => startScripted(core),
};

/** The artifact-store routes over one host's store (`home`: the scope its project's sessions publish to). */
function storeApi(store: Map<string, Stored>, home: ArtifactScope, homeSessions: ReadonlySet<string>, emitHost: MockCore["emitHost"]): Partial<DesktopApi> {
  const emitPublished = (s: Stored, newVersion: boolean) => {
    const v = s.versions[s.versions.length - 1]!;
    emitHost(ARTIFACT_PUBLISHED_EVENT, { artifactId: s.summary.artifactId, version: v.version, scope: s.summary.scope, name: s.summary.name, kind: s.summary.kind, producer: v.producer, newVersion });
  };
  const emitUpdated = (s: Stored, change: string) => emitHost(ARTIFACT_UPDATED_EVENT, { artifactId: s.summary.artifactId, scope: s.summary.scope, change, revision: s.summary.revision });
  const scopeOf = (q: { project?: string; session?: string; forSession?: string }): ArtifactScope | null => {
    if (q.project) return { kind: "project", id: q.project };
    if (q.session) return { kind: "session", id: q.session };
    if (q.forSession) return homeSessions.has(q.forSession) ? home : { kind: "session", id: q.forSession };
    return null;
  };
  const pick = (s: Stored, sel: number | "latest") => s.versions[(sel === "latest" ? s.versions.length : sel) - 1];
  return {
    async artifactStoreList(query) {
      const scope = scopeOf(query);
      if (!scope) throw new Error("invalid_request: one of project / session / forSession");
      const q = query.q?.toLowerCase();
      const archived = query.archived ?? "false";
      const all = [...store.values()]
        .filter((s) => s.summary.scope.kind === scope.kind && s.summary.scope.id === scope.id)
        .filter((s) => (archived === "all" ? true : archived === "true" ? !!s.summary.archivedAt : !s.summary.archivedAt))
        .filter((s) => !q || s.summary.name.toLowerCase().includes(q))
        .filter((s) => !query.kind || s.summary.kind === query.kind)
        .filter((s) => !query.producer || s.versions.some((v) => v.producer.sessionId === query.producer))
        .map(summaryOf)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const start = Number(query.cursor ?? 0) || 0;
      const limit = query.limit ?? 50;
      const page = all.slice(start, start + limit);
      return { scope, items: structuredClone(page), nextCursor: start + limit < all.length ? String(start + limit) : null };
    },
    async artifactStoreGet(id): Promise<ArtifactDetail | null> {
      const s = store.get(id);
      return s ? structuredClone({ artifact: summaryOf(s), versions: s.versions.map(strip).reverse() }) : null;
    },
    async artifactStoreContent(id, sel, opts): Promise<ArtifactContent | null> {
      const s = store.get(id);
      const v = s ? pick(s, sel) : undefined;
      if (!v) return null;
      const offset = opts?.offset ?? 0;
      const max = opts?.maxBytes ?? 262_144;
      if (v.b64) {
        const bin = atob(v.text);
        const part = bin.slice(offset, offset + max);
        return { version: v.version, encoding: "base64", content: btoa(part), offset, totalBytes: bin.length, truncated: offset + part.length < bin.length, mediaType: v.mediaType, sha256: v.sha256, externalChanged: null };
      }
      const content = v.text.slice(offset, offset + max);
      return { version: v.version, encoding: "utf8", content, offset, totalBytes: v.bytes, truncated: offset + content.length < v.text.length, mediaType: v.mediaType, sha256: v.sha256, externalChanged: v.storage === "external" ? false : null };
    },
    async artifactStoreDiff(id, from, to) {
      const s = store.get(id);
      const a = s ? pick(s, from) : undefined;
      const b = s ? pick(s, to) : undefined;
      if (!a || !b) return null;
      if (a.mediaType.startsWith("image/") && a.mediaType !== "image/svg+xml") return { from, to, binary: true, diff: null, truncated: false };
      return { from, to, binary: false, diff: unifiedDiff(a.text, b.text, from, to), truncated: false };
    },
    async artifactStoreResolve(refs) {
      return refs.map((ref): ArtifactResolveItem => {
        const parts = parseArtifactRef(ref);
        const s = parts ? store.get(parts.artifactId) : undefined;
        const v = s && parts ? pick(s, parts.version) : undefined;
        if (!s || !v) return { ref, ok: false, error: "artifact_not_found" };
        return { ref, ok: true, artifactId: s.summary.artifactId, name: s.summary.name, kind: s.summary.kind, version: v.version, latestVersion: s.versions.length, mediaType: v.mediaType, archived: !!s.summary.archivedAt };
      });
    },
    async artifactStoreUsage() {
      const versions = [...store.values()].flatMap((s) => s.versions);
      return { bytes: versions.reduce((n, v) => n + v.bytes, 0), blobs: versions.length, artifacts: store.size, versions: versions.length, quotaBytes: 10 * 1024 ** 3, maxBlobBytes: 64 * 1024 ** 2, hashExternalMaxBytes: 1024 ** 3 };
    },
    async artifactStorePublish(req) {
      const path = req.path.replace(/\\/g, "/").replace(/^\.\//, "");
      if (path.split("/").includes("..") || /^[a-z]:\//i.test(path) || path.startsWith("/")) return refusal("artifact_path_forbidden", "path is outside the workspace root");
      const name = req.name?.trim() || path;
      const existing = [...store.values()].find((s) => s.summary.name === name);
      const at = new Date().toISOString();
      const text = `# ${name.split("/").pop()}\n\nPublished by the owner from the workspace (${at.slice(0, 16)}).${req.note ? `\n\n> ${req.note}` : ""}\n`;
      const mediaType = /\.md$/i.test(path) ? "text/markdown" : /\.csv$/i.test(path) ? "text/csv" : "text/plain";
      let s = existing;
      if (!s) {
        const id = `af-${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
        s = { summary: { artifactId: id, scope: home, name, kind: req.kind ?? (/\.csv$/i.test(path) ? "table" : "report"), revision: 0, starred: false, archivedAt: null, createdAt: at, updatedAt: at }, versions: [] };
        store.set(id, s);
      }
      s.versions.push(version(s.summary.artifactId, s.versions.length + 1, text, mediaType, path, OWNER, at, { note: req.note ?? null }));
      s.summary = { ...s.summary, updatedAt: at, revision: s.summary.revision + 1, ...(req.kind ? { kind: req.kind } : {}) };
      emitPublished(s, true);
      const v = s.versions[s.versions.length - 1]!;
      return { ok: true as const, published: structuredClone({ artifact: summaryOf(s), version: strip(v), newVersion: true, markdown: `[${label(name)} v${v.version}](${v.link})` }) };
    },
    async artifactStorePatch(id, patch) {
      const s = store.get(id);
      if (!s) return refusal("artifact_not_found", "unknown artifact");
      if (patch.expectedRevision !== s.summary.revision) return { ...refusal("artifact_revision_conflict", "revision changed"), revision: s.summary.revision };
      const change = patch.name !== undefined ? "renamed" : patch.kind !== undefined ? "kind" : patch.starred !== undefined ? "starred" : patch.archived ? "archived" : "unarchived";
      s.summary = {
        ...s.summary,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
        ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date().toISOString() : null } : {}),
        revision: s.summary.revision + 1,
      };
      emitUpdated(s, change);
      return { ok: true as const, artifact: structuredClone(summaryOf(s)) };
    },
    async artifactStoreDelete(id) {
      const s = store.get(id);
      if (!s) return refusal("artifact_not_found", "unknown artifact");
      store.delete(id);
      s.summary = { ...s.summary, revision: s.summary.revision + 1 };
      emitUpdated(s, "deleted");
      return { ok: true as const, artifactId: id };
    },
  };
}

function startScripted(core: MockCore): void {
  if (core.legacy) return;
  // demo-writer republishes the page with show ~12 s after start (?publishAt=<s> to change): with
  // demo-writer in view it opens on the right (auto-open, live.ts); its 「最新」 tab then follows later versions in place.
  const at = Number(new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("publishAt")) || 12;
  setTimeout(() => {
    const s = store.get(DOODLE);
    if (!s) return;
    const n = s.versions.length + 1;
    s.versions.push(version(DOODLE, n, doodle(n), "text/html", "figures/dose-response.html", agent("demo-done", "demo-writer", "demo-t11"), new Date().toISOString(), { note: "bars by default" }));
    s.summary = { ...s.summary, updatedAt: new Date().toISOString(), revision: s.summary.revision + 1 };
    const v = s.versions[n - 1]!;
    core.emitHost(ARTIFACT_PUBLISHED_EVENT, { artifactId: DOODLE, version: n, scope: SCOPE, name: s.summary.name, kind: s.summary.kind, producer: v.producer, newVersion: true });
    // `artifact_publish {show: true}`: cutex follows the publish with the show request (the mock host
    // lists `artifact-show`; under ?legacy there are no artifacts at all).
    core.emitHost(ARTIFACT_SHOW_REQUESTED_EVENT, { artifactId: DOODLE, version: n, ref: v.ref, scope: SCOPE, name: s.summary.name, kind: s.summary.kind, mediaType: v.mediaType,
      cutexSessionId: v.producer.sessionId, displayName: v.producer.displayName, hostId: "mock-host", newVersion: true, requestedAt: new Date().toISOString() });
  }, at * 1000);
  // demo-writer publishes section 2 a little after start (no show request: nothing opens on its own):
  // chips citing v2 / v3 say 有更新 v4, open 「最新」 tabs and the library refresh.
  setTimeout(() => {
    const s = store.get(REPORT);
    if (!s || s.versions.length >= 4) return;
    s.versions.push(version(REPORT, 4, report(4), "text/markdown", "reports/regression.md", agent("demo-done", "demo-writer", "demo-t9"), new Date().toISOString(), { note: "section 2: sensitivity" }));
    s.summary = { ...s.summary, updatedAt: new Date().toISOString(), revision: s.summary.revision + 1 };
    const v = s.versions[3]!;
    core.emitHost(ARTIFACT_PUBLISHED_EVENT, { artifactId: REPORT, version: 4, scope: SCOPE, name: s.summary.name, kind: s.summary.kind, producer: v.producer, newVersion: true });
  }, 20_000);
}
