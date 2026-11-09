// Browser preview of signed module packs (shared/modulePacks.ts, docs/desktop-modules.md §23): plays
// main's ModulePackService. The index offers a newer claude-science (the pilot), an older one (the
// "install older version" path), one that needs a newer app, and a pack-only module whose download fails
// verification (error + retry). Installing claude-science imports the REAL pilot pack: the preview server
// (vite.preview.config.ts, plugin `mock-module-packs`) builds it with scripts/module-packs/build.mjs and
// serves its index.js, so the host object / swap / fallback run as in the app.
// localStorage "cutex-mock-packs" = "none" (no index published yet) | "offline" (check fails) | "broken"
// (an installed pack failed its start-up verification).
import type { ModuleDevBridge, ModuleDevView } from "../../../shared/moduleDev";
import type { InstalledPackView, ModulePacksBridge, ModulePacksView, PackStep } from "../../../shared/modulePacks";

const STEP_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scenario(): string {
  try {
    return localStorage.getItem("cutex-mock-packs") ?? "";
  } catch {
    return "";
  }
}

const INDEX_PACKS: NonNullable<ModulePacksView["index"]>["packs"] = [
  { id: "claude-science", version: "1.1.0", moduleApi: "^1.16", compat: "ok", size: 22746, title: { en: "Claude Science", "zh-CN": "Claude Science" } },
  { id: "claude-science", version: "1.0.1", moduleApi: "^1.16", compat: "ok", size: 22701, title: { en: "Claude Science", "zh-CN": "Claude Science" } },
  { id: "claude-science", version: "2.0.0", moduleApi: "^1.21", compat: "needsNewerApp", size: 23950, title: { en: "Claude Science", "zh-CN": "Claude Science" } },
  { id: "desk-pet", version: "1.2.1", moduleApi: "^1.30", compat: "ok", size: 21000, title: { en: "Desk pet", "zh-CN": "桌宠" }, description: { en: "A little character that types while your agents use tokens", "zh-CN": "一个小角色：智能体用 token 时它敲得起劲" } },
  {
    id: "lab-notes",
    version: "0.3.0",
    moduleApi: "^1.16",
    compat: "ok",
    size: 8812,
    title: { en: "Lab notes", "zh-CN": "实验记录" },
    description: { en: "A notebook page per host (preview: its download fails verification)", "zh-CN": "每台主机一页实验记录（预览：下载后校验失败）" },
  },
];

/** Developer mode in the preview: the switch and the rows, with nothing to load (shared/moduleDev.ts). */
export function mockModuleDev(): ModuleDevBridge {
  let view: ModuleDevView = { enabled: false, internal: true, skipped: false, modules: [] };
  const listeners = new Set<(v: ModuleDevView) => void>();
  const set = (next: ModuleDevView) => {
    view = next;
    for (const l of listeners) l(view);
    return Promise.resolve(view);
  };
  return {
    state: () => Promise.resolve(view),
    setEnabled: (enabled) => set({ ...view, enabled }),
    addFolder: () => set({ ...view, modules: [...view.modules, { folder: `D:/work/module-${view.modules.length + 1}`, id: null, version: null, moduleApi: null, rev: 0, entry: null, styles: [], host: {}, error: "no build in dist/ (run cutex-module build)" }] }),
    removeFolder: (folder) => set({ ...view, modules: view.modules.filter((m) => m.folder !== folder) }),
    report: () => Promise.resolve(view),
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function mockModulePacks(): ModulePacksBridge {
  const listeners = new Set<(v: ModulePacksView) => void>();
  const mode = scenario();
  let view: ModulePacksView = {
    appModuleApi: "1.16",
    testKey: true,
    installed: [],
    broken: mode === "broken" ? [{ id: "claude-science", version: "1.0.1", error: "index.js does not match its signed hash" }] : [],
    index: null,
    checking: false,
    check: null,
    operation: null,
    lastError: null,
    local: { allowed: true, internal: true, safeStart: null, held: [], error: null },
  };
  const set = (next: Partial<ModulePacksView>) => {
    view = { ...view, ...next };
    for (const l of listeners) l(view);
    return view;
  };
  const entry = (id: string, version: string): InstalledPackView => ({
    id,
    version,
    moduleApi: INDEX_PACKS.find((p) => p.id === id && p.version === version)?.moduleApi ?? "^1.16",
    compat: "ok",
    entry: `/__mock-pack/${id}/${version}/index.js`,
    styles: [],
    host: {},
    ...(INDEX_PACKS.find((p) => p.id === id)?.title ? { title: INDEX_PACKS.find((p) => p.id === id)!.title } : {}),
  });
  let busy = false;

  return {
    state: async () => view,
    async check() {
      set({ checking: true });
      await sleep(600);
      if (mode === "none") return set({ checking: false, index: null, check: { kind: "noRelease", error: "no module index is published yet" } });
      if (mode === "offline") return set({ checking: false, check: { kind: "unreachable", error: "cannot reach github.com: getaddrinfo ENOTFOUND github.com" } });
      return set({ checking: false, check: null, index: { serial: 1792253158, generatedAt: "2026-10-17T16:05:58Z", checkedAt: Date.now(), packs: INDEX_PACKS } });
    },
    async install({ id, version }) {
      if (busy) throw new Error("busy: busy with another pack");
      busy = true;
      const target = version ?? INDEX_PACKS.filter((p) => p.id === id && p.compat === "ok")[0]?.version ?? null;
      try {
        for (const step of ["download", "verify", "unpack"] as PackStep[]) {
          set({ operation: { id, action: "install", version: target, step }, lastError: null });
          await sleep(STEP_MS);
          if (id === "lab-notes" && step === "verify") {
            return set({ operation: null, lastError: { id, action: "install", message: "index.js does not match the signed sha256", code: "verify_failed", retry: version ? { version } : {} } });
          }
        }
        return set({ operation: null, installed: [...view.installed.filter((p) => p.id !== id), entry(id, target!)], broken: view.broken.filter((b) => b.id !== id) });
      } finally {
        busy = false;
      }
    },
    async remove({ id }) {
      return set({ installed: view.installed.filter((p) => p.id !== id), broken: view.broken.filter((b) => b.id !== id), lastError: view.lastError?.id === id ? null : view.lastError });
    },
    // Stands in for main's file dialog and confirm: the preview always picks the desk pet.
    async installLocal() {
      return set({ installed: [...view.installed.filter((p) => p.id !== "desk-pet"), { ...entry("desk-pet", "1.2.1"), local: true }] });
    },
    async allowLocal({ allow }) {
      return set({ local: { ...view.local, allowed: allow } });
    },
    async localFailed({ id, version, reason }) {
      return set({ installed: view.installed.filter((p) => p.id !== id), local: { ...view.local, held: [...view.local.held, { id, version, reason: "failed", detail: reason }] } });
    },
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
