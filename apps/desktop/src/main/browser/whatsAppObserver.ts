import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { WhatsAppWatchView } from "../../shared/browser";
import type { ServiceNotificationConfiguration } from "../../shared/serviceNotifications";
import { writeFileAtomic } from "../fileWrites";
import { isWhatsAppWeb, parseWhatsAppSnapshot, READ_WHATSAPP_UNREAD, WHATSAPP_WORLD, WhatsAppUnread, type WhatsAppSignal } from "./whatsAppUnread";

export const WHATSAPP_SERVICE = "whatsapp";
const SERVICE = `/v2/services/${WHATSAPP_SERVICE}`;
const TOKEN = /^ctsvc1_[A-Za-z0-9_-]{43}$/;
const POLL_MS = 10_000;
const MAX_PENDING = 6;
interface Binding {
  hostId: string;
  tabKey: string;
  enabled: boolean;
  linked: boolean;
  preview: boolean;
  credential: string;
}
interface ObserverGuest {
  getURL(): string;
  executeJavaScriptInIsolatedWorld(world: number, scripts: { code: string }[], userGesture: false): Promise<unknown>;
}
interface Source {
  guest: ObserverGuest;
  current(): boolean;
  reading(): boolean;
}
interface Options {
  userData: string;
  hasTab(hostId: string, tabKey: string): boolean;
  source(hostId: string, tabKey: string): Source | null;
  client(hostId: string): CutexClient | null;
  locale(): string | undefined;
}

const servicePath = `${SERVICE}/notification-settings`;

/**
 * The WhatsApp module switch (renderer module `whatsapp`, default off; owner 2026-11-26). main keeps its own copy in
 * userData/whatsapp-module.json and decides from it, before and without any renderer: off = no script runs in the
 * tab, no polling, no notifications, no configure, and the tab is not held as owner-only. The binding and its
 * credential stay on disk (turning the module on again resumes). Migration: with no file yet, an install whose
 * watch is already on starts with the module on.
 */
interface ModuleState { version: 1; enabled: boolean }

export class WhatsAppObserver {
  private readonly file: string;
  private readonly moduleFile: string;
  private moduleOn: boolean;
  private binding: Binding | null;
  private tracker: WhatsAppUnread | null = null;
  private status: WhatsAppWatchView["status"] = "waiting";
  private pending: { body: string; expires: number }[] = [];
  private inFlight = false;
  private configured = false;
  private nextPoll = 0;

  constructor(private readonly options: Options) {
    this.file = join(options.userData, "whatsapp-observer.json");
    this.moduleFile = join(options.userData, "whatsapp-module.json");
    this.binding = this.load();
    this.moduleOn = this.loadModule();
    this.resetTracker();
  }

  private loadModule(): boolean {
    try {
      const state = JSON.parse(readFileSync(this.moduleFile, "utf8")) as Partial<ModuleState>;
      if (state.version === 1 && typeof state.enabled === "boolean") return state.enabled;
    } catch { /* first run (or unreadable): migrate below */ }
    const enabled = this.binding?.enabled === true;
    try { writeFileAtomic(this.moduleFile, JSON.stringify({ version: 1, enabled } satisfies ModuleState)); } catch { /* retried on the next set */ }
    return enabled;
  }

  /** The module switch as main holds it. */
  moduleEnabled(): boolean {
    return this.moduleOn;
  }

  /** Owner turned the WhatsApp module on / off: persisted first; off stops at once (data kept). */
  setModuleEnabled(enabled: boolean): { enabled: boolean } {
    if (enabled !== this.moduleOn) {
      writeFileAtomic(this.moduleFile, JSON.stringify({ version: 1, enabled } satisfies ModuleState));
      this.moduleOn = enabled;
      this.status = "waiting";
      this.nextPoll = 0;
      this.resetTracker();
    }
    return { enabled: this.moduleOn };
  }

  private load(): Binding | null {
    try {
      const binding = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Binding> & { version?: number };
      if (binding.version !== 1 || typeof binding.hostId !== "string" || binding.hostId.length > 128
        || typeof binding.tabKey !== "string" || !/^[a-f0-9-]{36}$/i.test(binding.tabKey)
        || typeof binding.enabled !== "boolean" || typeof binding.linked !== "boolean"
        || typeof binding.preview !== "boolean" || typeof binding.credential !== "string" || binding.credential.length > 2048) return null;
      return binding as Binding;
    } catch { return null; }
  }

