// @vitest-environment jsdom
// 输入优化 (module input-refinement; 提示词增强 before 2026-11-26): cutex text-rewrite-v1 and -v2
// (shared/textRewrite.ts, shared/textRewriteV2.ts, main/textRewrite.ts, modules/input-refinement/*), mounted in the
// input box through the generic composer.action host (lib/composerActions.ts, modules/ComposerActions.tsx):
// - main: bodies rebuilt from known fields, POST never retried, cancel aborts the transport, per-Profile failures,
//   no text in errors; v2 template CRUD and structured replies checked (correction spans exact and ordered);
// - the rebindable shortcut (Ctrl+Shift+E, no clash), the picker command, IME never triggers them; selection vs draft;
// - Esc cancels the request in flight (cancelTextRewrite with its id; a late answer is dropped);
// - the compare view, 「还可以补充」 as checkboxes (直接加上 without a model call, 重新整理 on v2), 第 N 版 switching,
//   纠错学习's changes (category, explanation, 取决于你的意思); Enter adopts the shown version as one undo step; a
//   draft changed meanwhile is refused;
// - capability gating and the settings (v1 routing on this desktop; v2 templates on the host).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement as h, useState } from "react";
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
// r298: the host's global order and what the settings pages sent.
const globalRoutingHost = vi.hoisted(() => ({ global: null as unknown, calls: [] as unknown[][] }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({
  useTargetFeatures: () => target.features,
  useTargetHostId: () => "local",
  useTargetApi: () => ({
    listProfiles: () => Promise.resolve({ defaultProfile: "p-gpt", profiles: PROFILES }),
    patchTextRewriteRoute: (route: unknown) => { globalRoutingHost.calls.push(["patchTextRewriteRoute", route]); globalRoutingHost.global = route; return Promise.resolve(route); },
    patchTextRewriteTemplate: (id: string, patch: { route?: unknown }) => {
      globalRoutingHost.calls.push(["patchTextRewriteTemplate", id, patch]);
      const t = (v2Host.lists.get("local") as { id: string }[] | undefined)?.find((x) => x.id === id) ?? { id };
      return Promise.resolve({ ...t, ...(patch.route !== undefined ? { routeOverride: patch.route, route: patch.route ?? globalRoutingHost.global } : {}) });
    },
    createTextRewriteTemplate: (input: object) => { globalRoutingHost.calls.push(["createTextRewriteTemplate", input]); return Promise.resolve({ ...input, id: "tpl-new", builtIn: false, route: globalRoutingHost.global, routeOverride: null }); },
  }),
}));
vi.mock("../src/renderer/src/lib/profileOrder", () => ({ useOrderedProfiles: (items: unknown) => items }));
const FEATURE_ROWS = [
  { id: "fp-small", name: "便宜的小模型", protocol: "openaiResponses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.2-mini", quotaType: "payAsYouGo", keyPresent: true },
  { id: "fp-haiku", name: "Haiku 改写", protocol: "anthropicMessages", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", quotaType: "balance", keyPresent: true },
];
const featureReads = vi.hoisted(() => ({ n: 0 }));
const TEMPLATES = vi.hoisted(() => [
  { id: "prompt-enhance-v1", builtIn: true, kind: "enhance", name: "提示词增强", prompt: "P", route: { mode: "agent", model: null, fallback: [] } },
  { id: "grammar-learning-v1", builtIn: true, kind: "correction", name: "纠错学习", prompt: "C", route: { mode: "agent", model: null, fallback: [] } },
  { id: "tpl-mail", builtIn: false, kind: "enhance", name: "英文邮件", prompt: "M", route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-small", model: "gpt-6.2-mini" }] } },
]);
vi.mock("../src/renderer/src/bridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFor: (hostId: string) => ({
    featureProfiles: () => { featureReads.n++; return Promise.resolve({ profiles: FEATURE_ROWS, damaged: [] }); },
    textRewriteTemplates: () => Promise.resolve(structuredClone(v2Host.lists.get(hostId) ?? TEMPLATES)),
    patchTextRewriteTemplate: (id: string, patch: unknown) => v2Host.patch(hostId, id, patch),
    textRewriteRoute: () => Promise.resolve(structuredClone(globalRoutingHost.global)),
  }),
}));
// The host's template list and PATCH (the one-time v1 route migration), per host.
const v2Host = vi.hoisted(() => ({ lists: new Map<string, unknown[]>(), patch: null as unknown as (hostId: string, id: string, patch: unknown) => Promise<unknown> }));
const opened = vi.hoisted(() => [] as unknown[][]);
// The input box's host: what the composer sees (features of the agent's host, its daemon).
const composerHost = vi.hoisted(() => ({ features: new Set<string>(["text-rewrite-v1"]), api: null as unknown }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (select: (s: unknown) => unknown) => select({ openSettings: (...args: unknown[]) => opened.push(args) }),
  featuresOf: () => composerHost.features,
  hostApi: () => composerHost.api,
}));
// The composer.action slot holds this module's item only (modules/input-refinement/index.ts), shown everywhere.
vi.mock("../src/renderer/src/modules/react", async () => {
  const { RewriteAction } = await import("../src/renderer/src/modules/input-refinement/RewriteAction");
  const entry = { moduleId: "input-refinement", mode: "show", missing: [], waiting: false, item: { id: "input-refinement.action", commands: ["promptEnhance", "inputRefinementPick"], Action: RewriteAction } };
  return { useSlot: () => [entry] };
});
vi.mock("../src/renderer/src/lib/agentFeaturesView", () => ({ useAgentFeatures: () => null }));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ useHostEntryGate: () => () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CutexClient } from "@cutex-desktop/cutex-client";
import { TextRewrites } from "../src/main/textRewrite";
import { textRewriteAttempts, textRewriteBody, type TextRewriteRequest, type TextRewriteResult } from "../src/shared/textRewrite";
import { REWRITE_PROTECTION_MAX_BYTES, copyOfTemplate, parseRewriteGlobalRouteReply, parseRewriteTemplateList, rewriteGlobalRouteBody, parseStructuredRewriteReply, rewriteTemplateCreateBody, rewriteTemplateErrorOf, type RewriteProtection, rewriteTemplatePatchBody, structuredRewriteBody, type StructuredRewriteRequest, type StructuredRewriteResult } from "../src/shared/textRewriteV2";
import { adoptRewrite, appendSuggestions, applyCorrections, chooseCorrection, correctionEdits, diffTexts, enhanceTarget, hostRoute, panelKey, parsePromptEnhancePrefs, promptEnhancePrefs, resetPromptEnhancePrefsForTests, rewriteRoute, setHostRoute, setLastTemplate, setPromptEnhanceEnabled, v2RouteFromLocal, type EnhanceTarget } from "../src/renderer/src/modules/input-refinement/rewrite";
import { insertUndoable } from "../src/renderer/src/lib/undoableInsert";
import { bindingConflicts, bindingsOf, currentConflicts, resetKeybindingsForTests, setBindings, setKeybindingPlatform } from "../src/renderer/src/lib/keybindings";
import { useComposerActions } from "../src/renderer/src/lib/composerActions";
import { ComposerActions } from "../src/renderer/src/modules/ComposerActions";
import { InputRefinementCard, InputRefinementSettings } from "../src/renderer/src/modules/input-refinement/RewriteSettings";
import { TemplateSettings } from "../src/renderer/src/modules/input-refinement/TemplateSettings";
import { loadTemplates, resetTemplatesForTests, setTemplateEdit, templateName, useTemplateEdit } from "../src/renderer/src/modules/input-refinement/templates";
import { AgentMentionInput } from "../src/renderer/src/components/AgentMentionInput";
import type { DaemonApi } from "../src/shared/ipc";

vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

const OK = { contractVersion: 2, rewrittenText: "Goal: fix the login page.\n\nSteps: run the tests.", missingDetails: ["Which browser?"], used: { profileId: "p-claude", provider: "anthropic", model: null, requestedModel: "claude-sonnet-5-5", fallbackUsed: true } };

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

function client(answer: (init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return answer(init!); });
  return { client: new CutexClient({ baseUrl: "http://127.0.0.1:9", token: "owner-token" }, { fetch: fetch as unknown as typeof globalThis.fetch }), calls, fetch };
}
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("main: POST /v2/text-rewrite (v1)", () => {
  const request = (over: Partial<TextRewriteRequest> = {}): TextRewriteRequest => ({ requestId: "req-00000001", text: "fix login", route: { mode: "agent", sessionId: "cutex.abc", fallbackProfileIds: ["p-ds"] }, ...over });

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
    expect(() => textRewriteBody({ text: "中".repeat(5462), route: { mode: "profile", profileIds: ["a"] } })).toThrow("text too long");
  });

  it("is reachable only through the allowed IPC methods; teardown cancels", () => {
    for (const file of ["src/main/index.ts", "src/preload/index.ts"]) {
      for (const m of ["textRewrite", "cancelTextRewrite", "structuredTextRewrite", "textRewriteTemplates", "createTextRewriteTemplate", "patchTextRewriteTemplate", "deleteTextRewriteTemplate"]) expect(src(file)).toContain(`"${m}",`);
    }
    expect(src("src/main/daemon.ts")).toMatch(/private teardown\(\): void \{\n\s+this\.textRewrites\.cancelAll\(\);/);
  });
});

