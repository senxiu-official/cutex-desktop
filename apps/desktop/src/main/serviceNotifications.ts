import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { CapabilitiesView, ShellNotification } from "../shared/ipc";
import { SERVICE_NOTIFICATIONS_FEATURE, type ServiceNotificationEntry, type ServiceNotificationLocator, type ServiceNotificationOpen } from "../shared/serviceNotifications";
import { userAccessOf } from "../shared/users";
import { writeFileAtomic } from "./fileWrites";

const POLL_MS = 8_000;
const NOTIFICATION_KEY_PREFIX = "service-notification:";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SERVICE_PATH = /^\/(?!\/)[a-zA-Z0-9/._~-]{0,511}$/;

interface Cursor { streamId: string; after: number }
interface Daemon {
  activeClient(): CutexClient | null;
  capabilities(): Promise<CapabilitiesView | null>;
}
interface Connection { daemon: Daemon; client: CutexClient; seen: Set<string>; supported?: boolean; timer?: ReturnType<typeof setTimeout> }
interface Options {
  userData(): string;
  daemon(hostId: string): Daemon | null;
  show(notice: ShellNotification): void;
  open(target: ServiceNotificationOpen): void;
  muted(): boolean;
}

/** Uses the short durable feed to converge after disconnects, while preview text stays in the OS notice. */
export class ServiceNotifications {
  private cursors: Map<string, Cursor> | null = null;
  private readonly connections = new Map<string, Connection>();
  private readonly targets = new Map<string, ServiceNotificationOpen>();

  constructor(private readonly options: Options) {}

  private stateFile(): string { return join(this.options.userData(), "service-notification-cursors.json"); }

  private readCursors(): Map<string, Cursor> {
    if (this.cursors) return this.cursors;
    this.cursors = new Map();
    try {
      const values = JSON.parse(readFileSync(this.stateFile(), "utf8")) as Record<string, Cursor>;
      for (const [hostId, value] of Object.entries(values).slice(0, 128)) {
        if (value && UUID.test(value.streamId) && Number.isSafeInteger(value.after) && value.after >= 0) this.cursors.set(hostId, value);
      }
    } catch { /* New device or damaged cursor file. The feed is time bounded. */ }
    return this.cursors;
  }

  private saveCursor(hostId: string, cursor: Cursor): void {
    const cursors = this.readCursors();
    const previous = cursors.get(hostId);
    if (previous?.streamId === cursor.streamId && previous.after === cursor.after) return;
    cursors.delete(hostId);
    cursors.set(hostId, cursor);
    while (cursors.size > 128) cursors.delete(cursors.keys().next().value!);
    try { writeFileAtomic(this.stateFile(), JSON.stringify(Object.fromEntries(cursors))); } catch { /* Keep the cursor in memory. */ }
  }

  onHost(hostId: string): void {
    const current = this.connections.get(hostId);
    const daemon = this.options.daemon(hostId), client = daemon?.activeClient();
    if (current && current.daemon === daemon && current.client === client) return;
    if (current) clearTimeout(current.timer);
    this.connections.delete(hostId);
    if (!daemon || !client) return;
    const connection = { daemon, client, seen: new Set<string>() };
    this.connections.set(hostId, connection);
    this.schedule(hostId, connection, 0);
  }

  private schedule(hostId: string, connection: Connection, delay: number): void {
    connection.timer = setTimeout(() => {
      void this.refresh(hostId, connection).catch(() => {}).finally(() => {
        if (this.current(hostId, connection) && connection.supported !== false) this.schedule(hostId, connection, POLL_MS);
      });
    }, delay);
    connection.timer.unref();
  }

  private current(hostId: string, connection: Connection): boolean {
    return this.connections.get(hostId) === connection && this.options.daemon(hostId) === connection.daemon
      && connection.daemon.activeClient() === connection.client;
  }

