// Desk pet art format 2 (docs/desktop-modules.md §29.9): a scene the window's own fixed renderer plays. pet.json
// describes images, named bodies with breathing frames, a held prop with a cover, page overlays, a pile of books and
// named clips; nothing in it runs. Pure checks shared by main, the window's document and the tests. Anything unknown,
// out of range or pointing at nothing refuses the whole set.

/** [x, y] in the unit the field names. */
export type DeskPetPoint = readonly [number, number];
/** Four corners, clockwise from the top-left, onto which a cover image is projected. */
export type DeskPetQuad = readonly [DeskPetPoint, DeskPetPoint, DeskPetPoint, DeskPetPoint];
export interface DeskPetBox { x: number; y: number; width: number; height: number }

export interface DeskPetSceneFrame {
  body: string;
  /** A held prop drawn over the body; null = none. */
  prop: string | null;
  ms: number;
  /** The prop's opacity while it appears or goes (0–1); the hands and sparkles are drawn over it meanwhile. */
  magic: number | null;
  /** A page overlay drawn over the prop, then the hands over it. */
  page: string | null;
}

/** Clip roles the renderer plays. `idle` and `reading` are required; the sleep trio is all or none. */
export const DESK_PET_CLIP_ROLES = ["idle", "reading", "opening", "closing", "fallAsleep", "sleeping", "wake", "attention"] as const;
export type DeskPetClipRole = (typeof DESK_PET_CLIP_ROLES)[number];

export interface DeskPetCover {
  /** What it is (`book`, `diary`, `letters`…): told to the module, not drawn. */
  kind: string;
  /** Projected onto a prop's or the pile's cover quad. */
  image: string | null;
  /** Multiplies the green-keyed pixels of a prop with a cover and of the pile image (§29.9). */
  tint: readonly [number, number, number] | null;
}

export interface DeskPetPile {
  image: string;
  /** Top-left of the lowest book, canvas units; each book above is `step` higher. */
  x: number;
  y: number;
  width: number;
  height: number;
  step: number;
  max: number;
  /** In the pile image's own units (`width` × `height`). */
  cover: DeskPetQuad | null;
  /** The order new books take their covers in, repeating. */
  deck: readonly { cover: string; units: number }[];
}

export interface DeskPetScene {
  canvas: { width: number; height: number };
  /** The character's part of the canvas: it is what the size setting measures, and every body, prop, page and hands image fills it. */
  character: DeskPetBox;
  breathMs: number;
  bodies: Readonly<Record<string, { still: string; breath: readonly string[] }>>;
  props: Readonly<Record<string, { image: string; cover: { quad: DeskPetQuad | null; over: string | null } | null }>>;
  pages: Readonly<Record<string, string>>;
  hands: string | null;
  sparkle: { image: string; width: number; height: number; at: readonly DeskPetPoint[] } | null;
  covers: Readonly<Record<string, DeskPetCover>>;
  pile: DeskPetPile | null;
  clips: Readonly<Partial<Record<DeskPetClipRole, readonly DeskPetSceneFrame[]>>>;
}

export const DESK_PET_SCENE = {
  minCanvas: 64,
  maxCanvas: 1024,
  minCharacter: 32,
  maxImages: 256,
  /** Each file, and every file of a set together. */
  imageBytes: 2 * 1024 * 1024,
  setBytes: 48 * 1024 * 1024,
  minSide: 1,
  maxSide: 2048,
  /** Decoded pixels of a whole set: what the window may hold at most. */
  setPixels: 64 * 1024 * 1024,
  maxBodies: 16,
  maxBreath: 48,
  maxProps: 8,
  maxPages: 16,
  maxCovers: 16,
  maxPile: 20,
  maxUnits: 8,
  maxFrames: 64,
  minFrameMs: 16,
  maxFrameMs: 60_000,
  maxSparkles: 8,
} as const;

const KEYS = ["format", "name", "family", "scale", "pixel", "canvas", "character", "breathMs", "bodies", "props", "pages", "hands", "sparkle", "covers", "pile", "clips"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const onlyKeys = (raw: Record<string, unknown>, keys: readonly string[]) => Object.keys(raw).every((k) => keys.includes(k));
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Ids of bodies, props, pages and covers. */
export function isDeskPetSceneId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}
/** A file beside pet.json: lowercase name, `.png`, no folder. */
export function isDeskPetSceneFile(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,62}\.png$/.test(value);
}

