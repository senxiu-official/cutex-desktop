// The desk pet's characters (docs/desktop-modules.md §29): the owner's folder `<userData>/desk-pet/art/<id>/`, the art
// inside the signed pack, and the drawn placeholder. Fixed file names only: the format has no paths, the renderer
// names only a listed character id. Folder files go through the same plain-file reads as the portrait packs (lstat, no
// symlink or junction on the way, size cap); each image is checked by its bytes (real PNG signature, not animated, size
// range) before anything decodes it, then re-encoded, so what reaches the window is a plain PNG from main. Format 2
// (§29.9) names its files in pet.json; the same reads and checks apply to each, under that format's limits.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDeskPetIcon, checkDeskPetImage, DESK_PET_ALPHA_MIN, DESK_PET_ART, DESK_PET_ICON_FILES, DESK_PET_PLACEHOLDER_ID, isDeskPetCharacterId, parseDeskPetManifest, readPngHeader, type DeskPetArtProblem, type DeskPetArtProblemCode, type DeskPetBookArt, type DeskPetCharacter, type DeskPetManifest } from "../shared/deskPet";
import { deskPetCharacterFiles, deskPetSceneFiles, DESK_PET_SCENE, pileBookBox, type DeskPetScene } from "../shared/deskPetScene";
import { isPlainDir, readFileSafe } from "./portraitPacks";

/** One decoded image; `alpha` holds one byte per pixel. */
export interface DecodedImage { width: number; height: number; alpha: Uint8Array; dataUrl: string }
/** The Electron side (nativeImage), injected so the rules run in plain tests. Null = it does not decode. `fit`: scaled
 * down (never up) to fit inside that many pixels, keeping its shape. */
export type DecodeImage = (png: Buffer, fit?: { width: number; height: number }) => DecodedImage | null;

/** Read-only access to art in the signed pack: paths relative to the pack's `art/`; every read is hashed again by the pack service. */
export interface PackArt {
  characters(): string[];
  read(character: string, file: string): Buffer | null;
}

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

export interface LoadedCharacter {
  width: number;
  height: number;
  scale: number;
  pixel: boolean;
  /** Union of all layers; `width × height` bytes. */
  alpha: Uint8Array;
  both: string;
  left: string;
  right: string;
  face: string | null;
  faceBlink: string | null;
  blink: string | null;
  accessory: string | null;
  /** Icons by family ("any" = `icon.png`); not part of the shape (they are drawn over the head). */
  icons: Record<string, string>;
  /** Format 2: `width` × `height` are the canvas in its units, `alpha` the character's layers only (the pile changes). */
  scene?: LoadedScene;
}

export interface LoadedScene {
  scene: DeskPetScene;
  images: Record<string, string>;
  /** The pile image's alpha in its own units (`pile.width` × `pile.height`); null = no pile. */
  pileAlpha: Uint8Array | null;
}

/** `head`: only as much as the checks need (listing dozens of sets stays cheap). */
type Reader = (file: string, head?: boolean) => Promise<Buffer | "missing" | "notPlain" | "tooLarge">;
const HEAD_BYTES = 64 * 1024;

export interface Listed { character: DeskPetCharacter; manifest: DeskPetManifest; read: Reader }

