// The three page channels in main (main/frames.ts + shared/pageBridge.ts, docs/design/004-artifact-page-bridge.md):
// what a page CANNOT do — reach another artifact's storage, exceed limits, send without the owner's native
// confirm, copy without a gesture, call anything outside the fixed schema (network, IPC, daemon).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { OFFLINE_PAGE_CSP, PAGE_API_TAG } from "@cutex-desktop/opaque-frame/page";
import type { ArtifactContent, ArtifactDetail, ArtifactProducer } from "../src/shared/artifactStore";
import { PAGE_COPY_MAX_BYTES, PAGE_MESSAGE_TAG, PAGE_SUBMIT_MAX_BYTES, parsePageCall, parsePageMessage } from "../src/shared/pageBridge";
import { pageSubmitMessage } from "../src/shared/pagePromptText";
import { createArtifactPageService, PAGE_SUBMIT_COOLDOWN_MS, PAGE_SUBMIT_MAX_PER_WINDOW, type PageChannelDeps } from "../src/main/frames";
import { createPageStorage } from "../src/main/pageStorage";

const A = "af-0123456789abcdef0123456789abcdef";
const B = "af-fedcba9876543210fedcba9876543210";
const content: ArtifactContent = { version: 2, encoding: "utf8", content: "<p>form</p>", offset: 0, totalBytes: 11, truncated: false, mediaType: "text/html", sha256: null, externalChanged: null };
const producer = (patch: Partial<ArtifactProducer> = {}): ArtifactProducer => ({ kind: "agent", sessionId: "s-writer", displayName: "demo-writer", runtimeGeneration: 1, turnId: "t1", askId: null, profile: null, model: null, attribution: null, candidates: [], ...patch });
const detail = (id: string, p = producer()) => ({ artifact: { artifactId: id, name: "decide.html" }, versions: [{ version: 2, producer: p }, { version: 1, producer: producer({ sessionId: "s-other", displayName: "other" }) }] }) as unknown as ArtifactDetail;

function fixture(options: { confirm?: PageChannelDeps["confirm"]; producer?: ArtifactProducer } = {}) {
  let t = 1_000_000;
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const submit = vi.fn(async (_s: string, _text: string) => ({}));
  const writeClipboard = vi.fn();
  const confirm = vi.fn(options.confirm ?? (async () => true));
  const storage = createPageStorage({ root: mkdtempSync(join(tmpdir(), "page-bridge-")) });
  const service = createArtifactPageService({
    documents,
    contentReader: () => ({ artifactStoreContent: async () => content }),
    ensureContained: async () => {},
    page: { storage, host: () => ({ artifactStoreGet: async (id) => detail(id, options.producer), submit }), confirm, writeClipboard, locale: () => "zh-CN", now: () => t },
  });
  const open = async (owner: number, artifactId = A) => {
    const r = await service.prepare(owner, { hostId: "local", artifactId, version: 2 });
    if (!r.ok) throw new Error("prepare");
    return r.frame;
  };
  return { documents, service, submit, writeClipboard, confirm, storage, open, advance: (ms: number) => (t += ms) };
}

