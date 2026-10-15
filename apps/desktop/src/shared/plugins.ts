/** Local desktop plugin resources, never daemon protocol or credentials. */
export const PLUGINS_CHANNEL = "cutex-desktop:plugins";
export interface PluginCatalog {
  plugins: { manifest: unknown; fingerprint: string }[];
  errors: { id: string; message: string }[];
}
export interface PluginFrameInput { pluginId: string; fingerprint: string; instanceId: string; channel: string }
export interface PluginFrameResource { id: string; url: string }
export interface PluginBridge {
  list(): Promise<PluginCatalog>;
  prepare(input: PluginFrameInput): Promise<PluginFrameResource>;
  release(id: string): Promise<void>;
}
export type PluginRequest = { op: "list" } | ({ op: "prepare" } & PluginFrameInput) | { op: "release"; id: string };
