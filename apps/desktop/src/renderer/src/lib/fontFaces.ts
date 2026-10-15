import type { Appearance } from "./appearanceModel";
import { FONT_UNICODE_RANGES } from "./fontRanges";

export const FONT_VARIABLES = ["--font-sans", "--font-chat", "--font-mono", "--font-sans-latin", "--font-sans-cjk", "--font-chat-latin", "--font-chat-cjk"] as const;
export type FontVariable = typeof FONT_VARIABLES[number];
export type FontVariables = Record<FontVariable, string>;

/** Used until the first local-font generation is ready, and without the Font Loading API. */
export const FALLBACK_FONT_VARIABLES: FontVariables = {
  "--font-sans": "system-ui, sans-serif", "--font-chat": "system-ui, sans-serif", "--font-mono": "monospace",
  "--font-sans-latin": "system-ui, sans-serif", "--font-sans-cjk": "system-ui, sans-serif",
  "--font-chat-latin": "system-ui, sans-serif", "--font-chat-cjk": "system-ui, sans-serif",
};

const SANS_LATIN = ["Inter", "Segoe UI", "Noto Sans", "Liberation Sans", "Arial"];
const SANS_CJK = ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "SimSun"];
const MONO_LATIN = ["JetBrains Mono", "Cascadia Code", "Consolas", "Liberation Mono", "DejaVu Sans Mono"];
const MONO_CJK = ["Microsoft YaHei Mono", "Noto Sans Mono CJK SC", ...SANS_CJK];

type LocalStyle = { weight: "400" | "700"; style: "normal" | "italic"; names: string[] };
/** Actual full/PostScript face names, not a regular face relabelled as bold. */
const KNOWN_FACES: Record<string, readonly [string[], string[], string[]]> = {
  "segoe ui": [["Segoe UI Bold", "SegoeUI-Bold"], ["Segoe UI Italic", "SegoeUI-Italic"], ["Segoe UI Bold Italic", "SegoeUI-BoldItalic"]],
  consolas: [["Consolas Bold", "Consolas-Bold"], ["Consolas Italic", "Consolas-Italic"], ["Consolas Bold Italic", "Consolas-BoldItalic"]],
  arial: [["Arial Bold", "Arial-BoldMT"], ["Arial Italic", "Arial-ItalicMT"], ["Arial Bold Italic", "Arial-BoldItalicMT"]],
  georgia: [["Georgia Bold", "Georgia-Bold"], ["Georgia Italic", "Georgia-Italic"], ["Georgia Bold Italic", "Georgia-BoldItalic"]],
  inter: [["Inter Bold", "Inter-Bold"], ["Inter Italic", "Inter-Italic"], ["Inter Bold Italic", "Inter-BoldItalic"]],
  "jetbrains mono": [["JetBrains Mono Bold", "JetBrainsMono-Bold"], ["JetBrains Mono Italic", "JetBrainsMono-Italic"], ["JetBrains Mono Bold Italic", "JetBrainsMono-BoldItalic"]],
  "liberation sans": [["Liberation Sans Bold", "LiberationSans-Bold"], ["Liberation Sans Italic", "LiberationSans-Italic"], ["Liberation Sans Bold Italic", "LiberationSans-BoldItalic"]],
  "liberation mono": [["Liberation Mono Bold", "LiberationMono-Bold"], ["Liberation Mono Italic", "LiberationMono-Italic"], ["Liberation Mono Bold Italic", "LiberationMono-BoldItalic"]],
  "dejavu sans mono": [["DejaVu Sans Mono Bold", "DejaVuSansMono-Bold"], ["DejaVu Sans Mono Oblique", "DejaVuSansMono-Oblique"], ["DejaVu Sans Mono Bold Oblique", "DejaVuSansMono-BoldOblique"]],
  "noto sans": [["Noto Sans Bold", "NotoSans-Bold"], ["Noto Sans Italic", "NotoSans-Italic"], ["Noto Sans Bold Italic", "NotoSans-BoldItalic"]],
  "microsoft yahei": [["Microsoft YaHei Bold", "MicrosoftYaHei-Bold"], [], []],
  "noto sans cjk sc": [["Noto Sans CJK SC Bold", "NotoSansCJKsc-Bold"], [], []],
  "noto sans mono cjk sc": [["Noto Sans Mono CJK SC Bold", "NotoSansMonoCJKsc-Bold"], [], []],
};

