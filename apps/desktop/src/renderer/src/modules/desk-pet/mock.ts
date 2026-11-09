// Preview of the desk pet: plays main's window service inside the page (a fixed corner picture instead of a window, no
// drag), so the settings page, tray button and identity menu can be seen. `__deskPetBurst(n)` in the console sends
// n tool-call events down the host feed; `__deskPetTokens(n)` one usage report of n new tokens.
import { DESK_PET_DEFAULTS, parseDeskPetPatch, shownPose, type DeskPetBridge, type DeskPetSettings, type DeskPetView } from "../../../../shared/deskPet";
import { DESK_PET_PLACEHOLDER_SIZE, placeholderFrame } from "../../../../shared/deskPetPlaceholder";
import type { ModuleMock } from "../../dev/mockTypes";

function canvasOf(frame: Parameters<typeof placeholderFrame>[0]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = DESK_PET_PLACEHOLDER_SIZE;
  canvas.getContext("2d")!.putImageData(new ImageData(placeholderFrame(frame) as Uint8ClampedArray<ArrayBuffer>, DESK_PET_PLACEHOLDER_SIZE), 0, 0);
  return canvas;
}

function mockBridge(): DeskPetBridge {
  let settings: DeskPetSettings = { ...DESK_PET_DEFAULTS };
  let running = false;
  const listeners = new Set<(v: DeskPetView) => void>();
  const view = (): DeskPetView => ({
    running,
    settings,
    characters: [{ id: "placeholder", name: { en: "Placeholder", "zh-CN": "占位" }, family: null, source: "placeholder", pixel: false, format: 1, books: null }],
    current: "placeholder",
    problems: [{ character: "my-character", file: "left.png", code: "notPng" }],
    artDir: "C:\\Users\\preview\\AppData\\Roaming\\Cutex\\desk-pet\\art",
    placement: "full",
    shape: true,
  });
  let picture: { box: HTMLElement; label: HTMLElement; frames: Record<"both" | "left" | "right", HTMLCanvasElement> } | null = null;
  const made = () => {
    if (picture) return picture;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;right:32px;bottom:96px;width:160px;z-index:9999;pointer-events:none;text-align:center";
    const frames = { both: canvasOf("both"), left: canvasOf("left"), right: canvasOf("right") };
    const label = document.createElement("div");
    label.style.cssText = "display:inline-block;padding:0 8px;border-radius:10px;background:rgba(30,30,32,.78);color:#fff;font:600 12px/20px system-ui";
    for (const c of Object.values(frames)) {
      c.style.cssText = "width:160px;height:160px;display:none";
      box.append(c);
    }
    box.append(label);
    frames.both.style.display = "block";
    return (picture = { box, label, frames });
  };
  const pose = (p: "both" | "left" | "right") => {
    for (const [k, c] of Object.entries(made().frames)) c.style.display = k === p ? "block" : "none";
  };
  const draw = () => {
    if (running && !settings.hidden) {
      const { box, label } = made();
      document.body.append(box);
      box.style.opacity = String(settings.opacity);
      for (const c of Object.values(made().frames)) c.style.transform = settings.mirror ? "scaleX(-1)" : "";
      label.style.display = settings.showCount ? "inline-block" : "none";
    } else picture?.box.remove();
    const v = view();
    for (const l of listeners) l(v);
    return v;
  };
  return {
    state: async () => view(),
    start: async () => {
      running = true;
      return draw();
    },
    stop: async () => {
      running = false;
      draw();
    },
    set: async (patch) => {
      settings = { ...settings, ...parseDeskPetPatch(patch) };
      return draw();
    },
    tick: async (t) => {
      if (t.pose) pose(shownPose(t.pose, settings.mirror));
      if (t.total !== undefined) made().label.textContent = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(t.total);
      if (t.mark !== undefined) made().box.style.outline = t.mark ? "3px solid #f59e0b" : "";
    },
    reloadArt: async () => draw(),
    openFolder: async () => {},
    preview: async () => {
      const c = canvasOf("both");
      return [c.toDataURL()];
    },
    follow: async () => {},
    onState: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onOpenSettings: () => () => {},
  };
}

export const mock: ModuleMock = {
  bridge: () => ({ deskPet: mockBridge() }),
  start(core) {
    (globalThis as { __deskPetBurst?: (n: number) => void }).__deskPetBurst = (n) => {
      const id = core.projectRecords().active[0]?.cutexSessionId;
      if (!id) return;
      for (let i = 0; i < n; i++) core.nativeEvent(id, "item/started", { threadId: "t", turnId: "u", item: { type: "mcpToolCall", id: `mock-${Date.now()}-${i}`, server: "s", tool: "t" } });
    };
    let total = 0;
    (globalThis as { __deskPetTokens?: (n: number) => void }).__deskPetTokens = (n) => {
      const id = core.projectRecords().active[0]?.cutexSessionId;
      if (!id) return;
      total += n;
      const t = { inputTokens: total, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: total };
      core.nativeEvent(id, "thread/tokenUsage/updated", { threadId: "pet", turnId: "u", tokenUsage: { total: t, last: t, modelContextWindow: 400_000 } });
    };
  },
};
