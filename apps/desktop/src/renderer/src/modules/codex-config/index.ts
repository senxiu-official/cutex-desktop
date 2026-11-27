// 运行时配置 (owner 2026-11-28 「按推荐」, was 「Codex 配置」 under 工具): one switchable module under 主机与运行时. Its own
// page sits next to 运行时 in Settings; 插件, MCP 服务器, 技能 and 钩子 are its detail pages (no nav rows of their own, the
// breadcrumb goes through 运行时配置). Page ids and anchors are unchanged, so old links still open them. 精简 turns the
// whole module off.
import { Anchor, Cable, Puzzle, SlidersHorizontal, Wand2 } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const RuntimeConfigPage = lazyPage(() => import("../../components/settings/RuntimeConfigSettings").then((m) => m.RuntimeConfigPage));
const McpPage = lazyPage(() => import("../../components/settings/CapabilitiesSettings").then((m) => m.McpPage));
const SkillsPage = lazyPage(() => import("../../components/settings/RuntimeConfigSettings").then((m) => m.RuntimeSkillsPage));
const HooksPage = lazyPage(() => import("../../components/settings/CapabilitiesSettings").then((m) => m.HooksPage));
const PluginsPage = lazyPage(() => import("../../components/settings/PluginsSettings").then((m) => m.PluginsPage));

export const RUNTIME_CONFIG_PAGE = "runtime-config";

export default defineModule({
  id: "codex-config",
  titleKey: "codex-config.title",
  descriptionKey: "codex-config.description",
  contributes: {
    "settings.page": [
      { id: "codex-config.overview", page: RUNTIME_CONFIG_PAGE, group: "agents", order: 510, icon: SlidersHorizontal, titleKey: "runtimeConfig.nav", source: "host", hintKey: "runtimeConfig.pageHint", Page: RuntimeConfigPage, keywords: ["runtimeConfig.plugins", "runtimeConfig.skills", "runtimeConfig.mcp", "runtimeConfig.hooks"], sections: [{ anchor: "sync", titleKey: "codex-config.plugins.sync", keywords: ["codex-config.plugins.follow"] }] },
      { id: "codex-config.plugins", page: "plugins", group: "agents", order: 511, navParent: RUNTIME_CONFIG_PAGE, icon: Puzzle, titleKey: "codex-config.plugins", source: "codex", hintKey: "settings.pageHint.plugins", Page: PluginsPage, keywords: ["codex-config.plugins.tab.browse", "codex-config.plugins.market.add"] },
      { id: "codex-config.mcp", page: "mcp", group: "agents", order: 512, navParent: RUNTIME_CONFIG_PAGE, icon: Cable, titleKey: "codex-config.mcp", source: "codex", hintKey: "settings.pageHint.mcp", Page: McpPage, sections: [{ anchor: "configured", titleKey: "codex-config.mcp.configured", keywords: ["codex-config.mcp.add", "codex-config.mcp.command", "codex-config.mcp.tokenEnv"] }, { anchor: "builtin", titleKey: "codex-config.mcp.builtin" }] },
      { id: "codex-config.skills", page: "skills", group: "agents", order: 513, navParent: RUNTIME_CONFIG_PAGE, icon: Wand2, titleKey: "codex-config.skills", source: "host", hintKey: "runtimeConfig.skills.pageHint", Page: SkillsPage, keywords: ["runtimeConfig.skills.copyTo", "runtimeConfig.skills.byRuntime"], sections: [{ anchor: "byRuntime", titleKey: "runtimeConfig.skills.byRuntime" }] },
      { id: "codex-config.hooks", page: "hooks", group: "agents", order: 514, navParent: RUNTIME_CONFIG_PAGE, icon: Anchor, titleKey: "codex-config.hooks", source: "codex", hintKey: "settings.pageHint.hooks", Page: HooksPage, keywords: ["codex-config.hooks.trust", "codex-config.hooks.revoke"] },
    ],
  },
});