export function localStyles(family: string): LocalStyle[] {
  // local() matches a face's full or PostScript name, never the family (Chromium on Windows and
  // Linux alike). Many regular faces are "<Family> Regular" / "<Family>-Regular" (JetBrains Mono,
  // Inter, Noto Sans on Linux, Dubai, Yu Gothic…), so the bare family alone would miss them.
  const compact = family.replace(/\s+/g, "");
  const styles: LocalStyle[] = [{ weight: "400", style: "normal", names: [...new Set([family, `${family} Regular`, `${compact}-Regular`, compact])] }];
  // Unknown families: the conventional face names only (never the regular names relabelled 700).
  // A face that is not installed fails to load and is skipped, so the browser synthesizes that
  // style from the regular face as before. Installed ones (static faces, or a variable font's
  // named instance: checked on Windows with Bahnschrift Bold) render the real bold / italic,
  // as main's plain font-family did. No variable axes are inferred.
  const [bold, italic, boldItalic] = KNOWN_FACES[family.toLowerCase()]
    ?? [[`${family} Bold`, `${compact}-Bold`], [`${family} Italic`, `${compact}-Italic`], [`${family} Bold Italic`, `${compact}-BoldItalic`]];
  if (bold.length) styles.push({ weight: "700", style: "normal", names: bold });
  if (italic.length) styles.push({ weight: "400", style: "italic", names: italic });
  if (boldItalic.length) styles.push({ weight: "700", style: "italic", names: boldItalic });
  return styles;
}

/** A CSS string, including control characters; never interpret a family as CSS. */
export function cssString(value: string): string {
  return `"${value.replace(/["\\\u0000-\u001F\u007F]/g, (c) => `\\${c.codePointAt(0)!.toString(16)} `)}"`;
}

export interface RoutedFace {
  alias: string;
  family: string;
  source: string;
  descriptors: { weight: string; style: string; unicodeRange: string; display: "swap" };
}
export interface FontPlan { faces: RoutedFace[]; variables: FontVariables; requestedFamilies: string[] }

function families(selected: string, defaults: readonly string[]): string[] {
  const seen = new Set<string>();
  return [selected, ...defaults].filter((f) => {
    if (!f || seen.has(f.toLowerCase())) return false;
    seen.add(f.toLowerCase());
    return true;
  });
}

/** Each source, including fallbacks, is restricted. No chosen raw family leaks into a stack. */
export function buildFontPlan(a: Appearance, generation: number): FontPlan {
  const faces: RoutedFace[] = [];
  const aliases = new Map<string, string>();
  const route = (family: string, unicodeRange: string): string => {
    const key = JSON.stringify([family.toLowerCase(), unicodeRange]);
    let alias = aliases.get(key);
    if (!alias) {
      alias = `cutex-font-${generation}-${aliases.size}`;
      aliases.set(key, alias);
      for (const { weight, style, names } of localStyles(family)) {
        faces.push({ alias, family, source: names.map((name) => `local(${cssString(name)})`).join(", "), descriptors: { weight, style, unicodeRange, display: "swap" } });
      }
    }
    return cssString(alias);
  };
  const stack = (latin: string[], cjk: string[], context: "latinContext" | "cjkContext", generic: string): string => [
    ...latin.map((family) => route(family, FONT_UNICODE_RANGES[context].latin)),
    ...cjk.map((family) => route(family, FONT_UNICODE_RANGES[context].cjk)), generic,
  ].join(", ");
  const uiLatin = families(a.uiFont, SANS_LATIN), uiCjk = families(a.cjkFont, SANS_CJK);
  const chatLatin = families(a.chatFont || a.uiFont, SANS_LATIN), chatCjk = families(a.chatCjkFont || a.cjkFont, SANS_CJK);
  const sansLatin = stack(uiLatin, uiCjk, "latinContext", "system-ui, sans-serif");
  const sansCjk = stack(uiLatin, uiCjk, "cjkContext", "system-ui, sans-serif");
  const chatLatinStack = stack(chatLatin, chatCjk, "latinContext", "system-ui, sans-serif");
  const chatCjkStack = stack(chatLatin, chatCjk, "cjkContext", "system-ui, sans-serif");
  // Code/terminal punctuation always stays on the mono side. An empty mono
  // selection still tries Latin monospace before the range-limited CJK side.
  const monoStack = stack(families(a.monoFont, MONO_LATIN), families(a.cjkFont, MONO_CJK), "latinContext", "monospace");
  return {
    faces,
    variables: {
      "--font-sans": sansLatin, "--font-chat": chatLatinStack,
      "--font-sans-latin": sansLatin, "--font-sans-cjk": sansCjk,
      "--font-chat-latin": chatLatinStack, "--font-chat-cjk": chatCjkStack,
      "--font-mono": monoStack,
    },
    requestedFamilies: [...new Set([a.uiFont, a.cjkFont, a.chatFont, a.chatCjkFont, a.monoFont].filter(Boolean))],
  };
}

