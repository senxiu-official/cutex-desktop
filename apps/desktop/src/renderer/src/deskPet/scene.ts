// The fixed player of format 2 scenes (docs/desktop-modules.md §29.9) in the desk pet window. Nothing from the art runs:
// pet.json is data this file reads. It draws on one canvas only when something changes (a clip frame, a breathing
// phase, a book rising off the pile), on one timer: a transparent always-on-top window pays for every frame it composites.
// What it shows follows what the module says (agents at work, the books); how it gets there (open the book, turn pages,
// put it away, fall asleep) is decided here.
import { isGreenKeyed, pileBookBox, tinted, type DeskPetBook, type DeskPetBooks, type DeskPetClipRole, type DeskPetQuad, type DeskPetScene, type DeskPetSceneFrame } from "../../../shared/deskPetScene";
import type { DeskPetSceneArt } from "../../../shared/deskPet";

/** Reading goes on this long after the last work, so short gaps between reports do not close the book. */
export const SCENE_LINGER_MS = 15_000;
/** Idle this long, it falls asleep (when the art has the sleep clips). */
export const SCENE_SLEEP_AFTER_MS = 60_000;
/** A book rising off the pile as it appears in the hands. */
export const SCENE_TRANSFER_MS = 700;
const TRANSFER_STEPS = 8;
/** New books dropping onto the top of the pile (one landing for a whole burst). */
export const SCENE_LANDING_MS = 500;
const LANDING_RISE = 28;

type Mode = DeskPetClipRole;
type Image = HTMLImageElement | HTMLCanvasElement;

export interface SceneInput {
  work: boolean;
  books: DeskPetBooks;
  attention: boolean;
  /** Breathing frames play (the "motion at rest" setting); off = still bodies. */
  breathing: boolean;
}

export interface ScenePlayer {
  readonly key: string;
  /** The share of the canvas's width to the middle of the character (the mark and icons go over it). */
  readonly headX: number;
  /** What plays now and which book is in hand (tests, diagnostics). */
  snapshot(): { mode: DeskPetClipRole; book: string | null };
  set(input: Partial<SceneInput>): void;
  resize(width: number, height: number, pixel: boolean): void;
  destroy(): void;
}

/** Decodes every image first; null if one does not decode (main already checked them). */
export async function createScenePlayer(host: HTMLElement, key: string, art: DeskPetSceneArt, input: SceneInput, clock: () => number = () => performance.now()): Promise<ScenePlayer | null> {
  const scene = art.scene;
  const images = new Map<string, HTMLImageElement>();
  try {
    await Promise.all(
      Object.entries(art.images).map(async ([file, src]) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        images.set(file, img);
      }),
    );
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "scene";
  host.append(canvas);
  const ctx = canvas.getContext("2d")!;
  return new Player(scene, key, images, canvas, ctx, input, clock);
}

class Player implements ScenePlayer {
  readonly headX: number;
  private mode: Mode = "idle";
  private index = 0;
  private frameAt: number;
  /** Runs when the current clip ends (a transition); null = the clip loops. */
  private after: (() => void) | null = null;
  private input: SceneInput;
  private shown: DeskPetBook | null = null;
  private transfer: { book: DeskPetBook; from: number; at: number } | null = null;
  /** Books landing on the pile now, and new ones waiting for it (or for a book rising off the top) to finish. */
  private landing: { ids: Set<string>; at: number } | null = null;
  private waiting = new Set<string>();
  /** Books the pile has shown. */
  private known = new Set<string>();
  private lastWork: number;
  private idleSince: number;
  private timer: number | null = null;
  private pixel = false;
  private width = 0;
  private height = 0;
  private readonly composites = new Map<string, Image>();
  private destroyed = false;

