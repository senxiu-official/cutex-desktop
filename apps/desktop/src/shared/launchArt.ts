// Launcher artwork (开场立绘): the portrait + victory pose of each provider. A build may bundle them
// (renderer lib/launchArt.ts, assets/launcher/), and Settings → 外观 → 启动页立绘 imports them at runtime
// from a folder the owner picks: main copies only the exact file names below (regular PNG files, at
// most LAUNCH_ART_MAX_BYTES each) into `<userData>/launcher-art/` (main/launchArt.ts) and hands the
// renderer `data:image/png` URLs over this channel, so no CSP change and no file:// access is needed.
// Imported art overrides the bundled art per provider, and only when both of its files are present.

export const LAUNCH_ART_CHANNEL = "cutex-desktop:launch-art";

export const LAUNCH_ART_PROVIDERS = ["codex", "claude", "deepseek", "kimi", "glm", "gemini"] as const;
export type LaunchArtProvider = (typeof LAUNCH_ART_PROVIDERS)[number];

/** The file names the launcher uses (the same names in assets/launcher/ and in an imported folder). */
export const LAUNCH_ART_FILES: Record<LaunchArtProvider, { portrait: string; victory: string }> = {
  codex: { portrait: "codex-portrait-astra-v7.png", victory: "codex-victory-astra-v4.png" },
  claude: { portrait: "claude-portrait-redraw-v4.png", victory: "claude-victory-paired-v1.png" },
  deepseek: { portrait: "deepseek-portrait-redraw-v4.png", victory: "deepseek-victory-paired-v1.png" },
  kimi: { portrait: "kimi-portrait-redraw-v4.png", victory: "kimi-victory-paired-v1.png" },
  glm: { portrait: "glm-portrait-redraw-v4.png", victory: "glm-victory-paired-v1.png" },
  gemini: { portrait: "gemini-portrait-v2.png", victory: "gemini-victory-v1.png" },
};

/** One imported image's cap. */
export const LAUNCH_ART_MAX_BYTES = 10 * 1024 * 1024;
/** The folder under userData. */
export const LAUNCH_ART_DIR = "launcher-art";
/** The first eight bytes of every PNG file. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Per provider: both images as `data:image/png;base64,…` URLs. */
export type LaunchArtImages = Partial<Record<LaunchArtProvider, { portrait: string; victory: string }>>;

export interface LaunchArtState {
  /** The imported art (complete providers only). */
  imported: LaunchArtImages;
}

/** Why a file of the chosen folder was not imported. */
export type LaunchArtRefusal = "notFile" | "symlink" | "tooLarge" | "notPng" | "unreadable";

export interface LaunchArtImportResult {
  /** The folder dialog was cancelled: nothing changed. */
  canceled: boolean;
  /** Providers whose two files were copied (they replace that provider's earlier import). */
  imported: LaunchArtProvider[];
  /** Providers with only one usable file in the folder: not imported. */
  incomplete: LaunchArtProvider[];
  /** Files with a launcher name that were refused. Other names in the folder are ignored. */
  refused: { file: string; reason: LaunchArtRefusal }[];
  state: LaunchArtState;
}

export type LaunchArtRequest = { op: "state" } | { op: "import" } | { op: "clear" };

export interface LaunchArtBridge {
  state(): Promise<LaunchArtState>;
  /** Opens the native folder dialog in main, then imports from the chosen folder. */
  import(): Promise<LaunchArtImportResult>;
  /** Removes every imported image (bundled art, else the icon intro, shows again). */
  clear(): Promise<LaunchArtState>;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}
