// Mock 百度网盘 for the renderer preview: an SVIP account with a small folder tree, search, file details,
// a device-code login that succeeds on the second poll, and downloads that move (paused / failed / done
// rows included). `?pan=unconfigured` starts with no app, `?pan=login` with an app but no login,
// `?pan=empty` with no downloads yet. Updates arrive on `panEvents` like the real feed.
import type { PanConnection, PanDownload, PanFile, PanResult } from "../../../../shared/baiduPan";
import { BAIDU_PAN_FEATURE } from "../../../../shared/baiduPan";
import type { DesktopApi } from "../../../../shared/ipc";
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

const MODE = typeof location !== "undefined" ? new URLSearchParams(location.search).get("pan") ?? "" : "";
const ok = <T,>(value: T): PanResult<T> => ({ ok: true, value: structuredClone(value) });
const no = (code: string, message: string): PanResult<never> => ({ ok: false, code, message, retryable: false });
const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const T = Math.floor(Date.now() / 1000);
const GiB = 1024 ** 3, MiB = 1024 ** 2;

const account = { id: "2081736650", name: "developer_pan", vipType: 2 };
let conn: PanConnection =
  MODE === "unconfigured" ? { configured: false, state: "disconnected", appId: null, clientId: null, account: null, expiresAt: null }
  : MODE === "login" ? { configured: true, state: "needsAuth", appId: "41785023", clientId: "Kq7…", account: null, expiresAt: null }
  : { configured: true, state: "connected", appId: "41785023", clientId: "Kq7…", account, expiresAt: new Date(Date.now() + 28 * 86400e3).toISOString() };

let nid = 1000;
const f = (path: string, isDir: boolean, size = 0, ago = 3600): PanFile => ({ id: String(nid++ * 7919), path, name: path.split("/").pop()!, isDir, size, modifiedAt: T - ago });
const TREE: PanFile[] = [
  f("/研究资料", true, 0, 86400 * 3), f("/数据集", true, 0, 86400 * 10), f("/照片", true, 0, 86400 * 40), f("/apps", true, 0, 86400 * 400),
  f("/读我.txt", false, 2_314, 86400 * 90),
  f("/研究资料/论文", true, 0, 86400 * 2), f("/研究资料/2026 组会.pptx", false, 48 * MiB, 7200), f("/研究资料/实验记录.xlsx", false, 1.2 * MiB, 86400),
  f("/研究资料/论文/mof-relax-2026.pdf", false, 6.4 * MiB, 86400 * 5), f("/研究资料/论文/appendix-data.zip", false, 3.7 * GiB, 86400 * 6),
  f("/数据集/ifm-train-v3.tar", false, 182 * GiB, 86400 * 12), f("/数据集/ifm-val-v3.tar", false, 21.5 * GiB, 86400 * 12), f("/数据集/README.md", false, 4_096, 86400 * 12),
  f("/照片/2026-春", true, 0, 86400 * 200),
];
for (let i = 1; i <= 140; i++) TREE.push(f(`/照片/2026-春/IMG_${String(4100 + i)}.HEIC`, false, Math.round((2.1 + (i % 7) * 0.3) * MiB), 86400 * 200 - i * 60));

const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
const iso = (s: number) => new Date(Date.now() - s * 1000).toISOString();
let did = 1;
const dl = (remote: string, targetDir: string, state: PanDownload["state"], total: number | null, done: number, ago: number, extra: Partial<PanDownload> = {}): PanDownload => {
  const name = remote.split("/").pop()!;
  return { id: `pdl_${did++}`, requestId: `req-${did}`, remote, targetDir, targetPath: `${targetDir}\\${name}`, state, downloadedBytes: done, totalBytes: total, bytesPerSecond: state === "downloading" ? 38 * MiB : 0, caller: { kind: "owner", id: null }, createdAt: iso(ago), updatedAt: iso(Math.max(0, ago - 5)), error: null, ...extra };
};
const downloads = new Map<string, PanDownload>();
if (MODE !== "empty" && MODE !== "unconfigured")
  for (const d of [
    dl("/数据集/ifm-val-v3.tar", "D:\\Data\\baidu", "downloading", 21.5 * GiB, 7.9 * GiB, 240),
    dl("/研究资料/论文/appendix-data.zip", "D:\\Data\\baidu", "queued", 3.7 * GiB, 0, 120),
    dl("/研究资料/2026 组会.pptx", "D:\\Users\\developer\\Downloads", "completed", 48 * MiB, 48 * MiB, 3600),
    dl("/数据集/ifm-train-v3.tar", "D:\\Data\\baidu", "paused", 182 * GiB, 64.2 * GiB, 7200),
    dl("/研究资料/实验记录.xlsx", "/srv/data/agent-work/downloads/baidu", "failed", 1.2 * MiB, 0, 5400, { caller: { kind: "agent", id: "eva" }, error: { code: "pan_storage_error", message: "disk full", retryable: true } }),
  ]) downloads.set(d.id, d);

let authPolls = 0;
const watches = new Set<string>();
let wid = 0;

