// @vitest-environment jsdom
// 提示词增强 (cutex text-rewrite-v1; shared/textRewrite.ts, main/textRewrite.ts, lib/promptEnhance.ts,
// lib/usePromptEnhance.ts, components/PromptEnhancePanel.tsx, settings/PromptEnhanceSettings.tsx):
// - main: body rebuilt from known fields, POST never retried, cancel aborts the transport (cutex sees the close),
//   per-Profile failure reasons and other errors mapped, no text in errors;
// - the rebindable shortcut (Ctrl+Shift+E, no clash), IME never triggers it; selection vs whole draft;
// - Esc cancels the request in flight (cancelTextRewrite with its id; a late answer is dropped);
// - the compare view (original / rewrite, missing details, Profile + model, backup used), Enter adopts, the draft
//   changed meanwhile is refused; adoption is one undo step (textarea insertText; rich input history);
// - capability gating (composer and settings) and the per-host routing settings.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement as h, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
const PROFILES = [
  { id: "p-gpt", name: "GPT 主号", model: "gpt-6.2" },
  { id: "p-claude", name: "Claude 订阅", model: "claude-sonnet-5-5" },
  { id: "p-ds", name: "DeepSeek", model: "deepseek-v4" },
];
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfileList: () => ({ defaultProfile: "p-gpt", profiles: PROFILES }),
  loadProfileList: () => Promise.resolve({ defaultProfile: "p-gpt", profiles: PROFILES }),
}));
const target = { features: new Set<string>(["text-rewrite-v1"]) };
vi.mock("../src/renderer/src/lib/targetHost", () => ({
  useTargetFeatures: () => target.features,
  useTargetHostId: () => "local",
  useTargetApi: () => ({ listProfiles: () => Promise.resolve({ defaultProfile: "p-gpt", profiles: PROFILES }) }),
}));
vi.mock("../src/renderer/src/lib/profileOrder", () => ({ useOrderedProfiles: (items: unknown) => items }));
// 功能 Profiles of the host (lib/featureProfiles reads them through apiFor; never the ordinary Profile list).
const FEATURE_ROWS = [
  { id: "fp-small", name: "便宜的小模型", protocol: "openaiResponses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.2-mini", quotaType: "payAsYouGo", keyPresent: true },
  { id: "fp-haiku", name: "Haiku 改写", protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", quotaType: "balance", keyPresent: true },
];
const featureReads = vi.hoisted(() => ({ n: 0 }));
vi.mock("../src/renderer/src/bridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFor: () => ({ featureProfiles: () => { featureReads.n++; return Promise.resolve({ profiles: FEATURE_ROWS, damaged: [] }); } }),
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: unknown) => unknown) => select({ openSettings: () => {} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CutexClient } from "@cutex-desktop/cutex-client";
import { TextRewrites } from "../src/main/textRewrite";
import { textRewriteBody, type TextRewriteRequest, type TextRewriteResult } from "../src/shared/textRewrite";
import { adoptRewrite, diffTexts, enhanceTarget, hostRoute, insertUndoable, parsePromptEnhancePrefs, promptEnhanceKey, promptEnhancePrefs, resetPromptEnhancePrefsForTests, rewriteRoute, setHostRoute, type EnhanceTarget } from "../src/renderer/src/lib/promptEnhance";
import { bindingConflicts, bindingsOf, currentConflicts, resetKeybindingsForTests, setKeybindingPlatform, type KeyLike } from "../src/renderer/src/lib/keybindings";
import { usePromptEnhance } from "../src/renderer/src/lib/usePromptEnhance";
import { PromptEnhancePanel } from "../src/renderer/src/components/PromptEnhancePanel";
import { PromptEnhanceSection } from "../src/renderer/src/components/settings/PromptEnhanceSettings";
import { AgentMentionInput } from "../src/renderer/src/components/AgentMentionInput";
import type { DaemonApi } from "../src/shared/ipc";

// The store double is too thin for the avatar stack (agent looks, Profile pictures): icons are stubbed.
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const OK = { contractVersion: 2, rewrittenText: "Goal: fix the login page.\n\nSteps: run the tests.", missingDetails: ["Which browser?"], used: { profileId: "p-claude", provider: "anthropic", model: null, requestedModel: "claude-sonnet-5-5", fallbackUsed: true } };

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

describe("main: POST /v2/text-rewrite", () => {
  const request = (over: Partial<TextRewriteRequest> = {}): TextRewriteRequest => ({ requestId: "req-00000001", text: "fix login", route: { mode: "agent", sessionId: "cutex.abc", fallbackProfileIds: ["p-ds"] }, ...over });

  function client(answer: (init: RequestInit) => Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return answer(init!); });
    return { client: new CutexClient({ baseUrl: "http://127.0.0.1:9", token: "owner-token" }, { fetch: fetch as unknown as typeof globalThis.fetch }), calls, fetch };
  }
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("sends the rebuilt body with the template once, and passes back only the known fields", async () => {
    const { client: c, calls, fetch } = client(() => json(200, { ...OK, extra: "dropped" }));
    const result = await new TextRewrites().run(c, { ...request(), stray: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v2/text-rewrite");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ templateId: "prompt-enhance-v1", text: "fix login", route: { mode: "agent", sessionId: "cutex.abc", fallbackProfileIds: ["p-ds"] } });
    expect(result).toEqual({ ok: true, rewrittenText: OK.rewrittenText, missingDetails: OK.missingDetails, used: OK.used });
  });

  it("is never retried, even on a retryable 503 (a retry may be charged again)", async () => {
    const { client: c, fetch } = client(() => json(503, { error: { code: "rewrite_busy", message: "Rewrite capacity busy", retryable: true } }));
    expect(await new TextRewrites().run(c, request())).toEqual({ ok: false, code: "rewrite_busy", attempts: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts the transport (the connection closes, cutex cancels upstream) and reports cancelled", async () => {
    let signal: AbortSignal | undefined;
    const { client: c } = client((init) => new Promise((_, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const rewrites = new TextRewrites();
    const pending = rewrites.run(c, request());
    await Promise.resolve();
    expect(rewrites.size).toBe(1);
    rewrites.cancel("req-00000001");
    expect(signal?.aborted).toBe(true);
    expect(await pending).toEqual({ ok: false, code: "cancelled", attempts: [] });
    expect(rewrites.size).toBe(0);
  });

  it("frees the slot when no answer comes (timeout), and cancelAll drops every call", async () => {
    const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const { client: c } = client(hang);
    expect(await new TextRewrites(5).run(c, request())).toEqual({ ok: false, code: "timeout", attempts: [] });
    const rewrites = new TextRewrites();
    const a = rewrites.run(c, request({ requestId: "req-0000000a" }));
    const b = rewrites.run(c, request({ requestId: "req-0000000b" }));
    rewrites.cancelAll();
    expect((await a).ok || (await b).ok).toBe(false);
  });

  it("maps rewrite_failed attempts per Profile, and 404 / 403 / unknown errors", async () => {
    const attempts = [{ profileId: "p-gpt", category: "quota_exhausted" }, { profileId: "p-claude", category: "authentication" }, { profileId: "x", category: "made_up" }];
    const failed = client(() => json(422, { error: { code: "rewrite_failed", message: "Rewrite did not complete", details: { attempts } } }));
    expect(await new TextRewrites().run(failed.client, request())).toEqual({ ok: false, code: "rewrite_failed", attempts: attempts.slice(0, 2) });
    expect(await new TextRewrites().run(client(() => json(404, { error: { code: "route_not_found", message: "" } })).client, request())).toMatchObject({ ok: false, code: "unsupported" });
    expect(await new TextRewrites().run(client(() => json(403, { error: { code: "owner_only", message: "" } })).client, request())).toMatchObject({ ok: false, code: "forbidden" });
    expect(await new TextRewrites().run(client(() => json(500, { error: { code: "boom", message: "" } })).client, request())).toMatchObject({ ok: false, code: "failed" });
    expect(await new TextRewrites().run(client(() => json(200, { contractVersion: 1 })).client, request())).toMatchObject({ ok: false, code: "failed" });
    expect(await new TextRewrites().run(client(() => Promise.reject(new TypeError("connect ECONNREFUSED"))).client, request())).toMatchObject({ ok: false, code: "unreachable" });
  });

  it("refuses malformed requests before calling cutex, without quoting the draft", () => {
    const secret = "my secret draft";
    for (const bad of [
      { text: secret, route: { mode: "agent" } },
      { text: "   ", route: { mode: "profile", profileIds: ["a"] } },
      { text: secret, route: { mode: "profile", profileIds: [] } },
      { text: secret, route: { mode: "profile", profileIds: ["a", "b", "c", "d", "e"] } },
      { text: secret, route: { mode: "other" } },
      { text: "x".repeat(16 * 1024 + 1), route: { mode: "profile", profileIds: ["a"] } },
    ]) {
      let message = "";
      try { textRewriteBody(bad); } catch (e) { message = (e as Error).message; }
      expect(message).not.toBe("");
      expect(message).not.toContain(secret);
    }
    // 16 KiB counts UTF-8 bytes: 5462 Chinese characters are 16386 bytes.
    expect(() => textRewriteBody({ text: "中".repeat(5462), route: { mode: "profile", profileIds: ["a"] } })).toThrow("text too long");
  });

  it("is reachable only through the two allowed IPC methods; teardown cancels", () => {
    for (const file of ["src/main/index.ts", "src/preload/index.ts"]) {
      expect(src(file)).toContain('"textRewrite",');
      expect(src(file)).toContain('"cancelTextRewrite",');
    }
    expect(src("src/main/daemon.ts")).toMatch(/private teardown\(\): void \{\n\s+this\.textRewrites\.cancelAll\(\);/);
  });
});

// ── keys, target, route ──────────────────────────────────────────────────────────────────────────

const key = (over: Partial<KeyLike>): KeyLike => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("shortcut and keys", () => {
  afterEach(() => { resetKeybindingsForTests(); setKeybindingPlatform(null); });

  it("defaults to Ctrl+Shift+E (⌘⇧E on macOS), clashing with nothing", () => {
    setKeybindingPlatform("other");
    expect(bindingsOf("promptEnhance")).toEqual(["Mod+Shift+KeyE"]);
    expect(bindingConflicts("promptEnhance", "Mod+Shift+KeyE")).toEqual([]);
    expect(currentConflicts().filter((c) => c.a === "promptEnhance" || c.b === "promptEnhance")).toEqual([]);
    // Composer keys are refused for it.
    expect(bindingConflicts("promptEnhance", "Mod+Enter").map((r) => r.kind)).toContain("composer");
    setKeybindingPlatform("mac");
    expect(bindingConflicts("promptEnhance", "Mod+Shift+KeyE")).toEqual([]);
  });

  it("start / adopt / cancel / hold, never during IME composition", () => {
    setKeybindingPlatform("other");
    const start = key({ key: "E", code: "KeyE", ctrlKey: true, shiftKey: true });
    expect(promptEnhanceKey(start, true, "idle")).toBe("start");
    expect(promptEnhanceKey(start, false, "idle")).toBeNull(); // host without text-rewrite-v1 / switched off
    expect(promptEnhanceKey({ ...start, isComposing: true }, true, "idle")).toBeNull();
    expect(promptEnhanceKey(key({ key: "Enter", isComposing: true }), true, "done")).toBeNull();
    expect(promptEnhanceKey(key({ key: "Enter", keyCode: 229 }), true, "done")).toBeNull();
    expect(promptEnhanceKey(key({ key: "Enter" }), true, "done")).toBe("adopt");
    expect(promptEnhanceKey(key({ key: "Enter" }), true, "running")).toBe("hold");
    expect(promptEnhanceKey(key({ key: "Enter" }), true, "idle")).toBeNull();
    expect(promptEnhanceKey(key({ key: "Enter", shiftKey: true }), true, "done")).toBeNull(); // newline stays
    expect(promptEnhanceKey(key({ key: "Escape" }), true, "running")).toBe("cancel");
    expect(promptEnhanceKey(key({ key: "Escape" }), true, "failed")).toBe("cancel");
    expect(promptEnhanceKey(key({ key: "Escape" }), true, "idle")).toBeNull(); // the composer's own Esc (interrupt)
  });

  it("rewrites the selection when it holds text, else the whole draft", () => {
    expect(enhanceTarget("abc def ghi", 4, 7)).toEqual({ start: 4, end: 7, text: "def", whole: false });
    expect(enhanceTarget("abc def ghi", 7, 4)).toEqual({ start: 4, end: 7, text: "def", whole: false });
    expect(enhanceTarget("abc def ghi", 3, 3)).toEqual({ start: 0, end: 11, text: "abc def ghi", whole: true });
    expect(enhanceTarget("abc   ghi", 3, 6)).toEqual({ start: 0, end: 9, text: "abc   ghi", whole: true }); // blank selection
    expect(enhanceTarget("  \n ", 0, 0)).toBeNull();
  });

  it("adopts only where the draft is unchanged", () => {
    const t: EnhanceTarget = { start: 4, end: 7, text: "def", whole: false };
    expect(adoptRewrite("abc def ghi", t, "DEF!")).toEqual({ text: "abc DEF! ghi", caret: 8 });
    expect(adoptRewrite("abc xyz ghi", t, "DEF!")).toBeNull();
    expect(adoptRewrite("abc def ghi more", { start: 0, end: 11, text: "abc def ghi", whole: true }, "X")).toBeNull();
  });

  it("routes (feature-profiles): the agent's own Profile then backup 功能 Profiles, or a 功能 Profile list; never ordinary IDs", () => {
    const r = (x: Partial<Parameters<typeof rewriteRoute>[0]>) => ({ mode: "agent" as const, fallback: ["p-ds"], profiles: ["p-gpt"], featureFallback: [], featureProfiles: [], ...x });
    expect(rewriteRoute(r({}), "cutex.s1", true)).toEqual({ mode: "agent", sessionId: "cutex.s1" });
    expect(rewriteRoute(r({ featureFallback: ["fp-small", "fp-haiku"] }), "cutex.s1", true)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackFeatureProfileIds: ["fp-small", "fp-haiku"] });
    expect(rewriteRoute(r({ mode: "profile", featureProfiles: ["fp-haiku", "fp-small"] }), "cutex.s1", true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-haiku", "fp-small"] });
    expect(rewriteRoute(r({ mode: "profile" }), "cutex.s1", true)).toBeNull();
    // A draft with no agent yet: the backups alone, else nothing.
    expect(rewriteRoute(r({ featureFallback: ["fp-small"] }), null, true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-small"] });
    expect(rewriteRoute(r({}), null, true)).toBeNull();
  });

  it("routes (no feature-profiles, today's cutex): ordinary backups or the fixed list exactly as before; 功能 Profiles never sent", () => {
    const r = (x: Partial<Parameters<typeof rewriteRoute>[0]>) => ({ mode: "agent" as const, fallback: [], profiles: [], featureFallback: ["fp-small"], featureProfiles: ["fp-haiku"], ...x });
    expect(rewriteRoute(r({ profiles: ["p-gpt"] }), "cutex.s1", false)).toEqual({ mode: "agent", sessionId: "cutex.s1" });
    expect(rewriteRoute(r({ fallback: ["p-ds", "p-claude"] }), "cutex.s1", false)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackProfileIds: ["p-ds", "p-claude"] });
    expect(rewriteRoute(r({ mode: "profile", fallback: ["p-ds"], profiles: ["p-claude", "p-gpt"] }), "cutex.s1", false)).toEqual({ mode: "profile", profileIds: ["p-claude", "p-gpt"] });
    expect(rewriteRoute(r({ mode: "profile" }), "cutex.s1", false)).toBeNull();
    // A draft with no agent yet: the ordinary backups alone, else nothing.
    expect(rewriteRoute(r({ fallback: ["p-ds"] }), null, false)).toEqual({ mode: "profile", profileIds: ["p-ds"] });
    expect(rewriteRoute(r({}), null, false)).toBeNull();
  });

  it("stored prefs: per host, malformed parts dropped, at most four Profiles", () => {
    expect(parsePromptEnhancePrefs(null)).toEqual({ enabled: true, hosts: {} });
    const p = parsePromptEnhancePrefs({ v: 1, enabled: false, hosts: { local: { mode: "profile", profiles: ["a", "a", "b", 3, "c", "d", "e"], fallback: "x" }, hostb: { mode: "?" } } });
    expect(p).toEqual({ enabled: false, hosts: { local: { mode: "profile", profiles: ["a", "b", "c", "d"], fallback: [], featureFallback: [], featureProfiles: [] }, hostb: { mode: "agent", fallback: [], profiles: [], featureFallback: [], featureProfiles: [] } } });
    // 功能 Profile choices are kept per host, up to three backups and four in the list.
    const q = parsePromptEnhancePrefs({ v: 1, hosts: { local: { mode: "agent", featureFallback: ["fp-a", "fp-b", "fp-c", "fp-d"], featureProfiles: ["fp-a", "fp-a", "fp-b"] } } });
    expect(q.hosts.local).toMatchObject({ featureFallback: ["fp-a", "fp-b", "fp-c"], featureProfiles: ["fp-a", "fp-b"] });
  });

  it("marks the changed words", () => {
    const parts = diffTexts("fix the login page", "fix the sign-in page now")!;
    expect(parts.filter((x) => x.kind === "removed").map((x) => x.text).join("")).toBe("login");
    expect(parts.filter((x) => x.kind === "added").map((x) => x.text).join("")).toContain("sign-in");
    expect(parts.filter((x) => x.kind !== "added").map((x) => x.text).join("")).toBe("fix the login page");
    expect(parts.filter((x) => x.kind !== "removed").map((x) => x.text).join("")).toBe("fix the sign-in page now");
    expect(diffTexts("登录页面坏了", "登录页面打不开")!.some((x) => x.kind === "removed" && x.text === "坏了")).toBe(true);
  });
});

// ── composer flow (the hook + panel the composer mounts, with its key decision) ─────────────────

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  resetPromptEnhancePrefsForTests();
  setKeybindingPlatform("other");
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  setKeybindingPlatform(null);
});

interface Deferred { resolve(r: TextRewriteResult): void; request: TextRewriteRequest }
function fakeApi() {
  const calls: Deferred[] = [];
  const api = {
    textRewrite: vi.fn((request: TextRewriteRequest) => new Promise<TextRewriteResult>((resolve) => calls.push({ resolve, request }))),
    cancelTextRewrite: vi.fn(),
  };
  return { api: api as unknown as DaemonApi, calls, raw: api };
}

/** The composer's wiring in small: a textarea, the panel above it, its onKeyDown through promptEnhanceKey. */
function Harness({ api, initial, sessionId = "cutex.s1" }: { api: DaemonApi; initial: string; sessionId?: string }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const getApi = useCallback(() => api, [api]);
  const route = useCallback(() => rewriteRoute(hostRoute("local"), sessionId, true), [sessionId]);
  const enhance = usePromptEnhance(getApi, route, `local|${sessionId}`);
  const adopt = () => {
    const shown = enhance.state;
    if (shown.phase !== "done") return;
    const next = enhance.adopt(text);
    if (!next) return;
    if (ref.current && insertUndoable(ref.current, shown.target.start, shown.target.end, shown.rewrittenText, next.text)) return;
    setText(next.text);
  };
  return h("div", null,
    h(PromptEnhancePanel, { state: enhance.state, hostId: "local", adoptKey: "Enter", onAdopt: adopt, onCancel: enhance.cancel, onRetry: () => enhance.start(text, null, null) }),
    h("textarea", {
      ref, value: text, "data-testid": "input",
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const action = promptEnhanceKey(e, true, enhance.state.phase);
        if (!action) return;
        e.preventDefault();
        if (action === "start") enhance.start(text, ref.current?.selectionStart, ref.current?.selectionEnd);
        else if (action === "cancel") enhance.cancel();
        else if (action === "adopt") adopt();
      },
    }),
  );
}

const input = () => host.querySelector<HTMLTextAreaElement>("[data-testid=input]")!;
const panel = () => host.querySelector<HTMLElement>("[data-testid=prompt-enhance-panel]");
const press = (el: HTMLElement, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const shortcut = () => press(input(), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true });

describe("composer flow", () => {
  it("the shortcut sends the selection, or the whole draft with none, via the agent route", async () => {
    const { api, calls } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "please fix the login page" })));
    input().setSelectionRange(11, 16);
    await shortcut();
    expect(calls[0]!.request).toMatchObject({ text: "the l", route: { mode: "agent", sessionId: "cutex.s1" } });
    expect(panel()?.dataset.phase).toBe("running");
    await press(input(), { key: "Escape" });
    input().setSelectionRange(3, 3);
    await shortcut();
    expect(calls[1]!.request.text).toBe("please fix the login page");
  });

  it("Esc cancels the request in flight (by its id) and a late answer is dropped", async () => {
    const { api, calls, raw } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "draft" })));
    await shortcut();
    const id = calls[0]!.request.requestId;
    await press(input(), { key: "Escape" });
    expect(raw.cancelTextRewrite).toHaveBeenCalledWith(id);
    expect(panel()).toBeNull();
    calls[0]!.resolve({ ok: true, rewrittenText: "late", missingDetails: [], used: OK.used });
    await flush();
    expect(panel()).toBeNull();
    expect(input().value).toBe("draft");
  });

  it("Enter while the answer is coming does nothing; then shows both sides, details and the Profile used; Enter adopts", async () => {
    const { api, calls } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "fix login" })));
    await shortcut();
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("fix login");
    calls[0]!.resolve({ ok: true, rewrittenText: OK.rewrittenText, missingDetails: OK.missingDetails, used: OK.used });
    await flush();
    expect(panel()?.dataset.phase).toBe("done");
    expect(host.querySelector("[data-prompt-enhance-side=removed]")?.textContent).toBe("fix login");
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe(OK.rewrittenText);
    expect(host.querySelector("[data-testid=prompt-enhance-missing]")?.textContent).toContain("Which browser?");
    const used = host.querySelector("[data-testid=prompt-enhance-used]")!.textContent!;
    expect(used).toContain("Claude 订阅"); // the Profile's name, not its id
    expect(used).toContain("claude-sonnet-5-5"); // model null → the requested model
    expect(used).toContain("promptEnhance.fallbackUsed");
    await press(input(), { key: "Enter" });
    expect(input().value).toBe(OK.rewrittenText);
    expect(panel()).toBeNull();
  });

  it("never overwrites a draft that changed meanwhile", async () => {
    const { api, calls } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "fix login" })));
    await shortcut();
    calls[0]!.resolve({ ok: true, rewrittenText: "Fix the login page.", missingDetails: [], used: { ...OK.used, fallbackUsed: false } });
    await flush();
    const el = input();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, "fix login now");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("fix login now");
    expect(panel()?.textContent).toContain("promptEnhance.draftChanged");
  });

  it("all Profiles failing: each one's reason", async () => {
    const { api, calls } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "fix login" })));
    await shortcut();
    calls[0]!.resolve({ ok: false, code: "rewrite_failed", attempts: [{ profileId: "p-gpt", category: "quota_exhausted" }, { profileId: "p-claude", category: "quota_exhausted" }] });
    await flush();
    expect(panel()?.dataset.phase).toBe("failed");
    const rows = [...host.querySelectorAll("[data-testid=prompt-enhance-attempts] li")].map((li) => li.textContent);
    expect(rows).toEqual([
      'promptEnhance.attempt {"profile":"GPT 主号","reason":"promptEnhance.attempt.quota_exhausted"}',
      'promptEnhance.attempt {"profile":"Claude 订阅","reason":"promptEnhance.attempt.quota_exhausted"}',
    ]);
    expect(host.querySelector("[data-testid=prompt-enhance-failed]")?.textContent).toContain("promptEnhance.error.rewrite_failed");
  });

  it("profile mode with no Profile chosen asks for one instead of calling cutex", async () => {
    setHostRoute("local", { mode: "profile", featureProfiles: [] });
    const { api, raw } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "fix login" })));
    await shortcut();
    expect(raw.textRewrite).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain("promptEnhance.error.noRoute");
  });

  it("switching agent drops the request (cancelled in cutex)", async () => {
    const { api, calls, raw } = fakeApi();
    act(() => root!.render(h(Harness, { api, initial: "fix login" })));
    await shortcut();
    act(() => root!.render(h(Harness, { api, initial: "fix login", sessionId: "cutex.s2" })));
    expect(raw.cancelTextRewrite).toHaveBeenCalledWith(calls[0]!.request.requestId);
    expect(panel()).toBeNull();
  });
});

