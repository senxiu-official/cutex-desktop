// The desk pet's window service (docs/desktop-modules.md §29): what the module (signed pack, renderer only) and the
// window's own document may ask of main/deskPet.ts. Fixed ops and plain values: never a URL, a path, coordinates or
// image bytes. The art format and its checks live here as pure functions, shared with the tests; format 2's scene is in
// ./deskPetScene.
import { parseDeskPetBooks, parseDeskPetScene, type DeskPetBooks, type DeskPetScene } from "./deskPetScene";

export const DESK_PET_CHANNEL = "cutex-desktop:desk-pet";

export type DeskPetPose = "both" | "left" | "right";
export const DESK_PET_POSES: readonly DeskPetPose[] = ["both", "left", "right"];
export const DESK_PET_SIZES: readonly number[] = [0.5, 0.75, 1, 1.5, 2];
export const DESK_PET_OPACITIES: readonly number[] = [1, 0.85, 0.7, 0.55, 0.4];
/** 半透明 in the pet's menu. */
export const DESK_PET_TRANSLUCENT = 0.55;
/** The longest side of the art on screen at 100 %, in DIP. */
export const DESK_PET_BASE_DIP = 160;
/** The window is at least this wide and this much taller while it shows the count. */
export const DESK_PET_COUNT_WIDTH = 96;
export const DESK_PET_COUNT_HEIGHT = 24;

export interface DeskPetSettings {
  hidden: boolean;
  /** Every click passes through the pet; the way back is the tray, the identity menu and Settings. */
  clickThrough: boolean;
  /** One of DESK_PET_OPACITIES. */
  opacity: number;
  /** Flips the whole pet left to right. A hand frame still means that hand as seen on screen. */
  mirror: boolean;
  /** Follow the open conversation's model family when a character has that family, else `character`. */
  followModel: boolean;
  /** Shown only while a cutex window has the focus. */
  onlyInFront: boolean;
  showCount: boolean;
  /** Blink every few seconds at rest: the one timer a resting pet has, inside its own window. */
  idleBlink: boolean;
  /** One of DESK_PET_SIZES. */
  size: number;
  /** A listed character id; null = the first one (the owner's folder, then the pack, then the placeholder). */
  character: string | null;
  /** Moves only for the open conversation's agent, not for every agent on the connected hosts. */
  currentOnly: boolean;
  /** A mark over the head while something waits on the owner that they have not opened. */
  waitingMark: boolean;
  /** A small icon rises over the head when tokens arrive (the set's icon for the model family, else a plain coin). */
  tokenIcons: boolean;
}

export const DESK_PET_DEFAULTS: DeskPetSettings = { hidden: false, clickThrough: false, opacity: 1, mirror: false, followModel: false, onlyInFront: false, showCount: true, idleBlink: true, size: 1, character: null, currentOnly: false, waitingMark: true, tokenIcons: false };

export type DeskPetArtSource = "folder" | "pack" | "placeholder";
export type DeskPetName = string | Readonly<Record<string, string>>;
/** A format 2 character's pile, for the module's book accounting (§29.10): how many books it holds and the covers new ones take. */
export interface DeskPetBookArt { max: number; deck: readonly { cover: string; kind: string; units: number }[] }
export interface DeskPetCharacter {
  id: string;
  name: DeskPetName;
  family: string | null;
  source: DeskPetArtSource;
  pixel: boolean;
  /** 1 = hand frames (§29.4); 2 = a scene (§29.9). */
  format: 1 | 2;
  /** Format 2 with a pile; null otherwise. */
  books: DeskPetBookArt | null;
}

export type DeskPetArtProblemCode =
  | "badName" | "reservedName" | "tooMany" | "notPlainFolder" | "noManifest" | "badManifest"
  | "missingFile" | "notPlainFile" | "tooLarge" | "notPng" | "animatedPng" | "badDimensions" | "sizeMismatch" | "undecodable" | "badIconDimensions"
  | "badSceneDimensions" | "setTooLarge";
export interface DeskPetArtProblem { character: string; file: string | null; code: DeskPetArtProblemCode }