async function checkSet(id: string, read: Reader, problems: DeskPetArtProblem[]): Promise<DeskPetManifest | null> {
  const raw = await read(DESK_PET_ART.manifest);
  if (raw === "missing") {
    problems.push({ character: id, file: DESK_PET_ART.manifest, code: "noManifest" });
    return null;
  }
  if (raw === "notPlain" || raw === "tooLarge") {
    problems.push({ character: id, file: DESK_PET_ART.manifest, code: raw === "notPlain" ? "notPlainFile" : "tooLarge" });
    return null;
  }
  let manifest: DeskPetManifest | null = null;
  try {
    manifest = parseDeskPetManifest(JSON.parse(raw.toString("utf8")));
  } catch {
    manifest = null;
  }
  if (!manifest) {
    problems.push({ character: id, file: DESK_PET_ART.manifest, code: "badManifest" });
    return null;
  }
  if (manifest.scene) return (await checkScene(id, manifest.scene, read, problems)) && (await checkIcons(id, read, problems)) ? manifest : null;
  let size: string | null = null;
  for (const file of [...DESK_PET_ART.required, ...DESK_PET_ART.optional]) {
    const required = (DESK_PET_ART.required as readonly string[]).includes(file);
    const bytes = await read(file, true);
    if (bytes === "missing") {
      if (!required) continue;
      problems.push({ character: id, file, code: "missingFile" });
      return null;
    }
    if (bytes === "notPlain" || bytes === "tooLarge") {
      problems.push({ character: id, file, code: bytes === "notPlain" ? "notPlainFile" : "tooLarge" });
      return null;
    }
    const checked = checkDeskPetImage(bytes);
    if (typeof checked === "string") {
      problems.push({ character: id, file, code: checked });
      return null;
    }
    const here = `${checked.width}x${checked.height}`;
    if (size && size !== here) {
      problems.push({ character: id, file, code: "sizeMismatch" });
      return null;
    }
    size = here;
  }
  return (await checkIcons(id, read, problems)) ? manifest : null;
}

async function checkIcons(id: string, read: Reader, problems: DeskPetArtProblem[]): Promise<boolean> {
  for (const file of Object.keys(DESK_PET_ICON_FILES)) {
    const bytes = await read(file, true);
    if (bytes === "missing") continue;
    const checked = bytes === "notPlain" ? "notPlainFile" : bytes === "tooLarge" ? "tooLarge" : checkDeskPetIcon(bytes);
    if (typeof checked === "string") {
      problems.push({ character: id, file, code: checked });
      return false;
    }
  }
  return true;
}

/** The checks on one format 2 image's bytes (its own size: a scene's files differ). */
export function checkSceneImage(bytes: Uint8Array): DeskPetArtProblemCode | { width: number; height: number } {
  if (bytes.length > DESK_PET_SCENE.imageBytes) return "tooLarge";
  const header = readPngHeader(bytes);
  if (!header) return "notPng";
  if (header.animated) return "animatedPng";
  const inRange = (n: number) => n >= DESK_PET_SCENE.minSide && n <= DESK_PET_SCENE.maxSide;
  if (!inRange(header.width) || !inRange(header.height)) return "badSceneDimensions";
  return { width: header.width, height: header.height };
}

/** Every file a scene names: there, plain, a still PNG in range; all of them within the set's decoded size. */
async function checkScene(id: string, scene: DeskPetScene, read: Reader, problems: DeskPetArtProblem[]): Promise<boolean> {
  let pixels = 0;
  for (const file of deskPetSceneFiles(scene)) {
    const bytes = await read(file, true);
    const checked = bytes === "missing" ? "missingFile" : bytes === "notPlain" ? "notPlainFile" : bytes === "tooLarge" ? "tooLarge" : checkSceneImage(bytes);
    if (typeof checked === "string") {
      problems.push({ character: id, file, code: checked });
      return false;
    }
    pixels += checked.width * checked.height;
  }
  if (pixels > DESK_PET_SCENE.setPixels) {
    problems.push({ character: id, file: null, code: "setTooLarge" });
    return false;
  }
  return true;
}

/** The pile part of a format 2 character, for the module (§29.10). */
export function bookArtOf(scene: DeskPetScene | null): DeskPetBookArt | null {
  if (!scene?.pile) return null;
  return { max: scene.pile.max, deck: scene.pile.deck.map((d) => ({ cover: d.cover, kind: scene.covers[d.cover]!.kind, units: d.units })) };
}