  private async refresh(hostId: string, connection: Connection): Promise<void> {
    if (!this.current(hostId, connection)) return;
    const { daemon, client } = connection;
    if (connection.supported === undefined) {
      const caps = await daemon.capabilities();
      if (!caps || !this.current(hostId, connection)) return;
      const access = userAccessOf(caps);
      connection.supported = access.isOwner && (caps.user?.scope ?? "full") === "full"
        && caps.featureList.includes(SERVICE_NOTIFICATIONS_FEATURE);
      if (!connection.supported) return;
    }
    const cursor = this.readCursors().get(hostId);
    const read = (after: number) => client.request<{ streamId: string; notifications: ServiceNotificationLocator[] }>("GET", "/v2/service-notifications",
      { query: { after: String(after), limit: "30" }, signal: AbortSignal.timeout(5_000), background: true });
    let page = await read(cursor?.after ?? 0);
    if (cursor && cursor.streamId !== page.streamId) page = await read(0);
    if (!this.current(hostId, connection) || !UUID.test(page.streamId) || !Array.isArray(page.notifications)) return;
    let after = cursor?.streamId === page.streamId ? cursor.after : 0;
    const latest = new Map<string, ServiceNotificationLocator>();
    for (const item of page.notifications) {
      if (!item || !Number.isSafeInteger(item.cursor) || item.cursor <= after) continue;
      after = item.cursor;
      if (item.desktop === true && typeof item.slug === "string" && SLUG.test(item.slug)
        && typeof item.id === "string" && UUID.test(item.id)) latest.set(item.slug, item);
    }
    // Advance after the selected notices resolve. On a transport failure the next pass retries the same IDs.
    for (const item of latest.values()) {
      if (!this.current(hostId, connection) || this.options.muted()) break;
      if (connection.seen.has(item.id)) continue;
      const reply = await client.request<{ notification: ServiceNotificationEntry }>("GET", `/v2/services/${item.slug}/notifications/${item.id}`,
        { signal: AbortSignal.timeout(5_000) }).catch(error => {
        if (error && typeof error === "object" && "status" in error && [404, 410].includes(Number(error.status))) return null;
        throw error;
      });
      if (!this.current(hostId, connection)) return;
      if (this.options.muted()) break;
      const notice = reply?.notification;
      if (!notice || notice.id !== item.id || notice.slug !== item.slug || notice.desktop !== true
        || !Number.isSafeInteger(notice.deliverUntil) || notice.deliverUntil <= Date.now() / 1000
        || typeof notice.title !== "string" || notice.title.length === 0 || notice.title.length > 200
        || (notice.body != null && (typeof notice.body !== "string" || notice.body.length > 480))) continue;
      const key = `${NOTIFICATION_KEY_PREFIX}${JSON.stringify([hostId, item.slug])}`;
      this.targets.delete(key);
      this.targets.set(key, { hostId, slug: item.slug, id: item.id, ...pathTarget(notice.target) });
      while (this.targets.size > 50) this.targets.delete(this.targets.keys().next().value!);
      this.options.show({ key, title: notice.title, body: notice.body ?? "" });
      connection.seen.add(item.id);
      if (connection.seen.size > 100) connection.seen.delete(connection.seen.keys().next().value!);
    }
    if (this.current(hostId, connection)) this.saveCursor(hostId, { streamId: page.streamId, after });
  }

  click(key: string): boolean {
    if (!key.startsWith(NOTIFICATION_KEY_PREFIX)) return false;
    const target = this.targets.get(key);
    this.targets.delete(key);
    if (target && this.options.daemon(target.hostId)?.activeClient()) this.options.open(target);
    return true;
  }

  dispose(): void {
    for (const connection of this.connections.values()) clearTimeout(connection.timer);
    this.connections.clear();
    this.targets.clear();
  }
}

function pathTarget(value: unknown): { path?: string } {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "servicePath" || !("path" in value)) return {};
  const path = value.path;
  return typeof path === "string" && SERVICE_PATH.test(path) && !path.split("/").some(segment => segment === "." || segment === "..") ? { path } : {};
}