  constructor(
    private readonly scene: DeskPetScene,
    readonly key: string,
    private readonly images: Map<string, HTMLImageElement>,
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    input: SceneInput,
    private readonly clock: () => number,
  ) {
    const now = clock();
    this.frameAt = now;
    this.lastWork = input.work ? now : -Infinity;
    this.idleSince = now;
    this.input = input;
    this.headX = (scene.character.x + scene.character.width / 2) / scene.canvas.width;
    for (const b of this.pileBooks()) this.known.add(b.id);
    this.step();
  }

  snapshot(): { mode: Mode; book: string | null } {
    return { mode: this.mode, book: this.shown?.id ?? null };
  }

  set(input: Partial<SceneInput>): void {
    const now = this.clock();
    if (input.work !== undefined && input.work !== this.input.work && !input.work) this.lastWork = now;
    this.input = { ...this.input, ...input };
    if (this.input.work) this.lastWork = now;
    if (input.books) this.noteBooks();
    this.step();
  }

  resize(width: number, height: number, pixel: boolean): void {
    this.width = width;
    this.height = height;
    this.pixel = pixel;
    this.step();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.canvas.remove();
  }

  // ---- the clips ----

  private frames(mode: Mode = this.mode): readonly DeskPetSceneFrame[] {
    return this.scene.clips[mode] ?? this.scene.clips.idle!;
  }

  private frame(): DeskPetSceneFrame {
    return this.frames()[this.index]!;
  }

  private play(mode: Mode, then: (() => void) | null = null): void {
    this.mode = mode;
    this.index = 0;
    this.frameAt = this.clock();
    this.after = then;
  }

  /** Plays the clips in turn, then `done`; a clip the art lacks is skipped. */
  private chain(modes: Mode[], done: () => void): void {
    const next = modes.find((m) => this.scene.clips[m]);
    if (!next) return done();
    this.play(next, () => this.chain(modes.slice(modes.indexOf(next) + 1), done));
  }

  private wantsBook(now: number): boolean {
    return !!this.input.books.active && (this.input.work || now - this.lastWork < SCENE_LINGER_MS);
  }

  /**
   * New books on the pile: those above every book it showed before land (they wait while a book rises off the top, and
   * a burst lands as one); new ones below (from under the shown part) just appear. Only the drawing changes here.
   */
  private noteBooks(): void {
    const books = this.pileBooks();
    const ids = new Set(books.map((b) => b.id));
    let highestKnown = -1;
    books.forEach((b, i) => {
      if (this.known.has(b.id)) highestKnown = i;
    });
    books.forEach((b, i) => {
      if (!this.known.has(b.id) && i > highestKnown) this.waiting.add(b.id);
    });
    for (const id of [...this.waiting]) if (!ids.has(id)) this.waiting.delete(id);
    if (this.landing) for (const id of [...this.landing.ids]) if (!ids.has(id)) this.landing.ids.delete(id);
    this.known = ids;
  }

  private landingNow(now: number): void {
    if (this.landing && now - this.landing.at >= SCENE_LANDING_MS) this.landing = null;
    if (!this.landing && !this.transfer && this.waiting.size) {
      this.landing = { ids: this.waiting, at: now };
      this.waiting = new Set();
    }
  }

  /** Still landing or waiting to land: a book cannot be taken before it lies on the pile. */
  private notLanded(id: string): boolean {
    return this.waiting.has(id) || !!this.landing?.ids.has(id);
  }

  /** The book on top of the pile goes into the hands. */
  private open(): void {
    const book = this.input.books.active;
    if (!book) return this.rest();
    if (book.id !== this.shown?.id) this.transfer = { book, from: this.input.books.pile.length, at: this.clock() };
    this.shown = book;
    this.chain(["opening"], () => this.play("reading"));
  }

  private rest(): void {
    this.idleSince = this.clock();
    this.play(this.input.attention && this.scene.clips.attention ? "attention" : "idle");
  }

