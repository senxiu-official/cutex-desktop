// The timeline intro (contract v1.13, docs/desktop-modules.md §19.3): the slot's show condition
// (session start on screen, not while loading / failed), the one-item pick, the intro module's
// portrait / greeting fallbacks and placeholder substitution, and the local store's caps and
// cleaning (lib/introAppearance). The outlet itself is rendered for real (renderToStaticMarkup,
// like admissionQueuePanel / browserModule): the total toggle, the loading gate and the isolation
// of a throwing `when` / render are behaviour, not source-regex guesses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

// node has no localStorage; the stores under test need one before their modules load.
const backing = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
};
vi.stubGlobal("localStorage", localStorageStub);

const SRC = join(__dirname, "../src/renderer/src");
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { startAppModules } = await import("../src/renderer/src/modules/app");
const { defineModule, SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { timelineAtStart, pickTimelineIntroItem } = await import("../src/renderer/src/modules/timelineIntroLogic");
const { TimelineIntro } = await import("../src/renderer/src/modules/TimelineIntroView");
const { setUiPref } = await import("../src/renderer/src/lib/prefs");
const {
  INTRO_PORTRAIT_TOO_LARGE,
  cleanIntroGreeting,
  introAppearanceOf,
  introPortraitProblem,
  resolveIntroGreeting,
  resolveIntroPortrait,
  setIntroAppearance,
  validIntroPortrait,
  INTRO_GREETING_MAX,
} = await import("../src/renderer/src/lib/introAppearance");
const { providerGreetings } = await import("../src/renderer/src/lib/providerGreetings");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const props = { sessionId: "eva", hostId: "local", profileName: "gamma", providerKind: null, agentName: "Eva" };

function entry(over: { id: `${string}.${string}`; order?: number; mode?: string; when?: () => boolean }) {
  return {
    item: { id: over.id, order: over.order, when: over.when, render: () => null },
    moduleId: over.id.split(".")[0]!,
    mode: (over.mode ?? "show") as "show",
    missing: [],
    waiting: false,
  };
}

describe("timeline.intro slot (v1.13)", () => {
  it("shows only while the session's start is on screen (hiddenTurns / older cursor)", () => {
    expect(timelineAtStart(0, null)).toBe(true);
    expect(timelineAtStart(0, undefined)).toBe(true);
    expect(timelineAtStart(3, null)).toBe(false); // 显示更早 window still hides the start
    expect(timelineAtStart(0, "before:40")).toBe(false); // an older page is still on the host
  });

  it("picks the first available item by order; `when` may pass it over; none → null", () => {
    const late = entry({ id: "a.late", order: 300 });
    const early = entry({ id: "b.early", order: 100 });
    expect(pickTimelineIntroItem([late, early], props)?.item.id).toBe("b.early");
    // Unavailable entries are skipped entirely.
    expect(pickTimelineIntroItem([entry({ id: "a.off", order: 50, mode: "hide" }), late], props)?.item.id).toBe("a.late");
    // The first item's `when` refuses this session → the next available one shows.
    const picky = entry({ id: "a.picky", order: 100, when: () => false });
    expect(pickTimelineIntroItem([picky, late], props)?.item.id).toBe("a.late");
    // A throwing `when` skips that item (reported under its module) — the next one still shows.
    const reported: string[] = [];
    const boom = entry({ id: "a.boom", order: 50, when: () => { throw new Error("when-boom"); } });
    expect(pickTimelineIntroItem([boom, late], props, (e) => reported.push(e.moduleId))?.item.id).toBe("a.late");
    expect(reported).toEqual(["a"]);
    expect(pickTimelineIntroItem([boom], props)).toBeNull();
    expect(pickTimelineIntroItem([entry({ id: "a.x", when: () => false }), entry({ id: "a.y", order: 10, when: () => false })], props)).toBeNull();
    expect(pickTimelineIntroItem([], props)).toBeNull();
  });

  it("hides by default (unavailable \"hide\") and the host renders it only in the owner's conversation", () => {
    expect(SLOT_SPECS["timeline.intro"].unavailable).toBe("hide");
    // The call site passes TimelineBody's own loading / failed (primitives, so the outlet's memo
    // holds): while the first page loads or failed, the opening must not appear-then-vanish.
    const timeline = readFileSync(join(SRC, "components/Timeline.tsx"), "utf8");
    expect(timeline).toMatch(/\{!readOnly && <TimelineIntro sessionId=\{sessionId\} hiddenTurns=\{hiddenTurns\} olderCursor=\{older\?\.cursor \?\? null\} loading=\{loading\} failed=\{failed\} \/>/);
  });

  it("the preview mock writes the real store key on the real local host id", () => {
    // The mock may not import lib/ (dev boundary), so it repeats the key and host id by hand —
    // pin both against drift, or the preview silently loses its seeded opening.
    const lib = readFileSync(join(SRC, "lib/introAppearance.ts"), "utf8");
    const mock = readFileSync(join(SRC, "modules/intro/mock.ts"), "utf8");
    const keyOf = (src: string) => src.match(/KEY = "([^"]+)"/)?.[1] ?? null;
    expect(keyOf(mock)).toBe(keyOf(lib));
    expect(mock).toMatch(/HOST = "local"/);
  });
});

describe("the intro module's contribution", () => {
  const gated = async (features: readonly string[] | null) => {
    const host = createModuleHost({ modules: MODULES, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: features && new Set(features) }, storage: memoryStorage(), services: () => stubServices(), log: () => {} });
    await host.idle();
    return host;
  };
  function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }

  it("intro.opening is the one item, whatever the host supports; module off → the slot is empty", async () => {
    for (const features of [[], null] as const) {
      const host = await gated(features);
      expect(host.snapshot("timeline.intro").map((e) => e.item.id)).toEqual(["intro.opening"]);
      expect(host.snapshot("timeline.intro").map((e) => e.item.id)).toEqual(["intro.opening"]);
    }
    const host = await gated([]);
    await host.setEnabled("intro", false);
    expect(host.snapshot("timeline.intro")).toEqual([]);
  });
});

