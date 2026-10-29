// Browser preview of agent pages (shared/frames.ts): the preview server (vite.preview.config.ts,
// plugin `mock-frames`) plays main's part — it builds the same offline document
// (@cutex-desktop/opaque-frame/page, with the page API) and serves it once with the same CSP + sandbox
// header. The page channels (shared/pageBridge.ts) are played here: storage in this tab's localStorage
// with main's limits, and — there is no native dialog in a browser — a stand-in confirm box drawn by the
// preview and labelled as such (the real app uses main's own native dialog, main/frames.ts).
import type { ArtifactContent, ArtifactDetail } from "../../../shared/artifactStore";
import { FILE_PAGE_MAX_BYTES, FILE_PAGE_PROMPT_BYTES, type FilePageInput, type FramesBridge } from "../../../shared/frames";
import type { FsFile } from "../../../shared/ipc";
import type { PageDataUsage, PageResult } from "../../../shared/pageBridge";
import { pageSubmitMessage, pageSubmitPromptText } from "../../../shared/pagePromptText";
import { currentLocale } from "../i18n";
import { appWindowOfKey } from "../lib/appWindowSet";

type ReadContent = (hostId: string, artifactId: string, version: number) => Promise<ArtifactContent | null>;
interface MockPageHost {
  detail(hostId: string, artifactId: string): Promise<ArtifactDetail | null>;
  submit(hostId: string, sessionId: string, text: string): Promise<unknown>;
}
// = main/pageStorage.ts (main's constants; the preview cannot import main).
const PAGE_LIMIT = 5 * 1024 * 1024;
const TOTAL_LIMIT = 200 * 1024 * 1024;
const STORE = "cutex-preview-page-data";

type Stored = Record<string, { hostId: string; artifactId: string; name: string | null; updatedAt: string; data: Record<string, string> }>;
const load = (): Stored => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Stored;
  } catch {
    return {};
  }
};
const save = (s: Stored) => localStorage.setItem(STORE, JSON.stringify(s));
const size = (data: Record<string, string>) => Object.entries(data).reduce((n, [k, v]) => n + new TextEncoder().encode(k + v).length, 0);

/** The preview's stand-in for main's native confirm dialog (clearly marked; never in the app), drawn in the window the page is in. */
function standInConfirm(text: ReturnType<typeof pageSubmitPromptText>, doc: Document): Promise<boolean> {
  return new Promise((resolve) => {
    const back = doc.createElement("div");
    back.setAttribute("data-testid", "mock-native-dialog");
    back.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28)";
    const box = doc.createElement("div");
    box.style.cssText = "width:460px;max-width:92vw;background:#f6f6f6;color:#111;border:1px solid #bbb;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:13px system-ui,sans-serif;overflow:hidden";
    const bar = doc.createElement("div");
    bar.style.cssText = "padding:6px 10px;background:#e4e4e4;border-bottom:1px solid #ccc;font-size:12px;display:flex;justify-content:space-between";
    bar.append(Object.assign(doc.createElement("b"), { textContent: text.title }), Object.assign(doc.createElement("span"), { textContent: "预览替身 · 真实 app 是系统对话框", style: "color:#888" }));
    const body = doc.createElement("div");
    body.style.cssText = "padding:14px 16px";
    const message = Object.assign(doc.createElement("div"), { textContent: text.message });
    message.style.cssText = "font-weight:600;margin-bottom:8px";
    const detail = Object.assign(doc.createElement("pre"), { textContent: text.detail });
    detail.style.cssText = "white-space:pre-wrap;max-height:240px;overflow:auto;margin:0;font:12px/1.5 ui-monospace,monospace;color:#333";
    const buttons = doc.createElement("div");
    buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #ddd";
    const done = (value: boolean) => {
      back.remove();
      resolve(value);
    };
    const send = Object.assign(doc.createElement("button"), { textContent: text.send, onclick: () => done(true) });
    const cancel = Object.assign(doc.createElement("button"), { textContent: text.cancel, onclick: () => done(false) });
    for (const b of [send, cancel]) b.style.cssText = "padding:4px 16px;border:1px solid #999;border-radius:4px;background:#fff";
    cancel.style.borderColor = "#3b82f6";
    body.append(message, detail);
    buttons.append(send, cancel);
    box.append(bar, body, buttons);
    back.append(box);
    doc.body.append(back);
    cancel.focus();
  });
}

type ReadFile = (input: FilePageInput, maxBytes: number) => Promise<FsFile>;

