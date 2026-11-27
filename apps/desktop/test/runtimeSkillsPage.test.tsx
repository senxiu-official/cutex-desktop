// @vitest-environment jsdom
// 运行时配置 → 技能: one list per runtime. Codex keeps its own rows with 「复制到…」 matched by SKILL.md path; Claude from the
// host list; DSH / Kimi read-only behind their flags; a host without runtime-skills keeps the Codex page and says why.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { RuntimeSkill, SkillRuntime } from "../src/shared/runtimeSkills";

const fx = vi.hoisted(() => ({ features: new Set<string>(), lists: {} as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (v: string) => v }));
vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({ t: (key: string, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (zhCN as Record<string, string>)[key] ?? key) }),
}));
vi.mock("../src/renderer/src/lib/targetHost", () => ({
  useTargetApi: () => ({ runtimeSkills: async (r: SkillRuntime) => fx.lists[r] }),
  useTargetFeatures: () => fx.features,
  useTargetHostId: () => "local",
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: (sel: (s: unknown) => unknown) => sel({ hosts: { hosts: [{ id: "local", label: "SAMPLEHOSTA" }] }, openSettings: () => {} }) }));
vi.mock("../src/renderer/src/components/settings/FollowShared", () => ({ FollowSharedSection: () => null, FollowSharedLink: () => null }));
// The Codex page itself is covered elsewhere; here it only has to call copyTo for each of its rows.
const native = [
  { name: "pdf", path: "C:\\h\\skills\\pdf\\SKILL.md" },
  { name: "github:review-pr", path: "C:\\h\\skills\\github-review-pr\\SKILL.md" },
  { name: "draft", path: "C:\\h\\skills\\draft\\SKILL.md" },
];
vi.mock("../src/renderer/src/components/settings/CapabilitiesSettings", () => ({
  SkillsPage: ({ copyTo }: { copyTo?: (s: unknown) => React.ReactNode }) =>
    h("div", { "data-codex-page": "" }, native.map((s) => h("div", { key: s.name, "data-native": s.name }, copyTo?.(s)))),
}));
const { RuntimeSkillsPage } = await import("../src/renderer/src/components/settings/RuntimeConfigSettings");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const skill = (runtime: SkillRuntime, name: string, origin: RuntimeSkill["origin"], extra: Partial<RuntimeSkill> = {}): RuntimeSkill => ({
  id: `${runtime}:${name}`, name, description: name, path: `C:/h/skills/${name.replace(":", "-")}/SKILL.md`, origin, source: "x", state: "enabled", copyable: origin === "personal", compatibility: { status: "portable", fields: [] }, ...extra,
});
const ok = (runtime: SkillRuntime, skills: RuntimeSkill[]) => ({ ok: true, list: { runtime, skills, coverage: "complete", limits: [], truncated: false } });

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const $ = (sel: string) => host.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const pick = async (label: string) => {
  const btn = [...host.querySelectorAll<HTMLElement>("[data-runtime-skills-filter] button, [data-runtime-skills-filter] [role=radio]")].find((b) => b.textContent === label)!;
  await act(async () => btn.click());
  await settle();
};
beforeEach(() => {
  fx.features = new Set(["runtime-skills", "runtime-skill-copy", "runtime-skills-dsh"]);
  fx.lists = {
    codex: ok("codex", [skill("codex", "pdf", "personal"), skill("codex", "github:review-pr", "plugin", { source: "github@openai-curated" })]),
    claude: ok("claude", [skill("claude", "paper-review", "personal"), skill("claude", "frontend-design", "plugin", { source: "frontend-design@claude-plugins-official" })]),
    dsh: ok("dsh", [skill("dsh", "repo-map", "personal", { copyable: false })]),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("Codex: one list, its own rows, 复制到 matched by path (back- or forward slashes), disabled with why otherwise", async () => {
  await act(async () => root.render(h(RuntimeSkillsPage)));
  await settle();
  expect($("[data-codex-page]")).not.toBeNull();
  expect($("[data-runtime-skills]")).toBeNull();
  expect($("[data-native=pdf] [data-runtime-skill-copy]")!.dataset.runtimeSkillCopy).toBe("ok");
  expect($("[data-native='github:review-pr'] [data-runtime-skill-copy]")!.dataset.runtimeSkillCopy).toBe("notPersonal");
  expect($("[data-native=draft] [data-runtime-skill-copy]")!.dataset.runtimeSkillCopy).toBe("notListed");
  expect($("[data-native=draft] [data-runtime-skill-copy]")!.title).toContain("刷新后再试");
});

it("Claude rows from the host list: plugin short name with the raw id as tooltip; 复制到 only on personal skills", async () => {
  await act(async () => root.render(h(RuntimeSkillsPage)));
  await pick("Claude");
  expect($("[data-codex-page]")).toBeNull();
  expect($("[data-runtime-skill=paper-review] [data-runtime-skill-copy]")!.dataset.runtimeSkillCopy).toBe("ok");
  const plugin = $("[data-runtime-skill=frontend-design]")!;
  expect(plugin.querySelector<HTMLElement>("[data-runtime-skill-copy]")!.dataset.runtimeSkillCopy).toBe("notPersonal");
  const src = plugin.querySelector<HTMLElement>("[data-runtime-skill-source]")!;
  expect([src.textContent, src.title]).toEqual(["frontend-design", "frontend-design@claude-plugins-official"]);
});

it("DSH is read-only (no 复制到); Kimi without its flag says why; no runtime-skills keeps the Codex page", async () => {
  await act(async () => root.render(h(RuntimeSkillsPage)));
  await pick("DSH");
  expect($("[data-runtime-skill=repo-map]")).not.toBeNull();
  expect($("[data-runtime-skill-copy]")).toBeNull();
  await pick("Kimi");
  expect($("[data-runtime-skills-blocked=kimi]")!.textContent).toContain("Kimi");

  act(() => root.unmount()); root = createRoot(host);
  fx.features = new Set();
  await act(async () => root.render(h(RuntimeSkillsPage)));
  await settle();
  expect($("[data-runtime-skills-filter]")).toBeNull();
  expect($("[data-codex-page]")).not.toBeNull();
  expect($("[data-runtime-skill-copy]")).toBeNull();
});