describe("main: text-rewrite-v2", () => {
  const sreq = (over: Partial<StructuredRewriteRequest> = {}): StructuredRewriteRequest => ({ requestId: "req-00000101", templateId: "grammar-learning-v1", sessionId: "cutex.abc", uiLanguage: "zh-CN", text: "je pense que je pouvais", ...over });
  const used = { profileId: "fp-haiku", provider: "anthropic", model: null, requestedModel: "claude-haiku-5-5", fallbackUsed: false };
  const correction = { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood", explanation: "条件式", language: "fr", alternatives: [{ replacement: "pouvais", when: "过去的能力" }] };

  it("structured: the body rebuilt from known fields (follow-up included), once, never retried; corrections checked against the original", async () => {
    const { client: c, calls, fetch } = client(() => json(200, { contractVersion: 2, text: "je pense que je pourrais", suggestions: [{ id: "s1", text: "时间?", needsInput: true }, { id: "s1", text: "dup", needsInput: false }], corrections: [correction], used, extra: 1 }));
    const result = await new TextRewrites().runStructured(c, { ...sreq(), stray: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v2/text-rewrite/structured");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ templateId: "grammar-learning-v1", sessionId: "cutex.abc", uiLanguage: "zh-CN", text: "je pense que je pouvais" });
    expect(result).toEqual({ ok: true, text: "je pense que je pourrais", suggestions: [{ id: "s1", text: "时间?", needsInput: true }], corrections: [correction], used });
    // A follow-up: answers only for known, distinct suggestions; blank text dropped.
    const follow = structuredRewriteBody(sreq({ templateId: "prompt-enhance-v1", followUp: { previous: { text: "prev", suggestions: [{ id: "s1", text: "环境", needsInput: true }, { id: "s2", text: "测试", needsInput: false }] }, answers: [{ id: "s1", text: "Samplehostb" }, { id: "s2", text: " " }] } }));
    expect(follow.followUp).toEqual({ previous: { text: "prev", suggestions: [{ id: "s1", text: "环境", needsInput: true }, { id: "s2", text: "测试", needsInput: false }] }, answers: [{ id: "s1", text: "Samplehostb" }, { id: "s2" }] });
    expect(() => structuredRewriteBody(sreq({ followUp: { previous: { text: "p", suggestions: [] }, answers: [{ id: "s9" }] } }))).toThrow();
    expect(() => structuredRewriteBody(sreq({ followUp: { previous: { text: "p", suggestions: [{ id: "s1", text: "x", needsInput: false }] }, answers: [{ id: "s1" }, { id: "s1" }] } }))).toThrow();
    expect(() => structuredRewriteBody(sreq({ uiLanguage: "zh CN" }))).toThrow();
  });

  it("r297 protection: opaque, bounded, a JSON copy; sent only with a follow-up; kept from a reply; 413 code known", async () => {
    const P = { literals: ["https://example.com/a", "`npm test`"], retained: [0] };
    const follow = { previous: { text: "prev", suggestions: [{ id: "s1", text: "环境", needsInput: true }] }, answers: [{ id: "s1" }] };
    expect(structuredRewriteBody(sreq({ followUp: follow, protection: P })).protection).toEqual(P);
    // A JSON copy: nothing but data goes out (functions / undefined dropped), never the caller's object itself.
    const odd = { literals: ["x"], f: () => 1, u: undefined } as unknown as RewriteProtection;
    const sent = structuredRewriteBody(sreq({ followUp: follow, protection: odd })).protection!;
    expect(sent).toEqual({ literals: ["x"] });
    expect(sent).not.toBe(odd);
    expect(structuredRewriteBody(sreq({ followUp: follow })).protection).toBeUndefined();
    expect(structuredRewriteBody(sreq({ followUp: follow, protection: null as unknown as RewriteProtection })).protection).toBeUndefined();
    expect(() => structuredRewriteBody(sreq({ protection: P }))).toThrow(); // a new rewrite starts without
    expect(() => structuredRewriteBody(sreq({ followUp: follow, protection: [1] as unknown as RewriteProtection }))).toThrow();
    expect(() => structuredRewriteBody(sreq({ followUp: follow, protection: { literals: ["x".repeat(REWRITE_PROTECTION_MAX_BYTES)] } }))).toThrow();
    for (const bad of [() => structuredRewriteBody(sreq({ protection: P }))]) {
      try { bad(); } catch (e) { expect(String(e)).not.toContain("example.com"); }
    }
    // Replies: kept when a bounded plain object; otherwise left out (the next round goes without).
    const base = { contractVersion: 2, text: "x", suggestions: [], corrections: [], used };
    expect(parseStructuredRewriteReply({ ...base, protection: P }, "y")!.protection).toEqual(P);
    expect(parseStructuredRewriteReply(base, "y")).not.toHaveProperty("protection");
    expect(parseStructuredRewriteReply({ ...base, protection: ["x"] }, "y")).not.toHaveProperty("protection");
    expect(parseStructuredRewriteReply({ ...base, protection: { literals: ["x".repeat(REWRITE_PROTECTION_MAX_BYTES)] } }, "y")).not.toHaveProperty("protection");
    // Through main: sent as the top-level field of the follow-up body and handed back from the reply.
    const { client: c, calls } = client(() => json(200, { ...base, protection: { literals: ["next"] } }));
    const result = await new TextRewrites().runStructured(c, sreq({ followUp: follow, protection: P }));
    expect(JSON.parse(String(calls[0]!.init.body)).protection).toEqual(P);
    expect(result).toMatchObject({ ok: true, protection: { literals: ["next"] } });
    const { client: c2 } = client(() => json(413, { contractVersion: 2, error: { code: "rewrite_protection_too_large", message: "protection too large" } }));
    expect(await new TextRewrites().runStructured(c2, sreq({ followUp: follow, protection: P }))).toEqual({ ok: false, code: "rewrite_protection_too_large", attempts: [] });
  });

  it("structured reply: spans that are not exact, ordered and apart drop the corrections, never the rewrite", () => {
    const base = { contractVersion: 2, text: "x", suggestions: [], used };
    expect(parseStructuredRewriteReply({ ...base, corrections: [{ ...correction, original: "pouvait" }] }, "je pense que je pouvais")!.corrections).toEqual([]);
    expect(parseStructuredRewriteReply({ ...base, corrections: [{ ...correction, start: 0, end: 2, original: "je" }, { ...correction, start: 1, end: 3, original: "e " }] }, "je pense")!.corrections).toEqual([]);
    expect(parseStructuredRewriteReply({ ...base, corrections: [{ ...correction, category: "made_up" }] }, "je pense que je pouvais")!.corrections[0]!.category).toBe("other");
    expect(parseStructuredRewriteReply({ contractVersion: 1, text: "x", used }, "y")).toBeNull();
  });

  it("r297 reply: an alternative's wider span is kept when exact and containing the change; droppedCorrections only when > 0", () => {
    const base = { contractVersion: 2, text: "x", suggestions: [], used };
    const text = "je pense que je pouvais";
    const alt = (span: unknown) => parseStructuredRewriteReply({ ...base, corrections: [{ ...correction, alternatives: [{ replacement: "je pensais que je pouvais", when: "当时", span }] }] }, text)!.corrections[0]!.alternatives;
    expect(alt({ start: 0, end: 23, original: "je pense que je pouvais" })).toEqual([{ replacement: "je pensais que je pouvais", when: "当时", span: { start: 0, end: 23, original: "je pense que je pouvais" } }]);
    expect(alt({ start: 16, end: 23, original: "pouvais" })).toEqual([{ replacement: "je pensais que je pouvais", when: "当时" }]); // = the change's own span
    expect(alt({ start: 0, end: 23, original: "je pensE que je pouvais" })).toEqual([]); // not the text there
    expect(alt({ start: 0, end: 8, original: "je pense" })).toEqual([]); // does not contain the change
    expect(alt({ start: 0, end: 99, original: text })).toEqual([]);
    expect(alt({ start: "0", end: 23, original: text })).toEqual([]);
    expect(alt(null)).toEqual([{ replacement: "je pensais que je pouvais", when: "当时" }]);
    expect(parseStructuredRewriteReply({ ...base, corrections: [correction], droppedCorrections: 2 }, text)!.droppedCorrections).toBe(2);
    expect(parseStructuredRewriteReply({ ...base, corrections: [correction], droppedCorrections: 0 }, text)).not.toHaveProperty("droppedCorrections");
    expect(parseStructuredRewriteReply({ ...base, corrections: [correction], droppedCorrections: -1 }, text)).not.toHaveProperty("droppedCorrections");
    expect(parseStructuredRewriteReply({ ...base, corrections: [correction] }, text)).not.toHaveProperty("droppedCorrections");
  });

  it("r297 template refusals: the code survives the IPC hop; the preview mock refuses with the same codes", async () => {
    expect(rewriteTemplateErrorOf(new Error("Error invoking remote method 'cutex-desktop:invoke': CutexApiError: rewrite_template_capacity: too many templates"))).toBe("rewrite_template_capacity");
    expect(rewriteTemplateErrorOf(new Error("rewrite_template_prompt_too_long: prompt too long"))).toBe("rewrite_template_prompt_too_long");
    expect(rewriteTemplateErrorOf("rewrite_template_name_too_long: x")).toBe("rewrite_template_name_too_long");
    expect(rewriteTemplateErrorOf(new Error("rewrite_template_capacityx: x"))).toBeNull();
    expect(rewriteTemplateErrorOf(new Error("invalid_rewrite_route: x"))).toBeNull();
    const { mock } = await import("../src/renderer/src/modules/input-refinement/mock");
    const api = mock.remote!("mock-r297", () => {}) as unknown as { createTextRewriteTemplate(x: unknown): Promise<unknown>; patchTextRewriteTemplate(id: string, x: unknown): Promise<unknown> };
    vi.useFakeTimers();
    try {
      const settle = async (p: Promise<unknown>) => { const r = p.then(() => null, (e: Error) => e.message); await vi.advanceTimersByTimeAsync(400); return r; };
      const draft = (over: object = {}) => ({ kind: "enhance", name: "t", prompt: "p", route: { mode: "agent", model: null, fallback: [] }, ...over });
      expect(await settle(api.createTextRewriteTemplate(draft({ name: "名".repeat(65) })))).toMatch(/rewrite_template_name_too_long/);
      expect(await settle(api.createTextRewriteTemplate(draft({ prompt: "字".repeat(5462) })))).toMatch(/rewrite_template_prompt_too_long/); // 16,386 bytes
      expect(await settle(api.createTextRewriteTemplate(draft({ prompt: "字".repeat(5461) })))).toBeNull(); // 16,383 bytes
      expect(await settle(api.patchTextRewriteTemplate("tpl-0b1c2d3e", { prompt: "x".repeat(16 * 1024 + 1) }))).toMatch(/rewrite_template_prompt_too_long/);
      for (let i = 2; i < 32; i++) expect(await settle(api.createTextRewriteTemplate(draft({ name: `t${i}` })))).toBeNull();
      expect(await settle(api.createTextRewriteTemplate(draft({ name: "one more" })))).toMatch(/rewrite_template_capacity/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("templates: list (built-ins first, malformed dropped), create / patch bodies rebuilt, built-in restore is route null", () => {
    const list = parseRewriteTemplateList({ contractVersion: 2, templates: [TEMPLATES[2], TEMPLATES[1], { id: "bad" }, TEMPLATES[0]] });
    expect(list.map((t) => t.id)).toEqual(["prompt-enhance-v1", "grammar-learning-v1", "tpl-mail"]);
    expect(rewriteTemplateCreateBody({ kind: "correction", name: "法语", prompt: "fix", route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-haiku", model: "" }] }, id: "x" }))
      .toEqual({ kind: "correction", name: "法语", prompt: "fix", route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-haiku" }] } });
    expect(() => rewriteTemplateCreateBody({ kind: "other", name: "x", prompt: "p", route: { mode: "agent", model: null, fallback: [] } })).toThrow();
    expect(() => rewriteTemplateCreateBody({ kind: "enhance", name: "x", prompt: "p", route: { mode: "profiles", candidates: [] } })).toThrow();
    expect(() => rewriteTemplateCreateBody({ kind: "enhance", name: "x", prompt: "p", route: { mode: "profiles", candidates: [{ kind: "profile", profileId: "a" }, { kind: "profile", profileId: "a" }] } })).toThrow();
    expect(rewriteTemplatePatchBody({ route: null })).toEqual({ route: null });
    expect(rewriteTemplatePatchBody({ name: "n", kind: "correction" })).toEqual({ name: "n" });
    expect(() => rewriteTemplatePatchBody({})).toThrow();
  });

  it("textRewrite / structuredTextRewrite are bound to event.sender, never to a renderer-supplied owner", () => {
    expect(src("src/main/index.ts")).toContain('const callArgs = method === "textRewrite" || method === "structuredTextRewrite" ? [args?.[0], event.sender] : args;');
  });
});

// ── keys, target, route ──────────────────────────────────────────────────────────────────────────

const ck = (over: Partial<{ key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }>) => ({ key: "", ctrl: false, meta: false, alt: false, shift: false, ...over });

describe("shortcut and keys", () => {
  afterEach(() => { resetKeybindingsForTests(); setKeybindingPlatform(null); });

  it("defaults to Ctrl+Shift+E (⌘⇧E on macOS), clashing with nothing; the picker has no default key", () => {
    setKeybindingPlatform("other");
    expect(bindingsOf("promptEnhance")).toEqual(["Mod+Shift+KeyE"]);
    expect(bindingsOf("inputRefinementPick")).toEqual([]);
    expect(bindingConflicts("promptEnhance", "Mod+Shift+KeyE")).toEqual([]);
    expect(currentConflicts().filter((c) => c.a === "promptEnhance" || c.b === "promptEnhance")).toEqual([]);
    expect(bindingConflicts("promptEnhance", "Mod+Enter").map((r) => r.kind)).toContain("composer");
    setKeybindingPlatform("mac");
    expect(bindingConflicts("promptEnhance", "Mod+Shift+KeyE")).toEqual([]);
  });

  it("an open panel: adopt / cancel / hold every send, steer, queue and interrupt-and-send key; Shift+Enter and Shift+Tab stay", () => {
    for (const phase of ["running", "done", "failed"] as const) {
      expect(panelKey(ck({ key: "Enter", ctrl: true }), phase, true)).toBe("hold");
      expect(panelKey(ck({ key: "Enter", meta: true }), phase, true)).toBe("hold");
      expect(panelKey(ck({ key: "Enter", ctrl: true, shift: true }), phase, true)).toBe("hold");
      expect(panelKey(ck({ key: "Enter", alt: true }), phase, true)).toBe("hold");
      expect(panelKey(ck({ key: "Tab" }), phase, true)).toBe("hold");
      expect(panelKey(ck({ key: "Enter", shift: true }), phase, true)).toBeNull();
      expect(panelKey(ck({ key: "Tab", shift: true }), phase, true)).toBeNull();
      expect(panelKey(ck({ key: "Escape" }), phase, true)).toBe("cancel");
    }
    expect(panelKey(ck({ key: "Enter" }), "running", false)).toBe("hold");
    expect(panelKey(ck({ key: "Enter" }), "done", true)).toBe("adopt");
    expect(panelKey(ck({ key: "Escape" }), "idle", false)).toBeNull(); // the composer's own Esc (interrupt)
    expect(panelKey(ck({ key: "Enter", ctrl: true }), "idle", false)).toBeNull();
  });

  it("rewrites the selection when it holds text, else the whole draft", () => {
    expect(enhanceTarget("abc def ghi", 4, 7)).toEqual({ start: 4, end: 7, text: "def", whole: false });
    expect(enhanceTarget("abc def ghi", 7, 4)).toEqual({ start: 4, end: 7, text: "def", whole: false });
    expect(enhanceTarget("abc def ghi", 3, 3)).toEqual({ start: 0, end: 11, text: "abc def ghi", whole: true });
    expect(enhanceTarget("abc   ghi", 3, 6)).toBe("blankSelection"); // never widened to the draft
    expect(enhanceTarget("abc def ghi", 0, 11)).toEqual({ start: 0, end: 11, text: "abc def ghi", whole: false }); // select-all stays a selection
    expect(enhanceTarget("  \n ", 0, 0)).toBeNull();
  });

  it("adopts only where the draft is unchanged", () => {
    const t: EnhanceTarget = { start: 4, end: 7, text: "def", whole: false };
    expect(adoptRewrite("abc def ghi", t, "DEF!")).toEqual({ text: "abc DEF! ghi", caret: 8 });
    expect(adoptRewrite("abc xyz ghi", t, "DEF!")).toBeNull();
    expect(adoptRewrite("abc def ghi more", { start: 0, end: 11, text: "abc def ghi", whole: true }, "X")).toBeNull();
  });

  it("直接加上 appends the checked items (with the owner's words); corrections apply with the owner's picks", () => {
    expect(appendSuggestions("Fix it.\n", [{ text: "页面" }, { text: "报错", answer: " null " }], "补充：")).toBe("Fix it.\n\n补充：\n- 页面\n- 报错：null");
    const cs = [
      { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood" as const, explanation: "", language: "fr", alternatives: [{ replacement: "pouvais", when: "过去" }] },
      { start: 24, end: 28, original: "vite", replacement: "rapidement", category: "wordChoice" as const, explanation: "", language: "fr", alternatives: [] },
    ];
    expect(applyCorrections("je pense que je pouvais vite", cs, {})).toBe("je pense que je pourrais rapidement");
    expect(applyCorrections("je pense que je pouvais vite", cs, { 0: 0 })).toBe("je pense que je pouvais rapidement");
  });

  it("r297 wider alternative: picking it replaces its whole span and leaves out the changes inside; picks never overlap", () => {
    const text = "je pense que je pouvais vite";
    const wide = { replacement: "je pensais que je pouvais", when: "当时的想法", span: { start: 0, end: 23, original: "je pense que je pouvais" } };
    const cs = [
      { start: 3, end: 8, original: "pense", replacement: "crois", category: "wordChoice" as const, explanation: "", language: "fr", alternatives: [{ replacement: "pensais", when: "过去" }] },
      { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood" as const, explanation: "", language: "fr", alternatives: [{ replacement: "pouvais", when: "过去" }, wide] },
      { start: 24, end: 28, original: "vite", replacement: "rapidement", category: "wordChoice" as const, explanation: "", language: "fr", alternatives: [] },
    ];
    expect(applyCorrections(text, cs, {})).toBe("je crois que je pourrais rapidement");
    const picked = correctionEdits(cs, { 1: 1 });
    expect(picked.covered).toEqual({ 0: 1 });
    expect(picked.edits.map((e) => [e.index, e.start, e.end, e.replacement, e.wide])).toEqual([[1, 0, 23, "je pensais que je pouvais", true], [2, 24, 28, "rapidement", false]]);
    expect(applyCorrections(text, cs, { 1: 1 })).toBe("je pensais que je pouvais rapidement");
    // The covered change's own pick is kept but has no effect while the wider pick stands; back to as suggested restores it.
    expect(applyCorrections(text, cs, { 0: 0, 1: 1 })).toBe("je pensais que je pouvais rapidement");
    expect(applyCorrections(text, cs, chooseCorrection(cs, { 0: 0, 1: 1 }, 1, null))).toBe("je pensais que je pourrais rapidement");
    // Two wider picks that overlap: choosing one drops the other (an exact-span alternative is not wide after parsing,
    // but the rule holds for any span); the earlier change wins if both were somehow set.
    const two = [{ ...cs[0]!, alternatives: [{ replacement: "Je pensais", when: "x", span: { start: 0, end: 8, original: "je pense" } }] }, cs[1]!];
    expect(chooseCorrection(two, { 0: 0 }, 1, 1)).toEqual({ 1: 1 });
    expect(chooseCorrection(two, { 1: 1 }, 0, 0)).toEqual({ 0: 0 });
    expect(correctionEdits(two, { 0: 0, 1: 1 }).edits.map((e) => e.index)).toEqual([0, 1]);
    expect(applyCorrections(text, two, { 0: 0, 1: 1 })).toBe("Je pensais que je pourrais vite");
  });

  it("routes (feature-profiles): the agent's own Profile then backup 功能 Profiles, or a 功能 Profile list; never ordinary IDs", () => {
    const r = (x: Partial<Parameters<typeof rewriteRoute>[0]>) => ({ mode: "agent" as const, fallback: ["p-ds"], profiles: ["p-gpt"], featureFallback: [], featureProfiles: [], ...x });
    expect(rewriteRoute(r({}), "cutex.s1", true)).toEqual({ mode: "agent", sessionId: "cutex.s1" });
    expect(rewriteRoute(r({ featureFallback: ["fp-small", "fp-haiku"] }), "cutex.s1", true)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackFeatureProfileIds: ["fp-small", "fp-haiku"] });
    expect(rewriteRoute(r({ mode: "profile", featureProfiles: ["fp-haiku", "fp-small"] }), "cutex.s1", true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-haiku", "fp-small"] });
    expect(rewriteRoute(r({ mode: "profile" }), "cutex.s1", true)).toBeNull();
    expect(rewriteRoute(r({ featureFallback: ["fp-small"] }), null, true)).toEqual({ mode: "featureProfiles", featureProfileIds: ["fp-small"] });
    expect(rewriteRoute(r({}), null, true)).toBeNull();
  });

  it("routes (no feature-profiles): ordinary backups or the fixed list exactly as before; 功能 Profiles never sent", () => {
    const r = (x: Partial<Parameters<typeof rewriteRoute>[0]>) => ({ mode: "agent" as const, fallback: [], profiles: [], featureFallback: ["fp-small"], featureProfiles: ["fp-haiku"], ...x });
    expect(rewriteRoute(r({ profiles: ["p-gpt"] }), "cutex.s1", false)).toEqual({ mode: "agent", sessionId: "cutex.s1" });
    expect(rewriteRoute(r({ fallback: ["p-ds", "p-claude"] }), "cutex.s1", false)).toEqual({ mode: "agent", sessionId: "cutex.s1", fallbackProfileIds: ["p-ds", "p-claude"] });
    expect(rewriteRoute(r({ mode: "profile", fallback: ["p-ds"], profiles: ["p-claude", "p-gpt"] }), "cutex.s1", false)).toEqual({ mode: "profile", profileIds: ["p-claude", "p-gpt"] });
    expect(rewriteRoute(r({ mode: "profile" }), "cutex.s1", false)).toBeNull();
    expect(rewriteRoute(r({ fallback: ["p-ds"] }), null, false)).toEqual({ mode: "profile", profileIds: ["p-ds"] });
    expect(rewriteRoute(r({}), null, false)).toBeNull();
  });

  it("stored prefs (same storage key as 提示词增强): per host, malformed parts dropped, at most four Profiles, last template per host", () => {
    expect(parsePromptEnhancePrefs(null)).toEqual({ enabled: true, hosts: {}, lastTemplate: {}, migrated: {} });
    const p = parsePromptEnhancePrefs({ v: 1, enabled: false, hosts: { local: { mode: "profile", profiles: ["a", "a", "b", 3, "c", "d", "e"], fallback: "x" }, samplehostb: { mode: "?" } } });
    expect(p).toEqual({ enabled: false, hosts: { local: { mode: "profile", profiles: ["a", "b", "c", "d"], fallback: [], featureFallback: [], featureProfiles: [] }, samplehostb: { mode: "agent", fallback: [], profiles: [], featureFallback: [], featureProfiles: [] } }, lastTemplate: {}, migrated: {} });
    const q = parsePromptEnhancePrefs({ v: 1, hosts: { local: { mode: "agent", featureFallback: ["fp-a", "fp-b", "fp-c", "fp-d"], featureProfiles: ["fp-a", "fp-a", "fp-b"] } }, lastTemplate: { local: "tpl-mail", bad: "x y" } });
    expect(q.hosts.local).toMatchObject({ featureFallback: ["fp-a", "fp-b", "fp-c"], featureProfiles: ["fp-a", "fp-b"] });
    expect(q.lastTemplate).toEqual({ local: "tpl-mail" });
    expect(src("src/renderer/src/modules/input-refinement/rewrite.ts")).toContain('const STORAGE_KEY = "cutex.promptEnhance";');
  });

  it("marks the changed words", () => {
    const parts = diffTexts("fix the login page", "fix the sign-in page now")!;
    expect(parts.filter((x) => x.kind === "removed").map((x) => x.text).join("")).toBe("login");
    expect(parts.filter((x) => x.kind === "added").map((x) => x.text).join("")).toContain("sign-in");
    expect(diffTexts("登录页面坏了", "登录页面打不开")!.some((x) => x.kind === "removed" && x.text === "坏了")).toBe(true);
  });
});

// ── the input box (composer.action host + this module's action) ──────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  resetPromptEnhancePrefsForTests();
  resetTemplatesForTests();
  setKeybindingPlatform("other");
  composerHost.features = new Set(["text-rewrite-v1", "feature-profiles"]);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  setKeybindingPlatform(null);
});

interface Call<R, Q> { resolve(r: R): void; request: Q }
function fakeApi() {
  const calls: Call<TextRewriteResult, TextRewriteRequest>[] = [];
  const structured: Call<StructuredRewriteResult, StructuredRewriteRequest>[] = [];
  const raw = {
    textRewrite: vi.fn((request: TextRewriteRequest) => new Promise<TextRewriteResult>((resolve) => calls.push({ resolve, request }))),
    structuredTextRewrite: vi.fn((request: StructuredRewriteRequest) => new Promise<StructuredRewriteResult>((resolve) => structured.push({ resolve, request }))),
    cancelTextRewrite: vi.fn(),
  };
  composerHost.api = raw as unknown as DaemonApi;
  return { calls, structured, raw };
}

/** The input box in small: a textarea, the panel place above it and the footer row, keys through the host's two passes. */
function Box({ initial, sessionId = "cutex.s1", sends }: { initial: string; sessionId?: string; sends?: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const [buttons, setButtons] = useState<HTMLElement | null>(null);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const el = () => host.querySelector<HTMLTextAreaElement>("[data-testid=input]");
  const actions = useComposerActions(sessionId, "local", {
    read: () => ({ text: el()?.value ?? text, selectionStart: el()?.selectionStart ?? 0, selectionEnd: el()?.selectionEnd ?? 0 }),
    replace: (start, end, insert, expected) => {
      const cur = el()?.value ?? text;
      if (cur.slice(start, end) !== expected) return false;
      setText(cur.slice(0, start) + insert + cur.slice(end));
      return true;
    },
    focus: () => el()?.focus(),
  });
  return h("div", null,
    h("div", { ref: setPanelEl }),
    h(ComposerActions, { host: actions, sessionId, hostId: "local", button: buttons, panel: panelEl }),
    h("textarea", {
      value: text, "data-testid": "input", "data-open": String(actions.open),
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (actions.commandKey(e)) return;
        if (actions.openKey(e)) return;
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sends?.(text); }
      },
    }),
    h("span", { ref: setButtons, "data-testid": "footer" }),
  );
}

const input = () => host.querySelector<HTMLTextAreaElement>("[data-testid=input]")!;
const panel = () => host.querySelector<HTMLElement>("[data-testid=prompt-enhance-panel]");
const press = (el: HTMLElement, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const shortcut = (over: KeyboardEventInit = {}) => press(input(), { key: "E", code: "KeyE", ctrlKey: true, shiftKey: true, ...over });
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("v1 host (text-rewrite-v1 only): 提示词增强 in the input box", () => {
  it("the wand button sits in the footer; the shortcut sends the selection, or the whole draft with none, via the agent route", async () => {
    const { calls } = fakeApi();
    act(() => root!.render(h(Box, { initial: "please fix the login page" })));
    expect(host.querySelector("[data-testid=footer] [data-testid=prompt-enhance-button]")).not.toBeNull();
    input().setSelectionRange(11, 16);
    await shortcut();
    expect(calls[0]!.request).toMatchObject({ text: "the l", route: { mode: "agent", sessionId: "cutex.s1" } });
    expect(panel()?.dataset.phase).toBe("running");
    expect(input().dataset.open).toBe("true");
    await press(input(), { key: "Escape" });
    expect(input().dataset.open).toBe("false");
    input().setSelectionRange(3, 3);
    await shortcut();
    expect(calls[1]!.request.text).toBe("please fix the login page");
  });

  it("IME composition never starts it; without either capability there is no button and the key is the box's own", async () => {
    const { calls } = fakeApi();
    act(() => root!.render(h(Box, { initial: "draft" })));
    await shortcut({ isComposing: true } as KeyboardEventInit);
    expect(calls).toHaveLength(0);
    composerHost.features = new Set();
    act(() => root!.render(h(Box, { initial: "draft", sessionId: "cutex.s9" })));
    expect(host.querySelector("[data-testid=prompt-enhance-button]")).toBeNull();
    await shortcut();
    expect(calls).toHaveLength(0);
  });

  it("Esc cancels the request in flight (by its id) and a late answer is dropped", async () => {
    const { calls, raw } = fakeApi();
    act(() => root!.render(h(Box, { initial: "draft" })));
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

  it("Enter while the answer is coming neither sends nor adopts; then both sides, checkable details and the Profile used; Enter adopts", async () => {
    const { calls } = fakeApi();
    const sends = vi.fn();
    act(() => root!.render(h(Box, { initial: "fix login", sends })));
    await shortcut();
    await press(input(), { key: "Enter" });
    await press(input(), { key: "Enter", ctrlKey: true });
    expect(sends).not.toHaveBeenCalled();
    expect(input().value).toBe("fix login");
    calls[0]!.resolve({ ok: true, rewrittenText: OK.rewrittenText, missingDetails: OK.missingDetails, used: OK.used });
    await flush();
    expect(panel()?.dataset.phase).toBe("done");
    expect(host.querySelector("[data-prompt-enhance-side=removed]")?.textContent).toBe("fix login");
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe(OK.rewrittenText);
    expect(host.querySelector("[data-testid=prompt-enhance-missing] input[type=checkbox]")).not.toBeNull();
    // v1: no 重新整理 (no follow-up round on an older cutex).
    expect(host.querySelector("[data-testid=input-refinement-regroup]")).toBeNull();
    const used = host.querySelector("[data-testid=prompt-enhance-used]")!.textContent!;
    expect(used).toContain("Claude 订阅");
    expect(used).toContain("claude-sonnet-5-5");
    expect(used).toContain("input-refinement.fallbackUsed");
    await press(input(), { key: "Enter" });
    expect(input().value).toBe(OK.rewrittenText);
    expect(panel()).toBeNull();
    expect(sends).not.toHaveBeenCalled();
  });

  it("直接加上: the checked items (a needs-your-words one with its input) make 第 2 版 without a model call; ‹ › switches; 采用 uses the shown one", async () => {
    const { calls, raw } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await shortcut();
    calls[0]!.resolve({ ok: true, rewrittenText: "Fix the login page.", missingDetails: ["Which browser?", "Which page?"], used: OK.used });
    await flush();
    const boxes = [...host.querySelectorAll<HTMLInputElement>("[data-testid=prompt-enhance-missing] input[type=checkbox]")];
    click(boxes[0]);
    const answer = host.querySelector<HTMLInputElement>("[data-suggestion-id=m1] input[type=text]")!;
    setValue(answer, "Firefox");
    click(host.querySelector("[data-testid=input-refinement-append]"));
    expect(raw.textRewrite).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe("Fix the login page.\n\ninput-refinement.appendLabel\n- Which browser?：Firefox");
    expect(host.querySelector("[data-testid=input-refinement-versions]")?.textContent).toContain('{"n":2,"total":2}');
    expect(host.querySelector("[data-testid=prompt-enhance-used]")?.textContent).toBe("input-refinement.usedNone");
    // Back to 第 1 版 and adopt that one.
    click(host.querySelector('[data-testid=input-refinement-versions] button[aria-label="input-refinement.versionPrev"]'));
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe("Fix the login page.");
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("Fix the login page.");
  });

  it("never overwrites a draft that changed meanwhile", async () => {
    const { calls } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await shortcut();
    calls[0]!.resolve({ ok: true, rewrittenText: "Fix the login page.", missingDetails: [], used: { ...OK.used, fallbackUsed: false } });
    await flush();
    setValue(input(), "fix login now");
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("fix login now");
    expect(panel()?.textContent).toContain("input-refinement.draftChanged");
  });

  it("all Profiles failing: each one's reason", async () => {
    const { calls } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await shortcut();
    calls[0]!.resolve({ ok: false, code: "rewrite_failed", attempts: [{ profileId: "p-gpt", category: "quota_exhausted" }, { profileId: "p-claude", category: "quota_exhausted" }] });
    await flush();
    expect(panel()?.dataset.phase).toBe("failed");
    const rows = [...host.querySelectorAll("[data-testid=prompt-enhance-attempts] li")].map((li) => li.textContent);
    expect(rows).toEqual([
      'input-refinement.attempt {"profile":"GPT 主号","reason":"input-refinement.attempt.quota_exhausted"}',
      'input-refinement.attempt {"profile":"Claude 订阅","reason":"input-refinement.attempt.quota_exhausted"}',
    ]);
  });

  it("profile mode with no Profile chosen asks for one instead of calling cutex", async () => {
    setHostRoute("local", { mode: "profile", featureProfiles: [] });
    const { raw } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await shortcut();
    expect(raw.textRewrite).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain("input-refinement.error.noRoute");
  });

  it("switching agent drops the request (cancelled in cutex)", async () => {
    const { calls, raw } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await shortcut();
    act(() => root!.render(h(Box, { initial: "fix login", sessionId: "cutex.s2" })));
    expect(raw.cancelTextRewrite).toHaveBeenCalledWith(calls[0]!.request.requestId);
    expect(panel()).toBeNull();
  });
});

describe("v2 host (text-rewrite-v2): templates, 重新整理, 纠错学习", () => {
  beforeEach(() => { composerHost.features = new Set(["text-rewrite-v1", "text-rewrite-v2", "feature-profiles"]); });
  const used = { profileId: "fp-haiku", provider: "anthropic", model: "claude-haiku-5-5", requestedModel: "claude-haiku-5-5", fallbackUsed: false };

  it("the shortcut uses the last template (first by default) with the session and UI language", async () => {
    const { structured, raw } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await flush();
    await shortcut();
    expect(raw.textRewrite).not.toHaveBeenCalled();
    expect(structured[0]!.request).toMatchObject({ templateId: "prompt-enhance-v1", sessionId: "cutex.s1", uiLanguage: "zh-CN", text: "fix login" });
    expect(structured[0]!.request.followUp).toBeUndefined();
    await press(input(), { key: "Escape" });
    act(() => setLastTemplate("local", "tpl-mail"));
    await shortcut();
    expect(structured[1]!.request.templateId).toBe("tpl-mail");
  });

  it("the wand: no ▾; click runs the current template; right-click opens the templates (current checked) and the settings; the tip says so", async () => {
    const { structured } = fakeApi();
    let edit: unknown = null;
    const Probe = () => { edit = useTemplateEdit(); return null; };
    act(() => root!.render(h("div", null, h(Box, { initial: "fix login" }), h(Probe))));
    await flush();
    const wand = () => host.querySelector<HTMLButtonElement>("[data-testid=prompt-enhance-button]")!;
    const menu = () => document.querySelector<HTMLElement>("[data-testid=input-refinement-menu]");
    expect(host.querySelectorAll("[data-input-refinement] button")).toHaveLength(1);
    expect(wand().getAttribute("data-tip")).toContain("input-refinement.rightClickHint");
    expect(wand().getAttribute("data-tip")).toContain("input-refinement.buttonHint");
    // Click: runs, no menu.
    click(wand());
    await flush();
    expect(structured).toHaveLength(1);
    expect(menu()).toBeNull();
    await press(input(), { key: "Escape" });
    // Right-click (also Shift+F10 / the menu key): the menu, nothing runs.
    act(() => { wand().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await flush();
    expect(structured).toHaveLength(1);
    const rows = [...menu()!.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
    expect(rows.map((r) => r.dataset.templateId)).toEqual(["prompt-enhance-v1", "grammar-learning-v1", "tpl-mail"]);
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(menu()!.querySelector("[role=separator]")).not.toBeNull();
    // Picking one makes it current and runs it.
    click(rows[2]!);
    await flush();
    expect(menu()).toBeNull();
    expect(structured[1]!.request.templateId).toBe("tpl-mail");
    expect(promptEnhancePrefs().lastTemplate.local).toBe("tpl-mail");
    await press(input(), { key: "Escape" });
    // 「“…”用哪个模型…」: the current template's own sub-page.
    act(() => { wand().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await flush();
    expect(menu()!.querySelector("[data-testid=input-refinement-menu-template]")!.textContent).toContain("input-refinement.menuTemplateModel");
    click(menu()!.querySelector("[data-testid=input-refinement-menu-template]"));
    await flush();
    expect(edit).toEqual({ hostId: "local", id: "tpl-mail" });
    expect(opened.at(-1)).toEqual(["input-refinement-detail", { sub: "template" }]);
    // 「输入优化设置…」: the detail page.
    act(() => { wand().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await flush();
    click(menu()!.querySelector("[data-testid=input-refinement-menu-settings]"));
    await flush();
    expect(opened.at(-1)).toEqual(["input-refinement-detail"]);
    expect(structured).toHaveLength(2);
  });

  it("the pick shortcut opens the same menu at the wand; with the button hidden it runs the last template", async () => {
    setBindings("inputRefinementPick", ["Mod+Shift+KeyY"]);
    try {
      const { structured } = fakeApi();
      act(() => root!.render(h(Box, { initial: "fix login" })));
      await flush();
      await press(input(), { key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true });
      await flush();
      expect(document.querySelector("[data-testid=input-refinement-menu]")).not.toBeNull();
      expect(structured).toHaveLength(0);
      await press(input(), { key: "Escape" });
      act(() => setPromptEnhanceEnabled(false));
      await flush();
      await press(input(), { key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true });
      await flush();
      expect(structured).toHaveLength(1);
    } finally {
      resetKeybindingsForTests();
      act(() => setPromptEnhanceEnabled(true));
    }
  });

  it("重新整理 sends the shown version and the checked suggestions (with the owner's words); its answer is 第 2 版; Esc keeps the versions", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    await shortcut();
    structured[0]!.resolve({ ok: true, text: "Find and fix the bug.", suggestions: [{ id: "s1", text: "页面", needsInput: false }, { id: "s2", text: "报错", needsInput: true }], corrections: [], used });
    await flush();
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-suggestion-id=s2] input[type=checkbox]"));
    setValue(host.querySelector<HTMLInputElement>("[data-suggestion-id=s2] input[type=text]")!, "null error");
    const regroup = host.querySelector<HTMLButtonElement>("[data-testid=input-refinement-regroup]")!;
    expect(regroup.disabled).toBe(false);
    click(regroup);
    await flush();
    expect(structured[1]!.request).toMatchObject({
      templateId: "prompt-enhance-v1", text: "fix the bug",
      followUp: { previous: { text: "Find and fix the bug.", suggestions: [{ id: "s1", text: "页面", needsInput: false }, { id: "s2", text: "报错", needsInput: true }] }, answers: [{ id: "s1" }, { id: "s2", text: "null error" }] },
    });
    // While it runs the first version stays; Esc cancels only this request.
    expect(panel()?.dataset.phase).toBe("running");
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe("Find and fix the bug.");
    await press(input(), { key: "Escape" });
    expect(panel()?.dataset.phase).toBe("done");
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    structured[2]!.resolve({ ok: true, text: "Find and fix the null error on the page.", suggestions: [], corrections: [], used });
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-versions]")?.textContent).toContain('{"n":2,"total":2}');
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("Find and fix the null error on the page.");
  });

  it("r297 protection: each 重新整理 sends back the protection of the version it builds on (‹ › included); never shown; a changed draft starts over, never a follow-up without it", async () => {
    const { structured } = fakeApi();
    const P = (n: number) => ({ literals: [`secret-literal-${n}`], retained: [0] });
    const sugg = (n: number) => [{ id: `s${n}`, text: `补充 ${n}`, needsInput: false }];
    const regroupWith = async (id: string) => {
      click(host.querySelector(`[data-suggestion-id=${id}] input[type=checkbox]`));
      click(host.querySelector("[data-testid=input-refinement-regroup]"));
      await flush();
    };
    const total = () => host.querySelector("[data-testid=input-refinement-versions]")?.textContent ?? "";
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    await shortcut();
    expect(structured[0]!.request).not.toHaveProperty("protection");
    structured[0]!.resolve({ ok: true, text: "Fix the bug.", suggestions: sugg(1), corrections: [], used, protection: P(1) });
    await flush();
    await regroupWith("s1");
    expect(structured[1]!.request.protection).toEqual(P(1));
    structured[1]!.resolve({ ok: true, text: "Fix the bug on the page.", suggestions: sugg(2), corrections: [], used, protection: P(2) });
    await flush();
    expect(panel()?.textContent).not.toContain("secret-literal");
    // Version 2 refined: its own protection.
    await regroupWith("s2");
    expect(structured[2]!.request.protection).toEqual(P(2));
    structured[2]!.resolve({ ok: true, text: "Fix the null bug on the page.", suggestions: [], corrections: [], used, protection: P(3) });
    await flush();
    // ‹ back to version 1 and refine it: version 1's protection, not the latest.
    click(host.querySelector('[aria-label="input-refinement.versionPrev"]'));
    click(host.querySelector('[aria-label="input-refinement.versionPrev"]'));
    await flush();
    expect(total()).toContain('{"n":1,"total":3}');
    await regroupWith("s1");
    expect(structured[3]!.request.protection).toEqual(P(1));
    expect(structured[3]!.request.followUp!.previous.text).toBe("Fix the bug.");
    structured[3]!.resolve({ ok: true, text: "Fix the bug (v4).", suggestions: [...sugg(4), { id: "s9", text: "补充 9", needsInput: false }], corrections: [], used, protection: P(4) });
    await flush();
    // 直接加上 keeps its source's protection; refining that version sends it.
    click(host.querySelector("[data-suggestion-id=s4] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-append]"));
    await flush();
    expect(total()).toContain('{"n":5,"total":5}');
    await regroupWith("s9");
    expect(structured[4]!.request.protection).toEqual(P(4));
    // It refines version 4 (the model's) with the appended item as an answer.
    expect(structured[4]!.request.followUp!.previous.text).toBe("Fix the bug (v4).");
    expect(structured[4]!.request.followUp!.answers).toEqual([{ id: "s4" }, { id: "s9" }]);
    structured[4]!.resolve({ ok: true, text: "Fix the bug (v6).", suggestions: sugg(6), corrections: [], used, protection: P(6) });
    await flush();
    // The draft changes outside the panel: 重新整理 becomes a fresh first round of the new draft — no follow-up, no
    // protection — and says so quietly; the earlier versions go.
    setValue(input(), "fix the bug now");
    await regroupWith("s6");
    const fresh = structured[5]!.request;
    expect(fresh.followUp).toBeUndefined();
    expect(fresh).not.toHaveProperty("protection");
    expect(fresh.text).toBe("fix the bug now");
    structured[5]!.resolve({ ok: true, text: "Fix the bug now.", suggestions: sugg(7), corrections: [], used, protection: P(7) });
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-restarted]")?.textContent).toBe("input-refinement.restarted");
    expect(host.querySelector("[data-testid=input-refinement-versions]")).toBeNull();
    // From there, follow-ups carry the new round's protection again, and the note is gone with the next version.
    await regroupWith("s7");
    expect(structured[6]!.request.protection).toEqual(P(7));
    structured[6]!.resolve({ ok: true, text: "Fix the bug now, on the page.", suggestions: [], corrections: [], used, protection: P(8) });
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-restarted]")).toBeNull();
    // Close, start over: a new rewrite never carries an old protection.
    await press(input(), { key: "Escape" });
    expect(panel()).toBeNull();
    await shortcut();
    expect(structured.at(-1)!.request).not.toHaveProperty("protection");
    expect(structured.at(-1)!.request.followUp).toBeUndefined();
  });

  it("r297 a selected part that changed: no model call, never the whole draft; a new selection starts again (重新整理 and 重试 alike)", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "please fix the login page" })));
    await flush();
    input().setSelectionRange(11, 25);
    await shortcut();
    expect(structured[0]!.request.text).toBe("the login page");
    structured[0]!.resolve({ ok: true, text: "the sign-in page", suggestions: [{ id: "s1", text: "哪个按钮", needsInput: false }], corrections: [], used, protection: { literals: ["p1"] } });
    await flush();
    setValue(input(), "please fix the signup page");
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    expect(structured).toHaveLength(1);
    expect(panel()?.dataset.phase).toBe("failed");
    expect(panel()?.textContent).toContain("input-refinement.error.selectionMoved");
    // 重试 / adopt can't widen it either: adopting is refused (the draft changed), and 重试 asks for a selection.
    await press(input(), { key: "Enter" });
    expect(structured).toHaveLength(1);
    expect(input().value).toBe("please fix the signup page");
    // A new selection: the shortcut starts on it.
    input().setSelectionRange(11, 26);
    await shortcut();
    expect(structured).toHaveLength(2);
    expect(structured[1]!.request.text).toBe("the signup page");
    expect(structured[1]!.request.followUp).toBeUndefined();
  });

  it("r297 直接加上 then 重新整理: the appended items go as answers (the owner's words included) on the version they came from", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    await shortcut();
    const suggestions = [{ id: "s1", text: "报错链接", needsInput: true }, { id: "s2", text: "页面", needsInput: false }, { id: "s3", text: "环境", needsInput: true }];
    structured[0]!.resolve({ ok: true, text: "Fix the bug.", suggestions, corrections: [], used, protection: { literals: ["p1"] } });
    await flush();
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    setValue(host.querySelector<HTMLInputElement>("[data-suggestion-id=s1] input[type=text]")!, "https://ci.example/run/42");
    click(host.querySelector("[data-testid=input-refinement-append]"));
    await flush();
    // 第 2 版 shows the link appended locally; refining it sends the model version and the link as an owner answer.
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toContain("https://ci.example/run/42");
    click(host.querySelector("[data-suggestion-id=s2] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-append]"));
    await flush();
    click(host.querySelector("[data-suggestion-id=s3] input[type=checkbox]"));
    setValue(host.querySelector<HTMLInputElement>("[data-suggestion-id=s3] input[type=text]")!, "Samplehostb");
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    expect(structured[1]!.request.followUp).toEqual({
      previous: { text: "Fix the bug.", suggestions },
      answers: [{ id: "s1", text: "https://ci.example/run/42" }, { id: "s2" }, { id: "s3", text: "Samplehostb" }],
    });
    expect(structured[1]!.request.protection).toEqual({ literals: ["p1"] });
  });

  it("r297 an expired protection (400 rewrite_protection_invalid): a fresh first round, same target rules, a quiet note", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    await shortcut();
    structured[0]!.resolve({ ok: true, text: "Fix the bug.", suggestions: [{ id: "s1", text: "页面", needsInput: false }], corrections: [], used, protection: { literals: ["p1"] } });
    await flush();
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    expect(structured[1]!.request.protection).toEqual({ literals: ["p1"] });
    structured[1]!.resolve({ ok: false, code: "rewrite_protection_invalid", attempts: [] });
    await flush();
    expect(structured).toHaveLength(3);
    expect(structured[2]!.request.followUp).toBeUndefined();
    expect(structured[2]!.request).not.toHaveProperty("protection");
    expect(structured[2]!.request.text).toBe("fix the bug");
    structured[2]!.resolve({ ok: true, text: "Fix the bug again.", suggestions: [], corrections: [], used, protection: { literals: ["p2"] } });
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-restarted]")?.getAttribute("data-notice")).toBe("protectionExpired");
    expect(panel()?.dataset.phase).toBe("done");
  });

  it("r297 an expired protection on a selection that changed meanwhile: no call, asks for a new selection", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "please fix the login page" })));
    await flush();
    input().setSelectionRange(11, 25);
    await shortcut();
    structured[0]!.resolve({ ok: true, text: "the sign-in page", suggestions: [{ id: "s1", text: "页面", needsInput: false }], corrections: [], used, protection: { literals: ["p1"] } });
    await flush();
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    setValue(input(), "please fix the signup page");
    structured[1]!.resolve({ ok: false, code: "rewrite_protection_invalid", attempts: [] });
    await flush();
    expect(structured).toHaveLength(2);
    expect(panel()?.textContent).toContain("input-refinement.error.selectionMoved");
  });

  it("r297 select-all is a selection: notes typed after it never reach a request (restart or 重新整理); adopting keeps them", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    input().setSelectionRange(0, 11);
    await shortcut();
    expect(structured[0]!.request.text).toBe("fix the bug");
    expect(panel()?.textContent).toContain("input-refinement.scope.selection");
    structured[0]!.resolve({ ok: true, text: "Fix the bug.", suggestions: [{ id: "s1", text: "页面", needsInput: false }], corrections: [], used, protection: { literals: ["p1"] } });
    await flush();
    setValue(input(), "fix the bug\nprivate: token abc");
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    expect(structured).toHaveLength(2);
    expect(JSON.stringify(structured[1]!.request)).not.toContain("private");
    expect(structured[1]!.request.protection).toEqual({ literals: ["p1"] });
    structured[1]!.resolve({ ok: false, code: "rewrite_protection_invalid", attempts: [] });
    await flush();
    // The expired-protection restart: the same selected part only.
    expect(structured).toHaveLength(3);
    expect(structured[2]!.request.text).toBe("fix the bug");
    expect(JSON.stringify(structured[2]!.request)).not.toContain("private");
    structured[2]!.resolve({ ok: true, text: "Fix the bug.", suggestions: [], corrections: [], used, protection: { literals: ["p2"] } });
    await flush();
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("Fix the bug.\nprivate: token abc");
  });

  it("r297 a whitespace-only selection: no request, a quiet hint, never the whole draft", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix   the bug" })));
    await flush();
    input().setSelectionRange(3, 6);
    await shortcut();
    expect(structured).toHaveLength(0);
    expect(panel()?.textContent).toContain("input-refinement.error.blankSelection");
    expect(panel()?.textContent).not.toContain("input-refinement.retry");
  });

  it("r297 protection on an older v2 host (replies never carry it): a changed draft still gets a follow-up, without the field", async () => {
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "fix the bug" })));
    await flush();
    await shortcut();
    structured[0]!.resolve({ ok: true, text: "Fix the bug.", suggestions: [{ id: "s1", text: "页面", needsInput: false }], corrections: [], used });
    await flush();
    setValue(input(), "fix the bug now");
    click(host.querySelector("[data-suggestion-id=s1] input[type=checkbox]"));
    click(host.querySelector("[data-testid=input-refinement-regroup]"));
    await flush();
    expect(structured[1]!.request.followUp!.previous.text).toBe("Fix the bug.");
    expect(structured[1]!.request).not.toHaveProperty("protection");
    expect(structured[1]!.request.text).toBe("fix the bug");
  });

  it("the preview mock issues protection and refuses a follow-up that does not bring back one it issued", async () => {
    const { mock } = await import("../src/renderer/src/modules/input-refinement/mock");
    const api = mock.remote!("mock-protection", () => {}) as unknown as { structuredTextRewrite(r: StructuredRewriteRequest): Promise<StructuredRewriteResult> };
    vi.useFakeTimers();
    try {
      const ask = async (r: Partial<StructuredRewriteRequest>) => { const p = api.structuredTextRewrite({ requestId: `req-${Math.random().toString(16).slice(2, 12)}`, templateId: "prompt-enhance-v1", uiLanguage: "zh-CN", text: "fix https://example.com/x", ...r }); await vi.advanceTimersByTimeAsync(1000); return p; };
      const first = await ask({});
      if (!first.ok) throw new Error("mock refused the first round");
      expect(first.protection).toBeTruthy();
      const followUp = { previous: { text: first.text, suggestions: first.suggestions }, answers: [{ id: first.suggestions[0]!.id }] };
      expect(await ask({ followUp, protection: first.protection })).toMatchObject({ ok: true });
      expect(await ask({ followUp })).toEqual({ ok: false, code: "invalid_rewrite_request", attempts: [] });
      expect(await ask({ followUp, protection: { literals: ["forged"] } })).toEqual({ ok: false, code: "invalid_rewrite_request", attempts: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("纠错学习: numbered changes with category and explanation; 取决于你的意思 changes what is adopted; 错题本 only a placeholder", async () => {
    const { structured } = fakeApi();
    act(() => setLastTemplate("local", "grammar-learning-v1"));
    act(() => root!.render(h(Box, { initial: "je pense que je pouvais apprendre vite" })));
    await flush();
    await shortcut();
    expect(structured[0]!.request.templateId).toBe("grammar-learning-v1");
    structured[0]!.resolve({
      ok: true, text: "je pense que je pourrais apprendre rapidement", suggestions: [], used,
      corrections: [
        { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood", explanation: "条件式", language: "fr", alternatives: [{ replacement: "pouvais", when: "过去的能力" }] },
        { start: 34, end: 38, original: "vite", replacement: "rapidement", category: "wordChoice", explanation: "书面语", language: "fr", alternatives: [] },
      ],
    });
    await flush();
    const items = [...host.querySelectorAll<HTMLElement>("[data-testid=input-refinement-corrections] li")];
    expect(items.map((li) => li.dataset.correctionCategory)).toEqual(["mood", "wordChoice"]);
    expect(items[0]!.textContent).toContain("input-refinement.category.mood");
    expect(items[0]!.textContent).toContain("条件式");
    expect(host.querySelectorAll("[data-testid=input-refinement-meaning]")).toHaveLength(1);
    expect(host.querySelector("[data-testid=input-refinement-mistake-book]")).not.toBeNull();
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe("je pense que je pourrais1 apprendre rapidement2");
    // The other meaning: keep pouvais.
    click(host.querySelectorAll<HTMLInputElement>("[data-testid=input-refinement-meaning] input[type=radio]")[1]);
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("je pense que je pouvais apprendre rapidement");
  });

  it("纠错学习 r297: a wider 取决于你的意思 replaces the whole clause, the change inside it shows as covered; dropped changes noted quietly", async () => {
    const { structured } = fakeApi();
    act(() => setLastTemplate("local", "grammar-learning-v1"));
    act(() => root!.render(h(Box, { initial: "je pense que je pouvais apprendre vite" })));
    await flush();
    await shortcut();
    structured[0]!.resolve({
      ok: true, text: "je crois que je pourrais apprendre rapidement", suggestions: [], used, droppedCorrections: 2,
      corrections: [
        { start: 3, end: 8, original: "pense", replacement: "crois", category: "wordChoice", explanation: "更确定", language: "fr", alternatives: [] },
        { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood", explanation: "条件式", language: "fr", alternatives: [
          { replacement: "pouvais", when: "过去的能力" },
          { replacement: "je pensais que je pouvais", when: "当时的想法", span: { start: 0, end: 23, original: "je pense que je pouvais" } },
        ] },
        { start: 34, end: 38, original: "vite", replacement: "rapidement", category: "wordChoice", explanation: "书面语", language: "fr", alternatives: [] },
      ],
    });
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-dropped]")?.textContent).toBe('input-refinement.dropped {"n":2}');
    const radios = () => host.querySelectorAll<HTMLInputElement>("[data-testid=input-refinement-meaning] input[type=radio]");
    expect(radios()[2]!.parentElement!.textContent).toContain("input-refinement.alternativeWide");
    click(radios()[2]);
    await flush();
    expect(host.querySelector("[data-prompt-enhance-side=added]")?.textContent).toBe("je pensais que je pouvais2 apprendre rapidement3");
    expect(host.querySelector("[data-prompt-enhance-side=removed]")?.textContent).toBe("je pense que je pouvais2 apprendre vite3");
    const items = [...host.querySelectorAll<HTMLElement>("[data-testid=input-refinement-corrections] li")];
    expect(items[0]!.dataset.coveredBy).toBe("2");
    expect(items[0]!.textContent).toContain('input-refinement.coveredBy {"n":2}');
    expect(items[1]!.textContent).toContain("je pense que je pouvais → je pensais que je pouvais");
    await press(input(), { key: "Enter" });
    expect(input().value).toBe("je pensais que je pouvais apprendre rapidement");
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

// ── the composer itself carries no rewrite code ──────────────────────────────────────────────────

describe("the input box only hosts composer.action", () => {
  it("Composer mounts the generic host and outlet, never the module", () => {
    const composer = src("src/renderer/src/components/Composer.tsx");
    expect(composer).toContain("useComposerActions(sessionId, hostId, {");
    expect(composer).toContain("<ComposerActions host={actions}");
    expect(composer).toContain("if (actions.commandKey(e)) return;");
    expect(composer).toContain("if (actions.openKey(e)) {");
    expect(composer).toContain("|| actions.open,");
    expect(composer).not.toMatch(/promptEnhance|PromptEnhance|textRewrite|TEXT_REWRITE|input-refinement/);
  });
});

// ── settings ─────────────────────────────────────────────────────────────────────────────────────

describe("settings: 会话 → 输入优化 (card) and its detail page", () => {
  it("the card: the button, the two keys and one row to the detail page with what the host offers", async () => {
    target.features = new Set(["text-rewrite-v1", "text-rewrite-v2", "feature-profiles"]);
    act(() => root!.render(h(InputRefinementCard)));
    await flush();
    expect(host.querySelector(`[id="settings-input-refinement.card"]`)).not.toBeNull();
    expect(host.textContent).toContain("input-refinement.settings.button");
    expect(host.textContent).toContain("input-refinement.settings.pickKey");
    const row = host.querySelector<HTMLButtonElement>("[data-settings-subpage]")!;
    expect(row.textContent).toContain('input-refinement.settings.templates {"n":3}');
    // The template the wand uses now, and its route, one level up from its sub-page.
    expect(row.textContent).toContain('input-refinement.settings.currentRoute {"template":"input-refinement.template.enhance","route":"input-refinement.settings.summary.agent"}');
    act(() => row.click());
    expect(opened.at(-1)).toEqual(["input-refinement-detail"]);
    // The button switch is this desktop's; it does not turn the module off.
    act(() => host.querySelector<HTMLButtonElement>("[role=switch]")!.click());
    expect(promptEnhancePrefs().enabled).toBe(false);
    // v1 host: the row reads which Profiles; no host support: says so, no row.
    target.features = new Set(["text-rewrite-v1"]);
    act(() => root!.render(h(InputRefinementCard)));
    await flush();
    expect(host.querySelector("[data-settings-subpage]")!.textContent).toContain("input-refinement.settings.route.title");
    target.features = new Set();
    act(() => root!.render(h(InputRefinementCard)));
    await flush();
    expect(host.querySelector("[data-settings-subpage]")).toBeNull();
    expect(host.textContent).toContain("input-refinement.error.unsupported");
  });

  it("v1 host with feature-profiles: follow the agent then backup 功能 Profiles, or a 功能 Profile list", async () => {
    target.features = new Set(["text-rewrite-v1", "feature-profiles"]);
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    expect(host.textContent).not.toContain("input-refinement.settings.button");
    expect(host.textContent).toContain("input-refinement.settings.route.agent");
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "input-refinement.settings.manageFeatureProfiles")!.click());
    expect(opened.at(-1)).toEqual(["profiles", { anchor: "feature-profiles.list" }]);
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
    act(() => host.querySelector<HTMLButtonElement>('[data-feature-profile-id="fp-small"] button[title="input-refinement.settings.moveUp"]')!.click());
    expect(hostRoute("local").featureFallback).toEqual(["fp-small", "fp-haiku"]);
  });

  it("v1 host without feature-profiles: the ordinary-Profile picker as before; 功能 Profile choices kept apart", async () => {
    setHostRoute("local", { mode: "agent", featureFallback: ["fp-small"], featureProfiles: ["fp-haiku"] });
    featureReads.n = 0;
    target.features = new Set(["text-rewrite-v1"]);
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    expect(featureReads.n).toBe(0);
    expect(host.textContent).toContain("input-refinement.settings.route.agentHint");
    const pickIn = (testId: string, id: string) => {
      act(() => host.querySelector<HTMLButtonElement>(`[data-testid=${testId}] [data-entity-select]`)!.click());
      act(() => document.querySelector<HTMLButtonElement>(`[role=option][data-value="${id}"]`)!.click());
    };
    pickIn("prompt-enhance-fallback", "p-ds");
    expect(hostRoute("local")).toMatchObject({ mode: "agent", fallback: ["p-ds"], featureFallback: ["fp-small"] });
  });

  it("v2 host: the host's templates, one row each; built-ins marked and copyable; no desktop routing", async () => {
    target.features = new Set(["text-rewrite-v1", "text-rewrite-v2", "feature-profiles"]);
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    const rows = [...host.querySelectorAll<HTMLElement>("[data-testid=input-refinement-templates] [data-template-id]")].map((x) => x.dataset.templateId);
    expect(rows).toEqual(["prompt-enhance-v1", "grammar-learning-v1", "tpl-mail"]);
    expect(host.textContent).toContain("input-refinement.template.enhance");
    expect(host.textContent).not.toContain("input-refinement.settings.route.agentHint");
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "input-refinement.settings.copy")).toHaveLength(2);
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "input-refinement.settings.copy")!.click());
    expect(opened.at(-1)).toEqual(["input-refinement-detail", { sub: "template" }]);
  });
});

