// Preview mock of Settings → 外观 → 中文字体包 (shared/fontCatalog.ts). The preview has no main process, so installed
// families have no files to serve: picking one shows the fallback note, as a real failed load would.
// `?fontpack=some` starts with 狮尾四季春 installed. 导入字体包… pretends the folder held 狮尾四季春加糖 complete and one
// changed file. 下载并安装 runs a 6-second fake download (cancel works); `?fontpack=fail` makes it stop at 40% with a
// network error, after which 继续下载 finishes it. `?fontpack=downloading` opens with a download at 35% that waits.
import type { FontPackBridge, FontPackDownload, FontPackState } from "../../../shared/fontCatalog";
import { FONT_PACK_ARCHIVE, PACK_FONTS } from "../../../shared/fontCatalog";

export function mockFontPack(): FontPackBridge {
  const mode = new URLSearchParams(location.search).get("fontpack");
  const installed = new Map<string, number>(mode === "some" ? [["swei-spring", 3]] : []);
  const total = FONT_PACK_ARCHIVE.bytes;
  let progress: FontPackDownload | undefined = mode === "downloading" ? { phase: "downloading", received: Math.round(total * 0.35), total } : undefined;
  let failOnce = mode === "fail";
  let cancel: (() => void) | null = null;
  const listeners = new Set<(state: FontPackState) => void>();
  const state = (): FontPackState => ({
    families: PACK_FONTS.map((e) => ({ id: e.id, installed: installed.get(e.id) ?? 0, total: e.faces.length, bytes: e.faces.reduce((n, f) => n + f.bytes, 0) })),
    ...(progress ? { download: progress } : {}),
  });
  const push = (next: FontPackDownload | undefined) => {
    progress = next;
    for (const l of listeners) l(state());
  };
  return {
    async state() {
      return state();
    },
    async import() {
      await new Promise((r) => setTimeout(r, 400));
      const sugar = PACK_FONTS.find((e) => e.id === "swei-spring-sugar")!;
      installed.set(sugar.id, sugar.faces.length);
      return { canceled: false, imported: sugar.faces.map((f) => f.file), refused: ["zhuque-fangsong-normal-400.ttf"], state: state() };
    },
    async remove(id) {
      installed.delete(id);
      return state();
    },
    async openFolder() {},
    download() {
      return new Promise<FontPackState>((resolve) => {
        let received = progress?.phase === "failed" ? progress.received : 0;
        let stopped = false;
        cancel = () => {
          stopped = true;
          push(undefined);
          resolve(state());
        };
        const step = () => {
          if (stopped) return;
          received = Math.min(total, received + total / 30);
          if (failOnce && received >= total * 0.4) {
            failOnce = false;
            push({ phase: "failed", received, total, error: "network" });
            return resolve(state());
          }
          if (received < total) {
            push({ phase: "downloading", received, total });
            return void setTimeout(step, 200);
          }
          push({ phase: "verifying", received, total });
          setTimeout(() => {
            push({ phase: "installing", received, total });
            setTimeout(() => {
              for (const e of PACK_FONTS) installed.set(e.id, e.faces.length);
              push(undefined);
              resolve(state());
            }, 500);
          }, 500);
        };
        step();
      });
    },
    async cancelDownload() {
      cancel?.();
    },
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
