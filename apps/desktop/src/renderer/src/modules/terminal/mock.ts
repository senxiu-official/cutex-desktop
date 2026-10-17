// Browser-preview cutex PTYs (dev/mockTypes.ts): a line-echoing fake shell per terminal, with the
// daemon's attach semantics (attach replays the scrollback with reset; output streams after it).
// ifm-director's history (agent `ifm-dir`) has a reply with shell code blocks for ▶ 运行 (§22): on the Windows mock
// host the one-line and multi-line PowerShell blocks get the button (the multi-line one asks twice),
// the bash block none.
import type { TerminalSummary } from "../../../../shared/ipc";
import type { ModuleMock } from "../../dev/mockTypes";

const PROMPT = "PS D:\\Apps\\cutex-desktop> ";

interface MockTerm {
  summary: TerminalSummary;
  line: string;
  scrollback: string;
}

/** `colors` / `palette`: the 16 ANSI colours as text, bold, and as fills (the palette check in the preview). */
function colorDemo(): string {
  const names = ["blk", "red", "grn", "yel", "blu", "mag", "cyn", "wht"];
  const row = (base: number, label: string) =>
    `${label.padEnd(7)}${names.map((n, i) => `\x1b[${base + i}m${n.padEnd(5)}\x1b[0m`).join("")}\r\n`;
  const fills = (base: number) => `${"fill".padEnd(7)}${names.map((_, i) => `\x1b[${base + i}m${String(base + i).padStart(4)} \x1b[0m`).join("")}\r\n`;
  return [
    row(30, "normal"),
    row(90, "bright"),
    `${"bold".padEnd(7)}${names.map((n, i) => `\x1b[1;${30 + i}m${n.padEnd(5)}\x1b[0m`).join("")}\r\n`,
    fills(40),
    fills(100),
    "\x1b[2mdim text\x1b[0m  \x1b[3mitalic\x1b[0m  \x1b[4munderline\x1b[0m  \x1b[7minverse\x1b[0m\r\n",
    "\x1b[32m✓ 128 passed\x1b[0m  \x1b[33m⚠ 3 warnings\x1b[0m  \x1b[31m✗ 1 failed\x1b[0m  \x1b[90m(4.21 s)\x1b[0m\r\n",
    "\x1b[1;34mdiff --git\x1b[0m a/src/x.ts b/src/x.ts\r\n\x1b[36m@@ -1,3 +1,3 @@\x1b[0m\r\n\x1b[31m-const a = 1;\x1b[0m\r\n\x1b[32m+const a = 2;\x1b[0m\r\n",
  ].join("");
}

const encode = (text: string) => btoa(unescape(encodeURIComponent(text)));

const REPLY = [
  "图表的任务已经交给 figures。想自己看一眼的话，先看工作区状态：",
  "",
  "```powershell",
  "git status --short",
  "```",
  "",
  "再重画三张图并列出结果（多行，点两次才运行）：",
  "",
  "```pwsh",
  "python plots/redraw.py --all",
  "Get-ChildItem figures -Filter *.pdf",
  "```",
  "",
  "Linux 主机上用这个（这台是 Windows，所以没有运行按钮）：",
  "",
  "```bash",
  "python plots/redraw.py --all && ls figures/*.pdf",
  "```",
].join("\n");

function ifmThread() {
  const now = Math.floor(Date.now() / 1000);
  return {
    thread: {
      id: "thread-ifm-dir",
      turns: [
        {
          id: "ifm-dir-t1",
          status: "completed",
          startedAt: now - 3600,
          completedAt: now - 3540,
          items: [
            { type: "userMessage", id: "ifm-dir-u1", content: [{ type: "text", text: "图表那边怎么样了？告诉我怎么自己检查。" }] },
            { type: "agentMessage", id: "ifm-dir-a1", text: REPLY },
          ],
        },
      ],
    },
  };
}

export const mock: ModuleMock = {
  features: { base: ["terminal"] },
  thread: (sessionId) => (sessionId === "ifm-dir" ? ifmThread() : null),
  api: (core) => {
    const terms = new Map<string, MockTerm>();
    let seq = 0;
    const out = (id: string, text: string) => {
      const t = terms.get(id);
      if (!t) return;
      t.scrollback = (t.scrollback + text).slice(-20000);
      core.emit("terminalOutput", { terminalId: id, data: encode(text), replay: false, reset: false });
    };
    return {
      async terminalList(scope) {
        return [...terms.values()].filter((t) => t.summary.scope === scope.kind && t.summary.rootId === scope.id).map((t) => t.summary);
      },
      async terminalCreate(scope, cols, rows) {
        seq += 1;
        // Unique across preview reloads, like the daemon's ids (a restored tab never meets a new PTY of its id).
        const id = `term-${Date.now().toString(36)}-${seq}`;
        const summary: TerminalSummary = { terminalId: id, scope: scope.kind, rootId: scope.id, cwd: "D:/Apps/cutex-desktop", shell: "pwsh.exe", pid: 4240 + seq, cols, rows, createdAt: new Date().toISOString(), exited: false, exitCode: null };
        terms.set(id, { summary, line: "", scrollback: `PowerShell 7.5 (mock) — type \x1b[1mcolors\x1b[0m for the ANSI palette\r\n${PROMPT}` });
        return summary;
      },
      async terminalAttach(id) {
        const t = terms.get(id);
        if (!t) throw new Error(`terminal ${id} not found`);
        setTimeout(() => core.emit("terminalOutput", { terminalId: id, data: encode(t.scrollback), replay: true, reset: true }), 30);
      },
      async terminalDetach() {},
      async terminalInput(id, data) {
        const t = terms.get(id);
        if (!t) return;
        for (const ch of data) {
          if (ch === "\r") {
            const cmd = t.line.trim();
            t.line = "";
            if (cmd === "exit") {
              out(id, "\r\n");
              t.summary = { ...t.summary, exited: true, exitCode: 0 };
              core.emit("terminalExit", { terminalId: id, exitCode: 0 });
              return;
            }
            const reply = cmd === "colors" || cmd === "palette" ? colorDemo() : cmd ? `mock: ${cmd}\r\n` : "";
            out(id, `\r\n${reply}${PROMPT}`);
          } else if (ch === "\x7f") {
            if (t.line) {
              t.line = t.line.slice(0, -1);
              out(id, "\b \b");
            }
          } else {
            t.line += ch;
            out(id, ch);
          }
        }
      },
      async terminalResize() {},
      async terminalKill(id) {
        terms.delete(id);
      },
    };
  },
};