  /** What to do next, at a frame boundary. Transitions finish first, and a page in mid-turn is never cut. */
  private decide(now: number, clipEnded: boolean): void {
    if (this.frame().page) return;
    const mode = this.mode;
    if (mode === "reading") {
      if (!this.wantsBook(now)) return this.chain(["closing"], () => ((this.shown = null), this.rest()));
      // Another book: finish the page, put this one away, take the next.
      // A book still landing is taken at the end of a later round: reading goes on meanwhile.
      if (clipEnded && this.input.books.active!.id !== this.shown?.id && !this.notLanded(this.input.books.active!.id)) return this.chain(["closing"], () => this.open());
      return;
    }
    if (mode === "idle" || mode === "attention") {
      if (this.input.work && this.input.books.active && !this.notLanded(this.input.books.active.id)) return this.open();
      if (mode === "idle" && this.input.attention && this.scene.clips.attention) return this.play("attention");
      if (mode === "attention" && !this.input.attention) return this.rest();
      if (this.scene.clips.sleeping && !this.input.attention && now - this.idleSince >= SCENE_SLEEP_AFTER_MS) return this.chain(["fallAsleep"], () => this.play("sleeping"));
      return;
    }
    if (mode === "sleeping" && ((this.input.work && this.input.books.active) || this.input.attention)) {
      this.chain(["wake"], () => (this.input.work && this.input.books.active ? this.open() : this.rest()));
    }
  }

  /** Moves the clips up to now, draws, and sets the one timer for the next change. */
  private step(): void {
    if (this.destroyed) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    let now = this.clock();
    // Bounded: a long pause of the timer (a hidden window) catches up in a few steps, never frame by frame forever.
    for (let guard = 0; guard < 256; guard++) {
      const frames = this.frames();
      const end = this.frameAt + frames[this.index]!.ms;
      if (now < end) break;
      this.frameAt = end;
      if (this.index + 1 < frames.length) {
        this.index++;
        this.decide(now, false);
      } else if (this.after) {
        const then = this.after;
        this.after = null;
        then();
      } else {
        this.index = 0;
        this.decide(now, true);
      }
    }
    this.landingNow(now);
    // Work, a book or the mark may have changed in mid-frame.
    if (!this.after) this.decide(now, false);
    now = this.clock();
    this.draw(now);
    this.timer = window.setTimeout(() => this.step(), Math.max(16, this.nextChange(now) - now));
  }

  private nextChange(now: number): number {
    let next = this.frameAt + this.frame().ms;
    const body = this.scene.bodies[this.frame().body]!;
    if (this.input.breathing && body.breath.length) {
      const phase = this.scene.breathMs / body.breath.length;
      next = Math.min(next, (Math.floor(now / phase) + 1) * phase);
    }
    if (this.transfer) next = Math.min(next, now + SCENE_TRANSFER_MS / TRANSFER_STEPS);
    if (this.landing) next = Math.min(next, now + SCENE_LANDING_MS / TRANSFER_STEPS);
    // Waiting for the book rising off the top: the landing starts on the step after it.
    else if (this.waiting.size && !this.transfer) next = now;
    if (this.mode === "reading" && !this.input.work) next = Math.min(next, this.lastWork + SCENE_LINGER_MS);
    if (this.mode === "idle" && this.scene.clips.sleeping) next = Math.min(next, this.idleSince + SCENE_SLEEP_AFTER_MS);
    return next;
  }

  // ---- drawing ----

