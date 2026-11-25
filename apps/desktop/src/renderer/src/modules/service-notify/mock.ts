// Browser-preview data for 服务通知 (cutex service-notifications-v1; all synthetic — no real message text or QR).
// - Settings per service like cutex: PUT takes the five fields, quiet hours need start ≠ end, WhatsApp refuses
//   retainContent = true. `?snSaveFail`: the first PUT fails (保存失败 → 重试). `?snNoCred`: no service has a credential.
// - History: synthetic entries over the last days across several services, paged by `before` / `nextBefore`
//   (`?snHistory=empty|error|many`).
// - WhatsApp's own stand-in (`?wa`, `?waState`) is in modules/whatsapp/mock.ts; its service and history rows stay here.
// - `?snClickAt=<s>`: a clicked desktop notification (`serviceNotificationOpen`) for demo-notebook /lab.
// `?legacy`: an older cutex without the feature (the 通知 card and the page are hidden / say 升级).
import { SERVICE_NOTIFICATIONS_FEATURE, type ServiceNotificationConfiguration, type ServiceNotificationEntry, type ServiceNotificationSettings } from "../../../../shared/serviceNotifications";
import type { ModuleMock } from "../../dev/mockTypes";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const DAY = 86_400;

const settings = new Map<string, ServiceNotificationSettings>([
  ["whatsapp", { enabled: true, desktop: true, phone: true, retainContent: false, quietHours: { startMinute: 23 * 60, endMinute: 7 * 60 } }],
  ["demo-notebook", { enabled: true, desktop: true, phone: false, retainContent: true, quietHours: null }],
  ["host-a-experiment-console", { enabled: true, desktop: false, phone: true, retainContent: true, quietHours: { startMinute: 12 * 60 + 30, endMinute: 14 * 60 } }],
]);
const DEFAULT: ServiceNotificationSettings = { enabled: false, desktop: true, phone: true, retainContent: false, quietHours: null };
let failNext = params.has("snSaveFail");
let coreRef: { legacy: boolean } = { legacy: false };
const core = () => coreRef;
const RETENTION = { maxAgeSeconds: 7 * 86_400, maxPerService: Number(params.get("snPerService")) || 200, maxPerHost: Number(params.get("snPerHost")) || 2000 };

function configuration(slug: string): ServiceNotificationConfiguration {
  const credential = !params.has("snNoCred") && (slug === "whatsapp" || settings.has(slug));
  const phone = params.has("snNoAndroid") ? { androidPaired: false, reachable: false } : params.has("snAndroidAway") ? { androidPaired: true, reachable: false } : { androidPaired: true, reachable: true };
  const extra = core().legacy ? {} : { timezone: { iana: params.has("snPosixTz") ? null : "Australia/Sydney", offsetSeconds: 11 * 3600 }, phone };
  return { settings: structuredClone(settings.get(slug) ?? DEFAULT), credentialConfigured: credential, supervisedCredential: credential && slug !== "whatsapp", ...extra };
}

/** Synthetic history, newest first by cursor. */
function history(): ServiceNotificationEntry[] {
  const mode = params.get("snHistory");
  if (mode === "empty") return [];
  const now = Math.floor(Date.now() / 1000);
  const rows: Omit<ServiceNotificationEntry, "cursor" | "id" | "deliverUntil" | "desktop" | "phone">[] = [
    { slug: "whatsapp", serviceName: "WhatsApp", title: "发来新消息 / New message", body: null, priority: "normal", target: { kind: "service" }, createdAt: now - 90 },
    { slug: "demo-notebook", serviceName: "Demo Notebook", title: "训练完成：run-42", body: "验证集准确率 91.3%，用时 2 小时 14 分", priority: "normal", target: { kind: "servicePath", path: "/lab" }, createdAt: now - 1_500 },
    { slug: "host-a-experiment-console", serviceName: "HOST-A Experiment Console", title: "GPU 温度过高", body: "GPU 1 达到 88°C，已暂停新任务", priority: "high", target: { kind: "servicePath", path: "/gpus/1" }, createdAt: now - 3_900 },
    { slug: "whatsapp", serviceName: "WhatsApp", title: "发来新消息 / New message", body: null, priority: "normal", target: { kind: "service" }, createdAt: now - 7_400 },
    { slug: "demo-notebook", serviceName: "Demo Notebook", title: "A very long synthetic notification title that keeps going to check truncation in narrow cards and English layout", body: "Body text that is equally long so the detail line has to truncate instead of wrapping the row height", priority: "normal", target: null, createdAt: now - DAY - 600 },
    { slug: "gone-service", serviceName: "已删除的服务", title: "旧通知", body: null, priority: "normal", target: { kind: "service" }, createdAt: now - 2 * DAY },
  ];
  const extra = mode === "many" ? 130 : 12;
  for (let i = 0; i < extra; i++) {
    rows.push({ slug: i % 3 ? "demo-notebook" : "whatsapp", serviceName: i % 3 ? "Demo Notebook" : "WhatsApp", title: i % 3 ? `检查点 ${i + 1} 已保存` : "发来新消息 / New message", body: i % 3 ? `step ${1000 * (i + 1)}` : null, priority: "normal", target: i % 3 ? { kind: "servicePath", path: "/lab" } : { kind: "service" }, createdAt: now - 2 * DAY - i * 1_800 });
  }
  return rows.map((r, i) => ({ ...r, cursor: 10_000 - i, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, deliverUntil: r.createdAt + 600, desktop: true, phone: r.slug !== "demo-notebook" }));
}

export const mock: ModuleMock = {
  features: { new: [SERVICE_NOTIFICATIONS_FEATURE] },
  api: (core) => (coreRef = core, {
    async serviceNotificationSettings(slug) {
      if (core.legacy) throw new Error("404 not_found");
      return configuration(slug);
    },
    async setServiceNotificationSettings(slug, next) {
      await new Promise((r) => setTimeout(r, 450));
      if (failNext) {
        failNext = false;
        throw new Error("503 service_notifications_unavailable: service notification storage is unavailable");
      }
      if (slug === "whatsapp" && next.retainContent) throw new Error("400 invalid_request: WhatsApp history cannot retain content");
      const q = next.quietHours;
      if (q && (q.startMinute === q.endMinute || q.startMinute >= 1440 || q.endMinute >= 1440)) throw new Error("400 invalid_request: quiet hours must have distinct start and end minutes between 0 and 1439");
      settings.set(slug, structuredClone(next));
      return configuration(slug);
    },
    async serviceNotificationHistory(query) {
      if (core.legacy) throw new Error("404 not_found");
      if (params.get("snHistory") === "error") throw new Error("503 service_notifications_unavailable");
      await new Promise((r) => setTimeout(r, 200));
      const limit = query.limit ?? 50;
      const all = history().filter((e) => (!query.service || e.slug === query.service) && (query.before === undefined || e.cursor < query.before));
      const page = all.slice(0, limit);
      return { notifications: page, nextBefore: all.length > limit ? page[page.length - 1]!.cursor : null, ...(core.legacy ? {} : { retention: RETENTION }) };
    },
  }),
  start: (core) => {
    const at = Number(params.get("snClickAt"));
    if (at > 0) setTimeout(() => core.emit("serviceNotificationOpen", { hostId: "local", slug: "demo-notebook", id: "00000000-0000-4000-8000-000000000001", path: "/lab" }), at * 1000);
  },
};
