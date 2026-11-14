// Approval titles in the app's language (TODO 审批标题本地化): built from kind + details, cutex's summary kept as the
// detail line; an unknown kind, or details missing what the title names, falls back to the summary.
import { describe, expect, it } from "vitest";
import type { ApprovalRecord } from "../src/shared/ipc";
import { approvalHeading, localizedApprovalTitle } from "../src/renderer/src/lib/approvalTitle";
import { zhCN } from "../src/renderer/src/modules/approvals/i18n";
import { en } from "../src/renderer/src/modules/approvals/i18n.en";
import { locales } from "../src/renderer/src/modules/approvals/i18n.locales";
import { APPROVAL_RULE_KINDS } from "../src/renderer/src/lib/approvalRuleKinds";

type Key = keyof typeof zhCN;
const translator = (catalog: Partial<Record<Key, string>>) => (key: string, vars?: Record<string, string | number>) =>
  ((catalog as Record<string, string | undefined>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, term: string) => (term === "agent" ? "Agent" : term)).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
const zh = translator(zhCN);
const english = translator(en as Partial<Record<Key, string>>);

const rec = (kind: string, details: Record<string, unknown> | null, summary = "daemon summary"): Pick<ApprovalRecord, "kind" | "summary" | "details"> => ({ kind, summary, details });

/** One record per protocol kind, details shaped as cutex writes them (upstream/cutex approvals, agent_api, gate, …). */
const SAMPLES: Record<string, { record: Pick<ApprovalRecord, "kind" | "summary" | "details">; zh: string; en: string }> = {
  managed_service: {
    record: rec("managed_service", { op: "register", slug: "web", command: ["npm", "run", "dev"], cwd: String.raw`C:\Users\me\app` }, "register managed service web (runs unrestricted as the owner): npm run dev"),
    zh: "注册托管服务 web（以你的身份运行）",
    en: "Register managed service web (runs as you)",
  },
  service_lifetime: {
    record: rec("service_lifetime", { op: "update", slug: "notes", lifetime: "persistent", managedExecution: true, staticRoot: String.raw`\\remote\data\notes` }),
    zh: String.raw`让服务 notes 常驻、以你的身份运行它的命令，同时发布 \\remote\data\notes`,
    en: String.raw`Keep service notes running, run its command as you and serve \\remote\data\notes`,
  },
  static_root: {
    record: rec("static_root", { op: "register", slug: "tokyo", staticRoot: String.raw`C:\Users\sam\My Documents\tokyo` }),
    zh: String.raw`服务 tokyo 发布工作区外的目录 C:\Users\sam\My Documents\tokyo`,
    en: String.raw`Service tokyo serves C:\Users\sam\My Documents\tokyo, outside the workspace`,
  },
  agent_profile: {
    record: rec("agent_profile", { operation: "create", name: "reviewer", profile: "gamma", sandboxMode: "workspace-write" }),
    zh: "用 Profile gamma 新建Agent reviewer",
    en: "Create Agent reviewer with Profile gamma",
  },
  ask_delivery: {
    record: rec("ask_delivery", { askId: "ask-1", target: "cutex.alden", targetName: "Alden", title: "构建 the next release" }, "委托 Lead → Alden: 构建 the next release"),
    zh: "委托给 Alden：构建 the next release",
    en: "Delegate to Alden: 构建 the next release",
  },
  browser_claim: {
    record: rec("browser_claim", { reason: "log in", urlHint: "https://x.test/" }, "Select an owner browser tab (shares its login state)"),
    zh: "选择你的一个浏览器标签页（共享它的登录状态）",
    en: "Choose one of your browser tabs (shares its login)",
  },
  browser_open: {
    record: rec("browser_open", { url: "https://user:pw@docs.example.test/notes?token=secret#x", title: "" }, "Open a browser tab in the agent login pool"),
    zh: "在Agent浏览器打开 docs.example.test",
    en: "Open docs.example.test in the Agent browser",
  },
  workflow_run: {
    record: rec("workflow_run", { name: "audit-i18n", description: "check catalogs" }, "Run workflow audit-i18n: check catalogs"),
    zh: "运行工作流 audit-i18n",
    en: "Run workflow audit-i18n",
  },
};

describe("approval titles", () => {
  it("cover every approval kind of the protocol", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...APPROVAL_RULE_KINDS].sort());
  });

  it.each(Object.entries(SAMPLES))("%s in zh-CN and en", (_, { record, zh: zhTitle, en: enTitle }) => {
    expect(localizedApprovalTitle(record, zh)).toBe(zhTitle);
    expect(localizedApprovalTitle(record, english)).toBe(enTitle);
  });

  it("every title key has en and zh-Hant text", () => {
    const keys = (Object.keys(zhCN) as Key[]).filter((k) => k.startsWith("approvals.title."));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect(locales["zh-Hant-CN"]![key], key).toBeTruthy();
    }
  });

  it("names the variant of each kind", () => {
    expect(localizedApprovalTitle(rec("managed_service", { op: "update", slug: "web" }), english)).toBe("Change managed service web (runs as you)");
    expect(localizedApprovalTitle(rec("managed_service", { op: "restart", slug: "web" }), english)).toBe("Run managed service web as you");
    expect(localizedApprovalTitle(rec("service_lifetime", { slug: "s", managedExecution: false }), zh)).toBe("让服务 s 常驻");
    expect(localizedApprovalTitle(rec("service_lifetime", { slug: "s", managedExecution: true }), zh)).toBe("让服务 s 常驻，并以你的身份运行它的命令");
    expect(localizedApprovalTitle(rec("service_lifetime", { slug: "s", staticRoot: "D:/site" }), zh)).toBe("让服务 s 常驻，同时发布 D:/site");
    expect(localizedApprovalTitle(rec("agent_profile", { operation: "replace", name: "a", profile: "p" }), zh)).toBe("用 Profile p 替换Agent a");
    expect(localizedApprovalTitle(rec("ask_delivery", { target: "cutex.x" }), english)).toBe("Delegate to cutex.x");
    expect(localizedApprovalTitle(rec("browser_open", { title: "Release notes", url: "https://x.test/" }), english)).toBe("Open Release notes in the Agent browser");
    expect(localizedApprovalTitle(rec("browser_open", {}), zh)).toBe("在Agent浏览器打开一个网页");
  });

  it("falls back to the daemon summary for unknown kinds and missing details", () => {
    for (const record of [rec("future_kind", { slug: "x" }), rec("managed_service", null), rec("static_root", { slug: "x" }), rec("agent_profile", { name: "a" }), rec("workflow_run", {}), rec("ask_delivery", { title: "t" })]) {
      expect(localizedApprovalTitle(record, zh)).toBeNull();
      expect(approvalHeading(record, zh)).toEqual({ title: "daemon summary", detail: null });
    }
  });

  it("keeps the summary as the detail line, once", () => {
    expect(approvalHeading(SAMPLES.managed_service!.record, zh)).toEqual({ title: SAMPLES.managed_service!.zh, detail: "register managed service web (runs unrestricted as the owner): npm run dev" });
    expect(approvalHeading(rec("workflow_run", { name: "w" }, "Run workflow w"), english)).toEqual({ title: "Run workflow w", detail: null });
  });

  it("puts details on one line, cut", () => {
    const title = localizedApprovalTitle(rec("ask_delivery", { targetName: "A", title: `line one\nline two ${"x".repeat(300)}` }), english)!;
    expect(title.startsWith("Delegate to A: line one line two x")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("\n");
  });
});