/** main/frames.ts countExternalRefs, for the preview (the preview cannot import main). */
const externalRefs = (html: string) =>
  [...html.matchAll(/\b(?:src|poster|data|background)\s*=\s*["']?([^"'\s>]+)/gi), ...html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi), ...html.matchAll(/url\(\s*["']?([^"')\s]+)/gi)]
    .map((m) => m[1] ?? "")
    .filter((v) => v && !/^(?:data:|blob:|#|about:|javascript:|mailto:|tel:)/i.test(v)).length;

export function mockFrames(read: ReadContent, host?: MockPageHost, readFile?: ReadFile): FramesBridge {
  // deskId: the window the page was prepared for (main parents its native confirm there; multi-window P4).
  const bound = new Map<string, { hostId: string; artifactId: string; version: number; deskId?: string }>();
  let prompting = false;
  return {
    async prepareArtifactPage({ hostId, artifactId, version }, deskId) {
      const c = await read(hostId, artifactId, version);
      if (!c) return { ok: false, reason: "not-found" };
      if (c.encoding !== "utf8") return { ok: false, reason: "not-text" };
      if (c.truncated) return { ok: false, reason: "too-large" };
      const r = await fetch("/__mock-frame", { method: "POST", body: c.content, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (!r.ok) throw new Error(`mock frame: ${r.status}`);
      const frame = (await r.json()) as { id: string; url: string };
      bound.set(frame.id, { hostId, artifactId, version, ...(deskId ? { deskId } : {}) });
      return { ok: true, frame };
    },
    async prepareFilePage(input) {
      if (!readFile) return { ok: false, reason: "host-offline" };
      let f: FsFile;
      try {
        f = await readFile(input, input.large ? FILE_PAGE_MAX_BYTES : FILE_PAGE_PROMPT_BYTES);
      } catch {
        return { ok: false, reason: "not-found" };
      }
      if (f.encoding !== "utf8") return { ok: false, reason: "not-text" };
      if (f.truncated) return { ok: false, reason: "too-large", totalBytes: f.size };
      // No page API for a file page (?pageApi=0): it has no channels.
      const r = await fetch("/__mock-frame?pageApi=0", { method: "POST", body: f.content, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (!r.ok) throw new Error(`mock frame: ${r.status}`);
      return { ok: true, frame: (await r.json()) as { id: string; url: string }, externalRefs: externalRefs(f.content) };
    },
    async release(id) {
      bound.delete(id);
      await fetch(`/__mock-frame/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    },
    async page(id, call): Promise<PageResult> {
      const b = bound.get(id);
      if (!b) return { ok: false, error: "unavailable" };
      const fileKey = `${b.hostId}\n${b.artifactId}`;
      const all = load();
      const file = all[fileKey];
      switch (call.op) {
        case "storage.get":
          return { ok: true, value: file?.data[call.key] ?? null };
        case "storage.keys":
          return { ok: true, value: Object.keys(file?.data ?? {}) };
        case "storage.set": {
          const data = { ...(file?.data ?? {}), [call.key]: call.value };
          if (size(data) > PAGE_LIMIT) return { ok: false, error: "quota_exceeded", scope: "page", limit: PAGE_LIMIT };
          const others = Object.entries(all).filter(([k]) => k !== fileKey).reduce((n, [, f]) => n + size(f.data), 0);
          if (others + size(data) > TOTAL_LIMIT) return { ok: false, error: "quota_exceeded", scope: "total", limit: TOTAL_LIMIT };
          const name = file?.name ?? (await host?.detail(b.hostId, b.artifactId))?.artifact.name ?? null;
          all[fileKey] = { hostId: b.hostId, artifactId: b.artifactId, name, updatedAt: new Date().toISOString(), data };
          save(all);
          return { ok: true };
        }
        case "storage.remove":
          if (file) {
            delete file.data[call.key];
            save(all);
          }
          return { ok: true };
        case "storage.clear":
          delete all[fileKey];
          save(all);
          return { ok: true };
        case "copy":
          await navigator.clipboard?.writeText(call.text).catch(() => undefined);
          return { ok: true };
        case "submit": {
          if (prompting) return { ok: false, error: "busy" };
          const detail = await host?.detail(b.hostId, b.artifactId);
          const producer = detail?.versions.find((v) => v.version === b.version)?.producer;
          if (!detail || !producer?.sessionId) return { ok: false, error: "no_recipient" };
          // As main: the dialog belongs to the page's window; that window gone = unavailable.
          const doc = appWindowOfKey(b.deskId ?? "main")?.document;
          if (!doc) return { ok: false, error: "unavailable" };
          prompting = true;
          try {
            const locale = currentLocale();
            const ok = await standInConfirm(pageSubmitPromptText(locale, { name: detail.artifact.name, version: b.version, agent: producer.displayName ?? producer.sessionId, text: call.text }), doc);
            if (!ok) return { ok: true, sent: false };
            await host!.submit(b.hostId, producer.sessionId, pageSubmitMessage(locale, { artifactId: b.artifactId, name: detail.artifact.name, version: b.version, format: call.format, text: call.text }));
            return { ok: true, sent: true };
          } finally {
            prompting = false;
          }
        }
      }
    },
    async pageDataUsage(): Promise<PageDataUsage> {
      const items = Object.values(load()).map(({ hostId, artifactId, name, updatedAt, data }) => ({ hostId, artifactId, name, updatedAt, bytes: size(data) }));
      const totalBytes = items.reduce((n, i) => n + i.bytes, 0);
      return { items: items.sort((a, b) => b.bytes - a.bytes), totalBytes, pageLimit: PAGE_LIMIT, totalLimit: TOTAL_LIMIT, totalRefused: totalBytes >= TOTAL_LIMIT };
    },
    async pageDataClear(hostId, artifactId) {
      const all = load();
      delete all[`${hostId}\n${artifactId}`];
      save(all);
    },
  };
}