export interface DeskPetView {
  running: boolean;
  settings: DeskPetSettings;
  characters: readonly DeskPetCharacter[];
  /** The character on screen. */
  current: string;
  problems: readonly DeskPetArtProblem[];
  /** The folder the owner drops art into (shown, and opened by `openFolder`). */
  artDir: string;
  /** The window draws format 2 scenes (an older app does not: the module then plays hand taps). */
  scenes?: boolean;
  /** "limited" = Linux Wayland: the compositor places windows, so the position is not kept. */
  placement: "full" | "limited";
  /** False: transparent pixels catch clicks too (the system refused the window shape). */
  shape: boolean;
  /** False: the system does not keep it above other windows (Linux Wayland other than KDE Plasma); null: not known yet. */
  onTop?: boolean | null;
}

/** Native menu rows; the module supplies them in the UI language. */
export const DESK_PET_MENU_KEYS = ["clickThrough", "translucent", "mirror", "onlyInFront", "showCount", "size", "character", "hide", "settings"] as const;
export type DeskPetMenuKey = (typeof DESK_PET_MENU_KEYS)[number];
export type DeskPetLabels = Readonly<Record<DeskPetMenuKey, string>>;

export type DeskPetRequest =
  | { op: "state" }
  | { op: "start"; labels: DeskPetLabels }
  | { op: "stop" }
  | { op: "set"; patch: Partial<DeskPetSettings> }
  /** `mark`: the waiting mark on or off; `icon`: one icon rises now (a family id, or "coin"); `work`, `books`: a format 2 scene (§29.10). */
  | { op: "tick"; pose?: DeskPetPose; total?: number; summary?: string; mark?: boolean; icon?: string; work?: boolean; books?: DeskPetBooks }
  | { op: "reloadArt" }
  | { op: "openFolder" }
  /** One listed character's rest pose, small: its layers, bottom to top. */
  | { op: "preview"; id: string }
  /** The open conversation's family (pet.json `family`), for the followModel setting; null = none. */
  | { op: "follow"; family: string | null };

export type DeskPetWindowRequest = { op: "state" } | { op: "dragStart" } | { op: "dragEnd" } | { op: "menu" } | { op: "stage"; kind: DeskPetStage };

/**
 * The window always holds room round the pet, and its shape decides what is drawn and catches clicks (on Windows a shape
 * clips drawing too). So a fan or a bubble only changes the shape: the pet never moves, the room costs nothing.
 */
export const DESK_PET_STAGE_SIDE = 84;
export const DESK_PET_STAGE_TOP = 84;
export type DeskPetStage = "none" | "bubble" | "fan";
/** Which side the fan and bubble open to; null = no room here (Wayland: the page uses the native menu). */
export interface DeskPetStageBox { below: boolean }

/** The window round a pet whose picture and count are `size`, at `at`. */
export function stageBounds(at: { x: number; y: number }, size: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return {
    x: at.x - DESK_PET_STAGE_SIDE,
    y: at.y - DESK_PET_STAGE_TOP,
    width: size.width + 2 * DESK_PET_STAGE_SIDE,
    height: size.height + 2 * DESK_PET_STAGE_TOP,
  };
}

/** The part of the window a bubble is drawn in, above the pet or below it and its count. Holds the page's #bubble. */
export function bubbleRect(size: { width: number; height: number }, below: boolean): { x: number; y: number; width: number; height: number } {
  const width = 72, height = 44;
  return { x: DESK_PET_STAGE_SIDE + Math.floor((size.width - width) / 2), y: below ? DESK_PET_STAGE_TOP + size.height + 4 : DESK_PET_STAGE_TOP - height - 4, width, height };
}

/** Over the head: the waiting mark and rising icons are drawn here, inside the room above the pet. */
export const DESK_PET_OVERHEAD = { width: 64, height: 60 } as const;
/** `centre`: over where in the window's content (DIP from its left), when the head is not in the middle (a scene's pile beside it). */
export function overheadRect(size: { width: number }, centre = size.width / 2): { x: number; y: number; width: number; height: number } {
  const { width, height } = DESK_PET_OVERHEAD;
  return { x: DESK_PET_STAGE_SIDE + Math.floor(centre - width / 2), y: DESK_PET_STAGE_TOP - height, width, height };
}
/** How long one rising icon is on screen. */
export const DESK_PET_ICON_MS = 1100;

