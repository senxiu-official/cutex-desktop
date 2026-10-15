// Browser-preview data for the turn summary (轮尾摘要, lib/turnSummary; dev/mockTypes.ts): Mika's
// history. Turn 1 only reads (no summary), turn 2 has only a failed and a declined edit (no summary),
// turn 3 adds / updates / deletes / moves files and its final reply links an html report marked
// "open", a localhost URL, a code reference (not a chip), a Markdown file, a missing file (dropped by
// the existence check) and a web page.
import type { ModuleMock } from "../../dev/mockTypes";

const ROOT = "D:\\Apps\\cutex-desktop";
const at = (rel: string) => `${ROOT}\\${rel.replace(/\//g, "\\")}`;

const REPORT = [
  "<!doctype html>",
  "<html lang=\"zh\">",
  "<head><meta charset=\"utf-8\"><title>Kutex 字体调查</title></head>",
  "<body>",
  "<h1>Kutex 字体调查</h1>",
  "<p>结论：中文用 Noto Sans SC，代码用 JetBrains Mono。</p>",
  "</body>",
  "</html>",
  "",
].join("\n");

const NOTES = ["# 字体调查笔记", "", "- Windows 默认回退到微软雅黑", "- macOS 回退到苹方", ""].join("\n");

function mikaThread() {
  const now = Math.floor(Date.now() / 1000);
  return {
    thread: {
      id: "thread-mika",
      turns: [
        {
          id: "mika-t1",
          status: "completed",
          startedAt: now - 2400,
          completedAt: now - 2340,
          items: [
            { type: "userMessage", id: "mika-u1", content: [{ type: "text", text: "看一下现在 Markdown 里用的是什么字体。" }] },
            { type: "commandExecution", id: "mika-c1", command: "rg -n \"font-family\" apps/desktop/src/renderer/src/styles.css", status: "completed", exitCode: 0, durationMs: 300, aggregatedOutput: "12:  font-family: var(--font-sans);" },
            { type: "agentMessage", id: "mika-a1", text: "正文走 `--font-sans`，代码块走 `--font-mono`，定义在 [styles.css](apps/desktop/src/renderer/src/styles.css:12)。" },
          ],
        },
        {
          id: "mika-t2",
          status: "completed",
          startedAt: now - 1800,
          completedAt: now - 1750,
          items: [
            { type: "userMessage", id: "mika-u2", content: [{ type: "text", text: "顺手把 README 的字体说明改一下。" }] },
            { type: "fileChange", id: "mika-f2a", status: "failed", changes: [{ path: at("README.md"), kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old\n+new" }] },
            { type: "fileChange", id: "mika-f2b", status: "declined", changes: [{ path: at("README.md"), kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old\n+new" }] },
            { type: "agentMessage", id: "mika-a2", text: "补丁没有应用上（被拒绝了），README 保持原样。" },
          ],
        },
        {
          id: "mika-t3",
          status: "completed",
          startedAt: now - 900,
          completedAt: now - 780,
          items: [
            { type: "userMessage", id: "mika-u3", content: [{ type: "text", text: "把字体调查写成报告，顺便把 preview 脚本改名，旧的草稿删掉。" }] },
            { type: "fileChange", id: "mika-f3a", status: "completed", changes: [{ path: at("docs/research/kutex-fonts.html"), kind: { type: "add" }, diff: REPORT }] },
            { type: "fileChange", id: "mika-f3b", status: "completed", changes: [{ path: at("docs/research/fonts-notes.md"), kind: { type: "add" }, diff: NOTES }] },
            {
              type: "fileChange",
              id: "mika-f3c",
              status: "completed",
              changes: [
                { path: at("apps/desktop/src/renderer/src/styles.css"), kind: { type: "update", move_path: null }, diff: "@@ -10,3 +10,4 @@\n :root {\n-  --font-sans: system-ui;\n+  --font-sans: \"Noto Sans SC\", system-ui;\n+  --font-mono: \"JetBrains Mono\", monospace;\n }" },
                { path: at("docs/research/fonts-draft.md"), kind: { type: "delete" }, diff: "# 草稿\n\n待整理\n" },
              ],
            },
            { type: "fileChange", id: "mika-f3d", status: "completed", changes: [{ path: at("scripts/preview-old.ps1"), kind: { type: "update", move_path: at("scripts/preview.ps1") }, diff: "@@ -1,2 +1,2 @@\n-$port = 5199\n+$port = 5306\n pnpm vite --port $port" }] },
            // A second edit of the same file: merged into one row.
            { type: "fileChange", id: "mika-f3e", status: "completed", changes: [{ path: at("apps/desktop/src/renderer/src/styles.css"), kind: { type: "update", move_path: null }, diff: "@@ -20 +20 @@\n-  line-height: 1.5;\n+  line-height: 1.6;" }] },
            { type: "commandExecution", id: "mika-c3", command: "pnpm vite --port 5306", status: "completed", exitCode: 0, durationMs: 1200 },
            {
              type: "agentMessage",
              id: "mika-a3",
              text: [
                "报告写好了：[Kutex 字体调查](docs/research/kutex-fonts.html \"open\")，笔记在 [fonts-notes.md](docs/research/fonts-notes.md)。",
                "",
                "预览服务跑在 `http://localhost:5306/`，样式改动在 [styles.css:12](apps/desktop/src/renderer/src/styles.css:12)。",
                "背景材料：[设计说明](docs/DESIGN.md)、[旧笔记](docs/missing-notes.md)、[Noto 字体](https://fonts.google.com/noto)。",
              ].join("\n"),
            },
          ],
        },
      ],
    },
  };
}

export const mock: ModuleMock = {
  thread: (sessionId) => (sessionId === "mika" ? mikaThread() : null),
};