function folderReader(dir: string): Reader {
  return async (file, head) => {
    const path = join(dir, file);
    let info;
    try {
      info = await lstat(path);
    } catch {
      return "missing";
    }
    if (info.isSymbolicLink() || !info.isFile()) return "notPlain";
    const max = file === DESK_PET_ART.manifest ? DESK_PET_ART.manifestBytes : DESK_PET_ART.imageBytes;
    if (info.size > max) return "tooLarge";
    if (head && file !== DESK_PET_ART.manifest) {
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | NOFOLLOW);
        const buffer = Buffer.alloc(Math.min(HEAD_BYTES, info.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
      } catch {
        return "notPlain";
      } finally {
        await handle?.close().catch(() => {});
      }
    }
    const read = await readFileSafe(path, max);
    return read ? read.bytes : "notPlain";
  };
}

/** Every valid character, the owner's folder first (it wins over a pack character of the same id), with what was refused and why. */
export async function listCharacters(artDir: string, pack: PackArt | null): Promise<{ listed: Map<string, Listed>; problems: DeskPetArtProblem[] }> {
  const listed = new Map<string, Listed>();
  const problems: DeskPetArtProblem[] = [];
  const add = (id: string, source: DeskPetCharacter["source"], manifest: DeskPetManifest, read: Reader) =>
    listed.set(id, { character: { id, name: manifest.name, family: manifest.family, source, pixel: manifest.pixel, format: manifest.scene ? 2 : 1, books: bookArtOf(manifest.scene) }, manifest, read });

  let names: string[] = [];
  // The root itself must be a plain folder: a linked art folder lists nothing.
  if (await isPlainDir(artDir)) names = (await readdir(artDir).catch(() => [] as string[])).filter((n) => !n.startsWith(".")).sort();
  let seen = 0;
  for (const name of names) {
    const dir = join(artDir, name);
    if (!(await isPlainDir(dir))) {
      // A stray file beside the sets is ignored; a link pretending to be a set is named.
      const info = await lstat(dir).catch(() => null);
      if (info?.isSymbolicLink()) problems.push({ character: name, file: null, code: "notPlainFolder" });
      continue;
    }
    if (name === DESK_PET_PLACEHOLDER_ID) {
      problems.push({ character: name, file: null, code: "reservedName" });
      continue;
    }
    if (!isDeskPetCharacterId(name)) {
      problems.push({ character: name, file: null, code: "badName" });
      continue;
    }
    if (++seen > DESK_PET_ART.maxCharacters) {
      problems.push({ character: name, file: null, code: "tooMany" });
      continue;
    }
    const read = folderReader(dir);
    const manifest = await checkSet(name, read, problems);
    if (manifest) add(name, "folder", manifest, read);
  }
  for (const id of pack?.characters() ?? []) {
    if (listed.has(id) || id === DESK_PET_PLACEHOLDER_ID || !isDeskPetCharacterId(id)) continue;
    const read: Reader = async (file) => pack!.read(id, file) ?? "missing";
    const manifest = await checkSet(id, read, problems);
    if (manifest) add(id, "pack", manifest, read);
  }
  return { listed, problems };
}

/** Decodes one listed character. Null + a problem when an image does not decode or the decoded sizes differ. `perUnit`:
 * format 2 images are scaled down to this many pixels per canvas unit (what the screen can show), never up. */