/** The fan: `n` points on the open half of an ellipse round the pet, relative to its centre. Always inside the window's room. */
export function fanPoints(n: number, petWidth: number, petHeight: number, below: boolean): { x: number; y: number }[] {
  const across = petWidth / 2 + 30;
  const along = petHeight / 2 + 30;
  return Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI * (i + 0.5)) / n;
    const y = along * Math.sin(angle);
    return { x: Math.round(-across * Math.cos(angle)) + 0, y: Math.round(below ? y : -y) };
  });
}

export interface DeskPetBridge {
  state(): Promise<DeskPetView>;
  start(labels: DeskPetLabels): Promise<DeskPetView>;
  stop(): Promise<void>;
  set(patch: Partial<DeskPetSettings>): Promise<DeskPetView>;
  tick(tick: { pose?: DeskPetPose; total?: number; summary?: string; mark?: boolean; icon?: string; work?: boolean; books?: DeskPetBooks }): Promise<void>;
  reloadArt(): Promise<DeskPetView>;
  openFolder(): Promise<void>;
  preview(id: string): Promise<readonly string[]>;
  follow(family: string | null): Promise<void>;
  onState(listener: (view: DeskPetView) => void): () => void;
  /** 设置 in the pet's menu: the app window was shown; open the module's page. */
  onOpenSettings(listener: () => void): () => void;
}

/** What the window's document draws, bottom to top: face / faceBlink, a hand frame, blink, accessory. Data URLs of PNGs main re-encoded; null = the set has none. */
export interface DeskPetWindowState {
  frames: Readonly<Record<DeskPetPose, string>>;
  face: string | null;
  faceBlink: string | null;
  blink: string | null;
  accessory: string | null;
  /** The set's icons by model family (`icon-<family>.png`), "any" for `icon.png`; a family without one draws the plain coin. */
  icons: Readonly<Record<string, string>>;
  /** The waiting mark is up. */
  mark: boolean;
  /** The window's document blinks by itself every few seconds. */
  idleBlink: boolean;
  artWidth: number;
  artHeight: number;
  showCount: boolean;
  opacity: number;
  mirror: boolean;
  pixel: boolean;
  /** The room round the pet in the window (0 on Wayland). */
  insetX: number;
  insetY: number;
  total: number;
  /** Wayland: the window cannot place itself, so the compositor drags it (CSS app-region). */
  nativeDrag: boolean;
  /** A format 2 character (then `frames` are empty). `art` comes only when the window may not have this `key` yet. */
  scene: { key: string; art?: DeskPetSceneArt } | null;
  /** Agents are at work (the scene reads); the books in hand and on the pile. */
  work: boolean;
  books: DeskPetBooks;
}
/** A scene and its images: data URLs of PNGs main re-encoded, by file name. */
export interface DeskPetSceneArt { scene: DeskPetScene; images: Readonly<Record<string, string>> }
export interface DeskPetWindowTick { pose?: DeskPetPose; total?: number; mark?: boolean; icon?: string; work?: boolean; books?: DeskPetBooks }

export interface DeskPetWindowBridge {
  state(): Promise<DeskPetWindowState | null>;
  onState(listener: (state: DeskPetWindowState) => void): void;
  onTick(listener: (tick: DeskPetWindowTick) => void): void;
  dragStart(): void;
  dragMove(): void;
  dragEnd(): void;
  menu(): void;
  stage(kind: DeskPetStage): Promise<DeskPetStageBox | null>;
}

const MAX_LABEL = 80;
const MAX_SUMMARY = 160;

export function isDeskPetCharacterId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Settings as stored or asked for: anything unknown or malformed is dropped, never coerced. */
export function parseDeskPetPatch(raw: unknown): Partial<DeskPetSettings> {
  if (!isRecord(raw)) throw new Error("bad desk pet settings");
  const out: Partial<DeskPetSettings> = {};
  for (const key of ["hidden", "clickThrough", "mirror", "followModel", "onlyInFront", "showCount", "idleBlink", "currentOnly", "waitingMark", "tokenIcons"] as const) {
    const value = raw[key];
    if (typeof value === "boolean") out[key] = value;
  }
  if (typeof raw.size === "number" && DESK_PET_SIZES.includes(raw.size)) out.size = raw.size;
  if (typeof raw.opacity === "number" && DESK_PET_OPACITIES.includes(raw.opacity)) out.opacity = raw.opacity;
  if (raw.character === null || isDeskPetCharacterId(raw.character)) out.character = raw.character;
  return out;
}

