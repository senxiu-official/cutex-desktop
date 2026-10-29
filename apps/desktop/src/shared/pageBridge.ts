// The three narrow channels of an agent page (docs/design/004-artifact-page-bridge.md, docs/desktop-modules.md
// §10.2): A its own small storage, B submit to the agent that made it (only after the owner confirms in a
// native dialog), C copy text (only during a user gesture). The page posts a fixed-schema message to its
// parent; the renderer broker (modules/artifacts/pageBroker.ts) accepts it only from that frame instance,
// checks the schema and sizes, and forwards it here over FRAMES_CHANNEL; main (main/frames.ts) checks it
// again, binds it to the artifact main itself prepared, and decides. Nothing else crosses: no network, no
// daemon RPC, no token, no other page's data. The storage quotas themselves are main's (main/pageStorage.ts).

/** The tag every page message carries (the page API in @cutex-desktop/opaque-frame/page uses the same). */
export const PAGE_MESSAGE_TAG = "cutex-page/1";
/** A storage key: printable, short. */
export const PAGE_KEY_MAX = 256;
/** Upper bound of any one message's payload (never more than one page's whole quota, 5 MiB). */
export const PAGE_MESSAGE_MAX_BYTES = 5 * 1024 * 1024;
/** What a page can hand to its agent in one submit (an owner message, not a file). */
export const PAGE_SUBMIT_MAX_BYTES = 64 * 1024;
/** What a page can ask to copy at once. */
export const PAGE_COPY_MAX_BYTES = 1024 * 1024;
/** Requests one frame may have open at once in the broker (more are answered `busy`). */
export const PAGE_MAX_IN_FLIGHT = 8;

export type PageCall =
  | { op: "storage.get"; key: string }
  | { op: "storage.set"; key: string; value: string }
  | { op: "storage.remove"; key: string }
  | { op: "storage.keys" }
  | { op: "storage.clear" }
  | { op: "submit"; format: "text" | "json"; text: string }
  | { op: "copy"; text: string };
export type PageOp = PageCall["op"];

export type PageErrorCode =
  | "invalid" // not this schema
  | "too_large" // over a message bound (key, value, submit, copy)
  | "quota_exceeded" // A: this page's 5 MiB, or all pages' 200 MB
  | "busy" // too many requests at once / a submit dialog is already open
  | "rate_limited" // B / C asked again too soon
  | "no_gesture" // C without an active user gesture
  | "no_recipient" // B: cutex does not know which agent made this page
  | "unavailable"; // host offline, frame gone, window hidden
export type PageResult =
  | { ok: true; value?: string | string[] | null; sent?: boolean }
  | { ok: false; error: PageErrorCode; /** quota_exceeded: which limit */ scope?: "page" | "total"; limit?: number };

const KEY = /^[^\u0000-\u001f\u007f]{1,256}$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const exact = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).sort().join() === [...keys].sort().join();

/**
 * A message from the page (already known to come from that frame instance): `{ tag, id, op, …}`.
 * Returns the call + its id, an error to answer with, or null (not a page message: ignore silently).
 */
export function parsePageMessage(data: unknown): { id: number; call: PageCall } | { id: number; error: PageErrorCode } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  if (r.tag !== PAGE_MESSAGE_TAG || typeof r.id !== "number" || !Number.isSafeInteger(r.id) || r.id < 0) return null;
  const id = r.id;
  const invalid = { id, error: "invalid" as const }, tooLarge = { id, error: "too_large" as const };
  const key = () => typeof r.key === "string" && KEY.test(r.key);
  switch (r.op) {
    case "storage.get":
    case "storage.remove":
      if (!exact(r, ["tag", "id", "op", "key"])) return invalid;
      if (typeof r.key === "string" && r.key.length > PAGE_KEY_MAX) return tooLarge;
      return key() ? { id, call: { op: r.op, key: r.key as string } } : invalid;
    case "storage.set":
      if (!exact(r, ["tag", "id", "op", "key", "value"]) || typeof r.value !== "string") return invalid;
      if (typeof r.key === "string" && r.key.length > PAGE_KEY_MAX) return tooLarge;
      if (!key()) return invalid;
      if (r.value.length > PAGE_MESSAGE_MAX_BYTES || bytes(r.value) > PAGE_MESSAGE_MAX_BYTES) return tooLarge;
      return { id, call: { op: "storage.set", key: r.key as string, value: r.value } };
    case "storage.keys":
    case "storage.clear":
      return exact(r, ["tag", "id", "op"]) ? { id, call: { op: r.op } } : invalid;
    case "submit": {
      if (!exact(r, ["tag", "id", "op", "format", "text"]) || (r.format !== "text" && r.format !== "json") || typeof r.text !== "string") return invalid;
      if (r.text.length > PAGE_SUBMIT_MAX_BYTES || bytes(r.text) > PAGE_SUBMIT_MAX_BYTES) return tooLarge;
      if (!r.text.trim()) return invalid;
      if (r.format === "json") {
        try {
          JSON.parse(r.text);
        } catch {
          return invalid;
        }
      }
      return { id, call: { op: "submit", format: r.format, text: r.text } };
    }
    case "copy":
      if (!exact(r, ["tag", "id", "op", "text"]) || typeof r.text !== "string") return invalid;
      if (r.text.length > PAGE_COPY_MAX_BYTES || bytes(r.text) > PAGE_COPY_MAX_BYTES) return tooLarge;
      return { id, call: { op: "copy", text: r.text } };
    default:
      return invalid; // fetch, ipc, daemon, open, … do not exist
  }
}

/** Main's own check of what the renderer forwards (same schema, no tag / id). */
export function parsePageCall(raw: unknown): PageCall {
  const parsed = parsePageMessage(raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as object), tag: PAGE_MESSAGE_TAG, id: 0 } : null);
  if (!parsed || "error" in parsed) throw new Error("Invalid page request");
  return parsed.call;
}

/** Settings / ⋯ menu: one page's stored data. */
export interface PageDataEntry {
  hostId: string;
  artifactId: string;
  /** Last known artifact name (null until main learned it). */
  name: string | null;
  bytes: number;
  updatedAt: string;
}
export interface PageDataUsage {
  items: PageDataEntry[];
  totalBytes: number;
  pageLimit: number;
  totalLimit: number;
  /** A write was refused because all pages together are over the total limit (cleared when back under). */
  totalRefused: boolean;
}
