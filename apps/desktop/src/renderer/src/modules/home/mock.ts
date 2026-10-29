// Browser-preview data for 桌面 (dev/mockTypes.ts): cutex `user-home` (GET / PUT with a revision, the
// cover) with pins — 听书 (a service with a template tile: image + progress, services/mock.ts), a stopped
// service, an artifact and an agent — and a cover painted on a canvas. Under `?legacy` the host has no
// `user-home` (the desktop keeps the settings on this device). Preview params: `?desktop` shows the
// desktop after start (显示桌面), `?homeprofile` opens the 个人页, `?homeedit` turns on 编辑主页 (dev/devDesktop.ts),
// `?nocover` starts without a cover, `?homeconflict` answers the first PUT with 409 (another device wrote),
// `?nopins` starts with nothing pinned (the empty tray: 「＋ 固定」 and its hint), `?manypins` pins ten agents,
// `?traynotes` puts notes on two apps.
import type { ModuleMock } from "../../dev/mockTypes";
import type { HomeDoc, HomeView } from "../../../../shared/home";
import { readHomeDoc } from "../../../../shared/home";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

let revision = 3;
let doc: HomeDoc = {
  layout: "desk-c1",
  bio: "在悉尼。让智能体替我读书、整理照片、盯着 cutex 的发布。",
  sidebarEntry: true,
  showWhenEmpty: true,
  blocks: [
    { id: "profile", visible: true },
    { id: "clock", visible: true },
    { id: "tiles", visible: true },
    { id: "needs", visible: true },
    { id: "stats", visible: true },
  ],
  pins: [
    { hostId: "local", kind: "service", key: "audiobook", title: "听书", size: "w" },
    { hostId: "local", kind: "service", key: "kks-voice-audition", title: "KKS Voice Audition", size: "m" },
    { hostId: "local", kind: "artifact", key: "af-3f9a1c2e7b8d4e05a1c2d3e4f5a6b7c8@latest", title: "论文阅读清单", size: "m" },
    { hostId: "local", kind: "service", key: "host-a-image2-results", title: "HOST-A Image2 Results", size: "s" },
    { hostId: "local", kind: "agent", key: "eva", title: "Eva", size: "s" },
    { hostId: "local", kind: "agent", key: "alden", title: "Alden", size: "s" },
    { hostId: "local", kind: "agent", key: "mika", title: "Mika", size: "s" },
    { hostId: "local", kind: "agent", key: "rei", title: "Rei", size: "s" },
    { hostId: "local", kind: "url", key: "https://www.bom.gov.au/nsw/forecasts/sydney.shtml", title: "悉尼天气", size: "s" },
  ],
};
if (params.has("nopins")) doc = { ...doc, pins: [] };
// `?pingroup`: Alden + Mika pinned as one group (design 039: an agent pin listing its members, shown as a capsule).
if (params.has("pingroup")) {
  const pins = (doc.pins ?? []).filter((p) => !(p.kind === "agent" && (p.key === "alden" || p.key === "mika")));
  doc = { ...doc, pins: [...pins, { hostId: "local", kind: "agent", key: "alden", title: "Alden + Mika", members: [{ hostId: "local", key: "alden" }, { hostId: "local", key: "mika" }] }] };
}
// `?manypins`: many agents pinned (the tray fills up: 最近 gives way, then 「… N」 or 托盘两排; owner 2026-10-24).
if (params.has("manypins")) {
  const keys = ["eva", "alden", "mika", "rei", "scratch", "wave", "lead", "helper", "old1", "widgets"];
  const apps = (doc.pins ?? []).filter((p) => p.kind !== "agent");
  doc = { ...doc, pins: [...apps, ...keys.map((key) => ({ hostId: "local", kind: "agent" as const, key, title: key, size: "s" as const }))] };
}
// `?traynotes`: notes on two pinned apps (the tray writes their first line on the item; owner 2026-10-24).
if (params.has("traynotes")) {
  const notes: Record<string, string> = { audiobook: "睡前 30 分钟\n第二章读完再换书", "https://www.bom.gov.au/nsw/forecasts/sydney.shtml": "Weekend sailing check" };
  doc = { ...doc, pins: (doc.pins ?? []).map((p) => (notes[p.key] ? { ...p, note: notes[p.key] } : p)) };
}
let coverEtag: string | null = params.has("nocover") ? null : "cover-1";
let coverUrl: string | null = null;
let conflictOnce = params.has("homeconflict");

const view = (): HomeView => ({ revision, home: { ...doc, coverEtag }, coverEtag, updatedAt: new Date().toISOString() });

/** A cover painted like the prototype's scene (sky, hills, a glow), as a JPEG data URL. */
function paintCover(): string | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 900;
  const g = c.getContext("2d");
  if (!g) return null;
  const sky = g.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, "#9fbbe8");
  sky.addColorStop(0.55, "#f2cdb4");
  sky.addColorStop(1, "#e7a98f");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1600, 900);
  const sun = g.createRadialGradient(1120, 330, 10, 1120, 330, 260);
  sun.addColorStop(0, "rgba(255,243,214,0.95)");
  sun.addColorStop(1, "rgba(255,243,214,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, 1600, 900);
  const hill = (color: string, base: number, amp: number, phase: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 900);
    for (let x = 0; x <= 1600; x += 20) g.lineTo(x, base - Math.sin(x / 260 + phase) * amp - Math.sin(x / 90 + phase * 2) * amp * 0.18);
    g.lineTo(1600, 900);
    g.fill();
  };
  hill("#8fa9d6", 620, 70, 0.4);
  hill("#6f8cc4", 700, 55, 1.7);
  hill("#4f6aa3", 790, 40, 2.9);
  return c.toDataURL("image/jpeg", 0.86);
}

export const mock: ModuleMock = {
  features: { new: ["user-home"] },
  api: (core) => ({
    async userHome() {
      if (core.legacy) return { ok: true, value: null };
      return { ok: true, value: view() };
    },
    async putUserHome(rev, home) {
      if (core.legacy) throw new Error("not_found: no route");
      if (conflictOnce) {
        // Another device wrote first: its edit (a new bio) lands, the desktop must re-apply on top.
        conflictOnce = false;
        revision += 1;
        doc = { ...doc, bio: "（另一台设备改了简介）" };
        return { ok: false, error: { code: "home_revision_conflict", message: "the home page changed on another device", revision } };
      }
      if (rev !== revision) return { ok: false, error: { code: "home_revision_conflict", message: "revision mismatch", revision } };
      const next = home === null ? {} : (readHomeDoc(home) ?? {});
      if (JSON.stringify(next) !== JSON.stringify(doc)) revision += 1;
      doc = next;
      return { ok: true, value: view() };
    },
    async homeCover() {
      if (core.legacy || !coverEtag) return null;
      if (!coverUrl) coverUrl = paintCover();
      return coverUrl ? { dataUrl: coverUrl, etag: coverEtag } : null;
    },
    async putHomeCover(upload) {
      coverUrl = `data:${upload.contentType};base64,${upload.data}`;
      coverEtag = `cover-${Date.now().toString(36)}`;
      return { ok: true, value: view() };
    },
    async deleteHomeCover() {
      coverEtag = null;
      coverUrl = null;
      return { ok: true, value: view() };
    },
  }),
};