export function parseDeskPetRequest(raw: unknown): DeskPetRequest {
  if (!isRecord(raw)) throw new Error("bad desk pet request");
  switch (raw.op) {
    case "state":
    case "stop":
    case "reloadArt":
    case "openFolder":
      return { op: raw.op };
    case "start": {
      if (!isRecord(raw.labels)) throw new Error("bad desk pet labels");
      const labels = {} as Record<DeskPetMenuKey, string>;
      for (const key of DESK_PET_MENU_KEYS) {
        const label = raw.labels[key];
        if (typeof label !== "string" || !label || label.length > MAX_LABEL) throw new Error("bad desk pet labels");
        labels[key] = label;
      }
      return { op: "start", labels };
    }
    case "set":
      return { op: "set", patch: parseDeskPetPatch(raw.patch) };
    case "preview":
      if (!isDeskPetCharacterId(raw.id)) throw new Error("bad desk pet character");
      return { op: "preview", id: raw.id };
    case "follow":
      if (raw.family !== null && !isDeskPetCharacterId(raw.family)) throw new Error("bad desk pet family");
      return { op: "follow", family: raw.family };
    case "tick": {
      const tick: DeskPetRequest & { op: "tick" } = { op: "tick" };
      if (raw.pose !== undefined) {
        if (!DESK_PET_POSES.includes(raw.pose as DeskPetPose)) throw new Error("bad desk pet pose");
        tick.pose = raw.pose as DeskPetPose;
      }
      if (raw.total !== undefined) {
        if (typeof raw.total !== "number" || !Number.isSafeInteger(raw.total) || raw.total < 0) throw new Error("bad desk pet total");
        tick.total = raw.total;
      }
      if (raw.mark !== undefined) {
        if (typeof raw.mark !== "boolean") throw new Error("bad desk pet mark");
        tick.mark = raw.mark;
      }
      if (raw.icon !== undefined) {
        if (raw.icon !== DESK_PET_COIN && !DESK_PET_ICON_FAMILIES.includes(raw.icon as string)) throw new Error("bad desk pet icon");
        tick.icon = raw.icon as string;
      }
      if (raw.work !== undefined) {
        if (typeof raw.work !== "boolean") throw new Error("bad desk pet work");
        tick.work = raw.work;
      }
      if (raw.books !== undefined) tick.books = parseDeskPetBooks(raw.books);
      if (raw.summary !== undefined) {
        if (typeof raw.summary !== "string" || raw.summary.length > MAX_SUMMARY) throw new Error("bad desk pet summary");
        tick.summary = raw.summary;
      }
      return tick;
    }
    default:
      throw new Error("unknown desk pet op");
  }
}

// ---- the art format ----

export const DESK_PET_ART = {
  /** Only so a huge folder cannot stall a read of it: listing reads one small manifest and the head of each image. */
  maxCharacters: 256,
  manifest: "pet.json",
  manifestBytes: 64 * 1024,
  imageBytes: 2 * 1024 * 1024,
  minSide: 64,
  maxSide: 1024,
  required: ["both.png", "left.png", "right.png"],
  /** Layers, bottom to top: `face` (or `face-blink` during a blink), the hand frame, `blink`, `accessory`. */
  optional: ["face.png", "face-blink.png", "blink.png", "accessory.png"],
  /** Optional icons, any size of their own: `icon.png` for every family, `icon-<family>.png` for one. Square. */
  iconBytes: 256 * 1024,
  iconMinSide: 32,
  iconMaxSide: 256,
} as const;
/** Model families an icon can be for (pet.json `family` uses the same ids). */
export const DESK_PET_ICON_FAMILIES: readonly string[] = ["claude", "gpt", "gemini", "deepseek", "kimi", "glm"];
/** The built-in icon (drawn by the window, no file). */
export const DESK_PET_COIN = "coin";
/** Icon file → the family it is for ("any" = `icon.png`). */
export const DESK_PET_ICON_FILES: Readonly<Record<string, string>> = Object.fromEntries([["icon.png", "any"], ...DESK_PET_ICON_FAMILIES.map((f) => [`icon-${f}.png`, f])]);