function point(raw: unknown, w: number, h: number): DeskPetPoint | null {
  return Array.isArray(raw) && raw.length === 2 && isNum(raw[0], 0, w) && isNum(raw[1], 0, h) ? [raw[0], raw[1]] : null;
}
function quad(raw: unknown, w: number, h: number): DeskPetQuad | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const points = raw.map((p) => point(p, w, h));
  return points.every((p) => p) ? (points as unknown as DeskPetQuad) : null;
}
function idMap(raw: unknown, max: number, min = 0): [string, unknown][] | null {
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  return entries.length >= min && entries.length <= max && entries.every(([k]) => isDeskPetSceneId(k)) ? entries : null;
}

/** The scene of a format 2 pet.json (the name, family, scale and pixel are read by parseDeskPetManifest). Null = refused. */
export function parseDeskPetScene(raw: unknown): DeskPetScene | null {
  if (!isRecord(raw) || raw.format !== 2 || !onlyKeys(raw, KEYS)) return null;
  const L = DESK_PET_SCENE;
  const c = raw.canvas;
  if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0], L.minCanvas, L.maxCanvas) || !isInt(c[1], L.minCanvas, L.maxCanvas)) return null;
  const canvas = { width: c[0], height: c[1] };
  const ch = raw.character ?? [0, 0, canvas.width, canvas.height];
  if (!Array.isArray(ch) || ch.length !== 4 || !isInt(ch[0], 0, canvas.width) || !isInt(ch[1], 0, canvas.height)) return null;
  if (!isInt(ch[2], L.minCharacter, canvas.width - ch[0]) || !isInt(ch[3], L.minCharacter, canvas.height - ch[1])) return null;
  const character = { x: ch[0], y: ch[1], width: ch[2], height: ch[3] };
  const breathMs = raw.breathMs ?? 3600;
  if (!isInt(breathMs, 500, 20_000)) return null;

  const bodyEntries = idMap(raw.bodies, L.maxBodies, 1);
  if (!bodyEntries) return null;
  const bodies: Record<string, { still: string; breath: string[] }> = {};
  for (const [id, b] of bodyEntries) {
    if (!isRecord(b) || !onlyKeys(b, ["still", "breath"]) || !isDeskPetSceneFile(b.still)) return null;
    const breath = b.breath ?? [];
    if (!Array.isArray(breath) || (breath.length !== 0 && (breath.length < 2 || breath.length > L.maxBreath)) || !breath.every(isDeskPetSceneFile)) return null;
    bodies[id] = { still: b.still, breath: [...breath] };
  }

  const propEntries = idMap(raw.props ?? {}, L.maxProps);
  if (!propEntries) return null;
  const props: Record<string, DeskPetScene["props"][string]> = {};
  for (const [id, p] of propEntries) {
    if (!isRecord(p) || !onlyKeys(p, ["image", "cover"]) || !isDeskPetSceneFile(p.image)) return null;
    let cover: { quad: DeskPetQuad | null; over: string | null } | null = null;
    if (p.cover !== undefined) {
      if (!isRecord(p.cover) || !onlyKeys(p.cover, ["quad", "over"])) return null;
      const q = p.cover.quad === undefined ? null : quad(p.cover.quad, character.width, character.height);
      if ((p.cover.quad !== undefined && !q) || (p.cover.over !== undefined && !isDeskPetSceneFile(p.cover.over))) return null;
      cover = { quad: q, over: (p.cover.over as string | undefined) ?? null };
    }
    props[id] = { image: p.image, cover };
  }

  const pageEntries = idMap(raw.pages ?? {}, L.maxPages);
  if (!pageEntries || !pageEntries.every(([, f]) => isDeskPetSceneFile(f))) return null;
  const pages = Object.fromEntries(pageEntries) as Record<string, string>;

  if (raw.hands !== undefined && !isDeskPetSceneFile(raw.hands)) return null;
  const hands = (raw.hands as string | undefined) ?? null;

  let sparkle: DeskPetScene["sparkle"] = null;
  if (raw.sparkle !== undefined) {
    const s = raw.sparkle;
    if (!isRecord(s) || !onlyKeys(s, ["image", "size", "at"]) || !isDeskPetSceneFile(s.image)) return null;
    const size = s.size;
    if (!Array.isArray(size) || size.length !== 2 || !isNum(size[0], 1, character.width) || !isNum(size[1], 1, character.height)) return null;
    if (!Array.isArray(s.at) || s.at.length < 1 || s.at.length > L.maxSparkles) return null;
    const at = s.at.map((p) => point(p, character.width, character.height));
    if (!at.every((p) => p)) return null;
    sparkle = { image: s.image, width: size[0], height: size[1], at: at as DeskPetPoint[] };
  }

  const coverEntries = idMap(raw.covers ?? { book: {} }, L.maxCovers, 1);
  if (!coverEntries) return null;
  const covers: Record<string, DeskPetCover> = {};
  for (const [id, cv] of coverEntries) {
    if (!isRecord(cv) || !onlyKeys(cv, ["kind", "image", "tint"])) return null;
    const kind = cv.kind ?? "book";
    if (!isDeskPetSceneId(kind)) return null;
    if (cv.image !== undefined && !isDeskPetSceneFile(cv.image)) return null;
    let tint: [number, number, number] | null = null;
    if (cv.tint !== undefined) {
      if (!Array.isArray(cv.tint) || cv.tint.length !== 3 || !cv.tint.every((v) => isNum(v, 0, 2))) return null;
      const [r, g, b] = cv.tint as number[];
      tint = [r!, g!, b!];
    }
    covers[id] = { kind, image: (cv.image as string | undefined) ?? null, tint };
  }

  let pile: DeskPetPile | null = null;
  if (raw.pile !== undefined) {
    const p = raw.pile;
    if (!isRecord(p) || !onlyKeys(p, ["image", "at", "size", "step", "max", "cover", "deck"]) || !isDeskPetSceneFile(p.image)) return null;
    const size = p.size;
    if (!Array.isArray(size) || size.length !== 2 || !isInt(size[0], 1, canvas.width) || !isInt(size[1], 1, canvas.height)) return null;
    const at = p.at;
    if (!Array.isArray(at) || at.length !== 2 || !isInt(at[0], 0, canvas.width - size[0]) || !isInt(at[1], 0, canvas.height - size[1])) return null;
    const max = p.max ?? L.maxPile;
    const step = p.step;
    if (!isInt(max, 1, L.maxPile) || !isInt(step, 0, canvas.height) || at[1] - (max - 1) * step < 0) return null;
    let cover: DeskPetQuad | null = null;
    if (p.cover !== undefined && !(cover = quad(p.cover, size[0], size[1]))) return null;
    const rawDeck = p.deck ?? [{ cover: Object.keys(covers)[0] }];
    if (!Array.isArray(rawDeck) || rawDeck.length < 1 || rawDeck.length > L.maxPile) return null;
    const deck: { cover: string; units: number }[] = [];
    for (const d of rawDeck) {
      if (!isRecord(d) || !onlyKeys(d, ["cover", "units"]) || typeof d.cover !== "string" || !covers[d.cover]) return null;
      const units = d.units ?? 1;
      if (!isInt(units, 1, L.maxUnits)) return null;
      deck.push({ cover: d.cover, units });
    }
    pile = { image: p.image, x: at[0], y: at[1], width: size[0], height: size[1], step, max, cover, deck };
  }

  if (!isRecord(raw.clips) || !onlyKeys(raw.clips, DESK_PET_CLIP_ROLES)) return null;
  const clips: Partial<Record<DeskPetClipRole, DeskPetSceneFrame[]>> = {};
  for (const role of DESK_PET_CLIP_ROLES) {
    const frames = raw.clips[role];
    if (frames === undefined) continue;
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > L.maxFrames) return null;
    const out: DeskPetSceneFrame[] = [];
    for (const f of frames) {
      if (!isRecord(f) || !onlyKeys(f, ["body", "prop", "ms", "magic", "page"])) return null;
      if (typeof f.body !== "string" || !bodies[f.body] || !isInt(f.ms, L.minFrameMs, L.maxFrameMs)) return null;
      if (f.prop !== undefined && (typeof f.prop !== "string" || !props[f.prop])) return null;
      if (f.page !== undefined && (typeof f.page !== "string" || !pages[f.page])) return null;
      if (f.magic !== undefined && (!isNum(f.magic, 0, 1) || f.prop === undefined)) return null;
      out.push({ body: f.body, prop: (f.prop as string | undefined) ?? null, ms: f.ms, magic: (f.magic as number | undefined) ?? null, page: (f.page as string | undefined) ?? null });
    }
    clips[role] = out;
  }
  if (!clips.idle || !clips.reading) return null;
  const sleep = [clips.fallAsleep, clips.sleeping, clips.wake].filter(Boolean).length;
  if (sleep !== 0 && sleep !== 3) return null;

  const scene: DeskPetScene = { canvas, character, breathMs, bodies, props, pages, hands, sparkle, covers, pile, clips };
  if (deskPetSceneFiles(scene).length > L.maxImages) return null;
  return scene;
}

