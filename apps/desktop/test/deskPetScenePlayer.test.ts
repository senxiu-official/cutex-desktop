// @vitest-environment jsdom
// The window's fixed scene player (renderer/src/deskPet/scene.ts; docs/desktop-modules.md §29.9–29.10): it follows what
// the module says (work, books, the mark) through the art's clips, never cuts a page in mid-turn, and draws only on change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScenePlayer, SCENE_LANDING_MS, SCENE_LINGER_MS, SCENE_SLEEP_AFTER_MS, SCENE_TRANSFER_MS, type ScenePlayer } from "../src/renderer/src/deskPet/scene";
import { parseDeskPetScene, type DeskPetBooks } from "../src/shared/deskPetScene";

const RAW = {
  format: 2,
  name: "T",
  canvas: [320, 256],
  character: [0, 0, 256, 256],
  bodies: { up: { still: "up.png", breath: ["up-0.png", "up-1.png"] }, read: { still: "read.png" }, sleep: { still: "sleep.png" } },
  props: { open: { image: "open.png" } },
  pages: { turn: "turn.png" },
  hands: "hands.png",
  pile: { image: "pile.png", at: [240, 226], size: [72, 24], step: 7, max: 5 },
  clips: {
    idle: [{ body: "up", ms: 2000 }],
    opening: [{ body: "read", prop: "open", ms: 100, magic: 0.5 }, { body: "read", prop: "open", ms: 100 }],
    reading: [{ body: "read", prop: "open", ms: 1000 }, { body: "read", prop: "open", ms: 200, page: "turn" }, { body: "read", prop: "open", ms: 500 }],
    closing: [{ body: "read", prop: "open", ms: 100, magic: 0.5 }, { body: "up", ms: 100 }],
    fallAsleep: [{ body: "sleep", ms: 300 }],
    sleeping: [{ body: "sleep", ms: 1000 }],
    wake: [{ body: "up", ms: 300 }],
    attention: [{ body: "up", ms: 500 }],
  },
};
const scene = parseDeskPetScene(RAW)!;
// The same art with clips for changing books while reading.
const switching = parseDeskPetScene({
  ...RAW,
  clips: { ...RAW.clips, switchOut: [{ body: "read", prop: "open", ms: 100 }, { body: "read", prop: "open", ms: 100, magic: 0 }], switchIn: [{ body: "read", prop: "open", ms: 100, magic: 0 }, { body: "read", prop: "open", ms: 100 }] },
})!;
const files = ["up.png", "up-0.png", "up-1.png", "read.png", "sleep.png", "open.png", "turn.png", "hands.png", "pile.png"];
const images = Object.fromEntries(files.map((f) => [f, `data:${f}`]));
const art = { scene, images };