describe("page message schema", () => {
  const msg = (patch: Record<string, unknown>) => ({ tag: PAGE_MESSAGE_TAG, id: 1, ...patch });
  it("is the tag the injected page API uses", () => expect(PAGE_API_TAG).toBe(PAGE_MESSAGE_TAG));
  it("ignores anything that is not a page message", () => {
    for (const data of [null, "x", [], { id: 1, op: "copy", text: "x" }, { tag: "other", id: 1 }, { tag: PAGE_MESSAGE_TAG, id: -1 }]) expect(parsePageMessage(data)).toBeNull();
  });
  it("knows only the fixed operations: no network, IPC, daemon, open, eval", () => {
    for (const op of ["fetch", "ipc", "daemon", "rpc", "open", "navigate", "eval", "storage.read", "storage.getOther", "__proto__"]) expect(parsePageMessage(msg({ op }))).toEqual({ id: 1, error: "invalid" });
  });
  it("refuses extra fields (no artifact / host / recipient chosen by the page)", () => {
    expect(parsePageMessage(msg({ op: "storage.get", key: "k", artifactId: B }))).toEqual({ id: 1, error: "invalid" });
    expect(parsePageMessage(msg({ op: "submit", format: "text", text: "hi", to: "s-other" }))).toEqual({ id: 1, error: "invalid" });
    expect(parsePageMessage(msg({ op: "copy", text: "x", gesture: true }))).toEqual({ id: 1, error: "invalid" });
  });
  it("bounds sizes: key, submit, copy", () => {
    expect(parsePageMessage(msg({ op: "storage.get", key: "k".repeat(257) }))).toEqual({ id: 1, error: "too_large" });
    expect(parsePageMessage(msg({ op: "storage.get", key: "a\u0000b" }))).toEqual({ id: 1, error: "invalid" });
    expect(parsePageMessage(msg({ op: "submit", format: "text", text: "x".repeat(PAGE_SUBMIT_MAX_BYTES + 1) }))).toEqual({ id: 1, error: "too_large" });
    expect(parsePageMessage(msg({ op: "submit", format: "json", text: "{nope" }))).toEqual({ id: 1, error: "invalid" });
    expect(parsePageMessage(msg({ op: "copy", text: "x".repeat(PAGE_COPY_MAX_BYTES + 1) }))).toEqual({ id: 1, error: "too_large" });
    expect(parsePageMessage(msg({ op: "storage.set", key: "k", value: 5 }))).toEqual({ id: 1, error: "invalid" });
  });
  it("main re-checks what the renderer forwards", () => {
    expect(parsePageCall({ op: "storage.keys" })).toEqual({ op: "storage.keys" });
    expect(() => parsePageCall({ op: "storage.keys", hostId: "x" })).toThrow();
    expect(() => parsePageCall({ op: "fetch", url: "http://127.0.0.1:24270/v2/sessions" })).toThrow();
  });
});

