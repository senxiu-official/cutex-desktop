// ?effort=resolved | ?effort=legacy: explicit reasoning effort and Claude alias names (owner 2026-11-20; lib/effortDisplay,
// shared/modelResolution). The claude Profile's agents run the `opus` alias with Claude's "none" (Claude Code's own
// default) — the case where the composer used to say 「Opus 5.5 · 默认」.
// - resolved: the host reports cutex resolved-reasoning-effort — the session's resolution (中 from claudeCodeDefault; the
//   alias resolved by the SDK handshake to claude-opus-5-5, display version "5.5"), the alias rows of model/list and the
//   Profile catalog, and each catalog row's resolution (a row without levels: unsupported).
// - legacy: an older host — none of those fields; the last answering model is claude-opus-5-5 (「上次实际响应」 only).
// - handshake: the SDK handshake target without a display version, no answering model reported.
// - none: no handshake and no answering model.
// - mismatch: handshake 5.5, but the last answer came from claude-opus-4-8 (the tooltip case).
// SYNTHETIC: shapes from the cutex contract (feat/resolved-effort-and-claude-alias a7fc3da1). The session also lists a
// skipped Profile choice (`skipped`), so its hover line can be reviewed.

const param = typeof location !== "undefined" ? new URLSearchParams(location.search).get("effort") : null;
const SCENES = ["resolved", "legacy", "handshake", "none", "mismatch"] as const;
export const EFFORT_SCENE: (typeof SCENES)[number] | null = (SCENES as readonly string[]).includes(param ?? "") ? (param as (typeof SCENES)[number]) : null;
/** Scenes whose host reports cutex resolved-reasoning-effort. */
const RESOLVING = EFFORT_SCENE === "resolved" || EFFORT_SCENE === "handshake" || EFFORT_SCENE === "mismatch";

/** The claude Profile's live thread settings in the scene. */
export const EFFORT_SETTINGS: Record<string, unknown> = EFFORT_SCENE ? { model: "opus", effort: "none" } : {};

const target = (resolvedModel: string, family: string, version: string) => ({ resolvedModel, resolvedDisplayName: `${family} ${version}`, resolvedDisplayVersion: version });
const TARGETS: Record<string, { resolvedModel: string; resolvedDisplayName: string; resolvedDisplayVersion: string }> = {
  opus: target("claude-opus-5-5", "Opus", "5.5"),
  "opus[1m]": target("claude-opus-5-5", "Opus", "5.5"),
  sonnet: target("claude-sonnet-5-5", "Sonnet", "5.5"),
  "sonnet[1m]": target("claude-sonnet-5-5", "Sonnet", "5.5"),
  fable: target("claude-fable-5-1", "Fable", "5.1"),
  haiku: target("claude-haiku-5-5", "Haiku", "5.5"),
};
const aliasFields = (id: string) => {
  if (!RESOLVING || !TARGETS[id]) return {};
  if (EFFORT_SCENE === "handshake") return { resolvedModel: TARGETS[id].resolvedModel, resolvedModelSource: "sdkHandshake" };
  return { ...TARGETS[id], resolvedModelSource: "sdkHandshake" };
};

/** claudeModelStatus in the scene: the model that answered (null = none reported); undefined = the preview's usual. */
export function effortObserved(model: string): string | null | undefined {
  if (EFFORT_SCENE === "none" || EFFORT_SCENE === "handshake") return null;
  if (EFFORT_SCENE === "mismatch" && model === "opus") return "claude-opus-4-8";
  return undefined;
}

/** A Claude session's runtimeDefaults with its resolution (resolved scene only). */
export function effortRuntimeDefaults<T extends Record<string, unknown> | null>(base: T): T {
  if (!RESOLVING || !base) return base;
  return { ...base, reasoningResolution: { configured: null, value: "medium", source: "claudeCodeDefault", skipped: [{ source: "profile", value: "ultra", reason: "unsupportedByModel" }], requestedModel: "opus", ...aliasFields("opus") } };
}

/** A model/list option with its alias fields (resolved scene only). */
export const effortModelOption = <T extends { model: string }>(m: T): T => ({ ...m, ...aliasFields(m.model) });

type Row = { id: string; supportedReasoningEfforts: string[]; effortSupportKnown?: boolean };

/** The Profile models view with each row's resolution and alias fields (resolved scene, Claude catalogs only). */
export function effortModelsView<V extends { modelsSource?: { kind?: string | null } | null; models: Row[] }>(view: V): V {
  if (!RESOLVING || !view.modelsSource?.kind?.startsWith("claude")) return view;
  return {
    ...view,
    models: view.models.map((r) => {
      const none = r.effortSupportKnown === true && !r.supportedReasoningEfforts.length;
      return { ...r, ...aliasFields(r.id), modelReasoningEffort: null, reasoningEffort: none ? { configured: null, value: null, source: "unsupported" } : { configured: null, value: "medium", source: "claudeCodeDefault" } };
    }),
  };
}
