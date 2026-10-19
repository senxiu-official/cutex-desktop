// @vitest-environment jsdom
// Profile import from CC Switch (components/ProfileImport, cutex profile-import-cc-switch): nothing
// without the capability; the default selection (importable, not imported before); rows without a
// key or unsupported are disabled with the reason; 导入 sends exactly the picked providers to the
// host it was given, and the result names what was created and what failed.
import { createElement as h } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcSwitchImportItem, CcSwitchImportList } from "../src/shared/ccSwitchImport";

const fx = vi.hoisted(() => ({
  features: new Set<string>(["profile-import-cc-switch"]),
  calls: [] as { host: string; items: CcSwitchImportItem[] }[],
  lists: 0,
  done: [] as number[],
}));

const LIST: CcSwitchImportList = {
  found: true,
  source: { path: "/home/u/.cc-switch/cc-switch.db", format: "sqlite", schemaVersion: 5 },
  error: null,
  providers: [
    { id: "c-official", app: "claude", name: "Claude Official", baseUrl: null, model: null, current: false, hasKey: false, supported: false, reason: "OAuth login", existingProfile: null },
    { id: "c-glm", app: "claude", name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-5.3", current: true, hasKey: true, supported: true, reason: null, existingProfile: null },
    { id: "c-kimi", app: "claude", name: "Kimi", baseUrl: "https://api.moonshot.cn/anthropic", model: null, current: false, hasKey: false, supported: true, reason: null, existingProfile: null },
    { id: "x-deepseek", app: "codex", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", current: false, hasKey: true, supported: true, reason: null, existingProfile: "omega" },
    { id: "x-relay", app: "codex", name: "Relay", baseUrl: "https://relay.example/v1", model: "gpt-5.5", current: true, hasKey: true, supported: true, reason: null, existingProfile: null },
  ],
};

function daemon(host: string) {
  return {
    async ccSwitchImportList() {
      fx.lists++;
      return structuredClone(LIST);
    },
    async ccSwitchImport(items: CcSwitchImportItem[]) {
      fx.calls.push({ host, items });
      return {
        created: [{ id: "c-glm", app: "claude", profile: { name: "Zhipu GLM" } }],
        failed: [{ id: "x-relay", app: "codex", code: "invalid_request", message: "bad base URL" }],
      };
    },
  };
}

vi.mock("../src/renderer/src/bridge", () => ({ api: daemon("local"), apiFor: (host: string) => daemon(host), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ loadProfileList: async () => null }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = () => ({ notify: () => {}, hosts: { active: "local" }, daemon: { kind: "connected" }, features: fx.features, featuresKnown: true, sidebar: null, approvals: null, services: null, byHost: { hachimi: { daemon: { kind: "connected" }, features: fx.features, featuresKnown: true, sidebar: null, approvals: null, services: null } } });
  return {
    ...(await importOriginal<object>()),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state()), { getState: state, setState: () => {}, subscribe: () => () => {} }),
  };
});

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { ProfileImport, resetCcSwitchListCache, useCcSwitchAvailable } = await import("../src/renderer/src/components/ProfileImport");

async function render(el: ReturnType<typeof h>) {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  await act(async () => root.render(el));
  // The list read resolves.
  await act(async () => {});
  return { div, unmount: () => act(() => root.unmount()) };
}

const box = (div: HTMLElement, app: string, id: string) => div.querySelector<HTMLInputElement>(`[data-cc-switch-row="${app}:${id}"] input[type=checkbox]`)!;

beforeEach(() => {
  resetCcSwitchListCache();
  fx.features = new Set(["profile-import-cc-switch"]);
  fx.calls = [];
  fx.lists = 0;
  fx.done = [];
});

describe("ProfileImport (CC Switch)", () => {
  it("renders nothing without the capability (and never reads the list)", async () => {
    fx.features = new Set();
    const { div, unmount } = await render(h(ProfileImport, { hostId: "local" }));
    expect(div.innerHTML).toBe("");
    expect(fx.lists).toBe(0);
    unmount();
  });

  it("groups by app, picks importable rows not imported before, disables keyless / unsupported rows", async () => {
    const { div, unmount } = await render(h(ProfileImport, { hostId: "local" }));
    expect([...div.querySelectorAll("[data-cc-switch-app]")].map((e) => e.getAttribute("data-cc-switch-app"))).toEqual(["claude", "codex"]);
    expect(box(div, "claude", "c-glm").checked).toBe(true);
    expect(box(div, "codex", "x-relay").checked).toBe(true);
    // Imported before: offered, not picked.
    expect(box(div, "codex", "x-deepseek").checked).toBe(false);
    expect(box(div, "codex", "x-deepseek").disabled).toBe(false);
    expect(div.textContent).toContain('profile-import.existing {"name":"omega"}');
    // Unsupported (cutex's reason) and keyless rows cannot be picked.
    expect(box(div, "claude", "c-official").disabled).toBe(true);
    expect(div.querySelector('[data-cc-switch-row="claude:c-official"]')!.textContent).toContain("OAuth login");
    expect(box(div, "claude", "c-kimi").disabled).toBe(true);
    expect(div.querySelector('[data-cc-switch-row="claude:c-kimi"]')!.textContent).toContain("profile-import.noKey");
    expect(div.textContent).toContain("profile-import.current");
    expect(div.textContent).toContain('profile-import.import {"n":2}');
    unmount();
  });

  it("imports the picked providers on the given host and reports created / failed", async () => {
    const { div, unmount } = await render(h(ProfileImport, { hostId: "hachimi", onDone: (n: number) => fx.done.push(n) }));
    // Also pick the one imported before.
    await act(async () => box(div, "codex", "x-deepseek").click());
    const button = [...div.querySelectorAll("button")].find((b) => b.textContent?.startsWith("profile-import.import"))!;
    expect(button.textContent).toBe('profile-import.import {"n":3}');
    await act(async () => button.click());
    await act(async () => {});
    expect(fx.calls).toEqual([
      {
        host: "hachimi",
        items: [
          { id: "c-glm", app: "claude" },
          { id: "x-deepseek", app: "codex" },
          { id: "x-relay", app: "codex" },
        ],
      },
    ]);
    expect(fx.done).toEqual([1]);
    const result = div.querySelector("[data-cc-switch-result]")!.textContent!;
    expect(result).toContain('profile-import.created {"n":1,"names":"Zhipu GLM"}');
    expect(result).toContain('profile-import.failedRow {"name":"Relay","message":"bad base URL"}');
    unmount();
  });

  it("useCcSwitchAvailable: true with the capability and an importable provider", async () => {
    let seen: boolean | null = null;
    const Probe = ({ hostId }: { hostId: string }) => ((seen = useCcSwitchAvailable(hostId)), null);
    const first = await render(h(Probe, { hostId: "local" }));
    expect(seen).toBe(true);
    first.unmount();
    fx.features = new Set();
    resetCcSwitchListCache();
    const second = await render(h(Probe, { hostId: "local" }));
    expect(seen).toBe(false);
    second.unmount();
  });
});
