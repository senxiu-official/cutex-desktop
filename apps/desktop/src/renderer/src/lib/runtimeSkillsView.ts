// 运行时配置 → 技能 (owner 2026-11-28 「按推荐」; .claude/reports/runtime-config-pages-20261128.md): pure helpers for the
// per-runtime skill list and 「复制到…」 (shared/runtimeSkills). Kept free of React so they are unit-tested.
import type { CopyRuntime, RuntimeSkill, SkillCopyPreview, SkillOriginKind, SkillRuntime } from "../../../shared/runtimeSkills";
import { COPY_RUNTIMES, RUNTIME_SKILL_COPY_FEATURE, RUNTIME_SKILLS_FEATURE, runtimeSkillsFeature } from "../../../shared/runtimeSkills";

/** Product names, the same in every language. */
export const RUNTIME_NAME: Record<SkillRuntime, string> = { codex: "Codex", claude: "Claude", dsh: "DSH", kimi: "Kimi" };

/** Card order: what the owner wrote first, then plugins, admin, other, the built-in ones last (settings rules §5). */
export const ORIGIN_ORDER: readonly SkillOriginKind[] = ["personal", "plugin", "admin", "other", "builtin"];

export const isReadOnlyRuntime = (r: SkillRuntime): boolean => !(COPY_RUNTIMES as readonly string[]).includes(r);
export const otherRuntime = (r: CopyRuntime): CopyRuntime => (r === "codex" ? "claude" : "codex");

/** Skills grouped by origin in card order (empty origins left out); names sorted within a card. */
export function byOrigin(skills: readonly RuntimeSkill[]): { origin: SkillOriginKind; skills: RuntimeSkill[] }[] {
  return ORIGIN_ORDER.map((origin) => ({ origin, skills: skills.filter((s) => s.origin === origin).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.skills.length);
}

/**
 * A row's provenance: a short readable label, the raw value as its tooltip (settings rules §5). A plugin's id
 * (「documents@openai-curated」) shows its name part; a root label shows its last path part. Null when the card title
 * already says it all (a personal skill in the runtime's own root).
 */
export function sourceLabel(skill: Pick<RuntimeSkill, "origin" | "source">): { label: string; title: string } | null {
  const raw = skill.source.trim();
  if (!raw) return null;
  if (skill.origin === "plugin") return { label: raw.split("@")[0] || raw, title: raw };
  if (skill.origin === "personal" || skill.origin === "builtin") return null;
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return { label: parts.slice(-2).join("/") || raw, title: raw };
}

/** Why a runtime's list is not shown (null: list it). `base`: the host has runtime-skills at all. */
export function listBlockedReason(runtime: SkillRuntime, features: ReadonlySet<string>): "noInventory" | "noFlag" | null {
  if (!features.has(RUNTIME_SKILLS_FEATURE)) return "noInventory";
  return features.has(runtimeSkillsFeature(runtime)) ? null : "noFlag";
}

/** Why 「复制到…」 is disabled on a row (null: it can be used); the action stays in place either way (rules §5). */
export function copyBlockedReason(runtime: SkillRuntime, skill: Pick<RuntimeSkill, "copyable" | "origin">, features: ReadonlySet<string>): "readOnlyRuntime" | "noCopyFeature" | "notPersonal" | null {
  if (isReadOnlyRuntime(runtime)) return "readOnlyRuntime";
  if (!features.has(RUNTIME_SKILL_COPY_FEATURE)) return "noCopyFeature";
  if (!skill.copyable) return "notPersonal";
  return null;
}

/** The refusal codes the copy flow names (anything else shows the daemon's message). */
export const COPY_ERROR_CODES = ["unsupported_runtime", "skill_not_found", "skill_not_copyable", "skill_copy_confirmation_required", "skill_copy_preview_stale", "skill_copy_action_conflict", "skill_access_failed"] as const;
export type CopyErrorCode = (typeof COPY_ERROR_CODES)[number];
export const knownCopyError = (code: string): code is CopyErrorCode => (COPY_ERROR_CODES as readonly string[]).includes(code);
/** Errors after which only a fresh preview helps (the token is gone or the request changed). */
export const needsFreshPreview = (code: string): boolean => code === "skill_copy_preview_stale" || code === "skill_copy_action_conflict";

/** One action id per preview: a retry of the same apply reuses it (the daemon answers `replayed`). */
export function newActionId(random: () => string = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))): string {
  return `skill-copy-${random()}`;
}

/** What the preview's main button does. */
export function previewAction(p: Pick<SkillCopyPreview, "disposition" | "previewToken" | "confirmPhrase">): "copy" | "overwrite" | "skip" | "none" {
  if (p.disposition === "blocked" || !p.previewToken) return "none";
  return p.disposition;
}

/** The typed phrase matches (writes only; a skip needs none). Exact, after trimming the ends. */
export function confirmationOk(p: Pick<SkillCopyPreview, "confirmPhrase">, typed: string): boolean {
  return !p.confirmPhrase || typed.trim() === p.confirmPhrase;
}

export const scriptFiles = (p: Pick<SkillCopyPreview, "files">) => p.files.filter((f) => f.script);
/** Frontmatter keys whose meaning changes or that are dropped (the 「设置差异」 list; kept ones are not news). */
export const frontmatterChanges = (p: Pick<SkillCopyPreview, "frontmatter">) => p.frontmatter.filter((f) => f.change !== "preserve");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