/** The checks on one icon's bytes. */
export function checkDeskPetIcon(bytes: Uint8Array): DeskPetArtProblemCode | { width: number; height: number } {
  if (bytes.length > DESK_PET_ART.iconBytes) return "tooLarge";
  const header = readPngHeader(bytes);
  if (!header) return "notPng";
  if (header.animated) return "animatedPng";
  if (header.width !== header.height || header.width < DESK_PET_ART.iconMinSide || header.width > DESK_PET_ART.iconMaxSide) return "badIconDimensions";
  return { width: header.width, height: header.height };
}
/** A pixel with at least this alpha in any frame is drawn and catches clicks. */
export const DESK_PET_ALPHA_MIN = 16;
/** The pet until the owner chooses one; without it (a folder-only set), the first listed. */
export const DESK_PET_DEFAULT_CHARACTER = "claude";

/** The frame that shows a pose: mirrored, the other hand's frame raises the hand the pose means on screen. */
export function shownPose(pose: DeskPetPose, mirror: boolean): DeskPetPose {
  if (!mirror || pose === "both") return pose;
  return pose === "left" ? "right" : "left";
}

/** The shape of the flipped picture. */
export function mirrorRects<T extends { x: number; width: number }>(rects: readonly T[], width: number): T[] {
  return rects.map((r) => ({ ...r, x: width - r.x - r.width }));
}
export const DESK_PET_PLACEHOLDER_ID = "placeholder";

export interface DeskPetManifest {
  name: DeskPetName;
  family: string | null;
  scale: number;
  /** Pixel art: scaled by nearest neighbour, so the grid stays crisp. */
  pixel: boolean;
  /** Format 2's scene (./deskPetScene); null = format 1. */
  scene: DeskPetScene | null;
}