export async function loadCharacter(entry: Listed, decode: DecodeImage, problems: DeskPetArtProblem[], perUnit = Infinity): Promise<LoadedCharacter | null> {
  if (entry.manifest.scene) return loadScene(entry, entry.manifest.scene, decode, problems, perUnit);
  const images = new Map<string, DecodedImage>();
  const id = entry.character.id;
  for (const file of [...DESK_PET_ART.required, ...DESK_PET_ART.optional]) {
    const bytes = await entry.read(file);
    if (bytes === "missing") continue;
    if (bytes === "notPlain" || bytes === "tooLarge") {
      problems.push({ character: id, file, code: bytes === "notPlain" ? "notPlainFile" : "tooLarge" });
      return null;
    }
    const decoded = typeof checkDeskPetImage(bytes) === "string" ? null : decode(bytes);
    if (!decoded) {
      problems.push({ character: id, file, code: "undecodable" });
      return null;
    }
    images.set(file, decoded);
  }
  const both = images.get("both.png");
  const left = images.get("left.png");
  const right = images.get("right.png");
  if (!both || !left || !right) {
    problems.push({ character: id, file: null, code: "missingFile" });
    return null;
  }
  for (const [file, image] of images) {
    if (image.width !== both.width || image.height !== both.height) {
      problems.push({ character: id, file, code: "sizeMismatch" });
      return null;
    }
  }
  const icons = await loadIcons(entry, decode, problems);
  if (!icons) return null;
  const alpha = new Uint8Array(both.width * both.height);
  for (const image of images.values()) for (let i = 0; i < alpha.length; i++) if (image.alpha[i]! > alpha[i]!) alpha[i] = image.alpha[i]!;
  return {
    width: both.width,
    height: both.height,
    scale: entry.manifest.scale,
    pixel: entry.manifest.pixel,
    alpha,
    both: both.dataUrl,
    left: left.dataUrl,
    right: right.dataUrl,
    face: images.get("face.png")?.dataUrl ?? null,
    // A closed face without its open one has nothing to swap with.
    faceBlink: images.has("face.png") ? (images.get("face-blink.png")?.dataUrl ?? null) : null,
    blink: images.get("blink.png")?.dataUrl ?? null,
    accessory: images.get("accessory.png")?.dataUrl ?? null,
    icons,
  };
}

async function loadIcons(entry: Listed, decode: DecodeImage, problems: DeskPetArtProblem[]): Promise<Record<string, string> | null> {
  const icons: Record<string, string> = {};
  for (const [file, family] of Object.entries(DESK_PET_ICON_FILES)) {
    const bytes = await entry.read(file);
    if (bytes === "missing") continue;
    const decoded = Buffer.isBuffer(bytes) && typeof checkDeskPetIcon(bytes) !== "string" ? decode(bytes) : null;
    if (!decoded) {
      problems.push({ character: entry.character.id, file, code: "undecodable" });
      return null;
    }
    icons[family] = decoded.dataUrl;
  }
  return icons;
}

/** Spreads an image's alpha over a box of a `width`-wide unit grid, keeping the highest value per unit. */
function stampAlpha(into: Uint8Array, width: number, image: DecodedImage, box: { x: number; y: number; width: number; height: number }): void {
  const height = into.length / width;
  for (let y = 0; y < image.height; y++) {
    const uy = box.y + Math.floor((y * box.height) / image.height);
    if (uy < 0 || uy >= height) continue;
    for (let x = 0; x < image.width; x++) {
      const ux = box.x + Math.floor((x * box.width) / image.width);
      if (ux < 0 || ux >= width) continue;
      const a = image.alpha[y * image.width + x]!;
      const at = uy * width + ux;
      if (a > into[at]!) into[at] = a;
    }
  }
}

