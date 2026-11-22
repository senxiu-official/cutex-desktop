// What the composer's model / effort chips show when the live thread settings do not say (owner
// 2026-11-18: no 「…」 placeholders, no alias lines). Pure, so it is unit-tested.
//
// The shown value is what the runtime actually uses, never a guess (owner 2026-11-20: never 「默认」):
// - effort: the thread's own explicit value (Claude's "none" = Claude Code's own default is no level); else the
//   host's resolution (`runtimeDefaults.reasoningResolution`, cutex resolved-reasoning-effort: its level, or
//   不支持 / 未上报); else the model row's default (model/list `defaultReasoningEffort` — Codex applies it to a null
//   effort); else the last level seen for this agent and model (a remount or reload before model/list answers);
//   else 「—」: 不支持 when the model lists no levels, otherwise 未上报.
// - model: the thread's model; else the last name seen for this agent; else the catalog's default row.

import { claudeIdInfo } from "./claudeModels";
import { explicitLevel, levelShown, noneShown, resolutionShown, type EffortShown } from "./effortDisplay";
import type { AliasResolution, ReasoningResolution } from "../../../shared/modelResolution";

const remembered = new Map<string, string>();
const key = (...parts: (string | null | undefined)[]) => parts.map((p) => p ?? "").join("\u0000");

export interface EffortRow { model: string; id?: string; efforts: readonly string[]; defaultEffort?: string | null }

/** The chip's effort: a level, or 「—」 with why. */
export function shownEffort(host: string, session: string, model: string | null, live: string | null, row: EffortRow | null | undefined, opts: { resolution?: ReasoningResolution | null; claude?: boolean } = {}): EffortShown {
  const k = key("effort", host, session, model);
  const own = explicitLevel(live, !!opts.claude);
  if (own) { remembered.set(k, own); return levelShown(own); }
  if (opts.resolution) {
    const shown = resolutionShown(opts.resolution);
    if (shown.level) remembered.set(k, shown.level);
    return shown;
  }
  // Claude's "none": the thread runs Claude Code's own default — a row default or an earlier level is not it.
  if (opts.claude && live === "none") return noneShown("unreported");
  // A listed model with no levels (a trusted empty list): 不支持, never an earlier level or a row default.
  if (row && !row.efforts.length) return noneShown("unsupported");
  const fromRow = explicitLevel(row?.defaultEffort, !!opts.claude);
  const value = (fromRow && row!.efforts.includes(fromRow) ? fromRow : null) ?? remembered.get(k) ?? null;
  if (value) { remembered.set(k, value); return levelShown(value); }
  return noneShown("unreported");
}

/** The model chip's name: the live name, else the last one seen for this agent, else the default row's. */
export function shownModelName(host: string, session: string, live: string, defaultRow: { displayName?: string; model: string } | null | undefined): string {
  if (live) { remembered.set(key("model", host, session), live); return live; }
  return remembered.get(key("model", host, session)) ?? defaultRow?.displayName ?? defaultRow?.model ?? "";
}

/** The context ring's last report for this agent (thread/read on reopen carries none). */
export function shownContext<T>(host: string, session: string, live: T | null | undefined): T | null {
  const k = key("context", host, session);
  if (live) { contextSeen.set(k, live); return live; }
  return (contextSeen.get(k) as T | undefined) ?? null;
}
const contextSeen = new Map<string, unknown>();

/**
 * Whether the model that answered (`lastObservedModel`) is a different model from what the chip says: another family
 * or another version. Claude ids compare by family + version (claudeIdInfo), so a date suffix and `[1m]` in any
 * order do not make the same model look different. A family alias compares with the handshake target its label
 * names (`aliasTarget`); without one the label's version (if any) came from this very answer, so only the family
 * counts (owner 2026-11-23).
 */
export function observedDiffers(observed: string | null, current: string | null, observedIsShown: boolean, aliasTarget: string | null = null): boolean {
  if (!observed || observedIsShown || !current) return false;
  const seen = claudeIdInfo(observed), chosen = claudeIdInfo(current);
  if (seen.kind === "pinned" && (chosen.kind === "pinned" || chosen.kind === "alias")) {
    if (seen.family !== chosen.family) return true;
    const resolved = aliasTarget ? claudeIdInfo(aliasTarget) : null;
    const target = chosen.kind === "pinned" ? chosen.version : resolved?.kind === "pinned" ? resolved.version : null;
    return !!target && !sameVersion(seen.version!, target);
  }
  const norm = (m: string) => m.toLowerCase().replace(/\[1m\]$/, "").replace(/-\d{8}$/, "").replace(/^claude-/, "");
  return norm(observed) !== norm(current);
}

const sameVersion = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/**
 * Whether the model chip's tooltip names the model that answered (owner 2026-11-23: never as text beside the chip):
 * only when it is not the family / version the chip shows. `alias`: the handshake resolution — its target counts
 * when the label shows the handshake's version.
 */
export function answeringModelShown(observed: string | null, current: string | null, alias: AliasResolution | null): boolean {
  return observedDiffers(observed, current, false, alias?.version ? alias.resolvedModel : null);
}

/** Tests only. */
export function resetComposerShown(): void { remembered.clear(); contextSeen.clear(); }
