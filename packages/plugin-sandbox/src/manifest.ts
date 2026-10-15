/** Strict external-plugin declarations; all executable content stays in an opaque frame. */
export const PLUGIN_CAPABILITIES = ["views", "entries", "agents.read", "agents.open", "settings"] as const;
export type PluginCapability = typeof PLUGIN_CAPABILITIES[number];
export interface PluginPage { id: `${string}.${string}`; title: string; order?: number }
export interface PluginNav { id: `${string}.${string}`; title: string; page: `${string}.${string}`; order?: number; area?: "top" | "footer" }
export interface PluginManifest {
  apiVersion: 1; id: string; name: string; version: string; entry: string; script?: string;
  styles: string[]; dependencies: string[]; capabilities: PluginCapability[];
  requires: { cutexCapabilities: string[]; hosts: "local" | "any" };
  codexPlugin?: string;
  contributes: { "main.page": PluginPage[]; "nav.primary": PluginNav[] };
}
export interface PluginCatalog {
  plugins: { manifest: PluginManifest; fingerprint: string }[];
  errors: { id: string; message: string }[];
}
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,54}$/;
export function isPluginAssetPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 240 && value.split("/").every(segment => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(segment));
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Invalid ${label}`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported ${label} field: ${key}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function strings(value: unknown, label: string, max = 32): string[] {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) throw new Error(`Invalid ${label}`);
  return value.map(entry => text(entry, label));
}
function asset(value: unknown, label: string, extension: RegExp): string {
  if (!isPluginAssetPath(value) || !extension.test(value)) throw new Error(`Invalid ${label} asset path`);
  return value;
}
function order(value: unknown): { order?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000) throw new Error("Invalid contribution order");
  return { order: value as number };
}
export function parsePluginManifest(input: unknown): PluginManifest {
  const raw = record(input, ["apiVersion", "id", "name", "version", "entry", "script", "styles", "dependencies", "capabilities", "requires", "codexPlugin", "contributes"], "manifest");
  if (raw.apiVersion !== 1) throw new Error("Unsupported plugin apiVersion");
  if (typeof raw.id !== "string" || !PLUGIN_ID_RE.test(raw.id)) throw new Error("Invalid plugin id");
  const id = raw.id;
  const version = text(raw.version, "version", 64);
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid plugin version");
  const capabilities = strings(raw.capabilities, "capabilities");
  for (const capability of capabilities) if (!(PLUGIN_CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`Unsupported plugin capability: ${capability}`);
  const dependencies = strings(raw.dependencies ?? [], "dependencies");
  for (const dependency of dependencies) if (!PLUGIN_ID_RE.test(dependency) || dependency === id) throw new Error("Invalid plugin dependency");
  const requires = record(raw.requires ?? {}, ["cutexCapabilities", "hosts"], "requires");
  const hosts = requires.hosts ?? "any";
  if (hosts !== "local" && hosts !== "any") throw new Error("Invalid plugin hosts");
  const cutexCapabilities = strings(requires.cutexCapabilities ?? [], "cutexCapabilities");
  for (const capability of cutexCapabilities) if (!/^[a-z][a-z0-9-]{0,95}$/.test(capability)) throw new Error("Invalid cutex capability");
  const contributions = record(raw.contributes ?? {}, ["main.page", "nav.primary"], "contributes");
  const itemId = (value: unknown): `${string}.${string}` => {
    if (typeof value !== "string" || !value.startsWith(`${id}.`) || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value) || value.length > 128) throw new Error("Invalid contribution id");
    return value as `${string}.${string}`;
  };
  const list = (slot: string): unknown[] => {
    const entries = contributions[slot] ?? [];
    if (!Array.isArray(entries) || entries.length > 16) throw new Error(`Invalid ${slot} contributions`);
    return entries;
  };
  const pages = list("main.page").map(value => {
    const row = record(value, ["id", "title", "order"], "page");
    return { id: itemId(row.id), title: text(row.title, "page title"), ...order(row.order) };
  });
  if (new Set(pages.map(page => page.id)).size !== pages.length) throw new Error("Duplicate page id");
  const nav = list("nav.primary").map(value => {
    const row = record(value, ["id", "title", "page", "order", "area"], "navigation");
    const page = itemId(row.page);
    if (!pages.some(candidate => candidate.id === page)) throw new Error("Navigation must target an owned page");
    if (row.area !== undefined && row.area !== "top" && row.area !== "footer") throw new Error("Invalid navigation area");
    return { id: itemId(row.id), title: text(row.title, "navigation title"), page, ...order(row.order), ...(row.area ? { area: row.area } : {}) } as PluginNav;
  });
  if (new Set(nav.map(item => item.id)).size !== nav.length) throw new Error("Duplicate navigation id");
  if (pages.length && !capabilities.includes("views")) throw new Error("Page contributions require views");
  if (nav.length && !capabilities.includes("entries")) throw new Error("Navigation contributions require entries");
  return { apiVersion: 1, id, name: text(raw.name, "name"), version, entry: asset(raw.entry, "entry", /\.html$/i),
    ...(raw.script === undefined ? {} : { script: asset(raw.script, "script", /\.(?:js|mjs)$/i) }),
    styles: strings(raw.styles ?? [], "styles", 16).map(path => asset(path, "style", /\.css$/i)), dependencies,
    capabilities: capabilities as PluginCapability[], requires: { cutexCapabilities, hosts },
    ...(raw.codexPlugin === undefined ? {} : { codexPlugin: text(raw.codexPlugin, "codexPlugin", 160) }),
    contributes: { "main.page": pages, "nav.primary": nav } };
}
export const parseManifest = parsePluginManifest;