/** Every file the scene names, once each, in a fixed order. */
export function deskPetSceneFiles(scene: DeskPetScene): string[] {
  const files = new Set<string>();
  for (const b of Object.values(scene.bodies)) [b.still, ...b.breath].forEach((f) => files.add(f));
  for (const p of Object.values(scene.props)) {
    files.add(p.image);
    if (p.cover?.over) files.add(p.cover.over);
  }
  Object.values(scene.pages).forEach((f) => files.add(f));
  if (scene.hands) files.add(scene.hands);
  if (scene.sparkle) files.add(scene.sparkle.image);
  for (const c of Object.values(scene.covers)) if (c.image) files.add(c.image);
  if (scene.pile) files.add(scene.pile.image);
  return [...files];
}

/** Files drawn over the character's box (the rest have their own place: covers, the pile, sparkles). */
export function deskPetCharacterFiles(scene: DeskPetScene): string[] {
  const files = new Set<string>();
  for (const b of Object.values(scene.bodies)) [b.still, ...b.breath].forEach((f) => files.add(f));
  for (const p of Object.values(scene.props)) {
    files.add(p.image);
    if (p.cover?.over) files.add(p.cover.over);
  }
  Object.values(scene.pages).forEach((f) => files.add(f));
  if (scene.hands) files.add(scene.hands);
  return [...files];
}