export interface FontStatus {
  phase: "loading" | "ready" | "unsupported";
  generation: number;
  failedFamilies: readonly string[];
}
export interface LoadableFont { load(): Promise<unknown> }
export interface FontEnvironment<F extends LoadableFont> {
  createFace(spec: RoutedFace): F;
  add(face: F): void;
  remove(face: F): void;
  publish(variables: FontVariables): void;
  beforePublish?(): void;
  afterPublish?(): void;
  statusChanged?(status: FontStatus): void;
}

/** All loading happens off the active FontFaceSet. One generation owns a commit. */
export class FontRoutingController<F extends LoadableFont> {
  private generation = 0;
  private key = "";
  private pending: Promise<void> = Promise.resolve();
  private active: F[] = [];
  private status: FontStatus = { phase: "ready", generation: 0, failedFamilies: [] };
  constructor(private readonly environment: FontEnvironment<F>, private readonly timeoutMs = 4000) {}

  getStatus(): FontStatus { return this.status; }

  update(a: Appearance): Promise<void> {
    const key = JSON.stringify([a.uiFont, a.cjkFont, a.chatFont || a.uiFont, a.chatCjkFont || a.cjkFont, a.monoFont]);
    if (key === this.key) return this.pending;
    this.key = key;
    const generation = ++this.generation;
    this.setStatus({ phase: "loading", generation, failedFamilies: [] });
    const plan = buildFontPlan(a, generation);
    this.pending = this.prepare(plan, generation);
    return this.pending;
  }

  private setStatus(status: FontStatus): void {
    this.status = status;
    this.environment.statusChanged?.(status);
  }

  private async prepare(plan: FontPlan, generation: number): Promise<void> {
    const loaded = await Promise.all(plan.faces.map(async (spec) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const face = this.environment.createFace(spec);
        await Promise.race([
          face.load(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Local font load timed out")), this.timeoutMs); }),
        ]);
        return { face, spec };
      } catch { return null; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }));
    // Stale faces were never registered, so cannot affect rendering or leak.
    if (generation !== this.generation) return;
    const ready = loaded.filter((entry) => entry !== null);
    const regularFamilies = new Set(ready.filter(({ spec }) => spec.descriptors.weight === "400" && spec.descriptors.style === "normal").map(({ spec }) => spec.family.toLowerCase()));
    const failedFamilies = plan.requestedFamilies.filter((family) => !regularFamilies.has(family.toLowerCase()));
    const previous = this.active;
    this.environment.beforePublish?.();
    if (generation !== this.generation) return;
    for (const { face } of ready) this.environment.add(face);
    this.environment.publish(plan.variables);
    this.active = ready.map(({ face }) => face);
    this.setStatus({ phase: "ready", generation, failedFamilies });
    this.environment.afterPublish?.();
    for (const face of previous) this.environment.remove(face);
  }

  dispose(): void {
    ++this.generation;
    for (const face of this.active) this.environment.remove(face);
    this.active = [];
    this.key = "";
  }
}