  private draw(now: number): void {
    const dpr = this.canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(this.width * dpr));
    const ph = Math.max(1, Math.round(this.height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    const { ctx, scene } = this;
    const unit = pw / scene.canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(unit, 0, 0, ph / scene.canvas.height, 0, 0);
    ctx.imageSmoothingEnabled = !this.pixel;
    ctx.imageSmoothingQuality = "high";
    const box = scene.character;
    const put = (image: Image | undefined, alpha = 1) => {
      if (!image || alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(image, box.x, box.y, box.width, box.height);
      ctx.globalAlpha = 1;
    };
    const frame = this.frame();
    const body = scene.bodies[frame.body]!;
    const breath = this.input.breathing && body.breath.length ? body.breath[Math.floor(((now % scene.breathMs) / scene.breathMs) * body.breath.length) % body.breath.length]! : body.still;
    put(this.images.get(breath));
    const hands = scene.hands ? this.images.get(scene.hands) : undefined;
    if (frame.prop) {
      put(this.prop(frame.prop, this.coverNow()), frame.magic ?? 1);
      if (frame.magic !== null) {
        put(hands);
        this.sparkles(frame.magic);
      }
    }
    if (frame.page) {
      put(this.images.get(scene.pages[frame.page]!));
      put(hands);
    }
    this.pile(now);
  }

  private coverNow(): string {
    return this.shown?.cover ?? this.input.books.active?.cover ?? Object.keys(this.scene.covers)[0]!;
  }

  private sparkles(magic: number): void {
    const sparkle = this.scene.sparkle;
    const image = sparkle && this.images.get(sparkle.image);
    const glow = Math.sin(Math.PI * magic);
    if (!sparkle || !image || glow <= 0.05) return;
    const { ctx } = this;
    const { x, y } = this.scene.character;
    ctx.globalAlpha = glow;
    sparkle.at.forEach(([sx, sy], i) => {
      const s = 1 + ((this.index + i) % 3) * 0.35;
      ctx.drawImage(image, x + sx - (sparkle.width * s) / 2, y + sy - (sparkle.height * s) / 2, sparkle.width * s, sparkle.height * s);
    });
    ctx.globalAlpha = 1;
  }

  /** The books on the pile now: the next one stays on top until it is taken. */
  private pileBooks(): readonly DeskPetBook[] {
    const { active, pile } = this.input.books;
    return active && active.id !== this.shown?.id ? [...pile, active] : pile;
  }

  private pile(now: number): void {
    const pile = this.scene.pile;
    if (!pile) return;
    const { ctx } = this;
    const landing = this.landing;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const fall = landing ? ease(Math.min(1, (now - landing.at) / SCENE_LANDING_MS)) : 1;
    // The top of the pile; books waiting to land are not there yet.
    this.pileBooks().filter((book) => !this.waiting.has(book.id)).slice(-pile.max).forEach((book, i) => {
      const b = pileBookBox(pile, i);
      const falling = !!landing?.ids.has(book.id);
      ctx.globalAlpha = falling ? fall : 1;
      ctx.drawImage(this.pileImage(book.cover), b.x, b.y - (falling ? LANDING_RISE * (1 - fall) : 0), b.width, b.height);
      ctx.globalAlpha = 1;
    });
    const transfer = this.transfer;
    if (!transfer) return;
    const t = Math.min(1, (now - transfer.at) / SCENE_TRANSFER_MS);
    if (t >= 1) {
      this.transfer = null;
      return;
    }
    const rise = ease(t);
    const b = pileBookBox(pile, Math.min(transfer.from, pile.max - 1));
    ctx.globalAlpha = 1 - rise;
    ctx.drawImage(this.pileImage(transfer.book.cover), b.x - 30 * rise, b.y - 22 * rise, b.width, b.height);
    ctx.globalAlpha = 1;
  }

  // ---- covers: tinted green-keyed pixels, a cover image projected onto a quad, the occluding part over it ----

  private prop(id: string, cover: string): Image | undefined {
    const prop = this.scene.props[id]!;
    const image = this.images.get(prop.image);
    if (!image || !prop.cover) return image;
    const key = `prop:${id}:${cover}`;
    let out = this.composites.get(key);
    if (!out) {
      const scale = image.naturalWidth / this.scene.character.width;
      out = this.covered(image, cover, prop.cover.quad, scale, prop.cover.over ? this.images.get(prop.cover.over) : undefined);
      this.composites.set(key, out);
    }
    return out;
  }

  private pileImage(cover: string): Image {
    const pile = this.scene.pile!;
    const key = `pile:${cover}`;
    let out = this.composites.get(key);
    if (!out) {
      const image = this.images.get(pile.image)!;
      out = pile.cover || this.scene.covers[cover]?.tint ? this.covered(image, cover, pile.cover, image.naturalWidth / pile.width) : image;
      this.composites.set(key, out);
    }
    return out;
  }

  private covered(image: HTMLImageElement, coverId: string, quad: DeskPetQuad | null, scale: number, over?: HTMLImageElement): Image {
    const cover = this.scene.covers[coverId] ?? Object.values(this.scene.covers)[0]!;
    if (!cover.tint && !cover.image && !over) return image;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const c = canvas.getContext("2d", { willReadFrequently: true })!;
    c.drawImage(image, 0, 0);
    if (cover.tint) {
      const data = c.getImageData(0, 0, canvas.width, canvas.height);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!isGreenKeyed(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!)) continue;
        const [r, g, b] = tinted(d[i]!, d[i + 1]!, d[i + 2]!, cover.tint);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
      c.putImageData(data, 0, 0);
    }
    const art = cover.image ? this.images.get(cover.image) : undefined;
    if (art && quad) project(c, art, quad.map(([x, y]) => [x * scale, y * scale]) as unknown as DeskPetQuad);
    if (over) c.drawImage(over, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
}

/** One triangle of `image` mapped affinely onto another. */
function triangle(c: CanvasRenderingContext2D, image: CanvasImageSource, src: readonly (readonly [number, number])[], dst: readonly (readonly [number, number])[]): void {
  const [a, b, d] = src as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const [p, q, r] = dst as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const det = (b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(det) < 0.001) return;
  const A = ((q[0] - p[0]) * (d[1] - a[1]) - (r[0] - p[0]) * (b[1] - a[1])) / det;
  const B = ((q[1] - p[1]) * (d[1] - a[1]) - (r[1] - p[1]) * (b[1] - a[1])) / det;
  const C = ((r[0] - p[0]) * (b[0] - a[0]) - (q[0] - p[0]) * (d[0] - a[0])) / det;
  const D = ((r[1] - p[1]) * (b[0] - a[0]) - (q[1] - p[1]) * (d[0] - a[0])) / det;
  c.save();
  c.beginPath();
  c.moveTo(p[0], p[1]);
  c.lineTo(q[0], q[1]);
  c.lineTo(r[0], r[1]);
  c.closePath();
  c.clip();
  c.transform(A, B, C, D, p[0] - A * a[0] - C * a[1], p[1] - B * a[0] - D * a[1]);
  c.drawImage(image, 0, 0);
  c.restore();
}

/** `image` onto a four-cornered area, as an 8 × 8 grid of triangle pairs (bilinear between the corners). */
function project(c: CanvasRenderingContext2D, image: HTMLImageElement, q: DeskPetQuad): void {
  const at = (u: number, v: number): [number, number] => [
    q[0][0] * (1 - u) * (1 - v) + q[1][0] * u * (1 - v) + q[2][0] * u * v + q[3][0] * (1 - u) * v,
    q[0][1] * (1 - u) * (1 - v) + q[1][1] * u * (1 - v) + q[2][1] * u * v + q[3][1] * (1 - u) * v,
  ];
  const N = 8;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const uv: [number, number][] = [[x / N, y / N], [(x + 1) / N, y / N], [(x + 1) / N, (y + 1) / N], [x / N, (y + 1) / N]];
      const s = uv.map(([u, v]) => [u * image.naturalWidth, v * image.naturalHeight] as const);
      const d = uv.map(([u, v]) => at(u, v));
      triangle(c, image, [s[0]!, s[1]!, s[2]!], [d[0]!, d[1]!, d[2]!]);
      triangle(c, image, [s[0]!, s[2]!, s[3]!], [d[0]!, d[2]!, d[3]!]);
    }
  }
}
