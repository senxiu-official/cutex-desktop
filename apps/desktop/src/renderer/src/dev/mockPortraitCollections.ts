// Browser preview of 完整头像主题 (shared/portraitCollections.ts, docs/desktop-optional-collections.md): plays main's
// PortraitCollections service. A checked catalogue with mixed themes: two downloaded (one with an update), one kept from
// an older app (version 0), one with nothing in the catalogue (starter pictures only), the rest downloadable. Installing
// steps through check → download (bytes) → verify → install; 「girls-night-in」 fails its download the first time.
// localStorage "cutex-mock-portraits" = "unchecked" (no catalogue yet) | "offline" (catalogue unreachable) |
// "downloading" (one theme stays at 45 %) | "error" (one theme failed verification).
// Keep portrait picture ids out of this file and dev/mockBridge.ts alike: the starter build checks mock references.
import type { PortraitCollectionsBridge, PortraitCollectionsView } from "../../../shared/portraitCollections";
import { DEFAULT_PORTRAIT_THEME_IDS } from "../../../shared/portraitDefaults";

const TICK_MS = 450;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function scenario(): string {
  try {
    return localStorage.getItem("cutex-mock-portraits") ?? "";
  } catch {
    return "";
  }
}

type Row = PortraitCollectionsView["themes"][number];

/** The catalogue the preview "publishes": every theme but the last, version 2 for three of them. */
function catalogue(): Row[] {
  return DEFAULT_PORTRAIT_THEME_IDS.slice(0, -1).map((theme, i) => ({ theme, available: i < 3 ? 2 : 1, installed: null, bytes: Math.round((2.4 + ((i * 7) % 11) * 0.37) * MB) }));
}

/** What this device has: 1 at v2, 1 at v1 (update offered), 1 kept from an older app. */
const INSTALLED: Record<string, number> = { "cloud-woven-silks": 2, "great-ming": 1, "tales-of-frills": 0 };

export function mockPortraitCollections(emit: (view: PortraitCollectionsView, packsChanged: boolean) => void): PortraitCollectionsBridge {
  const mode = scenario();
  const local = (): Row[] => Object.entries(INSTALLED).map(([theme, installed]) => ({ theme, available: null, installed, bytes: null }));
  const merged = (): Row[] => catalogue().map((r) => ({ ...r, installed: INSTALLED[r.theme] ?? null, available: r.theme === "tales-of-frills" ? null : r.available }));
  let view: PortraitCollectionsView = {
    checked: mode !== "unchecked" && mode !== "offline",
    themes: mode === "unchecked" || mode === "offline" ? local() : merged(),
    operation: null,
    error: mode === "offline" ? { code: "index_unavailable", theme: null } : mode === "error" ? { code: "verify_failed", theme: "snowy-owl-post" } : null,
  };
  if (mode === "downloading") {
    const row = view.themes.find((r) => r.theme === "ad-astra")!;
    view = { ...view, operation: { theme: "ad-astra", step: "download", received: Math.round(row.bytes! * 0.45), total: row.bytes! } };
  }
  const failedOnce = new Set<string>();
  const set = (next: Partial<PortraitCollectionsView>, packsChanged = false) => {
    view = { ...view, ...next };
    emit(view, packsChanged);
    return view;
  };
  let last: { theme: string | null } | null = null;

  async function check(): Promise<PortraitCollectionsView> {
    set({ operation: { theme: null, step: "check" }, error: null });
    await sleep(TICK_MS * 2);
    return set({ operation: null, checked: true, themes: merged().map((r) => ({ ...r, installed: view.themes.find((x) => x.theme === r.theme)?.installed ?? r.installed })) });
  }

  async function install(theme: string): Promise<PortraitCollectionsView> {
    last = { theme };
    if (!view.checked) {
      set({ operation: { theme, step: "check" }, error: null });
      await sleep(TICK_MS * 2);
      set({ checked: true, themes: merged() });
    }
    const row = view.themes.find((r) => r.theme === theme);
    if (!row || row.available === null) return set({ operation: null, error: { code: "not_available", theme } });
    const total = row.bytes ?? 3 * MB;
    for (let i = 0; i <= 6; i++) {
      set({ operation: { theme, step: "download", received: Math.round((total * i) / 6), total }, error: null });
      await sleep(TICK_MS);
      if (theme === "girls-night-in" && i === 3 && !failedOnce.has(theme)) {
        failedOnce.add(theme);
        return set({ operation: null, error: { code: "download_failed", theme } });
      }
    }
    for (const step of ["verify", "install"] as const) {
      set({ operation: { theme, step, total, received: total } });
      await sleep(TICK_MS * 2);
    }
    last = null;
    return set({ operation: null, error: null, themes: view.themes.map((r) => (r.theme === theme ? { ...r, installed: r.available } : r)) }, true);
  }

  return {
    state: async () => view,
    check: () => (view.operation ? Promise.resolve(view) : check()),
    install: (theme) => (view.operation ? Promise.resolve(view) : install(theme)),
    retry: () => {
      if (view.operation || !view.error) return Promise.resolve(view);
      const theme = view.error.theme ?? last?.theme ?? null;
      return theme ? install(theme) : check();
    },
  };
}
