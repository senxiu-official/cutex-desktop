// Browser preview of signed module packs (shared/modulePacks.ts, docs/desktop-modules.md §23): plays
// main's ModulePackService. The index offers a newer claude-science (the pilot), an older one (the
// "install older version" path), one that needs a newer app, and a pack-only module whose download fails
// verification (error + retry). Installing claude-science imports the REAL pilot pack: the preview server
// (vite.preview.config.ts, plugin `mock-module-packs`) builds it with scripts/module-packs/build.mjs and
// serves its index.js, so the host object / swap / fallback run as in the app.
// localStorage "cutex-mock-packs" = "none" (no index published yet) | "offline" (check fails) | "broken"
// (an installed pack failed its start-up verification).
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
  { id: "claude-science", version: "2.0.0", moduleApi: "^1.20", compat: "needsNewerApp", size: 23950, title: { en: "Claude Science", "zh-CN": "Claude Science" } },
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
  };
  const set = (next: Partial<ModulePacksView>) => {
    view = { ...view, ...next };
    for (const l of listeners) l(view);
    return view;
  };
  const entry = (id: string, version: string): InstalledPackView => ({
    id,
    version,
    moduleApi: "^1.16",
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
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