  private save(binding: Binding | null): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, ...binding }));
  }

  private resetTracker(): void {
    this.pending = [];
    const binding = this.binding;
    this.tracker = binding ? new WhatsAppUnread(binding.linked, () => {
      if (this.binding !== binding) return;
      binding.linked = true;
      try { this.save(binding); } catch { /* The current observed session stays linked. */ }
    }) : null;
  }

  /** Held as owner-only (never granted to an agent): only while the module is on. */
  protected(hostId: string, tabKey: string): boolean {
    return this.moduleOn && this.bound(hostId, tabKey);
  }

  private bound(hostId: string, tabKey: string): boolean {
    return this.binding?.hostId === hostId && this.binding.tabKey === tabKey;
  }

  observing(hostId: string, tabKey: string): boolean {
    return this.protected(hostId, tabKey) && this.binding!.enabled;
  }

  view(hostId: string): WhatsAppWatchView {
    const binding = this.binding?.hostId === hostId ? this.binding : null;
    return { tabKey: binding?.tabKey ?? null, enabled: binding?.enabled ?? false, preview: binding?.preview ?? false,
      linked: binding?.linked ?? false, status: binding?.enabled ? this.status : "disabled" };
  }

  private release(hostId: string, tabKey: string): void {
    if (!this.bound(hostId, tabKey)) return;
    this.save(null);
    this.binding = null;
    this.status = "waiting";
    this.nextPoll = 0;
    this.resetTracker();
  }

  retire(hostId: string, tabKey: string): void {
    // Module off: closing that tab keeps the binding (the owner's data) for when the module comes back.
    if (!this.moduleOn) return;
    try { this.release(hostId, tabKey); } catch { /* An explicit unbind or replacement can retry the write. */ }
  }

  unbind(hostId: string, tabKey: string): WhatsAppWatchView {
    if (!this.moduleOn) throw Error("whatsapp_module_off");
    if (this.configured) throw Error("whatsapp_settings_busy");
    this.release(hostId, tabKey);
    return this.view(hostId);
  }

  async configure(hostId: string, tabKey: string, enabled: boolean, preview: boolean, check: () => void): Promise<WhatsAppWatchView> {
    if (!this.moduleOn) throw Error("whatsapp_module_off");
    if (this.configured) throw Error("whatsapp_settings_busy");
    this.configured = true;
    try {
      let prior = this.binding;
      if (prior && !this.bound(hostId, tabKey)) {
        if (!enabled || this.options.hasTab(prior.hostId, prior.tabKey)) throw Error("whatsapp_different_tab");
        if (!this.options.source(hostId, tabKey)) throw Error("whatsapp_owner_tab_required");
        this.release(prior.hostId, prior.tabKey);
        prior = null;
      }
      if (!enabled && prior) {
        const disabled = { ...prior, enabled: false, preview };
        this.save(disabled);
        this.binding = disabled;
        this.resetTracker();
      }
      const client = this.options.client(hostId);
      if (!client) throw Error("whatsapp_local_host_required");
      if (!enabled) {
        if (!prior) return this.view(hostId);
        const current = await client.request<ServiceNotificationConfiguration>("GET", servicePath);
        check();
        await client.request("PUT", servicePath, { body: { ...current.settings, enabled: false } });
        return this.view(hostId);
      }
      const source = this.options.source(hostId, tabKey);
      if (!source || !isWhatsAppWeb(source.guest.getURL())) throw Error("whatsapp_owner_tab_required");
      const checkSource = () => { check(); if (!source.current()) throw Error("whatsapp_page_changed"); };
      let service: { service: { runtime: string; archived?: boolean } };
      try { service = await client.request("GET", SERVICE); }
      catch (error) {
        if (!error || typeof error !== "object" || !("status" in error) || error.status !== 404) throw error;
        checkSource();
        service = await client.request("POST", "/v2/services", { body: { slug: WHATSAPP_SERVICE,
          displayName: "WhatsApp", runtime: "integration", lifetime: "persistent" } });
      }
      checkSource();
      if (service.service.runtime !== "integration" || service.service.archived) throw Error("whatsapp_service_unavailable");
      if (!safeStorage.isEncryptionAvailable()) throw Error("whatsapp_secure_storage_unavailable");
      // Reserve the tab before issuing a credential. Agent grants and claims are then refused by main.
      const reserved: Binding = { hostId, tabKey, enabled: false, preview, linked: prior?.linked ?? false,
        credential: prior?.credential ?? "" };
      this.save(reserved);
      this.binding = reserved;
      const existing = await client.request<ServiceNotificationConfiguration>("GET", servicePath);
      checkSource();
      if (!existing.credentialConfigured || !this.readToken(reserved) || this.status === "credential") {
        const { token } = await client.request<{ token: string }>("POST", `${SERVICE}/notification-credential`);
        checkSource();
        if (!TOKEN.test(token)) throw Error("whatsapp_service_credential_unavailable");
        reserved.credential = safeStorage.encryptString(token).toString("base64");
        this.save(reserved);
      }
      await client.request("PUT", servicePath, { body: { ...existing.settings, enabled: true, retainContent: false } });
      checkSource();
      const binding = { ...reserved, enabled: true };
      this.save(binding);
      this.binding = binding;
      this.status = "waiting";
      this.resetTracker();
      this.nextPoll = 0;
      return this.view(hostId);
    } finally {
      this.configured = false;
    }
  }

  private readToken(binding: Binding): string | null {
    if (!binding.credential || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const value = safeStorage.decryptString(Buffer.from(binding.credential, "base64"));
      return TOKEN.test(value) ? value : null;
    } catch { return null; }
  }

  changed(hostId: string, tabKey: string): void {
    if (this.observing(hostId, tabKey)) this.nextPoll = Math.min(this.nextPoll, Date.now() + 1_000);
  }

  tick(now: number): void {
    const binding = this.binding, tracker = this.tracker;
    if (!this.moduleOn || !binding?.enabled || !tracker || this.configured || this.inFlight || now < this.nextPoll) return;
    this.nextPoll = now + POLL_MS;
    const source = this.options.source(binding.hostId, binding.tabKey);
    if (!source || !isWhatsAppWeb(source.guest.getURL())) { this.status = "waiting"; return; }
    this.inFlight = true;
    const current = () => this.moduleOn && this.binding === binding && this.tracker === tracker && source.current();
    void this.sample(source, binding, tracker, current).catch(() => {}).finally(() => { this.inFlight = false; });
  }

  private async sample(source: Source, binding: Binding, tracker: WhatsAppUnread, current: () => boolean): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown;
    try {
      raw = await Promise.race([source.guest.executeJavaScriptInIsolatedWorld(WHATSAPP_WORLD, [{ code: READ_WHATSAPP_UNREAD }], false),
        new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 5_000); deadline.unref(); })]);
    } finally { clearTimeout(deadline); }
    const sample = parseWhatsAppSnapshot(raw);
    if (!current() || !sample) return;
    this.status = sample.state;
    const now = Date.now();
    this.pending = this.pending.filter(item => item.expires > now);
    const signal = tracker.observe(sample, now, source.reading());
    if (signal && this.pending.length < MAX_PENDING) this.pending.push({ body: JSON.stringify(this.notification(signal, binding.preview)), expires: now + 60_000 });
    const next = this.pending[0];
    if (!next) return;
    const token = this.readToken(binding);
    if (!token) { this.status = "credential"; return; }
    const client = this.options.client(binding.hostId);
    if (!client || !current()) return;
    const url = new URL(client.url(`${SERVICE}/notifications`));
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return;
    const response = await client.fetchRaw(url.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: next.body });
    void response.body?.cancel().catch(() => {});
    if (!current()) return;
    if (response.status === 401) { this.status = "credential"; return; }
    if (response.ok || [400, 404, 409, 410].includes(response.status)) this.pending.shift();
  }

  private notification(signal: WhatsAppSignal, preview: boolean) {
    const zh = this.options.locale()?.startsWith("zh") === true;
    const title = signal.kind === "link" ? (zh ? "WhatsApp 需要重新关联" : "Relink WhatsApp")
      : signal.kind === "offline" ? (zh ? "WhatsApp 连接中断" : "WhatsApp connection is offline")
      : (zh ? "WhatsApp 新消息" : "New WhatsApp message");
    const body = signal.kind !== "unread" ? undefined
      : preview && signal.name ? [signal.name, signal.preview].filter(Boolean).join(" · ").slice(0, 240)
      : (zh ? `${signal.count} 条新未读` : `${signal.count} new unread`);
    return { title, body, dedupKey: signal.id, priority: signal.kind === "unread" ? "normal" : "high", target: { kind: "service" } };
  }
}