let now = 0;
let drawn: string[] = [];
let draws = 0;
const advance = (ms: number) => {
  for (let i = 0; i < ms; i += 10) {
    now += Math.min(10, ms - i);
    vi.advanceTimersByTime(Math.min(10, ms - i));
  }
};
const book = (id: string) => ({ id, cover: "book" });
const piled = () => drawn.filter((d) => d === "pile.png").length;
const falling = () => drawn.filter((d) => d === "pile.png~").length;

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  drawn = [];
  draws = 0;
  const ctx: { globalAlpha: number } & Record<string, unknown> = {
    setTransform() {},
    clearRect() {
      drawn = [];
      draws++;
    },
    drawImage(image: { src?: string }) {
      // A book still falling onto the pile is drawn faded: "~".
      drawn.push((image.src ?? "canvas").replace("data:", "") + (ctx.globalAlpha < 1 ? "~" : ""));
    },
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function make(books: DeskPetBooks, work = false, withSwitch = false): Promise<ScenePlayer> {
  const player = (await createScenePlayer(document.body, "k", withSwitch ? { scene: switching, images } : art, { work, books, attention: false, breathing: true }, () => now))!;
  player.resize(200, 160, false);
  return player;
}

describe("scene player", () => {
  it("rests with the pile drawn; work opens the book on top, reads, and turns pages", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] });
    expect(p.snapshot()).toEqual({ mode: "idle", book: null });
    // The next book still lies on top of the pile: two books drawn.
    expect(drawn.filter((d) => d === "pile.png")).toHaveLength(2);
    p.set({ work: true });
    expect(p.snapshot()).toEqual({ mode: "opening", book: "b1" });
    advance(800);
    expect(p.snapshot().mode).toBe("reading");
    expect(drawn.filter((d) => d === "pile.png")).toHaveLength(1);
    advance(500);
    expect(drawn).toContain("turn.png");
    p.destroy();
  });

  it("a new book waits for the end of the reading clip, then the old one is put away and the next taken", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] }, true);
    advance(250);
    expect(p.snapshot()).toEqual({ mode: "reading", book: "b1" });
    p.set({ books: { active: book("b2"), pile: [] } });
    // Mid-clip: still reading b1; b2 lies on top of the pile meanwhile.
    advance(700);
    expect(p.snapshot()).toEqual({ mode: "reading", book: "b1" });
    expect(drawn.filter((d) => d === "pile.png")).toHaveLength(1);
    advance(1000);
    expect(p.snapshot().mode).toBe("closing");
    advance(220);
    expect(p.snapshot()).toMatchObject({ mode: "opening", book: "b2" });
    p.destroy();
  });

  it("with switchOut / switchIn the next book comes without looking up: no closing or opening between books", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] }, true, true);
    const modes: string[] = [];
    const watch = (ms: number) => {
      for (let i = 0; i < ms; i += 10) {
        advance(10);
        const m = p.snapshot().mode;
        if (modes.at(-1) !== m) modes.push(m);
      }
    };
    watch(250);
    p.set({ books: { active: book("b2"), pile: [] } });
    watch(2500);
    expect(modes).toEqual(["opening", "reading", "switchOut", "switchIn", "reading"]);
    expect(p.snapshot().book).toBe("b2");
    // Work stops for good: only then does she close the book and look up.
    p.set({ work: false, books: { active: null, pile: [] } });
    watch(SCENE_LINGER_MS + 3000);
    expect(modes.slice(-2)).toEqual(["closing", "idle"]);
    p.destroy();
  });

  it("with switch clips a book still landing is not taken either: reading goes on, it lands, then it is switched in", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] }, true, true);
    advance(SCENE_TRANSFER_MS + SCENE_LANDING_MS);
    p.set({ books: { active: book("b4"), pile: [book("b2")] } });
    advance(10);
    expect([p.snapshot(), falling()]).toEqual([{ mode: "reading", book: "b1" }, 1]);
    const modes: string[] = [];
    for (let i = 0; i < 300; i++) {
      advance(10);
      if (modes.at(-1) !== p.snapshot().mode) modes.push(p.snapshot().mode);
    }
    expect(modes).toEqual(["reading", "switchOut", "switchIn", "reading"]);
    expect(p.snapshot().book).toBe("b4");
    p.destroy();
  });

  it("the pool runs out while the old book goes: she closes and rests, no new book", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] }, true, true);
    advance(250);
    p.set({ books: { active: book("b2"), pile: [] } });
    for (let i = 0; i < 300 && p.snapshot().mode !== "switchOut"; i++) advance(10);
    expect(p.snapshot()).toEqual({ mode: "switchOut", book: "b1" });
    p.set({ work: false, books: { active: null, pile: [] } });
    // The old book finishes going (a transition is never cut), then she closes.
    for (let i = 0; i < 30 && p.snapshot().mode === "switchOut"; i++) advance(10);
    expect(p.snapshot().mode).toBe("closing");
    advance(300);
    expect(p.snapshot()).toEqual({ mode: "idle", book: null });
    p.destroy();
  });

  it("never cuts a page in mid-turn; after work stops it reads on a while, then closes the book and rests", async () => {
    const p = await make({ active: book("b1"), pile: [] }, true);
    advance(250 + 1000 + 50);
    expect(drawn).toContain("turn.png");
    p.set({ work: false });
    advance(100);
    expect(p.snapshot().mode).toBe("reading");
    advance(SCENE_LINGER_MS);
    expect(["closing", "idle"]).toContain(p.snapshot().mode);
    advance(300);
    expect(p.snapshot()).toEqual({ mode: "idle", book: null });
    p.destroy();
  });

  it("falls asleep after a while at rest; work or the mark wakes it; the mark plays the reserved attention clip", async () => {
    const p = await make({ active: book("b1"), pile: [] });
    advance(SCENE_SLEEP_AFTER_MS + 400);
    expect(p.snapshot().mode).toBe("sleeping");
    p.set({ attention: true });
    expect(p.snapshot().mode).toBe("wake");
    advance(350);
    expect(p.snapshot().mode).toBe("attention");
    p.set({ attention: false });
    expect(p.snapshot().mode).toBe("idle");
    p.set({ work: true });
    expect(p.snapshot()).toMatchObject({ mode: "opening", book: "b1" });
    p.destroy();
  });

  it("new books land on top of the pile, a burst as one; one coming while another lands waits for it; counts never change", async () => {
    const p = await make({ active: null, pile: [book("b1")] });
    p.set({ books: { active: null, pile: [book("b1"), book("b2"), book("b3")] } });
    advance(10);
    expect([piled(), falling()]).toEqual([1, 2]);
    p.set({ books: { active: null, pile: [book("b1"), book("b2"), book("b3"), book("b4")] } });
    advance(10);
    // b4 is not on the pile yet: it lands after b2 and b3.
    expect([piled(), falling()]).toEqual([1, 2]);
    advance(SCENE_LANDING_MS);
    expect([piled(), falling()]).toEqual([3, 1]);
    advance(SCENE_LANDING_MS);
    expect([piled(), falling()]).toEqual([4, 0]);
    // A book from below the shown part (the pile went down) just appears.
    p.set({ books: { active: null, pile: [book("b0"), book("b1"), book("b2"), book("b3")] } });
    advance(10);
    expect([piled(), falling()]).toEqual([4, 0]);
    p.destroy();
  });

  it("a landing waits for a book rising off the top; reading never pauses for a landing, and a book still landing is not taken", async () => {
    const p = await make({ active: book("b1"), pile: [book("b2")] });
    p.set({ work: true });
    // b1 rises off the pile into the hands; b3 arrives meanwhile and waits.
    p.set({ books: { active: book("b1"), pile: [book("b2"), book("b3")] } });
    advance(100);
    // b2 on the pile and b1 fading as it rises: b3 is not drawn yet.
    expect([piled(), falling()]).toEqual([1, 1]);
    advance(SCENE_TRANSFER_MS);
    expect(p.snapshot()).toEqual({ mode: "reading", book: "b1" });
    expect([piled(), falling()]).toEqual([1, 1]);
    advance(SCENE_LANDING_MS);
    expect([piled(), falling()]).toEqual([2, 0]);
    // b4 arrives and is at once the book to read (the module took it off the top): it still lands first, the reading
    // clip goes on meanwhile, and only then is it taken.
    p.set({ books: { active: book("b4"), pile: [book("b2"), book("b3")] } });
    advance(10);
    expect(p.snapshot()).toEqual({ mode: "reading", book: "b1" });
    expect([piled(), falling()]).toEqual([2, 1]);
    advance(1700);
    expect(p.snapshot().book).toBe("b4");
    p.destroy();
  });

  it("draws only when something changes: breathing phases at rest, no frame loop", async () => {
    const p = await make({ active: null, pile: [] });
    const before = draws;
    advance(3600);
    // Two breathing frames over 3.6 s, plus the idle clip's own frame ends: a handful of draws, not 60 a second.
    expect(draws - before).toBeLessThan(10);
    p.set({ breathing: false });
    const still = draws;
    advance(1000);
    expect(draws - still).toBeLessThanOrEqual(1);
    p.destroy();
  });
});