/** Where book `i` of the pile (0 = the lowest) lies, canvas units. */
export function pileBookBox(pile: DeskPetPile, i: number): DeskPetBox {
  return { x: pile.x, y: pile.y - i * pile.step, width: pile.width, height: pile.height };
}

/** The green key: pixels a cover tint recolours (a prop with a cover, the pile image). */
export function isGreenKeyed(r: number, g: number, b: number, a: number): boolean {
  return a > 0 && g > r * 1.05 && g > b * 1.02;
}

/** One green-keyed pixel under a tint: its grey level times the tint, kept in range. */
export function tinted(r: number, g: number, b: number, tint: readonly [number, number, number]): [number, number, number] {
  const lum = (r + g + b) / 3;
  return [Math.min(255, Math.round(lum * tint[0])), Math.min(255, Math.round(lum * tint[1])), Math.min(255, Math.round(lum * tint[2]))];
}

/** One book as the module tracks it and the window draws it. */
export interface DeskPetBook { id: string; cover: string }
/** What the window shows: the book in hand (null = none) and the pile, lowest first. */
export interface DeskPetBooks { active: DeskPetBook | null; pile: readonly DeskPetBook[] }

export function isDeskPetBookId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function parseDeskPetBooks(raw: unknown): DeskPetBooks {
  if (!isRecord(raw) || !Array.isArray(raw.pile) || raw.pile.length > DESK_PET_SCENE.maxPile) throw new Error("bad desk pet books");
  const book = (b: unknown): DeskPetBook => {
    if (!isRecord(b) || !isDeskPetBookId(b.id) || !isDeskPetSceneId(b.cover)) throw new Error("bad desk pet book");
    return { id: b.id, cover: b.cover };
  };
  return { active: raw.active === null ? null : book(raw.active), pile: raw.pile.map(book) };
}

/** Canvas units per DIP-on-screen: the character's longest side at `baseDip` × size × scale, kept within `maxSide` for the whole canvas. */
export function sceneDipPerUnit(scene: Pick<DeskPetScene, "canvas" | "character">, baseDip: number, size: number, scale: number, maxSide: number): number {
  const wanted = (baseDip * size * scale) / Math.max(scene.character.width, scene.character.height);
  return Math.min(wanted, maxSide / Math.max(scene.canvas.width, scene.canvas.height));
}
