import { randomUUID } from "node:crypto";

export const WHATSAPP_WEB = "https://web.whatsapp.com/";
export const WHATSAPP_WORLD = 1011;

export function isWhatsAppWeb(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://web.whatsapp.com" && !url.username && !url.password;
  } catch {
    return false;
  }
}

// This is a fixed read of the top-level, already-rendered UI. It runs in an isolated world.
// It does not follow links, scroll, open a chat, read browser storage, or use WhatsApp internals.
export const READ_WHATSAPP_UNREAD = `(() => {
  if (window !== window.top || location.origin !== "https://web.whatsapp.com") return null;
  const title = document.title.slice(0, 100);
  const titleMatch = /^\\(([1-9][0-9]{0,3})\\)\\s*WhatsApp(?:$|\\s)/i.exec(title);
  const total = titleMatch ? Number(titleMatch[1]) : /^WhatsApp$/i.test(title.trim()) ? 0 : null;
  const pane = document.querySelector('#pane-side, [data-testid="chat-list"]');
  if (!pane) {
    // Pairing UI markers only. Never read QR data or phone number input values.
    const phoneLink = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 25).some(
      button => /^(?:log in with phone number|use phone number instead|使用电话号码登录|请改用电话号码关联。|使用電話號碼登入)$/i.test(button.textContent.trim()));
    if (phoneLink || document.querySelector('canvas[aria-label*="QR" i], canvas[aria-label*="二维码"], [data-testid="qrcode"], [data-testid="qr-code"]'))
      return { state: 'link', total: null, rows: [] };
    return { state: 'unknown', total: total > 0 ? total : null, rows: [] };
  }
  if (!navigator.onLine || document.querySelector('[data-testid="alert-computer-disconnected"], [data-testid="alert-phone-disconnected"]'))
    return { state: 'offline', total: null, rows: [] };
  const rows = [];
  const candidates = pane.querySelectorAll('[role="row"], [data-testid="cell-frame-container"]');
  for (let i = 0; i < Math.min(100, candidates.length); i++) {
    const row = candidates[i];
    const badge = row.querySelector('[data-testid="icon-unread-count"], [aria-label*="unread message" i], [aria-label*="未读消息"]');
    if (!badge) continue;
    const count = /^([1-9][0-9]{0,2})$/.exec(badge.textContent.trim());
    const key = row.getAttribute('data-id');
    if (!count || !key || key.length > 200) continue;
    const title = row.querySelector('[data-testid="cell-frame-title"] [title], [role="gridcell"] [data-testid="cell-frame-title"]');
    const preview = row.querySelector('[data-testid="last-msg-status"] + span[title], [data-testid="last-msg-text"] [title], [data-testid="last-msg-text"][title]');
    const text = element => (element?.getAttribute('title') || element?.textContent || '').trim();
    rows.push({ key, count: Number(count[1]), name: text(title).slice(0, 100), preview: text(preview).slice(0, 200) });
  }
  return { state: 'ready', total, rows };
})()`;

interface UnreadRow { key: string; count: number; name: string; preview: string }
export type WhatsAppStatus = "link" | "ready" | "offline" | "unknown";
export interface WhatsAppSnapshot { state: WhatsAppStatus; total: number | null; rows: UnreadRow[] }
export type WhatsAppSignal =
  | { kind: "unread"; id: string; count: number; name: string; preview: string }
  | { kind: "link" | "offline"; id: string };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, limit).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseWhatsAppSnapshot(input: unknown): WhatsAppSnapshot | null {
  if (!record(input) || (input.state !== "link" && input.state !== "ready" && input.state !== "offline" && input.state !== "unknown")) return null;
  const total = typeof input.total === "number" && Number.isSafeInteger(input.total) && input.total >= 0 && input.total <= 9_999 ? input.total : null;
  const seen = new Set<string>(), rows: UnreadRow[] = [];
  if (input.state === "ready" && Array.isArray(input.rows)) {
    for (const value of input.rows.slice(0, 100)) {
      if (!record(value) || typeof value.key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(value.key)
        || seen.has(value.key) || typeof value.count !== "number" || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > 999) continue;
      seen.add(value.key);
      rows.push({ key: value.key, count: value.count, name: safeText(value.name, 100), preview: safeText(value.preview, 200) });
    }
  }
  return { state: input.state, total, rows };
}

/** Per designated page. Baselines and previews are kept in process memory only. */
export class WhatsAppUnread {
  private baseline: WhatsAppSnapshot | null = null;
  private readySample: WhatsAppSnapshot | null = null;
  private titleBaseline: number | null = null;
  private status: WhatsAppStatus = "unknown";
  private statusSince = 0;
  private linkSent = false;
  private offlineSent = false;

  constructor(private linked: boolean, private readonly onLinked: () => void) {}

  private id(): string { return randomUUID(); }

  observe(snapshot: WhatsAppSnapshot, now: number, ownerReading: boolean): WhatsAppSignal | null {
    if (snapshot.state !== this.status) {
      this.status = snapshot.state;
      this.statusSince = now;
    }
    if (snapshot.state === "link" || snapshot.state === "offline") {
      this.readySample = null;
      const delay = snapshot.state === "link" ? 10_000 : 120_000;
      if (!this.linked || (snapshot.state === "link" ? this.linkSent : this.offlineSent) || now - this.statusSince < delay) return null;
      if (snapshot.state === "link") { this.baseline = null; this.titleBaseline = null; this.linkSent = true; }
      else this.offlineSent = true;
      return { kind: snapshot.state, id: this.id() };
    }
    if (snapshot.state === "unknown") {
      this.readySample = null;
      if (snapshot.total === null) return null;
      const previous = this.titleBaseline;
      this.titleBaseline = snapshot.total;
      if (previous === null) return null;
      this.markLinked();
      // The unread total can survive a chat-list change. Discard the older row subset so
      // a later successful DOM sample cannot announce the same increase a second time.
      if (this.baseline) this.baseline = { ...this.baseline, total: snapshot.total, rows: [] };
      if (snapshot.total <= previous) return null;
      return ownerReading ? null : { kind: "unread", id: this.id(), count: snapshot.total - previous, name: "", preview: "" };
    }
    if (!this.readySample) {
      this.readySample = snapshot;
      return null;
    }
    this.readySample = snapshot;
    this.markLinked();
    this.linkSent = false;
    this.offlineSent = false;
    const previous = this.baseline;
    this.baseline = snapshot;
    this.titleBaseline = snapshot.total;
    if (!previous || ownerReading) return null;
    const known = new Map(previous.rows.map(row => [row.key, row]));
    const growing = snapshot.rows.filter(row => {
      const old = known.get(row.key);
      return !!old && row.count > old.count;
    });
    const titleDelta = snapshot.total !== null && previous.total !== null ? Math.max(0, snapshot.total - previous.total) : 0;
    const rowDelta = growing.reduce((sum, row) => sum + row.count - known.get(row.key)!.count, 0);
    const count = Math.max(titleDelta, rowDelta);
    if (!count) return null;
    const row = growing.length === 1 && titleDelta <= rowDelta ? growing[0] : undefined;
    return { kind: "unread", id: this.id(), count, name: row?.name ?? "", preview: row?.preview ?? "" };
  }

  private markLinked(): void {
    if (!this.linked) { this.linked = true; this.onLinked(); }
  }
}