/** pet.json: format 1 (a name, optional family and scale; no paths), or format 2 (the same plus a scene naming its files). Null = refused. */
export function parseDeskPetManifest(raw: unknown): DeskPetManifest | null {
  if (!isRecord(raw) || (raw.format !== 1 && raw.format !== 2)) return null;
  let scene: DeskPetScene | null = null;
  if (raw.format === 2 && !(scene = parseDeskPetScene(raw))) return null;
  const good = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 40;
  let name: DeskPetName;
  if (good(raw.name)) name = raw.name;
  else if (isRecord(raw.name)) {
    const entries = Object.entries(raw.name);
    if (!entries.length || entries.length > 16 || !entries.every(([k, v]) => /^[A-Za-z-]{2,16}$/.test(k) && good(v))) return null;
    name = Object.fromEntries(entries) as Record<string, string>;
  } else return null;
  let family: string | null = null;
  if (raw.family !== undefined) {
    if (!isDeskPetCharacterId(raw.family)) return null;
    family = raw.family;
  }
  let scale = 1;
  if (raw.scale !== undefined) {
    if (typeof raw.scale !== "number" || !(raw.scale >= 0.25 && raw.scale <= 2)) return null;
    scale = raw.scale;
  }
  if (raw.pixel !== undefined && typeof raw.pixel !== "boolean") return null;
  return { name, family, scale, pixel: raw.pixel === true, scene };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Walks the PNG chunks up to the image data: the header's size, and whether it is an animated PNG. Null = not a PNG. */
export function readPngHeader(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (view.getUint32(8) !== 13 || tag(12) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let animated = false;
  for (let at = 33; at + 8 <= bytes.length; ) {
    const name = tag(at + 4);
    if (name === "IDAT") break;
    if (name === "acTL") animated = true;
    at += 12 + view.getUint32(at);
  }
  return { width, height, animated };
}

/** The checks on one image's bytes, before anything decodes them. */
export function checkDeskPetImage(bytes: Uint8Array): DeskPetArtProblemCode | { width: number; height: number } {
  if (bytes.length > DESK_PET_ART.imageBytes) return "tooLarge";
  const header = readPngHeader(bytes);
  if (!header) return "notPng";
  if (header.animated) return "animatedPng";
  const inRange = (n: number) => n >= DESK_PET_ART.minSide && n <= DESK_PET_ART.maxSide;
  if (!inRange(header.width) || !inRange(header.height)) return "badDimensions";
  return { width: header.width, height: header.height };
}

// ---- pure window geometry ----

export interface PetRect { x: number; y: number; width: number; height: number }

/** The art's size on screen: the longest side at DESK_PET_BASE_DIP × size × the character's scale, kept within `maxSide`. */
export function artDisplaySize(pixelWidth: number, pixelHeight: number, size: number, scale: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(pixelWidth, pixelHeight);
  const side = Math.min(DESK_PET_BASE_DIP * size * scale, maxSide);
  return { width: Math.max(1, Math.round((pixelWidth / longest) * side)), height: Math.max(1, Math.round((pixelHeight / longest) * side)) };
}

/** The window around the art: as wide as the count needs, taller while it shows the count. */
export function petWindowSize(art: { width: number; height: number }, showCount: boolean): { width: number; height: number } {
  return showCount ? { width: Math.max(art.width, DESK_PET_COUNT_WIDTH), height: art.height + DESK_PET_COUNT_HEIGHT } : { width: art.width, height: art.height };
}

const MAX_RECTS = 1200;

/**
 * The shape of the window (DIP rectangles relative to the art's top-left) from the union of the frames' alpha:
 * bands `cell` DIP high, spans rounded outwards so nothing drawn is ever clipped, equal neighbours merged. Coarser
 * cells when the outline is too busy for the system's region.
 */
export function petShapeRects(alpha: Uint8Array, pixelWidth: number, pixelHeight: number, displayWidth: number, displayHeight: number, cell = 2): PetRect[] {
  const perDipX = pixelWidth / displayWidth;
  const perDipY = pixelHeight / displayHeight;
  const out: PetRect[] = [];
  let open: PetRect[] = [];
  for (let dipY = 0; dipY < displayHeight; dipY += cell) {
    const rowStart = Math.floor(dipY * perDipY);
    const rowEnd = Math.min(pixelHeight, Math.ceil((dipY + cell) * perDipY));
    const spans: [number, number][] = [];
    for (let dipX = 0; dipX < displayWidth; dipX += cell) {
      const colStart = Math.floor(dipX * perDipX);
      const colEnd = Math.min(pixelWidth, Math.ceil((dipX + cell) * perDipX));
      let hit = false;
      for (let y = rowStart; y < rowEnd && !hit; y++) {
        for (let x = colStart; x < colEnd; x++) {
          if (alpha[y * pixelWidth + x]! >= DESK_PET_ALPHA_MIN) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      const last = spans.at(-1);
      if (last && last[1] === dipX) last[1] = Math.min(displayWidth, dipX + cell);
      else spans.push([dipX, Math.min(displayWidth, dipX + cell)]);
    }
    const height = Math.min(cell, displayHeight - dipY);
    const next: PetRect[] = [];
    for (const [start, end] of spans) {
      const grown = open.find((r) => r.x === start && r.width === end - start);
      if (grown) {
        grown.height += height;
        next.push(grown);
      } else {
        const rect = { x: start, y: dipY, width: end - start, height };
        out.push(rect);
        next.push(rect);
      }
    }
    open = next;
  }
  if (out.length > MAX_RECTS && cell < 32) return petShapeRects(alpha, pixelWidth, pixelHeight, displayWidth, displayHeight, cell * 2);
  return out;
}

/** The saved top-left kept on a display: at least `keep` DIP of the window stays inside one work area; null without displays. */
export function keepOnDisplays(position: { x: number; y: number }, size: { width: number; height: number }, areas: readonly PetRect[], keep = 24): { x: number; y: number } | null {
  let best: { x: number; y: number; moved: number } | null = null;
  for (const a of areas) {
    const x = Math.min(Math.max(position.x, a.x + keep - size.width), a.x + a.width - keep);
    const y = Math.min(Math.max(position.y, a.y), a.y + a.height - keep);
    const moved = Math.abs(x - position.x) + Math.abs(y - position.y);
    if (!best || moved < best.moved) best = { x, y, moved };
  }
  return best && { x: best.x, y: best.y };
}