describe("page channels in main", () => {
  it("injects window.cutexPage only into agent pages and leaves the offline CSP as it was", async () => {
    const f = fixture();
    const frame = await f.open(7);
    const response = f.documents.respond(new Request(frame.url));
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    const html = await response.text();
    expect(html).toContain("cutexPage");
    expect(html.indexOf("cutexPage")).toBeLessThan(html.indexOf("<p>form</p>"));
  });
  it("binds storage to the artifact main prepared; another renderer or a released frame gets nothing", async () => {
    const f = fixture();
    const a = await f.open(7, A), b = await f.open(7, B);
    expect(await f.service.page(7, a.id, { op: "storage.set", key: "k", value: "A's" })).toEqual({ ok: true });
    expect(await f.service.page(7, b.id, { op: "storage.get", key: "k" })).toEqual({ ok: true, value: null });
    expect(await f.service.page(8, a.id, { op: "storage.get", key: "k" })).toEqual({ ok: false, error: "unavailable" });
    expect(await f.service.page(7, "not-a-frame", { op: "storage.get", key: "k" })).toEqual({ ok: false, error: "unavailable" });
    // A new version of the same artifact (a new frame) sees the same data.
    const again = await f.open(7, A);
    expect(await f.service.page(7, again.id, { op: "storage.get", key: "k" })).toEqual({ ok: true, value: "A's" });
    f.service.release(7, a.id);
    expect(await f.service.page(7, a.id, { op: "storage.get", key: "k" })).toEqual({ ok: false, error: "unavailable" });
    f.service.releaseOwner(7);
    expect(await f.service.page(7, again.id, { op: "storage.get", key: "k" })).toEqual({ ok: false, error: "unavailable" });
  });
  it("answers quota_exceeded over 5 MiB", async () => {
    const f = fixture();
    const a = await f.open(7);
    const big = "x".repeat(3 * 1024 * 1024);
    expect(await f.service.page(7, a.id, { op: "storage.set", key: "a", value: big })).toEqual({ ok: true });
    expect(await f.service.page(7, a.id, { op: "storage.set", key: "b", value: big })).toEqual({ ok: false, error: "quota_exceeded", scope: "page", limit: 5 * 1024 * 1024 });
  });
  it("never sends without the owner's native confirm; sends to the version's agent, labelled", async () => {
    const f = fixture({ confirm: async () => false });
    const a = await f.open(7);
    expect(await f.service.page(7, a.id, { op: "submit", format: "text", text: "answers" })).toEqual({ ok: true, sent: false });
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.submit).not.toHaveBeenCalled();
    const [owner, text] = f.confirm.mock.calls[0]!;
    expect(owner).toBe(7);
    expect(text.message).toContain("demo-writer");
    expect(text.detail).toContain("answers");
    expect(text.send).toBe("发送");

    const ok = fixture();
    const b = await ok.open(7);
    expect(await ok.service.page(7, b.id, { op: "submit", format: "json", text: '{"a":1}' })).toEqual({ ok: true, sent: true });
    expect(ok.submit).toHaveBeenCalledWith("s-writer", pageSubmitMessage("zh-CN", { artifactId: A, name: "decide.html", version: 2, format: "json", text: '{"a":1}' }));
    expect(ok.submit.mock.calls[0]![1]).toContain(`${A}@2`);
  });
  it("cannot send when the dialog could not be shown, or the frame went away while it was open", async () => {
    const hidden = fixture({ confirm: async () => null });
    const a = await hidden.open(7);
    expect(await hidden.service.page(7, a.id, { op: "submit", format: "text", text: "x" })).toEqual({ ok: false, error: "unavailable" });
    expect(hidden.submit).not.toHaveBeenCalled();

    let answer!: (v: boolean) => void;
    const torn = fixture({ confirm: (_o, _t, signal) => new Promise((resolve) => { answer = resolve; signal.addEventListener("abort", () => resolve(true)); }) });
    const b = await torn.open(7);
    const pending = torn.service.page(7, b.id, { op: "submit", format: "text", text: "x" });
    await vi.waitFor(() => expect(torn.confirm).toHaveBeenCalled());
    torn.service.release(7, b.id);
    answer(true);
    expect(await pending).toEqual({ ok: true, sent: false });
    expect(torn.submit).not.toHaveBeenCalled();
  });
  it("refuses when cutex names no agent for the version (owner-made, ambiguous auto capture)", async () => {
    for (const p of [producer({ kind: "owner", sessionId: null }), producer({ kind: "auto", attribution: "ambiguous", sessionId: null })]) {
      const f = fixture({ producer: p });
      const a = await f.open(7);
      expect(await f.service.page(7, a.id, { op: "submit", format: "text", text: "x" })).toEqual({ ok: false, error: "no_recipient" });
      expect(f.confirm).not.toHaveBeenCalled();
    }
  });
  it("rate-limits prompts: one at a time, a cooldown, and a cap per window", async () => {
    let release!: () => void;
    const f = fixture({ confirm: () => new Promise((r) => (release = () => r(false))) });
    const a = await f.open(7);
    const first = f.service.page(7, a.id, { op: "submit", format: "text", text: "x" });
    await vi.waitFor(() => expect(f.confirm).toHaveBeenCalled());
    expect(await f.service.page(7, a.id, { op: "submit", format: "text", text: "x" })).toEqual({ ok: false, error: "busy" });
    release();
    await first;
    expect(await f.service.page(7, a.id, { op: "submit", format: "text", text: "x" })).toEqual({ ok: false, error: "rate_limited" });
    for (let i = 1; i < PAGE_SUBMIT_MAX_PER_WINDOW; i++) {
      f.advance(PAGE_SUBMIT_COOLDOWN_MS);
      const p = f.service.page(7, a.id, { op: "submit", format: "text", text: "x" });
      await vi.waitFor(() => expect(f.confirm).toHaveBeenCalledTimes(i + 1));
      release();
      await p;
    }
    f.advance(PAGE_SUBMIT_COOLDOWN_MS);
    expect(await f.service.page(7, a.id, { op: "submit", format: "text", text: "x" })).toEqual({ ok: false, error: "rate_limited" });
    expect(f.confirm).toHaveBeenCalledTimes(PAGE_SUBMIT_MAX_PER_WINDOW);
  });
  it("copies through main, rate-limited per frame", async () => {
    const f = fixture();
    const a = await f.open(7);
    expect(await f.service.page(7, a.id, { op: "copy", text: "result" })).toEqual({ ok: true });
    expect(await f.service.page(7, a.id, { op: "copy", text: "again" })).toEqual({ ok: false, error: "rate_limited" });
    expect(f.writeClipboard.mock.calls).toEqual([["result"]]);
  });
  it("refuses unknown operations from the renderer too", async () => {
    const f = fixture();
    const a = await f.open(7);
    expect(await f.service.page(7, a.id, { op: "daemon", path: "/v2/sessions" })).toEqual({ ok: false, error: "invalid" });
  });
  it("without the page deps a page has no API and every request is refused", async () => {
    const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
    const service = createArtifactPageService({ documents, contentReader: () => ({ artifactStoreContent: async () => content }), ensureContained: async () => {} });
    const r = await service.prepare(7, { hostId: "local", artifactId: A, version: 2 });
    if (!r.ok) throw new Error("prepare");
    expect(await documents.respond(new Request(r.frame.url)).text()).not.toContain("cutexPage");
    expect(await service.page(7, r.frame.id, { op: "storage.keys" })).toEqual({ ok: false, error: "unavailable" });
  });
});