// ── v1 → v2: this desktop's route moves into the host's built-in 提示词增强 once (Director 2026-11-26) ───────────

describe("one-time migration of the local v1 route to a v2 host", () => {
  const BUILT_IN = "prompt-enhance-v1";
  let patches: { hostId: string; id: string; patch: unknown }[];
  beforeEach(() => {
    resetPromptEnhancePrefsForTests();
    resetTemplatesForTests();
    v2Host.lists.clear();
    patches = [];
    v2Host.patch = (hostId, id, patch) => {
      patches.push({ hostId, id, patch });
      const t = (v2Host.lists.get(hostId) ?? TEMPLATES).find((x) => (x as { id: string }).id === id) as Record<string, unknown>;
      return Promise.resolve({ ...t, route: (patch as { route: unknown }).route });
    };
  });

  it("maps the v1 choices by the host's set (功能 Profiles with feature-profiles, else ordinary); nothing to move = null", () => {
    const r = (x: Partial<Parameters<typeof v2RouteFromLocal>[0]>) => ({ mode: "agent" as const, fallback: [], profiles: [], featureFallback: [], featureProfiles: [], ...x });
    expect(v2RouteFromLocal(r({ featureFallback: ["fp-small", "fp-haiku"], fallback: ["p-ds"] }), true))
      .toEqual({ mode: "agent", model: null, fallback: [{ kind: "featureProfile", profileId: "fp-small" }, { kind: "featureProfile", profileId: "fp-haiku" }] });
    expect(v2RouteFromLocal(r({ featureFallback: ["fp-small"], fallback: ["p-ds"] }), false)).toEqual({ mode: "agent", model: null, fallback: [{ kind: "profile", profileId: "p-ds" }] });
    expect(v2RouteFromLocal(r({ mode: "profile", featureProfiles: ["fp-haiku"], profiles: ["p-gpt", "p-claude"] }), false))
      .toEqual({ mode: "profiles", candidates: [{ kind: "profile", profileId: "p-gpt" }, { kind: "profile", profileId: "p-claude" }] });
    expect(v2RouteFromLocal(r({}), true)).toBeNull();
    expect(v2RouteFromLocal(r({ mode: "profile", profiles: ["p-gpt"] }), true)).toBeNull();
  });

  it("first read: the built-in (still cutex's default) gets the local route by PATCH; recorded; never again; the local value stays", async () => {
    setHostRoute("local", { mode: "agent", featureFallback: ["fp-small", "fp-haiku"] });
    await loadTemplates("local", true);
    expect(patches).toEqual([{ hostId: "local", id: BUILT_IN, patch: { route: { mode: "agent", model: null, fallback: [{ kind: "featureProfile", profileId: "fp-small" }, { kind: "featureProfile", profileId: "fp-haiku" }] } } }]);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true });
    expect(hostRoute("local").featureFallback).toEqual(["fp-small", "fp-haiku"]); // still there for v1 hosts
    await loadTemplates("local", true);
    expect(patches).toHaveLength(1);
    // The migration is stored with the prefs (same storage key).
    expect(JSON.parse(localStorage.getItem("cutex.promptEnhance")!).migrated).toEqual({ local: true });
  });

  it("never overwrites a route the owner already set on the host; still recorded as done", async () => {
    setHostRoute("local", { mode: "profile", featureProfiles: ["fp-haiku"] });
    v2Host.lists.set("local", TEMPLATES.map((t) => (t.id === BUILT_IN ? { ...t, route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-small", model: "gpt-6.2-mini" }] } } : t)));
    await loadTemplates("local", true);
    expect(patches).toEqual([]);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true });
  });

  it("nothing chosen locally: no PATCH, recorded; per host: another host still migrates its own route", async () => {
    await loadTemplates("local", true);
    expect(patches).toEqual([]);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true });
    setHostRoute("samplehostb", { mode: "profile", profiles: ["p-claude"] });
    await loadTemplates("samplehostb", false);
    expect(patches).toEqual([{ hostId: "samplehostb", id: BUILT_IN, patch: { route: { mode: "profiles", candidates: [{ kind: "profile", profileId: "p-claude" }] } } }]);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true, samplehostb: true });
  });

  it("a refused or failed PATCH is not recorded: the next read tries again", async () => {
    setHostRoute("local", { mode: "agent", featureFallback: ["fp-small"] });
    v2Host.patch = () => Promise.reject(new Error("422 invalid_rewrite_route: invalid rewrite route"));
    await loadTemplates("local", true);
    expect(promptEnhancePrefs().migrated).toEqual({});
    let calls = 0;
    v2Host.patch = (_h, id, patch) => { calls++; return Promise.resolve({ ...TEMPLATES[0], id, route: (patch as { route: unknown }).route }); };
    await loadTemplates("local", true);
    expect(calls).toBe(1);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true });
  });

  it("the input box on a v2 host triggers it on first use (its own template read)", async () => {
    setHostRoute("local", { mode: "agent", featureFallback: ["fp-haiku"] });
    composerHost.features = new Set(["text-rewrite-v1", "text-rewrite-v2", "feature-profiles"]);
    fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await flush();
    expect(patches.map((p) => [p.hostId, p.id])).toEqual([["local", BUILT_IN]]);
    expect(promptEnhancePrefs().migrated).toEqual({ local: true });
  });
});