describe("adoption is one undo step", () => {
  it("textarea: replaced through the browser's insertText on the target range", () => {
    const el = document.createElement("textarea");
    document.body.append(el);
    el.value = "abc def ghi";
    const exec = vi.fn((command: string, _ui: boolean, value: string) => {
      expect(command).toBe("insertText");
      el.setRangeText(value, el.selectionStart, el.selectionEnd, "end");
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    try {
      expect(insertUndoable(el, 4, 7, "DEF!", "abc DEF! ghi")).toBe(true);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(el.value).toBe("abc DEF! ghi");
      // Not done by the browser (or not as expected): the caller sets the draft itself.
      exec.mockImplementation(() => false);
      expect(insertUndoable(el, 0, 3, "x", "x DEF! ghi")).toBe(false);
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
      el.remove();
    }
  });

  it("rich input (mention atoms): Ctrl+Z after adoption restores the draft in one step", () => {
    function Rich() {
      const [value, setValue] = useState("ask [@Ada](cutex:agent/cutex.ada) to fix login");
      return h("div", null,
        h("button", { "data-testid": "adopt", onClick: () => setValue("ask [@Ada](cutex:agent/cutex.ada) to fix the login page and run the tests") }),
        h(AgentMentionInput, { value, onChange: (v: string) => setValue(v), "data-testid": "rich" } as never),
        h("output", { "data-testid": "value" }, value));
    }
    act(() => root!.render(h(Rich)));
    act(() => host.querySelector<HTMLButtonElement>("[data-testid=adopt]")!.click());
    expect(host.querySelector("[data-testid=value]")!.textContent).toContain("run the tests");
    const rich = host.querySelector<HTMLElement>("[data-testid=rich]")!;
    act(() => { rich.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(host.querySelector("[data-testid=value]")!.textContent).toBe("ask [@Ada](cutex:agent/cutex.ada) to fix login");
  });
});

// ── gating and settings ──────────────────────────────────────────────────────────────────────────

describe("capability gating and routing settings", () => {
  it("the composer shows the button, panel and key only with text-rewrite-v1 and the switch on", () => {
    const composer = src("src/renderer/src/components/Composer.tsx");
    expect(composer).toContain("const enhanceOn = enhancePrefs.enabled && features.has(TEXT_REWRITE_FEATURE);");
    expect(composer).toContain("rewriteRoute(hostRoute(hostId), sessionId, enhanceFeatureProfiles)");
    expect(composer).toContain("{enhanceOn && <PromptEnhancePanel");
    expect(composer).toMatch(/\{enhanceOn && \(\n\s+<button type="button" data-testid="prompt-enhance-button"/);
    expect(composer).toContain("promptEnhanceKey(e, enhanceOn, enhance.state.phase)");
    // Its Esc is not the conversation's interrupt.
    expect(composer).toContain("|| (enhanceOn && enhance.active),");
  });

  it("settings: hidden without the feature; with feature-profiles: follow the agent then backup 功能 Profiles, or a 功能 Profile list", async () => {
    target.features = new Set();
    act(() => root!.render(h(PromptEnhanceSection)));
    expect(host.textContent).toBe("");
    target.features = new Set(["text-rewrite-v1", "feature-profiles"]);
    act(() => root!.render(h(PromptEnhanceSection)));
    await flush();
    expect(host.textContent).toContain("promptEnhance.settings.route.agent");
    // The picker offers 功能 Profiles only, never the host's agent Profiles.
    const options = (testId: string) => [...host.querySelectorAll<HTMLOptionElement>(`[data-testid=${testId}] select option`)].map((o) => o.value).filter(Boolean);
    expect(options("prompt-enhance-fallback")).toEqual(["fp-small", "fp-haiku"]);
    const pickIn = (testId: string, id: string) => {
      const select = host.querySelector<HTMLSelectElement>(`[data-testid=${testId}] select`)!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, id);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    pickIn("prompt-enhance-fallback", "fp-haiku");
    pickIn("prompt-enhance-fallback", "fp-small");
    expect(hostRoute("local")).toMatchObject({ mode: "agent", featureFallback: ["fp-haiku", "fp-small"] });
    act(() => host.querySelector<HTMLButtonElement>('[data-feature-profile-id="fp-small"] button[title="promptEnhance.settings.moveUp"]')!.click());
    expect(hostRoute("local").featureFallback).toEqual(["fp-small", "fp-haiku"]);
    expect(rewriteRoute(hostRoute("local"), "cutex.s1", true)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackFeatureProfileIds: ["fp-small", "fp-haiku"] });
    // The 功能 Profile list.
    const fixed = [...host.querySelectorAll<HTMLButtonElement>("[role=radiogroup] button")].find((b) => b.textContent === "promptEnhance.settings.route.featureProfile")!;
    act(() => fixed.click());
    expect(hostRoute("local").mode).toBe("profile");
    pickIn("prompt-enhance-profiles", "fp-small");
    expect(rewriteRoute(hostRoute("local"), "cutex.s1", true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-small"] });
    act(() => host.querySelector<HTMLButtonElement>('[data-feature-profile-id="fp-small"] button[title="promptEnhance.settings.remove"]')!.click());
    expect(hostRoute("local").featureProfiles).toEqual([]);
    expect(promptEnhancePrefs().enabled).toBe(true);
  });

  it("settings on a host without feature-profiles (today's cutex): the ordinary-Profile picker as before; 功能 Profile choices kept apart", async () => {
    setHostRoute("local", { mode: "agent", featureFallback: ["fp-small"], featureProfiles: ["fp-haiku"] });
    featureReads.n = 0;
    target.features = new Set(["text-rewrite-v1"]);
    act(() => root!.render(h(PromptEnhanceSection)));
    await flush();
    expect(featureReads.n).toBe(0);
    expect(host.textContent).toContain("promptEnhance.settings.route.agentHint");
    expect(host.textContent).not.toContain("manageFeatureProfiles");
    // The add control is the searchable Profile picker (EntitySelect), as before.
    const pickIn = (testId: string, id: string) => {
      act(() => host.querySelector<HTMLButtonElement>(`[data-testid=${testId}] [data-entity-select]`)!.click());
      act(() => document.querySelector<HTMLButtonElement>(`[role=option][data-value="${id}"]`)!.click());
    };
    expect(host.querySelector('[data-testid=prompt-enhance-fallback] [data-feature-profile-id]')).toBeNull();
    pickIn("prompt-enhance-fallback", "p-ds");
    pickIn("prompt-enhance-fallback", "p-claude");
    expect(hostRoute("local")).toMatchObject({ mode: "agent", fallback: ["p-ds", "p-claude"], featureFallback: ["fp-small"] });
    act(() => host.querySelector<HTMLButtonElement>('[data-profile-id="p-claude"] button[title="promptEnhance.settings.moveUp"]')!.click());
    expect(hostRoute("local").fallback).toEqual(["p-claude", "p-ds"]);
    expect(rewriteRoute(hostRoute("local"), "cutex.s1", false)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackProfileIds: ["p-claude", "p-ds"] });
    const fixed = [...host.querySelectorAll<HTMLButtonElement>("[role=radiogroup] button")].find((b) => b.textContent === "promptEnhance.settings.route.profile")!;
    act(() => fixed.click());
    pickIn("prompt-enhance-profiles", "p-gpt");
    expect(rewriteRoute(hostRoute("local"), "cutex.s1", false)).toEqual({ mode: "profile", profileIds: ["p-gpt"] });
    // The 功能 Profile choices were never touched; with the capability they are what is used.
    expect(hostRoute("local")).toMatchObject({ featureFallback: ["fp-small"], featureProfiles: ["fp-haiku"] });
    expect(rewriteRoute(hostRoute("local"), "cutex.s1", true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-haiku"] });
  });
});

// ── review fixes (2026-11-24): held keys, cancel before start, owner renderer ────────────────────

describe("review fixes", () => {
  afterEach(() => setKeybindingPlatform(null));

  it("an open panel holds every send / steer / queue / interrupt-and-send key; Shift+Enter and Shift+Tab stay", () => {
    setKeybindingPlatform("other");
    for (const phase of ["running", "done", "failed"] as const) {
      expect(promptEnhanceKey(key({ key: "Enter", ctrlKey: true }), true, phase)).toBe("hold");
      expect(promptEnhanceKey(key({ key: "Enter", metaKey: true }), true, phase)).toBe("hold");
      expect(promptEnhanceKey(key({ key: "Enter", ctrlKey: true, shiftKey: true }), true, phase)).toBe("hold");
      expect(promptEnhanceKey(key({ key: "Enter", altKey: true }), true, phase)).toBe("hold");
      expect(promptEnhanceKey(key({ key: "Tab" }), true, phase)).toBe("hold");
      expect(promptEnhanceKey(key({ key: "Enter", shiftKey: true }), true, phase)).toBeNull();
      expect(promptEnhanceKey(key({ key: "Tab", shiftKey: true }), true, phase)).toBeNull();
      expect(promptEnhanceKey(key({ key: "Escape" }), true, phase)).toBe("cancel");
    }
    expect(promptEnhanceKey(key({ key: "Enter" }), true, "failed")).toBe("hold");
    expect(promptEnhanceKey(key({ key: "Enter" }), true, "done")).toBe("adopt");
    // Closed: the composer's own keys again.
    expect(promptEnhanceKey(key({ key: "Enter", ctrlKey: true }), true, "idle")).toBeNull();
    expect(promptEnhanceKey(key({ key: "Tab" }), true, "idle")).toBeNull();
  });

  const body = { requestId: "req-tomb-0001", text: "draft", route: { mode: "agent", sessionId: "cutex.s" } };
  const hanging = () => {
    const request = vi.fn((_m: string, _p: string, o: { signal: AbortSignal }) => new Promise((_r, reject) => o.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
    return { client: { request } as never, request };
  };

  it("main: a cancel that arrives before its start refuses that start (for a while), without calling cutex", async () => {
    let now = 1_000;
    const rewrites = new TextRewrites(30_000, () => now);
    const { client, request } = hanging();
    rewrites.cancel("req-tomb-0001");
    expect(rewrites.tombstones).toBe(1);
    expect(await rewrites.run(client, body)).toEqual({ ok: false, code: "cancelled", attempts: [] });
    expect(request).not.toHaveBeenCalled();
    expect(rewrites.tombstones).toBe(0);
    // Expired tombstones are forgotten; junk ids are not remembered.
    rewrites.cancel("req-tomb-0002");
    rewrites.cancel("bad id");
    now += 60_001;
    const late = rewrites.run(client, { ...body, requestId: "req-tomb-0002" });
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    rewrites.cancelAll();
    expect(await late).toMatchObject({ code: "cancelled" });
    expect(rewrites.tombstones).toBe(0);
  });

  it("main: the asking renderer's reload / crash / close cancels its call; listeners are removed after", async () => {
    for (const event of ["did-navigate", "render-process-gone", "destroyed"] as const) {
      const listeners = new Map<string, () => void>();
      const owner = { destroyed: false, isDestroyed() { return this.destroyed; }, on: vi.fn((e: string, l: () => void) => listeners.set(e, l)), removeListener: vi.fn((e: string) => listeners.delete(e)) };
      const rewrites = new TextRewrites();
      const { client } = hanging();
      const pending = rewrites.run(client, body, owner);
      await Promise.resolve();
      expect([...listeners.keys()].sort()).toEqual(["destroyed", "did-navigate", "render-process-gone"]);
      listeners.get(event)!();
      expect(await pending).toEqual({ ok: false, code: "cancelled", attempts: [] });
      expect(listeners.size).toBe(0);
    }
    // Already gone: nothing starts.
    const { client, request } = hanging();
    expect(await new TextRewrites().run(client, body, { isDestroyed: () => true, on: vi.fn(), removeListener: vi.fn() })).toMatchObject({ code: "cancelled" });
    expect(request).not.toHaveBeenCalled();
  });

  it("main: textRewrite is bound to event.sender, never to a renderer-supplied owner", () => {
    expect(src("src/main/index.ts")).toContain('const callArgs = method === "textRewrite" ? [args?.[0], event.sender] : args;');
  });
});
