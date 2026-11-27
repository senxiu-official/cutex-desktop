// Settings → 技能: where a skill comes from (docs/design/settings-rules.md 「列表行」). One card per origin, whose title
// states it once (用户 / 仓库 / 管理员 / 插件 / 内置); a plugin's skill is in 插件 whatever its scope (codex reports
// plugin skills as user). A row's only provenance text is a plugin's short name, the raw id as its tooltip.
import type { SkillMetadata, SkillScope } from "@cutex-desktop/protocol/codex/v2";

export type SkillOrigin = SkillScope | "plugin";

/** Card order: what the owner wrote first, then what came with plugins, the built-in ones last. */
export const SKILL_ORIGINS: readonly SkillOrigin[] = ["user", "repo", "admin", "plugin", "system"];

export const skillOrigin = (s: Pick<SkillMetadata, "scope" | "pluginId">): SkillOrigin => (s.pluginId ? "plugin" : s.scope);

/** Only the owner's own skills (用户) can be archived; the others say why (codex-config.skills.archiveBlocked.*). */
export const skillArchivable = (origin: SkillOrigin): boolean => origin === "user";

/** A plugin id's readable part: 「documents@openai-primary-runtime」 → 「documents」. */
export const pluginShortName = (pluginId: string): string => pluginId.split("@")[0] || pluginId;