async function loadScene(entry: Listed, scene: DeskPetScene, decode: DecodeImage, problems: DeskPetArtProblem[], perUnit: number): Promise<LoadedCharacter | null> {
  const id = entry.character.id;
  const fitOf = (units: { width: number; height: number }) => (Number.isFinite(perUnit) ? { width: Math.ceil(units.width * perUnit), height: Math.ceil(units.height * perUnit) } : undefined);
  const onCharacter = new Set(deskPetCharacterFiles(scene));
  const images: Record<string, string> = {};
  const alpha = new Uint8Array(scene.canvas.width * scene.canvas.height);
  let pileAlpha: Uint8Array | null = null;
  let bytesTotal = 0;
  for (const file of deskPetSceneFiles(scene)) {
    const bytes = await entry.read(file);
    if (!Buffer.isBuffer(bytes)) {
      problems.push({ character: id, file, code: bytes === "missing" ? "missingFile" : bytes === "notPlain" ? "notPlainFile" : "tooLarge" });
      return null;
    }
    bytesTotal += bytes.length;
    if (bytesTotal > DESK_PET_SCENE.setBytes) {
      problems.push({ character: id, file: null, code: "setTooLarge" });
      return null;
    }
    const pile = scene.pile?.image === file ? scene.pile : null;
    // Covers are projected onto a few dozen units at most: the character's box is plenty.
    const units = pile ?? (scene.sparkle?.image === file ? scene.sparkle : scene.character);
    const decoded = typeof checkSceneImage(bytes) === "string" ? null : decode(bytes, fitOf(units));
    if (!decoded) {
      problems.push({ character: id, file, code: "undecodable" });
      return null;
    }
    images[file] = decoded.dataUrl;
    if (onCharacter.has(file)) stampAlpha(alpha, scene.canvas.width, decoded, scene.character);
    if (pile) {
      pileAlpha = new Uint8Array(pile.width * pile.height);
      stampAlpha(pileAlpha, pile.width, decoded, { x: 0, y: 0, width: pile.width, height: pile.height });
    }
  }
  const icons = await loadIcons(entry, decode, problems);
  if (!icons) return null;
  return {
    width: scene.canvas.width,
    height: scene.canvas.height,
    scale: entry.manifest.scale,
    pixel: entry.manifest.pixel,
    alpha,
    both: "",
    left: "",
    right: "",
    face: null,
    faceBlink: null,
    blink: null,
    accessory: null,
    icons,
    scene: { scene, images, pileAlpha },
  };
}

/** A format 2 character's shape with `books` on its pile (a book in hand is part of the character's layers). */
export function sceneAlpha(character: Pick<LoadedCharacter, "alpha" | "width" | "scene">, books: number): Uint8Array {
  const pile = character.scene?.scene.pile;
  const pileAlpha = character.scene?.pileAlpha;
  if (!pile || !pileAlpha || books <= 0) return character.alpha;
  const out = character.alpha.slice();
  const height = out.length / character.width;
  for (let i = 0; i < Math.min(books, pile.max); i++) {
    const box = pileBookBox(pile, i);
    for (let y = 0; y < pile.height; y++) {
      const uy = box.y + y;
      if (uy < 0 || uy >= height) continue;
      for (let x = 0; x < pile.width; x++) {
        const at = uy * character.width + box.x + x;
        const a = pileAlpha[y * pile.width + x]!;
        if (a > out[at]!) out[at] = a;
      }
    }
  }
  return out;
}

/** The rest pose's layers, bottom to top, as PNG bytes; what a preview draws. Format 2: the idle clip's first frame. */
export async function restLayers(entry: Listed): Promise<Buffer[]> {
  const out: Buffer[] = [];
  const scene = entry.manifest.scene;
  if (scene) {
    const frame = scene.clips.idle![0]!;
    for (const file of [scene.bodies[frame.body]!.still, ...(frame.prop ? [scene.props[frame.prop]!.image] : [])]) {
      const bytes = await entry.read(file);
      if (Buffer.isBuffer(bytes) && typeof checkSceneImage(bytes) !== "string") out.push(bytes);
    }
    return out;
  }
  for (const file of ["face.png", "both.png", "accessory.png"]) {
    const bytes = await entry.read(file);
    if (Buffer.isBuffer(bytes) && typeof checkDeskPetImage(bytes) !== "string") out.push(bytes);
  }
  return out;
}

/** A character nothing draws (a blank set would be an unclickable, invisible pet). */
export function hasVisiblePixels(character: Pick<LoadedCharacter, "alpha">): boolean {
  return character.alpha.some((a) => a >= DESK_PET_ALPHA_MIN);
}

export async function ensureArtDir(artDir: string): Promise<void> {
  await mkdir(artDir, { recursive: true });
}