// ── the outlet, rendered for real ─────────────────────────────────────────────────────────────

/** A probe item that wins the pick (order 0) and can be told to throw in `when` or in render. */
let probeMode: "quiet" | "when-boom" | "render-boom" = "quiet";
const probe = defineModule({
  id: "probe",
  titleKey: "intro.moduleTitle",
  descriptionKey: "intro.moduleDescription",
  contributes: {
    "timeline.intro": [
      {
        id: "probe.opening",
        order: 0,
        when: () => {
          if (probeMode === "when-boom") throw new Error("probe when-boom");
          return true;
        },
        render: () => {
          if (probeMode === "render-boom") throw new Error("probe render-boom");
          return createElement("span", null, "probe-opening");
        },
      },
    ],
  },
});

describe("the outlet (modules/TimelineIntro), rendered", () => {
  const render = (over: { hiddenTurns?: number; olderCursor?: string | null; loading?: boolean; failed?: boolean } = {}) =>
    renderToStaticMarkup(createElement(TimelineIntro, { sessionId: "eva", hiddenTurns: over.hiddenTurns ?? 0, olderCursor: over.olderCursor ?? null, loading: over.loading ?? false, failed: over.failed ?? false }));

  beforeAll(async () => {
    // Without the intro module: its Opening needs the daemon/listProfiles lifecycle, which a
    // static render cannot run — the probe already exercises the outlet's own behaviour.
    await (await startAppModules([...MODULES.filter((m) => m.id !== "intro"), probe])).idle();
  });
  beforeEach(() => {
    vi.stubGlobal("localStorage", localStorageStub);
    probeMode = "quiet";
    setUiPref("timelineIntro", true);
  });

  it("renders the picked item's opening (the probe wins by order)", () => {
    expect(render()).toContain("probe-opening");
    expect(render()).toContain('data-timeline-intro="eva"');
    expect(render({ hiddenTurns: 3 })).toBe("");
    expect(render({ olderCursor: "before:40" })).toBe("");
  });

  it("设置 → 对话 → 显示会话开场 off → nothing renders at all", () => {
    setUiPref("timelineIntro", false);
    expect(render()).toBe("");
  });

  it("hidden while the first page is loading, and after it failed (no appear-then-vanish flash)", () => {
    expect(render({ loading: true })).toBe("");
    expect(render({ failed: true })).toBe("");
    expect(render()).toContain("probe-opening");
  });

  it("a throwing `when` is isolated: no crash, the bad item is skipped (here: nothing else to show)", () => {
    probeMode = "when-boom";
    const markup = render();
    expect(markup).toContain('data-timeline-intro="eva"');
    expect(markup).not.toContain("probe-opening");
  });

  it("a throwing render factory is isolated the same way", () => {
    probeMode = "render-boom";
    const markup = render();
    expect(markup).toContain('data-timeline-intro="eva"');
    expect(markup).not.toContain("probe-opening");
  });

  it("is memo'd with primitive props — TimelineBody's per-stream-event re-render cannot reach it", () => {
    // React.memo contract: the component re-renders only when its props differ. They are all
    // primitives (sessionId / counts / flags), and its store selectors select primitives too,
    // so a stream patch (same session, same loading) changes nothing it subscribes to.
    expect((TimelineIntro as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
    expect(render()).toContain("probe-opening");
  });
});

describe("portrait fallback (custom → provider artwork → none)", () => {
  const art = { glm: { portrait: "/art/glm.png", victory: "/art/glm-v.png" } } as const;

  it("a valid custom portrait wins; an invalid one falls through to the provider artwork", () => {
    expect(resolveIntroPortrait(PNG, "glm", art)).toBe(PNG);
    expect(resolveIntroPortrait("data:image/gif;base64,AAAA", "glm", art)).toBe("/art/glm.png");
    expect(resolveIntroPortrait(`data:image/png;base64,${"A".repeat(3_000_000)}`, "glm", art)).toBe("/art/glm.png");
  });

  it("zai maps to the glm artwork; unknown providers and artless checkouts get none", () => {
    expect(resolveIntroPortrait(null, "zai", art)).toBe("/art/glm.png");
    expect(resolveIntroPortrait(null, "codex", art)).toBeNull();
    expect(resolveIntroPortrait(null, "glm", {})).toBeNull();
    expect(resolveIntroPortrait(null, null, art)).toBeNull();
  });
});

describe("greeting resolution and placeholders", () => {
  const base = { provider: "glm" as const, locale: "zh-CN" as const, minute: 12 * 60, owner: "主人", agentName: "Eva", sample: 0 };

  it("a custom greeting wins; {{owner}} / {{name}} / single-brace {owner} substitute", () => {
    expect(resolveIntroGreeting({ ...base, custom: "{{owner}}，今天要做什么？" })).toBe("主人，今天要做什么？");
    expect(resolveIntroGreeting({ ...base, custom: "{owner}，稍等" })).toBe("主人，稍等");
    expect(resolveIntroGreeting({ ...base, custom: "{{name}}：{{owner}}的修改我看着" })).toBe("Eva：主人的修改我看着");
    // Single-brace {name} keeps the launcher pool's meaning (the owner's address), not the agent.
    expect(resolveIntroGreeting({ ...base, custom: "{name}，今天要做什么？" })).toBe("主人，今天要做什么？");
    // A missing agent name substitutes as empty, not as a placeholder.
    expect(resolveIntroGreeting({ ...base, custom: "{{name}}，开工", agentName: null })).toBe("，开工");
  });

  it("names land literally: $& / $` / $' in a name are never replacement patterns", () => {
    expect(resolveIntroGreeting({ ...base, custom: "{{name}} 好", agentName: "$&x" })).toBe("$&x 好");
    expect(resolveIntroGreeting({ ...base, custom: "{{owner}} 好", owner: "$`y" })).toBe("$`y 好");
    expect(resolveIntroGreeting({ ...base, custom: "{name} 好", owner: "$'z" })).toBe("$'z 好");
  });

  it("no custom text: the provider pool's pick keeps the launcher's {name} = the owner's address", () => {
    const expected = providerGreetings("glm", "zh-CN", base.minute)[0]!.replace(/\{(?:name|称呼)\}/g, "主人");
    expect(resolveIntroGreeting({ ...base, custom: null })).toBe(expected);
  });
});

describe("local store caps and cleaning (lib/introAppearance)", () => {
  it("rejects wrong types, oversized sources and malformed data URLs", () => {
    expect(introPortraitProblem({ type: "image/gif", size: 10 })).toBe("type");
    expect(introPortraitProblem({ type: "image/png", size: 3 * 1024 * 1024 })).toBe("tooLarge");
    expect(introPortraitProblem({ type: "image/webp", size: 1024 })).toBeNull();
    expect(validIntroPortrait(PNG)).toBe(true);
    expect(validIntroPortrait("data:image/gif;base64,AAAA")).toBe(false);
    expect(validIntroPortrait("https://example.invalid/a.png")).toBe(false);
    // The stored cap is ~1 MB encoded; the too-large sentinel is the picker's refusal reason.
    expect(validIntroPortrait(`data:image/png;base64,${"A".repeat(1_048_577)}`)).toBe(false);
    expect(INTRO_PORTRAIT_TOO_LARGE).toBe("intro-portrait-too-large");
  });

  it("caps and trims greetings; a blank one clears the field", () => {
    expect(cleanIntroGreeting("  你好 ")).toBe("你好");
    const capped = cleanIntroGreeting("啊".repeat(400));
    expect(capped).not.toBeNull();
    expect([...capped!].length).toBe(INTRO_GREETING_MAX);
    expect(cleanIntroGreeting("   ")).toBeNull();
  });

  it("never stores an invalid portrait, and an emptied entry disappears", () => {
    expect(setIntroAppearance("local", "gamma", { portrait: "javascript:alert(1)", greeting: "{{owner}}，今天要做什么？" })).toBe(true);
    expect(introAppearanceOf("local", "gamma")).toEqual({ portrait: null, greeting: "{{owner}}，今天要做什么？" });
    expect(setIntroAppearance("local", "gamma", { portrait: PNG })).toBe(true);
    expect(introAppearanceOf("local", "gamma")).toEqual({ portrait: PNG, greeting: "{{owner}}，今天要做什么？" });
    expect(setIntroAppearance("local", "gamma", { greeting: "  " })).toBe(true);
    expect(introAppearanceOf("local", "gamma")).toEqual({ portrait: PNG, greeting: null });
    expect(setIntroAppearance("local", "gamma", { portrait: null, greeting: null })).toBe(true);
    expect(introAppearanceOf("local", "gamma")).toEqual({ portrait: null, greeting: null });
    // Untouched profiles read as the stable empty snapshot.
    expect(introAppearanceOf("local", "other")).toEqual({ portrait: null, greeting: null });
  });

  it("refuses a portrait past the shared ~3 MB total (nothing changes, the editor is told)", () => {
    const big = `data:image/png;base64,${"A".repeat(1_000_000)}`;
    expect(setIntroAppearance("local", "p1", { portrait: big })).toBe(true);
    expect(setIntroAppearance("local", "p2", { portrait: big })).toBe(true);
    expect(setIntroAppearance("local", "p3", { portrait: big })).toBe(true);
    // 4 MB over the ~3 MB shared cap: refused, and nothing of it is stored.
    expect(setIntroAppearance("local", "p4", { portrait: big })).toBe(false);
    expect(introAppearanceOf("local", "p4")).toEqual({ portrait: null, greeting: null });
    // Replacing one of them (same size) stays allowed, and a greeting-only write passes too.
    expect(setIntroAppearance("local", "p1", { portrait: big })).toBe(true);
    expect(setIntroAppearance("local", "p4", { greeting: "hi" })).toBe(true);
    for (const p of ["p1", "p2", "p3", "p4"]) expect(setIntroAppearance("local", p, { portrait: null, greeting: null })).toBe(true);
  });

  it("a refused localStorage write (quota) reports failure and changes nothing", () => {
    const before = introAppearanceOf("local", "gamma");
    vi.stubGlobal("localStorage", { ...localStorageStub, setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(setIntroAppearance("local", "gamma", { greeting: "存不进去" })).toBe(false);
    expect(introAppearanceOf("local", "gamma")).toBe(before);
  });

  it("follows a storage event: another window's (or the preview's) rewrite shows up", async () => {
    const handlers: ((event: { key: string | null }) => void)[] = [];
    let backing = "";
    vi.stubGlobal("window", { addEventListener: (_t: string, h: unknown) => handlers.push(h as (event: { key: string | null }) => void) });
    vi.stubGlobal("localStorage", {
      getItem: (): string | null => backing || null,
      setItem: (_k: string, v: string): void => {
        backing = v;
      },
    });
    vi.resetModules();
    const fresh = await import("../src/renderer/src/lib/introAppearance");
    expect(fresh.introAppearanceOf("HOST-A", "deepseek").greeting).toBeNull();
    backing = JSON.stringify({ "HOST-A": { deepseek: { greeting: "{{owner}}，今天要做什么？" } } });
    // Other modules register storage listeners too; fire them all like the browser would.
    for (const h of handlers) h({ key: "cutex-desktop.introAppearance" });
    expect(fresh.introAppearanceOf("HOST-A", "deepseek").greeting).toBe("{{owner}}，今天要做什么？");
    // An unrelated key leaves the snapshot alone.
    backing = "{}";
    for (const h of handlers) h({ key: "other-store" });
    expect(fresh.introAppearanceOf("HOST-A", "deepseek").greeting).toBe("{{owner}}，今天要做什么？");
    vi.unstubAllGlobals();
  });
});