// ── r298: one built-in 语法纠错, the old two as owner templates, a global Profile order ──────────────────────────

describe("global-routing host (text-rewrite-global-route)", () => {
  const OWN = { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-haiku" }] };
  const R298_TEMPLATES = [
    { id: "grammar-correction-v1", builtIn: true, kind: "correction", name: "语法纠错", prompt: "G", route: { mode: "agent", model: null, fallback: [] }, routeOverride: null },
    { id: "prompt-enhance-v1", builtIn: false, kind: "enhance", name: "提示词增强（主机上的）", prompt: "P", route: { mode: "agent", model: null, fallback: [] }, routeOverride: null },
    { id: "grammar-learning-v1", builtIn: false, kind: "correction", name: "纠错学习（主机上的）", prompt: "C", route: OWN, routeOverride: OWN },
  ];
  const FEATURES = ["text-rewrite-v1", "text-rewrite-v2", "text-rewrite-global-route", "feature-profiles"];
  beforeEach(() => {
    v2Host.lists.set("local", structuredClone(R298_TEMPLATES));
    globalRoutingHost.global = { mode: "agent", model: null, fallback: [] };
    globalRoutingHost.calls.length = 0;
    target.features = new Set(FEATURES);
  });
  afterEach(() => { v2Host.lists.clear(); setTemplateEdit(null); });
  const radio = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === label);

  it("contract: routeOverride (null = follows), create without a route, the global route bodies, timeout elapsedMs, names", () => {
    const tpl = (over: object) => parseRewriteTemplateList({ contractVersion: 2, templates: [{ ...R298_TEMPLATES[0], ...over }] })[0]!;
    expect(tpl({}).routeOverride).toBeNull();
    expect(tpl({ routeOverride: OWN }).routeOverride).toEqual(OWN);
    expect(tpl({ routeOverride: undefined })).not.toHaveProperty("routeOverride"); // older hosts
    expect(tpl({ routeOverride: { mode: "nope" } })).not.toHaveProperty("routeOverride");
    // Built-ins first: 语法纠错, then the old IDs in host order.
    expect(parseRewriteTemplateList({ contractVersion: 2, templates: [R298_TEMPLATES[2], R298_TEMPLATES[1], R298_TEMPLATES[0]] }).map((t) => t.id)).toEqual(["grammar-correction-v1", "grammar-learning-v1", "prompt-enhance-v1"]);
    expect(rewriteTemplateCreateBody({ kind: "enhance", name: "n", prompt: "p", route: null })).toEqual({ kind: "enhance", name: "n", prompt: "p" });
    expect(rewriteTemplateCreateBody({ kind: "enhance", name: "n", prompt: "p" })).not.toHaveProperty("route");
    expect(rewriteTemplatePatchBody({ route: null })).toEqual({ route: null });
    expect(rewriteGlobalRouteBody(OWN)).toEqual({ route: OWN });
    expect(() => rewriteGlobalRouteBody({ mode: "profiles", candidates: [] })).toThrow();
    expect(parseRewriteGlobalRouteReply({ contractVersion: 2, route: OWN })).toEqual(OWN);
    expect(() => parseRewriteGlobalRouteReply({ contractVersion: 1, route: OWN })).toThrow();
    expect(textRewriteAttempts({ attempts: [{ profileId: "fp-small", category: "timeout", elapsedMs: 24_012 }, { profileId: "fp-haiku", category: "quota_exhausted", elapsedMs: 5 }] }))
      .toEqual([{ profileId: "fp-small", category: "timeout", elapsedMs: 24_012 }, { profileId: "fp-haiku", category: "quota_exhausted" }]);
    const t = (key: string) => key;
    expect(templateName(t, R298_TEMPLATES[0]!)).toBe("input-refinement.template.grammar");
    expect(templateName(t, R298_TEMPLATES[1]!)).toBe("提示词增强（主机上的）"); // an owner template now: the host's name
    expect(copyOfTemplate(parseRewriteTemplateList({ contractVersion: 2, templates: [R298_TEMPLATES[0]] })[0]!, "c").route).toBeNull();
  });

  it("detail page: 全局顺序 on top (PATCHed), templates say 跟随全局; without the capability there is none", async () => {
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    const global = host.querySelector<HTMLElement>("[data-testid=input-refinement-global]")!;
    expect(global).not.toBeNull();
    expect(host.firstElementChild!.contains(global) || host.querySelector("section")!.contains(global)).toBe(true);
    const rows = [...host.querySelectorAll<HTMLElement>("[data-testid=input-refinement-templates] [data-template-id]")].map((x) => x.dataset.templateId);
    expect(rows).toEqual(["grammar-correction-v1", "prompt-enhance-v1", "grammar-learning-v1"]);
    const list = host.querySelector("[data-testid=input-refinement-templates]")!.textContent!;
    expect(list.match(/input-refinement\.settings\.summary\.followGlobal/g)).toHaveLength(2);
    expect(list).toContain("Haiku 改写");
    // Only the built-in offers 复制一份改; the old two are the owner's now.
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "input-refinement.settings.copy")).toHaveLength(1);
    // Fixed Profiles in the global order, then save.
    click(radio("input-refinement.template.mode.profiles"));
    await flush();
    act(() => global.querySelector<HTMLElement>("[data-testid=input-refinement-candidates] [data-entity-select], [data-testid=input-refinement-candidates] button")!.click());
    act(() => document.querySelector<HTMLButtonElement>('[role=option][data-value="featureProfile:fp-small"]')!.click());
    click([...global.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "input-refinement.template.save"));
    await flush();
    expect(globalRoutingHost.calls).toEqual([["patchTextRewriteRoute", { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-small" }] }]]);
    // An older host: exactly as before.
    act(() => root!.unmount());
    root = createRoot(host);
    target.features = new Set(["text-rewrite-v1", "text-rewrite-v2", "feature-profiles"]);
    v2Host.lists.clear();
    resetTemplatesForTests();
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    expect(host.querySelector("[data-testid=input-refinement-global]")).toBeNull();
    expect(host.textContent).not.toContain("followGlobal");
  });

  it("template sub-page: 跟随全局 shows the global order read-only with a way there; 单独设置 edits; back to follow PATCHes null", async () => {
    globalRoutingHost.global = { mode: "agent", model: null, fallback: [{ kind: "featureProfile", profileId: "fp-small" }] };
    act(() => setTemplateEdit({ hostId: "local", id: "grammar-correction-v1" }));
    act(() => root!.render(h(TemplateSettings)));
    await flush();
    expect(radio("input-refinement.template.followGlobal")!.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector("[data-testid=input-refinement-global-shown]")!.textContent).toContain("input-refinement.settings.summary.agentFallback");
    expect(host.querySelector("[data-testid=input-refinement-candidates]")).toBeNull();
    // A built-in that follows: nothing to restore.
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "input-refinement.template.restore")).toBe(false);
    click([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "input-refinement.template.editGlobal"));
    expect(opened.at(-1)).toEqual(["input-refinement-detail", { anchor: "input-refinement-global" }]);
    // 单独设置: starts from the global order; saved as its own route.
    click(radio("input-refinement.template.ownRoute"));
    expect(host.querySelector("[data-testid=input-refinement-candidates]")).not.toBeNull();
    click(host.querySelector("[data-testid=input-refinement-template-save] button"));
    await flush();
    expect(globalRoutingHost.calls.at(-1)).toEqual(["patchTextRewriteTemplate", "grammar-correction-v1", { route: { mode: "agent", model: null, fallback: [{ kind: "featureProfile", profileId: "fp-small" }] } }]);

    // A template with its own route: switching back to 跟随全局 PATCHes route null.
    act(() => setTemplateEdit({ hostId: "local", id: "grammar-learning-v1" }));
    await flush();
    expect(radio("input-refinement.template.ownRoute")!.getAttribute("aria-checked")).toBe("true");
    click(radio("input-refinement.template.followGlobal"));
    click(host.querySelector("[data-testid=input-refinement-template-save] button"));
    await flush();
    expect(globalRoutingHost.calls.at(-1)).toEqual(["patchTextRewriteTemplate", "grammar-learning-v1", { route: null }]);
  });

  it("a new template follows the global order by default and is created without a route", async () => {
    act(() => root!.render(h(InputRefinementSettings)));
    await flush();
    click([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("input-refinement.settings.new")));
    act(() => root!.render(h(TemplateSettings)));
    await flush();
    expect(radio("input-refinement.template.followGlobal")!.getAttribute("aria-checked")).toBe("true");
    const name = host.querySelector<HTMLInputElement>("input[type=text], input:not([type])")!;
    setValue(name, "我的模板");
    setValue(host.querySelector<HTMLTextAreaElement>("textarea")!, "Do it.");
    click(host.querySelector("[data-testid=input-refinement-template-save] button"));
    await flush();
    expect(globalRoutingHost.calls.at(-1)).toEqual(["createTextRewriteTemplate", { kind: "enhance", name: "我的模板", prompt: "Do it.", route: null }]);
  });

  it("card and wand menu: 跟随全局 where it applies; the menu's model item opens the global order", async () => {
    act(() => root!.render(h(InputRefinementCard)));
    await flush();
    expect(host.querySelector("[data-settings-subpage]")!.textContent).toContain('"route":"input-refinement.settings.summary.followGlobal"');
    act(() => root!.unmount());
    root = createRoot(host);
    composerHost.features = new Set(FEATURES);
    fakeApi();
    act(() => root!.render(h(Box, { initial: "fix login" })));
    await flush();
    const open = () => act(() => { host.querySelector("[data-testid=prompt-enhance-button]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    open();
    await flush();
    const item = () => document.querySelector<HTMLElement>("[data-testid=input-refinement-menu-template]")!;
    expect(item().textContent).toContain("input-refinement.menuGlobalModel");
    click(item());
    expect(opened.at(-1)).toEqual(["input-refinement-detail", { anchor: "input-refinement-global" }]);
    // A template with its own route: its sub-page, as before.
    act(() => setLastTemplate("local", "grammar-learning-v1"));
    open();
    await flush();
    expect(item().textContent).toContain("input-refinement.menuTemplateModel");
    click(item());
    expect(opened.at(-1)).toEqual(["input-refinement-detail", { sub: "template" }]);
  });

  it("panel: an empty reason leaves no line; a timeout says how long it waited", async () => {
    composerHost.features = new Set(FEATURES);
    const { structured } = fakeApi();
    act(() => root!.render(h(Box, { initial: "je pense que je pouvais vite" })));
    await flush();
    await shortcut();
    expect(structured[0]!.request.templateId).toBe("grammar-correction-v1");
    const used = { profileId: "fp-small", provider: "openai", model: "gpt-6.2-mini", requestedModel: "gpt-6.2-mini", fallbackUsed: false };
    structured[0]!.resolve({ ok: true, text: "je pense que je pourrais vite", suggestions: [], used, corrections: [
      { start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "mood", explanation: "", language: "fr", alternatives: [] },
    ] });
    await flush();
    const item = host.querySelector<HTMLElement>("[data-testid=input-refinement-corrections] li")!;
    expect(item.querySelectorAll(".text-muted.break-words")).toHaveLength(0);
    await press(input(), { key: "Escape" });
    await shortcut();
    structured[1]!.resolve({ ok: false, code: "rewrite_failed", attempts: [{ profileId: "fp-small", category: "timeout", elapsedMs: 24_400 }, { profileId: "fp-haiku", category: "timeout" }] });
    await flush();
    const attempts = [...host.querySelectorAll("[data-testid=prompt-enhance-attempts] li")].map((li) => li.textContent);
    expect(attempts[0]).toContain('input-refinement.attempt.timeoutAfter {\\"n\\":24}');
    expect(attempts[1]).toContain("input-refinement.attempt.timeout");
    expect(attempts[1]).not.toContain("timeoutAfter");
  });
});