function api(core: MockCore): Partial<DesktopApi> {
  const push = (d: PanDownload) => { for (const watchId of watches) core.emit("panEvents", { watchId, kind: "download", download: structuredClone(d) }); };
  const connected = () => conn.state === "connected";
  return {
    async panConnection() { await delay(); return ok(conn); },
    async panConfigure(input) {
      await delay(300);
      if (!/^\d{4,}$/.test(input.appId.trim())) return no("invalid_request", "AppId must be digits");
      conn = { ...conn, configured: true, state: "needsAuth", appId: input.appId.trim(), clientId: input.clientId.trim().slice(0, 3) + "…" };
      return ok(conn);
    },
    async panDisconnect() { await delay(); conn = { ...conn, state: "disconnected", account: null, expiresAt: null }; return ok({ disconnected: true as const }); },
    async panAuthStart() { await delay(300); authPolls = 0; return ok({ id: "auth_1", state: "pending" as const, verificationUrl: "https://openapi.baidu.com/device", userCode: "QK7M-4TZP", expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 5 }); },
    async panAuthPoll(id) {
      await delay();
      if (++authPolls < 2) return ok({ id, state: "pending" as const });
      conn = { ...conn, state: "connected", account, expiresAt: new Date(Date.now() + 30 * 86400e3).toISOString() };
      return ok({ id, state: "connected" as const, connection: conn });
    },
    async panAuthCode(code) {
      await delay(300);
      if (code.trim().length < 6) return no("pan_needs_auth", "invalid code");
      conn = { ...conn, state: "connected", account, expiresAt: new Date(Date.now() + 30 * 86400e3).toISOString() };
      return ok(conn);
    },
    async panFiles(dir, start = 0, limit = 100) {
      await delay();
      if (!connected()) return no("pan_needs_auth", "sign in");
      const all = TREE.filter((x) => parent(x.path) === dir).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh"));
      const page = all.slice(start, start + limit);
      return ok({ files: page, hasMore: start + limit < all.length, nextStart: start + limit < all.length ? start + limit : null });
    },
    async panSearch(key, dir) {
      await delay(350);
      const k = key.toLowerCase();
      const hits = TREE.filter((x) => (dir === "/" || x.path.startsWith(dir + "/")) && x.name.toLowerCase().includes(k));
      return ok({ files: hits.slice(0, 50), hasMore: hits.length > 50 });
    },
    async panMeta(path) { await delay(); const x = TREE.find((y) => y.path === path); return x ? ok({ file: x }) : no("pan_not_found", "not found"); },
    async panDownloads() { await delay(); return ok({ downloads: [...downloads.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }); },
    async panStartDownload(req) {
      await delay(250);
      const x = TREE.find((y) => y.path === req.remote);
      if (!x || x.isDir) return no("pan_not_found", "not a file");
      const d = dl(req.remote, req.targetDir, "queued", x.size, 0, 0, { requestId: req.requestId });
      d.targetPath = `${req.targetDir.replace(/[\\/]+$/, "")}${req.targetDir.includes("\\") ? "\\" : "/"}${x.name}`;
      downloads.set(d.id, d);
      return ok({ download: d });
    },
    async panDownloadAction(id, action) {
      await delay();
      const d = downloads.get(id);
      if (!d) return no("pan_not_found", "no such download");
      const next: PanDownload["state"] = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "queued";
      Object.assign(d, { state: next, bytesPerSecond: 0, error: action === "resume" ? null : d.error, updatedAt: new Date().toISOString() });
      push(d);
      return ok({ download: d });
    },
    async watchPan() {
      const watchId = `mock-pan-${++wid}`;
      watches.add(watchId);
      setTimeout(() => watches.has(watchId) && core.emit("panEvents", { watchId, kind: "status", status: "live" }), 200);
      return watchId;
    },
    async unwatchPan(watchId) { watches.delete(watchId); },
  };
}

/** Each second: the first queued row starts when none runs; running rows move ~38 MiB/s with some jitter. */
function start(core: MockCore) {
  setInterval(() => {
    if (!watches.size) return; // nobody follows: the preview idles like the real page
    const rows = [...downloads.values()];
    if (!rows.some((d) => d.state === "downloading")) {
      const q = rows.filter((d) => d.state === "queued").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
      if (q) q.state = "downloading";
    }
    for (const d of rows) {
      if (d.state !== "downloading") continue;
      d.bytesPerSecond = Math.round((30 + Math.random() * 16) * MiB);
      d.downloadedBytes = Math.min(d.totalBytes ?? Infinity, d.downloadedBytes + d.bytesPerSecond);
      if (d.totalBytes != null && d.downloadedBytes >= d.totalBytes) Object.assign(d, { state: "completed", bytesPerSecond: 0 });
      d.updatedAt = new Date().toISOString();
      for (const watchId of watches) core.emit("panEvents", { watchId, kind: "download", download: structuredClone(d) });
    }
  }, 1000);
}

export const mock: ModuleMock = {
  api,
  start,
  features: { new: [BAIDU_PAN_FEATURE] },
};
